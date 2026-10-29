import { useEffect, useState } from "react";
import UGCDashboardView from "../../components/UGCDashboardView";
import { sendEmail } from "../../lib/api";
import { supabase } from "../../supabaseClient";
import { fmtMoney, getAvatarColor, getInitials, statusBadge } from "../../utils";

export default function OwnerDashboard({ db, onRefresh, setPage }) {
  const [pendingUsers, setPendingUsers] = useState([]);
  const [approvingSaving, setApprovingSaving] = useState(false);

  useEffect(()=>{
    supabase.from("user_profiles").select("*").eq("role","pending").then(({data, error})=>{
      if (error) {
        console.error("Failed to load pending users:", error);
        return;
      }
      if(data) setPendingUsers(data);
    });
  },[db]);

  const approveUser = async(userId, role, name) => {
    setApprovingSaving(true);
    try {
      const profile = pendingUsers.find(u=>u.id===userId);
      const email = profile?.email || "";
      const normalizedRole = (role === "account_manager" || role === "am") ? "am" : role;
      
      // Update the user role in user_profiles
      const { error: upError } = await supabase.from("user_profiles").update({role: normalizedRole, full_name:name}).eq("id",userId);
      if(upError) throw upError;

      if(normalizedRole==="am") {
        const { error: amError } = await supabase.from("account_managers").upsert({name, email, user_id:userId, status:"Active"},{onConflict:"email"});
        if(amError) throw amError;
      }
      
      if(normalizedRole==="creator") {
        const { error: cError } = await supabase.from("creators").upsert({name, email, user_id:userId, status:"Active"},{onConflict:"email"});
        if(cError) throw cError;
      }

      if(normalizedRole==="client") {
        const { error: clError } = await supabase.from("clients").upsert({name: name || "New Client", contact_email: email, user_id:userId, status:"Active"},{onConflict:"user_id"});
        if(clError) throw clError;
      }
      
      // Email: welcome the newly approved user
      sendEmail("user_approved", {
        userEmail: email,
        displayName: name,
        role: normalizedRole,
      });
      
      setPendingUsers(prev=>prev.filter(u=>u.id!==userId));
      if (typeof onRefresh === "function") {
        await onRefresh();
      }
    } catch (err) {
      console.error("Failed to approve user:", err);
      alert("Error approving user: " + err.message);
    } finally {
      setApprovingSaving(false);
    }
  };

  const denyUser = async(userId) => {
    await supabase.from("user_profiles").update({role:"denied"}).eq("id",userId);
    setPendingUsers(prev=>prev.filter(u=>u.id!==userId));
  };
  const totalRevenue = (db.clients || []).filter(c=>c.status==="Active").reduce((a,c)=>a+Number(c.budget||0),0);
  const pendingReviews = (db.submissions || []).filter(s => s.status === "Submitted" || s.status === "Under Review");
  const activeCampaigns = (db.campaigns || []).filter(c => c.status === "Active" || c.status === "Draft");

  return (
    <div className="content admin-dash-wrap">
      {/* UGCTrackr-style Dashboard Performance Suite */}
      <div style={{ marginBottom: 32 }}>
        <UGCDashboardView
          campaigns={db.campaigns || []}
          submissions={db.submissions || []}
          analytics={db.analytics || []}
          creators={db.creators || []}
          title="Dashboard"
          subtitle="Agency-wide verified post analytics, daily views, and deliverable metrics"
          showTopPosts={true}
          onNavigate={setPage}
        />
      </div>

      {/* Agency Operations & Pulse */}
      <div className="mb-20 flex-between">
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "var(--ink)" }}>Agency Operations</h3>
          <p style={{ color: "var(--ink2)", marginTop: 2, fontSize: 13 }}>Review queues, pending onboarding, and financial pulse.</p>
        </div>
        <span className="owner-badge">👑 Owner Operations</span>
      </div>

      {/* Pulse Cards */}
      <div className="stats-grid" style={{ marginBottom: 32 }}>
        <div className="stat-card">
           <div className="stat-label">Reviews Pending</div>
           <div className="stat-value" style={{ color: pendingReviews.length ? "var(--orange)" : "var(--ink)" }}>{pendingReviews.length}</div>
        </div>
        <div className="stat-card">
           <div className="stat-label">Users to Approve</div>
           <div className="stat-value" style={{ color: pendingUsers.length ? "var(--blue)" : "var(--ink)" }}>{pendingUsers.length}</div>
        </div>
        <div className="stat-card stat-highlight">
           <div className="stat-label">Active Campaigns</div>
           <div className="stat-value">{activeCampaigns.length}</div>
        </div>
        <div className="stat-card">
           <div className="stat-label">Monthly Revenue</div>
           <div className="stat-value text-green">{fmtMoney(totalRevenue)}</div>
        </div>
      </div>

      {/* The Inbox Grid - Urgent actions sorted to top */}
      <div className="grid-2" style={{ marginBottom: 32 }}>
        
        {/* Left: Action Required Reviews */}
        <div className="premium-card" style={{ display: "flex", flexDirection: "column" }}>
          <div className="flex-between mb-16">
            <div className="card-title mb-0" style={{ fontSize: 16 }}>🚀 Action Required: Reviews</div>
            {pendingReviews.length > 0 && <span className="badge badge-orange">{pendingReviews.length} left</span>}
          </div>
          
          {pendingReviews.length === 0 ? (
            <div className="empty" style={{ padding: 32, background: "var(--bg2)", borderRadius: 12, flex: 1 }}>
              <div className="empty-icon">✨</div>
              <p style={{ marginTop: 12, fontWeight: 600, color: "var(--ink)" }}>All caught up!</p>
              <p style={{ fontSize: 13, color: "var(--ink3)", marginTop: 4 }}>No submissions waiting for review right now.</p>
            </div>
          ) : (
            <div className="list-stack" style={{ flex: 1 }}>
              {pendingReviews.slice(0, 5).map(sub => {
                const creator = db.creators.find(c => c.id === sub.creator_id);
                const campaign = db.campaigns.find(c => c.id === sub.campaign_id);
                return (
                <div key={sub.id} className="list-item flex-between" style={{ padding: "14px 0", borderBottom: "1px solid var(--border2)" }}>
                  <div>
                    <div className="fw-600 fs-14">{creator?.name || "Creator"}</div>
                    <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 2 }}>
                      {campaign?.name || "Unknown Campaign"} • <span style={{color:"var(--orange)", fontWeight:500}}>{sub.concept_status === 'Pending' ? 'Concept Pending' : 'Final Video Pending'}</span>
                    </div>
                  </div>
                  <div className="badge" style={{background:"var(--bg2)", color:"var(--ink2)"}}>Requires Review</div>
                </div>
              )})}
            </div>
          )}
        </div>

        {/* Right: Pending Users Onboarding */}
        <div className="premium-card" style={{ display: "flex", flexDirection: "column" }}>
          <div className="flex-between mb-16">
            <div className="card-title mb-0" style={{ fontSize: 16 }}>🤝 Action Required: Onboarding</div>
            {pendingUsers.length > 0 && <span className="badge badge-blue">{pendingUsers.length} waiting</span>}
          </div>
          
          {pendingUsers.length === 0 ? (
            <div className="empty" style={{ padding: 32, background: "var(--bg2)", borderRadius: 12, flex: 1 }}>
              <div className="empty-icon">✓</div>
              <p style={{ marginTop: 12, fontWeight: 600, color: "var(--ink)" }}>Onboarding clear.</p>
              <p style={{ fontSize: 13, color: "var(--ink3)", marginTop: 4 }}>No new users waiting for role assignments.</p>
            </div>
          ) : (
             <div className="list-stack" style={{ flex: 1 }}>
              {pendingUsers.map(u => (
                <div key={u.id} className="list-item flex-between" style={{ padding: "12px 0", borderBottom: "1px solid var(--border2)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div className={`creator-avatar ${getAvatarColor(u.full_name||u.email)}`} style={{width:36,height:36,fontSize:13}}>{getInitials(u.full_name||u.email)}</div>
                    <div>
                      <div className="fw-600 fs-14">{u.full_name || u.email}</div>
                      <div style={{ fontSize: 12, color: "var(--ink3)" }}>Req: {u.requested_role || "Creator"}</div>
                    </div>
                  </div>
                  <div style={{display:"flex", gap:6, flexWrap:"wrap"}}>
                    <button className="btn btn-green btn-sm" disabled={approvingSaving} onClick={()=>approveUser(u.id,"am",u.full_name||u.email.split("@")[0])} style={{padding:"4px 8px"}}>✓ AM</button>
                    <button className="btn btn-sm" style={{background:"var(--blue)",color:"#fff",padding:"4px 8px"}} disabled={approvingSaving} onClick={()=>approveUser(u.id,"creator",u.full_name||u.email.split("@")[0])}>✓ Creator</button>
                    <button className="btn btn-sm" style={{background:"var(--orange)",color:"#fff",padding:"4px 8px"}} disabled={approvingSaving} onClick={()=>approveUser(u.id,"client",u.full_name||u.email.split("@")[0])}>✓ Client</button>
                    <button className="btn btn-red btn-sm" disabled={approvingSaving} onClick={()=>denyUser(u.id)} style={{padding:"4px 8px"}}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Existing Operational Snapshot */}
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Network Directory</h3>
      <div className="grid-2">
        <div className="premium-card">
          <div className="card-title">Client Overview</div>
          <div className="table-wrap">
            <table className="premium-table">
              <thead><tr><th>Client</th><th>Budget</th><th>Status</th><th>AM</th></tr></thead>
              <tbody>
                {db.clients.map(c=>{
                  const am = db.accountManagers.find(a=>a.id===c.am_id);
                  return (
                    <tr key={c.id}>
                      <td className="fw-600">{c.name}</td>
                      <td className="text-green fw-600">{fmtMoney(c.budget)}</td>
                      <td>{statusBadge(c.status)}</td>
                      <td style={{fontSize:12,color:am?"var(--ink)":"var(--orange)"}}>
                        {am?.name || "Unassigned"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
            {db.clients.length===0&&<div className="empty" style={{padding:48}}><div className="empty-icon text-muted" style={{fontSize:40,marginBottom:16}}>🏢</div><h3 style={{fontSize:18,marginBottom:8}}>No clients yet</h3><p style={{color:"var(--ink3)",marginBottom:24}}>Add your first client to start creating campaigns.</p><button className="btn btn-primary" onClick={() => window.location.search = "?page=clients"}>+ Add Client</button></div>}
        </div>
        
        <div className="premium-card">
          <div className="card-title">Team</div>
          {db.accountManagers.map(am=>{
            const amCreators=db.creators.filter(c=>c.am_id===am.id);
            const amClients=db.clients.filter(c=>c.am_id===am.id);
            const pending=db.submissions.filter(s=>{const cr=db.creators.find(c=>c.id===s.creator_id);return cr?.am_id===am.id&&(s.status==="Submitted"||s.status==="Under Review");}).length;
            return (
              <div key={am.id} style={{padding:"12px 0",borderBottom:"1px solid var(--border2)"}}>
                <div className="flex-between mb-8">
                  <div className="fw-600">{am.name}</div>
                  {pending>0&&<span className="badge badge-orange">{pending} pending</span>}
                </div>
                <div style={{fontSize:12,color:"var(--ink3)"}}>
                  {amCreators.length} creator{amCreators.length!==1?"s":""} · {amClients.length} client{amClients.length!==1?"s":""} assigned
                </div>
              </div>
            );
          })}
          {db.accountManagers.length===0&&<div className="empty" style={{padding:48}}><div className="empty-icon text-muted" style={{fontSize:40,marginBottom:16}}>👥</div><h3 style={{fontSize:18,marginBottom:8}}>No team members yet</h3><p style={{color:"var(--ink3)",marginBottom:24}}>Have Account Managers sign up using this URL, and assign their role in the 'Team/Roles' tab.</p></div>}
        </div>
      </div>
    </div>
  );
}
