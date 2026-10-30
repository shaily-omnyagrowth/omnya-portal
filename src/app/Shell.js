import React, { useEffect, useRef, useState } from "react";
import { ArrowRight01Icon, Cancel01Icon, Menu01Icon, ViewIcon } from "@hugeicons/core-free-icons";
import Icon from "../ui/Icon";
import watchTables from "../ui/tableLabels";
import { navsFor, roleLabel, titleFor } from "./nav";
import Sidebar from "./Sidebar";

export default function Shell({ user, role, baseRole, caps, page, onNavigate, counts, overrideRole, onViewAs, onLogout, refreshing, children }) {
  const [drawer, setDrawer] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem("sidebar_collapsed") === "1"; } catch (_) { return false; } });
  const toggleCollapsed = () => setCollapsed(c => { try { localStorage.setItem("sidebar_collapsed", c ? "0" : "1"); } catch (_) {} return !c; });
  const mainRef = useRef(null);
  const scrollRef = useRef(null);
  const firstPage = useRef(true);

  const title = titleFor(role, page);
  const group = navsFor(role, caps).find(g => g.items.some(i => i.id === page))?.label;

  useEffect(() => {
    document.title = `${title} | Omnya`;
  }, [title]);

  useEffect(() => {
    setDrawer(false);
    if (firstPage.current) { firstPage.current = false; return; }
    window.scrollTo(0, 0);
    scrollRef.current?.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [page]);

  useEffect(() => watchTables(), []);

  useEffect(() => {
    const el = scrollRef.current;
    const onScroll = () => setScrolled(window.scrollY > 4 || el.scrollTop > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); el.removeEventListener("scroll", onScroll); };
  }, []);

  useEffect(() => {
    if (!drawer) return undefined;
    const onKey = e => { if (e.key === "Escape") setDrawer(false); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [drawer]);

  return (
    <div className={`app ${drawer ? "sidebar-open" : ""} ${collapsed ? "collapsed" : ""}`}>
      {refreshing && <div className="top-progress" role="progressbar" aria-label="Updating" />}
      <div className="sidebar-overlay" onClick={() => setDrawer(false)} aria-hidden="true" />
      <Sidebar
        user={user} role={role} baseRole={baseRole} caps={caps} page={page} counts={counts}
        onNavigate={onNavigate} overrideRole={overrideRole} onViewAs={onViewAs} onLogout={onLogout}
        collapsed={collapsed} onToggleCollapsed={toggleCollapsed}
      />
      <div className="main" ref={scrollRef} inert={drawer || undefined}>
        <header className={`topbar ${scrolled ? "scrolled" : ""}`}>
          <div className="topbar-left">
            <button className="btn btn-ghost btn-icon mobile-toggle" onClick={() => setDrawer(d => !d)} aria-label={drawer ? "Close menu" : "Open menu"} aria-expanded={drawer}>
              <Icon icon={drawer ? Cancel01Icon : Menu01Icon} size={20} />
            </button>
            <div className="crumbs">
              {group && <><span className="desktop-only">{group}</span><span className="desktop-only" aria-hidden="true"><Icon icon={ArrowRight01Icon} size={12} /></span></>}
              <span className="current">{title}</span>
            </div>
          </div>
          <div className="topbar-right">
            {overrideRole && (
              <button className="badge badge-ink" style={{ height: 28, border: 0, gap: 6, paddingInline: 10 }} onClick={() => onViewAs(null)} data-tip="Return to your owner view">
                <Icon icon={ViewIcon} size={14} />
                <span>Viewing as {roleLabel[overrideRole].toLowerCase()}</span>
                <Icon icon={Cancel01Icon} size={12} />
              </button>
            )}
          </div>
        </header>
        <main ref={mainRef} tabIndex={-1} style={{ outline: "none" }}>
          <React.Fragment key={`${role}:${page}`}>{children}</React.Fragment>
        </main>
      </div>
    </div>
  );
}
