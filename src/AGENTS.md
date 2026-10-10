# src (React SPA)

## Overview

The whole browser app: one Create React App bundle serving owners, account managers, creators and clients. Most screens live in `App.js`; larger dashboards are split into `pages/` and `components/` and lazy loaded so each role only downloads what it uses.

## Key files

| File | Owns |
|---|---|
| `App.js` | Session, role resolution, `loadDB()`, the `navs` sidebar map plus `navsFor(role, caps)`, and the per role `if (page === "…")` render ladder near the bottom |
| `supabaseClient.js` | The anon key client; throws if `REACT_APP_SUPABASE_URL` or `REACT_APP_SUPABASE_ANON_KEY` is missing |
| `utils.js` | Shared formatters (`fmtMoney`, `fmtNum`, `fmtDate`), `platformMeta`, status badges |
| `pages/` | Role dashboards (`ClientDashboard`, `CreatorDashboard`), owner admin (`UserManagement`, `AuditHistory`, `SystemConfig`), and the public `SharedCampaignReport` |
| `components/PayoutManager.js`, `components/CreatorEarnings.js` | Money screens; every money action goes through `/api/*` |
| `CreatorConnections.js` | Social account connect and disconnect UI (OAuth starts in `api/auth/*`) |

## Conventions

- No router. Navigation is a `page` string in state, mirrored to the URL with `history.pushState` and to `localStorage.last_page`. Adding a screen means a `navs` entry plus a branch in the render ladder for each role that sees it.
- Wrap each rendered page in `<ErrorBoundary label="…">` and load heavy screens with `React.lazy`, as the existing pages do.
- Browser writes go through `updateRows()` and errors through `describeWriteError()` in `App.js`. Server calls go through `callApi()`, which attaches the session bearer token and throws on `{ ok: false }`.
- An owner can preview other roles with the role override select. Code that gates on role should use the resolved `role`, not `user.role`.

## Gotchas

- `components/Guards/RequireRole.js` and `contexts/AuthContext.js` are dead code. They import `react-router-dom`, which is not installed. Do not wire them in.
- `App.js` starts with `/* eslint-disable */`; other files are linted, and `CI=true npm run build` fails on warnings there.
- `npm start` does not serve `/api/*`. Use `node tests/lib/devServer.cjs` (port 3100) when a screen calls the API, or it will look broken when it is not.
- Do not call third party hosts from the browser. The CSP blocks everything except Supabase.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
