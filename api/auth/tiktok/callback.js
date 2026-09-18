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
// THIS IS NOW THE DEFAULT TIKTOK REDIRECT URI, so it must not be deleted.
//
// Every TikTok route takes its redirect URI from redirectUriFor('tiktok') in
// api/_utils/oauth.js, which defaults to ${APP_BASE_URL}/api/auth/tiktok/callback
// -- this path -- because that is the one SOCIAL_MEDIA_INTEGRATION.md tells the
// operator to register in the TikTok developer console.
//
// It used to be worse than ambiguous. api/integrations/tiktok/connect.js (what
// the Connect button actually calls) defaulted to
// /api/integrations/tiktok/callback, so a console configured from the setup
// guide never matched what the portal sent. TikTok rejects that on its own
// domain, with "Something went wrong", and offers no way back.
//
// TIKTOK_REDIRECT_URI still overrides the default if the console was registered
// with something else. The owner's System Config page shows the value in use.

module.exports = require('../../integrations/tiktok/callback');
