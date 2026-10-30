import { useState } from 'react';
import { ChartLineData01Icon } from '@hugeicons/core-free-icons';
import { AreaChart, ShareBars } from '../ui/charts';
import EmptyState from '../ui/EmptyState';
import Segmented from '../ui/Segmented';
import { calcPacing, daysLeftLabel, fmtCompactNum, fmtNum, fmtPct, platformMeta } from '../utils';
import useDashboardData, { RANGES } from './dashboard/useDashboardData';
import TopPostsShowcase from './TopPostsShowcase';
import VideoThumb from '../ui/VideoThumb';
import Select from "../ui/Select";

const PLATFORM_KEYS = ['tiktok', 'instagram', 'youtube', 'facebook'];
const ACTIVE = new Set(['Active', 'Open', 'In Progress']);

function Filters({ data, campaigns, creators }) {
  const { filters, set, clear, active } = data;
  const togglePlatform = (k) => set({ platforms: filters.platforms.includes(k) ? filters.platforms.filter(p => p !== k) : [...filters.platforms, k] });
  return (
    <div className="toolbar">
      <label className="toolbar-field"><span className="sr-only">Campaign</span>
        <Select className="select" value={filters.campaign} onChange={e => set({ campaign: e.target.value })}>
          <option value="all">All campaigns</option>
          {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </label>
      <label className="toolbar-field"><span className="sr-only">Time range</span>
        <Select className="select" value={filters.range} onChange={e => set({ range: e.target.value })}>{RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
      </label>
      {filters.range === 'custom' && (
        <span className="toolbar-field flex gap-8">
          <input className="form-input" type="date" aria-label="From" value={filters.from} max={filters.to || undefined} onChange={e => set({ from: e.target.value })} />
          <input className="form-input" type="date" aria-label="To" value={filters.to} min={filters.from || undefined} onChange={e => set({ to: e.target.value })} />
        </span>
      )}
      {creators.length > 1 && (
        <label className="toolbar-field"><span className="sr-only">Creator</span>
          <Select className="select" value={filters.creator} onChange={e => set({ creator: e.target.value })}>
            <option value="all">All creators</option>
            {creators.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </label>
      )}
      <div className="chip-row" role="group" aria-label="Platforms">
        {PLATFORM_KEYS.map(k => <button key={k} className="chip" aria-pressed={filters.platforms.includes(k)} onClick={() => togglePlatform(k)}>{platformMeta(k).name}</button>)}
      </div>
      {active > 0 && <button className="btn btn-ghost btn-sm" onClick={clear}>Clear filters</button>}
    </div>
  );
}

export default function UGCDashboardView({ campaigns = [], submissions = [], analytics = [], creators = [], showTopPosts = true, onNavigate = null, onSelectPost , showDelivery = true }) {
  const data = useDashboardData({ campaigns, submissions, analytics, creators });
  const [mode, setMode] = useState('daily');
  const { totals, daily, byPlatform, shown, posts } = data;

  let running = 0;
  const series = mode === 'total' ? daily.map(d => ({ ...d, value: (running += d.value) })) : daily;
  const top = shown.reduce((a, b) => (!a || (b.views || 0) > (a.views || 0) ? b : a), null);
  const liveCampaigns = campaigns.filter(c => ACTIVE.has(c.status));
  const approvedFor = (id) => submissions.filter(s => s.campaign_id === id && (s.status === 'Approved' || s.status === 'Published/Tracked')).length;

  return (
    <div className="flex-col gap-24">
      <Filters data={data} campaigns={campaigns} creators={creators} />

      <div className="stats-grid" style={{ marginBottom: 0 }}>
        <div className="stat-card stat-highlight"><div className="stat-label">Views</div><div className="stat-value">{fmtCompactNum(totals.views)}</div><div className="stat-sub">{fmtNum(totals.views)} in total</div></div>
        <div className="stat-card"><div className="stat-label">Videos delivered</div><div className="stat-value">{fmtNum(totals.videos)}</div><div className="stat-sub">{fmtCompactNum(totals.avg)} views each on average</div></div>
        <div className="stat-card"><div className="stat-label">Engagement rate</div><div className="stat-value">{fmtPct(totals.er)}</div><div className="stat-sub">{fmtCompactNum(totals.likes)} likes · {fmtCompactNum(totals.comments)} comments</div></div>
        <div className="stat-card"><div className="stat-label">Shares and saves</div><div className="stat-value">{fmtCompactNum(totals.shares + totals.saves)}</div><div className="stat-sub">{fmtCompactNum(totals.shares)} shares · {fmtCompactNum(totals.saves)} saves</div></div>
      </div>

      {posts.length === 0 ? (
        <div className="card"><EmptyState icon={ChartLineData01Icon} title="No delivered videos yet">Views and engagement show up here once the first video is approved and posted.</EmptyState></div>
      ) : (
        <div className="dash-grid">
          <section className="card card-stacked">
            <div className="card-head">
              <div><h2 className="card-title">Views by post date</h2><p className="card-desc">Current views of the videos posted each day.</p></div>
              <Segmented label="Chart mode" value={mode} onChange={setMode} options={[['daily', 'Daily'], ['total', 'Running total']]} />
            </div>
            {series.length > 1
              ? <AreaChart data={series} height={240} ariaLabel="Views by post date" formatLabel={(l, long) => new Date(l).toLocaleDateString('en-US', long ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' })} format={(v, long) => (long ? fmtNum(v) : fmtCompactNum(v))} />
              : <EmptyState compact icon={ChartLineData01Icon} title={shown.length ? 'Not enough days to chart' : 'No videos match these filters'}
                  action={!shown.length && <button className="btn btn-secondary btn-sm" onClick={data.clear}>Clear filters</button>}>
                  {shown.length ? 'Every matching video was posted on the same day.' : 'Widen the date range or pick another campaign.'}
                </EmptyState>}
          </section>
          <section className="card">
            <div className="card-head"><div><h2 className="card-title">Views by platform</h2><p className="card-desc">Share of views across the filtered videos.</p></div></div>
            {byPlatform.length ? <ShareBars items={byPlatform.map(([k, v]) => ({ label: platformMeta(k).name, value: v }))} /> : <p className="fs-13 text-muted">No views yet.</p>}
            {top && (
              <div className="top-pick">
                <span className="fs-12 text-muted">Most viewed</span>
                <button type="button" className="top-pick-row" onClick={onSelectPost ? () => onSelectPost(top) : undefined} disabled={!onSelectPost}>
                  <VideoThumb sub={top} width={40} platform={top.platformKey} />
                  <span className="min-w-0"><span className="fw-600 text-ink truncate" style={{ display: 'block' }}>{top.creatorName}</span><span className="fs-12 text-muted truncate" style={{ display: 'block' }}>{top.campaignName}</span></span>
                  <strong className="tnum">{fmtCompactNum(top.views)}</strong>
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      {showTopPosts && <TopPostsShowcase posts={shown} title="Top videos" subtitle="Ranked by views across the current filters." onSelect={onSelectPost} />}

      {showDelivery && liveCampaigns.length > 0 && (
        <section>
          <div className="flex-between mb-12">
            <h2 className="section-title" style={{ margin: 0 }}>Campaign delivery</h2>
            {onNavigate && <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('campaigns')}>All campaigns</button>}
          </div>
          <div className="card flush">
            {liveCampaigns.slice(0, 8).map(c => {
              const done = approvedFor(c.id);
              const pacing = calcPacing({ startDate: c.start_date || c.created_at, deadline: c.deadline, videosNeeded: c.videos_needed || 10, approvedCount: done });
              return (
                <div key={c.id} className="delivery-row">
                  <div className="flex-1"><div className="fw-600 fs-14 truncate">{c.name}</div><div className="fs-12 text-muted">{daysLeftLabel(c.deadline)}</div></div>
                  <div className="delivery-bar">
                    <div className="flex-between fs-12 mb-4"><span className="text-muted tnum">{done} of {c.videos_needed || 0}</span><span className="fw-600 tnum">{pacing.deliveryPct}%</span></div>
                    <div className="progress-bar"><div className="progress-fill" style={{ width: `${Math.min(100, pacing.deliveryPct)}%` }} /></div>
                  </div>
                  <span className={`badge ${pacing.paceBadge}`}>{pacing.paceLabel}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
