import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";
import { fmtDate, fmtRelativeTime } from "../../utils";

// Spec 0002: track TikTok from a pasted profile link. Paused; not mounted while TikTok OAuth is the path.
// Reads creator_social_accounts_safe under RLS; only /api/tiktok-link/save may set link_status (AC-17).
const LINK_MIGRATION_CODES = new Set(["42703", "42P01", "PGRST204", "PGRST205"]);

export default function TikTokLinkPanel() {
  const [row, setRow] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [switchedOff, setSwitchedOff] = useState(false);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { data, error: readErr } = await supabase
      .from("creator_social_accounts_safe")
      .select("link_handle, link_status, link_code, link_code_expires_at, link_rejected_reason, link_health, link_last_error, link_last_fetched_at, follower_count")
      .eq("user_id", session.user.id).eq("platform", "tiktok").maybeSingle();
    if (readErr && LINK_MIGRATION_CODES.has(String(readErr.code))) setSwitchedOff(true);
    else if (readErr) setError("Couldn't load your TikTok link.");
    setRow(data || null);
    setLoaded(true);
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not signed in");
      const res = await fetch("/api/tiktok-link/save", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ handle: input }),
      });
      const json = await res.json().catch(() => ({}));
      if (json?.error?.code === "migration_missing") { setSwitchedOff(true); return; }
      if (!res.ok || !json.ok) throw new Error(json.error?.message || "Couldn't save your TikTok link.");
      setInput("");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;
  if (switchedOff) return <div className="conn-profile fs-13" role="status">TikTok link tracking isn't switched on yet.</div>;

  const status = row?.link_status;
  return (
    <div className="conn-profile" style={{ flexDirection: "column", alignItems: "stretch" }}>
      <div className="fw-600 fs-13">Track TikTok with your profile link</div>
      {status === "pending_code" && <p className="fs-13" role="status">Add <strong className="tnum">{row.link_code}</strong> to your TikTok bio for @{row.link_handle}. We check every few hours, then your manager confirms it. The code expires {fmtDate(row.link_code_expires_at)}.</p>}
      {status === "code_found" && <p className="fs-13" role="status">We found your code on @{row.link_handle}. Waiting for your manager to confirm it.</p>}
      {status === "verified" && <p className="fs-13" role="status">Verified: @{row.link_handle}{row.follower_count != null && ` · ${Number(row.follower_count).toLocaleString()} followers`}{row.link_last_fetched_at && ` · updated ${fmtRelativeTime(row.link_last_fetched_at).toLowerCase()}`}</p>}
      {status === "rejected" && <p className="fs-13 text-red" role="status">Your manager didn't verify @{row.link_handle}: {row.link_rejected_reason}</p>}
      {(!status || status === "rejected") && (
        <form onSubmit={save} className="flex gap-8 flex-wrap">
          <label htmlFor="tiktok-link-input" className="sr-only">TikTok handle or profile link</label>
          <input id="tiktok-link-input" className="form-input" style={{ flex: "1 1 240px" }} value={input} onChange={e => setInput(e.target.value)} placeholder="@yourname or https://www.tiktok.com/@yourname" />
          <button type="submit" className="btn btn-primary" disabled={saving || !input.trim()}>{saving ? "Saving…" : "Save link"}</button>
        </form>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
