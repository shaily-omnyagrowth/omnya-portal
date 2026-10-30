import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";

const PENDING = new Set(["pending", "eligible", "needs_review"]);
const COOLDOWN = 14 * 86400000;

export default function useEarningsData(creatorId) {
  const [state, setState] = useState({ loading: true, error: "", earnings: [], withdrawals: [], bonusSubs: [] });

  const load = useCallback(async () => {
    if (!creatorId) { setState(s => ({ ...s, loading: false })); return; }
    try {
      const [e, w, b] = await Promise.all([
        supabase.from("creator_earnings").select("*").eq("creator_id", creatorId).order("created_at", { ascending: false }),
        supabase.from("withdrawal_requests").select("*").eq("creator_id", creatorId).order("created_at", { ascending: false }),
        supabase.from("submissions").select("*, campaigns(name, client_id)").eq("creator_id", creatorId).in("status", ["Approved", "Published/Tracked"]).order("created_at", { ascending: false }),
      ]);
      const err = e.error || w.error || b.error;
      if (err) throw err;
      setState({ loading: false, error: "", earnings: e.data || [], withdrawals: w.data || [], bonusSubs: b.data || [] });
    } catch (err) {
      setState(s => ({ ...s, loading: false, error: err.message || "Couldn't load your earnings." }));
    }
  }, [creatorId]);

  useEffect(() => { load(); }, [load]);

  const sum = (pred) => state.earnings.filter(pred).reduce((a, r) => a + (parseFloat(r.amount) || 0), 0);
  const last = state.withdrawals.find(r => !["rejected", "cancelled"].includes(r.status));
  const lastDate = last?.created_at ? new Date(last.created_at) : null;

  return {
    ...state,
    reload: load,
    setBonusSubs: (fn) => setState(s => ({ ...s, bonusSubs: fn(s.bonusSubs) })),
    balances: {
      available: sum(r => r.status === "approved"),
      pending: sum(r => PENDING.has(r.status)),
      requested: sum(r => r.status === "withdrawal_requested"),
      paid: sum(r => r.status === "paid"),
    },
    canWithdraw: !lastDate || Date.now() - lastDate.getTime() >= COOLDOWN,
    nextWithdrawal: lastDate ? new Date(lastDate.getTime() + COOLDOWN) : null,
  };
}
