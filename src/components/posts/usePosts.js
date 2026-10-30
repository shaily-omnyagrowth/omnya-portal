import { useMemo, useState } from "react";
import { engagementRate, platformKey, viewsOf } from "../../utils";

const DAY = 86400000;

export function normalizePosts({ submissions, analytics, creators, campaigns }) {
  const byId = {};
  (analytics || []).forEach(a => { if (a.submission_id) byId[a.submission_id] = a; });
  return (submissions || []).map(s => {
    const a = byId[s.id];
    const views = viewsOf(s, a);
    const likes = Number(a?.likes ?? s.likes ?? 0);
    const comments = Number(a?.comments ?? s.comments ?? 0);
    const shares = Number(a?.shares ?? s.shares ?? 0);
    const saves = Number(a?.saves ?? s.saves ?? 0);
    const creator = (creators || []).find(c => c.id === s.creator_id);
    const campaign = (campaigns || []).find(c => c.id === s.campaign_id);
    return {
      ...s, analytics: a, views, likes, comments, shares, saves,
      engRate: engagementRate({ views, likes, comments, shares }),
      creatorName: creator?.name || s.creator_name || "Creator",
      campaignName: campaign?.name || "Campaign",
      platformKey: platformKey(a?.platform || s.platform || campaign?.format) || "other",
      postUrl: s.posted_link || s.posted_url || a?.video_url || null,
      date: new Date(s.posted_at || s.approved_date || s.created_at),
    };
  });
}

export default function usePosts(props) {
  const posts = useMemo(() => normalizePosts(props), [props.submissions, props.analytics, props.creators, props.campaigns]); // eslint-disable-line react-hooks/exhaustive-deps
  const [filters, setFilters] = useState({ search: "", platform: "all", campaign: "all", creator: "all", range: "all", sort: "views" });
  const set = (patch) => setFilters(f => ({ ...f, ...patch }));

  const shown = useMemo(() => {
    const now = Date.now();
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
    const q = filters.search.trim().toLowerCase();
    const list = posts.filter(p => {
      if (q && !`${p.creatorName} ${p.campaignName}`.toLowerCase().includes(q)) return false;
      if (filters.platform !== "all" && p.platformKey !== filters.platform) return false;
      if (filters.campaign !== "all" && p.campaign_id !== filters.campaign) return false;
      if (filters.creator !== "all" && p.creator_id !== filters.creator) return false;
      const t = p.date.getTime();
      if (filters.range === "7d" && t < now - 7 * DAY) return false;
      if (filters.range === "30d" && t < now - 30 * DAY) return false;
      if (filters.range === "month" && t < monthStart) return false;
      return true;
    });
    const by = { views: p => p.views, likes: p => p.likes, engRate: p => p.engRate, recent: p => p.date.getTime() }[filters.sort];
    return list.sort((a, b) => by(b) - by(a));
  }, [posts, filters]);

  const totals = useMemo(() => shown.reduce((t, p) => ({ views: t.views + p.views, likes: t.likes + p.likes, comments: t.comments + p.comments }), { views: 0, likes: 0, comments: 0 }), [shown]);
  const active = ["platform", "campaign", "creator", "range"].filter(k => filters[k] !== "all").length + (filters.search ? 1 : 0);

  return { posts, shown, totals, filters, set, active, clear: () => setFilters(f => ({ ...f, search: "", platform: "all", campaign: "all", creator: "all", range: "all" })) };
}
