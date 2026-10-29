import { useMemo, useState } from "react";
import { callApi } from "../../lib/api";
import { updateRows } from "../../lib/db";
import { supabase } from "../../supabaseClient";
import { fmtRelativeTime, statusBadge } from "../../utils";

// CREATORS MANAGE - OWNER VIEW TO MANAGE ALL CREATORS & AMs
// ============================================================
export default function CreatorsManage({ db, onRefresh, user }) {
  const [tab, setTab] = useState("creators");
  const [editCreator, setEditCreator] = useState(null);
  const [editAM, setEditAM] = useState(null);
  const [saving, setSaving] = useState(false);
  // §6.1 "Manage creators, Account Managers and clients". Account Managers
  // could previously only be edited — never created, never removed. Creating
  // one goes through /api/admin/users/create because it needs an auth account
  // as well as an account_managers row; without both, the manager exists in
  // the assignment dropdown but cannot sign in.
  const [showCreateAM, setShowCreateAM] = useState(false);
  const [amForm, setAmForm] = useState({ email: "", fullName: "" });
  const [amBusy, setAmBusy] = useState(false);
  const [amMsg, setAmMsg] = useState({ type: "", text: "" });
  const [archiveAMTarget, setArchiveAMTarget] = useState(null);
  const [archiveAMReason, setArchiveAMReason] = useState("");
  const [archiveCreatorTarget, setArchiveCreatorTarget] = useState(null);
  const [archiveCreatorReason, setArchiveCreatorReason] = useState("");
  const [creatorMsg, setCreatorMsg] = useState({ type: "", text: "" });

  const createAM = async () => {
    setAmBusy(true);
    setAmMsg({ type: "", text: "" });
    try {
      const data = await callApi("/api/admin/users/create", {
        body: {
          email: amForm.email.trim(),
          fullName: amForm.fullName.trim(),
          role: "am",
          sendInvite: true,
        },
      });
      setAmMsg({ type: "success", text: data.message });
      setAmForm({ email: "", fullName: "" });
      setShowCreateAM(false);
      await onRefresh();
    } catch (err) {
      setAmMsg({ type: "error", text: err.message });
    } finally {
      setAmBusy(false);
    }
  };

  // Archive, not delete: creators point at their AM through am_id, and
  // removing the row would orphan every one of those assignments (§7.2 —
  // "Removal/deactivation must preserve historical references").
  //
  // archived_at is independent of status: status keeps governing day-to-day
  // (Active/Paused/Offboarded), archived_at is the sole soft-delete signal —
  // see 20260825000000_creator_submission_archival.sql.
  const setCreatorArchived = async (creator, archived, reason) => {
    setSaving(true);
    setCreatorMsg({ type: "", text: "" });

    const patch = archived
      ? {
          archived_at: new Date().toISOString(),
          archived_by: user?.id || null,
          archive_reason: (reason || "").trim(),
        }
      : { archived_at: null, archived_by: null, archive_reason: null };

    const { data, error } = await supabase
      .from("creators").update(patch).eq("id", creator.id).select("id");

    if (error || !data || data.length === 0) {
      setCreatorMsg({
        type: "error",
        text: error ? `Could not save: ${error.message}`
                    : "That creator was not updated — you may not have permission.",
      });
      setSaving(false);
      return;
    }

    setArchiveCreatorTarget(null);
    setArchiveCreatorReason("");
    await onRefresh();
    setSaving(false);
  };

  const setAMArchived = async (am, archived, reason) => {
    setSaving(true);
    setAmMsg({ type: "", text: "" });

    const patch = archived
      ? {
          status: "Archived",
          archived_at: new Date().toISOString(),
          archived_by: user?.id || null,
          archive_reason: (reason || "").trim(),
        }
      : { status: "Active", archived_at: null, archived_by: null, archive_reason: null };

    const { data, error } = await supabase
      .from("account_managers").update(patch).eq("id", am.id).select("id");

    if (error || !data || data.length === 0) {
      setAmMsg({
        type: "error",
        text: error ? `Could not save: ${error.message}`
                    : "That manager was not updated — you may not have permission.",
      });
      setSaving(false);
      return;
    }

    setArchiveAMTarget(null);
    setArchiveAMReason("");
    await onRefresh();
    setSaving(false);
  };

  // Both of these closed their modal whatever happened. commission_rate in
  // particular is a figure the owner comes back to change, and a refused write
  // looked exactly like a saved one until the next reload undid it.
  const saveCreator = async () => {
    setSaving(true);
    setCreatorMsg({ type: "", text: "" });
    const err = await updateRows("creators", {
      name: editCreator.name,
      tiktok_handle: editCreator.tiktok_handle,
      instagram_handle: editCreator.instagram_handle,
      weekly_rate: Number(editCreator.weekly_rate||0),
      videos_per_week: Number(editCreator.videos_per_week||0),
      payment_method: editCreator.payment_method,
      payment_handle: editCreator.payment_handle,
      status: editCreator.status,
      am_id: editCreator.am_id||null,
    }, { id: editCreator.id });
    if (err) { setCreatorMsg({ type: "error", text: `Could not save ${editCreator.name}: ${err}` }); setSaving(false); return; }
    await onRefresh();
    setEditCreator(null);
    setSaving(false);
  };

  const saveAM = async () => {
    const rate = Number(editAM.commission_rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 0.5) {
      setAmMsg({ type: "error", text: "Commission rate has to be between 0 and 0.50 (that is, 0% to 50%)." });
      return;
    }
    setSaving(true);
    setAmMsg({ type: "", text: "" });
    const err = await updateRows("account_managers", {
      name: editAM.name,
      email: editAM.email,
      commission_rate: rate,
    }, { id: editAM.id });
    if (err) { setAmMsg({ type: "error", text: `Could not save ${editAM.name}: ${err}` }); setSaving(false); return; }
    await onRefresh();
    setEditAM(null);
    setSaving(false);
  };

  const [creatorSearch, setCreatorSearch] = useState("");
  const [creatorStatusFilter, setCreatorStatusFilter] = useState("all");
  const [creatorSortBy, setCreatorSortBy] = useState("lastActive");

  const enrichedCreators = useMemo(() => {
    return db.creators.map(c => {
      const subs = db.submissions.filter(s => s.creator_id === c.id);
      const dates = subs.map(s => new Date(s.created_at || s.approved_date).getTime()).filter(t => !isNaN(t));
      const lastActiveTime = dates.length > 0 ? Math.max(...dates) : new Date(c.created_at).getTime();
      return {
        ...c,
        lastActiveTime,
        subCount: subs.length
      };
    }).filter(c => {
      if (creatorSearch.trim()) {
        const q = creatorSearch.toLowerCase();
        const matchName = (c.name || "").toLowerCase().includes(q);
        const matchEmail = (c.email || "").toLowerCase().includes(q);
        const matchHandle = (c.tiktok_handle || "").toLowerCase().includes(q) || (c.instagram_handle || "").toLowerCase().includes(q);
        if (!matchName && !matchEmail && !matchHandle) return false;
      }
      if (creatorStatusFilter === "active" && (c.archived_at || c.status !== "Active")) return false;
      if (creatorStatusFilter === "paused" && c.status !== "Paused") return false;
      if (creatorStatusFilter === "archived" && !c.archived_at) return false;
      return true;
    }).sort((a, b) => {
      if (creatorSortBy === "name") return (a.name || "").localeCompare(b.name || "");
      if (creatorSortBy === "rate") return Number(b.weekly_rate || 0) - Number(a.weekly_rate || 0);
      return b.lastActiveTime - a.lastActiveTime;
    });
  }, [db.creators, db.submissions, creatorSearch, creatorStatusFilter, creatorSortBy]);

  return (
    <div className="content">
      <div className="flex-center gap-8 mb-16">
        {["creators","ams"].map(t=>(
          <button key={t} className={`btn btn-sm ${tab===t?"btn-primary":"btn-ghost"}`} onClick={()=>setTab(t)}>
            {t==="creators"?`Creators (${db.creators.length})`:`Account Managers (${db.accountManagers.length})`}
          </button>
        ))}
      </div>

      <div style={{ padding: '16px', background: 'var(--bg2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', marginBottom: '24px' }}>
        <div className="flex-between">
          <div style={{ fontSize: '13px', color: 'var(--ink2)' }}>
            <strong>How to add users:</strong> Have your Creators or Account Managers create an account using this portal's URL. Once they sign up, they will appear in the <strong>Team / Roles</strong> tab where you can officially assign their status.
          </div>
        </div>
      </div>

      {tab==="creators"&&(
        <div className="premium-card" style={{ padding: 0 }}>
          {/* Creators Filter Bar */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[
                ['all', `All (${db.creators.length})`],
                ['active', 'Active'],
                ['paused', 'Paused'],
                ['archived', 'Archived']
              ].map(([st, label]) => (
                <button
                  key={st}
                  className={`btn btn-sm ${creatorStatusFilter === st ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ padding: '4px 10px', fontSize: 12 }}
                  onClick={() => setCreatorStatusFilter(st)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select
                className="select"
                value={creatorSortBy}
                onChange={e => setCreatorSortBy(e.target.value)}
                style={{ height: 32, fontSize: 12 }}
              >
                <option value="lastActive">Sort: Last Active</option>
                <option value="name">Sort: Name (A-Z)</option>
                <option value="rate">Sort: Highest Rate</option>
              </select>
              <input
                type="text"
                className="form-input"
                placeholder="Search creator, handle..."
                value={creatorSearch}
                onChange={e => setCreatorSearch(e.target.value)}
                style={{ width: 180, height: 32, fontSize: 12 }}
              />
            </div>
          </div>

          {creatorMsg.text&&(
            <div style={{
              margin: '16px 20px 0',
              background: creatorMsg.type==="error"?"rgba(192,57,43,0.08)":"rgba(26,122,74,0.08)",
              border:`1px solid ${creatorMsg.type==="error"?"var(--red)":"var(--green)"}`,
              borderRadius:"var(--radius-sm)",padding:"10px 14px",
              fontSize:13,color:creatorMsg.type==="error"?"var(--red)":"var(--green)"
            }}>{creatorMsg.text}</div>
          )}
          <div className="table-wrap">
            <table className="premium-table">
              <thead><tr><th>Name</th><th>Email</th><th>Handles</th><th>Rate</th><th>AM</th><th>Last Active</th><th>Status</th><th style={{textAlign:"right"}}>Actions</th></tr></thead>
              <tbody>
                {enrichedCreators.map(c=>{
                  const am = db.accountManagers.find(a=>a.id===c.am_id);
                  const archived = !!c.archived_at;
                  return (
                    <tr key={c.id} style={archived?{opacity:0.62}:undefined}>
                      <td className="fw-600">{c.name||"—"}</td>
                      <td style={{fontSize:12,color:"var(--ink3)"}}>{c.email}</td>
                      <td style={{fontSize:12}}>{c.tiktok_handle?"@"+c.tiktok_handle:""}{c.instagram_handle?" / @"+c.instagram_handle:""}</td>
                      <td className="text-green">{c.weekly_rate?`$${c.weekly_rate}/wk`:"—"}</td>
                      <td style={{fontSize:12}}>{am?.name||<span style={{color:"var(--orange)"}}>Unassigned</span>}</td>
                      <td style={{fontSize:12, color: "var(--ink3)"}}>{fmtRelativeTime(c.lastActiveTime)}</td>
                      <td>
                        {archived?<span className="badge badge-gray">Archived</span>:statusBadge(c.status||"Active")}
                        {archived&&c.archive_reason&&(
                          <div style={{fontSize:11,color:"var(--ink3)",marginTop:3,maxWidth:200}}>{c.archive_reason}</div>
                        )}
                      </td>
                      <td>
                        <div style={{display:"flex",gap:6,justifyContent:"flex-end",flexWrap:"wrap"}}>
                          <button className="btn btn-sm btn-ghost" onClick={()=>setEditCreator({...c})}>Edit</button>
                          {archived
                            ? <button className="btn btn-sm btn-green" disabled={saving} onClick={()=>setCreatorArchived(c,false)}>Restore</button>
                            : <button className="btn btn-sm btn-ghost" style={{color:"var(--orange)"}} disabled={saving}
                                      onClick={()=>{setArchiveCreatorTarget(c);setArchiveCreatorReason("");}}>Archive</button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {enrichedCreators.length===0&&<div className="empty" style={{padding:48}}><div className="empty-icon text-muted" style={{fontSize:40,marginBottom:16}}>🎬</div><h3 style={{fontSize:18,marginBottom:8}}>No creators match filters</h3><p style={{color:"var(--ink3)"}}>Try adjusting your search or status filter.</p></div>}
        </div>
      )}

      {tab==="ams"&&(
        <div className="premium-card">
          <div className="flex-between mb-16" style={{flexWrap:"wrap",gap:10}}>
            <div style={{fontSize:12,color:"var(--ink3)"}}>
              Archiving keeps the manager's record so assignment history stays intact.
            </div>
            <button className="btn btn-sm btn-primary" onClick={()=>{setShowCreateAM(true);setAmMsg({type:"",text:""});}}>+ Add Account Manager</button>
          </div>

          {amMsg.text&&(
            <div style={{
              background: amMsg.type==="error"?"rgba(192,57,43,0.08)":"rgba(26,122,74,0.08)",
              border:`1px solid ${amMsg.type==="error"?"var(--red)":"var(--green)"}`,
              borderRadius:"var(--radius-sm)",padding:"10px 14px",marginBottom:14,
              fontSize:13,color:amMsg.type==="error"?"var(--red)":"var(--green)"
            }}>{amMsg.text}</div>
          )}

          <div className="table-wrap">
            <table className="premium-table">
              <thead><tr><th>Name</th><th>Email</th><th>Creators</th><th>Status</th><th style={{textAlign:"right"}}>Actions</th></tr></thead>
              <tbody>
                {db.accountManagers.map(am=>{
                  const count = db.creators.filter(c=>c.am_id===am.id).length;
                  const archived = am.status === "Archived";
                  return (
                    <tr key={am.id} style={archived?{opacity:0.62}:undefined}>
                      <td className="fw-600">{am.name||"—"}</td>
                      <td style={{fontSize:12,color:"var(--ink3)"}}>{am.email}</td>
                      <td>{count} creators</td>
                      <td>
                        <span className={`badge ${archived?"badge-gray":"badge-green"}`}>{archived?"Archived":"Active"}</span>
                        {archived&&am.archive_reason&&(
                          <div style={{fontSize:11,color:"var(--ink3)",marginTop:3,maxWidth:200}}>{am.archive_reason}</div>
                        )}
                      </td>
                      <td>
                        <div style={{display:"flex",gap:6,justifyContent:"flex-end",flexWrap:"wrap"}}>
                          <button className="btn btn-sm btn-ghost" onClick={()=>setEditAM({...am})}>Edit</button>
                          {archived
                            ? <button className="btn btn-sm btn-green" disabled={saving} onClick={()=>setAMArchived(am,false)}>Restore</button>
                            : <button className="btn btn-sm btn-ghost" style={{color:"var(--orange)"}} disabled={saving}
                                      onClick={()=>{setArchiveAMTarget(am);setArchiveAMReason("");}}>Archive</button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {db.accountManagers.length===0&&<div className="empty" style={{padding:48}}><div className="empty-icon text-muted" style={{fontSize:40,marginBottom:16}}>👥</div><h3 style={{fontSize:18,marginBottom:8}}>No team members yet</h3><p style={{color:"var(--ink3)"}}>Add one above, or invite them using your portal URL.</p></div>}
        </div>
      )}

      {/* Create Account Manager */}
      {showCreateAM&&(
        <div className="modal-overlay" onClick={()=>setShowCreateAM(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-title">Add Account Manager</div>
            <div className="modal-sub">
              Creates their sign-in account and their manager record together, then
              emails an invitation so they set their own password.
            </div>
            <div className="form-group">
              <label className="form-label">Email <span style={{color:"var(--red)"}}>*</span></label>
              <input className="form-input" type="email" placeholder="manager@example.com"
                     value={amForm.email} onChange={e=>setAmForm({...amForm,email:e.target.value})}/>
            </div>
            <div className="form-group">
              <label className="form-label">Full name</label>
              <input className="form-input" placeholder="Optional"
                     value={amForm.fullName} onChange={e=>setAmForm({...amForm,fullName:e.target.value})}/>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={()=>setShowCreateAM(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createAM} disabled={amBusy||!amForm.email.trim()}>
                {amBusy?"Creating…":"Create & Invite"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Archive Account Manager */}
      {archiveAMTarget&&(
        <div className="modal-overlay" onClick={()=>setArchiveAMTarget(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-title">Archive {archiveAMTarget.name||archiveAMTarget.email}?</div>
            <div className="modal-sub">
              {db.creators.filter(c=>c.am_id===archiveAMTarget.id).length > 0
                ? `${db.creators.filter(c=>c.am_id===archiveAMTarget.id).length} creator(s) are still assigned to them. Those assignments are preserved — reassign the creators separately if someone else should take over.`
                : "No creators are currently assigned to them."}
            </div>
            <div className="form-group">
              <label className="form-label">Reason <span style={{color:"var(--red)"}}>*</span></label>
              <input className="form-input" placeholder="e.g. Left the agency"
                     value={archiveAMReason} onChange={e=>setArchiveAMReason(e.target.value)}/>
            </div>
            <div style={{fontSize:11,color:"var(--ink3)",marginBottom:12}}>
              To also stop them signing in, deactivate their user account in User Management.
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={()=>setArchiveAMTarget(null)}>Cancel</button>
              <button className="btn" style={{background:"var(--orange)",color:"#fff"}}
                      onClick={()=>setAMArchived(archiveAMTarget,true,archiveAMReason)}
                      disabled={saving||!archiveAMReason.trim()}>
                {saving?"Archiving…":"Archive"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Archive Creator */}
      {archiveCreatorTarget&&(
        <div className="modal-overlay" onClick={()=>setArchiveCreatorTarget(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-title">Archive {archiveCreatorTarget.name||archiveCreatorTarget.email}?</div>
            <div className="modal-sub">
              Their submissions, campaign history and earnings are kept and stay linked. You can restore them at any time.
            </div>
            <div className="form-group">
              <label className="form-label">Reason <span style={{color:"var(--red)"}}>*</span></label>
              <input className="form-input" placeholder="e.g. No longer active"
                     value={archiveCreatorReason} onChange={e=>setArchiveCreatorReason(e.target.value)}/>
            </div>
            <div style={{fontSize:11,color:"var(--ink3)",marginBottom:12}}>
              To also stop them signing in, deactivate their user account in User Management.
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={()=>setArchiveCreatorTarget(null)}>Cancel</button>
              <button className="btn" style={{background:"var(--orange)",color:"#fff"}}
                      onClick={()=>setCreatorArchived(archiveCreatorTarget,true,archiveCreatorReason)}
                      disabled={saving||!archiveCreatorReason.trim()}>
                {saving?"Archiving…":"Archive"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editCreator&&(
        <div className="modal-overlay" onClick={()=>setEditCreator(null)}>
          <div className="modal" style={{maxWidth:500}} onClick={e=>e.stopPropagation()}>
            <div className="modal-title">Edit Creator</div>
            <div className="modal-sub">{editCreator.email}</div>
            <div className="form-group"><label className="form-label">Display Name</label><input className="form-input" value={editCreator.name||""} onChange={e=>setEditCreator({...editCreator,name:e.target.value})}/></div>
            <div className="grid-2">
              <div className="form-group"><label className="form-label">TikTok Handle</label><input className="form-input" placeholder="@handle" value={editCreator.tiktok_handle||""} onChange={e=>setEditCreator({...editCreator,tiktok_handle:e.target.value.replace("@","")})}/></div>
              <div className="form-group"><label className="form-label">Instagram Handle</label><input className="form-input" placeholder="@handle" value={editCreator.instagram_handle||""} onChange={e=>setEditCreator({...editCreator,instagram_handle:e.target.value.replace("@","")})}/></div>
              <div className="form-group"><label className="form-label">Weekly Rate ($)</label><input className="form-input" type="number" value={editCreator.weekly_rate||""} onChange={e=>setEditCreator({...editCreator,weekly_rate:e.target.value})}/></div>
              <div className="form-group"><label className="form-label">Videos/Week</label><input className="form-input" type="number" value={editCreator.videos_per_week||""} onChange={e=>setEditCreator({...editCreator,videos_per_week:e.target.value})}/></div>
              <div className="form-group"><label className="form-label">Payment Method</label><select className="select" value={editCreator.payment_method||""} onChange={e=>setEditCreator({...editCreator,payment_method:e.target.value})}><option value="">Select...</option>{["PayPal","Venmo","Zelle","Bank Transfer","Cash App","Crypto"].map(m=><option key={m}>{m}</option>)}</select></div>
              <div className="form-group"><label className="form-label">Payment Handle/Email</label><input className="form-input" placeholder="e.g. @venmo or email" value={editCreator.payment_handle||""} onChange={e=>setEditCreator({...editCreator,payment_handle:e.target.value})}/></div>
            </div>
            <div className="form-group"><label className="form-label">Assign to Account Manager</label><select className="select" value={editCreator.am_id||""} onChange={e=>setEditCreator({...editCreator,am_id:e.target.value})}><option value="">No AM assigned</option>{db.accountManagers.map(am=><option key={am.id} value={am.id}>{am.name}</option>)}</select></div>
            <div className="form-group"><label className="form-label">Status</label><select className="select" value={editCreator.status||"Active"} onChange={e=>setEditCreator({...editCreator,status:e.target.value})}>{["Active","Paused","Offboarded"].map(s=><option key={s}>{s}</option>)}</select></div>
            {creatorMsg.type==="error"&&creatorMsg.text&&<div style={{color:"var(--red)",fontSize:13,marginBottom:12}} role="alert">{creatorMsg.text}</div>}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={()=>setEditCreator(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveCreator} disabled={saving}>{saving?"Saving...":"Save Changes"}</button>
            </div>
          </div>
        </div>
      )}

      {editAM&&(
        <div className="modal-overlay" onClick={()=>setEditAM(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-title">Edit Account Manager</div>
            <div className="form-group"><label className="form-label">Name</label><input className="form-input" value={editAM.name||""} onChange={e=>setEditAM({...editAM,name:e.target.value})}/></div>
            <div className="form-group"><label className="form-label">Email</label><input className="form-input" value={editAM.email||""} onChange={e=>setEditAM({...editAM,email:e.target.value})}/></div>
            <div className="form-group">
              <label className="form-label">Commission Rate</label>
              <select className="select" value={editAM.commission_rate||0.10} onChange={e=>setEditAM({...editAM,commission_rate:Number(e.target.value)})}>
                {[0.05,0.08,0.10,0.12,0.15,0.18,0.20,0.25].map(r=><option key={r} value={r}>{r*100}%{r===0.10?" (default)":""}</option>)}
              </select>
            </div>
            {amMsg.type==="error"&&amMsg.text&&<div style={{color:"var(--red)",fontSize:13,marginBottom:12}} role="alert">{amMsg.text}</div>}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={()=>setEditAM(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveAM} disabled={saving}>{saving?"Saving...":"Save Changes"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
