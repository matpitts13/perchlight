// Signing in to Cloudflare.
//
// 1. API token (always available): the user creates a token on Cloudflare's
//    site (we open the page with the right permissions filled in), pastes it,
//    and we check it by listing the accounts it can see.
// 2. "Sign in with Cloudflare" (OAuth, authorization code + PKCE, loopback
//    redirect): needs this app's own OAuth client registered with Cloudflare
//    (free, but the project maintainer must register it on a verified domain).
//    Until oauth-config.json has a client id, the button is hidden and the app
//    says so. NOT YET TESTED against Cloudflare: see the README.
import { shell } from "electron";
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { setSecret } from "./store.js";

const OAUTH = JSON.parse(fs.readFileSync(fileURLToPath(new URL("./oauth-config.json", import.meta.url)), "utf8"));

/** The token page, with Perchlight's permissions filled in. If Cloudflare
 *  ignores the template, the README lists the permissions to pick by hand. */
export const TOKEN_TEMPLATE_URL =
  "https://dash.cloudflare.com/profile/api-tokens?" +
  new URLSearchParams({
    permissionGroupKeys: JSON.stringify([
      { key: "account_settings", type: "read" },
      { key: "workers_kv_storage", type: "edit" },
      { key: "d1", type: "edit" },
    ]),
    name: "Perchlight",
  });

export function oauthAvailable() {
  return Boolean(OAUTH.clientId);
}

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Listens on the first free registered port for the browser's redirect. */
function listen(state) {
  return new Promise((resolve, reject) => {
    const ports = [...OAUTH.ports];
    const tryNext = () => {
      const port = ports.shift();
      if (!port) return reject(new Error("Couldn't open a local port for sign-in (all of the registered ports are in use)."));
      let settle;
      const result = new Promise((res, rej) => (settle = { res, rej }));
      const page = (msg) => `<!doctype html><meta charset="utf-8"><title>Perchlight</title><body style="font-family:system-ui;padding:40px">${msg}</body>`;
      const server = http.createServer((req, res) => {
        const url = new URL(req.url, `http://127.0.0.1:${port}`);
        // Anything that isn't Cloudflare's redirect for THIS sign-in (wrong
        // path or state) is refused, and the sign-in keeps waiting: another
        // web page can't cancel it by poking the port.
        if (url.pathname !== "/oauth/callback" || url.searchParams.get("state") !== state) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(page("Not a Perchlight sign-in."));
          return;
        }
        const code = url.searchParams.get("code");
        res.writeHead(code ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(page(code ? "Signed in. You can close this tab and go back to Perchlight." : "Sign-in didn't complete. Go back to Perchlight and try again."));
        server.close();
        if (code) settle.res(code);
        else settle.rej(new Error(url.searchParams.get("error_description") || url.searchParams.get("error") || "Sign-in was cancelled."));
      });
      result.catch(() => {}); // handled by the caller; avoids an unhandled rejection before it attaches
      server.once("error", (err) => (err.code === "EADDRINUSE" ? tryNext() : reject(err)));
      server.listen(port, "127.0.0.1", () => resolve({ port, code: result, close: () => server.close() }));
    };
    tryNext();
  });
}

async function tokenRequest(params) {
  const res = await fetch(OAUTH.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: OAUTH.clientId, ...params }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Cloudflare sign-in failed: ${data.error_description || data.error || `HTTP ${res.status}`}`);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
}

/** Runs the browser sign-in. Resolves to { accessToken, refreshToken, expiresAt }. */
export async function signInWithBrowser() {
  if (!oauthAvailable()) throw new Error("Sign in with Cloudflare isn't set up in this build yet. Use an API token.");
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const server = await listen(state);
  // A loopback IP literal, not "localhost" (RFC 8252 §7.3): the server listens
  // on 127.0.0.1, and "localhost" can resolve to IPv6 first.
  const redirectUri = `http://127.0.0.1:${server.port}/oauth/callback`;
  const url = `${OAUTH.authorizeUrl}?${new URLSearchParams({
    response_type: "code",
    client_id: OAUTH.clientId,
    redirect_uri: redirectUri,
    scope: OAUTH.scopes.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  })}`;
  let timer;
  const timeout = new Promise((_, rej) => (timer = setTimeout(() => rej(new Error("Sign-in timed out. Try again.")), 5 * 60 * 1000)));
  try {
    await shell.openExternal(url);
    const code = await Promise.race([server.code, timeout]);
    return await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier });
  } finally {
    clearTimeout(timer);
    server.close();
  }
}

const refreshing = new Map(); // projectId -> in-flight refresh, so parallel calls share one

/** A valid access token for an OAuth project, refreshing (and saving) it when needed. */
export async function freshOAuthToken(projectId, secret, { force = false } = {}) {
  if (!force && secret.expiresAt - 60_000 > Date.now()) return secret.accessToken;
  if (!secret.refreshToken) throw Object.assign(new Error("Your Cloudflare sign-in has expired. Sign in again from Projects."), { signedOut: true });
  if (!refreshing.has(projectId)) {
    refreshing.set(
      projectId,
      (async () => {
        try {
          const fresh = await tokenRequest({ grant_type: "refresh_token", refresh_token: secret.refreshToken });
          const merged = { ...fresh, refreshToken: fresh.refreshToken ?? secret.refreshToken };
          setSecret(projectId, merged);
          return merged.accessToken;
        } catch (err) {
          throw Object.assign(new Error(`Your Cloudflare sign-in couldn't be renewed. Sign in again from Projects. (${err.message})`), { signedOut: true });
        } finally {
          refreshing.delete(projectId);
        }
      })(),
    );
  }
  return refreshing.get(projectId);
}
