import React, { useCallback, useEffect, useState } from "react";
import { LOGO_URI } from "./app/brand";
import ErrorBoundary from "./app/ErrorBoundary";
import { navs } from "./app/nav";
import Sidebar from "./app/Sidebar";
import styles from "./app/styles";
import { sendEmail } from "./lib/api";
import { isSchemaError, selectAllWithRetry } from "./lib/db";
import AMDashboard from "./pages/am/AMDashboard";
import Login from "./pages/auth/Login";
import ResetPassword from "./pages/auth/ResetPassword";
import CampaignsPage from "./pages/campaigns/CampaignsPage";
import ClientsPage from "./pages/clients/ClientsPage";
import Analytics from "./pages/content/Analytics";
import ContentLibrary from "./pages/content/ContentLibrary";
import CreatorActiveJobs from "./pages/creator/CreatorActiveJobs";
import CreatorInsights from "./pages/creator/CreatorInsights";
import JobBoard from "./pages/creator/JobBoard";
import MySubmissions from "./pages/creator/MySubmissions";
import SubmitContent from "./pages/creator/SubmitContent";
import RevenueAnalytics from "./pages/money/RevenueAnalytics";
import OwnerDashboard from "./pages/owner/OwnerDashboard";
import SQLSetupModal from "./pages/owner/SQLSetupModal";
import CreatorPerformance from "./pages/people/CreatorPerformance";
import CreatorsManage from "./pages/people/CreatorsManage";
import MyCreators from "./pages/people/MyCreators";
import PendingUsers from "./pages/people/PendingUsers";
import TeamPerformance from "./pages/people/TeamPerformance";
import ReviewQueue from "./pages/review/ReviewQueue";
import SharedCampaignReport from "./pages/SharedCampaignReport";
import { supabase } from "./supabaseClient";
import ErrorMsg from "./ui/ErrorMsg";
import Spinner from "./ui/Spinner";

const Legal = React.lazy(() => import('./pages/Legal'));

const Landing = React.lazy(() => import('./pages/Landing'));

const CreatorDashboard = React.lazy(() => import('./pages/CreatorDashboard'));

const ClientDashboard = React.lazy(() => import('./pages/ClientDashboard'));

const ClientCampaignsPage = React.lazy(() =>
  import('./pages/ClientDashboard').then(m => ({ default: m.ClientCampaignsPage }))
);

const ClientContentGallery = React.lazy(() =>
  import('./pages/ClientDashboard').then(m => ({ default: m.ClientContentGallery }))
);

const CreatorConnections = React.lazy(() => import('./pages/CreatorConnections'));

const AnalyticsDashboard = React.lazy(() => import('./pages/AnalyticsDashboard'));

const CreatorEarningsPage = React.lazy(() => import('./components/CreatorEarnings'));

const PayoutManager = React.lazy(() => import('./components/PayoutManager'));

// Owner administration (scope §6.1 / §5.2). Lazy for the same reason as the
// rest: only owners ever load these, so they stay out of everyone's bundle.
const UserManagement = React.lazy(() => import('./pages/UserManagement'));

const AuditHistory = React.lazy(() => import('./pages/AuditHistory'));

const SystemConfig = React.lazy(() => import('./pages/SystemConfig'));

export default function App() {
  const path = window.location.pathname.toLowerCase().replace(/\/+$/, "") || "/";
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true); // Start as true for initial session check
  const [overrideRole, setOverrideRole] = useState(null);
  let rawRole = (user?.role || "pending").toLowerCase();
  let baseRole = rawRole === "account_manager" ? "am" : (rawRole === "admin" ? "owner" : rawRole);
  let role = (baseRole === "owner" && overrideRole) ? overrideRole : baseRole;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [page, setPage] = useState(() => localStorage.getItem("last_page") || "dashboard");
  const [showSQL, setShowSQL] = useState(false);
  const [db, setDb] = useState({
    creators:[], clients:[], campaigns:[], submissions:[],
    accountManagers:[], payments:[], userProfiles:[], analytics:[]
  });
  const [dbLoading, setDbLoading] = useState(false);
  const [dbError, setDbError] = useState("");
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [caps, setCaps] = useState({});

  useEffect(() => {
    // 1. Initialize from URL on load
    const params = new URLSearchParams(window.location.search);
    const urlPage = params.get('page');
    if (urlPage) setPage(urlPage.toLowerCase());

    // 2. Handle browser Back/Forward buttons
    const handlePopState = () => {
      const p = new URLSearchParams(window.location.search).get('page') || 'dashboard';
      setPage(p.toLowerCase());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    // Sync state to URL safely without infinitely pushing history.
    // Signed out, leave "/" (landing) and "/login" clean: a "?page=" on "/" means a portal deep link.
    if (!user) return;
    const url = new URL(window.location);
    // Signing in from /login moves into the portal at "/"; replace so Back does not return to the form.
    const fromLogin = url.pathname.toLowerCase().replace(/\/+$/, "") === "/login";
    if (fromLogin) url.pathname = "/";
    if (fromLogin || url.searchParams.get('page') !== page) {
      url.searchParams.set('page', page);
      window.history[fromLogin ? 'replaceState' : 'pushState']({}, '', url);
    }
    localStorage.setItem("last_page", page);
  }, [page, user]);

  // Check auth on load
  useEffect(() => {
    let mounted = true;
    
    // Auth init
    const init = async () => {
      console.log("App: Starting auth init...");
      
      // Safety timeout: Never block app load forever
      const safetyTimeout = setTimeout(() => {
        if (mounted) {
          console.warn("App: Auth init safety timeout triggered.");
          setLoading(false);
        }
      }, 5000);

      try {
        const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
        
        if (sessionErr) throw sessionErr;

        if (session && mounted) {
          // If we have a session, fetch profile with timeout to prevent hangs
          const profilePromise = supabase.from("user_profiles").select("*").eq("id", session.user.id).maybeSingle();
          const pTimeout = new Promise((_, r) => setTimeout(() => r(new Error("Profile timeout")), 4000));
          
          try {
            const { data: profile } = await Promise.race([profilePromise, pTimeout]);
            
            clearTimeout(safetyTimeout);
            if (mounted) {
              if (profile) {
                const fullUser = { ...session.user, ...profile };
                setUser(fullUser);
                
                // Ensure creator profile existence for integrations
                if (profile.role === 'creator') {
                  const { data: creator } = await supabase.from('creators').select('id').eq('user_id', session.user.id).maybeSingle();
                  if (!creator) {
                    console.log("App: Provisioning missing creator record...");
                    await supabase.from('creators').insert({
                      id: session.user.id,
                      user_id: session.user.id,
                      name: profile.full_name || 'Creator',
                      email: session.user.email,
                      niche: 'Lifestyle',
                      bio: 'New Omnya Creator'
                    });
                  }
                }
              } else {
                // Profile fetch returned null — could be RLS blocking or a transient error.
                // Retry once before giving up.
                const { data: retryProfile } = await supabase.from("user_profiles").select("*").eq("id", session.user.id).maybeSingle();
                if (retryProfile) {
                  setUser({ ...session.user, ...retryProfile });
                } else {
                  // Profile is actually missing in the database!
                  // Create it immediately as a bulletproof backup.
                  const fallbackRole = 'pending';
                  const reqRole = session.user.user_metadata?.requested_role || "creator";
                  
                  try {
                    await supabase.from("user_profiles").insert({
                      id: session.user.id,
                      email: session.user.email,
                      full_name: session.user.email.split("@")[0],
                      role: fallbackRole,
                      requested_role: reqRole
                    });
                    
                    if (fallbackRole === "pending") {
                      sendEmail("user_signup_waiting_approval", {
                        userEmail: session.user.email,
                        displayName: session.user.email.split("@")[0],
                        requestedRole: reqRole,
                      });
                    }
                  } catch (err) {
                    console.warn("Failed to auto-create missing user profile:", err.message);
                  }
                  
                  setUser({ ...session.user, role: fallbackRole });
                  console.warn('Profile fetch failed twice, using fallback role:', fallbackRole);
                }
              }
            }
          } catch(err) {
            console.warn("Profile fetch took too long, yielding to stale cache.");
            setUser(session.user);
          }
        } 
      } catch (e) {
        console.error("App: Stale session detected, wiping cache:", e);
        try { localStorage.removeItem('supabase.auth.token'); } catch(_){}
      } finally {
        if (mounted) {
          clearTimeout(safetyTimeout);
          setLoading(false);
        }
      }
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log("Auth Event:", event);
      if (event === "SIGNED_OUT" || event === "USER_DELETED") {
        if (mounted) {
          setUser(null);
          setIsRecoveryMode(false);
          setDbLoading(false); // Stop db loop
          localStorage.removeItem("last_page");
        }
      } else if (event === "PASSWORD_RECOVERY") {
        if (mounted) setIsRecoveryMode(true);
      } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        // Leave the DB fetching loop to the global useEffect to avoid race condition!
        // We only append the raw auth user info, preserving profile fields
        // (role, full_name, etc.) that come from user_profiles.
        //
        // IMPORTANT: session.user.role is the auth-level role ("authenticated"),
        // NOT user_profiles.role. Spreading session.user last would clobber the
        // real role and break the sidebar / page-validation effect on token
        // refresh (~50 min after sign-in).
        if (session && mounted) {
          setUser(prevUser => {
            if (!prevUser) return { ...session.user };
            // Same user (tab refocus re-emits SIGNED_IN): keep the object so loadDB doesn't rerun
            if (prevUser.id === session.user.id) return prevUser;
            // Profile fields win; only merge session.user fields that prevUser
            // doesn't already have (e.g. id/email on the initial SIGNED_IN).
            return { ...session.user, ...prevUser };
          });
        }
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Sync page validation.
  //
  // Uses App's already-computed `role` (derived from user_profiles.role via
  // normalizeRole). We refuse to validate at all if role is not one
  // of the known nav buckets — that keeps a transient state like
  // role="authenticated" from briefly resetting `page` to dashboard during
  // token refresh.
  useEffect(() => {
    if (!user) return;
    if (!navs[role]) {
      // Role is unknown (e.g. transient 'pending' before profile loads, or
      // some auth-level value). Don't force-reset the page.
      setLoading(false);
      return;
    }
    const currentNavs = navs[role];
    const isPageValid = currentNavs.some(n => n.id === page);
    if (!isPageValid && page !== "dashboard") {
      setPage("dashboard");
    }
    setLoading(false);
  }, [user, page, role]);

  // Optional nav entries are gated on a capability the *database* confirms.
  //
  // An owner always holds it. An AM holds it only with an active
  // payment_managers grant, which is_payment_manager('can_view_payouts')
  // answers server-side. On error we hide the entry: failing closed here costs
  // an AM one menu item, whereas failing open offers a page that will refuse
  // them anyway.
  //
  // Note this deliberately does NOT feed the page-validation effect below.
  // That effect only asks "is this a route this role has", and gating it on an
  // async capability would bounce a deep link to /payout-manager back to the
  // dashboard during the round trip.
  useEffect(() => {
    let cancelled = false;
    if (!user) { setCaps({}); return; }
    if (role === "owner") { setCaps({ payouts: true }); return; }
    if (role !== "am") { setCaps({}); return; }
    (async () => {
      const { data, error } = await supabase.rpc("is_payment_manager", { p_permission: "can_view_payouts" });
      if (cancelled) return;
      if (error) {
        console.warn("caps: is_payment_manager failed, hiding gated nav —", error.message);
        setCaps({});
        return;
      }
      setCaps({ payouts: data === true });
    })();
    return () => { cancelled = true; };
  }, [user, role]);

  const loadDB = useCallback(async()=>{
    if (!user) return;
    setDbLoading(true); setDbError("");
    try {
      console.log("loadDB: Fetching tables...");
      
      const isClient = (user?.role || "").toLowerCase() === 'client';
      const isOwner  = ['owner', 'admin'].includes((user?.role || '').toLowerCase());
      
      const tables = isClient ? [
        { key: 'campaigns', name: 'client_safe_campaigns' },
        { key: 'submissions', name: 'client_safe_submissions' },
        { key: 'analytics', name: 'client_safe_analytics' },
        { key: 'userProfiles', name: 'user_profiles' },
        { key: 'clients', name: 'clients' }
      ] : [
        { key: 'creators', name: 'creators' },
        { key: 'clients', name: 'clients' },
        { key: 'campaigns', name: 'campaigns' },
        { key: 'submissions', name: 'submissions' },
        { key: 'accountManagers', name: 'account_managers' },
        { key: 'payments', name: 'payments' },
        { key: 'userProfiles', name: 'user_profiles' },
        { key: 'analytics', name: 'video_analytics' },
        { key: 'campaignCreators', name: 'campaign_creators' }
      ];

      const results = {};
      const failures = [];

      await Promise.all(tables.map(async (t) => {
        const { data, error } = await selectAllWithRetry(t.name);
        if (error) {
          console.error(`Error loading ${t.name}:`, error.code || "(no code)", error.message);
          failures.push({ table: t.name, error });
        } else {
          results[t.key] = data;
        }
      }));

      if (failures.length > 0) {
        const coreRequired = isClient ? ["user_profiles"] : ["creators", "user_profiles"];
        const coreFailures = failures.filter(f => coreRequired.includes(f.table));

        if (coreFailures.length > 0) {
          const schemaBroken = coreFailures.some(f => isSchemaError(f.error));
          // Only the owner can act on a schema problem, and only the owner
          // should see internal table names. Everyone else gets a retry.
          if (schemaBroken && isOwner) {
            const names = coreFailures.map(f => f.table).join(", ");
            setDbError(`Core tables (${names}) are missing. Apply the pending migrations in supabase/migrations (supabase db push).`);
            setShowSQL(true);
          } else if (schemaBroken) {
            setDbError("Your account isn't fully set up yet. Please contact support.");
          } else {
            setDbError("We couldn't load your data. Please check your connection and retry.");
          }
        } else {
          console.warn("Some secondary tables failed to load:", failures.map(f => f.table));
        }
      }
      
      setDb({
        creators: results.creators || [],
        clients: results.clients || [],
        campaigns: results.campaigns || [],
        submissions: results.submissions || [],
        accountManagers: results.accountManagers || [],
        payments: results.payments || [],
        userProfiles: results.userProfiles || [],
        analytics: results.analytics || [],
        campaignCreators: results.campaignCreators || [],
        _currentUser: user
      });
    } catch(e) { 
      console.error("DB Load Error:", e);
      setDbError("Failed to load data. Check your connection."); 
    }
    setDbLoading(false);
  },[user]);

  useEffect(()=>{ if(user) loadDB(); },[user,loadDB]);

  // Global Realtime Sync (role-scoped delta updates)
  //
  // Each role subscribes only to the tables it actually needs. Supabase
  // Realtime enforces RLS on change events, so even if a role over-subscribes,
  // rows they cannot read will be filtered server-side. We restrict
  // subscriptions here as defence-in-depth and to avoid leaking metadata
  // about sensitive tables (payments, user_profiles) to creators/clients.
  useEffect(() => {
    if (!user) return;

    const tableKeyMap = {
      creators:         'creators',
      clients:          'clients',
      campaigns:        'campaigns',
      submissions:      'submissions',
      account_managers: 'accountManagers',
      payments:         'payments',
      user_profiles:    'userProfiles',
      video_analytics:  'analytics',
    };

    // Tables each role should receive live updates for.
    const roleTableSets = {
      owner:   ['creators', 'clients', 'campaigns', 'submissions', 'account_managers', 'payments', 'user_profiles', 'video_analytics'],
      am:      ['creators', 'clients', 'campaigns', 'submissions', 'video_analytics'],
      creator: ['campaigns', 'submissions'],
      client:  ['campaigns', 'submissions', 'video_analytics'],
    };

    const tablesToSubscribe = roleTableSets[role] || [];

    const channels = tablesToSubscribe.map(table =>
      supabase.channel(`sync_${table}_${role}`)
        .on('postgres_changes', { event: '*', schema: 'public', table }, payload => {
          setDb(prev => {
            const listKey = tableKeyMap[table];
            if (!prev[listKey]) return prev;

            const currentArr = [...prev[listKey]];

            if (payload.eventType === 'INSERT') {
              if (!currentArr.find(item => item.id === payload.new.id)) {
                currentArr.push(payload.new);
              }
            } else if (payload.eventType === 'UPDATE') {
              const idx = currentArr.findIndex(item => item.id === payload.new.id);
              if (idx !== -1) currentArr[idx] = payload.new;
              else currentArr.push(payload.new);
            } else if (payload.eventType === 'DELETE') {
              return { ...prev, [listKey]: currentArr.filter(item => item.id !== payload.old.id) };
            }

            return { ...prev, [listKey]: currentArr };
          });
        })
        .subscribe()
    );

    return () => {
      channels.forEach(ch => supabase.removeChannel(ch));
    };
  }, [user, role]);

  const handleLogin = async(u) => {
    console.log("handleLogin: instant login for", u.id);
    // Setting user unmounts <Login> immediately, which is great.
    setUser(u); 
    
    // Fire-and-forget sync wrapper
    const syncProfile = async () => {
      try {
        const profilePromise = supabase.from("user_profiles").select("*").eq("id", u.id).maybeSingle();
        const pTimeout = new Promise((_, r) => setTimeout(() => r(new Error("Timeout")), 10000));
        
        const { data: profile } = await Promise.race([profilePromise, pTimeout]);
        
        if (profile) { 
          setUser(prev => ({...prev, ...profile})); 
        } else {
          // Profile fetch returned null — could be a brand-new user OR a transient fetch failure.
          // SAFE: Use INSERT (not upsert) so we never overwrite an existing role (e.g. owner → pending).
          const requestedRole = u.user_metadata?.requested_role || "creator";
          const initialRole = "pending";
          const { data: newProfile } = await supabase.from("user_profiles")
            .insert({ id: u.id, email: u.email, full_name: u.email.split("@")[0], role: initialRole, requested_role: requestedRole })
            .select().maybeSingle();
          if (newProfile) {
            setUser(prev => ({...prev, ...newProfile}));
            
            // Only send the approval request email if the user is a pending new signup
            if (initialRole === "pending") {
              sendEmail("user_signup_waiting_approval", {
                userEmail: u.email,
                displayName: u.email.split("@")[0],
                requestedRole: requestedRole,
              });
            }
          } else {
            // Insert failed (profile likely already exists) — retry the fetch to get the real data.
            const { data: retryProfile } = await supabase.from("user_profiles").select("*").eq("id", u.id).maybeSingle();
            if (retryProfile) setUser(prev => ({...prev, ...retryProfile}));
          }
        }
      } catch(e) {
        console.warn("Background profile sync failed:", e.message);
      }
    };
    
    syncProfile();
  };

  // Signed out users land on the sign-in form, not the marketing page at "/".
  const handleLogout = async()=>{ await supabase.auth.signOut(); window.history.replaceState({}, '', '/login'); setUser(null); setPage("dashboard"); };


  const reviewPendingCount = db.submissions.filter(s=>s.status==="Submitted"||s.status==="Under Review").length;

  const pageTitles = {
    dashboard:"Dashboard",jobs:"Available Jobs","active-jobs":"My Active Jobs",
    submit:"Submit Content",submissions:"My Submissions",insights:"Video Insights",
    "review-queue":"Review Queue","my-creators":"My Creators",campaigns:"Campaigns",
    clients:"My Clients","content-library":"Content Library",analytics:"Analytics",
    "clients-full":"Client Management",revenue:"Revenue Analytics",
    team:"Team Performance","pending-users":"Approve Users","creators-manage":"Manage Creators",
    legal: "Legal Center",
    "social-connections": "Social Connections",
    "payout-manager": "Payout Manager",
    "content-gallery": "Delivered Content",
    "creator-performance": "Creator Performance",
    "user-management": "User Management",
    "audit": "Audit History",
    "system-config": "System Config",
  };

  const renderPage = ()=>{
    if(dbError&&!showSQL) return <div className="content"><ErrorMsg msg={dbError} onRetry={loadDB}/>{baseRole==="owner"&&<div style={{marginTop:16}}><button className="btn btn-primary btn-sm" onClick={()=>setShowSQL(true)}>📋 View Database Setup SQL</button></div>}</div>;
    if(dbLoading) return <Spinner/>;

    // Validation is now handled in useEffect

    if(role==="client"){
      if(page==="dashboard") return <ErrorBoundary label="Client Dashboard"><ClientDashboard user={user} db={db} onRefresh={loadDB} onNavigate={setPage}/></ErrorBoundary>;
      if(page==="campaigns") return <ErrorBoundary label="Client Campaigns"><ClientCampaignsPage user={user} db={db}/></ErrorBoundary>;
      if(page==="content-gallery") return <ErrorBoundary label="Client Content Gallery"><ClientContentGallery user={user} db={db}/></ErrorBoundary>;
      if(page==="analytics") return <ErrorBoundary label="Video Insights"><div className="content"><h2 style={{fontSize:24,fontWeight:700,marginBottom:8}}>Video Insights</h2><p style={{color:"var(--ink3)",marginBottom:24}}>Performance analytics across all your campaigns.</p><AnalyticsDashboard campaignId={null}/></div></ErrorBoundary>;
    }

    if(role==="creator"){
      if(page==="dashboard") return <ErrorBoundary label="Dashboard"><CreatorDashboard user={user} db={db} onNavigate={setPage}/></ErrorBoundary>;
      if(page==="jobs") return <ErrorBoundary label="Job Board"><JobBoard user={user} db={db} onRefresh={loadDB}/></ErrorBoundary>;
      if(page==="active-jobs") return <ErrorBoundary label="Active Jobs"><CreatorActiveJobs user={user} db={db} onNavigate={setPage}/></ErrorBoundary>;
      if(page==="submit") return <ErrorBoundary label="Submit Content"><SubmitContent user={user} db={db} onRefresh={loadDB} setPage={setPage}/></ErrorBoundary>;
      if(page==="submissions") return <ErrorBoundary label="My Submissions"><MySubmissions user={user} db={db}/></ErrorBoundary>;
      if(page==="social-connections") return <ErrorBoundary label="Social Connections"><CreatorConnections currentUser={user} /></ErrorBoundary>;
      if(page==="payout-manager") return <ErrorBoundary label="Payout Manager"><CreatorEarningsPage user={user} db={db}/></ErrorBoundary>;
      if(page==="insights") return <ErrorBoundary label="Video Insights"><CreatorInsights user={user} db={db}/></ErrorBoundary>;
      if(page==="legal") return <ErrorBoundary label="Legal Center"><Legal /></ErrorBoundary>;
    }
    if(role==="am"||role==="account_manager"){
      if(page==="dashboard") return <ErrorBoundary label="AM Dashboard"><AMDashboard user={user} db={db} setPage={setPage}/></ErrorBoundary>;
      if(page==="review-queue") return <ErrorBoundary label="Review Queue"><ReviewQueue db={db} onRefresh={loadDB} user={user}/></ErrorBoundary>;
      if(page==="my-creators") return <ErrorBoundary label="My Creators"><MyCreators user={user} db={db} onRefresh={loadDB}/></ErrorBoundary>;
      if(page==="campaigns") return <ErrorBoundary label="Campaigns"><CampaignsPage user={user} db={db} onRefresh={loadDB} isOwner={false}/></ErrorBoundary>;
      if(page==="clients") return <ErrorBoundary label="Clients"><ClientsPage isOwner={false} db={db} onRefresh={loadDB} user={user}/></ErrorBoundary>;
      if(page==="content-library") return <ErrorBoundary label="Content Library"><ContentLibrary db={db} onRefresh={loadDB}/></ErrorBoundary>;
      if(page==="analytics") return <ErrorBoundary label="Analytics"><Analytics db={db}/></ErrorBoundary>;
      if(page==="revenue") return <ErrorBoundary label="Revenue"><RevenueAnalytics db={db} user={user} isOwner={false} onRefresh={loadDB}/></ErrorBoundary>;
      if(page==="creator-performance") return <ErrorBoundary label="Creator Performance"><CreatorPerformance db={db} isOwner={false} user={user} onRefresh={loadDB}/></ErrorBoundary>;
      if(page==="payout-manager") return <ErrorBoundary label="Payouts"><PayoutManager /></ErrorBoundary>;
      if(page==="legal") return <ErrorBoundary label="Legal Center"><Legal /></ErrorBoundary>;
    }
    if(role==="owner"){
      if(page==="dashboard") return <ErrorBoundary label="Owner Dashboard"><OwnerDashboard db={db} onRefresh={loadDB} setPage={setPage}/></ErrorBoundary>;
      if(page==="clients-full") return <ErrorBoundary label="Client Management"><ClientsPage isOwner={true} db={db} onRefresh={loadDB} user={user}/></ErrorBoundary>;
      if(page==="revenue") return <ErrorBoundary label="Revenue"><RevenueAnalytics db={db} user={user} isOwner={role==="owner"} onRefresh={loadDB}/></ErrorBoundary>;
      if(page==="creator-performance") return <ErrorBoundary label="Creator Performance"><CreatorPerformance db={db} isOwner={true} user={user} onRefresh={loadDB}/></ErrorBoundary>;
      if(page==="payout-manager") return <ErrorBoundary label="Payouts"><PayoutManager /></ErrorBoundary>;
      if(page==="team") return <ErrorBoundary label="Team Performance"><TeamPerformance db={db} onRefresh={loadDB}/></ErrorBoundary>;
      if(page==="pending-users") return <ErrorBoundary label="Pending Users"><PendingUsers onRefresh={loadDB}/></ErrorBoundary>;
      if(page==="user-management") return <ErrorBoundary label="User Management"><UserManagement currentUser={user} onRefresh={loadDB}/></ErrorBoundary>;
      if(page==="audit") return <ErrorBoundary label="Audit History"><AuditHistory/></ErrorBoundary>;
      if(page==="system-config") return <ErrorBoundary label="System Config"><SystemConfig/></ErrorBoundary>;
      // §5.2: the owner files a submission on a creator's behalf with the creator's form.
      if(page==="submit") return <ErrorBoundary label="Submit Content"><SubmitContent user={user} db={db} onRefresh={loadDB} setPage={setPage} isOverride={true}/></ErrorBoundary>;
      if(page==="creators-manage") return <ErrorBoundary label="Manage Creators"><CreatorsManage db={db} onRefresh={loadDB} user={user}/></ErrorBoundary>;
      if(page==="review-queue") return <ErrorBoundary label="Review Queue"><ReviewQueue db={db} onRefresh={loadDB} user={user}/></ErrorBoundary>;
      if(page==="campaigns") return <ErrorBoundary label="Campaigns"><CampaignsPage user={user} db={db} onRefresh={loadDB} isOwner={true}/></ErrorBoundary>;
      if(page==="content-library") return <ErrorBoundary label="Content Library"><ContentLibrary db={db} onRefresh={loadDB}/></ErrorBoundary>;
      if(page==="legal") return <ErrorBoundary label="Legal Center"><Legal /></ErrorBoundary>;
    }
    if (loading) {
      return (
        <div className="content">
          <div className="empty">
            <div className="loading-spinner" style={{ fontSize: '3rem', marginBottom: '1rem' }}>⌛</div>
            <h3>Syncing workspace...</h3>
            <p>Gathering your latest data from the platform.</p>
          </div>
        </div>
      );
    }

    return (
      <div className="content">
        <div className="empty">
          <div className="empty-icon">🏠</div>
          <h3>Dashboard Pending</h3>
          <p>Please select a tab from the sidebar to continue.</p>
        </div>
      </div>
    );
  };

  useEffect(() => {
    let interval;
    if (user?.role === "pending") {
      interval = setInterval(async () => {
        const { data: profile } = await supabase.from("user_profiles").select("*").eq("id", user.id).single();
        if (profile && profile.role !== "pending") {
          // Role has been assigned by owner — clear any stale page target so the
          // user always lands on their role-appropriate dashboard, never an owner page.
          localStorage.removeItem("last_page");
          setPage("dashboard");
          setUser(prev => ({ ...prev, ...profile }));
        }
      }, 10000); // Poll every 10s
    }
    return () => interval && clearInterval(interval);
  }, [user]);

  const checkStatus = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const { data: profile, error } = await supabase.from("user_profiles").select("*").eq("id", user.id).maybeSingle();
      if (error) throw error;
      if (profile) {
        setUser({ ...user, ...profile });
      } else {
        alert("Profile not found. If this persists, please contact support.");
      }
    } catch (e) {
      console.error("Check status error:", e.message);
      alert("Failed to check status: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  // Main Render Helper
  const wrapContent = (content, showFooter = false) => (
    <>
      <style>{styles}</style>
      <ErrorBoundary label="Global">
        <div style={{minHeight:"100vh",display:"flex",flexDirection:"column"}}>
          {content}
          {showFooter && (
            <div className="public-footer">
              <a href="/terms" style={{textDecoration: 'none', color: 'inherit'}}>Terms of Service</a>
              <a href="/privacy" style={{textDecoration: 'none', color: 'inherit'}}>Privacy Policy</a>
              <a href="/data-deletion" style={{textDecoration: 'none', color: 'inherit'}}>Data Deletion</a>
            </div>
          )}
        </div>
      </ErrorBoundary>
    </>
  );

  // Loading screen removed as per user request
  
  const searchParams = new URLSearchParams(window.location.search);
  const isPublicShare = path === '/share/campaign' || path.startsWith('/share/') || searchParams.has('share_token');
  if(isPublicShare) return <React.Suspense fallback={<div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center'}}><div className="ai-spinner" style={{width:32,height:32,borderWidth:3}}/></div>}><SharedCampaignReport /></React.Suspense>;


  // "/" is the public landing page for signed-out visitors; the sign-in form lives at "/login".
  // A "?page=" deep link or an auth redirect (tokens in the hash, ?code=) is portal traffic, not a visit.
  const isLandingPath = path === '/' && !searchParams.has('page') && !searchParams.has('code') &&
    !/access_token|refresh_token|error_description|type=recovery/.test(window.location.hash);
  if (isLandingPath && !user) {
    // With no stored Supabase session there is nothing to restore, so skip the spinner.
    let hasStoredSession = true;
    try { hasStoredSession = Object.keys(localStorage).some(k => /^sb-.+-auth-token$/.test(k)); } catch (_) {}
    if (!loading || !hasStoredSession) return <React.Suspense fallback={null}><Landing /></React.Suspense>;
  }

  // Display initialization spinner while checking session
  if (loading && !user) return wrapContent(<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",background:"var(--bg)"}}><Spinner label="Restoring session…" /></div>, false);

  if(isRecoveryMode) return wrapContent(<ResetPassword onComplete={() => setIsRecoveryMode(false)}/>, true);
  if(!user) return wrapContent(<Login onLogin={handleLogin}/>, false);
  if(rawRole==="pending") return wrapContent(<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",background:"var(--bg)",flexDirection:"column",gap:16,padding:24}}><img src={LOGO_URI} alt="Omnya" style={{height:48,width:"auto"}}/><div style={{fontFamily:"Bebas Neue, sans-serif",fontSize:24,letterSpacing:"2px"}}>Account Pending Approval</div><div style={{fontSize:14,color:"var(--ink3)",textAlign:"center",maxWidth:340}}>Your account has been created! An admin will assign your role shortly. Please check back soon.</div><div style={{display:"flex",gap:8}}><button className="btn btn-primary btn-sm" onClick={checkStatus} disabled={loading}>{loading ? "Checking..." : "Check Status"}</button><button className="btn btn-ghost btn-sm" onClick={handleLogout}>Sign out</button></div></div>, true);
  if(rawRole==="denied") return wrapContent(<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",background:"var(--bg)",flexDirection:"column",gap:16}}><img src={LOGO_URI} alt="Omnya" style={{height:48,width:"auto"}}/><div style={{fontFamily:"Bebas Neue, sans-serif",fontSize:24}}>Access Denied</div><div style={{fontSize:14,color:"var(--ink3)"}}>Please contact your admin for access.</div><button className="btn btn-primary btn-sm" onClick={handleLogout}>Sign out</button></div>, true);
  const usersPendingCount = db.userProfiles?.filter(u => u.role === "pending").length || 0;

  return wrapContent(
    <>
      <div className={`app ${mobileMenuOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-overlay" onClick={() => setMobileMenuOpen(false)}></div>
        <Sidebar user={user} role={role} caps={caps} page={page} setPage={setPage} reviewPendingCount={reviewPendingCount} usersPendingCount={usersPendingCount} onLogout={handleLogout} mobileMenuOpen={mobileMenuOpen} setMobileMenuOpen={setMobileMenuOpen}/>
        <div className="main">
          <div className="topbar">
            <div className="flex-center gap-12">
              <button className="mobile-toggle" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
                {mobileMenuOpen ? '✕' : '☰'}
              </button>
              <div>
                <div className="page-title">{pageTitles[page]||page}</div>
                <div className="page-sub">Omnya Creator Portal</div>
              </div>
            </div>
            <div className="flex-center gap-8">
              {baseRole==="owner"&&(
                <select className="select desktop-only" style={{height:32,fontSize:12,padding:"0 12px 0 8px",marginRight:8}} value={overrideRole||""} onChange={e=>{setOverrideRole(e.target.value||null);setPage("dashboard");}}>
                  <option value="">👑 View as Owner</option>
                  <option value="creator">👁️ View as Creator</option>
                  <option value="am">👁️ View as AM</option>
                  <option value="client">👁️ View as Client</option>
                </select>
              )}
              {role==="owner"&&<button className="btn btn-ghost btn-sm desktop-only" onClick={()=>setShowSQL(true)}>🗄️ DB Setup</button>}
              <button className="btn btn-ghost btn-sm desktop-only" onClick={handleLogout}>Sign out</button>
            </div>
          </div>
          <React.Suspense fallback={<Spinner />}>{renderPage()}</React.Suspense>
        </div>
      </div>
      {showSQL&&baseRole==="owner"&&<SQLSetupModal onClose={()=>setShowSQL(false)}/>}
    </>
  );
}
