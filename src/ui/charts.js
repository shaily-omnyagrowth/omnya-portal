import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fmtCompactNum } from "../utils";

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setW(el.clientWidth);
    let raf = 0;
    const ro = new ResizeObserver(([e]) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setW(Math.round(e.contentRect.width)));
    });
    ro.observe(el);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);
  return [ref, w];
}

const keyOf = (data) => data.map(d => `${d.label}:${d.value}`).join("|");

const niceMax = (v) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
};

function Tooltip({ x, y, w, children }) {
  const left = Math.min(Math.max(x, 70), w - 70);
  return (
    <div className="chart-tip" style={{ left, top: y }} role="presentation">{children}</div>
  );
}

// Area/line chart. data: [{ label, value }] in order.
export function AreaChart({ data, height = 220, format = fmtCompactNum, formatLabel = (l) => l, ariaLabel, color = "var(--viz-1)", showArea = true }) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState(null);
  const gid = useId().replace(/:/g, "");
  const pad = { t: 12, r: 12, b: 26, l: 44 };
  const iw = Math.max(0, w - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const max = niceMax(Math.max(0, ...data.map(d => d.value || 0)));
  const xs = (i) => pad.l + (data.length <= 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const ys = (v) => pad.t + ih - (Math.max(0, v || 0) / max) * ih;

  const { line, area } = useMemo(() => {
    if (!data.length || !iw) return { line: "", area: "" };
    const pts = data.map((d, i) => [xs(i), ys(d.value)]);
    const l = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
    return { line: l, area: `${l}L${pts[pts.length - 1][0].toFixed(1)},${pad.t + ih}L${pts[0][0].toFixed(1)},${pad.t + ih}Z` };
  }, [data, iw, max]); // eslint-disable-line react-hooks/exhaustive-deps

  const ticks = [0, 0.5, 1].map(f => f * max);
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(iw / 72))));

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const i = Math.round(((x - pad.l) / Math.max(1, iw)) * (data.length - 1));
    setHover(Math.min(data.length - 1, Math.max(0, i)));
  };

  return (
    <div ref={ref} className="chart" style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={ariaLabel}
          onPointerMove={onMove} onPointerLeave={() => setHover(null)} onPointerDown={onMove} style={{ touchAction: "pan-y" }}>
          <defs>
            <linearGradient id={`g${gid}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.14" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map(t => (
            <g key={t}>
              <line x1={pad.l} x2={w - pad.r} y1={ys(t)} y2={ys(t)} stroke="var(--viz-grid)" strokeDasharray={t ? "3 4" : undefined} />
              <text x={pad.l - 8} y={ys(t)} dy="0.32em" textAnchor="end" className="chart-axis">{format(t)}</text>
            </g>
          ))}
          {data.map((d, i) => ((i % labelEvery === 0 && data.length - 1 - i >= labelEvery * 0.6) || i === data.length - 1) && (
            <text key={i} x={xs(i)} y={height - 6} textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"} className="chart-axis">{formatLabel(d.label)}</text>
          ))}
          <g style={{ color }} key={keyOf(data)}>
            {showArea && <path d={area} fill={`url(#g${gid})`} className="chart-area" />}
            <path d={line} pathLength="1" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" className="chart-line" />
            {data.length === 1 && <circle cx={xs(0)} cy={ys(data[0].value)} r="3.5" fill="currentColor" />}
          </g>
          {hover != null && data[hover] && (
            <g>
              <line x1={xs(hover)} x2={xs(hover)} y1={pad.t} y2={pad.t + ih} stroke="var(--border-strong)" />
              <circle cx={xs(hover)} cy={ys(data[hover].value)} r="4" fill="var(--surface)" stroke={color} strokeWidth="2" />
            </g>
          )}
        </svg>
      )}
      {hover != null && data[hover] && (
        <Tooltip x={xs(hover)} y={ys(data[hover].value)} w={w}>
          <span className="chart-tip-label">{formatLabel(data[hover].label, true)}</span>
          <strong>{format(data[hover].value, true)}</strong>
        </Tooltip>
      )}
      <ul className="sr-only">{data.map((d, i) => <li key={i}>{formatLabel(d.label, true)}: {format(d.value, true)}</li>)}</ul>
    </div>
  );
}

// Vertical bars. data: [{ label, value, tone? }]
export function BarChart({ data, height = 200, format = fmtCompactNum, ariaLabel }) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState(null);
  const pad = { t: 12, r: 8, b: 26, l: 44 };
  const iw = Math.max(0, w - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const max = niceMax(Math.max(0, ...data.map(d => d.value || 0)));
  const slot = data.length ? iw / data.length : 0;
  const bw = Math.min(36, slot * 0.62);
  const ys = (v) => pad.t + ih - (Math.max(0, v || 0) / max) * ih;

  return (
    <div ref={ref} className="chart" style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={ariaLabel} onPointerLeave={() => setHover(null)}>
          {[0, 0.5, 1].map(f => (
            <g key={f}>
              <line x1={pad.l} x2={w - pad.r} y1={ys(f * max)} y2={ys(f * max)} stroke="var(--viz-grid)" strokeDasharray={f ? "3 4" : undefined} />
              <text x={pad.l - 8} y={ys(f * max)} dy="0.32em" textAnchor="end" className="chart-axis">{format(f * max)}</text>
            </g>
          ))}
          <g key={keyOf(data)}>
          {data.map((d, i) => {
            const x = pad.l + slot * i + (slot - bw) / 2;
            const y = ys(d.value);
            return (
              <g key={i} onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)}>
                <rect x={pad.l + slot * i} y={pad.t} width={slot} height={ih} fill="transparent" />
                <rect x={x} y={y} width={bw} height={Math.max(0, pad.t + ih - y)} rx="3"
                  fill={d.tone || (hover === i ? "var(--ink)" : "var(--viz-2)")} className="chart-bar" style={{ transformOrigin: `0 ${pad.t + ih}px`, animationDelay: `${Math.min(i * 30, 360)}ms` }} />
                <text x={x + bw / 2} y={height - 6} textAnchor="middle" className="chart-axis">{d.label}</text>
              </g>
            );
          })}
          </g>
        </svg>
      )}
      {hover != null && data[hover] && (
        <Tooltip x={pad.l + slot * hover + slot / 2} y={ys(data[hover].value)} w={w}>
          <span className="chart-tip-label">{data[hover].fullLabel || data[hover].label}</span>
          <strong>{format(data[hover].value, true)}</strong>
        </Tooltip>
      )}
      <ul className="sr-only">{data.map((d, i) => <li key={i}>{d.fullLabel || d.label}: {format(d.value, true)}</li>)}</ul>
    </div>
  );
}

export function Sparkline({ values, width = 96, height = 28, color = "var(--ink)", ariaLabel }) {
  const gid = useId().replace(/:/g, "");
  if (!values || values.length < 2) return <span style={{ display: "inline-block", width, height }} aria-hidden="true" />;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * width, height - 2 - ((v - min) / (max - min || 1)) * (height - 4)]);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  return (
    <svg width={width} height={height} role={ariaLabel ? "img" : undefined} aria-label={ariaLabel} aria-hidden={ariaLabel ? undefined : true} style={{ color, overflow: "visible" }}>
      <defs>
        <linearGradient id={`s${gid}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.16" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d}L${width},${height}L0,${height}Z`} fill={`url(#s${gid})`} />
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Thin horizontal share bars, for breakdowns like views by platform.
export function ShareBars({ items, format = fmtCompactNum }) {
  const total = items.reduce((a, i) => a + (i.value || 0), 0) || 1;
  return (
    <div className="share-bars">
      {items.map(i => (
        <div key={i.label} className="share-row">
          <span className="share-label">{i.label}</span>
          <span className="share-track"><span className="share-fill" style={{ width: `${((i.value || 0) / total) * 100}%`, background: i.color }} /></span>
          <span className="share-val">{format(i.value || 0)}</span>
        </div>
      ))}
    </div>
  );
}
