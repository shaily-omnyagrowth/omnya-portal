import { useMemo, useState } from "react";
import CreatorLeaderboard from "../../components/CreatorLeaderboard";
import PostsGalleryView from "../../components/PostsGalleryView";
import TopPostsShowcase from "../../components/TopPostsShowcase";
import { fmtCompactNum, fmtNum } from "../../utils";

export default function Analytics({ db }) {
  const [activeTab, setActiveTab] = useState("overview"); // 'overview' | 'leaderboard' | 'gallery'

  const analyticsMap = useMemo(() => {
    const map = {};
    (db.analytics || []).forEach(a => { if (a.submission_id) map[a.submission_id] = a; });
    return map;
  }, [db.analytics]);

  const approvedSubs = useMemo(() => {
    return (db.submissions || []).filter(s => s.status === "Approved");
  }, [db.submissions]);

  // "Approved" is a decision; "Posted" is a fact. An approved video with no
  // posted_link has not gone live yet, and it is also the one the social sync
  // can do nothing with — it has no URL to read views from. Showing both
  // numbers is what makes that gap visible instead of looking like missing data.
  const postedSubs = useMemo(() => {
    return approvedSubs.filter(s => (s.posted_link || "").trim() !== "");
  }, [approvedSubs]);

  const enrichedPosts = useMemo(() => {
    return approvedSubs.map(s => {
      const a = analyticsMap[s.id];
      const views = Number(a?.views || s.views_1w || s.views_72h || s.views_24h || 0);
      const likes = Number(a?.likes || s.likes || 0);
      const comments = Number(a?.comments || s.comments || 0);
      const shares = Number(a?.shares || s.shares || 0);
      const saves = Number(a?.saves || s.saves || 0);
      const creator = db.creators.find(c => c.id === s.creator_id);
      const campaign = db.campaigns.find(c => c.id === s.campaign_id);
      return {
        ...s,
        views, likes, comments, shares, saves,
        creatorName: creator?.name || 'Creator',
        campaignName: campaign?.name || 'Campaign',
        platform: (a?.platform || s.platform || campaign?.format || 'tiktok').toLowerCase()
      };
    }).sort((a, b) => b.views - a.views);
  }, [approvedSubs, analyticsMap, db.creators, db.campaigns]);

  const totals = useMemo(() => {
    const acc = { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 };
    enrichedPosts.forEach(p => {
      acc.views += p.views;
      acc.likes += p.likes;
      acc.comments += p.comments;
      acc.shares += p.shares;
      acc.saves += p.saves;
    });
    const eng = acc.likes + acc.comments + acc.shares + acc.saves;
    const engRate = acc.views > 0 ? ((eng / acc.views) * 100).toFixed(2) + '%' : '0.00%';
    return { ...acc, eng, engRate };
  }, [enrichedPosts]);

  return (
    <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Top Banner & Tab Controls */}
      <div className="flex-between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: 'var(--ink)' }}>
            Performance & Analytics Suite
          </h2>
          <p style={{ color: 'var(--ink3)', fontSize: 13, marginTop: 4 }}>
            Real-time verified impressions, creator rankings, and viral content detection
          </p>
        </div>

        <div style={{
          display: 'flex',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: 2
        }}>
          <button
            className={`btn btn-sm ${activeTab === 'overview' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ padding: '5px 12px', fontSize: 12, borderRadius: 4 }}
            onClick={() => setActiveTab('overview')}
          >
            📊 Overview
          </button>
          <button
            className={`btn btn-sm ${activeTab === 'leaderboard' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ padding: '5px 12px', fontSize: 12, borderRadius: 4 }}
            onClick={() => setActiveTab('leaderboard')}
          >
            🏆 Leaderboard
          </button>
          <button
            className={`btn btn-sm ${activeTab === 'gallery' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ padding: '5px 12px', fontSize: 12, borderRadius: 4 }}
            onClick={() => setActiveTab('gallery')}
          >
            🎴 Content Gallery
          </button>
        </div>
      </div>

      {/* Aggregate KPI Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 14
      }}>
        <div className="stat-card stat-highlight">
          <div className="stat-label">Total Verified Views</div>
          <div className="stat-value">{fmtCompactNum(totals.views)}</div>
          <div className="stat-sub">{fmtNum(totals.views)} impressions</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Engagement Rate</div>
          <div className="stat-value text-green">{totals.engRate}</div>
          <div className="stat-sub">{fmtCompactNum(totals.eng)} total interactions</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Approved Videos</div>
          <div className="stat-value">{approvedSubs.length}</div>
          <div className="stat-sub">{db.submissions.filter(s=>s.status==="Submitted"||s.status==="Under Review").length} pending</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Posted Videos</div>
          <div className="stat-value">{postedSubs.length}</div>
          <div className="stat-sub">{approvedSubs.length-postedSubs.length} approved, not live yet</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Likes</div>
          <div className="stat-value">{fmtCompactNum(totals.likes)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Comments</div>
          <div className="stat-value">{fmtCompactNum(totals.comments)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Shares & Reposts</div>
          <div className="stat-value">{fmtCompactNum(totals.shares)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Saves / Bookmarks</div>
          <div className="stat-value">{fmtCompactNum(totals.saves)}</div>
        </div>
      </div>

      {/* Tab 1: Overview (Top Posts + Creator Leaderboard Preview) */}
      {activeTab === 'overview' && (
        <>
          <TopPostsShowcase
            posts={enrichedPosts}
            title="Top Performing Agency Content"
            subtitle="Top videos ranked by verified reach and engagement"
          />

          <CreatorLeaderboard
            creators={db.creators}
            submissions={db.submissions}
            analytics={db.analytics}
            campaigns={db.campaigns}
          />
        </>
      )}

      {/* Tab 2: Leaderboard Focused */}
      {activeTab === 'leaderboard' && (
        <CreatorLeaderboard
          creators={db.creators}
          submissions={db.submissions}
          analytics={db.analytics}
          campaigns={db.campaigns}
        />
      )}

      {/* Tab 3: Content Gallery */}
      {activeTab === 'gallery' && (
        <PostsGalleryView
          submissions={approvedSubs}
          analytics={db.analytics}
          creators={db.creators}
          campaigns={db.campaigns}
          title="All Delivered Content Assets"
          subtitle="Filter by creator, campaign, platform, and date range with live watch links"
        />
      )}
    </div>
  );
}
