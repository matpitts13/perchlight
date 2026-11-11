# SDD: Perchlight

**Version:** 1.1
**Date:** 2026-11-09
**Status:** Active (v0.1 built for both repos; see "Build notes" at the end)

## Summary

Perchlight is a free, open-source (MIT) set of tools for people who run small sites and apps on Cloudflare. It has three parts:

1. **`perchlight`**: a desktop app for Windows, Mac and Linux for viewing and editing your Cloudflare data (Workers KV, D1) across several sites. Its screens are built from a config file, which you can make with a form, upload, or have an AI agent write.
2. **`perchlight-list`**: a mailing-list backend you deploy to your own Cloudflare account. It handles double opt-in signup, blocking, and announcement emails that follow the sending rules.
3. **`perchlight.ravenburst.com`**: a single free web page with downloads, the privacy policy and terms that the sign-in registration needs, and a working "get updates" form that runs on `perchlight-list`.

Both are general-purpose versions of tools built for Ravenburst. They contain nothing Ravenburst-specific: no license/trial system, no Ravenburst data, and no Ravenburst branding. Perchlight is not affiliated with or endorsed by Cloudflare.

## Requirements

### Must have

**perchlight (desktop app)**
- Sign in with a "Sign in with Cloudflare" button. Login hands back to the app on the user's computer (no password stored). Sign-in tokens are encrypted with the operating system's secure storage.
- Guided API-token sign-in as a backup: one click opens Cloudflare's token page with the right permissions filled in, the user pastes the token, and the app checks it before saving.
- **Projects (site picker):** each project has a name, a Cloudflare account, a sign-in, and its screens. A dropdown switches between projects, and different projects can use different Cloudflare accounts.
- KV browser (namespaces, keys with prefix filter, view/edit/delete values, expiration) and D1 browser (databases, tables, rows, SQL console), carried over from Ravenburst Admin.
- **Screen builder:** the user picks a KV prefix or a D1 table, the app reads up to 20 sample records, and it suggests columns (name, path, type). The user can rename, hide, reorder, mark columns editable, and add row actions such as "set field to value" or "delete". Changes save to the project's config.
- **Config file:** import and export a `perchlight.json`. A published JSON Schema (`schema/perchlight.schema.json`) describes the format, so people and AI agents can write the file themselves. Uploaded files are checked against the schema, and errors are shown with the path and the problem in plain language.
- **Built-in mailing-list screen** that works with `perchlight-list`: subscribers, a status filter, block and unblock, blocked and allowed domains, CSV export, and announcements (write, preview, send a test, queue for sending, see send progress).
- Every change to live data asks for confirmation first, and destructive actions (delete, bulk edits) need a second confirmation.
- Builds for Windows (NSIS installer), Mac (unsigned `.dmg`) and Linux (AppImage), produced by GitHub Actions on each version tag.
- An original icon (a bird on a perch with a lit window), not resembling Cloudflare's logo or the Ravenburst "R".

**perchlight-list (mailing-list backend)**
- A Cloudflare Worker with static assets and D1, deployable with Cloudflare's one-click "Deploy" button, plus `npm run deploy` for manual deploys.
- Signup (`POST /api/subscribe`), confirm, and unsubscribe, with the same privacy behaviour as Ravenburst: the reply never reveals whether an address is already on the list.
- Spam protection: Turnstile, a check that the email's domain has a mail server (MX), the bundled CC0 disposable-domain list with credit, hand-added blocked and allowed domains, and an hourly per-IP signup limit (stored as a hash, never the raw IP).
- **Swappable email services:** a small `EmailSender` interface with `resend` (the default, free tier) and `cloudflare` (Cloudflare Email Service, which needs a paid Workers plan) built in. The service is chosen with the `MAIL_PROVIDER` setting.
- **Announcements:**
  - Each announcement is stored in D1 by the admin app and sent by the Worker on a timer (cron trigger, every minute), in batches that stay under a configurable daily limit (`DAILY_SEND_LIMIT`, default 100 to match Resend's free tier).
  - Every announcement email includes:
    - a `List-Unsubscribe` header with an HTTPS link, plus a `mailto:` address when `UNSUBSCRIBE_MAILTO` is set
    - `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058)
    - a visible unsubscribe link
    - the sender's postal address (CAN-SPAM)
  - The Worker refuses to send announcements if `MAIL_POSTAL_ADDRESS` is missing.
  - Each recipient gets at most one copy of each announcement, enforced in the database.
  - **Bounces and spam complaints** arrive through a signature-checked webhook (`POST /api/webhooks/resend`). The address is marked `bounced` or `complained` and is never emailed again.
- Database migrations included, plus an example `.dev.vars` for secrets. No secret goes in `wrangler.toml`.

**Both repos**
- MIT license, `Copyright (c) 2026 <your name>`.
- A README with screenshots or a GIF, one-command setup, a "not affiliated with Cloudflare" notice, credits, and a responsibility note (people who run a list must follow anti-spam and privacy law).
- Tests and CI on every push, with a CI badge in the README.
- Fresh git history. No code is copied from repos that contain Ravenburst-specific history.

### Should have (if time allows)
- Ready-made screen templates beyond the mailing list, such as "KV feature flags" and "D1 users table".
- A demo GIF and a "try it in 2 minutes" walkthrough in the README.
- A dark/light theme that follows the operating system.

### Out of scope
- The license/trial server (it stays private to Ravenburst).
- Mac code signing and notarization (needs the $99/year Apple Developer program; can come later).
- Email open and click tracking, subscriber segments, A/B tests, a rich email designer.
- Cloudflare resources other than KV and D1 (R2, Queues, Durable Objects) in v1.
- A paid tier, accounts, or any server run by Perchlight beyond the one-page site.
- Moving the live Ravenburst site onto `perchlight-list` (Ravenburst keeps its own code; this can be revisited).

## Technical Design

### Data model changes

**perchlight-list D1 schema**, in fresh migrations based on the Ravenburst ones:

```sql
-- 0001_init.sql
CREATE TABLE subscribers (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  email            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','confirmed','unsubscribed','bounced','complained')),
  token            TEXT NOT NULL UNIQUE,          -- secret for confirm/unsubscribe links
  source           TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at     TEXT,
  unsubscribed_at  TEXT,
  confirm_sent_at  TEXT,
  confirm_sends    INTEGER NOT NULL DEFAULT 0,
  block_reason     TEXT,                          -- e.g. BURNER-EMAIL; NULL = not blocked
  blocked_at       TEXT
);
CREATE INDEX idx_subscribers_status ON subscribers (status);

CREATE TABLE signup_attempts (ip_hash TEXT, hour TEXT, attempts INTEGER NOT NULL DEFAULT 0,
                              PRIMARY KEY (ip_hash, hour));
CREATE TABLE blocked_domains (domain TEXT PRIMARY KEY COLLATE NOCASE,
                              reason TEXT NOT NULL DEFAULT 'BURNER-EMAIL',
                              added_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE allowed_domains (domain TEXT PRIMARY KEY COLLATE NOCASE,
                              added_at TEXT NOT NULL DEFAULT (datetime('now')));
-- Triggers: a blocked address must stay unsubscribed (same as Ravenburst 0003).

-- 0002_announcements.sql
CREATE TABLE announcements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  subject     TEXT NOT NULL,
  body_text   TEXT NOT NULL,       -- plain text, always sent
  body_html   TEXT,                -- optional; produced by the admin app
  status      TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','queued','sending','sent','cancelled')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  queued_at   TEXT,
  finished_at TEXT
);
CREATE TABLE deliveries (
  announcement_id  INTEGER NOT NULL REFERENCES announcements(id),
  subscriber_id    INTEGER NOT NULL REFERENCES subscribers(id),
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','claimed','sent','failed','skipped')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  claimed_at       TEXT,
  batch_key        TEXT,           -- also the email service's idempotency key (ADR 0002)
  provider_id      TEXT,           -- the email service's message id, used to match bounce webhooks
  error            TEXT,
  sent_at          TEXT,
  PRIMARY KEY (announcement_id, subscriber_id)   -- one copy per person per announcement
);
CREATE INDEX idx_deliveries_pending ON deliveries (status, announcement_id);
CREATE TABLE send_log_daily (day TEXT PRIMARY KEY, sent INTEGER NOT NULL DEFAULT 0);
```

**Queueing an announcement** happens in one transaction: the admin app sets `status='queued'` and inserts one `deliveries` row for each subscriber that is currently `confirmed` and not blocked. Anyone who unsubscribes later is skipped at send time (`status='skipped'`).

**perchlight app, local data.** This lives in Electron's `userData` folder. None of it is synced or sent anywhere.
- `projects.json`: the list of projects (id, name, account id, sign-in method, config path). It contains no tokens.
- Tokens are encrypted with Electron `safeStorage` and stored in `secrets.bin`, keyed by project id.
- `views/<projectId>.perchlight.json`: each project's screen config.

**`perchlight.json` format** (v1, checked against the published JSON Schema):

```json
{
  "$schema": "https://perchlight.ravenburst.com/schema/v1.json",
  "version": 1,
  "views": [
    {
      "id": "licenses",
      "title": "Licenses",
      "source": { "type": "kv", "namespace": "<namespace id>", "prefix": "devices:" },
      "keyPattern": "devices:{hash}",
      "columns": [
        { "label": "Code hash", "from": "key.hash" },
        { "label": "Devices", "from": "value.devices", "type": "count" },
        { "label": "Revoked", "from": "value.revoked", "type": "boolean", "editable": true }
      ],
      "actions": [
        { "label": "Revoke", "set": { "value.revoked": true }, "confirm": true }
      ]
    },
    {
      "id": "users",
      "title": "Users",
      "source": { "type": "d1", "database": "<database id>", "table": "users" },
      "columns": [
        { "label": "Email", "from": "email" },
        { "label": "Plan", "from": "plan", "type": "enum", "options": ["free","pro"], "editable": true }
      ],
      "actions": [ { "label": "Delete", "delete": true, "confirm": true } ]
    },
    { "id": "list", "title": "Mailing list", "preset": "perchlight-list", "database": "<database id>" }
  ]
}
```

Column types: `text`, `number`, `boolean`, `date`, `enum`, `count`, `json`. For D1 sources, actions run as parameterized `UPDATE`/`DELETE` statements against the row's primary key. They are never built by joining strings together.

### IPC / API surface

**Desktop app.** The renderer runs with context isolation and no Node access. It reaches the main process only through a fixed allowlist of channels exposed by `preload.js`:

| Channel | Payload | Returns |
|---|---|---|
| `auth:signIn` | `{ projectId }` | `{ accountId, accountName }`. Runs the browser sign-in with a one-time verification code (PKCE) and a loopback return address. |
| `auth:useToken` | `{ projectId, token }` | `{ accountId, accountName }`. Checks the token, then stores it encrypted. |
| `auth:signOut` | `{ projectId }` | `void` |
| `projects:list` / `projects:save` / `projects:delete` | project object / id | projects |
| `views:get` / `views:save` | `{ projectId, config? }` | config. `save` checks it against the schema first. |
| `views:import` / `views:export` | `{ projectId }` | Uses the system open/save dialog. Import returns the check result. |
| `views:sample` | `{ projectId, source }` | Up to 20 records plus suggested columns. |
| `kv:namespaces` `kv:keys` `kv:get` `kv:put` `kv:delete` | `{ projectId, ... }` | Same behaviour as Ravenburst Admin. |
| `d1:databases` `d1:query` | `{ projectId, db, sql, params }` | rows |
| `file:saveText` | `{ name, text }` | Save dialog, used for CSV export. |

The main process looks up the project's token and calls the Cloudflare REST API (`https://api.cloudflare.com/client/v4`). Tokens never reach the renderer.

**perchlight-list Worker endpoints:**

| Method and path | Purpose |
|---|---|
| `POST /api/subscribe` | Form or JSON `{ email, turnstileToken, source?, website? }`. `website` is a hidden field that only bots fill in. Always returns the same "check your email" reply. |
| `GET /api/confirm?token=` → page; `POST /api/confirm` | Two steps, so email security scanners that open links can't confirm someone by accident. |
| `GET /api/unsubscribe?token=` → page; `POST /api/unsubscribe` | The POST also accepts RFC 8058 one-click (`List-Unsubscribe=One-Click`) with no further steps. |
| `POST /api/webhooks/resend` | Checks the webhook signature, then handles `email.bounced` and `email.complained`. |
| `scheduled` (cron `* * * * *`) | Sends the next batch of pending deliveries, staying under the daily limit, and finalizes finished announcements. |

**Worker settings:**
- Variables: `LIST_NAME`, `SITE_URL`, `MAIL_FROM`, `MAIL_PROVIDER` (`resend` | `cloudflare`), `MAIL_POSTAL_ADDRESS`, `UNSUBSCRIBE_MAILTO` (optional), `DAILY_SEND_LIMIT`, `BATCH_SIZE`.
- Secrets: `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `TURNSTILE_SECRET_KEY`, `IP_SALT`.
- Bindings: `DB` (D1), plus `EMAIL` when using Cloudflare email.

### Component / module changes

New repos under `GitHubProjects/`:

```
perchlight/
  src/main/        main.js, auth/oauth.js, auth/token.js, store.js (projects + safeStorage),
                   cloudflare.js (from Ravenburst Admin, token source swapped), ipc.js (allowlist)
  src/preload.js
  src/renderer/    app shell, project picker, KV/D1 browsers, view renderer,
                   screen builder, mailing-list preset, announcement composer
  schema/          perchlight.schema.json (v1)
  site/            the one-page website (Cloudflare Pages): index, privacy, terms, schema/v1.json
  build/           icons
  test/            Vitest unit tests; Playwright Electron smoke test
  .github/workflows/  ci.yml (tests), release.yml (3-OS builds on tag)
  docs/SDD.md

perchlight-list/
  src/index.js           router + scheduled handler
  src/routes/            subscribe.js, confirm.js, unsubscribe.js, webhooks.js
  src/lib/               validate.js, turnstile.js, mx.js, blocking.js, tokens.js, pages.js
  src/lib/senders/       index.js (EmailSender interface), resend.js, cloudflare.js
  src/lib/announce.js    batch sending, headers, daily limit
  src/data/disposable-domains.js  (generated, CC0, credited)
  scripts/update-blocklist.mjs
  public/                example signup page + confirm/unsubscribe pages
  migrations/            0001_init.sql, 0002_announcements.sql
  test/                  Vitest with @cloudflare/vitest-pool-workers
  wrangler.jsonc, .dev.vars.example, README.md
```

Code that comes from Ravenburst (covered by the signed IP assignment):
- From Ravenburst Admin: `cloudflare.js` (with wrangler-token reading **removed**), the KV/D1 browser UI and the SQL console.
- From the Ravenburst website: the signup, confirm and unsubscribe logic, `blocking.js`, `mx.js`, `turnstile.js`, the blocklist generator, and the migrations.

### Edge cases
- **Expired or revoked sign-in:** when Cloudflare returns 401, the app refreshes the token once. If that fails, it marks the project "signed out" and shows a sign-in prompt without losing the current screen.
- **Several accounts on one sign-in:** the user picks the account per project. Calls always use that account id.
- **The sign-in return port is in use:** the app tries the registered ports in order (see Open questions).
- **Invalid or newer config files:** the check reports each error. A file with a higher `version` than the app supports is refused with a message to update the app.
- **Sample records don't match each other** (KV values with different shapes): the suggested columns combine every field seen. Missing values show as empty, and non-JSON values show as raw text.
- **KV caching:** after any KV edit, the app shows "changes can take up to 60 seconds to reach everywhere".
- **Large lists:** subscriber screens load in pages (D1 `LIMIT/OFFSET` with a total count), and CSV export streams page by page.
- **Daily send limit reached partway through an announcement:** the rest stays `pending` and continues the next day. The admin app shows "N of M sent, continues tomorrow".
- **A cron run overlaps the previous one:** batches are claimed with a single `UPDATE ... WHERE status='pending' ... RETURNING`, so no row is sent twice.
- **Unsubscribe or bounce while an announcement is sending:** the address is checked again at send time and its delivery marked `skipped`.
- **Email service failure:** the delivery is marked `failed` with the error and retried up to 3 times on later runs.
- **A blocked address tries to re-subscribe:** the database triggers keep it unsubscribed. The reply stays the same as for anyone else.
- **Missing postal address:** the queued announcement stays `queued`, and the admin app shows the setting to fix.

## perchlight-list sending design (scope change, 2026-11-09)

Replaces the batch-recovery design that failed code review twice. Research sources are in the research report, summarized in ADR 0003 once the design is approved.

### Services and modes
| Service | Standard mode (one email per request) | Bulk mode (batches) | Retry when unsure? | Bounces and complaints |
|---|---|---|---|---|
| Resend | yes, with a per-email idempotency key `perchlight-a<announcement>-s<subscriber>` | 100 per request, permissive validation | **Standard: yes, automatically.** Bulk: no. | Signed webhook (Svix) |
| Amazon SES (v2 API, SigV4-signed fetch) | `SendEmail` | `SendBulkEmail`, 50 per request, inline template, per-person `ReplacementHeaders` for List-Unsubscribe | no | SNS notifications. RSA signature checked, certificate URL must be `sns.<region>.amazonaws.com`, TopicArn must match the setting |
| Mailgun (US or EU) | `/messages`, one recipient | `/messages` with `recipient-variables`, 1,000 per request (all or nothing) | no | Signed webhook (HMAC-SHA256); also handles `unsubscribed` events |
| Postmark | `/email` | `/email/batch`, 500 per request, per-message results | no | Webhook with a password in the URL; handles Bounce, SpamComplaint and SubscriptionChange |
| Cloudflare Email | binding `send` | — (no bulk feature) | no | none (not offered by the service) |

### What happens to each delivery
`pending → claimed → sending → sent | failed | unknown | skipped`
1. **Claim:** a batch of `pending` rows is claimed in one statement (overlapping runs can't claim the same row).
2. **Re-check, every time:** anyone no longer confirmed, or now blocked, is marked `skipped`. There are no exceptions, which fixes review finding 1.
3. **Mark `sending`** (with `send_started_at`) in D1 *before* the request goes out.
4. **Send, then record each result:**
   - `sent` → `sent`, with the service's message id.
   - Refused for this person only (bad address, suppressed) → `failed`.
   - Temporary, for this person only → back to `pending`. After 3 attempts → `failed`.
   - **Throttled** (429, quota, SES `ACCOUNT_THROTTLED`) → back to `pending` with no attempt used, and the run stops.
   - **Configuration problem** (bad key, unverified domain, account paused or suspended, other request-level 4xx) → the rows go back to `pending`, and the announcement becomes **`paused`** with `last_error`. It resumes when the owner fixes the problem and clicks Resume. It never loops forever and never fails the list (review finding 3).
   - **Unclear outcome** (timeout, or Resend's 409 `concurrent_idempotent_requests`):
     - Resend in standard mode → `pending`, and the retry uses the same key.
     - Everything else → **`unknown`**, never sent again automatically. The admin app shows these with a "Resend to these N" button.
   - Resend 409 `invalid_idempotent_request` (same key, different content) → `unknown`.
5. **Recovering abandoned rows:**
   - `claimed` for more than 2 minutes, never started → `pending` (nothing went out).
   - `sending` for more than 2 minutes:
     - Resend in standard mode → `pending` (safe because of the per-email key).
     - Everything else → `unknown`.

Guarantees:
- An unsubscribed, bounced, complained or blocked person is never sent a new email.
- Duplicates are impossible, except Resend standard retries, which Resend deduplicates for 24 hours.
- The worst case is "unknown: please confirm", never "emailed twice" or "emailed after unsubscribing".

### Speed settings
- `SEND_MODE`: `standard` (default) or `bulk`.
- `EMAILS_PER_RUN`: default 20. Runs happen every minute.
- `MAX_PARALLEL`: default 4, at most 6 (Workers' limit on open connections).
- `REQUESTS_PER_SECOND`: pacing to the service's limit. Default 2; Resend allows 10.
- `DAILY_SEND_LIMIT`: default 100; `0` means no limit.

Each run stops after about 50 seconds.

On the **Workers Free plan** (50 outside requests and 10 ms of CPU per run), stay at the defaults, about 20 emails a minute. The higher speeds and bulk mode need **Workers Paid** ($5/month: 10,000 requests and 30 s of CPU per run). The README gives example speeds:
- Resend bulk: 10 requests a second × 100 emails = about 1 million in roughly 20 minutes.
- Postmark bulk: 500 per request, with no hard rate limit.
- SES: limited by each account's own approved sending rate.

### Per-person unsubscribe in bulk mode
- **Resend and Postmark:** per-message headers, normal.
- **SES:** `ReplacementHeaders` for the header. The footer link goes in through the template variable `{{perchlight_unsubscribe_url}}`; literal `{{` in announcement text is escaped.
- **Mailgun:** `h:List-Unsubscribe` with `%recipient.unsubscribe_url%`. Mailgun's docs don't confirm that substitution works in headers, so the README requires a test send, and Mailgun's own `unsubscribed` webhook is handled as a backup.
- **Postmark broadcast streams:** `POSTMARK_UNSUBSCRIBE=postmark` (the default) lets Postmark manage unsubscribes, which sync back through the SubscriptionChange webhook. `self` uses our headers, but only after Postmark support approves it.

### Schema changes (migrations not yet released, so they're edited in place)
- `deliveries.status` gains `sending` and `unknown`, and drops `batch_key`. New columns: `send_started_at`, `provider_id`, `error`.
- `announcements.status` gains `paused`. New column: `last_error`.

### Testing
- A fake of each service built from its documented request and response shapes.
- SigV4 checked against AWS's published test vector.
- SNS signature checking tested with a certificate and signature generated by OpenSSL.
- Webhook checks tested with valid and tampered payloads.
- Before relying on each service, the README asks for one real test send from the owner's account.

## Future iterations (not v1)

Ranked by usefulness against effort. Each item uses public Cloudflare APIs only.

### Desktop app: more Cloudflare products
| Priority | Feature | What it gives users |
|---|---|---|
| v1.1 | **R2 file browser** | Browse buckets, upload and download, make time-limited share links. A very common need with no good desktop tool. |
| v1.1 | **Secrets and settings manager** | See every Worker's and Pages project's settings and secret *names* in one table, set or rotate secrets, and spot differences between staging and production. |
| v1.1 | **Backups** | One-click KV and D1 export to a file, plus D1 Time Travel restore points shown as a timeline. |
| v1.2 | **Deployments and rollback** | List Worker versions, roll back with one click, and use gradual deploys. |
| v1.2 | **Live logs** | Stream a Worker's logs (like `wrangler tail`) with filters, inside the app. |
| v1.2 | **Site health** | Request and error charts from Cloudflare's analytics API, plus SSL and DNS checks per project. |
| later | Email Routing rules, DNS record editor, cache purge, Queues inspector (peek, purge, replay failed messages), Turnstile widget manager, cron "run now". | Fills out the "one app for my Cloudflare sites" picture. |
| later | Local change history | A record of every edit made through Perchlight (who, what, before and after), kept on the user's computer. |

### perchlight-list: later
Scheduled sends, subscriber tags or groups, an embed-code generator for the signup form, a webhook on new subscribers, RSS-to-email.

### Companion projects (same pattern: deployable Worker + built-in admin screen)
1. **perchlight-feedback**: a contact or feedback form with Turnstile and D1, with a reply-tracking screen in the app.
2. **perchlight-flags**: feature flags stored in KV with a tiny client library, toggled from the app.
3. **perchlight-status**: a status page powered by scheduled health checks.
4. **perchlight-links**: short links with click counts.

Each companion is small on its own, but together with the app they show "a free toolkit for running a product on Cloudflare". That story is stronger for employers and customers than unrelated repos.

## Open questions
1. **Sign-in return address:** does Cloudflare's self-managed public sign-in app accept a loopback address on any port, or only exactly registered ones? Plan: register a client and test before building `auth/oauth.js`. If exact ports are required, register 3 fixed ports.
2. **Sign-in permissions:** confirm Cloudflare offers fine-grained permissions for KV and D1 (read/write) and account read, so the app asks for no more access than it needs.
3. **Bounce events from Cloudflare Email Service:** does it provide bounce or complaint notifications? If not, the `cloudflare` sender ships without automatic bounce handling, and the README says so.
4. **One-click Deploy button and D1:** confirm the Deploy button creates the D1 database and runs the migrations. If not, the README gives a 3-command manual setup instead.
5. **Formatting announcement emails:** support plain text plus a small Markdown subset written by us, or add a library such as `marked` (goes through the dependency review)? Recommendation: write the small subset ourselves (headings, bold, italic, links, lists) and keep zero runtime dependencies in the Worker.
6. **Sign the IP assignment** before the first public push.

## Acceptance criteria
- A new user can install the app on Windows, Mac or Linux, sign in with the button or with an API token, and see their KV namespaces and D1 databases in under 3 minutes, without installing Node or Wrangler.
- Two projects on two different Cloudflare accounts can be switched between with the picker, and each only ever touches its own account.
- Using only the screen builder (no JSON), a user can create a screen for a KV prefix and one for a D1 table, edit a field, and see the change in Cloudflare.
- Importing a malformed `perchlight.json` shows each error with its path, and nothing is saved.
- A `perchlight.json` written from the published schema by an outside tool imports with no errors.
- `perchlight-list` deploys to a fresh Cloudflare account by following the README, and a signup → confirm → unsubscribe round-trip works end to end.
- Disposable-domain signups and hand-blocked domains are rejected silently, and the reply text is identical to a successful signup.
- An announcement queued to N confirmed subscribers sends exactly N emails, never more than `DAILY_SEND_LIMIT` per day, each carrying the List-Unsubscribe headers, the unsubscribe link, and the postal address.
- One-click unsubscribe from a mail client (RFC 8058 POST) unsubscribes immediately.
- A Resend bounce webhook marks the subscriber `bounced`, and they get no further emails. A webhook with a bad signature is rejected.
- CI passes on every push, and pushing a version tag produces installers for all 3 operating systems.
- Neither repo contains "Ravenburst" outside the credits and the sign-in domain, any secret, Cloudflare logos, or code from the license/trial system.

## Build notes (v0.1, 2026-11-09)

How v0.1 differs from the plan above, and why:

- **Desktop app stack:** plain JavaScript ES modules, with no framework and no build step. Pages are served from a privileged `app://perchlight/` protocol, under a strict Content Security Policy. Electron is the only package that ships in the app. Main process files are `src/main/{main,ipc,store,cloudflare,auth}.js`; the preload is `src/preload.cjs`.
- **"Sign in with Cloudflare":** fully coded (PKCE, a `127.0.0.1` loopback redirect on ports 8976-8978, and a single-flight token refresh). It's hidden until a Cloudflare OAuth client is registered and its id goes in `src/main/oauth-config.json`. This is untested against Cloudflare. API-token sign-in works now.
- **Screens file:** the published JSON Schema and the app's checker are kept in step by a parity test (Ajv, 31 cases). Field names that would reach JavaScript's built-in objects (`__proto__`, `constructor`, `prototype`) are rejected.
- **KV edits:** they re-read the key before writing, keep its expiration and metadata, and refuse to write rather than risk damage (a deleted key, a value that isn't a JSON object, or numbers too large to round-trip exactly).
- **Mailing-list screen:** shows the newest 5,000 subscribers, with totals computed in SQL. It never deletes blocked, bounced or complained rows. Announcements are queued by inserting deliveries while the announcement is still a draft, then flipping it to queued with a guard.
- **perchlight-list sending:** see that repo's ADR 0003 and the sending design section above.
- **Not tested by the authors** (it costs money or needs accounts): real email sends, OAuth sign-in, and the macOS and Linux builds on real machines. Both READMEs say so.
