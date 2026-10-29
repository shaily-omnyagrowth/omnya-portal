import { useState } from "react";
import { updateRows } from "../../lib/db";

// Owner-only editor behind the "Edit" button on each Revenue Analytics row.
//
// Every figure on that row is derived from four stored numbers, and this is
// where each of them can be corrected after the fact:
//
//   Revenue          clients.budget
//   Creator cost     campaigns.pay_per_video   (x approved videos)
//   Sales comm.      campaigns.is_sales_sourced + sales_commission_rate
//   Manager comm.    campaigns.manager_commission_rate, else the manager's own
//                    account_managers.commission_rate
//
// Only rows that actually changed are written, each through updateRows(), and
// the first failure stops the save and is shown — nothing here reports success
// it did not have. The database enforces the same rules independently: only
// the owner may change a rate, and only 10/20/30% are valid sales rates.
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

    await onSaved();
    setSaving(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{maxWidth:640}} onClick={e=>e.stopPropagation()}>
        <div className="modal-title">Edit figures — {client.name}</div>
        <div className="modal-sub">These are the stored numbers every column on this row is calculated from.</div>

        <div className="grid-2" style={{gap:12}}>
          <div className="form-group">
            <label className="form-label">Monthly budget / revenue ($)</label>
            <input className="form-input" type="number" min="0" value={budget} onChange={e=>setBudget(e.target.value)}/>
          </div>
          <div className="form-group">
            <label className="form-label">Manager's default commission (%)</label>
            <input className="form-input" type="number" min="0" max="50" value={amRate} disabled={!clientAM} onChange={e=>setAmRate(e.target.value)}/>
            <div className="form-hint">
              {clientAM ? `Applies to every client managed by ${clientAM.name}, unless a campaign overrides it below.` : "No account manager is assigned to this client."}
            </div>
          </div>
        </div>

        <div style={{fontSize:13,fontWeight:600,margin:"8px 0"}}>Campaigns ({camps.length})</div>
        {camps.length===0&&<div style={{fontSize:13,color:"var(--ink3)",marginBottom:12}}>This client has no campaigns yet.</div>}
        <div style={{display:"flex",flexDirection:"column",gap:10,maxHeight:320,overflowY:"auto",marginBottom:12}}>
          {camps.map(c=>(
            <div key={c.id} style={{border:"1px solid var(--border2)",borderRadius:"var(--radius-sm)",padding:"10px 12px"}}>
              <div style={{fontWeight:600,fontSize:13,marginBottom:8}}>{c.name}</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(150px, 1fr))",gap:10,alignItems:"end"}}>
                <div>
                  <label className="form-label" style={{fontSize:10}}>Pay per video ($)</label>
                  <input className="form-input" type="number" min="0" value={c.pay_per_video} onChange={e=>setCamp(c.id,{pay_per_video:e.target.value})}/>
                </div>
                <div>
                  <label className="form-label" style={{fontSize:10}}>Sales commission</label>
                  <select className="select" value={c.is_sales_sourced?String(c.sales_commission_rate):"none"}
                          onChange={e=>e.target.value==="none"
                            ? setCamp(c.id,{is_sales_sourced:false})
                            : setCamp(c.id,{is_sales_sourced:true,sales_commission_rate:Number(e.target.value)})}>
                    <option value="none">Not sales sourced</option>
                    <option value="0.1">10%</option>
                    <option value="0.2">20%</option>
                    <option value="0.3">30%</option>
                  </select>
                </div>
                <div>
                  <label className="form-label" style={{fontSize:10}}>Manager commission</label>
                  <select className="select" value={c.manager_commission_rate} onChange={e=>setCamp(c.id,{manager_commission_rate:e.target.value})}>
                    <option value="">Manager's default</option>
                    <option value="0.1">10%</option>
                    <option value="0.15">15%</option>
                    <option value="0.2">20%</option>
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>

        {err&&<div style={{color:"var(--red)",fontSize:13,marginBottom:12}} role="alert">{err}</div>}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?"Saving…":"Save changes"}</button>
        </div>
      </div>
    </div>
  );
}
