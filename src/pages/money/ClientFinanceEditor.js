import { useState } from "react";
import { gooeyToast as toast } from "goey-toast";
import { updateRows } from "../../lib/db";
import Alert from "../../ui/Alert";
import Dialog from "../../ui/Dialog";
import Select from "../../ui/Select";

export default function ClientFinanceEditor({ row, onClose, onSaved }) {
  const { client, clientAM, clientCampaigns } = row;
  const [budget, setBudget] = useState(String(client.budget ?? 0));
  const [amRate, setAmRate] = useState(String(Math.round(Number(clientAM?.commission_rate ?? 0.10) * 100)));
  const [camps, setCamps] = useState(() => clientCampaigns.map(c => ({
    id: c.id,
    name: c.name,
    is_sales_sourced: Boolean(c.is_sales_sourced),
    sales_commission_rate: Number(c.sales_commission_rate ?? 0.30),
    manager_commission_rate: c.manager_commission_rate == null ? "" : String(Number(c.manager_commission_rate)),
    pay_per_video: String(c.pay_per_video ?? 0),
  })));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const setCamp = (id, patch) => setCamps(list => list.map(c => c.id === id ? { ...c, ...patch } : c));

  const save = async () => {
    setErr("");
    const nextBudget = Number(budget);
    if (!Number.isFinite(nextBudget) || nextBudget < 0) { setErr("Budget has to be a number, 0 or more."); return; }
    const nextAmRate = Number(amRate) / 100;
    if (clientAM && (!Number.isFinite(nextAmRate) || nextAmRate < 0 || nextAmRate > 0.5)) {
      setErr("The manager's default commission has to be between 0% and 50%."); return;
    }
    for (const c of camps) {
      const pay = Number(c.pay_per_video);
      if (!Number.isFinite(pay) || pay < 0) { setErr(`Pay per video for "${c.name}" has to be a number, 0 or more.`); return; }
    }

    setSaving(true);
    const fail = (where, message) => { setErr(`${where}: ${message}`); setSaving(false); };

    if (nextBudget !== Number(client.budget ?? 0)) {
      const e = await updateRows("clients", { budget: nextBudget }, { id: client.id });
      if (e) return fail("Budget", e);
    }
    if (clientAM && nextAmRate !== Number(clientAM.commission_rate ?? 0.10)) {
      const e = await updateRows("account_managers", { commission_rate: nextAmRate }, { id: clientAM.id });
      if (e) return fail("Manager's default commission", e);
    }
    for (const c of camps) {
      const before = clientCampaigns.find(x => x.id === c.id);
      const patch = {};
      if (c.is_sales_sourced !== Boolean(before.is_sales_sourced)) patch.is_sales_sourced = c.is_sales_sourced;
      if (Number(c.sales_commission_rate) !== Number(before.sales_commission_rate ?? 0.30)) patch.sales_commission_rate = Number(c.sales_commission_rate);
      const mgr = c.manager_commission_rate === "" ? null : Number(c.manager_commission_rate);
      const mgrBefore = before.manager_commission_rate == null ? null : Number(before.manager_commission_rate);
      if (mgr !== mgrBefore) patch.manager_commission_rate = mgr;
      if (Number(c.pay_per_video) !== Number(before.pay_per_video ?? 0)) patch.pay_per_video = Number(c.pay_per_video);
      if (Object.keys(patch).length === 0) continue;
      const e = await updateRows("campaigns", patch, { id: c.id });
      if (e) return fail(c.name, e);
    }

    toast.success(`${client.name} updated`);
    await onSaved();
    setSaving(false);
  };

  return (
    <Dialog size="lg" title={`Edit ${client.name}`} description="The stored numbers this row is calculated from." onClose={onClose}
      actions={<><button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button></>}>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label" htmlFor="fe-budget">Monthly revenue ($)</label>
          <input id="fe-budget" className="form-input" type="number" inputMode="decimal" min="0" value={budget} onChange={e => setBudget(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="fe-am">Manager's default commission (%)</label>
          <input id="fe-am" className="form-input" type="number" inputMode="decimal" min="0" max="50" value={amRate} disabled={!clientAM} onChange={e => setAmRate(e.target.value)} />
          <div className="form-hint">{clientAM ? `Applies to every client ${clientAM.name} manages, unless a campaign below overrides it.` : "No account manager is assigned to this client."}</div>
        </div>
      </div>

      <h3 className="card-title" style={{ marginTop: 8 }}>Campaigns</h3>
      {camps.length === 0 && <p className="fs-13 text-muted">This client has no campaigns yet.</p>}
      <div className="list-stack gap-12">
        {camps.map(c => (
          <fieldset key={c.id} className="card" style={{ padding: 14, margin: 0 }}>
            <legend className="sr-only">{c.name}</legend>
            <div className="fw-600 truncate mb-8" style={{ color: "var(--ink)" }}>{c.name}</div>
            <div className="form-row" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" htmlFor={`fe-pay-${c.id}`}>Pay per video ($)</label>
                <input id={`fe-pay-${c.id}`} className="form-input" type="number" inputMode="decimal" min="0" value={c.pay_per_video} onChange={e => setCamp(c.id, { pay_per_video: e.target.value })} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" htmlFor={`fe-sales-${c.id}`}>Sales commission</label>
                <Select id={`fe-sales-${c.id}`} className="select" value={c.is_sales_sourced ? String(c.sales_commission_rate) : "none"}
                  onChange={e => e.target.value === "none" ? setCamp(c.id, { is_sales_sourced: false }) : setCamp(c.id, { is_sales_sourced: true, sales_commission_rate: Number(e.target.value) })}>
                  <option value="none">Not sales sourced</option>
                  <option value="0.1">10%</option>
                  <option value="0.2">20%</option>
                  <option value="0.3">30%</option>
                </Select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" htmlFor={`fe-mgr-${c.id}`}>Manager commission</label>
                <Select id={`fe-mgr-${c.id}`} className="select" value={c.manager_commission_rate} onChange={e => setCamp(c.id, { manager_commission_rate: e.target.value })}>
                  <option value="">Manager's default</option>
                  <option value="0.1">10%</option>
                  <option value="0.15">15%</option>
                  <option value="0.2">20%</option>
                </Select>
              </div>
            </div>
          </fieldset>
        ))}
      </div>
      {err && <Alert tone="error" style={{ marginTop: 12 }}>{err}</Alert>}
    </Dialog>
  );
}
