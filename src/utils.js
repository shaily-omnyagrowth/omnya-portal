import React from 'react';

/**
 * Shared utility functions for Omnya Portal
 */

export const avatarColors = ["av-blue","av-green","av-gold","av-orange","av-red"];

export const getAvatarColor = (name) => avatarColors[(name||"?").charCodeAt(0) % avatarColors.length];

export const getInitials = (name) => (name||"?").split(" ").map(n=>n[0]).join("").toUpperCase().slice(0,2);

export const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-US",{month:"short",day:"numeric"}) : "—";

export const fmtMoney = (n) => n != null ? `$${Number(n).toLocaleString()}` : "—";

export const fmtNum = (n) => n != null ? Number(n).toLocaleString() : "—";

export const statusBadge = (status) => {
  const map = {Active:"badge-green",Paused:"badge-gray",Offboarded:"badge-red",Open:"badge-blue","In Progress":"badge-orange",Completed:"badge-green",Cancelled:"badge-red",Pending:"badge-orange",Approved:"badge-green",Denied:"badge-red","Revisions Needed":"badge-gold",Current:"badge-green",Overdue:"badge-red",Paid:"badge-green",Unpaid:"badge-orange",Trial:"badge-gold","Monthly Retainer":"badge-blue","One-Off":"badge-gray"};
  return <span className={`badge ${map[status]||"badge-gray"}`}>{status}</span>;
};

export const scoreColor = (s) => s >= 90 ? "#1A7A4A" : s >= 70 ? "#9A7A00" : s >= 50 ? "#C25A00" : "#C0392B";

export const fmtCompactNum = (n) => {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const num = Number(n);
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return num.toLocaleString();
};

export const fmtRelativeTime = (d) => {
  if (!d) return "Never";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 60) return "1 mo ago";
  return `${Math.floor(diffDays / 30)} mos ago`;
};

export const platformMeta = (platform = "") => {
  const p = (platform || "").toLowerCase();
  if (p.includes("tiktok")) {
    return { name: "TikTok", icon: "🎵", color: "#000000", bg: "#f1f1f2", text: "#000", border: "#e0e0e2" };
  }
  if (p.includes("instagram") || p.includes("ig")) {
    return { name: "Instagram", icon: "📸", color: "#E1306C", bg: "#fdf2f6", text: "#C13584", border: "#fbcfe8" };
  }
  if (p.includes("youtube") || p.includes("yt")) {
    return { name: "YouTube", icon: "▶️", color: "#FF0000", bg: "#fef2f2", text: "#dc2626", border: "#fecaca" };
  }
  if (p.includes("facebook") || p.includes("fb")) {
    return { name: "Facebook", icon: "👥", color: "#1877F2", bg: "#eff6ff", text: "#1d4ed8", border: "#bfdbfe" };
  }
  return { name: platform || "Post", icon: "🎬", color: "#4f46e5", bg: "#eef2ff", text: "#4338ca", border: "#c7d2fe" };
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
    const diffTime = end.getTime() - now.getTime();
    daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    totalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
    elapsedDays = Math.max(0, Math.ceil((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
  }

  const totalWeeks = totalDays ? Math.max(1, Math.ceil(totalDays / 7)) : 4;
  const currentWeek = elapsedDays !== null ? Math.min(totalWeeks, Math.max(1, Math.ceil(elapsedDays / 7))) : 1;

  const expectedPace = Math.min(needed, Math.round((currentWeek / totalWeeks) * needed));
  let paceStatus = "on_track";
  let paceLabel = "On Track";
  let paceBadge = "badge-green";

  if (delivered >= needed) {
    paceStatus = "completed";
    paceLabel = "Completed";
    paceBadge = "badge-green";
  } else if (daysRemaining !== null && daysRemaining < 0) {
    paceStatus = "overdue";
    paceLabel = `Overdue by ${Math.abs(daysRemaining)}d`;
    paceBadge = "badge-red";
  } else if (delivered < expectedPace - 1) {
    paceStatus = "behind";
    paceLabel = "Behind Pace";
    paceBadge = "badge-orange";
  } else if (delivered > expectedPace) {
    paceStatus = "ahead";
    paceLabel = "Ahead of Pace";
    paceBadge = "badge-blue";
  }

  return {
    deliveryPct,
    daysRemaining,
    totalWeeks,
    currentWeek,
    expectedPace,
    paceStatus,
    paceLabel,
    paceBadge,
    isExpired: daysRemaining !== null && daysRemaining < 0
  };
};

export const isBreakoutVideo = (views, creatorAvgViews) => {
  const v = Number(views) || 0;
  const avg = Number(creatorAvgViews) || 0;
  if (v >= 100_000) return true;
  if (avg > 1000 && v >= avg * 2.5) return true;
  return false;
};

