import { useState } from "react";
import { GridViewIcon, Search01Icon, TableIcon, Video01Icon } from "@hugeicons/core-free-icons";
import EmptyState from "../ui/EmptyState";
import Icon from "../ui/Icon";
import { fmtCompactNum } from "../utils";
import PostCard from "./posts/PostCard";
import PostsTable from "./posts/PostsTable";
import usePosts from "./posts/usePosts";

const PLATFORM_OPTIONS = [["all", "All platforms"], ["tiktok", "TikTok"], ["instagram", "Instagram"], ["youtube", "YouTube"], ["facebook", "Facebook"]];
const RANGE_OPTIONS = [["all", "All time"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["month", "This month"]];
const SORT_OPTIONS = [["views", "Most views"], ["likes", "Most likes"], ["engRate", "Highest engagement"], ["recent", "Newest"]];

function Select({ label, value, onChange, options }) {
  return (
    <label className="toolbar-field">
      <span className="sr-only">{label}</span>
      <select className="select" value={value} onChange={e => onChange(e.target.value)}>
        {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </label>
  );
}

export default function PostsGalleryView({ submissions = [], analytics = [], creators = [], campaigns = [], title, subtitle, initialView = "gallery", onSelect, emptyText }) {
  const [view, setView] = useState(initialView);
  const { posts, shown, totals, filters, set, active, clear } = usePosts({ submissions, analytics, creators, campaigns });
  const usedCampaigns = campaigns.filter(c => posts.some(p => p.campaign_id === c.id));
  const usedCreators = creators.filter(c => posts.some(p => p.creator_id === c.id));

  return (
    <section>
      {(title || subtitle) && (
        <div className="mb-16">
          {title && <h2 className="section-title" style={{ marginBottom: 2 }}>{title}</h2>}
          {subtitle && <p className="fs-13 text-muted">{subtitle}</p>}
        </div>
      )}

      <div className="toolbar">
        <label className="toolbar-search">
          <Icon icon={Search01Icon} size={16} />
          <span className="sr-only">Search posts</span>
          <input className="form-input" type="search" placeholder="Search creator or campaign" value={filters.search} onChange={e => set({ search: e.target.value })} />
        </label>
        <Select label="Platform" value={filters.platform} onChange={v => set({ platform: v })} options={PLATFORM_OPTIONS} />
        {usedCampaigns.length > 1 && <Select label="Campaign" value={filters.campaign} onChange={v => set({ campaign: v })} options={[["all", "All campaigns"], ...usedCampaigns.map(c => [c.id, c.name])]} />}
        {usedCreators.length > 1 && <Select label="Creator" value={filters.creator} onChange={v => set({ creator: v })} options={[["all", "All creators"], ...usedCreators.map(c => [c.id, c.name])]} />}
        <Select label="Time range" value={filters.range} onChange={v => set({ range: v })} options={RANGE_OPTIONS} />
        <Select label="Sort" value={filters.sort} onChange={v => set({ sort: v })} options={SORT_OPTIONS} />
        <div className="segmented toolbar-view" role="group" aria-label="Layout">
          <button type="button" aria-pressed={view === "gallery"} onClick={() => setView("gallery")} aria-label="Gallery"><Icon icon={GridViewIcon} size={16} /></button>
          <button type="button" aria-pressed={view === "table"} onClick={() => setView("table")} aria-label="Table"><Icon icon={TableIcon} size={16} /></button>
        </div>
      </div>

      <div className="toolbar-summary">
        <span>{shown.length === posts.length ? `${posts.length} ${posts.length === 1 ? "video" : "videos"}` : `${shown.length} of ${posts.length} videos`}
          {active > 0 && <button className="text-btn" style={{ marginLeft: 8, fontWeight: 500 }} onClick={clear}>Clear filters</button>}
        </span>
        <span className="tnum">{fmtCompactNum(totals.views)} views · {fmtCompactNum(totals.likes)} likes · {fmtCompactNum(totals.comments)} comments</span>
      </div>

      {shown.length === 0 ? (
        <div className="card">
          <EmptyState icon={Video01Icon} title={posts.length ? "No videos match these filters" : "No delivered videos yet"}
            action={active > 0 && <button className="btn btn-secondary btn-sm" onClick={clear}>Clear filters</button>}>
            {posts.length ? "Try a wider time range or another platform." : (emptyText || "Approved videos appear here as soon as they're posted.")}
          </EmptyState>
        </div>
      ) : view === "gallery" ? (
        <div className="post-grid">{shown.map(p => <PostCard key={p.id} post={p} onSelect={onSelect} />)}</div>
      ) : (
        <PostsTable posts={shown} onSelect={onSelect} />
      )}
    </section>
  );
}
