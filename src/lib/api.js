import { SUPABASE_URL, supabase } from "../supabaseClient";

export const checkSupabaseHealth = async () => {
  // The anon key is public by design (it ships in the bundle), but it was
  // referenced here as the undefined `SUPABASE_KEY`, so both probes threw and
  // the health check always reported a failure.
  const SUPABASE_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;
  const diagnostic = {
    url: SUPABASE_URL,
    origin: window.location.origin,
    apiHealth: "Testing...",
    authHealth: "Testing...",
    details: ""
  };
  
  try {
    const apiStart = Date.now();
    const apiRes = await fetch(`${SUPABASE_URL}/rest/v1/`, { 
      method: 'HEAD',
      headers: { 'apikey': SUPABASE_KEY }
    });
    diagnostic.apiHealth = apiRes.ok ? `OK (${Date.now() - apiStart}ms)` : `Error: ${apiRes.status}`;
  } catch (e) {
    diagnostic.apiHealth = `Failed: ${e.message}`;
  }

  try {
    const authStart = Date.now();
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: { 'apikey': SUPABASE_KEY }
    });
    diagnostic.authHealth = authRes.ok ? `OK (${Date.now() - authStart}ms)` : `Error: ${authRes.status}`;
  } catch (e) {
    diagnostic.authHealth = `Failed: ${e.message}`;
  }

  return diagnostic;
};

// EMAIL HELPER — fire-and-forget via /api/send-email
// Never throws; silently skips if key not configured.
// ============================================================
export const sendEmail = (type, data) => {
  supabase.auth.getSession().then(({ data: { session } }) => {
    const headers = { "Content-Type": "application/json" };
    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }
    fetch("/api/send-email", {
      method: "POST",
      headers,
      body: JSON.stringify({ type, data }),
    }).catch(e => console.warn("Email send failed (non-critical):", e.message));
  }).catch(e => console.warn("Could not get session for email:", e.message));
};

export async function callApi(path, { method = "POST", body = null } = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Your session has expired. Sign in again.");

  const res = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  let payload = null;
  try { payload = await res.json(); } catch (_) { /* non-JSON error page */ }

  if (!res.ok || payload?.ok === false) {
    throw new Error(
      payload?.error?.message || payload?.message ||
      `Request failed (${res.status})`
    );
  }
  return payload?.data ?? payload;
}
