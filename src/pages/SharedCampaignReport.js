import React, { useState, useEffect } from 'react';
import LoadingSpinner from '../components/LoadingSpinner';
import TopPostsShowcase from '../components/TopPostsShowcase';
import PostsGalleryView from '../components/PostsGalleryView';
import { fmtCompactNum, fmtNum, platformMeta, getAvatarColor, getInitials } from '../utils';

export default function SharedCampaignReport() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [report, setReport] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token') || params.get('share_token');

    if (!token) {
      setError('Missing share token. Please check your link.');
      setLoading(false);
      return;
    }

    async function fetchReport() {
      try {
        const res = await fetch(`/api/campaigns/share-report?token=${encodeURIComponent(token)}`);
        const json = await res.json().catch(() => ({}));

        if (!res.ok || !json.ok) {
          throw new Error(json.error?.message || 'Shared report not found or link has expired.');
        }

        setReport(json.data);
      } catch (err) {
        setError(err.message || 'Failed to load report.');
      } finally {
        setLoading(false);
      }
    }

    fetchReport();
  }, []);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <LoadingSpinner label="Loading Campaign Performance Report…" />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 24 }}>
        <div className="premium-card text-center" style={{ maxWidth: 460, padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
          <h3 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--ink)' }}>Report Unavailable</h3>
          <p style={{ color: 'var(--ink3)', fontSize: 13, marginTop: 8 }}>
            {error || 'This report link is inactive or has been revoked by the campaign manager.'}
          </p>
          <div style={{ marginTop: 24 }}>
            <a href="/" className="btn btn-primary btn-sm">
              Go to Omnya Portal
            </a>
          </div>
        </div>
      </div>
    );
  }

  const { campaign, clientName, stats, timeline, topPosts, posts, creators } = report;
  const formatMeta = platformMeta(campaign.format);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      {/* Top Brand Bar */}
      <header style={{
        background: '#fff',
        borderBottom: '1px solid var(--border)',
        padding: '16px 32px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            background: 'var(--ink)',
            color: '#fff',
            fontFamily: 'Bebas Neue, sans-serif',
            fontSize: 22,
            letterSpacing: '2px',
            padding: '4px 12px',
            borderRadius: 6
          }}>
            OMNYA
          </div>
          <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: 14 }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--ink3)', fontWeight: 600 }}>
              Performance Report
            </div>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>
              {clientName}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            background: 'rgba(26, 122, 74, 0.1)',
            color: 'var(--green)',
            border: '1px solid rgba(26, 122, 74, 0.2)',
            padding: '4px 12px',
            borderRadius: 20,
            fontSize: 12,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 6
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)' }}></span>
            Live Performance Data
          </span>
        </div>
      </header>

      {/* Main Report Body */}
      <main style={{ maxWidth: 1200, width: '100%', margin: '0 auto', padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: 28, flex: 1 }}>
        {/* Campaign Hero Banner */}
        <div className="premium-card" style={{ padding: 28 }}>
          <div className="flex-between mb-16" style={{ flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, color: 'var(--ink)', letterSpacing: '-0.5px' }}>
                  {campaign.name}
                </h1>
                <span style={{
                  background: formatMeta.bg,
                  color: formatMeta.text,
                  border: `1px solid ${formatMeta.border}`,
                  padding: '4px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 700
                }}>
                  {formatMeta.icon} {campaign.format}
                </span>
              </div>
              <p style={{ color: 'var(--ink3)', margin: 0, fontSize: 14, maxWidth: 640 }}>
                {campaign.description || 'Verified UGC and influencer campaign delivery metrics, reach, and engagement data.'}
              </p>
            </div>

            {campaign.brief_url && (
              <a
                href={campaign.brief_url}
                target="_blank"
                rel="noreferrer noopener"
                className="btn btn-secondary btn-sm"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <span>📑</span>
                <span>View Campaign Brief</span>
              </a>
            )}
          </div>

          {/* Flight Pacing Strip */}
          <div style={{
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '16px 20px',
            marginTop: 20
          }}>
            <div className="flex-between mb-8" style={{ fontSize: 13 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 800, color: 'var(--ink)' }}>
                  Flight: Week {timeline.currentWeek} of {timeline.totalWeeks}
                </span>
                <span className={`badge ${timeline.paceStatus === 'completed' || timeline.paceStatus === 'on_track' ? 'badge-green' : timeline.paceStatus === 'ahead' ? 'badge-blue' : 'badge-orange'}`}>
                  {timeline.paceStatus === 'completed' ? 'Completed' : timeline.paceStatus === 'ahead' ? 'Ahead of Pace' : timeline.paceStatus === 'behind' ? 'Behind Pace' : 'On Track'}
                </span>
              </div>
              <div style={{ fontWeight: 600, color: timeline.daysRemaining !== null && timeline.daysRemaining <= 3 ? 'var(--red)' : 'var(--ink3)' }}>
                {timeline.daysRemaining !== null ? (
                  timeline.daysRemaining > 0 ? `⏱️ ${timeline.daysRemaining} days remaining` : timeline.daysRemaining === 0 ? '⚠️ Ends today' : `🏁 Ended ${Math.abs(timeline.daysRemaining)}d ago`
                ) : 'Active Campaign'}
              </div>
            </div>

            {/* Progress bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink3)', marginBottom: 6 }}>
              <span>Delivery: <strong>{stats.deliveredPosts}</strong> of <strong>{stats.targetPosts}</strong> approved deliverables</span>
              <strong style={{ color: 'var(--ink)' }}>{stats.deliveryPct}%</strong>
            </div>
            <div style={{ height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${Math.min(100, stats.deliveryPct)}%`,
                  background: stats.deliveryPct >= 100 ? 'var(--green)' : 'var(--blue)',
                  borderRadius: 4
                }}
              />
            </div>
          </div>
        </div>

        {/* Aggregate KPI Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 16
        }}>
          <div className="stat-card stat-highlight">
            <div className="stat-label">Total Verified Views</div>
            <div className="stat-value">{fmtCompactNum(stats.totalViews)}</div>
            <div className="stat-sub">{fmtNum(stats.totalViews)} total impressions</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Engagement Rate</div>
            <div className="stat-value text-green">{stats.engagementRate}%</div>
            <div className="stat-sub">{fmtCompactNum(stats.totalEngagements)} total interactions</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Total Likes</div>
            <div className="stat-value">{fmtCompactNum(stats.totalLikes)}</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Comments</div>
            <div className="stat-value">{fmtCompactNum(stats.totalComments)}</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Shares & Reposts</div>
            <div className="stat-value">{fmtCompactNum(stats.totalShares)}</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Saves / Bookmarks</div>
            <div className="stat-value">{fmtCompactNum(stats.totalSaves)}</div>
          </div>
        </div>

        {/* Top Posts Showcase */}
        {topPosts.length > 0 && (
          <TopPostsShowcase
            posts={topPosts}
            title="Top Performing Campaign Posts"
            subtitle="Top videos ranked by total reach and viewer engagement"
          />
        )}

        {/* Full Posts Gallery / Table */}
        <PostsGalleryView
          submissions={posts}
          analytics={[]}
          creators={creators}
          campaigns={[campaign]}
          title="All Delivered Content Assets"
          subtitle="Explore all verified post deliverables and direct video links"
          initialView="gallery"
        />

        {/* Participating Creators Roster */}
        {creators.length > 0 && (
          <div className="premium-card" style={{ padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px 0' }}>
              Contributing Creators ({creators.length})
            </h3>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 12
            }}>
              {creators.map(c => (
                <div
                  key={c.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 14px',
                    background: 'var(--bg)',
                    borderRadius: 8,
                    border: '1px solid var(--border2)'
                  }}
                >
                  <div
                    className={`creator-avatar ${getAvatarColor(c.name)}`}
                    style={{ width: 34, height: 34, fontSize: 13 }}
                  >
                    {getInitials(c.name)}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>
                      {c.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink3)' }}>
                      {c.tiktok_handle ? `@${c.tiktok_handle}` : (c.instagram_handle ? `@${c.instagram_handle}` : 'Creator')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer style={{
        background: '#fff',
        borderTop: '1px solid var(--border)',
        padding: '24px 32px',
        textAlign: 'center',
        fontSize: 12,
        color: 'var(--ink3)'
      }}>
        <div>Powered by <strong>Omnya Growth</strong> · Verified UGC Campaign Management & Reporting</div>
      </footer>
    </div>
  );
}
