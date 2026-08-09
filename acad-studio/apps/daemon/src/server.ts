/** Acad Studio daemon — Express + SSE. Mỗi tin nhắn spawn một CLI agent local
 * (claude/codex/grok) headless, stream event chuẩn hoá về UI, lưu lịch sử SQLite.
 * Khi đóng gói: phục vụ UI tĩnh (Next export) qua ACAD_WEB_DIR và
 * thư mục dự án qua ACAD_PROJECT_ROOT (MEP_* aliases still accepted).
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { AGENTS, detectAgents, type AgentEvent } from "./agents.js";
import { acadBridgeRouter, ensureBridgeDirs } from "./acadBridge.js";
import { drawingStandardsRouter } from "./drawingStandards.js";
import { blockLibraryRouter } from "./blockLibraryRouter.js";
import { cadSelectionRouter } from "./cadSelection.js";
import { cadWebSyncRouter, createCadWebSyncControl } from "./cadwebSync.js";
import { lispLibraryRouter } from "./lispLibrary.js";
import which from "./which.js";
import { initDb, type Store } from "./db.js";
import { isAllowedBrowserOrigin } from "./originPolicy.js";
import {
  bindLispProposalMetadata,
  validLispProposal,
  withoutLispProposal,
} from "./lispReviewProtocol.js";

const MAX_AGENT_ARG_BYTES = 320 * 1024;
const MAX_AGENT_STDOUT_BYTES = 2 * 1024 * 1024;
const MAX_ASSISTANT_BYTES = 640 * 1024;
const MAX_AGENT_STDERR_BYTES = 64 * 1024;

// Khi đóng gói luôn có ACAD_PROJECT_ROOT / MEP_PROJECT_ROOT nên import.meta.url
// (không hợp lệ trong bundle CJS) chỉ được tính ở nhánh dev.
const PROJECT_ROOT =
  process.env.ACAD_PROJECT_ROOT ||
  process.env.MEP_PROJECT_ROOT ||
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const PORT = Number(process.env.ACAD_DAEMON_PORT ?? process.env.MEP_DAEMON_PORT ?? 8788);
const WEB_DIR = process.env.ACAD_WEB_DIR || process.env.MEP_WEB_DIR; // set khi đóng gói

async function main() {
  process.env.ACAD_PROJECT_ROOT = PROJECT_ROOT;
  process.env.MEP_PROJECT_ROOT = PROJECT_ROOT; // alias for older code paths
  const store: Store = await initDb();
  const cadWebSync = createCadWebSyncControl();

  const app = express();
  // This loopback daemon can execute AutoLISP. Browser Origin is therefore a
  // security boundary: Electron/dev UI are allowed, arbitrary websites are not.
  app.use((req, res, next) => {
    const origin = req.get("origin");
    const browserCrossSiteWithoutOrigin =
      !origin && req.get("sec-fetch-site") === "cross-site";
    if (!isAllowedBrowserOrigin(origin, PORT) || browserCrossSiteWithoutOrigin) {
      return res.status(403).json({
        ok: false,
        code: "origin_not_allowed",
        error: "Browser origin không được phép gọi Acad Studio daemon",
      });
    }
    return next();
  });
  app.use(cors({
    origin(origin, callback) {
      callback(null, isAllowedBrowserOrigin(origin, PORT));
    },
  }));
  app.use(express.json({ limit: "2mb" }));

  ensureBridgeDirs();
  app.use("/api/acad", acadBridgeRouter());
  app.use("/api/acad/selection", cadSelectionRouter());
  app.use("/api/acad/standards", drawingStandardsRouter());
  app.use("/api/acad/blocks", blockLibraryRouter());
  app.use("/api/acad/lisp", lispLibraryRouter({ projectRoot: PROJECT_ROOT }));
  app.use("/api/cadweb/sync", cadWebSyncRouter(cadWebSync));
  const { sessionRouter } = await import("./session.js");
  app.use("/api/acad", sessionRouter());
  const { drawRouter } = await import("./drawRouter.js");
  app.use("/api/acad", drawRouter());

  app.get("/api/health", (_req, res) => res.json({ ok: true, root: PROJECT_ROOT }));
  app.get("/api/agents", (_req, res) => res.json({ agents: detectAgents() }));
  app.get("/api/conversations", (_req, res) => res.json({ conversations: store.listConversations() }));
  app.get("/api/conversations/:id/messages", (req, res) =>
    res.json({ messages: store.getMessages(req.params.id) }));
  app.get("/api/lisp-proposal-decision", (req, res) => {
    const resourceId = String(req.query.resourceId ?? "");
    const baseRevision = String(req.query.baseRevision ?? "");
    const proposalHash = String(req.query.proposalHash ?? "");
    if (!resourceId || !baseRevision || !/^[a-f0-9]{64}$/.test(proposalHash)) {
      return res.status(400).json({ ok: false, error: "Thiếu/sai resourceId, baseRevision hoặc proposalHash" });
    }
    return res.json({
      ok: true,
      decision: store.getLispProposalDecision(resourceId, baseRevision, proposalHash),
    });
  });
  app.post("/api/lisp-proposal-decision", (req, res) => {
    const resourceId = String(req.body?.resourceId ?? "");
    const baseRevision = String(req.body?.baseRevision ?? "");
    const proposalHash = String(req.body?.proposalHash ?? "");
    const decision = String(req.body?.decision ?? "");
    if (
      !resourceId ||
      !baseRevision ||
      !/^[a-f0-9]{64}$/.test(proposalHash) ||
      decision !== "rejected"
    ) {
      return res.status(400).json({ ok: false, error: "Quyết định proposal không hợp lệ" });
    }
    store.setLispProposalDecision(resourceId, baseRevision, proposalHash, "rejected");
    return res.json({ ok: true, decision: "rejected" });
  });

  app.post("/api/chat", (req, res) => {
    const {
      agent: agentId = "claude",
      message = "",
      displayMessage = "",
      reviewResourceId = "",
      reviewBaseRevision = "",
      reviewCoverage = "",
      sessionId = null,
      conversationId,
    } = req.body ?? {};
    const agent = AGENTS[agentId];

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    const send = (ev: AgentEvent | Record<string, unknown>) =>
      res.write(`data: ${JSON.stringify(ev)}\n\n`);

    const text = String(message).trim();
    if (!agent) return void (send({ kind: "error", message: `Không có agent '${agentId}'` }), res.end());
    if (!text) return void (send({ kind: "error", message: "Tin nhắn trống" }), res.end());
    const readOnly = text.startsWith("[ACAD_LISP_REVIEW]");
    const coverage =
      reviewCoverage === "full-source" ||
      reviewCoverage === "partial-source" ||
      reviewCoverage === "metadata-only"
        ? reviewCoverage
        : null;
    if (readOnly && !coverage) {
      return void (
        send({ kind: "error", message: "Thiếu phạm vi source cho lượt review." }),
        res.end()
      );
    }
    if (readOnly && !agent.isolatedReview) {
      return void (
        send({
          kind: "error",
          message:
            `${agent.label} chưa có chế độ no-tools đủ cô lập để đọc source không tin cậy. ` +
            "Hãy chọn Claude hoặc Grok.",
        }),
        res.end()
      );
    }
    const storedText =
      readOnly && String(displayMessage).trim()
        ? String(displayMessage).trim().slice(0, 500)
        : text;

    const argv = agent.buildArgs(text, readOnly ? null : sessionId, { readOnly });
    const argvBytes = argv.reduce(
      (total, argument) => total + Buffer.byteLength(argument) + 1,
      Buffer.byteLength(which(agent.bin) || agent.bin),
    );
    if (argvBytes > MAX_AGENT_ARG_BYTES) {
      return void (
        send({
          kind: "error",
          message: "Nội dung gửi agent quá lớn; hãy giảm source/manifest rồi phân tích lại.",
        }),
        res.end()
      );
    }

    const convId = conversationId || randomUUID();
    send({ kind: "conversation", id: convId });
    store.ensureConversation(convId, agentId, storedText);
    store.addMessage(convId, "user", storedText);

    const binPath = which(agent.bin);
    if (!binPath) return void (send({ kind: "error", message: `Chưa cài CLI '${agent.bin}'` }), res.end());

    // Review runs in an isolated session so a previously permissive session
    // cannot carry write authority into the source-reading flow. It also gets
    // an empty working directory; the resource bytes are already in the prompt.
    const reviewDir = readOnly ? mkdtempSync(join(tmpdir(), "acad-lisp-review-")) : null;
    const child = spawn(binPath, argv, {
      cwd: reviewDir || PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let assistant = "";
    let finished = false;
    let outputLimitExceeded = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let reviewDirCleaned = false;
    const cleanupReviewDir = () => {
      if (!reviewDir || reviewDirCleaned) return;
      reviewDirCleaned = true;
      try { rmSync(reviewDir, { recursive: true, force: true }); } catch { /* best effort */ }
    };
    const errBuf: string[] = [];
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrBytes >= MAX_AGENT_STDERR_BYTES) return;
      const remaining = MAX_AGENT_STDERR_BYTES - stderrBytes;
      const kept = chunk.subarray(0, remaining);
      stderrBytes += kept.length;
      errBuf.push(kept.toString());
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= MAX_AGENT_STDOUT_BYTES || outputLimitExceeded) return;
      outputLimitExceeded = true;
      send({
        kind: "error",
        message: "Agent trả quá nhiều dữ liệu; đã dừng lượt review để bảo vệ app.",
      });
      child.kill();
    });

    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      line = line.trim();
      if (!line) return;
      let obj: any;
      try { obj = JSON.parse(line); } catch {
        return void send({ kind: "log", text: line.slice(0, 4_000) });
      }
      for (const ev of agent.parse(obj)) {
        if (ev.kind === "text") {
          const nextBytes = Buffer.byteLength(assistant) + Buffer.byteLength(ev.text);
          if (nextBytes > MAX_ASSISTANT_BYTES) {
            if (!outputLimitExceeded) {
              outputLimitExceeded = true;
              send({
                kind: "error",
                message: "Phản hồi agent vượt giới hạn an toàn; đã dừng trước khi lưu.",
              });
              child.kill();
            }
            continue;
          }
          assistant += ev.text;
        }
        if (outputLimitExceeded) continue;
        send(ev);
      }
    });

    child.on("close", (code) => {
      cleanupReviewDir();
      if (code && code !== 0) {
        const tail = errBuf.join("").slice(-400).trim();
        send({ kind: "error", message: `agent thoát mã ${code}. ${tail}` });
      }
      if (!outputLimitExceeded && assistant.trim()) {
        const proposalValid =
          readOnly &&
          validLispProposal(assistant, reviewResourceId, reviewBaseRevision);
        if (readOnly && !proposalValid && assistant.includes("<lisp-manifest-proposal>")) {
          send({
            kind: "error",
            message: "Proposal bị loại vì resource/revision không khớp lượt review.",
          });
        }
        const storedAssistant =
          proposalValid && coverage
            ? bindLispProposalMetadata(
                assistant.trim(),
                reviewResourceId,
                reviewBaseRevision,
                coverage,
              ) || withoutLispProposal(assistant)
            : withoutLispProposal(assistant);
        if (storedAssistant) store.addMessage(convId, "assistant", storedAssistant);
      }
      send({ kind: "end" });
      finished = true;
      res.end();
    });
    child.on("error", (e) => {
      cleanupReviewDir();
      send({ kind: "error", message: String(e) });
      finished = true;
      res.end();
    });

    // Chỉ giết agent khi client NGẮT giữa chừng (res.on close), KHÔNG dùng req.on close.
    res.on("close", () => { if (!finished) child.kill(); });
  });

  // Phục vụ UI tĩnh khi đóng gói (Next export).
  if (WEB_DIR && existsSync(WEB_DIR)) {
    app.use(express.static(WEB_DIR));
    // Catch-all chỉ dành cho route HTML. Một asset build (/_next/*) hay payload
    // điều hướng client (*.txt) không tìm thấy PHẢI trả 404: nếu trả index.html
    // kèm 200 text/html thì router Next nhận HTML thay vì payload và điều hướng
    // hỏng im lặng — trong khi curl một route HTML vẫn xanh.
    app.get("*", (req, res) => {
      if (req.path.startsWith("/_next/") || req.path.endsWith(".txt")) {
        return res.status(404).end();
      }
      return res.sendFile(resolve(WEB_DIR, "index.html"));
    });
  }

  const server = app.listen(PORT, "127.0.0.1", () => {
    cadWebSync.start();
    console.log(`[mep-daemon] http://127.0.0.1:${PORT}  (root: ${PROJECT_ROOT}${WEB_DIR ? ", ui tĩnh" : ""})`);
  });
  server.on("close", () => cadWebSync.stop());
}

main().catch((e) => { console.error("[mep-daemon] init lỗi:", e); process.exit(1); });
