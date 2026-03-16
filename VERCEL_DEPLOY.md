# Vercel Environment Variables Guide

## Option 1: Vercel Dashboard (Recommended for beginners)

1.  Go to [Vercel Dashboard](https://vercel.com/dashboard).
2.  Select your **Omnya Portal** project.
3.  Click on **Settings** (gear icon on the left).
4.  Click on **Environment Variables** in the right sidebar.
5.  Add each variable one by one:
    *   **Key:** `SUPABASE_URL`
    *   **Value:** `https://aglikzyarmqbdmjvkvyj.supabase.co`
    *   Select **Production**, **Preview**, and **Development** scopes.
    *   Click **Save**.
6.  Repeat for:
    *   `SUPABASE_ANON_KEY`: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnbGlrenlhcm1xYmRtanZrdnlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3MjMwNDcsImV4cCI6MjA4NzI5OTA0N30.vYAk33Z_x5lWkKc6zUhTxhHiWo2cZgk3dYmO7c0I6GM`
    *   `SUPABASE_SERVICE_ROLE_KEY`: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnbGlrenlhcm1xYmRtanZrdnlqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTcyMzA0NywiZXhwIjoyMDg3Mjk5MDQ3fQ.DVu4K0nIkRth28G2hBbcqYmrDYdkEPOZr0psfYYWZrg`
    *   And any other API keys you have.
7.  **Important:** Go to the **Git** tab in settings and click **Redeploy** on your latest deployment to apply the new variables.

---

## Option 2: Vercel CLI (Faster for developers)

### 1. Install Vercel CLI
Run this in your terminal:
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
You can add them one by one:

```bash
vercel env add SUPABASE_URL production
# Type or paste the value when prompted: https://aglikzyarmqbdmjvkvyj.supabase.co

vercel env add SUPABASE_ANON_KEY production
# Paste: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

vercel env add SUPABASE_SERVICE_ROLE_KEY production
# Paste: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 5. Deploy
After adding variables, trigger a new deployment:
```bash
vercel --prod
```
