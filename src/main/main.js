// Perchlight: main process. Serves the app's pages from app://perchlight/
// (so they can use ES modules under a strict Content Security Policy), and
// registers the IPC channels in ipc.js.
import { app, BrowserWindow, net, protocol, shell } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerIpc, EXTERNAL_HOSTS } from "./ipc.js";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVED = ["renderer", "shared"]; // only these folders are reachable from the window

if (process.env.PERCHLIGHT_USER_DATA) app.setPath("userData", process.env.PERCHLIGHT_USER_DATA);

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

function serveApp() {
  protocol.handle("app", (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const file = path.normalize(path.join(SRC, rel));
    const allowed = url.host === "perchlight" && SERVED.some((d) => file.startsWith(path.join(SRC, d) + path.sep));
    if (!allowed) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).href);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 560,
    title: "Perchlight",
    icon: path.join(SRC, "..", "build", "icon.png"),
    backgroundColor: "#16171b",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(SRC, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  // Links to the allowed sites open in the browser; the window never navigates away or opens popups.
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.protocol === "https:" && EXTERNAL_HOSTS.includes(u.hostname)) shell.openExternal(u.href);
    } catch {
      // not a URL: ignore
    }
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.loadURL("app://perchlight/renderer/index.html");
  if (process.env.PERCHLIGHT_SMOKE) smokeTest(win, process.env.PERCHLIGHT_SMOKE);
}

/** `npm run smoke`: loads the app, reports console errors, saves a screenshot, quits. */
function smokeTest(win, outFile) {
  const problems = [];
  win.webContents.on("console-message", (e) => {
    const level = e.level ?? "info";
    if (level === "error" || level === "warning") problems.push(`${level}: ${e.message}`);
  });
  win.webContents.on("render-process-gone", (_e, d) => problems.push(`renderer gone: ${d.reason}`));
  win.webContents.once("did-finish-load", () => {
    setTimeout(async () => {
      const fs = await import("node:fs");
      fs.writeFileSync(outFile, (await win.webContents.capturePage()).toPNG());
      const title = await win.webContents.executeJavaScript("document.querySelector('h1')?.textContent ?? '(no heading)'");
      // Open the first dialog the screen offers (e.g. "+ Add project") and capture it too.
      await win.webContents.executeJavaScript("document.querySelector('main button.primary')?.click()");
      await new Promise((r) => setTimeout(r, 600));
      fs.writeFileSync(outFile.replace(/\.png$/, "-dialog.png"), (await win.webContents.capturePage()).toPNG());
      console.log(`SMOKE heading: ${title}`);
      console.log(problems.length ? `SMOKE problems:\n${problems.join("\n")}` : "SMOKE ok: no console errors");
      app.exit(problems.length ? 1 : 0);
    }, 2500);
  });
}

app.setAppUserModelId("dev.perchlight.app");

// One copy at a time: two would overwrite each other's projects and sign-ins.
if (!process.env.PERCHLIGHT_SMOKE && !app.requestSingleInstanceLock()) app.exit(0);
app.on("second-instance", () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
// The app never asks for camera, microphone, location or notifications.
app.on("web-contents-created", (_e, contents) => {
  contents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
});

app.whenReady().then(() => {
  serveApp();
  registerIpc();
  createWindow();
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
