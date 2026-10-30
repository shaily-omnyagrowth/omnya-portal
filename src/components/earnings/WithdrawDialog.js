import { useState } from "react";
import { gooeyToast as toast } from "goey-toast";
import Alert from "../../ui/Alert";
import Dialog from "../../ui/Dialog";
import { fmtMoney } from "../../utils";
import { authed, errMessage, methodLabel, payoutDestination } from "./rules";

export default function WithdrawDialog({ amount, creator, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const confirm = async () => {
    setBusy(true); setErr("");
    try {
      const { res, json } = await authed("/api/withdrawals/request");
      if (!res.ok) throw new Error(errMessage(json, "Your withdrawal wasn't requested."));
      toast.success("Withdrawal requested", { description: json.message || `${fmtMoney(amount, { cents: true })} is on its way once approved.` });
      onDone();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };
  return (
    <Dialog size="sm" title="Withdraw your balance" description="The payout team approves requests, then sends the money." onClose={busy ? undefined : onClose}
      actions={<><button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="btn btn-primary" onClick={confirm} disabled={busy}>{busy ? "Requesting…" : `Withdraw ${fmtMoney(amount, { cents: true })}`}</button></>}>
      <dl className="kv mb-16">
        <dt>Amount</dt><dd className="fw-600">{fmtMoney(amount, { cents: true })}</dd>
        <dt>Method</dt><dd>{methodLabel(creator?.payment_method)}</dd>
        <dt>Destination</dt><dd>{payoutDestination(creator)}</dd>
      </dl>
      <p className="fs-13 text-muted">You can request one withdrawal every 14 days.</p>
      {err && <Alert tone="error" style={{ marginTop: 12 }}>{err}</Alert>}
    </Dialog>
  );
}
