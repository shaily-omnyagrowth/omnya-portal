// enforce_videos_needed() and complete_campaign_when_full(): videos needed caps a campaign and completes it.
//
//   node supabase/migrations/__tests__/campaign-videos-needed.test.cjs

const { freshDb } = require('./db.cjs');

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

(async () => {
  console.log('\ncampaign videos needed');
  const db = await freshDb();
  const CR = 'e0000000-0000-0000-0000-0000000000b1';
  await db.query(`insert into public.creators (id, name, email) values ($1, 'Ada', 'ada@example.com')`, [CR]);

  const campaign = async (needed) => (await db.query(
    `insert into public.campaigns (name, videos_needed, status) values ('C', $1, 'Open') returning id`, [needed])).rows[0].id;
  const submit = async (id, type = 'Final') => (await db.query(
    `insert into public.submissions (creator_id, campaign_id, submission_type, status) values ($1, $2, $3, 'Submitted') returning id`, [CR, id, type])).rows[0].id;
  const setStatus = (id, status) => db.query(`update public.submissions set status = $1 where id = $2`, [status, id]);
  const status = async (id) => (await db.query(`select status from public.campaigns where id = $1`, [id])).rows[0].status;
  const refused = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

  const c = await campaign(2);
  const a = await submit(c), b = await submit(c), extra = await submit(c);
  await setStatus(a, 'Approved');
  R(await status(c) === 'Open', 'a campaign stays open below videos needed');

  const concept = await submit(c, 'Concept');
  await setStatus(concept, 'Approved');
  R(await status(c) === 'Open', 'an approved concept does not count');

  await setStatus(b, 'Approved');
  R(await status(c) === 'Completed', 'the last needed approval completes the campaign');

  let msg = await refused(() => submit(c));
  R(/already has the 2 approved videos/.test(msg || ''), 'a new submission is refused once met', msg);
  msg = await refused(() => setStatus(extra, 'Approved'));
  R(/already has the 2 approved videos/.test(msg || ''), 'an extra approval is refused once met', msg);
  R(await refused(() => setStatus(extra, 'Rejected')) === null, 'an extra video can still be rejected');
  R(await refused(() => setStatus(a, 'Published/Tracked')) === null, 'an approved video can still move to tracked');

  await db.query(`update public.campaigns set videos_needed = 3, status = 'Open' where id = $1`, [c]);
  R(await refused(() => submit(c)) === null, 'raising videos needed reopens submissions');

  const open = await campaign(0);
  const o = await submit(open);
  await setStatus(o, 'Approved');
  R(await status(open) === 'Open', 'no videos needed means no limit');

  const archived = await campaign(1);
  const ar = await submit(archived);
  await db.query(`update public.campaigns set status = 'Archived' where id = $1`, [archived]);
  await setStatus(ar, 'Approved');
  R(await status(archived) === 'Archived', 'an archived campaign stays archived');

  const { rows } = await db.query(`select proname from pg_proc where proname in ('campaign_approved_videos','enforce_videos_needed','complete_campaign_when_full') and prosecdef`);
  R(rows.length === 3, 'the checks ignore RLS, so a creator sees the full count', String(rows.length));

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
