// Electron shell.
//  - Dev (không đóng gói): tools-dev đã chạy daemon + web (Next :3000) -> chỉ mở cửa sổ.
//  - Đóng gói: tự spawn daemon.cjs (Node của Electron) phục vụ UI tĩnh + API ở :8788.
const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("node:child_process");
const { join } = require("node:path");

const PORT = 8788;
const DEV_URL = process.env.ACAD_WEB_URL || process.env.MEP_WEB_URL || "http://localhost:3000";
const PACKAGED_URL = `http://127.0.0.1:${PORT}`;
let daemon = null;

function startDaemon() {
  const buildDir = join(process.resourcesPath, "build");
  daemon = spawn(process.execPath, [join(buildDir, "daemon.cjs")], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      ACAD_DAEMON_PORT: String(PORT),
      MEP_DAEMON_PORT: String(PORT), // legacy alias
      ACAD_WEB_DIR: join(buildDir, "web"),
      MEP_WEB_DIR: join(buildDir, "web"),
      ACAD_SQLJS_WASM: join(buildDir, "sql-wasm.wasm"),
      MEP_SQLJS_WASM: join(buildDir, "sql-wasm.wasm"),
      ACAD_DATA_DIR: app.getPath("userData"),
      MEP_DATA_DIR: app.getPath("userData"),
      ACAD_PROJECT_ROOT:
        process.env.ACAD_PROJECT_ROOT ||
        process.env.MEP_PROJECT_ROOT ||
        join(app.getPath("home"), "Desktop", "tool-autocad"),
      MEP_PROJECT_ROOT:
        process.env.ACAD_PROJECT_ROOT ||
        process.env.MEP_PROJECT_ROOT ||
        join(app.getPath("home"), "Desktop", "tool-autocad"),
    },
    stdio: "ignore",
  });
  daemon.on("exit", (c) => { if (c) console.error("[daemon] thoát", c); });
}

async function waitFor(url, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return true; } catch { /* chưa lên */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function createWindow(url) {
  const win = new BrowserWindow({
    width: 1180, height: 820, minWidth: 820, minHeight: 560,
    title: "Acad Studio", backgroundColor: "#0f1216",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL(url);
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
}

app.whenReady().then(async () => {
  const url = app.isPackaged ? PACKAGED_URL : DEV_URL;
  if (app.isPackaged) startDaemon();
  await waitFor(url + (app.isPackaged ? "/api/health" : ""));
  createWindow(url);
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(url); });
});

app.on("window-all-closed", () => app.quit());
app.on("quit", () => { if (daemon) try { daemon.kill(); } catch { /* */ } });
