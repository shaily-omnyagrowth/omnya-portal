import { useState } from "react";
import { gooeyToast as toast } from "goey-toast";
import { describeWriteError } from "../lib/db";
import { supabase } from "../supabaseClient";
import Alert from "../ui/Alert";
import PageHeader from "../ui/PageHeader";
import { roleLabel } from "../app/nav";
import Avatar from "../ui/Avatar";

function Section({ title, desc, children, onSubmit, busy, dirty, err }) {
  return (
    <form className="settings-section" onSubmit={onSubmit} noValidate>
      <div className="settings-intro"><h2 className="card-title">{title}</h2><p className="card-desc">{desc}</p></div>
      <div className="card">
        {children}
        {err && <Alert tone="error" style={{ marginBottom: 16 }}>{err}</Alert>}
        <div className="settings-actions">
          <button type="submit" className="btn btn-primary" disabled={busy || !dirty}>{busy ? "Saving…" : "Save changes"}</button>
        </div>
      </div>
    </form>
  );
}

export default function Settings({ user, db, setUser, onRefresh }) {
  const role = user?.role === "account_manager" ? "am" : user?.role;
  const creator = role === "creator" ? (db?.creators || []).find(c => c.user_id === user.id) : null;

  const [name, setName] = useState(user?.full_name || "");
  const [pw, setPw] = useState({ next: "", confirm: "" });
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState({});

  const fail = (key, msg) => setErr(e => ({ ...e, [key]: msg }));

  const saveProfile = async (e) => {
    e.preventDefault();
    const full = name.trim();
    if (!full) return fail("profile", "Add your name. It's what your team and brands see.");
    setBusy("profile"); setErr({});
    const { data, error } = await supabase.from("user_profiles").update({ full_name: full }).eq("id", user.id).select("full_name");
    if (error || !data?.length) { setBusy(""); return fail("profile", error ? describeWriteError(error) : "Your profile wasn't updated. Sign out and back in, then try again."); }
    if (creator) await supabase.from("creators").update({ name: full }).eq("id", creator.id);
    setBusy("");
    setUser?.(prev => ({ ...prev, full_name: full }));
    toast.success("Profile saved");
    onRefresh?.();
  };

  const savePassword = async (e) => {
    e.preventDefault();
    if (pw.next.length < 8) return fail("password", "Use at least 8 characters.");
    if (pw.next !== pw.confirm) return fail("password", "The two passwords don't match.");
    setBusy("password"); setErr({});
    const { error } = await supabase.auth.updateUser({ password: pw.next });
    setBusy("");
    if (error) return fail("password", /same/i.test(error.message) ? "That's your current password. Pick a new one." : error.message);
    setPw({ next: "", confirm: "" });
    toast.success("Password changed", { description: "Use it the next time you sign in." });
  };

  const display = name.trim() || user?.email;

  return (
    <div className="content settings">
      <PageHeader title="Settings" description="Your profile and sign in details." />

      <div className="settings-who card">
        <Avatar name={display} className="avatar-lg" />
        <div className="min-w-0">
          <div className="fw-600 text-ink truncate">{display}</div>
          <div className="fs-13 text-muted truncate">{user?.email} · {roleLabel[role] || "Member"}</div>
        </div>
      </div>

      <Section title="Profile" desc="Shown to your team, and to brands on shared reports." onSubmit={saveProfile} busy={busy === "profile"} dirty={name.trim() !== (user?.full_name || "")} err={err.profile}>
        <div className="form-group"><label className="form-label" htmlFor="st-name">Full name</label><input id="st-name" className="form-input" value={name} onChange={e => setName(e.target.value)} autoComplete="name" maxLength={120} /></div>
        <div className="form-group"><label className="form-label" htmlFor="st-email">Email</label><input id="st-email" className="form-input" value={user?.email || ""} disabled /><span className="form-hint">To change the email you sign in with, contact hello@omnyagrowth.com.</span></div>
      </Section>


      <Section title="Password" desc="You stay signed in on this device after changing it." onSubmit={savePassword} busy={busy === "password"} dirty={!!pw.next} err={err.password}>
        <input type="email" autoComplete="username" value={user?.email || ""} readOnly hidden />
        <div className="form-row">
          <div className="form-group"><label className="form-label" htmlFor="st-pw">New password</label><input id="st-pw" className="form-input" type="password" autoComplete="new-password" value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} /><span className="form-hint">At least 8 characters.</span></div>
          <div className="form-group"><label className="form-label" htmlFor="st-pw2">Confirm it</label><input id="st-pw2" className="form-input" type="password" autoComplete="new-password" value={pw.confirm} onChange={e => setPw({ ...pw, confirm: e.target.value })} /></div>
        </div>
      </Section>
    </div>
  );
}
