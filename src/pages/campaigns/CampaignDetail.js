import { useEffect, useState } from "react";
import AMClientSummaryBar from "../../components/AMClientSummaryBar";
import { describeWriteError, updateRows } from "../../lib/db";
import { supabase } from "../../supabaseClient";
import ErrorMsg from "../../ui/ErrorMsg";
import { fmtDate, fmtMoney } from "../../utils";
import CampaignForum from "./CampaignForum";

export default function CampaignDetail({ campaign, db, user, onRefresh, onClose, isOwner, onShare }) {
  const [saving, setSaving] = useState(false);
  const [assignError, setAssignError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");
  const [archiveError, setArchiveError] = useState("");
  const isArchived = campaign.status === "Archived";
  const [uploadingBrief, setUploadingBrief] = useState(false);
  const [isSalesSourced, setIsSalesSourced] = useState(Boolean(campaign.is_sales_sourced));
  const [salesRate, setSalesRate] = useState(Number(campaign.sales_commission_rate ?? 0.30));
  const [managerRate, setManagerRate] = useState((campaign.manager_commission_rate == null ? null : Number(campaign.manager_commission_rate)));
  const [showClientCpm, setShowClientCpm] = useState(Boolean(campaign.show_client_cpm));
  // Every write on this screen reports here. None of them used to report at all.
  const [finError, setFinError] = useState("");
  const [editForm, setEditForm] = useState({
    name: campaign.name||"",
    description: campaign.description||"",
    format: campaign.format||"TikTok",
    videos_needed: campaign.videos_needed||10,
    pay_per_video: campaign.pay_per_video||10,
    deadline: campaign.deadline||"",
    status: campaign.status||"Open",
    is_sales_sourced: Boolean(campaign.is_sales_sourced),
    sales_commission_rate: Number(campaign.sales_commission_rate ?? 0.30),
    manager_commission_rate: (campaign.manager_commission_rate == null ? null : Number(campaign.manager_commission_rate)),
    show_client_cpm: Boolean(campaign.show_client_cpm),
  });

  useEffect(() => {
    if (!editing) {
      setIsSalesSourced(Boolean(campaign.is_sales_sourced));
      setSalesRate(Number(campaign.sales_commission_rate ?? 0.30));
      setManagerRate((campaign.manager_commission_rate == null ? null : Number(campaign.manager_commission_rate)));
      setShowClientCpm(Boolean(campaign.show_client_cpm));
      setEditForm({
        name: campaign.name||"",
        description: campaign.description||"",
        format: campaign.format||"TikTok",
        videos_needed: campaign.videos_needed||10,
        pay_per_video: campaign.pay_per_video||10,
        deadline: campaign.deadline||"",
        status: campaign.status||"Open",
        is_sales_sourced: Boolean(campaign.is_sales_sourced),
        sales_commission_rate: Number(campaign.sales_commission_rate ?? 0.30),
        manager_commission_rate: (campaign.manager_commission_rate == null ? null : Number(campaign.manager_commission_rate)),
        show_client_cpm: Boolean(campaign.show_client_cpm),
      });
    }
  }, [campaign, editing]);

  const client = db.clients.find(c=>c.id===campaign.client_id);
  const clientAM = db.accountManagers.find(a=>a.id===client?.am_id);
  const assignedCreators = db.creators.filter(c=>(campaign.assigned_creators||[]).includes(c.id));
  const availableCreators = db.creators.filter(c=>!(campaign.assigned_creators||[]).includes(c.id)&&c.status==="Active");
  const approved = db.submissions.filter(s=>s.campaign_id===campaign.id&&s.status==="Approved").length;

  // Applications from campaign_creators
  const pendingApplications = (db.campaignCreators || []).filter(cc => cc.campaign_id === campaign.id && cc.status === 'Applied');

  // Profitability calculations
  //
  // ONE manager commission. account_managers.commission_rate (10% by default)
  // is the manager commission this screen has always charged, as "AM Cost". The
  // punch list's "10% manager commission" is that same money, so
  // campaigns.manager_commission_rate is a per-campaign OVERRIDE of it and NULL
  // means "use the manager's own rate". Charging both, as a first pass at this
  // did, put 20% on every campaign and understated every margin by 10 points.
  const revenue = Number(client?.budget||0);
  const activeSalesRate = isSalesSourced ? Number(salesRate || 0.30) : 0;
  const amDefaultRate = Number(clientAM?.commission_rate ?? 0.10);
  const activeMgrRate = managerRate == null ? amDefaultRate : Number(managerRate);
  const salesCost = revenue * activeSalesRate;
  const managerCost = revenue * activeMgrRate;
  const creatorCost = approved * Number(campaign.pay_per_video||0);
  const totalCost = salesCost + managerCost + creatorCost;
  const grossProfit = revenue - totalCost;
  const margin = revenue > 0 ? Math.round((grossProfit/revenue)*100) : 0;
  // Cost per video = total campaign cost ÷ videos needed (full commitment)
  const totalCampaignCost = (Number(campaign.videos_needed||1) * Number(campaign.pay_per_video||0)) + managerCost + salesCost;
  const costPerVideo = Number(campaign.videos_needed||0) > 0 ? Math.round(totalCampaignCost / Number(campaign.videos_needed)) : 0;

  // CPM — what the client pays per thousand views. Always shown to owner and
  // manager; whether the CLIENT sees it is the show_client_cpm switch below.
  // Same formula the brand portal uses (client budget / views), so the number a
  // client asks about is the number on this screen. Latest pull per submission.
  const campaignViews = (() => {
    const subIds = new Set(db.submissions.filter(x=>x.campaign_id===campaign.id).map(x=>x.id));
    const latest = {};
    (db.analytics||[]).forEach(a => {
      if (!subIds.has(a.submission_id)) return;
      const prev = latest[a.submission_id];
      if (!prev || new Date(a.pulled_at||0) > new Date(prev.pulled_at||0)) latest[a.submission_id] = a;
    });
    return Object.values(latest).reduce((t,a)=>t+Number(a.views||0),0);
  })();
  const cpm = revenue > 0 && campaignViews > 0 ? (revenue / campaignViews) * 1000 : null;
  const marginColor = margin>=50?"var(--green)":margin>=25?"var(--gold)":"var(--red)";
  const cpvColor = costPerVideo===0?"var(--ink3)":costPerVideo<=50?"var(--green)":costPerVideo<=60?"var(--gold)":"var(--red)";
  const cpvFlag = costPerVideo===0?"":costPerVideo<=50?"🟢":costPerVideo<=60?"⚠️":"🚨";

  // At Risk flags
  const pendingSubs = db.submissions.filter(s=>s.campaign_id===campaign.id&&(s.status==="Submitted"||s.status==="Under Review"));
  const staleSubs = pendingSubs.filter(s=>{
    const days = (Date.now()-new Date(s.created_at).getTime())/(1000*60*60*24);
    return days>3;
  });

  // Velocity calculations
  const now = new Date();
  const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate()-now.getDay()); startOfWeek.setHours(0,0,0,0);
  const startOfLastWeek = new Date(startOfWeek); startOfLastWeek.setDate(startOfWeek.getDate()-7);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const allApproved = db.submissions.filter(s=>s.campaign_id===campaign.id&&s.status==="Approved");
  const thisWeekApproved = allApproved.filter(s=>new Date(s.created_at)>=startOfWeek).length;
  const lastWeekApproved = allApproved.filter(s=>new Date(s.created_at)>=startOfLastWeek&&new Date(s.created_at)<startOfWeek).length;
  const thisMonthApproved = allApproved.filter(s=>new Date(s.created_at)>=startOfMonth).length;
  const velocityChange = lastWeekApproved===0 ? (thisWeekApproved>0?100:0) : Math.round(((thisWeekApproved-lastWeekApproved)/lastWeekApproved)*100);
  const velocityColor = velocityChange>0?"var(--green)":velocityChange===0?"var(--ink3)":"var(--red)";
  const velocityIcon = velocityChange>0?"↑":velocityChange===0?"→":"↓";

  // Optimistic, but honest: the control moves at once, and moves BACK with a
  // reason if the write did not land (see updateRows). onRefresh afterwards is
  // what stops the `campaign` prop going stale — the old toggle skipped it, so
  // reopening this panel re-read the pre-toggle value and looked unsaved even
  // when it had saved.
  const toggleSalesSourced = async () => {
    const next = !isSalesSourced;
    setFinError(""); setIsSalesSourced(next);
    setEditForm(prev => ({ ...prev, is_sales_sourced: next }));
    // The rate is left alone: it is which sales team, not whether there is one.
    const err = await updateRows("campaigns", { is_sales_sourced: next }, { id: campaign.id });
    if (err) {
      setIsSalesSourced(!next);
      setEditForm(prev => ({ ...prev, is_sales_sourced: !next }));
      setFinError(err);
      return;
    }
    await onRefresh();
  };

  const updateSalesRate = async (rate) => {
    const next = Number(rate), prevRate = salesRate;
    setFinError(""); setSalesRate(next);
    setEditForm(prev => ({ ...prev, sales_commission_rate: next }));
    const err = await updateRows("campaigns", { sales_commission_rate: next }, { id: campaign.id });
    if (err) {
      setSalesRate(prevRate);
      setEditForm(prev => ({ ...prev, sales_commission_rate: prevRate }));
      setFinError(err);
      return;
    }
    await onRefresh();
  };

  // "" from the select means "inherit the manager's own rate" -> NULL.
  const updateManagerRate = async (rate) => {
    const next = rate === "" || rate == null ? null : Number(rate), prevRate = managerRate;
    setFinError(""); setManagerRate(next);
    setEditForm(prev => ({ ...prev, manager_commission_rate: next }));
    const err = await updateRows("campaigns", { manager_commission_rate: next }, { id: campaign.id });
    if (err) {
      setManagerRate(prevRate);
      setEditForm(prev => ({ ...prev, manager_commission_rate: prevRate }));
      setFinError(err);
      return;
    }
    await onRefresh();
  };

  const toggleShowClientCpm = async () => {
    const next = !showClientCpm;
    setFinError(""); setShowClientCpm(next);
    setEditForm(prev => ({ ...prev, show_client_cpm: next }));
    const err = await updateRows("campaigns", { show_client_cpm: next }, { id: campaign.id });
    if (err) {
      setShowClientCpm(!next);
      setEditForm(prev => ({ ...prev, show_client_cpm: !next }));
      setFinError(err);
      return;
    }
    await onRefresh();
  };

  // Approving is a status change and nothing else. The database mirrors
  // Approved rows into campaigns.assigned_creators by trigger; writing that
  // array from here as well is how it used to drift.
  const reviewApplication = async (creatorId, status) => {
    setSaving(true);
    setAssignError("");
    const err = await updateRows(
      "campaign_creators",
      { status, reviewed_by: user?.id || null, reviewed_at: new Date().toISOString() },
      { campaign_id: campaign.id, creator_id: creatorId }
    );
    if (err) {
      setAssignError(`Could not ${status === "Approved" ? "approve" : "decline"} that application: ${err}`);
      setSaving(false);
      return;
    }
    await onRefresh();
    setSaving(false);
  };
  const approveApplication = (creatorId) => reviewApplication(creatorId, "Approved");
  // Declined, not deleted: the creator sees the outcome, and cannot re-apply blind.
  const declineApplication = (creatorId) => reviewApplication(creatorId, "Declined");

  const uploadBrief = async (file) => {
    if (!file) return;
    setUploadingBrief(true);
    const path = `briefs/${campaign.id}/${file.name}`;
    await supabase.storage.from("submissions").upload(path, file, {upsert:true});
    const { data } = supabase.storage.from("submissions").getPublicUrl(path);
    await supabase.from("campaigns").update({brief_url:data.publicUrl}).eq("id",campaign.id);
    await onRefresh();
    setUploadingBrief(false);
  };

  const assignCreator = async (creatorId) => {
    setSaving(true);
    // F-10 -- see the note in JobBoard.apply. The junction table is the
    // source of truth; campaigns.assigned_creators mirrors it by trigger.
    const { error } = await supabase
      .from("campaign_creators")
      // Not ignoreDuplicates any more: a creator with an Applied or Declined row
      // already "exists", so DO NOTHING turned a staff assignment into a silent
      // no-op. Assigning them IS the approval, so the row is upgraded.
      .upsert({ campaign_id: campaign.id, creator_id: creatorId, assigned_by: user?.id || null,
                status: "Approved", reviewed_by: user?.id || null, reviewed_at: new Date().toISOString() },
              { onConflict: "campaign_id,creator_id" });

    if (error) {
      setAssignError("Could not assign that creator: " + describeWriteError(error));
      setSaving(false);
      return;
    }
    setAssignError("");

    await supabase.from("campaigns").update({ status: "In Progress" }).eq("id", campaign.id);
    await onRefresh(); setSaving(false);
  };

  const removeCreator = async (creatorId) => {
    setSaving(true);
    const { error } = await supabase
      .from("campaign_creators")
      .delete()
      .eq("campaign_id", campaign.id)
      .eq("creator_id", creatorId);

    if (error) {
      setAssignError("Could not remove that creator: " + error.message);
      setSaving(false);
      return;
    }
    setAssignError("");
    await onRefresh(); setSaving(false);
  };

  const saveEdit = async () => {
    setSaving(true);
    setFinError("");
    const patch = {
      name: editForm.name,
      description: editForm.description,
      format: editForm.format,
      status: editForm.status,
      videos_needed: Number(editForm.videos_needed),
      pay_per_video: Number(editForm.pay_per_video),
      deadline: editForm.deadline || null,
      is_sales_sourced: Boolean(editForm.is_sales_sourced),
      show_client_cpm: Boolean(editForm.show_client_cpm),
    };
    // Commission rates are the owner's to set; the database refuses anyone
    // else (campaigns_guard_commission_rates), so do not send them at all.
    // The rate is never zeroed for a non-sales campaign: 0 is not one of the
    // allowed rates, and is_sales_sourced already says whether it applies.
    if (isOwner) {
      patch.sales_commission_rate = Number(editForm.sales_commission_rate || 0.30);
      patch.manager_commission_rate = editForm.manager_commission_rate == null || editForm.manager_commission_rate === ""
        ? null : Number(editForm.manager_commission_rate);
    }
    const err = await updateRows("campaigns", patch, { id: campaign.id });
    if (err) { setFinError(err); setSaving(false); return; }
    await onRefresh(); setEditing(false); setSaving(false);
  };

  // Scope §7.1 step 13: "Campaign closes or archives while preserving history,
  // financial links and audit records." This used to be a hard DELETE, which
  // took the submissions, earnings and audit references with it. The database
  // now refuses that outright (trg_campaigns_no_delete), so this is the only
  // path — and it is reversible.
  const archiveCampaign = async () => {
    if (!archiveReason.trim()) {
      setArchiveError("Give a reason — it is what the audit entry will say.");
      return;
    }
    setDeleting(true);
    setArchiveError("");

    const { data, error } = await supabase
      .from("campaigns")
      .update({
        status: "Archived",
        archived_at: new Date().toISOString(),
        archived_by: user?.id || null,
        archive_reason: archiveReason.trim(),
      })
      .eq("id", campaign.id)
      .select("id");

    if (error) {
      setArchiveError(`Could not archive: ${error.message}`);
      setDeleting(false);
      return;
    }
    // PostgREST reports success for an UPDATE that matched zero rows, which is
    // exactly what an RLS refusal looks like. .select() is what makes the
    // difference visible.
    if (!data || data.length === 0) {
      setArchiveError("That campaign was not archived — you may not have permission.");
      setDeleting(false);
      return;
    }

    await onRefresh(); onClose();
  };

  const restoreCampaign = async () => {
    setDeleting(true);
    setArchiveError("");
    const { data, error } = await supabase
      .from("campaigns")
      .update({ status: "Open", archived_at: null, archived_by: null, archive_reason: null })
      .eq("id", campaign.id)
      .select("id");

    if (error || !data || data.length === 0) {
      setArchiveError(error ? `Could not restore: ${error.message}` : "That campaign was not restored — you may not have permission.");
      setDeleting(false);
      return;
    }
    await onRefresh(); onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{maxWidth:640,maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>

        {assignError && <ErrorMsg msg={assignError} />}

        {/* Header */}
        <div className="flex-between mb-16">
          <div>
            <div className="modal-title" style={{marginBottom:2}}>{campaign.name}</div>
            <div style={{fontSize:12,color:"var(--ink3)"}}>{client?.name||"—"} · {campaign.format} · Due {fmtDate(campaign.deadline)}</div>
            {client&&db.accountManagers.find(a=>a.id===client.am_id)&&<div style={{fontSize:12,color:"var(--ink3)",marginTop:2}}>AM: {db.accountManagers.find(a=>a.id===client.am_id)?.name}</div>}
            {/* AM campaign context bar */}
            {!isOwner&&client&&(
              <div style={{display:"flex",gap:16,marginTop:8,padding:"6px 10px",background:"var(--bg2)",borderRadius:"var(--radius-sm)",flexWrap:"wrap"}}>
                <span style={{fontSize:12}}><span style={{color:"var(--ink3)"}}>Client: </span><span style={{fontWeight:600}}>{client.name}</span></span>
                <span style={{fontSize:12}}><span style={{color:"var(--ink3)"}}>Value: </span><span style={{fontWeight:600,color:"var(--green)"}}>{fmtMoney(client.budget)}</span></span>
                <span style={{fontSize:12}}><span style={{color:"var(--ink3)"}}>Target: </span><span style={{fontWeight:600}}>{campaign.videos_needed} videos</span></span>
                <span style={{fontSize:12}}><span style={{color:"var(--ink3)"}}>Approved: </span><span style={{fontWeight:600,color:"var(--green)"}}>{approved}</span></span>
              </div>
            )}
          </div>
          <div style={{display:"flex",gap:8}}>
            {onShare&&!editing&&<button className="btn btn-sm btn-ghost" style={{color:"var(--blue)",fontWeight:600}} onClick={()=>onShare(campaign)}>🔗 Share Analytics</button>}
            {!editing&&<button className="btn btn-sm btn-primary" onClick={()=>setEditing(true)}>✏️ Edit</button>}
            {!editing&&!isArchived&&<button className="btn btn-sm btn-ghost" style={{color:"var(--orange)"}} onClick={()=>{setConfirmDelete(true);setArchiveReason("");setArchiveError("");}}>🗄 Archive</button>}
            {!editing&&isArchived&&<button className="btn btn-sm btn-ghost" style={{color:"var(--green)"}} onClick={restoreCampaign} disabled={deleting}>{deleting?"Restoring…":"↩ Restore"}</button>}
            <button className="btn btn-sm btn-ghost" onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Archived banner — the campaign is still fully readable, which is the
            point of archiving rather than deleting. */}
        {isArchived&&(
          <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:12,marginBottom:16}}>
            <div style={{fontSize:13,fontWeight:600,marginBottom:4}}>🗄 Archived</div>
            <div style={{fontSize:12,color:"var(--ink3)"}}>
              {campaign.archive_reason ? `Reason: ${campaign.archive_reason}` : "No reason recorded."}
              {campaign.archived_at ? ` · ${fmtDate(campaign.archived_at)}` : ""}
            </div>
            <div style={{fontSize:12,color:"var(--ink3)",marginTop:6}}>
              Submissions, earnings and audit history are preserved. Restore returns it to Open.
            </div>
          </div>
        )}

        {/* Confirm Archive */}
        {confirmDelete&&(
          <div style={{background:"var(--bg2)",border:"1px solid var(--orange)",borderRadius:"var(--radius-sm)",padding:12,marginBottom:16}}>
            <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>Archive this campaign?</div>
            <div style={{fontSize:12,color:"var(--ink3)",marginBottom:12}}>
              It stops appearing in active lists. Submissions, earnings and audit
              records are kept, and you can restore it at any time.
            </div>
            {archiveError&&<ErrorMsg msg={archiveError} />}
            <div className="form-group">
              <label className="form-label">Reason <span style={{color:"var(--red)"}}>*</span></label>
              <input
                className="form-input"
                placeholder="e.g. Client ended the retainer"
                value={archiveReason}
                onChange={e=>setArchiveReason(e.target.value)}
              />
            </div>
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-sm btn-ghost" onClick={()=>setConfirmDelete(false)}>Cancel</button>
              <button className="btn btn-sm" style={{background:"var(--orange)",color:"#fff"}} onClick={archiveCampaign} disabled={deleting||!archiveReason.trim()}>{deleting?"Archiving…":"Archive Campaign"}</button>
            </div>
          </div>
        )}

        {/* Edit Form */}
        {editing ? (
          <div>
            <div className="form-group"><label className="form-label">Campaign Name</label><input className="form-input" value={editForm.name} onChange={e=>setEditForm({...editForm,name:e.target.value})}/></div>
            <div className="form-group"><label className="form-label">Description / Guidelines</label><textarea className="textarea" rows={4} value={editForm.description} onChange={e=>setEditForm({...editForm,description:e.target.value})}/></div>
            <div className="grid-2">
              <div className="form-group"><label className="form-label">Format</label><select className="select" value={editForm.format} onChange={e=>setEditForm({...editForm,format:e.target.value})}>{["TikTok","IG Reel","FB Reel","YouTube Short"].map(f=><option key={f}>{f}</option>)}</select></div>
              <div className="form-group"><label className="form-label">Status</label><select className="select" value={editForm.status} onChange={e=>setEditForm({...editForm,status:e.target.value})}>{["Open","In Progress","Completed","Paused"].map(s=><option key={s}>{s}</option>)}</select></div>
              <div className="form-group"><label className="form-label">Videos Needed</label><input className="form-input" type="number" value={editForm.videos_needed} onChange={e=>setEditForm({...editForm,videos_needed:e.target.value})}/></div>
              <div className="form-group"><label className="form-label">Pay Per Video ($)</label><input className="form-input" type="number" value={editForm.pay_per_video} onChange={e=>setEditForm({...editForm,pay_per_video:e.target.value})}/></div>
              <div className="form-group"><label className="form-label">Deadline</label><input className="form-input" type="date" value={editForm.deadline} onChange={e=>setEditForm({...editForm,deadline:e.target.value})}/></div>
            </div>
            {/* Financial and Commission Controls */}
            <div style={{background:"var(--bg2)",borderRadius:"var(--radius-sm)",padding:"12px 14px",marginBottom:16}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:editForm.is_sales_sourced?12:0}}>
                <input type="checkbox" id="editSalesToggle" checked={editForm.is_sales_sourced} onChange={e=>setEditForm({...editForm,is_sales_sourced:e.target.checked})} style={{width:16,height:16,cursor:"pointer"}}/>
                <label htmlFor="editSalesToggle" style={{fontSize:13,cursor:"pointer",fontWeight:600,userSelect:"none"}}>Sales Sourced Campaign</label>
              </div>
              {isOwner&&editForm.is_sales_sourced&&(
                <div className="form-group" style={{marginBottom:10}}>
                  <label className="form-label" style={{fontSize:10}}>Sales Commission Rate</label>
                  <select className="select" value={editForm.sales_commission_rate} onChange={e=>setEditForm({...editForm,sales_commission_rate:Number(e.target.value)})}>
                    <option value={0.10}>10% Commission</option>
                    <option value={0.20}>20% Commission</option>
                    <option value={0.30}>30% Commission</option>
                  </select>
                </div>
              )}
              {isOwner&&(
                <div className="form-group" style={{marginBottom:10,marginTop:10}}>
                  <label className="form-label" style={{fontSize:10}}>Manager Commission Rate</label>
                  <select className="select" value={editForm.manager_commission_rate ?? ""} onChange={e=>setEditForm({...editForm,manager_commission_rate:e.target.value===""?null:Number(e.target.value)})}>
                    <option value="">Manager's default ({Math.round(amDefaultRate*100)}%)</option>
                    <option value={0.10}>10% for this campaign</option>
                    <option value={0.15}>15% for this campaign</option>
                    <option value={0.20}>20% for this campaign</option>
                  </select>
                </div>
              )}
              <div style={{display:"flex",alignItems:"center",gap:10,marginTop:8}}>
                <input type="checkbox" id="editCpmToggle" checked={editForm.show_client_cpm} onChange={e=>setEditForm({...editForm,show_client_cpm:e.target.checked})} style={{width:16,height:16,cursor:"pointer"}}/>
                <label htmlFor="editCpmToggle" style={{fontSize:12,cursor:"pointer",userSelect:"none",color:"var(--ink2)"}}>Display CPM metric to client in brand portal</label>
              </div>
            </div>
            {finError&&<div style={{color:"var(--red)",fontSize:13,marginBottom:12}} role="alert">{finError}</div>}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={()=>{setFinError("");setEditing(false);}}>Cancel</button>
              <button className="btn btn-primary" onClick={saveEdit} disabled={saving}>{saving?"Saving...":"Save Changes"}</button>
            </div>
          </div>
        ) : (
          <div>
            {/* AM Account Summary Bar — visible to AMs only */}
            {!isOwner&&client&&<AMClientSummaryBar client={client} db={db}/>}

            {/* At Risk Flags */}
            {(staleSubs.length>0||margin<60||costPerVideo>60)&&(
              <div style={{marginBottom:16,display:"flex",flexDirection:"column",gap:6}}>
                {staleSubs.length>0&&<div style={{background:"#fff0f0",border:"1px solid var(--red)",borderRadius:"var(--radius-sm)",padding:"8px 12px",fontSize:12,color:"var(--red)"}}>🚨 {staleSubs.length} submission{staleSubs.length!==1?"s":""} pending review for 3+ days</div>}
                {margin<60&&revenue>0&&<div style={{background:"#fffbe6",border:"1px solid #ffe066",borderRadius:"var(--radius-sm)",padding:"8px 12px",fontSize:12,color:"#b08800"}}>⚠️ Margin is {margin}% — below 60% target</div>}
                {costPerVideo>60&&<div style={{background:"#fff0f0",border:"1px solid var(--red)",borderRadius:"var(--radius-sm)",padding:"8px 12px",fontSize:12,color:"var(--red)"}}>🚨 Cost per video ${costPerVideo} exceeds $60 threshold</div>}
              </div>
            )}

            {/* Sales Sourced & Financial Setup */}
            <div style={{marginBottom:16,padding:"12px 14px",background:"var(--bg2)",borderRadius:"var(--radius-sm)",display:"flex",flexDirection:"column",gap:10}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <input type="checkbox" id="salesToggle" checked={isSalesSourced} onChange={toggleSalesSourced} style={{width:16,height:16,cursor:"pointer"}}/>
                  <label htmlFor="salesToggle" style={{fontSize:13,cursor:"pointer",userSelect:"none",fontWeight:600}}>
                    Sales sourced campaign
                  </label>
                </div>
                {isSalesSourced && (
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:12,color:"var(--ink3)"}}>Sales commission:</span>
                    {isOwner ? (
                      <select
                        className="select"
                        style={{padding:"4px 28px 4px 10px",height:30,fontSize:12,width:"auto"}}
                        value={salesRate}
                        onChange={e=>updateSalesRate(e.target.value)}
                        aria-label="Sales commission rate"
                      >
                        <option value={0.10}>10%</option>
                        <option value={0.20}>20%</option>
                        <option value={0.30}>30%</option>
                      </select>
                    ) : <strong style={{fontSize:12}}>{Math.round(activeSalesRate*100)}%</strong>}
                  </div>
                )}
              </div>

              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",borderTop:"1px solid var(--border2)",paddingTop:8,flexWrap:"wrap",gap:10}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:12,color:"var(--ink3)"}}>Manager commission:</span>
                  {isOwner ? (
                    <select
                      className="select"
                      style={{padding:"4px 28px 4px 10px",height:30,fontSize:12,width:"auto"}}
                      value={managerRate ?? ""}
                      onChange={e=>updateManagerRate(e.target.value)}
                      aria-label="Manager commission rate"
                    >
                      <option value="">Manager's default ({Math.round(amDefaultRate*100)}%)</option>
                      <option value={0.10}>10% for this campaign</option>
                      <option value={0.15}>15% for this campaign</option>
                      <option value={0.20}>20% for this campaign</option>
                    </select>
                  ) : <strong style={{fontSize:12}}>{Math.round(activeMgrRate*100)}%</strong>}
                </div>

                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <input
                    type="checkbox"
                    id="cpmClientToggle"
                    checked={showClientCpm}
                    onChange={toggleShowClientCpm}
                    style={{width:15,height:15,cursor:"pointer"}}
                  />
                  <label htmlFor="cpmClientToggle" style={{fontSize:12,cursor:"pointer",color:"var(--ink2)"}}>
                    Let the client see CPM
                  </label>
                </div>
              </div>
              {finError&&<div style={{fontSize:12,color:"var(--red)"}} role="alert">{finError}</div>}
            </div>

            {/* Profitability Stats */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(130px, 1fr))",gap:10,marginBottom:20}}>
              <div className="stat-card"><div className="stat-label">Revenue</div><div className="stat-value" style={{fontSize:16,color:"var(--green)"}}>{fmtMoney(revenue)}</div></div>
              <div className="stat-card"><div className="stat-label">Creator Cost</div><div className="stat-value" style={{fontSize:16,color:"var(--red)"}}>{fmtMoney(creatorCost)}</div><div style={{fontSize:10,color:"var(--ink3)"}}>{approved} approved × {fmtMoney(campaign.pay_per_video)}</div></div>
              <div className="stat-card"><div className="stat-label">Manager Comm.</div><div className="stat-value" style={{fontSize:16,color:"var(--orange)"}}>{fmtMoney(managerCost)}</div><div style={{fontSize:10,color:"var(--ink3)"}}>{Math.round(activeMgrRate*100)}% of budget{managerRate==null?"":" · campaign override"}</div></div>
              {isSalesSourced&&<div className="stat-card"><div className="stat-label">Sales Comm.</div><div className="stat-value" style={{fontSize:16,color:"var(--orange)"}}>{fmtMoney(salesCost)}</div><div style={{fontSize:10,color:"var(--ink3)"}}>{Math.round(activeSalesRate*100)}% of budget</div></div>}
              <div className="stat-card"><div className="stat-label">Gross Profit</div><div className="stat-value" style={{fontSize:16,color:grossProfit>=0?"var(--green)":"var(--red)"}}>{fmtMoney(grossProfit)}</div></div>
              <div className="stat-card"><div className="stat-label">Margin</div><div className="stat-value" style={{fontSize:16,color:marginColor}}>{margin}%</div><div style={{width:"100%",background:"var(--bg2)",borderRadius:4,height:4,marginTop:4}}><div style={{width:`${Math.min(Math.max(margin,0),100)}%`,background:marginColor,height:4,borderRadius:4}}/></div></div>
              <div className="stat-card"><div className="stat-label">Cost/Video</div><div className="stat-value" style={{fontSize:16,color:cpvColor}}>{cpvFlag} {costPerVideo>0?fmtMoney(costPerVideo):"—"}</div></div>
              <div className="stat-card" title="Client budget ÷ verified views × 1,000"><div className="stat-label">CPM</div><div className="stat-value" style={{fontSize:16}}>{cpm==null?"—":`$${cpm.toFixed(2)}`}</div><div style={{fontSize:10,color:"var(--ink3)"}}>{campaignViews>0?`${campaignViews.toLocaleString()} views`:"no views synced yet"} · {showClientCpm?"client can see":"hidden from client"}</div></div>
              <div className="stat-card"><div className="stat-label">Progress</div><div className="stat-value" style={{fontSize:16}}>{approved}/{campaign.videos_needed}</div></div>
            </div>

            {/* Velocity Dashboard */}
            <div style={{marginBottom:20}}>
              <div style={{fontSize:13,fontWeight:600,marginBottom:10}}>⚡ Velocity</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
                <div className="stat-card">
                  <div className="stat-label">This Week</div>
                  <div className="stat-value" style={{fontSize:20}}>{thisWeekApproved}</div>
                  <div style={{fontSize:11,color:"var(--ink3)"}}>approved videos</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Last Week</div>
                  <div className="stat-value" style={{fontSize:20}}>{lastWeekApproved}</div>
                  <div style={{fontSize:11,color:"var(--ink3)"}}>approved videos</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Week Change</div>
                  <div className="stat-value" style={{fontSize:20,color:velocityColor}}>{velocityIcon} {Math.abs(velocityChange)}%</div>
                  <div style={{fontSize:11,color:"var(--ink3)"}}>vs last week</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">This Month</div>
                  <div style={{display:"flex",alignItems:"baseline",gap:4}}>
                    <div className="stat-value" style={{fontSize:20}}>{thisMonthApproved}</div>
                    <div style={{fontSize:12,color:"var(--ink3)"}}>/ {campaign.videos_needed}</div>
                  </div>
                  <div style={{width:"100%",background:"var(--bg2)",borderRadius:4,height:4,marginTop:4}}>
                    <div style={{width:`${Math.min(Math.round((thisMonthApproved/(campaign.videos_needed||1))*100),100)}%`,background:"var(--green)",height:4,borderRadius:4}}/>
                  </div>
                </div>
              </div>
            </div>

            {/* Brief Doc */}
            <div style={{marginBottom:16,padding:"10px 14px",background:"var(--bg2)",borderRadius:"var(--radius-sm)"}}>
              <div style={{fontSize:12,fontWeight:600,marginBottom:8}}>📄 Creator Brief</div>
              {campaign.brief_url ? (
                <div className="flex-between">
                  <a href={campaign.brief_url} target="_blank" rel="noreferrer" className="btn btn-sm btn-primary">📥 View Brief</a>
                  <label style={{cursor:"pointer",fontSize:12,color:"var(--ink3)"}}>
                    Replace
                    <input type="file" accept=".pdf,.doc,.docx" style={{display:"none"}} onChange={e=>uploadBrief(e.target.files[0])}/>
                  </label>
                </div>
              ) : (
                <label style={{cursor:"pointer"}}>
                  <div style={{border:"2px dashed var(--border2)",borderRadius:"var(--radius-sm)",padding:"12px",textAlign:"center",fontSize:12,color:"var(--ink3)"}}>
                    {uploadingBrief?"Uploading...":"+ Upload brief doc (PDF, Word)"}
                  </div>
                  <input type="file" accept=".pdf,.doc,.docx" style={{display:"none"}} onChange={e=>uploadBrief(e.target.files[0])}/>
                </label>
              )}
            </div>

            {/* Description */}
            {campaign.description&&<div style={{background:"var(--bg2)",borderRadius:"var(--radius-sm)",padding:12,marginBottom:20,fontSize:13,color:"var(--ink2)"}}><div style={{fontSize:11,textTransform:"uppercase",letterSpacing:"0.5px",color:"var(--ink3)",marginBottom:6}}>Guidelines</div>{campaign.description}</div>}

            {/* Pending Applications (P2) */}
            {pendingApplications.length > 0 && (
              <div style={{marginBottom:24,padding:16,background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:"var(--radius-sm)"}}>
                <div style={{fontSize:14,fontWeight:700,color:"#166534",marginBottom:12}}>
                  📬 Pending Creator Applications ({pendingApplications.length})
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {pendingApplications.map(app => {
                    const creator = db.creators.find(c => c.id === app.creator_id);
                    return (
                      <div key={app.id || app.creator_id} className="flex-between" style={{padding:"10px 12px",background:"#fff",borderRadius:8,border:"1px solid #dcfce7"}}>
                        <div>
                          <div style={{fontWeight:600,fontSize:13}}>{creator?.name || "Creator"}</div>
                          <div style={{fontSize:11,color:"var(--ink3)",marginTop:2}}>
                            {creator?.platform || "—"} · Committed: <strong>{app.commitment || 1} video(s)</strong>
                            {app.demo_video_url && (
                              <span style={{marginLeft:8}}>
                                · <a href={app.demo_video_url} target="_blank" rel="noreferrer" style={{color:"var(--blue)",fontWeight:600}}>🎬 Demo Video</a>
                              </span>
                            )}
                          </div>
                        </div>
                        <div style={{display:"flex",gap:6}}>
                          <button className="btn btn-sm btn-green" onClick={()=>approveApplication(app.creator_id)} disabled={saving}>
                            ✓ Approve
                          </button>
                          <button className="btn btn-sm btn-ghost" style={{color:"var(--red)"}} onClick={()=>declineApplication(app.creator_id)} disabled={saving}>
                            ✕ Decline
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Assigned Creators */}
            <div style={{marginBottom:20}}>
              <div style={{fontSize:13,fontWeight:600,marginBottom:10}}>Assigned Creators ({assignedCreators.length})</div>
              {assignedCreators.length===0&&<div style={{fontSize:13,color:"var(--ink3)",fontStyle:"italic"}}>No creators assigned yet</div>}
              {assignedCreators.map(c=>(
                <div key={c.id} className="flex-between" style={{padding:"8px 0",borderBottom:"1px solid var(--border)"}}>
                  <div><div style={{fontWeight:600,fontSize:13}}>{c.name}</div><div style={{fontSize:11,color:"var(--ink3)"}}>{c.platform||"—"} · {c.niche||"—"}</div></div>
                  <button className="btn btn-sm btn-ghost" style={{color:"var(--red)"}} onClick={()=>removeCreator(c.id)} disabled={saving}>Remove</button>
                </div>
              ))}
            </div>

            {/* Available Creators */}
            <div>
              <div style={{fontSize:13,fontWeight:600,marginBottom:10}}>Add Creators ({availableCreators.length} available)</div>
              {availableCreators.length===0&&<div style={{fontSize:13,color:"var(--ink3)",fontStyle:"italic"}}>All active creators are already assigned</div>}
              {availableCreators.map(c=>(
                <div key={c.id} className="flex-between" style={{padding:"8px 0",borderBottom:"1px solid var(--border)"}}>
                  <div><div style={{fontWeight:600,fontSize:13}}>{c.name}</div><div style={{fontSize:11,color:"var(--ink3)"}}>{c.platform||"—"} · {c.niche||"—"}</div></div>
                  <button className="btn btn-sm btn-primary" onClick={()=>assignCreator(c.id)} disabled={saving}>+ Assign</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Forum */}
        {!editing&&<CampaignForum campaign={campaign} user={db._currentUser} db={db} canPin={isOwner||db.accountManagers.some(a=>a.user_id===db._currentUser?.id||a.email===db._currentUser?.email)}/>}
      </div>
    </div>
  );
}
