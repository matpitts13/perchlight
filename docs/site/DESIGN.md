---
name: Perchlight site
description: Night-and-lamp field guide. Dark night bands alternate with warm bone pages; one amber lamp colour marks every live thing; serif display over a plain technical sans; the signature move is a rail map of what each tool runs on.
colors:
  night: "#15171c"
  night-2: "#20232b"
  night-line: "#343946"
  bone: "#eceae4"
  paper: "#f7f6f2"
  ink: "#17191e"
  muted: "#545963"
  on-night: "#eceae4"
  on-night-muted: "#a6abb6"
  lamp: "#eaa43e"
  lamp-ink: "#8a5710"
  branch: "#c98a3c"
  hairline: "#d8d3c8"
  frame-bar: "#e6e2d9"
  frame-dot: "#cfc9bd"
  state-ok-bg: "#f6e3c4"
  state-ok-ink: "#6e4508"
typography:
  display: { fontFamily: Source Serif 4, fontSize: 60px, fontWeight: 600, lineHeight: 1.05, letterSpacing: -0.02em }
  h2: { fontFamily: Source Serif 4, fontSize: 40px, fontWeight: 600, lineHeight: 1.1 }
  h3: { fontFamily: Source Serif 4, fontSize: 24px, fontWeight: 600, lineHeight: 1.2 }
  title: { fontFamily: IBM Plex Sans, fontSize: 18px, fontWeight: 600, lineHeight: 1.3 }
  lead: { fontFamily: IBM Plex Sans, fontSize: 20px, fontWeight: 400, lineHeight: 1.55 }
  body: { fontFamily: IBM Plex Sans, fontSize: 17px, fontWeight: 400, lineHeight: 1.6 }
  lead-2: { fontFamily: IBM Plex Sans, fontSize: 19px, fontWeight: 400, lineHeight: 1.55 }
  button: { fontFamily: IBM Plex Sans, fontSize: 16px, fontWeight: 600, lineHeight: 1 }
  frame-ui: { fontFamily: IBM Plex Sans, fontSize: 13px, fontWeight: 600, lineHeight: 1.4 }
  frame-chip: { fontFamily: IBM Plex Sans, fontSize: 12px, fontWeight: 600, lineHeight: 1.4 }
  small: { fontFamily: IBM Plex Sans, fontSize: 15px, fontWeight: 400, lineHeight: 1.5 }
  mono: { fontFamily: IBM Plex Mono, fontSize: 14px, fontWeight: 500, lineHeight: 1.5 }
rounded:
  sharp: 3px
  frame: 8px
  pill: 999px
spacing: { xs: 4px, sm: 8px, md: 12px, lg: 16px, xl: 24px, 2xl: 32px, 3xl: 48px, 4xl: 72px, 5xl: 112px }
components:
  button-primary-light: { backgroundColor: "{colors.ink}", textColor: "{colors.bone}", rounded: "{rounded.pill}", padding: "12px 22px" }
  button-primary-night: { backgroundColor: "{colors.lamp}", textColor: "{colors.night}", rounded: "{rounded.pill}", padding: "12px 22px" }
  button-secondary: { backgroundColor: transparent, textColor: currentColor, borderColor: currentColor, rounded: "{rounded.pill}" }
---
## Overview
Mode: Persuade (index), Read (privacy, terms). The world is the icon's: a night ground, a white bird, an amber lamp. Night bands carry the hero, the rail map and the close; bone bands carry reading. Informed by: Linear's dark/light band rhythm and density (library/linear.app.md), Mintlify's calm reading column; neither palette nor type reused.

## Colors
`lamp` is the only chromatic colour and means "live / in use": a stop on the rail map, the primary button on night, focus rings. `lamp-ink` is its text-safe shade on bone (links). `branch` draws the rail lines only. Everything else is night/bone neutrals. Dark scheme: bone bands become `night-2`, ink becomes `on-night`; night bands stay.

## Typography
Source Serif 4 (variable, opsz) for h1–h3: the field-guide voice. IBM Plex Sans for everything read or clicked. IBM Plex Mono only for tool names in the rail map, binding names and code. All self-hosted woff2 in `site/fonts/` (OFL). Body 17px, measure ≤ 68ch, `text-wrap: balance` on headings, `pretty` on paragraphs.

## Layout
Container 1120px, 24px gutters (16px under 480px). Sections 1–2 screens tall at 1440×900, generous top padding (`5xl`), heading space above > below. Tool list is grouped rows, never a card grid.

## Elevation & Depth
Flat. Separation by band colour and hairlines. The app frame is the only raised object (one soft offset shadow on night).

## Shapes
Sharp 3px on chips and code; 8px on the app frame; pills for buttons only.

## Motion
One moment: when the rail map enters the viewport, its stops light from dim to lamp, row by row (≤ 900ms total, ease-out-expo). Stops are visible (dim) at rest and fully lit under reduced motion. Hover: buttons shade, rows tint, links draw underline.

## Components
Buttons (pill, verb + object). Tool row: name link (repo), one-line job, struck-through "instead of" line. Rail map: a real `<table>` styled as rails and stops. App frame: illustrative HTML of the desktop app's mailing-list screen, `role="img"`.

## Signature move
The rail map: one vertical rail per Cloudflare building block (Workers, D1, R2, Durable Objects, Workers AI, Cron), one row per tool, a lit stop where the tool uses that block. It answers "what will this cost me in Cloudflare terms" honestly, from the repos' configs.

## Do's and Don'ts
- Do state what each tool replaces; don't invent prices, users or stars.
- Do keep the not-affiliated line in the footer.
- Don't add kickers/eyebrows above headings, card grids, gradients or glows (the icon's moon glow stays inside the icon).
