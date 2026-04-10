import React, { useState, useEffect, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://aglikzyarmqbdmjvkvyj.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnbGlrenlhcm1xYmRtanZrdnlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3MjMwNDcsImV4cCI6MjA4NzI5OTA0N30.vYAk33Z_x5lWkKc6zUhTxhHiWo2cZgk3dYmO7c0I6GM";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default function AnalyticsDashboard({ campaignId }) {
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState([]);
  const [lastRefreshed, setLastRefreshed] = useState(null);

  // 1. Data Normalization & Fallbacks
  // Note: While the backend normalizes TikTok/Ig responses via /api/analytics/fetch,
  // we do a UI-layer sanitization here to ensure safe rendering of missing data.
  const normalizeValues = (val) => {
    if (val === null || val === undefined || isNaN(val)) return '-';
    return val.toLocaleString();
  };

  const getEngagementRate = (metric) => {
    if (metric.views === 0 || !metric.views) return '0%';
    const totalEng = (metric.likes || 0) + (metric.comments || 0) + (metric.shares || 0);
    return ((totalEng / metric.views) * 100).toFixed(2) + '%';
  };

  // 2. Fetch Stale-While-Revalidate Strategy
  // Initially loads instant Supabase cache.
  // In a real app, this logic checks if pulled_at > 12h and hits /api/analytics/fetch
  useEffect(() => {
    let active = true;
    async function loadData() {
      setLoading(true);
      try {
        let query = supabase.from('video_analytics').select('*').order('pulled_at', { ascending: false });
        if (campaignId) query = query.eq('campaign_id', campaignId);
        
        const { data, error } = await query;
        if (error) throw error;
        
        if (active) {
            setMetrics(data || []);
            setLastRefreshed(data?.[0]?.pulled_at || null);
        }
      } catch (err) {
        console.error('Failed to load metrics:', err);
      } finally {
        if (active) setLoading(false);
      }
    }
    loadData();
    return () => { active = false; };
  }, [campaignId]);

  // 3. Campaign Rollups (Aggregations)
  const rollups = useMemo(() => {
    const defaultStats = { totalViews: 0, totalLikes: 0, totalComments: 0, totalShares: 0 };
    if (!metrics.length) return defaultStats;
    
    return metrics.reduce((acc, m) => {
        acc.totalViews += m.views || 0;
        acc.totalLikes += m.likes || 0;
        acc.totalComments += m.comments || 0;
        acc.totalShares += m.shares || 0;
        return acc;
    }, defaultStats);
  }, [metrics]);

  if (loading) {
    return <div style={{ padding: 20 }}>Generating Analytics Vectors...</div>;
  }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 'bold', margin: 0 }}>Campaign Analytics</h2>
        {lastRefreshed && (
           <span style={{ fontSize: '12px', color: '#6b7280' }}>
             Last Synced: {new Date(lastRefreshed).toLocaleString()}
           </span>
        )}
      </div>

      {/* Row 1: Campaign Rollups */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '32px' }}>
        <RollupCard title="Total Views" value={normalizeValues(rollups.totalViews)} />
        <RollupCard title="Total Likes" value={normalizeValues(rollups.totalLikes)} />
        <RollupCard title="Total Comments" value={normalizeValues(rollups.totalComments)} />
        <RollupCard title="Total Shares" value={normalizeValues(rollups.totalShares)} />
      </div>

      {/* Row 2: Submissions Post-Level Table */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden', backgroundColor: '#fff' }}>
        <div style={{ padding: '16px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '600', margin: 0 }}>Post-Level Performance</h3>
        </div>
        
        {metrics.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
            No analytics data synced yet. Wait for scheduled fetch, or ensure creators are connected.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb', color: '#6b7280', fontSize: '12px', textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 16px' }}>Platform</th>
                <th style={{ padding: '12px 16px' }}>Video ID</th>
                <th style={{ padding: '12px 16px' }}>Views</th>
                <th style={{ padding: '12px 16px' }}>Likes</th>
                <th style={{ padding: '12px 16px' }}>Engagement</th>
                <th style={{ padding: '12px 16px' }}>Reach</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map(m => (
                <tr key={`${m.platform}-${m.video_id}`} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '12px 16px', textTransform: 'capitalize' }}>{m.platform}</td>
                  <td style={{ padding: '12px 16px', fontFamily: 'monospace' }}>
                    <a href={`https://${m.platform}.com/video/${m.video_id}`} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>
                      {m.video_id?.substring(0, 10)}...
                    </a>
                  </td>
                  <td style={{ padding: '12px 16px' }}>{normalizeValues(m.views)}</td>
                  <td style={{ padding: '12px 16px' }}>{normalizeValues(m.likes)}</td>
                  <td style={{ padding: '12px 16px' }}>{getEngagementRate(m)}</td>
                  <td style={{ padding: '12px 16px' }}>{normalizeValues(m.reach)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function RollupCard({ title, value }) {
  return (
    <div style={{ padding: '20px', border: '1px solid #e5e7eb', borderRadius: '8px', background: '#fff' }}>
      <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '8px' }}>{title}</div>
      <div style={{ fontSize: '28px', fontWeight: 'bold' }}>{value}</div>
    </div>
  );
}
