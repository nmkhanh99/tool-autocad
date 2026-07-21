/**
 * Pure helpers for AutoCAD control readiness (health / paths / scratch).
 * Kept free of Express I/O so unit tests exercise the real shipped builders.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  BRIDGE_DIR_NAME,
  PLUGIN_BINARY_NAME,
  PLUGIN_BINARY_REL as PLUGIN_BINARY_REL_CONTRACT,
  PLUGIN_BUNDLE_NAME as PLUGIN_BUNDLE_NAME_CONTRACT,
  PRODUCT,
  ensureBridgeLayout,
  resolveBridgeDir,
} from "./bridgeContract.js";

export const BRIDGE_DIR_DEFAULT = resolveBridgeDir();
export const PLUGIN_BUNDLE_NAME = PLUGIN_BUNDLE_NAME_CONTRACT;
/** Flat ARX package: binary is Contents/MacOS/AcadBridge (has acrxEntryPoint). */
export const PLUGIN_BINARY_REL = PLUGIN_BINARY_REL_CONTRACT;
export { PLUGIN_BINARY_NAME, BRIDGE_DIR_NAME, resolveBridgeDir, ensureBridgeLayout };

/** Autodesk Customer Error Report folder — telemetry after crash, NOT the root bug. */
export function cerRootDir(home = homedir()): string {
  return join(home, "Library/Application Support/Autodesk/CER");
}

/** User AutoCAD 2027 Support (en) — SHX substitutes live here. */
export function acadUserSupportDir(home = homedir()): string {
  return join(
    home,
    "Library/Application Support/Autodesk/AutoCAD 2027/R26.0/roaming/@en@/Support",
  );
}

export function acadUserShxFontDir(home = homedir()): string {
  return join(acadUserSupportDir(home), "SHXFont");
}

/** Stock AutoCAD SHX fonts (source for substitutes). */
export function acadStockShxDir(): string {
  return "/Applications/Autodesk/AutoCAD 2027/AutoCAD 2027.app/Contents/Resources/Fonts/shx";
}

/** Project-bundled font substitutes (romans1 / SUPEROS). */
export function projectFontsDir(projectRoot: string): string {
  return join(projectRoot, "acad-studio", "fonts");
}

export const STABILITY_FONT_NAMES = ["romans1.shx", "SUPEROS.SHX"] as const;

export type HealthCheck = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  /** Setup action id for POST /api/acad/setup/:action, or null if not remediable. */
  fix: string | null;
  /** Optional secondary path (e.g. APPLOAD) when live plugin is dead. */
  appload?: string | null;
  /** Group for UI: readiness | stability */
  group?: "readiness" | "stability";
};

const LEGACY_PLUGIN_BUNDLE = "MEP-Bridge.bundle";
const LEGACY_PLUGIN_BINARY_REL = "Contents/MacOS/MepBridge";

export function pluginInstallDirs(home = homedir()): {
  plugins: string;
  addins: string;
} {
  const base = join(home, "Library/Application Support/Autodesk");
  return {
    plugins: join(base, "ApplicationPlugins", PLUGIN_BUNDLE_NAME),
    addins: join(base, "ApplicationAddins", PLUGIN_BUNDLE_NAME),
  };
}

/** Primary or legacy package dir under ApplicationPlugins (whichever is present). */
export function resolveInstalledPluginDir(home = homedir()): string {
  const primary = pluginInstallDirs(home).plugins;
  if (
    existsSync(join(primary, "Contents/PackageContents.xml")) &&
    (existsSync(join(primary, PLUGIN_BINARY_REL)) ||
      existsSync(join(primary, LEGACY_PLUGIN_BINARY_REL)))
  ) {
    return primary;
  }
  const legacy = join(home, "Library/Application Support/Autodesk/ApplicationPlugins", LEGACY_PLUGIN_BUNDLE);
  if (existsSync(join(legacy, "Contents/PackageContents.xml"))) return legacy;
  return primary;
}

/**
 * Absolute path to load via APPLOAD — the outer package .bundle itself
 * (must export acrxEntryPoint; nested .bundle layout breaks ApplicationAddins).
 */
export function pluginApploadPath(home = homedir()): string {
  return resolveInstalledPluginDir(home);
}

export function pluginPackageXml(home = homedir()): string {
  return join(resolveInstalledPluginDir(home), "Contents/PackageContents.xml");
}

export function pluginBinaryPath(home = homedir()): string {
  const dir = resolveInstalledPluginDir(home);
  const primary = join(dir, PLUGIN_BINARY_REL);
  if (existsSync(primary)) return primary;
  const legacy = join(dir, LEGACY_PLUGIN_BINARY_REL);
  if (existsSync(legacy)) return legacy;
  return primary;
}

export function isPluginInstalled(home = homedir()): boolean {
  return existsSync(pluginPackageXml(home)) && existsSync(pluginBinaryPath(home));
}

/** True if installed package looks like flat ARX (binary at Contents/MacOS/AcadBridge). */
export function isPluginLayoutFlat(home = homedir()): boolean {
  const nested = join(
    pluginInstallDirs(home).plugins,
    `Contents/MacOS/${PLUGIN_BINARY_NAME}.bundle`,
  );
  return existsSync(pluginBinaryPath(home)) && !existsSync(nested);
}

export function bridgeResultsDir(bridgeDir = resolveBridgeDir()): string {
  return join(bridgeDir, "results");
}

export function ensureBridgeDir(bridgeDir = resolveBridgeDir()): string {
  return ensureBridgeLayout(bridgeDir);
}

export function scratchDwgPath(projectRoot: string): string {
  return join(projectRoot, "acad-studio", ".work", "ACAD-RAW-scratch.dwg");
}

export function sdkIncPath(): string {
  return "/Library/Developer/Autodesk/ObjectARX 2027/inc";
}

/**
 * Build the static portion of the health checklist (no process I/O).
 * Live/running items are merged by the daemon after probing AutoCAD.
 */
export function buildStaticHealthChecks(opts: {
  acadApp: string | null;
  coreConsole: string | null;
  bridgeOk: boolean;
  bridgeDetail: string;
  pluginOk: boolean;
  sdkOk: boolean;
  clangOk: boolean;
  agentsDetail: string;
  agentsOk: boolean;
  home?: string;
}): HealthCheck[] {
  const home = opts.home ?? homedir();
  const appload = pluginApploadPath(home);
  return [
    {
      id: "autocad",
      label: "AutoCAD 2027",
      ok: !!opts.acadApp,
      detail: opts.acadApp || "Chưa cài trong /Applications/Autodesk",
      fix: null,
    },
    {
      id: "corecon",
      label: "AcCoreConsole (chức năng headless)",
      ok: !!opts.coreConsole,
      detail: opts.coreConsole || "Không thấy Helpers/AcCoreConsole",
      fix: null,
    },
    {
      id: "bridge",
      label: `Thư mục cầu nối ${PRODUCT.bridgeHomeHint}`,
      ok: opts.bridgeOk,
      detail: opts.bridgeDetail,
      fix: opts.bridgeOk ? null : "mkbridge",
    },
    {
      id: "plugin",
      label: `Plugin ${PRODUCT.plugin} (cài đặt)`,
      ok: opts.pluginOk,
      detail: opts.pluginOk
        ? `Đã cài (flat ARX) — APPLOAD: ${appload}`
        : "Chưa cài — bấm Build & cài (cần SDK + clang)",
      fix: opts.pluginOk ? null : "buildplugin",
      appload: opts.pluginOk ? appload : null,
    },
    {
      id: "sdk",
      label: "ObjectARX SDK (để build plugin)",
      ok: opts.sdkOk,
      detail: opts.sdkOk ? sdkIncPath() : "Chưa tải SDK (aps.autodesk.com)",
      fix: null,
    },
    {
      id: "clang",
      label: "Trình biên dịch clang++",
      ok: opts.clangOk,
      detail: opts.clangOk ? "OK" : "Cài Xcode Command Line Tools",
      fix: null,
    },
    {
      id: "agents",
      label: "CLI agent chat (claude/codex/grok)",
      ok: opts.agentsOk,
      detail: opts.agentsDetail || "Chưa có",
      fix: null,
    },
  ];
}

/** Merge static checks + live AutoCAD/plugin probe into final report. */
export function mergeLiveHealth(
  staticChecks: HealthCheck[],
  live: {
    running: boolean;
    pluginAlive: boolean;
    docsCount: number;
    pluginInstalled: boolean;
    apploadPath: string;
  },
): HealthCheck[] {
  const checks = [...staticChecks];
  checks.push({
    id: "running",
    label: "AutoCAD đang chạy (GUI)",
    ok: live.running,
    detail: live.running
      ? "Đang chạy"
      : "Chưa mở — bấm Mở AutoCAD + file mới",
    fix: live.running ? null : "openacad",
  });

  if (!live.running) {
    checks.push({
      id: "pluginlive",
      label: "Plugin phản hồi (heartbeat)",
      ok: true,
      detail: "AutoCAD chưa mở — sẽ kiểm khi mở",
      fix: null,
      appload: live.pluginInstalled ? live.apploadPath : null,
    });
  } else if (live.pluginAlive) {
    checks.push({
      id: "pluginlive",
      label: "Plugin phản hồi (heartbeat)",
      ok: true,
      detail: `OK — ${live.docsCount} bản vẽ đang mở`,
      fix: null,
      appload: live.apploadPath,
    });
  } else {
    checks.push({
      id: "pluginlive",
      label: "Plugin phản hồi (heartbeat)",
      ok: false,
      detail:
        "KHÔNG phản hồi. Trong AutoCAD: APPLOAD → chọn file dưới đây (hoặc Always Load), " +
        "hoặc khởi động lại AutoCAD. Path: " +
        live.apploadPath,
      fix: live.pluginInstalled ? "restartacad" : "buildplugin",
      appload: live.apploadPath,
    });
  }
  return checks;
}

/** Overall readiness: control usable when headless pieces OK; live optional. */
export function healthReportOk(checks: HealthCheck[]): boolean {
  // Fail only on hard blockers for any control (app, corecon, bridge).
  // pluginlive may be false while headless still works.
  const hard = new Set(["autocad", "corecon", "bridge"]);
  return checks.filter((c) => hard.has(c.id)).every((c) => c.ok);
}

/**
 * Explain CER .analytics paths vs real crash root cause (AcadBridge reactor).
 * Pure — used by health payload and UI.
 */
export function cerNotRootCauseMessage(): string {
  return (
    "Đường dẫn …/Autodesk/CER/…/*.analytics là telemetry hộp thoại gửi báo cáo crash (CER), " +
    "KHÔNG phải nguyên nhân lỗi. Crash gần đây: plugin AcadBridge gọi removeReactor trên database " +
    "đã huỷ khi đổi/đóng tab bản vẽ (documentActivated). Cách sửa: Build & cài plugin (bản đã fix reactor) " +
    "rồi Restart AutoCAD."
  );
}

export type FontStabilityStatus = {
  ok: boolean;
  missing: string[];
  present: string[];
  supportDir: string;
  shxDir: string;
};

/** Check whether missing-drawing SHX substitutes exist under user Support. */
export function checkStabilityFonts(home = homedir()): FontStabilityStatus {
  const supportDir = acadUserSupportDir(home);
  const shxDir = acadUserShxFontDir(home);
  const present: string[] = [];
  const missing: string[] = [];
  for (const name of STABILITY_FONT_NAMES) {
    const a = join(shxDir, name);
    const b = join(supportDir, name);
    // macOS case-insensitive FS: SUPEROS.SHX / superos.shx same path
    if (existsSync(a) || existsSync(b)) present.push(name);
    else missing.push(name);
  }
  return { ok: missing.length === 0, missing, present, supportDir, shxDir };
}

/**
 * Install romans1.shx + SUPEROS.SHX from stock AutoCAD fonts (or project fonts/).
 * Pure enough for unit tests with custom home/projectRoot.
 */
export function fixStabilityFonts(opts?: {
  home?: string;
  projectRoot?: string;
}): { ok: boolean; detail: string; installed: string[]; error?: string } {
  const home = opts?.home ?? homedir();
  const projectRoot =
    opts?.projectRoot ||
    process.env.MEP_PROJECT_ROOT ||
    join(homedir(), "Desktop", "tool-autocad");
  const shxDir = acadUserShxFontDir(home);
  const supportDir = acadUserSupportDir(home);
  const stock = acadStockShxDir();
  const proj = projectFontsDir(projectRoot);
  try {
    mkdirSync(shxDir, { recursive: true });
    mkdirSync(supportDir, { recursive: true });
  } catch (e) {
    return { ok: false, detail: "", installed: [], error: "mkdir: " + e };
  }
  const map: Record<string, string> = {
    "romans1.shx": "romans.shx",
    "SUPEROS.SHX": "simplex.shx",
  };
  const installed: string[] = [];
  for (const [destName, stockName] of Object.entries(map)) {
    const dest = join(shxDir, destName);
    const candidates = [
      join(proj, destName),
      join(stock, stockName),
      join(supportDir, destName),
    ];
    const src = candidates.find((p) => existsSync(p));
    if (!src) {
      return {
        ok: false,
        detail: `Không thấy nguồn cho ${destName}`,
        installed,
        error: `missing source ${stockName} / project fonts`,
      };
    }
    try {
      copyFileSync(src, dest);
      copyFileSync(src, join(supportDir, destName));
      installed.push(destName);
    } catch (e) {
      return { ok: false, detail: "", installed, error: String(e) };
    }
  }
  // Font map lines (append if acad.fmp exists)
  const fmp = join(supportDir, "acad.fmp");
  try {
    if (existsSync(fmp)) {
      let text = readFileSync(fmp, "utf8");
      const need = ["romans1;romans.shx", "SUPEROS;simplex.shx", "superos;simplex.shx"];
      for (const line of need) {
        if (!text.toLowerCase().includes(line.split(";")[0].toLowerCase() + ";")) {
          if (!text.endsWith("\n")) text += "\n";
          text += line + "\n";
        }
      }
      writeFileSync(fmp, text, "utf8");
    }
  } catch {
    /* optional fmp */
  }
  return {
    ok: installed.length === STABILITY_FONT_NAMES.length,
    detail: `Đã cài font thay thế: ${installed.join(", ")} → ${shxDir}`,
    installed,
  };
}

/** Count recent CER crash folders (informational). */
export function countRecentCerReports(home = homedir(), maxAgeMs = 7 * 24 * 3600 * 1000): {
  count: number;
  cerDir: string;
  newestMs: number | null;
} {
  const cerDir = cerRootDir(home);
  if (!existsSync(cerDir)) return { count: 0, cerDir, newestMs: null };
  let count = 0;
  let newestMs: number | null = null;
  const now = Date.now();
  try {
    for (const name of readdirSync(cerDir)) {
      const p = join(cerDir, name);
      try {
        const st = statSync(p);
        if (!st.isDirectory()) continue;
        // product hash dirs contain numeric session folders
        for (const sub of readdirSync(p)) {
          if (!/^\d+$/.test(sub)) continue;
          const sp = join(p, sub);
          const sst = statSync(sp);
          if (now - sst.mtimeMs <= maxAgeMs) {
            count++;
            if (newestMs == null || sst.mtimeMs > newestMs) newestMs = sst.mtimeMs;
          }
        }
      } catch {
        /* skip */
      }
    }
  } catch {
    /* */
  }
  return { count, cerDir, newestMs };
}

/**
 * Stability-oriented checks: CER explain, reactor/plugin rebuild, fonts.
 * Pure builders — no Express.
 */
export function buildStabilityChecks(opts: {
  pluginInstalled: boolean;
  pluginAlive: boolean;
  running: boolean;
  fonts: FontStabilityStatus;
  cerReports: { count: number; cerDir: string };
  apploadPath: string;
  /** True if objectarx/mepbridge.cpp contains reactor safety (documentToBeDestroyed detach). */
  reactorFixInSource?: boolean;
}): HealthCheck[] {
  const checks: HealthCheck[] = [];

  // Always OK informational — so UI shows "not the bug"
  checks.push({
    id: "cer_telemetry",
    label: "CER / file .analytics",
    ok: true,
    detail:
      opts.cerReports.count > 0
        ? `${opts.cerReports.count} báo cáo crash CER (7 ngày) tại ${opts.cerReports.cerDir} — đây là log gửi report, không phải root cause.`
        : `Thư mục CER: ${opts.cerReports.cerDir}. File *.analytics chỉ là telemetry hộp thoại crash, không phải nguyên nhân lỗi.`,
    fix: null,
    group: "stability",
  });

  // Reactor / plugin rebuild path
  const reactorOk = opts.pluginInstalled && opts.pluginAlive;
  checks.push({
    id: "acadbridge_reactor",
    label: "AcadBridge ổn định (reactor đổi bản vẽ)",
    ok: reactorOk,
    detail: reactorOk
      ? "Plugin live — bản đã cài đang phản hồi. Nếu vừa crash khi đổi tab: Build & cài lại (fix reactor) rồi Restart CAD."
      : !opts.pluginInstalled
        ? "Chưa cài AcadBridge — Build & cài (objectarx, gồm fix documentActivated/removeReactor)."
        : !opts.running
          ? "AutoCAD chưa mở — mở CAD rồi kiểm heartbeat. Sau build plugin phải Restart CAD."
          : "Plugin không live — Restart CAD hoặc Build & cài lại (crash class: removeReactor khi đổi tab).",
    fix: !opts.pluginInstalled
      ? "buildplugin"
      : opts.running && !opts.pluginAlive
        ? "restartacad"
        : opts.pluginInstalled && !opts.pluginAlive
          ? "buildplugin"
          : opts.pluginInstalled
            ? "buildplugin" // allow rebuild even when live (user may need latest fix)
            : null,
    appload: opts.apploadPath,
    group: "stability",
  });

  // When plugin is live, still expose rebuild as optional fix via always-available button in UI;
  // mark ok true but keep fix=buildplugin for "Cài bản fix reactor"
  if (reactorOk) {
    const last = checks[checks.length - 1];
    last.fix = "buildplugin"; // remediable upgrade path
    last.detail += " Nút Sửa = rebuild+cài bản plugin hiện tại (sau đó Restart CAD).";
  }

  checks.push({
    id: "stability_fonts",
    label: "Font SHX bản vẽ (romans1 / SUPEROS)",
    ok: opts.fonts.ok,
    detail: opts.fonts.ok
      ? `OK: ${opts.fonts.present.join(", ")} tại ${opts.fonts.shxDir}`
      : `Thiếu: ${opts.fonts.missing.join(", ")} — bấm Sửa font (thay romans/simplex). Hộp missing SHX ≠ CER.`,
    fix: opts.fonts.ok ? null : "fixfonts",
    group: "stability",
  });

  if (opts.reactorFixInSource === false) {
    checks.push({
      id: "reactor_source",
      label: "Mã nguồn fix reactor",
      ok: false,
      detail: "objectarx/mepbridge.cpp chưa có detach an toàn — cần cập nhật code rồi buildplugin.",
      fix: null,
      group: "stability",
    });
  }

  return checks;
}

/** Map check id → preferred fix action (for tests / UI). */
export function stabilityFixForCheck(checkId: string): string | null {
  const m: Record<string, string | null> = {
    cer_telemetry: null,
    acadbridge_reactor: "buildplugin",
    mepbridge_reactor: "buildplugin", // legacy check id alias
    stability_fonts: "fixfonts",
    pluginlive: "restartacad",
    running: "openacad",
    plugin: "buildplugin",
  };
  return Object.prototype.hasOwnProperty.call(m, checkId) ? m[checkId] : null;
}

/**
 * Detect if shipped mepbridge.cpp contains the reactor detach fix.
 * Reads source when path provided / default project layout.
 */
export function reactorFixPresentInSource(mepbridgeCppPath: string): boolean {
  if (!existsSync(mepbridgeCppPath)) return false;
  try {
    const src = readFileSync(mepbridgeCppPath, "utf8");
    return (
      src.includes("documentToBeDestroyed") &&
      (src.includes("detachDbReactor") || src.includes("gDocWatched"))
    );
  } catch {
    return false;
  }
}

/** Default path to mepbridge.cpp under project root. */
export function defaultMepbridgeCppPath(projectRoot?: string): string {
  const root =
    projectRoot ||
    process.env.MEP_PROJECT_ROOT ||
    join(homedir(), "Desktop", "tool-autocad");
  return join(root, "objectarx", "mepbridge.cpp");
}

export function openPayload(opts: {
  app: string;
  path: string | null;
  created: string | null;
}): {
  ok: true;
  app: string;
  path: string | null;
  created: string | null;
  hint: string;
} {
  return {
    ok: true,
    app: opts.app,
    path: opts.path,
    created: opts.created,
    hint: opts.path
      ? `Đã mở AutoCAD với ${opts.path}. Đợi plugin nạp; nếu heartbeat fail → APPLOAD ${pluginApploadPath()}.`
      : "Đã mở AutoCAD. File → New hoặc Open, rồi APPLOAD plugin nếu cần.",
  };
}
