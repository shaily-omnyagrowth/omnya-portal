import { useEffect, useState } from 'react';
import { LockIcon, Video01Icon } from '@hugeicons/core-free-icons';
import PostCard from '../components/posts/PostCard';
import EmptyState from '../ui/EmptyState';
import Icon from '../ui/Icon';
import { SkeletonStats, SkeletonCards } from '../ui/Skeleton';
import { fmtCompactNum, fmtDate, fmtNum, getInitials, platformKey, platformMeta, statusBadge } from '../utils';

const PACE = { completed: ['Delivered', 'text-green'], ahead: ['Ahead of pace', 'text-green'], behind: ['Behind pace', 'text-amber'], on_track: ['On track', 'text-muted'] };

function Bar({ clientName }) {
  return (
    <header className="report-bar">
      <a href="/" className="sidebar-logo"><img src="/brand/mark.png" alt="" width="20" height="26" /><span className="sidebar-logo-text">Omnya</span></a>
      {clientName && <span className="fs-13 text-muted truncate">Performance report for <strong className="text-ink">{clientName}</strong></span>}
    </header>
  );
}

export default function SharedCampaignReport() {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token') || params.get('share_token');
    if (!token) { setState({ error: "This link is missing its share code. Ask whoever sent it for a fresh link." }); return; }
    fetch(`/api/campaigns/share-report?token=${encodeURIComponent(token)}`)
      .then(r => r.json().then(j => ({ ok: r.ok, j })).catch(() => ({ ok: false, j: {} })))
      .then(({ ok, j }) => {
        if (!ok || !j.ok) throw new Error(j.error?.message || 'This report was turned off or the link has expired. Ask your account manager for a new one.');
        setState({ report: j.data });
      })
      .catch(e => setState({ error: e.message === 'Failed to fetch' ? "We couldn't reach Omnya. Check your connection and reload." : e.message }));
  }, []);

  useEffect(() => { if (state.report) document.title = `${state.report.campaign.name} | Omnya report`; }, [state.report]);

  if (state.loading) {
    return <div className="report"><Bar /><main className="report-main" aria-busy="true"><SkeletonStats /><SkeletonCards count={4} h={300} /></main></div>;
  }
  if (state.error) {
    return (
      <div className="report"><Bar />
        <main className="report-main"><div className="card"><EmptyState icon={LockIcon} title="This report isn't available" action={<a href="/" className="btn btn-secondary btn-sm">Go to Omnya</a>}>{state.error}</EmptyState></div></main>
      </div>
    );
  }

  const { campaign, clientName, stats, timeline, posts, creators } = state.report;
  const p = platformMeta(campaign.format);
  const [paceLabel, paceTone] = PACE[timeline.paceStatus] || PACE.on_track;
  const days = timeline.daysRemaining;
  const when = days == null ? null : days > 0 ? `${days} ${days === 1 ? 'day' : 'days'} left` : days === 0 ? 'Ends today' : `Ended ${fmtDate(campaign.deadline)}`;
  const cards = posts.map(x => ({
    ...x, platformKey: platformKey(x.platform), date: x.approved_date, postUrl: x.posted_link,
    engRate: Number(x.engagementRate), campaignName: campaign.name,
  }));

  return (
    <div className="report">
      <Bar clientName={clientName} />
      <main className="report-main">
        <header className="page-header">
          <div className="min-w-0">
            <div className="flex-center gap-8 mb-4">{statusBadge(campaign.status)}<span className="fs-13 text-muted flex-center gap-4"><Icon icon={p.icon} size={14} />{campaign.format || p.name}</span></div>
            <h1 className="break-anywhere">{campaign.name}</h1>
            {campaign.description && <p>{campaign.description}</p>}
          </div>
          {campaign.brief_url && <div className="page-actions"><a className="btn btn-secondary" href={campaign.brief_url} target="_blank" rel="noreferrer noopener">Open the brief</a></div>}
        </header>

        <section className="card mb-16">
          <div className="flex-between mb-8">
            <span className="camp-count"><strong>{stats.deliveredPosts}</strong> of {stats.targetPosts} videos delivered</span>
            <span className="fs-13 fw-600 tnum">{stats.deliveryPct}%</span>
          </div>
          <div className="progress-bar"><div className="progress-fill" style={{ width: `${Math.min(100, stats.deliveryPct)}%`, background: stats.deliveryPct >= 100 ? 'var(--green)' : 'var(--ink)' }} /></div>
          <div className="fs-12 mt-8"><span className={`fw-550 ${paceTone}`}>{paceLabel}</span><span className="text-muted"> · week {timeline.currentWeek} of {timeline.totalWeeks}{when ? ` · ${when}` : ''}</span></div>
        </section>

        <div className="stats-grid">
          <div className="stat-card stat-highlight"><div className="stat-label">Views</div><div className="stat-value">{fmtCompactNum(stats.totalViews)}</div><div className="stat-sub">{fmtNum(stats.totalViews)} verified</div></div>
          <div className="stat-card"><div className="stat-label">Engagement rate</div><div className="stat-value">{stats.engagementRate}%</div><div className="stat-sub">{fmtCompactNum(stats.totalEngagements)} interactions</div></div>
          <div className="stat-card"><div className="stat-label">Likes and comments</div><div className="stat-value">{fmtCompactNum(stats.totalLikes + stats.totalComments)}</div><div className="stat-sub">{fmtCompactNum(stats.totalLikes)} likes · {fmtCompactNum(stats.totalComments)} comments</div></div>
          <div className="stat-card"><div className="stat-label">Shares and saves</div><div className="stat-value">{fmtCompactNum(stats.totalShares + stats.totalSaves)}</div><div className="stat-sub">{fmtCompactNum(stats.totalShares)} shares · {fmtCompactNum(stats.totalSaves)} saves</div></div>
        </div>

        <section className="section">
          <h2 className="section-title">Delivered videos</h2>
          {cards.length ? <div className="post-grid">{cards.map(post => <PostCard key={post.id} post={post} />)}</div>
            : <div className="card"><EmptyState icon={Video01Icon} title="No videos delivered yet">Videos appear here with live views as soon as they're approved and posted.</EmptyState></div>}
        </section>

        {creators.length > 0 && (
          <section className="section">
            <h2 className="section-title">Creators on this campaign</h2>
            <div className="report-creators">
              {creators.map(c => (
                <div key={c.id} className="report-creator">
                  <span className="avatar">{getInitials(c.name)}</span>
                  <span className="min-w-0"><span className="fw-600 text-ink truncate" style={{ display: 'block' }}>{c.name}</span>
                    <span className="fs-12 text-muted truncate" style={{ display: 'block' }}>{c.tiktok_handle ? `@${c.tiktok_handle}` : c.instagram_handle ? `@${c.instagram_handle}` : 'Creator'}</span></span>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
      <footer className="public-footer"><span>Verified from each platform by Omnya Growth</span><a href="/privacy">Privacy</a><a href="/terms">Terms</a></footer>
    </div>
  );
}
