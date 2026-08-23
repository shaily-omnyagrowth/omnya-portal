// tests/security-headers.test.cjs
//
// The portal served no security headers at all: no CSP, no X-Frame-Options,
// no HSTS. vercel.json now sets them.
//
// A Content-Security-Policy that breaks the application is worse than none,
// because it fails silently in production and looks like a broken app rather
// than a misconfiguration. So this suite does not check that the header exists
// -- it serves the real build behind the real policy and drives Chrome through
// it, listening for securitypolicyviolation events.
//
// It reads the header values straight out of vercel.json, so the test and the
// deployed configuration cannot drift apart. Editing the policy without
// re-running this is the mistake it exists to catch.
//
//   npm run build && node tests/security-headers.test.cjs
//
// Exit codes: 0 pass · 1 real failure · 3 blocked (no build present).

const http = require('http');
const fs = require('fs');
const path = require('path');
const chrome = require('./lib/chrome.cjs');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
const PORT = Number(process.env.SEC_PORT || 3210);

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

// --- the real configuration -------------------------------------------------

function headersFromVercelJson(urlPath) {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const out = {};
  for (const rule of cfg.headers || []) {
    // Vercel source patterns; only the two shapes this project uses.
    const matches =
      rule.source === '/(.*)' ||
      (rule.source === '/static/(.*)' && urlPath.startsWith('/static/'));
    if (!matches) continue;
    for (const h of rule.headers || []) out[h.key] = h.value;
  }
  return out;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

function serveBuild() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      let filePath = path.join(BUILD, urlPath);
      if (!filePath.startsWith(BUILD)) { res.writeHead(403).end('forbidden'); return; }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(BUILD, 'index.html');
      }
      const body = fs.readFileSync(filePath);
      res.writeHead(200, Object.assign(
        {
          'content-type': MIME[path.extname(filePath)] || 'application/octet-stream',
          'content-length': body.length,
        },
        headersFromVercelJson(urlPath)
      ));
      res.end(body);
    });
    server.on('error', reject);
    server.listen(PORT, () => resolve(server));
  });
}

// --- what the policy must say -----------------------------------------------

function parseCsp(value) {
  const map = {};
  for (const part of String(value || '').split(';')) {
    const bits = part.trim().split(/\s+/).filter(Boolean);
    if (!bits.length) continue;
    map[bits[0]] = bits.slice(1);
  }
  return map;
}

(async () => {
  console.log('\nSecurity headers -- the real policy, against the real build\n');

  if (!fs.existsSync(path.join(BUILD, 'index.html'))) {
    console.log('  BLOCKED  no production build at ./build — run: npm run build');
    process.exit(3);
  }

  const configured = headersFromVercelJson('/');
  const csp = parseCsp(configured['Content-Security-Policy']);

  // --- the header set ------------------------------------------------------

  for (const key of [
    'Content-Security-Policy',
    'X-Frame-Options',
    'X-Content-Type-Options',
    'Referrer-Policy',
    'Strict-Transport-Security',
    'Permissions-Policy',
  ]) {
    R(!!configured[key], `${key} is configured`, configured[key] ? 'set' : 'MISSING');
  }

  // --- the policy's own claims --------------------------------------------

  R(!(csp['script-src'] || []).includes("'unsafe-inline'"),
    "script-src does not allow 'unsafe-inline'",
    (csp['script-src'] || []).join(' '));

  R(!(csp['script-src'] || []).includes("'unsafe-eval'"),
    "script-src does not allow 'unsafe-eval'");

  R((csp['frame-ancestors'] || []).includes("'none'"),
    "frame-ancestors is 'none' — the portal cannot be framed");

  R((csp['object-src'] || []).includes("'none'"),
    "object-src is 'none'");

  // style-src DOES need 'unsafe-inline', and that is a deliberate, documented
  // concession rather than an oversight: every component in src/ styles itself
  // with a JSX style={{...}} prop, and src/App.js injects its stylesheet as a
  // <style> element at runtime. Removing it means rewriting the entire UI's
  // styling approach. Asserted so the reason is recorded next to the fact.
  R((csp['style-src'] || []).includes("'unsafe-inline'"),
    "style-src allows 'unsafe-inline' (required: JSX style props + injected <style>)");

  // The browser must not be able to reach Anthropic. src/App.js:720 posts to
  // api.anthropic.com directly with no auth header, so it can only ever 401 --
  // and the tempting "fix" is to put ANTHROPIC_API_KEY in the frontend, which
  // would hand it to every visitor. Leaving the host off connect-src makes the
  // call fail loudly and blocks that shortcut.
  const connect = (csp['connect-src'] || []).join(' ');
  R(!/anthropic/i.test(connect),
    'connect-src does not allow api.anthropic.com',
    connect);

  R(/supabase\.co/.test(connect) && /wss:/.test(connect),
    'connect-src allows Supabase REST and realtime',
    connect);

  // --- and now the part that actually matters ------------------------------

  let server;
  try {
    server = await serveBuild();

    const session = await chrome.open({
      suite: 'security-headers',
      network: 'wifi',
      base: `http://localhost:${PORT}`,
      timeout: 60000,
    });

    // securitypolicyviolation is the authoritative signal; console text is
    // formatted differently across Chrome versions and is easy to miss.
    await session.page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', e => {
        window.__cspViolations.push({
          directive: e.effectiveDirective || e.violatedDirective,
          blocked: String(e.blockedURI || '').slice(0, 120),
          line: e.lineNumber || null,
        });
      });
    });

    try {
      const res = await session.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      R(res && res.status() < 400, 'the app loads under the policy',
        res ? `HTTP ${res.status()}` : 'no response');

      await session.page.waitForSelector('.login-card', { timeout: 45000 });
      await session.settle({ timeout: 20000 });
      R(true, 'the sign-in screen renders with the policy enforced');

      const violations = await session.page.evaluate(() => window.__cspViolations || []);
      const grouped = violations.reduce((m, v) => {
        const k = `${v.directive} <- ${v.blocked}`;
        m[k] = (m[k] || 0) + 1;
        return m;
      }, {});
      const summary = Object.entries(grouped).map(([k, n]) => `${k} x${n}`);

      R(violations.length === 0, 'no CSP violations while loading the app',
        violations.length ? summary.join(' | ') : 'none');

      // The fonts are the most likely casualty of a too-tight policy, and a
      // silent fallback looks like a design choice rather than a bug.
      const fontsLoaded = await session.page.evaluate(async () => {
        try {
          await document.fonts.ready;
          return [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family);
        } catch { return []; }
      });
      R(fontsLoaded.some(f => /Bebas|DM Sans/i.test(f)),
        'the webfonts still load through the policy',
        fontsLoaded.length ? [...new Set(fontsLoaded)].join(', ') : 'NONE LOADED');

      R(session.console.errors().length === 0,
        'no uncaught console errors under the policy',
        String(session.console.errors().length));

      R(session.net.summary().failed === 0,
        'no request was blocked into failure',
        String(session.net.summary().failed));

      // Verify what the browser actually received, not just what we configured.
      const served = session.security.documentHeaders() || {};
      R(!!served['content-security-policy'],
        'the document really carried the CSP header',
        served['content-security-policy'] ? 'yes' : 'no');

      // missingHeaders() returns { present, missing }, not a bare array. Used
      // as an array this reads `undefined === 0` -> false, so it failed while
      // printing "all present" beside itself. A test whose verdict contradicts
      // its own evidence is worse than no test.
      const { present, missing } = session.security.missingHeaders();
      R(Array.isArray(missing) && missing.length === 0,
        'no expected security header is missing on the document',
        missing && missing.length
          ? 'MISSING: ' + missing.join(', ')
          : Object.keys(present).length + ' present');

      await session.shot('under-csp');
    } finally {
      await session.close();
    }
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
