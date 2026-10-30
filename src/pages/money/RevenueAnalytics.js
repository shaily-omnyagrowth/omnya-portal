import { useMemo, useState } from "react";
import { ChartIncreaseIcon } from "@hugeicons/core-free-icons";
import Alert from "../../ui/Alert";
import EmptyState from "../../ui/EmptyState";
import PageHeader from "../../ui/PageHeader";
import { BarChart } from "../../ui/charts";
import { fmtMoney } from "../../utils";
import ClientFinanceEditor from "./ClientFinanceEditor";
import { clientFinance } from "./finance";

const LIVE = new Set(["Approved", "Published/Tracked"]);
const pct = (r) => `${Math.round(r * 100)}%`;

function useSpendByMonth(db) {
  return useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
      const value = db.submissions.filter(s => {
        if (!s.created_at || !LIVE.has(s.status)) return false;
        const c = new Date(s.created_at);
        return c.getFullYear() === d.getFullYear() && c.getMonth() === d.getMonth();
      }).reduce((t, s) => t + Number(db.campaigns.find(c => c.id === s.campaign_id)?.pay_per_video || 0), 0);
      return { label: d.toLocaleDateString("en-US", { month: "short" }), fullLabel: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }), value };
    });
  }, [db.submissions, db.campaigns]);
}

export default function RevenueAnalytics({ db, user, isOwner, onRefresh }) {
  const am = !isOwner ? db.accountManagers.find(a => a.user_id === user?.id || a.email === user?.email) : null;
  const [editing, setEditing] = useState(null);
  const [onlyRisk, setOnlyRisk] = useState(false);
  const spend = useSpendByMonth(db);

  const rows = db.clients.filter(c => isOwner || c.am_id === am?.id).map(c => clientFinance(c, db)).sort((a, b) => b.revenue - a.revenue);
  const sum = (k) => rows.reduce((t, r) => t + r[k], 0);
  const revenue = sum("revenue"), profit = sum("grossProfit");
  const commission = sum("managerCost") + sum("salesCost");
  const margin = revenue > 0 ? Math.round((profit / revenue) * 100) : 0;
  const atRisk = rows.filter(r => r.health.tone === "red");
  const shown = onlyRisk ? atRisk : rows;
  const names = (list) => list.length <= 3 ? list.map(r => r.client.name).join(", ") : `${list.slice(0, 3).map(r => r.client.name).join(", ")} and ${list.length - 3} more`;

  return (
    <div className="content">
      <PageHeader title="Revenue" description={isOwner ? "Monthly revenue, costs and margin for every client. Edit a row to correct the numbers it's built from." : "Revenue, costs and margin for the clients you manage."} />

      {rows.length === 0 ? (
        <div className="card"><EmptyState icon={ChartIncreaseIcon} title="No clients yet">Revenue shows up here once a client has a budget.</EmptyState></div>
      ) : (
        <>
          <div className="stats-grid">
            <div className="stat-card stat-highlight"><div className="stat-label">Monthly revenue</div><div className="stat-value">{fmtMoney(revenue)}</div><div className="stat-sub">{rows.length} {rows.length === 1 ? "client" : "clients"}</div></div>
            <div className="stat-card"><div className="stat-label">Creator costs</div><div className="stat-value">{fmtMoney(sum("creatorCost"))}</div><div className="stat-sub">{sum("totalApproved")} approved videos</div></div>
            <div className="stat-card"><div className="stat-label">Commission</div><div className="stat-value">{fmtMoney(commission)}</div><div className="stat-sub">{isOwner ? `${fmtMoney(sum("managerCost"))} manager, ${fmtMoney(sum("salesCost"))} sales` : "Manager and sales"}</div></div>
            <div className="stat-card"><div className="stat-label">Gross profit</div><div className="stat-value" style={{ color: profit < 0 ? "var(--red)" : undefined }}>{fmtMoney(profit)}</div><div className="stat-sub">{margin}% margin</div></div>
          </div>

          {(atRisk.length > 0 || (revenue > 0 && margin < 30)) && (
            <div className="list-stack gap-8 mb-16">
              {revenue > 0 && margin < 30 && <Alert tone="warning" title={`Overall margin is ${margin}%`}>Most UGC agencies aim for 40 to 60%. Check pay per video and commission on the clients below.</Alert>}
              {atRisk.length > 0 && <Alert tone="error" title={atRisk.length === 1 ? `${atRisk[0].client.name} is at risk` : `${atRisk.length} clients are at risk`}
                action={<button className="btn btn-secondary btn-sm" onClick={() => setOnlyRisk(v => !v)}>{onlyRisk ? "Show all clients" : "Show them"}</button>}>
                {atRisk.length === 1 ? `${atRisk[0].health.why}.` : `${names(atRisk)}. Thin margin or no live campaign.`}</Alert>}
            </div>
          )}

          <section className="section">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Client</th><th className="num">Revenue</th><th className="num">Creator cost</th><th className="num">Commission</th><th className="num">Gross profit</th><th className="num">Per video</th><th>Health</th>{isOwner && <th><span className="sr-only">Actions</span></th>}</tr></thead>
                <tbody>
                  {shown.map(r => (
                    <tr key={r.client.id}>
                      <td><span className="fw-600 truncate" style={{ display: "block", maxWidth: 240, color: "var(--ink)" }}>{r.client.name}</span><span className="fs-12 text-muted truncate" style={{ display: "block", maxWidth: 240 }}>{[isOwner && (r.clientAM?.name || "No manager"), r.client.deal_type].filter(Boolean).join(" · ")}</span></td>
                      <td className="num fw-600" style={{ color: "var(--ink)" }}>{fmtMoney(r.revenue)}</td>
                      <td className="num">{fmtMoney(r.creatorCost)}<span className="fs-12 text-muted" style={{ display: "block" }}>{r.totalApproved} {r.totalApproved === 1 ? "video" : "videos"}</span></td>
                      <td className="num">{fmtMoney(r.managerCost + r.salesCost)}<span className="fs-12 text-muted" style={{ display: "block" }}>{pct(r.managerRate)} manager{r.hasSalesSourced ? `, ${pct(r.salesCommissionRate)} sales` : ""}</span></td>
                      <td className="num fw-600" style={{ color: r.grossProfit < 0 ? "var(--red)" : "var(--ink)" }}>{fmtMoney(r.grossProfit)}<span className="fs-12 text-muted" style={{ display: "block", fontWeight: 400 }}>{r.margin}% margin</span></td>
                      <td className="num">{r.costPerVideo ? fmtMoney(r.costPerVideo) : "--"}</td>
                      <td><span className={`badge badge-${r.health.tone}`} title={r.health.why}>{r.health.label}</span></td>
                      {isOwner && <td className="num"><button className="btn btn-ghost btn-sm" onClick={() => setEditing(r)}>Edit</button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card card-stacked section">
            <div className="card-head"><div><h2 className="card-title">Creator spend</h2><p className="card-desc">Pay for approved videos by the month they were sent in.</p></div></div>
            <BarChart data={spend} height={200} format={(v) => fmtMoney(v)} ariaLabel="Creator spend per month for the last six months" />
          </section>
        </>
      )}

      {editing && <ClientFinanceEditor row={editing} onClose={() => setEditing(null)} onSaved={async () => { await onRefresh?.(); setEditing(null); }} />}
    </div>
  );
}
