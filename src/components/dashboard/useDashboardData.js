import { useMemo, useState } from 'react';
import { engagementRate, platformKey, viewsOf } from '../../utils';

const LIVE = new Set(['Approved', 'Published/Tracked']);
const DAY = 86400000;

export const RANGES = [['all', 'All time'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['this_month', 'This month'], ['last_month', 'Last month'], ['this_year', 'This year'], ['custom', 'Custom range']];

function inRange(d, range, from, to) {
  if (range === 'all' || !d) return true;
  const now = new Date();
  if (range === '7d') return d >= new Date(now - 7 * DAY);
  if (range === '30d') return d >= new Date(now - 30 * DAY);
  if (range === 'this_month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  if (range === 'last_month') { const s = new Date(now.getFullYear(), now.getMonth() - 1, 1); return d >= s && d < new Date(now.getFullYear(), now.getMonth(), 1); }
  if (range === 'this_year') return d.getFullYear() === now.getFullYear();
  if (range === 'custom') return (!from || d >= new Date(from)) && (!to || d <= new Date(`${to}T23:59:59`));
  return true;
}

export default function useDashboardData({ campaigns, submissions, analytics, creators }) {
  const [filters, setFilters] = useState({ campaign: 'all', range: 'all', from: '', to: '', platforms: [], creator: 'all' });
  const set = (patch) => setFilters(f => ({ ...f, ...patch }));

  const byId = useMemo(() => {
    const m = {};
    (analytics || []).forEach(a => { if (a.submission_id) m[a.submission_id] = a; });
    return m;
  }, [analytics]);

  const posts = useMemo(() => (submissions || []).filter(s => LIVE.has(s.status)).map(s => {
    const a = byId[s.id];
    const campaign = (campaigns || []).find(c => c.id === s.campaign_id);
    return {
      ...s,
      views: viewsOf(s, a), likes: Number(a?.likes ?? s.likes ?? 0), comments: Number(a?.comments ?? s.comments ?? 0),
      shares: Number(a?.shares ?? s.shares ?? 0), saves: Number(a?.saves ?? s.saves ?? 0),
      platformKey: platformKey(a?.platform || s.platform || campaign?.format) || 'other',
      date: new Date(s.posted_at || s.approved_date || s.created_at),
      creatorName: s.creator_name || (creators || []).find(c => c.id === s.creator_id)?.name || 'Creator',
      campaignName: campaign?.name || 'Campaign',
      postUrl: s.posted_link || s.posted_url || a?.video_url || null,
      analytics: a,
    };
  }), [submissions, byId, campaigns, creators]);

  const shown = useMemo(() => posts.filter(p =>
    (filters.campaign === 'all' || p.campaign_id === filters.campaign) &&
    (!filters.platforms.length || filters.platforms.includes(p.platformKey)) &&
    (filters.creator === 'all' || p.creator_id === filters.creator) &&
    inRange(p.date, filters.range, filters.from, filters.to)), [posts, filters]);

  const totals = useMemo(() => {
    const t = shown.reduce((a, p) => ({ views: a.views + p.views, likes: a.likes + p.likes, comments: a.comments + p.comments, shares: a.shares + p.shares, saves: a.saves + p.saves }), { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 });
    return { ...t, videos: shown.length, er: engagementRate(t), avg: shown.length ? t.views / shown.length : 0 };
  }, [shown]);

  const daily = useMemo(() => {
    const m = {};
    shown.forEach(p => { if (isNaN(p.date)) return; const k = p.date.toISOString().slice(0, 10); m[k] = (m[k] || 0) + p.views; });
    const keys = Object.keys(m).sort();
    if (!keys.length) return [];
    // Fill gaps so the line reads as time, not as a list of posting days.
    const out = [];
    for (let d = new Date(keys[0]); d <= new Date(keys[keys.length - 1]); d = new Date(d.getTime() + DAY)) {
      const k = d.toISOString().slice(0, 10);
      out.push({ label: k, value: m[k] || 0 });
    }
    return out.length > 180 ? out.slice(-180) : out;
  }, [shown]);

  const byPlatform = useMemo(() => {
    const m = {};
    shown.forEach(p => { m[p.platformKey] = (m[p.platformKey] || 0) + p.views; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [shown]);

  const active = (filters.campaign !== 'all') + (filters.range !== 'all') + (filters.platforms.length > 0) + (filters.creator !== 'all');
  const clear = () => setFilters({ campaign: 'all', range: 'all', from: '', to: '', platforms: [], creator: 'all' });

  return { filters, set, clear, active, posts, shown, totals, daily, byPlatform };
}
