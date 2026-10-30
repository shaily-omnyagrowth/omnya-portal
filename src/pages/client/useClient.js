import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabaseClient";

// The signed in brand's clients row plus its campaigns and submissions, already scoped by RLS.
export default function useClient(user, db) {
  const [client, setClient] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    setStatus("loading");
    supabase.from("clients").select("*").eq("user_id", user.id).maybeSingle().then(({ data, error: e }) => {
      if (!live) return;
      if (e) { setError(e.message); setStatus("error"); return; }
      setClient(data);
      setStatus(data ? "ready" : "unlinked");
    });
    return () => { live = false; };
  }, [user.id, nonce]);

  const campaigns = useMemo(() => (client ? (db.campaigns || []).filter(c => c.client_id === client.id)
    .map(c => ({ ...c, id: c.campaign_id || c.id, name: c.campaign_name || c.name, status: c.campaign_status || c.status })) : []), [db.campaigns, client]);
  const ids = useMemo(() => new Set(campaigns.map(c => c.id)), [campaigns]);
  const submissions = useMemo(() => (db.submissions || []).filter(s => ids.has(s.campaign_id)).map(s => ({ ...s, id: s.id || s.submission_id })), [db.submissions, ids]);

  return { client, status, error, campaigns, submissions, reload: () => setNonce(n => n + 1) };
}
