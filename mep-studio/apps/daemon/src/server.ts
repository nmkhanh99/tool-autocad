/** MEP Studio daemon — Express + SSE. Mỗi tin nhắn spawn một CLI agent local
 * (claude/codex/grok) headless, stream event chuẩn hoá về UI, lưu lịch sử SQLite.
 * Khi đóng gói: phục vụ luôn UI tĩnh (Next export) qua MEP_WEB_DIR và nhận
 * thư mục dự án qua MEP_PROJECT_ROOT.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { AGENTS, detectAgents, type AgentEvent } from "./agents.js";
import { acadBridgeRouter, ensureBridgeDirs } from "./acadBridge.js";
import which from "./which.js";
import { initDb, type Store } from "./db.js";

// Khi đóng gói luôn có MEP_PROJECT_ROOT nên import.meta.url (không hợp lệ trong
// bundle CJS) chỉ được tính ở nhánh dev — nhờ short-circuit của `||`.
const PROJECT_ROOT =
  process.env.MEP_PROJECT_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const PORT = Number(process.env.MEP_DAEMON_PORT ?? 8788);
const WEB_DIR = process.env.MEP_WEB_DIR; // set khi đóng gói -> phục vụ UI tĩnh

async function main() {
  process.env.MEP_PROJECT_ROOT = PROJECT_ROOT; // để acadBridge tìm mep_lib.lsp
  const store: Store = await initDb();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  ensureBridgeDirs();
  app.use("/api/acad", acadBridgeRouter());
  const { sessionRouter } = await import("./session.js");
  app.use("/api/acad", sessionRouter());

  app.get("/api/health", (_req, res) => res.json({ ok: true, root: PROJECT_ROOT }));
  app.get("/api/agents", (_req, res) => res.json({ agents: detectAgents() }));
  app.get("/api/conversations", (_req, res) => res.json({ conversations: store.listConversations() }));
  app.get("/api/conversations/:id/messages", (req, res) =>
    res.json({ messages: store.getMessages(req.params.id) }));

  app.post("/api/chat", (req, res) => {
    const { agent: agentId = "claude", message = "", sessionId = null, conversationId } = req.body ?? {};
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

    const convId = conversationId || randomUUID();
    send({ kind: "conversation", id: convId });
    store.ensureConversation(convId, agentId, text);
    store.addMessage(convId, "user", text);

    const binPath = which(agent.bin);
    if (!binPath) return void (send({ kind: "error", message: `Chưa cài CLI '${agent.bin}'` }), res.end());

    const argv = agent.buildArgs(text, sessionId);
    const child = spawn(binPath, argv, {
      cwd: PROJECT_ROOT, stdio: ["ignore", "pipe", "pipe"], env: process.env,
    });

    let assistant = "";
    let finished = false;
    const errBuf: string[] = [];
    child.stderr.on("data", (d) => errBuf.push(d.toString()));

    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      line = line.trim();
      if (!line) return;
      let obj: any;
      try { obj = JSON.parse(line); } catch { return void send({ kind: "log", text: line }); }
      for (const ev of agent.parse(obj)) {
        if (ev.kind === "text") assistant += ev.text;
        send(ev);
      }
    });

    child.on("close", (code) => {
      if (code && code !== 0) {
        const tail = errBuf.join("").slice(-400).trim();
        send({ kind: "error", message: `agent thoát mã ${code}. ${tail}` });
      }
      if (assistant.trim()) store.addMessage(convId, "assistant", assistant.trim());
      send({ kind: "end" });
      finished = true;
      res.end();
    });
    child.on("error", (e) => { send({ kind: "error", message: String(e) }); finished = true; res.end(); });

    // Chỉ giết agent khi client NGẮT giữa chừng (res.on close), KHÔNG dùng req.on close.
    res.on("close", () => { if (!finished) child.kill(); });
  });

  // Phục vụ UI tĩnh khi đóng gói (Next export).
  if (WEB_DIR && existsSync(WEB_DIR)) {
    app.use(express.static(WEB_DIR));
    app.get("*", (_req, res) => res.sendFile(resolve(WEB_DIR, "index.html")));
  }

  app.listen(PORT, "127.0.0.1", () => {
    console.log(`[mep-daemon] http://127.0.0.1:${PORT}  (root: ${PROJECT_ROOT}${WEB_DIR ? ", ui tĩnh" : ""})`);
  });
}

main().catch((e) => { console.error("[mep-daemon] init lỗi:", e); process.exit(1); });
