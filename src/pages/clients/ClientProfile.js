import { useState } from "react";
import AMClientSummaryBar from "../../components/AMClientSummaryBar";
import { updateRows } from "../../lib/db";
import { supabase } from "../../supabaseClient";
import ErrorMsg from "../../ui/ErrorMsg";
import { fmtDate } from "../../utils";

export default function ClientProfile({ client, db, onRefresh, onClose, isOwner, user }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    description: client.description||"",
    goals: client.goals||"",
    target_audience: client.target_audience||"",
    content_guidelines: client.content_guidelines||"",
    notes: client.notes||"",
    contract_notes: client.contract_notes||"",
    contract_url: client.contract_url||""
  });

  // §11.1 — soft deletion or inactive states where historical records must stay
  // referentially intact. A client anchors campaigns, submissions and earnings,
  // so it is archived rather than removed.
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");
  const [archiveError, setArchiveError] = useState("");
  const isArchived = client.status === "Archived";

  // A failed save used to report nowhere: the panel dropped out of edit mode
  // and showed the old values again, which reads as "this cannot be edited".
  const [saveError, setSaveError] = useState("");
  const save = async () => {
    setSaving(true);
    setSaveError("");
    const err = await updateRows("clients", form, { id: client.id });
    if (err) { setSaveError("Could not save: " + err); setSaving(false); return; }
    await onRefresh();
    setSaving(false);
    setEditing(false);
  };

  const setArchived = async (archived) => {
    if (archived && !archiveReason.trim()) {
      setArchiveError("Give a reason — it is what the audit entry will say.");
      return;
    }
    setSaving(true);
    setArchiveError("");

    const patch = archived
      ? {
          status: "Archived",
          archived_at: new Date().toISOString(),
          archived_by: user?.id || null,
          archive_reason: archiveReason.trim(),
        }
      : { status: "Active", archived_at: null, archived_by: null, archive_reason: null };

    // .select() is what distinguishes an RLS refusal (no error, zero rows)
    // from a real success.
    const { data, error } = await supabase
      .from("clients").update(patch).eq("id", client.id).select("id");

    if (error || !data || data.length === 0) {
      setArchiveError(error ? `Could not save: ${error.message}`
                            : "That client was not updated — you may not have permission.");
      setSaving(false);
      return;
    }

    await onRefresh();
    setSaving(false);
    setConfirmArchive(false);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{maxWidth:600,maxHeight:"85vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        {isArchived&&(
          <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:12,marginBottom:16}}>
            <div style={{fontSize:13,fontWeight:600,marginBottom:4}}>🗄 Archived</div>
            <div style={{fontSize:12,color:"var(--ink3)"}}>
              {client.archive_reason ? `Reason: ${client.archive_reason}` : "No reason recorded."}
              {client.archived_at ? ` · ${fmtDate(client.archived_at)}` : ""}
            </div>
          </div>
        )}

        {isOwner&&(
          <div style={{marginBottom:16}}>
            {!confirmArchive ? (
              isArchived
                ? <button className="btn btn-sm btn-green" onClick={()=>setArchived(false)} disabled={saving}>{saving?"Restoring…":"↩ Restore Client"}</button>
                : <button className="btn btn-sm btn-ghost" style={{color:"var(--orange)"}} onClick={()=>{setConfirmArchive(true);setArchiveReason("");setArchiveError("");}}>🗄 Archive Client</button>
            ) : (
              <div style={{background:"var(--bg2)",border:"1px solid var(--orange)",borderRadius:"var(--radius-sm)",padding:12}}>
                <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>Archive this client?</div>
                <div style={{fontSize:12,color:"var(--ink3)",marginBottom:12}}>
                  Their campaigns, submissions and financial history are kept and
                  stay linked. You can restore them at any time.
                </div>
                {archiveError&&<ErrorMsg msg={archiveError} />}
                <div className="form-group">
                  <label className="form-label">Reason <span style={{color:"var(--red)"}}>*</span></label>
                  <input className="form-input" placeholder="e.g. Contract ended August 2026"
                         value={archiveReason} onChange={e=>setArchiveReason(e.target.value)}/>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button className="btn btn-sm btn-ghost" onClick={()=>setConfirmArchive(false)}>Cancel</button>
                  <button className="btn btn-sm" style={{background:"var(--orange)",color:"#fff"}}
                          onClick={()=>setArchived(true)} disabled={saving||!archiveReason.trim()}>
                    {saving?"Archiving…":"Archive Client"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex-between mb-16">
          <div>
            <div className="modal-title" style={{marginBottom:2}}>{client.name}</div>
            <div style={{fontSize:12,color:"var(--ink3)"}}>{client.deal_type} · {client.status}</div>
          </div>
          <div style={{display:"flex",gap:8}}>
            {!editing&&<button className="btn btn-sm btn-primary" onClick={()=>setEditing(true)}>✏️ Edit</button>}
            <button className="btn btn-sm btn-ghost" onClick={onClose}>✕</button>
          </div>
        </div>

        {/* AM Account Summary Bar */}
        {!isOwner&&<AMClientSummaryBar client={client} db={db}/>}

        {editing ? (
          <div>
            <div className="form-group"><label className="form-label">What does this client do?</label><textarea className="textarea" rows={3} placeholder="Describe the client's business, product, or service..." value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></div>
            <div className="form-group"><label className="form-label">Goals</label><textarea className="textarea" rows={3} placeholder="What are they trying to achieve with UGC? Brand awareness, conversions, followers..." value={form.goals} onChange={e=>setForm({...form,goals:e.target.value})}/></div>
            <div className="form-group"><label className="form-label">Target Audience</label><textarea className="textarea" rows={2} placeholder="Who are they targeting? Age, interests, demographics..." value={form.target_audience} onChange={e=>setForm({...form,target_audience:e.target.value})}/></div>
            <div className="form-group"><label className="form-label">Content Guidelines</label><textarea className="textarea" rows={3} placeholder="Dos and don'ts, tone of voice, style preferences..." value={form.content_guidelines} onChange={e=>setForm({...form,content_guidelines:e.target.value})}/></div>
            <div className="form-group"><label className="form-label">Notes</label><textarea className="textarea" rows={2} placeholder="Any other important info..." value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></div>
            <div style={{borderTop:"1px solid var(--border)",paddingTop:16,marginTop:4}}>
              <div style={{fontSize:12,fontWeight:600,color:"var(--ink3)",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:12}}>📄 Contract</div>
              <div className="form-group"><label className="form-label">Contract Notes</label><textarea className="textarea" rows={3} placeholder="Payment schedule, deliverables, special terms..." value={form.contract_notes} onChange={e=>setForm({...form,contract_notes:e.target.value})}/></div>
              <div className="form-group"><label className="form-label">Contract URL</label><input className="form-input" placeholder="https://docs.google.com/..." value={form.contract_url} onChange={e=>setForm({...form,contract_url:e.target.value})}/></div>
            </div>
            {saveError&&<ErrorMsg msg={saveError} />}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={()=>setEditing(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?"Saving...":"Save"}</button>
            </div>
          </div>
        ) : (
          <div>
            {[["What they do", form.description],["Goals", form.goals],["Target Audience", form.target_audience],["Content Guidelines", form.content_guidelines],["Notes", form.notes]].map(([label, val])=>(
              <div key={label} style={{marginBottom:16}}>
                <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:"0.5px",color:"var(--ink3)",marginBottom:4}}>{label}</div>
                <div style={{fontSize:14,color:val?"var(--ink)":"var(--ink3)",fontStyle:val?"normal":"italic"}}>{val||"Not filled in yet"}</div>
              </div>
            ))}
            {/* Portal Access section */}
            <div style={{borderTop:"1px solid var(--border)",paddingTop:16,marginTop:16}}>
              <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:"0.5px",color:"var(--ink3)",marginBottom:12}}>🔐 Client Portal Access</div>
              {client.user_id ? (
                <div style={{display:"flex",alignItems:"center",gap:8,background:"rgba(26,122,74,0.07)",border:"1px solid rgba(26,122,74,0.15)",borderRadius:"var(--radius-sm)",padding:"10px 14px"}}>
                  <span style={{color:"var(--green)",fontSize:16}}>✓</span>
                  <div>
                    <div style={{fontSize:13,fontWeight:600,color:"var(--green)"}}>Portal account linked</div>
                    <div style={{fontSize:11,color:"var(--ink3)"}}>Client can log in to view their brand dashboard.</div>
                  </div>
                </div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  <div style={{fontSize:13,color:"var(--ink3)",lineHeight:1.6}}>
                    No portal account linked yet.<br/>
                    Ask the client to sign up at <strong>{window.location.origin}</strong> and select <strong>"Client / Brand Partner"</strong> as their role. Then use the <strong>🔗 Link</strong> button in the clients table to connect their account to this record.
                  </div>
                </div>
              )}
            </div>

            {/* Contract section */}
            <div style={{borderTop:"1px solid var(--border)",paddingTop:16,marginTop:16}}>
              <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:"0.5px",color:"var(--ink3)",marginBottom:12}}>📄 Contract</div>
              {form.contract_url&&(
                <div style={{marginBottom:12}}>
                  <a href={form.contract_url} target="_blank" rel="noreferrer" className="btn btn-sm btn-primary">📄 View Contract</a>
                </div>
              )}
              <div style={{fontSize:14,color:form.contract_notes?"var(--ink)":"var(--ink3)",fontStyle:form.contract_notes?"normal":"italic",background:"var(--bg2)",borderRadius:"var(--radius-sm)",padding:form.contract_notes?"12px":"0",whiteSpace:"pre-wrap"}}>
                {form.contract_notes||"No contract notes yet"}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
