// tests/vercel-rewrites.test.cjs
//
// Does vercel.json actually route the single-page app?
//
// Until 2026-09-19 every deep link on production answered Vercel's NOT_FOUND:
// /share/campaign, /dashboard, anything that was not "/". Nobody noticed
// because the app routes by ?page= on "/", until the first link meant for
// someone outside the portal: the client-facing campaign report.
//
// The cause was the catch-all rewrite's DESTINATION, not its source. With
// `cleanUrls: true`, Vercel strips ".html" from the static output at build
// time, so a rewrite to "/index.html" points at a file that no longer exists
// under that name and falls through to 404. Vercel's docs: "If cleanUrls is
// set to true in your project's vercel.json, do not include the file
// extension in the source or destination path. For example, /index.html
// would be /". The three explicit ".html" rewrites in the file are dead for
// the same reason — those pages are served as clean URLs before rewrites run
// — which is why nothing else appeared broken.
//
// This compiles every rewrite source with path-to-regexp 6.1.0, the version
// Vercel's routing compiles sources with, and asks the questions a browser
// asks. A negative lookahead in the source is fine; ".html" in the catch-all
// destination is not.
//
//   node tests/vercel-rewrites.test.cjs
//
// Exit codes: 0 pass · 1 fail. Prints SKIP and exits 0 when path-to-regexp 6
// is not installed (it is in devDependencies: npm install).

const fs = require('fs');
const path = require('path');

let pathToRegexp, version;
try {
  ({ pathToRegexp } = require('path-to-regexp'));
  version = require('path-to-regexp/package.json').version;
} catch {
  console.error('SKIP: path-to-regexp is not installed.  npm install');
  process.exit(0);
}
if (!/^6\./.test(version)) {
  console.error(`SKIP: path-to-regexp ${version} installed; Vercel compiles sources with 6.x.  npm i -D path-to-regexp@6.1.0`);
  process.exit(0);
}

const ROOT = path.join(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const APP_SHELL = config.cleanUrls ? '/' : '/index.html';

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

// First rewrite whose source matches, the way Vercel walks the list.
function destinationFor(pathname) {
  for (const rw of config.rewrites || []) {
    let re;
    try { re = pathToRegexp(rw.source); } catch (e) { return `INVALID SOURCE ${rw.source}: ${e.message}`; }
    if (re.test(pathname)) return rw.destination;
  }
  return null;
}

console.log(`\nvercel.json rewrites (path-to-regexp ${version}, cleanUrls=${Boolean(config.cleanUrls)})\n`);

for (const rw of config.rewrites || []) {
  try { pathToRegexp(rw.source); R(true, `compiles: ${rw.source}`); }
  catch (e) { R(false, `compiles: ${rw.source}`, e.message); }
}

// Paths the app owns must reach the app shell, under a name that exists once
// cleanUrls has stripped the extension.
for (const p of ['/share/campaign', '/share', '/dashboard', '/campaigns/123']) {
  R(destinationFor(p) === APP_SHELL, `${p} → ${APP_SHELL}`, `got ${destinationFor(p)}`);
}
if (config.cleanUrls) {
  const catchAll = (config.rewrites || []).find(rw => pathToRegexp(rw.source).test('/share/campaign'));
  R(catchAll && !/\.html$/.test(catchAll.destination),
    'the catch-all destination has no .html extension (cleanUrls strips it at build time)',
    catchAll ? catchAll.destination : 'no catch-all');
}

// Functions and files must never be rewritten to the app shell.
for (const p of ['/api/campaigns/share-report', '/api/auth/tiktok/callback', '/static/js/main.js', '/favicon.ico', '/robots.txt', '/omnya_logo.png']) {
  R(destinationFor(p) !== APP_SHELL, `${p} is not rewritten to the app shell`, `got ${destinationFor(p)}`);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
