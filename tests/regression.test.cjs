// tests/regression.test.cjs
//
// Re-runs the three checks that produced FALSE FAILURES during the audit, using
// the corrected harness. Each one is annotated with what went wrong before, so
// the regression being guarded against is the *test* misreporting — not only
// the app misbehaving.
//
//   1. node tests/lib/devServer.cjs          (with CRA already on :3000)
//   2. node tests/regression.test.cjs
//
// Needs @electric-sql/pglite? No — this one talks to the real backend.
// Needs playwright-core; see tests/README.md.

const path = require('path');
const { select, selectOne, parseBody, assertColumns } = require('./lib/schema.cjs');
const { setup, tokens, teardown } = require('./lib/fixture.cjs');
const ui = require('./lib/ui.cjs');

let chromium;
try { ({ chromium } = require('playwright-core')); }
catch { console.error('\nNeeds a browser driver:\n  npm i -D playwright-core\n'); process.exit(2); }

const CHROME = process.env.CHROME_PATH ||
  'C:/Program Files/Google/Chrome/Application/chrome.exe';

let pass = 0, fail = 0;
const R = (ok, label, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(52)} ${detail}`);
  ok ? pass++ : fail++;
};

(async () => {
  console.log('\nChecking the harness itself before trusting it');
  // The guard must reject a column that does not exist, or it is not protecting anything.
  try {
    await assertColumns('submissions', ['am_feedback']);
    R(false, 'schema guard rejects a bad column name', 'it accepted "am_feedback"');
  } catch (e) {
    R(/TEST BUG/.test(e.message) && /feedback/.test(e.message),
      'schema guard rejects a bad column name',
      'and suggests "feedback" — the mistake made 3x in the audit');
  }
  await assertColumns('submissions', ['feedback', 'final_status', 'concept_status']);
  R(true, 'schema guard accepts the real column names');

  const fx = await setup();
  console.log(`\nFixture ready (${fx.users.length} accounts, suffix +${fx.ts})`);

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    // ================================================================= 1
    // Previously: "Creator Social Channels renders blank."
    // Cause: CRA does not serve /api/*, so the page showed load errors that do
    // not occur in production. With devServer.cjs in front, /api is real, so a
    // failure here now means something.
    console.log('\n1. Creator Social Channels — /api is served for real now');
    {
      const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
      const problems = ui.watchForProblems(page);
      await ui.login(page, fx.users.find(u => u.role === 'creator').email, fx.password);
      await ui.goto(page, 'Social Channels');
      const text = await ui.contentText(page);
      R(/social connections/i.test(text), 'the page renders its own content', `"${text.slice(0, 52)}"`);
      R(!/failed to load/i.test(text), 'no "failed to load" banner',
        /failed to load/i.test(text) ? 'STILL FAILING — now a real defect' : 'panels loaded');
      const apiErrors = problems.list().filter(p => p.includes('/api/'));
      R(apiErrors.length === 0, 'no /api errors', apiErrors.slice(0, 2).join(' ; ') || 'clean');
      await page.context().close();
    }

    // ================================================================= 2
    // Previously: "No revisions action offered."
    // Cause: the test read the default tab after emptying it. selectTab makes
    // the tab explicit and throws if it is missing.
    console.log('\n2. AM Review Queue — the tab is selected, never assumed');
    {
      const sub = (await require('./lib/fixture.cjs').post('submissions', {
        creator_id: fx.ids.creator, campaign_id: fx.ids.campaign,
        submission_type: 'Final Post', concept_status: 'Approved', final_status: 'Pending',
        platform: 'TikTok', posted_link: 'https://tiktok.com/@t/video/1',
      }))[0];

      const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
      const problems = ui.watchForProblems(page);
      await ui.login(page, fx.users.find(u => u.role === 'am').email, fx.password);
      await ui.goto(page, 'Review Queue');

      const tab = await ui.selectTab(page, /Finals Waiting/i);
      R(true, 'the Finals tab is selected explicitly', `"${tab}"`);

      const btn = page.locator('button:has-text("Request Changes")').first();
      R(await btn.count() > 0, 'Request Changes is offered on the Finals tab',
        (await btn.count()) ? 'found' : 'NOT FOUND — a real defect this time');

      if (await btn.count()) {
        await btn.click();
        await page.waitForTimeout(1200);
        await page.locator('textarea').first().fill('Regression test: re-shoot the opening.');
        await page.locator('button:has-text("Send Revision Request")').first().click();
        await page.waitForTimeout(3500);

        // Schema-checked read: a typo here throws instead of faking a bug.
        const row = await selectOne('submissions', ['final_status', 'feedback'], `id=eq.${sub.id}`);
        R(row && /revision/i.test(row.final_status || ''), 'the revision state persisted',
          row ? `final_status="${row.final_status}"` : 'row missing');
        R(row && (row.feedback || '').includes('re-shoot the opening'), 'the feedback text persisted',
          row ? `"${String(row.feedback).slice(0, 42)}"` : '');
      }
      const problemList = problems.list();
      R(problemList.length === 0, 'no application-level problems',
        problemList.slice(0, 2).join(' ; ') || 'clean');
      const gaps = problems.envGaps();
      if (gaps.length) console.log(`        note: ${gaps.length} local-environment failure(s), not app defects: ${gaps[0]}`);
      await page.context().close();
    }

    // ================================================================= 3
    // Previously: "Revision feedback not persisted" (wrong column) and
    // "create-batch body has no .ok" (body was a JSON string, not an object).
    console.log('\n3. API response bodies are parsed, not assumed to be objects');
    {
      const tk = await tokens(fx);
      const res = await fetch(`${ui.BASE}/api/payouts/create-batch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tk.owner },
        body: JSON.stringify({ withdrawalRequestIds: [] }),
      });
      const body = parseBody(await res.text());
      R(res.status === 400, 'create-batch rejects an empty list with 400', `status ${res.status}`);
      R(body && body.ok === false, 'the parsed body exposes ok:false',
        `ok=${body && body.ok} (reading .ok off the raw string gave undefined before)`);
    }
  } finally {
    await browser.close();
    process.stdout.write('\nTearing down… ');
    await teardown(fx);
    console.log('done — all fixture accounts and rows removed.');
  }

  console.log(`\n${'-'.repeat(70)}\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\nHarness error:', e.message); process.exit(1); });
