import { fmtMoney } from "../../utils";

export default function RevenueTrendChart({ db, clientData }) {
  // Generate last 6 months labels
  const months = [];
  for (let i=5; i>=0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth()-i);
    months.push({ label: d.toLocaleString("default",{month:"short"}), year: d.getFullYear(), month: d.getMonth() });
  }

  // For now, use current snapshot for current month and project backward
  // As real data accumulates via submissions, this will fill in
  const totalRevenue = clientData.reduce((a,c)=>a+c.revenue,0);
  const totalCost = clientData.reduce((a,c)=>a+c.creatorCost+c.amCost,0);
  const totalProfit = totalRevenue - totalCost;
  const currentMargin = totalRevenue>0?Math.round((totalProfit/totalRevenue)*100):0;

  // Build trend from submissions by month
  const getMonthData = (year, month) => {
    const monthSubs = db.submissions.filter(s=>{
      if (!s.created_at) return false;
      const d = new Date(s.created_at);
      return d.getFullYear()===year && d.getMonth()===month && s.status==="Approved";
    });
    const creatorCost = monthSubs.reduce((total,s)=>{
      const camp = db.campaigns.find(c=>c.id===s.campaign_id);
      return total + Number(camp?.pay_per_video||0);
    },0);
    // Revenue = current active client budgets (snapshot)
    const isCurrentMonth = year===new Date().getFullYear()&&month===new Date().getMonth();
    const revenue = isCurrentMonth ? totalRevenue : 0; // Will populate as history builds
    const margin = revenue>0?Math.round(((revenue-creatorCost)/revenue)*100):0;
    return { creatorCost, revenue, margin, approved: monthSubs.length };
  };

  const data = months.map(m=>({...m, ...getMonthData(m.year, m.month)}));
  const currentMonthData = data[data.length-1];
  const maxRevenue = Math.max(...data.map(d=>d.revenue), 1);

  return (
    <div>
      <div style={{display:"flex",gap:16,marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12}}><div style={{width:12,height:3,background:"var(--green)",borderRadius:2}}/> Revenue</div>
        <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12}}><div style={{width:12,height:3,background:"var(--red)",borderRadius:2,borderStyle:"dashed"}}/> Costs</div>
        <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:"var(--ink3)"}}>* Revenue history populates as months accumulate</div>
      </div>
      <div style={{display:"flex",gap:8,alignItems:"flex-end",height:120,paddingBottom:24,position:"relative"}}>
        {data.map((m,i)=>{
          const revH = m.revenue>0?Math.round((m.revenue/maxRevenue)*100):0;
          const costH = m.revenue>0?Math.round(((m.creatorCost)/maxRevenue)*100):0;
          const isCurrent = i===data.length-1;
          return (
            <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
              <div style={{width:"100%",display:"flex",gap:2,alignItems:"flex-end",height:96}}>
                <div style={{flex:1,background:isCurrent?"var(--green)":"rgba(26,122,74,0.3)",borderRadius:"3px 3px 0 0",height:`${revH}%`,minHeight:revH>0?4:0,transition:"height 0.3s"}}/>
                <div style={{flex:1,background:isCurrent?"var(--red)":"rgba(220,53,69,0.3)",borderRadius:"3px 3px 0 0",height:`${costH}%`,minHeight:costH>0?4:0,transition:"height 0.3s"}}/>
              </div>
              <div style={{fontSize:10,color:isCurrent?"var(--ink)":"var(--ink3)",fontWeight:isCurrent?600:400}}>{m.label}</div>
              {isCurrent&&<div style={{fontSize:10,color:"var(--green)",fontWeight:600}}>{fmtMoney(m.revenue)}</div>}
            </div>
          );
        })}
      </div>
      <div style={{display:"flex",gap:16,paddingTop:8,borderTop:"1px solid var(--border)"}}>
        <div style={{fontSize:12}}><span style={{color:"var(--ink3)"}}>This month: </span><span style={{fontWeight:600,color:"var(--green)"}}>{fmtMoney(currentMonthData.revenue)}</span></div>
        <div style={{fontSize:12}}><span style={{color:"var(--ink3)"}}>Margin: </span><span style={{fontWeight:600,color:currentMargin>=50?"var(--green)":currentMargin>=25?"var(--gold)":"var(--red)"}}>{currentMargin}%</span></div>
        <div style={{fontSize:12}}><span style={{color:"var(--ink3)"}}>Approved videos: </span><span style={{fontWeight:600}}>{currentMonthData.approved}</span></div>
      </div>
    </div>
  );
}
