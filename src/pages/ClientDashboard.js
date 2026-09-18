import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import AnalyticsDashboard from '../AnalyticsDashboard';
import { fmtDate, fmtNum, calcPacing, platformMeta, isBreakoutVideo } from '../utils';
import LoadingSpinner from '../components/LoadingSpinner';
import CampaignProgressCard from '../components/CampaignProgressCard';
import PostsGalleryView from '../components/PostsGalleryView';
import UGCDashboardView from '../components/UGCDashboardView';

// ============================================================================
// COMPONENT 0: AgencyHeaderBar (OMNYA GROWTH Partner Branding)
// ============================================================================
export function AgencyHeaderBar({ clientName }) {
  return (
    <div
      className="client-agency-header"
      style={{
        background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)',
        color: '#FFFFFF',
        padding: '18px 24px',
        borderRadius: '12px',
        marginBottom: '24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.12)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: 'linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 800,
            fontSize: 18,
            color: '#FFFFFF',
            letterSpacing: '0.05em',
            boxShadow: '0 2px 8px rgba(59, 130, 246, 0.4)'
          }}
        >
          OG
        </div>
        <div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: '0.12em',
              color: '#60A5FA',
              textTransform: 'uppercase',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <span>OMNYA GROWTH</span>
            <span style={{ color: '#64748B' }}>•</span>
            <span style={{ color: '#94A3B8', fontWeight: 600 }}>Client Partner Portal</span>
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#FFFFFF', marginTop: 2 }}>
            {clientName ? `${clientName} Workspace` : 'Brand Partner Workspace'}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: 'rgba(16, 185, 129, 0.15)',
            color: '#34D399',
            border: '1px solid rgba(52, 211, 153, 0.3)',
            borderRadius: '20px',
            padding: '4px 12px',
            fontSize: 12,
            fontWeight: 600
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10B981' }} />
          Verified Partner
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENT 0.5: ClientCampaignDetailView (Drilldown View with CPM & Top Videos)
// ============================================================================
export function ClientCampaignDetailView({ campaign, clientProfile, submissions, analytics, creators, onBack }) {
  const campaignId = campaign.campaign_id || campaign.id;
  const campaignSubs = useMemo(() => {
    return (submissions || []).filter(s => s.campaign_id === campaignId);
  }, [submissions, campaignId]);

  const pacing = calcPacing({
    startDate: campaign.start_date || campaign.created_at,
    deadline: campaign.deadline,
    videosNeeded: campaign.videos_needed || 10,
    approvedCount: campaignSubs.length
  });

  const formatMeta = platformMeta(campaign.format);

  // Latest analytics record per submission
  const analyticsMap = useMemo(() => {
    const map = {};
    (analytics || []).forEach(a => {
      const subId = a.submission_id || a.submissionId;
      if (subId) {
        if (!map[subId] || new Date(a.pulled_at || 0) > new Date(map[subId].pulled_at || 0)) {
          map[subId] = a;
        }
      }
    });
    return map;
  }, [analytics]);

  // Creator lookup
  const creatorMap = useMemo(() => {
    const map = {};
    (creators || []).forEach(c => {
      map[c.id] = c;
    });
    return map;
  }, [creators]);

  // Enriched submissions
  const enrichedSubs = useMemo(() => {
    return campaignSubs.map(s => {
      const subId = s.id || s.submission_id;
      const a = analyticsMap[subId];
      const views = Number(a?.views || s.views_1w || s.views_72h || s.views_24h || s.views || 0);
      const likes = Number(a?.likes || s.likes || 0);
      const comments = Number(a?.comments || s.comments || 0);
      const shares = Number(a?.shares || s.shares || 0);
      const creator = creatorMap[s.creator_id];
      const isBreakout = isBreakoutVideo(views, creator?.avg_views || 0);
      return {
        ...s,
        id: subId,
        views,
        likes,
        comments,
        shares,
        totalEngagements: likes + comments + shares,
        isBreakout
      };
    }).sort((a, b) => b.views - a.views);
  }, [campaignSubs, analyticsMap, creatorMap]);

  const totalViews = enrichedSubs.reduce((acc, s) => acc + s.views, 0);
  const totalLikes = enrichedSubs.reduce((acc, s) => acc + s.likes, 0);
  const totalComments = enrichedSubs.reduce((acc, s) => acc + s.comments, 0);
  const totalShares = enrichedSubs.reduce((acc, s) => acc + s.shares, 0);
  const totalEngagements = totalLikes + totalComments + totalShares;
  const engagementRate = totalViews > 0 ? ((totalEngagements / totalViews) * 100).toFixed(2) + '%' : '0.00%';

  // CPM (cost per thousand views) = the client's own budget / verified views.
  //
  // clientProfile.budget is the client's own clients row, which RLS already
  // lets them read, so nothing internal is exposed by dividing it. The first
  // version reached for campaign.budget, campaign.videos_needed and
  // campaign.pay_per_video instead: the first does not exist, and the other two
  // are deliberately absent from client_safe_campaigns (pay_per_video is what
  // creators are paid). Every one of them was therefore undefined, the `|| 10`
  // fallbacks kicked in, and the client was shown a CPM computed from an
  // invented $100. With no budget or no views there is no CPM, and we say so.
  const clientBudget = Number(clientProfile?.budget || 0);
  const cpm = clientBudget > 0 && totalViews > 0 ? ((clientBudget / totalViews) * 1000).toFixed(2) : null;
  // Only true when the owner or manager has switched it on for this campaign;
  // the column reaches the client through client_safe_campaigns.
  const showCpm = Boolean(campaign.show_client_cpm);

  // Top videos sorted by reach
  const topVideos = enrichedSubs.slice(0, 4);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <button
          className="btn btn-ghost btn-sm"
          onClick={onBack}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          ← Back to Campaigns Overview
        </button>
      </div>

      {/* Campaign Header Card */}
      <div className="premium-card mb-24" style={{ padding: 24 }}>
        <div className="flex-between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: 24, margin: 0, fontWeight: 700 }}>{campaign.campaign_name || campaign.name}</h2>
              <span
                style={{
                  background: formatMeta.bg,
                  color: formatMeta.text,
                  border: `1px solid ${formatMeta.border}`,
                  padding: '3px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600
                }}
              >
                {formatMeta.icon} {campaign.format || 'Video'}
              </span>
              <span
                className={`badge ${
                  campaign.campaign_status === 'Active' || campaign.status === 'Active'
                    ? 'badge-green'
                    : 'badge-orange'
                }`}
              >
                {campaign.campaign_status || campaign.status}
              </span>
            </div>
            <p style={{ color: 'var(--ink3)', fontSize: 13, margin: 0 }}>
              Launched: {fmtDate(campaign.created_at)} · Goal: {campaign.videos_needed || 10} deliverables
            </p>
          </div>

          {campaign.brief_url && (
            <a
              href={campaign.brief_url}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary btn-sm"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <span>View Concept Briefing Document</span> 📑
            </a>
          )}
        </div>

        {/* Timeline & Pacing Bar */}
        <div
          style={{
            background: 'var(--bg)',
            borderRadius: 8,
            padding: 16,
            marginTop: 20,
            border: '1px solid var(--border2)'
          }}
        >
          <div className="flex-between mb-8" style={{ fontSize: 13 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 700, color: 'var(--ink)' }}>
                Week {pacing.currentWeek} of {pacing.totalWeeks}
              </span>
              <span className={`badge ${pacing.paceBadge}`} style={{ fontSize: 11 }}>
                {pacing.paceLabel}
              </span>
            </div>
            <div
              style={{
                fontWeight: 600,
                color:
                  pacing.daysRemaining !== null && pacing.daysRemaining <= 3
                    ? 'var(--red)'
                    : 'var(--ink3)'
              }}
            >
              {pacing.daysRemaining !== null
                ? pacing.daysRemaining > 0
                  ? `⏱️ ${pacing.daysRemaining} days remaining`
                  : pacing.daysRemaining === 0
                  ? '⚠️ Flight ends today'
                  : `🏁 Completed ${Math.abs(pacing.daysRemaining)}d ago`
                : 'No flight deadline set'}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 11,
              color: 'var(--ink3)',
              marginBottom: 6
            }}
          >
            <span>
              Delivered: {campaignSubs.length} of {campaign.videos_needed || 10} assets
            </span>
            <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{pacing.deliveryPct}% Complete</span>
          </div>
          <div style={{ height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${Math.min(100, pacing.deliveryPct)}%`,
                background:
                  pacing.deliveryPct >= 100
                    ? 'var(--green)'
                    : pacing.paceStatus === 'behind'
                    ? 'var(--orange)'
                    : 'var(--blue)',
                borderRadius: 4,
                transition: 'width 0.3s ease'
              }}
            />
          </div>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fit, minmax(180px, 1fr))`,
          gap: 16,
          marginBottom: 24
        }}
      >
        <div className="stat-card">
          <div className="stat-label">Delivered Videos</div>
          <div className="stat-value text-blue" style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
            {campaignSubs.length}{' '}
            <span style={{ fontSize: 13, color: 'var(--ink3)', fontWeight: 500 }}>
              / {campaign.videos_needed || 10}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>{pacing.deliveryPct}% of target</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Verified Views</div>
          <div className="stat-value" style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
            {fmtNum(totalViews)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>Cumulative post views</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Total Engagements</div>
          <div className="stat-value text-purple" style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
            {fmtNum(totalEngagements)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>Likes, comments & shares</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Engagement Rate</div>
          <div className="stat-value text-green" style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
            {engagementRate}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>Interactions / views</div>
        </div>

        {/* CPM Metric: ONLY rendered if show_client_cpm === true */}
        {showCpm && (
          <div className="stat-card" style={{ borderLeft: '4px solid var(--blue)' }}>
            <div className="stat-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>CPM (Cost / 1k Views)</span>
              <span
                title="Effective Cost Per Mille based on campaign investment and verified impressions"
                style={{ cursor: 'help', fontSize: 11, color: 'var(--ink3)' }}
              >
                ⓘ
              </span>
            </div>
            <div className="stat-value text-blue" style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
              {cpm ? `$${cpm}` : '—'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>
              {totalViews > 0 ? `Effective rate on ${fmtNum(totalViews)} views` : 'Pending initial impressions'}
            </div>
          </div>
        )}
      </div>

      {/* Top Performing Content Section */}
      {topVideos.length > 0 && (
        <div className="mb-24">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Top Performing Content</h3>
              <p style={{ color: 'var(--ink3)', fontSize: 13, margin: '2px 0 0 0' }}>
                Highest-reach approved assets driving verified impressions for this flight.
              </p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            {topVideos.map((video, idx) => {
              const platform = video.platform || 'tiktok';
              const pMeta = platformMeta(platform);
              return (
                <div
                  key={video.id}
                  className="premium-card"
                  style={{
                    padding: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between'
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 8
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          background: idx === 0 ? 'var(--gold-soft, #FEF3C7)' : 'var(--bg2)',
                          color: idx === 0 ? 'var(--gold-dark, #B45309)' : 'var(--ink2)',
                          padding: '2px 8px',
                          borderRadius: 12
                        }}
                      >
                        #{idx + 1} Top Reach
                      </span>
                      {video.isBreakout && (
                        <span className="badge badge-orange" style={{ fontSize: 10 }}>
                          🔥 Breakout
                        </span>
                      )}
                    </div>

                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                      {video.creator_name || 'Creator'}
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 12,
                        color: 'var(--ink3)',
                        marginBottom: 12
                      }}
                    >
                      <span>
                        {pMeta.icon} {platform.toUpperCase()}
                      </span>
                      <span>•</span>
                      <span>{fmtDate(video.created_at)}</span>
                    </div>

                    <div
                      style={{
                        background: 'var(--bg)',
                        padding: 10,
                        borderRadius: 6,
                        marginBottom: 12
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 12, color: 'var(--ink3)' }}>Views</span>
                        <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--blue)' }}>
                          {fmtNum(video.views)}
                        </span>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginTop: 4
                        }}
                      >
                        <span style={{ fontSize: 11, color: 'var(--ink3)' }}>Likes & Comments</span>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>
                          {fmtNum(video.likes + video.comments)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div>
                    {video.posted_link || video.video_url ? (
                      <a
                        href={video.posted_link || video.video_url}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-secondary btn-sm"
                        style={{ width: '100%', textAlign: 'center', justifyContent: 'center' }}
                      >
                        Watch Post ↗
                      </a>
                    ) : (
                      <span
                        style={{
                          fontSize: 12,
                          color: 'var(--ink3)',
                          textAlign: 'center',
                          display: 'block'
                        }}
                      >
                        Video link pending
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Campaign Submissions Listing */}
      <div className="mb-24">
        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
          Delivered Submissions ({campaignSubs.length})
        </h3>
        <div className="premium-card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="premium-table">
              <thead>
                <tr>
                  <th>Creator Name</th>
                  <th>Platform</th>
                  <th>Submission Type</th>
                  <th>Status</th>
                  <th>Verified Views</th>
                  <th>Live Link</th>
                  <th>Delivery Date</th>
                </tr>
              </thead>
              <tbody>
                {enrichedSubs.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', padding: 24, color: 'var(--ink3)' }}>
                      No content submissions approved for this campaign yet.
                    </td>
                  </tr>
                ) : (
                  enrichedSubs.map(s => (
                    <tr key={s.id}>
                      <td className="fw-600">{s.creator_name || 'Creator'}</td>
                      <td style={{ textTransform: 'capitalize' }}>
                        {s.platform === 'tiktok'
                          ? '🎵 TikTok'
                          : s.platform === 'instagram'
                          ? '📸 Instagram'
                          : s.platform === 'youtube'
                          ? '▶️ YouTube'
                          : '🎥 ' + (s.platform || 'Video')}
                      </td>
                      <td>{s.submission_type || 'Draft'}</td>
                      <td>
                        <span className="badge badge-green">{s.final_status || s.status || 'Approved'}</span>
                      </td>
                      <td className="fw-600">{fmtNum(s.views)}</td>
                      <td>
                        {s.posted_link || s.video_url ? (
                          <a
                            href={s.posted_link || s.video_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue"
                            style={{ fontWeight: 500 }}
                          >
                            View Post 🔗
                          </a>
                        ) : (
                          <span style={{ color: 'var(--ink3)' }}>Not posted</span>
                        )}
                      </td>
                      <td style={{ color: 'var(--ink3)' }}>{fmtDate(s.created_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Campaign Analytics Deep Dive */}
      <div className="premium-card mb-24" style={{ padding: 24 }}>
        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20 }}>Engagement Analytics & Trends</h3>
        <AnalyticsDashboard campaignId={campaignId} />
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENT 1: ClientDashboard (Overview)
// ============================================================================
export default function ClientDashboard({ user, db, onRefresh, onNavigate }) {
  const [clientProfile, setClientProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState("");
  const [selectedCampaign, setSelectedCampaign] = useState(null);

  // 1. Fetch linked brand account details
  useEffect(() => {
    async function loadBrandAccount() {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('clients')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) throw error;
        if (data) {
          setClientProfile(data);
        }
      } catch (err) {
        console.error("Failed to load client mapping:", err.message);
        setDbError("Unable to establish your brand credentials.");
      } finally {
        setLoading(false);
      }
    }
    loadBrandAccount();
  }, [user]);

  // 2. Filter campaigns belonging to this brand
  const clientCampaigns = useMemo(() => {
    if (!clientProfile) return [];
    return (db.campaigns || []).filter(c => c.client_id === clientProfile.id);
  }, [db.campaigns, clientProfile]);

  const clientCampIds = useMemo(() => {
    return new Set(clientCampaigns.map(c => c.campaign_id || c.id));
  }, [clientCampaigns]);

  // 3. Submissions belonging to this brand's campaigns
  const clientSubmissions = useMemo(() => {
    return (db.submissions || []).filter(s => clientCampIds.has(s.campaign_id));
  }, [db.submissions, clientCampIds]);

  if (loading) return <LoadingSpinner label="Loading Brand Workspace…" />;

  if (dbError || !clientProfile) {
    return (
      <div className="content text-center" style={{ padding: 64 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🏢</div>
        <h3 style={{ fontWeight: 600 }}>Brand Workspace Registration</h3>
        <p style={{ color: 'var(--ink3)', marginTop: 8, maxWidth: 460, margin: '8px auto' }}>
          Your client portal account is successfully verified. We are finalising the linkage to your brand assets and active campaigns.
        </p>
        <button className="btn btn-secondary btn-sm" onClick={onRefresh} style={{ marginTop: 16 }}>
          🔄 Refresh Status
        </button>
      </div>
    );
  }

  // If a campaign is clicked in the catalog, drill down into its details
  if (selectedCampaign) {
    return (
      <div className="content">
        <AgencyHeaderBar clientName={clientProfile.name} />
        <ClientCampaignDetailView
          campaign={selectedCampaign}
          clientProfile={clientProfile}
          submissions={db.submissions || []}
          analytics={db.analytics || []}
          creators={db.creators || []}
          onBack={() => setSelectedCampaign(null)}
        />
      </div>
    );
  }

  return (
    <div className="content">
      {/* Agency Header Bar: OMNYA GROWTH branding */}
      <AgencyHeaderBar clientName={clientProfile.name} />

      {/* UGCTrackr-style Dashboard Performance Suite for Client Brand */}
      <div style={{ marginBottom: 32 }}>
        <UGCDashboardView
          campaigns={clientCampaigns}
          submissions={clientSubmissions}
          analytics={db.analytics || []}
          creators={db.creators || []}
          title={clientProfile.name}
          subtitle="Partner Brand Portal · Verified Performance Analytics & Daily View Trends"
          showTopPosts={true}
          onNavigate={onNavigate}
        />
      </div>

      {/* Clickable Campaign Catalog Table */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Campaign Catalogs</h3>
          <p style={{ color: 'var(--ink3)', fontSize: 13, margin: '4px 0 0 0' }}>
            Click any campaign to inspect deliverables, CPM, and video insights.
          </p>
        </div>
      </div>
      <div className="premium-card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="premium-table">
            <thead>
              <tr>
                <th>Campaign Name</th>
                <th>Format</th>
                <th>Status</th>
                <th>Deliverables</th>
                <th>Concept Briefing</th>
                <th>Launch Date</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {clientCampaigns.length === 0 ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', padding: 32, color: 'var(--ink3)' }}>
                    No campaigns have launched yet. Contact your Account Manager to begin onboarding.
                  </td>
                </tr>
              ) : (
                clientCampaigns.map(c => {
                  const campId = c.campaign_id || c.id;
                  const subs = (db.submissions || []).filter(s => s.campaign_id === campId);
                  const formatMetaObj = platformMeta(c.format);
                  return (
                    <tr
                      key={campId}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setSelectedCampaign(c)}
                    >
                      <td>
                        <span className="fw-700 text-blue">{c.campaign_name || c.name}</span>
                      </td>
                      <td>
                        <span
                          style={{
                            background: formatMetaObj.bg,
                            color: formatMetaObj.text,
                            padding: '2px 8px',
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 600
                          }}
                        >
                          {formatMetaObj.icon} {c.format || 'TikTok'}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            c.campaign_status === 'Active' || c.status === 'Active'
                              ? 'badge-green'
                              : 'badge-orange'
                          }`}
                        >
                          {c.campaign_status || c.status}
                        </span>
                      </td>
                      <td>
                        <span className="fw-600">
                          {subs.length} / {c.videos_needed || 10}
                        </span>
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        {c.brief_url ? (
                          <a
                            href={c.brief_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue"
                            style={{ fontWeight: 500 }}
                          >
                            View Brief 📑
                          </a>
                        ) : (
                          <span style={{ color: 'var(--ink3)' }}>—</span>
                        )}
                      </td>
                      <td style={{ color: 'var(--ink3)' }}>{fmtDate(c.created_at)}</td>
                      <td>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={e => {
                            e.stopPropagation();
                            setSelectedCampaign(c);
                          }}
                        >
                          View Details →
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENT 2: ClientCampaignsPage (Cards, Table, and Detail)
// ============================================================================
export function ClientCampaignsPage({ user, db }) {
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [clientProfile, setClientProfile] = useState(null);
  const [viewMode, setViewMode] = useState('cards'); // 'cards' | 'table'
  const [search, setSearch] = useState('');

  // Load client profile
  useEffect(() => {
    let active = true;
    supabase
      .from('clients')
      .select('id, name')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (active && data) setClientProfile(data);
      });
    return () => {
      active = false;
    };
  }, [user.id]);

  // Filter campaigns belonging to this client only
  const clientCampaigns = useMemo(() => {
    if (!clientProfile) return [];
    return (db.campaigns || []).filter(c => c.client_id === clientProfile.id);
  }, [db.campaigns, clientProfile]);

  const getSubmissionsForCampaign = (campaignId) => {
    return (db.submissions || []).filter(s => s.campaign_id === campaignId);
  };

  const filteredCampaigns = useMemo(() => {
    if (!search.trim()) return clientCampaigns;
    const q = search.toLowerCase();
    return clientCampaigns.filter(
      c =>
        (c.campaign_name || c.name || '').toLowerCase().includes(q) ||
        (c.format || '').toLowerCase().includes(q)
    );
  }, [clientCampaigns, search]);

  // Single campaign detail drilldown view
  if (selectedCampaign) {
    return (
      <div className="content">
        <AgencyHeaderBar clientName={clientProfile?.name} />
        <ClientCampaignDetailView
          campaign={selectedCampaign}
          clientProfile={clientProfile}
          submissions={db.submissions || []}
          analytics={db.analytics || []}
          creators={db.creators || []}
          onBack={() => setSelectedCampaign(null)}
        />
      </div>
    );
  }

  return (
    <div className="content">
      {/* Agency Header Bar */}
      <AgencyHeaderBar clientName={clientProfile?.name} />

      {/* Header & Controls */}
      <div className="mb-24 flex-between" style={{ flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Campaign Overview</h2>
          <p style={{ color: 'var(--ink3)', marginTop: 4 }}>
            Monitor flight progress, milestones, and deliverable pacing across your brand portfolio.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* Search Box */}
          <input
            type="text"
            className="input"
            placeholder="Search campaigns..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: 200, height: 36, fontSize: 13 }}
          />

          {/* View Toggle */}
          <div
            style={{
              display: 'flex',
              background: 'var(--bg2)',
              borderRadius: 'var(--radius-sm)',
              padding: 3,
              border: '1px solid var(--border)'
            }}
          >
            <button
              className={`btn btn-sm ${viewMode === 'cards' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ padding: '4px 12px', fontSize: 12, height: 28 }}
              onClick={() => setViewMode('cards')}
            >
              🗂 Cards
            </button>
            <button
              className={`btn btn-sm ${viewMode === 'table' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ padding: '4px 12px', fontSize: 12, height: 28 }}
              onClick={() => setViewMode('table')}
            >
              📋 Table
            </button>
          </div>
        </div>
      </div>

      {/* Cards View */}
      {viewMode === 'cards' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 20
          }}
        >
          {filteredCampaigns.length === 0 ? (
            <div className="premium-card text-center" style={{ gridColumn: '1 / -1', padding: 48 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📢</div>
              <h3>No campaigns found</h3>
              <p style={{ color: 'var(--ink3)' }}>
                {search
                  ? 'No campaigns match your search query.'
                  : "We haven't launched any campaign cycles in this brand workspace yet."}
              </p>
            </div>
          ) : (
            filteredCampaigns.map(c => {
              const campaignId = c.campaign_id || c.id;
              const subs = getSubmissionsForCampaign(campaignId);
              return (
                <CampaignProgressCard
                  key={campaignId}
                  campaign={{
                    ...c,
                    id: campaignId,
                    name: c.campaign_name || c.name,
                    status: c.campaign_status || c.status,
                    videos_needed: c.videos_needed || 10,
                    format: c.format || 'TikTok',
                    deadline: c.deadline,
                    start_date: c.start_date || c.created_at,
                    show_client_cpm: c.show_client_cpm
                  }}
                  client={clientProfile}
                  approvedCount={subs.length}
                  onClick={() => setSelectedCampaign(c)}
                />
              );
            })
          )}
        </div>
      )}

      {/* Table View */}
      {viewMode === 'table' && (
        <div className="premium-card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="premium-table">
              <thead>
                <tr>
                  <th>Campaign Name</th>
                  <th>Format</th>
                  <th>Status</th>
                  <th>Deliverables</th>
                  <th>Pacing</th>
                  <th>Timeline</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredCampaigns.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', padding: 32, color: 'var(--ink3)' }}>
                      No campaigns match your filters.
                    </td>
                  </tr>
                ) : (
                  filteredCampaigns.map(c => {
                    const campaignId = c.campaign_id || c.id;
                    const subs = getSubmissionsForCampaign(campaignId);
                    const pacing = calcPacing({
                      startDate: c.start_date || c.created_at,
                      deadline: c.deadline,
                      videosNeeded: c.videos_needed || 10,
                      approvedCount: subs.length
                    });
                    const formatMeta = platformMeta(c.format);

                    return (
                      <tr
                        key={campaignId}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setSelectedCampaign(c)}
                      >
                        <td>
                          <span className="fw-700 text-blue">{c.campaign_name || c.name}</span>
                        </td>
                        <td>
                          <span
                            style={{
                              background: formatMeta.bg,
                              color: formatMeta.text,
                              padding: '2px 8px',
                              borderRadius: 4,
                              fontSize: 11,
                              fontWeight: 600
                            }}
                          >
                            {formatMeta.icon} {c.format || 'TikTok'}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              c.campaign_status === 'Active' || c.status === 'Active'
                                ? 'badge-green'
                                : 'badge-orange'
                            }`}
                          >
                            {c.campaign_status || c.status}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span className="fw-600">
                              {subs.length} / {c.videos_needed || 10}
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--ink3)' }}>
                              ({pacing.deliveryPct}%)
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className={`badge ${pacing.paceBadge}`} style={{ fontSize: 11 }}>
                            Week {pacing.currentWeek} · {pacing.paceLabel}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--ink3)' }}>
                          {pacing.daysRemaining !== null
                            ? pacing.daysRemaining > 0
                              ? `${pacing.daysRemaining}d left`
                              : 'Ended'
                            : fmtDate(c.created_at)}
                        </td>
                        <td>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={e => {
                              e.stopPropagation();
                              setSelectedCampaign(c);
                            }}
                          >
                            Details →
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// COMPONENT 3: ClientContentGallery (PostsGalleryView)
// ============================================================================
export function ClientContentGallery({ user, db }) {
  const [clientProfile, setClientProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Load client profile
  useEffect(() => {
    let active = true;
    supabase
      .from('clients')
      .select('id, name')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (active && data) setClientProfile(data);
        if (active) setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user.id]);

  // Scoped campaigns
  const clientCampaigns = useMemo(() => {
    if (!clientProfile) return [];
    return (db.campaigns || [])
      .filter(c => c.client_id === clientProfile.id)
      .map(c => ({
        ...c,
        id: c.campaign_id || c.id,
        name: c.campaign_name || c.name
      }));
  }, [db.campaigns, clientProfile]);

  const clientCampIds = useMemo(() => {
    return new Set(clientCampaigns.map(c => c.id));
  }, [clientCampaigns]);

  // Scoped submissions
  const clientSubmissions = useMemo(() => {
    if (!clientProfile) return [];
    return (db.submissions || [])
      .filter(s => clientCampIds.has(s.campaign_id))
      .map(s => ({
        ...s,
        id: s.id || s.submission_id
      }));
  }, [db.submissions, clientCampIds, clientProfile]);

  if (loading) {
    return <LoadingSpinner label="Loading Verified Content Library…" />;
  }

  return (
    <div className="content">
      {/* Agency Header Bar */}
      <AgencyHeaderBar clientName={clientProfile?.name} />

      <PostsGalleryView
        submissions={clientSubmissions}
        analytics={db.analytics || []}
        creators={db.creators || []}
        campaigns={clientCampaigns}
        title="Verified Content Library"
        subtitle="Filter and explore verified assets and live performance metrics across your campaigns"
        initialView="gallery"
      />
    </div>
  );
}
