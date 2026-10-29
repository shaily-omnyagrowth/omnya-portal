import { useMemo, useState } from "react";
import CampaignCalendarView from "../../components/CampaignCalendarView";
import CampaignProgressCard from "../../components/CampaignProgressCard";
import CampaignShareModal from "../../components/CampaignShareModal";
import { describeWriteError } from "../../lib/db";
import { supabase } from "../../supabaseClient";
import { calcPacing, fmtDate, statusBadge } from "../../utils";
import CampaignDetail from "./CampaignDetail";

export default function CampaignsPage({ user, db, onRefresh, isOwner }) {
  const am = db.accountManagers.find(a=>a.user_id===user.id||a.email===user.email);
  const campaigns = isOwner?db.campaigns:db.campaigns.filter(c=>{
    const client=db.clients.find(cl=>cl.id===c.client_id);
    return client?.am_id===am?.id;
  });
  const [showCreate, setShowCreate] = useState(false);
  const [viewCampaign, setViewCampaign] = useState(null);
  const [shareModalCampaign, setShareModalCampaign] = useState(null);
  const [viewMode, setViewMode] = useState("cards"); // "cards" | "table" | "calendar"
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [form, setForm] = useState({
    name: "", client_id: "", description: "", format: "TikTok",
    videos_needed: 10, pay_per_video: 10, deadline: "", status: "Open",
    application_type: "Open Application",
    is_sales_sourced: false,
    sales_commission_rate: 0.30,
    manager_commission_rate: null, // null = the account manager's own rate
    show_client_cpm: false,
  });

  const create = async () => {
    if (!form.name||!form.client_id) { setErr("Name and client are required"); return; }
    setSaving(true); setErr("");
    const { error } = await supabase.from("campaigns").insert({
      ...form,
      videos_needed: Number(form.videos_needed),
      pay_per_video: Number(form.pay_per_video),
      // Never 0: the column only accepts 10/20/30%, and is_sales_sourced is
      // what decides whether it is charged. A manager's values are replaced
      // with the defaults by the database regardless (owner-only rates).
      sales_commission_rate: Number(form.sales_commission_rate || 0.30),
      manager_commission_rate: form.manager_commission_rate == null || form.manager_commission_rate === ""
        ? null : Number(form.manager_commission_rate),
      show_client_cpm: Boolean(form.show_client_cpm),
      deadline: form.deadline || null,
      assigned_creators: []
    });
    if (error) { setErr(describeWriteError(error)); setSaving(false); return; }
    await onRefresh();
    setShowCreate(false); setSaving(false);
    setForm({
      name: "", client_id: "", description: "", format: "TikTok",
      videos_needed: 10, pay_per_video: 10, deadline: "", status: "Open",
      application_type: "Open Application",
      is_sales_sourced: false,
      sales_commission_rate: 0.30,
      manager_commission_rate: null,
      show_client_cpm: false,
    });
  };

  const filteredCampaigns = useMemo(() => {
    return campaigns.filter(c => {
      if (search.trim()) {
        const q = search.toLowerCase();
        const client = db.clients.find(cl => cl.id === c.client_id);
        const matchName = (c.name || "").toLowerCase().includes(q);
        const matchClient = (client?.name || "").toLowerCase().includes(q);
        if (!matchName && !matchClient) return false;
      }
      if (statusFilter === "active" && (c.status === "Archived" || c.status === "Completed")) return false;
      if (statusFilter === "completed" && c.status !== "Completed") return false;
      if (statusFilter === "archived" && c.status !== "Archived") return false;
      return true;
    });
  }, [campaigns, search, statusFilter, db.clients]);

  return (
    <div className="content">
      {/* Header & Controls Bar */}
      <div className="flex-between mb-16" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {/* View Switcher */}
          <div style={{
            display: 'flex',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 2
          }}>
            <button
              className={`btn btn-sm ${viewMode === 'cards' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ padding: '4px 10px', fontSize: 12, borderRadius: 4 }}
              onClick={() => setViewMode('cards')}
            >
              🗂 Cards
            </button>
            <button
              className={`btn btn-sm ${viewMode === 'table' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ padding: '4px 10px', fontSize: 12, borderRadius: 4 }}
              onClick={() => setViewMode('table')}
            >
              📋 Table
            </button>
            <button
              className={`btn btn-sm ${viewMode === 'calendar' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ padding: '4px 10px', fontSize: 12, borderRadius: 4 }}
              onClick={() => setViewMode('calendar')}
            >
              📅 Calendar
            </button>
          </div>

          {/* Quick Filters */}
          <div style={{ display: 'flex', gap: 4 }}>
            {[
              ['all', `All (${campaigns.length})`],
              ['active', 'Active Flights'],
              ['completed', 'Completed'],
              ['archived', 'Archived']
            ].map(([st, label]) => (
              <button
                key={st}
                className={`btn btn-sm ${statusFilter === st ? 'btn-secondary' : 'btn-ghost'}`}
                style={{ padding: '4px 8px', fontSize: 11 }}
                onClick={() => setStatusFilter(st)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            className="form-input"
            placeholder="Search campaigns..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: 170, height: 32, fontSize: 12 }}
          />
          <button className="btn btn-primary btn-sm" onClick={()=>setShowCreate(true)}>+ New Campaign</button>
        </div>
      </div>

      {campaigns.length===0&&<div className="empty" style={{padding:48}}><div className="empty-icon text-muted" style={{fontSize:40,marginBottom:16}}>📢</div><h3 style={{fontSize:18,marginBottom:8}}>No campaigns yet</h3><p style={{color:"var(--ink3)",marginBottom:24}}>Create your first campaign to get creatives rolling.</p>{isOwner&&<button className="btn btn-primary" onClick={()=>setShowCreate(true)}>+ Create Campaign</button>}</div>}

      {/* Cards View */}
      {viewMode === 'cards' && campaigns.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 16
        }}>
          {filteredCampaigns.length === 0 ? (
            <div className="premium-card text-center" style={{ gridColumn: '1 / -1', padding: 40, color: 'var(--ink3)' }}>
              No campaigns match your search or filter.
            </div>
          ) : (
            filteredCampaigns.map(c => {
              const client = db.clients.find(cl => cl.id === c.client_id);
              const amRow = db.accountManagers.find(a => a.id === client?.am_id);
              const approved = db.submissions.filter(s => s.campaign_id === c.id && s.status === 'Approved').length;
              const creatorsCount = (c.assigned_creators || []).length;

              return (
                <CampaignProgressCard
                  key={c.id}
                  campaign={c}
                  client={client}
                  accountManager={amRow}
                  approvedCount={approved}
                  assignedCreatorsCount={creatorsCount}
                  onClick={() => setViewCampaign(c)}
                  onShareClick={() => setShareModalCampaign(c)}
                  isOwner={isOwner}
                  showCpmBadge
                />
              );
            })
          )}
        </div>
      )}

      {/* Table View */}
      {viewMode === 'table' && campaigns.length > 0 && (
        <div className="premium-card">
          <div className="table-wrap">
            <table className="premium-table">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Client</th>
                  <th>AM</th>
                  <th>Format</th>
                  <th>Flight / Week</th>
                  <th>Progress</th>
                  <th>Deadline</th>
                  <th>Status</th>
                  <th style={{textAlign:"right"}}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredCampaigns.length === 0 ? (
                  <tr>
                    <td colSpan="9" style={{ textAlign: 'center', padding: 32, color: 'var(--ink3)' }}>
                      No campaigns found matching filter.
                    </td>
                  </tr>
                ) : (
                  filteredCampaigns.map(c=>{
                    const client=db.clients.find(cl=>cl.id===c.client_id);
                    const approved=db.submissions.filter(s=>s.campaign_id===c.id&&s.status==="Approved").length;
                    const pacing = calcPacing({
                      startDate: c.start_date || c.created_at,
                      deadline: c.deadline,
                      videosNeeded: c.videos_needed || 10,
                      approvedCount: approved
                    });

                    return (
                      <tr key={c.id} style={{cursor:"pointer"}} onClick={()=>setViewCampaign(c)}>
                        <td>
                          <div className="fw-600" style={{color:"var(--blue)"}}>{c.name}</div>
                          <div style={{fontSize:11,color:"var(--ink3)"}}>{(c.assigned_creators||[]).length} creators</div>
                        </td>
                        <td className="text-muted">{client?.name||"—"}</td>
                        <td style={{fontSize:12,color:"var(--ink3)"}}>{db.accountManagers.find(a=>a.id===client?.am_id)?.name||"—"}</td>
                        <td><span className="badge badge-blue">{c.format}</span></td>
                        <td>
                          <div style={{ fontSize: 11, fontWeight: 600 }}>Week {pacing.currentWeek} of {pacing.totalWeeks}</div>
                          <div style={{ fontSize: 10, color: 'var(--ink3)' }}>{pacing.paceLabel}</div>
                        </td>
                        <td>
                          <div style={{fontSize:11,color:"var(--ink3)",marginBottom:4}}>{approved}/{c.videos_needed} videos ({pacing.deliveryPct}%)</div>
                          <div className="progress-bar" style={{width:80}}><div className="progress-fill" style={{width:`${Math.min(pacing.deliveryPct,100)}%`}}/></div>
                        </td>
                        <td>
                          <div style={{ fontSize: 12 }}>{fmtDate(c.deadline)}</div>
                          <div style={{ fontSize: 10, color: pacing.daysRemaining !== null && pacing.daysRemaining <= 3 ? 'var(--red)' : 'var(--ink3)' }}>
                            {pacing.daysRemaining !== null ? (pacing.daysRemaining > 0 ? `${pacing.daysRemaining}d left` : 'Expired') : '—'}
                          </div>
                        </td>
                        <td>{statusBadge(c.status)}</td>
                        <td style={{textAlign:"right"}}>
                          <div style={{display:"flex",gap:4,justifyContent:"flex-end"}} onClick={e => e.stopPropagation()}>
                            <button className="btn btn-sm btn-ghost" title="Share Analytics" onClick={()=>setShareModalCampaign(c)}>🔗</button>
                            <button className="btn btn-sm btn-ghost" onClick={()=>setViewCampaign(c)}>✏️</button>
                            {c.status!=="Archived"&&<button className="btn btn-sm btn-ghost" style={{color:"var(--orange)"}} onClick={()=>setViewCampaign(c)}>🗄</button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Calendar View */}
      {viewMode === 'calendar' && campaigns.length > 0 && (
        <CampaignCalendarView
          campaigns={filteredCampaigns}
          db={db}
          onSelectCampaign={setViewCampaign}
        />
      )}

      {/* Share Modal */}
      {shareModalCampaign && (
        <CampaignShareModal
          campaign={shareModalCampaign}
          onClose={() => setShareModalCampaign(null)}
          onUpdated={async () => {
            await onRefresh();
          }}
        />
      )}

      {viewCampaign&&<CampaignDetail campaign={viewCampaign} db={db} user={user} onRefresh={async()=>{await onRefresh();setViewCampaign(db.campaigns.find(c=>c.id===viewCampaign.id)||null);}} onClose={()=>setViewCampaign(null)} onShare={setShareModalCampaign}/>}
      {showCreate&&(
        <div className="modal-overlay" onClick={()=>setShowCreate(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-title">New Campaign</div>
            <div className="modal-sub">Create a content campaign for a client</div>
            <div className="form-group"><label className="form-label">Campaign Name</label><input className="form-input" placeholder="e.g. Spring Launch 2026" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></div>
            <div className="form-group"><label className="form-label">Client</label><select className="select" value={form.client_id} onChange={e=>setForm({...form,client_id:e.target.value})}><option value="">Select client...</option>{db.clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div className="form-group"><label className="form-label">Description / Guidelines</label><textarea className="textarea" placeholder="Content guidelines, talking points, CTAs..." value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></div>
            <div className="grid-2">
              <div className="form-group"><label className="form-label">Format</label><select className="select" value={form.format} onChange={e=>setForm({...form,format:e.target.value})}>{["TikTok","IG Reel","FB Reel","YouTube Short"].map(f=><option key={f}>{f}</option>)}</select></div>
              <div className="form-group"><label className="form-label">Deadline</label><input className="form-input" type="date" value={form.deadline} onChange={e=>setForm({...form,deadline:e.target.value})}/></div>
              <div className="form-group"><label className="form-label">Videos Needed</label><input className="form-input" type="number" value={form.videos_needed} onChange={e=>setForm({...form,videos_needed:e.target.value})}/></div>
              <div className="form-group"><label className="form-label">Pay Per Video ($)</label><input className="form-input" type="number" value={form.pay_per_video} onChange={e=>setForm({...form,pay_per_video:e.target.value})}/></div>
            </div>
            {/* Financial and Commission Controls */}
            <div style={{background:"var(--bg2)",borderRadius:"var(--radius-sm)",padding:"12px 14px",marginBottom:16}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:form.is_sales_sourced?12:0}}>
                <input type="checkbox" id="createSalesToggle" checked={form.is_sales_sourced} onChange={e=>setForm({...form,is_sales_sourced:e.target.checked})} style={{width:16,height:16,cursor:"pointer"}}/>
                <label htmlFor="createSalesToggle" style={{fontSize:13,cursor:"pointer",fontWeight:600,userSelect:"none"}}>Sales Sourced Campaign</label>
              </div>
              {isOwner&&form.is_sales_sourced&&(
                <div className="form-group" style={{marginBottom:10}}>
                  <label className="form-label" style={{fontSize:10}}>Sales Commission Rate</label>
                  <select className="select" value={form.sales_commission_rate} onChange={e=>setForm({...form,sales_commission_rate:Number(e.target.value)})}>
                    <option value={0.10}>10% Commission</option>
                    <option value={0.20}>20% Commission</option>
                    <option value={0.30}>30% Commission</option>
                  </select>
                </div>
              )}
              {isOwner&&(
                <div className="form-group" style={{marginBottom:10,marginTop:10}}>
                  <label className="form-label" style={{fontSize:10}}>Manager Commission Rate</label>
                  <select className="select" value={form.manager_commission_rate ?? ""} onChange={e=>setForm({...form,manager_commission_rate:e.target.value===""?null:Number(e.target.value)})}>
                    <option value="">Manager's default rate</option>
                    <option value={0.10}>10% for this campaign</option>
                    <option value={0.15}>15% for this campaign</option>
                    <option value={0.20}>20% for this campaign</option>
                  </select>
                </div>
              )}
              <div style={{display:"flex",alignItems:"center",gap:10,marginTop:8}}>
                <input type="checkbox" id="createCpmToggle" checked={form.show_client_cpm} onChange={e=>setForm({...form,show_client_cpm:e.target.checked})} style={{width:16,height:16,cursor:"pointer"}}/>
                <label htmlFor="createCpmToggle" style={{fontSize:12,cursor:"pointer",userSelect:"none",color:"var(--ink2)"}}>Display CPM metric to client in brand portal</label>
              </div>
            </div>
            {err&&<div style={{color:"var(--red)",fontSize:13,marginBottom:12}}>{err}</div>}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={()=>setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={create} disabled={saving}>{saving?"Creating...":"Create Campaign"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
