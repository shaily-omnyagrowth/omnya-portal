// tests/oauth-handoff.test.cjs
//
// Drives the OAuth hand-off in a real Chrome, UNDER THE PRODUCTION HEADERS.
//
// That last part is the whole point. The first popup implementation relied on
// an inline <script> in the callback response, window.opener.postMessage, and
// polling popup.closed. All three work on `react-scripts start`, which sends no
// security headers, and all three break on Vercel, where vercel.json sends
//
//     Content-Security-Policy:    script-src 'self'
//     Cross-Origin-Opener-Policy: same-origin
//
// So this test reads those two headers out of vercel.json and serves them, puts
// the "provider" on a DIFFERENT ORIGIN so the opener is genuinely severed, and
// then checks what a creator would actually experience.
//
// It is offline and needs no Supabase, no provider credentials and no dev
// server. What it cannot cover is the provider's own consent screen — whether
// TikTok / Meta / Google accept our client id, scopes and redirect URI is
// decided in their consoles, and only a real sign-in proves it.
//
//   node tests/oauth-handoff.test.cjs

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let chromium;
try {
  ({ chromium } = require('playwright-core'));
} catch {
  console.error('SKIP: playwright-core is not installed.  npm i -D playwright-core');
  process.exit(0);
}

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => p && fs.existsSync(p));
if (!CHROME) {
  console.error('SKIP: no Chrome found. Set CHROME_PATH.');
  process.exit(0);
}

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

// The real production headers, not a copy of them.
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const globalHeaders = (vercel.headers.find((h) => h.source === '/(.*)') || { headers: [] }).headers;
const header = (name) => (globalHeaders.find((h) => h.key.toLowerCase() === name.toLowerCase()) || {}).value;
const CSP = header('Content-Security-Policy');
const COOP = header('Cross-Origin-Opener-Policy');

const { oauthCompleteUrl } = require(path.join(ROOT, 'api/_utils/oauth'));

// A stand-in for the portal tab. It speaks exactly the protocol
// src/CreatorConnections.js speaks — same channel, same ack — from an external
// script, because under this CSP an inline one would not run.
const PORTAL_HTML = `<!doctype html><title>portal</title><button id="go">connect</button><script src="/portal-stub.js"></script>`;
const PORTAL_JS = `
  window.__results = []; window.__popup = null;
  var ch = new BroadcastChannel('omnya-oauth');
  ch.onmessage = function (ev) {
    if (!ev.data || ev.data.type !== 'oauth_result') return;
    ch.postMessage({ type: 'oauth_ack' });
    window.__results.push(ev.data);
  };
  document.getElementById('go').addEventListener('click', function () {
    var p = window.open('', 'omnya_oauth_test', 'width=500,height=600');
    window.__popup = p;
    p.location.href = window.__providerUrl;
  });
`;

function serve(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

(async () => {
  console.log('OAuth hand-off -- under the production CSP and COOP');
  R(/script-src 'self'/.test(CSP || ''), "vercel.json still sends script-src 'self'", CSP ? '' : 'header not found');
  R(COOP === 'same-origin', 'vercel.json still sends COOP same-origin', String(COOP));

  // Portal origin.
  const portal = await serve((req, res) => {
    const url = new URL(req.url, 'http://x');
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('Cross-Origin-Opener-Policy', COOP);
    const file = { '/oauth-complete.html': 'public/oauth-complete.html', '/oauth-complete.js': 'public/oauth-complete.js' }[url.pathname];
    if (file) {
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8');
      return res.end(fs.readFileSync(path.join(ROOT, file)));
    }
    if (url.pathname === '/portal-stub.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(PORTAL_JS); }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(PORTAL_HTML); // "/" and "/?page=social-connections..."
  });
  const PORTAL = `http://127.0.0.1:${portal.port}`;

  // Provider origin: a different port is a different origin, which is what
  // makes COOP sever the popup. It bounces straight back the way a real
  // callback does, using the app's own URL builder.
  const provider = await serve((req, res) => {
    const url = new URL(req.url, 'http://x');
    const outcome = url.searchParams.get('outcome');
    const target = oauthCompleteUrl(PORTAL, outcome === 'ok'
      ? { platform: 'tiktok', connected: 'tiktok' }
      : { platform: 'tiktok', error: 'tiktok_token_failed' });
    res.writeHead(302, { Location: target });
    res.end();
  });
  // localhost vs 127.0.0.1 guarantees a different origin AND a different site.
  const PROVIDER = `http://localhost:${provider.port}`;

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    // ---- 1. popup flow, success ---------------------------------------------
    let ctx = await browser.newContext();
    let page = await ctx.newPage();
    const cspViolations = [];
    ctx.on('page', (p) => p.on('console', (m) => {
      if (/Content Security Policy|Refused to (execute|load)/i.test(m.text())) cspViolations.push(m.text().slice(0, 140));
    }));
    await page.goto(PORTAL + '/?page=social-connections');
    await page.evaluate((u) => { window.__providerUrl = u; }, PROVIDER + '/authorize?outcome=ok');

    const popupPromise = ctx.waitForEvent('page');
    await page.click('#go');
    const popup = await popupPromise;
    const closed = popup.waitForEvent('close', { timeout: 8000 }).then(() => true).catch(() => false);

    await page.waitForFunction(() => window.__results.length > 0, null, { timeout: 8000 }).catch(() => {});
    const results = await page.evaluate(() => window.__results);
    R(results.length === 1 && results[0].status === 'success' && results[0].platform === 'tiktok',
      'the portal tab is told the connection succeeded', JSON.stringify(results[0] || null));
    R(await closed, 'and the popup closes itself');
    R(cspViolations.length === 0, 'with no CSP violation on the completion page', cspViolations[0]);

    R(new URL(page.url()).searchParams.get('page') === 'social-connections' && !page.url().includes('connected='),
      'the portal tab never navigated away', page.url().replace(PORTAL, ''));
    await ctx.close();

    // ---- 2. popup flow, failure ---------------------------------------------
    ctx = await browser.newContext();
    page = await ctx.newPage();
    await page.goto(PORTAL + '/?page=social-connections');
    await page.evaluate((u) => { window.__providerUrl = u; }, PROVIDER + '/authorize?outcome=fail');
    const p2 = ctx.waitForEvent('page');
    await page.click('#go');
    const popup2 = await p2;
    const closed2 = popup2.waitForEvent('close', { timeout: 8000 }).then(() => true).catch(() => false);
    await page.waitForFunction(() => window.__results.length > 0, null, { timeout: 8000 }).catch(() => {});
    const r2 = await page.evaluate(() => window.__results[0] || null);
    R(r2 && r2.status === 'error' && r2.error === 'tiktok_token_failed',
      'a failed sign-in reaches the portal tab with its reason', JSON.stringify(r2));
    R(await closed2, 'and the popup still closes, leaving the creator on the portal');
    await ctx.close();

    // ---- 3. full-page flow (popup blocked): nobody is listening --------------
    ctx = await browser.newContext();
    page = await ctx.newPage();
    await page.goto(PROVIDER + '/authorize?outcome=ok');
    await page.waitForURL(/page=social-connections/, { timeout: 8000 }).catch(() => {});
    const u3 = new URL(page.url());
    R(u3.origin === PORTAL && u3.searchParams.get('connected') === 'tiktok',
      'with no portal tab listening, success carries on to the portal by itself', page.url().replace(PORTAL, ''));
    await ctx.close();

    // ---- 4. full-page flow, failure: never a dead end ------------------------
    ctx = await browser.newContext();
    page = await ctx.newPage();
    await page.goto(PROVIDER + '/authorize?outcome=fail');
    await page.waitForSelector('#retryBtn:not([hidden])', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2000); // past the ack wait; an error must NOT auto-leave
    R(page.url().includes('/oauth-complete'), 'a failure stays on screen long enough to be read', page.url().replace(PORTAL, ''));
    const text = await page.textContent('main');
    R(/couldn.t connect TikTok/i.test(text) && /configuration issue/i.test(text),
      'and says what went wrong in plain words', text.replace(/\s+/g, ' ').slice(0, 90));
    R(/Reference: tiktok_token_failed/.test(text), 'with the reference code for support');

    const back = await page.getAttribute('#returnLink', 'href');
    R(/page=social-connections/.test(back) && /error=tiktok_token_failed/.test(back),
      '"Return to Omnya Portal" goes back to Social Channels with the error', back);
    await page.click('#retryBtn');
    await page.waitForURL(/retry=tiktok/, { timeout: 8000 }).catch(() => {});
    R(/retry=tiktok/.test(page.url()) && new URL(page.url()).origin === PORTAL,
      '"Try again" works under the CSP and returns to the portal ready to reconnect', page.url().replace(PORTAL, ''));
    await ctx.close();

    // ---- 5. hostile query string --------------------------------------------
    ctx = await browser.newContext();
    page = await ctx.newPage();
    let dialog = false;
    page.on('dialog', (d) => { dialog = true; d.dismiss(); });
    await page.goto(PORTAL + '/oauth-complete.html?status=error&platform=' +
      encodeURIComponent('"><img src=x onerror=alert(1)>') + '&error=' + encodeURIComponent('<script>alert(1)</script>'));
    await page.waitForTimeout(800);
    const injected = await page.evaluate(() => document.querySelectorAll('main img, main script').length);
    R(!dialog && injected === 0, 'markup in the query string is rendered as text, never as HTML', 'injected nodes=' + injected);
    await ctx.close();
  } finally {
    await browser.close();
    portal.srv.close();
    provider.srv.close();
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('\nHARNESS ERROR:', e); process.exit(2); });
