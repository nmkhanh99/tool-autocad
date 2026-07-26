/**
 * drawRouter — API để agent/AI điều khiển VẼ THẬT theo hợp đồng
 *   yêu cầu → vẽ (stage) → xác nhận → áp dụng (apply).
 *
 *   GET  /api/acad/draw/scenario          kịch bản prompt (35 bước)
 *   POST /api/acad/draw/match    {text}   khớp câu chat «Vẽ …» với bước
 *   POST /api/acad/draw/new      {dwg?}   tạo bản vẽ trống để vẽ lên
 *   POST /api/acad/draw/stage    {text|stepId, dwg?}
 *   POST /api/acad/draw/apply    {opId}   ← chỉ gọi SAU khi user Chấp nhận
 *   POST /api/acad/draw/reject   {opId}
 *   GET  /api/acad/draw/verify   ?dwg=
 *   GET  /api/acad/draw/contract
 *
 * Ràng buộc: KHÔNG apply trong cùng request với stage.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import express, { type Router } from "express";
import {
  buildApplyLisp, buildDrawSteps, buildRejectLisp, buildStageLisp,
  buildVerifyLisp, drawScenarioJson, loadDrawRecipe, matchDrawStep,
  projectRoot,
} from "./drawT1.js";
import {
  coreConsoleAvailable, createBlankDwg, readReport, runHeadlessLisp,
} from "./headlessDraw.js";
import { openDocs, runLiveLisp } from "./liveDraw.js";

export const DRAW_CONTRACT = {
  order: ["stage", "user Chấp nhận", "apply"],
  rule: "KHÔNG gọi apply trong cùng request với stage; stage chỉ vẽ lên layer preview.",
  previewLayer: "ACAD-PREVIEW-<opId>",
  reject: "reject xoá toàn bộ entity preview, bản vẽ trở lại trạng thái trước bước.",
} as const;

function workDir(): string {
  return process.env.ACAD_DRAW_WORKDIR || join(projectRoot(), "acad-studio/.work");
}
function defaultDwg(): string {
  return join(workDir(), "T1-DEMO-VE-THAT.dwg");
}
function resultPath(): string {
  return join(workDir(), "draw-result.txt");
}

/**
 * ĐÍCH VẼ. Hai kiểu:
 *  - live: bản vẽ ĐANG MỞ trong AutoCAD → vẽ thẳng vào đó, người dùng thấy ngay.
 *  - file: DWG đóng trên đĩa → AcCoreConsole mở/sửa/lưu (mặc định `.work/…`).
 */
export type DrawTarget =
  | { kind: "live"; title: string; file: string }
  | { kind: "file"; dwg: string };

let target: DrawTarget | null = null;

export function getDrawTarget(): DrawTarget {
  return target ?? { kind: "file", dwg: defaultDwg() };
}
export function setDrawTarget(t: DrawTarget | null): void {
  target = t;
}

/** Nhãn ngắn để hiện trong chat / log. */
function targetLabel(t: DrawTarget): string {
  return t.kind === "live" ? `${t.title} (đang mở trong AutoCAD)` : t.dwg;
}

type StagedOp = {
  opId: string; stepId: string; target: DrawTarget;
  staged: number; previewLayer: string; destLayer: string | null;
  state: "staged" | "applied" | "rejected";
  at: number;
};

const ops = new Map<string, StagedOp>();

export function __resetDrawOps(): void {
  ops.clear();
}
export function listDrawOps(): StagedOp[] {
  return [...ops.values()];
}

/** Chạy 1 job vẽ theo đúng kênh của target. */
async function runForTarget(
  t: DrawTarget,
  build: (mode: "headless" | "live") => { lisp: string },
): Promise<{ ok: boolean; result: Record<string, string>; error?: string }> {
  if (t.kind === "live") {
    const out = await runLiveLisp({
      lisp: build("live").lisp,
      // ưu tiên đường dẫn file (định danh chắc chắn hơn title trùng tên)
      target: t.file || t.title,
    });
    return { ok: out.ok, result: out.result, error: out.error };
  }
  const out = await runHeadlessLisp({
    lisp: build("headless").lisp,
    dwg: t.dwg,
    resultPath: resultPath(),
  });
  return { ok: out.ok, result: out.result, error: out.error || out.output.slice(-400) };
}

export function drawRouter(): Router {
  const r = express.Router();

  r.get("/draw/contract", (_req, res) =>
    res.json({ ok: true, contract: DRAW_CONTRACT, coreConsole: coreConsoleAvailable() }));

  r.get("/draw/scenario", (_req, res) => {
    try {
      res.json({ ok: true, ...drawScenarioJson() });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  r.post("/draw/match", (req, res) => {
    const text = String(req.body?.text || req.body?.message || "");
    const step = matchDrawStep(text);
    res.json({
      ok: true,
      matched: !!step,
      step: step
        ? { id: step.id, order: step.order, phase: step.phase, prompt: step.prompt,
            title: step.title, destLayer: step.destLayer, expectCount: step.expectCount }
        : null,
    });
  });

  /** Danh sách bản vẽ ĐANG MỞ trong AutoCAD để người dùng chọn đích vẽ. */
  r.get("/draw/docs", async (_req, res) => {
    try {
      const d = await openDocs();
      const cur = getDrawTarget();
      res.json({
        ok: true,
        alive: d.alive,
        docs: d.docs,
        target: cur,
        targetLabel: targetLabel(cur),
        hint: d.alive
          ? "POST /api/acad/draw/target {title} để chọn bản vẽ đích."
          : "Chưa thấy plugin AcadBridge — mở AutoCAD và cài Acad-Bridge.bundle.",
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  /**
   * Chọn ĐÍCH VẼ.
   *   {title|file}  → bản vẽ đang mở trong AutoCAD (vẽ live)
   *   {dwg}         → file DWG đóng trên đĩa (AcCoreConsole)
   *   {}            → quay về mặc định `.work/…`
   */
  r.post("/draw/target", async (req, res) => {
    try {
      const wantDwg = req.body?.dwg ? String(req.body.dwg) : "";
      const wantDoc = String(req.body?.title || req.body?.file || "");

      if (wantDwg) {
        if (!existsSync(wantDwg)) {
          return res.status(400).json({ ok: false, error: `Không thấy file ${wantDwg}` });
        }
        setDrawTarget({ kind: "file", dwg: wantDwg });
      } else if (wantDoc) {
        const d = await openDocs();
        const hit = d.docs.find(
          (x) => x.title === wantDoc || x.file === wantDoc || x.file.endsWith(`/${wantDoc}`),
        );
        if (!hit) {
          return res.status(400).json({
            ok: false,
            error: `Không thấy bản vẽ đang mở '${wantDoc}'`,
            docs: d.docs.map((x) => x.title),
          });
        }
        setDrawTarget({ kind: "live", title: hit.title, file: hit.file });
      } else {
        setDrawTarget(null);
      }

      ops.clear(); // đổi đích → bỏ mọi preview treo của đích cũ
      const cur = getDrawTarget();
      res.json({
        ok: true,
        target: cur,
        targetLabel: targetLabel(cur),
        agentOutput:
          cur.kind === "live"
            ? `🎯 Đích vẽ: **${cur.title}** — bản vẽ đang mở trong AutoCAD. Các lệnh «Vẽ …» sẽ vẽ thẳng vào đó (không lưu file, bạn tự Save).`
            : `🎯 Đích vẽ: file đóng \`${cur.dwg}\` (AcCoreConsole sẽ mở và lưu lại).`,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  r.post("/draw/new", async (req, res) => {
    const dwg = String(req.body?.dwg || defaultDwg());
    const out = await createBlankDwg(dwg);
    setDrawTarget({ kind: "file", dwg });
    ops.clear();
    res.json({ ok: out.ok, dwg, target: getDrawTarget(), error: out.error });
  });

  r.post("/draw/stage", async (req, res) => {
    try {
      // Ưu tiên đích do request chỉ định, nếu không thì dùng đích đã chọn.
      let t: DrawTarget = getDrawTarget();
      if (req.body?.dwg) t = { kind: "file", dwg: String(req.body.dwg) };
      else if (req.body?.target) {
        const d = await openDocs();
        const want = String(req.body.target);
        const hit = d.docs.find((x) => x.title === want || x.file === want);
        if (hit) t = { kind: "live", title: hit.title, file: hit.file };
      }
      if (t.kind === "file" && !existsSync(t.dwg)) {
        return res.status(400).json({
          ok: false,
          error: `Chưa có bản vẽ ${t.dwg} — gọi POST /api/acad/draw/new, hoặc chọn bản vẽ đang mở bằng POST /api/acad/draw/target.`,
        });
      }

      const text = String(req.body?.text || req.body?.message || "");
      const stepId = req.body?.stepId
        ? String(req.body.stepId)
        : matchDrawStep(text)?.id;
      if (!stepId) {
        return res.json({ ok: false, matched: false, error: "Không khớp bước vẽ nào." });
      }
      const step = buildDrawSteps().find((s) => s.id === stepId);
      if (!step) return res.status(400).json({ ok: false, error: `Không có bước '${stepId}'` });

      const opId = randomUUID().replaceAll("-", "").slice(0, 24);
      const out = await runForTarget(t, (mode) =>
        buildStageLisp(stepId, opId, {
          mode,
          resultPath: resultPath(),
          savePath: t.kind === "file" ? t.dwg : undefined,
        }),
      );
      if (!out.ok) return res.status(500).json({ ok: false, error: out.error });

      const staged = Number(out.result.staged || 0);
      ops.set(opId, {
        opId, stepId, target: t, staged,
        previewLayer: out.result.previewLayer || "",
        destLayer: step.destLayer, state: "staged", at: Date.now(),
      });
      res.json({
        ok: true, matched: true, staged: true, committed: false, waitApply: true,
        opId, count: staged, expectCount: step.expectCount,
        previewLayer: out.result.previewLayer, destLayer: step.destLayer,
        target: t, targetLabel: targetLabel(t),
        step: { id: step.id, order: step.order, prompt: step.prompt, title: step.title },
        agentOutput:
          `⏸ Đã vẽ ${staged} đối tượng của «${step.title}» lên layer ${out.result.previewLayer} ` +
          `trong **${targetLabel(t)}**. CHƯA áp dụng — chờ bạn Chấp nhận.`,
        contract: DRAW_CONTRACT,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  r.post("/draw/apply", async (req, res) => {
    try {
      const opId = String(req.body?.opId || "");
      const op = ops.get(opId);
      if (!op) return res.status(400).json({ ok: false, error: `Không thấy opId '${opId}'` });
      if (op.state !== "staged") {
        return res.status(409).json({ ok: false, error: `op '${opId}' đã ${op.state}` });
      }
      const out = await runForTarget(op.target, (mode) =>
        buildApplyLisp(op.stepId, opId, {
          mode,
          resultPath: resultPath(),
          savePath: op.target.kind === "file" ? op.target.dwg : undefined,
        }),
      );
      if (!out.ok) return res.status(500).json({ ok: false, error: out.error });

      op.state = "applied";
      const applied = Number(out.result.applied || 0);
      res.json({
        ok: true, opId, committed: true, applied,
        destLayer: out.result.destLayer, stepId: op.stepId,
        target: op.target, targetLabel: targetLabel(op.target),
        agentOutput:
          `✓ Đã áp dụng ${applied} đối tượng sang layer ${out.result.destLayer} ` +
          `trong **${targetLabel(op.target)}**.` +
          (op.target.kind === "live" ? " Bản vẽ CHƯA lưu — bấm Save trong AutoCAD nếu muốn giữ." : ""),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  r.post("/draw/reject", async (req, res) => {
    try {
      const opId = String(req.body?.opId || "");
      const op = ops.get(opId);
      if (!op) return res.status(400).json({ ok: false, error: `Không thấy opId '${opId}'` });
      const out = await runForTarget(op.target, (mode) =>
        buildRejectLisp(op.stepId, opId, {
          mode,
          resultPath: resultPath(),
          savePath: op.target.kind === "file" ? op.target.dwg : undefined,
        }),
      );
      op.state = "rejected";
      res.json({
        ok: out.ok, opId, committed: false,
        erased: Number(out.result.erased || 0), stepId: op.stepId,
        target: op.target, targetLabel: targetLabel(op.target),
        agentOutput: `✗ Đã xoá ${out.result.erased || 0} đối tượng preview — bản vẽ giữ nguyên.`,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  r.get("/draw/verify", async (req, res) => {
    try {
      const dwg = String(req.query?.dwg || defaultDwg());
      if (!existsSync(dwg)) return res.status(400).json({ ok: false, error: `Không thấy ${dwg}` });
      const rep = join(workDir(), "draw-report.txt");
      const out = await runHeadlessLisp({ lisp: buildVerifyLisp(rep), dwg, resultPath: rep });
      const recipe = loadDrawRecipe();
      const got = readReport(rep);
      res.json({
        ok: out.ok, dwg, report: got,
        sample: {
          MLINE: recipe.totals.pipes, DIMENSION: recipe.totals.dims,
          MULTILEADER: recipe.totals.leaders, HATCH: recipe.totals.hatches,
          CIRCLE: recipe.totals.circles, INSERT: recipe.totals.fittings,
        },
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  r.get("/draw/ops", (_req, res) => res.json({ ok: true, ops: listDrawOps() }));

  return r;
}
