// api/_utils/cors.js
//
// CORS for first-party API endpoints. Defaults to the portal origin; can be
// extended with ADDITIONAL_ALLOWED_ORIGINS (comma-separated env var) for
// preview deployments.
//
// Returns true if the request was a preflight OPTIONS that has been
// responded to — caller should `return` immediately if so.

const DEFAULT_ALLOWED_ORIGINS = [
  'https://www.portalomnyagrowth.com',
  'https://portalomnyagrowth.com',
];

function getAllowedOrigins() {
  const fromEnv = (process.env.ADDITIONAL_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // In local dev, allow http://localhost:3000 implicitly.
  const localDev = ['http://localhost:3000', 'http://127.0.0.1:3000'];
  return [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...fromEnv, ...localDev])];
}

function applyCors(req, res) {
  const origin = req.headers.origin || '';
  const allowed = getAllowedOrigins();
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0];

  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

module.exports = { applyCors, getAllowedOrigins };
