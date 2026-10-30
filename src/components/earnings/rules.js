import { supabase } from "../../supabaseClient";

// Mirrors api/_lib/paymentCalculations.js (the browser can't import the CJS module).
export const BONUS_TIERS = [
  { minViews: 10000000, bonus: 1000, label: "10M views" },
  { minViews: 1000000, bonus: 500, label: "1M views" },
  { minViews: 500000, bonus: 350, label: "500K views" },
  { minViews: 250000, bonus: 250, label: "250K views" },
  { minViews: 100000, bonus: 150, label: "100K views" },
  { minViews: 50000, bonus: 50, label: "50K views" },
];
export const BONUS_ELIGIBILITY_DAYS = 10;
const DAY = 86400000;

export const bonusFor = (views) => BONUS_TIERS.find(t => views >= t.minViews)?.bonus || 0;
export const tierLabel = (views) => BONUS_TIERS.find(t => views >= t.minViews)?.label || null;
export const nextTier = (views) => [...BONUS_TIERS].reverse().find(t => views < t.minViews) || null;
export const daysSince = (postedAt) => (postedAt ? Math.floor((Date.now() - new Date(postedAt).getTime()) / DAY) : null);
export const daysUntilEligible = (postedAt) => (postedAt ? Math.max(0, Math.ceil(BONUS_ELIGIBILITY_DAYS - (Date.now() - new Date(postedAt).getTime()) / DAY)) : BONUS_ELIGIBILITY_DAYS);

// Reads the { ok:false, error:{ code, message } } envelope without rendering "[object Object]".
export function errMessage(json, fallback) {
  if (json?.error && typeof json.error === "object" && json.error.message) return json.error.message;
  if (typeof json?.error === "string" && json.error) return json.error;
  if (typeof json?.message === "string" && json.message) return json.message;
  return fallback;
}

export const EARNING_TYPES = { base_video_pay: "Base pay", performance_bonus: "Performance bonus", bonus: "Bonus", bonus_payment: "Bonus", weekly_rate: "Weekly rate", referral: "Referral", adjustment: "Adjustment", other: "Other" };
export const earningType = (t) => (t ? EARNING_TYPES[t] || t.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase()) : "--");
export const methodLabel = (m) => ({ bank_transfer: "Bank transfer", zelle: "Zelle", stripe: "Stripe" }[m] || m || "--");

export function payoutDestination(creator) {
  if (!creator) return "No payout method on file";
  if (creator.payment_method === "zelle") {
    if (creator.zelle_email) { const e = creator.zelle_email; return `Zelle, ${e.charAt(0)}•••${e.slice(e.indexOf("@"))}`; }
    if (creator.zelle_phone_last4) return `Zelle, phone ending ${creator.zelle_phone_last4}`;
    return "Zelle, no destination on file";
  }
  if (creator.payment_method === "bank_transfer") {
    return creator.bank_account_last4 ? `${creator.bank_name || "Bank"} account ending ${creator.bank_account_last4}` : "Bank transfer, no account on file";
  }
  if (creator.payment_method === "stripe") return "Stripe automatic payouts";
  return "No payout method on file";
}

export async function authed(path, { method = "POST", body } = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${session?.access_token || ""}`, "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}
