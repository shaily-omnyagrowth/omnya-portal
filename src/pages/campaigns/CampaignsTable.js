import { Share01Icon } from "@hugeicons/core-free-icons";
import Icon from "../../ui/Icon";
import { calcPacing, daysLeftLabel, formatLabel, statusBadge } from "../../utils";
import usePagination from "../../ui/Pagination";

export default function CampaignsTable({ campaigns, db, approvedFor, onOpen, onShare }) {
  const { rows, pager } = usePagination(campaigns, { label: "campaigns" });
  return (
    <>
    <div className="table-wrap">
      <table>
        <thead><tr><th>Campaign</th><th>Client</th><th>Format</th><th>Delivery</th><th>Pace</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {rows.map(c => {
            const client = db.clients.find(cl => cl.id === c.client_id);
            const approved = approvedFor(c.id);
            const pacing = calcPacing({ startDate: c.start_date || c.created_at, deadline: c.deadline, videosNeeded: c.videos_needed || 10, approvedCount: approved });
            return (
              <tr key={c.id} onClick={() => onOpen(c)} style={{ cursor: "pointer" }}>
                <td><div className="fw-600 truncate" style={{ color: "var(--ink)", maxWidth: 200 }} title={c.name}>{c.name}</div><div className="fs-12 text-muted">{(c.assigned_creators || []).length} {(c.assigned_creators || []).length === 1 ? "creator" : "creators"}</div></td>
                <td><span className="truncate" style={{ display: "block", maxWidth: 160 }} title={client?.name}>{client?.name || "--"}</span></td>
                <td style={{ whiteSpace: "nowrap" }}>{formatLabel(c.format) || "--"}</td>
                <td style={{ minWidth: 110 }}>
                  <div className="fs-12 text-muted mb-4 tnum">{approved} of {c.videos_needed || 0} · {pacing.deliveryPct}%</div>
                  <div className="progress-bar" style={{ width: 90 }}><div className="progress-fill" style={{ width: `${Math.min(pacing.deliveryPct, 100)}%` }} /></div>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <span className={`badge ${pacing.paceBadge}`}>{pacing.paceLabel}</span>
                  {!(pacing.daysRemaining < 0) && <div className={`fs-12 mt-4 ${pacing.daysRemaining !== null && pacing.daysRemaining <= 3 ? "text-red" : "text-muted"}`}>{daysLeftLabel(c.deadline)}</div>}
                </td>
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
    {pager}
    </>
  );
}
