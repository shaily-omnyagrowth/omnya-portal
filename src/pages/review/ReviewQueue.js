import { useMemo, useState } from "react";
import { Clock01Icon, TaskDone01Icon } from "@hugeicons/core-free-icons";
import { gooeyToast as toast } from "goey-toast";
import { callApi, sendEmail } from "../../lib/api";
import { describeWriteError } from "../../lib/db";
import { supabase } from "../../supabaseClient";
import Alert from "../../ui/Alert";
import Dialog from "../../ui/Dialog";
import EmptyState from "../../ui/EmptyState";
import Icon from "../../ui/Icon";
import PageHeader from "../../ui/PageHeader";
import Tabs from "../../ui/Tabs";
import VideoThumb from "../../ui/VideoThumb";
import { fmtCompactNum, fmtRelativeTime, platformMeta } from "../../utils";

const QUICK_NOTES = ["Show the product label for at least 2 seconds.", "Reshoot in natural light.", "Keep it under 30 seconds.", "Mention the brand name in the first 3 seconds.", "Use audio from the commercial library."];
const daysWaiting = (d) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : 0);

function FeedbackDialog({ mode, sub, creatorName, saving, error, onClose, onSubmit }) {
  const [text, setText] = useState("");
  const changes = mode === "changes";
  const add = (n) => setText(t => (t.trim() ? `${t.trim()}\n${n}` : n));
  return (
    <Dialog
      title={changes ? "Request changes" : "Decline this submission"}
      description={`${creatorName} sees this note${changes ? " and can send an updated version" : ""}.`}
      onClose={onClose}
      actions={<>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className={`btn ${changes ? "btn-primary" : "btn-danger"}`} disabled={saving || !text.trim()} onClick={() => onSubmit(text.trim())}>
          {saving ? "Sending…" : changes ? "Send revision request" : "Decline submission"}
        </button>
      </>}
    >
      {error && <Alert tone="error" style={{ marginBottom: 12 }}>{error}</Alert>}
      <div className="form-group">
        <label className="form-label" htmlFor="review-note">{changes ? "What needs to change" : "Why it isn't approved"}</label>
        <textarea id="review-note" className="textarea" rows={5} value={text} onChange={e => setText(e.target.value)} autoFocus
          placeholder={changes ? "Be specific so they can fix it in one pass." : "Explain the decision so they know for next time."} />
      </div>
      {changes && (
        <div className="chip-row" aria-label="Quick notes">
          {QUICK_NOTES.map(n => <button key={n} type="button" className="chip" onClick={() => add(n)}>{n}</button>)}
        </div>
      )}
      {sub?.notes && <p className="fs-12 text-muted mt-12">Creator's note: {sub.notes}</p>}
    </Dialog>
  );
}

export default function ReviewQueue({ db, onRefresh, user }) {
  const [tab, setTab] = useState("concepts");
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(null);
  const [actionError, setActionError] = useState("");

  const isOwner = db._currentUser?.role === "owner" || user?.role === "owner";
  const myAM = db.accountManagers.find(a => a.user_id === user?.id || a.email === user?.email);

  const scoped = useMemo(() => {
    if (isOwner) return db.submissions;
    const clientIds = new Set(db.clients.filter(c => c.am_id === myAM?.id).map(c => c.id));
    const campaignIds = new Set(db.campaigns.filter(c => clientIds.has(c.client_id)).map(c => c.id));
    return db.submissions.filter(s => campaignIds.has(s.campaign_id) || (myAM && db.creators.some(c => c.id === s.creator_id && c.am_id === myAM.id)));
  }, [db, isOwner, myAM]);

  const waiting = (s) => s.status === "Submitted" || s.status === "Under Review";
  const byOldest = (a, b) => new Date(a.submitted_at || a.created_at) - new Date(b.submitted_at || b.created_at);
  const lists = {
    concepts: scoped.filter(s => waiting(s) && s.submission_type !== "Final").sort(byOldest),
    finals: scoped.filter(s => waiting(s) && s.submission_type === "Final").sort(byOldest),
    revisions: scoped.filter(s => s.status === "Revision Requested").sort(byOldest),
  };
  const items = lists[tab];
  const overdue = [...lists.concepts, ...lists.finals].filter(s => daysWaiting(s.submitted_at || s.created_at) >= 3).length;

  // The write goes first and asks for the row back: an RLS refusal returns zero rows, not an error.
  const action = async (sub, value, feedback = "") => {
    setSaving(sub.id); setActionError("");
    const updates = { status: value, feedback, reviewed_at: new Date().toISOString(), reviewed_by: user?.id || null };
    if (value === "Approved") updates.approved_date = new Date().toISOString().split("T")[0];
    const campaign = db.campaigns.find(c => c.id === sub.campaign_id);
    const creator = db.creators.find(c => c.id === sub.creator_id);

    const { data: updated, error: updateErr } = await supabase.from("submissions").update(updates).eq("id", sub.id).select("id");
    if (updateErr || !updated?.length) {
      const msg = updateErr ? `It didn't save: ${describeWriteError(updateErr)}` : "That submission wasn't updated. You may not have permission to review this creator's work; check they're assigned to you.";
      setActionError(msg); setSaving(null);
      if (!modal) toast.error("Review not saved", { description: msg });
      return;
    }

    let followUp = "";
    if (value === "Approved") {
      if (campaign && !db.payments.find(p => p.submission_id === sub.id)) {
        try {
          await callApi("/api/payments/record-approval", { body: { submissionId: sub.id } });
        } catch (payErr) {
          followUp = `Its payment record wasn't created (${payErr.message}). Ask the owner to add it under Payouts.`;
        }
      }
      if (creator?.email) sendEmail("final_approved", { creatorEmail: creator.email, creatorName: creator.name, campaignName: campaign?.name || "your campaign", amount: campaign?.pay_per_video });
    }
    if (value === "Revision Requested" && creator?.email && feedback) {
      sendEmail("revision_requested", { creatorEmail: creator.email, creatorName: creator.name, campaignName: campaign?.name || "your campaign", amName: "Your account manager", feedback });
    }

    const name = creator?.name || "The creator";
    if (value === "Approved") toast.success("Approved", { description: followUp || `${name} has been notified.` });
    else if (value === "Revision Requested") toast.success("Changes requested", { description: `${name} will receive your notes by email.` });
    else if (value === "Rejected") toast("Submission declined", { description: `${name} can view the reason.` });
    else toast("Marked as in review");
    if (followUp) setActionError(followUp);
    setModal(null); setSaving(null);
    onRefresh();
  };

  const renderCard = (s) => {
    const creator = db.creators.find(c => c.id === s.creator_id);
    const campaign = db.campaigns.find(c => c.id === s.campaign_id);
    const client = db.clients.find(c => c.id === campaign?.client_id);
    const days = daysWaiting(s.submitted_at || s.created_at);
    const link = s.submission_type === "Final" ? (s.posted_link || s.posted_url) : s.concept_link;
    const p = platformMeta(s.platform || campaign?.format);
    const busy = saving === s.id;
    return (
      <article key={s.id} className="review-card">
        <div className="review-header">
          <VideoThumb sub={s} width={52} platform={s.platform || campaign?.format} />
          <div className="flex-1">
            <div className="flex-center gap-8 flex-wrap">
              <span className="review-name">{creator?.name || "Unknown creator"}</span>
              <span className="badge badge-outline"><Icon icon={p.icon} size={12} />{s.submission_type === "Final" ? "Final" : "Concept"}</span>
              {s.status === "Under Review" && <span className="badge badge-orange">In review</span>}
            </div>
            <div className="review-campaign truncate">{[campaign?.name, client?.name].filter(Boolean).join(" · ") || "Campaign"}</div>
            {s.notes && <p className="fs-13 mt-8" style={{ color: "var(--ink2)", whiteSpace: "pre-line" }}>“{s.notes}”</p>}
            {tab === "revisions" && s.feedback && <div className="sub-note warn"><span className="fw-600">Your notes</span><p>{s.feedback}</p></div>}
          </div>
          <div className="text-right" style={{ flexShrink: 0 }}>
            <div className={`fs-12 flex-center gap-4 ${days >= 3 ? "text-red fw-600" : "text-muted"}`} style={{ justifyContent: "flex-end" }}>
              <Icon icon={Clock01Icon} size={12} />{days === 0 ? "Today" : `${days}d waiting`}
            </div>
            <div className="fs-12 text-muted">{fmtRelativeTime(s.submitted_at || s.created_at)}</div>
            {Number(s.view_count_verified) > 0 && <div className="fs-12 text-green fw-600 mt-4">{fmtCompactNum(s.view_count_verified)} verified views</div>}
          </div>
        </div>
        <div className="review-actions">
          {link && <a href={link} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">Watch video</a>}
          {tab !== "revisions" ? (
            <>
              <span style={{ flex: 1 }} />
              {s.status !== "Under Review" && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => action(s, "Under Review")}>Mark in review</button>}
              <button className="btn btn-red btn-sm" disabled={busy} onClick={() => { setActionError(""); setModal({ s, mode: "decline" }); }}>Decline</button>
              <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => { setActionError(""); setModal({ s, mode: "changes" }); }}>Request changes</button>
              <button className="btn btn-green btn-sm" disabled={busy} onClick={() => action(s, "Approved")}>
                {busy ? "Saving…" : "Approve"}
              </button>
            </>
          ) : <span className="fs-13 text-muted">Waiting for {creator?.name?.split(" ")[0] || "the creator"} to send an update.</span>}
        </div>
      </article>
    );
  };

  return (
    <div className="content">
      <PageHeader
        title="Review queue"
        description={tab === "concepts" ? "Approve concepts before creators film and post. Oldest first." : tab === "finals" ? "Approve posted videos to complete delivery and create the payment." : "Submissions sent back for changes, waiting on the creator."}
      />
      {overdue > 0 && <Alert tone="warning" style={{ marginBottom: 16 }}>{overdue} {overdue === 1 ? "submission has" : "submissions have"} waited 3 days or more.</Alert>}
      {actionError && !modal && <Alert tone="error" style={{ marginBottom: 16 }}>{actionError}</Alert>}
      <Tabs label="Review stage" value={tab} onChange={setTab} tabs={[
        { id: "concepts", label: "Concepts waiting", count: lists.concepts.length },
        { id: "finals", label: "Finals waiting", count: lists.finals.length },
        { id: "revisions", label: "Changes requested", count: lists.revisions.length },
      ]} />
      {items.length === 0
        ? <div className="card"><EmptyState icon={TaskDone01Icon} title="All clear">{tab === "revisions" ? "No submissions are waiting on creators." : "Nothing is waiting for review. New submissions land here."}</EmptyState></div>
        : items.map(renderCard)}
      {modal && (
        <FeedbackDialog
          mode={modal.mode} sub={modal.s} saving={saving === modal.s.id} error={actionError}
          creatorName={db.creators.find(c => c.id === modal.s.creator_id)?.name || "The creator"}
          onClose={() => setModal(null)}
          onSubmit={(text) => action(modal.s, modal.mode === "changes" ? "Revision Requested" : "Rejected", text)}
        />
      )}
    </div>
  );
}
