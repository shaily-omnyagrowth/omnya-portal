import React from 'react';
import { fmtDate, statusBadge, calcPacing, platformMeta } from '../utils';

export default function CampaignProgressCard({
  campaign,
  client,
  accountManager,
  approvedCount = 0,
  assignedCreatorsCount = 0,
  onClick,
  onShareClick,
  isOwner = false,
  // Staff screens only. This card is also drawn in the client portal, where
  // "CPM: internal" is both meaningless and a hint that something is withheld.
  showCpmBadge = false
}) {
  const pacing = calcPacing({
    startDate: campaign.start_date || campaign.created_at,
    deadline: campaign.deadline,
    videosNeeded: campaign.videos_needed || 10,
    approvedCount
  });

  const formatMeta = platformMeta(campaign.format);

  return (
    <div
      className="premium-card hover-card"
      style={{
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
        border: '1px solid var(--border)',
        position: 'relative'
      }}
      onClick={onClick}
    >
      {/* Header: Title, Client, Status */}
      <div>
        <div className="flex-between mb-8" style={{ alignItems: 'flex-start', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div style={{
              width: 38,
              height: 38,
              borderRadius: 8,
              background: formatMeta.bg || '#f3f4f6',
              border: `1px solid ${formatMeta.border || '#e5e7eb'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              flexShrink: 0
            }}>
              {formatMeta.icon || '📢'}
            </div>
            <div style={{ minWidth: 0 }}>
              <h4 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--ink)' }}>
                {campaign.name}
              </h4>
              <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 2 }}>
                {client?.name || 'Client Brand'}
                {accountManager && <span> · AM: {accountManager.name}</span>}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            <span style={{
              background: formatMeta.bg,
              color: formatMeta.text,
              border: `1px solid ${formatMeta.border}`,
              padding: '2px 8px',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600
            }}>
              {formatMeta.icon} {campaign.format}
            </span>
            {statusBadge(campaign.status)}
          </div>
        </div>

        {/* Pacing & Flight Bar */}
        <div style={{
          background: 'var(--bg)',
          borderRadius: 8,
          padding: '12px',
          marginTop: 12,
          marginBottom: 16,
          border: '1px solid var(--border2)'
        }}>
          {/* Week X and Days Remaining */}
          <div className="flex-between mb-8" style={{ fontSize: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 700, color: 'var(--ink)' }}>
                Week {pacing.currentWeek} of {pacing.totalWeeks}
              </span>
              <span className={`badge ${pacing.paceBadge}`} style={{ fontSize: 10, padding: '2px 6px' }}>
                {pacing.paceLabel}
              </span>
            </div>
            <div style={{
              fontWeight: 600,
              color: pacing.daysRemaining !== null && pacing.daysRemaining <= 3 ? 'var(--red)' : 'var(--ink3)'
            }}>
              {pacing.daysRemaining !== null ? (
                pacing.daysRemaining > 0 ? (
                  `⏱️ ${pacing.daysRemaining}d left`
                ) : pacing.daysRemaining === 0 ? (
                  '⚠️ Ends today'
                ) : (
                  `🏁 Ended ${Math.abs(pacing.daysRemaining)}d ago`
                )
              ) : (
                'No deadline'
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink3)', marginBottom: 4 }}>
            <span>Deliverables: {approvedCount} / {campaign.videos_needed || 10} videos</span>
            <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{pacing.deliveryPct}%</span>
          </div>
          <div style={{ height: 6, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${Math.min(100, pacing.deliveryPct)}%`,
                background: pacing.deliveryPct >= 100 ? 'var(--green)' : pacing.paceStatus === 'behind' ? 'var(--orange)' : 'var(--blue)',
                borderRadius: 4,
                transition: 'width 0.3s ease'
              }}
            />
          </div>

          {/* Timeline Dates */}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--ink3)', marginTop: 6 }}>
            <span>Start: {fmtDate(campaign.start_date || campaign.created_at)}</span>
            <span>Target: {fmtDate(campaign.deadline)}</span>
          </div>
        </div>
      </div>

      {/* Footer: Stats & Actions */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 12,
        borderTop: '1px solid var(--border2)',
        fontSize: 12
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ color: 'var(--ink3)' }}>
            <strong style={{ color: 'var(--ink)' }}>{assignedCreatorsCount}</strong> creator{assignedCreatorsCount !== 1 ? 's' : ''} assigned
          </div>
          {showCpmBadge && (
            <span style={{
              fontSize: 10,
              padding: '2px 6px',
              borderRadius: 4,
              background: 'var(--bg2)',
              color: 'var(--ink2)',
              fontWeight: 600,
              border: '1px solid var(--border2)'
            }}>
              CPM: {campaign.show_client_cpm ? 'client can see' : 'internal only'}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
          {onShareClick && (
            <button
              className="btn btn-ghost btn-sm"
              title="Share campaign analytics"
              onClick={onShareClick}
              style={{ padding: '4px 8px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <span>🔗</span>
              <span>Share</span>
            </button>
          )}
          {onClick && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={onClick}
              style={{ padding: '4px 10px', fontSize: 11 }}
            >
              Details →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
