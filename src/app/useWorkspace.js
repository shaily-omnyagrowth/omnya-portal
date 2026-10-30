import { useCallback, useEffect, useRef, useState } from "react";
import { isSchemaError, selectAllWithRetry } from "../lib/db";
import { supabase } from "../supabaseClient";

const EMPTY = { creators: [], clients: [], campaigns: [], submissions: [], accountManagers: [], payments: [], userProfiles: [], analytics: [], campaignCreators: [] };

const CLIENT_TABLES = [
  { key: "campaigns", name: "client_safe_campaigns" },
  { key: "submissions", name: "client_safe_submissions" },
  { key: "analytics", name: "client_safe_analytics" },
  { key: "userProfiles", name: "user_profiles" },
  { key: "clients", name: "clients" },
];
const STAFF_TABLES = [
  { key: "creators", name: "creators" },
  { key: "clients", name: "clients" },
  { key: "campaigns", name: "campaigns" },
  { key: "submissions", name: "submissions" },
  { key: "accountManagers", name: "account_managers" },
  { key: "payments", name: "payments" },
  { key: "userProfiles", name: "user_profiles" },
  { key: "analytics", name: "video_analytics" },
  { key: "campaignCreators", name: "campaign_creators" },
];

const TABLE_KEYS = {
  creators: "creators", clients: "clients", campaigns: "campaigns", submissions: "submissions",
  account_managers: "accountManagers", payments: "payments", user_profiles: "userProfiles", video_analytics: "analytics",
};
// Realtime is scoped per role as defence in depth; RLS still filters every event.
const LIVE_TABLES = {
  owner: ["creators", "clients", "campaigns", "submissions", "account_managers", "payments", "user_profiles", "video_analytics"],
  am: ["creators", "clients", "campaigns", "submissions", "video_analytics"],
  creator: ["campaigns", "submissions"],
  client: ["campaigns", "submissions", "video_analytics"],
};

export const normalizeRole = (raw) => {
  const r = (raw || "pending").toLowerCase();
  return r === "account_manager" ? "am" : r === "admin" ? "owner" : r;
};

export default function useWorkspace(user, role) {
  const [db, setDb] = useState(EMPTY);
  const [status, setStatus] = useState("idle");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [caps, setCaps] = useState({});
  const userRef = useRef(user);
  userRef.current = user;
  const loadedFor = useRef(null);

  const dataRole = normalizeRole(user?.role);
  const ready = !!user && ["owner", "am", "creator", "client"].includes(dataRole);

  // First load shows skeletons; later loads refresh in place so the open page keeps its state.
  const loadDB = useCallback(async () => {
    const u = userRef.current;
    if (!u) return;
    const r = normalizeRole(u.role);
    const key = `${u.id}:${r}`;
    const background = loadedFor.current === key;
    if (background) setRefreshing(true); else setStatus("loading");
    setError("");

    const isClient = r === "client";
    const results = {};
    const failures = [];
    try {
      await Promise.all((isClient ? CLIENT_TABLES : STAFF_TABLES).map(async (t) => {
        const { data, error: e } = await selectAllWithRetry(t.name);
        if (e) failures.push({ table: t.name, error: e });
        else results[t.key] = data;
      }));
    } catch (e) {
      console.error("Workspace load failed:", e);
      setError("We couldn't load your data. Check your connection and try again.");
    }

    const core = failures.filter(f => (isClient ? ["user_profiles"] : ["creators", "user_profiles"]).includes(f.table));
    if (core.length) {
      const schemaBroken = core.some(f => isSchemaError(f.error));
      if (schemaBroken && r === "owner") setError(`Core tables (${core.map(f => f.table).join(", ")}) are missing. Apply the pending migrations in supabase/migrations.`);
      else if (schemaBroken) setError("Your account isn't fully set up yet. Contact hello@omnyagrowth.com and we'll sort it out.");
      else setError("We couldn't load your data. Check your connection and try again.");
    } else if (failures.length) {
      console.warn("Some tables failed to load:", failures.map(f => `${f.table} (${f.error?.code || "?"})`).join(", "));
    }

    setDb(prev => ({
      ...EMPTY,
      ...Object.fromEntries(Object.keys(EMPTY).map(k => [k, results[k] ?? (background ? prev[k] : [])])),
      _currentUser: u,
    }));
    loadedFor.current = key;
    setStatus("ready");
    setRefreshing(false);
  }, []);

  useEffect(() => {
    if (ready) loadDB();
    else { loadedFor.current = null; setDb(EMPTY); setStatus("idle"); setError(""); }
  }, [ready, user?.id, dataRole, loadDB]);

  useEffect(() => {
    if (!ready) return undefined;
    const channels = (LIVE_TABLES[role] || []).map(table =>
      supabase.channel(`sync_${table}_${role}`)
        .on("postgres_changes", { event: "*", schema: "public", table }, payload => {
          setDb(prev => {
            const listKey = TABLE_KEYS[table];
            if (!prev[listKey]) return prev;
            if (payload.eventType === "DELETE") return { ...prev, [listKey]: prev[listKey].filter(i => i.id !== payload.old.id) };
            const list = [...prev[listKey]];
            const idx = list.findIndex(i => i.id === payload.new.id);
            if (idx === -1) list.push(payload.new); else list[idx] = payload.new;
            return { ...prev, [listKey]: list };
          });
        })
        .subscribe()
    );
    return () => channels.forEach(ch => supabase.removeChannel(ch));
  }, [ready, user?.id, role]);

  // Optional nav entries are gated on a capability the database confirms; errors hide the entry.
  useEffect(() => {
    let cancelled = false;
    if (!ready) { setCaps({}); return undefined; }
    if (role === "owner") { setCaps({ payouts: true }); return undefined; }
    if (role !== "am") { setCaps({}); return undefined; }
    supabase.rpc("is_payment_manager", { p_permission: "can_view_payouts" }).then(({ data, error: e }) => {
      if (cancelled) return;
      if (e) console.warn("is_payment_manager failed, hiding gated nav:", e.message);
      setCaps({ payouts: !e && data === true });
    });
    return () => { cancelled = true; };
  }, [ready, user?.id, role]);

  return { db, setDb, status, refreshing, error, loadDB, caps };
}
