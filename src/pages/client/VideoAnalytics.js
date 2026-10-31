import { useCallback, useEffect, useMemo, useState } from "react";
import { ChartBarLineIcon } from "@hugeicons/core-free-icons";
import { gooeyToast as toast } from "goey-toast";
import { supabase } from "../../supabaseClient";
import Alert from "../../ui/Alert";
import EmptyState from "../../ui/EmptyState";
import Icon from "../../ui/Icon";
import Select from "../../ui/Select";
import { SkeletonStats, SkeletonTable } from "../../ui/Skeleton";
import { EMPTY, fmtCompactNum, fmtDate, fmtNum, fmtRelativeTime, platformMeta } from "../../utils";
import usePagination from "../../ui/Pagination";

const PLATFORMS = [["all", "All platforms"], ["tiktok", "TikTok"], ["instagram", "Instagram"], ["youtube", "YouTube"], ["facebook", "Facebook"]];

const rate = (m) => {
  if (Number(m.engagement_rate) > 0) return `${Number(m.engagement_rate).toFixed(2)}%`;
  const v = Number(m.views) || 0;
  if (!v) return EMPTY;
  const e = ["likes", "comments"].reduce((t, k) => t + (Number(m[k]) || 0), 0);
  return `${((e / v) * 100).toFixed(2)}%`;
};

const linkFor = (m) => {
  if (/^https?:\/\//.test(m.video_url || "")) return m.video_url;
  if (!m.video_id) return null;
  return { youtube: `https://www.youtube.com/watch?v=${m.video_id}`, instagram: `https://www.instagram.com/p/${m.video_id}/`, tiktok: `https://www.tiktok.com/video/${m.video_id}`, facebook: `https://www.facebook.com/${m.video_id}` }[m.platform] || null;
};

// Per video metrics; clients read client_safe_analytics, staff read video_analytics.
export default function VideoAnalytics({ campaignId = null, isClient = true }) {
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState("");
  const [platform, setPlatform] = useState("all");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError("");
    let q = supabase.from(isClient ? "client_safe_analytics" : "video_analytics").select("*").order("pulled_at", { ascending: false });
    if (campaignId) q = q.eq("campaign_id", campaignId);
    const { data, error: e } = await q;
    if (e) { setError(e.code === "42703" ? "A database update is still pending, so video metrics can't load yet. Please contact your account manager." : e.message); setMetrics([]); return; }
    setMetrics(data || []);
  }, [campaignId, isClient]);

  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => (metrics || []).filter(m => platform === "all" || (m.platform || "").toLowerCase() === platform), [metrics, platform]);
  const totals = useMemo(() => shown.reduce((t, m) => ({ views: t.views + (Number(m.views) || 0), likes: t.likes + (Number(m.likes) || 0), comments: t.comments + (Number(m.comments) || 0) }), { views: 0, likes: 0, comments: 0 }), [shown]);
  const { rows: page, pager } = usePagination(shown, { label: "videos" });

  const refresh = async () => {
    setRefreshing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Your session has expired. Sign in again.");
      const res = await fetch("/api/analytics/manual-sync", {
        method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify(platform === "all" ? {} : { platform }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error?.message || "The platforms didn't respond. Try again in a few minutes.");
      const { updated = 0, failed = 0, processed = 0 } = json.data || {};
      (failed ? toast.warning : toast.success)(`Refreshed ${updated} of ${processed} videos`, failed ? { description: `${failed} couldn't be reached. They'll retry on the next sync.` } : undefined);
      await load();
    } catch (err) {
      toast.error("Metrics weren't refreshed", { description: err.message });
    } finally {
      setRefreshing(false);
    }
  };

  if (!metrics) return <><SkeletonStats /><SkeletonTable rows={5} cols={6} /></>;
  const synced = shown[0]?.pulled_at;

  return (
    <div className="flex-col gap-16">
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <label className="toolbar-field"><span className="sr-only">Platform</span>
          <Select className="select" aria-label="Platform" value={platform} onChange={e => setPlatform(e.target.value)}>{PLATFORMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        </label>
        <span className="fs-12 text-muted">{synced ? `Synced ${fmtRelativeTime(synced)}` : "Not synced yet"}</span>
        <button className="btn btn-secondary btn-sm" style={{ marginLeft: "auto" }} onClick={refresh} disabled={refreshing}>{refreshing ? "Refreshing…" : "Refresh metrics"}</button>
      </div>
      {error && <Alert tone="warning" title="Metrics are unavailable right now">{error}</Alert>}
      {!error && <div className="stats-grid" style={{ marginBottom: 0 }}>
        <div className="stat-card stat-highlight"><div className="stat-label">Views</div><div className="stat-value">{fmtCompactNum(totals.views)}</div><div className="stat-sub">{shown.length} {shown.length === 1 ? "video" : "videos"}</div></div>
        <div className="stat-card"><div className="stat-label">Likes</div><div className="stat-value">{fmtCompactNum(totals.likes)}</div></div>
        <div className="stat-card"><div className="stat-label">Comments</div><div className="stat-value">{fmtCompactNum(totals.comments)}</div></div>
      </div>}
      {shown.length === 0 ? (
        !error && <div className="card"><EmptyState icon={ChartBarLineIcon} title={metrics.length ? "No videos on this platform" : "No metrics yet"}
          action={metrics.length ? <button className="btn btn-secondary btn-sm" onClick={() => setPlatform("all")}>Show all platforms</button> : undefined}>
          {metrics.length ? "Pick another platform to see its videos." : "Metrics sync every 12 hours once a video is live. Use Refresh metrics to pull them now."}
        </EmptyState></div>
      ) : (
        <>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Video</th><th className="num">Views</th><th className="num">Likes</th><th className="num">Comments</th><th className="num">Engagement</th><th>Synced</th></tr></thead>
            <tbody>
              {page.map(m => {
                const p = platformMeta(m.platform);
                const href = linkFor(m);
                return (
                  <tr key={m.id || m.analytics_id || `${m.platform}-${m.video_id}`}>
                    <td><span className="flex-center gap-8"><Icon icon={p.icon} size={15} />{href ? <a className="link truncate" style={{ maxWidth: 240 }} href={href} target="_blank" rel="noreferrer">{p.name} video</a> : <span>{p.name} video</span>}</span></td>
                    <td className="num fw-600 text-ink">{fmtNum(m.views)}</td>
                    <td className="num">{fmtNum(m.likes)}</td>
                    <td className="num">{fmtNum(m.comments)}</td>
                    <td className="num">{rate(m)}</td>
                    <td className="text-muted">{m.pulled_at ? fmtDate(m.pulled_at) : EMPTY}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {pager}
        </>
      )}
    </div>
  );
}
