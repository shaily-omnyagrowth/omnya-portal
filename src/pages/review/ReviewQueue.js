import { useState } from "react";
import { sendEmail } from "../../lib/api";
import { describeWriteError } from "../../lib/db";
import { supabase } from "../../supabaseClient";
import ErrorMsg from "../../ui/ErrorMsg";
import { fmtDateTime, getAvatarColor, getInitials } from "../../utils";

export default function ReviewQueue({ db, onRefresh, user }) {
  const [tab, setTab] = useState("concepts");
  const [modal, setModal] = useState(null);
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  // Surfaces a write that did not land. See the note in action() below.
  const [actionError, setActionError] = useState("");

  const isOwner = db._currentUser?.role === "owner" || user?.role === "owner";
  const myAM = db.accountManagers.find(a=>a.user_id===user?.id||a.email===user?.email);
  const myClientIds = new Set(db.clients.filter(c=>c.am_id===myAM?.id).map(c=>c.id));
  const myCampaignIds = new Set(db.campaigns.filter(c=>myClientIds.has(c.client_id)).map(c=>c.id));

  const scopedSubmissions = isOwner
    ? db.submissions
    : db.submissions.filter(s =>
        myCampaignIds.has(s.campaign_id) ||
        (myAM && db.creators.some(c => c.id === s.creator_id && c.am_id === myAM.id))
      );

  const isWaiting = (s) => s.status==="Submitted" || s.status==="Under Review";
  const concepts = scopedSubmissions.filter(s=>isWaiting(s) && s.submission_type!=="Final");
  const finals = scopedSubmissions.filter(s=>isWaiting(s) && s.submission_type==="Final");
  const revisions = scopedSubmissions.filter(s=>s.status==="Revision Requested");

  const getDaysWaiting = (dateStr) => {
    if (!dateStr) return 0;
    return Math.floor((Date.now()-new Date(dateStr).getTime())/(1000*60*60*24));
  };

  const action = async (subId, field, value) => {
    setSaving(true);
    const updates = {
      [field]: value,
      feedback,
      reviewed_at: new Date().toISOString(),
      // §5.1: approvals and rejections generate audit events.
      // trg_audit_submission_review reads this column for the actor.
      reviewed_by: user?.id || null,
    };
    const sub = db.submissions.find(s=>s.id===subId);
    const campaign = db.campaigns.find(c=>c.id===sub?.campaign_id);
    const creator = db.creators.find(c=>c.id===sub?.creator_id);

    if (value === "Approved" && field === "status") {
      updates.approved_date = new Date().toISOString().split("T")[0];
    }

    // The write goes FIRST. The payment row and the emails below are
    // consequences of a review that happened; they used to run before it, so a
    // refused approval still created a payable row and still told the creator
    // they had been approved.
    // The result of this write used to be discarded. If RLS refused it, or a
    // CHECK rejected the value, or the network dropped, the modal closed anyway
    // and the reviewer was shown nothing — so an AM believed they had sent a
    // revision request that never happened, and the creator was never told.
    // tests/regression.test.cjs caught exactly that: the button was found, the
    // modal filled, "Send Revision Request" clicked, and final_status stayed
    // "Pending" with feedback null.
    //
    // .select() is what makes it detectable at all. Without it PostgREST
    // reports success for an UPDATE that matched zero rows, which is precisely
    // what an RLS refusal looks like: no error, no rows, no clue.
    const { data: updated, error: updateErr } = await supabase
      .from("submissions")
      .update(updates)
      .eq("id", subId)
      .select("id");

    if (updateErr) {
      setActionError(`Could not save: ${updateErr.message}`);
      setSaving(false);
      return;                        // leave the modal open, feedback intact
    }
    if (!updated || updated.length === 0) {
      setActionError(
        "That submission was not updated — you may not have permission to review " +
        "this creator's work. Check they are assigned to you."
      );
      setSaving(false);
      return;
    }

    let followUp = "";

    if (value === "Approved" && field === "status") {
      // Auto-generate payment record
      if (sub && campaign) {
        const existingPayment = db.payments.find(p=>p.submission_id===subId);
        if (!existingPayment) {
          // supabase-js does not throw on a refused insert, it returns the
          // error — so a try/catch here caught nothing and an approval could
          // quietly leave the creator with no payment row. The approval has
          // already landed by this point, so report it rather than fail it.
          const { error: payErr } = await supabase.from("payments").insert({
            creator_id: sub.creator_id,
            campaign_id: sub.campaign_id,
            submission_id: subId,
            videos_approved: 1,
            amount_owed: Number(campaign.pay_per_video||0),
            week_ending: new Date().toISOString().split("T")[0],
            status: "Pending",
            payment_method: "Venmo",
          });
          if (payErr) {
            console.warn("approve: payment row not created:", payErr.code, payErr.message);
            followUp = "The video was approved, but its payment record could not be created (" + describeWriteError(payErr) + "). Ask the owner to add it in Payment Management.";
          }
        }
      }
      // Email: notify creator their final was approved
      if (creator?.email) {
        sendEmail("final_approved", {
          creatorEmail: creator.email,
          creatorName: creator.name,
          campaignName: campaign?.name || "your campaign",
          amount: campaign?.pay_per_video,
        });
      }
    }

    // Email: revision requested on concept or final
    if ((field === "status" || field === "status") && value === "Revision Requested") {
      if (creator?.email && feedback) {
        sendEmail("revision_requested", {
          creatorEmail: creator.email,
          creatorName: creator.name,
          campaignName: campaign?.name || "your campaign",
          amName: "Your Account Manager",
          feedback,
        });
      }
    }

    setActionError(followUp);
    await onRefresh();
    setModal(null); setFeedback(""); setSaving(false);
  };

  const tabs = [
    { id:"concepts", label:"📽️ Concepts Waiting", count:concepts.length, color:"var(--blue)" },
    { id:"finals",   label:"🎬 Finals Waiting",   count:finals.length,   color:"var(--green)" },
    { id:"revisions",label:"↺ Revisions Out",     count:revisions.length,color:"var(--orange)" },
  ];

  const items = tab==="concepts"?concepts:tab==="finals"?finals:revisions;

  const renderCard = (s) => {
    const creator = db.creators.find(c=>c.id===s.creator_id);
    const campaign = db.campaigns.find(c=>c.id===s.campaign_id);
    const client = db.clients.find(c=>c.id===campaign?.client_id);
    const days = getDaysWaiting(s.created_at);
    const isUrgent = days >= 3;
    const videoLink = s.submission_type==="Final" ? (s.posted_link || s.posted_url) : s.concept_link;

    return (
      <div key={s.id} className="review-card" style={{borderLeft: isUrgent?"3px solid var(--red)":"3px solid var(--border)"}}>
        <div className="review-header">
          <div className={`creator-avatar ${getAvatarColor(creator?.name||"")}`}>{getInitials(creator?.name||"?")}</div>
          <div className="review-meta" style={{flex:1}}>
            <div className="review-name">{creator?.name||"Unknown"}</div>
            <div className="review-campaign">{campaign?.name} · {client?.name}</div>
            {s.notes&&<div style={{fontSize:11,color:"var(--ink3)",marginTop:2,fontStyle:"italic"}}>💬 "{s.notes}"</div>}
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:11,color:isUrgent?"var(--red)":"var(--ink3)",fontWeight:isUrgent?600:400}}>
              {isUrgent?"🚨 ":""}{days}d waiting
            </div>
            <div style={{fontSize:11,color:"var(--ink3)"}}>{fmtDateTime(s.created_at)}</div>
          </div>
        </div>

        {/* Video preview link */}
        {videoLink&&(
          <div style={{margin:"10px 0",padding:"10px 12px",background:"var(--bg2)",borderRadius:"var(--radius-sm)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div>
              <span style={{fontSize:12,color:"var(--ink3)"}}>
                {s.submission_type==="Final"?"🎬 Final":"📽️ Concept"} · {s.platform || campaign?.format || "Video"}
              </span>
              {s.view_count_verified != null && Number(s.view_count_verified) > 0 && (
                <div style={{ fontSize: 11, color: "var(--green)", fontWeight: 600, marginTop: 2 }}>
                  ✓ {Number(s.view_count_verified).toLocaleString()} verified views
                </div>
              )}
            </div>
            <a href={videoLink} target="_blank" rel="noreferrer" className="btn btn-sm btn-primary">View Video →</a>
          </div>
        )}

        {/* Feedback if revisions were requested */}
        {tab==="revisions"&&s.feedback&&(
          <div style={{margin:"8px 0",padding:"10px 12px",background:"rgba(255,165,0,0.08)",borderRadius:"var(--radius-sm)",fontSize:12,color:"var(--ink2)"}}>
            <div style={{fontSize:10,color:"var(--orange)",fontWeight:600,marginBottom:4}}>REVISION NOTES</div>
            {s.feedback}
          </div>
        )}

        {/* Actions */}
        <div className="review-actions">
          {tab==="concepts"&&<>
            <button className="btn btn-green btn-sm" onClick={()=>action(s.id,"status","Approved")}>✓ Approve</button>
            <button className="btn btn-sm" style={{background:"var(--blue)",color:"#fff"}} onClick={()=>action(s.id,"status","Under Review")}>👁️ Mark Under Review</button>
            <button className="btn btn-orange btn-sm" onClick={()=>{setModal({s,action:"revisions"});setFeedback("");}}>↺ Revisions</button>
            <button className="btn btn-red btn-sm" onClick={()=>{setModal({s,action:"deny"});setFeedback("");}}>✕ Deny</button>
          </>}
          {tab==="finals"&&<>
            <button className="btn btn-green btn-sm" onClick={()=>action(s.id,"status","Approved")}>✓ Approve</button>
            <button className="btn btn-sm" style={{background:"var(--blue)",color:"#fff"}} onClick={()=>action(s.id,"status","Under Review")}>👁️ Mark Under Review</button>
            <button className="btn btn-orange btn-sm" onClick={()=>{setModal({s,action:"revisions-final"});setFeedback("");}}>↺ Changes</button>
            <button className="btn btn-red btn-sm" onClick={()=>{setModal({s,action:"deny-final"});setFeedback("");}}>✕ Deny</button>
          </>}
          {tab==="revisions"&&<>
            <div style={{fontSize:12,color:"var(--ink3)",fontStyle:"italic"}}>Waiting for creator to resubmit...</div>
          </>}
        </div>
      </div>
    );
  };

  return (
    <div className="content">
      {/* Approve is a one-click action with no modal, so an error raised by it
          had nowhere to appear: the only place actionError was drawn is inside
          the feedback modal below. */}
      {actionError && !modal && <ErrorMsg msg={actionError} />}
      {/* Flow tabs with counts */}
      <div style={{display:"flex",gap:10,marginBottom:20,flexWrap:"wrap"}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            display:"flex",alignItems:"center",gap:8,padding:"10px 16px",
            background:tab===t.id?"var(--ink)":"var(--bg2)",
            color:tab===t.id?"#fff":"var(--ink)",
            border:`1px solid ${tab===t.id?"var(--ink)":"var(--border)"}`,
            borderRadius:"var(--radius-sm)",cursor:"pointer",fontSize:13,fontWeight:500
          }}>
            {t.label}
            <span style={{
              background:t.count>0?(tab===t.id?"rgba(255,255,255,0.2)":t.color):"var(--border)",
              color:t.count>0?(tab===t.id?"#fff":"#fff"):"var(--ink3)",
              borderRadius:20,padding:"1px 8px",fontSize:11,fontWeight:700,minWidth:20,textAlign:"center"
            }}>{t.count}</span>
          </button>
        ))}
      </div>

      {/* Flow description */}
      <div style={{fontSize:12,color:"var(--ink3)",marginBottom:16,padding:"8px 12px",background:"var(--bg2)",borderRadius:"var(--radius-sm)"}}>
        {tab==="concepts"&&"📽️ Review concept videos before creators film the final version. Approve to move them to filming."}
        {tab==="finals"&&"🎬 Review final videos ready to post. Approve to mark as complete and trigger payment."}
        {tab==="revisions"&&"↺ These creators have been asked to revise their concept. Waiting for resubmission."}
      </div>

      {items.length===0&&<div className="empty"><div className="empty-icon">✅</div><h3>All clear!</h3><p>No {tab==="concepts"?"concepts waiting":tab==="finals"?"finals waiting":"revisions pending"}</p></div>}
      {items.map(s=>renderCard(s))}

      {modal&&(
        <div className="modal-overlay" onClick={()=>setModal(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-title">
              {modal.action==="revisions"||modal.action==="revisions-final"?"↺ Request Revisions":"✕ Deny Submission"}
            </div>
            <div className="modal-sub">This feedback will be visible to the creator</div>
            {actionError && <ErrorMsg msg={actionError} />}
            <div className="form-group">
              <label className="form-label">Feedback <span style={{color:"var(--red)"}}>*</span></label>
              <textarea className="textarea" rows={4} placeholder="Be specific — what needs to change and why..." value={feedback} onChange={e=>setFeedback(e.target.value)}/>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={()=>setModal(null)}>Cancel</button>
              <button
                className={`btn ${modal.action==="revisions"||modal.action==="revisions-final"?"btn-orange":"btn-red"}`}
                disabled={saving||!feedback.trim()}
                onClick={()=>{
                  if(modal.action==="revisions") action(modal.s.id,"status","Revision Requested");
                  else if(modal.action==="revisions-final") action(modal.s.id,"status","Revision Requested");
                  else if(modal.action==="deny") action(modal.s.id,"status","Rejected");
                  else action(modal.s.id,"status","Rejected");
                }}
              >{saving?"Saving...":modal.action==="revisions"||modal.action==="revisions-final"?"Send Revision Request":"Confirm Denial"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
