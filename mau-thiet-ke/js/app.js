/* ============================================================
   AutoCAD Toolkit — App shell
   Renders titlebar / rail / statusbar, command palette (⌘K),
   the activity drawer, modals, confirms and the shared guard copy.
   Each screen file only owns its own <main> content + screen logic.

   Design contract (from the source audit):
   · Every write is two-phase. Nothing "just happens" — it stages,
     then a human confirms it. The staged-change chip is global.
   · Every backend call can take 0.2s–120s and can fail with a typed
     409. Screens must use App.guard() copy, never invent their own.
   · Anything drawn ahead of its endpoint must carry .needs-backend.
   ============================================================ */
(function () {
  "use strict";

  /* ---------- Icons (stroke, 24-grid, currentColor) ----------
     One definition per glyph. Screens must call App.icon() rather
     than pasting inline SVG, or the two copies drift apart. */
  var ICONS = {
    sidebar: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 5v14"/>',
    home:    '<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
    plan:    '<path d="M3 5h18v14H3z"/><path d="M3 10h6v9M15 5v9h6"/>',
    info:    '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.6"/>',
    chat:    '<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
    changes: '<path d="M4 7h9M4 7 7 4M4 7l3 3"/><path d="M20 17h-9m9 0-3-3m3 3-3 3"/>',
    check:   '<path d="M4 5h16v14H4z"/><path d="m8 12 3 3 5-6"/>',
    takeoff: '<path d="M4 4h16v16H4z"/><path d="M4 9h16M9 9v11M14 9v11"/>',
    publish: '<path d="M7 9V4h10v5"/><path d="M5 9h14a2 2 0 0 1 2 2v5h-4v4H7v-4H3v-5a2 2 0 0 1 2-2z"/>',
    batch:   '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M8 13h8"/>',
    library: '<path d="M4 4h6v16H4zM14 4h6v6h-6zM14 14h6v6h-6z"/>',
    lisp:    '<path d="m9 8-4 4 4 4M15 8l4 4-4 4"/>',
    ruler:   '<path d="m3 15 6-6 6 6-6 6z" transform="translate(1 -3)"/><path d="M13 5h8v8"/>',
    sync:    '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/>',
    gear:    '<circle cx="12" cy="12" r="3"/><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8-1.4 1.4m-10 10L5.6 18.4"/>',
    search:  '<circle cx="11" cy="11" r="6"/><path d="m20 20-3.5-3.5"/>',
    plus:    '<path d="M12 5v14M5 12h14"/>',
    tick:    '<path d="m5 12 5 5L19 7"/>',
    close:   '<path d="m6 6 12 12M18 6 6 18"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    activity:'<path d="M3 12h4l2.5-6 4 12L16 12h5"/>',
    alert:   '<path d="M12 4.5 21 19H3z"/><path d="M12 10v4m0 2.2v.4"/>',
    zoomin:  '<circle cx="11" cy="11" r="6"/><path d="M11 9v4M9 11h4M20 20l-3.5-3.5"/>',
    zoomout: '<circle cx="11" cy="11" r="6"/><path d="M9 11h4M20 20l-3.5-3.5"/>',
    fit:     '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    hand:    '<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V12m0-1a1.5 1.5 0 0 1 3 0v5a5 5 0 0 1-5 5h-1.5a5 5 0 0 1-4.4-2.6L6 15a1.6 1.6 0 0 1 2.6-1.8L9 14"/>',
    external:'<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'
  };

  function icon(name, cls) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round"' + (cls ? ' class="' + cls + '"' : "") +
      ' aria-hidden="true">' + (ICONS[name] || "") + "</svg>";
  }

  /* ---------- Navigation ----------
     Grouped by what the user is doing, not by which endpoint serves it.
     "Thay đổi" sits at the top of QUY TRÌNH because every write in the
     product funnels through it. */
  var NAV = [
    { group: "Bản vẽ", items: [
      { id: "home",      href: "index.html",         icon: "home",    label: "Tổng quan" },
      { id: "workspace", href: "workspace.html",     icon: "plan",    label: "Khung bản vẽ" },
      { id: "info",      href: "drawing-info.html",  icon: "info",    label: "Thông tin bản vẽ" },
      { id: "assistant", href: "assistant.html",     icon: "chat",    label: "Trợ lý AI" }
    ]},
    { group: "Quy trình", items: [
      { id: "changes",   href: "changes.html",       icon: "changes", label: "Thay đổi", staged: true },
      { id: "review",    href: "review.html",        icon: "check",   label: "Kiểm tra" },
      { id: "takeoff",   href: "takeoff.html",       icon: "takeoff", label: "Bóc tách" },
      { id: "publish",   href: "publish.html",       icon: "publish", label: "Xuất bản PDF" }
    ]},
    { group: "Hàng loạt", items: [
      { id: "batch",     href: "batch.html",         icon: "batch",   label: "Xử lý thư mục" }
    ]},
    { group: "Tài nguyên", items: [
      { id: "blocks",    href: "library-blocks.html",icon: "library", label: "Thư viện block" },
      { id: "lisp",      href: "library-lisp.html",  icon: "lisp",    label: "Thư viện LISP" },
      { id: "standards", href: "standards.html",     icon: "ruler",   label: "Hồ sơ tiêu chuẩn" }
    ]},
    { group: "Hệ thống", items: [
      { id: "settings",  href: "settings.html",      icon: "gear",    label: "Kết nối AutoCAD" },
      { id: "cadweb",    href: "cadweb.html",        icon: "sync",    label: "Đồng bộ CadWeb" }
    ]}
  ];

  /* Open documents come from /docs, which only ever reports the drawings
     AutoCAD currently has open — never a recent-files list. */
  var DOCS = [
    { id: "TH-KT-01", name: "TH-KT-01 · Mặt bằng tầng 3.dwg", dbmod: true,  active: true },
    { id: "TH-KT-02", name: "TH-KT-02 · Mặt cắt A-A.dwg",     dbmod: false },
    { id: "HT-CN-11", name: "HT-CN-11 · Sơ đồ cấp nước.dwg",  dbmod: false }
  ];

  /* Command palette — navigation and *prepare* actions only.
     Nothing here writes to the drawing directly; a write always lands
     in Thay đổi first. Commands that do not exist in the codebase
     (LAYERSYNC, RELOADARX, a free-form AUDIT) have been removed. */
  var COMMANDS = [
    { label: "Tổng quan",                         cmd: "HOME",      href: "index.html" },
    { label: "Khung bản vẽ",                      cmd: "WORKSPACE", href: "workspace.html" },
    { label: "Thông tin bản vẽ hiện hành",        cmd: "DWGINFO",   href: "drawing-info.html" },
    { label: "Thay đổi chờ duyệt",                cmd: "CHANGES",   href: "changes.html" },
    { label: "Hỏi trợ lý AI về bản vẽ này",       cmd: "ASK",       href: "assistant.html" },
    { label: "Quét tiêu chuẩn bản vẽ hiện hành",  cmd: "SCAN",      href: "review.html" },
    { label: "Bóc tách khối lượng (livebom)",     cmd: "TAKEOFF",   href: "takeoff.html" },
    { label: "Xuất bản PDF",                      cmd: "PLOT",      href: "publish.html" },
    { label: "Xử lý hàng loạt thư mục",           cmd: "BATCH",     href: "batch.html" },
    { label: "Thư viện block",                    cmd: "BLOCKS",    href: "library-blocks.html" },
    { label: "Thư viện script LISP",              cmd: "LISP",      href: "library-lisp.html" },
    { label: "Hồ sơ tiêu chuẩn",                  cmd: "PROFILES",  href: "standards.html" },
    { label: "Nhật ký hoạt động",                 cmd: "LOG",       drawer: true },
    { label: "Kết nối AutoCAD & chẩn đoán",       cmd: "HEALTH",    href: "settings.html" },
    { label: "Đồng bộ CadWeb",                    cmd: "CADWEB",    href: "cadweb.html" }
  ];

  /* ---------- Connection health ----------
     /health distinguishes five outcomes. `off` is by far the most
     common one in the field and used to be the one state the deck
     never drew. */
  var CONN = {
    on:          { label: "AutoCAD 2027 · đã nối",        short: "đã nối" },
    busy:        { label: "AutoCAD đang bận",             short: "bận" },
    off:         { label: "AutoCAD chưa chạy",            short: "chưa chạy" },
    missing:     { label: "Chưa cài AutoCAD",             short: "chưa cài" },
    "no-plugin": { label: "Chưa cài plugin AcadBridge",   short: "thiếu plugin" },
    mute:        { label: "Plugin không phản hồi",        short: "plugin câm" }
  };

  /* ---------- Guard vocabulary ----------
     Single source of truth for the typed failures a write can return.
     Screens render this; they never write their own copy, because the
     difference between document_stale and drawing_stale is exactly the
     difference between "prepare again" and "reload the drawing". */
  var GUARDS = {
    confirmation_required: {
      title: "Cần bạn xác nhận trước khi ghi",
      body: "Thao tác đã được chuẩn bị nhưng chưa chạm vào bản vẽ. Máy chủ chỉ ghi khi nhận xác nhận rõ ràng từ người dùng.",
      cta: "Xem thay đổi", href: "changes.html"
    },
    document_stale: {
      title: "Bản vẽ đã đổi — thao tác bị huỷ",
      body: "Máy chủ đã tự huỷ thao tác này. Không thể thử lại cùng mã thao tác; phải chuẩn bị lại từ đầu.",
      cta: "Chuẩn bị lại"
    },
    drawing_stale: {
      title: "Revision của bản vẽ đã thay đổi",
      body: "Có người (hoặc chính bạn trong AutoCAD) đã sửa bản vẽ sau khi thao tác được chuẩn bị. Đọc lại bản vẽ rồi chuẩn bị lại.",
      cta: "Đọc lại bản vẽ"
    },
    profile_stale: {
      title: "Hồ sơ tiêu chuẩn đã đổi giữa lúc quét và lúc áp dụng",
      body: "Kết quả quét được gắn với phiên bản hồ sơ cũ nên không còn dùng được. Phải quét lại bằng hồ sơ hiện tại.",
      cta: "Quét lại"
    },
    target_mismatch: {
      title: "Đối tượng đích không còn khớp",
      body: "Tập đối tượng đã chuẩn bị khác với tập đang có trong bản vẽ. Chọn lại rồi chuẩn bị thao tác mới.",
      cta: "Chọn lại"
    },
    drawing_read_only: {
      title: "Bản vẽ đang ở chế độ chỉ đọc",
      body: "Không có đường ghi nào khả dụng cho bản vẽ này. Mọi nút ghi đã bị khoá từ trước, không phải lỗi sau khi chạy.",
      cta: null
    },
    layer_not_found: {
      title: "Layer đích không còn tồn tại",
      body: "Layer đã biến mất giữa lúc chuẩn bị và lúc áp dụng. Chọn layer khác hoặc tạo lại layer rồi chuẩn bị lại.",
      cta: "Chọn layer khác"
    },
    ambiguous_target: {
      title: "Không xác định được bản vẽ đích",
      body: "Có nhiều bản vẽ đang mở trùng tên. Cần chọn theo đường dẫn đầy đủ.",
      cta: "Chọn theo đường dẫn"
    },
    target_busy: {
      title: "AutoCAD đang bận",
      body: "Phiên chưa ở trạng thái rảnh (quiescent). Kết thúc lệnh đang chạy trong AutoCAD rồi thử lại.",
      cta: null
    },
    no_match: {
      title: "Không có đối tượng phù hợp",
      body: "Thao tác chạy xong nhưng không chạm vào đối tượng nào. Nguyên nhân hay gặp nhất là layer đích đang bị khoá.",
      cta: "Kiểm tra layer"
    },
    revision_conflict: {
      title: "Bản duyệt đã cũ",
      body: "Nội dung script đã đổi sau khi được duyệt. Phải xem lại và duyệt lại từ đầu.",
      cta: "Xem lại"
    }
  };

  /* ---------- Staged operations ----------
     Persisted so the chip reads the same on every screen. Ops are born
     in five different places; the whole point of the chip is that a
     staged write cannot be forgotten just by navigating away. */
  var STORE = "acad.staged.v1";
  var SEED = [
    { id: "op_7f31", verb: "Gán lại layer", subject: "214 đối tượng trên layer 0 → A-WALL",
      doc: "TH-KT-01", rev: "r48", from: "assistant", state: "ready", at: "10:12" },
    { id: "op_7f2e", verb: "Đồng bộ layer theo hồ sơ", subject: "Tạo 3 layer, sửa màu 5 layer",
      doc: "TH-KT-01", rev: "r48", from: "review", state: "ready", at: "10:09" },
    { id: "op_7f19", verb: "Chèn block", subject: "VAN-CONG-DN80 · 1 lần chèn",
      doc: "TH-KT-01", rev: "r47", from: "library", state: "stale", at: "09:54" }
  ];

  function staged() {
    try {
      var raw = localStorage.getItem(STORE);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* private mode — fall through to the seed */ }
    return SEED.slice();
  }
  function saveStaged(list) {
    try { localStorage.setItem(STORE, JSON.stringify(list)); } catch (e) { /* non-fatal */ }
    paintStaged();
  }
  function pendingCount() {
    return staged().filter(function (o) { return o.state === "ready" || o.state === "draft"; }).length;
  }
  function paintStaged() {
    var n = pendingCount();
    document.querySelectorAll("[data-staged-chip]").forEach(function (el) {
      el.dataset.count = String(n);
      var slot = el.querySelector(".n");
      if (slot) slot.textContent = String(n);
      el.setAttribute("aria-label", n + " thay đổi chờ duyệt");
    });
    document.querySelectorAll('[data-od-id="nav-changes"] .count').forEach(function (el) {
      el.textContent = String(n);
      el.hidden = n === 0;
    });
  }

  /* ---------- Shell render ---------- */
  function renderTitlebar(el) {
    if (!el) return;
    var state = document.body.dataset.acad || "on";
    var conn = CONN[state] || CONN.on;

    var tabs = DOCS.map(function (d, i) {
      return '<button class="doctab" role="tab" aria-selected="' + (d.active ? "true" : "false") +
        '" data-doc="' + d.id + '" data-od-id="doc-tab-' + (i + 1) + '">' +
        '<span class="dot" data-saved="' + (d.dbmod ? "false" : "true") + '"></span>' +
        '<span class="name">' + d.name + "</span></button>";
    }).join("");

    el.innerHTML =
      '<div class="wdots" aria-hidden="true"><i></i><i></i><i></i></div>' +
      '<button class="btn btn--quiet btn--icon" data-rail-toggle aria-expanded="true" ' +
        'title="Thu gọn thanh điều hướng (⌘B)" data-od-id="rail-toggle">' + icon("sidebar") + "</button>" +
      '<div class="doctabs" role="tablist" aria-label="Bản vẽ đang mở" data-od-id="open-documents">' + tabs +
        '<button class="btn btn--quiet btn--icon" title="Mở bản vẽ trong AutoCAD" data-od-id="open-drawing">' +
        icon("plus") + "</button>" +
      "</div>" +
      '<div class="right">' +
        '<button class="searchbtn" data-palette-open data-od-id="global-search">' + icon("search") +
          "<span>Tìm màn hình, hồ sơ, block…</span><kbd>⌘K</kbd></button>" +
        '<button class="stagedchip" data-staged-chip data-count="0" data-od-id="staged-changes">' +
          icon("changes") + "Chờ duyệt<span class=\"n\">0</span></button>" +
        '<button class="btn btn--quiet btn--icon" data-drawer-open title="Nhật ký hoạt động" ' +
          'data-od-id="activity-log">' + icon("activity") + "</button>" +
        '<a class="conn" href="settings.html" data-state="' + state + '" data-od-id="acad-connection">' +
          '<span class="beacon"></span>' + conn.label + "</a>" +
      "</div>";
  }

  function renderRail(el, screen) {
    if (!el) return;
    el.innerHTML = NAV.map(function (g) {
      return '<div class="rail-group eyebrow">' + g.group + "</div>" +
        g.items.map(function (it) {
          /* title + aria-label survive the collapsed state, where the
             visible label is hidden and the icon is all that is left. */
          return '<a class="rail-link" href="' + it.href + '"' +
            (it.id === screen ? ' aria-current="page"' : "") +
            ' title="' + it.label + '" aria-label="' + it.label + '"' +
            ' data-od-id="nav-' + it.id + '">' + icon(it.icon) + "<span>" + it.label + "</span>" +
            (it.staged ? '<span class="count" hidden>0</span>' : "") + "</a>";
        }).join("");
    }).join("") +
    '<div class="rail-foot">' +
      '<div class="eyebrow" style="margin-bottom:6px">Cầu nối</div>' +
      '<div class="mono" style="font-size:11px;color:var(--muted);line-height:1.6">' +
      "~/Acad-Bridge<br>plugin nhịp 2,1 s</div></div>";
  }

  /* The status bar carries only values the daemon actually reports.
     There is no drawing-level scale in AutoCAD, so no "1:100" here. */
  function renderStatusbar(el, extra) {
    if (!el) return;
    var state = document.body.dataset.acad || "on";
    var conn = CONN[state] || CONN.on;
    el.innerHTML =
      '<span>INSUNITS <b>4 · mm</b></span><span class="sep"></span>' +
      "<span>AutoCAD <b>" + conn.short + "</b></span><span class=\"sep\"></span>" +
      '<span data-status-slot>' + (extra || "Sẵn sàng") + "</span>" +
      '<span class="right">' +
        '<button data-drawer-open style="font:inherit;color:inherit">Nhật ký hoạt động</button>' +
        '<span class="sep"></span><span>Plugin AcadBridge <b data-arx>1.4.2</b></span>' +
      "</span>";
  }

  /* ---------- Rail collapse ----------
     Three inputs, one output. The saved preference wins at normal widths.
     Below 900px there is no room for labels at all, so the shell collapses
     regardless — and the toggle is disabled and says why, rather than
     being silently ignored. */
  var RAIL_KEY = "acad.rail.v1";

  function railPref() {
    try { return localStorage.getItem(RAIL_KEY); } catch (e) { return null; }
  }
  function saveRailPref(v) {
    try { localStorage.setItem(RAIL_KEY, v); } catch (e) { /* private mode — state stays per-page */ }
  }
  function railState() {
    var w = window.innerWidth;
    if (w < 900) return "collapsed";
    var pref = railPref();
    if (pref === "collapsed" || pref === "expanded") return pref;
    return w < 1240 ? "collapsed" : "expanded";   // default follows the viewport
  }
  function applyRail() {
    var state = railState();
    var locked = window.innerWidth < 900;
    document.body.dataset.rail = state;
    document.querySelectorAll("[data-rail-toggle]").forEach(function (b) {
      var open = state === "expanded";
      b.setAttribute("aria-expanded", String(open));
      b.disabled = locked;
      b.title = locked
        ? "Màn hình quá hẹp để mở rộng thanh điều hướng"
        : (open ? "Thu gọn thanh điều hướng (⌘B)" : "Mở rộng thanh điều hướng (⌘B)");
    });
  }
  function toggleRail() {
    if (window.innerWidth < 900) return;
    saveRailPref(railState() === "expanded" ? "collapsed" : "expanded");
    applyRail();
  }

  /* ---------- Toast ----------
     Toasts report *completed, non-navigational* facts only. A write
     never gets a toast; it gets a staged operation and a confirm. */
  function toast(message) {
    var host = document.querySelector(".toaster");
    if (!host) {
      host = document.createElement("div");
      host.className = "toaster";
      document.body.appendChild(host);
    }
    var t = document.createElement("div");
    t.className = "toast";
    t.setAttribute("role", "status");
    t.innerHTML = icon("tick") + "<span></span>";
    t.lastChild.textContent = message;
    host.appendChild(t);
    setTimeout(function () { t.remove(); }, 3600);
  }

  /* ---------- Modal ---------- */
  function modal(opts) {
    var wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML =
      '<div class="modal' + (opts.wide ? " modal--wide" : "") + '" role="dialog" aria-modal="true">' +
        "<header><h2></h2>" + (opts.sub ? "<p></p>" : "") + "</header>" +
        '<div class="modal-body"></div>' +
        "<footer></footer>" +
      "</div>";
    wrap.querySelector("h2").textContent = opts.title || "";
    if (opts.sub) wrap.querySelector("header p").textContent = opts.sub;
    wrap.querySelector(".modal-body").innerHTML = opts.body || "";
    wrap.querySelector("footer").innerHTML = opts.footer || "";
    document.body.appendChild(wrap);

    function close() {
      document.removeEventListener("keydown", onKey);
      wrap.remove();
    }
    function onKey(e) { if (e.key === "Escape") { e.preventDefault(); close(); } }
    document.addEventListener("keydown", onKey);
    wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) close(); });
    wrap.addEventListener("click", function (e) { if (e.target.closest("[data-close]")) close(); });

    var focusable = wrap.querySelector("footer .btn--primary, footer .btn, .modal-body input, .modal-body button");
    if (focusable) focusable.focus();
    return { el: wrap, close: close };
  }

  /* Blocking confirm for destructive / irreversible paths. `danger`
     forces the user to read: the primary action is not pre-focused
     and the consequence is spelled out above the buttons. */
  function confirm(opts) {
    var m = modal({
      title: opts.title,
      sub: opts.sub,
      wide: opts.wide,
      body: opts.body || "",
      footer:
        (opts.note ? '<span class="note">' + opts.note + "</span>" : "") +
        '<span class="spacer"></span>' +
        '<button class="btn" data-close>' + (opts.cancelLabel || "Bỏ qua") + "</button>" +
        '<button class="btn btn--primary" data-ok>' + (opts.confirmLabel || "Xác nhận") + "</button>"
    });
    m.el.querySelector("[data-ok]").addEventListener("click", function () {
      m.close();
      if (opts.onConfirm) opts.onConfirm();
    });
    return m;
  }

  /* Renders a typed guard failure using the shared vocabulary. */
  function guard(code, extra) {
    var g = GUARDS[code];
    if (!g) return null;
    return modal({
      title: g.title,
      body:
        '<div class="statebox" data-state="blocked" style="padding:var(--s3) 0">' +
          '<div class="mark">' + icon("alert") + "</div>" +
          "<p>" + g.body + (extra ? " " + extra : "") + "</p>" +
          '<span class="code">HTTP 409 · <b>' + code + "</b></span>" +
        "</div>",
      footer:
        '<span class="spacer"></span>' +
        '<button class="btn" data-close>Đóng</button>' +
        (g.cta
          ? (g.href
              ? '<a class="btn btn--primary" href="' + g.href + '">' + g.cta + "</a>"
              : '<button class="btn btn--primary" data-close>' + g.cta + "</button>")
          : "")
    });
  }

  /* ---------- Activity drawer ----------
     Job queue + AutoCAD event stream. There is no job-history store on
     the server: this is a tail of the reactor's event file, so it is
     framed as a live log and never as durable history. */
  var EVENTS = [
    { t: "10:12:41", k: "op",  m: "<b>Chuẩn bị</b> gán lại layer · 214 đối tượng · <code>op_7f31</code> — chờ xác nhận" },
    { t: "10:12:38", k: "job", m: "<code>/selection/prepare</code> · action <code>move-to-layer</code> · 1,84 s" },
    { t: "10:09:02", k: "job", m: "<code>/standards/scan</code> · hồ sơ <code>cty-2024</code> · 4 phát hiện · 2,31 s" },
    { t: "10:08:57", k: "acad", m: "Bản vẽ <b>TH-KT-01</b> chuyển sang revision <code>r48</code>" },
    { t: "09:54:10", k: "err", m: "<b>409 drawing_stale</b> · <code>op_7f19</code> chèn block — revision đã đổi giữa chuẩn bị và áp dụng" },
    { t: "09:53:48", k: "job", m: "<code>/blocks/insert</code> · VAN-CONG-DN80 · 12,4 s" },
    { t: "09:41:15", k: "acad", m: "Phiên AutoCAD 2027 đã nối · plugin AcadBridge 1.4.2" }
  ];

  function initDrawer() {
    var wrap = document.createElement("div");
    wrap.className = "drawer-backdrop";
    wrap.hidden = true;
    wrap.innerHTML =
      '<aside class="drawer" role="dialog" aria-modal="true" aria-label="Nhật ký hoạt động">' +
        "<header><h2>Nhật ký hoạt động</h2>" +
          '<div class="actions">' +
            '<span class="tag tag--quiet">tail sự kiện</span>' +
            '<button class="btn btn--quiet btn--icon" data-drawer-close aria-label="Đóng nhật ký">' +
              icon("close") + "</button>" +
          "</div></header>" +
        '<div class="banner" style="border-radius:0;border-width:0 0 1px 0">' +
          '<span class="bm"></span><span class="bt">Đây là dòng sự kiện trực tiếp do reactor ghi ra, ' +
          "<b>không phải kho lịch sử</b>. Máy chủ không lưu job đã chạy — đóng app là mất.</span></div>" +
        '<div class="scroll">' +
          EVENTS.map(function (e) {
            return '<div class="evrow" data-kind="' + e.k + '"><span class="t">' + e.t +
              '</span><span class="m">' + e.m + "</span></div>";
          }).join("") +
        "</div>" +
      "</aside>";
    document.body.appendChild(wrap);

    function open() { wrap.hidden = false; }
    function close() { wrap.hidden = true; }
    wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) close(); });
    wrap.addEventListener("click", function (e) { if (e.target.closest("[data-drawer-close]")) close(); });
    document.addEventListener("click", function (e) { if (e.target.closest("[data-drawer-open]")) open(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !wrap.hidden) { e.preventDefault(); close(); }
    });
    return { open: open, close: close };
  }

  /* ---------- Command palette ---------- */
  function initPalette(drawer) {
    var wrap = document.createElement("div");
    wrap.className = "palette-backdrop";
    wrap.hidden = true;
    wrap.innerHTML =
      '<div class="palette" role="dialog" aria-modal="true" aria-label="Bảng lệnh">' +
      '<input type="text" placeholder="Đi tới màn hình hoặc mở nhật ký…" aria-label="Tìm lệnh">' +
      "<ul></ul></div>";
    document.body.appendChild(wrap);

    var input = wrap.querySelector("input");
    var list = wrap.querySelector("ul");
    var active = 0;
    var shown = COMMANDS.slice();

    function paint() {
      list.innerHTML = shown.length
        ? shown.map(function (c, i) {
            return '<li data-active="' + (i === active) + '" data-i="' + i + '">' +
              "<span>" + c.label + '</span><span class="cmd">' + c.cmd + "</span></li>";
          }).join("")
        : '<li data-active="false" style="color:var(--muted)">Không có mục khớp</li>';
    }
    function filter() {
      var q = input.value.trim().toLowerCase();
      shown = COMMANDS.filter(function (c) {
        return !q || c.label.toLowerCase().indexOf(q) > -1 || c.cmd.toLowerCase().indexOf(q) > -1;
      });
      active = 0;
      paint();
    }
    function open() { wrap.hidden = false; input.value = ""; filter(); input.focus(); }
    function close() { wrap.hidden = true; }
    function run(c) {
      if (!c) return;
      close();
      if (c.href) { window.location.href = c.href; return; }
      if (c.drawer) drawer.open();
    }

    input.addEventListener("input", filter);
    list.addEventListener("click", function (e) {
      var li = e.target.closest("li[data-i]");
      if (li) run(shown[+li.dataset.i]);
    });
    wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) close(); });

    document.addEventListener("keydown", function (e) {
      var meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") { e.preventDefault(); wrap.hidden ? open() : close(); return; }
      if (wrap.hidden) return;
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, shown.length - 1); paint(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); paint(); }
      else if (e.key === "Enter") { e.preventDefault(); run(shown[active]); }
    });
    document.addEventListener("click", function (e) {
      if (e.target.closest("[data-palette-open]")) open();
    });
  }

  /* ---------- Boot ---------- */
  function boot() {
    var screen = document.body.dataset.screen || "home";
    renderTitlebar(document.querySelector("[data-shell=titlebar]"));
    renderRail(document.querySelector("[data-shell=rail]"), screen);
    renderStatusbar(document.querySelector("[data-shell=statusbar]"), document.body.dataset.status);

    var drawer = initDrawer();
    initPalette(drawer);
    paintStaged();
    applyRail();

    window.addEventListener("resize", applyRail);
    document.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleRail();
      }
    });

    document.addEventListener("click", function (e) {
      if (e.target.closest("[data-rail-toggle]")) { toggleRail(); return; }
      if (e.target.closest("[data-staged-chip]")) window.location.href = "changes.html";
    });

    // Document tabs switch which drawing every screen is scoped to.
    var tabs = document.querySelector(".doctabs");
    if (tabs) {
      tabs.addEventListener("click", function (e) {
        var tab = e.target.closest(".doctab");
        if (!tab) return;
        tabs.querySelectorAll(".doctab").forEach(function (t) { t.setAttribute("aria-selected", "false"); });
        tab.setAttribute("aria-selected", "true");
        document.dispatchEvent(new CustomEvent("acad:doc", { detail: { id: tab.dataset.doc } }));
      });
    }
  }

  window.App = {
    icon: icon,
    toast: toast,
    modal: modal,
    confirm: confirm,
    guard: guard,
    guards: GUARDS,
    docs: DOCS,
    staged: staged,
    saveStaged: saveStaged,
    pendingCount: pendingCount,
    setStatus: function (t) {
      var slot = document.querySelector("[data-status-slot]");
      if (slot) slot.textContent = t;
    }
  };

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", boot)
    : boot();
})();
