import { useMemo, useState } from "react";
import { ArrowUpRight01Icon, Film01Icon, Upload04Icon } from "@hugeicons/core-free-icons";
import EmptyState from "../../ui/EmptyState";
import Icon from "../../ui/Icon";
import PageHeader from "../../ui/PageHeader";
import Tabs from "../../ui/Tabs";
import VideoThumb from "../../ui/VideoThumb";
import { fmtCompactNum, fmtDateTime, platformMeta, statusBadge, viewsOf } from "../../utils";

const FILTERS = {
  all: () => true,
  review: s => s.status === "Submitted" || s.status === "Under Review",
  changes: s => s.status === "Revision Requested",
  approved: s => s.status === "Approved" || s.status === "Published/Tracked",
  rejected: s => s.status === "Rejected",
};

export default function MySubmissions({ user, db, onNavigate }) {
  const creator = db.creators.find(c => c.user_id === user.id || c.email === user.email);
  const subs = useMemo(() => (creator ? db.submissions.filter(s => s.creator_id === creator.id) : [])
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)), [creator, db.submissions]);
  const [tab, setTab] = useState(() => (subs.some(FILTERS.changes) ? "changes" : "all"));
  const shown = subs.filter(FILTERS[tab]);
  const count = k => subs.filter(FILTERS[k]).length;
  const analytics = useMemo(() => Object.fromEntries((db.analytics || []).filter(a => a.submission_id).map(a => [a.submission_id, a])), [db.analytics]);

  return (
    <div className="content">
      <PageHeader
        title="Submissions"
        description="Everything you've sent and where it is in review. Requested changes include the reviewer's notes."
        actions={onNavigate && <button className="btn btn-primary" onClick={() => onNavigate("submit")}><Icon icon={Upload04Icon} size={16} />Submit content</button>}
      />
      <Tabs label="Filter submissions" value={tab} onChange={setTab} tabs={[
        { id: "all", label: "All", count: subs.length },
        { id: "review", label: "In review", count: count("review") },
        { id: "changes", label: "Changes requested", count: count("changes") },
        { id: "approved", label: "Approved", count: count("approved") },
        { id: "rejected", label: "Not approved", count: count("rejected") },
      ]} />

      {shown.length === 0 ? (
        <div className="card">
          <EmptyState icon={Film01Icon} title={subs.length ? "Nothing here" : "No submissions yet"}
            action={!subs.length && onNavigate && <button className="btn btn-primary btn-sm" onClick={() => onNavigate("submit")}>Submit your first video</button>}>
            {subs.length ? "No submissions match this filter." : "Send a concept for approval first, then the posted link once it's live."}
          </EmptyState>
        </div>
      ) : (
        <div className="card flush">
          {shown.map(s => {
            const camp = db.campaigns.find(c => c.id === s.campaign_id);
            const link = s.submission_type === "Final" ? (s.posted_link || s.posted_url) : s.concept_link;
            const views = viewsOf(s, analytics[s.id]);
            const verified = Number(s.view_count_verified) > 0;
            const p = platformMeta(s.platform || camp?.format);
            return (
              <article key={s.id} className="sub-row">
                <VideoThumb sub={s} width={44} platform={s.platform || camp?.format} />
                <div className="flex-1">
                  <div className="flex gap-8 flex-wrap" style={{ alignItems: "center" }}>
                    <h3 className="fw-600 fs-14 break-anywhere" style={{ lineHeight: 1.35 }}>{camp?.name || "Campaign"}</h3>
                    {statusBadge(s.status)}
                  </div>
                  <div className="fs-12 text-muted mt-4">
                    {s.submission_type === "Final" ? "Final video" : "Concept"} · {p.name} · sent {fmtDateTime(s.submitted_at || s.created_at)}
                  </div>
                  {s.feedback && (
                    <div className={`sub-note ${s.status === "Revision Requested" ? "warn" : ""}`}>
                      <span className="fw-600">Reviewer notes</span>
                      <p>{s.feedback}</p>
                    </div>
                  )}
                  {s.status === "Revision Requested" && onNavigate && (
                    <button className="btn btn-secondary btn-sm mt-8" onClick={() => onNavigate("submit")}>Send an updated version</button>
                  )}
                </div>
                <div className="sub-side">
                  {views > 0 && <div className="tnum"><span className="fw-600">{fmtCompactNum(views)}</span> <span className="fs-12 text-muted">{verified ? "verified views" : "views"}</span></div>}
                  {link && <a className="btn btn-ghost btn-sm" href={link} target="_blank" rel="noreferrer">Open<Icon icon={ArrowUpRight01Icon} size={14} /></a>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
