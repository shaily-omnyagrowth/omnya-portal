import { useState } from "react";
import { platformMeta } from "../utils";
import Icon from "./Icon";

const youtubeId = (link = "") => (link.match(/(?:[?&]v=|youtu\.be\/|youtube\.com\/(?:shorts|live|embed)\/)([A-Za-z0-9_-]{6,})/) || [])[1];

export const thumbFor = (sub) => {
  const link = sub?.posted_link || sub?.posted_url || sub?.video_url || "";
  const yt = youtubeId(link);
  return sub?.thumbnail_url || (yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : null);
};

export default function VideoThumb({ sub, width = 48, ratio = 4 / 3, radius = 8, platform, fluid = false }) {
  const [failed, setFailed] = useState(false);
  const src = thumbFor(sub);
  const p = platformMeta(platform || sub?.platform);
  const size = fluid ? { width: "100%", aspectRatio: `1 / ${ratio}` } : { width, height: Math.round(width * ratio) };
  const style = { ...size, borderRadius: radius, flexShrink: 0, background: "var(--bg2)", overflow: "hidden", display: "grid", placeItems: "center", color: "var(--ink3)" };
  if (!src || failed) return <span style={style} aria-hidden="true">{fluid ? <span className="thumb-empty"><Icon icon={p.icon} size={20} /></span> : <Icon icon={p.icon} size={Math.max(14, Math.round(width / 3))} />}</span>;
  return (
    <span style={style}>
      <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} onLoad={e => { if (e.currentTarget.naturalWidth <= 120) setFailed(true); }} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </span>
  );
}
