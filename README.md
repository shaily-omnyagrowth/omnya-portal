<p align="center"><img src="public/og.png" alt="Omnya, the creator portal for Omnya Growth" width="720"></p>

# Omnya Portal

Creator, brand and staff portal for a UGC agency: campaigns, content submissions, social analytics, creator earnings and payouts.

React SPA (Create React App) + Vercel functions in `api/` + Supabase (Postgres, Auth, Storage).

## Getting started

```bash
npm install
cp .env.example .env          # fill in values; see comments in the file
npm run dev                   # SPA on :3000 and /api/* on :3100
```

A fresh Supabase project runs `supabase/SETUP.sql` once, then `npm run db:migrate` (`-- --status` shows what's applied). See [supabase/migrations/README.md](supabase/migrations/README.md).

## Tests

```bash
node tests/run-all.cjs --offline-only   # fast lane, no servers
CI=true npm test -- --watchAll=false    # Jest
```

## Layout

```
├── api/            Vercel functions, one file per route (_lib/, _utils/ helpers)
├── src/
│   ├── app/        session, workspace loading, nav, routes, shell
│   ├── pages/      screens by area
│   ├── components/ shared feature pieces
│   ├── ui/         primitives (Dialog, Select, Avatar, Pagination, charts…)
│   └── styles/     tokens and global CSS
├── supabase/
│   ├── SETUP.sql   the whole schema, as of 2026-10-30
│   └── migrations/ every change since, plus PGlite tests
├── tests/          custom Node harness
├── scripts/        migration runner
├── public/         static assets, legal pages, TikTok verification files
└── docs/
    └── guides/     design context, social OAuth setup
```

Contributor and agent conventions: [AGENTS.md](AGENTS.md).
