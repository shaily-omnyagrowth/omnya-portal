import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import AnalyticsDashboard from '../AnalyticsDashboard';
import { fmtDate, fmtNum } from '../utils';
import LoadingSpinner from '../components/LoadingSpinner';

// ============================================================================
// COMPONENT 1: ClientDashboard (Overview)
// ============================================================================
export default function ClientDashboard({ user, db, onRefresh }) {
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

  // 2. Compute dynamic metrics safely
  const clientCampaigns = useMemo(() => {
    if (!clientProfile) return [];
    // safe view maps c.client_id
    return db.campaigns.filter(c => c.client_id === clientProfile.id);
  }, [db.campaigns, clientProfile]);

  const livePostsCount = useMemo(() => {
    return db.submissions.filter(s =>
      clientCampaigns.some(c => c.campaign_id === s.campaign_id)
    ).length;
  }, [db.submissions, clientCampaigns]);

  // Aggregated analytics rollups from db.analytics
  const totals = useMemo(() => {
    const defaultStats = { views: 0, likes: 0, comments: 0, shares: 0 };
    if (!db.analytics || !db.analytics.length) return defaultStats;
    return db.analytics.reduce((acc, a) => {
      acc.views += a.views || 0;
      acc.likes += a.likes || 0;
      acc.comments += a.comments || 0;
      acc.shares += a.shares || 0;
      return acc;
    }, defaultStats);
  }, [db.analytics]);

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
      {/* Header Banner */}
      <div className="mb-24 flex-between" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: 'var(--ink)' }}>
             {clientProfile.name}
          </h2>
          <p style={{ color: 'var(--ink3)', marginTop: 4, fontSize: 13 }}>
            Partner Brand Portal · Verified Performance Campaigns
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="owner-badge" style={{ background: 'var(--blue)', color: '#fff', fontSize: 11, padding: '4px 10px', borderRadius: 20 }}>
            🛡️ Secure Brand Access
          </span>
        </div>
      </div>

      {/* Top Cards Grid */}
      <div className="stats-grid" style={{ marginBottom: 32 }}>
        <div className="stat-card">
          <div className="stat-label">Delivered Campaigns</div>
          <div className="stat-value">{clientCampaigns.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Approved Live Posts</div>
          <div className="stat-value text-green">{livePostsCount}</div>
        </div>
        <div className="stat-card stat-highlight">
          <div className="stat-label">Total Verified Views</div>
          <div className="stat-value">{fmtNum(totals.views)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Engagements</div>
          <div className="stat-value">{fmtNum(totals.likes + totals.comments + totals.shares)}</div>
        </div>
      </div>

      {/* Campaign Analytics Chart Component */}
      <div className="premium-card" style={{ marginBottom: 32, padding: 24 }}>
        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20 }}>Campaign Insights Overview</h3>
        <AnalyticsDashboard campaignId={null} />
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
                  <tr key={c.campaign_id}>
                    <td className="fw-600">{c.campaign_name}</td>
                    <td>
                      <span className={`badge ${c.campaign_status === 'Active' ? 'badge-green' : 'badge-orange'}`}>
                        {c.campaign_status}
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
// COMPONENT 2: ClientCampaignsPage
// ============================================================================
export function ClientCampaignsPage({ user, db }) {
  const [selectedCampaign, setSelectedCampaign] = useState(null);

  // Filter campaigns belonging to this client user
  const clientCampaigns = useMemo(() => {
    return db.campaigns || [];
  }, [db.campaigns]);

  // Submissions associated with each campaign
  const getSubmissionsForCampaign = (campaignId) => {
    return db.submissions.filter(s => s.campaign_id === campaignId);
  };

  if (selectedCampaign) {
    const campaignSubs = getSubmissionsForCampaign(selectedCampaign.campaign_id);
    return (
      <div className="content">
        <div style={{ marginBottom: 20 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setSelectedCampaign(null)}>
            ← Back to Campaigns Overview
          </button>
        </div>

        <div className="premium-card mb-24" style={{ padding: 24 }}>
          <div className="flex-between">
            <div>
              <h2 style={{ fontSize: 24, margin: 0 }}>{selectedCampaign.campaign_name}</h2>
              <p style={{ color: 'var(--ink3)', marginTop: 4, fontSize: 13 }}>
                Launched: {fmtDate(selectedCampaign.created_at)}
              </p>
            </div>
            <span className={`badge ${selectedCampaign.campaign_status === 'Active' ? 'badge-green' : 'badge-orange'}`} style={{ fontSize: 14 }}>
              {selectedCampaign.campaign_status}
            </span>
          </div>

          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border2)' }}>
            {selectedCampaign.brief_url ? (
              <a href={selectedCampaign.brief_url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                View Concept Briefing Document 📑
              </a>
            ) : (
              <span style={{ color: 'var(--ink3)', fontSize: 13 }}>No concept brief uploaded for this campaign.</span>
            )}
          </div>
        </div>

        {/* Campaign Metrics Section */}
        <div className="premium-card mb-24" style={{ padding: 24 }}>
          <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20 }}>Campaign Engagement & Analytics</h3>
          <AnalyticsDashboard campaignId={selectedCampaign.campaign_id} />
        </div>

        {/* Campaign Submissions Listing */}
        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Delivered Submissions ({campaignSubs.length})</h3>
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
                    <tr key={s.submission_id}>
                      <td className="fw-600">{s.creator_name}</td>
                      <td style={{ textTransform: 'capitalize' }}>
                        {s.platform === 'tiktok' ? '🎵 TikTok' : s.platform === 'instagram' ? '📸 Instagram' : '🎥 ' + s.platform}
                      </td>
                      <td>{s.submission_type}</td>
                      <td>
                        <span className="badge badge-green">{s.final_status}</span>
                      </td>
                      <td>
                        {s.posted_link ? (
                          <a href={s.posted_link} target="_blank" rel="noreferrer" className="text-blue" style={{ fontWeight: 500 }}>
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
      <div className="mb-24">
        <h2 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Campaign Overview</h2>
        <p style={{ color: 'var(--ink3)', marginTop: 4 }}>Monitor progress, details, and active brief setups across your brand portfolio.</p>
      </div>

      <div className="grid-2">
        {clientCampaigns.length === 0 ? (
          <div className="premium-card text-center" style={{ gridColumn: 'span 2', padding: 48 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📢</div>
            <h3>No campaigns found</h3>
            <p style={{ color: 'var(--ink3)' }}>We haven't launched any campaign cycles in this brand workspace yet.</p>
          </div>
        ) : (
          clientCampaigns.map(c => {
            const subs = getSubmissionsForCampaign(c.campaign_id);
            return (
              <div key={c.campaign_id} className="premium-card hover-card" style={{ padding: 24, cursor: 'pointer', transition: 'transform 0.2s, box-shadow 0.2s' }} onClick={() => setSelectedCampaign(c)}>
                <div className="flex-between mb-16">
                  <div className="fw-700" style={{ fontSize: 18, color: 'var(--ink)' }}>{c.campaign_name}</div>
                  <span className={`badge ${c.campaign_status === 'Active' ? 'badge-green' : 'badge-orange'}`}>
                    {c.campaign_status}
                  </span>
                </div>
                <div style={{ color: 'var(--ink3)', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Approved Posts Delivered:</span>
                    <strong style={{ color: 'var(--ink)' }}>{subs.length} posts</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Launch Date:</span>
                    <strong style={{ color: 'var(--ink)' }}>{fmtDate(c.created_at)}</strong>
                  </div>
                </div>
                <div style={{ marginTop: 20, textAlign: 'right' }}>
                  <span className="text-blue" style={{ fontSize: 13, fontWeight: 600 }}>View Performance Details →</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENT 3: ClientContentGallery
// ============================================================================
export function ClientContentGallery({ user, db }) {
  const [platformFilter, setPlatformFilter] = useState('all');

  const filteredSubmissions = useMemo(() => {
    if (platformFilter === 'all') return db.submissions;
    return db.submissions.filter(s => s.platform === platformFilter);
  }, [db.submissions, platformFilter]);

  // Helper to find metrics for a submission
  const getMetrics = (subId) => {
    if (!db.analytics) return null;
    return db.analytics.find(a => a.submission_id === subId) || null;
  };

  const getEngagementRate = (m) => {
    if (!m || !m.views || m.views === 0) return '0%';
    const totalEng = (m.likes || 0) + (m.comments || 0) + (m.shares || 0);
    return ((totalEng / m.views) * 100).toFixed(2) + '%';
  };

  return (
    <div className="content">
      <div className="mb-24 flex-between" style={{ flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Delivered Content Gallery</h2>
          <p style={{ color: 'var(--ink3)', marginTop: 4 }}>Access approved creator assets and live verified stats.</p>
        </div>
        
        {/* Platform Filter Controls */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={`btn btn-sm ${platformFilter === 'all' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setPlatformFilter('all')}>
            All platforms
          </button>
          <button className={`btn btn-sm ${platformFilter === 'tiktok' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setPlatformFilter('tiktok')}>
            🎵 TikTok
          </button>
          <button className={`btn btn-sm ${platformFilter === 'instagram' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setPlatformFilter('instagram')}>
            📸 Instagram
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: 24 }}>
        {filteredSubmissions.length === 0 ? (
          <div className="premium-card text-center" style={{ gridColumn: 'span 3', padding: 48 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🎬</div>
            <h3>No creative assets delivered</h3>
            <p style={{ color: 'var(--ink3)', marginTop: 8 }}>Approved campaign submissions will dynamically populate in this workspace.</p>
          </div>
        ) : (
          filteredSubmissions.map(s => {
            const m = getMetrics(s.submission_id);
            const campaign = db.campaigns.find(c => c.campaign_id === s.campaign_id);
            return (
              <div key={s.submission_id} className="premium-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, border: '1px solid var(--border)' }}>
                {/* Creator and Campaign Headers */}
                <div className="flex-between">
                  <div>
                    <div className="fw-700" style={{ fontSize: 16, color: 'var(--ink)' }}>{s.creator_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 2 }}>
                      {campaign ? campaign.campaign_name : 'Campaign'}
                    </div>
                  </div>
                  <span className="badge badge-green" style={{ fontSize: 10 }}>Approved Asset</span>
                </div>

                {/* Submissions Info Body */}
                <div style={{ fontSize: 13, background: 'var(--bg)', padding: '12px 16px', borderRadius: 'var(--radius-sm)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--ink3)' }}>Platform:</span>
                    <strong style={{ textTransform: 'capitalize' }}>
                      {s.platform === 'tiktok' ? '🎵 TikTok' : s.platform === 'instagram' ? '📸 Instagram' : s.platform}
                    </strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--ink3)' }}>Asset Type:</span>
                    <strong>{s.submission_type}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--ink3)' }}>Delivered:</span>
                    <strong>{fmtDate(s.created_at)}</strong>
                  </div>
                </div>

                {/* Post Metrics Details */}
                <div style={{ borderTop: '1px solid var(--border2)', paddingTop: 14 }}>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--ink3)', letterSpacing: 0.5, marginBottom: 8, fontWeight: 600 }}>
                    Verified Performance Metrics
                  </div>
                  
                  {m ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', fontSize: 13 }}>
                      <div className="flex-between" style={{ borderBottom: '1px solid var(--border2)', paddingBottom: 4 }}>
                        <span style={{ color: 'var(--ink3)' }}>Views:</span>
                        <strong style={{ color: 'var(--ink)' }}>{fmtNum(m.views)}</strong>
                      </div>
                      <div className="flex-between" style={{ borderBottom: '1px solid var(--border2)', paddingBottom: 4 }}>
                        <span style={{ color: 'var(--ink3)' }}>Likes:</span>
                        <strong style={{ color: 'var(--ink)' }}>{fmtNum(m.likes)}</strong>
                      </div>
                      <div className="flex-between" style={{ borderBottom: '1px solid var(--border2)', paddingBottom: 4 }}>
                        <span style={{ color: 'var(--ink3)' }}>Engagement:</span>
                        <strong style={{ color: 'var(--ink)' }}>{getEngagementRate(m)}</strong>
                      </div>
                      <div className="flex-between" style={{ borderBottom: '1px solid var(--border2)', paddingBottom: 4 }}>
                        <span style={{ color: 'var(--ink3)' }}>Reach:</span>
                        <strong style={{ color: 'var(--ink)' }}>{fmtNum(m.reach)}</strong>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--ink3)', fontStyle: 'italic', padding: '6px 0' }}>
                      Metrics update pending next social sync cycle...
                    </div>
                  )}
                </div>

                {/* Live Link Button */}
                <div style={{ marginTop: 'auto', paddingTop: 12 }}>
                  {s.posted_link ? (
                    <a href={s.posted_link} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm btn-full" style={{ textAlign: 'center', display: 'block', textDecoration: 'none' }}>
                      Open Original Post 🔗
                    </a>
                  ) : (
                    <button className="btn btn-ghost btn-sm btn-full" disabled>
                      Post Link Unavailable
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
