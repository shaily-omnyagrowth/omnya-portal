import Icon from "./Icon";

export default function EmptyState({ icon, title, children, action, compact = false }) {
  return (
    <div className="empty" style={compact ? { padding: "28px 16px" } : undefined}>
      {icon && <div className="empty-icon"><Icon icon={icon} size={20} /></div>}
      {title && <h3>{title}</h3>}
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
