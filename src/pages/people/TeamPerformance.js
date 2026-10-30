import { useState } from "react";
import { UserGroupIcon } from "@hugeicons/core-free-icons";
import { gooeyToast as toast } from "goey-toast";
import { updateRows } from "../../lib/db";
import EmptyState from "../../ui/EmptyState";
import PageHeader from "../../ui/PageHeader";
import { getInitials } from "../../utils";

const LIVE = new Set(["Approved", "Published/Tracked"]);

function Rating({ value, onChange, label }) {
  return (
    <span className="rating" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} of 5`} className={n <= (value || 0) ? "on" : ""} onClick={() => onChange(n)} />
      ))}
    </span>
  );
}

function stats(am, db) {
  const creators = db.creators.filter(c => c.am_id === am.id);
  const clients = db.clients.filter(c => c.am_id === am.id && !c.archived_at);
  const campaigns = db.campaigns.filter(c => clients.some(cl => cl.id === c.client_id));
  const subs = db.submissions.filter(s => creators.some(c => c.id === s.creator_id));
  const reviewed = subs.filter(s => s.reviewed_at && s.created_at);
  const turnaround = reviewed.length ? reviewed.reduce((t, s) => t + (new Date(s.reviewed_at) - new Date(s.created_at)) / 86400000, 0) / reviewed.length : null;
  const approved = subs.filter(s => LIVE.has(s.status));
  const revenue = clients.reduce((t, c) => t + Number(c.budget || 0), 0);
  const creatorCost = approved.reduce((t, s) => t + Number(db.campaigns.find(c => c.id === s.campaign_id)?.pay_per_video || 0), 0);
  const margin = revenue > 0 ? Math.round(((revenue - creatorCost - revenue * Number(am.commission_rate || 0.1)) / revenue) * 100) : null;
  const active = creators.filter(c => c.status === "Active" && !c.archived_at).length;
  return { creators, clients, active, approved: approved.length, live: campaigns.filter(c => ["Open", "In Progress", "Active"].includes(c.status)).length, turnaround, retention: creators.length ? Math.round((active / creators.length) * 100) : null, margin };
}

export default function TeamPerformance({ db, onRefresh, onNavigate }) {
  const [saving, setSaving] = useState(null);
  const ams = db.accountManagers.filter(a => a.status !== "Archived");

  const rate = async (client, score) => {
    setSaving(client.id);
    const err = await updateRows("clients", { satisfaction_score: score }, { id: client.id });
    setSaving(null);
    if (err) return toast.error("Rating not saved", { description: err });
    toast.success(`${client.name} rated ${score} of 5`);
    onRefresh();
  };

  return (
    <div className="content">
      <PageHeader title="Team performance" description="How each account manager's accounts are doing: delivery, review speed, creator retention and client satisfaction."
        actions={onNavigate && <button className="btn btn-secondary" onClick={() => onNavigate("creators-manage")}>Manage account managers</button>} />
      {ams.length === 0 ? (
        <div className="card"><EmptyState icon={UserGroupIcon} title="No account managers yet">Invite one from the Creators page to start assigning clients.</EmptyState></div>
      ) : (
        <div className="flex-col gap-16">
          {ams.map(am => {
            const s = stats(am, db);
            const rated = s.clients.filter(c => c.satisfaction_score);
            const avg = rated.length ? rated.reduce((t, c) => t + c.satisfaction_score, 0) / rated.length : null;
            const tiles = [
              ["Live campaigns", s.live], ["Active creators", `${s.active} of ${s.creators.length}`], ["Approved videos", s.approved],
              ["Review turnaround", s.turnaround == null ? "--" : `${s.turnaround.toFixed(1)} days`, s.turnaround != null && s.turnaround > 5 ? "var(--red)" : null],
              ["Creator retention", s.retention == null ? "--" : `${s.retention}%`], ["Margin", s.margin == null ? "--" : `${s.margin}%`, s.margin != null && s.margin < 20 ? "var(--red)" : null],
            ];
            return (
              <section key={am.id} className="card">
                <div className="card-head">
                  <span className="flex-center gap-12" style={{ minWidth: 0 }}>
                    <span className="avatar" style={{ width: 40, height: 40 }}>{getInitials(am.name)}</span>
                    <span style={{ minWidth: 0 }}><span className="fw-600 fs-16 truncate" style={{ display: "block" }}>{am.name}</span><span className="fs-13 text-muted truncate" style={{ display: "block" }}>{am.email} · {Math.round(Number(am.commission_rate || 0.1) * 100)}% commission</span></span>
                  </span>
                  {avg != null && <span className="fs-13 text-muted">Satisfaction <strong className="text-ink">{avg.toFixed(1)}</strong> / 5</span>}
                </div>
                <div className="mini-stats stat-strip">
                  {tiles.map(([l, v, c]) => <div key={l} className="metric-mini"><div className="metric-mini-label">{l}</div><div className="metric-mini-val" style={{ fontSize: 18, color: c || undefined }}>{v}</div></div>)}
                </div>
                {s.clients.length > 0 && (
                  <div className="mt-16">
                    <div className="fw-600 fs-13 mb-4">Client satisfaction</div>
                    <div className="list-stack">
                      {s.clients.map(cl => (
                        <div key={cl.id} className="list-item" style={{ padding: "8px 0" }}>
                          <span className="fs-13 truncate">{cl.name}</span>
                          <span className="flex-center gap-8">{!cl.satisfaction_score && <span className="fs-12 text-muted">Not rated</span>}<Rating label={`Rate ${cl.name}`} value={cl.satisfaction_score} onChange={(n) => saving !== cl.id && rate(cl, n)} /></span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
