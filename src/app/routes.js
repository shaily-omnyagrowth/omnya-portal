import React from "react";

const lazy = (load, name) => React.lazy(() => load().then(m => ({ default: name ? m[name] : m.default })));

const P = {
  Legal: lazy(() => import("../pages/Legal")),
  CreatorDashboard: lazy(() => import("../pages/CreatorDashboard")),
  ClientOverview: lazy(() => import("../pages/client/ClientOverview")),
  ClientCampaigns: lazy(() => import("../pages/client/ClientCampaigns")),
  ClientContent: lazy(() => import("../pages/client/ClientContent")),
  ClientVideoInsights: lazy(() => import("../pages/ClientVideoInsights")),
  CreatorConnections: lazy(() => import("../pages/CreatorConnections")),
  CreatorEarnings: lazy(() => import("../components/CreatorEarnings")),
  PayoutManager: lazy(() => import("../components/PayoutManager")),
  UserManagement: lazy(() => import("../pages/UserManagement")),
  AMDashboard: lazy(() => import("../pages/am/AMDashboard")),
  CampaignsPage: lazy(() => import("../pages/campaigns/CampaignsPage")),
  ClientsPage: lazy(() => import("../pages/clients/ClientsPage")),
  Analytics: lazy(() => import("../pages/content/Analytics")),
  ContentLibrary: lazy(() => import("../pages/content/ContentLibrary")),
  CreatorActiveJobs: lazy(() => import("../pages/creator/CreatorActiveJobs")),
  CreatorInsights: lazy(() => import("../pages/creator/CreatorInsights")),
  JobBoard: lazy(() => import("../pages/creator/JobBoard")),
  MySubmissions: lazy(() => import("../pages/creator/MySubmissions")),
  SubmitContent: lazy(() => import("../pages/creator/SubmitContent")),
  RevenueAnalytics: lazy(() => import("../pages/money/RevenueAnalytics")),
  OwnerDashboard: lazy(() => import("../pages/owner/OwnerDashboard")),
  CreatorPerformance: lazy(() => import("../pages/people/CreatorPerformance")),
  CreatorsManage: lazy(() => import("../pages/people/CreatorsManage")),
  MyCreators: lazy(() => import("../pages/people/MyCreators")),
  PendingUsers: lazy(() => import("../pages/people/PendingUsers")),
  TeamPerformance: lazy(() => import("../pages/people/TeamPerformance")),
  ReviewQueue: lazy(() => import("../pages/review/ReviewQueue")),
  Settings: lazy(() => import("../pages/Settings")),
};

// [component, props, skeleton variant] per role and page.
export function routeFor(role, page, ctx) {
  const { user, db, loadDB, setPage, setUser } = ctx;
  const settings = [P.Settings, { user, db, setUser, onRefresh: loadDB, onNavigate: setPage }, "detail"];
  const common = { user, db, onRefresh: loadDB };
  const table = {
    client: {
      dashboard: [P.ClientOverview, { user, db, onNavigate: setPage }, "dashboard"],
      campaigns: [P.ClientCampaigns, { user, db }, "cards"],
      "content-gallery": [P.ClientContent, { user, db }, "cards"],
      analytics: [P.ClientVideoInsights, {}, "table"],
      legal: [P.Legal, {}, "detail"],
      settings,
    },
    creator: {
      dashboard: [P.CreatorDashboard, { user, db, onNavigate: setPage }, "dashboard"],
      jobs: [P.JobBoard, common, "cards"],
      "active-jobs": [P.CreatorActiveJobs, { user, db, onNavigate: setPage }, "list"],
      submit: [P.SubmitContent, { ...common, setPage }, "detail"],
      submissions: [P.MySubmissions, { user, db, onNavigate: setPage }, "list"],
      "social-connections": [P.CreatorConnections, { currentUser: user }, "cards"],
      "payout-manager": [P.CreatorEarnings, { user, db }, "table"],
      insights: [P.CreatorInsights, { user, db, onNavigate: setPage, onRefresh: loadDB }, "detail"],
      legal: [P.Legal, {}, "detail"],
      settings,
    },
    am: {
      dashboard: [P.AMDashboard, { user, db, setPage }, "dashboard"],
      "review-queue": [P.ReviewQueue, common, "list"],
      "my-creators": [P.MyCreators, common, "table"],
      campaigns: [P.CampaignsPage, { ...common, isOwner: false }, "table"],
      clients: [P.ClientsPage, { ...common, isOwner: false }, "table"],
      "content-library": [P.ContentLibrary, common, "cards"],
      analytics: [P.Analytics, { db }, "dashboard"],
      revenue: [P.RevenueAnalytics, { ...common, isOwner: false }, "dashboard"],
      "creator-performance": [P.CreatorPerformance, { ...common, isOwner: false }, "table"],
      "payout-manager": [P.PayoutManager, {}, "table"],
      legal: [P.Legal, {}, "detail"],
      settings,
    },
    owner: {
      dashboard: [P.OwnerDashboard, { db, setPage }, "dashboard"],
      "clients-full": [P.ClientsPage, { ...common, isOwner: true }, "table"],
      revenue: [P.RevenueAnalytics, { ...common, isOwner: true }, "dashboard"],
      "creator-performance": [P.CreatorPerformance, { ...common, isOwner: true }, "table"],
      "payout-manager": [P.PayoutManager, {}, "dashboard"],
      team: [P.TeamPerformance, { db, onRefresh: loadDB, onNavigate: setPage }, "list"],
      "pending-users": [P.PendingUsers, { onRefresh: loadDB }, "list"],
      "user-management": [P.UserManagement, { currentUser: user, onRefresh: loadDB }, "table"],
      submit: [P.SubmitContent, { ...common, setPage, isOverride: true }, "detail"],
      "creators-manage": [P.CreatorsManage, common, "table"],
      "review-queue": [P.ReviewQueue, common, "list"],
      campaigns: [P.CampaignsPage, { ...common, isOwner: true }, "table"],
      "content-library": [P.ContentLibrary, common, "cards"],
      legal: [P.Legal, {}, "detail"],
      settings,
    },
  };
  return table[role]?.[page] || null;
}

export function skeletonFor(role, page) {
  return routeFor(role, page, { user: null, db: null, loadDB: null, setPage: null })?.[2] || "dashboard";
}
