// The built-in screen for a perchlight-list mailing list: subscribers,
// blocked/allowed domains, and announcements. Everything is plain SQL on the
// list's D1 database; sending is done by the perchlight-list Worker itself
// (this app never holds your email service's key).
import { h, act, modal, confirmBox, confirmChange, table, stats, chips, badge, fmt, sqlDate, searchBox, plural, toast } from "../ui.js";
import { state, cf, viewHeader, show } from "../state.js";
import { markdownToHtml, escapeHtml } from "../../shared/markdown.js";
import { toCsv } from "../../shared/csv.js";

const BLOCK_REASONS = ["BURNER-EMAIL", "SPAM", "ABUSE", "BOUNCED", "REQUESTED"];
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z0-9-]{2,}$/;
const STATUS_KIND = { confirmed: "good", pending: "warn", unsubscribed: "bad", bounced: "bad", complained: "bad" };
const ROW_CAP = 5000;

export async function viewList(root, view) {
  const tab = state.ui[`list:${view.id}`] ?? "subscribers";
  const q = (sql, params) => cf("d1Query", view.database, sql, params);
  const tabs = chips([["subscribers", "Subscribers"], ["announcements", "Announcements"], ["domains", "Blocked domains"]], tab, (t) => ((state.ui[`list:${view.id}`] = t), show(state.view)));
  const ctx = { view, q, refresh: () => show(state.view) };
  if (tab === "announcements") return announcements(root, ctx, tabs);
  if (tab === "domains") return domains(root, ctx, tabs);
  return subscribers(root, ctx, tabs);
}

// --- Subscribers -------------------------------------------------------------

async function subscribers(root, { view, q, refresh }, tabs) {
  // Counts come from the database; rows are capped so big lists stay fast.
  const [[res], [totals]] = await Promise.all([
    q(
      `SELECT id, email, status, source, created_at, confirmed_at, unsubscribed_at, confirm_sent_at, confirm_sends, block_reason, blocked_at
       FROM subscribers ORDER BY id DESC LIMIT ?1`,
      [ROW_CAP],
    ),
    q("SELECT status, COUNT(*) AS n, SUM(block_reason IS NOT NULL) AS blocked FROM subscribers GROUP BY status"),
  ]);
  const all = res.results;
  const byStatus = Object.fromEntries(totals.results.map((r) => [r.status, r.n]));
  const count = (s) => byStatus[s] ?? 0;
  const totalRows = totals.results.reduce((s, r) => s + r.n, 0);
  const blockedTotal = totals.results.reduce((s, r) => s + (r.blocked ?? 0), 0);
  let filter = state.ui[`lf:${view.id}`] ?? "all";
  let query = "";
  const body = h("div");

  const blockButtons = (r) => {
    if (!r.block_reason) {
      return h("button", {
        class: "small danger-text",
        onclick: async () => {
          const reason = await askReason(`Block ${r.email}?`, "They're unsubscribed now and can never be put back on the list by signing up or confirming. No email is sent.", "SPAM");
          if (!reason) return;
          if (!(await confirmChange({ title: `Block ${r.email}?`, before: r.status, after: `unsubscribed · blocked: ${reason}`, confirm: "Block", danger: true }))) return;
          if (await act(() => q(`UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = COALESCE(unsubscribed_at, datetime('now')), block_reason = ?1, blocked_at = datetime('now') WHERE id = ?2`, [reason, r.id]), "Blocked")) refresh();
        },
      }, "Block…");
    }
    return h("button", {
      class: "small",
      onclick: async () => {
        if (!(await confirmBox(`Unblock ${r.email}?`, "They stay unsubscribed: to rejoin they'd sign up and confirm again. If their domain is blocked, signing up blocks them again.", "Unblock", false))) return;
        if (await act(() => q("UPDATE subscribers SET block_reason = NULL, blocked_at = NULL WHERE id = ?1", [r.id]), "Unblocked")) refresh();
      },
    }, "Unblock");
  };

  const setStatus = async (r, status) => {
    if (status === r.status) return;
    const body = status === "confirmed" ? "Only do this if they really asked to join (for example, they confirmed some other way)." : "";
    if (!(await confirmBox(`Mark ${r.email} as ${status}?`, body, "Change", status !== "confirmed"))) return refresh();
    if (
      await act(
        () =>
          q(
            `UPDATE subscribers SET status = ?1,
               confirmed_at = CASE ?1 WHEN 'confirmed' THEN COALESCE(confirmed_at, datetime('now')) WHEN 'pending' THEN NULL ELSE confirmed_at END,
               unsubscribed_at = CASE ?1 WHEN 'unsubscribed' THEN datetime('now') ELSE NULL END
             WHERE id = ?2 AND block_reason IS NULL`,
            [status, r.id],
          ),
        "Updated",
      )
    ) refresh();
  };

  const filtered = () => {
    const s = query.toLowerCase();
    const match = (r) => (filter === "all" ? true : filter === "blocked" ? Boolean(r.block_reason) : r.status === filter);
    return all.filter((r) => match(r) && (!s || r.email.toLowerCase().includes(s) || (r.source || "").toLowerCase().includes(s) || (r.block_reason || "").toLowerCase().includes(s)));
  };

  const filterChips = h("div");
  const draw = () => {
    filterChips.replaceChildren(chips(["all", "confirmed", "pending", "unsubscribed", "bounced", "complained", "blocked"], filter, (f) => ((filter = f), (state.ui[`lf:${view.id}`] = f), draw())));
    body.replaceChildren(
      table(
        [
          { label: "Email", render: (r) => r.email },
          {
            label: "Status",
            render: (r) =>
              r.block_reason
                ? h("span", { title: `Blocked ${fmt(sqlDate(r.blocked_at))}; always unsubscribed` }, badge(r.block_reason, "bad"), " ", h("small", { class: "muted" }, "unsubscribed"))
                : ["bounced", "complained"].includes(r.status)
                  ? badge(r.status, "bad")
                  : h(
                      "select",
                      { class: `status-select ${r.status}`, "aria-label": `Status of ${r.email}`, onchange: (e) => setStatus(r, e.target.value) },
                      ["pending", "confirmed", "unsubscribed"].map((s) => {
                        const o = h("option", { value: s }, s);
                        o.selected = s === r.status;
                        return o;
                      }),
                    ),
          },
          { label: "Source", render: (r) => r.source || "—" },
          { label: "Signed up", render: (r) => fmt(sqlDate(r.created_at)) },
          { label: "Confirmed", render: (r) => fmt(sqlDate(r.confirmed_at)) },
          { label: "Confirm emails", render: (r) => h("span", { title: r.confirm_sent_at ? `Last sent ${fmt(sqlDate(r.confirm_sent_at))}` : "" }, r.confirm_sends ? `${r.confirm_sends} sent` : "none") },
          {
            label: "",
            class: "row-actions",
            render: (r) => {
              // Blocked, bounced and complained rows are what keeps those
              // addresses from being emailed again: they can't be deleted here.
              const protectedRow = Boolean(r.block_reason) || ["bounced", "complained"].includes(r.status);
              return [
                blockButtons(r),
                protectedRow
                  ? h("button", { class: "small", disabled: true, title: "Kept so this address is never emailed again. Unblock first if you really need to remove it." }, "Delete")
                  : h("button", {
                      class: "small danger-text",
                      onclick: async () => {
                        if (!(await confirmBox(`Delete ${r.email}?`, "Removes them and their announcement history entirely. To keep a record that they opted out, mark them unsubscribed instead."))) return;
                        const done = await act(async () => {
                          // deliveries are removed with them (ON DELETE CASCADE)
                          const [d] = await q("DELETE FROM subscribers WHERE id = ?1 AND block_reason IS NULL AND status NOT IN ('bounced', 'complained')", [r.id]);
                          if (!d.meta.changes) throw new Error("Not deleted: they were blocked, bounced or complained meanwhile.");
                        }, "Deleted");
                        if (done) refresh();
                      },
                    }, "Delete"),
              ];
            },
          },
        ],
        filtered(),
        "No subscribers match.",
      ),
    );
  };

  const addBtn = view.siteUrl
    ? h("button", {
        class: "primary",
        onclick: async () => {
          const res = await modal({
            title: "Add a subscriber",
            body: "Goes through your list's double opt-in: they get a confirmation email and join once they click it.",
            fields: [
              { name: "email", label: "Email", type: "email", required: true },
              { name: "source", label: "Source (letters, digits, dashes)", value: "admin" },
            ],
            confirm: "Send invite",
          });
          if (!res) return;
          const source = res.source.trim().toLowerCase().replace(/[^a-z0-9-]/g, "") || "admin";
          try {
            toast(await window.api.subscribe(view.siteUrl, res.email.trim(), source));
            refresh();
          } catch (err) {
            const message = String(err?.message ?? err);
            const turnstile = /bot check/i.test(message);
            toast(turnstile ? "Your list has Turnstile turned on, which this app can't pass. Add them through your site's signup form instead." : message, "error");
          }
        },
      }, "+ Add")
    : null;

  const exportBtn = h("button", {
    class: "ghost",
    onclick: async () => {
      const rows = filtered();
      const cols = ["email", "status", "source", "created_at", "confirmed_at", "unsubscribed_at", "block_reason"];
      const saved = await act(() => window.api.saveText(`subscribers-${filter}.csv`, toCsv(rows, cols)));
      if (saved && saved !== true) toast(`Saved ${plural(rows.length, "row")}`);
    },
  }, "Export CSV");

  root.append(
    viewHeader(view.title, totalRows > all.length ? `Subscribers · newest ${all.length.toLocaleString()} of ${totalRows.toLocaleString()} shown (search and export cover those)` : "Subscribers", addBtn, exportBtn),
    tabs,
    h("div", { style: "height:14px" }),
    stats([
      ["total", totalRows],
      ["confirmed", count("confirmed"), "good"],
      ["pending", count("pending"), "warn"],
      ["unsubscribed", count("unsubscribed"), "bad"],
      ["bounced / complained", count("bounced") + count("complained"), "bad"],
      ["blocked", blockedTotal, "bad"],
    ]),
    h("div", { class: "toolbar" }, filterChips, searchBox("Search email, source or reason…", query, (v) => ((query = v), draw()))),
    body,
  );
  draw();
}

async function askReason(title, body, value) {
  const res = await modal({ title, body, fields: [{ name: "reason", label: "Reason", options: BLOCK_REASONS, other: true, value, required: true, placeholder: "e.g. SCRAPER" }], confirm: "Next" });
  if (!res) return null;
  return res.reason.trim().toUpperCase().replace(/\s+/g, "-").replace(/[^A-Z0-9_-]/g, "").slice(0, 40) || null;
}

// --- Blocked / allowed domains -------------------------------------------------

async function domains(root, { view, q, refresh }, tabs) {
  const [[blocked], [allowed]] = await Promise.all([
    q("SELECT domain, reason, added_at FROM blocked_domains ORDER BY domain"),
    q("SELECT domain, added_at FROM allowed_domains ORDER BY domain"),
  ]);
  const askDomain = async (title, body, extra = []) => {
    const res = await modal({ title, body, fields: [{ name: "domain", label: "Domain", required: true, placeholder: "example.com" }, ...extra], confirm: "Next" });
    if (!res) return null;
    const domain = res.domain.trim().toLowerCase().replace(/^.*@/, "");
    if (!DOMAIN_RE.test(domain)) return toast(`“${domain}” isn't a domain like example.com.`, "error"), null;
    return { ...res, domain };
  };
  const like = (d) => [`%@${d}`, `%.${d}`];

  const addBlocked = h("button", {
    class: "small primary",
    onclick: async () => {
      const res = await askDomain("Block a domain", "Signups from it (and its subdomains) are refused, on top of the built-in list of disposable domains.", [{ name: "reason", label: "Reason", options: BLOCK_REASONS, other: true, value: "BURNER-EMAIL", required: true }]);
      if (!res) return;
      const reason = res.reason.trim().toUpperCase().replace(/\s+/g, "-").replace(/[^A-Z0-9_-]/g, "").slice(0, 40) || "BURNER-EMAIL";
      const found = await act(() => q("SELECT id, email FROM subscribers WHERE block_reason IS NULL AND (lower(email) LIKE ?1 OR lower(email) LIKE ?2)", like(res.domain)));
      if (!found || found === true) return;
      const hits = found[0].results;
      if (!(await confirmChange({ title: `Block ${res.domain}?`, body: hits.length ? `This also blocks ${plural(hits.length, "existing subscriber")} on it: they're unsubscribed and tagged ${reason}.` : "No existing subscribers use it.", after: [`${res.domain} → ${reason}`, ...hits.map((x) => `  ${x.email}`)].join("\n"), confirm: "Block", danger: true }))) return;
      const ok = await act(async () => {
        await q("INSERT INTO blocked_domains (domain, reason) VALUES (?1, ?2) ON CONFLICT(domain) DO UPDATE SET reason = excluded.reason", [res.domain, reason]);
        if (hits.length) await q(`UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = COALESCE(unsubscribed_at, datetime('now')), block_reason = ?1, blocked_at = datetime('now') WHERE block_reason IS NULL AND (lower(email) LIKE ?2 OR lower(email) LIKE ?3)`, [reason, ...like(res.domain)]);
      }, `Blocked ${res.domain}`);
      if (ok) refresh();
    },
  }, "+ Block domain");

  const addAllowed = h("button", {
    class: "small",
    onclick: async () => {
      const res = await askDomain("Allow a domain", "For a real email provider that the built-in disposable list blocks by mistake. Domains you blocked yourself stay blocked.");
      if (!res) return;
      if (await act(() => q("INSERT OR IGNORE INTO allowed_domains (domain) VALUES (?1)", [res.domain]), `Allowed ${res.domain}`)) refresh();
    },
  }, "+ Allow domain");

  const remove = (tableName, domain, note) =>
    h("button", {
      class: "small danger-text",
      onclick: async () => {
        if (!(await confirmBox(`Remove ${domain}?`, note))) return;
        if (await act(() => q(`DELETE FROM ${tableName === "blocked" ? "blocked_domains" : "allowed_domains"} WHERE domain = ?1`, [domain]), `Removed ${domain}`)) refresh();
      },
    }, "Remove");

  root.append(
    viewHeader(view.title, "Blocked and allowed domains"),
    tabs,
    h("div", { class: "console-head spaced" }, h("h2", {}, "Blocked domains"), addBlocked),
    table(
      [
        { label: "Domain", render: (d) => d.domain },
        { label: "Reason", render: (d) => badge(d.reason, "bad") },
        { label: "Added", render: (d) => fmt(sqlDate(d.added_at)) },
        { label: "", class: "row-actions", render: (d) => remove("blocked", d.domain, "New signups from it are allowed again. People already blocked stay blocked.") },
      ],
      blocked.results,
      "None yet. Disposable domains are already blocked by the built-in list.",
    ),
    h("div", { class: "console-head spaced" }, h("h2", {}, "Allowed domains"), addAllowed),
    table(
      [
        { label: "Domain", render: (d) => d.domain },
        { label: "Added", render: (d) => fmt(sqlDate(d.added_at)) },
        { label: "", class: "row-actions", render: (d) => remove("allowed", d.domain, "The built-in disposable list applies to it again.") },
      ],
      allowed.results,
      "None.",
    ),
  );
}

// --- Announcements -------------------------------------------------------------

const STATUS_BADGE = { draft: "neutral", queued: "warn", sending: "warn", paused: "bad", sent: "good", cancelled: "neutral" };

async function announcements(root, ctx, tabs) {
  const { view, q, refresh } = ctx;
  const [[anns], [counts], [confirmed]] = await Promise.all([
    q("SELECT id, subject, status, last_error, created_at, queued_at, finished_at FROM announcements ORDER BY id DESC LIMIT 200"),
    q("SELECT announcement_id AS id, status, COUNT(*) AS n FROM deliveries GROUP BY announcement_id, status"),
    q("SELECT COUNT(*) AS n FROM subscribers WHERE status = 'confirmed' AND block_reason IS NULL"),
  ]);
  const byAnn = new Map();
  for (const c of counts.results) {
    if (!byAnn.has(c.id)) byAnn.set(c.id, {});
    byAnn.get(c.id)[c.status] = c.n;
  }
  const audience = confirmed.results[0].n;

  const progress = (a) => {
    const c = byAnn.get(a.id) ?? {};
    const total = Object.values(c).reduce((s, n) => s + n, 0);
    if (!total) return h("span", { class: "muted" }, a.status === "draft" ? "not queued" : "—");
    const done = (c.sent ?? 0) + (c.skipped ?? 0) + (c.failed ?? 0) + (c.unknown ?? 0);
    const parts = [`${c.sent ?? 0} sent`, c.pending || c.claimed || c.sending ? `${(c.pending ?? 0) + (c.claimed ?? 0) + (c.sending ?? 0)} waiting` : null, c.skipped ? `${c.skipped} skipped` : null, c.failed ? `${c.failed} failed` : null, c.unknown ? `${c.unknown} unknown` : null].filter(Boolean);
    return h("div", { style: "min-width:220px" }, h("div", { class: "progress", "aria-hidden": "true" }, h("span", { style: `width:${Math.round((done / total) * 100)}%` })), h("small", { class: "muted" }, parts.join(" · ")));
  };

  const rowActions = (a) => {
    const c = byAnn.get(a.id) ?? {};
    const btn = (label, fn, cls = "small") => h("button", { class: cls, onclick: fn }, label);
    const out = [];
    if (a.status === "draft") {
      out.push(btn("Edit", () => compose(ctx, a)), btn("Send test…", () => sendTest(ctx, a)), btn("Queue for everyone", () => queueAll(ctx, a, audience), "small primary"));
      out.push(btn("Delete", async () => (await confirmBox(`Delete “${a.subject}”?`, "The draft is removed.")) && (await act(() => q("DELETE FROM announcements WHERE id = ?1 AND status = 'draft'", [a.id]), "Deleted")) && refresh(), "small danger-text"));
    }
    if (a.status === "paused") out.push(btn("Resume", async () => (await act(() => q("UPDATE announcements SET status = 'sending', last_error = NULL WHERE id = ?1 AND status = 'paused'", [a.id]), "Resumed; sending continues within a minute")) && refresh(), "small primary"));
    if (["queued", "sending", "paused"].includes(a.status)) {
      out.push(btn("Cancel", async () => (await confirmBox(`Cancel “${a.subject}”?`, "Emails already sent stay sent; nobody else gets it.", "Cancel sending")) && (await act(() => q("UPDATE announcements SET status = 'cancelled', finished_at = datetime('now') WHERE id = ?1 AND status IN ('queued', 'sending', 'paused')", [a.id]), "Cancelled")) && refresh(), "small danger-text"));
    }
    if (c.unknown && a.status !== "cancelled") {
      out.push(
        btn(`Resend to ${c.unknown} unknown…`, async () => {
          const ok = await confirmBox(
            `Resend to ${plural(c.unknown, "person")} whose email may not have gone out?`,
            "Their send ended without a clear result (a timeout or crash), so some of them may already have it. Check your email service's logs first if you can. They're re-checked before sending, so anyone who unsubscribed is skipped.",
            "Re-queue them",
            false,
          );
          // A fresh start for each row: attempts, batching and the old error are reset.
          const sql = `UPDATE deliveries SET status = 'pending', claim_id = NULL, claimed_at = NULL, send_started_at = NULL,
                         attempts = 0, solo = 0, idempotent_send = 0, error = NULL
                       WHERE announcement_id = ?1 AND status = 'unknown'`;
          if (ok && (await act(() => q(sql, [a.id]), "Re-queued; the Worker picks them up within a minute"))) refresh();
        }),
      );
    }
    out.push(btn("View", () => previewDialog(a.id, ctx)));
    return out;
  };

  root.append(
    viewHeader(view.title, `Announcements · ${plural(audience, "confirmed subscriber")}`, h("button", { class: "primary", onclick: () => compose(ctx) }, "+ New announcement")),
    tabs,
    h("p", { class: "muted", style: "margin:12px 0" }, "Your perchlight-list Worker sends queued announcements in the background (every minute, within its daily limit). This app only writes the queue: it never holds your email service's key."),
    anns.results.some((a) => a.status === "paused") && h("div", { class: "error-box", style: "margin-bottom:14px" }, h("h3", {}, "Paused"), anns.results.filter((a) => a.status === "paused").map((a) => h("p", {}, h("b", {}, a.subject), ": ", a.last_error || "paused"))),
    table(
      [
        { label: "Subject", render: (a) => h("b", {}, a.subject) },
        { label: "Status", render: (a) => badge(a.status, STATUS_BADGE[a.status]) },
        { label: "Progress", render: progress },
        { label: "Created", render: (a) => fmt(sqlDate(a.created_at)) },
        { label: "", class: "row-actions", render: rowActions },
      ],
      anns.results,
      "No announcements yet.",
    ),
  );
}

/** Write or edit a draft. Body is Markdown; text and HTML versions are both stored. */
async function compose({ q, refresh }, existing = null) {
  let body = existing ? (await q("SELECT body_text FROM announcements WHERE id = ?1", [existing.id]))[0].results[0]?.body_text ?? "" : "";
  const res = await modal({
    title: existing ? "Edit announcement" : "New announcement",
    body: "Write in plain text. Simple formatting works: # Heading, **bold**, *italic*, - lists and [links](https://…). Your list's footer (unsubscribe link and postal address) is added automatically.",
    fields: [
      { name: "subject", label: "Subject", value: existing?.subject ?? "", required: true },
      { name: "body", label: "Message", multiline: true, rows: 16, prose: true, spellcheck: true, value: body, required: true },
    ],
    confirm: existing ? "Save draft" : "Save as draft",
    wide: true,
  });
  if (!res) return;
  const html = markdownToHtml(res.body);
  const ok = existing
    ? await act(() => q("UPDATE announcements SET subject = ?1, body_text = ?2, body_html = ?3 WHERE id = ?4 AND status = 'draft'", [res.subject.trim(), res.body, html, existing.id]), "Draft saved")
    : await act(() => q("INSERT INTO announcements (subject, body_text, body_html) VALUES (?1, ?2, ?3)", [res.subject.trim(), res.body, html]), "Draft saved");
  if (ok) refresh();
}

async function previewDialog(id, { q }) {
  const [res] = await q("SELECT subject, body_text, body_html FROM announcements WHERE id = ?1", [id]);
  const a = res.results[0];
  if (!a) return;
  const frame = h("iframe", { class: "preview", sandbox: "", title: "Email preview" });
  frame.srcdoc = `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:24px;font-family:Arial,sans-serif;color:#1c1917;background:#fff">${a.body_html || `<p>${escapeHtml(a.body_text).replace(/\n/g, "<br>")}</p>`}<p style="font-size:12px;color:#78716c;margin-top:24px">[Your list's footer: unsubscribe link and postal address]</p></body>`;
  await modal({ title: a.subject, content: frame, confirm: "Close", cancel: null, wide: true });
}

/** Sends a copy to chosen confirmed subscribers (e.g. yourself) as a separate "[Test]" announcement. */
async function sendTest({ q, refresh }, a) {
  const res = await modal({
    title: "Send a test",
    body: "Sends a copy marked [Test] to the addresses you list, as its own announcement, so the real one isn't affected. They must be confirmed subscribers (sign yourself up first).",
    fields: [{ name: "emails", label: "Email addresses (comma or new line separated)", multiline: true, rows: 3, required: true }],
    confirm: "Next",
  });
  if (!res) return;
  const emails = [...new Set(res.emails.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  const [found] = await q("SELECT id, email FROM subscribers WHERE status = 'confirmed' AND block_reason IS NULL AND email IN (SELECT value FROM json_each(?1))", [JSON.stringify(emails)]);
  const ids = found.results.map((r) => r.id);
  const missing = emails.filter((e) => !found.results.some((r) => r.email.toLowerCase() === e));
  if (!ids.length) return toast(`None of those are confirmed subscribers: ${missing.join(", ")}`, "error");
  if (!(await confirmBox(`Send a test to ${ids.length} ${ids.length === 1 ? "address" : "addresses"}?`, `${found.results.map((r) => r.email).join(", ")}${missing.length ? `\n\nSkipped (not confirmed subscribers): ${missing.join(", ")}` : ""}`, "Send test", false))) return;
  const ok = await act(async () => {
    const [ins] = await q("INSERT INTO announcements (subject, body_text, body_html) SELECT '[Test] ' || subject, body_text, body_html FROM announcements WHERE id = ?1 RETURNING id", [a.id]);
    const testId = ins.results[0].id;
    try {
      // Deliveries first, then queue: the Worker ignores drafts.
      await q("INSERT OR IGNORE INTO deliveries (announcement_id, subscriber_id) SELECT ?1, value FROM json_each(?2)", [testId, JSON.stringify(ids)]);
      await q("UPDATE announcements SET status = 'queued', queued_at = datetime('now') WHERE id = ?1", [testId]);
    } catch (err) {
      // Don't leave a half-made "[Test]" draft behind that could be queued for everyone.
      await q("DELETE FROM announcements WHERE id = ?1 AND status = 'draft'", [testId]).catch(() => {});
      throw err;
    }
  }, "Test queued; it goes out within a minute");
  if (ok) refresh();
}

async function queueAll({ q, refresh }, a, audience) {
  if (!audience) return toast("No confirmed subscribers yet.", "error");
  if (!(await confirmBox(`Send “${a.subject}” to ${plural(audience, "confirmed subscriber")}?`, "Your list's Worker sends it in the background, within its daily limit. Anyone who unsubscribes before their copy goes out is skipped. You can cancel it at any time.", "Queue it", false))) return;
  const ok = await act(async () => {
    // Deliveries first while it's still a draft (the Worker ignores drafts), then queue.
    await q(
      `INSERT OR IGNORE INTO deliveries (announcement_id, subscriber_id)
       SELECT ?1, id FROM subscribers WHERE status = 'confirmed' AND block_reason IS NULL
         AND EXISTS (SELECT 1 FROM announcements WHERE id = ?1 AND status = 'draft')`,
      [a.id],
    );
    const [u] = await q("UPDATE announcements SET status = 'queued', queued_at = datetime('now') WHERE id = ?1 AND status = 'draft'", [a.id]);
    if (!u.meta.changes) throw new Error("It's no longer a draft (already queued, sent or cancelled). Refresh to see where it is.");
  }, "Queued; sending starts within a minute");
  if (ok) refresh();
}

export const _forTests = { STATUS_KIND };
