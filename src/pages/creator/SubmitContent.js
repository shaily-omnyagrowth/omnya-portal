import { useEffect, useState } from "react";
import { Folder01Icon, UserIcon } from "@hugeicons/core-free-icons";
import { gooeyToast as toast } from "goey-toast";
import { sendEmail } from "../../lib/api";
import { describeWriteError } from "../../lib/db";
import { supabase } from "../../supabaseClient";
import Alert from "../../ui/Alert";
import EmptyState from "../../ui/EmptyState";
import PageHeader from "../../ui/PageHeader";
import Segmented from "../../ui/Segmented";
import { DropZone, HowItWorks, VerifiedVideo } from "./submit/parts";
import { authedPost, linkPlatform, useConnectedPlatforms, useVerifyLink } from "./submit/useVerifyLink";
import Select from "../../ui/Select";
import { campaignPlatform } from "../../utils";

const BLANK = { campaign_id: "", type: "Concept", concept_link: "", posted_link: "", comment: "" };

// isOverride (§5.2): the owner files a submission on a creator's behalf, picking the creator first.
export default function SubmitContent({ user, db, onRefresh, setPage, isOverride = false }) {
  const ownCreator = db.creators.find(c => c.user_id === user.id || c.email === user.email);
  const [overrideCreatorId, setOverrideCreatorId] = useState("");
  const [form, setForm] = useState(BLANK);
  const [file, setFile] = useState(null);
  const [uploadMode, setUploadMode] = useState("file");
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [err, setErr] = useState("");

  const creator = isOverride ? db.creators.find(c => c.id === overrideCreatorId) : ownCreator;
  const { isConnected } = useConnectedPlatforms(creator?.user_id);
  const { verify, verifyErr, verifiedVideo, reset: resetVerify } = useVerifyLink({ creator, isConnected });

  const myJobs = db.campaigns.filter(c => (c.assigned_creators || []).includes(creator?.id) && c.status !== "Completed" && c.status !== "Archived");

  useEffect(() => {
    if (!myJobs.some(j => j.id === form.campaign_id)) setForm(f => ({ ...f, campaign_id: myJobs[0]?.id || "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creator?.id, myJobs.length]);

  const set = (patch) => setForm(f => ({ ...f, ...patch }));

  if (isOverride && !creator) {
    return (
      <div className="content">
        <PageHeader title="Submit for a creator" description="Record a submission the creator sent another way, by email for example. It's filed against their record and noted as filed by you." />
        <div className="card" style={{ maxWidth: 520 }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="override-creator">Creator</label>
            <Select id="override-creator" className="select" value={overrideCreatorId} onChange={e => setOverrideCreatorId(e.target.value)}>
              <option value="">Choose a creator</option>
              {db.creators.filter(c => c.status !== "Offboarded" && !c.archived_at).sort((a, b) => (a.name || "").localeCompare(b.name || "")).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
        </div>
      </div>
    );
  }

  if (!creator) return <div className="content"><EmptyState icon={UserIcon} title="Your creator profile isn't set up yet">Contact your account manager and they'll link it for you.</EmptyState></div>;

  if (myJobs.length === 0) {
    return (
      <div className="content">
        <PageHeader title={isOverride ? "Submit for a creator" : "Submit content"} />
        <div className="card">
          <EmptyState icon={Folder01Icon} title="No active campaigns"
            action={isOverride ? <button className="btn btn-secondary btn-sm" onClick={() => setOverrideCreatorId("")}>Pick another creator</button>
              : <button className="btn btn-primary btn-sm" onClick={() => setPage("jobs")}>Browse open jobs</button>}>
            {isOverride ? `${creator.name} isn't on an active campaign. Assign them first, then submit.` : "You can submit once you're booked on a campaign. Apply to an open job to get started."}
          </EmptyState>
        </div>
      </div>
    );
  }

  const platform = campaignPlatform(db.campaigns.find(c => c.id === form.campaign_id));

  const uploadToStorage = async (fileObj, campaignId) => {
    const campaign = db.campaigns.find(c => c.id === campaignId);
    const fileName = `${creator?.name}_${campaign?.name}_${new Date().toISOString().split("T")[0]}_${fileObj.name}`.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = `submissions/${campaignId}/${Date.now()}_${fileName}`;
    setUploadProgress(20);
    const { error } = await supabase.storage.from("submissions").upload(filePath, fileObj, {
      cacheControl: "3600", upsert: false,
      onUploadProgress: (p) => setUploadProgress(Math.round((p.loaded / p.total) * 70) + 20),
    });
    if (error) throw new Error(error.message);
    setUploadProgress(95);
    return supabase.storage.from("submissions").getPublicUrl(filePath).data.publicUrl;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.campaign_id) return setErr("Choose the campaign this is for.");
    if (uploadMode === "file" && !file) return setErr("Add the video file, or switch to pasting a link.");
    if (uploadMode === "link" && !form.concept_link.trim()) return setErr("Paste the video link.");
    const linked = form.type === "Final" && uploadMode === "link" ? linkPlatform(form.concept_link) : null;
    if (linked && linked !== platform) return setErr(`This campaign is for ${platform} videos. Paste the link to your ${platform} post.`);
    if (form.type === "Final" && !isConnected(platform)) return setErr(`Connect ${platform} on the Social channels page first, so views can be verified.`);
    setSubmitting(true); setErr(""); setUploadProgress(0);

    let fileLink = form.concept_link.trim();
    if (uploadMode === "file" && file) {
      try { setUploadProgress(10); fileLink = await uploadToStorage(file, form.campaign_id); setUploadProgress(90); }
      catch (e2) { setErr("The upload didn't finish: " + e2.message); setSubmitting(false); setUploadProgress(0); return; }
    }

    let verified = verifiedVideo;
    if (form.type === "Final" && uploadMode === "link" && !verified) {
      verified = await verify(fileLink, platform);
      if (!verified) { setSubmitting(false); return; }
    }

    const postedUrl = form.type === "Final" && uploadMode === "link" ? (verified?.url || fileLink) : (form.posted_link || null);
    const { data: inserted, error } = await supabase.from("submissions").insert({
      creator_id: creator.id, campaign_id: form.campaign_id, submission_type: form.type, concept_link: fileLink,
      status: "Submitted", posted_link: postedUrl, posted_url: postedUrl, platform, payment_status: "Unpaid",
      notes: isOverride ? `[Filed by ${user.email} on the creator's behalf] ${form.comment || ""}`.trim() : (form.comment || null),
    }).select().single();
    if (error) { setErr(describeWriteError(error)); setSubmitting(false); setUploadProgress(0); return; }

    // Stamp verified metrics server side, or ask for a first analytics sync.
    if (inserted?.id && (postedUrl || (form.type === "Final" && uploadMode === "link"))) {
      const path = form.type === "Final" && uploadMode === "link" ? "/api/social/verify-video-link" : "/api/analytics/manual-sync";
      const body = path.includes("verify") ? { submissionId: inserted.id, url: postedUrl, platform } : { submissionId: inserted.id };
      authedPost(path, body).catch(() => {});
    }

    const campaign = db.campaigns.find(c => c.id === form.campaign_id);
    const am = db.accountManagers.find(a => a.id === db.clients.find(c => c.id === campaign?.client_id)?.am_id);
    if (am?.email) sendEmail("new_submission", { amEmail: am.email, creatorName: creator.name, campaignName: campaign?.name || "Unknown campaign", submissionType: form.type, platform, notes: form.comment });

    setFile(null); setUploadProgress(0); setSubmitting(false);
    setForm({ ...BLANK, campaign_id: myJobs[0]?.id || "" });
    resetVerify();
    onRefresh?.();
    toast.success(`${form.type === "Final" ? "Final video" : "Concept"} sent for review`, {
      description: isOverride ? `Filed for ${creator.name}.` : "Your account manager has been notified. Feedback usually lands within 1 to 3 days.",
    });
    if (isOverride) setOverrideCreatorId("");
    else setPage("submissions");
  };

  const linkLabel = form.type === "Concept" ? "Review link" : "Posted video link";

  return (
    <div className="content">
      <PageHeader
        title={isOverride ? `Submit for ${creator.name}` : "Submit content"}
        description={isOverride ? "Filed against this creator's record and noted as filed by you." : "Send a concept for approval first. Once it's posted, send the final link so views can be tracked."}
        actions={isOverride && <button className="btn btn-secondary" onClick={() => setOverrideCreatorId("")}>Change creator</button>}
      />
      <div className="submit-layout">
        <form className="card" onSubmit={submit} noValidate>
          <div className="form-section">
            <div className="form-group">
              <label className="form-label" htmlFor="campaign">Campaign</label>
              <Select id="campaign" className="select" value={form.campaign_id} onChange={e => set({ campaign_id: e.target.value })}>
                {myJobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
              </Select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <span className="form-label" id="type-label">What are you sending?</span>
              <Segmented label="Submission type" value={form.type} onChange={t => { set({ type: t }); resetVerify(); if (t === "Final") setUploadMode("link"); }}
                options={[["Concept", "Concept for approval"], ["Final", "Final posted video"]]} />
            </div>
          </div>

          <div className="form-section">
            <div className="flex-between mb-12">
              <span className="form-label">Video</span>
              {form.type === "Concept" && <Segmented label="Upload method" value={uploadMode} onChange={m => { setUploadMode(m); resetVerify(); }} options={[["file", "Upload file"], ["link", "Paste link"]]} />}
            </div>
            {uploadMode === "file" ? (
              <DropZone file={file} onFile={setFile} progress={uploadProgress} busy={submitting} />
            ) : (
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="sr-only" htmlFor="video-link">{linkLabel}</label>
                <input id="video-link" className="form-input" inputMode="url" value={form.concept_link}
                  placeholder={form.type === "Concept" ? "https://www.loom.com/share/…" : "https://www.tiktok.com/@you/video/…"}
                  onChange={e => { set({ concept_link: e.target.value }); resetVerify(); }} />
                <span className="form-hint">{form.type === "Concept" ? "A Loom, Google Drive or Frame.io link the team can open." : "App share links like vt.tiktok.com or youtu.be work too."}</span>
              </div>
            )}

            {form.type === "Final" && platform && !isConnected(platform) && <span className="form-error">Connect {platform} on Social channels to submit {platform} videos.</span>}
            {verifyErr && <Alert tone="error" style={{ marginTop: 12 }}>{verifyErr}</Alert>}
            {verifiedVideo && <VerifiedVideo video={verifiedVideo} />}
          </div>

          <div className="form-section">
            <div className="form-group">
              <label className="form-label" htmlFor="comment">Notes for your account manager <span className="text-muted" style={{ fontWeight: 400 }}>(optional)</span></label>
              <textarea id="comment" className="textarea" rows={3} value={form.comment} onChange={e => set({ comment: e.target.value })} placeholder="Anything they should know before reviewing" />
            </div>
            {err && <Alert tone="error" style={{ marginBottom: 16 }}>{err}</Alert>}
            <button type="submit" className="btn btn-primary btn-lg" disabled={submitting}>
              {submitting ? (uploadProgress > 0 ? "Uploading…" : "Sending…") : "Send for review"}
            </button>
          </div>
        </form>
        <HowItWorks type={form.type} />
      </div>
    </div>
  );
}
