import { useState } from "react";
import { fmtDateTime } from "../../utils";

export default function MySubmissions({ user, db }) {
  const creator = db.creators.find(c=>c.user_id===user.id||c.email===user.email);
  const mySubs = (creator?db.submissions.filter(s=>s.creator_id===creator.id):[]).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  const [tab, setTab] = useState("All");

  const filtered = mySubs.filter(s=>{
    if(tab==="All") return true;
    if(tab==="Pending") return s.status==="Submitted"||s.status==="Under Review";
    if(tab==="Approved") return s.status==="Approved";
    if(tab==="Revisions") return s.status==="Revision Requested";
    if(tab==="Rejected") return s.status==="Rejected";
    return true;
  });

  return (
    <div className="content">
      <div className="tabs mb-24">
        {["All","Pending","Approved","Revisions","Rejected"].map(t=>(
          <div key={t} className={`tab ${tab===t?"active":""}`} onClick={()=>setTab(t)}>{t}</div>
        ))}
      </div>
      {filtered.length===0&&<div className="empty" style={{padding:48, marginTop:24}}><div className="empty-icon text-muted" style={{fontSize:40,marginBottom:16}}>📝</div><h3 style={{fontSize:18,marginBottom:8}}>No submissions yet</h3><p style={{color:"var(--ink3)",marginBottom:24}}>{tab==="all" ? "You haven't uploaded any videos yet. Go to the Submit tab to add your content." : "No videos match this status filter."}</p></div>}
      {filtered.length>0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px' }}>
          {filtered.map(s => {
            const camp = db.campaigns.find(c => c.id === s.campaign_id);
            const isApproved = s.status === "Approved";
            const needsRevisions = s.concept_status === "Revision Requested";
            const isPending = s.status === "Submitted" || s.status === "Under Review";
            
            // Build aesthetic status dots
            let statusColor = "var(--ink2)";
            let pulseClass = "";
            if (isApproved) statusColor = "#10b981"; // green
            else if (isPending) { statusColor = "#f59e0b"; pulseClass = "pulse-amber"; }
            else if (needsRevisions) statusColor = "#ef4444"; // red

            return (
              <div key={s.id} className="premium-card fade-in" style={{ padding: '24px', display: 'flex', flexDirection: 'column', height: '100%' }}>
                
                <div className="flex-between mb-16">
                  <span className={`status-pill ${s.submission_type==='Concept'?'status-pill-blue':'status-pill-orange'}`}>
                    {s.submission_type} Video
                  </span>
                  
                  <div className="flex-center gap-8">
                    <div className={`dot ${pulseClass}`} style={{background: statusColor, width: 8, height: 8}}></div>
                    <span className="fs-12 fw-600" style={{color: statusColor, textTransform: 'uppercase', letterSpacing: 0.5}}>
                      {s.status}
                    </span>
                  </div>
                </div>

                <div className="heading-md" style={{marginBottom: 4, lineHeight: 1.2}}>{camp?.name || "Unknown Campaign"}</div>
                <div className="fs-12 text-muted mb-16">Submitted on {fmtDateTime(s.created_at)}</div>

                {s.submission_type === "Final" && (s.posted_link || s.posted_url) && (
                  <div style={{ margin: "0 0 16px 0", padding: "10px 12px", background: "var(--bg2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border2)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: (s.view_count_verified != null && Number(s.view_count_verified) > 0) ? 6 : 0 }}>
                      <span style={{ fontSize: 11, color: "var(--ink3)", textTransform: "uppercase", fontWeight: 600 }}>
                        {s.platform || "Video"}
                      </span>
                      <a href={s.posted_link || s.posted_url} target="_blank" rel="noreferrer" className="link" style={{ fontSize: 12 }}>
                        View Video ↗
                      </a>
                    </div>
                    {s.view_count_verified != null && Number(s.view_count_verified) > 0 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--green)", fontWeight: 600 }}>
                        <span>✓ {Number(s.view_count_verified).toLocaleString()} verified views</span>
                      </div>
                    )}
                  </div>
                )}

                {s.feedback ? (
                  <div style={{ marginTop: 'auto', background: 'var(--bg2)', padding: '16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border2)' }}>
                    <div className="fs-12 fw-600 mb-4" style={{color: 'var(--ink)'}}>AM Feedback</div>
                    <div className="fs-13" style={{color: 'var(--ink2)', lineHeight: 1.5}}>{s.feedback}</div>
                  </div>
                ) : (
                  <div style={{ marginTop: 'auto', padding: '16px', borderTop: '1px dashed var(--border2)', textAlign: 'center' }}>
                    <div className="fs-12 text-muted">Awaiting Account Manager Review...</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
