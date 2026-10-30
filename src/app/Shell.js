import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight01Icon, Cancel01Icon, Menu01Icon, ViewIcon } from "@hugeicons/core-free-icons";
import Icon from "../ui/Icon";
import { navsFor, roleLabel, titleFor } from "./nav";
import Sidebar from "./Sidebar";

export default function Shell({ user, role, baseRole, caps, page, onNavigate, counts, overrideRole, onViewAs, onLogout, refreshing, children }) {
  const [drawer, setDrawer] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const mainRef = useRef(null);
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
    mainRef.current?.focus({ preventScroll: true });
  }, [page]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
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
    <div className={`app ${drawer ? "sidebar-open" : ""}`}>
      {refreshing && <div className="top-progress" role="progressbar" aria-label="Updating" />}
      <div className="sidebar-overlay" onClick={() => setDrawer(false)} aria-hidden="true" />
      <Sidebar
        user={user} role={role} baseRole={baseRole} caps={caps} page={page} counts={counts}
        onNavigate={onNavigate} overrideRole={overrideRole} onViewAs={onViewAs} onLogout={onLogout}
      />
      <div className="main" inert={drawer || undefined}>
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
              <button className="badge badge-ink" style={{ height: 28, border: 0, gap: 6, paddingInline: 10 }} onClick={() => onViewAs(null)} title="Return to your owner view">
                <Icon icon={ViewIcon} size={14} />
                <span>Viewing as {roleLabel[overrideRole].toLowerCase()}</span>
                <Icon icon={Cancel01Icon} size={12} />
              </button>
            )}
          </div>
        </header>
        <main ref={mainRef} tabIndex={-1} style={{ outline: "none" }}>
          <motion.div
            key={`${role}:${page}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  );
}
