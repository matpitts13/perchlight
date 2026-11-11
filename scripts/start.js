// Starts the app. VS Code's terminal sets ELECTRON_RUN_AS_NODE, which makes
// Electron run as plain Node with no window, so clear it first.
//   npm start
//   npm run smoke    (loads the app, checks for errors, saves smoke.png, quits)
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
if (process.argv.includes("--smoke")) {
  env.PERCHLIGHT_SMOKE = path.join(root, "smoke.png");
  // A throwaway profile, so a smoke run never touches your real projects.
  env.PERCHLIGHT_USER_DATA = path.join(root, ".smoke-profile");
}
const child = spawn(electron, ["."], { stdio: "inherit", env, cwd: root });
child.on("exit", (code) => process.exit(code ?? 0));
