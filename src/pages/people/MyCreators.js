import { useMemo, useState } from "react";
import { Search01Icon, UserGroupIcon, UserIcon } from "@hugeicons/core-free-icons";
import { gooeyToast as toast } from "goey-toast";
import { MIGRATION_HINT, describeWriteError, updateRows } from "../../lib/db";
import { supabase } from "../../supabaseClient";
import Alert from "../../ui/Alert";
import confirm from "../../ui/confirm";
import Dialog from "../../ui/Dialog";
import EmptyState from "../../ui/EmptyState";
import Icon from "../../ui/Icon";
import PageHeader from "../../ui/PageHeader";
import { Skeleton } from "../../ui/Skeleton";
import { fmtMoney, fmtRelativeTime, getInitials, statusBadge } from "../../utils";

const EMPTY = { name: "", email: "", tiktok_handle: "", instagram_handle: "", weekly_rate: "", videos_per_week: "", status: "Active" };
const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v || "").trim());
const details = (f) => ({
  name: f.name.trim(), email: (f.email || "").trim().toLowerCase() || null,
  tiktok_handle: (f.tiktok_handle || "").trim().replace(/^@/, "") || null, instagram_handle: (f.instagram_handle || "").trim().replace(/^@/, "") || null,
  weekly_rate: Number(f.weekly_rate || 0), videos_per_week: Number(f.videos_per_week || 0), status: f.status || "Active",
});

export function CreatorFields({ f, setF }) {
  const s = (patch) => setF({ ...f, ...patch });
  return (
    <div className="form-row">
      <div className="form-group"><label className="form-label" htmlFor="cf-name">Name</label><input id="cf-name" className="form-input" value={f.name || ""} onChange={e => s({ name: e.target.value })} autoFocus /></div>
      <div className="form-group"><label className="form-label" htmlFor="cf-email">Email</label><input id="cf-email" className="form-input" type="email" inputMode="email" value={f.email || ""} onChange={e => s({ email: e.target.value })} /><span className="form-hint">Links their account when they sign up with it.</span></div>
      <div className="form-group"><label className="form-label" htmlFor="cf-tt">TikTok handle</label><input id="cf-tt" className="form-input" placeholder="@handle" value={f.tiktok_handle || ""} onChange={e => s({ tiktok_handle: e.target.value })} /></div>
      <div className="form-group"><label className="form-label" htmlFor="cf-ig">Instagram handle</label><input id="cf-ig" className="form-input" placeholder="@handle" value={f.instagram_handle || ""} onChange={e => s({ instagram_handle: e.target.value })} /></div>
      <div className="form-group"><label className="form-label" htmlFor="cf-rate">Weekly rate (USD)</label><input id="cf-rate" className="form-input" type="number" inputMode="decimal" min="0" value={f.weekly_rate ?? ""} onChange={e => s({ weekly_rate: e.target.value })} /></div>
      <div className="form-group"><label className="form-label" htmlFor="cf-vpw">Videos per week</label><input id="cf-vpw" className="form-input" type="number" inputMode="numeric" min="0" value={f.videos_per_week ?? ""} onChange={e => s({ videos_per_week: e.target.value })} /></div>
      <div className="form-group"><label className="form-label" htmlFor="cf-status">Status</label><select id="cf-status" className="select" value={f.status || "Active"} onChange={e => s({ status: e.target.value })}>{["Active", "Paused", "Offboarded"].map(x => <option key={x}>{x}</option>)}</select></div>
    </div>
  );
}

// Scope comes from the database: RLS returns only this manager's creators and the claim/release RPCs refuse others.
export default function MyCreators({ user, db, onRefresh }) {
  const am = db.accountManagers.find(a => a.user_id === user.id || a.email === user.email);
  const base = useMemo(() => (am ? db.creators.filter(c => c.am_id === am.id) : []), [am, db.creators]);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null);
  const [formErr, setFormErr] = useState("");
  const [pool, setPool] = useState(undefined);
  const [poolErr, setPoolErr] = useState("");
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiveReason, setArchiveReason] = useState("");

  const rows = useMemo(() => base.map(c => {
    const subs = db.submissions.filter(s => s.creator_id === c.id);
    const times = subs.map(s => new Date(s.created_at || s.approved_date).getTime()).filter(t => !isNaN(t));
    const approved = subs.filter(s => s.status === "Approved" || s.status === "Published/Tracked").length;
    const decided = subs.filter(s => ["Approved", "Published/Tracked", "Rejected", "Revision Requested"].includes(s.status)).length;
    return { ...c, lastActive: times.length ? Math.max(...times) : null, approved, rate: decided ? Math.round((approved / decided) * 100) : null };
  }).filter(c => (showArchived || !c.archived_at) && (!search.trim() || `${c.name} ${c.tiktok_handle || ""} ${c.email || ""}`.toLowerCase().includes(search.toLowerCase())))
    .sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0)), [base, db.submissions, search, showArchived]);
  const archivedCount = base.filter(c => c.archived_at).length;

  const save = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setFormErr("Add the creator's name.");
    if (!validEmail(form.email)) return setFormErr("Add a valid email. It's how their account links to this record when they sign up.");
    setBusy(true); setFormErr("");
    if (form.id) {
      const err = await updateRows("creators", details(form), { id: form.id });
      setBusy(false);
      if (err) return setFormErr(err);
      toast.success("Creator saved");
    } else {
      const { error } = await supabase.from("creators").insert({ ...details(form), am_id: am.id });
      setBusy(false);
      if (error) return setFormErr(error.code === "23505" ? "A creator with this email already exists. If they don't have a manager, claim them from the unassigned list." : describeWriteError(error));
      toast.success(`${form.name.trim()} added to your roster`);
    }
    setForm(null); onRefresh();
  };

  // archived_at is the soft-delete flag, separate from status (20260825000000).
  const setArchived = async (c, archived) => {
    setBusy(true);
    const patch = archived ? { archived_at: new Date().toISOString(), archived_by: user?.id || null, archive_reason: archiveReason.trim() } : { archived_at: null, archived_by: null, archive_reason: null };
    const err = await updateRows("creators", patch, { id: c.id });
    setBusy(false);
    if (err) return toast.error(`${c.name} wasn't ${archived ? "archived" : "restored"}`, { description: err });
    toast.success(`${c.name} ${archived ? "archived" : "restored"}`, { description: archived ? "Their work and payment history are kept." : undefined });
    setArchiveTarget(null); setArchiveReason(""); onRefresh();
  };

  const openPool = async () => {
    setPool(null); setPoolErr("");
    const { data, error } = await supabase.rpc("list_unassigned_creators");
    if (error) { setPoolErr(error.code === "PGRST202" ? MIGRATION_HINT : error.message); setPool([]); return; }
    setPool(data || []);
  };

  const claim = async (c) => {
    setBusy(true);
    const { error } = await supabase.rpc("claim_creator", { p_creator_id: c.id });
    setBusy(false);
    if (error) { setPoolErr(error.message); return openPool(); }
    setPool(list => (list || []).filter(x => x.id !== c.id));
    toast.success(`${c.name || "Creator"} is on your roster`);
    onRefresh();
  };

  const release = async (c) => {
    const ok = await confirm({ title: `Remove ${c.name} from your roster?`, body: "They go back to the unassigned list, where any manager can pick them up. Their work and payment history don't change.", confirmLabel: "Remove from roster", tone: "danger" });
    if (!ok) return;
    const { error } = await supabase.rpc("release_creator", { p_creator_id: c.id });
    if (error) return toast.error(`${c.name} wasn't removed`, { description: error.code === "PGRST202" ? MIGRATION_HINT : error.message });
    toast(`${c.name} removed from your roster`);
    onRefresh();
  };

  if (!am) return <div className="content"><EmptyState icon={UserIcon} title="Your account manager profile isn't linked yet">An owner needs to link your login to your account manager record before you can manage a roster.</EmptyState></div>;

  return (
    <div className="content">
      <PageHeader title="Creators" description="The creators you manage. Add someone new, or claim a creator who doesn't have a manager yet."
        actions={<><button className="btn btn-secondary" onClick={openPool}>Claim unassigned</button><button className="btn btn-primary" onClick={() => { setFormErr(""); setForm({ ...EMPTY }); }}>Add creator</button></>} />

      {base.length === 0 ? (
        <div className="card"><EmptyState icon={UserGroupIcon} title="No creators on your roster yet" action={<button className="btn btn-primary btn-sm" onClick={openPool}>See unassigned creators</button>}>Add a creator yourself, or claim one who signed up without a manager.</EmptyState></div>
      ) : (
        <>
          <div className="toolbar">
            <label className="toolbar-search" style={{ maxWidth: 340 }}><Icon icon={Search01Icon} size={16} /><span className="sr-only">Search creators</span>
              <input className="form-input" type="search" placeholder="Search name, handle or email" value={search} onChange={e => setSearch(e.target.value)} /></label>
            {archivedCount > 0 && <label className="check" style={{ marginLeft: "auto" }}><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /><span>Show archived ({archivedCount})</span></label>}
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Creator</th><th>Status</th><th className="num">Approved</th><th className="num">Approval rate</th><th className="num">Weekly rate</th><th>Last active</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map(c => (
                  <tr key={c.id} style={c.archived_at ? { opacity: 0.6 } : undefined}>
                    <td><span className="flex-center gap-12"><span className="avatar">{getInitials(c.name)}</span><span style={{ minWidth: 0 }}><span className="fw-600 truncate" style={{ display: "block", color: "var(--ink)", maxWidth: 260 }}>{c.name}</span><span className="fs-12 text-muted truncate" style={{ display: "block", maxWidth: 260 }}>{c.tiktok_handle ? `@${c.tiktok_handle}` : c.email}</span></span></span></td>
                    <td>{c.archived_at ? <span className="badge badge-gray" title={c.archive_reason || ""}>Archived</span> : statusBadge(c.status)}</td>
                    <td className="num">{c.approved}</td>
                    <td className="num">{c.rate == null ? "–" : `${c.rate}%`}</td>
                    <td className="num">{c.weekly_rate ? fmtMoney(c.weekly_rate) : "–"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{c.lastActive ? fmtRelativeTime(c.lastActive) : "No submissions"}</td>
                    <td className="num"><span className="flex gap-4" style={{ justifyContent: "flex-end" }}>
                      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setFormErr(""); setForm({ ...EMPTY, ...c }); }}>Edit</button>
                      {c.archived_at ? <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setArchived(c, false)}>Restore</button>
                        : <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setArchiveTarget(c); setArchiveReason(""); }}>Archive</button>}
                      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => release(c)}>Remove</button>
                    </span></td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={7} className="text-center text-muted" style={{ padding: 32 }}>No creators match your search.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {form && (
        <Dialog size="lg" title={form.id ? `Edit ${form.name || "creator"}` : "Add a creator"} description={form.id ? "Payout details belong to the creator and can't be changed here." : "They join your roster straight away."} onClose={() => setForm(null)}
          actions={<><button className="btn btn-secondary" onClick={() => setForm(null)}>Cancel</button><button type="submit" form="creator-form" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : form.id ? "Save changes" : "Add creator"}</button></>}>
          <form id="creator-form" onSubmit={save} noValidate><CreatorFields f={form} setF={setForm} />{formErr && <Alert tone="error">{formErr}</Alert>}</form>
        </Dialog>
      )}

      {pool !== undefined && (
        <Dialog title="Unassigned creators" description="Creators who don't have an account manager yet. Claiming one adds them to your roster." onClose={() => setPool(undefined)} actions={<button className="btn btn-secondary" onClick={() => setPool(undefined)}>Done</button>}>
          {poolErr && <Alert tone="error" style={{ marginBottom: 12 }}>{poolErr}</Alert>}
          {pool === null ? [1, 2, 3].map(i => <Skeleton key={i} h={52} style={{ marginBottom: 8 }} />)
            : pool.length === 0 ? <p className="fs-13 text-muted">Nobody is waiting for a manager right now.</p>
            : <div className="list-stack">{pool.map(c => (
              <div key={c.id} className="list-item">
                <span style={{ minWidth: 0 }}><span className="fw-600 fs-13 truncate" style={{ display: "block" }}>{c.name || "Unnamed creator"}</span><span className="fs-12 text-muted">{[c.tiktok_handle && `TikTok @${c.tiktok_handle}`, c.instagram_handle && `Instagram @${c.instagram_handle}`].filter(Boolean).join(" · ") || "No handles yet"}</span></span>
                <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => claim(c)}>Claim</button>
              </div>))}</div>}
        </Dialog>
      )}

      {archiveTarget && (
        <Dialog size="sm" title={`Archive ${archiveTarget.name}?`} description="Their submissions, payments and campaign history are kept, and you can restore them any time." onClose={() => setArchiveTarget(null)}
          actions={<><button className="btn btn-secondary" onClick={() => setArchiveTarget(null)}>Cancel</button><button className="btn btn-danger" disabled={busy || !archiveReason.trim()} onClick={() => setArchived(archiveTarget, true)}>{busy ? "Archiving…" : "Archive"}</button></>}>
          <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label" htmlFor="arch-reason">Reason</label><input id="arch-reason" className="form-input" value={archiveReason} onChange={e => setArchiveReason(e.target.value)} placeholder="Stopped responding in September" autoFocus /></div>
        </Dialog>
      )}
    </div>
  );
}
