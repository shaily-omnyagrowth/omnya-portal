import { useCallback, useEffect, useState } from "react";
import { gooeyToast as toast } from "goey-toast";
import { sendEmail } from "../lib/api";
import { supabase } from "../supabaseClient";

const fetchProfile = (id) => supabase.from("user_profiles").select("*").eq("id", id).maybeSingle();
const withTimeout = (promise, ms, label) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms))]);

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
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let mounted = true;
    const safety = setTimeout(() => { if (mounted) setLoading(false); }, 5000);

    const init = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!session || !mounted) return;
        try {
          const { data: profile } = await withTimeout(fetchProfile(session.user.id), 4000, "Profile timeout");
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
          const { data: retry } = await fetchProfile(session.user.id);
          if (retry) { setUser({ ...session.user, ...retry }); return; }
          try { await createPendingProfile(session.user); } catch (e) { console.warn("Could not create the missing profile:", e.message); }
          setUser({ ...session.user, role: "pending" });
        } catch {
          setUser(session.user);
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
      const { data: profile } = await withTimeout(fetchProfile(authUser.id), 10000, "Timeout");
      if (profile) { setUser(prev => ({ ...prev, ...profile })); return; }
      const created = await createPendingProfile(authUser);
      if (created) { setUser(prev => ({ ...prev, ...created })); return; }
      const { data: retry } = await fetchProfile(authUser.id);
      if (retry) setUser(prev => ({ ...prev, ...retry }));
    } catch (e) {
      console.warn("Profile sync after sign in failed:", e.message);
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

  const checkStatus = useCallback(async () => {
    if (!user || checking) return;
    setChecking(true);
    try {
      const { data: profile, error } = await fetchProfile(user.id);
      if (error) throw error;
      if (!profile) toast.error("We couldn't find your profile", { description: "If this keeps happening, contact hello@omnyagrowth.com." });
      else if (profile.role === "pending") toast("Still waiting for approval", { description: "We'll email you as soon as your role is assigned." });
      else setUser(prev => ({ ...prev, ...profile }));
    } catch (e) {
      toast.error("Couldn't check your status", { description: e.message });
    } finally {
      setChecking(false);
    }
  }, [user, checking]);

  return { user, setUser, loading, isRecoveryMode, setIsRecoveryMode, handleLogin, handleLogout, checkStatus, checking };
}
