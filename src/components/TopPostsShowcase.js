import { useState } from 'react';
import { engagementRate, platformKey } from '../utils';
import PostCard from './posts/PostCard';

const shape = (p) => ({
  ...p,
  views: Number(p.views || 0), likes: Number(p.likes || 0), comments: Number(p.comments || 0), shares: Number(p.shares || 0),
  engRate: p.engRate ?? engagementRate({ views: Number(p.views || 0), likes: p.likes, comments: p.comments, shares: p.shares }),
  platformKey: p.platformKey || platformKey(p.platform) || 'other',
  postUrl: p.postUrl || p.posted_link || p.posted_url || p.video_url || null,
  date: p.date || new Date(p.posted_at || p.approved_date || p.created_at || Date.now()),
  creatorName: p.creatorName || p.creator_name || 'Creator',
  campaignName: p.campaignName || p.campaign_name || 'Campaign',
});

export default function TopPostsShowcase({ posts = [], title = 'Top posts', subtitle, limit = 10, onSelect }) {
  const [all, setAll] = useState(false);
  const sorted = posts.map(shape).sort((a, b) => b.views - a.views);
  if (!sorted.length) return null;
  const shown = all ? sorted : sorted.slice(0, limit);
  return (
    <section>
      <div className="flex-between mb-12">
        <div><h2 className="section-title" style={{ margin: 0 }}>{title}</h2>{subtitle && <p className="fs-13 text-muted">{subtitle}</p>}</div>
        {sorted.length > limit && <button className="btn btn-ghost btn-sm" onClick={() => setAll(a => !a)}>{all ? 'Show top 10' : `Show all ${sorted.length}`}</button>}
      </div>
      <div className={all ? "post-grid" : "post-strip"}>{shown.map(p => <PostCard key={p.id} post={p} onSelect={onSelect} />)}</div>
    </section>
  );
}
