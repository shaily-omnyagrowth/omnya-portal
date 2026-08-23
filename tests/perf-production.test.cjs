// tests/perf-production.test.cjs
//
// Measures the PRODUCTION build, not the dev server.
//
// WHY THIS EXISTS
//
// smoke-journey.test.cjs points at :3100, which proxies `react-scripts start`.
// That serves one unminified `bundle.js` with no code splitting, so the numbers
// it produces describe the development server and nobody's real experience.
// Reported as production characteristics they are simply wrong:
//
//   dev server      one bundle.js, 537 KB on the wire
//   production      252 kB gzipped main + 9 split chunks
//
// Layout shift is a different matter -- CLS comes from what the page does while
// rendering, not from how the JavaScript was packaged, so a dev-server CLS of
// 0.6265 probably does carry over. "Probably" is not good enough to hand
// someone as a defect, hence this file.
//
// It serves ./build over plain HTTP and drives real Chrome against it, on both
// a fast connection and a slow one.
//
//   npm run build && node tests/perf-production.test.cjs
//
// Exit codes: 0 pass · 1 real failure · 3 blocked (no build present).

const http = require('http');
const fs = require('fs');
const path = require('path');
const chrome = require('./lib/chrome.cjs');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
const PORT = Number(process.env.PERF_PORT || 3200);

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

// Budgets. Deliberately generous -- this is a regression fence, not a target.
// Anything tighter would fail on an unlucky run and teach everyone to ignore it.
const BUDGET = {
  cls: 0.1,              // Core Web Vitals "good"
  transferKB: 900,       // everything needed to render the sign-in screen
  requests: 25,
  lcpWifiMs: 4000,
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// A static server that behaves like the hosting does: unknown paths that are
// not files fall through to index.html, matching the SPA rewrite in vercel.json.
function serveBuild() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      let filePath = path.join(BUILD, urlPath);

      if (!filePath.startsWith(BUILD)) {          // no traversal
        res.writeHead(403).end('forbidden');
        return;
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(BUILD, 'index.html');
      }
      const body = fs.readFileSync(filePath);
      res.writeHead(200, {
        'content-type': MIME[path.extname(filePath)] || 'application/octet-stream',
        'content-length': body.length,
      });
      res.end(body);
    });
    server.on('error', reject);
    server.listen(PORT, () => resolve(server));
  });
}

async function measure(networkName) {
  const slow = networkName === 'slow-3g';
  const session = await chrome.open({
    suite: 'perf-production',
    network: networkName,
    base: `http://localhost:${PORT}`,
    timeout: slow ? 180000 : 45000,
  });

  try {
    const res = await session.goto('/', {
      waitUntil: 'domcontentloaded',
      timeout: slow ? 180000 : 60000,
    });
    if (!res || res.status() >= 400) {
      throw new Error(`the build returned HTTP ${res ? res.status() : 'no response'}`);
    }

    await session.page.waitForSelector('.login-card', { timeout: slow ? 180000 : 45000 });
    await session.settle({ timeout: slow ? 60000 : 20000 });

    const metrics = await session.perf.metrics();
    const net = session.net.summary();
    const dupes = session.net.duplicateRequests();
    const consoleErrors = session.console.errors();

    await session.shot(`production-${networkName}`);
    return { metrics, net, dupes, consoleErrors };
  } finally {
    await session.close();
  }
}

const kb = bytes => Math.round((bytes || 0) / 1024);

(async () => {
  console.log('\nProduction build performance -- real Chrome against ./build\n');

  if (!fs.existsSync(path.join(BUILD, 'index.html'))) {
    console.log('  BLOCKED  no production build found at ./build');
    console.log('           run: npm run build');
    process.exit(3);
  }

  const built = fs.statSync(path.join(BUILD, 'index.html')).mtime;
  console.log(`  build from ${built.toISOString()}  ·  serving on :${PORT}\n`);

  let server;
  try {
    server = await serveBuild();

    const results = {};
    for (const network of ['wifi', 'slow-3g']) {
      console.log(`  ── ${network} ──`);
      const r = await measure(network);
      results[network] = r;

      const m = r.metrics;
      console.log(
        `     TTFB ${m.ttfbMs}ms · FCP ${m.fcpMs}ms · LCP ${m.lcpMs}ms · CLS ${m.cls} ` +
        `(${m.layoutShifts} shift(s)) · load ${m.loadMs}ms`
      );
      console.log(`     ${r.net.count} request(s) · ${kb(r.net.bytes)} KB transferred\n`);
    }

    const wifi = results.wifi;
    const slow = results['slow-3g'];

    // --- the assertions ---------------------------------------------------

    R(wifi.consoleErrors.length === 0 && slow.consoleErrors.length === 0,
      'no uncaught console errors on either connection',
      `${wifi.consoleErrors.length} / ${slow.consoleErrors.length}`);

    R(wifi.net.failed === 0 && slow.net.failed === 0,
      'no failed requests',
      `${wifi.net.failed} / ${slow.net.failed}`);

    R(kb(wifi.net.bytes) <= BUDGET.transferKB,
      `the sign-in screen transfers under ${BUDGET.transferKB} KB`,
      `${kb(wifi.net.bytes)} KB`);

    R(wifi.net.count <= BUDGET.requests,
      `under ${BUDGET.requests} requests to first render`,
      `${wifi.net.count}`);

    R(wifi.metrics.lcpMs <= BUDGET.lcpWifiMs,
      `LCP under ${BUDGET.lcpWifiMs}ms on a fast connection`,
      `${wifi.metrics.lcpMs}ms`);

    // The one this file was written to settle.
    R(wifi.metrics.cls <= BUDGET.cls,
      `CLS at or under ${BUDGET.cls} -- the layout does not jump while loading`,
      `${wifi.metrics.cls} across ${wifi.metrics.layoutShifts} shift(s)`);

    // Icons are exempt. index.html declares omnya_logo.png as both `icon` and
    // `apple-touch-icon`, which are different declarations for different
    // purposes, and some browsers fetch each. Collapsing them would cost the
    // iOS home-screen icon to save one small, non-render-blocking request.
    // Scoping the assertion is not the same as silencing it: a duplicated
    // script, stylesheet or font still fails.
    const ICON_LIKE = /favicon|apple-touch-icon|omnya_logo\.png|manifest\.json/i;
    const realDupes = wifi.dupes.filter(d => !ICON_LIKE.test(d.url));

    R(realDupes.length === 0,
      'no script, stylesheet or font is requested more than once',
      realDupes.length
        ? realDupes.map(d => `${d.url.split('/').pop()} x${d.count}`).join(', ')
        : (wifi.dupes.length ? `none (${wifi.dupes.length} icon duplicate(s) ignored)` : 'none'));

    // --- context, not assertions ------------------------------------------

    console.log('\n  Where this started (dev server, before the shell was added):');
    console.log('    wifi     LCP 1900ms · CLS 0.6265 · 9 req · 587 KB   (one unminified bundle)');
    console.log('    slow-3g  LCP 16096ms · CLS 0.6265 · 8 req · 587 KB');
    console.log('  The 0.63 was one shift: BODY 20,14 -> 0,900. Fixed by the inline');
    console.log('  shell in public/index.html -- see the note there.');
    console.log('\n  Production, measured just now:');
    console.log(`    wifi     LCP ${wifi.metrics.lcpMs}ms · CLS ${wifi.metrics.cls} · ` +
                `${wifi.net.count} req · ${kb(wifi.net.bytes)} KB`);
    console.log(`    slow-3g  LCP ${slow.metrics.lcpMs}ms · CLS ${slow.metrics.cls} · ` +
                `${slow.net.count} req · ${kb(slow.net.bytes)} KB`);

  } catch (err) {
    console.error('\n  HARNESS ERROR: ' + (err && err.message));
    console.error(err && err.stack);
    if (server) server.close();
    process.exit(2);
  } finally {
    if (server) server.close();
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
