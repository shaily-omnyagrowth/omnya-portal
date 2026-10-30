import { useState } from "react";
import { gooeyToast as toast } from "goey-toast";
import { describeWriteError } from "../../lib/db";
import { supabase } from "../../supabaseClient";
import Alert from "../../ui/Alert";
import Dialog from "../../ui/Dialog";

const BLANK = {
  name: "", client_id: "", description: "", format: "TikTok", videos_needed: 10, pay_per_video: 10, deadline: "", status: "Open",
  application_type: "Open Application", is_sales_sourced: false, sales_commission_rate: 0.30, manager_commission_rate: null, show_client_cpm: false,
};

export default function NewCampaignDialog({ clients, isOwner, onClose, onCreated }) {
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const set = (patch) => setForm(f => ({ ...f, ...patch }));

  const create = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.client_id) return setErr("Add a name and choose the client.");
    setSaving(true); setErr("");
    // The sales rate is never 0: only 10/20/30% are valid and is_sales_sourced decides if it applies.
    const { error } = await supabase.from("campaigns").insert({
      ...form,
      name: form.name.trim(),
      videos_needed: Number(form.videos_needed),
      pay_per_video: Number(form.pay_per_video),
      sales_commission_rate: Number(form.sales_commission_rate || 0.30),
      manager_commission_rate: form.manager_commission_rate == null || form.manager_commission_rate === "" ? null : Number(form.manager_commission_rate),
      show_client_cpm: Boolean(form.show_client_cpm),
      deadline: form.deadline || null,
      assigned_creators: [],
    });
    setSaving(false);
    if (error) return setErr(describeWriteError(error));
    toast.success("Campaign created", { description: `${form.name.trim()} is open for applications.` });
    onCreated();
  };

  return (
    <Dialog size="lg" title="New campaign" description="Creators see the name, brief, format and pay when they browse jobs." onClose={onClose}
      actions={<><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="new-campaign" className="btn btn-primary" disabled={saving}>{saving ? "Creating…" : "Create campaign"}</button></>}>
      <form id="new-campaign" onSubmit={create} noValidate>
        <div className="form-row">
          <div className="form-group"><label className="form-label" htmlFor="c-name">Campaign name</label><input id="c-name" className="form-input" value={form.name} onChange={e => set({ name: e.target.value })} placeholder="Spring launch" autoFocus /></div>
          <div className="form-group"><label className="form-label" htmlFor="c-client">Client</label>
            <select id="c-client" className="select" value={form.client_id} onChange={e => set({ client_id: e.target.value })}>
              <option value="">Choose a client</option>
              {clients.filter(c => !c.archived_at).sort((a, b) => (a.name || "").localeCompare(b.name || "")).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group"><label className="form-label" htmlFor="c-brief">Brief</label><textarea id="c-brief" className="textarea" rows={4} value={form.description} onChange={e => set({ description: e.target.value })} placeholder="What to make, talking points, the call to action and anything to avoid." /></div>
        <div className="form-row">
          <div className="form-group"><label className="form-label" htmlFor="c-format">Format</label><select id="c-format" className="select" value={form.format} onChange={e => set({ format: e.target.value })}>{["TikTok", "IG Reel", "FB Reel", "YouTube Short"].map(f => <option key={f}>{f}</option>)}</select></div>
          <div className="form-group"><label className="form-label" htmlFor="c-deadline">Deadline</label><input id="c-deadline" className="form-input" type="date" value={form.deadline} onChange={e => set({ deadline: e.target.value })} /></div>
          <div className="form-group"><label className="form-label" htmlFor="c-videos">Videos needed</label><input id="c-videos" className="form-input" type="number" inputMode="numeric" min="1" value={form.videos_needed} onChange={e => set({ videos_needed: e.target.value })} /></div>
          <div className="form-group"><label className="form-label" htmlFor="c-pay">Pay per video (USD)</label><input id="c-pay" className="form-input" type="number" inputMode="decimal" min="0" value={form.pay_per_video} onChange={e => set({ pay_per_video: e.target.value })} /></div>
        </div>
        <fieldset className="fieldset">
          <legend className="form-label">Money and visibility</legend>
          <label className="check"><input type="checkbox" checked={form.is_sales_sourced} onChange={e => set({ is_sales_sourced: e.target.checked })} /><span><span className="fw-600">Sales sourced</span><span className="form-hint" style={{ display: "block" }}>A sales commission is charged on this campaign.</span></span></label>
          {isOwner && form.is_sales_sourced && (
            <div className="form-group" style={{ marginTop: 12 }}><label className="form-label" htmlFor="c-sales">Sales commission</label>
              <select id="c-sales" className="select" value={form.sales_commission_rate} onChange={e => set({ sales_commission_rate: Number(e.target.value) })}><option value={0.10}>10%</option><option value={0.20}>20%</option><option value={0.30}>30%</option></select></div>
          )}
          {isOwner && (
            <div className="form-group" style={{ marginTop: 12 }}><label className="form-label" htmlFor="c-mgr">Manager commission</label>
              <select id="c-mgr" className="select" value={form.manager_commission_rate ?? ""} onChange={e => set({ manager_commission_rate: e.target.value === "" ? null : Number(e.target.value) })}>
                <option value="">Use the manager's default rate</option><option value={0.10}>10% for this campaign</option><option value={0.15}>15% for this campaign</option><option value={0.20}>20% for this campaign</option>
              </select></div>
          )}
          <label className="check" style={{ marginTop: 12 }}><input type="checkbox" checked={form.show_client_cpm} onChange={e => set({ show_client_cpm: e.target.checked })} /><span><span className="fw-600">Show CPM to the client</span><span className="form-hint" style={{ display: "block" }}>Adds cost per thousand views to their brand portal.</span></span></label>
        </fieldset>
        {err && <Alert tone="error" style={{ marginTop: 16 }}>{err}</Alert>}
      </form>
    </Dialog>
  );
}
