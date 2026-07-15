/**
 * Pure helpers for AutoCAD control readiness (health / paths / scratch).
 * Kept free of Express I/O so unit tests exercise the real shipped builders.
 */
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const BRIDGE_DIR_DEFAULT = join(homedir(), "MEP-Bridge");
export const PLUGIN_BUNDLE_NAME = "MEP-Bridge.bundle";
/** Flat ARX package: binary is Contents/MacOS/MepBridge (has acrxEntryPoint). */
export const PLUGIN_BINARY_REL = "Contents/MacOS/MepBridge";

export type HealthCheck = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  /** Setup action id for POST /api/acad/setup/:action, or null if not remediable. */
  fix: string | null;
  /** Optional secondary path (e.g. APPLOAD) when live plugin is dead. */
  appload?: string | null;
};

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

/**
 * Absolute path to load via APPLOAD — the outer package .bundle itself
 * (must export acrxEntryPoint; nested .bundle layout breaks ApplicationAddins).
 */
export function pluginApploadPath(home = homedir()): string {
  return pluginInstallDirs(home).plugins;
}

export function pluginPackageXml(home = homedir()): string {
  return join(pluginInstallDirs(home).plugins, "Contents/PackageContents.xml");
}

export function pluginBinaryPath(home = homedir()): string {
  return join(pluginInstallDirs(home).plugins, PLUGIN_BINARY_REL);
}

export function isPluginInstalled(home = homedir()): boolean {
  return existsSync(pluginPackageXml(home)) && existsSync(pluginBinaryPath(home));
}

/** True if installed package looks like flat ARX (binary at Contents/MacOS/MepBridge). */
export function isPluginLayoutFlat(home = homedir()): boolean {
  const nested = join(pluginInstallDirs(home).plugins, "Contents/MacOS/MepBridge.bundle");
  return existsSync(pluginBinaryPath(home)) && !existsSync(nested);
}

export function bridgeResultsDir(bridgeDir = process.env.MEP_BRIDGE_DIR || BRIDGE_DIR_DEFAULT): string {
  return join(bridgeDir, "results");
}

export function ensureBridgeDir(bridgeDir = process.env.MEP_BRIDGE_DIR || BRIDGE_DIR_DEFAULT): string {
  const results = bridgeResultsDir(bridgeDir);
  mkdirSync(results, { recursive: true });
  return results;
}

export function scratchDwgPath(projectRoot: string): string {
  return join(projectRoot, "mep-studio", ".work", "MEP-RAW-scratch.dwg");
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
      label: "Thư mục cầu nối ~/MEP-Bridge",
      ok: opts.bridgeOk,
      detail: opts.bridgeDetail,
      fix: opts.bridgeOk ? null : "mkbridge",
    },
    {
      id: "plugin",
      label: "Plugin MepBridge (cài đặt)",
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
