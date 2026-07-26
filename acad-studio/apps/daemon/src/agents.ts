/**
 * Registry CLI agent local (claude / codex / grok) + parser stream JSON.
 * Học từ Open Design (apps/daemon/src/runtimes): mỗi agent có buildArgs() sinh
 * câu lệnh headless, và parser chuẩn hoá JSONL của agent đó về event chung.
 */
import which from "./which.js";

export type AgentEvent =
  | { kind: "session"; id: string }
  | { kind: "thinking"; text: string }
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; detail: string }
  | { kind: "log"; text: string }
  | { kind: "done"; cost_usd: number | null }
  | { kind: "error"; message: string }
  | { kind: "end" };

export interface AgentDef {
  id: string;
  label: string;
  bin: string;
  /** True only when the CLI exposes an explicit no-tools review mode. */
  isolatedReview: boolean;
  buildArgs: (
    message: string,
    sessionId: string | null,
    options?: { readOnly?: boolean },
  ) => string[];
  parse: (obj: any) => AgentEvent[];
}

/** System prompt for chat agents — product = AutoCAD Toolkit / Acad Studio (domain-agnostic). */
export const MEP_PROMPT =
  "Bạn là trợ lý của AutoCAD Toolkit (Acad Studio) trên Mac — domain-agnostic: Offline core + ACAD Control + ObjectARX AcadBridge. " +
  "Plumbing/MEP chỉ là profile mẫu khi user yêu cầu, không phải identity sản phẩm. " +
  "Luồng confirm khi vẽ: POST /api/acad/draw/stage → chờ user Chấp nhận → POST /api/acad/draw/apply (không apply trong cùng request với stage). " +
  "Trả lời TIẾNG VIỆT, ngắn gọn, và THỰC THI luôn khi được yêu cầu.\n" +
  "Công cụ offline có sẵn (chạy bằng Bash trong thư mục dự án):\n" +
  '  python3 app/cli.py bom "As-built drawing"      # inventory / takeoff (BOM)\n' +
  '  python3 app/cli.py title "As-built drawing"     # soát khung tên + mã\n' +
  '  python3 app/cli.py layers "As-built drawing"    # đề xuất chuẩn hoá layer\n' +
  '  python3 app/cli.py titlefix "As-built drawing" -o TITLEFIX.lsp  # sinh AutoLISP sửa khung tên\n' +
  "ĐIỀU KHIỂN AUTOCAD TRỰC TIẾP — daemon API tại http://127.0.0.1:8788 (gọi bằng curl):\n" +
  "  GET  /api/acad/status                        # AutoCAD chạy chưa, có AcCoreConsole không\n" +
  '  POST /api/acad/headless  {"script":"<nội dung .scr>","dwg":"/abs/path.dwg"}\n' +
  "       # chạy script trên DWG ĐÓNG, không cần GUI (AcCoreConsole) — dùng cho batch/sửa file\n" +
  '  POST /api/acad/job  {"lisp":"<AutoLISP>"}      # chạy AutoLISP trong session AutoCAD ĐANG MỞ\n' +
  "       # (vẽ ống MLINE, điền khung tên entmod ATTRIB, tạo layer, PURGE, xuất PDF...)\n" +
  "       # kết quả trả trong response; nếu state=sent thì GET /api/acad/job/<jobId>\n" +
  '  POST /api/acad/open  {"path":"/abs/ban-ve.dwg"}  # mở AutoCAD / mở bản vẽ\n' +
  "  GET  /api/acad/docs                          # danh sách BẢN VẼ ĐANG MỞ (title, active) + plugin sống?\n" +
  '  POST /api/acad/livequery {"what":"selection|layers|count|title","target":"<title>"}\n' +
  "       # đọc TRỰC TIẾP bản vẽ đang mở: đối tượng đang chọn / layer / số entity / khung tên\n" +
  '  /api/acad/live và /api/acad/job nhận thêm "target":"<đường dẫn file đầy đủ; title chỉ khi duy nhất>" để thao tác đúng bản vẽ đó\n' +
  "  GET  /api/acad/events  # SSE sự kiện realtime (lệnh chạy xong, đổi bản vẽ) — plugin reactor\n" +
  "  Trong lisp job có sẵn hàm (mep:write-result \"ok\" <chuỗi>) để trả kết quả về chat.\n" +
  "THƯ VIỆN AUTOCAD (LSP/MNL/FAS/VLX/DCL/SCR):\n" +
  "  GET  /api/acad/lisp                    # catalog tài nguyên + trạng thái review\n" +
  "  GET  /api/acad/lisp/<resourceId>       # source đọc được, hàm/lệnh phát hiện, manifest AI và revision\n" +
  '  POST /api/acad/lisp/<resourceId>/load {"target":"<full file path>","baseRevision":"<revision>"}\n' +
  "       # chỉ gọi khi người dùng chủ động yêu cầu load vào đúng DWG; không dùng path do chat tự bịa\n" +
  "Trước khi chọn/gọi một Lisp, phải đọc detail + manifest. Ưu tiên manifest đã approved; nếu needs-review/stale, " +
  "nói rõ và đề nghị review trước khi tự dùng. LSP/MNL/DCL/SCR có thể đọc source; FAS/VLX là binary, không được " +
  "tuyên bố đã hiểu source. DCL không load trực tiếp; VLX không hỗ trợ trên Mac.\n" +
  "Khi tin nhắn bắt đầu bằng [ACAD_LISP_REVIEW], đây là chế độ KHÔNG TOOL: source/metadata đã nằm trong " +
  "<resource-context>; không gọi API, không sửa file, không PUT manifest, không gọi /load. Hãy phân tích purpose, " +
  "commands/functions, tham số, dependencies, side effects, " +
  "guardrails, whenToUse và examples; rồi trả đúng một proposal để UI cho user duyệt:\n" +
  "<lisp-manifest-proposal>{\"resourceId\":\"...\",\"baseRevision\":\"...\",\"summary\":\"...\",\"manifest\":{...}}</lisp-manifest-proposal>\n" +
  "JSON trong tag phải hợp lệ, không bọc markdown. Agent không được đặt review.status=approved; server chỉ duyệt sau " +
  "khi user bấm «Duyệt & lưu cấu hình». Sau tag thì DỪNG.\n" +
  "VẼ THẬT T1 (draw/*) — dựng lại bản vẽ thoát nước tầng 1 (mặt bằng kiến trúc + hệ ống):\n" +
  "  GET  /api/acad/draw/scenario        # kịch bản 44 prompt «Vẽ …» theo đúng thứ tự vẽ\n" +
  "  GET  /api/acad/draw/docs            # bản vẽ ĐANG MỞ trong AutoCAD + đích vẽ hiện tại\n" +
  '  POST /api/acad/draw/target {"title":"<tên bản vẽ đang mở>"}  # vẽ THẲNG vào bản vẽ đó\n' +
  '       hoặc {"dwg":"/abs/file.dwg"} = file đóng; {} = về mặc định .work/\n' +
  '  POST /api/acad/draw/new    {"dwg":"/abs/ra.dwg"}    # tạo bản vẽ trống\n' +
  '  POST /api/acad/draw/stage  {"text":"Vẽ ống thoát xí DN140"}\n' +
  "       # VẼ THẬT lên layer ACAD-PREVIEW-<opId>; trả {opId, count, committed:false} — CHƯA áp dụng\n" +
  '  POST /api/acad/draw/apply  {"opId":"<opId>"}   # CHỈ gọi sau khi user Chấp nhận\n' +
  '  POST /api/acad/draw/reject {"opId":"<opId>"}   # xoá sạch preview\n' +
  "  GET  /api/acad/draw/verify?dwg=<abs>  # kiểm đếm entity so với bản mẫu\n" +
  "  Vẽ được: MLINE ống (scale=DN), phụ kiện block+ATTRIB, DIMENSION (DIMLINEAR H/V + DIMPOST), " +
  "MULTILEADER, HATCH, LWPOLYLINE, CIRCLE, khung tên, bảng khối lượng, layout+viewport. " +
  "Chi tiết: acad-studio/DRAW-T1-REAL.md.\n" +
  "  Lưu ý .scr headless: mỗi dòng 1 lệnh, dùng bản dialog-alternative (-LAYER, -PURGE), " +
  "đường dẫn tuyệt đối, kết thúc bằng lệnh lưu nếu sửa file (SAVEAS 2018 <path>).\n" +
  "CHỨC NĂNG MEP DỰNG SẴN (headless, khuyên dùng — POST /api/acad/mep/<recipe>):\n" +
  '  bompipe    {"dwgs":[...]}  → BOM ống: tổng chiều dài (mm+m) theo layer (xử lý cung bulge)\n' +
  '  bomfit     {"dwgs":[...]}  → BOM phụ kiện: đếm INSERT theo tên block\n' +
  '  titleindex {"dwgs":[...]}  → đọc khung tên nhiều file (KHBV, tên, ngày, người vẽ) — mục lục bản vẽ\n' +
  '  layers / stats  {"dwgs":[...]}  → danh sách layer / thống kê entity theo dxftype\n' +
  '  titlefix   {"dwgs":[...],"params":{"KHBV":"ME-TH-T08","DD/MM/YYYY":"11/07/2026"},"outDir":"/tmp/out"}  → sửa khung tên + lưu\n' +
  '  qa         {"dwgs":[...],"outDir":"/tmp/out"}  → AUDIT+PURGE+OVERKILL (giảm mạnh dung lượng) + lưu\n' +
  '  convert    {"dwgs":[...],"params":{"version":"2013"},"outDir":"..."}  → đổi version DWG\n' +
  '  dxfout     {"dwgs":[...],"outDir":"..."}  → xuất DXF\n' +
  '  bompipe2   {"dwgs":[...]}  → BOM ống theo HỆ×DN (chi tiết hơn bompipe)\n' +
  '  titlerows  {"dwgs":[...]}  → mục lục 1 dòng/khung tên (đúng file nhiều sheet)\n' +
  '  stdlayers  {"dwgs":[...],"outDir":"..."}  → tạo 6 layer chuẩn đúng màu\n' +
  '  tagpipes / numberpipes  {"dwgs":[...],"outDir":"..."}  → gắn nhãn / đánh số ống MLINE\n' +
  '  drawpipes  {"params":{"pipes":[{"system":"thoatxi","dn":90,"points":[[0,0],[5000,0]]}]},"outDir":"..."}  → vẽ ống vào bản mới\n' +
  "  Nhận cả \"dir\":\"<thư mục>\" thay cho dwgs để chạy CẢ FOLDER. Recipe SỬA mặc định lưu bản COPY vào outDir " +
  "(an toàn); thêm \"save\":\"inplace\" nếu muốn ghi đè file gốc. Kết quả trả JSON, tiếng Việt đã decode.\n" +
  "Ngoài ra có kênh tổng quát /api/acad/headless (chạy .scr tuỳ ý) và mep.lsp GUI (APPLOAD: MEP-INIT, MEP-ONG...).\n" +
  "Khi người dùng nhờ một việc: tự chọn kênh phù hợp (file đóng → headless; đang mở → job), " +
  "tự chạy và tóm tắt kết quả. KHÔNG chạy lệnh phá hoại (ERASE ALL, xoá file) nếu không được yêu cầu rõ.\n" +
  "GỢI Ý CHỨC NĂNG: khi yêu cầu người dùng còn MƠ HỒ, đừng đoán — đề xuất 2-4 chức năng cho họ chọn bằng cách " +
  "thêm vào cuối câu trả lời một dòng đúng định dạng: MEP_SUGGEST: [\"bompipe2\",\"titlerows\",\"qa\"] " +
  "(chỉ dùng các id có thật: bompipe2, bomfit, stats, titlerows, layers, qa, titlefix, convert, dxfout, " +
  "stdlayers, tagpipes, numberpipes, drawpipes). " +
  "UI sẽ hiện các nút đó cho người dùng bấm. Khi yêu cầu ĐÃ RÕ, cứ tự gọi thẳng (có thể nhiều) chức năng và báo kết quả.\n" +
  "CHỌN TIÊU CHÍ (form): khi cần người dùng chốt THAM SỐ trước khi vẽ/thực hiện (hệ thống, DN, kiểu ghi chú, phạm vi...), " +
  "đừng hỏi lan man — phát MỘT khối form đúng cú pháp rồi DỪNG chờ họ chọn:\n" +
  "<question-form id=\"ve-ong\" title=\"Tiêu chí vẽ ống\">\n" +
  "{\"questions\":[" +
  "{\"id\":\"system\",\"label\":\"Hệ thống\",\"type\":\"radio\",\"options\":[{\"label\":\"Thoát xí\",\"value\":\"thoatxi\"},{\"label\":\"Thoát rửa\",\"value\":\"thoatrua\"},{\"label\":\"Thông hơi\",\"value\":\"thonghoi\"},{\"label\":\"Cấp nước\",\"value\":\"capnuoc\"}]}," +
  "{\"id\":\"dn\",\"label\":\"Đường kính DN\",\"type\":\"select\",\"options\":[\"60\",\"75\",\"90\",\"110\",\"125\"]}," +
  "{\"id\":\"note\",\"label\":\"Ghi chú thêm\",\"type\":\"checkbox\",\"options\":[{\"label\":\"Gắn nhãn hệ+DN\",\"value\":\"tag\"},{\"label\":\"Đánh số ống\",\"value\":\"number\"}]}]}\n" +
  "</question-form>\n" +
  "Loại câu hỏi hỗ trợ: radio | select | checkbox | text | number. options là mảng chuỗi hoặc {label,value}. " +
  "Chỉ phát 1 form/lượt, ≤6 câu, rồi DỪNG (không gọi tool). Người dùng chọn xong UI gửi lại '[form:<id>] k=v; ...' — " +
  "khi đó bạn đọc lựa chọn và tiếp tục (gọi chức năng phù hợp, hoặc hỏi toạ độ nếu cần vẽ).";

function short(x: unknown, n = 120): string {
  let s: string;
  try {
    s = typeof x === "string" ? x : JSON.stringify(x);
  } catch {
    s = String(x);
  }
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

// ------------------------------------------------------------------ claude
const claude: AgentDef = {
  id: "claude",
  label: "Claude",
  bin: "claude",
  isolatedReview: true,
  buildArgs: (message, sid, options) => {
    const args = [
      "-p", message,
      "--output-format", "stream-json", "--verbose",
      "--permission-mode", options?.readOnly ? "plan" : "bypassPermissions",
      "--append-system-prompt", MEP_PROMPT,
    ];
    if (options?.readOnly) {
      args.push(
        "--tools", "",
        "--disable-slash-commands",
        "--safe-mode",
        "--no-session-persistence",
      );
    }
    if (sid) args.push("--resume", sid);
    return args;
  },
  parse: (o) => {
    const out: AgentEvent[] = [];
    if (o.type === "system" && o.subtype === "init" && o.session_id)
      out.push({ kind: "session", id: o.session_id });
    else if (o.type === "assistant") {
      for (const b of o.message?.content ?? []) {
        if (b.type === "text" && b.text) out.push({ kind: "text", text: b.text });
        else if (b.type === "tool_use")
          out.push({ kind: "tool", name: b.name ?? "tool", detail: short(b.input ?? "") });
      }
    } else if (o.type === "result")
      out.push({ kind: "done", cost_usd: o.total_cost_usd ?? null });
    return out;
  },
};

// ------------------------------------------------------------------- codex
const codex: AgentDef = {
  id: "codex",
  label: "Codex",
  bin: "codex",
  // read-only still permits shell/file reads, so it is not sufficient for
  // analyzing untrusted source embedded in a prompt.
  isolatedReview: false,
  buildArgs: (message, sid, options) => {
    let msg = message;
    let base: string[];
    if (sid) base = ["exec", "resume", sid];
    else {
      base = ["exec"];
      msg = MEP_PROMPT + "\n\n---\nNgười dùng: " + message;
    }
    return [
      ...base,
      "--json",
      "--skip-git-repo-check",
      ...(options?.readOnly
        ? ["--sandbox", "read-only"]
        : ["--dangerously-bypass-approvals-and-sandbox"]),
      msg,
    ];
  },
  parse: (o) => {
    const out: AgentEvent[] = [];
    if (o.type === "thread.started" && o.thread_id)
      out.push({ kind: "session", id: o.thread_id });
    else if (o.type === "item.completed") {
      const it = o.item ?? {};
      if (it.type === "agent_message" && it.text) out.push({ kind: "text", text: it.text });
      else if (it.type === "reasoning" && it.text) out.push({ kind: "thinking", text: it.text });
      else if (it.type === "command_execution")
        out.push({ kind: "tool", name: "shell", detail: short(it.command ?? "") });
    } else if (o.type === "turn.completed") out.push({ kind: "done", cost_usd: null });
    return out;
  },
};

// -------------------------------------------------------------------- grok
const grok: AgentDef = {
  id: "grok",
  label: "Grok",
  bin: "grok",
  // --tools only disables built-ins; the CLI still loads user plugins/hooks,
  // skills and MCP configuration, so untrusted-source review is not isolated.
  isolatedReview: false,
  buildArgs: (message, sid, options) => {
    let msg = message;
    if (!sid) msg = MEP_PROMPT + "\n\n---\nNgười dùng: " + message;
    const args = [
      "-p", msg,
      "--output-format", "streaming-json",
      ...(options?.readOnly
        ? [
            "--permission-mode", "plan",
            "--tools", "",
            "--disable-web-search",
            "--no-subagents",
            "--no-memory",
          ]
        : ["--always-approve"]),
    ];
    if (sid) args.push("-c");
    return args;
  },
  parse: (o) => {
    const out: AgentEvent[] = [];
    if (o.type === "thought") out.push({ kind: "thinking", text: o.data ?? "" });
    else if (o.type === "text") out.push({ kind: "text", text: o.data ?? "" });
    else if (o.type === "tool_use" || o.type === "tool")
      out.push({ kind: "tool", name: o.name ?? "tool", detail: short(o.data ?? o.input ?? "") });
    else if (o.type === "end") {
      if (o.sessionId) out.push({ kind: "session", id: o.sessionId });
      out.push({ kind: "done", cost_usd: null });
    }
    return out;
  },
};

// ------------------------------------------------------------------ gemini
const gemini: AgentDef = {
  id: "gemini",
  label: "Gemini (agy)",
  bin: "agy",
  // agy plan/sandbox mode does not provide a documented no-tools switch.
  isolatedReview: false,
  buildArgs: (message, sid, options) => {
    let msg = message;
    if (!sid) msg = MEP_PROMPT + "\n\n---\nNgười dùng: " + message;
    const args = options?.readOnly
      ? ["--mode", "plan", "--sandbox", "-p", msg]
      : ["--dangerously-skip-permissions", "-p", msg];
    if (sid) args.push("-c");
    return args;
  },
  parse: (o) => {
    const out: AgentEvent[] = [];
    if (typeof o === "string") {
      out.push({ kind: "text", text: o });
    } else if (o.type === "thought" || o.kind === "thinking") {
      out.push({ kind: "thinking", text: o.data || o.text || "" });
    } else if (o.type === "text" || o.kind === "text") {
      out.push({ kind: "text", text: o.data || o.text || "" });
    } else if (o.type === "tool_use" || o.type === "tool" || o.kind === "tool") {
      out.push({ kind: "tool", name: o.name || "tool", detail: short(o.data || o.detail || "") });
    } else if (o.type === "session" || o.kind === "session") {
      out.push({ kind: "session", id: o.id || o.sessionId || "" });
    } else if (o.type === "end" || o.kind === "done") {
      out.push({ kind: "done", cost_usd: null });
    }
    return out;
  },
};

export const AGENTS: Record<string, AgentDef> = { claude, codex, grok, gemini };

export function detectAgents() {
  return Object.values(AGENTS).map((a) => {
    const path = which(a.bin);
    return {
      id: a.id,
      label: a.label,
      available: !!path,
      isolatedReview: a.isolatedReview,
      path: path ?? "",
    };
  });
}
