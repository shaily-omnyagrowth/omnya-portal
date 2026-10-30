import { Share01Icon } from "@hugeicons/core-free-icons";
import Icon from "../../ui/Icon";
import { calcPacing, daysLeftLabel, statusBadge } from "../../utils";

export default function CampaignsTable({ campaigns, db, approvedFor, onOpen, onShare }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Campaign</th><th>Client</th><th>Manager</th><th>Format</th><th>Delivery</th><th>Pace</th><th>Deadline</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {campaigns.map(c => {
            const client = db.clients.find(cl => cl.id === c.client_id);
            const approved = approvedFor(c.id);
            const pacing = calcPacing({ startDate: c.start_date || c.created_at, deadline: c.deadline, videosNeeded: c.videos_needed || 10, approvedCount: approved });
            return (
              <tr key={c.id} onClick={() => onOpen(c)} style={{ cursor: "pointer" }}>
                <td><div className="fw-600 truncate" style={{ color: "var(--ink)", maxWidth: 260 }}>{c.name}</div><div className="fs-12 text-muted">{(c.assigned_creators || []).length} creators</div></td>
                <td><span className="truncate" style={{ display: "block", maxWidth: 200 }}>{client?.name || "--"}</span></td>
                <td>{db.accountManagers.find(a => a.id === client?.am_id)?.name || "--"}</td>
                <td style={{ whiteSpace: "nowrap" }}>{c.format || "--"}</td>
                <td style={{ minWidth: 140 }}>
                  <div className="fs-12 text-muted mb-4 tnum">{approved} of {c.videos_needed || 0} · {pacing.deliveryPct}%</div>
                  <div className="progress-bar" style={{ width: 110 }}><div className="progress-fill" style={{ width: `${Math.min(pacing.deliveryPct, 100)}%` }} /></div>
                </td>
                <td><span className={`badge ${pacing.paceBadge}`}>{pacing.paceLabel}</span></td>
                <td style={{ whiteSpace: "nowrap" }} className={pacing.daysRemaining !== null && pacing.daysRemaining <= 3 ? "text-red" : ""}>{daysLeftLabel(c.deadline)}</td>
                <td>{statusBadge(c.status)}</td>
                <td className="num" onClick={e => e.stopPropagation()}>
                  <button className="btn btn-ghost btn-icon btn-sm" aria-label={`Share ${c.name} results`} onClick={() => onShare(c)}><Icon icon={Share01Icon} size={16} /></button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
