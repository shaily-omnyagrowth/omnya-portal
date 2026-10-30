import { Clock01Icon, Wallet01Icon } from "@hugeicons/core-free-icons";
import EmptyState from "../../ui/EmptyState";
import { fmtDate, fmtMoney, fmtNum, statusBadge } from "../../utils";
import { earningType, methodLabel, tierLabel } from "./rules";

export function EarningsTable({ rows, campaigns }) {
  if (!rows.length) return <div className="card"><EmptyState icon={Wallet01Icon} title="No earnings yet">Base pay and bonuses appear here as videos are approved.</EmptyState></div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Date</th><th>Type</th><th>Campaign</th><th className="num">Views</th><th className="num">Amount</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.created_at)}</td>
              <td style={{ whiteSpace: "nowrap" }}>{earningType(r.earning_type)}{r.views_counted && tierLabel(r.views_counted) ? <span className="fs-12 text-muted"> · {tierLabel(r.views_counted)}</span> : null}</td>
              <td><span className="truncate" style={{ display: "block", maxWidth: 220 }}>{campaigns.find(c => c.id === r.campaign_id)?.name || r.description || "--"}</span></td>
              <td className="num">{r.views_counted ? fmtNum(r.views_counted) : "--"}</td>
              <td className="num fw-600" style={{ color: "var(--ink)" }}>{fmtMoney(r.amount, { cents: true })}</td>
              <td>{statusBadge(r.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WithdrawalsTable({ rows }) {
  if (!rows.length) return <div className="card"><EmptyState icon={Clock01Icon} title="No withdrawals yet">When you withdraw your balance, each request and its status shows up here.</EmptyState></div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Requested</th><th className="num">Amount</th><th>Method</th><th>Status</th><th>Details</th></tr></thead>
        <tbody>
          {rows.map(w => (
            <tr key={w.id}>
              <td style={{ whiteSpace: "nowrap" }}>{fmtDate(w.created_at)}</td>
              <td className="num fw-600" style={{ color: "var(--ink)" }}>{fmtMoney(w.amount, { cents: true })}</td>
              <td>{methodLabel(w.payment_method)}</td>
              <td>{statusBadge(w.status)}</td>
              <td className="text-muted"><span className="truncate" style={{ display: "block", maxWidth: 260 }}>{w.status === "rejected" && w.rejection_reason ? w.rejection_reason : w.payment_destination_summary || "--"}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
