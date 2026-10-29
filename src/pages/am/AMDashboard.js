import { useMemo } from "react";
import UGCDashboardView from "../../components/UGCDashboardView";
import { fmtMoney } from "../../utils";

export default function AMDashboard({ user, db, setPage }) {
  const am = db.accountManagers.find(a=>a.user_id===user.id||a.email===user.email);
  const myCreators = am?db.creators.filter(c=>c.am_id===am.id):[];
  const myClients = useMemo(() => am?db.clients.filter(c=>c.am_id===am.id):[], [am, db.clients]);

  const myCampaigns = useMemo(() => {
    const clientIds = new Set(myClients.map(cl => cl.id));
    return (db.campaigns || []).filter(c => clientIds.has(c.client_id));
  }, [myClients, db.campaigns]);

  const campIds = useMemo(() => new Set(myCampaigns.map(c => c.id)), [myCampaigns]);

  const pendingC = (db.submissions || []).filter(s => (campIds.has(s.campaign_id) || myCreators.some(c => c.id === s.creator_id)) && s.status === "Submitted").length;
  const pendingF = (db.submissions || []).filter(s => (campIds.has(s.campaign_id) || myCreators.some(c => c.id === s.creator_id)) && s.status === "Under Review").length;
  const approvedWeek = (db.submissions || []).filter(s => (campIds.has(s.campaign_id) || myCreators.some(c => c.id === s.creator_id)) && s.status === "Approved" && new Date(s.approved_date) > new Date(Date.now()-7*86400000)).length;

  if(!am) return <div className="content"><div className="empty"><div className="empty-icon">⚙️</div><h3>Account not fully set up</h3><p>Your account manager profile isn't linked yet. Contact Shai to get assigned to clients and creators.</p></div></div>;
  return (
    <div className="content">
      {/* UGCTrackr-style Dashboard Performance Suite for AM */}
      <div style={{ marginBottom: 32 }}>
        <UGCDashboardView
          campaigns={myCampaigns}
          submissions={(db.submissions || []).filter(s => campIds.has(s.campaign_id))}
          analytics={db.analytics || []}
          creators={myCreators}
          title="Overview"
          subtitle="Performance analytics and daily view trends across your assigned accounts"
          showTopPosts={true}
          onNavigate={setPage}
        />
      </div>

      {/* AM Operational Overview */}
      <div className="mb-20 flex-between">
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "var(--ink)" }}>Account Operations</h3>
          <p style={{ color: "var(--ink2)", marginTop: 2, fontSize: 13 }}>Pending submissions, creator progress, and client quotas.</p>
        </div>
        <span className="owner-badge" style={{ background: "var(--blue)", color: "#fff" }}>🤝 AM Operations</span>
      </div>

      <div className="stats-grid">
        <div
          className="stat-card stat-highlight"
          style={{ cursor: "pointer", transition: "transform 0.15s" }}
          onClick={() => setPage && setPage("review-queue")}
          title="Go to Review Queue"
        >
          <div className="stat-label">Pending Approvals ➔</div>
          <div className="stat-value">{pendingC+pendingF}</div>
          <div className="stat-sub">{pendingC} concepts · {pendingF} finals (click to open queue)</div>
        </div>
        <div className="stat-card"><div className="stat-label">Approved This Week</div><div className="stat-value">{approvedWeek}</div></div>
        <div className="stat-card"><div className="stat-label">My Creators</div><div className="stat-value">{myCreators.length}</div></div>
        <div className="stat-card"><div className="stat-label">My Clients</div><div className="stat-value">{myClients.length}</div></div>
      </div>
      <div className="grid-2">
        <div className="premium-card">
          <div className="card-title">Creator Performance</div>
          {myCreators.map(c=>{
            const subs=db.submissions.filter(s=>s.creator_id===c.id);
            const rate=subs.length>0?Math.round((subs.filter(s=>s.status==="Approved").length/subs.length)*100):0;
            return (
              <div key={c.id} className="perf-row">
                <div className="perf-label fs-12">{c.name.split(" ")[0]}</div>
                <div className="perf-bar"><div className="perf-fill" style={{width:`${rate}%`,background:rate>80?"var(--green)":rate>60?"var(--gold)":"var(--red)"}}/></div>
                <div className="perf-val">{rate}%</div>
              </div>
            );
          })}
          {myCreators.length===0&&<div className="empty" style={{padding:24}}><div className="empty-icon">👥</div><h3>No creators yet</h3></div>}
        </div>
        <div className="premium-card">
          <div className="card-title">My Clients</div>
          {myClients.map(cl=>{
            const campaigns = db.campaigns.filter(c=>c.client_id===cl.id);
            const now = new Date();
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const approvedMonth = db.submissions.filter(s=>campaigns.some(c=>c.id===s.campaign_id)&&s.status==="Approved"&&new Date(s.created_at)>=startOfMonth).length;
            const target = campaigns.reduce((t,c)=>t+Number(c.videos_needed||0),0);
            const revenue = Number(cl.budget||0);
            const creatorCost = db.submissions.filter(s=>campaigns.some(c=>c.id===s.campaign_id)&&s.status==="Approved").reduce((t,s)=>{const camp=db.campaigns.find(c=>c.id===s.campaign_id);return t+Number(camp?.pay_per_video||0);},0);
            const margin = revenue>0?Math.round(((revenue-creatorCost-revenue*0.10)/revenue)*100):0;
            const marginColor = margin>=50?"var(--green)":margin>=25?"#b08800":"var(--red)";
            return (
              <div key={cl.id} style={{padding:"12px 0",borderBottom:"1px solid var(--border2)"}}>
                <div className="flex-between" style={{marginBottom:8}}>
                  <div>
                    <div className="fw-600 fs-13">{cl.name}</div>
                    <div style={{fontSize:11,color:"var(--ink3)"}}>{cl.videos_per_month} videos/mo · {cl.deal_type}</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontWeight:700,fontSize:13,color:"var(--green)"}}>{fmtMoney(revenue)}</div>
                    <div style={{fontSize:11,fontWeight:600,color:marginColor}}>{margin}% margin</div>
                  </div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{flex:1,background:"var(--border2)",borderRadius:4,height:4}}>
                    <div style={{width:`${target>0?Math.min(Math.round((approvedMonth/target)*100),100):0}%`,background:"var(--green)",height:4,borderRadius:4}}/>
                  </div>
                  <div style={{fontSize:11,color:"var(--ink3)",whiteSpace:"nowrap"}}>{approvedMonth}/{target} this month</div>
                </div>
              </div>
            );
          })}
          {myClients.length===0&&<div className="empty" style={{padding:24}}><div className="empty-icon">🏢</div><h3>No clients yet</h3></div>}
        </div>
      </div>
    </div>
  );
}
