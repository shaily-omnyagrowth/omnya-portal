import { useState } from "react";
import { fmtMoney } from "../../utils";
import ClientFinanceEditor from "./ClientFinanceEditor";
import RevenueTrendChart from "./RevenueTrendChart";

function getRetentionScore(client, db) {
  const clientCampaigns = db.campaigns.filter(c=>c.client_id===client.id);
  const allApproved = db.submissions.filter(s=>{
    return clientCampaigns.some(c=>c.id===s.campaign_id) && s.status==="Approved";
  });

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth()-1, 1);

  const thisMonth = allApproved.filter(s=>new Date(s.created_at)>=startOfMonth).length;
  const lastMonth = allApproved.filter(s=>new Date(s.created_at)>=startOfLastMonth&&new Date(s.created_at)<startOfMonth).length;

  const revenue = Number(client.budget||0);
  const creatorCost = allApproved.reduce((t,s)=>{
    const camp = db.campaigns.find(c=>c.id===s.campaign_id);
    return t+Number(camp?.pay_per_video||0);
  },0);
  const margin = revenue>0?Math.round(((revenue-creatorCost)/revenue)*100):0;

  const outputTrend = lastMonth===0?(thisMonth>0?"up":"flat"):thisMonth>lastMonth?"up":thisMonth===lastMonth?"flat":"down";
  const hasActiveCampaigns = clientCampaigns.some(c=>c.status==="In Progress"||c.status==="Open");

  // Score logic
  if (margin>=40 && outputTrend!=="down" && hasActiveCampaigns) return {score:"green", label:"🟢 Healthy", desc:"High output · Good margin", color:"var(--green)", bg:"rgba(26,122,74,0.08)"};
  if (margin>=25 && outputTrend==="down") return {score:"yellow", label:"🟡 Watch", desc:"Margin OK but output slowing", color:"#b08800", bg:"#fffbe6"};
  if (margin<25 || (!hasActiveCampaigns && allApproved.length>0)) return {score:"red", label:"🔴 At Risk", desc:"Low output · Thin margin", color:"var(--red)", bg:"rgba(220,53,69,0.08)"};
  return {score:"yellow", label:"🟡 Watch", desc:"Insufficient data", color:"#b08800", bg:"#fffbe6"};
}

export default function RevenueAnalytics({ db, user, isOwner, onRefresh }) {
  const am = !isOwner ? db.accountManagers.find(a=>a.user_id===user?.id||a.email===user?.email) : null;

  // This page used to be pure read/compute, on the theory that budget and
  // commission edits "live on Client Management and Manage Creators". In
  // practice that meant the figures shown here could not be corrected from
  // here, and the two screens that could write them discarded their errors, so
  // to the owner every number on this table was a one-time entry.
  //
  // The owner can now edit a row in place (ClientFinanceEditor, below). It is
  // still one write path, not a third: everything goes through updateRows().
  const [editing, setEditing] = useState(null); // a clientData row

  // AM commission rate — 20% for senior, 10% default
  const getAMRate = (amRecord) => {
    if (!amRecord) return 0.10;
    return Number(amRecord.commission_rate||0.10);
  };

  // Build per-client profitability
  const clientData = db.clients
    .filter(c => isOwner ? true : c.am_id === am?.id)
    .map(c => {
      const clientAM = db.accountManagers.find(a=>a.id===c.am_id);
      const clientCampaigns = db.campaigns.filter(camp=>camp.client_id===c.id);
      
      // Creator costs = sum of (approved videos × pay_per_video) across all campaigns
      const creatorCost = clientCampaigns.reduce((total, camp) => {
        const approved = db.submissions.filter(s=>s.campaign_id===camp.id&&s.status==="Approved").length;
        return total + (approved * Number(camp.pay_per_video||0));
      }, 0);

      const revenue = Number(c.budget||0);
      const amRate = getAMRate(clientAM);
      
      // Sales commission — determine rate from campaigns (10%, 20%, 30%)
      const salesCampaigns = clientCampaigns.filter(camp => camp.is_sales_sourced);
      const hasSalesSourced = salesCampaigns.length > 0;
      const salesCommissionRate = hasSalesSourced
        ? Math.max(...salesCampaigns.map(camp => Number(camp.sales_commission_rate ?? 0.30)))
        : 0;
      const salesCost = revenue * salesCommissionRate;

      // Manager commission. ONE commission: the account manager's own rate,
      // unless a campaign overrides it. Revenue here is per client while the
      // override is per campaign, so — same rule as the sales rate above — the
      // highest override in force wins. amCost/amRate stay in the row under
      // their old names because the trend chart reads them.
      const overrides = clientCampaigns
        .filter(camp => camp.manager_commission_rate != null)
        .map(camp => Number(camp.manager_commission_rate));
      const managerRate = overrides.length ? Math.max(...overrides) : amRate;
      const managerCost = revenue * managerRate;

      const grossProfit = revenue - creatorCost - salesCost - managerCost;
      const margin = revenue > 0 ? Math.round((grossProfit/revenue)*100) : 0;
      const totalApproved = clientCampaigns.reduce((t,camp)=>t+db.submissions.filter(s=>s.campaign_id===camp.id&&s.status==="Approved").length,0);
      const costPerVideo = totalApproved > 0 ? Math.round((creatorCost+salesCost+managerCost)/totalApproved) : 0;

      return {
        client: c,
        clientAM,
        clientCampaigns,
        managerOverridden: overrides.length > 0,
        revenue,
        creatorCost,
        amCost: managerCost,
        amRate: managerRate,
        managerCost,
        managerRate,
        salesCost,
        salesCommissionRate,
        hasSalesSourced,
        grossProfit,
        margin,
        totalApproved,
        costPerVideo,
        campaigns: clientCampaigns.length
      };
    });

  const totalRevenue = clientData.reduce((a,c)=>a+c.revenue,0);
  const totalCreatorCost = clientData.reduce((a,c)=>a+c.creatorCost,0);
  const totalManagerCost = clientData.reduce((a,c)=>a+c.managerCost,0);
  const totalSalesCost = clientData.reduce((a,c)=>a+(c.salesCost||0),0);
  const totalProfit = clientData.reduce((a,c)=>a+c.grossProfit,0);
  const totalMargin = totalRevenue>0?Math.round((totalProfit/totalRevenue)*100):0;

  const marginColor = (m) => m>=50?"var(--green)":m>=25?"var(--gold)":"var(--red)";

  return (
    <div className="content">
      {isOwner&&<div className="mb-16"><span className="owner-badge">👑 Full Agency View</span></div>}

      {/* Top Stats */}
      <div className="stats-grid" style={{gridTemplateColumns:"repeat(auto-fit, minmax(160px, 1fr))",marginBottom:24}}>
        <div className="stat-card stat-highlight"><div className="stat-label">Monthly Revenue</div><div className="stat-value">{fmtMoney(totalRevenue)}</div></div>
        <div className="stat-card"><div className="stat-label">Creator Costs</div><div className="stat-value" style={{color:"var(--red)"}}>{fmtMoney(totalCreatorCost)}</div></div>
        {isOwner&&<div className="stat-card"><div className="stat-label">Manager Commission</div><div className="stat-value" style={{color:"var(--orange)"}}>{fmtMoney(totalManagerCost)}</div></div>}
        {isOwner&&<div className="stat-card"><div className="stat-label">Sales Commission</div><div className="stat-value" style={{color:"var(--orange)"}}>{fmtMoney(totalSalesCost)}</div></div>}
        <div className="stat-card"><div className="stat-label">Gross Profit</div><div className="stat-value" style={{color:"var(--green)"}}>{fmtMoney(totalProfit)}</div></div>
        <div className="stat-card"><div className="stat-label">Margin</div><div className="stat-value" style={{color:marginColor(totalMargin)}}>{totalMargin}%</div></div>
      </div>

      {/* Per Client Profitability */}
      <div className="premium-card">
        <div className="card-title">Campaign Profitability by Client</div>
        <div className="table-wrap">
          <table className="premium-table">
            <thead>
              <tr>
                <th>Client</th>
                {isOwner&&<th>AM</th>}
                <th>Revenue</th>
                <th>Creator Cost</th>
                {isOwner&&<th>Manager Comm.</th>}
                {isOwner&&<th>Sales Comm.</th>}
                <th>Gross Profit</th>
                <th>Margin</th>
                <th>Videos</th>
                <th>Cost/Video</th>
                <th>Retention Risk</th>
                {isOwner&&<th style={{textAlign:"right"}}>Edit</th>}
              </tr>
            </thead>
            <tbody>
              {clientData.map((row)=>{ const {client,clientAM,revenue,creatorCost,managerCost,managerRate,managerOverridden,salesCost,salesCommissionRate,hasSalesSourced,grossProfit,margin,totalApproved,costPerVideo} = row; return (
                <tr key={client.id}>
                  <td>
                    <div className="fw-600">{client.name}</div>
                    <div style={{fontSize:11,color:"var(--ink3)"}}>{client.deal_type} · {client.status}</div>
                  </td>
                  {isOwner&&<td style={{fontSize:12,color:"var(--ink3)"}}>{clientAM?.name||"—"}<br/><span style={{fontSize:10,color:"var(--ink3)"}}>{clientAM?`${getAMRate(clientAM)*100}%`:"—"}</span></td>}
                  <td className="text-green fw-600">{fmtMoney(revenue)}</td>
                  <td style={{color:"var(--red)"}}>{fmtMoney(creatorCost)}</td>
                  {isOwner&&<td style={{color:"var(--orange)",fontSize:12}}>{fmtMoney(managerCost)}<br/><span style={{fontSize:10,color:"var(--ink3)"}}>{Math.round(managerRate*100)}%{managerOverridden?" · override":""}</span></td>}
                  {isOwner&&<td style={{color:hasSalesSourced?"var(--orange)":"var(--ink3)",fontSize:12}}>{hasSalesSourced?`${fmtMoney(salesCost)} (${Math.round(salesCommissionRate*100)}%)`:"—"}</td>}
                  <td style={{color:grossProfit>=0?"var(--green)":"var(--red)",fontWeight:600}}>{fmtMoney(grossProfit)}</td>
                  <td>
                    <div style={{fontWeight:700,color:marginColor(margin)}}>{margin}%</div>
                    <div style={{width:60,background:"var(--bg2)",borderRadius:4,height:4,marginTop:3}}>
                      <div style={{width:`${Math.min(Math.max(margin,0),100)}%`,background:marginColor(margin),height:4,borderRadius:4}}/>
                    </div>
                  </td>
                  <td style={{fontSize:13}}>{totalApproved}</td>
                  <td style={{fontSize:13,color:"var(--ink3)"}}>{costPerVideo>0?fmtMoney(costPerVideo):"—"}</td>
                  <td>
                    {(()=>{ const r=getRetentionScore(client,db); return (
                      <div>
                        <div style={{fontWeight:600,fontSize:12,color:r.color}}>{r.label}</div>
                        <div style={{fontSize:10,color:"var(--ink3)",marginTop:2}}>{r.desc}</div>
                      </div>
                    ); })()}
                  </td>
                  {isOwner&&<td style={{textAlign:"right"}}><button className="btn btn-sm btn-ghost" onClick={()=>setEditing(row)}>✏️ Edit</button></td>}
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
        {clientData.length===0&&<div className="empty" style={{padding:32}}><div className="empty-icon">📈</div><h3>No clients yet</h3></div>}
      </div>

      {/* Client Retention Predictor */}
      {clientData.length>0&&(
        <div className="premium-card" style={{marginBottom:16}}>
          <div className="card-title">🔮 Client Retention Predictor</div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            {clientData.map(({client})=>{
              const r = getRetentionScore(client, db);
              return (
                <div key={client.id} style={{background:r.bg,border:`1px solid ${r.color}`,borderRadius:"var(--radius-sm)",padding:"10px 14px",minWidth:160}}>
                  <div style={{fontWeight:600,fontSize:13,marginBottom:2}}>{client.name}</div>
                  <div style={{fontWeight:700,fontSize:12,color:r.color}}>{r.label}</div>
                  <div style={{fontSize:11,color:"var(--ink3)",marginTop:2}}>{r.desc}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Revenue Trend Chart */}
      <div className="premium-card" style={{marginTop:16}}>
        <div className="card-title">📈 Revenue Trend (Last 6 Months)</div>
        <RevenueTrendChart db={db} clientData={clientData}/>
      </div>

      {/* Key Insights */}
      {clientData.length>0&&(
        <div className="premium-card" style={{marginTop:16}}>
          <div className="card-title">💡 Key Insights</div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {clientData.sort((a,b)=>b.margin-a.margin).slice(0,1).map(d=>(
              <div key={d.client.id} style={{fontSize:13,padding:"10px 14px",background:"rgba(26,122,74,0.08)",borderRadius:"var(--radius-sm)",borderLeft:"3px solid var(--green)"}}>
                🏆 <strong>{d.client.name}</strong> is your most profitable account at <strong>{d.margin}% margin</strong>
              </div>
            ))}
            {clientData.filter(d=>d.margin<25&&d.revenue>0).map(d=>(
              <div key={d.client.id} style={{fontSize:13,padding:"10px 14px",background:"rgba(220,53,69,0.08)",borderRadius:"var(--radius-sm)",borderLeft:"3px solid var(--red)"}}>
                ⚠️ <strong>{d.client.name}</strong> has a thin margin of <strong>{d.margin}%</strong> — consider repricing or reducing creator costs
              </div>
            ))}
            {totalMargin<30&&totalRevenue>0&&(
              <div style={{fontSize:13,padding:"10px 14px",background:"rgba(255,165,0,0.08)",borderRadius:"var(--radius-sm)",borderLeft:"3px solid var(--gold)"}}>
                📊 Overall agency margin is <strong>{totalMargin}%</strong> — healthy range is 40-60% for a UGC agency
              </div>
            )}
          </div>
        </div>
      )}

      
      {editing&&(
        <ClientFinanceEditor
          row={editing}
          onClose={()=>setEditing(null)}
          onSaved={async()=>{ if (onRefresh) await onRefresh(); setEditing(null); }}
        />
      )}
    </div>
  );
}
