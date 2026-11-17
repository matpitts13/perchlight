# Critique: site/index.html (redesign) — 2026-11-16

Mode: Persuade. Personas: Jordan (first-timer), Riley (stress tester), Casey (mobile).
visual-qa: PASS, 0 warn, at 1440/1024/768/390/320 (index, privacy, terms).

## Scores
Nielsen: 33/40 (good). Status 3 · real-world match 4 · control 3 · consistency 4 · error prevention 3 · recognition 4 · efficiency 3 · minimalist 3 · recovery 3 · help 3.
Cognitive load: 0–1 fails (low). Hero has 2 actions; tool groups hold 4–5 items; rail map is one decision per row.

## Design quality
- Generic test: passes. The night/lamp palette from the icon and the rail map make it Perchlight's page; no card grid, kickers, gradients or stat strip.
- Hierarchy test: squinting at 1440, the h1, the amber primary button and the lit stops read first.
- System test: one button pair, one radius scale, three faces with fixed roles; DESIGN.md drift: none.

## Findings
- P2 · header at ≤560px · only "Download" is reachable from the header; Casey has to scroll to reach the tools · show the "Tools" link on phones · FIXED.
- P2 · hero `.frame` · the app window is an HTML illustration, not a screenshot, and could drift from the real app · replace it with a real screenshot of the subscribers screen when convenient (needs the user's app with example data) · OPEN.
- P3 · rail map headers · "D1", "R2", "Durable Objects" are Cloudflare terms; fine for this audience, but a first-timer gets no definition · optional `title` or a one-line legend linking Cloudflare's docs · OPEN.

No P0/P1. Stop.
