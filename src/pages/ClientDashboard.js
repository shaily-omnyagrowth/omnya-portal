import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import AnalyticsDashboard from '../AnalyticsDashboard';
import { fmtDate, calcPacing, platformMeta } from '../utils';
import LoadingSpinner from '../components/LoadingSpinner';
import CampaignProgressCard from '../components/CampaignProgressCard';
import PostsGalleryView from '../components/PostsGalleryView';
import UGCDashboardView from '../components/UGCDashboardView';

// ============================================================================
// COMPONENT 1: ClientDashboard (Overview)
// ============================================================================
export default function ClientDashboard({ user, db, onRefresh, onNavigate }) {
  const [clientProfile, setClientProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState("");

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

  return (
    <div className="content">
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

      {/* Quick Campaign Catalog Table */}
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Campaign Catalogs</h3>
      <div className="premium-card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="premium-table">
            <thead>
              <tr>
                <th>Campaign Name</th>
                <th>Status</th>
                <th>Concept Briefing</th>
                <th>Launch Date</th>
              </tr>
            </thead>
            <tbody>
              {clientCampaigns.length === 0 ? (
                <tr>
                  <td colSpan="4" style={{ textAlign: 'center', padding: 32, color: 'var(--ink3)' }}>
                    No campaigns have launched yet. Contact your Account Manager to begin onboarding.
                  </td>
                </tr>
              ) : (
                clientCampaigns.map(c => (
                  <tr key={c.campaign_id || c.id}>
                    <td className="fw-600">{c.campaign_name || c.name}</td>
                    <td>
                      <span className={`badge ${c.campaign_status === 'Active' || c.status === 'Active' ? 'badge-green' : 'badge-orange'}`}>
                        {c.campaign_status || c.status}
                      </span>
                    </td>
                    <td>
                      {c.brief_url ? (
                        <a href={c.brief_url} target="_blank" rel="noreferrer" className="text-blue" style={{ fontWeight: 500 }}>
                          View Campaign Brief 📑
                        </a>
                      ) : (
                        <span style={{ color: 'var(--ink3)' }}>No briefing brief uploaded</span>
                      )}
                    </td>
                    <td style={{ color: 'var(--ink3)' }}>{fmtDate(c.created_at)}</td>
                  </tr>
                ))
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

  // Load client profile so we can scope campaigns to this specific client.
  useEffect(() => {
    let active = true;
    supabase
      .from('clients')
      .select('id, name')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => { if (active && data) setClientProfile(data); });
    return () => { active = false; };
  }, [user.id]);

  // Filter campaigns belonging to this client only.
  const clientCampaigns = useMemo(() => {
    if (!clientProfile) return [];
    return (db.campaigns || []).filter(c => c.client_id === clientProfile.id);
  }, [db.campaigns, clientProfile]);

  // Submissions associated with each campaign
  const getSubmissionsForCampaign = (campaignId) => {
    return (db.submissions || []).filter(s => s.campaign_id === campaignId);
  };

  const filteredCampaigns = useMemo(() => {
    if (!search.trim()) return clientCampaigns;
    const q = search.toLowerCase();
    return clientCampaigns.filter(c =>
      (c.campaign_name || c.name || '').toLowerCase().includes(q) ||
      (c.format || '').toLowerCase().includes(q)
    );
  }, [clientCampaigns, search]);

  // Single campaign detail view
  if (selectedCampaign) {
    const campaignId = selectedCampaign.campaign_id || selectedCampaign.id;
    const campaignSubs = getSubmissionsForCampaign(campaignId);
    const pacing = calcPacing({
      startDate: selectedCampaign.start_date || selectedCampaign.created_at,
      deadline: selectedCampaign.deadline,
      videosNeeded: selectedCampaign.videos_needed || 10,
      approvedCount: campaignSubs.length
    });
    const formatMeta = platformMeta(selectedCampaign.format);

    return (
      <div className="content">
        <div style={{ marginBottom: 20 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setSelectedCampaign(null)}>
            ← Back to Campaigns Overview
          </button>
        </div>

        {/* Campaign Header Card */}
        <div className="premium-card mb-24" style={{ padding: 24 }}>
          <div className="flex-between" style={{ flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <h2 style={{ fontSize: 24, margin: 0 }}>{selectedCampaign.campaign_name || selectedCampaign.name}</h2>
                <span style={{
                  background: formatMeta.bg,
                  color: formatMeta.text,
                  border: `1px solid ${formatMeta.border}`,
                  padding: '3px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600
                }}>
                  {formatMeta.icon} {selectedCampaign.format || 'Video'}
                </span>
                <span className={`badge ${selectedCampaign.campaign_status === 'Active' || selectedCampaign.status === 'Active' ? 'badge-green' : 'badge-orange'}`}>
                  {selectedCampaign.campaign_status || selectedCampaign.status}
                </span>
              </div>
              <p style={{ color: 'var(--ink3)', fontSize: 13, margin: 0 }}>
                Launched: {fmtDate(selectedCampaign.created_at)} · Goal: {selectedCampaign.videos_needed || 10} videos
              </p>
            </div>

            {selectedCampaign.brief_url && (
              <a href={selectedCampaign.brief_url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                View Concept Briefing Document 📑
              </a>
            )}
          </div>

          {/* Timeline & Pacing Bar */}
          <div style={{
            background: 'var(--bg)',
            borderRadius: 8,
            padding: 16,
            marginTop: 20,
            border: '1px solid var(--border2)'
          }}>
            <div className="flex-between mb-8" style={{ fontSize: 13 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 700, color: 'var(--ink)' }}>
                  Week {pacing.currentWeek} of {pacing.totalWeeks}
                </span>
                <span className={`badge ${pacing.paceBadge}`} style={{ fontSize: 11 }}>
                  {pacing.paceLabel}
                </span>
              </div>
              <div style={{ fontWeight: 600, color: pacing.daysRemaining !== null && pacing.daysRemaining <= 3 ? 'var(--red)' : 'var(--ink3)' }}>
                {pacing.daysRemaining !== null ? (
                  pacing.daysRemaining > 0 ? `⏱️ ${pacing.daysRemaining} days remaining` : pacing.daysRemaining === 0 ? '⚠️ Flight ends today' : `🏁 Completed ${Math.abs(pacing.daysRemaining)}d ago`
                ) : 'No flight deadline set'}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink3)', marginBottom: 6 }}>
              <span>Delivered: {campaignSubs.length} of {selectedCampaign.videos_needed || 10} assets</span>
              <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{pacing.deliveryPct}% Complete</span>
            </div>
            <div style={{ height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${Math.min(100, pacing.deliveryPct)}%`,
                  background: pacing.deliveryPct >= 100 ? 'var(--green)' : pacing.paceStatus === 'behind' ? 'var(--orange)' : 'var(--blue)',
                  borderRadius: 4,
                  transition: 'width 0.3s ease'
                }}
              />
            </div>
          </div>
        </div>

        {/* Campaign Metrics Section */}
        <div className="premium-card mb-24" style={{ padding: 24 }}>
          <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20 }}>Campaign Engagement & Analytics</h3>
          <AnalyticsDashboard campaignId={campaignId} />
        </div>

        {/* Campaign Submissions Listing */}
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
            Delivered Submissions ({campaignSubs.length})
          </h3>
        </div>

        <div className="premium-card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="premium-table">
              <thead>
                <tr>
                  <th>Creator Name</th>
                  <th>Platform</th>
                  <th>Submission Type</th>
                  <th>Status</th>
                  <th>Live Link</th>
                  <th>Delivery Date</th>
                </tr>
              </thead>
              <tbody>
                {campaignSubs.length === 0 ? (
                  <tr>
                    <td colSpan="6" style={{ textAlign: 'center', padding: 24, color: 'var(--ink3)' }}>
                      No content submissions approved for this campaign yet.
                    </td>
                  </tr>
                ) : (
                  campaignSubs.map(s => (
                    <tr key={s.submission_id || s.id}>
                      <td className="fw-600">{s.creator_name || 'Creator'}</td>
                      <td style={{ textTransform: 'capitalize' }}>
                        {s.platform === 'tiktok' ? '🎵 TikTok' : s.platform === 'instagram' ? '📸 Instagram' : s.platform === 'youtube' ? '▶️ YouTube' : '🎥 ' + (s.platform || 'Video')}
                      </td>
                      <td>{s.submission_type || 'Draft'}</td>
                      <td>
                        <span className="badge badge-green">{s.final_status || s.status || 'Approved'}</span>
                      </td>
                      <td>
                        {s.posted_link || s.video_url ? (
                          <a href={s.posted_link || s.video_url} target="_blank" rel="noreferrer" className="text-blue" style={{ fontWeight: 500 }}>
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
    );
  }

  return (
    <div className="content">
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
          <div style={{ display: 'flex', background: 'var(--bg2)', borderRadius: 'var(--radius-sm)', padding: 3, border: '1px solid var(--border)' }}>
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
          {filteredCampaigns.length === 0 ? (
            <div className="premium-card text-center" style={{ gridColumn: '1 / -1', padding: 48 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📢</div>
              <h3>No campaigns found</h3>
              <p style={{ color: 'var(--ink3)' }}>
                {search ? 'No campaigns match your search query.' : "We haven't launched any campaign cycles in this brand workspace yet."}
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
                    start_date: c.start_date || c.created_at
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
                      <tr key={campaignId} style={{ cursor: 'pointer' }} onClick={() => setSelectedCampaign(c)}>
                        <td>
                          <span className="fw-700 text-blue">{c.campaign_name || c.name}</span>
                        </td>
                        <td>
                          <span style={{
                            background: formatMeta.bg,
                            color: formatMeta.text,
                            padding: '2px 8px',
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 600
                          }}>
                            {formatMeta.icon} {c.format || 'TikTok'}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${c.campaign_status === 'Active' || c.status === 'Active' ? 'badge-green' : 'badge-orange'}`}>
                            {c.campaign_status || c.status}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span className="fw-600">{subs.length} / {c.videos_needed || 10}</span>
                            <span style={{ fontSize: 11, color: 'var(--ink3)' }}>({pacing.deliveryPct}%)</span>
                          </div>
                        </td>
                        <td>
                          <span className={`badge ${pacing.paceBadge}`} style={{ fontSize: 11 }}>
                            Week {pacing.currentWeek} · {pacing.paceLabel}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--ink3)' }}>
                          {pacing.daysRemaining !== null ? (
                            pacing.daysRemaining > 0 ? `${pacing.daysRemaining}d left` : 'Ended'
                          ) : fmtDate(c.created_at)}
                        </td>
                        <td>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={(e) => {
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

  // Load client profile so we can scope submissions to this client's campaigns.
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
    return () => { active = false; };
  }, [user.id]);

  // Scoped campaigns
  const clientCampaigns = useMemo(() => {
    if (!clientProfile) return [];
    return (db.campaigns || []).filter(c => c.client_id === clientProfile.id).map(c => ({
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
    return (db.submissions || []).filter(s => clientCampIds.has(s.campaign_id)).map(s => ({
      ...s,
      id: s.id || s.submission_id
    }));
  }, [db.submissions, clientCampIds, clientProfile]);

  if (loading) {
    return <LoadingSpinner label="Loading Verified Content Library…" />;
  }

  return (
    <div className="content">
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
