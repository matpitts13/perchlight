// Cloudflare REST API client, one per project. Every call is scoped to the
// project's account; tokens come from the encrypted store and never reach
// the app's window.
import { getProject, getSecret } from "./store.js";
import { freshOAuthToken } from "./auth.js";

const API = "https://api.cloudflare.com/client/v4";

/** The bearer token for a project (refreshing a sign-in token if needed). */
async function tokenFor(project, { forceRefresh = false } = {}) {
  const secret = getSecret(project.id);
  if (!secret) throw new SignedOutError();
  if (project.auth === "oauth") return freshOAuthToken(project.id, secret, { force: forceRefresh });
  return secret.token;
}

export class SignedOutError extends Error {
  constructor() {
    super("Signed out of Cloudflare for this project. Sign in again from Projects.");
    this.signedOut = true;
  }
}

/** A raw request with a given token (used before a project exists, when checking a token). */
export async function requestWithToken(token, method, route, { body } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  let payload = body;
  if (body !== undefined && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(API + route, { method, headers, body: payload, signal: AbortSignal.timeout(30000) });
  return res;
}

async function parse(res) {
  const data = await res.json().catch(() => null);
  if (!data || !data.success) {
    const msg = data?.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
    const err = new Error(`Cloudflare: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Accounts a token can see. */
export async function listAccounts(token) {
  const res = await requestWithToken(token, "GET", "/accounts?per_page=50");
  if (res.status === 401 || res.status === 403) throw new Error("Cloudflare didn't accept that token. Check it was copied in full and hasn't been revoked.");
  const data = await parse(res);
  return data.result.map((a) => ({ id: a.id, name: a.name }));
}

export function client(projectId) {
  const project = getProject(projectId);
  if (!project.accountId) throw new Error("This project has no Cloudflare account selected.");
  const acct = (route) => `/accounts/${project.accountId}${route}`;

  async function request(method, route, opts = {}, retried = false) {
    const token = await tokenFor(project, { forceRefresh: retried });
    const res = await requestWithToken(token, method, route, opts);
    if (res.status === 401 && project.auth === "oauth" && !retried) return request(method, route, opts, true);
    if (res.status === 401) throw new SignedOutError();
    if (opts.raw) {
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Cloudflare ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return res.text();
    }
    return parse(res);
  }

  return {
    async kvNamespaces() {
      const out = [];
      for (let page = 1; page <= 20; page++) {
        const d = await request("GET", acct(`/storage/kv/namespaces?per_page=100&page=${page}`));
        out.push(...d.result.map((n) => ({ id: n.id, title: n.title })));
        if (d.result.length < 100) break;
      }
      return out;
    },

    async kvKeys(ns, prefix = "", { limit = 10000 } = {}) {
      const keys = [];
      let cursor = "";
      do {
        const q = new URLSearchParams({ limit: "1000" });
        if (prefix) q.set("prefix", prefix);
        if (cursor) q.set("cursor", cursor);
        const d = await request("GET", acct(`/storage/kv/namespaces/${encodeURIComponent(ns)}/keys?${q}`));
        keys.push(...d.result.map((k) => ({ name: k.name, expiration: k.expiration ?? null, metadata: k.metadata ?? null })));
        cursor = d.result_info?.cursor || "";
      } while (cursor && keys.length < limit);
      return { keys: keys.slice(0, limit), truncated: Boolean(cursor) };
    },

    kvGet(ns, key) {
      return request("GET", acct(`/storage/kv/namespaces/${encodeURIComponent(ns)}/values/${encodeURIComponent(key)}`), { raw: true });
    },

    /** { key: text | null } for many keys: bulk endpoint, else one GET each. */
    async kvGetMany(ns, keys) {
      const out = {};
      for (let i = 0; i < keys.length; i += 100) {
        const chunk = keys.slice(i, i + 100);
        try {
          const d = await request("POST", acct(`/storage/kv/namespaces/${encodeURIComponent(ns)}/bulk/get`), { body: { keys: chunk, type: "text" } });
          Object.assign(out, d.result.values);
        } catch (err) {
          // Only fall back for "this endpoint/request isn't supported"; rate
          // limits, permissions and sign-in problems are real errors.
          if (err.signedOut || ![400, 404, 405].includes(err.status)) throw err;
          let next = 0;
          const worker = async () => {
            while (next < chunk.length) {
              const k = chunk[next++];
              out[k] = await this.kvGet(ns, k);
            }
          };
          await Promise.all(Array.from({ length: 6 }, worker));
        }
      }
      return out;
    },

    /** Writes a value, keeping the given expiration and metadata (pass the key's current ones). */
    async kvPut(ns, key, value, expiration = null, metadata = null) {
      const form = new FormData();
      form.set("value", value);
      form.set("metadata", JSON.stringify(metadata ?? {})); // "{}" = no metadata, as Cloudflare expects the field
      const q = expiration ? `?expiration=${Number(expiration)}` : "";
      await request("PUT", acct(`/storage/kv/namespaces/${encodeURIComponent(ns)}/values/${encodeURIComponent(key)}${q}`), { body: form });
      return true;
    },

    async kvDelete(ns, key) {
      await request("DELETE", acct(`/storage/kv/namespaces/${encodeURIComponent(ns)}/values/${encodeURIComponent(key)}`));
      return true;
    },

    async d1Databases() {
      const d = await request("GET", acct("/d1/database?per_page=100"));
      return d.result.map((db) => ({ id: db.uuid, name: db.name }));
    },

    /** Runs SQL; one { results, meta } per statement. */
    async d1Query(db, sql, params = []) {
      // SQLite has no true/false: send 1/0, as Workers' D1 binding does.
      const bound = params.map((p) => (p === true ? 1 : p === false ? 0 : p));
      const d = await request("POST", acct(`/d1/database/${encodeURIComponent(db)}/query`), { body: { sql, params: bound } });
      return d.result.map((r) => ({ results: r.results || [], meta: r.meta || {} }));
    },
  };
}
