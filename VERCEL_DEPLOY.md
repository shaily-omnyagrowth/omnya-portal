# Vercel Environment Variables Guide

> **SECURITY NOTICE — read [SECURITY_NOTES.md](./SECURITY_NOTES.md) first.**
> Earlier revisions of this file contained live Supabase anon and service-role keys.
> Those keys are in git history and **must be rotated** in Supabase before this
> repository is shared, deployed, or trusted again. Never paste live secrets back
> into this file.

## Option 1: Vercel Dashboard (Recommended for beginners)

1.  Go to [Vercel Dashboard](https://vercel.com/dashboard).
2.  Select your **Omnya Portal** project.
3.  Click on **Settings** (gear icon on the left).
4.  Click on **Environment Variables** in the right sidebar.
5.  Add each variable one by one. **Values must come from your Supabase / provider
    dashboards — never copy them into this file.** Required keys:

    | Key | Source | Scope | Notes |
    |---|---|---|---|
    | `REACT_APP_SUPABASE_URL` | Supabase → Settings → API → Project URL | Production, Preview, Development | Bundled into the React build; safe to be public. |
    | `REACT_APP_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon public key | Production, Preview, Development | Bundled into the React build; only safe when RLS is correctly configured. |
    | `SUPABASE_URL` | Same as above, without `REACT_APP_` prefix | Production, Preview, Development | Used by serverless functions in `api/`. |
    | `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role secret | **Production only** (and Preview if you want preview deploys to hit the same DB) | **NEVER expose to the browser.** Bypasses RLS. Treat like a database password. |
    | `CRON_SECRET` | Generate locally: `openssl rand -hex 32` | Production | Required for `/api/analytics/sync` cron auth. |
    | `RESEND_API_KEY` | Resend dashboard | Production, Preview | For transactional emails. |
    | `RESEND_FROM_EMAIL` | e.g. `Omnya Growth <noreply@mail.omnyagrowth.com>` | Production, Preview | Falls back to `onboarding@resend.dev` if unset. |
    | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | TikTok Developer Portal | Production, Preview | OAuth. |
    | `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` | Meta Developer Portal | Production, Preview | OAuth. |
    | `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` | Meta Developer Portal | Production, Preview | OAuth. |
    | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` | Google Cloud Console | Production, Preview | OAuth. |
    | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` | Google Cloud Console | Production, Preview | Drive uploads (review whether still needed — see SECURITY_NOTES.md). |
    | `ANTHROPIC_API_KEY` | Anthropic console | Production, Preview | Only if the AI insights server proxy is enabled. |

6.  **Important:** Go to the **Git** tab in settings and click **Redeploy** on your
    latest deployment to apply the new variables.

---

## Option 2: Vercel CLI (Faster for developers)

### 1. Install Vercel CLI
```bash
npm i -g vercel
```

### 2. Login to Vercel
```bash
vercel login
```
(Follow the browser prompts to log in).

### 3. Link your project
Run this inside your project folder:
```bash
vercel link
```
Select your account and project when prompted.

### 4. Add Environment Variables
You can add them one by one. The CLI will prompt for values — paste from the
provider dashboards, do not check values into source control.

```bash
vercel env add REACT_APP_SUPABASE_URL production
vercel env add REACT_APP_SUPABASE_ANON_KEY production
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add CRON_SECRET production
# ...repeat for every key in the table above.
```

### 5. Deploy
After adding variables, trigger a new deployment:
```bash
vercel --prod
```

---

## Local development

Create a `.env.local` (not committed; see `.gitignore`) using `.env.example` as
the template. The client-side build requires `REACT_APP_SUPABASE_URL` and
`REACT_APP_SUPABASE_ANON_KEY`; missing either will throw at runtime.
