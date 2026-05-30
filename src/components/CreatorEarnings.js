/* eslint-disable */
import { useState, useEffect, useRef, useCallback } from "react";
import React from "react";
import { supabase } from "../supabaseClient";
import { fmtDate, fmtMoney, fmtNum, statusBadge } from "../utils";
import LoadingSpinner from "./LoadingSpinner";

// ---------------------------------------------------------------------------
// Bonus calculation logic (inlined from api/_lib/paymentCalculations.js)
// Cannot import Node CJS modules directly in the React app.
// ---------------------------------------------------------------------------

const BONUS_TIERS = [
  { minViews: 10000000, bonus: 1000, label: "10M+ views" },
  { minViews: 1000000,  bonus: 500,  label: "1M views"   },
  { minViews: 500000,   bonus: 350,  label: "500K views" },
  { minViews: 250000,   bonus: 250,  label: "250K views" },
  { minViews: 100000,   bonus: 150,  label: "100K views" },
  { minViews: 50000,    bonus: 50,   label: "50K views"  },
];

const BONUS_ELIGIBILITY_DAYS = 10;

function calculateBonusByViews(views) {
  for (const tier of BONUS_TIERS) {
    if (views >= tier.minViews) return tier.bonus;
  }
  return 0;
}

function getBonusTierLabel(views) {
  for (const tier of BONUS_TIERS) {
    if (views >= tier.minViews) return tier.label;
  }
  return null;
}

function isBonusEligible(postedAt) {
  if (!postedAt) return false;
  const ms = BONUS_ELIGIBILITY_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - new Date(postedAt).getTime() >= ms;
}

function getDaysSincePosting(postedAt) {
  if (!postedAt) return null;
  const ms = Date.now() - new Date(postedAt).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function getDaysUntilEligible(postedAt) {
  if (!postedAt) return BONUS_ELIGIBILITY_DAYS;
  const ms = Date.now() - new Date(postedAt).getTime();
  const daysElapsed = ms / (24 * 60 * 60 * 1000);
  return Math.max(0, Math.ceil(BONUS_ELIGIBILITY_DAYS - daysElapsed));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt2(n) {
  return n != null ? `$${Number(n).toFixed(2)}` : "$0.00";
}

function fmtTypeName(type) {
  const map = {
    base_video_pay:   "Base Pay",
    bonus:            "Bonus",
    bonus_payment:    "Bonus",
    referral:         "Referral",
    adjustment:       "Adjustment",
    withdrawal:       "Withdrawal",
  };
  if (!type) return "—";
  return map[type] || type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function PaymentMethodBadge({ status }) {
  const map = {
    missing:   { bg: "rgba(192,57,43,0.10)", color: "var(--red)",   label: "Missing"   },
    submitted: { bg: "rgba(154,122,0,0.12)", color: "#9a7a00",      label: "Submitted" },
    verified:  { bg: "rgba(26,122,74,0.10)", color: "var(--green)", label: "Verified"  },
  };
  const s = map[(status || "missing").toLowerCase()] || map.missing;
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 10px",
      borderRadius: 99,
      fontSize: 12,
      fontWeight: 600,
      background: s.bg,
      color: s.color,
    }}>
      {s.label}
    </span>
  );
}

function WithdrawalStatusBadge({ status }) {
  const map = {
    pending:   { bg: "rgba(154,122,0,0.12)", color: "#9a7a00",      label: "Pending"   },
    approved:  { bg: "rgba(26,122,74,0.10)", color: "var(--green)", label: "Approved"  },
    rejected:  { bg: "rgba(192,57,43,0.10)", color: "var(--red)",   label: "Rejected"  },
    paid:      { bg: "rgba(26,122,74,0.10)", color: "var(--green)", label: "Paid"      },
    cancelled: { bg: "rgba(100,100,100,0.10)", color: "var(--ink3)", label: "Cancelled" },
  };
  const s = map[(status || "pending").toLowerCase()] || map.pending;
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 10px",
      borderRadius: 99,
      fontSize: 12,
      fontWeight: 600,
      background: s.bg,
      color: s.color,
    }}>
      {s.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CreatorEarnings({ user, db }) {
  // ---- Summary state ----
  const [summary, setSummary]             = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryErr, setSummaryErr]       = useState("");

  // ---- Creator record (from db prop) ----
  const creator = db.creators.find(c => c.user_id === user.id || c.email === user.email);

  // ---- Payment method form ----
  const [pmFormOpen, setPmFormOpen]         = useState(false);
  const [pmMethod, setPmMethod]             = useState("bank_transfer");
  const [bankName, setBankName]             = useState("");
  const [bankLast4, setBankLast4]           = useState("");
  const [bankNotes, setBankNotes]           = useState("");
  const [zelleEmail, setZelleEmail]         = useState("");
  const [zelleLast4, setZelleLast4]         = useState("");
  const [pmWorking, setPmWorking]           = useState(false);
  const [pmMsg, setPmMsg]                   = useState({ text: "", type: "" });
  const pmFormRef = useRef(null);

  // ---- Stripe Connect ----
  const [stripeStatus, setStripeStatus]     = useState(null);   // null | object
  const [stripeLoading, setStripeLoading]   = useState(false);

  // ---- Withdrawal modal ----
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawWorking, setWithdrawWorking]     = useState(false);
  const [withdrawMsg, setWithdrawMsg]             = useState({ text: "", type: "" });

  // ---- Bonus submissions ----
  const [bonusSubs, setBonusSubs]         = useState([]);
  const [bonusLoading, setBonusLoading]   = useState(true);
  const [bonusErr, setBonusErr]           = useState("");
  // Per-submission edits: { [subId]: { postedUrl, postedAt, viewCount } }
  const [subEdits, setSubEdits]           = useState({});
  const [subSaving, setSubSaving]         = useState({});
  const [subMsg, setSubMsg]               = useState({});

  // ---- Withdrawal history ----
  const [withdrawHistory, setWithdrawHistory]   = useState([]);
  const [withdrawHistLoading, setWithdrawHistLoading] = useState(true);
  const [withdrawHistErr, setWithdrawHistErr]   = useState("");

  // ----------------------------------------------------------------
  // Fetch earnings summary (direct Supabase — works without vercel dev)
  // ----------------------------------------------------------------
  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryErr("");
    if (!creator?.id) {
      setSummaryLoading(false);
      return;
    }
    try {
      const creatorId = creator.id;

      const { data: earnings, error: earningsErr } = await supabase
        .from("creator_earnings")
        .select("*")
        .eq("creator_id", creatorId)
        .order("created_at", { ascending: false });
      if (earningsErr) throw earningsErr;

      const earningsRows = earnings || [];
      const pendingStatuses = new Set(["pending", "eligible", "needs_review"]);
      let availableBalance = 0;
      let pendingBalance = 0;
      let withdrawalRequestedBalance = 0;
      let paidBalance = 0;

      for (const row of earningsRows) {
        const amount = parseFloat(row.amount) || 0;
        if (row.status === "approved") availableBalance += amount;
        else if (pendingStatuses.has(row.status)) pendingBalance += amount;
        else if (row.status === "withdrawal_requested") withdrawalRequestedBalance += amount;
        else if (row.status === "paid") paidBalance += amount;
      }

      const { data: lastRequest, error: requestErr } = await supabase
        .from("withdrawal_requests")
        .select("created_at")
        .eq("creator_id", creatorId)
        .not("status", "in", '("rejected","cancelled")')
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (requestErr) throw requestErr;

      const lastDate = lastRequest?.created_at ? new Date(lastRequest.created_at) : null;
      const cooldownMs = 14 * 24 * 60 * 60 * 1000;
      const canWithdraw = !lastDate || (Date.now() - lastDate.getTime()) >= cooldownMs;
      const nextWithdrawalDate = lastDate
        ? new Date(lastDate.getTime() + cooldownMs).toISOString()
        : null;

      setSummary({
        availableBalance,
        pendingBalance,
        withdrawalRequestedBalance,
        paidBalance,
        canRequestWithdrawal: canWithdraw,
        nextWithdrawalDate,
        earnings: earningsRows,
      });
    } catch (err) {
      setSummaryErr(err.message);
    } finally {
      setSummaryLoading(false);
    }
  }, [creator?.id]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  // ----------------------------------------------------------------
  // Fetch bonus-eligible submissions (final approved, from supabase)
  // ----------------------------------------------------------------
  useEffect(() => {
    if (!creator) { setBonusLoading(false); return; }
    async function fetchBonusSubs() {
      setBonusLoading(true);
      setBonusErr("");
      try {
        const { data, error } = await supabase
          .from("submissions")
          .select("*, campaigns(name, client_id)")
          .eq("creator_id", creator.id)
          .eq("final_status", "Approved")
          .order("created_at", { ascending: false });
        if (error) throw error;
        setBonusSubs(data || []);
        // seed edits with current values
        const init = {};
        (data || []).forEach(s => {
          init[s.id] = {
            postedUrl:  s.posted_url  || "",
            postedAt:   s.posted_at   ? s.posted_at.slice(0, 10) : "",
            viewCount:  s.view_count_submitted != null ? String(s.view_count_submitted) : "",
          };
        });
        setSubEdits(init);
      } catch (err) {
        setBonusErr(err.message);
      } finally {
        setBonusLoading(false);
      }
    }
    fetchBonusSubs();
  }, [creator?.id]);

  // ----------------------------------------------------------------
  // Fetch withdrawal history
  // ----------------------------------------------------------------
  useEffect(() => {
    if (!creator) { setWithdrawHistLoading(false); return; }
    async function fetchWithdrawals() {
      setWithdrawHistLoading(true);
      setWithdrawHistErr("");
      try {
        const { data, error } = await supabase
          .from("withdrawal_requests")
          .select("*")
          .eq("creator_id", creator.id)
          .order("created_at", { ascending: false });
        if (error) throw error;
        setWithdrawHistory(data || []);
      } catch (err) {
        setWithdrawHistErr(err.message);
      } finally {
        setWithdrawHistLoading(false);
      }
    }
    fetchWithdrawals();
  }, [creator?.id]);

  // ----------------------------------------------------------------
  // Stripe Connect
  // ----------------------------------------------------------------
  async function loadStripeStatus() {
    if (!creator?.id) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/stripe/connect-status", {
        headers: { Authorization: `Bearer ${session?.access_token || ""}` },
      });
      if (res.ok) {
        const json = await res.json();
        setStripeStatus(json);
      }
    } catch (_) {}
  }

  async function handleStripeConnect() {
    setStripeLoading(true);
    setPmMsg({ text: "", type: "" });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/stripe/connect-url", {
        method: "POST",
        headers: {
          Authorization:  `Bearer ${session?.access_token || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.message || "Failed to generate Stripe link");
      if (json.alreadyActive) {
        setPmMsg({ text: "Your Stripe account is already active and ready for payouts.", type: "success" });
        setStripeStatus(prev => ({ ...prev, status: "active" }));
        return;
      }
      // Redirect to Stripe hosted onboarding
      window.location.href = json.url;
    } catch (err) {
      setPmMsg({ text: err.message, type: "error" });
    } finally {
      setStripeLoading(false);
    }
  }

  // Check for Stripe callback params on mount
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("stripe_connected") === "true") {
      loadStripeStatus();
      // Clean up URL
      window.history.replaceState({}, "", window.location.pathname + "?page=earnings");
    }
    if (params.get("stripe_refresh") === "true") {
      setPmMsg({ text: "Stripe onboarding session expired. Please try connecting again.", type: "error" });
      window.history.replaceState({}, "", window.location.pathname + "?page=earnings");
    }
  }, []);

  // Load Stripe status when Stripe is selected
  React.useEffect(() => {
    if (pmMethod === "stripe" && !stripeStatus) loadStripeStatus();
  }, [pmMethod]);

  // ----------------------------------------------------------------
  // Payment method submit
  // ----------------------------------------------------------------
  function validatePaymentMethod() {
    if (pmMethod === "stripe") return null; // Stripe handled via OAuth flow
    if (pmMethod === "bank_transfer") {
      if (!bankName.trim())               return "Bank name is required.";
      if (!/^\d{4}$/.test(bankLast4))     return "Account last 4 must be exactly 4 digits.";
    }
    if (pmMethod === "zelle") {
      const hasEmail = zelleEmail.trim().length > 0;
      const hasPhone = zelleLast4.trim().length > 0;
      if (!hasEmail && !hasPhone)          return "Provide your Zelle email or phone last 4.";
      if (hasEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(zelleEmail.trim()))
                                           return "Zelle email is not valid.";
      if (hasPhone && !/^\d{4}$/.test(zelleLast4))
                                           return "Phone last 4 must be exactly 4 digits.";
    }
    return null;
  }

  async function handlePaymentMethodSubmit(e) {
    e.preventDefault();
    const validationErr = validatePaymentMethod();
    if (validationErr) {
      setPmMsg({ text: validationErr, type: "error" });
      return;
    }
    setPmWorking(true);
    setPmMsg({ text: "", type: "" });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const body = { payment_method: pmMethod };
      if (pmMethod === "bank_transfer") {
        body.bank_name            = bankName.trim();
        body.bank_account_last4   = bankLast4;
        if (bankNotes.trim()) body.bank_transfer_notes = bankNotes.trim();
      }
      if (pmMethod === "zelle") {
        if (zelleEmail.trim()) body.zelle_email      = zelleEmail.trim();
        if (zelleLast4.trim()) body.zelle_phone_last4 = zelleLast4.trim();
      }
      const res = await fetch("/api/creators/payment-method", {
        method:  "PATCH",
        headers: {
          Authorization:  `Bearer ${session?.access_token || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.message || "Failed to save payment method");
      setPmMsg({ text: "Payment method saved successfully.", type: "success" });
      setPmFormOpen(false);
      loadSummary();
    } catch (err) {
      setPmMsg({ text: err.message, type: "error" });
    } finally {
      setPmWorking(false);
    }
  }

  // ----------------------------------------------------------------
  // Withdrawal request
  // ----------------------------------------------------------------
  async function handleWithdrawalConfirm() {
    setWithdrawWorking(true);
    setWithdrawMsg({ text: "", type: "" });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/withdrawals/request", {
        method:  "POST",
        headers: {
          Authorization:  `Bearer ${session?.access_token || ""}`,
          "Content-Type": "application/json",
        },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.message || "Withdrawal failed");
      setWithdrawMsg({ text: json.message || "Withdrawal request submitted!", type: "success" });
      loadSummary();
      // Refresh withdrawal history
      if (creator) {
        const { data } = await supabase
          .from("withdrawal_requests")
          .select("*")
          .eq("creator_id", creator.id)
          .order("created_at", { ascending: false });
        setWithdrawHistory(data || []);
      }
      // Close modal after a short delay
      setTimeout(() => setShowWithdrawModal(false), 2000);
    } catch (err) {
      setWithdrawMsg({ text: err.message, type: "error" });
    } finally {
      setWithdrawWorking(false);
    }
  }

  // ----------------------------------------------------------------
  // Save view count for a submission
  // ----------------------------------------------------------------
  async function handleSubSave(subId) {
    const edit = subEdits[subId] || {};
    setSubSaving(prev => ({ ...prev, [subId]: true }));
    setSubMsg(prev => ({ ...prev, [subId]: { text: "", type: "" } }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const body = { submissionId: subId };
      if (edit.postedUrl && edit.postedUrl.trim())  body.postedUrl = edit.postedUrl.trim();
      if (edit.postedAt  && edit.postedAt.trim())   body.postedAt  = edit.postedAt.trim();
      if (edit.viewCount && edit.viewCount.trim())  body.viewCountSubmitted = edit.viewCount.trim();
      const res = await fetch("/api/creator/view-count", {
        method:  "POST",
        headers: {
          Authorization:  `Bearer ${session?.access_token || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.message || "Failed to save");
      // Update local state with returned submission
      const updated = json.submission || {};
      setBonusSubs(prev => prev.map(s => s.id === subId ? { ...s, ...updated } : s));
      setSubEdits(prev => ({
        ...prev,
        [subId]: {
          postedUrl:  updated.posted_url  || edit.postedUrl  || "",
          postedAt:   updated.posted_at   ? updated.posted_at.slice(0, 10) : (edit.postedAt || ""),
          viewCount:  updated.view_count_submitted != null ? String(updated.view_count_submitted) : (edit.viewCount || ""),
        },
      }));
      setSubMsg(prev => ({ ...prev, [subId]: { text: "Saved successfully!", type: "success" } }));
    } catch (err) {
      setSubMsg(prev => ({ ...prev, [subId]: { text: err.message, type: "error" } }));
    } finally {
      setSubSaving(prev => ({ ...prev, [subId]: false }));
    }
  }

  function updateSubEdit(subId, field, value) {
    setSubEdits(prev => ({ ...prev, [subId]: { ...(prev[subId] || {}), [field]: value } }));
  }

  // ----------------------------------------------------------------
  // Derived values from summary
  // ----------------------------------------------------------------
  const availableBalance         = summary?.availableBalance         || 0;
  const pendingBalance           = summary?.pendingBalance           || 0;
  const withdrawalRequestedBalance = summary?.withdrawalRequestedBalance || 0;
  const paidBalance              = summary?.paidBalance              || 0;
  const canRequestWithdrawal     = summary?.canRequestWithdrawal     ?? false;
  const nextWithdrawalDate       = summary?.nextWithdrawalDate       || null;
  const earningsRows             = summary?.earnings                 || [];

  const paymentMethodStatus = creator?.payment_method_status || "missing";
  const hasPaymentMethod    = paymentMethodStatus !== "missing" && !!creator?.payment_method;

  function getPaymentDestSummary() {
    if (!creator) return "No payment method on file";
    const m = creator.payment_method;
    if (m === "zelle") {
      if (creator.zelle_email) {
        const e = creator.zelle_email;
        const at = e.indexOf("@");
        return `Zelle: ${e.charAt(0)}***${e.slice(at)}`;
      }
      if (creator.zelle_phone_last4) return `Zelle: ***-***-${creator.zelle_phone_last4}`;
      return "Zelle (no destination on file)";
    }
    if (m === "bank_transfer") {
      const last4 = creator.bank_account_last4;
      const name  = creator.bank_name ? ` (${creator.bank_name})` : "";
      return last4 ? `Bank Transfer: ****${last4}${name}` : "Bank Transfer (no account on file)";
    }
    return "No payment method on file";
  }

  function getBonusStatus(sub) {
    const edit    = subEdits[sub.id] || {};
    const rawViews = parseInt(edit.viewCount || sub.view_count_submitted, 10);
    const views   = isNaN(rawViews) ? 0 : rawViews;
    const postedAt = edit.postedAt || sub.posted_at;

    // Check earnings rows for a paid/approved bonus entry tied to this submission
    const bonusEarning = earningsRows.find(
      e => e.submission_id === sub.id && (e.earning_type === "performance_bonus" || e.earning_type === "bonus" || e.earning_type === "other")
    );
    if (bonusEarning) {
      if (bonusEarning.status === "paid")
        return { label: `Paid ${fmt2(bonusEarning.amount)}`, color: "var(--green)" };
      if (bonusEarning.status === "approved")
        return { label: `Approved ${fmt2(bonusEarning.amount)}`, color: "var(--green)" };
      if (bonusEarning.status === "needs_review")
        return { label: "Needs admin review", color: "#9a7a00" };
      if (bonusEarning.status === "forfeited")
        return { label: "Forfeited", color: "var(--red)" };
    }

    if (!postedAt) return { label: "Set posted date to begin", color: "var(--ink3)" };

    const eligible = isBonusEligible(postedAt);
    if (!eligible) {
      const daysLeft = getDaysUntilEligible(postedAt);
      return { label: `Waiting for 10-day mark (${daysLeft}d left)`, color: "var(--ink3)" };
    }
    if (!views) return { label: "Submit views to check bonus", color: "#9a7a00" };

    const bonus = calculateBonusByViews(views);
    if (!bonus) return { label: "No bonus tier reached", color: "var(--ink3)" };
    return { label: `Eligible: ${fmt2(bonus)} — Submit for review`, color: "var(--green)" };
  }

  // ----------------------------------------------------------------
  // Loading / error for top-level summary
  // ----------------------------------------------------------------
  if (summaryLoading) return <LoadingSpinner label="Loading earnings…" />;

  if (summaryErr && !summary) {
    return (
      <div className="content">
        <div style={{
          background: "rgba(192,57,43,0.08)",
          border: "1px solid rgba(192,57,43,0.2)",
          borderRadius: "var(--radius)",
          padding: "16px 20px",
          color: "var(--red)",
          fontSize: 13,
        }}>
          ⚠ {summaryErr}
        </div>
      </div>
    );
  }

  // ----------------------------------------------------------------
  // Render
  // ----------------------------------------------------------------
  return (
    <div className="content">

      {/* ── Section 1: Balance Cards ── */}
      <div style={{ marginBottom: 24 }}>
        <div className="heading-md" style={{ marginBottom: 16 }}>Earnings Overview</div>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: 16,
        }}>
          {/* Available Balance */}
          <div className="premium-card" style={{ borderTop: "3px solid var(--green)" }}>
            <div className="fs-12 fw-600 text-muted text-uppercase" style={{ letterSpacing: "0.05em", marginBottom: 8 }}>
              Available Balance
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: "var(--green)" }}>
              {fmt2(availableBalance)}
            </div>
            <div className="fs-12 text-muted" style={{ marginTop: 4 }}>Ready to withdraw</div>
          </div>

          {/* Pending Review */}
          <div className="premium-card" style={{ borderTop: "3px solid #f59e0b" }}>
            <div className="fs-12 fw-600 text-muted text-uppercase" style={{ letterSpacing: "0.05em", marginBottom: 8 }}>
              Pending Review
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: "#9a7a00" }}>
              {fmt2(pendingBalance)}
            </div>
            <div className="fs-12 text-muted" style={{ marginTop: 4 }}>Under review</div>
          </div>

          {/* Withdrawal Requested */}
          <div className="premium-card" style={{ borderTop: "3px solid #3b82f6" }}>
            <div className="fs-12 fw-600 text-muted text-uppercase" style={{ letterSpacing: "0.05em", marginBottom: 8 }}>
              Withdrawal Requested
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: "#2563eb" }}>
              {fmt2(withdrawalRequestedBalance)}
            </div>
            <div className="fs-12 text-muted" style={{ marginTop: 4 }}>Processing</div>
          </div>

          {/* Total Paid */}
          <div className="premium-card" style={{ borderTop: "3px solid var(--ink3)" }}>
            <div className="fs-12 fw-600 text-muted text-uppercase" style={{ letterSpacing: "0.05em", marginBottom: 8 }}>
              Total Paid
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: "var(--ink3)" }}>
              {fmt2(paidBalance)}
            </div>
            <div className="fs-12 text-muted" style={{ marginTop: 4 }}>All time</div>
          </div>
        </div>
      </div>

      {/* ── Section 2: Payment Method ── */}
      <div className="premium-card" style={{ marginBottom: 24 }} ref={pmFormRef}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div className="heading-md" style={{ marginBottom: 4 }}>Payment Method</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <PaymentMethodBadge status={paymentMethodStatus} />
              {creator?.payment_method && (
                <span className="fs-13 text-muted">
                  {creator.payment_method === "bank_transfer" ? "Bank Transfer" : "Zelle"}
                  {creator.bank_name ? ` · ${creator.bank_name}` : ""}
                  {creator.bank_account_last4 ? ` ****${creator.bank_account_last4}` : ""}
                  {creator.zelle_email ? ` · ${creator.zelle_email.charAt(0)}***${creator.zelle_email.slice(creator.zelle_email.indexOf("@"))}` : ""}
                  {creator.zelle_phone_last4 ? ` · ***-${creator.zelle_phone_last4}` : ""}
                </span>
              )}
            </div>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setPmFormOpen(o => !o); setPmMsg({ text: "", type: "" }); }}
          >
            {pmFormOpen ? "Cancel" : (hasPaymentMethod ? "Update" : "Set Up")}
          </button>
        </div>

        {pmMsg.text && (
          <div style={{
            fontSize: 13,
            marginBottom: 12,
            color: pmMsg.type === "success" ? "var(--green)" : "var(--red)",
          }}>
            {pmMsg.text}
          </div>
        )}

        {pmFormOpen && (
          <form onSubmit={handlePaymentMethodSubmit} style={{ borderTop: "1px solid var(--border)", paddingTop: 20 }}>
            {/* Method selector */}
            <div style={{ marginBottom: 16 }}>
              <label className="fs-12 fw-600 text-muted text-uppercase" style={{ display: "block", marginBottom: 6, letterSpacing: "0.05em" }}>
                Payment Type
              </label>
              <select
                value={pmMethod}
                onChange={e => setPmMethod(e.target.value)}
                style={{
                  width: "100%", padding: "10px 12px", fontSize: 14,
                  border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                  background: "var(--bg)", color: "var(--ink)",
                }}
              >
                <option value="bank_transfer">Bank Transfer (manual, 1–3 days)</option>
                <option value="zelle">Zelle (manual, same day)</option>
                <option value="stripe">Stripe — Automatic ACH (2–3 business days)</option>
              </select>
            </div>

            {/* Stripe Connect panel */}
            {pmMethod === "stripe" && (
              <div style={{
                background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.2)",
                borderRadius: "var(--radius-sm)", padding: 18, marginBottom: 16,
              }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
                  Stripe Automatic Payouts
                </div>
                <div style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 14, lineHeight: 1.5 }}>
                  Connect your bank account through Stripe's secure onboarding. Once active,
                  payouts are sent automatically when the owner approves — no manual bank
                  transfer needed.
                </div>

                {stripeStatus?.status === "active" ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--green)", fontWeight: 600, fontSize: 13 }}>
                    <span>✓</span> Stripe account connected and ready for payouts
                  </div>
                ) : stripeStatus?.status === "pending" ? (
                  <div style={{ fontSize: 13, color: "var(--gold)", fontWeight: 600 }}>
                    ⏳ Stripe review in progress — usually takes 1–2 business days
                  </div>
                ) : stripeStatus?.status === "onboarding" ? (
                  <div style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 10 }}>
                    Onboarding started but not yet complete.
                  </div>
                ) : stripeStatus?.status === "disabled" ? (
                  <div style={{ fontSize: 13, color: "var(--red)", fontWeight: 600, marginBottom: 10 }}>
                    ⚠ Your Stripe account was disabled. Contact support.
                  </div>
                ) : null}

                {stripeStatus?.status !== "active" && (
                  <button
                    type="button"
                    onClick={handleStripeConnect}
                    disabled={stripeLoading}
                    style={{
                      marginTop: 12, padding: "10px 18px", fontSize: 13, fontWeight: 700,
                      background: "#635bff", color: "#fff", border: "none",
                      borderRadius: "var(--radius-sm)", cursor: stripeLoading ? "wait" : "pointer",
                    }}
                  >
                    {stripeLoading ? "Redirecting…" : stripeStatus?.status === "onboarding" ? "Continue Stripe Setup" : "Connect Stripe Account"}
                  </button>
                )}

                <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 10 }}>
                  Powered by Stripe Connect. Your bank details are stored securely by Stripe, not by Omnya.
                </div>
              </div>
            )}

            {/* Bank Transfer fields */}
            {pmMethod === "bank_transfer" && (
              <>
                <div style={{ marginBottom: 14 }}>
                  <label className="fs-12 fw-600 text-muted text-uppercase" style={{ display: "block", marginBottom: 6, letterSpacing: "0.05em" }}>
                    Bank Name
                  </label>
                  <input
                    type="text"
                    value={bankName}
                    onChange={e => setBankName(e.target.value)}
                    placeholder="e.g. Chase"
                    style={{
                      width: "100%", padding: "10px 12px", fontSize: 14,
                      border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                      background: "var(--bg)", color: "var(--ink)", boxSizing: "border-box",
                    }}
                  />
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label className="fs-12 fw-600 text-muted text-uppercase" style={{ display: "block", marginBottom: 6, letterSpacing: "0.05em" }}>
                    Account Last 4 Digits
                  </label>
                  <input
                    type="text"
                    value={bankLast4}
                    onChange={e => setBankLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    placeholder="Last 4 digits"
                    maxLength={4}
                    style={{
                      width: "100%", padding: "10px 12px", fontSize: 14,
                      border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                      background: "var(--bg)", color: "var(--ink)", boxSizing: "border-box",
                    }}
                  />
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label className="fs-12 fw-600 text-muted text-uppercase" style={{ display: "block", marginBottom: 6, letterSpacing: "0.05em" }}>
                    Notes (optional)
                  </label>
                  <textarea
                    value={bankNotes}
                    onChange={e => setBankNotes(e.target.value)}
                    placeholder="Any routing instructions or notes for payouts"
                    rows={3}
                    style={{
                      width: "100%", padding: "10px 12px", fontSize: 14,
                      border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                      background: "var(--bg)", color: "var(--ink)", resize: "vertical", boxSizing: "border-box",
                    }}
                  />
                </div>
              </>
            )}

            {/* Zelle fields */}
            {pmMethod === "zelle" && (
              <>
                <div style={{ marginBottom: 4 }}>
                  <div className="fs-12 text-muted" style={{ marginBottom: 12 }}>
                    Provide your Zelle email address and/or the last 4 digits of your registered phone number. At least one is required.
                  </div>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label className="fs-12 fw-600 text-muted text-uppercase" style={{ display: "block", marginBottom: 6, letterSpacing: "0.05em" }}>
                    Zelle Email
                  </label>
                  <input
                    type="email"
                    value={zelleEmail}
                    onChange={e => setZelleEmail(e.target.value)}
                    placeholder="your@email.com"
                    style={{
                      width: "100%", padding: "10px 12px", fontSize: 14,
                      border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                      background: "var(--bg)", color: "var(--ink)", boxSizing: "border-box",
                    }}
                  />
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label className="fs-12 fw-600 text-muted text-uppercase" style={{ display: "block", marginBottom: 6, letterSpacing: "0.05em" }}>
                    Phone Last 4 Digits
                  </label>
                  <input
                    type="text"
                    value={zelleLast4}
                    onChange={e => setZelleLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    placeholder="Last 4 digits of phone"
                    maxLength={4}
                    style={{
                      width: "100%", padding: "10px 12px", fontSize: 14,
                      border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                      background: "var(--bg)", color: "var(--ink)", boxSizing: "border-box",
                    }}
                  />
                </div>
              </>
            )}

            {pmMethod !== "stripe" && (
              <button
                type="submit"
                disabled={pmWorking}
                className="btn btn-primary"
                style={{ marginTop: 4 }}
              >
                {pmWorking ? "Saving…" : "Save Payment Method"}
              </button>
            )}
          </form>
        )}
      </div>

      {/* ── Section 3: Withdrawal ── */}
      <div className="premium-card" style={{ marginBottom: 24 }}>
        <div className="heading-md" style={{ marginBottom: 4 }}>Withdrawal</div>
        <div className="fs-13 text-muted" style={{ marginBottom: 16 }}>
          Withdraw your available balance. Withdrawals may be requested once every 14 days.
        </div>

        {canRequestWithdrawal && availableBalance > 0 && hasPaymentMethod ? (
          <button
            className="btn btn-primary"
            onClick={() => { setShowWithdrawModal(true); setWithdrawMsg({ text: "", type: "" }); }}
          >
            Request Withdrawal — {fmt2(availableBalance)}
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {!hasPaymentMethod && (
              <div style={{
                background: "rgba(154,122,0,0.10)",
                border: "1px solid rgba(154,122,0,0.25)",
                borderRadius: "var(--radius-sm)",
                padding: "12px 16px",
                fontSize: 13,
                color: "#9a7a00",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}>
                <span>You need to set up a payment method before requesting a withdrawal.</span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setPmFormOpen(true);
                    setTimeout(() => pmFormRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
                  }}
                >
                  Set Up Now
                </button>
              </div>
            )}
            {availableBalance <= 0 && (
              <div className="fs-13 text-muted">Available balance is $0.00. No funds ready for withdrawal.</div>
            )}
            {!canRequestWithdrawal && nextWithdrawalDate && (
              <div className="fs-13 text-muted">
                Next eligible withdrawal date:{" "}
                <strong>{new Date(nextWithdrawalDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</strong>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Withdrawal Confirmation Modal ── */}
      {showWithdrawModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        }}>
          <div style={{
            background: "var(--bg)", borderRadius: "var(--radius)", padding: 28,
            maxWidth: 420, width: "100%", boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
          }}>
            <div className="heading-md" style={{ marginBottom: 20 }}>Confirm Withdrawal</div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span className="text-muted">Amount</span>
                <strong style={{ color: "var(--green)" }}>{fmt2(availableBalance)}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span className="text-muted">Payment Method</span>
                <strong>{creator?.payment_method === "bank_transfer" ? "Bank Transfer" : "Zelle"}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span className="text-muted">Destination</span>
                <strong style={{ maxWidth: 220, textAlign: "right" }}>{getPaymentDestSummary()}</strong>
              </div>
            </div>

            {withdrawMsg.text && (
              <div style={{
                fontSize: 13, marginBottom: 14,
                color: withdrawMsg.type === "success" ? "var(--green)" : "var(--red)",
              }}>
                {withdrawMsg.text}
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button
                className="btn btn-primary"
                disabled={withdrawWorking}
                onClick={handleWithdrawalConfirm}
                style={{ flex: 1 }}
              >
                {withdrawWorking ? "Submitting…" : "Confirm Withdrawal"}
              </button>
              <button
                className="btn btn-ghost"
                disabled={withdrawWorking}
                onClick={() => setShowWithdrawModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Section 4: Video Bonus Submissions ── */}
      <div className="premium-card" style={{ marginBottom: 24 }}>
        <div className="heading-md" style={{ marginBottom: 4 }}>Video Bonus Submissions</div>
        <div className="fs-13 text-muted" style={{ marginBottom: 20 }}>
          Approved videos. Enter your posted URL and view count after 10 days to check bonus eligibility.
        </div>

        {bonusLoading && <LoadingSpinner size={24} label="Loading submissions…" />}
        {bonusErr && (
          <div style={{ fontSize: 13, color: "var(--red)" }}>⚠ {bonusErr}</div>
        )}

        {!bonusLoading && !bonusErr && bonusSubs.length === 0 && (
          <div className="empty" style={{ padding: 24 }}>
            <div className="empty-icon">🎬</div>
            <h3>No approved videos yet</h3>
            <p>Once a video is approved, it will appear here for bonus tracking.</p>
          </div>
        )}

        {!bonusLoading && bonusSubs.map(sub => {
          const edit    = subEdits[sub.id] || {};
          const msg     = subMsg[sub.id]   || {};
          const saving  = subSaving[sub.id] || false;
          const campaign = sub.campaigns;
          const daysSince = getDaysSincePosting(edit.postedAt || sub.posted_at);
          const rawViews  = parseInt(edit.viewCount || sub.view_count_submitted, 10);
          const views     = isNaN(rawViews) ? 0 : rawViews;
          const bonusEstimate = views > 0 ? calculateBonusByViews(views) : 0;
          const tierLabel     = views > 0 ? getBonusTierLabel(views) : null;
          const bonusStatus   = getBonusStatus(sub);

          return (
            <div key={sub.id} style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              padding: 20,
              marginBottom: 16,
              background: "var(--bg2)",
            }}>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12, gap: 12 }}>
                <div>
                  <div className="fw-600 fs-14" style={{ marginBottom: 2 }}>
                    {campaign?.name || "Campaign"}
                  </div>
                  <div className="fs-12 text-muted">
                    {sub.platform || "Video"} · Approved {fmtDate(sub.approved_date || sub.created_at)}
                    {daysSince !== null && (
                      <span> · {daysSince} day{daysSince !== 1 ? "s" : ""} since posting</span>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div className="fs-12 fw-600 text-muted text-uppercase" style={{ marginBottom: 4 }}>Base Pay</div>
                  <div className="fs-13 fw-600" style={{ color: sub.payment_status === "Paid" ? "var(--green)" : "var(--ink3)" }}>
                    {sub.payment_status || "Pending"}
                  </div>
                </div>
              </div>

              {/* Editable fields */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 12 }}>
                <div>
                  <label className="fs-12 fw-600 text-muted text-uppercase" style={{ display: "block", marginBottom: 4, letterSpacing: "0.04em" }}>
                    Posted URL
                  </label>
                  <input
                    type="url"
                    value={edit.postedUrl || ""}
                    onChange={e => updateSubEdit(sub.id, "postedUrl", e.target.value)}
                    placeholder="https://..."
                    style={{
                      width: "100%", padding: "8px 10px", fontSize: 13,
                      border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                      background: "var(--bg)", color: "var(--ink)", boxSizing: "border-box",
                    }}
                  />
                </div>
                <div>
                  <label className="fs-12 fw-600 text-muted text-uppercase" style={{ display: "block", marginBottom: 4, letterSpacing: "0.04em" }}>
                    Posted Date
                  </label>
                  <input
                    type="date"
                    value={edit.postedAt || ""}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={e => updateSubEdit(sub.id, "postedAt", e.target.value)}
                    style={{
                      width: "100%", padding: "8px 10px", fontSize: 13,
                      border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                      background: "var(--bg)", color: "var(--ink)", boxSizing: "border-box",
                    }}
                  />
                </div>
                <div>
                  <label className="fs-12 fw-600 text-muted text-uppercase" style={{ display: "block", marginBottom: 4, letterSpacing: "0.04em" }}>
                    View Count
                  </label>
                  <input
                    type="number"
                    value={edit.viewCount || ""}
                    min={0}
                    onChange={e => updateSubEdit(sub.id, "viewCount", e.target.value)}
                    placeholder="e.g. 125000"
                    style={{
                      width: "100%", padding: "8px 10px", fontSize: 13,
                      border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                      background: "var(--bg)", color: "var(--ink)", boxSizing: "border-box",
                    }}
                  />
                </div>
              </div>

              {/* Bonus preview */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: 12, padding: "10px 14px",
                background: "var(--bg)", border: "1px solid var(--border2)",
                borderRadius: "var(--radius-sm)", marginBottom: 12,
                flexWrap: "wrap",
              }}>
                <div>
                  <span className="fs-12 text-muted">Bonus status: </span>
                  <span className="fs-13 fw-600" style={{ color: bonusStatus.color }}>
                    {bonusStatus.label}
                  </span>
                </div>
                {bonusEstimate > 0 && (
                  <div>
                    <span className="fs-12 text-muted">Estimated bonus: </span>
                    <span className="fs-13 fw-600" style={{ color: "var(--green)" }}>
                      {fmt2(bonusEstimate)}
                    </span>
                    {tierLabel && (
                      <span className="fs-11 text-muted" style={{ marginLeft: 6 }}>({tierLabel})</span>
                    )}
                  </div>
                )}
                {views > 0 && (
                  <div className="fs-12 text-muted">{fmtNum(views)} views</div>
                )}
              </div>

              {/* Save button + message */}
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={saving}
                  onClick={() => handleSubSave(sub.id)}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                {msg.text && (
                  <span style={{ fontSize: 13, color: msg.type === "success" ? "var(--green)" : "var(--red)" }}>
                    {msg.text}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Section 5: Earnings History ── */}
      <div className="premium-card" style={{ marginBottom: 24 }}>
        <div className="heading-md" style={{ marginBottom: 20 }}>Earnings History</div>
        {earningsRows.length === 0 ? (
          <div className="empty" style={{ padding: 24 }}>
            <div className="empty-icon">💰</div>
            <h3>No earnings recorded yet</h3>
            <p>Your earnings will appear here once a payment is approved.</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left" }}>
              <thead>
                <tr style={{
                  borderBottom: "1px solid var(--border)",
                  color: "var(--ink3)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em",
                }}>
                  {["Date", "Type", "Campaign", "Description", "Views", "Bonus Tier", "Amount", "Status"].map(h => (
                    <th key={h} style={{ padding: "10px 12px", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {earningsRows.map((row, i) => {
                  const campaignName = db.campaigns.find(c => c.id === row.campaign_id)?.name || "—";
                  const tierLbl = row.views_counted ? getBonusTierLabel(row.views_counted) : null;
                  return (
                    <tr key={row.id || i} style={{ borderBottom: "1px solid var(--border2)" }}>
                      <td style={{ padding: "12px 12px", whiteSpace: "nowrap" }}>{fmtDate(row.created_at)}</td>
                      <td style={{ padding: "12px 12px", whiteSpace: "nowrap" }}>{fmtTypeName(row.earning_type)}</td>
                      <td style={{ padding: "12px 12px", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{campaignName}</td>
                      <td style={{ padding: "12px 12px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ink3)" }}>
                        {row.description || "—"}
                      </td>
                      <td style={{ padding: "12px 12px" }}>{row.views_counted ? fmtNum(row.views_counted) : "—"}</td>
                      <td style={{ padding: "12px 12px", whiteSpace: "nowrap" }}>{tierLbl || "—"}</td>
                      <td style={{ padding: "12px 12px", fontWeight: 700, whiteSpace: "nowrap" }}>
                        {fmt2(row.amount)}
                      </td>
                      <td style={{ padding: "12px 12px" }}>
                        {statusBadge(
                          row.status === "approved" ? "Approved" :
                          row.status === "paid"     ? "Paid" :
                          row.status === "pending"  ? "Pending" :
                          row.status === "forfeited"? "Denied" :
                          (row.status || "Pending")
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Section 6: Withdrawal History ── */}
      <div className="premium-card">
        <div className="heading-md" style={{ marginBottom: 20 }}>Withdrawal History</div>

        {withdrawHistLoading && <LoadingSpinner size={24} label="Loading withdrawals…" />}
        {withdrawHistErr && (
          <div style={{ fontSize: 13, color: "var(--red)" }}>⚠ {withdrawHistErr}</div>
        )}

        {!withdrawHistLoading && !withdrawHistErr && withdrawHistory.length === 0 && (
          <div className="empty" style={{ padding: 24 }}>
            <div className="empty-icon">💸</div>
            <h3>No withdrawals yet</h3>
            <p>Your withdrawal requests will appear here.</p>
          </div>
        )}

        {!withdrawHistLoading && withdrawHistory.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left" }}>
              <thead>
                <tr style={{
                  borderBottom: "1px solid var(--border)",
                  color: "var(--ink3)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em",
                }}>
                  {["Date", "Amount", "Method", "Status", "Notes"].map(h => (
                    <th key={h} style={{ padding: "10px 12px", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {withdrawHistory.map((wr, i) => (
                  <tr key={wr.id || i} style={{ borderBottom: "1px solid var(--border2)" }}>
                    <td style={{ padding: "12px 12px", whiteSpace: "nowrap" }}>{fmtDate(wr.created_at)}</td>
                    <td style={{ padding: "12px 12px", fontWeight: 700 }}>{fmt2(wr.amount)}</td>
                    <td style={{ padding: "12px 12px", whiteSpace: "nowrap" }}>
                      {wr.payment_method === "bank_transfer" ? "Bank Transfer" :
                       wr.payment_method === "zelle"         ? "Zelle" :
                       wr.payment_method || "—"}
                    </td>
                    <td style={{ padding: "12px 12px" }}>
                      <WithdrawalStatusBadge status={wr.status} />
                    </td>
                    <td style={{ padding: "12px 12px", color: "var(--ink3)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {wr.status === "rejected" && wr.rejection_reason
                        ? wr.rejection_reason
                        : wr.payment_destination_summary || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
