// Builds build/icon.png (512x512, used for the window, Linux and macOS) and
// build/icon.ico (16-256, Windows) from build/icon.svg. Runs inside Electron so
// Chromium draws the SVG crisply at every size:   npm run icon
const path = require("path");
const fs = require("fs");

if (!process.versions.electron) {
  const { spawnSync } = require("child_process");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(require("electron"), [__filename], { stdio: "inherit", env });
  process.exit(r.status ?? 1);
}

const { app, BrowserWindow } = require("electron");
const DIR = path.join(__dirname, "..", "build");
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

async function renderer(svg) {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, backgroundColor: "#00000000", webPreferences: { offscreen: true } });
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden"><img id="i" style="display:block;width:512px;height:512px" src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"></body></html>`;
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString("base64")}`);
  return {
    async render(size) {
      await win.webContents.executeJavaScript(`new Promise((done) => { const i = document.getElementById("i"); i.style.width = i.style.height = "${size}px"; requestAnimationFrame(() => requestAnimationFrame(done)); })`);
      const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
      return (image.getSize().width === size ? image : image.resize({ width: size, height: size, quality: "best" })).toPNG();
    },
    close: () => win.destroy(),
  };
}

function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  try {
    const r = await renderer(fs.readFileSync(path.join(DIR, "icon.svg"), "utf8"));
    fs.writeFileSync(path.join(DIR, "icon.png"), await r.render(512));
    const ico = [];
    for (const size of ICO_SIZES) ico.push({ size, data: await r.render(size) });
    fs.writeFileSync(path.join(DIR, "icon.ico"), buildIco(ico));
    r.close();
    console.log("Wrote build/icon.png and build/icon.ico");
    app.exit(0);
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
});
