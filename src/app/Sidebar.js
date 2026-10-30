import { useEffect, useRef, useState } from "react";
import { JusticeScale01Icon, Settings02Icon, Logout03Icon, SidebarLeft01Icon, UnfoldMoreIcon } from "@hugeicons/core-free-icons";
import Icon from "../ui/Icon";
import { navsFor, roleLabel } from "./nav";
import Avatar from "../ui/Avatar";

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

function AccountMenu({ collapsed, user, role, onNavigate, onLogout }) {
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
          <div className="menu-label truncate">{user.email}</div>
          <button role="menuitem" className="menu-item" onClick={pick(() => onNavigate("settings"))}>
            <Icon icon={Settings02Icon} size={16} /> Settings
          </button>
          <button role="menuitem" className="menu-item" onClick={pick(() => onNavigate("legal"))}>
            <Icon icon={JusticeScale01Icon} size={16} /> Legal center
          </button>
          <button role="menuitem" className="menu-item danger" onClick={pick(onLogout)}>
            <Icon icon={Logout03Icon} size={16} /> Sign out
          </button>
        </div>
      )}
      <button className="user-chip" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)} data-tip={collapsed ? name : undefined} data-tip-side="right">
        <Avatar name={name} className="user-avatar" />
        <span className="user-info">
          <span className="user-name" style={{ display: "block" }}>{name}</span>
          <span className="user-email sidebar-role" style={{ display: "block" }}>{roleLabel[role]}</span>
        </span>
        <Icon icon={UnfoldMoreIcon} size={16} style={{ color: "var(--ink4)" }} />
      </button>
    </div>
  );
}

export default function Sidebar({ user, role, caps, page, onNavigate, counts, onLogout, collapsed, onToggleCollapsed }) {
  return (
    <aside className="sidebar" aria-label="Main navigation">
      <div className="sidebar-header">
        <NavLink id="dashboard" className="sidebar-logo" onNavigate={onNavigate} aria-label="Omnya overview">
          <img src="/brand/mark.png" alt="" width="22" height="29" />
          <span className="sidebar-logo-text">Omnya</span>
        </NavLink>
        <button className="btn btn-ghost btn-icon btn-sm sidebar-collapse desktop-only" onClick={onToggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} data-tip-side={collapsed ? "right" : undefined}>
          <Icon icon={SidebarLeft01Icon} size={18} />
        </button>
      </div>
      <nav className="sidebar-nav">
        {navsFor(role, caps).map((group, gi) => (
          <div className="nav-section" key={group.label || gi}>
            {group.label && <div className="nav-section-label">{group.label}</div>}
            {group.items.map(item => (
              <NavLink key={item.id} id={item.id} active={page === item.id} onNavigate={onNavigate} className={`nav-item ${page === item.id ? "active" : ""}`} data-tip={collapsed ? item.label : undefined} data-tip-side="right">
                <Icon icon={item.icon} size={18} />
                <span className="label">{item.label}</span>
                {counts[item.id] > 0 && <span className="nav-badge" aria-label={`${counts[item.id]} waiting`}>{counts[item.id] > 99 ? "99+" : counts[item.id]}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <AccountMenu collapsed={collapsed} user={user} role={role} onNavigate={onNavigate} onLogout={onLogout} />
    </aside>
  );
}
