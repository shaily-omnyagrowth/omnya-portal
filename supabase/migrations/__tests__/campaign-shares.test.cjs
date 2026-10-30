// Campaign share links: every campaign gets a distinct token, starts private, and the token is indexed.
//
//   node supabase/migrations/__tests__/campaign-shares.test.cjs

const { freshDb } = require('./db.cjs');

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

(async () => {
  console.log('\ncampaign share tokens');
  const db = await freshDb();
  const rows = (await db.query(`INSERT INTO public.campaigns (name, sales_commission_rate) VALUES ('One', 0.1), ('Two', 0.1)
    RETURNING share_token, share_enabled`)).rows;

  R(rows.every(r => typeof r.share_token === 'string' && r.share_token.length > 0), 'every campaign gets a share_token');
  R(new Set(rows.map(r => r.share_token)).size === rows.length, 'share tokens are distinct');
  R(rows.every(r => r.share_enabled === false), 'sharing starts off, so nothing becomes public by accident');
  const idx = (await db.query("SELECT 1 FROM pg_indexes WHERE indexname = 'idx_campaigns_share_token'")).rows.length;
  R(idx === 1, 'share_token is indexed');

  await db.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST BUG:', e); process.exit(1); });
