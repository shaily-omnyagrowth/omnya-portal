import { useState } from "react";
import { Award01Icon } from "@hugeicons/core-free-icons";
import { gooeyToast as toast } from "goey-toast";
import { updateRows } from "../../lib/db";
import Alert from "../../ui/Alert";
import Dialog from "../../ui/Dialog";
import EmptyState from "../../ui/EmptyState";
import PageHeader from "../../ui/PageHeader";
import { fmtMoney, getInitials } from "../../utils";
import Select from "../../ui/Select";

const LIVE = new Set(["Approved", "Published/Tracked"]);
const TIERS = { A: ["80 to 100", "Top performer", "green"], B: ["60 to 79", "Solid", "blue"], C: ["40 to 59", "Needs support", "orange"], D: ["under 40", "At risk", "red"] };
const tierOf = (s) => (s >= 80 ? "A" : s >= 60 ? "B" : s >= 40 ? "C" : "D");

// Score: 40% approval rate, 30% low revisions, 30% on time (25 points when no due dates are tracked).
function score(creator, db) {
  const subs = db.submissions.filter(s => s.creator_id === creator.id);
  const isOverridden = creator.score_override != null || creator.tier_override != null;
  if (!subs.length && !isOverridden) return { subs: 0, score: null, tier: null };
  const approved = subs.filter(s => LIVE.has(s.status)).length;
  const revisions = subs.filter(s => s.status === "Revision Requested").length;
  const tracked = subs.filter(s => s.due_date);
  const onTime = tracked.filter(s => new Date(s.created_at) <= new Date(s.due_date)).length;
  const approvalRate = subs.length ? Math.round((approved / subs.length) * 100) : 0;
  const revisionRate = subs.length ? Math.round((revisions / subs.length) * 100) : 0;
  const onTimeRate = tracked.length ? Math.round((onTime / tracked.length) * 100) : null;
  const computed = Math.round(approvalRate * 0.4 + (100 - revisionRate) * 0.3 + (onTimeRate != null ? onTimeRate * 0.3 : 25));
  const final = creator.score_override != null ? Number(creator.score_override) : computed;
  const paid = subs.filter(s => LIVE.has(s.status)).reduce((t, s) => t + Number(db.campaigns.find(c => c.id === s.campaign_id)?.pay_per_video || 0), 0);
  return { subs: subs.length, approvalRate, revisionRate, onTimeRate, score: final, computed, tier: creator.tier_override || tierOf(final), isOverridden, paid };
}

export default function CreatorPerformance({ db, isOwner, user, onRefresh }) {
  const am = !isOwner ? db.accountManagers.find(a => a.user_id === user?.id || a.email === user?.email) : null;
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const rows = db.creators.filter(c => !c.archived_at && (isOwner || c.am_id === am?.id)).map(c => ({ c, ...score(c, db) }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  const write = async (updates, msg) => {
    setBusy(true); setErr("");
    const e = await updateRows("creators", updates, { id: edit.c.id });
    setBusy(false);
    if (e) return setErr(e);
    toast.success(msg); setEdit(null); onRefresh?.();
  };
  const save = () => {
    const s = edit.score === "" || edit.score == null ? null : Math.round(Number(edit.score));
    if (s != null && (!Number.isFinite(s) || s < 0 || s > 100)) return setErr("Use a score between 0 and 100.");
    write({ score_override: s, tier_override: edit.tier || null }, `${edit.c.name}'s score updated`);
  };

  return (
    <div className="content">
      <PageHeader title="Creator performance" description="Scores combine approval rate (40%), few revisions (30%) and on time delivery (30%). Adjust a score when you know something the numbers don't." />
      <p className="fs-13 text-muted mb-16">
        {Object.entries(TIERS).map(([t, [range, label]], i) => <span key={t}>{i > 0 && " · "}<strong className="text-ink">Tier {t}</strong> {range}, {label.toLowerCase()}</span>)}
      </p>
      {rows.length === 0 ? <div className="card"><EmptyState icon={Award01Icon} title="No creators to score yet">Creators get a score after their first submission.</EmptyState></div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Creator</th><th>Tier</th><th className="num">Score</th><th className="num">Submissions</th><th className="num">Approved</th><th className="num">Revisions</th><th className="num">On time</th><th className="num">Earned</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.c.id}>
                  <td><span className="flex-center gap-12"><span className="avatar">{getInitials(r.c.name)}</span><span className="fw-600 truncate" style={{ color: "var(--ink)", maxWidth: 220 }}>{r.c.name}</span></span></td>
                  <td>{r.tier ? <span className={`badge badge-${TIERS[r.tier]?.[2] || "gray"}`}>Tier {r.tier}{r.isOverridden ? " · adjusted" : ""}</span> : <span className="text-muted">No data</span>}</td>
                  <td className="num fw-600" style={{ color: "var(--ink)" }}>{r.score ?? "--"}</td>
                  <td className="num">{r.subs}</td>
                  <td className="num">{r.subs ? `${r.approvalRate}%` : "--"}</td>
                  <td className="num">{r.subs ? `${r.revisionRate}%` : "--"}</td>
                  <td className="num">{r.onTimeRate == null ? "--" : `${r.onTimeRate}%`}</td>
                  <td className="num">{r.subs ? fmtMoney(r.paid) : "--"}</td>
                  <td className="num"><button className="btn btn-ghost btn-sm" onClick={() => { setErr(""); setEdit({ c: r.c, score: r.c.score_override ?? r.score ?? "", tier: r.c.tier_override || r.tier || "C", isOverridden: r.isOverridden, computed: r.computed }); }}>Adjust</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit && (
        <Dialog size="sm" title={`Adjust ${edit.c.name}'s score`} description={edit.computed != null ? `The automatic score is ${edit.computed}.` : "There's no automatic score yet."} onClose={() => setEdit(null)}
          actions={<>
            {edit.isOverridden && <button className="btn btn-ghost" style={{ marginRight: "auto" }} disabled={busy} onClick={() => write({ score_override: null, tier_override: null }, "Back to the automatic score")}>Use the automatic score</button>}
            <button className="btn btn-secondary" onClick={() => setEdit(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
          </>}>
          <div className="form-row">
            <div className="form-group"><label className="form-label" htmlFor="ov-score">Score</label><input id="ov-score" className="form-input" type="number" inputMode="numeric" min="0" max="100" value={edit.score} onChange={e => setEdit({ ...edit, score: e.target.value })} /></div>
            <div className="form-group"><label className="form-label" htmlFor="ov-tier">Tier</label><Select id="ov-tier" className="select" value={edit.tier} onChange={e => setEdit({ ...edit, tier: e.target.value })}>{Object.entries(TIERS).map(([t, [, label]]) => <option key={t} value={t}>Tier {t}, {label.toLowerCase()}</option>)}</Select></div>
          </div>
          {err && <Alert tone="error">{err}</Alert>}
        </Dialog>
      )}
    </div>
  );
}
