// api/auth/tiktok/start.js
//
// POST /api/auth/tiktok/start
//
// DELEGATES to api/integrations/tiktok/connect.js. This file no longer builds
// the authorization URL itself.
//
// WHY  (F-13)
//
// It used to construct its own TikTok authorization URL, whose callback wrote
// plaintext tokens to creator_tokens. api/integrations/tiktok/connect.js does
// the same job and its callback encrypts into creator_social_accounts.
//
// Two starts pointing at two callbacks is how the codebase ended up with two
// TikTok integrations in the first place. Keeping the route but delegating the
// behaviour means an old client calling this endpoint is now sent through the
// encrypted flow, while nothing that already calls it breaks.
//
// Nothing in src/ calls this endpoint -- the UI uses
// /api/integrations/tiktok/connect directly -- so this exists purely for any
// caller outside the repo. See the companion note in ./callback.js for why the
// pair is delegated rather than deleted.

module.exports = require('../../integrations/tiktok/connect');
