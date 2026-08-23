// tests/smoke-journey.test.cjs
//
// The proof that the instrument works.
//
// A real person opens the portal for the first time — once on wifi, once on a
// slow 3G connection — and we assert what that person would actually notice:
// the sign-in screen renders, nothing on it is a raw JavaScript value, the
// browser console is clean, and nothing secret travelled down the wire. Along
// the way it captures the performance numbers, so the two networks can be
// compared side by side.
//
// It is deliberately the cheapest journey there is. If this suite is red, the
// harness or the environment is wrong, and no verdict from the other suites
// should be believed until it is green.
//
//   node tests/run-all.cjs --suite=smoke-journey     starts CRA + devServer first
//   node tests/smoke-journey.test.cjs                if both are already up
//
// Exit codes: 0 pass · 1 real failure · 3 blocked.

const chrome = require('./lib/chrome.cjs');
const { journey, finish, configure, harnessError } = require('./lib/journey.cjs');

const SUITE = 'smoke-journey';

// The sign-in screen carries a version stamp; it is not a finding. Everything
// else on the screen is asserted literally.
const SANITY_ALLOW = [/^v\d+\.\d+\.\d+$/];

/** One person's first visit at a given connection speed. */
async function firstVisit(networkName, title) {
  const slow = networkName === 'slow-3g' || networkName === 'offline';
  const session = await chrome.open({
    suite: SUITE,
    network: networkName,
    traceName: `trace-${networkName}`,
    timeout: slow ? 180000 : 45000,
  });

  const out = { network: networkName, metrics: null, net: null, trace: null };

  await journey(title, async (j) => {
    await j.step('open the portal', async (s) => {
      const res = await session.goto('/', {
        waitUntil: 'domcontentloaded',
        timeout: slow ? 180000 : 60000,
      });
      s.expect(res, 'page.goto returned no response object');
      s.expect(res.status() < 400, `the app returned HTTP ${res.status()} for /`);
      s.note(`HTTP ${res.status()}`);
    });

    await j.step('wait for the app to finish rendering', async (s) => {
      await session.page.waitForSelector('.login-card', { timeout: slow ? 180000 : 45000 });
      await session.settle({ timeout: slow ? 60000 : 20000 });
      s.note('the login card is on screen');
    });

    await j.step('the sign-in screen is really there', async (s) => {
      const seen = await session.page.evaluate(() => ({
        heading: ((document.querySelector('.login-title') || {}).textContent || '').trim(),
        email: !!document.querySelector('input[type="email"]'),
        password: !!document.querySelector('input[type="password"]'),
        submit: ((document.querySelector('button.btn-primary.btn-full') || {}).textContent || '').trim(),
      }));
      s.expect(/welcome back/i.test(seen.heading),
        `the sign-in heading reads "${seen.heading}", expected "Welcome back"`);
      s.expect(seen.email, 'no email field on the sign-in screen');
      s.expect(seen.password, 'no password field on the sign-in screen');
      s.expect(/sign in/i.test(seen.submit),
        `the submit button reads "${seen.submit}", expected "Sign In"`);
      s.note(`"${seen.heading}" · email + password + "${seen.submit}"`);
    });

    await j.step('nothing on screen is a raw JavaScript value', async (s) => {
      const r = await session.assertSane({ allowText: SANITY_ALLOW });
      s.note(`${r.mainChars} chars in ${r.mainSelector} · no Loading / undefined / NaN / [object Object]`);
    });

    await j.step('the browser console is clean', async (s) => {
      const r = session.console.assertNoErrors();
      const gaps = session.console.envGaps();
      s.note(`0 uncaught · ${r.suppressed} known-noise suppressed`);
      for (const g of gaps) s.note(`local-env gap: ${g.text.slice(0, 70)} (${g.why})`);
    });

    await j.step('no failed requests', async (s) => {
      const failed = session.net.failed();
      s.expect(failed.length === 0,
        `${failed.length} request(s) failed:\n` +
        failed.slice(0, 6).map(f => `      ${f.method} ${f.status || f.failure} ${f.url}`).join('\n'));
      s.note(`${session.net.requests().length} request(s) · ` +
        `${Math.round(session.net.totalBytes() / 1024)}KB transferred`);
    });

    await j.step('no secrets on the wire', async (s) => {
      const r = await session.security.assertNoSecretsOnTheWire();
      s.note(`${r.scannedResponses} response bodies scanned · ${r.warnings} non-critical warning(s)`);
      for (const w of (r.warningList || []).slice(0, 3)) {
        s.note(`warn: ${w.rule} at ${w.url.replace(/^https?:\/\/[^/]+/, '')}`);
      }
    });

    await j.step('performance is measurable', async (s) => {
      const m = await session.perf.metrics();
      s.expect(m.observerInstalled,
        'the PerformanceObserver init script did not run — LCP and CLS cannot be measured');
      s.expect(m.ttfbMs != null && m.domContentLoadedMs != null,
        `Navigation Timing came back empty (ttfb=${m.ttfbMs}, dcl=${m.domContentLoadedMs})`);
      s.note(await session.perf.line());
      out.metrics = m;
    });

    await j.step('the same request is not fired twice', async (s) => {
      const dupes = session.net.duplicateRequests();
      if (dupes.length) {
        // Worth seeing on the sign-in screen, but not yet a failure: the N+1
        // assertion belongs on the data-heavy pages the next wave adds.
        s.note(`${dupes.length} duplicated GET(s): ` +
          dupes.slice(0, 3).map(d => `${d.url.replace(/^https?:\/\/[^/]+/, '')} x${d.count}`).join(', '));
      } else {
        s.note('every GET was made exactly once');
      }
    });

    await j.step('security posture of the served document', async (s) => {
      const h = session.security.missingHeaders();
      const cookies = await session.security.cookies();
      const risky = cookies.filter(c => c.issues.length);
      // CRA's dev server is not Vercel, so a missing header here is recorded,
      // not failed. Turning this into an assertion belongs on a deployed URL.
      s.note(`headers present: ${Object.keys(h.present).join(', ') || 'none'}`);
      s.note(`missing (dev server, expected): ${h.missing.join(', ')}`);
      s.note(cookies.length
        ? `${cookies.length} cookie(s), ${risky.length} with flag issues`
        : 'no cookies set before sign-in');
      out.headers = h;
      out.cookies = cookies;
    });
  }, { session, blockers: [] });

  out.net = session.net.summary();
  out.trace = await session.close();
  return out;
}

const f = (v, u = 'ms') => (v == null ? 'n/a' : `${v}${u}`);

(async () => {
  console.log('\nSmoke journey — a real person opening the portal\n');

  let wifi = null, slow = null;
  try {
    const chromePath = chrome.resolveChromePath();
    configure({ name: SUITE, base: chrome.BASE, chrome: chromePath, networks: ['wifi', 'slow-3g'] });
    console.log(`  browser: ${chromePath}`);
    console.log(`  base:    ${chrome.BASE}`);

    wifi = await firstVisit('wifi', 'a first-time visitor on wifi');
    slow = await firstVisit('slow-3g', 'the same visitor on slow 3G');
  } catch (err) {
    harnessError(err);
    console.error('\nHarness error: ' + (err.stack || err.message));
  }

  if (wifi && slow && wifi.metrics && slow.metrics) {
    const row = (label, key, unit = 'ms') =>
      console.log(`    ${label.padEnd(22)} ${f(wifi.metrics[key], unit).padStart(12)} ${f(slow.metrics[key], unit).padStart(12)}`);
    console.log('\n  What the network costs a real user\n');
    console.log(`    ${''.padEnd(22)} ${'wifi'.padStart(12)} ${'slow-3g'.padStart(12)}`);
    row('TTFB', 'ttfbMs');
    row('First Contentful Paint', 'fcpMs');
    row('Largest Contentful Paint', 'lcpMs');
    row('DOMContentLoaded', 'domContentLoadedMs');
    row('load', 'loadMs');
    console.log(`    ${'Cumulative Layout Shift'.padEnd(22)} ${String(wifi.metrics.cls ?? 'n/a').padStart(12)} ${String(slow.metrics.cls ?? 'n/a').padStart(12)}`);
    row('JS heap', 'jsHeapUsedMB', 'MB');
    console.log(`    ${'requests'.padEnd(22)} ${String(wifi.net.count).padStart(12)} ${String(slow.net.count).padStart(12)}`);
    console.log(`    ${'transferred'.padEnd(22)} ${(Math.round(wifi.net.bytes / 1024) + 'KB').padStart(12)} ${(Math.round(slow.net.bytes / 1024) + 'KB').padStart(12)}`);
    console.log('');
    console.log(`    ${chrome.describeNetwork('slow-3g')}`);
    configure({ comparison: { wifi: wifi.metrics, 'slow-3g': slow.metrics } });
  }

  finish();
})();
