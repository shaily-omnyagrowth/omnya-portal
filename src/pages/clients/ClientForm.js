import Alert from "../../ui/Alert";
import Dialog from "../../ui/Dialog";

export default function ClientForm({ data, setData, onSave, onCancel, title, db, err, saving }) {
  const s = (patch) => setData({ ...data, ...patch });
  const field = (k, label, props = {}) => (
    <div className="form-group"><label className="form-label" htmlFor={`cl-${k}`}>{label}</label><input id={`cl-${k}`} className="form-input" value={data[k] || ""} onChange={e => s({ [k]: e.target.value })} {...props} /></div>
  );
  return (
    <Dialog size="lg" title={title} onClose={onCancel}
      actions={<><button className="btn btn-secondary" onClick={onCancel}>Cancel</button><button type="submit" form="client-form" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save client"}</button></>}>
      <form id="client-form" onSubmit={e => { e.preventDefault(); onSave(); }} noValidate>
        {field("name", "Client name", { placeholder: "e.g. Eden Health", autoFocus: true })}
        <div className="form-row">
          <div className="form-group"><label className="form-label" htmlFor="cl-deal">Deal type</label><select id="cl-deal" className="select" value={data.deal_type || "Monthly Retainer"} onChange={e => s({ deal_type: e.target.value })}>{["Monthly Retainer", "One-Off", "Trial"].map(x => <option key={x}>{x}</option>)}</select></div>
          <div className="form-group"><label className="form-label" htmlFor="cl-status">Status</label><select id="cl-status" className="select" value={data.status || "Active"} onChange={e => s({ status: e.target.value })}>{["Active", "Paused", "Completed"].map(x => <option key={x}>{x}</option>)}</select></div>
          {field("videos_per_month", "Videos per month", { type: "number", inputMode: "numeric", min: 0 })}
          {field("budget", "Monthly budget (USD)", { type: "number", inputMode: "decimal", min: 0 })}
        </div>
        <div className="form-row">
          {field("contact_name", "Contact name")}
          {field("contact_email", "Contact email", { type: "email", inputMode: "email" })}
          {field("contact_phone", "Contact phone", { type: "tel", inputMode: "tel" })}
          <div className="form-group"><label className="form-label" htmlFor="cl-am">Account manager</label><select id="cl-am" className="select" value={data.am_id || ""} onChange={e => s({ am_id: e.target.value || null })}><option value="">Unassigned</option>{db.accountManagers.filter(a => a.status !== "Archived").map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        </div>
        {field("drive_link", "Shared drive link", { inputMode: "url", placeholder: "https://drive.google.com/…" })}
        <div className="form-group"><label className="form-label" htmlFor="cl-notes">Contract notes</label><textarea id="cl-notes" className="textarea" rows={3} value={data.contract_notes || ""} onChange={e => s({ contract_notes: e.target.value })} placeholder="Terms, payment schedule, anything unusual" /></div>
        {field("contract_url", "Contract link (optional)", { inputMode: "url" })}
        {err && <Alert tone="error">{err}</Alert>}
      </form>
    </Dialog>
  );
}
