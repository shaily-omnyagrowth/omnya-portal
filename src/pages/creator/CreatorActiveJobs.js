import { useState } from "react";
import { ArrowLeft01Icon, ArrowUpRight01Icon, Folder01Icon } from "@hugeicons/core-free-icons";
import EmptyState from "../../ui/EmptyState";
import Icon from "../../ui/Icon";
import PageHeader from "../../ui/PageHeader";
import { daysLeftLabel, fmtDate, fmtMoney, platformMeta, statusBadge } from "../../utils";
import CampaignForum from "../campaigns/CampaignForum";

const DONE = new Set(["Approved", "Published/Tracked"]);

export default function CreatorActiveJobs({ user, db, onNavigate }) {
  const creator = db.creators.find(c => c.user_id === user.id || c.email === user.email);
  const jobs = db.campaigns.filter(c => (c.assigned_creators || []).includes(creator?.id) && !["Completed", "Archived", "Cancelled"].includes(c.status));
  const [selectedId, setSelectedId] = useState(null);
  const job = jobs.find(j => j.id === selectedId);

  if (job) {
    const client = db.clients.find(c => c.id === job.client_id);
    const subs = db.submissions.filter(s => s.creator_id === creator?.id && s.campaign_id === job.id);
    const delivered = subs.filter(s => DONE.has(s.status)).length;
    const p = platformMeta(job.format);
    return (
      <div className="content">
        <button className="btn btn-ghost btn-sm mb-16" style={{ marginLeft: -8 }} onClick={() => setSelectedId(null)}>
          <Icon icon={ArrowLeft01Icon} size={16} />All projects
        </button>
        <PageHeader
          title={job.name}
          description={[client?.name, `${fmtMoney(job.pay_per_video)} per video`, job.deadline ? `due ${fmtDate(job.deadline)}` : "no deadline"].filter(Boolean).join(" · ")}
          actions={<button className="btn btn-primary" onClick={() => onNavigate("submit")}>Submit for this project</button>}
        />
        <div className="dash-grid">
          <section className="card">
            <h2 className="card-title">Brief</h2>
            {job.description ? <p className="fs-14" style={{ color: "var(--ink2)", whiteSpace: "pre-line" }}>{job.description}</p> : <p className="text-muted fs-14">No written brief yet. Ask in the thread below if anything is unclear.</p>}
            {job.brief_url && <a href={job.brief_url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm mt-16">Open full brief<Icon icon={ArrowUpRight01Icon} size={14} /></a>}
          </section>
          <section className="card">
            <h2 className="card-title">Your progress</h2>
            <dl className="kv">
              <dt>Status</dt><dd>{statusBadge(job.status)}</dd>
              <dt>Platform</dt><dd><Icon icon={p.icon} size={14} style={{ display: "inline", verticalAlign: "-2px", marginRight: 6 }} />{p.name}</dd>
              <dt>Deadline</dt><dd>{daysLeftLabel(job.deadline)}</dd>
              <dt>Sent</dt><dd>{subs.length} {subs.length === 1 ? "submission" : "submissions"}</dd>
              <dt>Approved</dt><dd>{delivered}</dd>
            </dl>
          </section>
        </div>
        <div className="section"><CampaignForum campaign={job} user={user} db={db} canPin={false} /></div>
      </div>
    );
  }

  return (
    <div className="content">
      <PageHeader title="Active projects" description="Campaigns you're booked on. Open one for the brief, your progress and the team thread." />
      {jobs.length === 0 ? (
        <div className="card">
          <EmptyState icon={Folder01Icon} title="No active projects" action={<button className="btn btn-primary btn-sm" onClick={() => onNavigate("jobs")}>Browse open jobs</button>}>
            When the team approves one of your applications, the campaign appears here.
          </EmptyState>
        </div>
      ) : (
        <div className="card flush">
          {jobs.map(j => {
            const client = db.clients.find(c => c.id === j.client_id);
            const subs = db.submissions.filter(s => s.creator_id === creator?.id && s.campaign_id === j.id);
            const delivered = subs.filter(s => DONE.has(s.status)).length;
            const p = platformMeta(j.format);
            return (
              <button key={j.id} className="video-row" style={{ padding: "16px 18px" }} onClick={() => setSelectedId(j.id)}>
                <span className="empty-icon" style={{ margin: 0, width: 36, height: 36, borderRadius: 10 }}><Icon icon={p.icon} size={18} /></span>
                <span className="flex-1">
                  <span className="fw-600 fs-14 truncate" style={{ display: "block" }}>{j.name}</span>
                  <span className="fs-12 text-muted truncate" style={{ display: "block" }}>{[client?.name, `${fmtMoney(j.pay_per_video)} per video`].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="text-right fs-12" style={{ flexShrink: 0 }}>
                  <span className="fw-600 fs-13" style={{ display: "block" }}>{delivered} approved</span>
                  <span className="text-muted">{daysLeftLabel(j.deadline)}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
