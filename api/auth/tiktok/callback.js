// api/auth/tiktok/callback.js
//
// GET /api/auth/tiktok/callback?code=...&state=...
//
// DELEGATES to api/integrations/tiktok/callback.js. This file no longer
// implements the flow.
//
// WHY THIS ROUTE STILL EXISTS  (F-13)
//
// There were two TikTok integrations writing to two different tables:
//
//   this path                     -> creator_tokens          plaintext
//   api/integrations/tiktok/*     -> creator_social_accounts  AES-256-GCM
//
// The integrations path is the one that is kept: better schema, encrypted
// tokens, and its callback is the one that actually stores a connection.
//
// The UI no longer calls it directly. src/TikTokConnect.js has been deleted and
// TikTok is now a fourth card in src/CreatorConnections.js on the same
// /api/auth/{platform}/start flow as Instagram, Facebook and YouTube — which
// reaches api/integrations/tiktok/connect.js through the delegation below.
//
// Deleting this route outright is not safe. Both api/auth/tiktok/start.js and
// api/integrations/tiktok/connect.js read the SAME TIKTOK_REDIRECT_URI
// environment variable and only fall back to their own path when it is unset.
// So whichever URI is registered in the TikTok developer console decides which
// of the two callbacks TikTok actually calls -- and that value is not visible
// from here. If it points at this path and this path disappears, every TikTok
// connection breaks with a redirect_uri mismatch.
//
// Delegating costs one function call and removes the divergence either way:
// whichever URI is registered, the request is handled by the encrypted
// implementation and nothing new is ever written to creator_tokens.
//
// The redirect target differs slightly between the two (this one sent the
// browser to page=social-connections, the other sends it to
// page=tiktok-connect). That is the integrations handler's business now;
// reconciling the two Social Channels screens is tracked separately.
//
// This file can be deleted once TIKTOK_REDIRECT_URI is confirmed to point at
// /api/integrations/tiktok/callback.

module.exports = require('../../integrations/tiktok/callback');
