import { useEffect, useState } from "react";
import { ArrowLeft01Icon, Building03Icon, Mail01Icon, Video01Icon, ViewIcon, ViewOffIcon } from "@hugeicons/core-free-icons";
import { gooeyToast as toast } from "goey-toast";
import { sendEmail } from "../../lib/api";
import { supabase } from "../../supabaseClient";
import Alert from "../../ui/Alert";
import Icon from "../../ui/Icon";

const ROLES = [
  { id: "creator", label: "Creator", icon: Video01Icon },
  { id: "client", label: "Brand", icon: Building03Icon },
];

const friendly = (message = "") => {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "That email and password don't match an account.";
  if (m.includes("email not confirmed")) return "Confirm your email first. We sent you a link when you signed up.";
  if (m.includes("already registered")) return "An account with this email already exists. Sign in instead.";
  if (m.includes("rate limit") || m.includes("too many")) return "Too many attempts. Wait a minute and try again.";
  if (m.includes("timed out") || m.includes("failed to fetch")) return "We couldn't reach the server. Check your connection and try again.";
  return message || "Something went wrong. Try again.";
};

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error("timed out")), ms))]);

function PasswordInput({ value, onChange, autoComplete, invalid, id }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input
        id={id} className="form-input" type={show ? "text" : "password"} value={value} onChange={onChange}
        autoComplete={autoComplete} required aria-invalid={invalid || undefined} style={{ paddingRight: 44 }}
      />
      <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setShow(s => !s)}
        aria-label={show ? "Hide password" : "Show password"} style={{ position: "absolute", right: 4, top: 4 }}>
        <Icon icon={show ? ViewOffIcon : ViewIcon} size={16} />
      </button>
    </div>
  );
}

function Aside() {
  return (
    <aside className="auth-aside" aria-hidden="true">
      <span className="auth-aside-glow" />
      <img src="/landing/ring.webp" alt="" className="auth-aside-ring" width="760" height="1010" decoding="async" />
      <div>
        <p className="auth-aside-quote">Creator content that is briefed, reviewed, measured and paid for in one place.</p>
        <div className="auth-aside-meta" style={{ marginTop: 28 }}>
          <span><strong>Verified</strong>views from connected accounts</span>
          <span><strong>One queue</strong>for every review</span>
          <span><strong>On time</strong>creator payouts</span>
        </div>
      </div>
    </aside>
  );
}

export default function Login({ onLogin }) {
  const [mode, setMode] = useState(() => (window.location.pathname.toLowerCase().startsWith("/signup") ? "signup" : "login"));
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [requestedRole, setRequestedRole] = useState("creator");
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("client_id")) { setMode("signup"); setRequestedRole("client"); }
  }, []);

  const go = (m) => { setMode(m); setErr(""); setNotice(""); };
  const mismatch = mode === "signup" && confirmPassword && confirmPassword !== password;

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setNotice("");
    if (mode === "signup") {
      if (!fullName.trim()) return setErr("Add your name so your account manager knows who you are.");
      if (password.length < 8) return setErr("Use at least 8 characters for your password.");
      if (password !== confirmPassword) return setErr("The two passwords don't match.");
    }
    setLoading(true);
    try {
      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
        if (error) throw error;
        setNotice(`If ${email} has an account, a reset link is on its way.`);
        return;
      }
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { data: { requested_role: requestedRole }, emailRedirectTo: `${window.location.origin}/` },
        });
        if (error) throw error;
        if (data.user) {
          try {
            const initialRole = requestedRole === "client" ? "client" : "pending";
            await supabase.from("user_profiles").insert({
              id: data.user.id, email, full_name: fullName.trim(), role: initialRole, requested_role: requestedRole,
            });
            if (initialRole === "pending") {
              sendEmail("user_signup_waiting_approval", { userEmail: email, displayName: fullName.trim(), requestedRole });
            }
            const clientId = new URLSearchParams(window.location.search).get("client_id");
            if (clientId && requestedRole === "client") {
              await supabase.from("clients").update({ user_id: data.user.id }).eq("id", clientId).is("user_id", null);
            }
          } catch (profileErr) {
            console.warn("Profile pre-provisioning failed:", profileErr.message);
          }
        }
        if (data.session) onLogin(data.user);
        else go("verify");
        return;
      }
      const { data, error } = await withTimeout(supabase.auth.signInWithPassword({ email, password }), 15000);
      if (error) throw error;
      if (!data.session) throw new Error("Email not confirmed");
      onLogin(data.user);
    } catch (e2) {
      setErr(friendly(e2.message));
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setLoading(true);
    const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: `${window.location.origin}/` } });
    setLoading(false);
    if (error) toast.error("Couldn't resend the link", { description: friendly(error.message) });
    else toast.success("Verification link sent", { description: `Check ${email}, including spam.` });
  };

  const heading = {
    login: ["Welcome back", "Sign in to your Omnya portal."],
    signup: requestedRole === "client" ? ["Set up your brand portal", "See delivery and results for every campaign."] : ["Create your account", "Join the Omnya creator network. An admin approves new accounts."],
    forgot: ["Reset your password", "We'll email you a link to choose a new one."],
    verify: ["Check your inbox", ""],
  }[mode];

  return (
    <div className="auth">
      <div className="login-wrap">
        <div className="login-card">
          <a href="/" className="login-logo" style={{ textDecoration: "none", color: "inherit" }}>
            <img src="/brand/mark.png" alt="" width="24" height="32" /> Omnya
          </a>

          {mode === "verify" ? (
            <div className="fade-in">
              <div className="empty-icon" style={{ marginBottom: 20 }}><Icon icon={Mail01Icon} size={20} /></div>
              <h1 className="login-title">{heading[0]}</h1>
              <p className="login-sub">We sent a confirmation link to <strong style={{ color: "var(--ink)" }}>{email}</strong>. Open it to finish setting up your account.</p>
              <Alert tone="info" style={{ marginBottom: 20 }}>
                {requestedRole === "client"
                  ? "Your brand portal opens as soon as you confirm your email."
                  : "After you confirm, an admin reviews your account. We'll email you when it's ready."}
              </Alert>
              <button className="btn btn-primary btn-full" onClick={resend} disabled={loading}>{loading ? "Sending…" : "Resend the link"}</button>
              <button className="btn btn-ghost btn-full mt-8" onClick={() => go("login")}>
                <Icon icon={ArrowLeft01Icon} size={16} /> Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={submit} noValidate key={mode} className="fade-in">
              <h1 className="login-title">{heading[0]}</h1>
              <p className="login-sub">{heading[1]}</p>

              {mode === "signup" && (
                <div className="form-group">
                  <span className="form-label" id="role-label">I'm joining as</span>
                  <div className="role-options" role="group" aria-labelledby="role-label">
                    {ROLES.map(r => (
                      <button key={r.id} type="button" className="role-option" aria-pressed={requestedRole === r.id} onClick={() => setRequestedRole(r.id)}>
                        <Icon icon={r.icon} size={18} />{r.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {mode === "signup" && (
                <div className="form-group">
                  <label className="form-label" htmlFor="name">{requestedRole === "client" ? "Your name or company" : "Full name"}</label>
                  <input id="name" className="form-input" value={fullName} onChange={e => setFullName(e.target.value)} autoComplete={requestedRole === "client" ? "organization" : "name"} required />
                </div>
              )}

              <div className="form-group">
                <label className="form-label" htmlFor="email">Email</label>
                <input id="email" className="form-input" type="email" inputMode="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus={mode === "login"} />
              </div>

              {mode !== "forgot" && (
                <div className="form-group">
                  <div className="flex-between">
                    <label className="form-label" htmlFor="password">Password</label>
                    {mode === "login" && <button type="button" className="text-btn fs-13" style={{ fontWeight: 500 }} onClick={() => go("forgot")}>Forgot password?</button>}
                  </div>
                  <PasswordInput id="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} />
                  {mode === "signup" && <span className="form-hint">At least 8 characters.</span>}
                </div>
              )}

              {mode === "signup" && (
                <div className="form-group">
                  <label className="form-label" htmlFor="confirm">Confirm password</label>
                  <PasswordInput id="confirm" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" invalid={!!mismatch} />
                  {mismatch && <span className="form-error">The passwords don't match yet.</span>}
                </div>
              )}

              {err && <Alert tone="error" style={{ marginBottom: 16 }}>{err}</Alert>}
              {notice && <Alert tone="success" style={{ marginBottom: 16 }}>{notice}</Alert>}

              <button type="submit" className="btn btn-primary btn-full btn-lg" disabled={loading || (mode === "forgot" && !!notice)}>
                {loading ? "One moment…" : { login: "Sign in", signup: "Create account", forgot: "Send reset link" }[mode]}
              </button>

              <p className="login-foot">
                {mode === "login" && <>New to Omnya? <button type="button" className="text-btn" onClick={() => go("signup")}>Create an account</button></>}
                {mode === "signup" && <>Already have an account? <button type="button" className="text-btn" onClick={() => go("login")}>Sign in</button></>}
                {mode === "forgot" && <button type="button" className="text-btn" onClick={() => go("login")}>Back to sign in</button>}
              </p>
            </form>
          )}
        </div>
      </div>
      <Aside />
    </div>
  );
}
