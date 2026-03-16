# Omnya Portal - Environment Variables

This project requires several environment variables to function correctly. These variables are used for authentication, API integrations, and database connections.

## Supabase

- `SUPABASE_URL`: The URL of your Supabase project (e.g., `https://your-project.supabase.co`).
- `SUPABASE_ANON_KEY`: The anonymous public key from your Supabase project settings (Project Settings -> API).
- `SUPABASE_SERVICE_ROLE_KEY`: (Optional for server-side functions) The service role key with elevated privileges. **Do not expose this in client-side code.**

## Social Media APIs

To enable analytics fetching for creators, you need to set up developer apps for the respective platforms and obtain API keys/tokens.

- `TIKTOK_APP_KEY`: Your TikTok Developer App Key.
- `TIKTOK_APP_SECRET`: Your TikTok Developer App Secret.
- `INSTAGRAM_APP_KEY`: Your Instagram/Meta App Key.
- `INSTAGRAM_APP_SECRET`: Your Instagram/Meta App Secret.
- `YOUTUBE_API_KEY`: Your Google Cloud Console Project API Key (enabled for YouTube Data API v3).
- `FACEBOOK_APP_KEY`: Your Facebook/Meta App Key.
- `FACEBOOK_APP_SECRET`: Your Facebook/Meta App Secret.

## Email (Resend)

- `RESEND_API_KEY`: Your Resend API key for sending transactional emails.

## Anthropic (AI)

- `ANTHROPIC_API_KEY`: Your Anthropic API key for AI features (Video Insights).

---

## Adding Variables to Vercel

1.  Go to your project dashboard on [Vercel](https://vercel.com).
2.  Select your project.
3.  Go to **Settings** -> **Environment Variables**.
4.  Add each variable with its corresponding value.
5.  Ensure you add `SUPABASE_URL` and `SUPABASE_ANON_KEY` as **Production**, **Development**, and **Preview** variables so they are available in all environments.
6.  For server-side functions (like `/api/analytics`), you may also need to add `SUPABASE_SERVICE_ROLE_KEY` and any other secret keys.
7.  Redeploy your project (or push a new commit) to ensure the new environment variables are loaded.

## Local Development

Create a `.env.local` file in the root directory (if not already present) to store these variables locally:

```bash
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
# Add other keys as needed
```
