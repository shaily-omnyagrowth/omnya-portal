export default function Spinner({ label = null }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', width: '100%', minHeight: 240,
      padding: '48px 24px', boxSizing: 'border-box', gap: 12,
    }}>
      <div className="ai-spinner" style={{ width: 32, height: 32, borderWidth: 3 }} role="status" aria-label={label || 'Loading'} />
      {label && <div style={{ fontSize: 13, color: 'var(--ink3)' }}>{label}</div>}
    </div>
  );
}
