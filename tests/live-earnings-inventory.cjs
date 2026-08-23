// tests/live-earnings-inventory.cjs
//
// READ ONLY. Settles the open question in section 9.2 of the scope spec:
//
//   "The threshold schedule is documented historically, but the calculation
//    mode must be confirmed: tiered 'highest qualifying bonus only' versus
//    cumulative awards. Restoration must not guess; production data and prior
//    code should determine the existing rule."
//
// The prior code (api/_lib/paymentCalculations.js) is unambiguous: getBonusTier
// returns the FIRST matching tier from a descending list, so it awards the
// highest qualifying bonus only. This asks the other half of the question —
// what production actually paid — by looking for a submission whose view count
// crosses more than one threshold and comparing the bonus recorded against it.
//
// A cumulative rule at 250,000 views would have paid 50 + 150 + 250 = 450.
// A tiered rule pays 250. One real row decides it.
//
//   node tests/live-earnings-inventory.cjs

const { select } = require('./lib/schema.cjs');

const TIERS = [
  { minViews: 10000000, bonus: 1000, label: '10M+' },
  { minViews: 1000000,  bonus: 500,  label: '1M'   },
  { minViews: 500000,   bonus: 350,  label: '500K' },
  { minViews: 250000,   bonus: 250,  label: '250K' },
  { minViews: 100000,   bonus: 150,  label: '100K' },
  { minViews: 50000,    bonus: 50,   label: '50K'  },
];

const tieredFor = views => (TIERS.find(t => views >= t.minViews) || { bonus: 0 }).bonus;
const cumulativeFor = views =>
  TIERS.filter(t => views >= t.minViews).reduce((sum, t) => sum + t.bonus, 0);

(async () => {
  console.log('\nEarnings inventory  (read-only)\n');

  const earnings = await select('creator_earnings',
    ['id', 'creator_id', 'submission_id', 'earning_type', 'amount', 'status', 'bonus_tier', 'views_counted']);

  console.log(`  creator_earnings         ${earnings.length} row(s)`);

  if (earnings.length === 0) {
    console.log('\n  The table is empty, so production data cannot settle the');
    console.log('  tiered-vs-cumulative question in scope spec section 9.2.');
    console.log('  The only evidence available is the prior code, which awards');
    console.log('  the HIGHEST QUALIFYING BONUS ONLY (api/_lib/paymentCalculations.js,');
    console.log('  getBonusTier returns the first match of a descending list).');
    console.log('\n  That needs an explicit decision before go-live, not an assumption.\n');
    return;
  }

  const byType = earnings.reduce((m, r) => {
    m[r.earning_type || '(null)'] = (m[r.earning_type || '(null)'] || 0) + 1;
    return m;
  }, {});
  for (const [t, n] of Object.entries(byType).sort()) {
    console.log(`    ${String(t).padEnd(20)} ${n}`);
  }

  // The decisive rows: a bonus on a submission that crosses two or more tiers.
  const bonuses = earnings.filter(r => r.earning_type === 'performance_bonus');
  const decisive = bonuses.filter(r => Number(r.views_counted) >= 100000);

  console.log(`\n  performance_bonus rows   ${bonuses.length}`);
  console.log(`  crossing 2+ thresholds   ${decisive.length}`);

  if (decisive.length === 0) {
    console.log('\n  No bonus row crosses more than one threshold, so production');
    console.log('  data still cannot distinguish the two rules. Decide explicitly.\n');
    return;
  }

  console.log('\n  views      paid    tiered   cumulative   verdict');
  console.log('  ' + '-'.repeat(56));
  let tieredVotes = 0, cumulativeVotes = 0, neither = 0;
  for (const r of decisive) {
    const v = Number(r.views_counted), paid = Number(r.amount);
    const t = tieredFor(v), c = cumulativeFor(v);
    const verdict = paid === t ? 'TIERED' : paid === c ? 'CUMULATIVE' : 'neither';
    if (verdict === 'TIERED') tieredVotes++;
    else if (verdict === 'CUMULATIVE') cumulativeVotes++;
    else neither++;
    console.log(`  ${String(v).padEnd(10)} ${String(paid).padEnd(7)} ${String(t).padEnd(8)} ${String(c).padEnd(12)} ${verdict}`);
  }

  console.log('\n  ' + '-'.repeat(56));
  console.log(`  tiered ${tieredVotes} · cumulative ${cumulativeVotes} · neither ${neither}`);
  if (neither > 0) {
    console.log('\n  Rows matching NEITHER rule mean the recorded amounts do not follow');
    console.log('  the documented schedule at all. Investigate before go-live.');
  }
  console.log('');
})().catch(e => { console.error('PROBE FAILED:', e.message); process.exit(2); });
