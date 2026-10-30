import { useState } from "react";
import { gooeyToast as toast } from "goey-toast";
import { supabase } from "../../supabaseClient";
import Alert from "../../ui/Alert";

export default function ResetPassword({ onComplete }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (password.length < 8) return setErr("Use at least 8 characters.");
    if (password !== confirm) return setErr("The two passwords don't match.");
    setLoading(true); setErr("");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { setErr(error.message); setLoading(false); return; }
    toast.success("Password updated", { description: "Sign in with your new password." });
    try { await supabase.auth.signOut(); } catch (_) {}
    onComplete();
  };

  return (
    <div className="auth" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
      <div className="login-wrap">
        <form className="login-card" onSubmit={submit} noValidate>
          <div className="login-logo"><img src="/brand/mark.png" alt="" width="24" height="32" /> Omnya</div>
          <h1 className="login-title">Choose a new password</h1>
          <p className="login-sub">You'll sign in with it from now on.</p>
          <div className="form-group">
            <label className="form-label" htmlFor="new-password">New password</label>
            <input id="new-password" className="form-input" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} autoFocus />
            <span className="form-hint">At least 8 characters.</span>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="confirm-password">Confirm password</label>
            <input id="confirm-password" className="form-input" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} />
          </div>
          {err && <Alert tone="error" style={{ marginBottom: 16 }}>{err}</Alert>}
          <button type="submit" className="btn btn-primary btn-full btn-lg" disabled={loading}>{loading ? "Saving…" : "Update password"}</button>
        </form>
      </div>
    </div>
  );
}
