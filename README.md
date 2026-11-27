<p align="center">
  <img src="web/public/icons/icon-192.png" width="96" alt="Tada icon">
</p>

<h1 align="center">Tada</h1>

<p align="center">A single-user to-do app with multi-device sync. Local-first: every device keeps its own local database, taps take effect instantly, and it keeps working offline.</p>

<p align="center">
  <a href="https://github.com/cholf5/tada/actions/workflows/ci.yml"><img src="https://github.com/cholf5/tada/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="Apache-2.0"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2024-339933.svg" alt="Node.js 24+">
</p>

<p align="center">English · <a href="README.zh-CN.md">简体中文</a></p>

> [!IMPORTANT]
> **This project ships source code only; there is no hosted service.** Deploy it yourself — one relay serves exactly one person.

Lists, tasks, subtasks, Today, All, and search, plus an optional multi-device sync. Anything that needs another person or a background push — collaboration, sharing, reminders, activity feeds — has been deliberately left out.

## Features

| Feature | What it does |
|---|---|
| **Lists** | Create, rename, recolor, drag to reorder, delete |
| **Tasks** | Quick add, inline title editing, notes, due dates, complete and restore, drag to reorder, move to another list |
| **Subtasks** | Add, check off and delete inside the task detail; one level only; the parent shows completion progress |
| **Views** | Today (including overdue), All, completed archive, a single list |
| **Search** | Searches titles and notes across lists; matching subtasks also show their parent's title |
| **Sync** | Incremental multi-device sync, offline writes, row-level LWW; fully local when unpaired |
| **Install** | PWA: add to home screen, start offline, update automatically |
| **Appearance** | Follows the system light/dark setting; can be locked to day or night in settings (per device) |
| **Language** | Chinese / English, follows the browser by default, can be chosen in settings (per device) |
| **Settings** | Pairing, device name, sync status, sync now, unpair, appearance, language, export backup, re-upload local data |

## Quick start

Node.js ≥ 24 is required (relay tests use the built-in `node:sqlite`). The frontend is a pure browser environment, so installing dependencies is all it takes.

```bash
npm install
npm run dev:web
```

Open <http://localhost:5173> and you are set. Without the relay running it is a fully local app with the complete feature set.

To try multi-device sync, start a local relay as well:

```bash
cp relay/wrangler.toml.example relay/wrangler.toml   # first time only
npm run db:init:local                  # create local D1 tables, once
npx wrangler d1 execute tada --local --config relay/wrangler.toml --command \
  "INSERT INTO pairing_codes (code, expires_at) VALUES ('AAAA111111', strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes'))"
npm run dev:relay                      # 127.0.0.1:8787
```

Then enter the pairing code `AAAA111111` under Settings → Relay. Vite already proxies `/api` to 8787.

## How it works

```text
┌─ Browser / PWA ────────────────────────────┐
│ React 19 · Vite · Dexie (IndexedDB)        │
│ Every read/write hits local storage first  │
│ and the UI responds immediately            │
└───────────────┬────────────────────────────┘
                │ push / pull (optional)
┌───────────────▼────────────────────────────┐
│ Cloudflare Worker + D1                     │
│ pairing auth · row-level LWW · tombstones  │
└────────────────────────────────────────────┘
```

- **Local-first**: the row write and its `outbox` entry happen in a single Dexie transaction; sync runs in the background, and a network failure never rolls back the UI.
- **Relay optional**: while unpaired the whole sync path does not exist, and the app works standalone as usual.
- **Row-level LWW + HLC**: for the same row the larger HLC wins; the server only compares strings.
- **Tombstone deletes**: a delete is `deleted = 1` plus a new HLC and is never a physical delete, so the other device cannot resurrect the row.
- **Protocol written once**: entity types, zod validation and HLC live in `shared/`, imported by both the frontend and the relay.
- **Same-origin deploy**: the Worker serves both `web/dist` and the API, which removes CORS; the PWA identity stays `/` and never follows branding.

Repository layout:

```text
shared/   @tada/shared  entity types, zod schemas, HLC, API types
relay/    @tada/relay   Cloudflare Worker + D1, hand-written SQL
web/      @tada/web     React 19 PWA, Dexie + @dnd-kit
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev:web` | Vite dev server (5173) |
| `npm run dev:relay` | Wrangler local relay (8787) |
| `npm run typecheck` | Typecheck all three workspaces |
| `npm run test` | Protocol, sync engine, relay SQL and HTTP+SQL E2E |
| `npm run build` | Build the frontend into `web/dist` |
| `npm run deploy` | Build the frontend and deploy the Worker (frontend + API, same origin) |
| `npm run db:init` | Create or patch tables in the remote D1 |
| `npm run db:init:local` | Create tables in the local D1 (local development) |
| `npm run pair` | Generate a one-time pairing code and print the command that writes it into D1 |
| `npm run icons` | Regenerate the PWA icons from SVG |

## Deploy

Full steps are in **[`docs/DEPLOY.md`](docs/DEPLOY.md)** (Chinese). Shortest path:

```bash
git clone https://github.com/cholf5/tada.git
cd tada
npm install
npx wrangler login
cd relay
cp wrangler.toml.example wrangler.toml
npx wrangler d1 create tada   # put the database_id into relay/wrangler.toml
cd ..
npm run db:init
npm run deploy
npm run pair                  # run the printed wrangler command, then enter the code in settings
```

- The result is a `https://tada-relay.<subdomain>.workers.dev` address: frontend, API and PWA manifest all live there, HTTPS included. No GitHub Pages, server or certificate needed.
- `APP_ORIGIN` only needs a value when the frontend and backend are on different origins (for example the frontend on GitHub Pages); keep the placeholder when the Worker serves both.
- Pairing codes stay valid for 10 minutes and work once; generate one per device.
- Upgrade: `git pull && npm install && npm run db:init && npm run deploy`.

<details>
<summary>Custom instance name and icon</summary>

A self-hosted instance can use its own app name and icon, visible on every connected device:

1. After pairing, change the name and pick a built-in icon or upload your own image under Settings → Instance branding.
2. Uploaded images are resized to a 512×512 PNG in the browser before upload; the relay stores only that one file.
3. Before pairing you can also set `APP_NAME` under `[vars]` in `relay/wrangler.toml`; once the settings page has saved a value, D1 wins and changing `APP_NAME` no longer overrides it.
4. A PWA already added to the home screen must be removed and re-added for the new name and icon to appear; an ordinary page refresh is enough elsewhere.
5. Built-in icons include wax seal (default), signed seal, notebook, paper & ribbon, enamel check, and a recolorable classic check.

</details>

## Data and backups

> [!WARNING]
> IndexedDB is the only local copy. Clearing site data, browser storage eviction, or leaving an iOS device unused for a long time can all make it disappear.

- On startup the app asks for persistent storage; the browser may refuse, and the settings page shows the current status.
- Settings → Local data can export a JSON backup containing lists and tasks (including tombstones) but no pairing token; import is not implemented yet.
- With sync enabled, the relay holds another copy; for local-only use, export regularly.

## Tests and CI

- Relay tests execute the real `schema.sql` through Node's built-in `node:sqlite`; `relay/src/e2e.test.ts` goes through the full HTTP layer: pairing, push/pull from two clients, LWW, tombstones, paging, 401.
- CI runs typecheck, test, `npm audit --omit=dev --audit-level=high` and build, in that order.

## Out of scope

Deliberately not built: multi-user and shared lists, reminders and notifications, calendar integration, attachments, comments, activity feeds, hosted service. Full scope and known limitations are in [`docs/SPEC.md`](docs/SPEC.md).

More documentation (written in Chinese):

- [`docs/DEPLOY.md`](docs/DEPLOY.md) — complete walkthrough from zero to Cloudflare Workers
- [`docs/SPEC.md`](docs/SPEC.md) — product spec, data model, sync rules, acceptance
- [`relay/README.md`](relay/README.md) — relay API contract, deployment and pairing
- [`docs/HARDENING.md`](docs/HARDENING.md) — hardening log and real-device acceptance checklist
- [`AGENTS.md`](AGENTS.md) — project conventions for collaborators

---

Apache-2.0, see [LICENSE](LICENSE). The name and icons are not covered by the license; forks should rename.

Tada is an independent open-source project inspired by Wunderlist. It is not affiliated with, endorsed, or sponsored by Microsoft Corporation. Wunderlist is a trademark of Microsoft Corporation.
