export default function PageHeader({ title, description, actions, children }) {
  return (
    <header className="page-header">
      <div style={{ minWidth: 0 }}>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
        {children}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}
