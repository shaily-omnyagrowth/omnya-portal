import { useEffect, useState } from "react";
import { sendEmail } from "../../lib/api";
import { supabase } from "../../supabaseClient";
import Spinner from "../../ui/Spinner";

export default function PendingUsers({ onRefresh }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [names, setNames] = useState({});

  const loadPending = async () => {
    setLoading(true);
    const { data } = await supabase.from("user_profiles").select("*").eq("role", "pending");
    setUsers(data || []);
    const n = {};
    (data||[]).forEach(u => { n[u.id] = u.full_name || u.email.split("@")[0]; });
    setNames(n);
    setLoading(false);
  };

  useEffect(() => { loadPending(); }, []);

  const assignRole = async (userId, email, role) => {
    setSaving(userId);
    try {
      const displayName = names[userId] || email.split("@")[0];

      // The role row is written LAST. It used to go first, so when the creators
      // / account_managers / clients upsert below failed, the person was left
      // holding the role with no record behind it: gone from this queue, absent
      // from Manage Creators, and greeted with "Creator profile not found".
      // In this order a failure leaves them pending, with the error on screen.
      if (role === "am" || role === "account_manager") {
        const { error: amError } = await supabase.from("account_managers").upsert({ user_id: userId, email, name: displayName, status: "Active" }, { onConflict: "email" });
        if(amError) throw amError;
      }
      if (role === "creator") {
        const { error: cError } = await supabase.from("creators").upsert({ user_id: userId, email, name: displayName, status: "Active" }, { onConflict: "email" });
        if(cError) throw cError;
      }
      if (role === "client") {
        const { error: clError } = await supabase.from("clients").upsert({ user_id: userId, contact_email: email, name: displayName, status: "Active" }, { onConflict: "user_id" });
        if(clError) throw clError;
      }

      const { data: promoted, error: upError } = await supabase
        .from("user_profiles").update({ role, full_name: displayName }).eq("id", userId).select("id");
      if (upError) throw upError;
      if (!promoted || promoted.length === 0) throw new Error("The role was not saved. You may not have permission to approve users.");

      // Email: welcome the newly approved user
      sendEmail("user_approved", {
        userEmail: email,
        displayName,
        role,
      });

      loadPending();
      if (typeof onRefresh === "function") {
        await onRefresh();
      }
    } catch(err) {
      console.error("Failed to assign role:", err);
      alert("Error assigning role: " + err.message);
    } finally {
      setSaving(null);
    }
  };

  const denyUser = async (userId) => {
    setSaving(userId);
    await supabase.from("user_profiles").update({ role: "denied" }).eq("id", userId);
    setSaving(null);
    loadPending();
  };

  if (loading) return <Spinner />;

  return (
    <div className="content">
      <div className="card mb-16" style={{background:"var(--bg2)"}}>
        <div style={{fontSize:13,color:"var(--ink3)"}}>
          New signups waiting for role assignment. Enter their name, then click Creator, AM or Client to give them access. They'll be able to log in immediately.
        </div>
      </div>
      {users.length === 0 ? (
        <div className="empty"><div className="empty-icon">✅</div><h3>No pending users</h3><p>Everyone has been assigned a role</p></div>
      ) : (
        users.map(u => (
          <div key={u.id} className="card mb-12">
            <div className="flex-between" style={{flexWrap:"wrap",gap:12}}>
              <div style={{flex:1,minWidth:200}}>
                <div style={{fontWeight:600,marginBottom:4}}>{u.email}{u.requested_role&&<span style={{marginLeft:8,fontSize:11,padding:"2px 8px",borderRadius:20,background:u.requested_role==="am"?"var(--blue)":u.requested_role==="client"?"var(--orange)":"var(--green)",color:"#fff",fontWeight:500}}>{u.requested_role==="am"?"Account Manager":u.requested_role==="client"?"Client / Brand Partner":"Creator"}</span>}</div>
                <input
                  className="form-input"
                  style={{marginTop:6,fontSize:13}}
                  placeholder="Enter their name..."
                  value={names[u.id]||""}
                  onChange={e=>setNames({...names,[u.id]:e.target.value})}
                />
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <button className="btn btn-sm" style={{background:"var(--green)",color:"#fff"}} disabled={saving===u.id} onClick={()=>assignRole(u.id, u.email, "creator")}>
                  {saving===u.id?"...":"✓ Creator"}
                </button>
                <button className="btn btn-sm" style={{background:"var(--blue)",color:"#fff"}} disabled={saving===u.id} onClick={()=>assignRole(u.id, u.email, "am")}>
                  {saving===u.id?"...":"✓ AM"}
                </button>
                <button className="btn btn-sm" style={{background:"var(--orange)",color:"#fff"}} disabled={saving===u.id} onClick={()=>assignRole(u.id, u.email, "client")}>
                  {saving===u.id?"...":"✓ Client"}
                </button>
                <button className="btn btn-sm" style={{background:"var(--red)",color:"#fff"}} disabled={saving===u.id} onClick={()=>denyUser(u.id)}>
                  {saving===u.id?"...":"✗ Deny"}
                </button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
