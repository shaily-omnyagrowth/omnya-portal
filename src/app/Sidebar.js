import { getAvatarColor, getInitials } from "../utils";
import { LOGO_MARK_URI } from "./brand";
import { navsFor, roleLabel } from "./nav";

export default function Sidebar({ user, role, caps, page, setPage, reviewPendingCount, usersPendingCount, onLogout, mobileMenuOpen, setMobileMenuOpen }) {
  // role is computed by App.js with the email-promotion shortcut + 'pending' fallback.
  // We don't recompute here; the source of truth lives one level up. (Used to be
  // a local `(user?.role || "creator")` which raced on cold load and rendered an
  // empty sidebar until the next React update.)
  return (
    <div className={`sidebar ${mobileMenuOpen ? 'open' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <img src={LOGO_MARK_URI} alt="Omnya" style={{height:36,width:"auto"}} />
          <div>
            <div className="sidebar-logo-text">Omnya</div>
            <div className="sidebar-role">{roleLabel[role]}</div>
          </div>
        </div>
      </div>
      <div className="sidebar-nav">
        <div className="nav-section">
          {navsFor(role, caps).map(item => (
            <div key={item.id} className={`nav-item ${page===item.id?"active":""}`} onClick={()=>{setPage(item.id); setMobileMenuOpen(false);}}>
              <span className="icon">{item.icon}</span>
              <span>{item.label}</span>
              {item.id === "review-queue" && reviewPendingCount > 0 && <span className="nav-badge">{reviewPendingCount}</span>}
              {item.id === "pending-users" && usersPendingCount > 0 && <span className="nav-badge">{usersPendingCount}</span>}
            </div>
          ))}
        </div>
      </div>
      <div className="sidebar-footer">
        <div className="user-chip">
          <div className={`user-avatar ${getAvatarColor(user.full_name||user.email)}`}>{getInitials(user.full_name||user.email)}</div>
          <div className="user-info">
            <div className="user-name">{user.full_name||"User"}</div>
            <div className="user-email">{user.email}</div>
          </div>
        </div>
        <button className="logout-btn" onClick={onLogout}>Sign out →</button>
      </div>
    </div>
  );
}
