import { useEffect, useRef, useState } from "react";
import { JusticeScale01Icon, Logout03Icon, SidebarLeft01Icon, Tick02Icon, UnfoldMoreIcon, ViewIcon } from "@hugeicons/core-free-icons";
import { getInitials } from "../utils";
import Icon from "../ui/Icon";
import { navsFor, roleLabel } from "./nav";

const VIEW_AS = [["", "Owner"], ["am", "Account manager"], ["creator", "Creator"], ["client", "Brand"]];

export function NavLink({ id, active, onNavigate, className = "", children, ...rest }) {
  return (
    <a
      href={`/?page=${id}`}
      className={className}
      aria-current={active ? "page" : undefined}
      onClick={e => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        onNavigate(id);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

function AccountMenu({ user, role, isOwner, overrideRole, onViewAs, onNavigate, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = e => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const name = user.full_name || user.email?.split("@")[0] || "Account";
  const pick = fn => () => { setOpen(false); fn(); };

  return (
    <div className="sidebar-footer" ref={ref}>
      {open && (
        <div className="menu" role="menu">
          {isOwner && <>
            <div className="menu-label">View the portal as</div>
            {VIEW_AS.map(([value, label]) => (
              <button key={label} role="menuitemradio" aria-checked={(overrideRole || "") === value} className="menu-item" onClick={pick(() => onViewAs(value || null))}>
                <Icon icon={(overrideRole || "") === value ? Tick02Icon : ViewIcon} size={16} style={{ opacity: (overrideRole || "") === value ? 1 : 0.6 }} />
                {label}
              </button>
            ))}
            <div className="menu-sep" />
          </>}
          <div className="menu-label truncate">{user.email}</div>
          <button role="menuitem" className="menu-item" onClick={pick(() => onNavigate("legal"))}>
            <Icon icon={JusticeScale01Icon} size={16} /> Legal center
          </button>
          <button role="menuitem" className="menu-item danger" onClick={pick(onLogout)}>
            <Icon icon={Logout03Icon} size={16} /> Sign out
          </button>
        </div>
      )}
      <button className="user-chip" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span className="user-avatar">{getInitials(name)}</span>
        <span className="user-info">
          <span className="user-name" style={{ display: "block" }}>{name}</span>
          <span className="user-email sidebar-role" style={{ display: "block" }}>{roleLabel[role]}</span>
        </span>
        <Icon icon={UnfoldMoreIcon} size={16} style={{ color: "var(--ink4)" }} />
      </button>
    </div>
  );
}

export default function Sidebar({ user, role, baseRole, caps, page, onNavigate, counts, overrideRole, onViewAs, onLogout, collapsed, onToggleCollapsed }) {
  return (
    <aside className="sidebar" aria-label="Main navigation">
      <div className="sidebar-header">
        <NavLink id="dashboard" className="sidebar-logo" onNavigate={onNavigate} aria-label="Omnya overview">
          <img src="/brand/mark.png" alt="" width="22" height="29" />
          <span className="sidebar-logo-text">Omnya</span>
        </NavLink>
        <button className="btn btn-ghost btn-icon btn-sm sidebar-collapse desktop-only" onClick={onToggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          <Icon icon={SidebarLeft01Icon} size={18} />
        </button>
      </div>
      <nav className="sidebar-nav">
        {navsFor(role, caps).map((group, gi) => (
          <div className="nav-section" key={group.label || gi}>
            {group.label && <div className="nav-section-label">{group.label}</div>}
            {group.items.map(item => (
              <NavLink key={item.id} id={item.id} active={page === item.id} onNavigate={onNavigate} className={`nav-item ${page === item.id ? "active" : ""}`} title={collapsed ? item.label : undefined}>
                <Icon icon={item.icon} size={18} />
                <span className="label">{item.label}</span>
                {counts[item.id] > 0 && <span className="nav-badge" aria-label={`${counts[item.id]} waiting`}>{counts[item.id] > 99 ? "99+" : counts[item.id]}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <AccountMenu user={user} role={role} isOwner={baseRole === "owner"} overrideRole={overrideRole} onViewAs={onViewAs} onNavigate={onNavigate} onLogout={onLogout} />
    </aside>
  );
}
