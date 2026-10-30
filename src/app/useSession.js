import { useCallback, useEffect, useState } from "react";
import { sendEmail } from "../lib/api";
import { supabase } from "../supabaseClient";

const fetchProfile = (id) => supabase.from("user_profiles").select("*").eq("id", id).maybeSingle();
const withTimeout = (promise, ms, label) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms))]);
// Null means no row; a failed read throws.
const loadProfile = async (id, ms) => {
  const { data, error } = await withTimeout(fetchProfile(id), ms, "Profile timeout");
  if (error) throw error;
  return data;
};

// Creates the pending profile a new sign up needs; INSERT so an existing role is never overwritten.
async function createPendingProfile(authUser) {
  const requestedRole = authUser.user_metadata?.requested_role || "creator";
  const displayName = authUser.email.split("@")[0];
  const { data } = await supabase.from("user_profiles")
    .insert({ id: authUser.id, email: authUser.email, full_name: displayName, role: "pending", requested_role: requestedRole })
    .select().maybeSingle();
  if (data) sendEmail("user_signup_waiting_approval", { userEmail: authUser.email, displayName, requestedRole });
  return data;
}

export default function useSession({ resetPage }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);

  useEffect(() => {
    let mounted = true;
    const safety = setTimeout(() => { if (mounted) setLoading(false); }, 5000);

    const init = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!session || !mounted) return;
        try {
          const profile = await loadProfile(session.user.id, 4000);
          if (!mounted) return;
          if (profile) {
            setUser({ ...session.user, ...profile });
            if (profile.role === "creator") {
              const { data: creator } = await supabase.from("creators").select("id").eq("user_id", session.user.id).maybeSingle();
              if (!creator) {
                await supabase.from("creators").insert({
                  id: session.user.id, user_id: session.user.id, name: profile.full_name || "Creator",
                  email: session.user.email,
                });
              }
            }
            return;
          }
          const retry = await loadProfile(session.user.id, 4000);
          if (retry) { setUser({ ...session.user, ...retry }); return; }
          try { await createPendingProfile(session.user); } catch (e) { console.warn("Could not create the missing profile:", e.message); }
          setUser({ ...session.user, role: "pending" });
        } catch (e) {
          console.warn("Could not load the profile:", e.message);
          setUser({ ...session.user, profileFailed: true });
        }
      } catch (e) {
        console.error("Stale session, clearing it:", e);
        try { localStorage.removeItem("supabase.auth.token"); } catch (_) {}
      } finally {
        if (mounted) { clearTimeout(safety); setLoading(false); }
      }
    };
    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === "SIGNED_OUT" || event === "USER_DELETED") {
        setUser(null);
        setIsRecoveryMode(false);
        localStorage.removeItem("last_page");
      } else if (event === "PASSWORD_RECOVERY") {
        setIsRecoveryMode(true);
      } else if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && session) {
        // session.user.role is the auth role ("authenticated"); profile fields must win over it.
        setUser(prev => {
          if (!prev) return { ...session.user };
          if (prev.id === session.user.id) return prev;
          return { ...session.user, ...prev };
        });
      }
    });

    return () => { mounted = false; clearTimeout(safety); subscription.unsubscribe(); };
  }, []);

  const handleLogin = useCallback(async (authUser) => {
    setUser(authUser);
    try {
      const profile = await loadProfile(authUser.id, 10000);
      if (profile) { setUser(prev => ({ ...prev, ...profile })); return; }
      const created = await createPendingProfile(authUser);
      if (created) { setUser(prev => ({ ...prev, ...created })); return; }
      const retry = await loadProfile(authUser.id, 10000);
      if (retry) setUser(prev => ({ ...prev, ...retry }));
    } catch (e) {
      console.warn("Profile sync after sign in failed:", e.message);
      setUser(prev => ({ ...prev, profileFailed: true }));
    }
  }, []);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    window.history.replaceState({}, "", "/login");
    setUser(null);
    resetPage?.();
  }, [resetPage]);

  // Pending accounts poll until the owner assigns a role.
  useEffect(() => {
    if (user?.role !== "pending") return undefined;
    const id = setInterval(async () => {
      const { data: profile } = await fetchProfile(user.id);
      if (profile && profile.role !== "pending") {
        localStorage.removeItem("last_page");
        resetPage?.();
        setUser(prev => ({ ...prev, ...profile }));
      }
    }, 10000);
    return () => clearInterval(id);
  }, [user?.id, user?.role, resetPage]);

  return { user, setUser, loading, isRecoveryMode, setIsRecoveryMode, handleLogin, handleLogout };
}
