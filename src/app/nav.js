import {
  Analytics01Icon, Award01Icon, Briefcase01Icon, Building03Icon, ChartBarLineIcon, ChartLineData01Icon,
  ClipboardIcon, DashboardSquare02Icon, Film01Icon, Folder01Icon, JusticeScale01Icon, Link01Icon,
  Megaphone01Icon, PlayListIcon, Settings02Icon, TaskDone01Icon, Upload04Icon, UserAdd01Icon,
  UserGroupIcon, UserSettings01Icon, Video01Icon, Wallet01Icon,
} from "@hugeicons/core-free-icons";

export const roleLabel = { creator: "Creator", am: "Account manager", account_manager: "Account manager", owner: "Owner", client: "Brand" };

// Title and one line of guidance for every page; nav labels read from here so they always agree.
export const pages = {
  dashboard: { title: "Overview", icon: DashboardSquare02Icon },
  "social-connections": { title: "Social channels", icon: Link01Icon, desc: "Connect the accounts you post from so views are verified automatically." },
  jobs: { title: "Find jobs", icon: Briefcase01Icon, desc: "Open campaigns you can apply to. Pick the ones that fit your audience." },
  "active-jobs": { title: "Active projects", icon: Folder01Icon, desc: "Campaigns you are booked on, with briefs, deadlines and the team thread." },
  submit: { title: "Submit content", icon: Upload04Icon, desc: "Send a concept for approval first, then the final posted link." },
  submissions: { title: "Submissions", icon: Film01Icon, desc: "Everything you have sent and where it is in review." },
  insights: { title: "Video insights", icon: ChartBarLineIcon, desc: "How your approved videos are performing over time." },
  "payout-manager": { title: "Payments", icon: Wallet01Icon },
  settings: { title: "Settings", icon: Settings02Icon, desc: "Your profile and sign in details." },
  legal: { title: "Legal center", icon: JusticeScale01Icon, desc: "Our terms, privacy policy and how to delete your data." },
  "review-queue": { title: "Review queue", icon: TaskDone01Icon, desc: "Approve concepts and final videos, or send them back with notes." },
  "my-creators": { title: "Creators", icon: UserGroupIcon, desc: "The creators you manage, their rates and recent activity." },
  campaigns: { title: "Campaigns", icon: Megaphone01Icon, desc: "Briefs, deliverables and pacing for every campaign." },
  clients: { title: "Clients", icon: Building03Icon, desc: "Brands you look after, their budgets and delivery." },
  "clients-full": { title: "Clients", icon: Building03Icon, desc: "Every brand on the platform, their budgets, account managers and status." },
  "content-library": { title: "Content library", icon: Video01Icon, desc: "Every delivered video across campaigns, with live performance." },
  analytics: { title: "Analytics", icon: Analytics01Icon, desc: "Views, engagement and top performers across your campaigns." },
  revenue: { title: "Revenue", icon: ChartLineData01Icon, desc: "Budget, creator cost and margin per client." },
  "creator-performance": { title: "Creator performance", icon: Award01Icon, desc: "Scores and tiers from delivery, approval rate and views." },
  "pending-users": { title: "Approvals", icon: UserAdd01Icon, desc: "New sign ups waiting for a role. They can't use the portal until you assign one." },
  "user-management": { title: "Users", icon: UserSettings01Icon, desc: "Every account, its role and status. Deactivating signs a user out everywhere." },
  "creators-manage": { title: "Creators", icon: UserGroupIcon, desc: "All creators and account managers, their assignments and rates." },
  team: { title: "Team performance", icon: Analytics01Icon, desc: "Account manager workload, client satisfaction and creator output." },
  audit: { title: "Audit history", icon: ClipboardIcon, desc: "Every privileged action, who took it and when." },
  "system-config": { title: "System config", icon: Settings02Icon, desc: "Integration keys and migration status for this deployment." },
  "content-gallery": { title: "Delivered content", icon: PlayListIcon, desc: "Every video delivered for your campaigns." },
};

const item = (id, extra) => ({ id, label: pages[id].title, icon: pages[id].icon, ...extra });

export const navGroups = {
  creator: [
    { items: [item("dashboard")] },
    { label: "Work", items: [item("jobs"), item("active-jobs"), item("submit"), item("submissions")] },
    { label: "Growth", items: [item("insights"), item("social-connections")] },
    { label: "Money", items: [item("payout-manager")] },
  ],
  am: [
    { items: [item("dashboard")] },
    { label: "Work", items: [item("review-queue"), item("campaigns"), item("content-library")] },
    { label: "Relationships", items: [item("my-creators"), item("clients")] },
    { label: "Insights", items: [item("analytics"), item("revenue"), item("creator-performance")] },
    { label: "Money", items: [item("payout-manager", { label: "Payouts", requires: "payouts" })] },
  ],
  owner: [
    { items: [item("dashboard")] },
    { label: "Work", items: [item("review-queue"), item("campaigns"), item("content-library"), item("submit", { label: "Submit for a creator" })] },
    { label: "People", items: [item("pending-users"), item("user-management"), item("clients-full"), item("creators-manage"), item("team"), item("creator-performance")] },
    { label: "Money", items: [item("revenue"), item("payout-manager", { label: "Payouts" })] },
    { label: "System", items: [item("audit"), item("system-config")] },
  ],
  client: [
    { items: [item("dashboard"), item("campaigns"), item("content-gallery"), item("analytics", { label: "Video insights" })] },
  ],
};

// Pages reachable by role but kept out of the sidebar.
const hidden = { creator: ["legal", "settings"], am: ["legal", "settings"], owner: ["legal", "settings"], client: ["legal", "settings"] };

export const navs = Object.fromEntries(Object.entries(navGroups).map(([role, groups]) => [
  role,
  [...groups.flatMap(g => g.items), ...(hidden[role] || []).map(id => item(id))],
]));

// Display filter only: RLS and api/_lib/paymentPermissions.js still authorize every request.
export function navsFor(role, caps) {
  return (navGroups[role] || [])
    .map(g => ({ ...g, items: g.items.filter(i => !i.requires || !!(caps && caps[i.requires])) }))
    .filter(g => g.items.length);
}

export function titleFor(role, page) {
  const entry = (navs[role] || []).find(i => i.id === page);
  return entry?.label || pages[page]?.title || "Overview";
}
