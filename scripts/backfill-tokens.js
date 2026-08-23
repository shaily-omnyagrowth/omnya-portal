#!/usr/bin/env node
//
// scripts/backfill-tokens.js
//
// Moves the OAuth connections in public.creator_tokens (plaintext) into
// public.creator_social_accounts (AES-256-GCM), then optionally erases the
// plaintext it has verified.
//
// WHY THIS IS A SCRIPT AND NOT A MIGRATION
//
// The encryption cannot happen inside PostgreSQL. The wire format --
// base64([ IV 12B | GCM tag 16B | ciphertext ]) -- is defined in
// api/_utils/encryption.js and the key lives only in ENCRYPTION_KEY, in the
// server environment. A SQL migration has access to neither.
//
// USAGE
//
//   node scripts/backfill-tokens.js --dry-run   report what would move, touch nothing
//   node scripts/backfill-tokens.js             encrypt and upsert
//   node scripts/backfill-tokens.js --scrub     null the plaintext of verified rows
//   node scripts/backfill-tokens.js --force     re-migrate rows already present
//
// Run 20260822000002_token_migration.sql FIRST. It drops the NOT NULL on
// access_token; without it --scrub fails with 23502 on every row.
//
// SAFETY
//
//   · Idempotent. A row already present in creator_social_accounts with a
//     non-null access_token_encrypted is skipped unless --force.
//   · --scrub NEVER erases a row it has not personally read back and decrypted
//     to an exact match of the plaintext. Verification is per row, not per run.
//   · --scrub and the migration phase are separate on purpose. Migrate, let the
//     app run against the new table, and only then erase.
//   · Nothing is deleted, ever. The legacy row survives with its metadata; only
//     the two token columns are nulled.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Load .env the way the serverless runtime would.
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const { createClient } = require('@supabase/supabase-js');
const { encrypt, decrypt } = require(path.join(ROOT, 'api/_utils/encryption'));
const { storagePlatform, PLATFORMS } = require(path.join(ROOT, 'api/_utils/socialAccounts'));

const argv    = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const SCRUB   = argv.includes('--scrub');
const FORCE   = argv.includes('--force');

const c = {
  dim:  s => `\x1b[2m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
  ok:   s => `\x1b[32m${s}\x1b[0m`,
  warn: s => `\x1b[33m${s}\x1b[0m`,
  err:  s => `\x1b[31m${s}\x1b[0m`,
};

function die(message, hint) {
  console.error('\n' + c.err('CANNOT RUN: ') + message);
  if (hint) console.error('  ' + hint);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Preflight. Every one of these is a reason the run would silently do the
// wrong thing rather than fail, so each is checked before anything is touched.
// ---------------------------------------------------------------------------

function preflight() {
  const key = (process.env.ENCRYPTION_KEY || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    die(
      `ENCRYPTION_KEY is ${key ? `${key.length} chars, not 64 hex` : 'not set'}.`,
      'Generate one with:\n    node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n' +
      '  It must be the SAME key the API uses, or nothing it writes will be readable.'
    );
  }

  const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) die('SUPABASE_URL is not set.');
  if (!svc) die('SUPABASE_SERVICE_ROLE_KEY is not set.', 'The service role is required: RLS denies this table to every other role.');

  // Prove the key round-trips before touching a single row. A key that is
  // valid hex but wrong produces ciphertext nothing can read, and we would not
  // find out until the scrub phase had already erased the plaintext.
  const probe = 'backfill-preflight-' + Date.now();
  if (decrypt(encrypt(probe)) !== probe) {
    die('ENCRYPTION_KEY failed a local round-trip.', 'Refusing to write ciphertext that cannot be read back.');
  }

  return createClient(url, svc, { auth: { persistSession: false } });
}

// ---------------------------------------------------------------------------

function mapLegacyRow(row) {
  // 'meta' is a flow label, not a storable platform -- the live CHECK accepts
  // only tiktok | instagram | facebook | youtube. A Meta connection lands on
  // the facebook row and records provider='meta' so analytics can still route
  // Instagram reads through it.
  const platform = storagePlatform(row.platform);
  if (!PLATFORMS.includes(platform)) return { skip: `unsupported platform '${row.platform}'` };
  if (!row.user_id) return { skip: 'row has no user_id' };
  if (!row.access_token) return { skip: 'no access_token' };

  // Preserve the ORIGINAL issue time rather than stamping now. Instagram
  // refuses to refresh a token younger than 24 hours; stamping now would make
  // every backfilled Instagram token look brand new and unrefreshable for a
  // day, exactly when we most want to refresh it.
  const issuedAt = row.updated_at || row.created_at || new Date().toISOString();

  return {
    row: {
      user_id: row.user_id,
      platform,
      platform_user_id: row.platform_user_id || row.account_id || null,
      username: row.platform_username || row.account_name || null,
      display_name: row.account_name || null,
      access_token_encrypted: encrypt(row.access_token),
      refresh_token_encrypted: encrypt(row.refresh_token),
      token_expires_at: row.expires_at || null,
      refresh_token_expires_at: row.refresh_expires_at || null,
      scopes: Array.isArray(row.scopes) ? row.scopes : [],
      connection_status: 'connected',
      last_error: null,
      last_synced_at: row.last_synced_at || null,
      metadata: {
        ...(row.metadata && typeof row.metadata === 'object' ? row.metadata : {}),
        provider: row.platform === 'meta' ? 'meta' : row.platform,
        token_issued_at: issuedAt,
        backfilled_from: 'creator_tokens',
        backfilled_at: new Date().toISOString(),
        legacy_token_id: row.id,
      },
      created_at: row.created_at || undefined,
      updated_at: new Date().toISOString(),
    },
    plaintext: { access: row.access_token, refresh: row.refresh_token || null },
    legacyId: row.id,
  };
}

// ---------------------------------------------------------------------------

async function main() {
  const supabase = preflight();

  console.log('\n' + c.bold('Token backfill') + '  creator_tokens -> creator_social_accounts');
  console.log(c.dim(`  mode: ${DRY_RUN ? 'DRY RUN (nothing is written)' : SCRUB ? 'MIGRATE + SCRUB' : 'MIGRATE'}${FORCE ? ' +FORCE' : ''}`));

  const { data: legacy, error: readErr } = await supabase
    .from('creator_tokens')
    .select('*')
    .not('access_token', 'is', null);

  if (readErr) die(`could not read creator_tokens: ${readErr.message}`);
  if (!legacy || legacy.length === 0) {
    console.log('\n' + c.ok('Nothing to do') + ' -- no creator_tokens row holds a plaintext access_token.\n');
    return 0;
  }

  const { data: existing, error: exErr } = await supabase
    .from('creator_social_accounts')
    .select('id, user_id, platform, access_token_encrypted');
  if (exErr) die(`could not read creator_social_accounts: ${exErr.message}`);

  const already = new Set(
    (existing || [])
      .filter(a => a.access_token_encrypted)
      .map(a => `${a.user_id}_${a.platform}`)
  );

  const stats  = { migrated: 0, skipped: 0, failed: 0, scrubbed: 0, verified: 0 };
  const byPlat = {};
  const problems = [];
  const verifiedLegacyIds = [];

  console.log(c.dim(`  ${legacy.length} legacy row(s) with a token\n`));

  for (const row of legacy) {
    const mapped = mapLegacyRow(row);
    const label = `${String(row.platform).padEnd(10)} user=${String(row.user_id || '?').slice(0, 8)}`;

    if (mapped.skip) {
      stats.skipped += 1;
      problems.push({ id: row.id, reason: mapped.skip });
      console.log(`  ${c.warn('SKIP')}     ${label}  ${c.dim(mapped.skip)}`);
      continue;
    }

    const key = `${mapped.row.user_id}_${mapped.row.platform}`;
    if (already.has(key) && !FORCE) {
      stats.skipped += 1;
      console.log(`  ${c.dim('PRESENT')}  ${label}  ${c.dim('-> ' + mapped.row.platform + ' already migrated')}`);
      continue;
    }

    if (DRY_RUN) {
      stats.migrated += 1;
      byPlat[mapped.row.platform] = (byPlat[mapped.row.platform] || 0) + 1;
      console.log(`  ${c.dim('WOULD')}    ${label}  ${c.dim('-> ' + mapped.row.platform)}`);
      continue;
    }

    const { error: upErr } = await supabase
      .from('creator_social_accounts')
      .upsert(mapped.row, { onConflict: 'user_id,platform' });

    if (upErr) {
      stats.failed += 1;
      problems.push({ id: row.id, reason: `upsert failed: ${upErr.message}` });
      console.log(`  ${c.err('FAIL')}     ${label}  ${upErr.message}`);
      continue;
    }

    // Read it back and decrypt it. Not a formality: this is the only thing
    // standing between a bad write and --scrub erasing the original.
    const { data: back, error: backErr } = await supabase
      .from('creator_social_accounts')
      .select('access_token_encrypted, refresh_token_encrypted')
      .eq('user_id', mapped.row.user_id)
      .eq('platform', mapped.row.platform)
      .single();

    let verified = false;
    if (!backErr && back) {
      try {
        const accessOk = decrypt(back.access_token_encrypted) === mapped.plaintext.access;
        const refreshOk = mapped.plaintext.refresh
          ? decrypt(back.refresh_token_encrypted) === mapped.plaintext.refresh
          : true;
        verified = accessOk && refreshOk;
      } catch (e) {
        verified = false;
        problems.push({ id: row.id, reason: `round-trip threw: ${e.message}` });
      }
    }

    stats.migrated += 1;
    byPlat[mapped.row.platform] = (byPlat[mapped.row.platform] || 0) + 1;

    if (verified) {
      stats.verified += 1;
      verifiedLegacyIds.push(mapped.legacyId);
      console.log(`  ${c.ok('OK')}       ${label}  ${c.dim('-> ' + mapped.row.platform + ', round-trip verified')}`);
    } else {
      problems.push({ id: row.id, reason: 'stored but round-trip NOT verified -- will not be scrubbed' });
      console.log(`  ${c.warn('UNVERIF')}  ${label}  ${c.dim('stored, but could not be read back')}`);
    }
  }

  // -------------------------------------------------------------------------
  // Scrub. Verified rows only, and only ones this run verified itself.
  // -------------------------------------------------------------------------

  if (SCRUB && !DRY_RUN && verifiedLegacyIds.length) {
    console.log('\n' + c.bold('Scrubbing plaintext') + c.dim(` (${verifiedLegacyIds.length} verified row(s))`));
    for (const id of verifiedLegacyIds) {
      const { error } = await supabase
        .from('creator_tokens')
        .update({
          access_token: null,
          refresh_token: null,
          status: 'migrated',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (error) {
        problems.push({ id, reason: `scrub failed: ${error.message}` });
        console.log(`  ${c.err('FAIL')}     ${String(id).slice(0, 8)}  ${error.message}`);
        if (/23502|null value/i.test(error.message)) {
          console.log('  ' + c.dim('    access_token is still NOT NULL -- apply 20260822000002_token_migration.sql first.'));
        }
      } else {
        stats.scrubbed += 1;
      }
    }
  } else if (SCRUB && !DRY_RUN) {
    console.log('\n' + c.warn('Nothing scrubbed') + ' -- no row was verified this run.');
  }

  // -------------------------------------------------------------------------

  console.log('\n' + c.bold('Summary'));
  console.log(`  migrated   ${stats.migrated}`);
  console.log(`  verified   ${stats.verified}`);
  console.log(`  skipped    ${stats.skipped}`);
  console.log(`  failed     ${stats.failed}`);
  if (SCRUB) console.log(`  scrubbed   ${stats.scrubbed}`);

  const plats = Object.keys(byPlat).sort();
  if (plats.length) {
    console.log('\n  by platform');
    for (const p of plats) console.log(`    ${p.padEnd(12)} ${byPlat[p]}`);
  }

  if (problems.length) {
    console.log('\n' + c.warn('Needs attention'));
    for (const p of problems) console.log(`  ${String(p.id).slice(0, 8)}  ${p.reason}`);
  }

  if (DRY_RUN) {
    console.log('\n' + c.dim('Dry run -- nothing was written. Re-run without --dry-run to apply.'));
  } else if (!SCRUB && stats.verified > 0) {
    console.log('\n' + c.dim(`${stats.verified} row(s) are verified and ready. Re-run with --scrub to erase the plaintext.`));
  }

  console.log('');
  return stats.failed > 0 ? 1 : 0;
}

main()
  .then(code => process.exit(code))
  .catch(err => {
    console.error('\n' + c.err('UNEXPECTED: ') + (err && err.stack ? err.stack : err));
    process.exit(2);
  });
