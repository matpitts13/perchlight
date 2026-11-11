// The only things the app's window can ask the main process to do. Every
// channel checks its input; tokens stay in this process.
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import * as store from "./store.js";
import { client, listAccounts } from "./cloudflare.js";
import { oauthAvailable, signInWithBrowser, TOKEN_TEMPLATE_URL } from "./auth.js";
import { validateConfig } from "../shared/config-schema.js";

// Sign-ins waiting for the user to pick an account: pendingId -> secret. In memory only.
const pending = new Map();
const PENDING_TTL_MS = 15 * 60 * 1000;

export const EXTERNAL_HOSTS = ["dash.cloudflare.com", "developers.cloudflare.com", "github.com", "perchlight.ravenburst.com"];

// --- input checks ----------------------------------------------------------
const fail = (msg) => {
  throw new Error(msg);
};
const str = (v, name, max = 1000) => (typeof v === "string" && v.length <= max ? v : fail(`${name} should be text (at most ${max} characters)`));
const optStr = (v, name, max) => (v === undefined || v === null ? undefined : str(v, name, max));
const obj = (v, name) => (v && typeof v === "object" && !Array.isArray(v) ? v : fail(`${name} is missing`));
const scalar = (v) => v === null || ["string", "number", "boolean"].includes(typeof v);

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, payload) => {
    // Only our own window, loaded from our own app:// pages, may call in.
    if (!event.senderFrame || !event.senderFrame.url.startsWith("app://perchlight/")) return { ok: false, error: "Not allowed" };
    try {
      return { ok: true, value: await fn(payload ?? {}) };
    } catch (err) {
      return { ok: false, error: err?.message || String(err), signedOut: Boolean(err?.signedOut) };
    }
  });
}

function rememberPending(secret, accounts) {
  const id = crypto.randomUUID();
  pending.set(id, { secret, accounts, at: Date.now() });
  for (const [k, v] of pending) if (Date.now() - v.at > PENDING_TTL_MS) pending.delete(k);
  return id;
}
function takePending(id) {
  const p = pending.get(str(id, "pendingId", 100));
  if (!p || Date.now() - p.at > PENDING_TTL_MS) fail("That sign-in has expired. Start again.");
  pending.delete(id);
  return p;
}

// --- Cloudflare calls ------------------------------------------------------
const CF = {
  kvNamespaces: () => [],
  kvKeys: ([ns, prefix, opts]) => [str(ns, "namespace", 100), optStr(prefix, "prefix", 512) ?? "", { limit: Math.min(Number(opts?.limit) || 10000, 50000) }],
  kvGet: ([ns, key]) => [str(ns, "namespace", 100), str(key, "key", 512)],
  kvGetMany: ([ns, keys]) => {
    if (!Array.isArray(keys) || keys.length > 5000) fail("keys should be a list of at most 5000");
    return [str(ns, "namespace", 100), keys.map((k) => str(k, "key", 512))];
  },
  kvPut: ([ns, key, value, expiration, metadata]) => [
    str(ns, "namespace", 100),
    str(key, "key", 512),
    str(value, "value", 25 * 1024 * 1024),
    expiration === null || expiration === undefined ? null : Number.isInteger(expiration) ? expiration : fail("expiration should be a whole number"),
    metadata === null || metadata === undefined
      ? null
      : JSON.stringify(metadata).length <= 1024
        ? metadata
        : fail("metadata is larger than Cloudflare's 1024-byte limit"),
  ],
  kvDelete: ([ns, key]) => [str(ns, "namespace", 100), str(key, "key", 512)],
  d1Databases: () => [],
  d1Query: ([db, sql, params]) => {
    const p = params ?? [];
    if (!Array.isArray(p) || p.length > 100 || !p.every(scalar)) fail("params should be a list of up to 100 plain values");
    return [str(db, "database", 100), str(sql, "sql", 100_000), p];
  },
};

export function registerIpc() {
  handle("app:info", () => ({ version: app.getVersion(), oauthAvailable: oauthAvailable(), tokenTemplateUrl: TOKEN_TEMPLATE_URL }));

  handle("auth:checkToken", async ({ token }) => {
    const t = str(token, "token", 500).trim();
    if (!/^[A-Za-z0-9_-]{20,}$/.test(t)) fail("That doesn't look like a Cloudflare API token. Copy the whole token shown after you create it.");
    const accounts = await listAccounts(t);
    if (!accounts.length) fail("That token can't see any Cloudflare account. Give it the Account Settings: Read permission.");
    return { pendingId: rememberPending({ token: t }, accounts), accounts, auth: "token" };
  });

  handle("auth:browserSignIn", async () => {
    const secret = await signInWithBrowser();
    const accounts = await listAccounts(secret.accessToken);
    if (!accounts.length) fail("That sign-in can't see any Cloudflare account.");
    BrowserWindow.getAllWindows()[0]?.focus();
    return { pendingId: rememberPending(secret, accounts), accounts, auth: "oauth" };
  });

  handle("projects:list", () => store.listProjects().map((p) => ({ ...p, signedIn: store.getSecret(p.id) !== null })));

  /**
   * Creates a project, renames one, or re-signs-in an existing one (id given).
   * The sign-in is taken and checked first, and the account must be one that
   * sign-in can actually see; the auth type comes from the sign-in itself.
   */
  handle("projects:save", ({ id, name, pendingId, accountId }) => {
    const existing = id ? store.getProject(str(id, "id", 64)) : null;
    let signIn = null;
    if (pendingId) signIn = takePending(pendingId);
    else if (!existing) fail("Sign in first.");

    let account = null;
    if (signIn) {
      account = signIn.accounts.find((a) => a.id === str(accountId ?? "", "accountId", 64));
      if (!account) fail("That account isn't one this sign-in can use.");
    }
    const project = store.saveProject({
      id: existing?.id,
      name: str(name ?? existing?.name ?? "", "name", 60),
      accountId: account?.id ?? existing.accountId,
      accountName: account?.name ?? existing.accountName,
      auth: signIn ? ("accessToken" in signIn.secret ? "oauth" : "token") : existing.auth,
    });
    if (signIn) store.setSecret(project.id, signIn.secret);
    return project;
  });

  handle("projects:delete", ({ id }) => store.deleteProject(str(id, "id", 64)));
  handle("projects:signOut", ({ id }) => store.clearSecret(store.getProject(str(id, "id", 64)).id));

  handle("views:get", ({ projectId }) => store.getViews(str(projectId, "projectId", 64)));
  handle("views:save", ({ projectId, config }) => store.saveViews(str(projectId, "projectId", 64), obj(config, "config")));

  handle("views:import", async ({ projectId }) => {
    store.getProject(str(projectId, "projectId", 64));
    const win = BrowserWindow.getFocusedWindow();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: "Import screens", filters: [{ name: "Perchlight screens", extensions: ["json"] }], properties: ["openFile"] });
    if (canceled || !filePaths[0]) return null;
    if (fs.statSync(filePaths[0]).size > 2 * 1024 * 1024) fail("That file is too large to be a screens file.");
    let config;
    try {
      config = JSON.parse(fs.readFileSync(filePaths[0], "utf8"));
    } catch (err) {
      return { ok: false, errors: [{ path: "(file)", message: `isn't valid JSON: ${err.message}` }] };
    }
    const result = validateConfig(config);
    return result.ok ? { ...store.saveViews(projectId, config), config } : result;
  });

  handle("views:export", async ({ projectId }) => {
    const config = store.getViews(str(projectId, "projectId", 64));
    const win = BrowserWindow.getFocusedWindow();
    const { canceled, filePath } = await dialog.showSaveDialog(win, { title: "Export screens", defaultPath: "perchlight.json", filters: [{ name: "JSON", extensions: ["json"] }] });
    if (canceled || !filePath) return null;
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf8");
    return filePath;
  });

  handle("cf:call", ({ projectId, name, args }) => {
    if (!Object.hasOwn(CF, name)) fail(`Unknown call ${String(name).slice(0, 40)}`);
    const checked = CF[name](Array.isArray(args) ? args : []);
    return client(str(projectId, "projectId", 64))[name](...checked);
  });

  handle("file:saveText", async ({ name, text }) => {
    const win = BrowserWindow.getFocusedWindow();
    const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: str(name, "name", 200).replace(/[\\/:*?"<>|]/g, "-") });
    if (canceled || !filePath) return null;
    fs.writeFileSync(filePath, str(text, "text", 100 * 1024 * 1024), "utf8");
    return filePath;
  });

  handle("external:open", ({ url }) => {
    const u = new URL(str(url, "url", 2000));
    if (u.protocol !== "https:" || !EXTERNAL_HOSTS.includes(u.hostname)) fail("That link isn't on the allowed list.");
    return shell.openExternal(u.href);
  });

  /** Adds a subscriber through a perchlight-list site's own double opt-in. */
  handle("list:subscribe", async ({ siteUrl, email, source }) => {
    const base = new URL(str(siteUrl, "siteUrl", 300));
    if (base.protocol !== "https:") fail("The list's site address should start with https://");
    const res = await fetch(new URL("/api/subscribe", base), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email: str(email, "email", 254), source: optStr(source, "source", 40) ?? "admin" }),
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) fail(data.message || `HTTP ${res.status}`);
    return data.message;
  });
}
