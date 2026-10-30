# src (React SPA)

## Overview

The whole browser app: one Create React App bundle serving owners, account managers, creators and clients. Screens are lazy loaded per role from `app/routes.js`, so each role only downloads what it uses.

## Key files

| File | Owns |
|---|---|
| `App.js` | Session gate, public routes (share report, legal), toaster and tooltip layer, then the shell and the routed page |
| `app/` | `useSession` (auth and profile), `useWorkspace` (`loadDB`, background refresh), `nav.js` (page titles, grouped nav per role), `routes.js` (page per role and its skeleton), `Shell.js` and `Sidebar.js` |
| `pages/<area>/` | Screens by area: `campaigns`, `clients`, `client` (the brand portal), `creator`, `money`, `people`, `review`, `owner`, `content`; plus `Settings`, `AuditHistory`, `SystemConfig`, `Legal`, `SharedCampaignReport`, `Landing` |
| `components/` | Shared feature pieces: `UGCDashboardView`, `PostsGalleryView`, `CampaignProgressCard`, `payouts/*` behind `PayoutManager.js`, `earnings/*` behind `CreatorEarnings.js` |
| `ui/` | Primitives: `Avatar` (seeded gradient, no photos or initials), `Pagination` (`usePagination` for tables), `Dialog`, `Alert`, `EmptyState` (+ `NoMatchRow`), `PageHeader`, `Tabs`, `Segmented`, `Select`, `TooltipLayer`, `Skeleton`, `charts` (`AreaChart`, `BarChart`, `Sparkline`, `ShareBars`), `Icon` |
| `styles/` | `tokens.css` (colours, type, radii, motion), `base`, `components`, `shell`, `utilities` |
| `lib/` | `db.js` (`updateRows`, `describeWriteError`), `api.js` (`callApi`) |
| `utils.js` | Formatters (`fmtMoney`, `fmtNum`, `fmtCompactNum`, `fmtDate`, `EMPTY` is `--`), `platformMeta`, `calcPacing`, status badges |

## Conventions

- Design context (users, brand, aesthetic, principles) lives in [docs/guides/design.md](../docs/guides/design.md). Read it before UI work.
- No router. Navigation is a `page` string mirrored to `?page=`. Adding a screen means an entry in `pages` in `app/nav.js`, a nav group item (or `hidden`), and a row in `routes.js` for each role.
- Use the `ui/` primitives: `Select` instead of `<select>`, `Dialog` instead of overlays, `Alert` for inline errors, `EmptyState` with a next step, skeletons instead of spinners. Icon-only buttons need an `aria-label`; the tooltip layer shows it. Use `data-tip` for any other hover hint and `data-tip-side="right"` on the collapsed rail.
- Feedback: action results are `gooeyToast` toasts (dark), load failures are an `Alert` with a retry action, and field errors stay inline.
- Browser writes go through `updateRows()` or ask for the row back with `.select()`, since RLS filtering returns zero rows rather than an error. Server calls go through `callApi()`.
- Comments say what a non-obvious block does in one line; audit ids (`N-18`) stay inline.

## Gotchas

- `CI=true npm run build` fails on any lint warning.
- `npm start` does not serve `/api/*`. Use `node tests/lib/devServer.cjs` (port 3100) when a screen calls the API.
- Do not call third party hosts from the browser. The CSP blocks everything except Supabase.
- On desktop the main panel (`.main`) is the scroll container, not the window. Sticky elements and scroll listeners must use it.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
