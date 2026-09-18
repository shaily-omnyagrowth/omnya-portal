// tests/creator-portal-fixes.test.cjs
//
// Entry point for the creator-portal punch list. One command, three layers:
//
//   1. supabase/migrations/__tests__/creator-portal-fixes.test.cjs
//        Real Postgres, the real migration chain, every query as `authenticated`.
//        Permissions, persistence, tenant scoping.  (P0-B, P1, P2, P3)
//   2. tests/oauth-handoff.test.cjs
//        Real Chrome under the production CSP + COOP headers.  (P0-A)
//   3. The guards in this file.
//
// WHAT THIS FILE USED TO BE
//
// Twenty-odd assertions of the form `assert(source.includes('some string'))`.
// They all passed, and they were all true: the strings were there. Meanwhile a
// creator could approve themselves onto any campaign, applying to a campaign
// assigned you to it on the spot, every campaign was billed the manager
// commission twice, the client CPM was computed from an invented $100, and the
// OAuth popup could not work on the deployed site at all. A test that checks a
// word is present is checking that someone typed it.
//
// So the behaviour lives in layers 1 and 2. What is left here are guards: each
// pins one SPECIFIC defect that already happened, says why it matters, and
// fails if that exact mistake comes back. They are deliberately few.
//
//   node tests/creator-portal-fixes.test.cjs

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// Comments are where these defects are DESCRIBED, so the guards read code only.
// Only comments that START a line are stripped. A looser /\*...*\/ matcher saw
// the "/*" in accept="video/*" as the opening of a block comment and deleted
// the code after it, which failed a guard the app was passing.
const code = (p) => read(p)
  .replace(/^[ 	]*\/\*[\s\S]*?\*\/[ 	]*$/gm, '')
  .replace(/^[ 	]*\{\/\*[\s\S]*?\*\/\}[ 	]*$/gm, '')
  .replace(/^[ 	]*\/\/.*$/gm, '');

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

function runSuite(label, file) {
  console.log(`\n=== ${label}`);
  const r = spawnSync(process.execPath, [path.join(ROOT, file)], { encoding: 'utf8', timeout: 600000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const tally = (out.match(/(\d+) passed, (\d+) failed/) || [])[0];
  const skipped = /^SKIP:/m.test(out);
  for (const line of out.split(/\r?\n/)) if (/FAIL|ABORT|HARNESS ERROR|^SKIP:/.test(line)) console.log('    ' + line.trim());
  if (skipped) { console.log('  SKIP   ' + label + '   (dependency missing; NOT verified)'); return; }
  R(r.status === 0, label, tally || `exit ${r.status}`);
}

runSuite('Database: permissions, persistence, tenant scope', 'supabase/migrations/__tests__/creator-portal-fixes.test.cjs');
runSuite('OAuth hand-off under production headers', 'tests/oauth-handoff.test.cjs');

console.log('\n=== Guards against defects that have already happened once');

// ---- P0-A -------------------------------------------------------------------
{
  const callbacks = [
    'api/auth/instagram/callback.js', 'api/auth/meta/callback.js',
    'api/auth/youtube/callback.js', 'api/integrations/tiktok/callback.js', 'api/_utils/oauth.js',
  ];
  const inline = callbacks.filter((f) => /<script|onclick=|text\/html/i.test(code(f)));
  R(inline.length === 0,
    "no OAuth callback responds with HTML or inline script (blocked by script-src 'self')", inline.join(', '));

  const cc = code('src/CreatorConnections.js');
  R(!/window\.opener|\.popup\.closed|addEventListener\(\s*['"]message['"]/.test(cc),
    'the connect flow does not depend on window.opener, popup.closed or postMessage (all broken by COOP same-origin)');

  // Browsers only allow window.open inside the click. After an await it is blocked.
  const handler = cc.slice(cc.indexOf('const handleConnect = async'));
  R(handler.indexOf('window.open(') > -1 && handler.indexOf('window.open(') < handler.indexOf('await fetch('),
    'the popup is opened before the first await, while the click is still a user gesture');

  const tt = code('api/integrations/tiktok/callback.js');
  R((tt.match(/oauth\/token\//g) || []).length === 1,
    'the TikTok callback exchanges the code once (a second redirect_uri can never succeed: it must equal the one authorize used)');

  const starts = ['api/integrations/tiktok/connect.js', 'api/integrations/tiktok/reconnect.js', 'api/integrations/tiktok/callback.js',
    'api/auth/instagram/start.js', 'api/auth/instagram/callback.js', 'api/auth/meta/start.js', 'api/auth/meta/callback.js',
    'api/auth/facebook/start.js', 'api/auth/youtube/start.js', 'api/auth/youtube/callback.js'];
  const own = starts.filter((f) => !/redirectUriFor\(/.test(code(f)) || /_REDIRECT_URI/.test(code(f)));
  R(own.length === 0,
    'every start route and callback takes its redirect URI from the one shared definition', own.join(', '));

  process.env.TIKTOK_REDIRECT_URI = '';
  const { redirectUriFor } = require(path.join(ROOT, 'api/_utils/oauth'));
  const documented = (read('SOCIAL_MEDIA_INTEGRATION.md').match(/\$\{APP_BASE_URL\}(\/api\/[a-z/]*tiktok\/callback)/) || [])[1];
  R(!!documented && redirectUriFor('tiktok').endsWith(documented),
    'the TikTok redirect URI the code sends is the one the setup guide says to register',
    `code=${redirectUriFor('tiktok')} docs=${documented}`);

  const vercel = JSON.parse(read('vercel.json'));
  R(vercel.rewrites.some((r) => r.source === '/oauth-complete') &&
    vercel.rewrites.findIndex((r) => r.source === '/oauth-complete') < vercel.rewrites.findIndex((r) => r.destination === '/index.html'),
    '/oauth-complete is routed to its page before the SPA catch-all can swallow it');
}

// ---- P0-B -------------------------------------------------------------------
{
  const app = code('src/App.js');
  R(!/sales_commission_rate\s*:[^,\n]*\?[^,\n]*:\s*0\b/.test(app),
    'the UI never writes a sales rate of 0 (only 10/20/30% are valid; is_sales_sourced decides whether it applies)');

  R(!/managerCost\s*\+\s*amCost|amCost\s*\+\s*managerCost|-\s*amCost\s*-\s*salesCost\s*-\s*managerCost/.test(app),
    'manager commission is charged once, not as "AM cost" plus "manager cost"');

  // The financial handlers must go through updateRows (which reports refusals).
  const detail = app.slice(app.indexOf('function CampaignDetail('), app.indexOf('function ClientsPage(') > -1 ? app.indexOf('export function ClientsPage(') : undefined);
  const bare = (detail.match(/await supabase\.from\("campaigns"\)\.update\([^)]*(sales_commission_rate|manager_commission_rate|show_client_cpm|is_sales_sourced)/g) || []);
  R(bare.length === 0, 'no commission / CPM write in CampaignDetail discards its result', bare.length + ' bare write(s)');

  R(/if \(isOwner\) \{\s*patch\.sales_commission_rate/.test(app),
    'a manager saving a campaign does not send commission rates at all');
}

// ---- P2 ---------------------------------------------------------------------
{
  const app = code('src/App.js');
  const board = app.slice(app.indexOf('function JobBoard('), app.indexOf('function SubmitContent(') > -1 ? app.indexOf('function SubmitContent(') : app.indexOf('function JobBoard(') + 9000);
  R(/status:\s*"Applied"/.test(board) && !/\.upsert\(/.test(board),
    'applying INSERTS an Applied row (an upsert would let a re-application overwrite a decision)');
  R(!/status:\s*"Assigned"|status === "Assigned"/.test(app),
    'the UI uses the database vocabulary Applied / Approved / Declined ("Assigned" is rejected by the CHECK)');
  R(/type="file"[\s\S]{0,200}accept="video\/\*"/.test(board), 'the application form takes a demo video FILE, not only a link');
}

// ---- P3 ---------------------------------------------------------------------
{
  const cd = code('src/pages/ClientDashboard.js');
  R(!/pay_per_video/.test(cd), 'the client portal never reads pay_per_video (it is what creators are paid)');
  R(!/\|\|\s*10\)\s*\*\s*Number/.test(cd) && /clientProfile\?\.budget/.test(cd),
    'client CPM comes from the client\'s own budget, never a made-up fallback');
  const mig = read('supabase/migrations/20260918000000_creator_portal_fixes.sql');
  const view = mig.slice(mig.indexOf('CREATE OR REPLACE VIEW public.client_safe_campaigns'));
  R(/show_client_cpm/.test(view) && !/pay_per_video|budget|commission/.test(view.slice(0, view.indexOf('FROM'))),
    'client_safe_campaigns exposes the CPM switch and no cost columns');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
