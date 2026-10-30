import { Share01Icon } from '@hugeicons/core-free-icons';
import Icon from '../ui/Icon';
import { calcPacing, daysLeftLabel, fmtDate, platformMeta, statusBadge } from '../utils';

// Also drawn in the client portal, where the internal CPM badge must not appear (showCpmBadge).
export default function CampaignProgressCard({ campaign, client, accountManager, approvedCount = 0, assignedCreatorsCount = 0, onClick, onShareClick, showCpmBadge = false }) {
  const pacing = calcPacing({ startDate: campaign.start_date || campaign.created_at, deadline: campaign.deadline, videosNeeded: campaign.videos_needed || 10, approvedCount });
  const p = platformMeta(campaign.format);
  const fill = pacing.deliveryPct >= 100 ? 'var(--green)' : pacing.paceStatus === 'behind' || pacing.paceStatus === 'overdue' ? 'var(--amber)' : 'var(--ink)';
  const Body = onClick ? 'button' : 'div';

  return (
    <article className="camp-card">
      <Body className="camp-hit" {...(onClick ? { onClick, type: 'button' } : {})}>
        <div className="flex-between" style={{ alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <h3 className="fw-600 fs-16 break-anywhere" style={{ lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{campaign.name}</h3>
            <div className="fs-13 text-muted truncate">{[client?.name, accountManager?.name].filter(Boolean).join(' · ') || 'No client'}</div>
          </div>
          {statusBadge(campaign.status)}
        </div>

        <div className="camp-progress">
          <div className="flex-between fs-12 mb-4">
            <span className="text-muted tnum">{approvedCount} of {campaign.videos_needed || 0} videos</span>
            <span className="fw-600 tnum">{pacing.deliveryPct}%</span>
          </div>
          <div className="progress-bar"><div className="progress-fill" style={{ width: `${Math.min(100, pacing.deliveryPct)}%`, background: fill }} /></div>
          <div className="flex-between fs-12 mt-8">
            <span className={`badge ${pacing.paceBadge}`}>{pacing.paceLabel}</span>
            <span className={pacing.daysRemaining !== null && pacing.daysRemaining <= 3 ? 'text-red fw-600' : 'text-muted'}>{daysLeftLabel(campaign.deadline)}</span>
          </div>
        </div>

        <div className="camp-foot">
          <span className="flex-center gap-4"><Icon icon={p.icon} size={13} />{p.key && p.key === String(campaign.format || '').toLowerCase() ? p.name : campaign.format || p.name}</span>
          <span>{assignedCreatorsCount} {assignedCreatorsCount === 1 ? 'creator' : 'creators'}</span>
          {campaign.deadline && <span>Due {fmtDate(campaign.deadline)}</span>}
          {showCpmBadge && <span>{campaign.show_client_cpm ? 'CPM shared' : 'CPM internal'}</span>}
        </div>
      </Body>
      {onShareClick && (
        <button className="btn btn-ghost btn-icon btn-sm camp-share" aria-label={`Share ${campaign.name} results`} onClick={onShareClick}>
          <Icon icon={Share01Icon} size={16} />
        </button>
      )}
    </article>
  );
}
