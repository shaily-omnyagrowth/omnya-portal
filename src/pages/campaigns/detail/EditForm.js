import { useState } from "react";
import { gooeyToast as toast } from "goey-toast";
import { updateRows } from "../../../lib/db";
import Alert from "../../../ui/Alert";
import Select from "../../../ui/Select";

const toForm = (c) => ({
  name: c.name || "", description: c.description || "", format: c.format || "TikTok", videos_needed: c.videos_needed || 10,
  pay_per_video: c.pay_per_video || 10, deadline: c.deadline || "", status: c.status || "Open",
  is_sales_sourced: Boolean(c.is_sales_sourced), sales_commission_rate: Number(c.sales_commission_rate ?? 0.30),
  manager_commission_rate: c.manager_commission_rate == null ? null : Number(c.manager_commission_rate), show_client_cpm: Boolean(c.show_client_cpm),
});

export default function EditForm({ campaign, isOwner, amDefaultRate, onCancel, onSaved }) {
  const [form, setForm] = useState(() => toForm(campaign));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const set = (patch) => setForm(f => ({ ...f, ...patch }));

  const save = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setErr("The campaign needs a name.");
    setSaving(true); setErr("");
    const patch = {
      name: form.name.trim(), description: form.description, format: form.format, status: form.status,
      videos_needed: Number(form.videos_needed), pay_per_video: Number(form.pay_per_video), deadline: form.deadline || null,
      is_sales_sourced: Boolean(form.is_sales_sourced), show_client_cpm: Boolean(form.show_client_cpm),
    };
    // Rates are owner-only (campaigns_guard_commission_rates), so managers never send them.
    if (isOwner) { patch.sales_commission_rate = Number(form.sales_commission_rate || 0.30);
      patch.manager_commission_rate = form.manager_commission_rate == null || form.manager_commission_rate === "" ? null : Number(form.manager_commission_rate);
    }
    const error = await updateRows("campaigns", patch, { id: campaign.id });
    setSaving(false);
    if (error) return setErr(error);
    toast.success("Campaign saved");
    onSaved();
  };

  return (
    <form onSubmit={save} noValidate>
      <div className="form-group"><label className="form-label" htmlFor="e-name">Name</label><input id="e-name" className="form-input" value={form.name} onChange={e => set({ name: e.target.value })} /></div>
      <div className="form-group"><label className="form-label" htmlFor="e-brief">Brief</label><textarea id="e-brief" className="textarea" rows={5} value={form.description} onChange={e => set({ description: e.target.value })} /></div>
      <div className="form-row">
        <div className="form-group"><label className="form-label" htmlFor="e-format">Format</label><Select id="e-format" className="select" value={form.format} onChange={e => set({ format: e.target.value })}>{["TikTok", "IG Reel", "FB Reel", "YouTube Short"].map(f => <option key={f}>{f}</option>)}</Select></div>
        <div className="form-group"><label className="form-label" htmlFor="e-status">Status</label><Select id="e-status" className="select" value={form.status} onChange={e => set({ status: e.target.value })}>{["Open", "In Progress", "Completed", "Paused"].map(s => <option key={s}>{s}</option>)}</Select></div>
        <div className="form-group"><label className="form-label" htmlFor="e-videos">Videos needed</label><input id="e-videos" className="form-input" type="number" inputMode="numeric" value={form.videos_needed} onChange={e => set({ videos_needed: e.target.value })} /></div>
        <div className="form-group"><label className="form-label" htmlFor="e-pay">Pay per video (USD)</label><input id="e-pay" className="form-input" type="number" inputMode="decimal" value={form.pay_per_video} onChange={e => set({ pay_per_video: e.target.value })} /></div>
        <div className="form-group"><label className="form-label" htmlFor="e-deadline">Deadline</label><input id="e-deadline" className="form-input" type="date" value={form.deadline} onChange={e => set({ deadline: e.target.value })} /></div>
      </div>
      <fieldset className="fieldset">
        <legend className="form-label">Money and visibility</legend>
        <label className="check"><input type="checkbox" checked={form.is_sales_sourced} onChange={e => set({ is_sales_sourced: e.target.checked })} /><span className="fw-600">Sales sourced</span></label>
        {isOwner && form.is_sales_sourced && (
          <div className="form-group mt-12"><label className="form-label" htmlFor="e-sales">Sales commission</label>
            <Select id="e-sales" className="select" value={form.sales_commission_rate} onChange={e => set({ sales_commission_rate: Number(e.target.value) })}><option value={0.10}>10%</option><option value={0.20}>20%</option><option value={0.30}>30%</option></Select></div>
        )}
        {isOwner && (
          <div className="form-group mt-12"><label className="form-label" htmlFor="e-mgr">Manager commission</label>
            <Select id="e-mgr" className="select" value={form.manager_commission_rate ?? ""} onChange={e => set({ manager_commission_rate: e.target.value === "" ? null : Number(e.target.value) })}>
              <option value="">Manager's default ({Math.round(amDefaultRate * 100)}%)</option><option value={0.10}>10% for this campaign</option><option value={0.15}>15% for this campaign</option><option value={0.20}>20% for this campaign</option>
            </Select></div>
        )}
        <label className="check mt-12"><input type="checkbox" checked={form.show_client_cpm} onChange={e => set({ show_client_cpm: e.target.checked })} /><span>Show CPM to the client</span></label>
      </fieldset>
      {err && <Alert tone="error" style={{ marginTop: 16 }}>{err}</Alert>}
      <div className="flex gap-8 mt-16">
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
