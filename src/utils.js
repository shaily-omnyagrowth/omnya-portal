import { Facebook01Icon, InstagramIcon, TiktokIcon, Video01Icon, YoutubeIcon } from "@hugeicons/core-free-icons";

export const EMPTY = "--";

export const getInitials = (name) => (name || "?").trim().split(/\s+/).map(n => n[0]).join("").toUpperCase().slice(0, 2) || "?";

export const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: new Date(d).getFullYear() !== new Date().getFullYear() ? "numeric" : undefined }) : EMPTY;
export const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : EMPTY;

export const fmtMoney = (n, { cents = false } = {}) => {
  if (n == null || Number.isNaN(Number(n))) return EMPTY;
  const v = Number(n), whole = !cents && Number.isInteger(Math.round(v * 100) / 100);
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
};

export const fmtNum = (n) => n != null && !Number.isNaN(Number(n)) ? Number(n).toLocaleString("en-US") : EMPTY;

export const fmtCompactNum = (n) => {
  if (n == null || Number.isNaN(Number(n))) return EMPTY;
  const num = Number(n);
  const abs = Math.abs(num);
  if (abs >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1).replace(/\.0$/, "") + "B";
  if (abs >= 1_000_000) return (num / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (abs >= 10_000) return Math.round(num / 1_000) + "K";
  if (abs >= 1_000) return (num / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return Math.round(num).toLocaleString("en-US");
};

export const fmtPct = (n, digits = 1) => n == null || Number.isNaN(Number(n)) ? EMPTY : `${Number(n).toFixed(digits)}%`;

export const fmtRelativeTime = (d) => {
  if (!d) return "Never";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return EMPTY;
  const diffSec = Math.floor((Date.now() - date) / 1000);
  if (diffSec < 60) return "Just now";
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 60) return "1 mo ago";
  if (days < 365) return `${Math.floor(days / 30)} mo ago`;
  return fmtDate(d);
};

// One status vocabulary for every badge in the portal.
const TONES = {
  Active: "green", Approved: "green", Completed: "green", Current: "green", Paid: "green", paid: "green",
  "Published/Tracked": "green", Connected: "green", approved: "green", eligible: "green",
  Open: "blue", Submitted: "blue", Applied: "blue", "Monthly Retainer": "blue", Retainer: "blue", batched: "blue",
  "In Progress": "orange", "Under Review": "orange", Pending: "orange", pending: "orange", "Revision Requested": "orange",
  "Revisions Needed": "orange", Unpaid: "orange", Trial: "orange", needs_review: "orange", locked: "orange", withdrawal_requested: "orange",
  verified: "green", submitted: "orange", missing: "red", rejected: "red",
  Offboarded: "red", Cancelled: "red", Denied: "red", Declined: "red", Rejected: "red", Overdue: "red", forfeited: "red", cancelled: "red",
  Paused: "gray", Draft: "gray", Archived: "gray", "One-Off": "gray",
};
const LABELS = {
  "Published/Tracked": "Published", "Revision Requested": "Changes requested", "Under Review": "In review",
  needs_review: "Needs review", withdrawal_requested: "Withdrawal requested", "Monthly Retainer": "Retainer", "One-Off": "One off",
};
export const statusTone = (status) => TONES[status] || "gray";
export const statusLabel = (status) => {
  if (!status) return "Unknown";
  const l = LABELS[status] || String(status).replace(/_/g, " ");
  return l.charAt(0).toUpperCase() + l.slice(1).toLowerCase().replace(/\btiktok\b/, "TikTok");
};
export const statusBadge = (status) => (
  <span className={`badge badge-${statusTone(status)}`}><span className="dot" />{statusLabel(status)}</span>
);

export const scoreColor = (s) => s >= 90 ? "var(--green)" : s >= 70 ? "var(--ink)" : s >= 50 ? "var(--amber)" : "var(--red)";

const PLATFORMS = {
  tiktok: { name: "TikTok", icon: TiktokIcon, color: "#0b0b0c" },
  instagram: { name: "Instagram", icon: InstagramIcon, color: "#c13584" },
  youtube: { name: "YouTube", icon: YoutubeIcon, color: "#d9201f" },
  facebook: { name: "Facebook", icon: Facebook01Icon, color: "#1877f2" },
};
export const platformKey = (platform = "") => {
  const p = String(platform || "").toLowerCase();
  if (p.includes("tiktok")) return "tiktok";
  if (p.includes("instagram") || p === "ig") return "instagram";
  if (p.includes("youtube") || p === "yt") return "youtube";
  if (p.includes("facebook") || p === "fb") return "facebook";
  return null;
};
export const platformMeta = (platform = "") => {
  const k = platformKey(platform);
  const m = k ? PLATFORMS[k] : { name: platform ? String(platform) : "Post", icon: Video01Icon, color: "var(--ink2)" };
  return { ...m, key: k, bg: "var(--bg2)", text: "var(--ink)", border: "var(--border)" };
};

export const CAMPAIGN_PLATFORMS = ["TikTok", "Instagram", "YouTube", "Facebook"];
// The platform a campaign is for, by its brand name, or null for an old free-text format.
export const campaignPlatform = (campaign) => {
  const k = platformKey(campaign?.format || "");
  return k ? PLATFORMS[k].name : null;
};

// Platform names in their brand casing; other formats as typed.
export const formatLabel = (format) => {
  if (!format) return "";
  const m = platformMeta(format);
  return m.key && m.key === String(format).toLowerCase() ? m.name : String(format);
};

export const calcPacing = ({ startDate, deadline, videosNeeded = 10, approvedCount = 0 }) => {
  const now = new Date();
  const start = startDate ? new Date(startDate) : new Date();
  const end = deadline ? new Date(deadline) : null;
  const needed = Number(videosNeeded) || 1;
  const delivered = Number(approvedCount) || 0;
  const deliveryPct = Math.min(100, Math.round((delivered / needed) * 100));

  let daysRemaining = null;
  let totalDays = null;
  let elapsedDays = null;
  if (end) {
    const day = 1000 * 60 * 60 * 24;
    daysRemaining = Math.ceil((end.getTime() - now.getTime()) / day);
    totalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / day));
    elapsedDays = Math.max(0, Math.ceil((now.getTime() - start.getTime()) / day));
  }

  const totalWeeks = totalDays ? Math.max(1, Math.ceil(totalDays / 7)) : 4;
  const currentWeek = elapsedDays !== null ? Math.min(totalWeeks, Math.max(1, Math.ceil(elapsedDays / 7))) : 1;
  const expectedPace = Math.min(needed, Math.round((currentWeek / totalWeeks) * needed));

  let paceStatus = "on_track", paceLabel = "On track", paceBadge = "badge-green";
  if (delivered >= needed) { paceStatus = "completed"; paceLabel = "Delivered"; paceBadge = "badge-green"; }
  else if (daysRemaining !== null && daysRemaining < 0) { paceStatus = "overdue"; paceLabel = `Overdue by ${Math.abs(daysRemaining)}d`; paceBadge = "badge-red"; }
  else if (delivered < expectedPace - 1) { paceStatus = "behind"; paceLabel = "Behind pace"; paceBadge = "badge-orange"; }
  else if (delivered > expectedPace) { paceStatus = "ahead"; paceLabel = "Ahead of pace"; paceBadge = "badge-blue"; }

  return { deliveryPct, daysRemaining, totalWeeks, currentWeek, expectedPace, paceStatus, paceLabel, paceBadge, isExpired: daysRemaining !== null && daysRemaining < 0 };
};

export const daysLeftLabel = (deadline) => {
  if (!deadline) return "No deadline";
  const d = Math.ceil((new Date(deadline) - new Date()) / 86400000);
  if (d < 0) return `${Math.abs(d)}d overdue`;
  if (d === 0) return "Due today";
  return `${d}d left`;
};

export const isBreakoutVideo = (views, creatorAvgViews) => {
  const v = Number(views) || 0;
  const avg = Number(creatorAvgViews) || 0;
  return v >= 100_000 || (avg > 1000 && v >= avg * 2.5);
};

// Best available view count for a submission: synced analytics first, then the latest checkpoint.
export const viewsOf = (sub, analytics) =>
  Number(analytics?.views || sub?.views_1m || sub?.views_2w || sub?.views_1w || sub?.views_72h || sub?.views_24h || sub?.views || 0);

export const engagementRate = ({ views, likes = 0, comments = 0 }) =>
  views > 0 ? ((Number(likes) + Number(comments)) / views) * 100 : 0;
