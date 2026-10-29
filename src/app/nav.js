export const roleLabel = { creator: "Creator Portal", am: "Account Manager", account_manager: "Account Manager", owner: "Owner", client: "Client Portal" };

export const navs = {
  creator: [
    {id:"dashboard",icon:"🏠",label:"Dashboard"},
    {id:"social-connections",icon:"🔗",label:"Social Channels"},
    {id:"jobs",icon:"🧭",label:"Available Jobs"},
    {id:"active-jobs",icon:"🎯",label:"Active Projects"},
    {id:"submit",icon:"⬆️",label:"Submit Content"},
    {id:"submissions",icon:"🎬",label:"My Submissions"},
    {id:"insights",icon:"📊",label:"Video Insights"},
    {id:"payout-manager",icon:"💳",label:"Payments"},
    {id:"legal",icon:"⚖️",label:"Legal Center"},
  ],
  am: [
    {id:"dashboard",icon:"🏠",label:"Dashboard"},
    {id:"review-queue",icon:"✅",label:"Review Queue"},
    {id:"my-creators",icon:"👥",label:"My Creators"},
    {id:"campaigns",icon:"📢",label:"Campaigns"},
    {id:"clients",icon:"🏢",label:"My Clients"},
    {id:"content-library",icon:"🎬",label:"Content Library"},
    {id:"analytics",icon:"📊",label:"Analytics"},
    {id:"revenue",icon:"📈",label:"Revenue"},
    {id:"creator-performance",icon:"🏆",label:"Creator Performance"},
    {id:"payout-manager",icon:"💸",label:"Payments",requires:"payouts"},
    {id:"legal",icon:"⚖️",label:"Legal Center"},
  ],
  owner: [
    {id:"dashboard",icon:"🏠",label:"Dashboard"},
    {id:"pending-users",icon:"🔔",label:"Approve Users"},
    {id:"user-management",icon:"👤",label:"User Management"},
    {id:"clients-full",icon:"🏢",label:"Client Management"},
    {id:"creators-manage",icon:"🎬",label:"Manage Creators"},
    {id:"revenue",icon:"📈",label:"Revenue Analytics"},
    {id:"payout-manager",icon:"💸",label:"Payment Management"},
    {id:"team",icon:"👥",label:"Team Performance"},
    {id:"creator-performance",icon:"🏆",label:"Creator Performance"},
    {id:"review-queue",icon:"✅",label:"Review Queue"},
    {id:"campaigns",icon:"📢",label:"All Campaigns"},
    {id:"content-library",icon:"🎬",label:"Content Library"},
    // §5.2 "Submit content: Owner Override/support"
    {id:"submit",icon:"⬆️",label:"Submit for Creator"},
    // §5.2 grants the owner "View audit history: Yes"; the events were being
    // written all along with nothing to display them.
    {id:"audit",icon:"📜",label:"Audit History"},
    {id:"system-config",icon:"⚙️",label:"System Config"},
    {id:"legal",icon:"⚖️",label:"Legal Center"},
  ],
  client: [
    {id:"dashboard",icon:"🏠",label:"Brand Insights"},
    {id:"campaigns",icon:"📢",label:"Campaign Overview"},
    {id:"content-gallery",icon:"🎬",label:"Delivered Content"},
    {id:"analytics",icon:"📊",label:"Video Insights"},
  ],
};

// Nav entries may declare `requires`, naming a capability the caller has to
// hold. This is a *display* filter only — it hides a door the user cannot open
// so they are not offered a page that will only tell them no. The actual
// authorization lives in RLS and in api/_lib/paymentPermissions.js, and both
// still run regardless of what the sidebar shows.
//
// caps.payouts comes from the is_payment_manager('can_view_payouts') RPC, so
// the answer is the database's, not the browser's.
export function navsFor(role, caps) {
  return (navs[role] || []).filter(item => !item.requires || !!(caps && caps[item.requires]));
}
