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
