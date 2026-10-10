# tests (system test harness)

## Overview

A custom Node harness (`*.test.cjs`), not Jest. Offline suites check handlers and logic; browser suites drive Chrome through `playwright-core` against the real app; some suites talk to the live Supabase project. Built so a broken test reports as a broken test, never as an app bug. `README.md` has the full background.

## Key files

| File | Owns |
|---|---|
| `run-all.cjs` | Boots CRA and the dev server, runs the offline lane first, then every suite; kills process trees on exit |
| `lib/devServer.cjs` | Serves `/api/*` from the real handlers on :3100 and proxies the rest to CRA |
| `lib/schema.cjs` | Reads the live schema and refuses unknown column names before querying |
| `lib/ui.cjs` | `login`, `goto`, `selectTab`, `contentText`: waits and throws with what it did find |
| `lib/fixture.cjs` | Disposable accounts and rows, with teardown that verifies nothing survived |
| `live-*.cjs` | Read only probes of the live database |

## Commands

```bash
node tests/run-all.cjs --offline-only   # fast lane
node tests/run-all.cjs --suite=creator  # one suite, prefix match
node tests/run-all.cjs --no-servers     # CRA and devServer already running
```

`CHROME_PATH` overrides the Chrome location. Live suites need `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`.

## Conventions

- Exit codes: `0` pass, `1` real failure, `3` BLOCKED on an unapplied migration (name the migration that fixes it). Never report BLOCKED as FAILED.
- Query tables with `schema.select()` / `selectOne()`, and parse handler responses with `parseBody()` (bodies are JSON strings).
- Select tabs explicitly and wait for content; never assume the default screen state.
- Assert on the tables actually touched, not only on summary counts.
- Prove the instrument is live before trusting it (RLS enforced, guard rejects a bad column).

## Gotchas

- Browser tests must point at :3100, not :3000, or every API call 404s.
- Live suites create real accounts named `claude-test-<role>+<timestamp>@example.com` in production Supabase and delete them in `finally`. Keep teardown intact.
- `/api/send-email` returns 500 locally while `RESEND_API_KEY` is a placeholder. The harness reports that as an env gap, not a failure.

## Agent skills

- [playwright-cli](../.agents/skills/playwright-cli/): `microsoft/playwright-cli`, browser automation (the suites use `playwright-core` through `lib/chrome.cjs`)
- [webapp-testing](../.agents/skills/webapp-testing/): `anthropics/skills`, driving the real app in a browser to check behavior

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
