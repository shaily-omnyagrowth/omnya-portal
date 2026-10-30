import { useMemo, useRef, useState } from "react";
import { ChartBarLineIcon } from "@hugeicons/core-free-icons";
import VideoMetricsPanel from "../../components/VideoMetricsPanel";
import { Sparkline } from "../../ui/charts";
import EmptyState from "../../ui/EmptyState";
import PageHeader from "../../ui/PageHeader";
import VideoThumb from "../../ui/VideoThumb";
import { engagementRate, fmtCompactNum, fmtDate, fmtPct, platformMeta, viewsOf } from "../../utils";

const LIVE = new Set(["Approved", "Published/Tracked"]);
const checkpoints = s => ["views_24h", "views_72h", "views_1w", "views_2w", "views_1m"].map(k => s[k]).filter(v => v != null).map(Number);

export default function CreatorInsights({ user, db, onNavigate }) {
  const creator = db.creators.find(c => c.user_id === user.id || c.email === user.email);
  const analyticsBySub = useMemo(() => Object.fromEntries((db.analytics || []).filter(a => a.submission_id).map(a => [a.submission_id, a])), [db.analytics]);
  const videos = useMemo(() => (creator ? db.submissions.filter(s => s.creator_id === creator.id && LIVE.has(s.status)) : [])
    .map(s => ({ ...s, _views: viewsOf(s, analyticsBySub[s.id]) }))
    .sort((a, b) => new Date(b.posted_at || b.approved_date || b.created_at) - new Date(a.posted_at || a.approved_date || a.created_at)), [creator, db.submissions, analyticsBySub]);
  const [selected, setSelected] = useState(null);
  const panelRef = useRef(null);
  const sub = videos.find(v => v.id === selected) || videos[0];
  const campaignName = id => db.campaigns.find(c => c.id === id)?.name;

  if (videos.length === 0) {
    return (
      <div className="content">
        <PageHeader title="Video insights" description="How your approved videos are performing over time." />
        <div className="card">
          <EmptyState icon={ChartBarLineIcon} title="No live videos yet" action={onNavigate && <button className="btn btn-primary btn-sm" onClick={() => onNavigate("submit")}>Submit a video</button>}>
            Once a final video is approved and posted, its views, likes and growth show up here.
          </EmptyState>
        </div>
      </div>
    );
  }

  const totalViews = videos.reduce((a, v) => a + v._views, 0);
  const totals = videos.reduce((a, v) => ({ likes: a.likes + Number(v.likes || 0), comments: a.comments + Number(v.comments || 0), shares: a.shares + Number(v.shares || 0) }), { likes: 0, comments: 0, shares: 0 });
  const best = videos.reduce((m, v) => (v._views > (m?._views || 0) ? v : m), null);

  const pick = (id) => {
    setSelected(id);
    if (window.matchMedia("(max-width: 960px)").matches) panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="content">
      <PageHeader title="Video insights" description="How your approved videos are performing. Pick a video to see its growth." />
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">Total views</div><div className="stat-value">{fmtCompactNum(totalViews)}</div><div className="stat-sub">across {videos.length} live {videos.length === 1 ? "video" : "videos"}</div></div>
        <div className="stat-card"><div className="stat-label">Average per video</div><div className="stat-value">{fmtCompactNum(totalViews / videos.length)}</div></div>
        <div className="stat-card"><div className="stat-label">Engagement rate</div><div className="stat-value">{fmtPct(engagementRate({ views: totalViews, ...totals }))}</div><div className="stat-sub">likes, comments and shares per view</div></div>
        <div className="stat-card"><div className="stat-label">Best video</div><div className="stat-value">{fmtCompactNum(best?._views)}</div><div className="stat-sub truncate">{campaignName(best?.campaign_id) || "Campaign"}</div></div>
      </div>

      <div className="insights-layout">
        <div className="card flush" role="listbox" aria-label="Your live videos">
          {videos.map(v => {
            const active = sub?.id === v.id;
            const p = platformMeta(v.platform);
            return (
              <button key={v.id} role="option" aria-selected={active} className={`video-row ${active ? "active" : ""}`} onClick={() => pick(v.id)}>
                <VideoThumb sub={v} width={40} />
                <span className="flex-1" style={{ textAlign: "left" }}>
                  <span className="fw-600 fs-13 truncate" style={{ display: "block" }}>{campaignName(v.campaign_id) || "Campaign"}</span>
                  <span className="fs-12 text-muted truncate" style={{ display: "block" }}>{p.name} · {fmtDate(v.posted_at || v.approved_date)}</span>
                </span>
                <span className="text-right" style={{ flexShrink: 0 }}>
                  <span className="fw-600 fs-13 tnum" style={{ display: "block" }}>{fmtCompactNum(v._views)}</span>
                  <Sparkline values={checkpoints(v)} width={56} height={18} color={active ? "var(--ink)" : "var(--ink4)"} />
                </span>
              </button>
            );
          })}
        </div>
        <div ref={panelRef} style={{ scrollMarginTop: 72 }}>
          {sub && <VideoMetricsPanel key={sub.id} sub={sub} analytics={analyticsBySub[sub.id]} campaignName={campaignName(sub.campaign_id)} />}
        </div>
      </div>
    </div>
  );
}
