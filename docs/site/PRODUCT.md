# Perchlight website (perchlight.ravenburst.com)

Inferred by `/design` on 2026-11-16 from the existing site, the repos and project notes. Correct anything wrong.

## Job
Show an indie developer, in one screen, that Perchlight is a family of free self-hosted tools that replace the paid services behind a small software product, then get them to the tool they need (its repo) or the desktop app download.

## Users
Solo and small-team developers of desktop apps, games, sites and SaaS who already use or would try Cloudflare. Technical, cost-sensitive, skeptical of marketing. Visit from a GitHub README, a profile link or a forum post; read on a desktop monitor, often in the evening; some on a phone.

## Surfaces
- `site/index.html`: Persuade (open-source developer-tool landing page).
- `site/privacy.html`, `site/terms.html`: Read.

## Primary actions
- Browse the tools → open a tool's repo.
- Download the desktop app (GitHub latest release).
- Watch releases on GitHub (no mailing-list form on the site).

## Brand commitments
- The icon: a white bird on an amber branch under a lamp-like moon, on a dark night ground.
- Name is "Perchlight"; tools are lower-case `perchlight-<tool>`.
- Never use "Cloudflare" in a product name or the Cloudflare logo; say "for Cloudflare"/"on your Cloudflare account"; keep the not-affiliated disclaimer.
- No Google Fonts or third-party font CDNs; no trackers; static files only.

## Tone / register
Plain-technical. Short declarative sentences, concrete nouns (what it does, what it runs on, what it replaces). No hype.

## Truth (the page may state these and nothing else)
- 13 self-hosted tools + 1 desktop app (Windows, macOS, Linux); all MIT, free, open source.
- Each tool's Cloudflare bindings, from its `wrangler.jsonc` (2026-11-16): every tool uses Workers + D1; R2: updates, crashes, forms, beta; Durable Objects: booking, status, hooks, play, privacy, ask, beta; Workers AI + Vectorize: ask; cron trigger: list, updates, guard, crashes.
- Workers Free allows 5 cron triggers per account.
- Desktop installers are not code-signed.
- Each tool's one-line description and "replaces" line as on the 2026-11-12 site.

## Anti-goals
Generic SaaS landing page (gradient hero, equal feature cards, stat strip, testimonials). Anything that looks like an official Cloudflare product.
