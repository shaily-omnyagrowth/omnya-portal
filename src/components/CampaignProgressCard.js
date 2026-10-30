import { Share01Icon } from '@hugeicons/core-free-icons';
import Icon from '../ui/Icon';
import { calcPacing, daysLeftLabel, fmtNum, platformMeta, statusBadge } from '../utils';

// showCpmBadge marks the internal view: the client portal never sees the account manager.
export default function CampaignProgressCard({ campaign, client, accountManager, approvedCount = 0, assignedCreatorsCount = 0, onClick, onShareClick, showCpmBadge = false }) {
  const pacing = calcPacing({ startDate: campaign.start_date || campaign.created_at, deadline: campaign.deadline, videosNeeded: campaign.videos_needed || 10, approvedCount });
  const p = platformMeta(campaign.format);
  const fill = pacing.deliveryPct >= 100 ? 'var(--green)' : pacing.paceStatus === 'behind' || pacing.paceStatus === 'overdue' ? 'var(--amber)' : 'var(--ink)';
  const Body = onClick ? 'button' : 'div';

  const tone = pacing.paceStatus === 'overdue' ? 'text-red' : pacing.paceStatus === 'behind' ? 'text-amber' : pacing.paceStatus === 'ahead' || pacing.deliveryPct >= 100 ? 'text-green' : 'text-muted';
  const when = pacing.paceStatus === 'overdue' ? null : daysLeftLabel(campaign.deadline);

  return (
    <article className="camp-card">
      <Body className="camp-hit" {...(onClick ? { onClick, type: 'button' } : {})}>
        <div className="camp-top">
          <h3 className="camp-name" title={campaign.name}>{campaign.name}</h3>
          {statusBadge(campaign.status)}
        </div>
        <div className="fs-13 text-muted truncate camp-client" title={client?.name}>{client?.name || 'No client'}</div>

        <div className="camp-progress">
          <div className="flex-between">
            <span className="camp-count tnum"><strong>{approvedCount}</strong> of {fmtNum(campaign.videos_needed || 0)} {campaign.videos_needed === 1 ? "video" : "videos"}</span>
            <span className="fs-13 fw-600 tnum">{pacing.deliveryPct}%</span>
          </div>
          <div className="progress-bar"><div className="progress-fill" style={{ width: `${Math.min(100, pacing.deliveryPct)}%`, background: fill }} /></div>
          <div className="fs-12"><span className={`fw-550 ${tone}`}>{pacing.paceLabel}</span>{when && <span className="text-muted"> · {when}</span>}</div>
        </div>
      </Body>
      <div className="camp-foot">
        <span className="flex-center gap-4 min-w-0" title={campaign.format || p.name}><Icon icon={p.icon} size={13} style={{ flexShrink: 0 }} /><span className="truncate">{p.key && p.key === String(campaign.format || '').toLowerCase() ? p.name : campaign.format || p.name}</span></span>
        <span style={{ whiteSpace: 'nowrap' }}>{assignedCreatorsCount} {assignedCreatorsCount === 1 ? 'creator' : 'creators'}</span>
        {showCpmBadge && accountManager?.name && <span className="truncate">{accountManager.name}</span>}
        {onShareClick && (
          <button className="btn btn-ghost btn-icon btn-sm camp-share" aria-label={`Share ${campaign.name} results`} onClick={onShareClick}>
            <Icon icon={Share01Icon} size={15} />
          </button>
        )}
      </div>
    </article>
  );
}
