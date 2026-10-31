import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { supabase } from "../supabaseClient";
import { AreaChart } from "../ui/charts";
import Icon from "../ui/Icon";
import Segmented from "../ui/Segmented";
import { engagementRate, fmtCompactNum, fmtDate, fmtNum, fmtPct, platformMeta, viewsOf } from "../utils";

const CHECKPOINTS = [["views_24h", "24h", 1], ["views_72h", "72h", 3], ["views_1w", "1 week", 7], ["views_2w", "2 weeks", 14], ["views_1m", "1 month", 30]];

// Daily snapshots for a TikTok video synced through the creator's login, when there are any.
function useSnapshots(sub) {
  const [rows, setRows] = useState(null);
  const link = sub?.posted_link || sub?.posted_url;
  useEffect(() => {
    let cancelled = false;
    setRows(null);
    if (!link) { setRows([]); return undefined; }
    (async () => {
      const { data: vids } = await supabase.from("creator_videos").select("id").eq("video_url", link).limit(1);
      const id = vids?.[0]?.id;
      if (!id) { if (!cancelled) setRows([]); return; }
      const { data } = await supabase.from("video_metrics").select("snapshot_at,view_count,like_count").eq("video_id", id).order("snapshot_at", { ascending: true }).limit(200);
      if (!cancelled) setRows(data || []);
    })().catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [link]);
  return rows;
}

export default function VideoMetricsPanel({ sub, analytics, campaignName }) {
  const snapshots = useSnapshots(sub);
  const [metric, setMetric] = useState("views");
  const views = viewsOf(sub, analytics);
  const likes = Number(analytics?.likes ?? sub.likes ?? 0);
  const comments = Number(analytics?.comments ?? sub.comments ?? 0);
  const er = engagementRate({ views, likes, comments });
  const link = sub.posted_link || sub.posted_url;
  const p = platformMeta(sub.platform);

  const series = useMemo(() => {
    if (snapshots && snapshots.length > 1) {
      return snapshots.map(r => ({ label: r.snapshot_at, value: Number(metric === "views" ? r.view_count : r.like_count) || 0 }));
    }
    const pts = CHECKPOINTS.filter(([k]) => sub[k] != null).map(([k, label]) => ({ label, value: Number(sub[k]) }));
    return pts.length ? [{ label: "Posted", value: 0 }, ...pts] : [];
  }, [snapshots, sub, metric]);
  const fromSnapshots = snapshots && snapshots.length > 1;

  const tiles = [
    ["Views", fmtNum(views)], ["Likes", fmtNum(likes)], ["Comments", fmtNum(comments)], ["Engagement", fmtPct(er)],
  ];

  return (
    <section className="card card-stacked">
      <div className="card-head">
        <div style={{ minWidth: 0 }}>
          <h2 className="card-title truncate">{campaignName || "Video performance"}</h2>
          <p className="card-desc">
            <Icon icon={p.icon} size={12} style={{ display: "inline", verticalAlign: "-2px", marginRight: 4 }} />
            {p.name}{sub.posted_at || sub.approved_date ? ` · posted ${fmtDate(sub.posted_at || sub.approved_date)}` : ""}
            {analytics?.pulled_at ? ` · synced ${fmtDate(analytics.pulled_at)}` : ""}
          </p>
        </div>
        {link && <a className="btn btn-secondary btn-sm" href={link} target="_blank" rel="noreferrer">Open video<Icon icon={ArrowUpRight01Icon} size={14} /></a>}
      </div>

      <div className="metrics-row mb-24">
        {tiles.map(([label, value]) => (
          <div key={label} className="metric-mini"><div className="metric-mini-val">{value}</div><div className="metric-mini-label">{label}</div></div>
        ))}
      </div>

      <div className="flex-between mb-12">
        <div>
          <div className="fw-600 fs-14">Growth over time</div>
          <div className="fs-12 text-muted">{fromSnapshots ? "Daily snapshots from your connected account." : "Views at each checkpoint after posting."}</div>
        </div>
        {fromSnapshots && <Segmented label="Metric" value={metric} onChange={setMetric} options={[["views", "Views"], ["likes", "Likes"]]} />}
      </div>
      {series.length > 1 ? (
        <AreaChart
          data={series}
          height={200}
          ariaLabel={`${metric} over time`}
          formatLabel={(l, long) => (fromSnapshots ? new Date(l).toLocaleDateString("en-US", long ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" }) : l)}
          format={(v, long) => (long ? fmtNum(v) : fmtCompactNum(v))}
        />
      ) : (
        <div className="empty" style={{ padding: "32px 16px", background: "var(--surface2)", borderRadius: "var(--radius)" }}>
          <p>No checkpoints yet. Views are recorded 24 hours, 3 days and a week after the video goes live.</p>
        </div>
      )}
    </section>
  );
}
