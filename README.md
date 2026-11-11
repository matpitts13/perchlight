# Perchlight

[![CI](https://github.com/matpitts13/perchlight/actions/workflows/ci.yml/badge.svg)](https://github.com/matpitts13/perchlight/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**A free desktop app for your Cloudflare data.** Browse and edit Workers KV and D1, build your own screens over your data without writing code, and run a mailing list. It works for every site you run, on Windows, macOS and Linux.

- **One app, all your sites.** Each project is a site or app, with its own Cloudflare account and sign-in. Switch between them in the sidebar.
- **KV and D1 browsers.**
  - KV: any namespace, keys by prefix, view and edit values, create and delete keys.
  - D1: tables, rows (double-click to edit), and a SQL console.
- **Your own screens, no code.** Pick a D1 table or a set of KV keys. Perchlight reads a few records and suggests columns (name, type, choices). You then:
  - rename, reorder, hide, or mark columns editable
  - add row buttons such as "Revoke" (sets a field) or "Delete"
- **Or write them yourself.** Screens are saved as a `perchlight.json` file, described by a published [JSON Schema](schema/perchlight.schema.json), so you or your AI agent can write one. **Import** checks the file and lists every problem with its exact location; **Export** saves it.
- **Mailing list.** A built-in screen for [perchlight-list](https://github.com/matpitts13/perchlight-list) (a free, self-hosted mailing list on Cloudflare):
  - subscribers, with filters, block/unblock and CSV export
  - blocked and allowed domains
  - announcements: write with simple formatting, preview, send a test to yourself, queue for everyone, watch progress, resume a paused send, and re-queue anyone whose delivery was unclear
- **Careful with live data.** Every change shows before and after and asks first.

Perchlight is an independent project. It is not affiliated with, endorsed by, or sponsored by Cloudflare, Inc. "Cloudflare" is a trademark of Cloudflare, Inc.

## Install

Download the installer for your system from [Releases](https://github.com/matpitts13/perchlight/releases).

The installers aren't code-signed: signing certificates cost money, and Perchlight is free. Your system will warn you once:
- **Windows:** SmartScreen says "Windows protected your PC". Click **More info**, then **Run anyway**.
- **macOS:** right-click Perchlight in Applications, choose **Open**, then **Open** again. If macOS says the app is damaged, run `xattr -dr com.apple.quarantine /Applications/Perchlight.app` in Terminal.
- **Linux:** make the AppImage executable (`chmod +x Perchlight-*.AppImage`) and run it.

Or run from source (Node 22+): `npm install`, then `npm start`.

## Connect to Cloudflare

**API token** (available now):
1. In Perchlight, choose **Add project → Use an API token → Open Cloudflare's token page**. The page opens with Perchlight's permissions filled in.
2. If they aren't filled in, add these permissions yourself:
   - **Account Settings: Read**
   - **Workers KV Storage: Edit**
   - **D1: Edit**
3. Create the token, copy it, and paste it into Perchlight. It's checked against Cloudflare, then stored **encrypted** with your system's key store (Windows DPAPI, macOS Keychain, Linux Secret Service). It's only ever sent to `api.cloudflare.com`.

**Sign in with Cloudflare** (coming): a one-click browser sign-in. The code is in place, but the button stays hidden until Perchlight's sign-in app is registered with Cloudflare (see [Maintainers](#maintainers)).

## What has and hasn't been tested

- **Tested automatically (`npm test`):** screen-file checking, column suggestions, key patterns, value formatting, the announcement formatter, and CSV export.
- **Tested by launching:** the app was started and checked on Windows, both from source and as a packaged build (`npm run smoke` loads it, checks for errors and saves a screenshot).
- **Not tested by the authors:**
  - **"Sign in with Cloudflare"**, because it can't run until the sign-in app is registered.
  - **Unsigned macOS and Linux builds** on real machines. They're built by the release workflow, but the authors have only run Windows.
  - **Your own Cloudflare data.** Before relying on Perchlight with important data, try it on a test namespace or database first. Everything it does is a standard Cloudflare API call, and Cloudflare's free plan is enough for that test.

## Your screens file

```json
{
  "$schema": "https://perchlight.ravenburst.com/schema/v1.json",
  "version": 1,
  "views": [
    {
      "id": "users",
      "title": "Users",
      "source": { "type": "d1", "database": "<database id>", "table": "users" },
      "columns": [
        { "label": "Email", "from": "email" },
        { "label": "Plan", "from": "plan", "type": "enum", "options": ["free", "pro"], "editable": true }
      ],
      "actions": [{ "label": "Delete", "delete": true }]
    },
    {
      "id": "licenses",
      "title": "Licenses",
      "source": { "type": "kv", "namespace": "<namespace id>", "prefix": "license:" },
      "keyPattern": "license:{code}",
      "columns": [
        { "label": "Code", "from": "key.code" },
        { "label": "Devices", "from": "value.devices", "type": "count" },
        { "label": "Revoked", "from": "value.revoked", "type": "boolean", "editable": true }
      ],
      "actions": [{ "label": "Revoke", "set": { "value.revoked": true } }]
    },
    { "id": "list", "title": "Mailing list", "preset": "perchlight-list", "database": "<database id>", "siteUrl": "https://list.example.com" }
  ]
}
```

**Column sources:**
- **D1:** a column name.
- **KV:**
  - `key`
  - `key.<part>`, a part named in `keyPattern`
  - `value`
  - `value.<field>.<field>`, for JSON values
  - `expiration`

**Types:** `text`, `number`, `boolean`, `date`, `enum` (needs `options`), `count` (the length of a list), and `json`. The full rules are in [schema/perchlight.schema.json](schema/perchlight.schema.json).

## Privacy and safety

- Your projects and screens are stored only on your computer. Sign-ins are encrypted. (On Linux without a keyring service such as GNOME Keyring or KWallet, Electron falls back to weak encryption. Install one if others can access your files.)
- The app talks only to `api.cloudflare.com`, plus your perchlight-list site when you add a subscriber.
- The window can't reach your files or Node.js. It calls a fixed list of checked commands, and tokens never reach it.
- Text from your data is always shown as text, never run as code. Announcement previews are shown sandboxed.

## Maintainers

- **Release:** bump `version` in `package.json`, then push a tag (`git tag v0.1.0 && git push --tags`). `.github/workflows/release.yml` builds all three systems and uploads them to a **draft** release. Publish the draft when it looks right.
  - The workflow keeps nothing as an Actions artifact.
  - CI only runs tests, and only for `main` and pull requests.
  - On a public repository both are free.
- **Enable "Sign in with Cloudflare":** register a public OAuth client with Cloudflare (free; needs a verified domain). The steps:
  - Redirect URIs: `http://127.0.0.1:8976/oauth/callback`, `:8977` and `:8978`.
  - Scopes: those in [`src/main/oauth-config.json`](src/main/oauth-config.json).
  - Put the client id in that same file.
  - Then test the flow and update this README.
- **Icon:** edit `build/icon.svg`, then run `npm run icon`.
- **Website** (`site/`, a static page with privacy and terms pages; free on Cloudflare Pages):
  1. Set the "Get updates" form's `action` to your perchlight-list deployment.
  2. Run `npx wrangler pages deploy site --project-name perchlight`.
  3. Add the custom domain (e.g. `perchlight.ravenburst.com`) in the Pages project settings.
  4. `site/schema/v1.json` must match `schema/perchlight.schema.json`; a test checks this.

## License

[MIT](LICENSE)
