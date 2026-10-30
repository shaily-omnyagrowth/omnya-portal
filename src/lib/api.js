import { supabase } from "../supabaseClient";

// Fire-and-forget email through /api/send-email; never throws.
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
