export function Skeleton({ w = "100%", h = 14, r, style, className = "" }) {
  return <span aria-hidden="true" className={`skel ${className}`} style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

export function SkeletonText({ lines = 2, last = "60%", gap = 8, h = 12 }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap }}>
      {Array.from({ length: lines }, (_, i) => <Skeleton key={i} h={h} w={i === lines - 1 ? last : "100%"} />)}
    </span>
  );
}

export function SkeletonHeader({ actions = 1 }) {
  return (
    <div className="page-header" aria-hidden="true">
      <div style={{ flex: 1, minWidth: 0 }}>
        <Skeleton w={220} h={32} style={{ marginBottom: 8, maxWidth: "70%" }} />
        <Skeleton w={420} h={18} style={{ maxWidth: "90%" }} />
      </div>
      {actions > 0 && <div className="page-actions">{Array.from({ length: actions }, (_, i) => <Skeleton key={i} w={112} h={38} r={6} />)}</div>}
    </div>
  );
}

export function SkeletonStats({ count = 4 }) {
  return (
    <div className="stats-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="stat-card">
          <Skeleton w="45%" h={13} />
          <Skeleton w="60%" h={32} style={{ marginTop: 10 }} />
          <Skeleton w="35%" h={11} style={{ marginTop: 12 }} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonChart({ h = 240 }) {
  return (
    <div className="card" aria-hidden="true">
      <Skeleton w={160} h={16} style={{ marginBottom: 6 }} />
      <Skeleton w={240} h={12} style={{ marginBottom: 20, maxWidth: "70%" }} />
      <Skeleton h={h} r={8} />
    </div>
  );
}

export function SkeletonTable({ rows = 6, cols = 5 }) {
  return (
    <div className="table-wrap" aria-hidden="true">
      <div style={{ display: "grid", gridTemplateColumns: `2fr repeat(${cols - 1}, 1fr)`, gap: 16, padding: "12px 16px", background: "var(--surface2)", borderBottom: "1px solid var(--border)" }}>
        {Array.from({ length: cols }, (_, i) => <Skeleton key={i} h={10} w="50%" />)}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} style={{ display: "grid", gridTemplateColumns: `2fr repeat(${cols - 1}, 1fr)`, gap: 16, alignItems: "center", height: 53, padding: "0 16px", borderBottom: r < rows - 1 ? "1px solid var(--border)" : 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}><Skeleton w={28} h={28} r={14} /><Skeleton h={12} w="60%" /></span>
          {Array.from({ length: cols - 1 }, (_, i) => <Skeleton key={i} h={12} w={i % 2 ? "40%" : "65%"} />)}
        </div>
      ))}
    </div>
  );
}

export function SkeletonToolbar() {
  return <div className="toolbar" aria-hidden="true"><Skeleton w={320} h={36} r={6} style={{ maxWidth: "100%" }} /></div>;
}

export function SkeletonList({ count = 4, h = 140 }) {
  return <div className="flex-col gap-12" aria-hidden="true">{Array.from({ length: count }, (_, i) => <div key={i} className="card" style={{ height: h }}><Skeleton w="40%" h={16} style={{ marginBottom: 10 }} /><SkeletonText lines={2} /></div>)}</div>;
}

export function SkeletonCards({ count = 6, h = 218 }) {
  return (
    <div className="grid-auto" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card" style={{ height: h }}>
          <Skeleton w="55%" h={16} style={{ marginBottom: 10 }} />
          <SkeletonText lines={2} />
          <Skeleton h={6} r={3} style={{ marginTop: 24 }} />
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton({ variant = "dashboard" }) {
  return (
    <div className="content" role="status" aria-label="Loading">
      <SkeletonHeader actions={variant === "detail" ? 0 : 1} />
      {variant === "dashboard" && <><SkeletonStats /><SkeletonChart /><div style={{ height: 24 }} /><SkeletonTable rows={4} /></>}
      {variant === "table" && <><SkeletonToolbar /><SkeletonTable rows={10} /></>}
      {variant === "cards" && <><SkeletonToolbar /><SkeletonCards /></>}
      {variant === "list" && <><SkeletonToolbar /><SkeletonList /></>}
      {variant === "detail" && <div className="flex-col gap-16"><div className="card" style={{ height: 90 }} aria-hidden="true" /><SkeletonChart h={200} /></div>}
    </div>
  );
}
