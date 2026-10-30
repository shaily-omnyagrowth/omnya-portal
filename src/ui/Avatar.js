const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.2' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.28 0'/%3E%3C/filter%3E%3Crect width='64' height='64' filter='url(%23n)'/%3E%3C/svg%3E\")";

const hash = (s) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0), 16777619); return h >>> 0; };

// Seeded black and white light blobs, so each name keeps the same gradient.
export function gradientFor(seed) {
  let h = hash(String(seed || "?"));
  const next = (min, max) => { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; return min + (h % (max - min + 1)); };
  const blob = (tone, alpha, size) => `radial-gradient(${next(50, 95)}% ${next(30, 70)}% at ${next(10, 90)}% ${next(10, 90)}%, rgba(${tone},${tone},${tone},${alpha}) 0%, rgba(${tone},${tone},${tone},0) ${size}%)`;
  return `${GRAIN}, ${blob(255, 0.95, next(50, 70))}, ${blob(next(120, 200), 0.8, next(50, 75))}, ${blob(90, 0.6, 70)}, linear-gradient(#000, #000)`;
}

export default function Avatar({ name, size, className = "" }) {
  return <span className={`avatar ${className}`.trim()} aria-hidden="true" style={{ backgroundImage: gradientFor(name), ...(size ? { width: size, height: size } : null) }} />;
}
