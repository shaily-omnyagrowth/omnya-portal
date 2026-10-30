import { useMemo, useState } from "react";
import { Briefcase01Icon, Calendar03Icon, CheckmarkCircle02Icon, Clock01Icon } from "@hugeicons/core-free-icons";
import { gooeyToast as toast } from "goey-toast";
import { describeWriteError, uploadDemoVideo } from "../../lib/db";
import { supabase } from "../../supabaseClient";
import Alert from "../../ui/Alert";
import Dialog from "../../ui/Dialog";
import EmptyState from "../../ui/EmptyState";
import Icon from "../../ui/Icon";
import PageHeader from "../../ui/PageHeader";
import { daysLeftLabel, fmtDate, fmtMoney, platformKey, platformMeta } from "../../utils";

function ApplyDialog({ job, client, creator, user, onClose, onDone }) {
  const [commitment, setCommitment] = useState(1);
  const [demoVideoUrl, setDemoVideoUrl] = useState("");
  const [demoFile, setDemoFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // F-10: an application is a campaign_creators row with status 'Applied'; RLS pins that status.
  // A plain insert so a second application is refused instead of overwriting a decision.
  const apply = async (e) => {
    e.preventDefault();
    const count = Math.floor(Number(commitment));
    if (!Number.isFinite(count) || count < 1) return setErr("Commit to at least one video.");
    const link = demoVideoUrl.trim();
    if (link && !/^https?:\/\//i.test(link)) return setErr("The demo link needs to start with https://");
    setBusy(true); setErr("");

    let demoUrl = link || null;
    if (demoFile) {
      try { demoUrl = await uploadDemoVideo(demoFile, job.id, creator.name); }
      catch (e2) { setErr("Your demo video couldn't be uploaded: " + e2.message); setBusy(false); return; }
    }
    const { error } = await supabase.from("campaign_creators").insert({
      campaign_id: job.id, creator_id: creator.id, assigned_by: user.id,
      commitment: count, demo_video_url: demoUrl, status: "Applied",
    });
    setBusy(false);
    if (error) return setErr(error.code === "23505" ? "You've already applied to this campaign." : "Your application wasn't sent: " + describeWriteError(error));
    toast.success("Application sent", { description: `${client?.name || "The team"} will review it and you'll hear back here.` });
    onDone();
  };

  return (
    <Dialog
      title={`Apply to ${job.name}`}
      description={[client?.name, `${fmtMoney(job.pay_per_video)} per video`].filter(Boolean).join(" · ")}
      onClose={onClose}
      actions={<>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" form="apply-form" className="btn btn-primary" disabled={busy}>{busy ? "Sending…" : "Send application"}</button>
      </>}
    >
      <form id="apply-form" onSubmit={apply}>
        {job.description && <p className="fs-14 mb-16" style={{ color: "var(--ink2)", whiteSpace: "pre-line" }}>{job.description}</p>}
        <div className="form-group">
          <label className="form-label" htmlFor="commitment">How many videos can you deliver?</label>
          <input id="commitment" className="form-input" type="number" inputMode="numeric" min="1" max={Math.max(1, Number(job.videos_needed) || 1)} step="1"
            value={commitment} onChange={e => setCommitment(e.target.value)} style={{ maxWidth: 140 }} />
          <span className="form-hint">The campaign needs {job.videos_needed || "several"} in total.</span>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="demo-file">Sample of your work</label>
          <input id="demo-file" className="form-input" type="file" accept="video/*" onChange={e => setDemoFile(e.target.files?.[0] || null)} />
          <span className="form-hint">Upload a video, or paste a link below. Up to 200 MB.</span>
          <input className="form-input" placeholder="https://www.tiktok.com/@you/video/…" value={demoVideoUrl} disabled={!!demoFile}
            onChange={e => setDemoVideoUrl(e.target.value)} aria-label="Link to a sample video" inputMode="url" />
        </div>
        {err && <Alert tone="error">{err}</Alert>}
      </form>
    </Dialog>
  );
}

export default function JobBoard({ user, db, onRefresh }) {
  const creator = db.creators.find(c => c.user_id === user.id || c.email === user.email);
  const [applying, setApplying] = useState(null);
  const [platform, setPlatform] = useState("all");

  const openJobs = useMemo(() => db.campaigns
    .filter(c => c.status === "Open" && c.application_type === "Open Application")
    .sort((a, b) => new Date(a.deadline || "2999-01-01") - new Date(b.deadline || "2999-01-01")), [db.campaigns]);
  const platforms = [...new Set(openJobs.map(j => platformKey(j.format)).filter(Boolean))];
  const visible = platform === "all" ? openJobs : openJobs.filter(j => platformKey(j.format) === platform);

  if (!creator) {
    return <div className="content"><Alert tone="error" title="We couldn't find your creator profile">Contact your account manager and they'll link it for you.</Alert></div>;
  }

  return (
    <div className="content">
      <PageHeader title="Find jobs" description="Open campaigns you can apply to. Send a sample and how many videos you can make; the team replies here." />

      {platforms.length > 1 && (
        <div className="chip-row mb-16" role="group" aria-label="Filter by platform">
          <button className="chip" aria-pressed={platform === "all"} onClick={() => setPlatform("all")}>All ({openJobs.length})</button>
          {platforms.map(p => <button key={p} className="chip" aria-pressed={platform === p} onClick={() => setPlatform(p)}>{platformMeta(p).name}</button>)}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="card"><EmptyState icon={Briefcase01Icon} title="No open jobs right now">New campaigns open every week. Keep your social channels connected so you're ready to apply.</EmptyState></div>
      ) : (
        <div className="grid-auto" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(320px, 100%), 1fr))" }}>
          {visible.map(job => {
            const client = db.clients.find(c => c.id === job.client_id);
            const app = (db.campaignCreators || []).find(cc => cc.campaign_id === job.id && cc.creator_id === creator.id);
            const assigned = (job.assigned_creators || []).includes(creator.id) || app?.status === "Approved";
            const pending = !assigned && app?.status === "Applied";
            const declined = !assigned && app?.status === "Declined";
            const soon = job.deadline && new Date(job.deadline) - new Date() <= 3 * 86400000;
            const p = platformMeta(job.format);
            return (
              <article key={job.id} className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div className="flex-between" style={{ alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0 }}>
                    <h2 className="fw-600 fs-16 break-anywhere" style={{ lineHeight: 1.3 }}>{job.name}</h2>
                    {client?.name && <div className="fs-13 text-muted truncate">{client.name}</div>}
                  </div>
                  <div className="text-right" style={{ flexShrink: 0 }}>
                    <div className="fw-600 fs-16 tnum">{fmtMoney(job.pay_per_video)}</div>
                    <div className="fs-12 text-muted">per video</div>
                  </div>
                </div>
                {job.description && <p className="fs-13" style={{ color: "var(--ink2)", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{job.description}</p>}
                <div className="flex gap-8 flex-wrap fs-12">
                  <span className="badge badge-outline"><Icon icon={p.icon} size={12} />{p.name}</span>
                  <span className={`badge ${soon ? "badge-orange" : "badge-outline"}`}><Icon icon={Calendar03Icon} size={12} />{job.deadline ? `Due ${fmtDate(job.deadline)}` : "No deadline"}</span>
                  {job.videos_needed ? <span className="badge badge-outline">{job.videos_needed} videos</span> : null}
                </div>
                <div style={{ marginTop: "auto", paddingTop: 14, borderTop: "1px solid var(--border)" }} className="flex-between">
                  <span className="fs-12 text-muted">{soon ? daysLeftLabel(job.deadline) : ""}</span>
                  {assigned ? <span className="badge badge-green"><Icon icon={CheckmarkCircle02Icon} size={12} />You're on this campaign</span>
                    : pending ? <span className="badge badge-orange"><Icon icon={Clock01Icon} size={12} />Applied{app.commitment ? ` for ${app.commitment}` : ""}</span>
                    : declined ? <span className="badge badge-gray">Not selected this time</span>
                    : <button className="btn btn-primary btn-sm" onClick={() => setApplying(job)}>Apply</button>}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {applying && (
        <ApplyDialog job={applying} client={db.clients.find(c => c.id === applying.client_id)} creator={creator} user={user}
          onClose={() => setApplying(null)} onDone={() => { setApplying(null); onRefresh(); }} />
      )}
    </div>
  );
}
