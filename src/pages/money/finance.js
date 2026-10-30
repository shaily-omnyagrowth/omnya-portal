const LIVE = new Set(["Approved", "Published/Tracked"]);

// Healthy needs a 40% margin, steady output and a live campaign; under 25% or idle with history is at risk.
export function health(client, db) {
  const camps = db.campaigns.filter(c => c.client_id === client.id);
  const approved = db.submissions.filter(s => camps.some(c => c.id === s.campaign_id) && LIVE.has(s.status));
  const now = new Date();
  const m0 = new Date(now.getFullYear(), now.getMonth(), 1), m1 = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const thisMonth = approved.filter(s => new Date(s.created_at) >= m0).length;
  const lastMonth = approved.filter(s => new Date(s.created_at) >= m1 && new Date(s.created_at) < m0).length;
  const revenue = Number(client.budget || 0);
  const cost = approved.reduce((t, s) => t + Number(camps.find(c => c.id === s.campaign_id)?.pay_per_video || 0), 0);
  const margin = revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : 0;
  const trend = lastMonth === 0 ? (thisMonth > 0 ? "up" : "flat") : thisMonth > lastMonth ? "up" : thisMonth === lastMonth ? "flat" : "down";
  const live = camps.some(c => c.status === "In Progress" || c.status === "Open");
  if (margin >= 40 && trend !== "down" && live) return { tone: "green", label: "Healthy", why: "Good margin and steady output" };
  if (margin >= 25 && trend === "down") return { tone: "orange", label: "Watch", why: "Output is slowing" };
  if (margin < 25 || (!live && approved.length > 0)) return { tone: "red", label: "At risk", why: !live && approved.length ? "No live campaign" : "Thin margin" };
  return { tone: "orange", label: "Watch", why: "Not enough data yet" };
}

// One manager commission: the AM's rate unless a campaign overrides it (highest override wins per client).
export function clientFinance(c, db) {
  const am = db.accountManagers.find(a => a.id === c.am_id);
  const camps = db.campaigns.filter(x => x.client_id === c.id);
  const approvedBy = (camp) => db.submissions.filter(s => s.campaign_id === camp.id && LIVE.has(s.status)).length;
  const creatorCost = camps.reduce((t, camp) => t + approvedBy(camp) * Number(camp.pay_per_video || 0), 0);
  const revenue = Number(c.budget || 0);
  const sales = camps.filter(x => x.is_sales_sourced);
  const salesCommissionRate = sales.length ? Math.max(...sales.map(x => Number(x.sales_commission_rate ?? 0.30))) : 0;
  const salesCost = revenue * salesCommissionRate;
  const overrides = camps.filter(x => x.manager_commission_rate != null).map(x => Number(x.manager_commission_rate));
  const managerRate = overrides.length ? Math.max(...overrides) : Number(am?.commission_rate || 0.10);
  const managerCost = revenue * managerRate;
  const grossProfit = revenue - creatorCost - salesCost - managerCost;
  const totalApproved = camps.reduce((t, x) => t + approvedBy(x), 0);
  return {
    client: c, clientAM: am, clientCampaigns: camps, managerOverridden: overrides.length > 0, revenue, creatorCost,
    amCost: managerCost, amRate: managerRate, managerCost, managerRate, salesCost, salesCommissionRate, hasSalesSourced: sales.length > 0,
    grossProfit, margin: revenue > 0 ? Math.round((grossProfit / revenue) * 100) : 0, totalApproved,
    costPerVideo: totalApproved ? Math.round((creatorCost + salesCost + managerCost) / totalApproved) : 0, campaigns: camps.length,
    health: health(c, db),
  };
}
