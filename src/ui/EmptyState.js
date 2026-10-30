import Icon from "./Icon";

function Illustration({ icon }) {
  return (
    <div className="empty-art" aria-hidden="true">
      <svg width="132" height="92" viewBox="0 0 132 92" fill="none">
        <rect x="18" y="14" width="74" height="58" rx="10" transform="rotate(-8 18 14)" fill="var(--bg2)" />
        <rect x="44" y="10" width="74" height="58" rx="10" transform="rotate(7 44 10)" fill="var(--bg3)" />
        <rect x="29" y="18" width="74" height="60" rx="11" fill="var(--surface)" stroke="var(--border2)" />
        <rect x="40" y="62" width="30" height="5" rx="2.5" fill="var(--bg2)" />
        <rect x="74" y="62" width="18" height="5" rx="2.5" fill="var(--bg2)" />
      </svg>
      {icon && <span className="empty-art-icon"><Icon icon={icon} size={22} /></span>}
    </div>
  );
}

export default function EmptyState({ icon, title, children, action, compact = false }) {
  return (
    <div className={`empty ${compact ? "compact" : ""}`}>
      {compact ? (icon && <div className="empty-icon"><Icon icon={icon} size={20} /></div>) : <Illustration icon={icon} />}
      {title && <h3>{title}</h3>}
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
