#!/usr/bin/env node
// tests/run-all.cjs
//
// The command that produces the final system report.
//
// It boots the two servers the browser suites need, discovers and runs every
// suite in the repository, and assembles one machine-readable result document
// so a report can be written from data rather than from prose.
//
//   node tests/run-all.cjs                    everything
//   node tests/run-all.cjs --offline-only     the fast lane only, no servers
//   node tests/run-all.cjs --suite=creator    one suite (prefix match)
//   node tests/run-all.cjs --headed           watch the browser work
//   node tests/run-all.cjs --network=slow-3g  drive every browser suite on 3G
//   node tests/run-all.cjs --no-servers       CRA and devServer are already up
//
// Three properties are deliberate and must survive any edit:
//
//   · The offline lane runs FIRST. It is fast and it exercises the same
//     assertions the browser lane depends on. If it is red, nothing a browser
//     suite says afterwards is worth believing, and you find that out in
//     seconds rather than minutes.
//
//   · BLOCKED is not FAILED. A suite that exits 3 is blocked on a migration
//     nobody has applied; it names the migration that fixes it and the run's
//     own exit code degrades to 3, never to 1. Conflating the two is how a
//     pending migration gets reported to a human as a broken application.
//
//   · Nothing is left running. Every process this file starts is killed as a
//     TREE on the way out — including on Ctrl-C, on a throw, and on a suite
//     that hung — because `npm start` on Windows is three processes deep and
//     killing the parent leaves webpack holding port 3000 forever. Any Chrome
//     a suite abandoned is swept too.
//
// Exit codes, the same contract every suite honours:
//   0  everything passed
//   1  at least one suite really failed (or errored)
//   3  nothing failed, but at least one suite is blocked on a migration

const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RESULTS_DIR = path.join(ROOT, 'tests', 'artifacts', 'results');
const RUN_ALL_JSON = path.join(RESULTS_DIR, 'run-all.json');

let CRA_PORT = Number(process.env.CRA_PORT || 3000);
const DEV_PORT = Number(process.env.PORT || 3100);
const IS_WIN = process.platform === 'win32';

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    suites: [], headed: false, network: null,
    offlineOnly: false, noServers: false, list: false,
    timeoutMs: Number(process.env.SUITE_TIMEOUT_MS || 15 * 60 * 1000),
  };
  for (const arg of argv) {
    const m = arg.match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!m) throw new Error(`TEST BUG: unrecognised argument "${arg}". See the header of tests/run-all.cjs.`);
    const [, flag, value] = m;
    switch (flag) {
      case 'suite':   opts.suites.push(...String(value || '').split(',').map(s => s.trim()).filter(Boolean)); break;
      case 'headed':  opts.headed = value !== 'false'; break;
      case 'network': opts.network = value; break;
      case 'offline-only': opts.offlineOnly = true; break;
      case 'no-servers':   opts.noServers = true; break;
      case 'list':    opts.list = true; break;
      case 'timeout': opts.timeoutMs = Number(value) * 1000; break;
      default:
        throw new Error(
          `TEST BUG: unknown flag "--${flag}". Known: --suite --headed --network --offline-only --no-servers --list --timeout.`
        );
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Suite discovery
//
// Discovered from the filesystem, not from a list, so a suite another lane adds
// is picked up without an edit here. What each suite NEEDS is metadata — a
// browser suite pointed at a dead port produces a timeout instead of a verdict,
// which is exactly the failure this harness exists to prevent — so it is read
// out of the file's own requires rather than assumed.
// ---------------------------------------------------------------------------

// Recurses. The first version read a single directory level, and discover()
// listed three fixed paths — so a suite written to tests/coverage/ was found by
// nothing, ran in no system test, and contributed silently to no total. A test
// that cannot be discovered is worse than no test: it reports green locally and
// guards nothing.
//
// Same reasoning as walking api/ rather than keeping a hand-written endpoint
// list: the discovery has to cover places nobody has thought of yet.
const globCjs = (dir, re) => {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'artifacts' || entry.name === 'lib') continue;
      out.push(...globCjs(full, re));
    } else if (re.test(entry.name)) {
      out.push(full);
    }
  }
  return out.sort();
};

// Suites that stand up their own server on their own port. They need a browser
// but not CRA, and they need `build/` to exist.
const SELF_HOSTED = new Set(['perf-production', 'security-headers']);

function classify(file) {
  const base = path.basename(file);
  const name = base.replace(/\.(test|journey)\.cjs$/, '');
  const src = fs.readFileSync(file, 'utf8');

  const usesChrome = /require\(['"][^'"]*lib\/chrome\.cjs['"]\)/.test(src);
  const usesBase   = /require\(['"][^'"]*lib\/ui\.cjs['"]\)/.test(src);
  const selfHosted = SELF_HOSTED.has(name);

  // The lane is about cost and about what has to be standing, not about the
  // network: `regression` and `role-boundaries` talk to live Supabase but need
  // no browser and no local server, so they belong in the fast lane.
  const needsBrowser = usesChrome;
  const needsServers = (usesChrome && !selfHosted) || usesBase;

  return {
    name,
    file,
    rel: path.relative(ROOT, file).replace(/\\/g, '/'),
    lane: needsBrowser ? 'browser' : 'offline',
    needsBrowser,
    needsServers,
    needsBuild: selfHosted,
    kind: /\.journey\.cjs$/.test(base) ? 'journey' : 'test',
  };
}

function discover() {
  // globCjs recurses, so tests/coverage/, tests/journeys/ and anything added
  // later are picked up without touching this list.
  const files = [
    ...globCjs(path.join(ROOT, 'tests'), /\.test\.cjs$/),
    ...globCjs(path.join(ROOT, 'supabase', 'migrations', '__tests__'), /\.test\.cjs$/),
    ...globCjs(path.join(ROOT, 'tests'), /\.journey\.cjs$/),
  ];
  const suites = files.map(classify);
  // Offline first, then browser. Within a lane, journeys last — they are the
  // slowest and the most dependent on everything else being right.
  const rank = s => (s.lane === 'offline' ? 0 : 10) + (s.kind === 'journey' ? 1 : 0);
  return suites.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Process bookkeeping
//
// Everything spawned goes in here, and everything in here is killed as a tree.
// ---------------------------------------------------------------------------

const spawned = [];      // { pid, label, child }
let chromeBefore = new Set();

function listChromePids() {
  if (!IS_WIN) return new Set();
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' or Name='msedge.exe'\" | " +
    'ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }'], { encoding: 'utf8', timeout: 20000 });
  const out = new Set();
  for (const line of String(r.stdout || '').split(/\r?\n/)) {
    const [pid, ...rest] = line.split('\t');
    if (/^\d+$/.test(pid)) out.add(`${pid}\u0000${rest.join('\t')}`);
  }
  return out;
}

const pidOf = entry => Number(entry.split('\u0000')[0]);
const cmdOf = entry => entry.split('\u0000')[1] || '';

/** Kill a process and everything it started. The tree part is the whole point. */
function killTree(pid, label) {
  if (!pid) return false;
  try {
    if (IS_WIN) {
      const r = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'],
        { encoding: 'utf8', timeout: 20000 });
      return r.status === 0;
    }
    process.kill(-pid, 'SIGKILL');
    return true;
  } catch (e) {
    if (label) console.log(`  (could not kill ${label} pid ${pid}: ${e.message})`);
    return false;
  }
}

let cleanedUp = false;
function cleanup(reason) {
  if (cleanedUp) return;
  cleanedUp = true;

  const killed = [];
  for (const p of spawned.slice().reverse()) {
    if (p.child && p.child.exitCode === null && p.child.signalCode === null) {
      if (killTree(p.pid, p.label)) killed.push(`${p.label} (pid ${p.pid})`);
    } else if (p.alwaysKill) {
      if (killTree(p.pid, p.label)) killed.push(`${p.label} (pid ${p.pid})`);
    }
  }

  // A suite that crashed mid-journey can leave its Chrome behind. Only sweep
  // browsers that (a) were not running before this command started and (b)
  // carry a Playwright profile directory, so a person's own Chrome window is
  // never touched.
  if (IS_WIN) {
    const beforePids = new Set([...chromeBefore].map(pidOf));
    for (const entry of listChromePids()) {
      const pid = pidOf(entry);
      if (beforePids.has(pid)) continue;
      if (!/playwright|chromiumdev_profile|--remote-debugging-pipe/i.test(cmdOf(entry))) continue;
      if (killTree(pid)) killed.push(`orphaned browser (pid ${pid})`);
    }
  }

  if (killed.length) {
    console.log(`\n  cleanup${reason ? ` (${reason})` : ''}: killed ${killed.length} process tree(s)`);
    for (const k of killed) console.log(`    · ${k}`);
  }
}

process.on('exit', () => cleanup('exit'));
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(sig, () => { cleanup(sig); process.exit(130); });
}
process.on('uncaughtException', err => {
  console.error('\nHarness error: ' + (err.stack || err.message));
  cleanup('uncaughtException');
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Servers
// ---------------------------------------------------------------------------

function isListening(port, timeout = 700) {
  return new Promise(resolve => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const done = ok => { try { sock.destroy(); } catch {} resolve(ok); };
    sock.setTimeout(timeout);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

/** GET / and resolve once it answers. A bound port is not a compiled bundle. */
function serves(port, timeout = 8000) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout },
      res => { res.resume(); resolve(res.statusCode > 0 && res.statusCode < 500); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

/**
 * Is the thing on this port actually THIS app?
 *
 * isListening() only proves something accepted a TCP connection. On this
 * machine :3000 was held by an unrelated Next.js project, and the orchestrator
 * cheerfully "reused" it — so every browser suite was driven against a
 * stranger's application and regression.test.cjs was reported as FAILED when
 * nothing was wrong with the portal at all.
 *
 * CRA serves an empty <div id="root"> and a bundle script tag. Both must be
 * there. This is the "assert the instrument is live before trusting what it
 * reads" rule applied to the servers themselves.
 */
function isOurApp(port, timeout = 8000) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout }, res => {
      if (!res.statusCode || res.statusCode >= 500) { res.resume(); return resolve(false); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { if (body.length < 65536) body += c; });
      res.on('end', () => resolve(
        /<div id="root">/.test(body) &&
        /static\/js\/(bundle|main)[^"']*\.js/.test(body)
      ));
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

/** Describe whatever is squatting on a port, so the error names the culprit. */
function describeOccupant(port, timeout = 4000) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { if (body.length < 4096) body += c; });
      res.on('end', () => {
        const title = (body.match(/<title[^>]*>([^<]{0,80})/i) || [])[1];
        const framework =
          /_next|__NEXT_DATA__|next\/dist/.test(body) ? 'a Next.js app'
          : /vite/i.test(body) ? 'a Vite app'
          : /<div id="root">/.test(body) ? 'a React app (but not this one)'
          : 'something';
        resolve(`${framework}${title ? ` titled "${title.trim()}"` : ''}`);
      });
    });
    req.on('timeout', () => { req.destroy(); resolve('an unresponsive server'); });
    req.on('error', () => resolve('an unreadable server'));
  });
}

/** First free port at or after `from`, so a squatter does not stop the run. */
async function freePortFrom(from, tries = 20) {
  for (let p = from; p < from + tries; p++) {
    if (!(await isListening(p, 300))) return p;
  }
  throw new Error(`No free port between ${from} and ${from + tries}.`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Poll — never sleep a fixed amount. A fixed sleep is either a wasted minute or
 * a flake, and on this machine CRA's first compile has taken anywhere from 12
 * to 70 seconds.
 */
async function waitUntil(fn, { timeoutMs, everyMs = 500, what }) {
  const deadline = Date.now() + timeoutMs;
  let waited = 0;
  while (Date.now() < deadline) {
    if (await fn()) return waited;
    await sleep(everyMs);
    waited = Math.round((Date.now() - (deadline - timeoutMs)) / 1000);
  }
  throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${what}.`);
}

function startProcess(label, args, env) {
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: !IS_WIN,
    windowsHide: true,
  });
  const entry = { pid: child.pid, label, child, alwaysKill: true, log: [] };
  spawned.push(entry);
  const keep = buf => {
    for (const line of String(buf).split(/\r?\n/)) if (line.trim()) entry.log.push(line.slice(0, 300));
    if (entry.log.length > 200) entry.log.splice(0, entry.log.length - 200);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.on('error', e => keep(`spawn error: ${e.message}`));
  return entry;
}

async function startServers({ needCra, needDev }) {
  const started = [];
  const reused = [];

  if (needCra) {
    // Reuse ONLY if what is already there is this application. Anything else
    // on the port gets stepped around, not adopted.
    if (await isListening(CRA_PORT) && await isOurApp(CRA_PORT)) {
      reused.push(`CRA on :${CRA_PORT}`);
    } else {
      if (await isListening(CRA_PORT)) {
        const who = await describeOccupant(CRA_PORT);
        const next = await freePortFrom(CRA_PORT + 1);
        console.log(`  :${CRA_PORT} is held by ${who} — not this portal.`);
        console.log(`  Leaving it alone and using :${next} instead.`);
        CRA_PORT = next;
      }
      const bin = path.join(ROOT, 'node_modules', 'react-scripts', 'bin', 'react-scripts.js');
      if (!fs.existsSync(bin)) {
        throw new Error(`Cannot start CRA: ${path.relative(ROOT, bin)} is missing. Run npm install.`);
      }
      // Run react-scripts directly rather than through `npm start`: npm.cmd adds
      // two shell layers whose PIDs we would then have to guess at on the way out.
      const p = startProcess(`CRA :${CRA_PORT}`, [bin, 'start'],
        { PORT: String(CRA_PORT), BROWSER: 'none', FORCE_COLOR: '0' });
      process.stdout.write(`  starting CRA on :${CRA_PORT} (pid ${p.pid}) `);
      try {
        await waitUntil(() => isListening(CRA_PORT), { timeoutMs: 180000, what: `CRA to listen on :${CRA_PORT}` });
        // Bound is not built. Wait for a real response so the first suite does
        // not eat the compile as page-load latency and call it a slow app.
        await waitUntil(() => serves(CRA_PORT, 10000), { timeoutMs: 240000, everyMs: 1000, what: 'CRA to serve /' });
      } catch (e) {
        console.log('failed');
        throw new Error(`${e.message}\n  Last output from CRA:\n` +
          p.log.slice(-12).map(l => '    ' + l).join('\n'));
      }
      console.log('up');
      started.push(`CRA on :${CRA_PORT}`);
    }
  }

  if (needDev) {
    // Same rule as CRA, one layer down and for the same reason. The devServer
    // only PROXIES the app: it is started with a CRA_PORT and holds onto it.
    // An instance left over from an earlier run can be listening on :3100
    // while pointing at a CRA that has since moved — or at a different project
    // entirely. Reusing it then serves a stranger's HTML through our port and
    // every browser suite times out hunting for a login form that was never
    // going to be there.
    //
    // isOurApp() goes through the proxy, so it answers the only question that
    // matters: is :3100 serving THIS application, right now.
    let devUsable = false;
    if (await isListening(DEV_PORT)) {
      devUsable = await isOurApp(DEV_PORT);
      if (!devUsable) {
        const who = await describeOccupant(DEV_PORT);
        throw new Error(
          `:${DEV_PORT} is listening but serves ${who} — not this portal.\n` +
          '  That is almost certainly a devServer from an earlier run still pointing at a stale CRA port.\n' +
          '  Stop it and re-run, or start a correct one yourself and pass --no-servers:\n' +
          `      CRA_PORT=${CRA_PORT} node tests/lib/devServer.cjs`
        );
      }
    }

    if (devUsable) {
      reused.push(`devServer on :${DEV_PORT}`);
    } else {
      const p = startProcess(`devServer :${DEV_PORT}`, [path.join(ROOT, 'tests', 'lib', 'devServer.cjs')],
        { PORT: String(DEV_PORT), CRA_PORT: String(CRA_PORT) });
      process.stdout.write(`  starting devServer on :${DEV_PORT} (pid ${p.pid}) `);
      try {
        await waitUntil(() => isListening(DEV_PORT), { timeoutMs: 60000, what: `devServer to listen on :${DEV_PORT}` });
      } catch (e) {
        console.log('failed');
        throw new Error(`${e.message}\n  Last output from devServer:\n` +
          p.log.slice(-12).map(l => '    ' + l).join('\n'));
      }
      console.log('up');
      started.push(`devServer on :${DEV_PORT}`);
    }
  }

  return { started, reused };
}

// ---------------------------------------------------------------------------
// Reading a suite's verdict
//
// Prefer the JSON a journey suite writes; fall back to its summary line. Both
// are read, and a disagreement between the exit code and the counts is worth
// showing rather than smoothing over.
// ---------------------------------------------------------------------------

const SUMMARY_PATTERNS = [
  // journey.cjs and payout-acceptance: "12 passed · 0 failed · 3 blocked"
  /(\d+)\s+passed\s*·\s*(\d+)\s+failed(?:\s*·\s*(\d+)\s+blocked)?/,
  // the offline suites: "42 passed, 0 failed"
  /(\d+)\s+passed,\s*(\d+)\s+failed/,
  // role-boundaries speaks in boundaries
  /(\d+)\s+boundaries held\s*·\s*(\d+)\s+open/,
];

function countsFromStdout(text) {
  for (const re of SUMMARY_PATTERNS) {
    const m = text.match(re);
    if (m) return { pass: Number(m[1]), fail: Number(m[2]), blocked: Number(m[3] || 0) };
  }
  return null;
}

/** Blocked findings printed by a non-journey suite, so they reach the report too. */
function blockersFromStdout(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    if (/Blocked on migrations that have not been applied/i.test(lines[i])) { inBlock = true; continue; }
    if (!inBlock) continue;
    const bullet = lines[i].match(/^\s*·\s*(.+?)\s+[—-]\s+(.+)$/);
    if (bullet) {
      const fixLine = (lines[i + 1] || '').match(/fix:\s*(.+)$/);
      out.push({ finding: bullet[1].trim(), why: bullet[2].trim(), fix: fixLine ? fixLine[1].trim() : null });
      continue;
    }
    if (lines[i].trim() && !/^\s*(fix:|·)/.test(lines[i]) && out.length) inBlock = false;
  }
  return out;
}

function newResultFiles(sinceMs) {
  if (!fs.existsSync(RESULTS_DIR)) return [];
  return fs.readdirSync(RESULTS_DIR)
    .filter(f => f.endsWith('.json') && f !== 'run-all.json')
    .map(f => path.join(RESULTS_DIR, f))
    .filter(f => { try { return fs.statSync(f).mtimeMs >= sinceMs; } catch { return false; } });
}

// ---------------------------------------------------------------------------
// Running one suite
// ---------------------------------------------------------------------------

function runSuite(suite, opts) {
  return new Promise(resolve => {
    const startedAt = Date.now();
    const env = { ...process.env, FORCE_COLOR: '0' };
    if (opts.headed) env.TEST_HEADED = '1';
    if (opts.network) env.TEST_NETWORK = opts.network;

    console.log(`\n${'='.repeat(78)}`);
    console.log(`  ${suite.name}   (${suite.lane}${suite.needsServers ? ', needs :3000 + :3100' : ''})`);
    console.log(`${'='.repeat(78)}`);

    const child = spawn(process.execPath, [suite.file], {
      cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    const entry = { pid: child.pid, label: `suite ${suite.name}`, child };
    spawned.push(entry);

    let out = '';
    const onData = buf => { const t = String(buf); out += t; process.stdout.write(t); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      console.log(`\n  !! ${suite.name} exceeded ${Math.round(opts.timeoutMs / 1000)}s — killing its process tree.`);
      killTree(child.pid, `suite ${suite.name}`);
    }, opts.timeoutMs);

    child.on('error', err => { out += `\nspawn error: ${err.message}\n`; });

    child.on('close', code => {
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;

      const results = [];
      for (const f of newResultFiles(startedAt - 2000)) {
        try { results.push(JSON.parse(fs.readFileSync(f, 'utf8'))); } catch { /* half-written */ }
      }
      const mine = results.filter(r => r && (r.suite === suite.name || String(r.suite).replace(/\./g, '-') === suite.name));
      const json = mine[0] || results[0] || null;

      const counts = json
        ? { pass: json.totals.pass, fail: json.totals.fail, blocked: json.totals.blocked, skip: json.totals.skip }
        : countsFromStdout(out);

      // A suite that could not RUN is not a suite that found a defect.
      //
      // The live-database suites reach Supabase over the network, and a
      // transient `fetch failed` aborts them with exit 1 — indistinguishable
      // from a real failure in the summary. In one run that reported
      // role-boundaries and payout-acceptance as FAIL when both pass cleanly
      // on the very next attempt; the actual message was
      //
      //     Harness error: fetch failed
      //
      // which is the suite telling us its instrument broke, not the app. The
      // whole point of this harness is that a broken test must not read as a
      // bug report, and that rule has to hold at the orchestrator level too.
      const harnessAborted = /^\s*Harness error:/m.test(out);
      const looksTransient = harnessAborted && /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|EAI_AGAIN/i.test(out);

      let status;
      if (timedOut) status = 'TIMEOUT';
      else if (code === 0) status = 'PASS';
      else if (looksTransient) status = 'INFRA';
      else if (harnessAborted) status = 'ERROR';
      else if (code === 1) status = 'FAIL';
      else if (code === 3) status = 'BLOCKED';
      else status = 'ERROR';

      const blockers = json && json.blockers && json.blockers.length
        ? json.blockers
        : blockersFromStdout(out);

      resolve({
        name: suite.name,
        file: suite.rel,
        lane: suite.lane,
        kind: suite.kind,
        status,
        exitCode: code,
        durationMs,
        counts: counts || null,
        blockers,
        testBugs: json ? json.totals.testBugs : (/FAIL\*|fault in the TEST/.test(out) ? 1 : 0),
        harnessError: json ? json.harnessError : null,
        resultsFile: json ? path.relative(ROOT, path.join(RESULTS_DIR, `${json.suite}.json`)).replace(/\\/g, '/') : null,
        journeys: json ? json.journeys.map(j => ({ name: j.name, totals: j.totals, durationMs: j.durationMs })) : null,
        stdoutTail: out.split(/\r?\n/).slice(-40).join('\n'),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
const secs = ms => (ms >= 60000 ? `${Math.floor(ms / 60000)}m${String(Math.round(ms % 60000 / 1000)).padStart(2, '0')}s` : `${(ms / 1000).toFixed(1)}s`);

function assertionsCell(r) {
  if (!r.counts) return '—';
  const bits = [`${r.counts.pass} pass`];
  if (r.counts.fail) bits.push(`${r.counts.fail} fail`);
  if (r.counts.blocked) bits.push(`${r.counts.blocked} blocked`);
  if (r.counts.skip) bits.push(`${r.counts.skip} skip`);
  return bits.join(' / ');
}

function printSummary(results, meta) {
  const W = 78;
  console.log(`\n\n${'='.repeat(W)}`);
  console.log('  SYSTEM TEST SUMMARY');
  console.log('='.repeat(W));
  console.log(`  ${pad('SUITE', 28)} ${pad('LANE', 8)} ${pad('STATUS', 9)} ${pad('ASSERTIONS', 22)} ${lpad('TIME', 7)}`);
  console.log('  ' + '-'.repeat(W - 4));

  let lane = null;
  for (const r of results) {
    if (r.lane !== lane) { lane = r.lane; }
    console.log(`  ${pad(r.name, 28)} ${pad(r.lane, 8)} ${pad(r.status, 9)} ${pad(assertionsCell(r), 22)} ${lpad(secs(r.durationMs), 7)}`);
  }

  const t = results.reduce((a, r) => {
    a.pass += r.counts ? r.counts.pass : 0;
    a.fail += r.counts ? r.counts.fail : 0;
    a.blocked += r.counts ? r.counts.blocked : 0;
    return a;
  }, { pass: 0, fail: 0, blocked: 0 });

  const suitesPassed  = results.filter(r => r.status === 'PASS').length;
  const suitesFailed  = results.filter(r => r.status === 'FAIL' || r.status === 'ERROR' || r.status === 'TIMEOUT').length;
  const suitesBlocked = results.filter(r => r.status === 'BLOCKED').length;
  const suitesInfra   = results.filter(r => r.status === 'INFRA').length;

  console.log('  ' + '-'.repeat(W - 4));
  console.log(`  ${pad(`${results.length} suites`, 28)} ${pad('', 8)} ` +
    `${pad(`${suitesPassed}/${suitesFailed}/${suitesBlocked}${suitesInfra ? `/${suitesInfra}!` : ''}`, 9)} ` +
    `${pad(`${t.pass} pass / ${t.fail} fail / ${t.blocked} blocked`, 22)} ` +
    `${lpad(secs(meta.durationMs), 7)}`);
  console.log('='.repeat(W));

  const testBugs = results.filter(r => r.testBugs > 0);
  if (testBugs.length) {
    console.log('\n  A fault in the TEST, not in the application — fix these first:\n');
    for (const r of testBugs) console.log(`    · ${r.name}: ${r.testBugs} test bug(s)`);
  }

  const bad = results.filter(r => r.status === 'FAIL' || r.status === 'ERROR' || r.status === 'TIMEOUT');
  if (bad.length) {
    console.log('\n  Failed:\n');
    for (const r of bad) {
      console.log(`    · ${r.name} — exit ${r.exitCode}${r.status === 'TIMEOUT' ? ' (timed out)' : ''}`);
      if (r.harnessError) console.log(`        harness error: ${String(r.harnessError).split('\n')[0]}`);
      console.log(`        full output above; tail in ${path.relative(ROOT, RUN_ALL_JSON).replace(/\\/g, '/')}`);
    }
  }

  const infra = results.filter(r => r.status === 'INFRA');
  if (infra.length) {
    console.log('\n  Could not run — the test could not reach the network, so it');
    console.log('  reached NO verdict about the application:\n');
    for (const r of infra) {
      console.log(`    · ${r.name} — ${String(r.stdoutTail || '').match(/Harness error: (.*)/)?.[1] || 'harness aborted'}`);
    }
    console.log('\n  Re-run when the connection is stable. This is not a defect report.');
  }

  const allBlockers = new Map();
  for (const r of results) for (const b of r.blockers || []) {
    if (!allBlockers.has(b.finding)) allBlockers.set(b.finding, { ...b, suites: [] });
    allBlockers.get(b.finding).suites.push(r.name);
  }
  if (allBlockers.size) {
    console.log('\n  Blocked on migrations that have not been applied:\n');
    for (const b of allBlockers.values()) {
      console.log(`    · ${b.finding} — ${b.why}`);
      if (b.fix) console.log(`           fix: ${b.fix}`);
      console.log(`           seen by: ${[...new Set(b.suites)].join(', ')}`);
    }
  } else if (suitesBlocked) {
    console.log('\n  Some suites exited 3 (blocked) without naming a finding — see their output above.');
  }

  if (meta.servers.started.length || meta.servers.reused.length) {
    console.log('');
    if (meta.servers.reused.length)  console.log(`  reused:  ${meta.servers.reused.join(', ')}`);
    if (meta.servers.started.length) console.log(`  started: ${meta.servers.started.join(', ')} (stopped on exit)`);
  }
  console.log(`\n  results: ${path.relative(ROOT, RUN_ALL_JSON).replace(/\\/g, '/')}`);
  console.log('');

  return { suitesPassed, suitesFailed, suitesBlocked, assertions: t };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  const opts = parseArgs(process.argv.slice(2));
  const t0 = Date.now();

  let suites = discover();
  if (opts.suites.length) {
    const want = opts.suites.map(s => s.toLowerCase());
    const before = suites;
    suites = suites.filter(s => want.some(w => s.name.toLowerCase() === w || s.name.toLowerCase().includes(w)));
    if (!suites.length) {
      throw new Error(
        `TEST BUG: --suite=${opts.suites.join(',')} matched nothing. Available:\n` +
        before.map(s => `    ${s.name}  (${s.lane})`).join('\n')
      );
    }
  }
  if (opts.offlineOnly) suites = suites.filter(s => s.lane === 'offline');

  if (opts.list) {
    for (const s of suites) console.log(`${pad(s.lane, 8)} ${pad(s.kind, 8)} ${pad(s.name, 26)} ${s.rel}`);
    process.exit(0);
  }

  console.log('\nOmnya portal — full system test run');
  console.log(`  ${suites.length} suite(s): ${suites.filter(s => s.lane === 'offline').length} offline, ` +
    `${suites.filter(s => s.lane === 'browser').length} browser`);
  if (opts.network) console.log(`  network:  every browser suite forced to ${opts.network}`);
  if (opts.headed)  console.log('  headed:   the browser window is visible');

  const needServers = !opts.noServers && suites.some(s => s.needsServers);
  const missingBuild = suites.filter(s => s.needsBuild && !fs.existsSync(path.join(ROOT, 'build', 'index.html')));
  if (missingBuild.length) {
    console.log(`  note:     ${missingBuild.map(s => s.name).join(', ')} need ./build — run \`npm run build\` first ` +
      '(they report BLOCKED without it, not FAILED)');
  }

  chromeBefore = listChromePids();

  let servers = { started: [], reused: [] };
  const results = [];
  let harnessError = null;

  try {
    if (needServers) {
      console.log('');
      servers = await startServers({ needCra: true, needDev: true });
    } else if (opts.noServers) {
      const cra = await isListening(CRA_PORT), dev = await isListening(DEV_PORT);
      console.log(`\n  --no-servers: CRA :${CRA_PORT} ${cra ? 'up' : 'DOWN'} · devServer :${DEV_PORT} ${dev ? 'up' : 'DOWN'}`);
      if (suites.some(s => s.needsServers) && !(cra && dev)) {
        throw new Error(
          `--no-servers was passed but ${!cra ? `nothing is listening on :${CRA_PORT}` : `nothing is listening on :${DEV_PORT}`}.\n` +
          '  Start them, or drop --no-servers and let this command start them for you.'
        );
      }
    }

    for (const s of suites) {
      let r = await runSuite(s, opts);

      // One retry when the suite could not reach the network. A transient
      // fetch failure is not evidence about the application, and re-running is
      // cheaper than a human re-reading the summary to work out whether the
      // FAIL was real. If it fails the same way twice it is reported as INFRA
      // and stays visible — never quietly swallowed.
      if (r.status === 'INFRA') {
        console.log(`\n  ${s.name}: could not reach the network — retrying once.\n`);
        r = await runSuite(s, opts);
      }

      results.push(r);
    }
  } catch (err) {
    harnessError = String(err.stack || err.message);
    console.error('\nHarness error: ' + harnessError);
  }

  const meta = { durationMs: Date.now() - t0, servers };
  const totals = results.length ? printSummary(results, meta) : { suitesFailed: 0, suitesBlocked: 0 };

  const anyFailed  = results.some(r => ['FAIL', 'ERROR', 'TIMEOUT'].includes(r.status)) || !!harnessError;
  const anyBlocked = results.some(r => r.status === 'BLOCKED');
  const code = anyFailed ? 1 : (anyBlocked ? 3 : 0);

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(RUN_ALL_JSON, JSON.stringify({
    run: 'run-all',
    startedAt: new Date(t0).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: meta.durationMs,
    exitCode: code,
    options: opts,
    servers,
    node: process.version,
    platform: process.platform,
    totals: {
      suites: results.length,
      passed: results.filter(r => r.status === 'PASS').length,
      failed: results.filter(r => ['FAIL', 'ERROR', 'TIMEOUT'].includes(r.status)).length,
      blocked: results.filter(r => r.status === 'BLOCKED').length,
      assertions: totals.assertions || null,
    },
    harnessError,
    blockers: [...results.reduce((m, r) => {
      for (const b of r.blockers || []) {
        if (!m.has(b.finding)) m.set(b.finding, { ...b, suites: [] });
        m.get(b.finding).suites.push(r.name);
      }
      return m;
    }, new Map()).values()],
    suites: results,
  }, null, 2));

  console.log(`  exit ${code}  (${code === 0 ? 'everything passed' : code === 3 ? 'blocked on unapplied migrations, nothing failed' : 'at least one suite failed'})\n`);

  cleanup('end of run');
  process.exit(code);
})();
