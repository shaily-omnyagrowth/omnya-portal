export default function Tabs({ value, onChange, tabs, label }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map(t => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          className={`tab ${value === t.id ? "active" : ""}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count != null && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
