// tests/lib/chrome.cjs
//
// A real-user browser capability layer: Playwright + the Chrome DevTools
// Protocol, wrapped so a test can assert on what a person actually experiences.
//
// This exists for the same reason the rest of tests/ does. During the audit,
// three "failures" turned out to be faults in the test rather than the app. So
// every probe here follows one rule:
//
//   A wrong test must fail loudly as a broken test, never as a false bug report.
//
// In practice that means:
//   · nothing is dropped by a blanket "ignore errors" — every suppression is an
//     explicit allowlist entry with a stated reason, and suppressed items stay
//     retrievable via .suppressed(), so a wrongly-hidden error is visible
//     rather than silent;
//   · a measurement that could not be taken returns null, never 0. A zero LCP
//     reads as an impossibly good real number; a null LCP reads as "not
//     measured", which is the truth;
//   · every failure message names the URL, the selector or the excerpt that
//     produced it, so the reader can tell at a glance whether the test or the
//     app is wrong.
//
// Usage:
//
//   const chrome = require('./lib/chrome.cjs');
//   const s = await chrome.open({ suite: 'smoke', network: 'slow-3g' });
//   await s.goto('/');
//   await s.settle();
//   await s.shot('login');
//   s.console.assertNoErrors();
//   await s.security.assertNoSecretsOnTheWire();
//   console.log(await s.perf.line());
//   await s.close();

const fs = require('fs');
const path = require('path');
const net = require('net');

const ROOT = path.join(__dirname, '..', '..');
const ARTIFACTS = path.join(ROOT, 'tests', 'artifacts');

let chromium;
try { ({ chromium } = require('playwright-core')); }
catch {
  throw new Error(
    'tests/lib/chrome.cjs needs a browser driver.\n' +
    '  npm i -D playwright-core\n' +
    'See tests/README.md.'
  );
}

// ---------------------------------------------------------------------------
// .env, read defensively. chrome.cjs must still work without it — only the
// secret scanner degrades (it can no longer allowlist the public anon key nor
// hard-match the service-role key by value), and it reports that it degraded.
// ---------------------------------------------------------------------------
function loadEnv() {
  try {
    const out = {};
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].trim();
    }
    return out;
  } catch { return null; }
}
const ENV = loadEnv();

// ---------------------------------------------------------------------------
// 1. Launch / session
// ---------------------------------------------------------------------------

const KNOWN_BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

/** Locate a real Chromium binary, or explain exactly how to point at one. */
function resolveChromePath() {
  if (process.env.CHROME_PATH) {
    if (fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
    throw new Error(
      `CHROME_PATH is set to "${process.env.CHROME_PATH}" but nothing is there.\n` +
      '  Unset it to fall back to the known install locations, or point it at a real chrome.exe.'
    );
  }
  for (const p of KNOWN_BROWSERS) if (fs.existsSync(p)) return p;
  throw new Error(
    'No Chrome or Edge binary found. Looked at:\n' +
    KNOWN_BROWSERS.map(p => '  ' + p).join('\n') + '\n' +
    'Set CHROME_PATH to the browser the tests should drive, e.g.\n' +
    '  CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" node tests/run-all.cjs'
  );
}

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3100';

/** True if something is listening. Lets a failure carry advice instead of a timeout. */
function isListening(host, port, timeout = 800) {
  return new Promise(resolve => {
    const sock = net.connect({ host, port });
    const done = ok => { try { sock.destroy(); } catch {} resolve(ok); };
    sock.setTimeout(timeout);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

function artifactDir(suite) {
  const dir = path.join(ARTIFACTS, String(suite || 'unnamed').replace(/[^a-z0-9._-]/gi, '_'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// 2. Network conditions (CDP Network.emulateNetworkConditions)
//
// The numbers are the Chrome DevTools / Lighthouse throttling constants, so
// "slow-3g" in a test means the same thing a developer sees in the DevTools
// network dropdown rather than an invented figure.
// ---------------------------------------------------------------------------

const NETWORK_PRESETS = {
  'wifi':    { offline: false, downloadThroughput: 30 * 1024 * 1024 / 8, uploadThroughput: 15 * 1024 * 1024 / 8, latency: 2 },
  'fast-3g': { offline: false, downloadThroughput: 1.6 * 1000 * 1000 / 8 * 0.9, uploadThroughput: 750 * 1000 / 8 * 0.9, latency: 150 * 3.75 },
  'slow-3g': { offline: false, downloadThroughput: 500 * 1000 / 8 * 0.8, uploadThroughput: 500 * 1000 / 8 * 0.8, latency: 400 * 5 },
  'offline': { offline: true,  downloadThroughput: 0, uploadThroughput: 0, latency: 0 },
};

function presetOrThrow(name) {
  const p = NETWORK_PRESETS[name];
  if (!p) {
    throw new Error(
      `TEST BUG: unknown network preset "${name}". Known: ${Object.keys(NETWORK_PRESETS).join(', ')}.`
    );
  }
  return p;
}

/** Human-readable summary of a preset, for the report. */
function describeNetwork(name) {
  const p = NETWORK_PRESETS[name];
  if (!p) return String(name);
  if (p.offline) return 'offline';
  const kbps = b => Math.round(b * 8 / 1000);
  return `${name} (${kbps(p.downloadThroughput)}kbps down / ${kbps(p.uploadThroughput)}kbps up / ${Math.round(p.latency)}ms RTT)`;
}

// ---------------------------------------------------------------------------
// 3. Console noise allowlist
//
// Explicit entries, each with a reason. Never a blanket ignore.
// ---------------------------------------------------------------------------

const KNOWN_CONSOLE_NOISE = [
  { re: /Download the React DevTools/i,               why: 'React DevTools install banner — dev build only' },
  { re: /favicon\.ico/i,                              why: 'favicon 404 — CRA dev serves no favicon' },
  { re: /\[HMR\]|\[WDS\]|webpack-dev-server|sockjs/i, why: 'CRA hot-module-reload chatter, not application code' },
  { re: /React Router Future Flag/i,                  why: 'router upgrade advisory, not an error' },
  { re: /Autofocus processing was blocked/i,          why: 'Chrome autofocus notice, no user-visible effect' },
];

// Failures caused by an unset local secret rather than a defect. Mirrors the
// ENV_GAP list in ui.cjs so both report the same thing the same way.
const ENV_GAP = [
  { re: /\/api\/send-email/, why: 'RESEND_API_KEY is still the .env.example placeholder locally' },
];

const firstMatch = (list, text) => list.find(e => e.re.test(text || ''));

// ---------------------------------------------------------------------------
// 4. Secret scanning
//
// The most important probe here. It reads every response body and looks for
// material that must never travel to a browser.
//
// Nuance is what makes it useful. Three things legitimately look secret-shaped
// on this app's wire:
//   · the Supabase *anon* key — a JWT, public by design, compiled into the bundle;
//   · the signed-in user's own access/refresh token from /auth/v1/token, which
//     is the entire purpose of that endpoint;
//   · nothing else.
// Those two are allowlisted by exact value and exact endpoint with the reason
// recorded. Everything else is a finding — in particular a creator's stored
// OAuth access_token coming back from one of *our* /api/* handlers, which is
// precisely the leak this app is exposed to.
// ---------------------------------------------------------------------------

const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g;

const SECRET_RULES = [
  { id: 'stripe_live_secret_key', severity: 'critical', re: /\bsk_live_[A-Za-z0-9]{6,}/g,
    why: 'a live Stripe secret key' },
  { id: 'stripe_webhook_secret',  severity: 'critical', re: /\bwhsec_[A-Za-z0-9]{6,}/g,
    why: 'a Stripe webhook signing secret' },
  // NOTE: there is deliberately no rule matching the bare word "service_role".
  // It looks like the obvious probe and it is a false-alarm generator:
  // @supabase/auth-js ships a doc comment warning you never to expose the
  // service_role key, that comment is compiled into bundle.js, and the rule
  // then reports a critical leak on every single page load. It did exactly
  // that here before being removed.
  //
  // The real question — "is a service key on the wire?" — is answered
  // precisely twice below in scanForSecrets(): once by matching the actual
  // SUPABASE_SERVICE_ROLE_KEY value, and once by decoding every JWT and
  // reading its `role` claim. Those catch a genuine leak even when the key
  // differs from .env, and they do not fire on prose about the key.
  { id: 'oauth_token_field',      severity: 'critical', re: /"(access_token|refresh_token)"\s*:\s*"[^"]{8,}"/g,
    why: 'an OAuth access/refresh token in a response body' },
  { id: 'encrypted_token_field',  severity: 'warn',     re: /"(access_token_encrypted|refresh_token_encrypted)"\s*:\s*"[^"]{8,}"/g,
    why: 'an encrypted creator token — encrypted or not, it should not be sent to the client' },
];

// Endpoints whose whole job is to hand the caller their own session.
const SECRET_URL_ALLOW = [
  { re: /\/auth\/v1\/(token|user|signup|logout|verify|recover|magiclink|otp|resend|callback)/,
    why: "Supabase auth endpoint — returning the caller's own session is the point of it" },
];

const redact = s => {
  const t = String(s);
  return t.length <= 14 ? '***' : `${t.slice(0, 6)}\u2026${t.slice(-4)} (${t.length} chars)`;
};

function decodeJwtPayload(tok) {
  try {
    const part = tok.split('.')[1];
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch { return null; }
}

// Injected before any page script runs, so the observers see the first paint.
const PERF_INIT_SCRIPT = `(() => {
  if (window.__omnyaPerf) return;
  var p = window.__omnyaPerf = { lcp: 0, cls: 0, fcp: 0, shifts: 0 };
  try {
    new PerformanceObserver(function (l) {
      var es = l.getEntries();
      for (var i = 0; i < es.length; i++) {
        var e = es[i];
        p.lcp = Math.max(p.lcp, e.renderTime || e.loadTime || e.startTime || 0);
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver(function (l) {
      var es = l.getEntries();
      for (var i = 0; i < es.length; i++) {
        var e = es[i];
        if (!e.hadRecentInput) { p.cls += e.value; p.shifts++; }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver(function (l) {
      var es = l.getEntries();
      for (var i = 0; i < es.length; i++) {
        if (es[i].name === 'first-contentful-paint') p.fcp = es[i].startTime;
      }
    }).observe({ type: 'paint', buffered: true });
  } catch (e) {}
})();`;

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

class Session {
  constructor(opts) {
    this.opts = opts;
    this.suite = opts.suite;
    this.dir = artifactDir(opts.suite);
    this.base = opts.base || BASE;
    this.networkName = opts.network || 'wifi';
    this.cpuRate = opts.cpu || 1;
    this._shotSeq = 0;
    this._records = [];       // network accounting
    this._bodies = [];        // { url, method, resourceType, status, promise }
    this._console = [];       // { kind, type, text, at, location }
    this._docResponses = [];  // main-frame document responses, for header probes
    this._tracing = false;
    this.shots = [];
  }

  // ---- wiring -------------------------------------------------------------
  _wireNetwork(page) {
    const started = new Map();

    page.on('request', req => { started.set(req, Date.now()); });

    page.on('response', res => {
      const req = res.request();
      try {
        if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
          this._docResponses.push({ url: res.url(), status: res.status(), headers: res.headers() });
        }
      } catch { /* frame detached */ }
      // Start the body read immediately: awaiting it later races a navigation
      // and loses the body. Binary types are skipped — they cannot carry a
      // secret this scanner would recognise and they cost megabytes.
      let type = 'other';
      try { type = req.resourceType(); } catch {}
      if (!['image', 'font', 'media'].includes(type)) {
        this._bodies.push({
          url: res.url(), method: req.method(), resourceType: type, status: res.status(),
          promise: res.text().then(t => t, () => null),
        });
      }
    });

    const finish = (req, extra) => {
      const t0 = started.get(req) || Date.now();
      const res = extra.response || null;
      let size = null;
      try {
        size = extra.sizes
          ? (extra.sizes.responseBodySize || 0) + (extra.sizes.responseHeadersSize || 0)
          : null;
      } catch { size = null; }
      this._records.push({
        url: req.url(),
        method: req.method(),
        resourceType: (() => { try { return req.resourceType(); } catch { return 'other'; } })(),
        status: res ? res.status() : null,
        failure: extra.failure || null,
        transferBytes: size,
        durationMs: Date.now() - t0,
        at: t0,
      });
      started.delete(req);
    };

    page.on('requestfinished', async req => {
      let sizes = null, response = null;
      try { sizes = await req.sizes(); } catch { /* already collected */ }
      try { response = await req.response(); } catch { /* ignore */ }
      finish(req, { sizes, response });
    });

    page.on('requestfailed', req => {
      const f = (() => { try { return req.failure(); } catch { return null; } })();
      finish(req, { failure: (f && f.errorText) || 'failed' });
    });
  }

  _wireConsole(page) {
    page.on('console', m => {
      this._console.push({
        kind: 'console', type: m.type(), text: m.text(), at: Date.now(),
        location: (() => { try { const l = m.location(); return `${l.url}:${l.lineNumber}`; } catch { return ''; } })(),
      });
    });
    page.on('pageerror', e => {
      this._console.push({
        kind: 'pageerror', type: 'error', text: String((e && e.message) || e),
        at: Date.now(), location: '',
      });
    });
  }

  // ---- lifecycle ----------------------------------------------------------
  async _start() {
    this.chromePath = resolveChromePath();

    this.browser = await chromium.launch({
      executablePath: this.chromePath,
      headless: !this.opts.headed,
      args: [
        // A fresh profile per run: nothing left by an earlier suite — cookies,
        // storage, a service worker — can make a test pass or fail by accident.
        '--no-first-run', '--no-default-browser-check',
        '--disable-features=Translate', '--disable-background-networking',
        '--disable-sync', '--mute-audio',
      ],
    });

    this.context = await this.browser.newContext({
      viewport: this.opts.viewport || { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
    });
    this.context.setDefaultTimeout(this.opts.timeout || 30000);

    await this.context.addInitScript(PERF_INIT_SCRIPT);

    if (this.opts.trace !== false) await this.startTrace();

    this.page = await this.context.newPage();
    this._wireNetwork(this.page);
    this._wireConsole(this.page);

    this.cdp = await this.context.newCDPSession(this.page);
    await this.cdp.send('Network.enable');
    await this.setNetwork(this.networkName);
    if (this.cpuRate !== 1) await this.setCpuThrottle(this.cpuRate);

    return this;
  }

  async startTrace() {
    try {
      await this.context.tracing.start({ screenshots: true, snapshots: true, sources: false });
      this._tracing = true;
    } catch (e) {
      // Tracing is triage sugar. Losing it must never fail a run — but it must
      // not vanish silently either, so the reason is kept on the session.
      this.traceError = e.message;
    }
  }

  async stopTrace() {
    if (!this._tracing) return null;
    // Two sessions in one suite (wifi then slow-3g, say) must not overwrite
    // each other's trace — the second one is usually the interesting one.
    let out = path.join(this.dir, `${this.opts.traceName || 'trace'}.zip`);
    for (let i = 2; fs.existsSync(out); i++) {
      out = path.join(this.dir, `${this.opts.traceName || 'trace'}-${i}.zip`);
    }
    try { await this.context.tracing.stop({ path: out }); this._tracing = false; return out; }
    catch (e) { this.traceError = e.message; this._tracing = false; return null; }
  }

  async close() {
    const trace = await this.stopTrace();
    try { await this.context.close(); } catch { /* already gone */ }
    try { await this.browser.close(); } catch { /* already gone */ }
    return trace;
  }

  // ---- conditions ---------------------------------------------------------
  /** Apply a named network preset via CDP. */
  async setNetwork(name) {
    const p = presetOrThrow(name);
    this.networkName = name;
    await this.cdp.send('Network.emulateNetworkConditions', {
      offline: p.offline,
      downloadThroughput: p.downloadThroughput,
      uploadThroughput: p.uploadThroughput,
      latency: p.latency,
    });
    return describeNetwork(name);
  }

  // The two the brief calls out, first-class.
  slow3g()  { return this.setNetwork('slow-3g'); }
  fast3g()  { return this.setNetwork('fast-3g'); }
  wifi()    { return this.setNetwork('wifi'); }
  offline() { return this.setNetwork('offline'); }

  /** 1 = no throttle, 4 is about a mid-range phone, 6 a low-end one. */
  async setCpuThrottle(rate) {
    if (!(rate >= 1)) throw new Error(`TEST BUG: CPU throttle rate must be >= 1, got ${rate}`);
    this.cpuRate = rate;
    await this.cdp.send('Emulation.setCPUThrottlingRate', { rate });
    return rate;
  }

  // ---- navigation ---------------------------------------------------------
  /**
   * Navigate. A relative path resolves against the base URL, which defaults to
   * :3100 — the dev server that actually serves /api/*. Pointing a browser test
   * at :3000 is exactly the mistake that made a healthy page look broken during
   * the audit, so a dead port is reported as such rather than as a timeout.
   */
  async goto(url = '/', options = {}) {
    const full = /^https?:/.test(url) ? url : this.base.replace(/\/$/, '') + url;
    try {
      return await this.page.goto(full, { waitUntil: 'domcontentloaded', timeout: 60000, ...options });
    } catch (e) {
      const u = new URL(full);
      const up = await isListening(u.hostname, Number(u.port || 80));
      if (!up) {
        throw new Error(
          `Could not reach ${full} — nothing is listening on ${u.hostname}:${u.port}.\n` +
          '  Browser tests must point at the dev server (:3100): it serves /api/* from the\n' +
          '  real handlers and proxies everything else to CRA on :3000.\n' +
          '    node tests/run-all.cjs        starts both for you\n' +
          `  Original error: ${e.message}`
        );
      }
      throw e;
    }
  }

  /**
   * Wait until the page stops changing. Falls back to this session's own
   * request accounting when networkidle never arrives, which CRA's dev polling
   * can cause.
   */
  async settle({ idleMs = 700, timeout = 20000 } = {}) {
    const deadline = Date.now() + timeout;
    try {
      await this.page.waitForLoadState('networkidle', { timeout: Math.min(timeout, 15000) });
    } catch {
      while (Date.now() < deadline) {
        const last = this._records.length
          ? Math.max(...this._records.map(r => r.at + r.durationMs)) : 0;
        if (Date.now() - last > idleMs) break;
        await this.page.waitForTimeout(150);
      }
    }
    await this.page.waitForTimeout(idleMs);
  }

  // ---- artifacts ----------------------------------------------------------
  /** Screenshot to tests/artifacts/<suite>/NN-<step>.png. */
  async shot(name, { fullPage = true } = {}) {
    const seq = String(++this._shotSeq).padStart(2, '0');
    const safe = String(name).replace(/[^a-z0-9._-]/gi, '-').slice(0, 60);
    const file = path.join(this.dir, `${seq}-${safe}.png`);
    try {
      await this.page.screenshot({ path: file, fullPage });
      this.shots.push(file);
      return file;
    } catch (e) { this.shotError = e.message; return null; }
  }

  /** Index into the logs; pass it to net.since() / console.since() to scope a step. */
  mark() { return { net: this._records.length, console: this._console.length }; }

  // ---- network accounting -------------------------------------------------
  get net() {
    const self = this;
    // Dev-server chatter that says nothing about the application.
    const ignoreDefault = [/sockjs-node/, /hot-update/, /__webpack_hmr/, /favicon\.ico/, /^ws:/];
    return {
      requests: (from = 0) => self._records.slice(from),
      since: m => self._records.slice(m ? m.net : 0),

      failed: ({ ignore = ignoreDefault, from = 0 } = {}) =>
        self._records.slice(from).filter(r =>
          (r.failure || (r.status != null && r.status >= 400)) &&
          !ignore.some(re => re.test(r.url))),

      slowerThan: (ms, { from = 0 } = {}) =>
        self._records.slice(from)
          .filter(r => r.durationMs > ms)
          .sort((a, b) => b.durationMs - a.durationMs),

      totalBytes: ({ from = 0 } = {}) =>
        self._records.slice(from).reduce((s, r) => s + (r.transferBytes || 0), 0),

      /**
       * The same GET fired more than once. In this app that is the N+1 signal:
       * a list page re-fetching the same row per item, or an effect with a
       * missing dependency re-running on every render.
       */
      duplicateRequests: ({ ignore = ignoreDefault, from = 0, minCount = 2 } = {}) => {
        const byUrl = new Map();
        for (const r of self._records.slice(from)) {
          if (r.method !== 'GET') continue;
          if (ignore.some(re => re.test(r.url))) continue;
          if (!byUrl.has(r.url)) byUrl.set(r.url, []);
          byUrl.get(r.url).push(r);
        }
        return [...byUrl.entries()]
          .filter(([, rs]) => rs.length >= minCount)
          .map(([url, rs]) => ({ url, count: rs.length, totalMs: rs.reduce((s, r) => s + r.durationMs, 0) }))
          .sort((a, b) => b.count - a.count);
      },

      /** Compact form for a report. */
      summary: ({ from = 0 } = {}) => {
        const rs = self._records.slice(from);
        return {
          count: rs.length,
          bytes: rs.reduce((s, r) => s + (r.transferBytes || 0), 0),
          failed: rs.filter(r => r.failure || (r.status != null && r.status >= 400)).length,
          slowest: rs.slice().sort((a, b) => b.durationMs - a.durationMs).slice(0, 3)
            .map(r => ({ url: r.url, ms: r.durationMs, status: r.status })),
        };
      },
    };
  }

  // ---- console ------------------------------------------------------------
  get console() {
    const self = this;
    const classify = (from = 0) => {
      const errors = [], noise = [], gaps = [];
      for (const e of self._console.slice(from)) {
        if (e.type !== 'error' && e.kind !== 'pageerror') continue;
        const gap = firstMatch(ENV_GAP, e.text);
        if (gap) { gaps.push({ ...e, why: gap.why }); continue; }
        const known = firstMatch(KNOWN_CONSOLE_NOISE, e.text);
        if (known) { noise.push({ ...e, why: known.why }); continue; }
        errors.push(e);
      }
      return { errors, noise, gaps };
    };

    return {
      all: () => self._console.slice(),
      messages: type => self._console.filter(e => !type || e.type === type),
      /** Genuine uncaught errors and console.error calls. */
      errors: (m) => classify(m ? m.console : 0).errors,
      /** Suppressed by the allowlist, with the reason — never silently dropped. */
      suppressed: (m) => classify(m ? m.console : 0).noise,
      /** Failures caused by an unset local secret rather than by the app. */
      envGaps: (m) => classify(m ? m.console : 0).gaps,
      since: m => self._console.slice(m ? m.console : 0),
      reset: () => { self._console.length = 0; },
      /**
       * Throw unless the page raised no uncaught errors. The message carries the
       * suppression counts, so a wrongly-allowlisted error is still visible.
       */
      assertNoErrors: (m) => {
        const { errors, noise, gaps } = classify(m ? m.console : 0);
        if (!errors.length) return { ok: true, suppressed: noise.length, envGaps: gaps.length };
        throw new Error(
          `${errors.length} uncaught console/page error(s):\n` +
          errors.slice(0, 8).map(e =>
            `  · [${e.kind}] ${e.text.slice(0, 220)}${e.location ? `\n      at ${e.location}` : ''}`
          ).join('\n') +
          `\n  (${noise.length} known-noise message(s) suppressed by the allowlist, ` +
          `${gaps.length} local-environment gap(s) — call .suppressed() / .envGaps() to see them.)`
        );
      },
    };
  }

  // ---- performance --------------------------------------------------------
  get perf() {
    const self = this;
    return {
      /**
       * Navigation Timing + Paint Timing + LCP/CLS.
       * Anything that could not be measured comes back null, never 0 — a zero
       * would read as a real, impossibly good number in a report.
       */
      metrics: async () => {
        const m = await self.page.evaluate(() => {
          const nav = performance.getEntriesByType('navigation')[0];
          const p = window.__omnyaPerf || null;
          const num = v => (typeof v === 'number' && v > 0 ? Math.round(v * 10) / 10 : null);
          const fcpEntry = performance.getEntriesByName('first-contentful-paint')[0];
          return {
            ttfbMs: nav ? num(nav.responseStart - nav.requestStart) : null,
            fcpMs: fcpEntry ? num(fcpEntry.startTime) : (p ? num(p.fcp) : null),
            lcpMs: p ? num(p.lcp) : null,
            cls: p && typeof p.cls === 'number' ? Math.round(p.cls * 10000) / 10000 : null,
            layoutShifts: p ? p.shifts : null,
            domContentLoadedMs: nav ? num(nav.domContentLoadedEventEnd - nav.startTime) : null,
            loadMs: nav ? num(nav.loadEventEnd - nav.startTime) : null,
            documentTransferBytes: nav && nav.transferSize ? nav.transferSize : null,
            jsHeapUsedMB: performance.memory
              ? Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10 : null,
            jsHeapLimitMB: performance.memory
              ? Math.round(performance.memory.jsHeapSizeLimit / 1048576) : null,
            observerInstalled: !!p,
          };
        }).catch(e => ({ error: e.message, observerInstalled: null }));

        if (m && m.observerInstalled === false) {
          m.note = 'The PerformanceObserver init script did not run — LCP/CLS are unmeasured (null), not zero.';
        }
        return {
          ...m,
          network: self.networkName,
          networkDescription: describeNetwork(self.networkName),
          cpuThrottle: self.cpuRate,
          totalTransferBytes: self.net.totalBytes(),
          requestCount: self._records.length,
        };
      },

      /** One line, for console output. */
      line: async () => {
        const m = await self.perf.metrics();
        const f = (v, u = 'ms') => (v == null ? 'n/a' : `${v}${u}`);
        return `TTFB ${f(m.ttfbMs)} · FCP ${f(m.fcpMs)} · LCP ${f(m.lcpMs)} · CLS ${m.cls ?? 'n/a'} · ` +
               `DCL ${f(m.domContentLoadedMs)} · load ${f(m.loadMs)} · heap ${f(m.jsHeapUsedMB, 'MB')} · ` +
               `${m.requestCount} req / ${Math.round((m.totalTransferBytes || 0) / 1024)}KB`;
      },
    };
  }

  // ---- security -----------------------------------------------------------
  get security() {
    const self = this;
    return {
      /** Headers on the last main-document response. */
      documentHeaders: () => (self._docResponses.length
        ? self._docResponses[self._docResponses.length - 1].headers : null),

      /**
       * Which of the wanted security headers the document did not send.
       * Returns findings rather than throwing: CRA's dev server legitimately
       * sends fewer headers than Vercel does, so the test decides what counts.
       */
      missingHeaders: (wanted = [
        'content-security-policy', 'x-frame-options',
        'x-content-type-options', 'strict-transport-security', 'referrer-policy',
      ]) => {
        const h = self.security.documentHeaders();
        if (!h) return { error: 'no main-document response recorded — navigate first', present: {}, missing: wanted };
        const present = {}, missing = [];
        for (const k of wanted) { if (h[k]) present[k] = h[k]; else missing.push(k); }
        return { present, missing };
      },

      /** Cookie flags, so a test can insist on Secure / HttpOnly / SameSite. */
      cookies: async () => {
        const cs = await self.context.cookies();
        return cs.map(c => ({
          name: c.name, domain: c.domain, path: c.path,
          secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite,
          issues: [
            (!c.secure && !/^\.?(localhost|127\.0\.0\.1)$/.test(c.domain)) ? 'not Secure' : null,
            !c.httpOnly ? 'readable from JavaScript (not HttpOnly)' : null,
            (!c.sameSite || c.sameSite === 'None') ? `SameSite=${c.sameSite || 'unset'}` : null,
          ].filter(Boolean),
        }));
      },

      /**
       * Scan every response body for material that must never reach a browser.
       * Returns findings; assertNoSecretsOnTheWire() is the assertion form.
       */
      scanForSecrets: async ({ allowUrls = [], allowValues = [] } = {}) => {
        const findings = [];
        const allowedValues = new Set([
          ...(ENV && ENV.REACT_APP_SUPABASE_ANON_KEY ? [ENV.REACT_APP_SUPABASE_ANON_KEY] : []),
          ...allowValues,
        ].filter(Boolean));
        const serviceKey = ENV && ENV.SUPABASE_SERVICE_ROLE_KEY;
        const extraAllow = allowUrls.map(a => (a instanceof RegExp ? a : new RegExp(a)));

        for (const b of self._bodies) {
          const allowed =
            SECRET_URL_ALLOW.find(a => a.re.test(b.url)) ||
            (extraAllow.some(re => re.test(b.url)) ? { why: 'allowlisted by the caller' } : null);

          const text = await b.promise;
          if (!text) continue;

          // Hard match on the real service key, in whatever shape it appears.
          if (serviceKey && serviceKey.length > 20 && text.includes(serviceKey)) {
            findings.push({
              severity: 'critical', rule: 'service_role_key_value', url: b.url,
              why: 'the SUPABASE_SERVICE_ROLE_KEY from .env appeared verbatim in a response body',
              excerpt: redact(serviceKey),
            });
          }

          for (const rule of SECRET_RULES) {
            if (allowed) continue;
            rule.re.lastIndex = 0;
            const hits = text.match(rule.re);
            if (!hits) continue;
            findings.push({
              severity: rule.severity, rule: rule.id, url: b.url, why: rule.why,
              count: hits.length, excerpt: redact(hits[0]),
            });
          }

          // JWTs are decoded, so the public anon key is not reported as a leak
          // and a service-role key never escapes as "probably fine".
          JWT_RE.lastIndex = 0;
          const jwts = [...new Set(text.match(JWT_RE) || [])];
          for (const tok of jwts) {
            if (allowedValues.has(tok)) continue;             // the public anon key
            const payload = decodeJwtPayload(tok);
            const role = payload && payload.role;
            if (role === 'service_role') {
              findings.push({
                severity: 'critical', rule: 'service_role_jwt', url: b.url,
                why: 'a JWT whose role claim is service_role', excerpt: redact(tok),
              });
              continue;
            }
            if (allowed) continue;                            // /auth/v1/token and friends
            if (role === 'anon') continue;                    // public by design
            findings.push({
              severity: 'warn', rule: 'jwt_on_the_wire', url: b.url,
              why: `a JWT (role=${role || 'unknown'}) in a response body outside the auth endpoints`,
              excerpt: redact(tok),
            });
          }
        }

        return {
          findings,
          scannedResponses: self._bodies.length,
          anonKeyAllowlisted: allowedValues.size > 0,
          note: ENV ? null
            : '.env could not be read — the public anon key could not be allowlisted and the service key could not be matched by value.',
        };
      },

      /** Assertion form. Throws naming the URL and rule behind each finding. */
      assertNoSecretsOnTheWire: async (opts = {}) => {
        const { findings, scannedResponses, note } = await self.security.scanForSecrets(opts);
        const bad = findings.filter(f => f.severity === 'critical' || opts.strict);
        if (!bad.length) {
          return { ok: true, scannedResponses, warnings: findings.length, warningList: findings, note };
        }
        throw new Error(
          `Secret material on the wire — ${bad.length} finding(s) across ${scannedResponses} response(s):\n` +
          bad.map(f =>
            `  · [${f.severity}] ${f.rule} — ${f.why}\n      ${f.url}\n      value: ${f.excerpt}`
          ).join('\n') +
          (note ? `\n  ${note}` : '')
        );
      },
    };
  }

  // ---- real-user sanity ---------------------------------------------------
  /**
   * The checks a person makes in the first second of looking at a screen: is
   * anything still saying "Loading", is the main region empty, and is any
   * element rendering a raw JavaScript value.
   *
   * That last one — `undefined`, `NaN`, `[object Object]` — catches a whole
   * class of real bugs in this codebase and is invisible to a status-code test.
   */
  async sanity({ allowText = [], requireMain = true, mainSelectors } = {}) {
    const selectors = mainSelectors || ['.content', 'main', '[role="main"]', '.login-card'];
    const found = await this.page.evaluate(({ allow, selectors }) => {
      const visible = el => {
        if (!el || !el.getBoundingClientRect) return false;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return false;
        const st = getComputedStyle(el);
        return st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
      };
      const pathOf = el => {
        const bits = [];
        for (let e = el; e && e.nodeType === 1 && bits.length < 4; e = e.parentElement) {
          const cls = (e.className && typeof e.className === 'string')
            ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
          bits.unshift(e.tagName.toLowerCase() + cls);
        }
        return bits.join(' > ');
      };

      // Leaf elements only, so a parent does not report its child's text again.
      const leaves = [...document.querySelectorAll('body *')]
        .filter(el => !el.querySelector('*') && visible(el));

      const patterns = [
        { id: 'loading', re: /(^|\s)Loading\b|Loading\.\.\.|Loading\u2026/i,
          why: 'a loading placeholder is still on screen after the page settled' },
        { id: 'undefined', re: /\bundefined\b/,
          why: 'an element is rendering the literal string "undefined"' },
        { id: 'NaN', re: /\bNaN\b/,
          why: 'an element is rendering NaN — a number was computed from a missing value' },
        { id: 'object-Object', re: /\[object Object\]/,
          why: 'an object was interpolated into JSX instead of a field of it' },
        { id: 'null-text', re: /^\s*null\s*$/,
          why: 'an element is rendering the literal string "null"' },
      ];

      const hits = [];
      for (const el of leaves) {
        const text = (el.innerText || el.textContent || '').trim();
        if (!text || text.length > 400) continue;
        if (allow.some(a => new RegExp(a).test(text))) continue;
        for (const p of patterns) {
          if (p.re.test(text)) hits.push({ id: p.id, why: p.why, text: text.slice(0, 120), where: pathOf(el) });
        }
      }

      let mainSelector = null, mainText = '';
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        mainSelector = sel;
        mainText = (el.innerText || el.textContent || '').trim();
        if (mainText) break;
      }

      return {
        hits, mainSelector,
        mainChars: mainText.length,
        bodyChars: (document.body.innerText || '').trim().length,
        title: document.title,
        url: location.href,
      };
    }, { allow: allowText.map(a => (a instanceof RegExp ? a.source : String(a))), selectors });

    const problems = found.hits.map(h => `${h.id}: ${h.why}\n      "${h.text}"\n      in ${h.where}`);
    if (requireMain && found.mainChars === 0) {
      problems.push(
        `empty-main: no content in the main region (tried ${selectors.join(', ')}` +
        `${found.mainSelector ? `; matched "${found.mainSelector}" but it was empty` : '; none matched'}). ` +
        `document.body holds ${found.bodyChars} character(s) of text.`
      );
    }
    return { ok: problems.length === 0, problems, ...found };
  }

  /** Assertion form of sanity(). */
  async assertSane(opts) {
    const r = await this.sanity(opts);
    if (!r.ok) {
      throw new Error(
        `The rendered page fails a real-user sanity check at ${r.url}:\n` +
        r.problems.map(p => '  · ' + p).join('\n')
      );
    }
    return r;
  }
}

/**
 * Open a browser session.
 *
 *   suite    artifact folder name                 (default 'session')
 *   headed   show the window                      (default false, or TEST_HEADED=1)
 *   network  wifi | fast-3g | slow-3g | offline   (default TEST_NETWORK or 'wifi')
 *   cpu      CPU throttling rate, 1 = none        (or TEST_CPU)
 *   base     base URL                             (default TEST_BASE_URL or :3100)
 *   trace    false to skip the Playwright trace
 */
async function open(opts = {}) {
  const s = new Session({
    suite: opts.suite || 'session',
    headed: opts.headed !== undefined ? opts.headed : process.env.TEST_HEADED === '1',
    network: opts.network || process.env.TEST_NETWORK || 'wifi',
    cpu: opts.cpu || Number(process.env.TEST_CPU || 1),
    base: opts.base,
    viewport: opts.viewport,
    timeout: opts.timeout,
    trace: opts.trace,
    traceName: opts.traceName,
  });
  presetOrThrow(s.networkName);   // fail before launching a browser we cannot use
  return s._start();
}

module.exports = {
  open, Session,
  resolveChromePath, artifactDir, isListening,
  NETWORK_PRESETS, describeNetwork, presetOrThrow,
  KNOWN_CONSOLE_NOISE, ENV_GAP, SECRET_RULES, SECRET_URL_ALLOW,
  BASE, ARTIFACTS, ROOT,
};
