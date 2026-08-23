// tests/lib/journey.cjs
//
// A scenario runner for tests written as real user journeys.
//
//   const { journey, finish } = require('./lib/journey.cjs');
//
//   journey('creator gets paid', async (j) => {
//     await j.step('creator logs in',        async (s) => { ... });
//     await j.step('creator requests a payout', async (s) => { ... });
//   }, { session, blockers: BLOCKERS });
//
//   await finish();
//
// Every step records status, duration, the network calls it made, the console
// errors raised during it, a screenshot, and a human-readable note. The suite
// emits tests/artifacts/results/<suite>.json alongside its console output, so
// the final system-test report can be assembled from data rather than prose.
//
// It keeps the harness's exit-code contract:
//   0  everything passed
//   1  a real failure (including a broken test — see below)
//   3  blocked on a migration that has not been applied
//
// Two properties are deliberate and must survive any edit:
//
//   · BLOCKED is never anonymous. A blocked step names the finding, why it is
//     blocked, and the migration step that fixes it — the pattern established
//     by tests/payout-acceptance.test.cjs.
//
//   · A fault in the *test* is reported as a fault in the test. Anything that
//     throws "TEST BUG" — schema.cjs's unknown-column guard, ui.cjs's missing
//     nav entry, an unknown network preset — is printed as FAIL (TEST BUG) and
//     listed separately from application failures. The harness exists because
//     three audit failures were faults in the test; it must never launder one
//     of those into a bug report about the app.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const RESULTS_DIR = path.join(ROOT, 'tests', 'artifacts', 'results');

const STATUS = { PASS: 'PASS', FAIL: 'FAIL', BLOCKED: 'BLOCKED', SKIP: 'SKIP' };

// Signals thrown from inside a step to choose a non-PASS outcome deliberately.
class BlockedSignal extends Error {
  constructor(finding, why, fix) {
    super(`${finding}: ${why}`);
    this.name = 'BlockedSignal';
    this.finding = finding; this.why = why; this.fix = fix;
  }
}
class SkipSignal extends Error {
  constructor(reason) { super(reason); this.name = 'SkipSignal'; this.reason = reason; }
}

const isTestBug = msg => /TEST BUG/.test(String(msg || ''));

// ---------------------------------------------------------------------------
// Suite state
// ---------------------------------------------------------------------------

function defaultSuiteName() {
  const entry = process.argv[1] || 'suite';
  return path.basename(entry).replace(/\.test\.cjs$/, '').replace(/\.cjs$/, '') || 'suite';
}

const suite = {
  name: defaultSuiteName(),
  startedAt: new Date().toISOString(),
  t0: Date.now(),
  journeys: [],
  blockers: new Map(),   // finding -> { finding, why, fix }
  harnessError: null,
  meta: {},
};

/** Override the suite name / add metadata that belongs in the report. */
function configure({ name, ...meta } = {}) {
  if (name) suite.name = name;
  Object.assign(suite.meta, meta);
  return suite;
}

const pad = (s, n) => String(s).padEnd(n);
const ms = n => `${n}ms`;

// ---------------------------------------------------------------------------
// The journey
// ---------------------------------------------------------------------------

class Journey {
  constructor(name, opts) {
    this.name = name;
    this.opts = opts;
    this.session = opts.session || null;
    this.blockerTable = opts.blockers || [];
    this.stopOnFail = opts.stopOnFail === true;
    this.steps = [];
    this.startedAt = new Date().toISOString();
    this.t0 = Date.now();
    this._stopped = false;
    this._n = 0;
  }

  /** Attach (or replace) the browser session used for screenshots and accounting. */
  use(session) { this.session = session; return this; }

  /**
   * Run one step of the journey.
   *
   * The handler receives a step context with `note`, `expect`, `blocked`,
   * `skip`, `shot`, plus `session` and `page` when a session is attached.
   */
  async step(label, fn) {
    const n = ++this._n;
    const record = {
      n, label, status: STATUS.PASS, kind: null, durationMs: 0,
      note: '', notes: [], error: null,
      network: { count: 0, bytes: 0, failed: 0, calls: [] },
      consoleErrors: [],
      screenshot: null,
      startedAt: new Date().toISOString(),
    };

    if (this._stopped) {
      record.status = STATUS.SKIP;
      record.note = 'skipped — an earlier step failed and this journey is stopOnFail';
      this.steps.push(record);
      this._print(record);
      return record;
    }

    const session = this.session;
    const mark = session ? session.mark() : null;
    const t0 = Date.now();

    const ctx = {
      journey: this,
      session,
      page: session ? session.page : null,
      /** Human-readable detail shown next to the step in the report. */
      note: text => { record.notes.push(String(text)); record.note = record.notes.join(' · '); },
      /** Assert, with a message that says what was expected. */
      expect: (cond, message) => { if (!cond) throw new Error(message || 'expectation not met'); },
      /** Report this step as BLOCKED on a migration, naming the fix. */
      blocked: (finding, why, fix) => { throw new BlockedSignal(finding, why, fix); },
      /** Report this step as SKIP with a reason. */
      skip: reason => { throw new SkipSignal(reason); },
      /** Extra screenshot inside the step. */
      shot: name => (session ? session.shot(`${this.name}-${n}-${name}`) : Promise.resolve(null)),
    };

    try {
      const returned = await fn(ctx);
      if (typeof returned === 'string' && returned) ctx.note(returned);
    } catch (err) {
      if (err instanceof SkipSignal) {
        record.status = STATUS.SKIP;
        ctx.note(err.reason);
      } else if (err instanceof BlockedSignal) {
        record.status = STATUS.BLOCKED;
        record.blocker = { finding: err.finding, why: err.why, fix: err.fix };
        suite.blockers.set(err.finding, record.blocker);
        ctx.note(`${err.finding}: ${err.why}`);
      } else {
        const hit = this.blockerTable.find(b => b.match.test(err.message || ''));
        if (hit) {
          record.status = STATUS.BLOCKED;
          record.blocker = { finding: hit.finding, why: hit.why, fix: hit.fix };
          suite.blockers.set(hit.finding, record.blocker);
          ctx.note(`${hit.finding}: ${hit.why}`);
          record.error = String(err.message).slice(0, 400);
        } else {
          record.status = STATUS.FAIL;
          record.kind = isTestBug(err.message) ? 'test-bug' : 'app';
          record.error = String(err.stack || err.message);
          ctx.note(String(err.message).split('\n')[0].slice(0, 160));
          if (this.stopOnFail) this._stopped = true;
        }
      }
    }

    record.durationMs = Date.now() - t0;

    if (session) {
      const calls = session.net.since(mark);
      record.network = {
        count: calls.length,
        bytes: calls.reduce((s, c) => s + (c.transferBytes || 0), 0),
        failed: calls.filter(c => c.failure || (c.status != null && c.status >= 400)).length,
        calls: calls.slice(0, 40).map(c => ({
          method: c.method,
          url: c.url.replace(/^https?:\/\/[^/]+/, ''),
          status: c.status, ms: c.durationMs, bytes: c.transferBytes, failure: c.failure,
        })),
      };
      if (calls.length > 40) record.network.truncated = calls.length - 40;

      record.consoleErrors = session.console.errors(mark)
        .map(e => ({ kind: e.kind, text: e.text.slice(0, 300), location: e.location }));
      record.consoleSuppressed = session.console.suppressed(mark).length;
      record.consoleEnvGaps = session.console.envGaps(mark)
        .map(e => ({ text: e.text.slice(0, 200), why: e.why }));

      record.screenshot = await session.shot(`${this.name}-${n}-${label}`);
      if (record.screenshot) record.screenshot = path.relative(ROOT, record.screenshot).replace(/\\/g, '/');
    }

    this.steps.push(record);
    this._print(record);
    return record;
  }

  _print(r) {
    const tag = r.kind === 'test-bug' ? 'FAIL*' : r.status;
    const bits = [];
    if (r.durationMs) bits.push(ms(r.durationMs));
    if (r.network.count) bits.push(`${r.network.count} req`);
    if (r.network.failed) bits.push(`${r.network.failed} failed`);
    if (r.consoleErrors && r.consoleErrors.length) bits.push(`${r.consoleErrors.length} console err`);
    const meta = bits.join(' · ');
    const note = r.note ? (meta ? `${meta} · ${r.note}` : r.note) : meta;
    console.log(`  ${pad(tag, 7)} ${pad(`${r.n}. ${r.label}`, 46)} ${note}`);
    if (r.kind === 'test-bug') {
      console.log('          ^ this is a fault in the TEST, not in the application:');
      for (const line of String(r.error).split('\n').slice(0, 6)) console.log('            ' + line);
    }
  }

  get totals() {
    const t = { pass: 0, fail: 0, blocked: 0, skip: 0, testBugs: 0 };
    for (const s of this.steps) {
      if (s.status === STATUS.PASS) t.pass++;
      else if (s.status === STATUS.FAIL) { t.fail++; if (s.kind === 'test-bug') t.testBugs++; }
      else if (s.status === STATUS.BLOCKED) t.blocked++;
      else t.skip++;
    }
    return t;
  }
}

/**
 * Define and run one journey.
 *
 *   journey('name', async (j) => { await j.step(...) }, { session, blockers })
 *
 * Returns the journey record. A throw from the body itself (not from a step)
 * is recorded as a harness error rather than as a silent zero-step pass.
 */
async function journey(name, fn, opts = {}) {
  const j = new Journey(name, opts);
  suite.journeys.push(j);
  console.log(`\n${name}`);
  if (opts.session) {
    const s = opts.session;
    console.log(`  network: ${require('./chrome.cjs').describeNetwork(s.networkName)}` +
      (s.cpuRate > 1 ? ` · CPU throttle ${s.cpuRate}x` : '') + ` · ${s.base}`);
  }
  console.log('');
  try {
    await fn(j);
  } catch (err) {
    j.bodyError = String(err.stack || err.message);
    const kind = isTestBug(err.message) ? 'test-bug' : 'app';
    j.steps.push({
      n: ++j._n, label: `journey body threw before finishing`, status: STATUS.FAIL,
      kind, durationMs: 0, note: String(err.message).split('\n')[0].slice(0, 160),
      notes: [], error: String(err.stack || err.message),
      network: { count: 0, bytes: 0, failed: 0, calls: [] }, consoleErrors: [], screenshot: null,
      startedAt: new Date().toISOString(),
    });
    j._print(j.steps[j.steps.length - 1]);
  }
  j.durationMs = Date.now() - j.t0;
  return j;
}

/** Record a harness-level problem — the run could not be completed at all. */
function harnessError(err) {
  suite.harnessError = String((err && err.stack) || err);
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function totals() {
  const t = { pass: 0, fail: 0, blocked: 0, skip: 0, testBugs: 0 };
  for (const j of suite.journeys) {
    const jt = j.totals;
    t.pass += jt.pass; t.fail += jt.fail; t.blocked += jt.blocked;
    t.skip += jt.skip; t.testBugs += jt.testBugs;
  }
  return t;
}

function exitCode() {
  const t = totals();
  if (suite.harnessError) return 1;
  if (t.fail) return 1;
  if (t.blocked) return 3;
  return 0;
}

function toJSON() {
  const t = totals();
  return {
    suite: suite.name,
    startedAt: suite.startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - suite.t0,
    exitCode: exitCode(),
    totals: t,
    meta: suite.meta,
    harnessError: suite.harnessError,
    blockers: [...suite.blockers.values()],
    journeys: suite.journeys.map(j => ({
      name: j.name,
      startedAt: j.startedAt,
      durationMs: j.durationMs || (Date.now() - j.t0),
      totals: j.totals,
      bodyError: j.bodyError || null,
      steps: j.steps,
    })),
  };
}

/** Write tests/artifacts/results/<suite>.json and return its path. */
function writeResults() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, `${suite.name}.json`);
  fs.writeFileSync(file, JSON.stringify(toJSON(), null, 2));
  return file;
}

/**
 * Print the summary, write the JSON, and exit with the contract code.
 * Pass { exit: false } to get the code back instead of exiting.
 */
function finish({ exit = true } = {}) {
  const t = totals();
  const file = writeResults();
  const code = exitCode();

  console.log(`\n${'-'.repeat(76)}`);
  console.log(`  ${t.pass} passed · ${t.fail} failed · ${t.blocked} blocked · ${t.skip} skipped`);

  if (t.testBugs) {
    console.log(`\n  ${t.testBugs} of the failures ${t.testBugs === 1 ? 'is' : 'are'} a fault in the TEST, not the application.`);
    console.log('  Fix the test first — a broken test tells you nothing about the app.');
    for (const j of suite.journeys) {
      for (const s of j.steps) {
        if (s.kind === 'test-bug') console.log(`    · ${j.name} / ${s.label}`);
      }
    }
  }

  const appFails = [];
  for (const j of suite.journeys) {
    for (const s of j.steps) if (s.status === STATUS.FAIL && s.kind !== 'test-bug') appFails.push({ j, s });
  }
  if (appFails.length) {
    console.log('\n  Failures:\n');
    for (const { j, s } of appFails) {
      console.log(`    · ${j.name} / ${s.label}`);
      for (const line of String(s.error).split('\n').slice(0, 8)) console.log('        ' + line);
    }
  }

  if (suite.blockers.size) {
    console.log('\n  Blocked on migrations that have not been applied:\n');
    for (const b of suite.blockers.values()) {
      console.log(`    · ${b.finding} — ${b.why}`);
      if (b.fix) console.log(`           fix: ${b.fix}`);
    }
  }

  if (suite.harnessError) {
    console.log('\n  Harness error — the run could not be completed:\n');
    for (const line of suite.harnessError.split('\n').slice(0, 10)) console.log('    ' + line);
  }

  console.log(`\n  results: ${path.relative(ROOT, file).replace(/\\/g, '/')}`);
  const anyShots = suite.journeys.some(j => j.steps.some(s => s.screenshot));
  if (anyShots) {
    console.log(`  screenshots: tests/artifacts/${suite.name}/`);
  }
  console.log('');

  if (exit) process.exit(code);
  return code;
}

module.exports = {
  journey, finish, configure, harnessError,
  writeResults, toJSON, totals, exitCode,
  STATUS, BlockedSignal, SkipSignal, RESULTS_DIR,
};
