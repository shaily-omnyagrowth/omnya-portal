export default function Spinner({ label = null, inline = false }) {
  if (inline) return <span className="spinner" role="status" aria-label={label || "Loading"} style={{ display: "inline-block" }} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, minHeight: 200, padding: 32 }}>
      <div className="spinner" role="status" aria-label={label || "Loading"} />
      {label && <div style={{ fontSize: 13, color: "var(--ink3)" }}>{label}</div>}
    </div>
  );
}
