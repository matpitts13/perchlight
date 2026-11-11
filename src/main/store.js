// Projects, sign-in secrets and screen configs, kept in Electron's userData
// folder. Nothing here is synced or sent anywhere.
//   projects.json          [{ id, name, accountId, accountName, auth: "token" | "oauth" }]
//   secrets.json           { [projectId]: base64 of safeStorage-encrypted JSON }
//   views/<projectId>.json  the project's perchlight.json
import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { emptyConfig, validateConfig } from "../shared/config-schema.js";

const dir = () => app.getPath("userData");
const file = (name) => path.join(dir(), name);
const ID_RE = /^[a-z0-9-]{8,64}$/;

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") console.error(`store: couldn't read ${path.basename(p)}: ${err.message}`);
    return fallback;
  }
}

/** Writes atomically (temp file, then rename), so a crash never leaves half a file. */
function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, p);
}

export function listProjects() {
  const list = readJson(file("projects.json"), []);
  return Array.isArray(list) ? list.filter((p) => p && ID_RE.test(p.id)) : [];
}

export function getProject(id) {
  if (typeof id !== "string" || !ID_RE.test(id)) throw new Error("Unknown project");
  const p = listProjects().find((x) => x.id === id);
  if (!p) throw new Error("Unknown project");
  return p;
}

export function saveProject(project) {
  const clean = {
    id: ID_RE.test(project.id ?? "") ? project.id : crypto.randomUUID(),
    name: String(project.name ?? "").trim().slice(0, 60) || "My site",
    accountId: String(project.accountId ?? "").slice(0, 64),
    accountName: String(project.accountName ?? "").slice(0, 120),
    auth: project.auth === "oauth" ? "oauth" : "token",
  };
  const list = listProjects().filter((p) => p.id !== clean.id);
  list.push(clean);
  writeJson(file("projects.json"), list);
  return clean;
}

export function deleteProject(id) {
  getProject(id);
  writeJson(file("projects.json"), listProjects().filter((p) => p.id !== id));
  const secrets = readJson(file("secrets.json"), {});
  delete secrets[id];
  writeJson(file("secrets.json"), secrets);
  fs.rmSync(file(path.join("views", `${id}.json`)), { force: true });
}

// --- secrets (encrypted with the operating system's key store) -------------

function requireEncryption() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("This computer's secure storage isn't available, so sign-ins can't be saved safely.");
  }
}

export function getSecret(id) {
  const blob = readJson(file("secrets.json"), {})[id];
  if (!blob || !safeStorage.isEncryptionAvailable()) return null; // unreadable here: shown as signed out
  try {
    return JSON.parse(safeStorage.decryptString(Buffer.from(blob, "base64")));
  } catch {
    return null; // encrypted by another user account or machine: sign in again
  }
}

export function setSecret(id, value) {
  requireEncryption();
  const secrets = readJson(file("secrets.json"), {});
  secrets[id] = safeStorage.encryptString(JSON.stringify(value)).toString("base64");
  writeJson(file("secrets.json"), secrets);
}

export function clearSecret(id) {
  const secrets = readJson(file("secrets.json"), {});
  delete secrets[id];
  writeJson(file("secrets.json"), secrets);
}

// --- screen configs --------------------------------------------------------

export function getViews(id) {
  getProject(id);
  const cfg = readJson(file(path.join("views", `${id}.json`)), null);
  try {
    if (cfg && validateConfig(cfg).ok) return cfg;
  } catch (err) {
    console.error(`store: screens file for ${id} couldn't be checked: ${err.message}`);
  }
  if (cfg) console.error(`store: screens file for ${id} has problems; starting empty (the file is left as it is until you save)`);
  return emptyConfig();
}

/** Saves after checking; returns { ok, errors }. */
export function saveViews(id, config) {
  getProject(id);
  const result = validateConfig(config);
  if (result.ok) writeJson(file(path.join("views", `${id}.json`)), config);
  return result;
}
