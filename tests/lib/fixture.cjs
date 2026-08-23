// tests/lib/fixture.cjs
//
// Creates a disposable set of accounts and records for a test run, then removes
// them again. Every account is named claude-test-<role>+<timestamp>@example.com
// so anything left behind is obvious and greppable.
//
// teardown() deletes by user id across every dependent table rather than by a
// list of ids captured at creation time — during the audit a submission created
// through the UI was not in the manifest and would have survived.

const fs = require('fs');
const path = require('path');
const { env } = require('./schema.cjs');

const U = env.SUPABASE_URL;
const K = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json',
            Prefer: 'return=representation' };

const rest = (q, o = {}) => fetch(`${U}/rest/v1/${q}`, { ...o, headers: { ...H, ...(o.headers || {}) } });
const post = async (t, b) => (await rest(t, { method: 'POST', body: JSON.stringify(b) })).json();

async function setup({ roles = ['owner', 'am', 'creator', 'client'], seed = true } = {}) {
  const ts = Date.now();
  const password = 'ClaudeTest!' + ts;
  const fx = { ts, password, users: [], ids: {} };

  for (const role of roles) {
    const email = `claude-test-${role}+${ts}@example.com`;
    const r = await fetch(`${U}/auth/v1/admin/users`, { method: 'POST', headers: H,
      body: JSON.stringify({ email, password, email_confirm: true,
        user_metadata: { full_name: `Claude Test ${role}`, requested_role: role } }) });
    const u = await r.json();
    if (!r.ok) throw new Error(`Could not create the ${role} account: ${JSON.stringify(u).slice(0, 160)}`);
    // A live trigger writes a profile with role=creator; overwrite with the role we want.
    await rest('user_profiles?on_conflict=id', { method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ id: u.id, email, full_name: `Claude Test ${role}`, role }) });
    fx.users.push({ role, email, id: u.id });
  }

  const uid = r => (fx.users.find(u => u.role === r) || {}).id;

  if (seed) {
    if (uid('am')) {
      const am = await post('account_managers', { user_id: uid('am'), name: 'Claude Test AM',
        email: fx.users.find(u => u.role === 'am').email });
      fx.ids.am = am[0] && am[0].id;
    }
    if (uid('creator')) {
      const cr = await post('creators', { user_id: uid('creator'), name: 'Claude Test Creator',
        email: fx.users.find(u => u.role === 'creator').email, status: 'Active',
        am_id: fx.ids.am || null, weekly_rate: 150, videos_per_week: 15 });
      fx.ids.creator = cr[0] && cr[0].id;
    }
    if (uid('client')) {
      // The client trigger usually provisions this row already.
      const existing = await (await rest(`clients?user_id=eq.${uid('client')}&select=id`)).json();
      fx.ids.client = existing[0] ? existing[0].id
        : (await post('clients', { user_id: uid('client'), name: 'Claude Test Client', status: 'Active' }))[0].id;
    }
    if (fx.ids.client) {
      const c = await post('campaigns', { name: 'Claude Test Campaign', client_id: fx.ids.client,
        status: 'Open', videos_needed: 5, pay_per_video: 10,
        assigned_creators: fx.ids.creator ? [fx.ids.creator] : [] });
      fx.ids.campaign = c[0] && c[0].id;
    }
  }
  return fx;
}

/**
 * Two independent tenants plus one owner.
 *
 * Isolation cannot be tested with one of everything: if there is only one
 * client, "the AM can see all clients" and "the AM can see their own client"
 * look identical. Each tenant here gets its own AM, creator, client, campaign
 * and submission, so every assertion can ask the sharp question — can tenant A
 * reach tenant B's data?
 *
 * Returns { password, users, owner, tenants: [A, B], campaignIds }.
 */
async function setupTenants() {
  const ts = Date.now();
  const password = 'ClaudeTest!' + ts;
  const fx = { ts, password, users: [], ids: {}, campaignIds: [], tenants: [] };

  const mkUser = async (tag, role) => {
    const email = `claude-test-${tag}+${ts}@example.com`;
    const r = await fetch(`${U}/auth/v1/admin/users`, { method: 'POST', headers: H,
      body: JSON.stringify({ email, password, email_confirm: true,
        user_metadata: { full_name: `Claude ${tag}`, requested_role: role } }) });
    const u = await r.json();
    if (!r.ok) throw new Error(`Could not create ${tag}: ${JSON.stringify(u).slice(0, 150)}`);
    await rest('user_profiles?on_conflict=id', { method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ id: u.id, email, full_name: `Claude ${tag}`, role }) });
    fx.users.push({ role: tag, email, id: u.id });
    return u.id;
  };

  fx.owner = { userId: await mkUser('owner', 'owner'), key: 'owner' };

  for (const letter of ['a', 'b']) {
    const t = { letter };
    t.amUser      = await mkUser(`am-${letter}`, 'am');
    t.creatorUser = await mkUser(`creator-${letter}`, 'creator');
    t.clientUser  = await mkUser(`client-${letter}`, 'client');

    t.am = (await post('account_managers', { user_id: t.amUser,
      name: `Claude AM ${letter.toUpperCase()}`,
      email: fx.users.find(u => u.role === `am-${letter}`).email }))[0].id;

    t.creator = (await post('creators', { user_id: t.creatorUser,
      name: `Claude Creator ${letter.toUpperCase()}`,
      email: fx.users.find(u => u.role === `creator-${letter}`).email,
      status: 'Active', am_id: t.am }))[0].id;

    // The client trigger normally provisions this row already.
    const existing = await (await rest(`clients?user_id=eq.${t.clientUser}&select=id`)).json();
    t.client = existing[0] ? existing[0].id
      : (await post('clients', { user_id: t.clientUser, name: `Claude Client ${letter.toUpperCase()}`, status: 'Active' }))[0].id;
    // Assign the client to this tenant's AM — without this, 'scoped to my clients'
    // and 'sees nothing' are indistinguishable.
    await rest(`clients?id=eq.${t.client}`, { method: 'PATCH', body: JSON.stringify({ am_id: t.am }) });

    t.campaign = (await post('campaigns', { name: `Claude Campaign ${letter.toUpperCase()}`,
      client_id: t.client, status: 'Open', videos_needed: 3, pay_per_video: 10,
      assigned_creators: [t.creator] }))[0].id;
    fx.campaignIds.push(t.campaign);

    t.submission = (await post('submissions', { creator_id: t.creator, campaign_id: t.campaign,
      submission_type: 'Final Post', concept_status: 'Approved', final_status: 'Approved',
      platform: 'TikTok', posted_link: `https://tiktok.com/@${letter}/video/1` }))[0].id;

    fx.tenants.push(t);
  }
  return fx;
}
/** Sign in each fixture user and return { role: accessToken }. */
async function tokens(fx) {
  const out = {};
  for (const u of fx.users) {
    const r = await fetch(`${U}/auth/v1/token?grant_type=password`, { method: 'POST',
      headers: { apikey: env.REACT_APP_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: u.email, password: fx.password }) });
    const j = await r.json();
    out[u.role] = j.access_token || null;
  }
  return out;
}

/** Remove everything, discovering dependents rather than trusting a manifest. */
async function teardown(fx, { verbose = false } = {}) {
  const uids = fx.users.map(u => u.id);
  const inList = `in.(${uids.join(',')})`;
  const del = async (q, label) => {
    const r = await rest(q, { method: 'DELETE' });
    const j = await r.json().catch(() => []);
    if (verbose) console.log(`    ${label.padEnd(22)} ${r.ok ? 'deleted ' + (Array.isArray(j) ? j.length : '?') : 'FAIL ' + r.status}`);
  };

  const creators = await (await rest(`creators?user_id=${inList}&select=id`)).json();
  for (const c of Array.isArray(creators) ? creators : []) {
    await del(`creator_earnings?creator_id=eq.${c.id}`, 'creator_earnings');
    await del(`withdrawal_requests?creator_id=eq.${c.id}`, 'withdrawal_requests');
    await del(`payments?creator_id=eq.${c.id}`, 'payments');
    await del(`submissions?creator_id=eq.${c.id}`, 'submissions');
  }
  await del(`payment_audit_logs?actor_user_id=${inList}`, 'payment_audit_logs');
  await del(`payment_managers?user_id=${inList}`, 'payment_managers');
  const campaignIds = [fx.ids.campaign, ...(fx.campaignIds || [])].filter(Boolean);
  for (const id of campaignIds) await del(`campaigns?id=eq.${id}`, 'campaigns');
  await del(`creators?user_id=${inList}`, 'creators');
  await del(`clients?user_id=${inList}`, 'clients');
  await del(`account_managers?user_id=${inList}`, 'account_managers');
  await del(`user_profiles?id=${inList}`, 'user_profiles');
  for (const u of fx.users) {
    await fetch(`${U}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: H });
  }

  const leftover = await (await rest(`user_profiles?id=${inList}&select=id`)).json();
  const n = Array.isArray(leftover) ? leftover.length : -1;
  if (n !== 0) throw new Error(`Teardown incomplete: ${n} profile row(s) still present`);
  return true;
}

module.exports = { setup, setupTenants, tokens, teardown, rest, post };
