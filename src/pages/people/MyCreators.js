import { useMemo, useState } from "react";
import { MIGRATION_HINT, describeWriteError, updateRows } from "../../lib/db";
import { supabase } from "../../supabaseClient";
import Spinner from "../../ui/Spinner";
import { fmtRelativeTime, getAvatarColor, getInitials, statusBadge } from "../../utils";

// The manager's roster. It was a read-only table — a manager could watch their
// creators and do nothing about them; every change meant asking the owner. It
// is now the scoped equivalent of the owner's Manage Creators:
//
//   add      a new creator record, or claim one from the unassigned pool
//   edit     the working details (not payout details — those are the creator's)
//   archive  / restore, with a reason, exactly as the owner's screen does
//   remove   release from this roster back to the pool; history is untouched
//
// Scope is enforced by the database, not by this file: RLS only ever returns
// this manager's creators, claim_creator()/release_creator() refuse anyone
// else's, and hard delete stays owner-only (creators_delete_owner).
export default function MyCreators({ user, db, onRefresh }) {
  const am = db.accountManagers.find(a=>a.user_id===user.id||a.email===user.email);
  const baseCreators = useMemo(() => am?db.creators.filter(c=>c.am_id===am.id):[], [am, db.creators]);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ type: "", text: "" });

  const emptyForm = { name:"", email:"", tiktok_handle:"", instagram_handle:"", weekly_rate:"", videos_per_week:"", status:"Active" };
  const [editCreator, setEditCreator] = useState(null);   // a creators row being edited
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState(emptyForm);
  const [formErr, setFormErr] = useState("");
  const [showPool, setShowPool] = useState(false);
  const [pool, setPool] = useState(null);                  // null = not loaded yet
  const [poolErr, setPoolErr] = useState("");
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiveReason, setArchiveReason] = useState("");
  const [releaseTarget, setReleaseTarget] = useState(null);

  const creators = useMemo(() => {
    return baseCreators.map(c => {
      const subs = db.submissions.filter(s => s.creator_id === c.id);
      const dates = subs.map(s => new Date(s.created_at || s.approved_date).getTime()).filter(t => !isNaN(t));
      const lastActiveTime = dates.length > 0 ? Math.max(...dates) : new Date(c.created_at).getTime();
      const approvedSubs = subs.filter(s => s.status === "Approved");
      const rate = subs.length > 0 ? Math.round((approvedSubs.length / subs.length) * 100) : 0;
      return { ...c, lastActiveTime, approvedCount: approvedSubs.length, approvalRate: rate };
    }).filter(c => {
      if (!showArchived && c.archived_at) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (c.name || "").toLowerCase().includes(q) || (c.tiktok_handle || "").toLowerCase().includes(q) || (c.email || "").toLowerCase().includes(q);
    }).sort((a, b) => b.lastActiveTime - a.lastActiveTime);
  }, [baseCreators, db.submissions, search, showArchived]);

  const archivedCount = baseCreators.filter(c=>c.archived_at).length;

  const details = (f) => ({
    name: f.name.trim(),
    email: (f.email||"").trim().toLowerCase() || null,
    tiktok_handle: (f.tiktok_handle||"").trim().replace(/^@/,"") || null,
    instagram_handle: (f.instagram_handle||"").trim().replace(/^@/,"") || null,
    weekly_rate: Number(f.weekly_rate||0),
    videos_per_week: Number(f.videos_per_week||0),
    status: f.status || "Active",
  });

  // creators.email is UNIQUE NOT NULL: it is how a sign-up is matched to the
  // record a manager created ahead of time, so it cannot be left blank.
  const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v||"").trim());

  const addCreator = async () => {
    if (!addForm.name.trim()) { setFormErr("A name is required."); return; }
    if (!validEmail(addForm.email)) { setFormErr("A valid email is required — it is how their account links to this record when they sign up."); return; }
    setBusy(true); setFormErr("");
    const { error } = await supabase.from("creators").insert({ ...details(addForm), am_id: am.id });
    if (error) {
      setFormErr(error.code === "23505"
        ? "A creator with that email already exists. If they have no manager yet, use “Pick from unassigned” instead."
        : describeWriteError(error));
      setBusy(false); return;
    }
    await onRefresh();
    setShowAdd(false); setAddForm(emptyForm); setBusy(false);
    setMsg({ type:"success", text:`${addForm.name.trim()} was added to your roster.` });
  };

  const saveCreator = async () => {
    if (!editCreator.name.trim()) { setFormErr("A name is required."); return; }
    if (!validEmail(editCreator.email)) { setFormErr("A valid email is required."); return; }
    setBusy(true); setFormErr("");
    const err = await updateRows("creators", details(editCreator), { id: editCreator.id });
    if (err) { setFormErr(err); setBusy(false); return; }
    await onRefresh();
    setEditCreator(null); setBusy(false);
  };

  // Same patch the owner's Manage Creators writes: archived_at is the
  // soft-delete signal, independent of status (20260825000000).
  const setArchived = async (creator, archived, reason) => {
    setBusy(true); setMsg({ type:"", text:"" });
    const patch = archived
      ? { archived_at: new Date().toISOString(), archived_by: user?.id || null, archive_reason: (reason||"").trim() }
      : { archived_at: null, archived_by: null, archive_reason: null };
    const err = await updateRows("creators", patch, { id: creator.id });
    if (err) { setMsg({ type:"error", text:`Could not ${archived?"archive":"restore"} ${creator.name}: ${err}` }); setBusy(false); return; }
    await onRefresh();
    setArchiveTarget(null); setArchiveReason(""); setBusy(false);
    setMsg({ type:"success", text:`${creator.name} was ${archived?"archived":"restored"}.` });
  };

  const openPool = async () => {
    setShowPool(true); setPool(null); setPoolErr("");
    const { data, error } = await supabase.rpc("list_unassigned_creators");
    if (error) { setPoolErr(error.code === "PGRST202" ? MIGRATION_HINT : error.message); setPool([]); return; }
    setPool(data || []);
  };

  const claim = async (c) => {
    setBusy(true); setPoolErr("");
    const { error } = await supabase.rpc("claim_creator", { p_creator_id: c.id });
    if (error) { setPoolErr(error.message); setBusy(false); openPool(); return; }
    await onRefresh();
    setPool(list => (list||[]).filter(x => x.id !== c.id));
    setBusy(false);
    setMsg({ type:"success", text:`${c.name} is now on your roster.` });
  };

  const release = async (c) => {
    setBusy(true); setMsg({ type:"", text:"" });
    const { error } = await supabase.rpc("release_creator", { p_creator_id: c.id });
    if (error) { setMsg({ type:"error", text:`Could not remove ${c.name}: ${error.code === "PGRST202" ? MIGRATION_HINT : error.message}` }); setBusy(false); setReleaseTarget(null); return; }
    await onRefresh();
    setReleaseTarget(null); setBusy(false);
    setMsg({ type:"success", text:`${c.name} was removed from your roster.` });
  };

  if (!am) return <div className="content"><div className="empty"><div className="empty-icon">⚙️</div><h3>Account not fully set up</h3><p>Your account manager profile isn't linked yet, so there is no roster to manage. Ask the owner to link it.</p></div></div>;

  const creatorFields = (f, setF) => (
    <>
      <div className="grid-2">
        <div className="form-group"><label className="form-label">Name <span style={{color:"var(--red)"}}>*</span></label><input className="form-input" value={f.name||""} onChange={e=>setF({...f,name:e.target.value})}/></div>
        <div className="form-group"><label className="form-label">Email <span style={{color:"var(--red)"}}>*</span></label><input className="form-input" type="email" value={f.email||""} onChange={e=>setF({...f,email:e.target.value})}/></div>
      </div>
      <div className="grid-2">
        <div className="form-group"><label className="form-label">TikTok handle</label><input className="form-input" placeholder="@handle" value={f.tiktok_handle||""} onChange={e=>setF({...f,tiktok_handle:e.target.value})}/></div>
        <div className="form-group"><label className="form-label">Instagram handle</label><input className="form-input" placeholder="@handle" value={f.instagram_handle||""} onChange={e=>setF({...f,instagram_handle:e.target.value})}/></div>
      </div>
      <div className="grid-2">
        <div className="form-group"><label className="form-label">Weekly rate ($)</label><input className="form-input" type="number" min="0" value={f.weekly_rate??""} onChange={e=>setF({...f,weekly_rate:e.target.value})}/></div>
        <div className="form-group"><label className="form-label">Videos per week</label><input className="form-input" type="number" min="0" value={f.videos_per_week??""} onChange={e=>setF({...f,videos_per_week:e.target.value})}/></div>
      </div>
      <div className="form-group"><label className="form-label">Status</label>
        <select className="select" value={f.status||"Active"} onChange={e=>setF({...f,status:e.target.value})}>
          {["Active","Paused","Offboarded"].map(x=><option key={x}>{x}</option>)}
        </select>
      </div>
      {formErr&&<div style={{color:"var(--red)",fontSize:13,marginBottom:12}} role="alert">{formErr}</div>}
    </>
  );

  return (
    <div className="content">
      <div className="flex-between mb-16" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>My Creators ({creators.length})</h3>
          <p style={{ color: "var(--ink3)", fontSize: 12, marginTop: 4 }}>Build and manage your own roster</p>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          {archivedCount>0&&(
            <label style={{fontSize:12,color:"var(--ink2)",display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}>
              <input type="checkbox" checked={showArchived} onChange={e=>setShowArchived(e.target.checked)}/> Show archived ({archivedCount})
            </label>
          )}
          <input
            type="text"
            className="form-input"
            placeholder="Search creator..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: 200, height: 32, fontSize: 12 }}
          />
          <button className="btn btn-sm btn-ghost" onClick={openPool}>Pick from unassigned</button>
          <button className="btn btn-primary btn-sm" onClick={()=>{setFormErr("");setAddForm(emptyForm);setShowAdd(true);}}>+ Add Creator</button>
        </div>
      </div>

      {msg.text&&(
        <div role="status" style={{fontSize:13,marginBottom:12,padding:"8px 12px",borderRadius:"var(--radius-sm)",background:msg.type==="success"?"rgba(26,122,74,0.08)":"rgba(192,57,43,0.08)",color:msg.type==="success"?"var(--green)":"var(--red)"}}>
          {msg.text}
        </div>
      )}

      {creators.length===0&&<div className="empty"><div className="empty-icon">👥</div><h3>No creators on your roster yet</h3><p>Add one, or pick from the unassigned pool.</p></div>}
      {creators.length>0&&(
      <div className="premium-card">
        <div className="table-wrap">
          <table className="premium-table">
            <thead>
              <tr>
                <th>Creator</th>
                <th>TikTok</th>
                <th>Status</th>
                <th>Last Active</th>
                <th>Approval Rate</th>
                <th>Approved</th>
                <th>Payment</th>
                <th style={{textAlign:"right"}}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {creators.map(c=>(
                <tr key={c.id} style={c.archived_at?{opacity:0.62}:undefined}>
                  <td>
                    <div className="flex-center gap-8">
                      <div className={`creator-avatar ${getAvatarColor(c.name)}`} style={{width:32,height:32,fontSize:12}}>{getInitials(c.name)}</div>
                      <div><div className="fw-600">{c.name}</div><div style={{fontSize:11,color:"var(--ink3)"}}>{c.email}</div></div>
                    </div>
                  </td>
                  <td style={{fontSize:12}}>{c.tiktok_handle?"@"+c.tiktok_handle:"—"}</td>
                  <td>{c.archived_at?<span className="badge badge-gray" title={c.archive_reason||""}>Archived</span>:statusBadge(c.status)}</td>
                  <td style={{fontSize:12, color: "var(--ink3)"}}>{fmtRelativeTime(c.lastActiveTime)}</td>
                  <td>
                    <div className="flex-center gap-8">
                      <div className="progress-bar" style={{width:80}}><div className="progress-fill" style={{width:`${c.approvalRate}%`,background:c.approvalRate>80?"var(--green)":"var(--gold)"}}/></div>
                      <span style={{fontSize:12}}>{c.approvalRate}%</span>
                    </div>
                  </td>
                  <td>{c.approvedCount}</td>
                  <td>{statusBadge(c.payment_status||"Current")}</td>
                  <td>
                    <div style={{display:"flex",gap:6,justifyContent:"flex-end",flexWrap:"wrap"}}>
                      <button className="btn btn-sm btn-ghost" disabled={busy} onClick={()=>{setFormErr("");setEditCreator({...c});}}>Edit</button>
                      {c.archived_at
                        ? <button className="btn btn-sm btn-green" disabled={busy} onClick={()=>setArchived(c,false)}>Restore</button>
                        : <button className="btn btn-sm btn-ghost" style={{color:"var(--orange)"}} disabled={busy} onClick={()=>{setArchiveTarget(c);setArchiveReason("");}}>Archive</button>}
                      <button className="btn btn-sm btn-ghost" style={{color:"var(--red)"}} disabled={busy} onClick={()=>setReleaseTarget(c)}>Remove</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {showAdd&&(
        <div className="modal-overlay" onClick={()=>setShowAdd(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-title">Add a creator</div>
            <div className="modal-sub">They go straight onto your roster. If they later sign up with this email, the account links to this record.</div>
            {creatorFields(addForm, setAddForm)}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={()=>setShowAdd(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={addCreator} disabled={busy}>{busy?"Adding…":"Add Creator"}</button>
            </div>
          </div>
        </div>
      )}

      {editCreator&&(
        <div className="modal-overlay" onClick={()=>setEditCreator(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-title">Edit {editCreator.name}</div>
            <div className="modal-sub">Payout details are the creator's own and are not editable here.</div>
            {creatorFields(editCreator, setEditCreator)}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={()=>setEditCreator(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveCreator} disabled={busy}>{busy?"Saving…":"Save Changes"}</button>
            </div>
          </div>
        </div>
      )}

      {showPool&&(
        <div className="modal-overlay" onClick={()=>setShowPool(false)}>
          <div className="modal" style={{maxWidth:560}} onClick={e=>e.stopPropagation()}>
            <div className="modal-title">Unassigned creators</div>
            <div className="modal-sub">Creators with no account manager yet. Claiming one adds them to your roster.</div>
            {poolErr&&<div style={{color:"var(--red)",fontSize:13,marginBottom:12}} role="alert">{poolErr}</div>}
            {pool===null&&<Spinner/>}
            {pool&&pool.length===0&&!poolErr&&<div style={{fontSize:13,color:"var(--ink3)",padding:"16px 0"}}>Nobody is waiting to be assigned right now.</div>}
            <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:340,overflowY:"auto"}}>
              {(pool||[]).map(c=>(
                <div key={c.id} className="flex-between" style={{padding:"10px 12px",border:"1px solid var(--border2)",borderRadius:"var(--radius-sm)"}}>
                  <div>
                    <div className="fw-600" style={{fontSize:13}}>{c.name||"Unnamed creator"}</div>
                    <div style={{fontSize:11,color:"var(--ink3)"}}>
                      {c.tiktok_handle?`TikTok @${c.tiktok_handle}`:"no TikTok handle"}{c.instagram_handle?` · IG @${c.instagram_handle}`:""} · {c.status||"—"}
                    </div>
                  </div>
                  <button className="btn btn-sm btn-primary" disabled={busy} onClick={()=>claim(c)}>Claim</button>
                </div>
              ))}
            </div>
            <div className="modal-actions"><button className="btn btn-ghost" onClick={()=>setShowPool(false)}>Done</button></div>
          </div>
        </div>
      )}

      {archiveTarget&&(
        <div className="modal-overlay" onClick={()=>setArchiveTarget(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-title">Archive {archiveTarget.name}?</div>
            <div className="modal-sub">Their submissions, payments and campaign history are kept. You can restore them at any time.</div>
            <div className="form-group">
              <label className="form-label">Reason <span style={{color:"var(--red)"}}>*</span></label>
              <input className="form-input" placeholder="e.g. Stopped responding, September 2026" value={archiveReason} onChange={e=>setArchiveReason(e.target.value)}/>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={()=>setArchiveTarget(null)}>Cancel</button>
              <button className="btn" style={{background:"var(--orange)",color:"#fff"}} disabled={busy||!archiveReason.trim()} onClick={()=>setArchived(archiveTarget,true,archiveReason)}>{busy?"Archiving…":"Archive Creator"}</button>
            </div>
          </div>
        </div>
      )}

      {releaseTarget&&(
        <div className="modal-overlay" onClick={()=>setReleaseTarget(null)}>
          <div className="modal" style={{maxWidth:460}} onClick={e=>e.stopPropagation()}>
            <div className="modal-title">Remove {releaseTarget.name} from your roster?</div>
            <div className="modal-sub">They go back to the unassigned pool, where you or another manager can pick them up again. Nothing is deleted — their work and payment history stay exactly as they are.</div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={()=>setReleaseTarget(null)}>Cancel</button>
              <button className="btn" style={{background:"var(--red)",color:"#fff"}} disabled={busy} onClick={()=>release(releaseTarget)}>{busy?"Removing…":"Remove from roster"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
