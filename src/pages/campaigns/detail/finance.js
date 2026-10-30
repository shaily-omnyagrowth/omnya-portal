const LIVE = new Set(["Approved", "Published/Tracked"]);

// One manager commission: campaigns.manager_commission_rate overrides the AM's own rate; NULL inherits it.
export function campaignFinance({ campaign, db, client, isSalesSourced, salesRate, managerRate }) {
  const am = db.accountManagers.find(a => a.id === client?.am_id);
  const subs = db.submissions.filter(s => s.campaign_id === campaign.id);
  const approvedSubs = subs.filter(s => LIVE.has(s.status));
  const approved = approvedSubs.length;
  const revenue = Number(client?.budget || 0);
  const activeSalesRate = isSalesSourced ? Number(salesRate || 0.30) : 0;
  const amDefaultRate = Number(am?.commission_rate ?? 0.10);
  const activeMgrRate = managerRate == null ? amDefaultRate : Number(managerRate);
  const salesCost = revenue * activeSalesRate;
  const managerCost = revenue * activeMgrRate;
  const creatorCost = approved * Number(campaign.pay_per_video || 0);
  const grossProfit = revenue - (salesCost + managerCost + creatorCost);
  const margin = revenue > 0 ? Math.round((grossProfit / revenue) * 100) : 0;
  const needed = Number(campaign.videos_needed || 0);
  const costPerVideo = needed > 0 ? Math.round(((needed * Number(campaign.pay_per_video || 0)) + managerCost + salesCost) / needed) : 0;

  // CPM uses the same formula as the brand portal: budget over the latest pull per submission.
  const ids = new Set(subs.map(s => s.id));
  const latest = {};
  (db.analytics || []).forEach(a => {
    if (!ids.has(a.submission_id)) return;
    if (!latest[a.submission_id] || new Date(a.pulled_at || 0) > new Date(latest[a.submission_id].pulled_at || 0)) latest[a.submission_id] = a;
  });
  const views = Object.values(latest).reduce((t, a) => t + Number(a.views || 0), 0);
  const cpm = revenue > 0 && views > 0 ? (revenue / views) * 1000 : null;

  const now = new Date();
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0, 0, 0, 0);
  const lastWeekStart = new Date(weekStart); lastWeekStart.setDate(weekStart.getDate() - 7);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const at = s => new Date(s.approved_date || s.created_at);
  const thisWeek = approvedSubs.filter(s => at(s) >= weekStart).length;
  const lastWeek = approvedSubs.filter(s => at(s) >= lastWeekStart && at(s) < weekStart).length;
  const thisMonth = approvedSubs.filter(s => at(s) >= monthStart).length;
  const stale = subs.filter(s => (s.status === "Submitted" || s.status === "Under Review") && Date.now() - new Date(s.created_at).getTime() > 3 * 86400000);

  // Weekly approvals over the flight, for the delivery chart.
  const start = new Date(campaign.start_date || campaign.created_at);
  const weeks = Math.max(1, Math.min(26, Math.ceil((Math.max(Date.now(), campaign.deadline ? new Date(campaign.deadline).getTime() : 0) - start.getTime()) / (7 * 86400000))));
  let running = 0;
  const burnup = Array.from({ length: weeks }, (_, i) => {
    const end = new Date(start.getTime() + (i + 1) * 7 * 86400000);
    running = approvedSubs.filter(s => at(s) < end).length;
    return { label: `W${i + 1}`, value: end > now && i > 0 && end - now > 7 * 86400000 ? null : running };
  }).filter(p => p.value != null);

  return { approved, revenue, salesCost, managerCost, creatorCost, grossProfit, margin, costPerVideo, cpm, views, activeSalesRate, activeMgrRate, amDefaultRate, thisWeek, lastWeek, thisMonth, stale, burnup, am };
}
