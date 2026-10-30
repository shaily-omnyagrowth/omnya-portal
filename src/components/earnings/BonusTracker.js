import { useEffect, useState } from "react";
import { Award01Icon } from "@hugeicons/core-free-icons";
import { gooeyToast as toast } from "goey-toast";
import EmptyState from "../../ui/EmptyState";
import { fmtCompactNum, fmtDate, fmtMoney, platformMeta } from "../../utils";
import { authed, BONUS_ELIGIBILITY_DAYS, BONUS_TIERS, bonusFor, daysSince, daysUntilEligible, errMessage, nextTier, tierLabel } from "./rules";

const editOf = (s) => ({ postedUrl: s.posted_url || "", postedAt: s.posted_at ? s.posted_at.slice(0, 10) : "", viewCount: s.view_count_submitted != null ? String(s.view_count_submitted) : "" });

function statusFor(sub, edit, earnings) {
  const views = parseInt(edit.viewCount || sub.view_count_submitted, 10) || 0;
  const postedAt = edit.postedAt || sub.posted_at;
  const e = earnings.find(r => r.submission_id === sub.id && ["performance_bonus", "bonus", "other"].includes(r.earning_type));
  if (e?.status === "paid") return [`Paid ${fmtMoney(e.amount, { cents: true })}`, "green"];
  if (e?.status === "approved") return [`Approved ${fmtMoney(e.amount, { cents: true })}`, "green"];
  if (e?.status === "needs_review") return ["With the payout team", "orange"];
  if (e?.status === "forfeited") return ["Forfeited", "red"];
  if (!postedAt) return ["Add the date you posted", "gray"];
  if (daysSince(postedAt) < BONUS_ELIGIBILITY_DAYS) return [`Eligible in ${daysUntilEligible(postedAt)}d`, "gray"];
  if (!views) return ["Add your view count", "orange"];
  const b = bonusFor(views);
  return b ? [`Eligible for ${fmtMoney(b)}`, "green"] : ["Below the first tier", "gray"];
}

function BonusRow({ sub, earnings, onSaved }) {
  const [edit, setEdit] = useState(() => editOf(sub));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setEdit(editOf(sub)); }, [sub]);
  const set = (patch) => setEdit(e => ({ ...e, ...patch }));
  const views = parseInt(edit.viewCount, 10) || 0;
  const [label, tone] = statusFor(sub, edit, earnings);
  const next = nextTier(views);
  const pct = next ? Math.min(100, Math.round((views / next.minViews) * 100)) : 100;
  const p = platformMeta(sub.platform);

  const save = async () => {
    setBusy(true);
    const body = { submissionId: sub.id };
    if (edit.postedUrl.trim()) body.postedUrl = edit.postedUrl.trim();
    if (edit.postedAt.trim()) body.postedAt = edit.postedAt.trim();
    if (edit.viewCount.trim()) body.viewCountSubmitted = edit.viewCount.trim();
    try {
      const { res, json } = await authed("/api/creator/view-count", { body });
      if (!res.ok) throw new Error(errMessage(json, "Couldn't save."));
      onSaved(sub.id, json.submission || {});
      toast.success("Saved", { description: tierLabel(views) ? `That's in the ${tierLabel(views)} tier.` : "We'll check it at the 10 day mark." });
    } catch (e) {
      toast.error("Not saved", { description: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bonus-row">
      <div className="flex-between" style={{ alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div className="fw-600 fs-14 truncate">{sub.campaigns?.name || "Campaign"}</div>
          <div className="fs-12 text-muted">{p.name} · approved {fmtDate(sub.approved_date || sub.created_at)}{daysSince(edit.postedAt || sub.posted_at) != null && ` · posted ${daysSince(edit.postedAt || sub.posted_at)}d ago`}</div>
        </div>
        <span className={`badge badge-${tone}`}>{label}</span>
      </div>
      <div className="form-row mt-12">
        <div className="form-group"><label className="form-label fs-12" htmlFor={`u-${sub.id}`}>Posted link</label><input id={`u-${sub.id}`} className="form-input" inputMode="url" value={edit.postedUrl} onChange={e => set({ postedUrl: e.target.value })} placeholder="https://" /></div>
        <div className="form-group"><label className="form-label fs-12" htmlFor={`d-${sub.id}`}>Posted on</label><input id={`d-${sub.id}`} className="form-input" type="date" max={new Date().toISOString().slice(0, 10)} value={edit.postedAt} onChange={e => set({ postedAt: e.target.value })} /></div>
        <div className="form-group"><label className="form-label fs-12" htmlFor={`v-${sub.id}`}>Views</label><input id={`v-${sub.id}`} className="form-input" type="number" inputMode="numeric" min={0} value={edit.viewCount} onChange={e => set({ viewCount: e.target.value })} /></div>
      </div>
      <div className="flex-between flex-wrap gap-12">
        <div className="flex-1" style={{ minWidth: 200 }}>
          <div className="flex-between fs-12 text-muted mb-4">
            <span>{views ? `${fmtCompactNum(views)} views` : "No views entered"}</span>
            <span>{next ? `${fmtCompactNum(next.minViews)} for ${fmtMoney(next.bonus)}` : "Top tier reached"}</span>
          </div>
          <div className="progress-bar"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}

export default function BonusTracker({ subs, earnings, onSaved }) {
  return (
    <div className="dash-grid" style={{ gridTemplateColumns: "minmax(0, 1fr) 260px" }}>
      <div className="card flush">
        {subs.length === 0
          ? <EmptyState icon={Award01Icon} title="No approved videos yet">Approved videos show up here so you can track them toward a bonus.</EmptyState>
          : subs.map(s => <BonusRow key={s.id} sub={s} earnings={earnings} onSaved={onSaved} />)}
      </div>
      <aside className="card">
        <h2 className="card-title">Bonus tiers</h2>
        <p className="fs-13 text-muted mb-12">Paid on views {BONUS_ELIGIBILITY_DAYS} days after posting. The highest tier reached counts.</p>
        <div className="list-stack">
          {[...BONUS_TIERS].reverse().map(t => (
            <div key={t.minViews} className="flex-between fs-13" style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
              <span className="text-muted">{t.label}</span><span className="fw-600 tnum">{fmtMoney(t.bonus)}</span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
