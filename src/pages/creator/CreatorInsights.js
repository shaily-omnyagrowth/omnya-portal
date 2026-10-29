import { useState } from "react";
import AIInsightsPanel from "../../components/AIInsightsPanel";
import { fmtDate, fmtDateTime } from "../../utils";

export default function CreatorInsights({ user, db }) {
  const creator = db.creators.find(c=>c.user_id===user.id||c.email===user.email);
  const approvedSubs = creator?db.submissions.filter(s=>s.creator_id===creator.id&&s.status==="Approved"):[];
  const [selected, setSelected] = useState(approvedSubs[0]?.id||null);

  const sub = db.submissions.find(s=>s.id===selected);

  return (
    <div className="content">
      {approvedSubs.length===0?<div className="empty"><div className="empty-icon">✨</div><h3>No approved videos yet</h3></div>:(
        <div className="grid-2" style={{alignItems:"start"}}>
          <div>
            <div className="card-title" style={{marginBottom:12}}>Your Approved Videos</div>
            {approvedSubs.map(s=>{
              const camp=db.campaigns.find(c=>c.id===s.campaign_id);
              const link=s.posted_link||s.posted_url;
              const ytId=link&&(link.match(/(?:[?&]v=|youtu\.be\/|youtube\.com\/(?:shorts|live|embed)\/)([A-Za-z0-9_-]{6,})/)||[])[1];
              const thumb=s.thumbnail_url||(ytId?`https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`:null);
              return (
                <div key={s.id} className="card mb-8" style={{cursor:"pointer",border:selected===s.id?"1px solid var(--ink)":"1px solid var(--border)"}} onClick={()=>setSelected(s.id)}>
                  <div className="flex-between" style={{gap:12}}>
                    {thumb&&<img src={thumb} alt="" onError={e=>{e.currentTarget.style.display="none";}} style={{width:56,height:72,objectFit:"cover",borderRadius:"var(--radius-sm)",flexShrink:0,background:"var(--bg2)"}}/>}
                    <div style={{minWidth:0,flex:1}}>
                      <div className="fw-600 fs-13" style={{marginBottom:2}}>{camp?.name}</div>
                      <div style={{fontSize:11,color:"var(--ink3)"}}>{s.platform} · Submitted {fmtDateTime(s.created_at)} · Approved {fmtDate(s.approved_date)}</div>
                      {link&&<a href={link} target="_blank" rel="noreferrer" className="link" onClick={e=>e.stopPropagation()} style={{fontSize:11,display:"block",marginTop:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{link.replace(/^https?:\/\/(www\.)?/,"").split("?")[0]} ↗</a>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div>{sub&&<AIInsightsPanel sub={sub}/>}</div>
        </div>
      )}
    </div>
  );
}
