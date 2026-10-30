import { useEffect, useState } from "react";
import { UserAdd01Icon } from "@hugeicons/core-free-icons";
import { gooeyToast as toast } from "goey-toast";
import { sendEmail } from "../../lib/api";
import { supabase } from "../../supabaseClient";
import confirm from "../../ui/confirm";
import EmptyState from "../../ui/EmptyState";
import PageHeader from "../../ui/PageHeader";
import { SkeletonTable } from "../../ui/Skeleton";
import { fmtRelativeTime } from "../../utils";
import Select from "../../ui/Select";

const ROLES = [["creator", "Creator"], ["am", "Account manager"], ["client", "Brand"]];
const roleName = (r) => (ROLES.find(([k]) => k === r || (r === "account_manager" && k === "am")) || [null, "Not specified"])[1];

export default function PendingUsers({ onRefresh }) {
  const [users, setUsers] = useState(null);
  const [saving, setSaving] = useState(null);
  const [draft, setDraft] = useState({});

  const load = async () => {
    const { data, error } = await supabase.from("user_profiles").select("*").eq("role", "pending").order("created_at", { ascending: true });
    if (error) toast.error("Couldn't load sign ups", { description: error.message });
    setUsers(data || []);
    setDraft(Object.fromEntries((data || []).map(u => [u.id, { name: u.full_name || u.email.split("@")[0], role: u.requested_role === "account_manager" ? "am" : u.requested_role || "creator" }])));
  };
  useEffect(() => { load(); }, []);

  // The role is written last: if creating the creator/AM/client record fails, the person stays pending.
  const approve = async (u) => {
    const { name, role } = draft[u.id];
    const displayName = name.trim() || u.email.split("@")[0];
    setSaving(u.id);
    try {
      if (role === "am") { const { error } = await supabase.from("account_managers").upsert({ user_id: u.id, email: u.email, name: displayName, status: "Active" }, { onConflict: "email" }); if (error) throw error; }
      if (role === "creator") { const { error } = await supabase.from("creators").upsert({ user_id: u.id, email: u.email, name: displayName, status: "Active" }, { onConflict: "email" }); if (error) throw error; }
      if (role === "client") { const { error } = await supabase.from("clients").upsert({ user_id: u.id, contact_email: u.email, name: displayName, status: "Active" }, { onConflict: "user_id" }); if (error) throw error; }
      const { data, error } = await supabase.from("user_profiles").update({ role, full_name: displayName }).eq("id", u.id).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("The role wasn't saved. You may not have permission to approve accounts.");
      sendEmail("user_approved", { userEmail: u.email, displayName, role });
      toast.success(`${displayName} approved as ${roleName(role).toLowerCase()}`, { description: "They can sign in now. We've emailed them." });
      setUsers(list => list.filter(x => x.id !== u.id));
      onRefresh?.();
    } catch (err) {
      toast.error(`${displayName} wasn't approved`, { description: err.message });
    } finally {
      setSaving(null);
    }
  };

  const deny = async (u) => {
    const ok = await confirm({ title: `Deny ${u.email}?`, body: "They won't be able to use the portal. You can give them a role later from Users.", confirmLabel: "Deny access", tone: "danger" });
    if (!ok) return;
    setSaving(u.id);
    const { error } = await supabase.from("user_profiles").update({ role: "denied" }).eq("id", u.id);
    setSaving(null);
    if (error) return toast.error("Not saved", { description: error.message });
    toast("Access denied", { description: u.email });
    setUsers(list => list.filter(x => x.id !== u.id));
  };

  return (
    <div className="content">
      <PageHeader title="Approvals" description="New sign ups can't use the portal until you give them a role. Check the name and role they asked for, then approve." />
      {users === null ? <SkeletonTable rows={4} cols={4} /> : users.length === 0 ? (
        <div className="card"><EmptyState icon={UserAdd01Icon} title="No one is waiting">New sign ups appear here, and in the sidebar count, as soon as they register.</EmptyState></div>
      ) : (
        <div className="card flush">
          {users.map(u => {
            const d = draft[u.id] || {};
            return (
              <div key={u.id} className="approve-row">
                <div className="flex-1" style={{ minWidth: 0 }}>
                  <div className="fw-600 fs-14 truncate">{u.email}</div>
                  <div className="fs-12 text-muted">Asked to join as {roleName(u.requested_role).toLowerCase()} · signed up {fmtRelativeTime(u.created_at).toLowerCase()}</div>
                </div>
                <input className="form-input" aria-label={`Name for ${u.email}`} value={d.name || ""} onChange={e => setDraft({ ...draft, [u.id]: { ...d, name: e.target.value } })} placeholder="Full name" />
                <Select className="select" aria-label={`Role for ${u.email}`} value={d.role} onChange={e => setDraft({ ...draft, [u.id]: { ...d, role: e.target.value } })}>
                  {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
                <span className="flex gap-8">
                  <button className="btn btn-ghost btn-sm" disabled={saving === u.id} onClick={() => deny(u)}>Deny</button>
                  <button className="btn btn-primary btn-sm" disabled={saving === u.id} onClick={() => approve(u)}>{saving === u.id ? "Approving…" : "Approve"}</button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
