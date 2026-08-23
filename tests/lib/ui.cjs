// tests/lib/ui.cjs
//
// Fixes false-alarm class 2, plus the timing and selector mistakes around it.
//
// The audit harness reported "no revisions action offered" because it looked at
// the Review Queue's default tab — which the previous assertion had just
// emptied by approving the only item on it. It reported an empty sidebar that
// was React still mounting. And it reported a page as blank because that page
// does not use the .content wrapper the helper assumed.
//
// All three are the same underlying error: asserting on a screen without first
// putting it in a known state, or reading it through a selector that only
// happens to work on some pages. These helpers make state explicit and fail
// with what was actually on screen rather than a bare false.

// Endpoints that fail locally only because a third-party secret is unset, and
// which therefore say nothing about the health of the application.
const ENV_GAP = /\/api\/send-email/;

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3100';

const clean = t => (t || '').replace(/\s+/g, ' ').trim();

/** Sign in and wait until the app has genuinely finished mounting. */
async function login(page, email, password) {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button.btn-primary.btn-full');
  await page.waitForSelector('.nav-item', { timeout: 30000 });
  // The sidebar renders before the profile resolves; wait for the role label
  // rather than sleeping an arbitrary amount.
  await page.waitForFunction(() => {
    const el = document.querySelector('.sidebar-role');
    return el && el.textContent.trim().length > 0;
  }, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);
}

/** Click a sidebar entry by its visible label and wait for the view to settle. */
async function goto(page, navLabel) {
  const item = page.locator('.nav-item', { hasText: navLabel }).first();
  if (!(await item.count())) {
    const available = (await page.locator('.nav-item').allTextContents()).map(clean);
    throw new Error(
      `TEST BUG: no sidebar entry matching "${navLabel}". Available: ${available.join(' | ')}`
    );
  }
  await item.click();
  await page.waitForTimeout(1400);
}

/**
 * Select a tab before asserting on its contents.
 *
 * This is the specific fix for the Review Queue false alarm: never assume the
 * tab you want is the one showing. Throws listing the real tabs if not found.
 */
async function selectTab(page, tabPattern) {
  const re = tabPattern instanceof RegExp ? tabPattern : new RegExp(tabPattern, 'i');
  const buttons = page.locator('button');
  const n = await buttons.count();
  for (let i = 0; i < n; i++) {
    const label = clean(await buttons.nth(i).textContent().catch(() => ''));
    if (re.test(label)) {
      await buttons.nth(i).click();
      await page.waitForTimeout(1200);
      return label;
    }
  }
  const all = [];
  for (let i = 0; i < n; i++) all.push(clean(await buttons.nth(i).textContent().catch(() => '')));
  throw new Error(
    `TEST BUG: no tab matching ${re}. Buttons on screen: ${all.filter(Boolean).join(' | ')}`
  );
}

/**
 * Visible text of the main content area.
 *
 * Not every page is wrapped in .content — lazily loaded ones (Social Channels)
 * mount their own root, and reading .content there returned an empty string,
 * which the audit harness misreported as "the page renders blank". Try the
 * known wrappers in order, fall back to the document minus the sidebar, and
 * poll until something is actually there so a lazy chunk has time to arrive.
 */
async function contentText(page, { timeout = 8000 } = {}) {
  const read = () => page.evaluate(() => {
    const strip = el => (el ? (el.innerText || el.textContent || '') : '');
    for (const sel of ['.content', 'main', '[role="main"]']) {
      const el = document.querySelector(sel);
      if (el && strip(el).trim()) return strip(el);
    }
    const side = document.querySelector('.sidebar');
    const whole = strip(document.body);
    const sideText = strip(side);
    return sideText ? whole.split(sideText).join(' ') : whole;
  });

  const deadline = Date.now() + timeout;
  let text = '';
  while (Date.now() < deadline) {
    text = await read().catch(() => '');
    if (clean(text)) break;
    await page.waitForTimeout(300);
  }
  return clean(text);
}

/**
 * Collect console and network problems.
 *
 * With devServer.cjs in front, /api genuinely works, so an /api failure here is
 * a real finding — except where it is caused by an unset local secret, which is
 * separated out so it cannot masquerade as an application defect.
 */
function watchForProblems(page) {
  const problems = [];
  const ignorable = /DevTools|Download the React DevTools|favicon|\[HMR\]|webpack-dev-server|sockjs/i;

  page.on('pageerror', e => {
    if (!ignorable.test(e.message)) problems.push('pageerror: ' + e.message.slice(0, 160));
  });
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (!ignorable.test(t)) problems.push('console: ' + t.slice(0, 160));
  });
  page.on('response', r => {
    if (r.status() < 400) return;
    const u = r.url();
    if (ignorable.test(u)) return;
    problems.push(`http ${r.status()} ${u.replace(/^https?:\/\/[^/]+/, '').slice(0, 90)}`);
  });

  // A console line and a network line are raised for the same failed request,
  // so a bare "Failed to load resource" is dropped when an env-gap http entry
  // already accounts for it.
  const dedupe = list => {
    const hasEnvGapHttp = list.some(p => p.startsWith('http ') && ENV_GAP.test(p));
    return list.filter(p =>
      !(hasEnvGapHttp && /^console: Failed to load resource/i.test(p)));
  };

  return {
    /** Genuine application problems. */
    list: () => dedupe([...new Set(problems)]).filter(p => !ENV_GAP.test(p)),
    /** Failures caused by unconfigured local secrets rather than defects. */
    envGaps: () => [...new Set(problems)].filter(p => ENV_GAP.test(p)),
    all: () => [...new Set(problems)],
    reset: () => { problems.length = 0; },
  };
}

module.exports = { BASE, clean, login, goto, selectTab, contentText, watchForProblems };
