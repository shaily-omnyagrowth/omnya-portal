import { useMemo } from "react";
import { ArrowLeft01Icon, Video01Icon } from "@hugeicons/core-free-icons";
import PostCard from "../../components/posts/PostCard";
import EmptyState from "../../ui/EmptyState";
import Icon from "../../ui/Icon";
import { EMPTY, calcPacing, daysLeftLabel, fmtCompactNum, fmtDate, fmtNum, platformKey, platformMeta, statusBadge, viewsOf } from "../../utils";
import VideoAnalytics from "./VideoAnalytics";

const LIVE = new Set(["Approved", "Published/Tracked"]);

export default function CampaignDetail({ campaign, clientProfile, submissions, analytics, creators, onBack }) {
  const subs = useMemo(() => submissions.filter(s => s.campaign_id === campaign.id && LIVE.has(s.status)), [submissions, campaign.id]);
  const latest = useMemo(() => {
    const map = {};
    (analytics || []).forEach(a => { const id = a.submission_id; if (id && (!map[id] || new Date(a.pulled_at || 0) > new Date(map[id].pulled_at || 0))) map[id] = a; });
    return map;
  }, [analytics]);

  const posts = subs.map(s => {
    const a = latest[s.id];
    const likes = Number(a?.likes ?? s.likes ?? 0), comments = Number(a?.comments ?? s.comments ?? 0), shares = Number(a?.shares ?? s.shares ?? 0);
    const views = viewsOf(s, a);
    return {
      ...s, views, likes, comments, shares, engRate: views ? ((likes + comments + shares) / views) * 100 : null,
      platformKey: platformKey(s.platform), date: s.created_at, postUrl: s.posted_link || s.posted_url || null,
      creatorName: s.creator_name || creators.find(c => c.id === s.creator_id)?.name || "Creator", campaignName: campaign.name,
    };
  }).sort((a, b) => b.views - a.views);

  const views = posts.reduce((t, p) => t + p.views, 0);
  const engaged = posts.reduce((t, p) => t + p.likes + p.comments + p.shares, 0);
  const needed = campaign.videos_needed || 10;
  const pacing = calcPacing({ startDate: campaign.start_date || campaign.created_at, deadline: campaign.deadline, videosNeeded: needed, approvedCount: subs.length });
  // CPM uses the client's own budget (their clients row); with no budget or no views there is no CPM.
  const budget = Number(clientProfile?.budget || 0);
  const cpm = budget > 0 && views > 0 ? (budget / views) * 1000 : null;
  const p = platformMeta(campaign.format);

  return (
    <div className="flex-col gap-24">
      <div>
        <button className="btn btn-ghost btn-sm" style={{ marginLeft: -12 }} onClick={onBack}><Icon icon={ArrowLeft01Icon} size={16} />All campaigns</button>
      </div>
      <header className="page-header" style={{ marginBottom: 0 }}>
        <div className="min-w-0">
          <div className="flex-center gap-8 mb-4">{statusBadge(campaign.status)}<span className="fs-13 text-muted flex-center gap-4"><Icon icon={p.icon} size={14} />{campaign.format || p.name}</span></div>
          <h1 className="break-anywhere">{campaign.name}</h1>
          <p>Started {fmtDate(campaign.start_date || campaign.created_at)} · {needed} videos planned</p>
        </div>
        {campaign.brief_url && <div className="page-actions"><a className="btn btn-secondary" href={campaign.brief_url} target="_blank" rel="noreferrer">Open the brief</a></div>}
      </header>

      <section className="card">
        <div className="flex-between mb-8">
          <span className="camp-count"><strong>{subs.length}</strong> of {needed} videos delivered</span>
          <span className="fs-13 fw-600 tnum">{pacing.deliveryPct}%</span>
        </div>
        <div className="progress-bar"><div className="progress-fill" style={{ width: `${Math.min(100, pacing.deliveryPct)}%`, background: pacing.deliveryPct >= 100 ? "var(--green)" : pacing.paceStatus === "behind" || pacing.paceStatus === "overdue" ? "var(--amber)" : "var(--ink)" }} /></div>
        <div className="fs-12 text-muted mt-8">{pacing.paceLabel}{pacing.paceStatus !== "overdue" && campaign.deadline ? ` · ${daysLeftLabel(campaign.deadline)}` : ""}</div>
      </section>

      <div className="stats-grid" style={{ marginBottom: 0 }}>
        <div className="stat-card stat-highlight"><div className="stat-label">Views</div><div className="stat-value">{fmtCompactNum(views)}</div><div className="stat-sub">{fmtNum(views)} verified</div></div>
        <div className="stat-card"><div className="stat-label">Engagements</div><div className="stat-value">{fmtCompactNum(engaged)}</div><div className="stat-sub">likes, comments and shares</div></div>
        <div className="stat-card"><div className="stat-label">Engagement rate</div><div className="stat-value">{views ? `${((engaged / views) * 100).toFixed(1)}%` : EMPTY}</div><div className="stat-sub">engagements per view</div></div>
        {campaign.show_client_cpm && <div className="stat-card"><div className="stat-label" data-tip="Your budget divided by verified views, per thousand">Cost per 1,000 views</div><div className="stat-value">{cpm != null ? `$${cpm.toFixed(2)}` : EMPTY}</div><div className="stat-sub">{views ? `on ${fmtCompactNum(views)} views` : "waiting for first views"}</div></div>}
      </div>

      <section>
        <h2 className="section-title">Delivered videos</h2>
        {posts.length ? <div className="post-grid">{posts.map(post => <PostCard key={post.id} post={post} />)}</div>
          : <div className="card"><EmptyState icon={Video01Icon} title="No videos delivered yet">Approved videos show up here with their live performance.</EmptyState></div>}
      </section>

      <section>
        <h2 className="section-title">Video metrics</h2>
        <VideoAnalytics campaignId={campaign.id} />
      </section>
    </div>
  );
}
