// api/_utils/supabaseAdmin.js
//
// Service-role Supabase client. Bypasses RLS — only use from server-side
// API routes that have already verified the caller's authorization manually.
//
// Fails loudly at first call if env vars are missing.

const { createClient } = require('@supabase/supabase-js');

let cachedClient = null;

function getSupabaseAdminClient() {
  if (cachedClient) return cachedClient;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error('SUPABASE_URL is not set');
  }
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  }

  cachedClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

module.exports = { getSupabaseAdminClient };
