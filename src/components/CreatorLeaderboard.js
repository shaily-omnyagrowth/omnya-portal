import React, { useState, useMemo } from 'react';
import { fmtCompactNum, getAvatarColor, getInitials, isBreakoutVideo } from '../utils';

export default function CreatorLeaderboard({ creators = [], submissions = [], analytics = [], campaigns = [] }) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('totalViews');
  const [sortAsc, setSortAsc] = useState(false);

  // Map analytics by submission_id
  const analyticsMap = useMemo(() => {
    const map = {};
    (analytics || []).forEach(a => {
      if (a.submission_id) map[a.submission_id] = a;
    });
    return map;
  }, [analytics]);

  // Compute rich creator metrics
  const scoredCreators = useMemo(() => {
    const now = Date.now();
    const fourteenDaysAgo = now - 14 * 24 * 60 * 60 * 1000;

    return creators.map(creator => {
      const creatorSubs = submissions.filter(s => s.creator_id === creator.id && s.status === 'Approved');
      const uniqueCampaignIds = new Set(creatorSubs.map(s => s.campaign_id).filter(Boolean));

      let totalViews = 0;
      let totalLikes = 0;
      let totalComments = 0;
      let totalShares = 0;
      let totalSaves = 0;

      const subMetrics = creatorSubs.map(s => {
        const a = analyticsMap[s.id];
        const views = Number(a?.views || s.views_1w || s.views_72h || s.views_24h || 0);
        const likes = Number(a?.likes || s.likes || 0);
        const comments = Number(a?.comments || s.comments || 0);
        const shares = Number(a?.shares || s.shares || 0);
        const saves = Number(a?.saves || s.saves || 0);

        totalViews += views;
        totalLikes += likes;
        totalComments += comments;
        totalShares += shares;
        totalSaves += saves;

        return {
          id: s.id,
          date: new Date(s.approved_date || s.created_at).getTime(),
          views
        };
      });

      const videoCount = creatorSubs.length;
      const avgViews = videoCount > 0 ? Math.round(totalViews / videoCount) : 0;
      const totalEng = totalLikes + totalComments + totalShares + totalSaves;
      const engRateNum = totalViews > 0 ? (totalEng / totalViews) * 100 : 0;
      const engRateStr = engRateNum > 0 ? engRateNum.toFixed(2) + '%' : '0.00%';

      // Calculate Breakouts
      let breakoutsCount = 0;
      let hasRecentBreakout = false;

      subMetrics.forEach(sm => {
        if (isBreakoutVideo(sm.views, avgViews)) {
          breakoutsCount++;
          if (sm.date >= fourteenDaysAgo) {
            hasRecentBreakout = true;
          }
        }
      });

      return {
        ...creator,
        videoCount,
        campaignCount: uniqueCampaignIds.size,
        totalViews,
        avgViews,
        totalEng,
        engRateNum,
        engRateStr,
        breakoutsCount,
        hasRecentBreakout
      };
    });
  }, [creators, submissions, analyticsMap]);

  // Filter and sort
  const filteredAndSorted = useMemo(() => {
    let list = scoredCreators.filter(c => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        (c.name || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.tiktok_handle || '').toLowerCase().includes(q) ||
        (c.instagram_handle || '').toLowerCase().includes(q)
      );
    });

    list.sort((a, b) => {
      let valA = a[sortBy];
      let valB = b[sortBy];
      if (typeof valA === 'string') {
        valA = valA.toLowerCase();
        valB = valB.toLowerCase();
        return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortAsc ? (valA || 0) - (valB || 0) : (valB || 0) - (valA || 0);
    });

    return list;
  }, [scoredCreators, search, sortBy, sortAsc]);

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(field);
      setSortAsc(false);
    }
  };

  const top3 = filteredAndSorted.slice(0, 3);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Top 3 Podium Cards */}
      {top3.length > 0 && !search && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16
        }}>
          {top3.map((creator, idx) => {
            const medal = idx === 0 ? '🥇 #1 Top Creator' : idx === 1 ? '🥈 #2 Runner-Up' : '🥉 #3 Performer';
            const borderCol = idx === 0 ? '#eab308' : idx === 1 ? '#94a3b8' : '#cd7f32';

            return (
              <div
                key={creator.id}
                className="premium-card"
                style={{
                  padding: 20,
                  borderTop: `4px solid ${borderCol}`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  position: 'relative'
                }}
              >
                <div className="flex-between">
                  <span style={{ fontSize: 12, fontWeight: 800, color: borderCol, textTransform: 'uppercase' }}>
                    {medal}
                  </span>
                  {creator.hasRecentBreakout && (
                    <span className="badge badge-orange" style={{ fontSize: 11, animation: 'pulse 2s infinite' }}>
                      🔥 Recent Breakout
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div
                    className={`creator-avatar ${getAvatarColor(creator.name)}`}
                    style={{ width: 44, height: 44, fontSize: 16, fontWeight: 700 }}
                  >
                    {getInitials(creator.name)}
                  </div>
                  <div>
                    <h4 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{creator.name}</h4>
                    <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 2 }}>
                      {creator.tiktok_handle ? `@${creator.tiktok_handle}` : (creator.instagram_handle ? `@${creator.instagram_handle}` : 'Creator')}
                    </div>
                  </div>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 8,
                  background: 'var(--bg)',
                  padding: 10,
                  borderRadius: 8,
                  textAlign: 'center',
                  fontSize: 12
                }}>
                  <div>
                    <div style={{ color: 'var(--ink3)', fontSize: 11 }}>Total Views</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)' }}>
                      {fmtCompactNum(creator.totalViews)}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--ink3)', fontSize: 11 }}>Avg Views</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)' }}>
                      {fmtCompactNum(creator.avgViews)}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--ink3)', fontSize: 11 }}>Eng. Rate</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--green)' }}>
                      {creator.engRateStr}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--ink3)', fontSize: 11 }}>Breakouts</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: creator.breakoutsCount > 0 ? 'var(--orange)' : 'var(--ink3)' }}>
                      {creator.breakoutsCount} {creator.breakoutsCount > 0 ? '🔥' : ''}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Main Leaderboard Table */}
      <div className="premium-card" style={{ padding: 0 }}>
        {/* Table Controls */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12
        }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Creator Performance Leaderboard</h3>
            <p style={{ color: 'var(--ink3)', fontSize: 12, marginTop: 4 }}>
              Rankings across verified views, engagement rate, and breakout hits
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              className="form-input"
              placeholder="Search creator or handle..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 220, fontSize: 12, height: 32 }}
            />
          </div>
        </div>

        {/* Leaderboard Table */}
        <div className="table-wrap">
          <table className="premium-table">
            <thead>
              <tr>
                <th style={{ width: 50, textAlign: 'center' }}>Rank</th>
                <th onClick={() => handleSort('name')} style={{ cursor: 'pointer' }}>
                  Creator {sortBy === 'name' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th onClick={() => handleSort('totalViews')} style={{ cursor: 'pointer' }}>
                  Total Views {sortBy === 'totalViews' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th onClick={() => handleSort('avgViews')} style={{ cursor: 'pointer' }}>
                  Avg Views {sortBy === 'avgViews' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th onClick={() => handleSort('engRateNum')} style={{ cursor: 'pointer' }}>
                  Eng. Rate {sortBy === 'engRateNum' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th onClick={() => handleSort('breakoutsCount')} style={{ cursor: 'pointer' }}>
                  Breakouts {sortBy === 'breakoutsCount' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th onClick={() => handleSort('videoCount')} style={{ cursor: 'pointer' }}>
                  Delivered {sortBy === 'videoCount' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th onClick={() => handleSort('campaignCount')} style={{ cursor: 'pointer' }}>
                  Campaigns {sortBy === 'campaignCount' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSorted.length === 0 ? (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', padding: 40, color: 'var(--ink3)' }}>
                    No creators match your search query.
                  </td>
                </tr>
              ) : (
                filteredAndSorted.map((c, index) => (
                  <tr key={c.id}>
                    <td style={{ textAlign: 'center', fontWeight: 700, color: index < 3 ? 'var(--gold)' : 'var(--ink3)' }}>
                      {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div
                          className={`creator-avatar ${getAvatarColor(c.name)}`}
                          style={{ width: 32, height: 32, fontSize: 12, flexShrink: 0 }}
                        >
                          {getInitials(c.name)}
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <strong style={{ color: 'var(--ink)' }}>{c.name}</strong>
                            {c.hasRecentBreakout && (
                              <span className="badge badge-orange" style={{ fontSize: 10, padding: '1px 6px' }}>
                                🔥 Recent
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--ink3)' }}>
                            {c.tiktok_handle ? `@${c.tiktok_handle}` : (c.instagram_handle ? `@${c.instagram_handle}` : c.email)}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={{ fontWeight: 700, color: 'var(--ink)' }}>
                      {fmtCompactNum(c.totalViews)}
                    </td>
                    <td>{fmtCompactNum(c.avgViews)}</td>
                    <td style={{ color: 'var(--green)', fontWeight: 600 }}>{c.engRateStr}</td>
                    <td>
                      {c.breakoutsCount > 0 ? (
                        <span style={{ fontWeight: 700, color: 'var(--orange)' }}>
                          {c.breakoutsCount} 🔥
                        </span>
                      ) : (
                        <span style={{ color: 'var(--ink3)' }}>0</span>
                      )}
                    </td>
                    <td>{c.videoCount} posts</td>
                    <td style={{ color: 'var(--ink3)' }}>{c.campaignCount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
