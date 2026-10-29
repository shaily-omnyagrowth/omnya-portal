import { useState } from "react";
import AIInsightsPanel from "../../components/AIInsightsPanel";
import PostsGalleryView from "../../components/PostsGalleryView";

export default function ContentLibrary({ db, onRefresh }) {
  const approved = db.submissions.filter(s=>s.status==="Approved");
  const [selected, setSelected] = useState(null);
  const sub = db.submissions.find(s=>s.id===selected);
  const campaign = sub?db.campaigns.find(c=>c.id===sub.campaign_id):null;
  const client = campaign?db.clients.find(c=>c.id===campaign.client_id):null;
  return (
    <div className="content">
      <PostsGalleryView
        submissions={approved}
        analytics={db.analytics}
        creators={db.creators}
        campaigns={db.campaigns}
        title="Content Library & Asset Gallery"
        subtitle="Explore and review all approved creator content with live analytics and direct links"
      />
      {selected&&sub&&(
        <div className="modal-overlay" onClick={()=>setSelected(null)}>
          <div className="modal" style={{maxWidth:640}} onClick={e=>e.stopPropagation()}>
            <div className="flex-between mb-16">
              <div><div className="modal-title">{campaign?.name}</div><div className="modal-sub">{db.creators.find(c=>c.id===sub.creator_id)?.name} · {sub.platform} · <a href={sub.posted_link} target="_blank" rel="noreferrer" className="link">View video →</a></div></div>
              <button className="btn btn-ghost btn-sm" onClick={()=>setSelected(null)}>✕</button>
            </div>
            <AIInsightsPanel sub={sub} campaign={campaign} client={client} onUpdate={async()=>{ await onRefresh(); }}/>
          </div>
        </div>
      )}
    </div>
  );
}
