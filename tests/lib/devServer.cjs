// tests/lib/devServer.cjs
//
// Fixes false-alarm class 1.
//
// `react-scripts start` serves the SPA but knows nothing about /api/* — those
// are Vercel serverless functions. Browser tests run against it therefore see
// 404s on every API call and report "the page failed to load" for pages that
// are perfectly healthy in production. During the audit this made the creator
// Social Channels page look broken when it was not.
//
// This server sits in front of CRA and closes the gap: /api/* is dispatched to
// the real handler files in api/, and everything else is proxied to CRA. A
// browser pointed here exercises the same code paths production does, so a
// network error in a test now means a real defect.
//
//   node tests/lib/devServer.cjs            # CRA on 3000, this on 3100
//   CRA_PORT=3000 PORT=3100 node tests/lib/devServer.cjs

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const API_DIR = path.join(ROOT, 'api');
const PORT = Number(process.env.PORT || 3100);
const CRA_PORT = Number(process.env.CRA_PORT || 3000);

// Load .env the way the serverless runtime would.
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

// Resolve a URL path to a handler file the way Vercel does: api/a/b -> api/a/b.js,
// falling back to api/a/b/index.js.
function resolveHandler(pathname) {
  const rel = pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
  if (!rel) return null;
  if (rel.includes('..')) return null;                 // no traversal
  for (const candidate of [rel + '.js', path.join(rel, 'index.js')]) {
    const full = path.join(API_DIR, candidate);
    if (full.startsWith(API_DIR) && fs.existsSync(full)) return full;
  }
  return null;
}

const readBody = req => new Promise(resolve => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => resolve(Buffer.concat(chunks)));
});

// Minimal stand-in for the Vercel response object the handlers expect.
function makeRes(res) {
  let statusCode = 200;
  const shim = {
    setHeader: (k, v) => { res.setHeader(k, v); return shim; },
    status: c => { statusCode = c; return shim; },
    json: b => {
      if (!res.headersSent) res.setHeader('content-type', 'application/json');
      res.statusCode = statusCode;
      res.end(typeof b === 'string' ? b : JSON.stringify(b));
      return shim;
    },
    send: b => {
      res.statusCode = statusCode;
      res.end(typeof b === 'string' || Buffer.isBuffer(b) ? b : JSON.stringify(b));
      return shim;
    },
    end: b => { res.statusCode = statusCode; res.end(b); return shim; },
  };
  return shim;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ---- /api/* : run the real handler --------------------------------------
  if (url.pathname.startsWith('/api/')) {
    const file = resolveHandler(url.pathname);
    if (!file) {
      res.statusCode = 404;
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ ok: false, error: { code: 'not_found',
        message: `No handler for ${url.pathname}` } }));
    }

    const raw = await readBody(req);
    let body = null;
    if (raw.length) {
      const text = raw.toString('utf8');
      try { body = JSON.parse(text); } catch { body = text; }
    }

    const query = Object.fromEntries(url.searchParams.entries());
    req.body = body;
    req.query = query;

    try {
      // Fresh require each call so edits are picked up without a restart.
      delete require.cache[require.resolve(file)];
      const handler = require(file);
      await handler(req, makeRes(res));
      if (!res.writableEnded) res.end();
    } catch (err) {
      console.error(`[devServer] ${req.method} ${url.pathname} threw:`, err.message);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
      }
      if (!res.writableEnded) {
        res.end(JSON.stringify({ ok: false, error: { code: 'handler_threw', message: err.message } }));
      }
    }
    return;
  }

  // ---- everything else : proxy to CRA -------------------------------------
  const proxy = http.request(
    { host: 'localhost', port: CRA_PORT, path: req.url, method: req.method, headers: req.headers },
    upstream => {
      res.writeHead(upstream.statusCode, upstream.headers);
      upstream.pipe(res);
    }
  );
  proxy.on('error', err => {
    res.statusCode = 502;
    res.end(`Dev proxy could not reach the CRA server on :${CRA_PORT} — is it running? (${err.message})`);
  });
  req.pipe(proxy);
});

server.listen(PORT, () => {
  console.log(`[devServer] listening on http://localhost:${PORT}`);
  console.log(`[devServer]   /api/*  -> real handlers in ${path.relative(ROOT, API_DIR)}/`);
  console.log(`[devServer]   /*      -> CRA on :${CRA_PORT}`);
});

module.exports = server;
