import { useState } from "react";
import { Building03Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { gooeyToast as toast } from "goey-toast";
import { describeWriteError } from "../../lib/db";
import { supabase } from "../../supabaseClient";
import Alert from "../../ui/Alert";
import Dialog from "../../ui/Dialog";
import EmptyState, { NoMatchRow } from "../../ui/EmptyState";
import Icon from "../../ui/Icon";
import PageHeader from "../../ui/PageHeader";
import { fmtMoney, statusBadge } from "../../utils";
import ClientForm from "./ClientForm";
import ClientProfile from "./ClientProfile";
import usePagination from "../../ui/Pagination";

const EMPTY = { name: "", deal_type: "Monthly Retainer", videos_per_month: 20, budget: 0, status: "Active", contact_name: "", contact_email: "", contact_phone: "", contract_notes: "", contract_url: "", drive_link: "" };

export default function ClientsPage({ isOwner, db, onRefresh, user }) {
  const [form, setForm] = useState(null);
  const [viewId, setViewId] = useState(null);
  const [link, setLink] = useState(null);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const archivedCount = db.clients.filter(c => c.status === "Archived").length;
  const rows = db.clients.filter(c => (showArchived || c.status !== "Archived") && (!search.trim() || `${c.name} ${c.contact_name || ""}`.toLowerCase().includes(search.toLowerCase())))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const { rows: page, pager } = usePagination(rows, { label: "clients" });
  const viewClient = viewId && db.clients.find(c => c.id === viewId);
  const open = (kind, c) => { setErr(""); setText(""); kind === "link" ? setLink(c) : kind === "archive" ? setArchiveTarget(c) : setDeleteTarget(c); };

  const saveClient = async () => {
    if (!form.name?.trim()) return setErr("Add the client's name.");
    setBusy(true); setErr("");
    const row = { ...form, name: form.name.trim(), videos_per_month: Number(form.videos_per_month), budget: Number(form.budget) };
    if (!form.id && !isOwner) { const mine = db.accountManagers.find(a => a.email === user?.email); if (mine) row.am_id = mine.id; }
    const { error } = form.id ? await supabase.from("clients").update(row).eq("id", form.id) : await supabase.from("clients").insert(row);
    setBusy(false);
    if (error) return setErr(describeWriteError(error));
    toast.success(form.id ? `${row.name} saved` : `${row.name} added`);
    setForm(null); onRefresh();
  };

  const linkAccount = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true); setErr("");
    try {
      const { data: profile, error } = await supabase.from("user_profiles").select("id, full_name, role").eq("email", text.trim().toLowerCase()).maybeSingle();
      if (error) throw error;
      if (!profile) throw new Error(`No account uses ${text.trim()}. Ask the client to sign up as a brand first.`);
      if (profile.role !== "client") throw new Error(`That account is set up as ${profile.role}, not a brand. They need to sign up as a brand.`);
      const { error: upErr } = await supabase.from("clients").update({ user_id: profile.id }).eq("id", link.id).is("user_id", null);
      if (upErr) throw upErr;
      toast.success("Portal account linked", { description: `${profile.full_name || text.trim()} can sign in to the brand portal now.` });
      setLink(null); onRefresh();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  // Archive keeps campaigns, submissions and payments linked; it can be undone.
  const setArchived = async (c, archived) => {
    if (archived && !text.trim()) return setErr("Add a reason. It's what the audit log will show.");
    setBusy(true); setErr("");
    const patch = archived ? { status: "Archived", archived_at: new Date().toISOString(), archived_by: user?.id || null, archive_reason: text.trim() } : { status: "Active", archived_at: null, archived_by: null, archive_reason: null };
    const { data, error } = await supabase.from("clients").update(patch).eq("id", c.id).select("id");
    setBusy(false);
    if (error || !data?.length) return archived ? setErr(error ? error.message : "That client wasn't updated. You may not have permission.") : toast.error("Not restored", { description: error?.message });
    toast.success(archived ? `${c.name} archived` : `${c.name} restored`);
    setArchiveTarget(null); onRefresh();
  };

  // campaigns.client_id has no ON DELETE, so Postgres refuses (23503) for a client with campaigns.
  const remove = async () => {
    setBusy(true); setErr("");
    const { error } = await supabase.from("clients").delete().eq("id", deleteTarget.id);
    setBusy(false);
    if (error) return setErr(error.code === "23503" || /foreign key/i.test(error.message || "") ? `${deleteTarget.name} still has campaigns, so it can't be deleted. Archive it instead.` : error.message);
    toast(`${deleteTarget.name} deleted`);
    setDeleteTarget(null); onRefresh();
  };

  const linkedCampaigns = deleteTarget ? db.campaigns.filter(c => c.client_id === deleteTarget.id).length : 0;

  return (
    <div className="content">
      <PageHeader title="Clients" description={isOwner ? "Every brand on the platform: budgets, account managers and portal access." : "The brands you look after. Contact details are visible to owners only."}
        actions={<button className="btn btn-primary" onClick={() => { setErr(""); setForm({ ...EMPTY }); }}>Add client</button>} />

      {db.clients.length === 0 ? (
        <div className="card"><EmptyState icon={Building03Icon} title="No clients yet" action={<button className="btn btn-primary btn-sm" onClick={() => setForm({ ...EMPTY })}>Add a client</button>}>Add a brand to start creating campaigns for it.</EmptyState></div>
      ) : (
        <>
          <div className="toolbar">
            <label className="toolbar-search" style={{ maxWidth: 320 }}><Icon icon={Search01Icon} size={16} /><span className="sr-only">Search clients</span><input className="form-input" type="search" placeholder="Search clients" value={search} onChange={e => setSearch(e.target.value)} /></label>
            {archivedCount > 0 && <label className="check" style={{ marginLeft: "auto" }}><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /><span>Show archived ({archivedCount})</span></label>}
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Client</th><th>Deal</th><th className="num">Videos a month</th><th className="num">Budget</th><th>Manager</th><th>Portal</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {page.map(c => (
                  <tr key={c.id} style={c.status === "Archived" ? { opacity: 0.6 } : undefined}>
                    <td><button className="text-btn fw-600 truncate" style={{ textDecoration: "none", maxWidth: 260, display: "block", textAlign: "left" }} onClick={() => setViewId(c.id)}>{c.name}</button>{isOwner && c.contact_email && <span className="fs-12 text-muted truncate" style={{ display: "block", maxWidth: 260 }}>{c.contact_name ? `${c.contact_name} · ` : ""}{c.contact_email}</span>}</td>
                    <td>{statusBadge(c.deal_type)}</td>
                    <td className="num">{c.videos_per_month ?? "--"}</td>
                    <td className="num fw-600" style={{ color: "var(--ink)" }}>{fmtMoney(c.budget)}</td>
                    <td>{db.accountManagers.find(a => a.id === c.am_id)?.name || <span className="text-muted">Unassigned</span>}</td>
                    <td>{c.user_id ? <span className="badge badge-green">Linked</span> : <button className="btn btn-ghost btn-sm" onClick={() => open("link", c)}>Link account</button>}</td>
                    <td>{statusBadge(c.status)}</td>
                    <td className="num"><span className="flex gap-4" style={{ justifyContent: "flex-end" }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setViewId(c.id)}>Open</button>
                      {isOwner && <button className="btn btn-ghost btn-sm" onClick={() => { setErr(""); setForm({ ...c }); }}>Edit</button>}
                      {isOwner && (c.status === "Archived" ? <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setArchived(c, false)}>Restore</button> : <button className="btn btn-ghost btn-sm" onClick={() => open("archive", c)}>Archive</button>)}
                      {isOwner && <button className="btn btn-ghost btn-sm" onClick={() => open("delete", c)}>Delete</button>}
                    </span></td>
                  </tr>
                ))}
                {rows.length === 0 && <NoMatchRow colSpan={8} onClear={() => setSearch("")}>No clients match your search.</NoMatchRow>}
              </tbody>
            </table>
          </div>
          {pager}
        </>
      )}

      {form && <ClientForm data={form} setData={setForm} onSave={saveClient} onCancel={() => setForm(null)} title={form.id ? `Edit ${form.name}` : "Add a client"} db={db} err={err} saving={busy} />}
      {viewClient && <ClientProfile client={viewClient} db={db} onRefresh={onRefresh} onClose={() => setViewId(null)} isOwner={isOwner} user={user} onLink={(c) => { setViewId(null); open("link", c); }} />}

      {link && (
        <Dialog size="sm" title="Link a portal account" description={`Connect ${link.name} to the brand account they signed up with.`} onClose={() => setLink(null)}
          actions={<><button className="btn btn-secondary" onClick={() => setLink(null)}>Cancel</button><button type="submit" form="link-form" className="btn btn-primary" disabled={busy || !text.trim()}>{busy ? "Linking…" : "Link account"}</button></>}>
          <form id="link-form" onSubmit={linkAccount}>
            <div className="form-group"><label className="form-label" htmlFor="link-email">Their sign in email</label><input id="link-email" className="form-input" type="email" inputMode="email" value={text} onChange={e => setText(e.target.value)} placeholder="name@brand.com" autoFocus /></div>
            {err && <Alert tone="error">{err}</Alert>}
          </form>
        </Dialog>
      )}

      {archiveTarget && (
        <Dialog size="sm" title={`Archive ${archiveTarget.name}?`} description="Campaigns, submissions and money history stay linked. You can restore the client any time." onClose={() => setArchiveTarget(null)}
          actions={<><button className="btn btn-secondary" onClick={() => setArchiveTarget(null)}>Cancel</button><button className="btn btn-danger" disabled={busy || !text.trim()} onClick={() => setArchived(archiveTarget, true)}>{busy ? "Archiving…" : "Archive"}</button></>}>
          <div className="form-group"><label className="form-label" htmlFor="ca-reason">Reason</label><input id="ca-reason" className="form-input" value={text} onChange={e => setText(e.target.value)} placeholder="The contract ended in August" autoFocus /></div>
          {err && <Alert tone="error">{err}</Alert>}
        </Dialog>
      )}

      {deleteTarget && (
        <Dialog size="sm" title={`Delete ${deleteTarget.name}?`} description="This can't be undone. Archive instead if you might need the record later." onClose={() => setDeleteTarget(null)}
          actions={<><button className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
            {linkedCampaigns > 0
              ? <button className="btn btn-primary" onClick={() => { const t = deleteTarget; setDeleteTarget(null); open("archive", t); }}>Archive instead</button>
              : <button className="btn btn-danger" disabled={busy || text.trim() !== deleteTarget.name.trim()} onClick={remove}>{busy ? "Deleting…" : "Delete permanently"}</button>}</>}>
          {linkedCampaigns > 0 ? <Alert tone="warning">{linkedCampaigns} {linkedCampaigns === 1 ? "campaign is" : "campaigns are"} linked to this client, so it can't be deleted. Archiving keeps them and can be undone.</Alert> : (
            <div className="form-group"><label className="form-label" htmlFor="cd-confirm">Type <strong>{deleteTarget.name.trim()}</strong> to confirm</label><input id="cd-confirm" className="form-input" value={text} onChange={e => setText(e.target.value)} autoFocus /></div>
          )}
          {err && <Alert tone="error">{err}</Alert>}
        </Dialog>
      )}
    </div>
  );
}
