import { useState } from "react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { gooeyToast as toast } from "goey-toast";
import { describeWriteError, updateRows } from "../../../lib/db";
import { supabase } from "../../../supabaseClient";
import Icon from "../../../ui/Icon";
import { getInitials } from "../../../utils";

function Person({ c, children }) {
  return (
    <div className="list-item">
      <span className="flex-center gap-12" style={{ minWidth: 0 }}>
        <span className="avatar">{getInitials(c?.name)}</span>
        <span style={{ minWidth: 0 }}><span className="fw-600 fs-13 truncate" style={{ display: "block" }}>{c?.name || "Creator"}</span>
          <span className="fs-12 text-muted truncate" style={{ display: "block" }}>{c?.tiktok_handle ? `@${c.tiktok_handle}` : c?.email}</span></span>
      </span>
      <span className="flex gap-8" style={{ flexShrink: 0 }}>{children}</span>
    </div>
  );
}

// campaign_creators is the record; the trigger mirrors Approved rows into campaigns.assigned_creators (F-10).
export default function CreatorsPanel({ campaign, db, user, onRefresh }) {
  const [busy, setBusy] = useState(null);
  const [q, setQ] = useState("");
  const assigned = db.creators.filter(c => (campaign.assigned_creators || []).includes(c.id));
  const applications = (db.campaignCreators || []).filter(cc => cc.campaign_id === campaign.id && cc.status === "Applied");
  const available = db.creators.filter(c => !(campaign.assigned_creators || []).includes(c.id) && c.status === "Active" && (!q || (c.name || "").toLowerCase().includes(q.toLowerCase())));
  const name = (id) => db.creators.find(c => c.id === id)?.name || "Creator";

  const review = async (creatorId, status) => {
    setBusy(creatorId);
    const err = await updateRows("campaign_creators", { status, reviewed_by: user?.id || null, reviewed_at: new Date().toISOString() }, { campaign_id: campaign.id, creator_id: creatorId });
    setBusy(null);
    if (err) return toast.error(`Couldn't ${status === "Approved" ? "approve" : "decline"} the application`, { description: err });
    toast.success(status === "Approved" ? `${name(creatorId)} is on the campaign` : "Application declined");
    onRefresh();
  };

  const assign = async (creatorId) => {
    setBusy(creatorId);
    // Assigning is the approval, so an existing Applied or Declined row is upgraded.
    const { error } = await supabase.from("campaign_creators").upsert({
      campaign_id: campaign.id, creator_id: creatorId, assigned_by: user?.id || null, status: "Approved", reviewed_by: user?.id || null, reviewed_at: new Date().toISOString(),
    }, { onConflict: "campaign_id,creator_id" });
    if (error) { setBusy(null); return toast.error("Couldn't assign that creator", { description: describeWriteError(error) }); }
    await supabase.from("campaigns").update({ status: "In Progress" }).eq("id", campaign.id);
    setBusy(null);
    toast.success(`${name(creatorId)} assigned`);
    onRefresh();
  };

  const remove = async (creatorId) => {
    setBusy(creatorId);
    const { error } = await supabase.from("campaign_creators").delete().eq("campaign_id", campaign.id).eq("creator_id", creatorId);
    setBusy(null);
    if (error) return toast.error("Couldn't remove that creator", { description: error.message });
    toast(`${name(creatorId)} removed from the campaign`);
    onRefresh();
  };

  return (
    <div className="flex-col gap-24">
      {applications.length > 0 && (
        <section>
          <h3 className="section-title">Applications <span className="text-muted fw-500">{applications.length}</span></h3>
          <div className="card flush" style={{ padding: "0 16px" }}>
            {applications.map(app => (
              <Person key={app.id || app.creator_id} c={db.creators.find(c => c.id === app.creator_id)}>
                <span className="fs-12 text-muted desktop-only" style={{ alignSelf: "center" }}>{app.commitment || 1} videos</span>
                {app.demo_video_url && <a className="btn btn-ghost btn-sm" href={app.demo_video_url} target="_blank" rel="noreferrer">Sample<Icon icon={ArrowUpRight01Icon} size={14} /></a>}
                <button className="btn btn-ghost btn-sm" disabled={busy === app.creator_id} onClick={() => review(app.creator_id, "Declined")}>Decline</button>
                <button className="btn btn-primary btn-sm" disabled={busy === app.creator_id} onClick={() => review(app.creator_id, "Approved")}>Approve</button>
              </Person>
            ))}
          </div>
        </section>
      )}
      <section>
        <h3 className="section-title">On this campaign <span className="text-muted fw-500">{assigned.length}</span></h3>
        <div className="card flush" style={{ padding: "0 16px" }}>
          {assigned.length === 0 ? <p className="fs-13 text-muted" style={{ padding: "16px 0" }}>Nobody yet. Approve an application or add a creator below.</p>
            : assigned.map(c => <Person key={c.id} c={c}><button className="btn btn-ghost btn-sm" disabled={busy === c.id} onClick={() => remove(c.id)}>Remove</button></Person>)}
        </div>
      </section>
      <section>
        <div className="flex-between mb-12"><h3 className="section-title" style={{ margin: 0 }}>Add creators</h3>
          <input className="form-input" type="search" placeholder="Search by name" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 220, minHeight: 34, height: 34 }} aria-label="Search creators" /></div>
        <div className="card flush" style={{ padding: "0 16px", maxHeight: 320, overflowY: "auto" }}>
          {available.length === 0 ? <p className="fs-13 text-muted" style={{ padding: "16px 0" }}>{q ? "No active creators match." : "Every active creator is already on this campaign."}</p>
            : available.map(c => <Person key={c.id} c={c}><button className="btn btn-secondary btn-sm" disabled={busy === c.id} onClick={() => assign(c.id)}>Add</button></Person>)}
        </div>
      </section>
    </div>
  );
}
