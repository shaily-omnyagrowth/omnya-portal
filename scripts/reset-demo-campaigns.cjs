// scripts/reset-demo-campaigns.cjs
//
// Archives the test suite's leftover campaigns and clients ("Claude …", "TEST",
// "Boom"), then adds 10 realistic demo brands, each with one open campaign.
// Campaigns and submissions can't be deleted (refuse_hard_delete triggers).
//
// Dry run by default: prints what it would archive and create.
//
//   node scripts/reset-demo-campaigns.cjs           # dry run
//   node scripts/reset-demo-campaigns.cjs --apply   # do it

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.join(__dirname, '..');
const env = {};
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
} catch { /* fall through to the check below */ }
const URL_BASE = process.env.SUPABASE_URL || env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(2);
}
const APPLY = process.argv.includes('--apply');
const supabase = createClient(URL_BASE, KEY, { auth: { persistSession: false } });

const isDummyCampaign = (c) => /^claude /i.test(c.name || '') || ['TEST', 'Boom'].includes((c.name || '').trim());
const isDummyClient = (c) => /^claude /i.test(c.name || '');

const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const MOCKS = [
  {
    client: { name: 'Lumen Skincare', deal_type: 'Monthly Retainer', videos_per_month: 20, budget: 4800, contact_name: 'Priya Natarajan' },
    campaign: { name: 'Glow Serum Launch', format: 'TikTok', videos_needed: 12, pay_per_video: 150, days: 21,
      description: 'Morning routine videos featuring the new Vitamin C Glow Serum. Show the texture, apply on camera, and share a genuine first impression. Natural light, no heavy filters. Hook in the first 2 seconds.' },
  },
  {
    client: { name: 'Northpeak Coffee', deal_type: 'Monthly Retainer', videos_per_month: 15, budget: 3600, contact_name: 'Marcus Hale' },
    campaign: { name: 'Cold Brew Summer', format: 'IG Reel', videos_needed: 10, pay_per_video: 120, days: 18,
      description: 'Make your go-to cold brew drink with Northpeak concentrate. Quick recipe format, 15 to 30 seconds, upbeat audio. Mention it takes under a minute to make.' },
  },
  {
    client: { name: 'Kindred Pet Co.', deal_type: 'One-Off', videos_per_month: 8, budget: 1600, contact_name: 'Hannah Brooks' },
    campaign: { name: 'Calm Chews Reactions', format: 'TikTok', videos_needed: 8, pay_per_video: 100, days: 14,
      description: 'Film your dog or cat trying Calm Chews for the first time. Capture the reaction, then a short before and after of a stressful moment like a car ride or the doorbell.' },
  },
  {
    client: { name: 'Volt Athletics', deal_type: 'Monthly Retainer', videos_per_month: 24, budget: 6000, contact_name: 'Diego Ramirez' },
    campaign: { name: 'Run Club Drop', format: 'YouTube Short', videos_needed: 15, pay_per_video: 175, days: 30,
      description: 'Wear the Volt Stride runners on a real run. Show fit, cushioning and a quick pace check. Vertical, 30 to 45 seconds, end with your honest rating out of 10.' },
  },
  {
    client: { name: 'Saffron & Sage', deal_type: 'Trial', videos_per_month: 6, budget: 900, contact_name: 'Leila Haddad' },
    campaign: { name: '20 Minute Dinners', format: 'IG Reel', videos_needed: 6, pay_per_video: 110, days: 12,
      description: 'Cook one of the Saffron & Sage spice kits start to finish in under 20 minutes. Overhead or side angle, show the plating, and say which kit you used.' },
  },
  {
    client: { name: 'Halo Audio', deal_type: 'Monthly Retainer', videos_per_month: 12, budget: 4200, contact_name: 'Kenji Watanabe' },
    campaign: { name: 'Halo Buds Pro Unboxing', format: 'TikTok', videos_needed: 10, pay_per_video: 200, days: 25,
      description: 'Unbox the Halo Buds Pro and test noise cancelling somewhere loud, like a cafe or the subway. Show the case, the fit and one feature you didn\'t expect.' },
  },
  {
    client: { name: 'Tidewater Swim', deal_type: 'One-Off', videos_per_month: 10, budget: 2000, contact_name: 'Olivia Carter' },
    campaign: { name: 'Resort Collection Try-On', format: 'TikTok', videos_needed: 10, pay_per_video: 130, days: 20,
      description: 'Try on two pieces from the Resort Collection. Transition style, outdoors if possible. Mention sizing and how it fits so viewers can pick the right size.' },
  },
  {
    client: { name: 'Orbit Snacks', deal_type: 'Monthly Retainer', videos_per_month: 20, budget: 3000, contact_name: 'Tunde Adeyemi' },
    campaign: { name: 'Taste Test Tuesday', format: 'FB Reel', videos_needed: 12, pay_per_video: 90, days: 16,
      description: 'Blind taste test of three Orbit flavours with a friend or family member. Keep it fun and unscripted, and finish with everyone\'s favourite.' },
  },
  {
    client: { name: 'Meridian Travel', deal_type: 'Trial', videos_per_month: 5, budget: 1250, contact_name: 'Sofia Rossi' },
    campaign: { name: 'Weekend Getaways', format: 'YouTube Short', videos_needed: 5, pay_per_video: 250, days: 35,
      description: 'Plan a weekend trip with the Meridian app and film the highlights. Show how you booked, one hidden gem, and what the trip cost in total.' },
  },
  {
    client: { name: 'Bloom Botanics', deal_type: 'Monthly Retainer', videos_per_month: 16, budget: 2800, contact_name: 'Grace Okafor' },
    campaign: { name: 'Plant Care 101', format: 'IG Reel', videos_needed: 8, pay_per_video: 115, days: 22,
      description: 'Repot a plant using Bloom potting mix and the self-watering planter. Share one plant care tip your followers probably don\'t know.' },
  },
];

async function rows(table, q) {
  const { data, error } = await q(supabase.from(table));
  if (error) throw new Error(`${table}: ${error.message}`);
  return data || [];
}

async function archive(table, ids) {
  if (!ids.length) return 0;
  const patch = { status: 'Archived', archived_at: new Date().toISOString(), archive_reason: 'Test data cleanup' };
  let n = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from(table).update(patch).in('id', ids.slice(i, i + 100)).select('id');
    if (error) throw new Error(`archive ${table}: ${error.message}`);
    n += (data || []).length;
  }
  return n;
}

(async () => {
  console.log(APPLY ? 'APPLYING\n' : 'DRY RUN (pass --apply to make changes)\n');

  const campaigns = (await rows('campaigns', (t) => t.select('id, name').is('archived_at', null))).filter(isDummyCampaign);
  const clients = (await rows('clients', (t) => t.select('id, name').is('archived_at', null))).filter(isDummyClient);

  console.log(`Archive: ${campaigns.length} campaigns, ${clients.length} clients`);
  const existing = new Set((await rows('clients', (t) => t.select('name'))).map((c) => c.name));
  const toCreate = MOCKS.filter((m) => !existing.has(m.client.name));
  console.log(`Create: ${toCreate.length} brands with one campaign each${toCreate.length < MOCKS.length ? ` (${MOCKS.length - toCreate.length} already exist)` : ''}`);
  for (const m of toCreate) console.log(`  ${m.client.name} — ${m.campaign.name} (${m.campaign.format}, ${m.campaign.videos_needed} × $${m.campaign.pay_per_video})`);

  if (!APPLY) return;

  console.log('\nArchived:', {
    campaigns: await archive('campaigns', campaigns.map((c) => c.id)),
    clients: await archive('clients', clients.map((c) => c.id)),
  });

  for (const m of toCreate) {
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .insert({ ...m.client, status: 'Active', contact_email: '', contact_phone: '' })
      .select('id')
      .single();
    if (clientErr) throw new Error(`insert client ${m.client.name}: ${clientErr.message}`);

    const { days, ...campaign } = m.campaign;
    const { error: campErr } = await supabase
      .from('campaigns')
      .insert({
        ...campaign,
        client_id: client.id,
        status: 'Open',
        application_type: 'Open Application',
        start_date: day(0),
        deadline: day(days),
        assigned_creators: [],
      })
      .select('id')
      .single();
    if (campErr) throw new Error(`insert campaign ${m.campaign.name}: ${campErr.message}`);
    console.log(`Created ${m.client.name} — ${m.campaign.name}`);
  }
})().catch((e) => {
  console.error('\nStopped:', e.message);
  process.exit(1);
});
