"use client";
import { useEffect, useRef, useState } from "react";
import { FUNCTIONS, GROUPS, byId, type Fn } from "./functions";
import DrawingInfoPanel from "./DrawingInfoPanel";
import LispLibraryPanel from "./LispLibraryPanel";
import {
  readLispProposal,
  proposalFingerprint,
  sameLispManifest,
  shownAssistantText,
  type LispManifestProposal,
} from "./lispProposal";

const DAEMON = process.env.NEXT_PUBLIC_DAEMON_URL || "http://127.0.0.1:8788";
const TOP_KEYS = new Set(["dir", "dwgs", "outDir", "save", "timeoutMs"]);

declare global {
  interface Window {
    acadStudio?: {
      signReview(input: {
        resourceId: string;
        baseRevision: string;
        proposalHash: string;
        analysisCoverage: string;
        acknowledgedIncomplete: boolean;
      }): Promise<Record<string, unknown>>;
    };
  }
}

type Agent = { id: string; label: string; available: boolean; isolatedReview?: boolean };
type Conv = { id: string; agent: string; title: string; created_at: number };
type Tool = { name: string; detail: string };
type Geom = { h: string; t: string; l: string; p?: number[][]; xy?: number[]; c?: number[]; r?: number; dn?: number; tx?: string };
type Preview = {
  state: "loading" | "staged" | "applied" | "rejected" | "error";
  sessionId?: string; opId?: string; error?: string; recipe?: string; params?: any;
  /** true = staged geometry is visible in open AutoCAD (MEP-PREVIEW), not just SVG sandbox */
  live?: boolean;
  /** "draw" = kịch bản vẽ T1 (/api/acad/draw/*); bỏ trống = live/sandbox preview thường */
  kind?: "draw";
  count?: number;
  handles?: string[];
  layer?: string;
  hint?: string;
  diff?: { added: Geom[]; removed: Geom[]; modified: Geom[]; summary: { added: number; removed: number; modified: number } };
  before?: Geom[]; after?: Geom[];
};
type Msg = {
  id?: string;
  role: "user" | "assistant" | "function" | "preview";
  text: string;
  thinking?: string;
  tools?: Tool[];
  cost?: number | null;
  error?: string;
  suggest?: string[];        // id chức năng agent gợi ý
  fn?: Fn;                   // message kết quả chức năng
  fnResult?: any;
  pv?: Preview;              // message xem trước thay đổi
  form?: QForm;              // form chọn tiêu chí do agent phát
  lispProposal?: LispManifestProposal; // manifest agent đề xuất, user duyệt mới lưu
};
type QOption = { label: string; value: string };
type QQuestion = { id: string; label: string; type: "radio" | "select" | "checkbox" | "text" | "number"; options?: (string | QOption)[] };
type QForm = { id: string; title: string; questions: QQuestion[]; submitted?: boolean };

let messageSequence = 0;
function newMessageId(): string {
  messageSequence += 1;
  return `msg-${Date.now().toString(36)}-${messageSequence.toString(36)}`;
}

function hydrateMessage(role: Msg["role"], text: string): Msg {
  return {
    id: newMessageId(),
    role,
    text,
    lispProposal: role === "assistant" ? readLispProposal(text) : undefined,
  };
}

async function reconcileLispProposals(messages: Msg[]): Promise<Msg[]> {
  return Promise.all(messages.map(async (message) => {
    const proposal = message.lispProposal;
    if (!proposal) return message;
    try {
      const proposalHash = await proposalFingerprint(proposal);
      const [response, decisionResponse] = await Promise.all([
        fetch(
          `${DAEMON}/api/acad/lisp/${encodeURIComponent(proposal.resourceId)}`,
          { cache: "no-store" },
        ),
        fetch(
          `${DAEMON}/api/lisp-proposal-decision?resourceId=${encodeURIComponent(proposal.resourceId)}` +
            `&baseRevision=${encodeURIComponent(proposal.baseRevision)}` +
            `&proposalHash=${encodeURIComponent(proposalHash)}`,
          { cache: "no-store" },
        ),
      ]);
      const body = await response.json().catch(() => ({}));
      const decisionBody = await decisionResponse.json().catch(() => ({}));
      const resource = body?.resource;
      if (!response.ok || !resource) return message;
      if (
        resource.reviewStatus === "approved" &&
        sameLispManifest(resource.manifest, proposal.manifest)
      ) {
        return {
          ...message,
          lispProposal: { ...proposal, state: "approved" as const, error: undefined },
        };
      }
      if (
        typeof resource.manifestRevision === "string" &&
        resource.manifestRevision !== proposal.baseRevision
      ) {
        return {
          ...message,
          lispProposal: {
            ...proposal,
            state: "superseded" as const,
            error: undefined,
          },
        };
      }
      if (decisionResponse.ok && decisionBody?.decision === "rejected") {
        return {
          ...message,
          lispProposal: { ...proposal, state: "rejected" as const, error: undefined },
        };
      }
    } catch {
      // History is still useful while the daemon/catalog is temporarily offline.
    }
    return message;
  }));
}

export default function Page() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agent, setAgent] = useState("claude");
  const [convs, setConvs] = useState<Conv[]>([]);
  const [activeConv, setActiveConv] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const messagesRef = useRef<Msg[]>([]);
  messagesRef.current = messages; // always latest for button handlers (avoid stale closure)
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [decideBusy, setDecideBusy] = useState<number | null>(null); // msg idx while accept/decline in flight
  const [panel, setPanel] = useState(true);
  const [health, setHealth] = useState<any>(null);
  const [healthOpen, setHealthOpen] = useState(false);
  const [fixing, setFixing] = useState<string>("");
  const [form, setForm] = useState<Fn | null>(null);
  const [formVals, setFormVals] = useState<Record<string, string>>({});
  const [docList, setDocList] = useState<{ title: string; file: string; active: boolean }[] | null>(null);
  const [docsAlive, setDocsAlive] = useState<boolean | null>(null);
  const [acadLive, setAcadLive] = useState<{ activeDoc: string; last: string } | null>(null);
  const [drawingInfoOpen, setDrawingInfoOpen] = useState(false);
  const [drawingInfoTarget, setDrawingInfoTarget] = useState("");
  const [drawingInfoRefreshToken, setDrawingInfoRefreshToken] = useState(0);
  const [lispLibraryOpen, setLispLibraryOpen] = useState(false);
  const [lispLibraryRefreshToken, setLispLibraryRefreshToken] = useState(0);
  const [lispProposalBusy, setLispProposalBusy] = useState<number | null>(null);
  /** Bản vẽ đang mở trong AutoCAD + đích vẽ đang chọn ("" = file .work mặc định). */
  const [drawDocs, setDrawDocs] = useState<{ title: string; file: string; active: boolean }[]>([]);
  const [drawTarget, setDrawTarget] = useState("");
  const sessionRef = useRef<string | null>(null);
  const viewEpochRef = useRef(0);
  const lispReviewExpectationRef = useRef<{
    resourceId: string;
    baseRevision: string;
    analysisCoverage: "full-source" | "partial-source" | "metadata-only";
  } | null>(null);
  const conversationLoadRef = useRef(0);
  const chatRef = useRef<HTMLDivElement>(null);
  const [autoBom, setAutoBom] = useState(false);
  const autoBomRef = useRef(false);
  const bomIdxRef = useRef<number | null>(null);
  // ObjectARX raw catalog (one-to-one with OBJECTARX-CAPABILITIES.md) — separate from MEP composites
  type RawCap = {
    id: string; name: string; api: string; catalogStatus: string;
    macAvailable: boolean; enabled: boolean; interactive: boolean;
    handler: string; reason: string; defaultParams?: Record<string, unknown>;
  };
  const [rawMenu, setRawMenu] = useState<Record<string, RawCap[]> | null>(null);
  const [rawOpen, setRawOpen] = useState(true);
  const [rawSummary, setRawSummary] = useState<any>(null);

  useEffect(() => { loadAgents(); loadConvs(); loadRawCatalog(); loadDrawDocs(); }, []);
  useEffect(() => {   // sự kiện realtime từ AutoCAD (plugin reactor → daemon SSE)
    const es = new EventSource(`${DAEMON}/api/acad/events`);
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        setAcadLive({ activeDoc: ev.activeDoc || "", last: `${ev.type}${ev.detail ? ": " + ev.detail : ""}` });
        if (String(ev.type).startsWith("doc")) {
          loadDocs();
          loadDrawDocs();
          setDrawingInfoTarget(ev.activeDoc || "");
          setDrawingInfoRefreshToken((token) => token + 1);
        }
        if (ev.type === "drawingModified" || ev.type === "pluginLoaded") {
          setDrawingInfoRefreshToken((token) => token + 1);
        }
        if (ev.type === "drawingModified" && autoBomRef.current) refreshBom();   // BOM tự cập nhật khi vẽ
      } catch { /* */ }
    };
    es.onerror = () => { /* daemon restart — EventSource tự reconnect */ };
    return () => es.close();
  }, []);
  useEffect(() => { chatRef.current?.scrollTo(0, chatRef.current.scrollHeight); }, [messages]);

  async function loadAgents() {
    try {
      const { agents } = await (await fetch(`${DAEMON}/api/agents`)).json();
      setAgents(agents);
      const first = agents.find((a: Agent) => a.available);
      if (first) setAgent(first.id);
    } catch { /* */ }
  }
  async function loadRawCatalog() {
    try {
      const r = await (await fetch(`${DAEMON}/api/acad/raw/catalog`)).json();
      if (r?.groups) { setRawMenu(r.groups); setRawSummary(r.summary || null); }
    } catch { /* daemon offline */ }
  }
  /** Mở AutoCAD GUI + (mặc định) file scratch mới để thao tác ObjectARX raw. */
  async function openAutoCAD(path?: string, opts?: { newFile?: boolean }) {
    const wantNew = opts?.newFile !== false && !path; // mặc định: tạo/mở scratch DWG
    setMessages((p) => [...p, {
      role: "function",
      text: path ? `📂 Mở bản vẽ trong AutoCAD` : (wantNew ? `🚀 Mở AutoCAD + file mới` : `🚀 Mở AutoCAD`),
      fn: { id: "open-acad", label: "Mở AutoCAD", group: "Hệ thống", icon: "🚀", desc: "POST /api/acad/open", endpoint: "open", fields: [], result: "text" },
    }]);
    try {
      const body = path ? { path } : (wantNew ? { new: true } : {});
      const r = await (await fetch(`${DAEMON}/api/acad/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })).json();
      if (r.ok === false || r.error) {
        return patchLast((m) => { m.error = r.error || "Không mở được AutoCAD (kiểm tra cài đặt /Applications/Autodesk)."; });
      }
      patchLast((m) => {
        m.fnResult = {
          live: true,
          hint: r.hint || (r.path
            ? `✓ Đã mở: ${r.path}. Đợi plugin AcadBridge nạp (~5–15s), rồi chạy ObjectARX raw.`
            : "✓ Đã mở AutoCAD. Trong CAD gõ NEW (hoặc File → New), đợi plugin AcadBridge, rồi chạy raw."),
        };
      });
      // Refresh docs heartbeat sau khi app + plugin nạp
      setTimeout(() => { loadDocs(); }, 4000);
      setTimeout(() => { loadDocs(); }, 10000);
    } catch (e) {
      patchLast((m) => { m.error = "Lỗi mở AutoCAD: " + e; });
    }
  }
  async function runRaw(cap: RawCap) {
    setMessages((p) => [...p, {
      role: "function",
      text: `⚙️ ObjectARX raw: ${cap.name}`,
      fn: { id: cap.id, label: cap.name, group: "ObjectARX raw", icon: "⚙️", desc: cap.api, endpoint: "raw", fields: [], result: "text" },
    }]);
    if (!cap.enabled) {
      return patchLast((m) => {
        m.error = cap.reason || "Capability disabled (Win-only / not on Mac)";
        m.fnResult = { live: true, hint: `blocked: ${cap.id}`, raw: { ok: false, blocked: true, id: cap.id } };
      });
    }
    try {
      const { docs, alive } = await loadDocs();
      const target = alive && docs.length ? (docs.find((d: any) => d.active) || docs[0]).title : undefined;
      const r = await (await fetch(`${DAEMON}/api/acad/raw/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: cap.id, target, params: cap.defaultParams || {} }),
      })).json();
      if (r.ok) {
        patchLast((m) => {
          m.fnResult = {
            live: true,
            hint: r.interactive
              ? `Interactive — thao tác trong AutoCAD (MEPRAW). id=${r.id}`
              : `✓ raw ${r.id}`,
            raw: r,
            selRows: r.payload
              ? [["key", "value"], ...Object.entries(r.payload).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)])]
              : undefined,
          };
        });
      } else {
        const needOpen = r.diagnostic === "autocad_not_running" || /AutoCAD chưa chạy/i.test(String(r.error || ""));
        patchLast((m) => {
          m.error = needOpen
            ? (r.error || "AutoCAD chưa chạy") + " — bấm 🚀 Mở AutoCAD ở panel trái, đợi app + plugin nạp, mở 1 DWG, rồi chạy lại."
            : (r.error || "raw invoke failed");
          m.fnResult = {
            live: true,
            hint: r.blocked ? `blocked: ${r.diagnostic || ""}` : "error",
            raw: r,
            canOpenAcad: needOpen,
          };
        });
      }
    } catch (e) {
      patchLast((m) => { m.error = "Lỗi raw invoke: " + e; });
    }
  }
  async function loadConvs() {
    try { setConvs((await (await fetch(`${DAEMON}/api/conversations`)).json()).conversations); } catch { /* */ }
  }
  function newChat() {
    conversationLoadRef.current += 1;
    viewEpochRef.current += 1;
    setMessages([]);
    setActiveConv(null);
    sessionRef.current = null;
  }

  function patchLast(fn: (m: Msg) => void) {
    setMessages((prev) => {
      const n = [...prev]; const last = { ...n[n.length - 1] }; fn(last); n[n.length - 1] = last; return n;
    });
  }

  function patchMessage(id: string, fn: (message: Msg) => void) {
    setMessages((previous) => previous.map((message) => {
      if (message.id !== id) return message;
      const updated = { ...message };
      fn(updated);
      return updated;
    }));
  }

  // ─── Chạy 1 chức năng (nút bấm hoặc gợi ý) ───
  async function loadDocs(): Promise<{ alive: boolean; docs: any[] }> {
    try {
      const r = await (await fetch(`${DAEMON}/api/acad/docs`)).json();
      setDocsAlive(!!r.alive); setDocList(r.docs || []);
      return { alive: !!r.alive, docs: r.docs || [] };
    } catch { setDocsAlive(false); setDocList([]); return { alive: false, docs: [] }; }
  }

  function openFn(fn: Fn) {
    setForm(fn);
    const init: Record<string, string> = {};
    fn.fields.forEach((f) => (init[f.name] = f.default || ""));
    if (fn.live) {
      setDocList(null); setDocsAlive(null);
      loadDocs().then(({ docs }) => {
        const act = docs.find((d: any) => d.active);
        if (act) setFormVals((v) => ({ ...v, __target: act.title }));
      });
    }
    setFormVals(init);
  }
  async function loadHealth() {
    try { setHealth(await (await fetch(`${DAEMON}/api/acad/health`)).json()); } catch { setHealth({ error: true }); }
  }
  async function openHealth() { setHealthOpen(true); loadHealth(); }
  async function runFix(action: string) {
    setFixing(action);
    try {
      const r = await (await fetch(`${DAEMON}/api/acad/setup/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      })).json();
      const baseHint = r.detail || r.hint || (r.ok ? "OK" : (r.error || "Lỗi"));
      const hint =
        baseHint +
        (action === "buildplugin" && r.ok ? " → bấm Restart AutoCAD để nạp plugin mới." : "");
      setMessages((p) => [...p, {
        role: "function",
        text: `⚙ Setup: ${action}`,
        fn: { id: "setup", label: action, group: "Hệ thống", icon: "⚙", desc: action, endpoint: "setup", fields: [], result: "text" },
        fnResult: {
          live: true,
          hint,
          raw: r,
        },
        error: r.ok === false ? (r.error || r.detail) : undefined,
      }]);
      if (action === "openacad" || action === "restartacad") {
        setTimeout(() => loadDocs(), 4000);
        setTimeout(() => loadDocs(), 12000);
      }
      // After successful plugin build, offer restart in chat
      if (action === "buildplugin" && r.ok) {
        setMessages((p) => [...p, {
          role: "assistant",
          text: "✓ Plugin đã cài. **Restart AutoCAD** (nút ⚙ hoặc bên dưới) để nạp bản fix reactor — không restart thì vẫn crash khi đổi tab.",
        }]);
      }
    } catch (e) {
      setMessages((p) => [...p, {
        role: "function", text: `⚙ Setup: ${action}`,
        fn: { id: "setup", label: action, group: "Hệ thống", icon: "⚙", desc: action, endpoint: "setup", fields: [], result: "text" },
        error: String(e),
      }]);
    }
    setFixing(""); loadHealth();
  }
  async function pick(name: string, kind: "file" | "folder") {
    try {
      const r = await (await fetch(`${DAEMON}/api/acad/pick`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }),
      })).json();
      if (r.path) setFormVals((v) => ({ ...v, [name]: r.path }));
    } catch { /* */ }
  }
  function parseVals(vals: Record<string, string>) {
    const body: any = { params: {} };
    let file = "";
    for (const [k, v] of Object.entries(vals)) {
      if (!v) continue;
      if (k === "file") { file = v; }
      else if (k === "pipes") {
        body.params.pipes = v.trim().split("\n").filter(Boolean).map((line) => {
          const [system, dn, ...pts] = line.trim().split(/\s+/);
          return { system, dn: Number(dn) || 90, points: pts.map((p) => p.split(",").map(Number)) };
        });
      } else if (TOP_KEYS.has(k)) body[k] = v; else body.params[k] = v;
    }
    return { body, file };
  }

  /** Nạp danh sách bản vẽ ĐANG MỞ trong AutoCAD + đích vẽ hiện tại. */
  async function loadDrawDocs() {
    try {
      const r = await (await fetch(`${DAEMON}/api/acad/draw/docs`)).json();
      if (!r.ok) return;
      setDrawDocs(r.docs || []);
      setDrawTarget(r.target?.kind === "live" ? r.target.title : "");
    } catch { /* daemon chưa lên */ }
  }

  /** Chọn đích vẽ: "" = file .work mặc định; ngược lại = title bản vẽ đang mở. */
  async function pickDrawTarget(title: string) {
    setDrawTarget(title);
    try {
      const r = await (await fetch(`${DAEMON}/api/acad/draw/target`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(title ? { title } : {}),
      })).json();
      setMessages((p) => [
        ...p,
        { role: "assistant", text: r.agentOutput || (r.error ? `✗ ${r.error}` : "Đã đổi đích vẽ.") },
      ]);
      if (r.error) setDrawTarget("");
    } catch (e) {
      setMessages((p) => [...p, { role: "assistant", text: "Lỗi đổi đích vẽ: " + e }]);
    }
  }

  /**
   * Kịch bản VẼ T1 (44 bước) — vẽ vào ĐÍCH đang chọn (bản vẽ đang mở, hoặc file .work).
   * stage → thẻ preview → chờ Chấp nhận → draw/apply.
   */
  async function runDrawStepInChat(text: string): Promise<boolean> {
    setMessages((p) => [
      ...p,
      { role: "user", text },
      { role: "assistant", text: "⏳ Đang vẽ lên layer preview…" },
    ]);
    try {
      const st = await (
        await fetch(`${DAEMON}/api/acad/draw/stage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        })
      ).json();

      if (!st.ok || !st.matched) {
        setMessages((p) => [
          ...p,
          { role: "assistant", text: `✗ ${st.error || "Không khớp bước vẽ nào."}` },
        ]);
        return false;
      }

      setMessages((p) => [
        ...p,
        {
          role: "preview",
          text: `${st.step?.title || text} (preview CAD)`,
          fn: byId("drawpipes"),
          pv: {
            state: "staged",
            live: true,
            kind: "draw",
            opId: st.opId,
            count: st.count,
            layer: st.previewLayer,
            hint:
              `Preview **${st.count}** đối tượng trên \`${st.previewLayer}\`` +
              (st.expectCount ? ` (mẫu: ${st.expectCount})` : "") +
              `. Đích: **${st.targetLabel}**. **Chưa commit** — bấm **Chấp nhận** / ` +
              `**Không chấp nhận** trước lệnh «Vẽ …» tiếp theo.`,
          },
        },
        { role: "assistant", text: st.agentOutput || `⏸ Preview «${text}» — chờ Chấp nhận.` },
      ]);
      return true;
    } catch (e) {
      setMessages((p) => [...p, { role: "assistant", text: "Lỗi vẽ: " + e }]);
      return false;
    }
  }

  /** Match kịch bản vẽ T1 (draw/*) từ chat. */
  async function tryRunScenarioFromChat(text: string): Promise<boolean> {
    try {
      const dr = await (
        await fetch(`${DAEMON}/api/acad/draw/match`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        })
      ).json();
      if (dr.ok && dr.matched && dr.step) {
        setPanel(false);
        return await runDrawStepInChat(text);
      }
      return false;
    } catch {
      return false;
    }
  }

  async function querySelection() {
    setMessages((p) => [...p, { role: "function", text: "🎯 Đối tượng đang chọn trong AutoCAD", fn: byId("livedraw") }]);
    try {
      const r = await (await fetch(`${DAEMON}/api/acad/livequery`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ what: "selection" }),
      })).json();
      if (r.state !== "done" || !r.result)
        return patchLast((m) => { m.error = "Không đọc được — plugin chưa phản hồi (khởi động lại AutoCAD) hoặc chưa chọn đối tượng."; });
      const msg = String(r.result.message || "");
      const n = (msg.match(/selection=(\d+)/) || [])[1] || "0";
      const rows = msg.split("\n").slice(1).filter(Boolean).map((l) => l.split("|"));
      patchLast((m) => { m.fnResult = { live: true, count: Number(n), hint: `Đang chọn ${n} đối tượng.` };
        if (rows.length) m.fnResult.selRows = [["Loại", "Layer", "Handle"], ...rows]; });
    } catch (e) { patchLast((m) => { m.error = "Lỗi: " + e; }); }
  }

  function bomToResult(r: any) {
    const pipeRows = [["Layer", "DN", "Dài (m)"], ...(r.pipes || []).map((p: any) => [p.layer, p.dn, String(p.len_m)])];
    const blkRows = (r.blocks || []).slice(0, 25).map((b: any) => [b.name, String(b.count)]);
    return { live: true,
      hint: `✓ BOM từ "${r.doc}" — ${r.pipes?.length || 0} nhóm ống, ${r.blocks?.length || 0} loại block.${autoBomRef.current ? " (tự cập nhật)" : ""}`,
      selRows: pipeRows.concat(blkRows.length ? [["— Block —", "SL", ""]].concat(blkRows.map((x: string[]) => [x[0], x[1], ""])) : []) };
  }
  async function insertBomTable() {
    setMessages((p) => [...p, { role: "function", text: "📋 Chèn bảng BOQ vào bản vẽ", fn: byId("livedraw") }]);
    const { alive, docs } = await loadDocs();
    if (!alive) return patchLast((m) => { m.error = "Plugin không phản hồi — khởi động lại AutoCAD."; });
    const target = (docs.find((d: any) => d.active) || docs[0] || {}).title || "";
    try {
      const r = await (await fetch(`${DAEMON}/api/acad/bomtable`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target, x: 0, y: 0 }),
      })).json();
      if (!r.ok) return patchLast((m) => { m.error = r.error || "Không chèn được bảng."; });
      patchLast((m) => { m.fnResult = { live: true, hint: r.hint }; });
    } catch (e) { patchLast((m) => { m.error = "Lỗi: " + e; }); }
  }
  async function highlight(layer: string) {
    const { alive, docs } = await loadDocs();
    if (!alive || !docs.length) return;
    const target = (docs.find((d: any) => d.active) || docs[0]).title;
    try {
      await fetch(`${DAEMON}/api/acad/highlight`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, layer }),
      });
    } catch { /* im lặng: đây là thao tác phụ trợ */ }
  }
  async function liveBom() {
    let idx = -1;
    setMessages((p) => { idx = p.length; return [...p, { role: "function", text: "📊 BOM live (bản vẽ đang mở)", fn: byId("livedraw") }]; });
    bomIdxRef.current = idx;
    try {
      const r = await (await fetch(`${DAEMON}/api/acad/livebom`)).json();
      if (!r.alive || r.error) return patchLast((m) => { m.error = r.error || "Plugin không phản hồi."; });
      patchLast((m) => { m.fnResult = bomToResult(r); });
    } catch (e) { patchLast((m) => { m.error = "Lỗi: " + e; }); }
  }
  async function refreshBom() {   // gọi bởi event drawingModified khi auto-BOM bật
    try {
      const r = await (await fetch(`${DAEMON}/api/acad/livebom`)).json();
      if (!r.alive || r.error) return;
      const i = bomIdxRef.current;
      if (i == null) return liveBom();
      setMessages((p) => p.map((m, k) => k === i ? { ...m, fnResult: bomToResult(r), error: undefined } : m));
    } catch { /* */ }
  }
  function toggleAutoBom() {
    const on = !autoBom; setAutoBom(on); autoBomRef.current = on;
    if (on) liveBom();
  }

  async function runLive(fn: Fn, params: any, target?: string) {
    setMessages((p) => [...p, { role: "function", text: `${fn.icon} ${fn.label}`, fn }]);
    const { alive, docs } = await loadDocs();
    if (!alive) return patchLast((m) => { m.error = "Plugin AcadBridge không phản hồi — khởi động lại AutoCAD (plugin tự nạp) rồi thử lại."; });
    if (!docs.length) return patchLast((m) => { m.error = "AutoCAD chưa mở bản vẽ nào — mở 1 bản vẽ rồi thử lại."; });
    const tgt = target || (docs.find((d: any) => d.active) || docs[0]).title;
    try {
      const [url, payload] = fn.native
        ? [`${DAEMON}/api/acad/native`, { target: tgt, pipes: params.pipes }]
        : [`${DAEMON}/api/acad/live`, { recipe: fn.liveRecipe || "drawpipes", params, target: tgt }];
      const r = await (await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      })).json();
      if (r.error) return patchLast((m) => { m.error = r.error; });
      patchLast((m) => { m.fnResult = { live: true, count: fn.native ? r.count : (params.pipes || []).length, hint: r.hint }; });
    } catch (e) { patchLast((m) => { m.error = "Lỗi: " + e; }); }
  }

  async function runFn(fn: Fn, vals: Record<string, string>) {
    setForm(null);
    const target = vals.__target || undefined;
    const { body, file } = parseVals(vals);
    delete body.params.__target;
    if (fn.live) return runLive(fn, body.params, target);
    if (fn.preview) return runPreview(fn, file, body.params);
    setMessages((p) => [...p, { role: "function", text: `${fn.icon} ${fn.label}`, fn }]);
    try {
      const r = await (await fetch(`${DAEMON}/api/acad/mep/${fn.endpoint}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      })).json();
      patchLast((m) => { m.fnResult = r; if (r.error) m.error = r.error; });
    } catch (e) { patchLast((m) => { m.error = "Lỗi gọi chức năng: " + e; }); }
  }

  async function runPreview(fn: Fn, file: string, params: any) {
    setMessages((p) => [...p, { role: "preview", text: fn.label, fn, pv: { state: "loading" } }]);
    try {
      // Prefer live on-AutoCAD preview when plugin is up and recipe supports it.
      const { alive, docs } = await loadDocs();
      const canLive =
        alive &&
        docs.length > 0 &&
        (fn.endpoint === "drawpipes" || fn.id === "drawpipes") &&
        Array.isArray(params?.pipes) &&
        params.pipes.length > 0;
      if (canLive) {
        const target = (docs.find((d: any) => d.active) || docs[0]).title;
        const lv = await (await fetch(`${DAEMON}/api/acad/livepreview`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipe: fn.endpoint, params, target }),
        })).json();
        if (lv.ok && lv.opId) {
          patchLast((m) => {
            m.pv = {
              state: "staged",
              live: true,
              opId: lv.opId,
              count: lv.count,
              handles: lv.handles,
              layer: lv.layer,
              recipe: fn.endpoint,
              params,
              hint: lv.hint,
            };
          });
          return;
        }
        // Fall through to sandbox SVG if live fails (old plugin without PREVIEW mode, etc.)
        if (lv.error && !file) {
          throw new Error(lv.error + " — mở file DWG trong form hoặc cập nhật plugin.");
        }
      }
      // Sandbox SVG session preview (complementary; no AutoCAD GUI required)
      if (!file) throw new Error("Thiếu file DWG cho preview sandbox (hoặc bật AutoCAD + plugin cho preview trực tiếp).");
      const so = await (await fetch(`${DAEMON}/api/acad/session/open`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ originalPath: file }),
      })).json();
      if (so.error) throw new Error(so.error);
      const pv = await (await fetch(`${DAEMON}/api/acad/preview`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: so.sessionId, recipe: fn.endpoint, params }),
      })).json();
      if (pv.error) throw new Error(pv.error);
      patchLast((m) => { m.pv = { state: "staged", sessionId: so.sessionId, opId: pv.opId, diff: pv.diff, after: pv.geometry, before: pv.before, recipe: fn.endpoint, params, live: false }; });
    } catch (e) { patchLast((m) => { m.pv = { state: "error", error: String(e) }; }); }
  }

  /** Accept/decline must read latest message state (buttons fire after async stage). */
  async function decide(pvMsgIdx: number, accept: boolean) {
    if (decideBusy != null) return;
    const m = messagesRef.current[pvMsgIdx];
    const pv = m?.pv;
    if (!pv || pv.state !== "staged" || !pv.opId) return;
    setDecideBusy(pvMsgIdx);
    try {
      if (pv.kind === "draw") {
        // Kịch bản vẽ T1 → draw/apply|reject (cùng opId từ draw/stage)
        const ep = accept ? "draw/apply" : "draw/reject";
        const r = await (await fetch(`${DAEMON}/api/acad/${ep}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ opId: pv.opId }),
        })).json();
        if (r.error || r.ok === false) throw new Error(r.error || "draw decide failed");
        if (r.agentOutput) setMessages((p) => [...p, { role: "assistant", text: r.agentOutput }]);
      } else if (pv.live) {
        // Live CAD preview (/livepreview) → livepreview apply|reject (same opId from stage)
        const ep = accept ? "livepreview/apply" : "livepreview/reject";
        const r = await (await fetch(`${DAEMON}/api/acad/${ep}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ opId: pv.opId }),
        })).json();
        if (r.error || r.ok === false) throw new Error(r.error || "live decide failed");
      } else {
        const ep = accept ? "apply" : "reject";
        const r = await (await fetch(`${DAEMON}/api/acad/${ep}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: pv.sessionId, opId: pv.opId }),
        })).json();
        if (r.error || r.ok === false) throw new Error(r.error || "sandbox decide failed");
      }
      setMessages((prev) =>
        prev.map((x, i) =>
          i === pvMsgIdx && x.pv
            ? { ...x, pv: { ...x.pv, state: accept ? "applied" : "rejected" } }
            : x,
        ),
      );
    } catch (e) {
      setMessages((prev) =>
        prev.map((x, i) =>
          i === pvMsgIdx && x.pv ? { ...x, pv: { ...x.pv, state: "error", error: String(e) } } : x,
        ),
      );
    } finally {
      setDecideBusy(null);
    }
  }

  async function decideLispProposal(msgIdx: number, accept: boolean) {
    const proposal = messagesRef.current[msgIdx]?.lispProposal;
    if (!proposal || proposal.state === "applying" || proposal.state === "approved") return;
    if (!accept) {
      setLispProposalBusy(msgIdx);
      try {
        const proposalHash = await proposalFingerprint(proposal);
        const response = await fetch(`${DAEMON}/api/lisp-proposal-decision`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resourceId: proposal.resourceId,
            baseRevision: proposal.baseRevision,
            proposalHash,
            decision: "rejected",
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.ok === false) {
          throw new Error(result.error || "Không lưu được quyết định từ chối.");
        }
        setMessages((prev) => prev.map((message, index) =>
          index === msgIdx && message.lispProposal
            ? { ...message, lispProposal: { ...message.lispProposal, state: "rejected", error: undefined } }
            : message));
      } catch (error) {
        setMessages((prev) => prev.map((message, index) =>
          index === msgIdx && message.lispProposal
            ? { ...message, lispProposal: { ...message.lispProposal, state: "error", error: String(error) } }
            : message));
      } finally {
        setLispProposalBusy(null);
      }
      return;
    }

    setLispProposalBusy(msgIdx);
    setMessages((prev) => prev.map((message, index) =>
      index === msgIdx && message.lispProposal
        ? { ...message, lispProposal: { ...message.lispProposal, state: "applying", error: undefined } }
        : message));
    try {
      const analysisCoverage = proposal.analysisCoverage || "unknown";
      if (analysisCoverage === "unknown") {
        throw new Error("Proposal cũ chưa ghi nhận phạm vi source; hãy yêu cầu agent phân tích lại.");
      }
      const proposalHash = await proposalFingerprint(proposal);
      if (!window.acadStudio?.signReview) {
        throw new Error("Duyệt cấu hình bảo mật chỉ khả dụng trong app Acad Studio desktop.");
      }
      const userProof = await window.acadStudio.signReview({
        resourceId: proposal.resourceId,
        baseRevision: proposal.baseRevision,
        proposalHash,
        analysisCoverage,
        acknowledgedIncomplete: analysisCoverage !== "full-source",
      });
      const challengeResponse = await fetch(
        `${DAEMON}/api/acad/lisp/${encodeURIComponent(proposal.resourceId)}/approval-challenge`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            baseRevision: proposal.baseRevision,
            proposalHash,
            analysisCoverage,
            acknowledgedIncomplete: analysisCoverage !== "full-source",
            userProof,
          }),
        },
      );
      const challenge = await challengeResponse.json().catch(() => ({}));
      if (!challengeResponse.ok || !challenge.approvalToken) {
        throw new Error(challenge.error || "Không tạo được xác nhận review.");
      }
      const response = await fetch(
        `${DAEMON}/api/acad/lisp/${encodeURIComponent(proposal.resourceId)}/manifest`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            baseRevision: proposal.baseRevision,
            approved: true,
            manifest: proposal.manifest,
            proposalHash,
            approvalToken: challenge.approvalToken,
          }),
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) {
        const rawError = String(result.error || "");
        if (rawError.startsWith("dependency_review_required:")) {
          const [, , ...reference] = rawError.split(":");
          throw new Error(
            `Cần phân tích và duyệt dependency ${reference.join(":")} trước khi duyệt resource này.`,
          );
        }
        throw new Error(rawError || (response.status === 409
          ? "File hoặc cấu hình đã đổi. Hãy yêu cầu agent phân tích lại."
          : `Không lưu được cấu hình (${response.status}).`));
      }
      setMessages((prev) => prev.map((message, index) =>
        index === msgIdx && message.lispProposal
          ? { ...message, lispProposal: { ...message.lispProposal, state: "approved", error: undefined } }
          : message));
      setLispLibraryRefreshToken((token) => token + 1);
    } catch (error) {
      setMessages((prev) => prev.map((message, index) =>
        index === msgIdx && message.lispProposal
          ? { ...message, lispProposal: { ...message.lispProposal, state: "error", error: String(error) } }
          : message));
    } finally {
      setLispProposalBusy(null);
    }
  }

  // ─── Chat ───
  async function send(
    text: string,
    opts?: {
      skipScenario?: boolean;
      freshSession?: boolean;
      displayText?: string;
      lispReview?: {
        resourceId: string;
        baseRevision: string;
        analysisCoverage: "full-source" | "partial-source" | "metadata-only";
      };
      agentOverride?: string;
    },
  ) {
    text = text.trim(); if (!text || busy) return;
    const streamViewEpoch = viewEpochRef.current;
    const userMessageId = newMessageId();
    const assistantMessageId = newMessageId();
    setBusy(true);
    setInput("");
    lispReviewExpectationRef.current = opts?.lispReview || null;
    // Prefer shipped full-sheet demo script when user chats y hệt kịch bản
    if (!opts?.skipScenario) {
      try {
        const handled = await tryRunScenarioFromChat(text);
        if (handled) {
          setBusy(false);
          return;
        }
      } catch { /* fall through to agent */ }
    }
    setMessages((p) => [
      ...p,
      { id: userMessageId, role: "user", text: opts?.displayText || text },
      { id: assistantMessageId, role: "assistant", text: "" },
    ]);
    const isolatedReview = opts?.freshSession === true;
    try {
      const resp = await fetch(`${DAEMON}/api/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: opts?.agentOverride || agent,
          message: text,
          displayMessage: opts?.displayText,
          reviewResourceId: opts?.lispReview?.resourceId,
          reviewBaseRevision: opts?.lispReview?.baseRevision,
          reviewCoverage: opts?.lispReview?.analysisCoverage,
          sessionId: opts?.freshSession ? null : sessionRef.current,
          conversationId: activeConv,
        }),
      });
      const reader = resp.body!.getReader(); const dec = new TextDecoder(); let buf = "";
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          if (block.startsWith("data:")) {
            try {
              handle(JSON.parse(block.slice(5).trim()), {
                ignoreSession: isolatedReview,
                messageId: assistantMessageId,
                viewEpoch: streamViewEpoch,
              });
            } catch { /* */ }
          }
        }
      }
    } catch (e) {
      patchMessage(assistantMessageId, (message) => {
        message.error = "Lỗi kết nối daemon: " + e;
      });
    }
    lispReviewExpectationRef.current = null;
    setBusy(false); loadConvs();
  }
  function handle(
    ev: any,
    opts: { ignoreSession?: boolean; messageId: string; viewEpoch: number },
  ) {
    const patchStreamMessage = (fn: (message: Msg) => void) =>
      patchMessage(opts.messageId, fn);
    const stillViewingStream = viewEpochRef.current === opts.viewEpoch;
    switch (ev.kind) {
      case "conversation": if (stillViewingStream) setActiveConv(ev.id); break;
      case "session": if (stillViewingStream && !opts.ignoreSession) sessionRef.current = ev.id; break;
      case "text": patchStreamMessage((m) => {
        m.text += ev.text;
        const mm = m.text.match(/MEP_SUGGEST:\s*(\[[^\]]*\])/);
        if (mm) { try { m.suggest = JSON.parse(mm[1]).map((x: any) => x.id || x); m.text = m.text.replace(mm[0], "").trim(); } catch { /* */ } }
        const fm = m.text.match(/<question-form([^>]*)>([\s\S]*?)<\/question-form>/);
        if (fm && !m.form) {
          try {
            const id = (fm[1].match(/id="([^"]*)"/) || [])[1] || "form";
            const title = (fm[1].match(/title="([^"]*)"/) || [])[1] || "Chọn tiêu chí";
            const body = JSON.parse(fm[2].trim());
            m.form = { id, title, questions: body.questions || [] };
          } catch { /* form chưa hoàn chỉnh */ }
        }
        if (!m.lispProposal) {
          const parsed = readLispProposal(m.text);
          const expected = lispReviewExpectationRef.current;
          if (
            parsed &&
            expected &&
            parsed.resourceId === expected.resourceId &&
            parsed.baseRevision === expected.baseRevision
          ) {
            m.lispProposal = {
              ...parsed,
              analysisCoverage: expected.analysisCoverage,
            };
          } else if (parsed) {
            m.error =
              "Agent trả proposal sai resource/revision hoặc không thuộc một lượt review do user khởi tạo.";
          }
        }
      }); break;
      case "thinking": patchStreamMessage((m) => { m.thinking = (m.thinking || "") + ev.text; }); break;
      case "tool": patchStreamMessage((m) => { m.tools = [...(m.tools || []), { name: ev.name, detail: ev.detail }]; }); break;
      case "error": patchStreamMessage((m) => { m.error = ev.message; }); break;
      case "done": patchStreamMessage((m) => { m.cost = ev.cost_usd; }); break;
    }
  }

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">Acad<span>·</span>Studio</div>
        <div className="newbtn" onClick={newChat}>＋ Hội thoại mới</div>
        <div className="histlbl">Lịch sử</div>
        <div className="hist">
          {convs.map((c) => (
            <div key={c.id} className={"conv" + (c.id === activeConv ? " active" : "")} title={c.title}
              onClick={async () => {
                const request = ++conversationLoadRef.current;
                viewEpochRef.current += 1;
                const { messages } = await (await fetch(`${DAEMON}/api/conversations/${c.id}/messages`)).json();
                if (conversationLoadRef.current !== request) return;
                const hydrated = messages.map((m: any) => hydrateMessage(m.role, m.content));
                setMessages(hydrated);
                setActiveConv(c.id); setAgent(c.agent); sessionRef.current = null;
                const reconciled = await reconcileLispProposals(hydrated);
                if (conversationLoadRef.current === request) setMessages(reconciled);
              }}>{c.title || "(không tiêu đề)"}</div>
          ))}
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <button className="pillbtn" onClick={() => setPanel(!panel)}>🧰 Chức năng</button>
          <button className="pillbtn" onClick={() => {
            setDrawingInfoTarget("");
            setDrawingInfoOpen(true);
          }} title="Đọc toàn bộ thông tin của bản vẽ đang active trong AutoCAD">
            ▦ Hồ sơ bản vẽ
          </button>
          <button className="pillbtn" onClick={() => setLispLibraryOpen(true)}
            title="Quét, đọc, cấu hình AI và nạp LSP/MNL/FAS vào bản vẽ đang mở">
            ⌘ Thư viện AutoCAD
          </button>
          <button className="pillbtn" onClick={openHealth} title="Kiểm tra plugin/heartbeat, CER vs crash, build & sửa">
            ⚙ Kiểm tra / Sửa AutoCAD
          </button>
          {acadLive && (
            <span className="acadchip" title={acadLive.last}>
              🎯 {acadLive.activeDoc || "AutoCAD"} <em>{acadLive.last.slice(0, 34)}</em>
            </span>
          )}
          <div className="spacer" />
          <select
            value={drawTarget}
            onChange={(e) => pickDrawTarget(e.target.value)}
            title="Bản vẽ đích — lệnh «Vẽ …» sẽ vẽ vào đây"
          >
            <option value="">📁 File .work (mặc định)</option>
            {drawDocs.map((d) => (
              <option key={d.file || d.title} value={d.title}>
                ✏️ {d.title}{d.active ? " •" : ""}
              </option>
            ))}
          </select>
          <button className="pillbtn" onClick={loadDrawDocs} title="Nạp lại danh sách bản vẽ đang mở trong AutoCAD">
            ⟳
          </button>
          <select value={agent} onChange={(e) => setAgent(e.target.value)}>
            {agents.map((a) => <option key={a.id} value={a.id} disabled={!a.available}>{a.label}{a.available ? "" : " (chưa cài)"}</option>)}
          </select>
        </div>

        <div className="chat" ref={chatRef}>
          <div className="wrap">
            {messages.length === 0 && (
              <div className="empty"><h2>Acad Studio — AutoCAD Toolkit</h2>
                <button className="drawing-empty-open" onClick={() => {
                  setDrawingInfoTarget("");
                  setDrawingInfoOpen(true);
                }}>▦ Xem hồ sơ bản vẽ đang active</button>
                <p>Chọn <b>bản vẽ đích</b> ở góc phải trên (bản vẽ đang mở trong AutoCAD),
                rồi gõ «Vẽ …» — ví dụ <b>«Vẽ lưới trục định vị A-B-C-D và 1-2-3-4-5-6»</b>,
                <b>«Vẽ cầu thang bộ»</b>, <b>«Vẽ ống thoát xí DN140»</b>.</p>
                <p>Mỗi bước hiện <b>preview</b> — bấm <b>Chấp nhận</b> mới ghi vào layer đích.</p></div>
            )}
            {messages.map((m, i) => <MessageView key={m.id || `${activeConv || "new"}-${i}-${m.role}`} m={m} idx={i} onRun={openFn}
              onDecide={decide} decideBusy={decideBusy === i}
              onLispDecision={decideLispProposal} lispBusy={lispProposalBusy === i}
              onSend={(text) => send(text)} setMessages={setMessages}
              onHighlight={highlight} onOpenAcad={() => openAutoCAD()} />)}
          </div>
        </div>

        <footer>
          <div className="composer">
            <textarea value={input} placeholder="Nhắn cho Acad Studio… «Vẽ ống…» / yêu cầu (Enter gửi)"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} />
            <button className="send" disabled={busy} onClick={() => send(input)}>Gửi</button>
          </div>
        </footer>
      </main>

      {panel && (
        <aside className="fnpanel">
          <div className="fnhead">Chức năng <span onClick={() => setPanel(false)}>✕</span></div>
          <div className="demorow" onClick={() => openAutoCAD(undefined, { newFile: true })}
            title="Mở AutoCAD 2027 + file scratch mới (ACAD-RAW-scratch.dwg) — AcadBridge / rebuild">
            🚀 Mở AutoCAD + file mới (trống)
          </div>
          <div className="demorow sel" onClick={querySelection} title="Đọc các đối tượng đang được chọn trong AutoCAD">
            🎯 Đối tượng đang chọn (từ AutoCAD)
          </div>
          <div className="demorow sel" onClick={liveBom} title="Bóc khối lượng bản vẽ đang mở — plugin C++ quét trực tiếp">
            📊 BOM live (bản vẽ đang mở)
          </div>
          <div className="demorow sel" onClick={insertBomTable} title="Chèn bảng khối lượng (AcDbTable) vào bản vẽ đang mở">
            📋 Chèn bảng BOQ vào bản vẽ
          </div>
          <div className={"demorow sel" + (autoBom ? " on" : "")} onClick={toggleAutoBom}
            title="Bật: BOM tự cập nhật mỗi khi bạn vẽ/sửa/xóa trong AutoCAD">
            {autoBom ? "🟢 BOM tự cập nhật: BẬT" : "🔄 BOM tự cập nhật: TẮT"}
          </div>

          {/* ── ObjectARX RAW (catalog đầy đủ, không phải workflow MEP phối hợp) ── */}
          <div className="fngroup rawroot">
            <div className="fngrouplbl rawtoggle" onClick={() => setRawOpen(!rawOpen)} title="Toàn bộ API ObjectARX raw theo OBJECTARX-CAPABILITIES.md">
              ⚙️ ObjectARX raw {rawSummary ? `(${rawSummary.enabled}/${rawSummary.total})` : ""} {rawOpen ? "▾" : "▸"}
              <a className="refr" style={{ marginLeft: 8 }} onClick={(e) => { e.stopPropagation(); loadRawCatalog(); }}>↻</a>
            </div>
            {rawOpen && !rawMenu && <div className="dim" style={{ padding: "4px 16px" }}>Đang tải catalog… (cần daemon)</div>}
            {rawOpen && rawMenu && Object.entries(rawMenu).map(([g, items]) => (
              <div key={"raw-" + g} className="fngroup">
                <div className="fngrouplbl rawsub">{g}</div>
                {items.map((c) => (
                  <div key={c.id}
                    className={"fnbtn rawbtn" + (c.enabled ? "" : " disabled") + (c.interactive ? " interactive" : "")}
                    onClick={() => runRaw(c)}
                    title={`${c.api}\n${c.reason || c.name}`}>
                    <span className="fnicon">{c.enabled ? (c.interactive ? "👆" : "⚙️") : "🚫"}</span>
                    <div>
                      <div className="fnname">{c.name}</div>
                      <div className="fndesc">
                        <code className="rawid">{c.id}</code>
                        {c.interactive ? " · interactive" : ""}
                        {!c.enabled ? " · disabled" : ""}
                        {" · "}{c.catalogStatus}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div className="fngrouplbl">MEP workflows (phối hợp)</div>
          {GROUPS.map((g) => (
            <div key={g} className="fngroup">
              <div className="fngrouplbl">{g}</div>
              {FUNCTIONS.filter((f) => f.group === g).map((f) => (
                <div key={f.id} className="fnbtn" onClick={() => openFn(f)} title={f.desc}>
                  <span className="fnicon">{f.icon}</span>
                  <div><div className="fnname">{f.label}</div><div className="fndesc">{f.desc}</div></div>
                </div>
              ))}
            </div>
          ))}
        </aside>
      )}

      {healthOpen && (
        <div className="modal" onClick={() => setHealthOpen(false)}>
          <div className="modalbox" onClick={(e) => e.stopPropagation()} style={{ width: 620, maxHeight: "85vh", overflow: "auto" }}>
            <h3>⚙ Kiểm tra / Sửa AutoCAD (ổn định + plugin)</h3>
            {!health && <div className="dim">Đang kiểm tra…</div>}
            {health?.error && <div className="err">Không gọi được daemon /api/acad/health</div>}
            {health?.checks && (
              <>
                <div className={"healthhead " + (health.ok ? "ok" : "warn2")}>
                  {health.ok
                    ? "✓ Headless control sẵn sàng."
                    : "⚠ Cần bổ sung cấu hình AutoCAD:"}
                  {health.channels && (
                    <div className="hdetail" style={{ marginTop: 6 }}>
                      Kênh: headless {health.channels.headless ? "✅" : "❌"} ·
                      GUI {health.channels.running ? "✅" : "❌"} ·
                      plugin live {health.channels.livePlugin ? "✅" : "❌"}
                    </div>
                  )}
                </div>

                {/* Stability: CER is NOT the bug; real fix = rebuild plugin + restart */}
                {health.stability && (
                  <div
                    className="healthhead warn2"
                    style={{ marginTop: 12, textAlign: "left", fontWeight: 400 }}
                    data-testid="stability-cer-note"
                  >
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>🛡 Ổn định (crash / CER)</div>
                    <div className="hdetail" style={{ whiteSpace: "pre-wrap" }}>
                      {health.stability.cerNotRootCause}
                    </div>
                    <div className="modalbtns" style={{ marginTop: 10, flexWrap: "wrap", gap: 8 }}>
                      <button
                        className="primary hfix"
                        disabled={fixing === "buildplugin"}
                        onClick={() => runFix("buildplugin")}
                        title="Build objectarx AcadBridge (fix reactor) và cài vào ApplicationPlugins"
                      >
                        {fixing === "buildplugin" ? "Đang build…" : "🔧 Build & cài plugin (fix crash)"}
                      </button>
                      <button
                        className="primary hfix"
                        disabled={fixing === "restartacad"}
                        onClick={() => runFix("restartacad")}
                      >
                        {fixing === "restartacad" ? "Đang restart…" : "↻ Restart AutoCAD"}
                      </button>
                      <button
                        className="hfix"
                        disabled={fixing === "openacad"}
                        onClick={() => runFix("openacad")}
                      >
                        {fixing === "openacad" ? "…" : "Mở AutoCAD"}
                      </button>
                      <button
                        className="hfix"
                        disabled={fixing === "fixfonts"}
                        onClick={() => runFix("fixfonts")}
                        title="Cài romans1.shx + SUPEROS.SHX thay thế"
                      >
                        {fixing === "fixfonts" ? "…" : "Aa Sửa font SHX"}
                      </button>
                    </div>
                  </div>
                )}

                {health.checks.map((c: any) => (
                  <div key={c.id} className="hrow" data-check-id={c.id} data-check-group={c.group || "readiness"}>
                    <span className="hicon">{c.ok ? "✅" : "⚠️"}</span>
                    <div className="hbody">
                      <div className="hlabel">{c.label}</div>
                      <div className="hdetail">{c.detail}</div>
                      {c.appload && (c.id === "pluginlive" || c.id === "acadbridge_reactor" || c.id === "mepbridge_reactor") && (
                        <div className="hdetail" style={{ marginTop: 4 }}>
                          <code style={{ fontSize: 11, wordBreak: "break-all" }}>{c.appload}</code>
                        </div>
                      )}
                    </div>
                    {c.fix && (!c.ok || c.group === "stability") && (
                      <button className="primary hfix" disabled={fixing === c.fix} onClick={() => runFix(c.fix)}>
                        {fixing === c.fix ? "Đang sửa…" :
                          c.fix === "buildplugin" ? "Build & cài" :
                          c.fix === "openacad" ? "Mở CAD" :
                          c.fix === "restartacad" ? "Restart CAD" :
                          c.fix === "fixfonts" ? "Sửa font" :
                          c.fix === "mkbridge" ? "Tạo bridge" : "Sửa"}
                      </button>
                    )}
                    {!c.ok && !c.fix && c.id === "sdk" && (
                      <a className="pickbtn hfix" href="https://aps.autodesk.com/developer/overview/objectarx-autocad-sdk" target="_blank" rel="noreferrer">Tải SDK</a>
                    )}
                  </div>
                ))}
              </>
            )}
            <div className="modalbtns" style={{ marginTop: 16 }}>
              <button onClick={loadHealth}>↻ Kiểm lại</button>
              <button className="primary" onClick={() => setHealthOpen(false)}>Đóng</button>
            </div>
          </div>
        </div>
      )}

      <DrawingInfoPanel
        open={drawingInfoOpen}
        daemon={DAEMON}
        initialTarget={drawingInfoTarget}
        refreshToken={drawingInfoRefreshToken}
        onClose={() => setDrawingInfoOpen(false)}
        onOpenAutoCAD={() => openAutoCAD(undefined, { newFile: true })}
      />

      <LispLibraryPanel
        open={lispLibraryOpen}
        daemon={DAEMON}
        initialTarget={drawTarget}
        refreshToken={lispLibraryRefreshToken}
        onClose={() => setLispLibraryOpen(false)}
        onAskAgent={(prompt, displayText, expected) => {
          if (busy) return false;
          const selected = agents.find((item) =>
            item.id === agent && item.available && item.isolatedReview);
          const reviewer = selected || agents.find((item) =>
            item.available && item.isolatedReview);
          if (!reviewer) {
            window.alert("Chưa có agent no-tools an toàn. Hãy cài Claude CLI để review source.");
            return false;
          }
          if (reviewer.id !== agent) setAgent(reviewer.id);
          setLispLibraryOpen(false);
          void send(prompt, {
            skipScenario: true,
            freshSession: true,
            displayText,
            lispReview: expected,
            agentOverride: reviewer.id,
          });
          return true;
        }}
        onOpenAutoCAD={() => openAutoCAD(undefined, { newFile: true })}
      />

      {form && (
        <div className="modal" onClick={() => setForm(null)}>
          <div className="modalbox" onClick={(e) => e.stopPropagation()}>
            <h3>{form.icon} {form.label}</h3>
            <p className="fndesc">{form.desc}</p>
            {form.live && (
              <label className="field">
                <span>Bản vẽ đích (đang mở trong AutoCAD)
                  {" "}<a className="refr" onClick={() => loadDocs()}>↻ làm mới</a></span>
                {docsAlive === null && <div className="dim">Đang hỏi AutoCAD…</div>}
                {docsAlive === false && <div className="err">Plugin không phản hồi — khởi động lại AutoCAD rồi bấm ↻.</div>}
                {docsAlive && docList && docList.length === 0 && <div className="err">AutoCAD chưa mở bản vẽ nào.</div>}
                {docsAlive && docList && docList.length > 0 && (
                  <select value={formVals.__target || ""} onChange={(e) => setFormVals({ ...formVals, __target: e.target.value })}>
                    {docList.map((d) => (
                      <option key={d.title} value={d.title}>{d.title}{d.active ? "  (đang active)" : ""}</option>
                    ))}
                  </select>
                )}
              </label>
            )}
            {form.fields.map((fl) => (
              <label key={fl.name} className="field">
                <span>{fl.label}</span>
                {fl.type === "select"
                  ? <select value={formVals[fl.name] || ""} onChange={(e) => setFormVals({ ...formVals, [fl.name]: e.target.value })}>
                      {fl.options!.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                  : fl.type === "textarea"
                  ? <textarea className="fldarea" rows={5} value={formVals[fl.name] || ""} placeholder={fl.placeholder || ""}
                      onChange={(e) => setFormVals({ ...formVals, [fl.name]: e.target.value })} />
                  : (fl.type === "file" || fl.type === "dir")
                  ? <div className="pickrow">
                      <input value={formVals[fl.name] || ""} placeholder={fl.placeholder || ""}
                        onChange={(e) => setFormVals({ ...formVals, [fl.name]: e.target.value })} />
                      <button type="button" className="pickbtn" onClick={() => pick(fl.name, fl.type === "dir" ? "folder" : "file")}>📁 Chọn…</button>
                    </div>
                  : <input value={formVals[fl.name] || ""} placeholder={fl.placeholder || ""}
                      onChange={(e) => setFormVals({ ...formVals, [fl.name]: e.target.value })} />}
              </label>
            ))}
            {form.preview && (
              <div className="warn">
                👁 Chạy sẽ tạo <b>preview</b> (trên AutoCAD nếu plugin sống). Chưa commit — sau đó bấm{" "}
                <b>Chấp nhận</b> / <b>Không chấp nhận</b> trên thẻ kết quả.
              </div>
            )}
            {form.modifies && !form.preview && <div className="warn">⚠ Ghi ra thư mục xuất (bản gốc giữ nguyên).</div>}
            <div className="modalbtns">
              <button type="button" onClick={() => setForm(null)}>Huỷ</button>
              <button type="button" className="primary" onClick={() => runFn(form, formVals)}>
                {form.preview ? "Xem trước" : "Chạy"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MessageView({
  m, idx, onRun, onDecide, decideBusy, onLispDecision, lispBusy,
  onSend, setMessages, onHighlight, onOpenAcad,
}: {
  m: Msg; idx: number; onRun: (f: Fn) => void; onDecide: (i: number, ok: boolean) => void; decideBusy?: boolean;
  onLispDecision: (i: number, ok: boolean) => void; lispBusy?: boolean;
  onSend: (t: string) => void; setMessages: (fn: (p: Msg[]) => Msg[]) => void;
  onHighlight: (layer: string) => void;
  onOpenAcad?: () => void;
}) {
  if (m.role === "preview") return <PreviewView m={m} idx={idx} onDecide={onDecide} decideBusy={!!decideBusy} />;
  if (m.role === "function") return <FunctionResult m={m} onHighlight={onHighlight} onOpenAcad={onOpenAcad} />;
  const shown = shownAssistantText(m.text);
  return (
    <div className={"msg " + m.role}>
      <div className="avatar">{m.role === "user" ? "🧑" : "🤖"}</div>
      <div className="bubble">
        {m.thinking && <div className="thinking">{m.thinking}</div>}
        {m.tools?.map((t, j) => <span key={j} className="tool">⚙ <b>{t.name}</b> {t.detail}</span>)}
        {shown && <div className="text">{shown}</div>}
        {m.form && <QuestionFormView form={m.form}
          onSubmit={(msg) => { setMessages((p) => p.map((x, i) => i === idx && x.form ? { ...x, form: { ...x.form, submitted: true } } : x)); onSend(msg); }} />}
        {m.suggest && m.suggest.length > 0 && (
          <div className="suggest">{m.suggest.map((id) => { const f = byId(id); return f
            ? <button key={id} className="sgbtn" onClick={() => onRun(f)}>{f.icon} {f.label}</button> : null; })}</div>
        )}
        {m.lispProposal && (
          <LispProposalCard
            proposal={m.lispProposal}
            busy={!!lispBusy}
            onApprove={() => onLispDecision(idx, true)}
            onReject={() => onLispDecision(idx, false)}
          />
        )}
        {m.error && <div className="err">{m.error}</div>}
        {m.cost != null && <div className="meta">≈ ${m.cost.toFixed(4)}</div>}
      </div>
    </div>
  );
}

function LispProposalCard({
  proposal,
  busy,
  onApprove,
  onReject,
}: {
  proposal: LispManifestProposal;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const state = proposal.state || "pending";
  const [inspected, setInspected] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [coverageConfirmed, setCoverageConfirmed] = useState(false);
  const [catalogResource, setCatalogResource] = useState<any>(null);
  const [catalogError, setCatalogError] = useState("");
  const manifest = proposal.manifest;
  const analysisCoverage = proposal.analysisCoverage || "unknown";
  const incompleteAnalysis = analysisCoverage !== "full-source";
  const rows = (value: unknown): string[] => {
    if (!Array.isArray(value)) return typeof value === "string" && value ? [value] : [];
    return value.map((entry) => {
      if (typeof entry === "string") return entry;
      if (!entry || typeof entry !== "object") return String(entry ?? "");
      const item = entry as Record<string, any>;
      const name = String(item.name || item.command || item.path || item.id || "");
      const params = Array.isArray(item.params)
        ? item.params.map((param: any) =>
            typeof param === "string" ? param : String(param?.name || param?.id || "")).filter(Boolean)
        : [];
      const purpose = String(item.purpose || item.description || item.summary || "");
      const risk = item.risk ? `risk: ${item.risk}` : "";
      const execution = [
        item.kind ? `kind=${item.kind}` : "",
        item.optional === true ? "optional" : item.optional === false ? "required" : "",
        item.preload === true ? "PRELOAD (chạy trước resource chính)" : "",
        item.resolution ? `resolution=${item.resolution}` : "",
      ].filter(Boolean).join(", ");
      return [
        name + (params.length ? `(${params.join(", ")})` : ""),
        execution,
        purpose,
        risk,
      ].filter(Boolean).join(" — ");
    }).filter(Boolean);
  };
  const ai = manifest.ai && typeof manifest.ai === "object" && !Array.isArray(manifest.ai)
    ? manifest.ai as Record<string, unknown>
    : {};
  const purpose = String(ai.summary || manifest.purpose || manifest.summary || "Chưa nêu mục đích.");
  const commands = rows(manifest.commands);
  const functions = rows(manifest.publicFunctions);
  const dependencies = rows(manifest.dependencies);
  const guardrails = rows(manifest.guardrails);
  const effects = manifest.effects && typeof manifest.effects === "object" && !Array.isArray(manifest.effects)
    ? Object.entries(manifest.effects as Record<string, unknown>)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    : [];
  const preloads = Array.isArray(manifest.dependencies)
    ? manifest.dependencies
      .filter((entry) => entry && typeof entry === "object" && (entry as any).preload === true)
      .map((entry) => String((entry as any).path || (entry as any).id || "(không có path/id)"))
    : [];
  const currentManifest =
    catalogResource?.manifest || catalogResource?.baseManifest || {};
  const changedKeys = [...new Set([
    ...Object.keys(currentManifest || {}),
    ...Object.keys(manifest),
  ])]
    .filter((key) => key !== "review")
    .filter((key) => JSON.stringify(currentManifest?.[key]) !== JSON.stringify(manifest[key]))
    .sort();
  const revisionOk =
    !!catalogResource &&
    catalogResource.manifestRevision === proposal.baseRevision;
  const actionable = state !== "approved" && state !== "rejected" && state !== "superseded";

  useEffect(() => {
    if (!actionable) return;
    let cancelled = false;
    setCatalogError("");
    void fetch(`${DAEMON}/api/acad/lisp/${encodeURIComponent(proposal.resourceId)}`, {
      cache: "no-store",
    }).then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.resource) throw new Error(body?.error || `HTTP ${response.status}`);
      if (!cancelled) setCatalogResource(body.resource);
    }).catch((error) => {
      if (!cancelled) setCatalogError(String(error));
    });
    return () => { cancelled = true; };
  }, [proposal.resourceId, proposal.baseRevision, state, actionable]);

  return (
    <section className={"lisp-proposal-card " + state}>
      <div className="lisp-proposal-title">
        <span>⌘ Cấu hình AI cần review</span>
        <code>{proposal.resourceId}</code>
      </div>
      <div className="lisp-proposal-resource">
        <strong>{catalogResource?.name || proposal.resourceName || proposal.resourceId}</strong>
        <span>{catalogResource?.pathLabel || proposal.pathLabel || "Đường dẫn trong catalog"}</span>
      </div>
      {proposal.summary && <p>{proposal.summary}</p>}
      <div className="lisp-proposal-facts">
        <span>{commands.length} lệnh</span>
        <span>{functions.length} hàm public</span>
        <span>{dependencies.length} dependency</span>
        <span>Revision {proposal.baseRevision.slice(0, 18)}…</span>
      </div>
      <div className={
        "lisp-proposal-result " +
        (analysisCoverage === "full-source" ? "ok" : "")
      }>
        {analysisCoverage === "full-source"
          ? "Agent đã nhận toàn bộ source của resource này."
          : analysisCoverage === "partial-source"
            ? "Cảnh báo: agent chỉ nhận một phần source do giới hạn kích thước. User phải tự đọc phần còn lại trước khi duyệt."
            : analysisCoverage === "metadata-only"
              ? "Cảnh báo: agent chỉ có metadata/hash, không đọc được source biên dịch hoặc source quá lớn."
              : "Proposal cũ không có bằng chứng phạm vi phân tích; cần phân tích lại để duyệt."}
      </div>
      <div className="lisp-proposal-review-grid">
        <section><b>Mục đích</b><p>{purpose}</p></section>
        <section><b>Lệnh + tham số</b>{commands.length
          ? <ul>{commands.map((row) => <li key={row}>{row}</li>)}</ul>
          : <p>Không có command public.</p>}</section>
        <section><b>Hàm public</b>{functions.length
          ? <ul>{functions.map((row) => <li key={row}>{row}</li>)}</ul>
          : <p>Không khai báo.</p>}</section>
        <section><b>Dependency</b>{dependencies.length
          ? <ul>{dependencies.map((row) => <li key={row}>{row}</li>)}</ul>
          : <p>Không khai báo.</p>}</section>
        <section><b>Dependency được thực thi trước</b>{preloads.length
          ? <ul>{preloads.map((row) => <li key={row}>{row}</li>)}</ul>
          : <p>Không có preload.</p>}</section>
        <section><b>Side effect</b>{effects.length
          ? <ul>{effects.map((row) => <li key={row}>{row}</li>)}</ul>
          : <p>Không đánh dấu.</p>}</section>
        <section><b>Guardrail</b>{guardrails.length
          ? <ul>{guardrails.map((row) => <li key={row}>{row}</li>)}</ul>
          : <p>Không khai báo.</p>}</section>
      </div>
      <div className="lisp-proposal-diff">
        <b>Thay đổi so với cấu hình hiện tại</b>
        {catalogResource
          ? changedKeys.length
            ? <div>{changedKeys.map((key) => <code key={key}>{key}</code>)}</div>
            : <span>Không đổi trường nội dung nào.</span>
          : <span>Đang đối chiếu catalog…</span>}
      </div>
      {catalogResource && changedKeys.length > 0 && (
        <details>
          <summary>So sánh giá trị hiện tại → đề xuất</summary>
          <pre>{JSON.stringify(Object.fromEntries(changedKeys.map((key) => [
            key,
            { current: currentManifest?.[key] ?? null, proposed: manifest[key] ?? null },
          ])), null, 2)}</pre>
        </details>
      )}
      <details onToggle={(event) => {
        if (event.currentTarget.open) setInspected(true);
      }}>
        <summary>Xem toàn bộ manifest agent đề xuất</summary>
        <pre>{JSON.stringify(proposal.manifest, null, 2)}</pre>
      </details>
      {proposal.error && <div className="err">{proposal.error}</div>}
      {catalogError && <div className="err">Không đối chiếu được catalog: {catalogError}</div>}
      {catalogResource && !revisionOk && actionable && (
        <div className="lisp-proposal-result">
          Source/cấu hình đã đổi sau khi agent phân tích. Hãy yêu cầu phân tích lại.
        </div>
      )}
      {state === "approved" ? (
        <div className="lisp-proposal-result ok">✓ User đã duyệt và lưu cấu hình. Không tự động load vào AutoCAD.</div>
      ) : state === "rejected" ? (
        <div className="lisp-proposal-result">Đã từ chối — source và cấu hình không bị thay đổi.</div>
      ) : state === "superseded" ? (
        <div className="lisp-proposal-result">Proposal này đã cũ vì source hoặc cấu hình hiện tại đã thay đổi.</div>
      ) : (
        <>
          <label className="lisp-proposal-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={!inspected || !revisionOk}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            Tôi đã mở manifest, kiểm tra lệnh, dependency, side effect và guardrail.
          </label>
          {incompleteAnalysis && analysisCoverage !== "unknown" && (
            <label className="lisp-proposal-confirm">
              <input
                type="checkbox"
                checked={coverageConfirmed}
                disabled={!inspected || !revisionOk}
                onChange={(event) => setCoverageConfirmed(event.target.checked)}
              />
              Tôi hiểu agent chưa đọc toàn bộ source; tôi đã tự kiểm tra phần còn lại hoặc tài liệu tin cậy.
            </label>
          )}
          <div className="lisp-proposal-actions">
            <button disabled={busy || state === "applying"} onClick={onReject}>Không chấp nhận</button>
            <button
              className="primary"
              disabled={
                busy ||
                state === "applying" ||
                !inspected ||
                !confirmed ||
                !revisionOk ||
                analysisCoverage === "unknown" ||
                (incompleteAnalysis && !coverageConfirmed)
              }
              onClick={onApprove}
              title={!inspected ? "Mở «Xem toàn bộ manifest» trước khi duyệt" : undefined}
            >
              {busy || state === "applying" ? "Đang lưu…" : state === "error" ? "Thử lưu lại" : "Duyệt & lưu cấu hình"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function QuestionFormView({ form, onSubmit }: { form: QForm; onSubmit: (msg: string) => void }) {
  const [ans, setAns] = useState<Record<string, any>>({});
  const opt = (o: string | QOption) => typeof o === "string" ? { label: o, value: o } : o;
  const submit = () => {
    const parts = form.questions.map((q) => {
      const v = ans[q.id];
      return `${q.label}=${Array.isArray(v) ? v.join(",") : (v ?? "")}`;
    });
    onSubmit(`[form:${form.id}] ${parts.join("; ")}`);
  };
  if (form.submitted) return <div className="qform"><div className="qftitle">{form.title}</div><div className="dim">✓ Đã chọn.</div></div>;
  return (
    <div className="qform">
      <div className="qftitle">{form.title}</div>
      {form.questions.map((q) => (
        <div key={q.id} className="qfield">
          <div className="qflabel">{q.label}</div>
          {q.type === "select" ? (
            <select value={ans[q.id] || ""} onChange={(e) => setAns({ ...ans, [q.id]: e.target.value })}>
              <option value="">— chọn —</option>
              {q.options?.map((o) => { const oo = opt(o); return <option key={oo.value} value={oo.value}>{oo.label}</option>; })}
            </select>
          ) : q.type === "text" || q.type === "number" ? (
            <input type={q.type} value={ans[q.id] || ""} onChange={(e) => setAns({ ...ans, [q.id]: e.target.value })} />
          ) : (
            <div className="qopts">{q.options?.map((o) => { const oo = opt(o); const on = ans[q.id];
              const checked = q.type === "checkbox" ? (on || []).includes(oo.value) : on === oo.value;
              return <label key={oo.value} className={"qopt" + (checked ? " on" : "")}>
                <input type={q.type} name={q.id} checked={checked}
                  onChange={() => setAns({ ...ans, [q.id]: q.type === "checkbox"
                    ? (checked ? (on || []).filter((x: string) => x !== oo.value) : [...(on || []), oo.value])
                    : oo.value })} />
                {oo.label}
              </label>; })}
            </div>
          )}
        </div>
      ))}
      <div className="modalbtns" style={{ marginTop: 10 }}>
        <button className="primary" onClick={submit}>Xác nhận lựa chọn</button>
      </div>
    </div>
  );
}

function FunctionResult({ m, onHighlight, onOpenAcad }: {
  m: Msg; onHighlight?: (layer: string) => void; onOpenAcad?: () => void;
}) {
  const r = m.fnResult; const fn = m.fn!;
  const canHi = !!r?.selRows && r.selRows[0]?.[0] === "Layer";   // chỉ bảng BOM (cột 0 = Layer)
  return (
    <div className="msg function">
      <div className="avatar">{fn.icon}</div>
      <div className="bubble">
        <div className="fnrhead">{fn.label} {r ? `— ${r.count} file` : "…"}</div>
        {!r && <div className="dim">Đang chạy AutoCAD…</div>}
        {m.error && <div className="err">{m.error}</div>}
        {r?.canOpenAcad && onOpenAcad && (
          <button className="primary" style={{ marginTop: 8 }} onClick={onOpenAcad}>🚀 Mở AutoCAD ngay</button>
        )}
        {r && r.live && (
          <>
            <div className="livebox">{r.hint || `✓ Đã gửi — AutoCAD tự thực hiện (plugin AcadBridge).`}</div>
            {r.selRows && (
              <>
              {canHi && <div className="dim">💡 Bấm 1 dòng để AutoCAD sáng + zoom tới nhóm ống đó.</div>}
              <div className="tblwrap"><table className="rtbl">
                <thead><tr>{r.selRows[0].map((h: string, j: number) => <th key={j}>{h}</th>)}</tr></thead>
                <tbody>{r.selRows.slice(1, 30).map((row: string[], j: number) => {
                  const hi = canHi && row[0] && !row[0].startsWith("—");
                  return <tr key={j} className={hi ? "hirow" : undefined}
                    onClick={hi ? () => onHighlight?.(row[0]) : undefined}
                    title={hi ? "Sáng + zoom trong AutoCAD" : undefined}>
                    {row.map((c, k) => <td key={k}>{c}</td>)}</tr>;
                })}</tbody>
              </table></div>
              </>
            )}
          </>
        )}
        {r && fn.result === "index" && <IndexTable results={r.results} />}
        {r && fn.result === "table" && <RecipeTables results={r.results} />}
        {r && fn.result === "files" && (
          <div className="dim">✓ Đã xử lý {r.results.filter((x: any) => x.ok).length}/{r.count} file → <code>{r.outDir}</code></div>
        )}
      </div>
    </div>
  );
}

function bbox(ents: Geom[]) {
  const pts: number[][] = [];
  ents.forEach((e) => { (e.p || []).forEach((p) => pts.push(p)); if (e.xy) pts.push(e.xy); if (e.c) pts.push(e.c); });
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function DiffSvg({ ents, box, hl }: { ents: Geom[]; box: any; hl?: { added: Set<string>; modified: Set<string>; removed?: Geom[] } }) {
  const VW = 320, all = box || bbox(ents);
  if (!all) return <div className="dim">(trống)</div>;
  const W = (all.maxX - all.minX) || 1, H = (all.maxY - all.minY) || 1;
  const VH = Math.max(150, Math.min(300, VW * H / W));
  const sc = Math.min(VW / W, VH / H) * 0.9;
  const tx = (x: number) => (x - all.minX) * sc + (VW - W * sc) / 2;
  const ty = (y: number) => VH - ((y - all.minY) * sc + (VH - H * sc) / 2);
  const list: (Geom & { _rm?: boolean })[] = [...ents, ...(hl?.removed || []).map((e) => ({ ...e, _rm: true }))];
  const col = (e: any) => e._rm ? "#ff5a5a" : hl?.added.has(e.h) ? "#4ade80" : hl?.modified.has(e.h) ? "#fbbf24" : "#5a6472";
  const isChg = (e: any) => e._rm || hl?.added.has(e.h) || hl?.modified.has(e.h);
  return (
    <svg className="diffsvg" viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid meet">
      {list.map((e, i) => {
        const c = col(e), sw = isChg(e) ? 1.8 : 0.6;
        if (e.p && e.p.length >= 2)
          return <polyline key={i} points={e.p.map((p) => `${tx(p[0])},${ty(p[1])}`).join(" ")} fill="none" stroke={c} strokeWidth={sw} strokeDasharray={e._rm ? "4 3" : undefined} />;
        if (e.c) return <circle key={i} cx={tx(e.c[0])} cy={ty(e.c[1])} r={Math.max(1.5, (e.r || 0) * sc)} fill="none" stroke={c} strokeWidth={sw} />;
        if (e.xy) return <circle key={i} cx={tx(e.xy[0])} cy={ty(e.xy[1])} r={isChg(e) ? 2.5 : 1} fill={c} />;
        return null;
      })}
    </svg>
  );
}

function PreviewView({
  m, idx, onDecide, decideBusy,
}: {
  m: Msg; idx: number; onDecide: (i: number, ok: boolean) => void; decideBusy?: boolean;
}) {
  const pv = m.pv!;
  const box = pv.before && pv.after ? mergeBox([...pv.before, ...pv.after], pv.diff?.removed) : null;
  const hl = pv.diff ? { added: new Set(pv.diff.added.map((e) => e.h)), modified: new Set(pv.diff.modified.map((e) => e.h)), removed: pv.diff.removed } : undefined;
  const isLiveCad = !!pv.live;
  const showButtons = pv.state === "staged" && !!pv.opId;
  return (
    <div className="msg preview" data-preview-state={pv.state} data-preview-live={isLiveCad ? "1" : "0"}>
      <div className="avatar">{m.fn?.icon || "📐"}</div>
      <div className="bubble prevbubble">
        <div className="fnrhead">
          {isLiveCad ? "Xem trước trên AutoCAD" : "Xem trước (sandbox)"} — {m.text}
        </div>
        {pv.state === "loading" && <div className="dim">Đang dựng preview…</div>}
        {pv.state === "error" && <div className="err">{pv.error}</div>}
        {isLiveCad && pv.state === "staged" && (
          <div className="livebox" style={{ marginTop: 8 }}>
            {pv.hint || `Đã vẽ tạm trên layer ${pv.layer || "MEP-PREVIEW"} (${pv.count ?? "?"} đối tượng).`}
            <div className="dim" style={{ marginTop: 6 }}>
              Nhìn AutoCAD — nét cam layer MEP-PREVIEW là preview. Phải bấm nút bên dưới để commit hoặc huỷ.
            </div>
          </div>
        )}
        {!isLiveCad && pv.diff && (
          <>
            <div className="difsum">
              <b style={{ color: "#4ade80" }}>+{pv.diff.summary.added} thêm</b>
              <b style={{ color: "#fbbf24" }}>~{pv.diff.summary.modified} đổi</b>
              <b style={{ color: "#ff5a5a" }}>−{pv.diff.summary.removed} xoá</b>
            </div>
            <div className="twoview">
              <div className="vw"><div className="vwlbl">Hiện tại</div><DiffSvg ents={pv.before || []} box={box} /></div>
              <div className="vw"><div className="vwlbl">Kết quả</div><DiffSvg ents={pv.after || []} box={box} hl={hl} /></div>
            </div>
          </>
        )}
        {/* Real clickable accept/decline — always rendered for staged previews (live or sandbox). */}
        {showButtons && (
          <div className="modalbtns preview-decide" style={{ marginTop: 14, gap: 10, display: "flex", flexWrap: "wrap" }} data-testid="preview-decide-bar">
            <button
              type="button"
              data-action="decline"
              data-testid="preview-decline"
              disabled={!!decideBusy}
              onClick={() => onDecide(idx, false)}
              style={{ minWidth: 140, padding: "10px 16px", cursor: decideBusy ? "wait" : "pointer" }}
            >
              {decideBusy ? "Đang huỷ…" : "Không chấp nhận"}
            </button>
            <button
              type="button"
              className="primary"
              data-action="accept"
              data-testid="preview-accept"
              disabled={!!decideBusy}
              onClick={() => onDecide(idx, true)}
              style={{ minWidth: 180, padding: "10px 16px", cursor: decideBusy ? "wait" : "pointer" }}
            >
              {decideBusy ? "Đang áp dụng…" : "✓ Chấp nhận"}
            </button>
          </div>
        )}
        {isLiveCad && pv.state === "applied" && (
          <div className="okmsg">✓ Đã commit preview vào layer vĩnh viễn trên AutoCAD.</div>
        )}
        {isLiveCad && pv.state === "rejected" && (
          <div className="dim">✕ Đã xoá preview trên AutoCAD — bản vẽ giữ nguyên như trước.</div>
        )}
        {!isLiveCad && pv.state === "applied" && (
          <div className="okmsg">✓ Đã áp dụng sandbox (backup current).
            <button type="button" className="pickbtn" style={{ marginLeft: 10 }} onClick={async () => {
              const e = await (await fetch(`${DAEMON}/api/acad/export`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: pv.sessionId }) })).json();
              if (e.written) await fetch(`${DAEMON}/api/acad/open`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: e.written }) });
            }}>📂 Mở kết quả trong AutoCAD</button>
          </div>
        )}
        {!isLiveCad && pv.state === "rejected" && <div className="dim">✕ Đã bỏ thay đổi sandbox (bản gốc giữ nguyên).</div>}
      </div>
    </div>
  );
}
function mergeBox(ents: Geom[], removed?: Geom[]) {
  return bbox([...ents, ...(removed || [])]);
}

function IndexTable({ results }: { results: any[] }) {
  return (
    <div className="tblwrap"><table className="rtbl">
      <thead><tr><th>File</th><th>KHBV</th><th>Tên bản vẽ</th><th>Ngày</th></tr></thead>
      <tbody>{results.map((x, i) => { const t = x.title || {}; return (
        <tr key={i}><td>{x.dwg}</td><td>{t.KHBV || (x.ok ? "—" : "✗")}</td><td>{t.TENBANVE1 || t.TENBANVE1_001 || ""}</td><td>{t["DD/MM/YYYY"] || ""}</td></tr>
      ); })}</tbody>
    </table></div>
  );
}
function RecipeTables({ results }: { results: any[] }) {
  return <>{results.map((x, i) => {
    const key = Object.keys(x).find((k) => Array.isArray(x[k]));
    const rows: string[][] = key ? x[key] : [];
    return (
      <div key={i} className="filesec">
        <div className="filelbl">{x.dwg}</div>
        {rows.length ? (
          <div className="tblwrap"><table className="rtbl">
            <thead><tr>{rows[0].map((h, j) => <th key={j}>{h}</th>)}</tr></thead>
            <tbody>{rows.slice(1, 40).map((row, j) => <tr key={j}>{row.map((c, k) => <td key={k}>{c}</td>)}</tr>)}</tbody>
          </table></div>
        ) : <div className="dim">{x.ok ? "(rỗng)" : "✗ lỗi"}</div>}
      </div>
    );
  })}</>;
}
