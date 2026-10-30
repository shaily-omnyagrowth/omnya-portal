import { useEffect, useState } from "react";
import { CheckmarkCircle02Icon, Clock01Icon } from "@hugeicons/core-free-icons";
import { gooeyToast as toast } from "goey-toast";
import Alert from "../../ui/Alert";
import Icon from "../../ui/Icon";
import Segmented from "../../ui/Segmented";
import { authed, errMessage, payoutDestination } from "./rules";

const STATUS = { missing: ["Not set up", "red"], submitted: ["Submitted", "orange"], verified: ["Verified", "green"] };

function validate(m, f) {
  if (m === "bank_transfer") {
    if (!f.bankName.trim()) return "Add your bank's name.";
    if (!/^\d{4}$/.test(f.bankLast4)) return "Enter the last 4 digits of your account number.";
  }
  if (m === "zelle") {
    const email = f.zelleEmail.trim(), phone = f.zelleLast4.trim();
    if (!email && !phone) return "Add your Zelle email or the last 4 digits of your Zelle phone number.";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "That Zelle email doesn't look right.";
    if (phone && !/^\d{4}$/.test(phone)) return "Use exactly 4 digits for the phone number.";
  }
  return null;
}

export default function PayoutMethodCard({ creator, onSaved, openSignal }) {
  const status = (creator?.payment_method_status || "missing").toLowerCase();
  const has = status !== "missing" && !!creator?.payment_method;
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState(creator?.payment_method || "bank_transfer");
  const [f, setF] = useState({ bankName: "", bankLast4: "", bankNotes: "", zelleEmail: "", zelleLast4: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [stripe, setStripe] = useState(null);
  const [stripeBusy, setStripeBusy] = useState(false);
  const set = (patch) => setF(v => ({ ...v, ...patch }));

  useEffect(() => { if (openSignal) setOpen(true); }, [openSignal]);

  const loadStripe = async () => {
    try { const { res, json } = await authed("/api/stripe/connect-status", { method: "GET" }); if (res.ok) setStripe(json); } catch (_) { /* optional */ }
  };
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const clean = () => { params.delete("stripe_connected"); params.delete("stripe_refresh"); const u = new URL(window.location); u.search = params.toString(); window.history.replaceState({}, "", u); };
    if (params.get("stripe_connected") === "true") { loadStripe(); toast.success("Stripe connected", { description: "We'll confirm your account shortly." }); clean(); }
    if (params.get("stripe_refresh") === "true") { toast.error("Stripe setup expired", { description: "Start the connection again to finish setting up." }); setOpen(true); setMethod("stripe"); clean(); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (method === "stripe" && !stripe) loadStripe(); }, [method]); // eslint-disable-line react-hooks/exhaustive-deps

  const connectStripe = async () => {
    setStripeBusy(true);
    try {
      const { res, json } = await authed("/api/stripe/connect-url", { body: {} });
      if (!res.ok) throw new Error(errMessage(json, "Couldn't start Stripe setup."));
      if (json.alreadyActive) { toast.success("Stripe is already set up", { description: "Payouts go to your Stripe account automatically." }); setStripe(p => ({ ...p, status: "active" })); return; }
      window.location.href = json.url;
    } catch (e) {
      toast.error("Stripe setup didn't start", { description: e.message });
    } finally {
      setStripeBusy(false);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    const v = validate(method, f);
    if (v) return setErr(v);
    setBusy(true); setErr("");
    const body = { payment_method: method };
    if (method === "bank_transfer") { body.bank_name = f.bankName.trim(); body.bank_account_last4 = f.bankLast4; if (f.bankNotes.trim()) body.bank_transfer_notes = f.bankNotes.trim(); }
    if (method === "zelle") { if (f.zelleEmail.trim()) body.zelle_email = f.zelleEmail.trim(); if (f.zelleLast4.trim()) body.zelle_phone_last4 = f.zelleLast4.trim(); }
    try {
      const { res, json } = await authed("/api/creators/payment-method", { method: "PATCH", body });
      if (!res.ok) throw new Error(errMessage(json, "Couldn't save your payout method."));
      toast.success("Payout method saved", { description: "Your account manager will verify it before the next payout." });
      setOpen(false);
      onSaved?.();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const [label, tone] = STATUS[status] || STATUS.missing;

  return (
    <section className="card" id="payout-method">
      <div className="card-head">
        <div style={{ minWidth: 0 }}>
          <h2 className="card-title">Payout method</h2>
          <p className="card-desc truncate">{has ? payoutDestination(creator) : "Where we send your money."}</p>
        </div>
        <span className={`badge badge-${tone}`}><span className="dot" />{label}</span>
      </div>
      {!open ? (
        <button className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
          {has ? "Change payout method" : "Set up payouts"}
        </button>
      ) : (
        <form onSubmit={save} noValidate className="fade-in">
          <div className="form-group">
            <span className="form-label">Method</span>
            <Segmented label="Payout method" value={method} onChange={(m) => { setMethod(m); setErr(""); }}
              options={[["bank_transfer", "Bank transfer"], ["zelle", "Zelle"], ["stripe", "Stripe"]]} />
            <span className="form-hint">{{ bank_transfer: "Sent manually, arrives in 1 to 3 business days.", zelle: "Sent manually, usually the same day.", stripe: "Automatic ACH once approved, 2 to 3 business days." }[method]}</span>
          </div>

          {method === "stripe" && (
            <div className="conn-profile" style={{ flexDirection: "column", alignItems: "stretch", marginTop: 0, marginBottom: 16 }}>
              {stripe?.status === "active" && <div className="flex-center gap-8 text-green fw-600 fs-13"><Icon icon={CheckmarkCircle02Icon} size={16} />Stripe is connected and ready for payouts</div>}
              {stripe?.status === "pending" && <div className="flex-center gap-8 text-orange fw-600 fs-13"><Icon icon={Clock01Icon} size={16} />Stripe is reviewing your account, usually 1 to 2 business days</div>}
              {stripe?.status === "onboarding" && <div className="fs-13">You started Stripe setup but haven't finished it.</div>}
              {stripe?.status === "disabled" && <Alert tone="error">Your Stripe account was disabled. Contact hello@omnyagrowth.com.</Alert>}
              {stripe?.status !== "active" && (
                <button type="button" className="btn btn-primary btn-sm" style={{ alignSelf: "flex-start" }} onClick={connectStripe} disabled={stripeBusy}>
                  {stripeBusy ? "Opening Stripe…" : stripe?.status === "onboarding" ? "Continue Stripe setup" : "Connect with Stripe"}
                </button>
              )}
              <span className="form-hint">Your bank details are stored by Stripe, not by Omnya.</span>
            </div>
          )}

          {method === "bank_transfer" && (
            <>
              <div className="form-row">
                <div className="form-group"><label className="form-label" htmlFor="bank-name">Bank name</label><input id="bank-name" className="form-input" value={f.bankName} onChange={e => set({ bankName: e.target.value })} autoComplete="off" /></div>
                <div className="form-group"><label className="form-label" htmlFor="bank-last4">Account number, last 4 digits</label><input id="bank-last4" className="form-input" inputMode="numeric" maxLength={4} value={f.bankLast4} onChange={e => set({ bankLast4: e.target.value.replace(/\D/g, "").slice(0, 4) })} /></div>
              </div>
              <div className="form-group"><label className="form-label" htmlFor="bank-notes">Notes for the payout team <span className="text-muted" style={{ fontWeight: 400 }}>(optional)</span></label><textarea id="bank-notes" className="textarea" rows={2} value={f.bankNotes} onChange={e => set({ bankNotes: e.target.value })} /></div>
            </>
          )}

          {method === "zelle" && (
            <div className="form-row">
              <div className="form-group"><label className="form-label" htmlFor="zelle-email">Zelle email</label><input id="zelle-email" className="form-input" type="email" inputMode="email" value={f.zelleEmail} onChange={e => set({ zelleEmail: e.target.value })} /></div>
              <div className="form-group"><label className="form-label" htmlFor="zelle-phone">or phone, last 4 digits</label><input id="zelle-phone" className="form-input" inputMode="numeric" maxLength={4} value={f.zelleLast4} onChange={e => set({ zelleLast4: e.target.value.replace(/\D/g, "").slice(0, 4) })} /></div>
            </div>
          )}

          {err && <Alert tone="error" style={{ marginBottom: 12 }}>{err}</Alert>}
          <div className="flex gap-8">
            {method !== "stripe" && <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? "Saving…" : "Save payout method"}</button>}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); setErr(""); }}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
