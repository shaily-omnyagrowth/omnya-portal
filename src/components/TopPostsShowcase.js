import React, { useState, useMemo } from 'react';
import { fmtNum, platformMeta, getAvatarColor, getInitials } from '../utils';

function fmtFullDateTime(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '—';
  const day = date.getDate();
  const suffix = (day % 10 === 1 && day !== 11) ? 'st' : (day % 10 === 2 && day !== 12) ? 'nd' : (day % 10 === 3 && day !== 13) ? 'rd' : 'th';
  const month = date.toLocaleDateString('en-US', { month: 'short' });
  const year = date.getFullYear();
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
  return `${month} ${day}${suffix}, ${year}, ${time}`;
}

const BG_GRADIENTS = [
  'linear-gradient(145deg, #1e1e24 0%, #2a2b36 50%, #17181f 100%)',
  'linear-gradient(145deg, #1a2332 0%, #1e3a5f 50%, #0d1b2a 100%)',
  'linear-gradient(145deg, #2d1b2e 0%, #4a2545 50%, #1e1022 100%)',
  'linear-gradient(145deg, #262c21 0%, #3e4a35 50%, #181d14 100%)',
  'linear-gradient(145deg, #2c2518 0%, #4d3e26 50%, #1c160c 100%)',
  'linear-gradient(145deg, #232233 0%, #383556 50%, #141320 100%)',
  'linear-gradient(145deg, #192a2a 0%, #244646 50%, #0d1a1a 100%)'
];

export default function TopPostsShowcase({
  posts = [],
  title = "Top posts",
  subtitle = "Highest-reach verified assets across active campaigns"
}) {
  const [viewMode, setViewMode] = useState('cards'); // 'cards' | 'table'
  const [showMore, setShowMore] = useState(false);
  const [sortCol, setSortCol] = useState('views');
  const [sortDir, setSortDir] = useState('desc');

  // Handle sorting for table view
  const sortedPosts = useMemo(() => {
    const list = [...posts];
    list.sort((a, b) => {
      let aVal = 0;
      let bVal = 0;

      if (sortCol === 'views') {
        aVal = Number(a.views || 0);
        bVal = Number(b.views || 0);
      } else if (sortCol === 'likes') {
        aVal = Number(a.likes || 0);
        bVal = Number(b.likes || 0);
      } else if (sortCol === 'shares') {
        aVal = Number(a.shares || 0);
        bVal = Number(b.shares || 0);
      } else if (sortCol === 'saves') {
        aVal = Number(a.saves || 0);
        bVal = Number(b.saves || 0);
      } else if (sortCol === 'comments') {
        aVal = Number(a.comments || 0);
        bVal = Number(b.comments || 0);
      } else if (sortCol === 'engagement') {
        const aViews = Number(a.views || 0);
        const bViews = Number(b.views || 0);
        const aEng = Number(a.likes || 0) + Number(a.comments || 0) + Number(a.shares || 0) + Number(a.saves || 0);
        const bEng = Number(b.likes || 0) + Number(b.comments || 0) + Number(b.shares || 0) + Number(b.saves || 0);
        aVal = aViews > 0 ? (aEng / aViews) : 0;
        bVal = bViews > 0 ? (bEng / bViews) : 0;
      } else if (sortCol === 'date') {
        aVal = new Date(a.created_at || a.approved_date || 0).getTime();
        bVal = new Date(b.created_at || b.approved_date || 0).getTime();
      } else if (sortCol === 'creator') {
        return sortDir === 'asc'
          ? (a.creatorName || '').localeCompare(b.creatorName || '')
          : (b.creatorName || '').localeCompare(a.creatorName || '');
      }

      return sortDir === 'desc' ? bVal - aVal : aVal - bVal;
    });

    return list;
  }, [posts, sortCol, sortDir]);

  // Number of items to display: 7 initial or all when showMore
  const visiblePosts = showMore ? sortedPosts : sortedPosts.slice(0, 7);

  const toggleSort = (col) => {
    if (sortCol === col) {
      setSortDir(prev => prev === 'desc' ? 'asc' : 'desc');
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
  };

  if (!posts || posts.length === 0) {
    return (
      <div className="premium-card" style={{ padding: 24, background: 'var(--surface)' }}>
        <div className="flex-between mb-12">
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--ink)' }}>{title}</h3>
            {subtitle && <p style={{ color: 'var(--ink3)', fontSize: 12, marginTop: 4 }}>{subtitle}</p>}
          </div>
        </div>
        <div style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--ink3)', fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔥</div>
          No verified post analytics available matching active filters.
        </div>
      </div>
    );
  }

  return (
    <div className="premium-card" style={{ padding: '24px 28px', background: 'var(--surface)', borderRadius: 'var(--radius)' }}>
      {/* Header: Title + [ Cards | Table ] Switcher */}
      <div className="flex-between mb-20" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--ink)' }}>{title}</h3>
          {subtitle && <p style={{ color: 'var(--ink3)', fontSize: 12, margin: '4px 0 0 0' }}>{subtitle}</p>}
        </div>

        {/* View Switcher Toggle: [ Cards | Table ] */}
        <div style={{
          display: 'flex',
          background: 'var(--bg2)',
          padding: 3,
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border)'
        }}>
          <button
            onClick={() => setViewMode('cards')}
            style={{
              background: viewMode === 'cards' ? 'var(--surface)' : 'transparent',
              color: viewMode === 'cards' ? 'var(--ink)' : 'var(--ink3)',
              border: viewMode === 'cards' ? '1px solid var(--border)' : '1px solid transparent',
              borderRadius: 4,
              padding: '4px 14px',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            Cards
          </button>
          <button
            onClick={() => setViewMode('table')}
            style={{
              background: viewMode === 'table' ? 'var(--surface)' : 'transparent',
              color: viewMode === 'table' ? 'var(--ink)' : 'var(--ink3)',
              border: viewMode === 'table' ? '1px solid var(--border)' : '1px solid transparent',
              borderRadius: 4,
              padding: '4px 14px',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            Table
          </button>
        </div>
      </div>

      {/* 1. CARDS VIEW (UGCTrackr 9:16 Vertical Video Cards) */}
      {viewMode === 'cards' && (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
            gap: 16
          }}>
            {visiblePosts.map((post, idx) => {
              const meta = platformMeta(post.platform);
              const views = Number(post.views || 0);
              const creatorName = post.creatorName || post.creator_name || 'Creator';
              const handle = post.creatorHandle || `@${creatorName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
              const link = post.posted_link || post.video_url || post.drive_link;
              const hasThumb = Boolean(post.thumbnail_url || post.cover_image);
              const platformAbbr = (post.platform || 'tiktok').toLowerCase().includes('tiktok') ? 'TT' :
                                   (post.platform || '').toLowerCase().includes('instagram') ? 'IG' :
                                   (post.platform || '').toLowerCase().includes('youtube') ? 'YT' : 'FB';

              return (
                <div
                  key={post.id || idx}
                  style={{
                    position: 'relative',
                    aspectRatio: '9 / 15',
                    minHeight: 270,
                    borderRadius: 14,
                    overflow: 'hidden',
                    background: hasThumb ? `url(${post.thumbnail_url || post.cover_image}) center/cover no-repeat` : BG_GRADIENTS[idx % BG_GRADIENTS.length],
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    transition: 'transform 0.15s ease, box-shadow 0.15s ease'
                  }}
                  className="hover-card"
                >
                  {/* Subtle editorial card texture if no real photo */}
                  {!hasThumb && (
                    <div style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: 0.25,
                      pointerEvents: 'none'
                    }}>
                      <span style={{ fontSize: 42 }}>🎬</span>
                      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, marginTop: 4, textTransform: 'uppercase' }}>
                        {meta.name}
                      </span>
                    </div>
                  )}

                  {/* Top Right Speech Bubble / Chat Badge */}
                  <div style={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: 'rgba(0, 0, 0, 0.45)',
                    backdropFilter: 'blur(4px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    color: '#fff',
                    zIndex: 2
                  }}>
                    🗨️
                  </div>

                  {/* Bottom Vignette & Metadata */}
                  <div style={{
                    marginTop: 'auto',
                    padding: '20px 12px 12px',
                    background: 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.65) 60%, transparent 100%)',
                    zIndex: 2,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3
                  }}>
                    {/* View Count */}
                    <div style={{
                      fontSize: 14,
                      fontWeight: 800,
                      color: '#ffffff',
                      letterSpacing: '-0.2px',
                      textShadow: '0 1px 2px rgba(0,0,0,0.6)'
                    }}>
                      {fmtNum(views)} Views
                    </div>

                    {/* Creator Handle, Platform Tag, and Link */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: 11,
                      color: '#9ca3af',
                      marginTop: 2
                    }}>
                      <span style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: 90,
                        color: '#d1d5db'
                      }}>
                        {handle}
                      </span>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: '#9ca3af',
                          background: 'rgba(255,255,255,0.1)',
                          padding: '1px 4px',
                          borderRadius: 3
                        }}>
                          {platformAbbr}
                        </span>

                        {link && (
                          <a
                            href={link}
                            target="_blank"
                            rel="noreferrer noopener"
                            title="Open video post"
                            style={{
                              color: '#9ca3af',
                              textDecoration: 'none',
                              fontSize: 12,
                              fontWeight: 700,
                              lineHeight: 1
                            }}
                          >
                            ↗
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Centered Show More / Show Less Pill Button */}
          {posts.length > 7 && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowMore(!showMore)}
                style={{
                  borderRadius: 20,
                  padding: '7px 24px',
                  fontSize: 12,
                  fontWeight: 600,
                  background: 'var(--bg2)',
                  border: '1px solid var(--border)',
                  cursor: 'pointer'
                }}
              >
                {showMore ? 'Show less' : 'Show more'}
              </button>
            </div>
          )}
        </>
      )}

      {/* 2. TABLE VIEW (UGCTrackr-exact Sortable Table) */}
      {viewMode === 'table' && (
        <>
          <div style={{ overflowX: 'auto', margin: '0 -8px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 960 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--ink3)' }}>
                  <th
                    onClick={() => toggleSort('creator')}
                    style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    Post ⇅
                  </th>
                  <th style={{ textAlign: 'center', padding: '10px 8px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    Platform ⇅
                  </th>
                  <th
                    onClick={() => toggleSort('date')}
                    style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    Date posted ⇅
                  </th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    Title ⇅
                  </th>
                  <th style={{ textAlign: 'center', padding: '10px 8px', fontWeight: 600 }}>
                    Link
                  </th>
                  <th
                    onClick={() => toggleSort('views')}
                    style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    Views ⇅
                  </th>
                  <th
                    onClick={() => toggleSort('likes')}
                    style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    Likes ⇅
                  </th>
                  <th
                    onClick={() => toggleSort('shares')}
                    style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    Shares ⇅
                  </th>
                  <th
                    onClick={() => toggleSort('saves')}
                    style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    Saves ⇅
                  </th>
                  <th
                    onClick={() => toggleSort('comments')}
                    style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    Comments ⇅
                  </th>
                  <th
                    onClick={() => toggleSort('engagement')}
                    style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    Engagement %
                  </th>
                  <th style={{ textAlign: 'center', padding: '10px 8px' }}></th>
                </tr>
              </thead>
              <tbody>
                {visiblePosts.map((post, idx) => {
                  const meta = platformMeta(post.platform);
                  const views = Number(post.views || 0);
                  const likes = Number(post.likes || 0);
                  const shares = Number(post.shares || 0);
                  const saves = Number(post.saves || 0);
                  const comments = Number(post.comments || 0);
                  const totalEng = likes + comments + shares + saves;
                  const engPct = views > 0 ? ((totalEng / views) * 100).toFixed(2) + '%' : '0.00%';
                  const creatorName = post.creatorName || post.creator_name || 'Creator';
                  const handle = post.creatorHandle || `@${creatorName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
                  const link = post.posted_link || post.video_url || post.drive_link;
                  const postDate = post.created_at || post.approved_date || new Date().toISOString();
                  const titlePreview = post.title || post.notes || `${post.campaignName || 'Campaign'} UGC Video`;

                  return (
                    <tr
                      key={post.id || idx}
                      style={{
                        borderBottom: '1px solid var(--border)',
                        transition: 'background 0.1s ease'
                      }}
                      className="table-row-hover"
                    >
                      {/* Post: Avatar + Handle + Timestamp */}
                      <td style={{ padding: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div
                            className={`creator-avatar ${getAvatarColor(creatorName)}`}
                            style={{ width: 32, height: 32, fontSize: 11, flexShrink: 0, borderRadius: 6 }}
                          >
                            {getInitials(creatorName)}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{handle}</div>
                            <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{fmtFullDateTime(postDate)}</div>
                          </div>
                        </div>
                      </td>

                      {/* Platform */}
                      <td style={{ textAlign: 'center', padding: '12px 8px', fontSize: 16 }}>
                        <span title={meta.name}>{meta.icon}</span>
                      </td>

                      {/* Date Posted */}
                      <td style={{ padding: '12px', color: 'var(--ink)', whiteSpace: 'nowrap' }}>
                        {fmtFullDateTime(postDate)}
                      </td>

                      {/* Title / Caption snippet */}
                      <td style={{ padding: '12px', color: 'var(--ink2)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {titlePreview}
                      </td>

                      {/* External Link */}
                      <td style={{ textAlign: 'center', padding: '12px 8px' }}>
                        {link ? (
                          <a
                            href={link}
                            target="_blank"
                            rel="noreferrer noopener"
                            style={{ color: 'var(--blue)', textDecoration: 'none', fontSize: 13 }}
                          >
                            ↗
                          </a>
                        ) : (
                          <span style={{ color: 'var(--ink3)' }}>—</span>
                        )}
                      </td>

                      {/* Views */}
                      <td style={{ textAlign: 'right', padding: '12px', fontWeight: 600, color: 'var(--ink)' }}>
                        {fmtNum(views)}
                      </td>

                      {/* Likes */}
                      <td style={{ textAlign: 'right', padding: '12px', color: 'var(--ink)' }}>
                        {fmtNum(likes)}
                      </td>

                      {/* Shares */}
                      <td style={{ textAlign: 'right', padding: '12px', color: 'var(--ink)' }}>
                        {fmtNum(shares)}
                      </td>

                      {/* Saves */}
                      <td style={{ textAlign: 'right', padding: '12px', color: 'var(--ink)' }}>
                        {fmtNum(saves)}
                      </td>

                      {/* Comments */}
                      <td style={{ textAlign: 'right', padding: '12px', color: 'var(--ink)' }}>
                        {fmtNum(comments)}
                      </td>

                      {/* Engagement % */}
                      <td style={{ textAlign: 'right', padding: '12px', fontWeight: 600, color: 'var(--green)' }}>
                        {engPct}
                      </td>

                      {/* Actions */}
                      <td style={{ textAlign: 'center', padding: '12px 8px', color: 'var(--ink3)', cursor: 'pointer' }}>
                        •••
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Centered Show More / Show Less Pill Button */}
          {posts.length > 7 && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowMore(!showMore)}
                style={{
                  borderRadius: 20,
                  padding: '7px 24px',
                  fontSize: 12,
                  fontWeight: 600,
                  background: 'var(--bg2)',
                  border: '1px solid var(--border)',
                  cursor: 'pointer'
                }}
              >
                {showMore ? 'Show less' : 'Show more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
