import { useMemo, useState } from 'react';
import { Award01Icon, Search01Icon } from '@hugeicons/core-free-icons';
import EmptyState from '../ui/EmptyState';
import { BarChart } from '../ui/charts';
import Icon from '../ui/Icon';
import { engagementRate, fmtCompactNum, fmtPct, getInitials, isBreakoutVideo, viewsOf } from '../utils';
import Avatar from '../ui/Avatar';
import usePagination from '../ui/Pagination';

const LIVE = new Set(['Approved', 'Published/Tracked']);
const COLS = [['name', 'Creator'], ['videoCount', 'Videos'], ['totalViews', 'Views'], ['avgViews', 'Avg views'], ['er', 'Engagement'], ['breakouts', 'Breakouts']];

export default function CreatorLeaderboard({ creators = [], submissions = [], analytics = [] }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState(['totalViews', false]);
  const byId = useMemo(() => Object.fromEntries((analytics || []).filter(a => a.submission_id).map(a => [a.submission_id, a])), [analytics]);

  const rows = useMemo(() => creators.map(c => {
    const subs = submissions.filter(s => s.creator_id === c.id && LIVE.has(s.status));
    const m = subs.map(s => { const a = byId[s.id]; return { views: viewsOf(s, a), likes: Number(a?.likes ?? s.likes ?? 0), comments: Number(a?.comments ?? s.comments ?? 0), shares: Number(a?.shares ?? s.shares ?? 0) }; });
    const t = m.reduce((x, y) => ({ views: x.views + y.views, likes: x.likes + y.likes, comments: x.comments + y.comments, shares: x.shares + y.shares }), { views: 0, likes: 0, comments: 0, shares: 0 });
    const avg = subs.length ? Math.round(t.views / subs.length) : 0;
    return { ...c, videoCount: subs.length, totalViews: t.views, avgViews: avg, er: engagementRate(t), breakouts: m.filter(x => isBreakoutVideo(x.views, avg)).length };
  }).filter(c => c.videoCount > 0), [creators, submissions, byId]);

  const [key, asc] = sort;
  const shown = rows.filter(c => !q || `${c.name} ${c.email} ${c.tiktok_handle || ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (typeof a[key] === 'string' ? a[key].localeCompare(b[key]) : a[key] - b[key]) * (asc ? 1 : -1));
  const top = [...rows].sort((a, b) => b.totalViews - a.totalViews).slice(0, 8);
  const { rows: page, offset, pager } = usePagination(shown, { label: 'creators' });

  if (!rows.length) return <div className="card"><EmptyState icon={Award01Icon} title="No creators to rank yet">Creators show up here, ranked by views, once one of their videos is approved.</EmptyState></div>;

  return (
    <div className="flex-col gap-24">
      <section className="card card-stacked">
        <div className="card-head"><div><h2 className="card-title">Views by creator</h2><p className="card-desc">Top {top.length} creators by total views on approved videos.</p></div></div>
        <BarChart data={top.map(c => ({ label: getInitials(c.name), fullLabel: c.name, value: c.totalViews }))} height={200} ariaLabel="Views by creator" />
      </section>
      <section>
        <div className="toolbar">
          <label className="toolbar-search" style={{ maxWidth: 320 }}><Icon icon={Search01Icon} size={16} /><span className="sr-only">Search creators</span>
            <input className="form-input" type="search" placeholder="Search creators" value={q} onChange={e => setQ(e.target.value)} /></label>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th style={{ width: 40 }}>#</th>{COLS.map(([k, l]) => (
              <th key={k} className={k === 'name' ? '' : 'num'} aria-sort={key === k ? (asc ? 'ascending' : 'descending') : 'none'}>
                <button className="th-sort" onClick={() => setSort([k, key === k ? !asc : k === 'name'])}>{l}{key === k ? (asc ? ' ↑' : ' ↓') : ''}</button>
              </th>))}</tr></thead>
            <tbody>
              {page.map((c, i) => (
                <tr key={c.id}>
                  <td className="text-muted tnum">{offset + i + 1}</td>
                  <td><span className="flex-center gap-12"><Avatar name={c.name} /><span style={{ minWidth: 0 }}><span className="fw-600 truncate" style={{ display: 'block', color: 'var(--ink)', maxWidth: 240 }}>{c.name}</span><span className="fs-12 text-muted truncate" style={{ display: 'block', maxWidth: 240 }}>{c.tiktok_handle ? `@${c.tiktok_handle}` : c.email}</span></span></span></td>
                  <td className="num">{c.videoCount}</td>
                  <td className="num fw-600" style={{ color: 'var(--ink)' }}>{fmtCompactNum(c.totalViews)}</td>
                  <td className="num">{fmtCompactNum(c.avgViews)}</td>
                  <td className="num">{fmtPct(c.er)}</td>
                  <td className="num">{c.breakouts || '--'}</td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={COLS.length + 1}><EmptyState compact icon={Search01Icon} title={`No creators match "${q}"`} action={<button className="btn btn-secondary btn-sm" onClick={() => setQ('')}>Clear search</button>}>Try a name, email or handle.</EmptyState></td></tr>}
            </tbody>
          </table>
        </div>
        {pager}
      </section>
    </div>
  );
}
