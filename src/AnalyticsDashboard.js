import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from './supabaseClient';

const PLATFORMS = ['all', 'tiktok', 'instagram', 'facebook', 'youtube'];

// Normalize null/undefined/NaN numeric values to a dash for display.
const fmtNum = (val) => {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return '-';
  return Number(val).toLocaleString();
};

// engagement_rate is stored as a percentage (with 2-decimal precision) by the
// sync helper. Fall back to a JS calculation for legacy rows where it's null/0.
const fmtEngagement = (m) => {
  if (m.engagement_rate && Number(m.engagement_rate) > 0) {
    return `${Number(m.engagement_rate).toFixed(2)}%`;
  }
  const v = Number(m.views) || 0;
  if (v <= 0) return '0%';
  const eng = (Number(m.likes) || 0) + (Number(m.comments) || 0) + (Number(m.shares) || 0) + (Number(m.saves) || 0);
  return `${((eng / v) * 100).toFixed(2)}%`;
};

// Prefer the stored video_url; fall back to a platform-shaped link for legacy rows.
const linkFor = (m) => {
  if (m.video_url && /^https?:\/\//.test(m.video_url)) return m.video_url;
  if (!m.platform || !m.video_id) return null;
  switch (m.platform) {
    case 'youtube':   return `https://www.youtube.com/watch?v=${m.video_id}`;
    case 'instagram': return `https://www.instagram.com/p/${m.video_id}/`;
    case 'tiktok':    return `https://www.tiktok.com/video/${m.video_id}`;
    case 'facebook':  return `https://www.facebook.com/${m.video_id}`;
    default:          return null;
  }
};

export default function AnalyticsDashboard({ campaignId }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [metrics, setMetrics] = useState([]);
  const [platformFilter, setPlatformFilter] = useState('all');
  const [message, setMessage] = useState({ type: '', text: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('video_analytics')
        .select('*')
        .order('pulled_at', { ascending: false });
      if (campaignId) query = query.eq('campaign_id', campaignId);
      const { data, error } = await query;
      if (error) throw error;
      setMetrics(data || []);
    } catch (err) {
      console.error('Failed to load metrics:', err);
      setMessage({ type: 'error', text: 'Failed to load analytics.' });
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Filtered view per the platform dropdown
  const visibleMetrics = useMemo(() => {
    if (platformFilter === 'all') return metrics;
    return metrics.filter((m) => (m.platform || '').toLowerCase() === platformFilter);
  }, [metrics, platformFilter]);

  const rollups = useMemo(() => {
    const acc = { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 };
    for (const m of visibleMetrics) {
      acc.views += Number(m.views) || 0;
      acc.likes += Number(m.likes) || 0;
      acc.comments += Number(m.comments) || 0;
      acc.shares += Number(m.shares) || 0;
      acc.saves += Number(m.saves) || 0;
    }
    return acc;
  }, [visibleMetrics]);

  const lastSynced = visibleMetrics[0]?.pulled_at || null;

  // Manual refresh — POST /api/analytics/manual-sync. Server scopes by role.
  const handleRefresh = async () => {
    setRefreshing(true);
    setMessage({ type: '', text: '' });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not signed in');

      const body = {};
      if (platformFilter !== 'all') body.platform = platformFilter;

      const res = await fetch('/api/analytics/manual-sync', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok) {
        throw new Error((json.error && json.error.message) || 'Refresh failed');
      }

      const { updated, failed, processed, skipped } = json.data || {};
      setMessage({
        type: failed > 0 ? 'warn' : 'success',
        text: `Refreshed ${updated || 0} of ${processed || 0} videos. ${failed ? `${failed} failed.` : ''} ${skipped ? `${skipped} skipped.` : ''}`,
      });

      await loadData();
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Refresh failed' });
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 20 }}>Loading analytics…</div>;
  }

  const msgColors =
    message.type === 'success' ? { bg: '#dcfce7', fg: '#166534' } :
    message.type === 'warn'    ? { bg: '#fef3c7', fg: '#92400e' } :
                                  { bg: '#fee2e2', fg: '#991b1b' };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 'bold', margin: 0 }}>Campaign Analytics</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 13 }}
          >
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>{p === 'all' ? 'All platforms' : p[0].toUpperCase() + p.slice(1)}</option>
            ))}
          </select>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            style={{
              padding: '8px 14px', borderRadius: 6, border: 'none',
              background: '#0a0a0a', color: '#fff', cursor: refreshing ? 'wait' : 'pointer',
              fontSize: 13, fontWeight: 600,
            }}
          >
            {refreshing ? 'Refreshing…' : 'Refresh now'}
          </button>
        </div>
      </div>

      {lastSynced && (
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>
          Last synced: {new Date(lastSynced).toLocaleString()}
        </div>
      )}

      {message.text && (
        <div
          role="status"
          style={{ padding: 12, marginBottom: 16, borderRadius: 6, background: msgColors.bg, color: msgColors.fg, fontSize: 13 }}
        >
          {message.text}
        </div>
      )}

      {/* Rollups */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 32 }}>
        <RollupCard title="Views"    value={fmtNum(rollups.views)} />
        <RollupCard title="Likes"    value={fmtNum(rollups.likes)} />
        <RollupCard title="Comments" value={fmtNum(rollups.comments)} />
        <RollupCard title="Shares"   value={fmtNum(rollups.shares)} />
        <RollupCard title="Saves"    value={fmtNum(rollups.saves)} />
      </div>

      {/* Per-video table */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
        <div style={{ padding: 16, borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Post-level performance</h3>
        </div>

        {visibleMetrics.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
            No analytics yet. Click <strong>Refresh now</strong> to pull from connected platforms, or wait for the next 12-hour cron.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e5e7eb', color: '#6b7280', fontSize: 12, textTransform: 'uppercase' }}>
                  <th style={{ padding: '12px 16px' }}>Platform</th>
                  <th style={{ padding: '12px 16px' }}>Video</th>
                  <th style={{ padding: '12px 16px' }}>Views</th>
                  <th style={{ padding: '12px 16px' }}>Likes</th>
                  <th style={{ padding: '12px 16px' }}>Comments</th>
                  <th style={{ padding: '12px 16px' }}>Engagement</th>
                  <th style={{ padding: '12px 16px' }}>Synced</th>
                </tr>
              </thead>
              <tbody>
                {visibleMetrics.map((m) => {
                  const href = linkFor(m);
                  return (
                    <tr key={m.id || `${m.platform}-${m.video_id}-${m.submission_id}`} style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '12px 16px', textTransform: 'capitalize' }}>{m.platform || '-'}</td>
                      <td style={{ padding: '12px 16px', fontFamily: 'monospace', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {href ? (
                          <a href={href} target="_blank" rel="noreferrer noopener" style={{ color: '#2563eb' }}>
                            {m.video_id ? `${m.video_id.substring(0, 14)}${m.video_id.length > 14 ? '…' : ''}` : 'open'}
                          </a>
                        ) : (m.video_id || '-')}
                      </td>
                      <td style={{ padding: '12px 16px' }}>{fmtNum(m.views)}</td>
                      <td style={{ padding: '12px 16px' }}>{fmtNum(m.likes)}</td>
                      <td style={{ padding: '12px 16px' }}>{fmtNum(m.comments)}</td>
                      <td style={{ padding: '12px 16px' }}>{fmtEngagement(m)}</td>
                      <td style={{ padding: '12px 16px', color: '#6b7280', fontSize: 12 }}>
                        {m.pulled_at ? new Date(m.pulled_at).toLocaleDateString() : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function RollupCard({ title, value }) {
  return (
    <div style={{ padding: 20, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
