// api/_utils/tiktokLink.js
//
// Rules for TikTok profile link tracking (spec 0002) that more than one route
// needs: turning what a creator pasted into a handle, issuing bio codes,
// deciding when a fetched view count may be written, and answering
// "migration not applied" the same way everywhere (AC-19).
//
// The provider calls live in tiktokPublic.js; this file is pure logic plus
// small Supabase helpers, so it is testable offline.

const crypto = require('crypto');
const { sendError } = require('./errors');
const { resolveShortLink } = require('./analytics');
const { needsReauth } = require('./socialAccounts');

const MIGRATION = 'supabase/SETUP.sql';

const LINK_CODE_TTL_DAYS = 7;
const CODE_PREFIX = 'OMNYA-';
// Crockford base32: no I, L, O or U, so a code read off a phone screen and
// typed into a bio cannot be mistyped as a lookalike.
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 6;

const HANDLE_RE = /^[a-z0-9._]{2,24}$/;
const SHORT_LINK_RE = /^(?:https?:\/\/)?(?:(?:vm|vt)\.tiktok\.com\/|(?:www\.)?tiktok\.com\/t\/)/i;

// Sanity cap (AC-8): a jump past 20x a stored count of at least 1,000 needs
// two fetches in a row to agree before it is written.
const JUMP_FACTOR = 20;
const JUMP_MIN_STORED = 1000;

// Single video lookup bounds (AC-8).
const LOOKUP_MAX_AGE_DAYS = 45;
const LOOKUP_REFRESH_HOURS = 24;
const LOOKUP_NOT_FOUND_TTL_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Handles and codes
// ---------------------------------------------------------------------------

// Accepts handle, @handle, https://www.tiktok.com/@handle (with any trailing
// path or query) and vm.tiktok.com / tiktok.com/t/ short links. Returns the
// lowercase handle, or null when the input is none of those (AC-1).
async function normalizeHandle(input) {
  if (typeof input !== 'string') return null;
  let value = input.trim();
  if (!value || value.length > 300) return null;

  if (SHORT_LINK_RE.test(value)) value = await resolveShortLink(value);

  let handle;
  if (/tiktok\.com/i.test(value)) {
    const m = value.match(/tiktok\.com\/@([A-Za-z0-9._]+)/i);
    if (!m) return null;
    handle = m[1];
  } else {
    handle = value.replace(/^@/, '');
  }
  handle = handle.toLowerCase();
  return HANDLE_RE.test(handle) ? handle : null;
}

function generateCode() {
  let code = CODE_PREFIX;
  for (let i = 0; i < CODE_LENGTH; i += 1) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return code;
}

function codeExpiresAt(now = Date.now()) {
  return new Date(now + LINK_CODE_TTL_DAYS * DAY_MS).toISOString();
}

// Case insensitive: bios get retyped, and TikTok shows them as typed.
function bioHasCode(bio, code) {
  if (!code) return false;
  return String(bio || '').toUpperCase().includes(String(code).toUpperCase());
}

function codeExpired(row, now = Date.now()) {
  return !row || !row.link_code_expires_at || new Date(row.link_code_expires_at).getTime() <= now;
}

// ---------------------------------------------------------------------------
// The link job's write rules
// ---------------------------------------------------------------------------

// A usable OAuth token makes OAuth the source of this creator's TikTok views
// (AC-9). The same test the OAuth sync uses, on the same row.
function hasUsableOAuth(row) {
  return Boolean(row && row.access_token_encrypted) && !needsReauth(row);
}

// AC-8 sanity cap. `previousFetch` is creator_videos.view_count for this video
// read BEFORE this run's upsert (null when the video is new to us).
function checkJump({ newViews, storedVerified, previousFetch }) {
  const stored = Number(storedVerified) || 0;
  if (stored < JUMP_MIN_STORED) return { apply: true };
  const line = stored * JUMP_FACTOR;
  if (newViews <= line) return { apply: true };
  if (previousFetch != null && Number(previousFetch) > line) return { apply: true };
  return { apply: false, held: true };
}

// AC-8: may this submission's video be fetched on its own, outside the feed?
function lookupEligible(sub, notFoundAt, now = Date.now()) {
  const posted = new Date(sub.posted_at || sub.created_at || 0).getTime();
  if (!posted || now - posted > LOOKUP_MAX_AGE_DAYS * DAY_MS) return false;
  if (sub.view_count_verified_at &&
      now - new Date(sub.view_count_verified_at).getTime() < LOOKUP_REFRESH_HOURS * 60 * 60 * 1000) {
    return false;
  }
  if (notFoundAt && now - new Date(notFoundAt).getTime() < LOOKUP_NOT_FOUND_TTL_DAYS * DAY_MS) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Migration not applied (AC-19)
//
// errors.js isSchemaMissing() covers a missing column. A route here can also
// hit a missing table (social_profile_snapshots) or function
// (apply_verified_views), so the set is wider, and the answer is a 503 that
// names the file rather than a 500.
// ---------------------------------------------------------------------------

const MIGRATION_MISSING_CODES = new Set(['42703', '42P01', '42883', 'PGRST202', 'PGRST204', 'PGRST205']);

function isLinkSchemaMissing(err) {
  return Boolean(err) && MIGRATION_MISSING_CODES.has(String(err.code));
}

function sendMigrationMissing(res) {
  return sendError(res, 503, 'migration_missing',
    `TikTok link tracking is not switched on yet. Run npm run db:migrate (${MIGRATION} on a fresh project), then retry.`,
    { migration: MIGRATION });
}

module.exports = {
  MIGRATION,
  LINK_CODE_TTL_DAYS,
  normalizeHandle,
  generateCode,
  codeExpiresAt,
  bioHasCode,
  codeExpired,
  hasUsableOAuth,
  checkJump,
  lookupEligible,
  isLinkSchemaMissing,
  sendMigrationMissing,
};
