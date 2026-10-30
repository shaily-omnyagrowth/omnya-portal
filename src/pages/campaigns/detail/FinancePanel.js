import { useEffect, useState } from "react";
import { gooeyToast as toast } from "goey-toast";
import { updateRows } from "../../../lib/db";
import Alert from "../../../ui/Alert";
import { fmtMoney } from "../../../utils";
import Select from "../../../ui/Select";

// Optimistic toggles that move back with the reason if updateRows reports the write didn't land.
export default function FinancePanel({ campaign, isOwner, onRefresh, finance, rates, setRates }) {
  const [err, setErr] = useState("");
  const { isSalesSourced, salesRate, managerRate, showClientCpm } = rates;
  useEffect(() => { setErr(""); }, [campaign.id]);

  const write = async (patch, optimistic, revert, label) => {
    setErr(""); setRates(r => ({ ...r, ...optimistic }));
    const e = await updateRows("campaigns", patch, { id: campaign.id });
    if (e) { setRates(r => ({ ...r, ...revert })); setErr(e); toast.error("Not saved", { description: e }); return; }
    toast.success(label);
    onRefresh();
  };

  const f = finance;
  const marginTone = f.margin >= 50 ? "var(--green)" : f.margin >= 25 ? "var(--ink)" : "var(--red)";
  const cpvTone = f.costPerVideo === 0 ? "var(--ink3)" : f.costPerVideo <= 50 ? "var(--green)" : f.costPerVideo <= 60 ? "var(--amber)" : "var(--red)";
  const tiles = [
    ["Revenue", fmtMoney(f.revenue), "client budget"],
    ["Creator cost", fmtMoney(f.creatorCost), `${f.approved} approved × ${fmtMoney(campaign.pay_per_video)}`],
    ["Manager commission", fmtMoney(f.managerCost), `${Math.round(f.activeMgrRate * 100)}%${managerRate == null ? "" : " override"}`],
    ...(isSalesSourced ? [["Sales commission", fmtMoney(f.salesCost), `${Math.round(f.activeSalesRate * 100)}% of budget`]] : []),
    ["Gross profit", fmtMoney(f.grossProfit), null, f.grossProfit >= 0 ? "var(--ink)" : "var(--red)"],
    ["Margin", `${f.margin}%`, "target 60%", marginTone],
    ["Cost per video", f.costPerVideo > 0 ? fmtMoney(f.costPerVideo) : "--", "target under $50", cpvTone],
    ["CPM", f.cpm == null ? "--" : fmtMoney(f.cpm, { cents: true }), f.views > 0 ? `${f.views.toLocaleString()} views` : "no views synced yet"],
  ];

  return (
    <section>
      <h3 className="section-title">Money</h3>
      <div className="mini-stats">
        {tiles.map(([label, value, sub, color]) => (
          <div key={label} className="metric-mini"><div className="metric-mini-label">{label}</div><div className="metric-mini-val" style={{ color, fontSize: 18 }}>{value}</div>{sub && <div className="fs-11 text-muted">{sub}</div>}</div>
        ))}
      </div>
      <div className="fieldset mt-12">
        <label className="check">
          <input type="checkbox" checked={isSalesSourced} onChange={() => write({ is_sales_sourced: !isSalesSourced }, { isSalesSourced: !isSalesSourced }, { isSalesSourced }, !isSalesSourced ? "Marked as sales sourced" : "No longer sales sourced")} />
          <span><span className="fw-600">Sales sourced</span>{isSalesSourced && !isOwner && <span className="text-muted"> · {Math.round(f.activeSalesRate * 100)}% commission</span>}</span>
        </label>
        {isOwner && isSalesSourced && (
          <div className="flex-center gap-8 mt-8 fs-13"><label htmlFor="sales-rate" className="text-muted">Sales commission</label>
            <Select id="sales-rate" className="select" style={{ width: "auto", minHeight: 32, height: 32 }} value={salesRate} onChange={e => write({ sales_commission_rate: Number(e.target.value) }, { salesRate: Number(e.target.value) }, { salesRate }, "Sales commission updated")}>
              <option value={0.10}>10%</option><option value={0.20}>20%</option><option value={0.30}>30%</option>
            </Select></div>
        )}
        <div className="flex-center gap-8 mt-12 fs-13"><span className="text-muted">Manager commission</span>
          {isOwner ? (
            <Select aria-label="Manager commission" className="select" style={{ width: "auto", minHeight: 32, height: 32 }} value={managerRate ?? ""}
              onChange={e => { const v = e.target.value === "" ? null : Number(e.target.value); write({ manager_commission_rate: v }, { managerRate: v }, { managerRate }, "Manager commission updated"); }}>
              <option value="">Manager's default ({Math.round(f.amDefaultRate * 100)}%)</option>
              <option value={0.10}>10% for this campaign</option><option value={0.15}>15% for this campaign</option><option value={0.20}>20% for this campaign</option>
            </Select>
          ) : <strong>{Math.round(f.activeMgrRate * 100)}%</strong>}
        </div>
        <label className="check mt-12">
          <input type="checkbox" checked={showClientCpm} onChange={() => write({ show_client_cpm: !showClientCpm }, { showClientCpm: !showClientCpm }, { showClientCpm }, !showClientCpm ? "Client can now see CPM" : "CPM hidden from the client")} />
          <span>Show CPM to the client</span>
        </label>
        {err && <Alert tone="error" style={{ marginTop: 12 }}>{err}</Alert>}
      </div>
    </section>
  );
}
