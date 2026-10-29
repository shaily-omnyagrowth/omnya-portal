import { fmtMoney } from "../utils";

export default function AMClientSummaryBar({ client, db }) {
  const campaigns = db.campaigns.filter(c=>c.client_id===client.id);
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const totalApprovedMonth = db.submissions.filter(s=>{
    return campaigns.some(c=>c.id===s.campaign_id) && s.status==="Approved" && new Date(s.created_at)>=startOfMonth;
  }).length;

  const totalTarget = campaigns.reduce((t,c)=>t+Number(c.videos_needed||0),0);
  const revenue = Number(client.budget||0);
  const creatorCost = db.submissions.filter(s=>campaigns.some(c=>c.id===s.campaign_id)&&s.status==="Approved")
    .reduce((t,s)=>{ const camp=db.campaigns.find(c=>c.id===s.campaign_id); return t+Number(camp?.pay_per_video||0); },0);
  const amCost = revenue * 0.10;
  const margin = revenue>0?Math.round(((revenue-creatorCost-amCost)/revenue)*100):0;
  const marginColor = margin>=50?"var(--green)":margin>=25?"#b08800":"var(--red)";
  const marginBg = margin>=50?"rgba(26,122,74,0.08)":margin>=25?"#fffbe6":"rgba(220,53,69,0.08)";
  const marginLabel = margin>=50?"🟢 Healthy":margin>=25?"🟡 Watch":"🔴 Thin";
  const costPerVideo = client.videos_per_month>0?Math.round(revenue/client.videos_per_month):0;
  const progress = totalTarget>0?Math.min(Math.round((totalApprovedMonth/totalTarget)*100),100):0;

  return (
    <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:20,padding:"14px 16px",background:"var(--bg2)",borderRadius:"var(--radius-sm)",border:"1px solid var(--border2)"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:11,color:"var(--ink3)",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:4}}>Monthly Value</div>
        <div style={{fontFamily:"Bebas Neue, sans-serif",fontSize:22,color:"var(--green)"}}>{fmtMoney(revenue)}</div>
      </div>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:11,color:"var(--ink3)",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:4}}>Videos Committed</div>
        <div style={{fontFamily:"Bebas Neue, sans-serif",fontSize:22}}>{client.videos_per_month}</div>
      </div>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:11,color:"var(--ink3)",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:4}}>Cost/Video Target</div>
        <div style={{fontFamily:"Bebas Neue, sans-serif",fontSize:22}}>{costPerVideo>0?fmtMoney(costPerVideo):"—"}</div>
      </div>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:11,color:"var(--ink3)",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:4}}>Margin Health</div>
        <div style={{fontSize:13,fontWeight:700,color:marginColor,background:marginBg,borderRadius:20,padding:"3px 10px",display:"inline-block"}}>{marginLabel}</div>
      </div>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:11,color:"var(--ink3)",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:4}}>This Month</div>
        <div style={{fontFamily:"Bebas Neue, sans-serif",fontSize:22}}>{totalApprovedMonth}<span style={{fontSize:14,color:"var(--ink3)"}}>/{totalTarget}</span></div>
        <div style={{width:"100%",background:"var(--border2)",borderRadius:4,height:3,marginTop:4}}>
          <div style={{width:`${progress}%`,background:progress>=80?"var(--green)":progress>=50?"var(--gold)":"var(--red)",height:3,borderRadius:4}}/>
        </div>
      </div>
    </div>
  );
}
