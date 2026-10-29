import { useEffect, useState } from "react";
import { LOGO_URI } from "../../app/brand";
import { checkSupabaseHealth, sendEmail } from "../../lib/api";
import { supabase } from "../../supabaseClient";

export default function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("login"); // login | signup | forgot | verify-waiting
  const [requestedRole, setRequestedRole] = useState("creator");

  useEffect(() => {
    // If arriving via an invite link, auto-open signup in client mode.
    const params = new URLSearchParams(window.location.search);
    if (params.get("client_id")) {
      setMode("signup");
      setRequestedRole("client");
    }
  }, []);

  const handle = async () => {
    if (!email && mode !== "login") { setErr("Please enter email"); return; }
    if (mode === "login" && (!email || !password)) { setErr("Please enter email and password"); return; }
    
    setLoading(true); setErr("");
    try {
      if (mode === "signup") {
        if (!fullName.trim()) { setErr("Please enter your name"); setLoading(false); return; }
        if (password.length < 6) { setErr("Password must be at least 6 characters"); setLoading(false); return; }
        if (password !== confirmPassword) { setErr("Passwords do not match"); setLoading(false); return; }
        console.log("Attempting signup for:", email);
        const { data, error } = await supabase.auth.signUp({
          email, 
          password, 
          options: { 
            data: { requested_role: requestedRole },
            emailRedirectTo: `${window.location.origin}/`
          } 
        });
        
        if (error) throw error;
        
        // Auto-provision user profile & notify owner even if unconfirmed
        if (data.user) {
          try {
            const u = data.user;
            const reqRole = requestedRole || "creator";
            const initialRole = reqRole === "client" ? "client" : "pending";
            
            // Insert profile row immediately (RLS allows all)
            await supabase.from("user_profiles").insert({
              id: u.id,
              email: email,
              full_name: fullName.trim() || email.split("@")[0],
              role: initialRole,
              requested_role: reqRole
            });
            
            // Send signup email to owner
            if (initialRole === "pending") {
              sendEmail("user_signup_waiting_approval", {
                userEmail: email,
                displayName: email.split("@")[0],
                requestedRole: reqRole,
              });
            }

            // Link client to user profile
            const clientId = new URLSearchParams(window.location.search).get("client_id");
            if (clientId && reqRole === "client") {
              await supabase
                .from("clients")
                .update({ user_id: u.id })
                .eq("id", clientId)
                .is("user_id", null);
            }
          } catch (profileErr) {
            console.warn("Non-critical profile pre-provisioning failed:", profileErr.message);
          }
        }

        if (data.user && !data.session) {
          // Transitions to waiting for email verification screen
          setMode("verify-waiting");
        } else if (data.session) {
          onLogin(data.user);
        }
        return;
      }

      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        if (error) throw error;
        setErr("Password reset link sent! Check your email.");
        return;
      }

      console.log("Attempting sign in for:", email);
      
      // Shorten timeout to 15s to fail faster if DB is cold
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Supabase request timed out. If the server is waking up, please wait 30 seconds and try again.")), 15000));
      const { data, error } = await Promise.race([supabase.auth.signInWithPassword({ email, password }), timeoutPromise]);
      
      if (error) throw error;
      if (!data.session) throw new Error("Could not retrieve session. Please verify your email.");
      
      console.log("User signed in successfully. ID:", data.user.id);
      onLogin(data.user);
    } catch(e) { 
      console.error("Login Error:", e);
      setErr(`Error: ${e.message}`); 
    } finally {
      setLoading(false);
    }
  };

  if (mode === "verify-waiting") {
    return (
      <div className="login-wrap">
        <div className="login-card" style={{textAlign:"center", padding: "36px 28px"}}>
          <div className="login-logo" style={{marginBottom: 20}}>
            <img src={LOGO_URI} alt="Omnya" style={{height:56,width:"auto"}} />
          </div>
          
          <div style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            background: "rgba(39, 174, 96, 0.1)",
            color: "var(--green)",
            fontSize: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 24px auto"
          }}>
            📧
          </div>

          <div className="login-title" style={{fontSize: 22, marginBottom: 12}}>
            Verify Your Email
          </div>
          
          <p style={{fontSize: 14, color: "var(--ink2)", lineHeight: "1.6", marginBottom: 24}}>
            We've sent a verification link to <strong style={{color:"var(--ink)"}}>{email}</strong>.<br />
            Please click the link in that email to confirm your registration.
          </p>

          <div style={{
            background: "var(--bg2)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "16px",
            fontSize: 13,
            color: "var(--ink3)",
            lineHeight: "1.5",
            textAlign: "left",
            marginBottom: 24
          }}>
            {requestedRole === "client" ? (
              <>✅ <strong>Account Ready Once Verified</strong><br />
              Click the link in your email to confirm your address — your brand portal will be immediately accessible, no further approval needed.</>
            ) : (
              <>🔒 <strong>Admin Approval Required</strong><br />
              Once your email is verified, your account will be set to <strong>Pending Approval</strong> and the owner will be notified to grant you access.</>
            )}
          </div>

          {err && <div style={{fontSize:13,marginBottom:16,color:err.includes("sent")?"var(--green)":"var(--red)"}}>{err}</div>}

          <div style={{display:"flex", flexDirection:"column", gap:12}}>
            <button 
              className="btn btn-primary" 
              style={{width:"100%"}}
              onClick={async () => {
                setLoading(true); setErr("");
                try {
                  const { error } = await supabase.auth.resend({
                    type: 'signup',
                    email: email,
                    options: {
                      emailRedirectTo: `${window.location.origin}/`
                    }
                  });
                  if (error) throw error;
                  setErr("Verification link resent! Check your inbox.");
                } catch (e) {
                  setErr(`Resend failed: ${e.message}`);
                } finally {
                  setLoading(false);
                }
              }} 
              disabled={loading}
            >
              {loading ? "Resending..." : "Resend Verification Email"}
            </button>

            <button 
              className="btn btn-ghost" 
              style={{width:"100%"}}
              onClick={() => { setMode("login"); setErr(""); }}
            >
              ← Back to Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">
          <img src={LOGO_URI} alt="Omnya" style={{height:56,width:"auto"}} />
        </div>
        <div className="login-title">
          {mode === "login" ? "Welcome back" : mode === "signup" ? (requestedRole === "client" ? "Brand Portal Access" : "Create account") : "Reset Password"}
        </div>
        <div className="login-sub">
          {mode === "login" ? "Sign in to your portal" : mode === "signup" ? (requestedRole === "client" ? "Set up your brand portal account" : "Join the Omnya creator network") : "Enter your email to receive a reset link"}
        </div>

        {mode === "signup" && (
          <div className="field">
            <label>{requestedRole === "client" ? "Your name / Company name" : "Your name"}</label>
            <input value={fullName} onChange={e=>setFullName(e.target.value)} type="text" placeholder={requestedRole === "client" ? "Acme Brand" : "Jane Smith"} />
          </div>
        )}

        <div className="field">
          <label>Email</label>
          <input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="you@omnya.com" />
        </div>

        {mode !== "forgot" && (
          <div className="field">
            <div className="flex-between">
              <label>Password</label>
              {mode === "login" && (
                <span 
                  style={{fontSize:12, color:"var(--blue)", cursor:"pointer", fontWeight:500}} 
                  onClick={() => { setMode("forgot"); setErr(""); }}
                >
                  Forgot password?
                </span>
              )}
            </div>
            <input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&handle()} />
          </div>
        )}

        {mode === "signup" && (
          <div className="field">
            <label>Confirm Password</label>
            <input
              value={confirmPassword}
              onChange={e=>setConfirmPassword(e.target.value)}
              type="password"
              placeholder="••••••••"
              onKeyDown={e=>e.key==="Enter"&&handle()}
              style={{borderColor: confirmPassword && confirmPassword !== password ? "var(--red,#e53e3e)" : ""}}
            />
            {confirmPassword && confirmPassword !== password && (
              <div style={{fontSize:12,color:"var(--red,#e53e3e)",marginTop:4}}>Passwords do not match</div>
            )}
          </div>
        )}

        {mode === "signup" && (
          <div className="field">
            <label>I am a...</label>
            <select value={requestedRole} onChange={e=>setRequestedRole(e.target.value)} style={{width:"100%",padding:"10px 12px",borderRadius:"var(--radius-sm)",border:"1px solid var(--border2)",background:"var(--bg2)",color:"var(--ink)",fontSize:14,cursor:"pointer"}}>
              <option value="creator">Creator</option>
              <option value="client">Client / Brand Partner</option>
              <option value="am">Account Manager</option>
            </select>
          </div>
        )}

        {err && <div style={{fontSize:13,marginBottom:12,color:(err.includes("Check your") || err.includes("sent"))?"var(--green)":"var(--red)"}}>{err}</div>}
        
        <button className="btn btn-primary btn-full" onClick={handle} disabled={loading}>
          {loading ? "Please wait..." : mode === "login" ? "Sign In" : mode === "signup" ? "Create Account" : "Send Reset Link"}
        </button>

        <div style={{textAlign:"center",marginTop:16,fontSize:13,color:"var(--ink3)"}}>
          {mode === "login" ? (
            <>Don't have an account? <span style={{color:"var(--blue)",cursor:"pointer",fontWeight:600}} onClick={()=>{setMode("signup");setErr("");}}>Sign up</span></> 
          ) : (
            <>Already have an account? <span style={{color:"var(--blue)",cursor:"pointer",fontWeight:600}} onClick={()=>{setMode("login");setErr("");}}>Sign in</span></>
          )}
        </div>

        <div style={{textAlign:"center",marginTop:24,fontSize:10,color:"var(--ink4)",opacity:0.5}}>
          v1.0.5
        </div>
        <div className="demo-hints" style={{marginTop:20}}>
          <div className="flex-between">
            <p>Connection Status</p>
            <button 
              className="btn btn-ghost" 
              style={{fontSize:10, padding:"2px 8px"}}
              onClick={async () => {
                setErr("Running diagnostics...");
                const results = await checkSupabaseHealth();
                console.log("Diagnostic results:", results);
                setErr(`API: ${results.apiHealth} | Auth: ${results.authHealth}`);
              }}
            >
              Test Connection
            </button>
          </div>
          <div style={{fontSize:12,color:"var(--ink3)",lineHeight:1.7}}>
            After signing up, an admin will assign your role (Creator / Client / Account Manager). Contact your admin to get access.
          </div>
        </div>
      </div>
    </div>
  );
}
