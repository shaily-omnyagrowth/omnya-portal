import { clientFinance } from "../pages/money/finance";
import { fmtMoney } from "../utils";

export default function AMClientSummaryBar({ client, db }) {
  const f = clientFinance(client, db);
  const m0 = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const thisMonth = db.submissions.filter(s => f.clientCampaigns.some(c => c.id === s.campaign_id) && (s.status === "Approved" || s.status === "Published/Tracked") && new Date(s.created_at) >= m0).length;
  const target = Number(client.videos_per_month || 0);

  return (
    <div className="stats-grid">
      <div className="stat-card"><div className="stat-label">Monthly value</div><div className="stat-value">{fmtMoney(f.revenue)}</div><div className="stat-sub">{target ? `${fmtMoney(f.revenue / target)} per committed video` : "No video commitment set"}</div></div>
      <div className="stat-card"><div className="stat-label">Videos this month</div><div className="stat-value">{thisMonth}{target ? <span className="text-muted fs-13"> / {target}</span> : null}</div><div className="stat-sub">{f.totalApproved} approved in total</div></div>
      <div className="stat-card"><div className="stat-label">Margin</div><div className="stat-value">{f.margin}%</div><div className="stat-sub"><span className={`badge badge-${f.health.tone}`}>{f.health.label}</span></div></div>
    </div>
  );
}
