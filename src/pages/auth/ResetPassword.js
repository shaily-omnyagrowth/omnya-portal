import { useState } from "react";
import { LOGO_URI } from "../../app/brand";
import { supabase } from "../../supabaseClient";

export default function ResetPassword({ onComplete }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [success, setSuccess] = useState(false);

  const handle = async () => {
    if (!password) { setErr("Enter new password"); return; }
    if (password !== confirm) { setErr("Passwords don't match"); return; }
    if (password.length < 6) { setErr("Password must be at least 6 chars"); return; }
    
    setLoading(true); setErr("");
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) { 
        setErr(error.message); 
        setLoading(false); 
        return; 
      }
      
      setSuccess(true);
      setLoading(false);
      setTimeout(async () => {
        try {
          await supabase.auth.signOut();
        } catch (e) {}
        onComplete();
      }, 2000);
    } catch (e) {
      console.error("Password reset error:", e);
      setErr("Failed to update password. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">
          <img src={LOGO_URI} alt="Omnya" style={{height:56,width:"auto"}} />
        </div>
        <div className="login-title">Set New Password</div>
        <div className="login-sub">Enter your new password below.</div>
        
        <div className="field">
          <label>New Password</label>
          <input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="••••••••" />
        </div>
        <div className="field">
          <label>Confirm Password</label>
          <input value={confirm} onChange={e=>setConfirm(e.target.value)} type="password" placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&handle()} />
        </div>

        {err && <div style={{fontSize:13,marginBottom:12,color:"var(--red)"}}>{err}</div>}
        {success && <div style={{fontSize:13,marginBottom:12,color:"var(--green)"}}>Password updated! Redirecting to login...</div>}
        
        <button className="btn btn-primary btn-full" onClick={handle} disabled={loading || success}>
          {loading ? "Updating..." : "Update Password →"}
        </button>
      </div>
    </div>
  );
}
