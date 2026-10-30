import { useState } from "react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { gooeyToast as toast } from "goey-toast";
import AMClientSummaryBar from "../../components/AMClientSummaryBar";
import { updateRows } from "../../lib/db";
import { supabase } from "../../supabaseClient";
import Alert from "../../ui/Alert";
import Dialog from "../../ui/Dialog";
import Icon from "../../ui/Icon";
import { fmtDate, statusBadge } from "../../utils";

const FIELDS = [
  ["description", "What they do", "Their business, product or service.", 3],
  ["goals", "Goals", "What they want from UGC: awareness, conversions, followers.", 3],
  ["target_audience", "Audience", "Who they're trying to reach.", 2],
  ["content_guidelines", "Content guidelines", "Tone, style, dos and don'ts.", 3],
  ["notes", "Notes", "Anything else the team should know.", 2],
  ["contract_notes", "Contract notes", "Payment schedule, deliverables, special terms.", 3],
];

export default function ClientProfile({ client, db, onRefresh, onClose, isOwner, user, onLink }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [form, setForm] = useState(() => Object.fromEntries([...FIELDS.map(([k]) => [k, client[k] || ""]), ["contract_url", client.contract_url || ""]]));
  const [archiving, setArchiving] = useState(false);
  const [reason, setReason] = useState("");
  const isArchived = client.status === "Archived";

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    const error = await updateRows("clients", form, { id: client.id });
    setBusy(false);
    if (error) return setErr(error);
    toast.success(`${client.name} saved`);
    setEditing(false); onRefresh();
  };

  // §11.1: clients anchor campaigns and money, so they are archived, never removed here.
  const setArchived = async (archived) => {
    if (archived && !reason.trim()) return setErr("Add a reason. It's what the audit log will show.");
    setBusy(true); setErr("");
    const patch = archived ? { status: "Archived", archived_at: new Date().toISOString(), archived_by: user?.id || null, archive_reason: reason.trim() } : { status: "Active", archived_at: null, archived_by: null, archive_reason: null };
    const { data, error } = await supabase.from("clients").update(patch).eq("id", client.id).select("id");
    setBusy(false);
    if (error || !data?.length) return setErr(error ? error.message : "That client wasn't updated. You may not have permission.");
    toast.success(archived ? `${client.name} archived` : `${client.name} restored`);
    onRefresh(); onClose();
  };

  return (
    <Dialog size="sheet" title={client.name} description={[client.deal_type, client.contact_name].filter(Boolean).join(" · ")} onClose={onClose}>
      <div className="flex-between flex-wrap gap-12 mb-16">
        <span className="flex gap-8">{statusBadge(client.status)}{client.user_id ? <span className="badge badge-green">Portal linked</span> : <span className="badge badge-gray">No portal account</span>}</span>
        {!editing && <span className="flex gap-8">
          {isOwner && (isArchived ? <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setArchived(false)}>Restore</button> : <button className="btn btn-ghost btn-sm" onClick={() => setArchiving(a => !a)}>Archive</button>)}
          <button className="btn btn-primary btn-sm" onClick={() => setEditing(true)}>Edit details</button>
        </span>}
      </div>
      {isArchived && <Alert tone="info" title="Archived" style={{ marginBottom: 16 }}>{client.archive_reason || "No reason recorded."}{client.archived_at ? ` · ${fmtDate(client.archived_at)}` : ""}</Alert>}
      {archiving && (
        <div className="fieldset mb-16">
          <p className="fs-13 text-muted mb-12">Their campaigns, submissions and money stay linked, and you can restore them any time.</p>
          <div className="flex gap-8 flex-wrap"><input className="form-input flex-1" style={{ minWidth: 220 }} aria-label="Reason" placeholder="Reason, e.g. the contract ended in August" value={reason} onChange={e => setReason(e.target.value)} /><button className="btn btn-danger" disabled={busy || !reason.trim()} onClick={() => setArchived(true)}>Archive</button></div>
        </div>
      )}
      {err && <Alert tone="error" style={{ marginBottom: 16 }}>{err}</Alert>}
      {!isOwner && !editing && <div className="mb-16"><AMClientSummaryBar client={client} db={db} /></div>}

      {editing ? (
        <form onSubmit={save} noValidate>
          {FIELDS.map(([k, label, hint, rows]) => (
            <div key={k} className="form-group"><label className="form-label" htmlFor={`cp-${k}`}>{label}</label><textarea id={`cp-${k}`} className="textarea" rows={rows} placeholder={hint} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} /></div>
          ))}
          <div className="form-group"><label className="form-label" htmlFor="cp-url">Contract link</label><input id="cp-url" className="form-input" inputMode="url" value={form.contract_url} onChange={e => setForm({ ...form, contract_url: e.target.value })} /></div>
          <div className="flex gap-8"><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button><button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button></div>
        </form>
      ) : (
        <div className="flex-col gap-16">
          <dl className="kv" style={{ gridTemplateColumns: "minmax(120px, 28%) 1fr", rowGap: 14 }}>
            {FIELDS.map(([k, label]) => <div key={k} style={{ display: "contents" }}><dt>{label}</dt><dd style={{ whiteSpace: "pre-line", color: form[k] ? undefined : "var(--ink4)" }}>{form[k] || "Not added yet"}</dd></div>)}
          </dl>
          {form.contract_url && <a href={form.contract_url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm" style={{ alignSelf: "flex-start" }}>Open contract<Icon icon={ArrowUpRight01Icon} size={14} /></a>}
          {!client.user_id && (
            <Alert tone="info" title="No portal account yet" action={onLink && <button className="btn btn-secondary btn-sm" onClick={() => onLink(client)}>Link account</button>}>
              Ask the client to sign up at {window.location.host} as a brand, then link their account here.
            </Alert>
          )}
        </div>
      )}
    </Dialog>
  );
}
