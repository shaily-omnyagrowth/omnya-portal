import { useState } from "react";
import { fmtDate, fmtMoney, statusBadge } from "../../utils";
import CampaignForum from "../campaigns/CampaignForum";

export default function CreatorActiveJobs({ user, db, onNavigate }) {
  const creator = db.creators.find(c=>c.user_id===user.id||c.email===user.email);
  const myJobs = db.campaigns.filter(c=>(c.assigned_creators||[]).includes(creator?.id)&&c.status!=="Completed");
  const [selectedJob, setSelectedJob] = useState(null);

  if (selectedJob) {
    const job = db.campaigns.find(c=>c.id===selectedJob);
    const client = db.clients.find(c=>c.id===job?.client_id);
    const mySubs = db.submissions.filter(s=>s.creator_id===creator?.id&&s.campaign_id===job?.id);
    return (
      <div className="content">
        <button className="btn btn-ghost btn-sm" style={{marginBottom:16}} onClick={()=>setSelectedJob(null)}>← Back to Jobs</button>
        <div className="card mb-16">
          <div className="flex-between mb-8">
            <div>
              <div style={{fontFamily:"Bebas Neue, sans-serif",fontSize:20,marginBottom:4}}>{job?.name}</div>
              <div style={{fontSize:12,color:"var(--ink3)"}}>{client?.name} · Due {fmtDate(job?.deadline)} · {fmtMoney(job?.pay_per_video)}/video</div>
            </div>
            {statusBadge(job?.status)}
          </div>
          {job?.description&&<div style={{background:"var(--bg2)",borderRadius:"var(--radius-sm)",padding:12,marginBottom:12,fontSize:13}}><div style={{fontSize:11,textTransform:"uppercase",letterSpacing:"0.5px",color:"var(--ink3)",marginBottom:6}}>Guidelines</div><p style={{color:"var(--ink2)",margin:0}}>{job.description}</p></div>}
          {job?.brief_url&&<div style={{marginBottom:12}}><a href={job.brief_url} target="_blank" rel="noreferrer" className="btn btn-sm btn-primary">📄 View Creator Brief</a></div>}
          <div className="flex-between">
            <div style={{fontSize:12,color:"var(--ink3)"}}>{mySubs.length} submission{mySubs.length!==1?"s":""}</div>
            <button className="btn btn-primary btn-sm" onClick={()=>onNavigate("submit")}>Submit Content</button>
          </div>
        </div>
        {job&&<CampaignForum campaign={job} user={user} db={db} canPin={false}/>}
      </div>
    );
  }

  return (
    <div className="content">
      {myJobs.length===0&&<div className="empty"><div className="empty-icon">🎯</div><h3>No active jobs</h3><p>Apply for jobs to get started</p></div>}
      {myJobs.map(job=>{
        const client = db.clients.find(c=>c.id===job.client_id);
        const mySubs = db.submissions.filter(s=>s.creator_id===creator?.id&&s.campaign_id===job.id);
        return (
          <div key={job.id} className="card mb-16" style={{cursor:"pointer"}} onClick={()=>setSelectedJob(job.id)}>
            <div className="flex-between mb-8">
              <div>
                <div style={{fontFamily:"Bebas Neue, sans-serif",fontSize:18,marginBottom:4,color:"var(--blue)"}}>{job.name}</div>
                <div style={{fontSize:12,color:"var(--ink3)"}}>{client?.name} · Due {fmtDate(job.deadline)} · {fmtMoney(job.pay_per_video)}/video</div>
              </div>
              {statusBadge(job.status)}
            </div>
            <div style={{fontSize:12,color:"var(--ink3)"}}>{mySubs.length} submission{mySubs.length!==1?"s":""} · Click to view details & forum</div>
          </div>
        );
      })}
    </div>
  );
}
