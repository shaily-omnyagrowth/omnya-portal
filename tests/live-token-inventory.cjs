// tests/live-token-inventory.cjs
//
// READ ONLY. Counts what the token backfill would actually have to move.
//
// Answers the question scripts/backfill-tokens.js cannot answer without a
// working ENCRYPTION_KEY: how many live connections are still sitting in the
// legacy plaintext table, and how many have already moved.
//
// Writes nothing. Prints no token material.
//
//   node tests/live-token-inventory.cjs

const { select } = require('./lib/schema.cjs');

const pad = (s, n) => String(s).padEnd(n);

(async () => {
  console.log('\nLive token inventory  (read-only)\n');

  const legacy = await select(
    'creator_tokens',
    ['id', 'user_id', 'platform', 'expires_at', 'status']
  ).catch(e => { throw new Error('creator_tokens: ' + e.message); });

  const modern = await select(
    'creator_social_accounts',
    ['id', 'user_id', 'platform', 'connection_status', 'token_expires_at']
  ).catch(e => { throw new Error('creator_social_accounts: ' + e.message); });

  // Whether a token column holds anything, without ever selecting the value.
  const withToken = await select('creator_tokens', ['id']).catch(() => []);

  const tally = (rows, key) => rows.reduce((m, r) => {
    const k = r[key] || '(null)';
    m[k] = (m[k] || 0) + 1;
    return m;
  }, {});

  console.log(`  creator_tokens           ${legacy.length} row(s)   ${'←'} legacy, plaintext`);
  const lp = tally(legacy, 'platform');
  for (const p of Object.keys(lp).sort()) console.log(`    ${pad(p, 14)} ${lp[p]}`);

  console.log(`\n  creator_social_accounts  ${modern.length} row(s)   ${'←'} encrypted`);
  const mp = tally(modern, 'platform');
  for (const p of Object.keys(mp).sort()) console.log(`    ${pad(p, 14)} ${mp[p]}`);

  const ms = tally(modern, 'connection_status');
  if (modern.length) {
    console.log('\n  connection_status');
    for (const s of Object.keys(ms).sort()) console.log(`    ${pad(s, 18)} ${ms[s]}`);
  }

  // What the backfill would move: a legacy (user_id, platform) with no
  // encrypted counterpart. 'meta' maps onto 'facebook' on the way across.
  const present = new Set(modern.map(r => `${r.user_id}_${r.platform}`));
  const toMove = legacy.filter(r => {
    if (!r.user_id) return false;
    const p = r.platform === 'meta' ? 'facebook' : r.platform;
    return !present.has(`${r.user_id}_${p}`);
  });
  const noUser = legacy.filter(r => !r.user_id);

  console.log('\n  ' + '-'.repeat(52));
  console.log(`  would migrate            ${toMove.length}`);
  console.log(`  already migrated         ${legacy.length - toMove.length - noUser.length}`);
  console.log(`  unmigratable (no user_id) ${noUser.length}`);

  if (legacy.length === 0) {
    console.log('\n  Nothing to migrate. The legacy table is empty.');
  }
  console.log('');
  void withToken;
})().catch(e => { console.error('PROBE FAILED:', e.message); process.exit(2); });
