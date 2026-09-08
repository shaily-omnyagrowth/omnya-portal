import React, { useState, useMemo } from 'react';
import { fmtDate, fmtCompactNum, platformMeta, getAvatarColor, getInitials } from '../utils';

export default function PostsGalleryView({
  submissions = [],
  analytics = [],
  creators = [],
  campaigns = [],
  title = "Delivered Content Library",
  subtitle = "Filter and explore verified creator assets across campaigns",
  initialView = "gallery"
}) {
  const [viewMode, setViewMode] = useState(initialView); // 'gallery' | 'table'
  const [search, setSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [campaignFilter, setCampaignFilter] = useState('all');
  const [creatorFilter, setCreatorFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [sortBy, setSortBy] = useState('views'); // 'views' | 'likes' | 'engRate' | 'recent'

  // Map analytics by submission_id
  const analyticsMap = useMemo(() => {
    const map = {};
    (analytics || []).forEach(a => {
      if (a.submission_id) map[a.submission_id] = a;
    });
    return map;
  }, [analytics]);

  // Normalize posts with calculated metrics
  const normalizedPosts = useMemo(() => {
    return submissions.map(s => {
      const a = analyticsMap[s.id];
      const views = Number(a?.views || s.views_1w || s.views_72h || s.views_24h || 0);
      const likes = Number(a?.likes || s.likes || 0);
      const comments = Number(a?.comments || s.comments || 0);
      const shares = Number(a?.shares || s.shares || 0);
      const saves = Number(a?.saves || s.saves || 0);
      const totalEng = likes + comments + shares + saves;
      const engRateNum = views > 0 ? (totalEng / views) * 100 : 0;

      const creator = creators.find(c => c.id === s.creator_id) || { name: 'Creator' };
      const campaign = campaigns.find(c => c.id === s.campaign_id) || { name: 'Campaign' };
      const platform = (a?.platform || s.platform || campaign.format || 'tiktok').toLowerCase();

      return {
        ...s,
        views,
        likes,
        comments,
        shares,
        saves,
        totalEng,
        engRateNum,
        engRateStr: engRateNum > 0 ? engRateNum.toFixed(1) + '%' : '0%',
        creatorName: creator.name,
        creatorTikTok: creator.tiktok_handle,
        creatorInstagram: creator.instagram_handle,
        campaignName: campaign.name,
        platform,
        postUrl: s.posted_link || s.concept_link || (a?.video_id ? `https://tiktok.com` : null),
        date: new Date(s.approved_date || s.created_at)
      };
    });
  }, [submissions, analyticsMap, creators, campaigns]);

  // Apply filters
  const filteredPosts = useMemo(() => {
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();

    let list = normalizedPosts.filter(p => {
      // Search
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchCreator = (p.creatorName || '').toLowerCase().includes(q);
        const matchCampaign = (p.campaignName || '').toLowerCase().includes(q);
        if (!matchCreator && !matchCampaign) return false;
      }

      // Platform
      if (platformFilter !== 'all' && !p.platform.includes(platformFilter)) {
        return false;
      }

      // Campaign
      if (campaignFilter !== 'all' && p.campaign_id !== campaignFilter) {
        return false;
      }

      // Creator
      if (creatorFilter !== 'all' && p.creator_id !== creatorFilter) {
        return false;
      }

      // Date
      if (dateFilter === '7d' && p.date.getTime() < sevenDaysAgo) return false;
      if (dateFilter === '30d' && p.date.getTime() < thirtyDaysAgo) return false;
      if (dateFilter === 'month' && p.date.getTime() < startOfMonth) return false;

      return true;
    });

    // Sorting
    list.sort((a, b) => {
      if (sortBy === 'views') return b.views - a.views;
      if (sortBy === 'likes') return b.likes - a.likes;
      if (sortBy === 'engRate') return b.engRateNum - a.engRateNum;
      if (sortBy === 'recent') return b.date.getTime() - a.date.getTime();
      return 0;
    });

    return list;
  }, [normalizedPosts, search, platformFilter, campaignFilter, creatorFilter, dateFilter, sortBy]);

  // Summary rollups for filtered set
  const rollups = useMemo(() => {
    return filteredPosts.reduce((acc, p) => {
      acc.views += p.views;
      acc.likes += p.likes;
      acc.comments += p.comments;
      acc.shares += p.shares;
      acc.saves += p.saves;
      return acc;
    }, { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 });
  }, [filteredPosts]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header & Controls */}
      <div className="flex-between" style={{ flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h3 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--ink)' }}>{title}</h3>
          <p style={{ color: 'var(--ink3)', fontSize: 13, marginTop: 4 }}>{subtitle}</p>
        </div>

        {/* View Switcher: Gallery vs Table */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{
            display: 'flex',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 2
          }}>
            <button
              onClick={() => setViewMode('gallery')}
              style={{
                border: 'none',
                background: viewMode === 'gallery' ? 'var(--blue)' : 'transparent',
                color: viewMode === 'gallery' ? '#fff' : 'var(--ink)',
                padding: '5px 12px',
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}
            >
              <span>🎴</span>
              <span>Gallery</span>
            </button>
            <button
              onClick={() => setViewMode('table')}
              style={{
                border: 'none',
                background: viewMode === 'table' ? 'var(--blue)' : 'transparent',
                color: viewMode === 'table' ? '#fff' : 'var(--ink)',
                padding: '5px 12px',
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}
            >
              <span>📋</span>
              <span>Table</span>
            </button>
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="premium-card" style={{ padding: '16px 20px' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          alignItems: 'center'
        }}>
          {/* Search */}
          <div>
            <label className="form-label" style={{ fontSize: 11, marginBottom: 4 }}>Search</label>
            <input
              type="text"
              className="form-input"
              placeholder="Search creator, campaign..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ height: 34, fontSize: 12 }}
            />
          </div>

          {/* Platform Filter */}
          <div>
            <label className="form-label" style={{ fontSize: 11, marginBottom: 4 }}>Platform</label>
            <select
              className="select"
              value={platformFilter}
              onChange={e => setPlatformFilter(e.target.value)}
              style={{ height: 34, fontSize: 12 }}
            >
              <option value="all">All Platforms</option>
              <option value="tiktok">🎵 TikTok</option>
              <option value="instagram">📸 Instagram</option>
              <option value="youtube">▶️ YouTube</option>
              <option value="facebook">👥 Facebook</option>
            </select>
          </div>

          {/* Campaign Filter */}
          {campaigns.length > 0 && (
            <div>
              <label className="form-label" style={{ fontSize: 11, marginBottom: 4 }}>Campaign</label>
              <select
                className="select"
                value={campaignFilter}
                onChange={e => setCampaignFilter(e.target.value)}
                style={{ height: 34, fontSize: 12 }}
              >
                <option value="all">All Campaigns ({campaigns.length})</option>
                {campaigns.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Creator Filter */}
          {creators.length > 0 && (
            <div>
              <label className="form-label" style={{ fontSize: 11, marginBottom: 4 }}>Creator</label>
              <select
                className="select"
                value={creatorFilter}
                onChange={e => setCreatorFilter(e.target.value)}
                style={{ height: 34, fontSize: 12 }}
              >
                <option value="all">All Creators ({creators.length})</option>
                {creators.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Date Filter */}
          <div>
            <label className="form-label" style={{ fontSize: 11, marginBottom: 4 }}>Timeframe</label>
            <select
              className="select"
              value={dateFilter}
              onChange={e => setDateFilter(e.target.value)}
              style={{ height: 34, fontSize: 12 }}
            >
              <option value="all">All Time</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
              <option value="month">This Month</option>
            </select>
          </div>

          {/* Sort By */}
          <div>
            <label className="form-label" style={{ fontSize: 11, marginBottom: 4 }}>Sort By</label>
            <select
              className="select"
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              style={{ height: 34, fontSize: 12 }}
            >
              <option value="views">Most Views</option>
              <option value="likes">Most Likes</option>
              <option value="engRate">Highest Engagement</option>
              <option value="recent">Recently Approved</option>
            </select>
          </div>
        </div>

        {/* Quick Result Pill */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 14,
          paddingTop: 12,
          borderTop: '1px solid var(--border2)',
          fontSize: 12,
          color: 'var(--ink3)'
        }}>
          <span>
            Showing <strong style={{ color: 'var(--ink)' }}>{filteredPosts.length}</strong> of {normalizedPosts.length} posts
          </span>
          <div style={{ display: 'flex', gap: 16 }}>
            <span>Total Views: <strong style={{ color: 'var(--ink)' }}>{fmtCompactNum(rollups.views)}</strong></span>
            <span>Likes: <strong style={{ color: 'var(--ink)' }}>{fmtCompactNum(rollups.likes)}</strong></span>
            <span>Comments: <strong style={{ color: 'var(--ink)' }}>{fmtCompactNum(rollups.comments)}</strong></span>
          </div>
        </div>
      </div>

      {/* Gallery View */}
      {viewMode === 'gallery' && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: 20
        }}>
          {filteredPosts.length === 0 ? (
            <div className="premium-card text-center" style={{ gridColumn: '1 / -1', padding: 48 }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🎬</div>
              <h4>No posts match your filters</h4>
              <p style={{ color: 'var(--ink3)', fontSize: 13, marginTop: 4 }}>
                Try adjusting your platform, date, or creator filter criteria.
              </p>
            </div>
          ) : (
            filteredPosts.map(post => {
              const meta = platformMeta(post.platform);
              return (
                <div
                  key={post.id}
                  className="premium-card hover-card"
                  style={{
                    padding: 0,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    border: '1px solid var(--border)'
                  }}
                >
                  {/* Card Media Preview Header */}
                  <div style={{
                    padding: '16px',
                    background: 'var(--surface)',
                    borderBottom: '1px solid var(--border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div
                        className={`creator-avatar ${getAvatarColor(post.creatorName)}`}
                        style={{ width: 34, height: 34, fontSize: 13, flexShrink: 0 }}
                      >
                        {getInitials(post.creatorName)}
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>
                          {post.creatorName}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--ink3)' }}>
                          {post.campaignName}
                        </div>
                      </div>
                    </div>

                    <span style={{
                      background: meta.bg,
                      color: meta.text,
                      border: `1px solid ${meta.border}`,
                      padding: '3px 8px',
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4
                    }}>
                      <span>{meta.icon}</span>
                      <span>{meta.name}</span>
                    </span>
                  </div>

                  {/* Body Performance Metrics */}
                  <div style={{ padding: '16px', flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div className="flex-between" style={{ alignItems: 'baseline' }}>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--ink3)', textTransform: 'uppercase' }}>Verified Views</div>
                        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)', lineHeight: 1.2 }}>
                          {fmtCompactNum(post.views)}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 11, color: 'var(--ink3)', textTransform: 'uppercase' }}>Engagement</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--green)' }}>
                          {post.engRateStr}
                        </div>
                      </div>
                    </div>

                    {/* Breakdown Matrix */}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(4, 1fr)',
                      gap: 6,
                      background: 'var(--bg)',
                      padding: 8,
                      borderRadius: 6,
                      textAlign: 'center',
                      fontSize: 11
                    }}>
                      <div>
                        <div style={{ color: 'var(--ink3)' }}>Likes</div>
                        <div style={{ fontWeight: 600 }}>{fmtCompactNum(post.likes)}</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--ink3)' }}>Comments</div>
                        <div style={{ fontWeight: 600 }}>{fmtCompactNum(post.comments)}</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--ink3)' }}>Shares</div>
                        <div style={{ fontWeight: 600 }}>{fmtCompactNum(post.shares)}</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--ink3)' }}>Saves</div>
                        <div style={{ fontWeight: 600 }}>{fmtCompactNum(post.saves)}</div>
                      </div>
                    </div>
                  </div>

                  {/* Footer with Direct Post Link */}
                  <div style={{
                    padding: '10px 16px',
                    background: 'var(--surface)',
                    borderTop: '1px solid var(--border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: 12
                  }}>
                    <span style={{ color: 'var(--ink3)' }}>
                      {fmtDate(post.date)}
                    </span>
                    {post.postUrl ? (
                      <a
                        href={post.postUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        style={{
                          fontWeight: 600,
                          color: 'var(--blue)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          textDecoration: 'none'
                        }}
                      >
                        Watch Video ↗
                      </a>
                    ) : (
                      <span style={{ color: 'var(--ink3)' }}>Link pending</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Table View */}
      {viewMode === 'table' && (
        <div className="premium-card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="premium-table">
              <thead>
                <tr>
                  <th>Creator</th>
                  <th>Campaign</th>
                  <th>Platform</th>
                  <th>Views</th>
                  <th>Likes</th>
                  <th>Comments</th>
                  <th>Shares</th>
                  <th>Eng. Rate</th>
                  <th>Approved Date</th>
                  <th style={{ textAlign: 'right' }}>Direct Link</th>
                </tr>
              </thead>
              <tbody>
                {filteredPosts.length === 0 ? (
                  <tr>
                    <td colSpan="10" style={{ textAlign: 'center', padding: 40, color: 'var(--ink3)' }}>
                      No posts match your filters.
                    </td>
                  </tr>
                ) : (
                  filteredPosts.map(post => {
                    const meta = platformMeta(post.platform);
                    return (
                      <tr key={post.id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div
                              className={`creator-avatar ${getAvatarColor(post.creatorName)}`}
                              style={{ width: 28, height: 28, fontSize: 11, flexShrink: 0 }}
                            >
                              {getInitials(post.creatorName)}
                            </div>
                            <strong style={{ color: 'var(--ink)' }}>{post.creatorName}</strong>
                          </div>
                        </td>
                        <td style={{ fontSize: 12 }}>{post.campaignName}</td>
                        <td>
                          <span style={{
                            background: meta.bg,
                            color: meta.text,
                            border: `1px solid ${meta.border}`,
                            padding: '2px 8px',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4
                          }}>
                            <span>{meta.icon}</span>
                            <span>{meta.name}</span>
                          </span>
                        </td>
                        <td style={{ fontWeight: 700, color: 'var(--ink)' }}>
                          {fmtCompactNum(post.views)}
                        </td>
                        <td>{fmtCompactNum(post.likes)}</td>
                        <td>{fmtCompactNum(post.comments)}</td>
                        <td>{fmtCompactNum(post.shares)}</td>
                        <td style={{ color: 'var(--green)', fontWeight: 600 }}>{post.engRateStr}</td>
                        <td style={{ fontSize: 12, color: 'var(--ink3)' }}>{fmtDate(post.date)}</td>
                        <td style={{ textAlign: 'right' }}>
                          {post.postUrl ? (
                            <a
                              href={post.postUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="btn btn-ghost btn-sm"
                              style={{ color: 'var(--blue)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            >
                              Watch ↗
                            </a>
                          ) : (
                            <span style={{ color: 'var(--ink3)', fontSize: 12 }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
