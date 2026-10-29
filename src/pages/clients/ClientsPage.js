import { useState } from "react";
import { supabase } from "../../supabaseClient";
import ErrorMsg from "../../ui/ErrorMsg";
import { fmtMoney, statusBadge } from "../../utils";
import ClientForm from "./ClientForm";
import ClientProfile from "./ClientProfile";

export default function ClientsPage({ isOwner, db, onRefresh, user }) {
  const [showCreate, setShowCreate] = useState(false);
  const [editClient, setEditClient] = useState(null);
  const [viewClient, setViewClient] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [linkingClient, setLinkingClient] = useState(null); // { id, name }
  const [linkEmail, setLinkEmail] = useState("");
  const [linkMsg, setLinkMsg] = useState({ type: "", text: "" });
  const [linkBusy, setLinkBusy] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiveReason, setArchiveReason] = useState("");
  const [archiveErr, setArchiveErr] = useState("");
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteErr, setDeleteErr] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Permanent, unlike archive. The database is the real guard here:
  // campaigns.client_id has no ON DELETE clause, so Postgres refuses (23503)
  // for any client that has campaigns — nothing cascades and nothing is
  // orphaned. Owner-only, and audited before the row goes.
  const deleteClient = async () => {
    setDeleteBusy(true);
    setDeleteErr("");
    const { error } = await supabase.from("clients").delete().eq("id", deleteTarget.id);
    if (error) {
      const isLinked = error.code === "23503" || /foreign key/i.test(error.message || "");
      setDeleteErr(isLinked
        ? `${deleteTarget.name} still has campaigns linked to it, so it can't be deleted. Archive it instead — that keeps the history and can be undone.`
        : `Could not delete: ${error.message}`);
      setDeleteBusy(false);
      return;
    }
    setDeleteTarget(null);
    setDeleteConfirm("");
    await onRefresh();
    setDeleteBusy(false);
  };

  // Archive, not delete: a client anchors campaigns, submissions and payment
  // history, so removing it here means the reversible archive/restore in
  // ClientProfile — this is the same flow, just reachable from the row
  // directly instead of only after opening the client's profile.
  const setClientArchived = async (client, archived, reason) => {
    if (archived && !(reason || "").trim()) {
      setArchiveErr("Give a reason — it is what the audit entry will say.");
      return;
    }
    setArchiveBusy(true);
    setArchiveErr("");
    const patch = archived
      ? { status: "Archived", archived_at: new Date().toISOString(), archived_by: user?.id || null, archive_reason: (reason || "").trim() }
      : { status: "Active", archived_at: null, archived_by: null, archive_reason: null };
    const { data, error } = await supabase.from("clients").update(patch).eq("id", client.id).select("id");
    if (error || !data || data.length === 0) {
      setArchiveErr(error ? `Could not save: ${error.message}` : "That client was not updated — you may not have permission.");
      setArchiveBusy(false);
      return;
    }
    setArchiveTarget(null);
    setArchiveReason("");
    await onRefresh();
    setArchiveBusy(false);
  };

  const handleLinkAccount = async () => {
    if (!linkEmail.trim()) return;
    setLinkBusy(true); setLinkMsg({ type: "", text: "" });
    try {
      // Look up user_profiles by email to get the user's id.
      const { data: profile, error: lookupErr } = await supabase
        .from("user_profiles")
        .select("id, full_name, role")
        .eq("email", linkEmail.trim().toLowerCase())
        .maybeSingle();
      if (lookupErr) throw lookupErr;
      if (!profile) throw new Error(`No account found for ${linkEmail.trim()}. Ask the client to sign up first.`);
      if (profile.role !== "client") throw new Error(`That account has role "${profile.role}", not "client". The user must sign up as Client / Brand Partner.`);

      const { error: updateErr } = await supabase
        .from("clients")
        .update({ user_id: profile.id })
        .eq("id", linkingClient.id)
        .is("user_id", null);
      if (updateErr) throw updateErr;

      setLinkMsg({ type: "success", text: `Linked! ${profile.full_name || linkEmail} can now log in to the brand portal.` });
      await onRefresh();
      setTimeout(() => { setLinkingClient(null); setLinkEmail(""); setLinkMsg({ type: "", text: "" }); }, 2000);
    } catch (e) {
      setLinkMsg({ type: "error", text: e.message });
    } finally {
      setLinkBusy(false);
    }
  };
  const emptyForm = {name:"",deal_type:"Monthly Retainer",videos_per_month:20,budget:0,status:"Active",contact_name:"",contact_email:"",contact_phone:"",contract_notes:"",contract_url:"",drive_link:""};
  const [form, setForm] = useState(emptyForm);

  const create = async () => {
    if (!form.name) { setErr("Client name is required"); return; }
    setSaving(true);
    
    // Auto-assign AM if user is an AM
    let finalForm = { ...form };
    if (!isOwner && user) {
      const myAM = db.accountManagers.find(am => am.email === user.email);
      if (myAM) {
        finalForm.am_id = myAM.id;
      }
    }

    const { error } = await supabase.from("clients").insert({...finalForm,videos_per_month:Number(finalForm.videos_per_month),budget:Number(finalForm.budget)});
    if (error) { setErr(error.message); setSaving(false); return; }
    await onRefresh(); setShowCreate(false); setSaving(false);
    setForm(emptyForm);
  };

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("clients").update({...editClient,videos_per_month:Number(editClient.videos_per_month),budget:Number(editClient.budget)}).eq("id", editClient.id);
    if (error) { setErr(error.message); setSaving(false); return; }
    await onRefresh(); setEditClient(null); setSaving(false);
  };

  return (
    <div className="content">
      <div className="flex-between mb-16">
        {isOwner&&<span className="owner-badge">👑 Owner View — All client data visible</span>}
        {isOwner&&<button className="btn btn-primary btn-sm" onClick={()=>setShowCreate(true)}>+ Add Client</button>}
      </div>
      <div className="premium-card">
        <div className="table-wrap">
          <table className="premium-table">
            <thead>
              <tr>
                <th>Client</th><th>Deal</th><th>Videos/Mo</th><th>Status</th>
                {isOwner?<><th>Budget</th><th>Contact</th><th>Email</th></>:<th>Monthly Value</th>}
                <th>AM</th><th>Portal</th><th>Drive</th>
                {isOwner&&<th style={{textAlign:"right"}}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {db.clients.map(c=>(
                <tr key={c.id} style={c.status==="Archived"?{opacity:0.62}:undefined}>
                  <td className="fw-600" style={{cursor:"pointer",color:"var(--blue)"}} onClick={()=>setViewClient(c)}>{c.name}</td>
                  <td>{statusBadge(c.deal_type)}</td>
                  <td>{c.videos_per_month}</td>
                  <td>{statusBadge(c.status)}</td>
                  {isOwner?<>
                    <td className="text-green fw-600">{fmtMoney(c.budget)}</td>
                    <td>{c.contact_name||"—"}</td>
                    <td style={{fontSize:12}}>{c.contact_email||"—"}</td>
                  </>:<td className="fw-600" style={{color:"var(--green)"}}>{fmtMoney(c.budget)}</td>}
                  <td style={{fontSize:12}}>{db.accountManagers.find(a=>a.id===c.am_id)?.name||"—"}</td>
                  <td style={{fontSize:12}}>
                    {c.user_id
                      ? <span className="badge badge-green" style={{fontSize:10}}>✓ Active</span>
                      : <button className="btn btn-sm btn-ghost" style={{fontSize:11,padding:"3px 8px"}} onClick={()=>{setLinkingClient({id:c.id,name:c.name});setLinkEmail("");setLinkMsg({type:"",text:""});}}>🔗 Link</button>}
                  </td>
                  <td>{c.drive_link?<a href={c.drive_link} target="_blank" rel="noreferrer" className="link">📁 Drive</a>:"—"}</td>
                  {isOwner&&<td>
                    <div style={{display:"flex",gap:6,justifyContent:"flex-end",flexWrap:"wrap"}}>
                      <button className="btn btn-sm btn-ghost" onClick={()=>{setErr("");setEditClient({...c});}}>Edit</button>
                      {c.status==="Archived"
                        ? <button className="btn btn-sm btn-green" disabled={archiveBusy} onClick={()=>setClientArchived(c,false)}>Restore</button>
                        : <button className="btn btn-sm btn-ghost" style={{color:"var(--orange)"}} disabled={archiveBusy}
                                  onClick={()=>{setArchiveTarget(c);setArchiveReason("");setArchiveErr("");}}>🗄 Archive</button>}
                      <button className="btn btn-sm btn-ghost" style={{color:"var(--red)"}} disabled={deleteBusy}
                              onClick={()=>{setDeleteTarget(c);setDeleteConfirm("");setDeleteErr("");}}>Delete</button>
                    </div>
                  </td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {!isOwner&&<div style={{marginTop:12,fontSize:12,color:"var(--ink3)",background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:"var(--radius-sm)",padding:"10px 14px"}}>🔒 Contact details visible to owner only.</div>}
      {showCreate&&<ClientForm data={form} setData={setForm} onSave={create} onCancel={()=>setShowCreate(false)} title="Add Client" db={db} err={err} saving={saving}/>}
      {editClient&&<ClientForm data={editClient} setData={setEditClient} onSave={save} onCancel={()=>setEditClient(null)} title="Edit Client" db={db} err={err} saving={saving}/>}
      {viewClient&&<ClientProfile client={viewClient} db={db} onRefresh={onRefresh} onClose={()=>setViewClient(null)} isOwner={isOwner} user={user}/>}
      {linkingClient&&(
        <div className="modal-overlay" onClick={()=>setLinkingClient(null)}>
          <div className="modal" style={{maxWidth:460}} onClick={e=>e.stopPropagation()}>
            <div className="flex-between mb-16">
              <div>
                <div className="modal-title" style={{marginBottom:2}}>Link Portal Account</div>
                <div style={{fontSize:12,color:"var(--ink3)"}}>{linkingClient.name}</div>
              </div>
              <button className="btn btn-sm btn-ghost" onClick={()=>setLinkingClient(null)}>✕</button>
            </div>
            <p style={{fontSize:13,color:"var(--ink3)",marginBottom:20,lineHeight:1.6}}>
              Enter the email the client used when signing up as <strong>Client / Brand Partner</strong>. Their portal will be linked to this record immediately.
            </p>
            <div className="form-group">
              <label className="form-label">Client's account email</label>
              <input
                className="form-input"
                type="email"
                placeholder="client@brand.com"
                value={linkEmail}
                onChange={e=>setLinkEmail(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&handleLinkAccount()}
                autoFocus
              />
            </div>
            {linkMsg.text&&(
              <div style={{fontSize:13,marginBottom:12,padding:"8px 12px",borderRadius:"var(--radius-sm)",background:linkMsg.type==="success"?"rgba(26,122,74,0.08)":"rgba(192,57,43,0.08)",color:linkMsg.type==="success"?"var(--green)":"var(--red)"}}>
                {linkMsg.text}
              </div>
            )}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={()=>setLinkingClient(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleLinkAccount} disabled={linkBusy||!linkEmail.trim()}>
                {linkBusy?"Linking…":"Link Account"}
              </button>
            </div>
          </div>
        </div>
      )}
      {archiveTarget&&(
        <div className="modal-overlay" onClick={()=>setArchiveTarget(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-title">Archive {archiveTarget.name}?</div>
            <div className="modal-sub">Their campaigns, submissions and financial history are kept and stay linked. You can restore them at any time.</div>
            {archiveErr&&<ErrorMsg msg={archiveErr}/>}
            <div className="form-group">
              <label className="form-label">Reason <span style={{color:"var(--red)"}}>*</span></label>
              <input className="form-input" placeholder="e.g. Contract ended August 2026"
                     value={archiveReason} onChange={e=>setArchiveReason(e.target.value)}/>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={()=>setArchiveTarget(null)}>Cancel</button>
              <button className="btn" style={{background:"var(--orange)",color:"#fff"}}
                      onClick={()=>setClientArchived(archiveTarget,true,archiveReason)}
                      disabled={archiveBusy||!archiveReason.trim()}>
                {archiveBusy?"Archiving…":"Archive Client"}
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteTarget&&(()=>{
        const linked = db.campaigns.filter(c=>c.client_id===deleteTarget.id).length;
        return (
        <div className="modal-overlay" onClick={()=>setDeleteTarget(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-title" style={{color:"var(--red)"}}>Delete {deleteTarget.name}?</div>
            <div className="modal-sub">
              This is permanent — unlike Archive, it cannot be undone and the client's
              record will not be recoverable.
            </div>
            {linked>0?(
              <div style={{background:"rgba(192,57,43,0.08)",border:"1px solid var(--red)",borderRadius:"var(--radius-sm)",padding:"10px 14px",margin:"12px 0",fontSize:13,color:"var(--red)"}}>
                {linked} campaign{linked===1?" is":"s are"} still linked to this client, so it cannot be deleted.
                Archive it instead — that keeps the history and can be undone.
              </div>
            ):(
              <>
                {deleteErr&&<ErrorMsg msg={deleteErr}/>}
                <div className="form-group">
                  <label className="form-label">
                    Type <strong>{deleteTarget.name.trim()}</strong> to confirm
                  </label>
                  <input className="form-input" placeholder={deleteTarget.name.trim()}
                         value={deleteConfirm} onChange={e=>setDeleteConfirm(e.target.value)}/>
                </div>
              </>
            )}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={()=>setDeleteTarget(null)}>Cancel</button>
              {linked>0
                ? <button className="btn" style={{background:"var(--orange)",color:"#fff"}}
                          onClick={()=>{const t=deleteTarget;setDeleteTarget(null);setArchiveTarget(t);setArchiveReason("");setArchiveErr("");}}>
                    🗄 Archive Instead
                  </button>
                : <button className="btn" style={{background:"var(--red)",color:"#fff"}}
                          onClick={deleteClient}
                          disabled={deleteBusy||deleteConfirm.trim()!==deleteTarget.name.trim()}>
                    {deleteBusy?"Deleting…":"Delete Permanently"}
                  </button>}
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
