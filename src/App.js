import React, { useCallback, useEffect, useState } from "react";
import { MotionConfig } from "framer-motion";
import { GooeyToaster } from "goey-toast";
import TooltipLayer from "./ui/TooltipLayer";
import { Home01Icon } from "@hugeicons/core-free-icons";
import ErrorBoundary from "./app/ErrorBoundary";
import { navs } from "./app/nav";
import { routeFor, skeletonFor } from "./app/routes";
import Shell from "./app/Shell";
import useSession from "./app/useSession";
import useWorkspace, { normalizeRole } from "./app/useWorkspace";
import AccountState from "./pages/auth/AccountState";
import Login from "./pages/auth/Login";
import ResetPassword from "./pages/auth/ResetPassword";
import EmptyState from "./ui/EmptyState";
import ErrorMsg from "./ui/ErrorMsg";
import { PageSkeleton } from "./ui/Skeleton";
import Spinner from "./ui/Spinner";

const Landing = React.lazy(() => import("./pages/Landing"));
const SharedCampaignReport = React.lazy(() => import("./pages/SharedCampaignReport"));

const pageFromUrl = () => (new URLSearchParams(window.location.search).get("page") || "").toLowerCase();

function useMediaQuery(query) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return match;
}

function Toaster() {
  const mobile = useMediaQuery("(max-width: 640px)");
  return <><TooltipLayer /><GooeyToaster theme="dark" position={mobile ? "top-center" : "bottom-right"} preset="smooth" closeButton={!mobile} /></>;
}

function PublicFooter() {
  return (
    <footer className="public-footer">
      <a href="/terms">Terms of service</a>
      <a href="/privacy">Privacy policy</a>
      <a href="/data-deletion">Data deletion</a>
    </footer>
  );
}

function Frame({ children, footer = false }) {
  return (
    <ErrorBoundary label="Global">
      <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1 }}>{children}</div>
        {footer && <PublicFooter />}
      </div>
    </ErrorBoundary>
  );
}

export default function App() {
  const path = window.location.pathname.toLowerCase().replace(/\/+$/, "") || "/";
  const [page, setPage] = useState(() => pageFromUrl() || localStorage.getItem("last_page") || "dashboard");
  const resetPage = useCallback(() => setPage("dashboard"), []);

  const session = useSession({ resetPage });
  const { user, loading } = session;
  const rawRole = (user?.role || "pending").toLowerCase();
  const role = normalizeRole(rawRole);
  const ws = useWorkspace(user, role);

  useEffect(() => {
    const onPop = () => setPage(pageFromUrl() || "dashboard");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Mirrors the page into the URL; signing in from /login replaces history so Back skips the form.
  useEffect(() => {
    if (!user) return;
    const url = new URL(window.location);
    const fromLogin = url.pathname.toLowerCase().replace(/\/+$/, "") === "/login";
    if (fromLogin) url.pathname = "/";
    if (fromLogin || url.searchParams.get("page") !== page) {
      url.searchParams.set("page", page);
      window.history[fromLogin ? "replaceState" : "pushState"]({}, "", url);
    }
    localStorage.setItem("last_page", page);
  }, [page, user]);

  // Unknown roles are transient (profile still loading), so only known roles reset the page.
  useEffect(() => {
    if (!user || !navs[role]) return;
    if (page !== "dashboard" && !navs[role].some(n => n.id === page)) setPage("dashboard");
  }, [user, page, role]);

  const navigate = useCallback((id) => setPage(id), []);

  const searchParams = new URLSearchParams(window.location.search);
  const isPublicShare = path === "/share/campaign" || path.startsWith("/share/") || searchParams.has("share_token");
  if (isPublicShare) {
    return <MotionConfig reducedMotion="user"><React.Suspense fallback={<Spinner />}><SharedCampaignReport /></React.Suspense><Toaster /></MotionConfig>;
  }

  // "/" is the landing page for signed-out visitors; "?page=" or an auth redirect is portal traffic.
  const isLandingPath = path === "/" && !searchParams.has("page") && !searchParams.has("code") &&
    !/access_token|refresh_token|error_description|type=recovery/.test(window.location.hash);
  if (isLandingPath && !user) {
    let hasStoredSession = true;
    try { hasStoredSession = Object.keys(localStorage).some(k => /^sb-.+-auth-token$/.test(k)); } catch (_) {}
    if (!loading || !hasStoredSession) return <React.Suspense fallback={null}><Landing /></React.Suspense>;
  }

  const wrap = (content, footer) => <MotionConfig reducedMotion="user"><Frame footer={footer}>{content}</Frame><Toaster /></MotionConfig>;

  if (loading && !user) return wrap(<div className="state-screen"><Spinner label="Signing you in" /></div>);
  if (session.isRecoveryMode) return wrap(<ResetPassword onComplete={() => session.setIsRecoveryMode(false)} />, true);
  if (!user) return wrap(<Login onLogin={session.handleLogin} />, true);
  if (rawRole === "pending") return wrap(<AccountState kind="pending" onCheck={session.checkStatus} checking={session.checking} onLogout={session.handleLogout} />, true);
  if (rawRole === "denied") return wrap(<AccountState kind="denied" onLogout={session.handleLogout} />, true);

  const { db } = ws;
  const counts = {
    "review-queue": db.submissions.filter(s => s.status === "Submitted" || s.status === "Under Review").length,
    "pending-users": db.userProfiles?.filter(u => u.role === "pending").length || 0,
  };

  const renderPage = () => {
    if (ws.error) {
      return (
        <div className="content">
          <ErrorMsg msg={ws.error} onRetry={ws.loadDB} />
        </div>
      );
    }
    if (ws.status !== "ready" || !navs[role]) return <PageSkeleton variant={skeletonFor(role, page)} />;
    const route = routeFor(role, page, { user, db, loadDB: ws.loadDB, setPage, setUser: session.setUser });
    if (!route) {
      return (
        <div className="content">
          <EmptyState icon={Home01Icon} title="This page isn't available" action={<button className="btn btn-primary" onClick={() => setPage("dashboard")}>Go to overview</button>}>
            It may have moved, or your role doesn't include it.
          </EmptyState>
        </div>
      );
    }
    const [Page, props, variant] = route;
    return (
      <ErrorBoundary label={page}>
        <React.Suspense fallback={<PageSkeleton variant={variant} />}><Page {...props} /></React.Suspense>
      </ErrorBoundary>
    );
  };

  return wrap(
    <>
      <Shell
        user={user} role={role} caps={ws.caps} page={page} counts={counts}
        onNavigate={navigate} onLogout={session.handleLogout}
        refreshing={ws.refreshing}
      >
        {renderPage()}
      </Shell>
    </>
  );
}
