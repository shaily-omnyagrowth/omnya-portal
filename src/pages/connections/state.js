import { Facebook01Icon, InstagramIcon, TiktokIcon, YoutubeIcon } from "@hugeicons/core-free-icons";

// "Sync now" re-pulls submission metrics, except TikTok, whose account-level sync has its own endpoint.
const ANALYTICS_SYNC = {
  endpoint: "/api/analytics/manual-sync",
  body: (platform) => ({ platform }),
  summarize: (d) => {
    const total = d?.submissionsTotal || 0;
    if (!total) return "No posted videos on this platform yet.";
    const parts = [`${d?.updated || 0} of ${total} ${total === 1 ? "video" : "videos"} refreshed`];
    if (d?.failed) parts.push(`${d.failed} failed`);
    if (d?.skipped) parts.push(`${d.skipped} skipped`);
    return parts.join(", ") + ".";
  },
};

const TIKTOK_SYNC = {
  endpoint: "/api/integrations/tiktok/sync",
  body: () => ({}),
  summarize: (d) =>
    !d ? "Synced." :
    d.video_access === "scope_not_granted" ? "Profile synced. TikTok didn't grant video access." :
    d.video_access === "denied" ? "Profile synced. Video access was denied." :
    d.video_access === "error" ? `Profile synced. Videos failed: ${d.video_error || "unknown error"}.` :
    d.videos_synced > 0 ? `${d.videos_synced} ${d.videos_synced === 1 ? "video" : "videos"} synced.` : "Up to date, no new videos.",
};

export const PLATFORM_META = {
  tiktok: { label: "TikTok", icon: TiktokIcon, subtitle: "Profile, videos and views", sync: TIKTOK_SYNC, scopeHints: [{ scope: "video.list", label: "Video access" }] },
  instagram: { label: "Instagram", icon: InstagramIcon, subtitle: "Reels and insights", sync: ANALYTICS_SYNC },
  facebook: { label: "Facebook", icon: Facebook01Icon, subtitle: "Pages and feed", sync: ANALYTICS_SYNC, guide: {
    steps: [
      "Press Connect and log in to Facebook.",
      "If Facebook asks to continue with your previous settings, choose Edit settings.",
      "If Facebook asks for Businesses, choose Opt in to current Businesses only and tick yours.",
      "When Facebook asks for Pages, choose Opt in to current Pages only and tick the Page you post on.",
      "Finish the remaining steps.",
    ],
    note: "You need access to the Page. Videos on a personal profile can't be tracked.",
  } },
  youtube: { label: "YouTube", icon: YoutubeIcon, subtitle: "Channel and Shorts", sync: ANALYTICS_SYNC },
};

// Order matches api/_utils/socialAccounts.js PLATFORMS.
export const VISIBLE_PLATFORMS = ["tiktok", "instagram", "facebook", "youtube"];

// The six values the creator_social_accounts.connection_status CHECK accepts.
const STATUS_META = {
  connected: { label: "Connected", tone: "green" },
  not_connected: { label: "Not connected", tone: "gray" },
  disconnected: { label: "Not connected", tone: "gray" },
  expired: { label: "Token expired", tone: "orange" },
  reauth_required: { label: "Reconnect required", tone: "orange" },
  sync_failed: { label: "Sync failed", tone: "red" },
};
const STATUS_ALIASES = { error: "sync_failed", needs_reauth: "reauth_required" };
// sync_failed keeps the token; matches REAUTH_STATUSES in api/_utils/socialAccounts.js.
const REAUTH_STATUSES = new Set(["expired", "reauth_required"]);
const OFF_STATUSES = new Set(["not_connected", "disconnected"]);
const REAUTH_REASON = {
  expired: "The access token has expired.",
  reauth_required: "This account needs to be authorized again.",
  sync_failed: "The last sync failed.",
};

// Folds one /api/social/connections row into what the card renders; the server's needsReauth wins.
export function deriveConnectionState(connection) {
  const raw = connection?.connectionStatus || connection?.status || "not_connected";
  const aliased = STATUS_ALIASES[raw] || raw;
  const status = STATUS_META[aliased] ? aliased : "not_connected";
  const tokenDead = !!(connection?.expiresAt && new Date(connection.expiresAt).getTime() < Date.now());
  const off = OFF_STATUSES.has(status);
  const needsReauth = !off && (REAUTH_STATUSES.has(status) || (connection?.needsReauth ?? tokenDead));
  const display = status === "connected" && needsReauth ? "expired" : status;
  const connected = display === "connected";
  return {
    status: display,
    connected,
    needsReauth,
    canSync: connected,
    action: off ? "connect" : needsReauth ? "reconnect" : "manage",
    reason: needsReauth ? REAUTH_REASON[display] || REAUTH_REASON.reauth_required : null,
    meta: STATUS_META[display],
  };
}

// Instagram and Facebook share one Meta login.
export const flowFor = (platform) => (platform === "facebook" ? "meta" : platform);

// Must match public/oauth-complete.js.
export const OAUTH_CHANNEL = "omnya-oauth";
export const OAUTH_STORAGE_KEY = "omnya_oauth_result";

export function platformFromError(code) {
  const prefix = String(code || "").split("_")[0];
  if (prefix === "meta") return "facebook";
  return PLATFORM_META[prefix] ? prefix : null;
}

const OAUTH_ERROR_TEXT = {
  auth_denied: "The sign in was cancelled or access wasn't granted. Choose Allow or Continue on every screen.",
  missing_params: "The provider sent you back without an authorization code. Start again.",
  invalid_state: "That sign in link expired or was already used (they last 10 minutes). Start again.",
  misconfigured: "This platform isn't fully set up on our side yet. Let your account manager know.",
  token_failed: "The provider refused to finish the sign in. This is usually a configuration issue on our side. Let your account manager know.",
  token_exchange_failed: "The provider refused to finish the sign in. This is usually a configuration issue on our side. Let your account manager know.",
  encryption_failed: "We couldn't store the connection securely, so nothing was saved. Let your account manager know.",
  storage_failed: "The sign in worked but we couldn't save it. Try again in a moment.",
  server_error: "Something went wrong on our side. Try again in a moment.",
};

export function describeOAuthError(code) {
  const clean = String(code || "").replace(/[^a-z0-9_]/gi, "");
  const reason = clean.replace(/^(tiktok|instagram|facebook|youtube|meta)_/, "");
  const text = OAUTH_ERROR_TEXT[reason] || "The connection couldn't be completed. Try again.";
  return clean ? `${text} (Reference: ${clean})` : text;
}
