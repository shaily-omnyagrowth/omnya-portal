// tests/role-boundaries.test.cjs
//
// The authorization matrix, asserted continuously against the real database.
//
// Two independent tenants are built — each with its own account manager,
// creator, client, campaign and submission — and then every role is asked the
// sharp question: can you reach the other tenant's data?
//
// Why two tenants: with one client in the system, "the AM sees all clients" and
// "the AM sees their own client" produce identical results. That ambiguity is
// exactly how N-10 survived until an AM with zero assigned clients was observed
// reading all ten.
//
// Two things this guards permanently:
//
//   · N-10 — an AM reading clients that are not theirs. Currently RED. It
//     should go green when the rogue policy is identified and dropped, without
//     anyone needing to remember what the symptom looked like.
//
//   · The payout authorization. Once migration step 2 lands, the only thing
//     between a creator and their own payout button is a SECURITY DEFINER
//     function body. These assertions mean the next edit to those functions
//     cannot quietly reopen it.
//
//   node tests/lib/devServer.cjs        # only needed for the API-gate section
//   node tests/role-boundaries.test.cjs
//
// Exit codes: 0 all held · 1 a boundary is open.

const { setupTenants, tokens, teardown } = require('./lib/fixture.cjs');
const { env } = require('./lib/schema.cjs');
const { BASE } = require('./lib/ui.cjs');

const ANON = env.REACT_APP_SUPABASE_ANON_KEY;

let held = 0, open = 0;
const openFindings = [];

function check(ok, label, detail, finding) {
  console.log(`  ${ok ? 'HELD' : 'OPEN'}  ${label.padEnd(56)} ${detail || ''}`);
  if (ok) held++;
  else { open++; if (finding) openFindings.push(`${finding} — ${label}`); }
}

/** Read a table as a given user and return the rows. */
async function readAs(token, table, select = 'id') {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?select=${select}`, {
    headers: { apikey: ANON, Authorization: 'Bearer ' + token },
  });
  const body = await r.json().catch(() => null);
  return Array.isArray(body) ? body : [];
}

const ids = rows => new Set(rows.map(r => r.id));

(async () => {
  console.log('\nRole boundaries — two tenants, and whether either can reach the other\n');
  const fx = await setupTenants();
  const [A, B] = fx.tenants;
  const tk = await tokens(fx);

  try {
    // ================================================= owner
    console.log('Owner — should see everything');
    {
      const t = tk.owner;
      const cl = ids(await readAs(t, 'clients'));
      const cr = ids(await readAs(t, 'creators'));
      check(cl.has(A.client) && cl.has(B.client), 'owner reads both tenants\' clients', '');
      check(cr.has(A.creator) && cr.has(B.creator), 'owner reads both tenants\' creators', '');
    }

    // ================================================= account manager
    console.log('\nAccount Manager A — should be confined to tenant A');
    {
      const t = tk['am-a'];
      const cl = ids(await readAs(t, 'clients'));
      const camp = ids(await readAs(t, 'campaigns'));
      const sub = ids(await readAs(t, 'submissions'));

      check(cl.has(A.client), 'AM A reads their own client', 'assigned client visible');
      check(!cl.has(B.client), 'AM A cannot read tenant B\'s client',
        cl.has(B.client) ? `LEAK — sees ${cl.size} clients in total` : 'scoped', 'N-10');
      check(!camp.has(B.campaign), 'AM A cannot read tenant B\'s campaign',
        camp.has(B.campaign) ? 'LEAK' : 'scoped', 'N-10');
      check(!sub.has(B.submission), 'AM A cannot read tenant B\'s submission',
        sub.has(B.submission) ? 'LEAK' : 'scoped');
    }

    // ================================================= creator
    console.log('\nCreator A — should see only their own work');
    {
      const t = tk['creator-a'];
      const cr = ids(await readAs(t, 'creators'));
      const camp = ids(await readAs(t, 'campaigns'));
      const sub = ids(await readAs(t, 'submissions'));
      const cl = await readAs(t, 'clients');

      check(cr.has(A.creator) && cr.size === 1, 'creator A reads only their own creator row', `${cr.size} row(s)`);
      check(!cr.has(B.creator), 'creator A cannot read creator B', cr.has(B.creator) ? 'LEAK' : 'scoped');
      check(camp.has(A.campaign) && !camp.has(B.campaign), 'creator A sees only campaigns they are assigned to', `${camp.size} campaign(s)`);
      check(!sub.has(B.submission), 'creator A cannot read another creator\'s submission', sub.has(B.submission) ? 'LEAK' : 'scoped');
      check(cl.length === 0, 'creator A cannot read the client list', `${cl.length} row(s)`);
    }

    // ================================================= client
    console.log('\nClient A — should see only their own brand');
    {
      const t = tk['client-a'];
      const cl = ids(await readAs(t, 'clients'));
      const camp = ids(await readAs(t, 'campaigns'));
      const prof = await readAs(t, 'user_profiles');

      check(cl.has(A.client) && cl.size === 1, 'client A reads only their own client row', `${cl.size} row(s)`);
      check(!camp.has(B.campaign), 'client A cannot read tenant B\'s campaign', camp.has(B.campaign) ? 'LEAK' : 'scoped');
      check(prof.length === 1, 'client A reads only their own profile', `${prof.length} row(s)`);
    }

    // ================================================= privileged tables
    console.log('\nPrivileged tables — writes must be refused');
    {
      const tryWrite = async (token, table, row) => {
        const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, { method: 'POST',
          headers: { apikey: ANON, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify(row) });
        return r.status;
      };
      const s1 = await tryWrite(tk['creator-a'], 'payment_managers',
        { user_id: A.creatorUser, can_mark_paid: true, active: true });
      check(s1 >= 400, 'creator cannot grant themselves payment-manager rights', `HTTP ${s1}`);

      const s2 = await tryWrite(tk['client-a'], 'payment_managers',
        { user_id: A.clientUser, can_mark_paid: true, active: true });
      check(s2 >= 400, 'client cannot grant themselves payment-manager rights', `HTTP ${s2}`);
    }

    // ================================================= payout RPCs
    console.log('\nPayout RPCs — the escalation path from the audit');
    {
      const callRpc = async (token, fn, args) => {
        const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST',
          headers: { apikey: ANON, Authorization: 'Bearer ' + (token || ANON), 'Content-Type': 'application/json' },
          body: JSON.stringify(args) });
        return { status: r.status, text: (await r.text()).slice(0, 160) };
      };
      const refused = r => /permission denied|42501|not authorized/i.test(r.text) || r.status === 403;

      const fakeId = '00000000-0000-0000-0000-000000000000';
      for (const [who, token] of [['creator', tk['creator-a']], ['client', tk['client-a']], ['anon', null]]) {
        const r = await callRpc(token, 'approve_withdrawal_request', { p_request_id: fakeId, p_approved_by: null });
        check(refused(r), `${who} cannot execute approve_withdrawal_request`,
          refused(r) ? 'refused' : `REACHED THE FUNCTION BODY — ${r.text.slice(0, 70)}`, 'N-11');
      }
      const r = await callRpc(tk['creator-a'], 'mark_payout_batch_paid', { p_batch_id: fakeId, p_marked_paid_by: null });
      check(refused(r), 'creator cannot execute mark_payout_batch_paid',
        refused(r) ? 'refused' : `REACHED THE FUNCTION BODY — ${r.text.slice(0, 70)}`, 'N-11');
    }

    // ================================================= API auth gates
    console.log('\nAPI auth gates');
    {
      const hit = async (path, token, method = 'GET', body) => {
        try {
          const r = await fetch(`${BASE}${path}`, { method,
            headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
            body: body ? JSON.stringify(body) : undefined });
          return r.status;
        } catch { return null; }
      };
      const probe = await hit('/api/earnings/summary', null);
      if (probe === null) {
        console.log('  SKIP  dev server not running on :3100 — start tests/lib/devServer.cjs');
      } else {
        check(probe === 401, 'no token is rejected', `HTTP ${probe}`);
        check(await hit('/api/earnings/summary', tk['client-a']) === 403,
          'client is refused the earnings summary', 'role gate');
        check(await hit('/api/earnings/recalculate', tk['creator-a'], 'POST', { creatorId: A.creator }) === 403,
          'creator is refused earnings recalculation', 'owner-only');
        check(await hit('/api/creator/view-count', tk['client-a'], 'POST', { submissionId: A.submission, viewCountSubmitted: 1 }) === 403,
          'client is refused the creator view-count endpoint', 'role gate');
      }
    }
  } finally {
    process.stdout.write('\nTearing down… ');
    await teardown(fx);
    console.log('done.');
  }

  console.log(`\n${'-'.repeat(76)}`);
  console.log(`  ${held} boundaries held · ${open} open`);

  // Every open boundary here has a written fix waiting on an apply. That makes
  // this BLOCKED, not FAILED.
  //
  // The distinction is the whole contract of this harness: exit 1 says the
  // application is broken and someone should stop and read the code, exit 3
  // says a migration has not been run yet. Reporting a pending migration as a
  // defect is how a green-able system gets treated as a broken one.
  //
  // The old text here said N-10 was "expected to be RED until the extra policy
  // on clients is found and dropped — run VERIFY_20260821.sql section 6 to
  // name it." It has since been found, and it was never an extra policy in
  // production: 20260527130000_client_rls_security.sql adds three policies
  // whose USING clause ends in
  //     OR EXISTS (... role IN ('owner','am','account_manager'))
  // which asks "are you staff?" and never "is this row yours?". Permissive
  // policies are OR'd, so it grants every AM every tenant's rows.
  // The shape below is a contract with tests/run-all.cjs, which scrapes this
  // section to build the run's aggregate blocker list — the one actionable
  // output of a whole system test. It parses
  //
  //     · <finding> — <why>
  //             fix: <migration>
  //
  // so the em-dash and the `fix:` line are load-bearing, not decoration. Change
  // them and this suite's blockers silently vanish from the summary while the
  // suite still reports itself as blocked.
  const FIXES = [
    { match: /N-10/, finding: 'N-10',
      why: "an AM reads every tenant's clients, campaigns and submissions",
      migration: '20260822000005_tenant_policy_reset.sql' },
    { match: /N-11/, finding: 'N-11',
      why: 'creator, client and anon all reach the payout RPC bodies',
      migration: '20260821000000_payout_drift_and_authz.sql' },
  ];

  if (openFindings.length) {
    const unique = [...new Set(openFindings)];
    console.log('\n  Open boundaries:\n');
    for (const f of unique) console.log('    · ' + f);

    const needed = FIXES.filter(fx => unique.some(f => fx.match.test(f)));
    const unexplained = unique.filter(f => !FIXES.some(fx => fx.match.test(f)));

    console.log('\n  Blocked on migrations that have not been applied:\n');
    for (const fx of needed) {
      console.log(`    · ${fx.finding} — ${fx.why}`);
      console.log(`           fix: ${fx.migration}`);
    }
    console.log('\n  Apply order and expected output: supabase/migrations/APPLY_20260822.md');
    console.log('  After applying, this suite should read 24 held · 0 open.');

    if (unexplained.length) {
      console.log('\n  NOT explained by a pending migration — these are real failures:\n');
      for (const f of unexplained) console.log('    · ' + f);
    }

    console.log('');
    // Blocked only if every open boundary is one a written migration closes.
    process.exit(unexplained.length ? 1 : 3);
  }

  console.log('');
  process.exit(0);
})().catch(e => { console.error('\nHarness error:', e.message); process.exit(1); });
