import { useMemo, useState } from "react";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { gooeyToast as toast } from "goey-toast";
import { callApi } from "../../lib/api";
import { updateRows } from "../../lib/db";
import { supabase } from "../../supabaseClient";
import Alert from "../../ui/Alert";
import Dialog from "../../ui/Dialog";
import Icon from "../../ui/Icon";
import PageHeader from "../../ui/PageHeader";
import Tabs from "../../ui/Tabs";
import { fmtMoney, fmtRelativeTime, getInitials, statusBadge } from "../../utils";

const PAYMENT_METHODS = ["PayPal", "Venmo", "Zelle", "Bank Transfer", "Cash App", "Crypto"];
const FILTERS = [["all", "All"], ["active", "Active"], ["paused", "Paused"], ["archived", "Archived"]];

function ArchiveDialog({ title, body, busy, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog size="sm" title={title} description={body} onClose={onClose}
      actions={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-danger" disabled={busy || !reason.trim()} onClick={() => onConfirm(reason.trim())}>{busy ? "Archiving…" : "Archive"}</button></>}>
      <div className="form-group"><label className="form-label" htmlFor="archive-reason">Reason</label><input id="archive-reason" className="form-input" value={reason} onChange={e => setReason(e.target.value)} placeholder="Left the agency" autoFocus /></div>
      <p className="fs-12 text-muted">To stop them signing in as well, deactivate their account in Users.</p>
    </Dialog>
  );
}

export default function CreatorsManage({ db, onRefresh, user }) {
  const [tab, setTab] = useState("creators");
  const [editCreator, setEditCreator] = useState(null);
  const [editAM, setEditAM] = useState(null);
  const [newAM, setNewAM] = useState(null);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("active");
  const [sort, setSort] = useState("lastActive");

  const creators = useMemo(() => db.creators.map(c => {
    const times = db.submissions.filter(s => s.creator_id === c.id).map(s => new Date(s.created_at || s.approved_date).getTime()).filter(t => !isNaN(t));
    return { ...c, lastActive: times.length ? Math.max(...times) : null };
  }), [db.creators, db.submissions]);
  const match = (c, f) => f === "all" || (f === "active" && !c.archived_at && c.status === "Active") || (f === "paused" && !c.archived_at && c.status === "Paused") || (f === "archived" && !!c.archived_at);
  const shown = creators.filter(c => match(c, filter) && (!search.trim() || `${c.name} ${c.email} ${c.tiktok_handle || ""} ${c.instagram_handle || ""}`.toLowerCase().includes(search.toLowerCase())))
    .sort((a, b) => sort === "name" ? (a.name || "").localeCompare(b.name || "") : sort === "rate" ? Number(b.weekly_rate || 0) - Number(a.weekly_rate || 0) : (b.lastActive || 0) - (a.lastActive || 0));

  const done = (msg) => { toast.success(msg); setErr(""); onRefresh(); };

  // Archive, not delete: assignments and history keep their references (§7.2, 20260825000000).
  const setArchived = async (kind, row, archived, reason = "") => {
    setBusy(true);
    const stamp = archived ? { archived_at: new Date().toISOString(), archived_by: user?.id || null, archive_reason: reason } : { archived_at: null, archived_by: null, archive_reason: null };
    const patch = kind === "am" ? { status: archived ? "Archived" : "Active", ...stamp } : stamp;
    const { data, error } = await supabase.from(kind === "am" ? "account_managers" : "creators").update(patch).eq("id", row.id).select("id");
    setBusy(false);
    if (error || !data?.length) return toast.error(`${row.name || row.email} wasn't ${archived ? "archived" : "restored"}`, { description: error ? error.message : "You may not have permission." });
    setArchiveTarget(null);
    done(`${row.name || row.email} ${archived ? "archived" : "restored"}`);
  };

  const saveCreator = async (e) => {
    e.preventDefault();
    setBusy(true);
    const c = editCreator;
    const error = await updateRows("creators", {
      name: c.name, tiktok_handle: c.tiktok_handle, instagram_handle: c.instagram_handle, weekly_rate: Number(c.weekly_rate || 0),
      videos_per_week: Number(c.videos_per_week || 0), payment_method: c.payment_method, payment_handle: c.payment_handle, status: c.status, am_id: c.am_id || null,
    }, { id: c.id });
    setBusy(false);
    if (error) return setErr(error);
    setEditCreator(null); done(`${c.name} saved`);
  };

  const saveAM = async (e) => {
    e.preventDefault();
    const rate = Number(editAM.commission_rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 0.5) return setErr("Commission has to be between 0% and 50%.");
    setBusy(true);
    const error = await updateRows("account_managers", { name: editAM.name, email: editAM.email, commission_rate: rate }, { id: editAM.id });
    setBusy(false);
    if (error) return setErr(error);
    setEditAM(null); done(`${editAM.name} saved`);
  };

  // An AM needs a sign in account and an account_managers row, so creation goes through the API.
  const createAM = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const data = await callApi("/api/admin/users/create", { body: { email: newAM.email.trim(), fullName: newAM.fullName.trim(), role: "am", sendInvite: true } });
      setNewAM(null);
      toast.success("Account manager invited", { description: data.message || `${newAM.email.trim()} gets an email to set a password.` });
      onRefresh();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const assigned = (amId) => db.creators.filter(c => c.am_id === amId).length;

  return (
    <div className="content">
      <PageHeader title="Creators" description="Every creator and account manager, who manages whom, and their rates. New creators join by signing up; approve them under Approvals."
        actions={tab === "ams" && <button className="btn btn-primary" onClick={() => { setErr(""); setNewAM({ email: "", fullName: "" }); }}>Invite account manager</button>} />
      <Tabs label="People" value={tab} onChange={setTab} tabs={[{ id: "creators", label: "Creators", count: db.creators.length }, { id: "ams", label: "Account managers", count: db.accountManagers.length }]} />

      {tab === "creators" ? (
        <>
          <div className="toolbar">
            <div className="chip-row">{FILTERS.map(([id, l]) => <button key={id} className="chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>{l} <span className="text-muted">{creators.filter(c => match(c, id)).length}</span></button>)}</div>
            <label className="toolbar-search" style={{ maxWidth: 300 }}><Icon icon={Search01Icon} size={16} /><span className="sr-only">Search creators</span><input className="form-input" type="search" placeholder="Search name, email or handle" value={search} onChange={e => setSearch(e.target.value)} /></label>
            <label className="toolbar-field" style={{ marginLeft: "auto" }}><span className="sr-only">Sort</span><select className="select" value={sort} onChange={e => setSort(e.target.value)}><option value="lastActive">Recently active</option><option value="name">Name</option><option value="rate">Highest rate</option></select></label>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Creator</th><th>Manager</th><th className="num">Weekly rate</th><th>Last active</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {shown.map(c => {
                  const am = db.accountManagers.find(a => a.id === c.am_id);
                  return (
                    <tr key={c.id} style={c.archived_at ? { opacity: 0.6 } : undefined}>
                      <td><span className="flex-center gap-12"><span className="avatar">{getInitials(c.name)}</span><span style={{ minWidth: 0 }}><span className="fw-600 truncate" style={{ display: "block", color: "var(--ink)", maxWidth: 240 }}>{c.name || "Unnamed"}</span><span className="fs-12 text-muted truncate" style={{ display: "block", maxWidth: 240 }}>{c.email}</span></span></span></td>
                      <td>{am?.name || <span className="text-orange">Unassigned</span>}</td>
                      <td className="num">{c.weekly_rate ? fmtMoney(c.weekly_rate) : "–"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{c.lastActive ? fmtRelativeTime(c.lastActive) : "Never"}</td>
                      <td>{c.archived_at ? <span className="badge badge-gray" title={c.archive_reason || ""}>Archived</span> : statusBadge(c.status || "Active")}</td>
                      <td className="num"><span className="flex gap-4" style={{ justifyContent: "flex-end" }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => { setErr(""); setEditCreator({ ...c }); }}>Edit</button>
                        {c.archived_at ? <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setArchived("creator", c, false)}>Restore</button>
                          : <button className="btn btn-ghost btn-sm" onClick={() => setArchiveTarget({ kind: "creator", row: c })}>Archive</button>}
                      </span></td>
                    </tr>
                  );
                })}
                {shown.length === 0 && <tr><td colSpan={6} className="text-center text-muted" style={{ padding: 32 }}>No creators match.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Account manager</th><th className="num">Creators</th><th className="num">Commission</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {db.accountManagers.map(am => {
                const archived = am.status === "Archived";
                return (
                  <tr key={am.id} style={archived ? { opacity: 0.6 } : undefined}>
                    <td><span className="flex-center gap-12"><span className="avatar">{getInitials(am.name || am.email)}</span><span style={{ minWidth: 0 }}><span className="fw-600 truncate" style={{ display: "block", color: "var(--ink)", maxWidth: 260 }}>{am.name || "Unnamed"}</span><span className="fs-12 text-muted truncate" style={{ display: "block", maxWidth: 260 }}>{am.email}</span></span></span></td>
                    <td className="num">{assigned(am.id)}</td>
                    <td className="num">{Math.round(Number(am.commission_rate ?? 0.1) * 100)}%</td>
                    <td>{archived ? <span className="badge badge-gray" title={am.archive_reason || ""}>Archived</span> : statusBadge("Active")}</td>
                    <td className="num"><span className="flex gap-4" style={{ justifyContent: "flex-end" }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => { setErr(""); setEditAM({ ...am }); }}>Edit</button>
                      {archived ? <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setArchived("am", am, false)}>Restore</button>
                        : <button className="btn btn-ghost btn-sm" onClick={() => setArchiveTarget({ kind: "am", row: am })}>Archive</button>}
                    </span></td>
                  </tr>
                );
              })}
              {db.accountManagers.length === 0 && <tr><td colSpan={5} className="text-center text-muted" style={{ padding: 32 }}>No account managers yet. Invite one to start assigning clients and creators.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {editCreator && (
        <Dialog size="lg" title={`Edit ${editCreator.name || "creator"}`} description={editCreator.email} onClose={() => setEditCreator(null)}
          actions={<><button className="btn btn-secondary" onClick={() => setEditCreator(null)}>Cancel</button><button type="submit" form="edit-creator" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button></>}>
          <form id="edit-creator" onSubmit={saveCreator} noValidate>
            <div className="form-row">
              {[["name", "Name"], ["tiktok_handle", "TikTok handle"], ["instagram_handle", "Instagram handle"]].map(([k, l]) => <div key={k} className="form-group"><label className="form-label" htmlFor={`ec-${k}`}>{l}</label><input id={`ec-${k}`} className="form-input" value={editCreator[k] || ""} onChange={e => setEditCreator({ ...editCreator, [k]: e.target.value })} /></div>)}
              <div className="form-group"><label className="form-label" htmlFor="ec-rate">Weekly rate (USD)</label><input id="ec-rate" className="form-input" type="number" inputMode="decimal" value={editCreator.weekly_rate || ""} onChange={e => setEditCreator({ ...editCreator, weekly_rate: e.target.value })} /></div>
              <div className="form-group"><label className="form-label" htmlFor="ec-vpw">Videos per week</label><input id="ec-vpw" className="form-input" type="number" inputMode="numeric" value={editCreator.videos_per_week || ""} onChange={e => setEditCreator({ ...editCreator, videos_per_week: e.target.value })} /></div>
              <div className="form-group"><label className="form-label" htmlFor="ec-am">Account manager</label><select id="ec-am" className="select" value={editCreator.am_id || ""} onChange={e => setEditCreator({ ...editCreator, am_id: e.target.value })}><option value="">Unassigned</option>{db.accountManagers.filter(a => a.status !== "Archived").map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
              <div className="form-group"><label className="form-label" htmlFor="ec-pm">Payment method</label><select id="ec-pm" className="select" value={editCreator.payment_method || ""} onChange={e => setEditCreator({ ...editCreator, payment_method: e.target.value })}><option value="">Not set</option>{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</select></div>
              <div className="form-group"><label className="form-label" htmlFor="ec-ph">Payment handle or email</label><input id="ec-ph" className="form-input" value={editCreator.payment_handle || ""} onChange={e => setEditCreator({ ...editCreator, payment_handle: e.target.value })} /></div>
              <div className="form-group"><label className="form-label" htmlFor="ec-status">Status</label><select id="ec-status" className="select" value={editCreator.status || "Active"} onChange={e => setEditCreator({ ...editCreator, status: e.target.value })}>{["Active", "Paused", "Offboarded"].map(s => <option key={s}>{s}</option>)}</select></div>
            </div>
            {err && <Alert tone="error">{err}</Alert>}
          </form>
        </Dialog>
      )}

      {editAM && (
        <Dialog title={`Edit ${editAM.name || "account manager"}`} onClose={() => setEditAM(null)}
          actions={<><button className="btn btn-secondary" onClick={() => setEditAM(null)}>Cancel</button><button type="submit" form="edit-am" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button></>}>
          <form id="edit-am" onSubmit={saveAM} noValidate>
            <div className="form-group"><label className="form-label" htmlFor="ea-name">Name</label><input id="ea-name" className="form-input" value={editAM.name || ""} onChange={e => setEditAM({ ...editAM, name: e.target.value })} /></div>
            <div className="form-group"><label className="form-label" htmlFor="ea-email">Email</label><input id="ea-email" className="form-input" type="email" value={editAM.email || ""} onChange={e => setEditAM({ ...editAM, email: e.target.value })} /></div>
            <div className="form-group"><label className="form-label" htmlFor="ea-rate">Commission</label><select id="ea-rate" className="select" value={editAM.commission_rate || 0.10} onChange={e => setEditAM({ ...editAM, commission_rate: Number(e.target.value) })}>{[0.05, 0.08, 0.10, 0.12, 0.15, 0.18, 0.20, 0.25].map(r => <option key={r} value={r}>{Math.round(r * 100)}%{r === 0.10 ? " (default)" : ""}</option>)}</select><span className="form-hint">Charged on their clients' budgets unless a campaign overrides it.</span></div>
            {err && <Alert tone="error">{err}</Alert>}
          </form>
        </Dialog>
      )}

      {newAM && (
        <Dialog title="Invite an account manager" description="Creates their sign in and manager record together, then emails them a link to set a password." onClose={() => setNewAM(null)}
          actions={<><button className="btn btn-secondary" onClick={() => setNewAM(null)}>Cancel</button><button type="submit" form="new-am" className="btn btn-primary" disabled={busy || !newAM.email.trim()}>{busy ? "Inviting…" : "Send invite"}</button></>}>
          <form id="new-am" onSubmit={createAM} noValidate>
            <div className="form-group"><label className="form-label" htmlFor="na-email">Email</label><input id="na-email" className="form-input" type="email" inputMode="email" value={newAM.email} onChange={e => setNewAM({ ...newAM, email: e.target.value })} autoFocus /></div>
            <div className="form-group"><label className="form-label" htmlFor="na-name">Full name <span className="text-muted" style={{ fontWeight: 400 }}>(optional)</span></label><input id="na-name" className="form-input" value={newAM.fullName} onChange={e => setNewAM({ ...newAM, fullName: e.target.value })} /></div>
            {err && <Alert tone="error">{err}</Alert>}
          </form>
        </Dialog>
      )}

      {archiveTarget && (
        <ArchiveDialog busy={busy} onClose={() => setArchiveTarget(null)}
          title={`Archive ${archiveTarget.row.name || archiveTarget.row.email}?`}
          body={archiveTarget.kind === "am"
            ? (assigned(archiveTarget.row.id) ? `${assigned(archiveTarget.row.id)} creators are still assigned to them. Those links are kept; reassign the creators if someone else should take over.` : "No creators are assigned to them.")
            : "Their submissions, campaigns and earnings stay linked. You can restore them any time."}
          onConfirm={(reason) => setArchived(archiveTarget.kind, archiveTarget.row, true, reason)} />
      )}
    </div>
  );
}
