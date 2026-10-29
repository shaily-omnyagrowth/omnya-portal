import { useState } from "react";
import { updateRows } from "../../lib/db";
import { supabase } from "../../supabaseClient";
import { getAvatarColor, getInitials } from "../../utils";

export default function TeamPerformance({ db, onRefresh }) {
  const [editingSatisfaction, setEditingSatisfaction] = useState(null);
  const [satValue, setSatValue] = useState(0);

  const [editCreator, setEditCreator] = useState(null);
  const [editAM, setEditAM] = useState(null);
  const [saving, setSaving] = useState(false);
  const [archiveAMTarget, setArchiveAMTarget] = useState(null);
  const [archiveAMReason, setArchiveAMReason] = useState("");
  const [amMsg, setAmMsg] = useState({ type: "", text: "" });

  const setAMArchived = async (am, archived, reason) => {
    setSaving(true);
    setAmMsg({ type: "", text: "" });
    const patch = archived
      ? {
          status: "Archived",
          archived_at: new Date().toISOString(),
          archived_by: db._currentUser?.id || null,
          archive_reason: (reason || "").trim(),
        }
      : { status: "Active", archived_at: null, archived_by: null, archive_reason: null };

    const { data, error } = await supabase
      .from("account_managers").update(patch).eq("id", am.id).select("id");

    if (error || !data || data.length === 0) {
      setAmMsg({
        type: "error",
        text: error ? `Could not save: ${error.message}` : "That manager was not updated — you may not have permission.",
      });
      setSaving(false);
      return;
    }

    setArchiveAMTarget(null);
    setArchiveAMReason("");
    await onRefresh();
    setSaving(false);
  };

  // Same defect, same fix, as Manage Creators: these used to close the modal
  // whether or not the row was saved.
  const [saveErr, setSaveErr] = useState("");

  const saveCreator = async () => {
    setSaving(true); setSaveErr("");
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
    if (err) { setSaveErr(err); setSaving(false); return; }
    await onRefresh();
    setEditCreator(null);
    setSaving(false);
  };

  const saveAM = async () => {
    const rate = Number(editAM.commission_rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 0.5) { setSaveErr("Commission rate has to be between 0 and 0.50 (0% to 50%)."); return; }
    setSaving(true); setSaveErr("");
    const err = await updateRows("account_managers", {
      name: editAM.name,
      email: editAM.email,
      commission_rate: rate,
    }, { id: editAM.id });
    if (err) { setSaveErr(err); setSaving(false); return; }
    await onRefresh();
    setEditAM(null);
    setSaving(false);
  };

  const saveSatisfaction = async (clientId, score) => {
    await supabase.from("clients").update({satisfaction_score: score}).eq("id", clientId);
    await onRefresh();
    setEditingSatisfaction(null);
  };

  return (
    <div className="content">
      <div className="mb-16"><span className="owner-badge">👑 Owner View</span></div>
      <div style={{display:"flex",flexDirection:"column",gap:20}}>
        {db.accountManagers.map(am=>{
          const amCreators = db.creators.filter(c=>c.am_id===am.id);
          const amClients = db.clients.filter(c=>c.am_id===am.id);
          const amCampaigns = db.campaigns.filter(camp=>amClients.some(cl=>cl.id===camp.client_id));
          const activeCampaigns = amCampaigns.filter(c=>c.status==="In Progress"||c.status==="Open");

          // Review turnaround time — avg days from submission to review
          const reviewedSubs = db.submissions.filter(s=>{
            const cr = db.creators.find(c=>c.id===s.creator_id);
            return cr?.am_id===am.id && s.reviewed_at && s.created_at;
          });
          const avgTurnaround = reviewedSubs.length>0
            ? (reviewedSubs.reduce((t,s)=>t+((new Date(s.reviewed_at)-new Date(s.created_at))/(1000*60*60*24)),0)/reviewedSubs.length).toFixed(1)
            : null;

          // Creator retention — active creators / total creators ever
          const activeCreators = amCreators.filter(c=>c.status==="Active").length;
          const retentionRate = amCreators.length>0?Math.round((activeCreators/amCreators.length)*100):0;

          // Campaign profit %
          const amRevenue = amClients.reduce((t,c)=>t+Number(c.budget||0),0);
          const amCreatorCost = db.submissions.filter(s=>{
            const cr=db.creators.find(c=>c.id===s.creator_id);
            return cr?.am_id===am.id&&s.status==="Approved";
          }).reduce((t,s)=>{
            const camp=db.campaigns.find(c=>c.id===s.campaign_id);
            return t+Number(camp?.pay_per_video||0);
          },0);
          const amRate = Number(am.commission_rate||0.10);
          const amCost = amRevenue*amRate;
          const amProfit = amRevenue - amCreatorCost - amCost;
          const amMargin = amRevenue>0?Math.round((amProfit/amRevenue)*100):0;

          // Client satisfaction avg
          const ratedClients = amClients.filter(c=>c.satisfaction_score);
          const avgSatisfaction = ratedClients.length>0
            ? (ratedClients.reduce((t,c)=>t+c.satisfaction_score,0)/ratedClients.length).toFixed(1)
            : null;

          const totalApproved = db.submissions.filter(s=>{const cr=db.creators.find(c=>c.id===s.creator_id);return cr?.am_id===am.id&&s.status==="Approved";}).length;

          return (
            <div key={am.id} className="premium-card">
              {/* AM Header */}
              <div className="flex-between mb-16">
                <div className="flex-center gap-12">
                  <div className={`creator-avatar ${getAvatarColor(am.name)}`} style={{width:48,height:48,fontSize:18}}>{getInitials(am.name)}</div>
                  <div>
                    <div style={{fontFamily:"Bebas Neue, sans-serif",fontSize:20}}>{am.name}</div>
                    <div style={{fontSize:12,color:"var(--ink3)",marginBottom:4}}>{am.email} · {amRate*100}% commission</div>
                    <div style={{display:"flex",gap:4}}>
                      <button className="btn btn-sm btn-ghost" onClick={()=>setEditAM({...am})}>✏️ Edit</button>
                      <button className="btn btn-sm btn-ghost" style={{color:"var(--orange)"}} onClick={()=>{setArchiveAMTarget(am);setArchiveAMReason("");}}>🗄 Archive</button>
                    </div>
                  </div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontFamily:"Bebas Neue, sans-serif",fontSize:24,color:amMargin>=40?"var(--green)":amMargin>=20?"var(--gold)":"var(--red)"}}>{amMargin}%</div>
                  <div style={{fontSize:11,color:"var(--ink3)"}}>Campaign Margin</div>
                </div>
              </div>

              {/* Key Metrics Grid */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:20}}>
                {[
                  ["Active Campaigns", activeCampaigns.length, "var(--blue)"],
                  ["Creators", `${activeCreators}/${amCreators.length}`, "var(--ink)"],
                  ["Approved Videos", totalApproved, "var(--green)"],
                  ["Avg Turnaround", avgTurnaround?`${avgTurnaround}d`:"—", avgTurnaround&&avgTurnaround<=3?"var(--green)":avgTurnaround&&avgTurnaround<=5?"var(--gold)":"var(--red)"],
                  ["Creator Retention", `${retentionRate}%`, retentionRate>=80?"var(--green)":retentionRate>=60?"var(--gold)":"var(--red)"],
                ].map(([label,val,color])=>(
                  <div key={label} style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:"var(--radius-sm)",padding:12,textAlign:"center"}}>
                    <div style={{fontFamily:"Bebas Neue, sans-serif",fontSize:24,color}}>{val}</div>
                    <div style={{fontSize:10,color:"var(--ink3)"}}>{label}</div>
                  </div>
                ))}
              </div>

              {/* Client Satisfaction Ratings */}
              <div style={{marginBottom:16}}>
                <div style={{fontSize:12,fontWeight:600,marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span>Client Satisfaction</span>
                  {avgSatisfaction&&<span style={{fontWeight:700,color:"var(--green)"}}>⭐ {avgSatisfaction} avg</span>}
                </div>
                {amClients.length===0&&<div style={{fontSize:12,color:"var(--ink3)",fontStyle:"italic"}}>No clients assigned</div>}
                {amClients.map(cl=>(
                  <div key={cl.id} className="flex-between" style={{padding:"6px 0",borderBottom:"1px solid var(--border)"}}>
                    <div style={{fontSize:13,fontWeight:500}}>{cl.name}</div>
                    <div style={{display:"flex",gap:4,alignItems:"center"}}>
                      {editingSatisfaction===cl.id ? (
                        <div style={{display:"flex",gap:4,alignItems:"center"}}>
                          {[1,2,3,4,5].map(n=>(
                            <button key={n} onClick={()=>setSatValue(n)} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,opacity:satValue>=n?1:0.3}}>⭐</button>
                          ))}
                          <button className="btn btn-sm btn-primary" onClick={()=>saveSatisfaction(cl.id,satValue)} style={{marginLeft:4}}>Save</button>
                          <button className="btn btn-sm btn-ghost" onClick={()=>setEditingSatisfaction(null)}>✕</button>
                        </div>
                      ) : (
                        <div style={{display:"flex",gap:4,alignItems:"center"}}>
                          <span style={{fontSize:13}}>{"⭐".repeat(cl.satisfaction_score||0)||<span style={{color:"var(--ink3)",fontSize:12}}>Not rated</span>}</span>
                          <button className="btn btn-sm btn-ghost" style={{fontSize:11}} onClick={()=>{setEditingSatisfaction(cl.id);setSatValue(cl.satisfaction_score||0);}}>
                            {cl.satisfaction_score?"Edit":"Rate"}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Creator breakdown */}
              <div>
                <div style={{fontSize:12,fontWeight:600,marginBottom:8}}>Creator Approval Rates</div>
                {amCreators.map(c=>{
                  const subs=db.submissions.filter(s=>s.creator_id===c.id);
                  const rate=subs.length>0?Math.round((subs.filter(s=>s.status==="Approved").length/subs.length)*100):0;
                  return (
                    <div key={c.id} className="flex-between" style={{padding:"4px 0",fontSize:13}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span>{c.name}</span>
                        <button className="btn btn-sm btn-ghost" style={{padding:"2px 4px",height:"auto",fontSize:11}} onClick={()=>setEditCreator({...c})}>✏️ Edit</button>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <div style={{width:60,background:"var(--bg2)",borderRadius:4,height:4}}>
                          <div style={{width:`${rate}%`,background:rate>80?"var(--green)":"var(--gold)",height:4,borderRadius:4}}/>
                        </div>
                        <span style={{color:rate>80?"var(--green)":"var(--gold)",fontWeight:600,fontSize:12,width:32,textAlign:"right"}}>{rate}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {db.accountManagers.length===0&&<div className="empty" style={{padding:48}}><div className="empty-icon text-muted" style={{fontSize:40,marginBottom:16}}>👥</div><h3 style={{fontSize:18,marginBottom:8}}>No team members yet</h3><p style={{color:"var(--ink3)",marginBottom:24}}>Have Account Managers sign up using this URL, and assign their role in the 'Team/Roles' tab.</p></div>}
      </div>

      {/* Archive Account Manager Modal */}
      {archiveAMTarget&&(
        <div className="modal-overlay" onClick={()=>setArchiveAMTarget(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-title">Archive {archiveAMTarget.name||archiveAMTarget.email}?</div>
            <div className="modal-sub">
              {db.creators.filter(c=>c.am_id===archiveAMTarget.id).length > 0
                ? `${db.creators.filter(c=>c.am_id===archiveAMTarget.id).length} creator(s) are still assigned to them. Those assignments are preserved — reassign the creators separately if someone else should take over.`
                : "No creators are currently assigned to them."}
            </div>
            {amMsg.text&&<div style={{color:"var(--red)",fontSize:13,marginBottom:12}}>{amMsg.text}</div>}
            <div className="form-group">
              <label className="form-label">Reason <span style={{color:"var(--red)"}}>*</span></label>
              <input className="form-input" placeholder="e.g. Left the agency" value={archiveAMReason} onChange={e=>setArchiveAMReason(e.target.value)}/>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={()=>setArchiveAMTarget(null)}>Cancel</button>
              <button className="btn" style={{background:"var(--orange)",color:"#fff"}} onClick={()=>setAMArchived(archiveAMTarget,true,archiveAMReason)} disabled={saving||!archiveAMReason.trim()}>
                {saving?"Archiving…":"Archive"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Creator Modal */}
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
            {saveErr&&<div style={{color:"var(--red)",fontSize:13,marginBottom:12}} role="alert">{saveErr}</div>}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={()=>setEditCreator(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveCreator} disabled={saving}>{saving?"Saving...":"Save Changes"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit AM Modal */}
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
            {saveErr&&<div style={{color:"var(--red)",fontSize:13,marginBottom:12}} role="alert">{saveErr}</div>}
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
