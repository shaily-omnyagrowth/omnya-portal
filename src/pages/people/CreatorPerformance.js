import { useState } from "react";
import { updateRows } from "../../lib/db";
import { fmtMoney } from "../../utils";

export default function CreatorPerformance({ db, isOwner, user, onRefresh }) {
  const am = !isOwner ? db.accountManagers.find(a=>a.user_id===user?.id||a.email===user?.email) : null;
  const [overrideModal, setOverrideModal] = useState(null); // { creator, score, tier }
  const [savingOverride, setSavingOverride] = useState(false);
  const [overrideError, setOverrideError] = useState("");
  
  const creators = db.creators.filter(c => isOwner ? true : c.am_id===am?.id);

  const getScore = (creator) => {
    const subs = db.submissions.filter(s=>s.creator_id===creator.id);
    if (subs.length===0) return { approvalRate:0, revisionRate:0, onTimeRate:0, totalRevenue:0, score:0, tier:"—", isOverridden: false, subs:0 };
    
    const approved = subs.filter(s=>s.status==="Approved").length;
    const revisions = subs.filter(s=>s.status==="Revision Requested").length;
    const onTime = subs.filter(s=>{
      if (!s.due_date) return true; // no due date = not tracked
      return new Date(s.created_at)<=new Date(s.due_date);
    }).length;
    const trackedDates = subs.filter(s=>s.due_date).length;
    
    const approvalRate = subs.length>0?Math.round((approved/subs.length)*100):0;
    const revisionRate = subs.length>0?Math.round((revisions/subs.length)*100):0;
    const onTimeRate = trackedDates>0?Math.round((onTime/trackedDates)*100):null;
    
    // Revenue = approved videos × pay_per_video from their campaigns
    const totalRevenue = subs.reduce((total,s)=>{
      if (s.status!=="Approved") return total;
      const camp = db.campaigns.find(c=>c.id===s.campaign_id);
      return total + Number(camp?.pay_per_video||0);
    }, 0);

    // Score: 40% approval rate + 30% low revisions + 30% on time
    const approvalScore = approvalRate * 0.4;
    const revisionScore = (100-revisionRate) * 0.3;
    const onTimeScore = onTimeRate!==null ? onTimeRate*0.3 : 25; // default 25 if no data
    const computedScore = Math.round(approvalScore + revisionScore + onTimeScore);
    const computedTier = computedScore>=80?"A":computedScore>=60?"B":computedScore>=40?"C":"D";

    const isOverridden = creator.score_override != null || creator.tier_override != null;
    const score = creator.score_override != null ? Number(creator.score_override) : computedScore;
    const tier = creator.tier_override != null ? creator.tier_override : (creator.score_override != null ? (score>=80?"A":score>=60?"B":score>=40?"C":"D") : computedTier);

    return { approvalRate, revisionRate, onTimeRate, totalRevenue, score, tier, isOverridden, subs:subs.length };
  };

  const tierColor = (t) => t==="A"?"var(--green)":t==="B"?"var(--blue)":t==="C"?"var(--gold)":"var(--red)";
  const tierBg = (t) => t==="A"?"rgba(26,122,74,0.1)":t==="B"?"rgba(37,99,235,0.1)":t==="C"?"rgba(255,165,0,0.1)":"rgba(220,53,69,0.1)";

  const scored = creators.map(c=>({creator:c, ...getScore(c)})).sort((a,b)=>b.score-a.score);

  // Goes through the database and back (onRefresh) rather than patching
  // db.creators in place: mutating a prop made the table look right until the
  // next load whether or not anything had been saved.
  const writeOverride = async (creatorId, updates) => {
    setSavingOverride(true);
    setOverrideError("");
    const err = await updateRows("creators", updates, { id: creatorId });
    if (err) { setOverrideError(err); setSavingOverride(false); return; }
    if (onRefresh) await onRefresh();
    setSavingOverride(false);
    setOverrideModal(null);
  };

  const saveOverride = () => {
    if (!overrideModal) return;
    const raw = overrideModal.score;
    const score = raw === "" || raw == null ? null : Math.round(Number(raw));
    if (score != null && (!Number.isFinite(score) || score < 0 || score > 100)) {
      setOverrideError("The score has to be between 0 and 100.");
      return;
    }
    return writeOverride(overrideModal.creator.id, { score_override: score, tier_override: overrideModal.tier || null });
  };

  const resetOverride = (creatorId) => writeOverride(creatorId, { score_override: null, tier_override: null });

  return (
    <div className="content">
      <div style={{marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{fontSize:13,color:"var(--ink3)"}}>Creator performance scores based on approval rate, revisions, and on-time delivery</div>
      </div>

      {/* Tier Legend */}
      <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
        {[["A","80-100 · Top performer"],["B","60-79 · Solid"],["C","40-59 · Needs improvement"],["D","<40 · At risk"]].map(([tier,desc])=>(
          <div key={tier} style={{background:tierBg(tier),border:`1px solid ${tierColor(tier)}`,borderRadius:20,padding:"4px 12px",fontSize:12}}>
            <span style={{fontWeight:700,color:tierColor(tier)}}>Tier {tier}</span> <span style={{color:"var(--ink3)"}}>{desc}</span>
          </div>
        ))}
      </div>

      <div className="premium-card">
        <div className="table-wrap">
          <table className="premium-table">
            <thead>
              <tr>
                <th>Creator</th>
                <th>Tier</th>
                <th>Score</th>
                <th>Submissions</th>
                <th>Approval Rate</th>
                <th>Revision Rate</th>
                <th>On-Time Rate</th>
                <th>Revenue Generated</th>
                <th style={{textAlign:"right"}}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {scored.map(({creator,tier,score,isOverridden,approvalRate,revisionRate,onTimeRate,totalRevenue,subs})=>(
                <tr key={creator.id}>
                  <td>
                    <div className="fw-600">{creator.name}</div>
                    <div style={{fontSize:11,color:"var(--ink3)"}}>{creator.platform||"—"} · {creator.niche||"—"}</div>
                  </td>
                  <td>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <span style={{background:tierBg(tier),color:tierColor(tier),fontWeight:700,borderRadius:20,padding:"3px 10px",fontSize:13}}>
                        {tier==="—"?"—":`Tier ${tier}`}
                      </span>
                      {isOverridden && (
                        <span className="badge badge-orange" style={{fontSize:10,padding:"2px 6px"}} title="Manual manager override">
                          ⚡ Override
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div style={{fontWeight:700,color:score>=80?"var(--green)":score>=60?"var(--blue)":score>=40?"var(--gold)":"var(--red)"}}>
                      {subs===0&&!isOverridden?"—":`${score}/100`}
                    </div>
                  </td>
                  <td style={{fontSize:13}}>{subs}</td>
                  <td>
                    <div style={{fontSize:13,fontWeight:600,color:approvalRate>=70?"var(--green)":approvalRate>=40?"var(--gold)":"var(--red)"}}>{subs===0?"—":`${approvalRate}%`}</div>
                  </td>
                  <td>
                    <div style={{fontSize:13,color:revisionRate<=20?"var(--green)":revisionRate<=40?"var(--gold)":"var(--red)"}}>{subs===0?"—":`${revisionRate}%`}</div>
                  </td>
                  <td style={{fontSize:13,color:"var(--ink3)"}}>{onTimeRate===null?"No data":`${onTimeRate}%`}</td>
                  <td className="text-green fw-600">{fmtMoney(totalRevenue)}</td>
                  <td style={{textAlign:"right"}}>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => { setOverrideError(""); setOverrideModal({
                        creator,
                        score: creator.score_override != null ? creator.score_override : score,
                        tier: creator.tier_override || (tier === "\u2014" ? "C" : tier),
                        isOverridden
                      }); }}
                      title="Adjust score or tier override"
                    >
                      ✏️ Override
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {scored.length===0&&<div className="empty" style={{padding:32}}><div className="empty-icon">⭐</div><h3>No creators yet</h3></div>}
      </div>

      {/* Override Modal */}
      {overrideModal && (
        <div className="modal-overlay" onClick={() => setOverrideModal(null)}>
          <div className="modal" style={{maxWidth:460}} onClick={e => e.stopPropagation()}>
            <div className="modal-title">Creator Tier & Score Override</div>
            <div className="modal-sub">
              Manually calibrate performance scoring for <strong>{overrideModal.creator.name}</strong>
            </div>

            <div className="form-group">
              <label className="form-label">Tier Override</label>
              <select
                className="select"
                value={overrideModal.tier}
                onChange={e => setOverrideModal({ ...overrideModal, tier: e.target.value })}
              >
                <option value="A">Tier A (80-100 · Top Performer)</option>
                <option value="B">Tier B (60-79 · Solid)</option>
                <option value="C">Tier C (40-59 · Needs Improvement)</option>
                <option value="D">Tier D (&lt;40 · At Risk)</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Score Override (0 - 100)</label>
              <input
                type="number"
                min="0"
                max="100"
                className="form-input"
                value={overrideModal.score}
                onChange={e => setOverrideModal({ ...overrideModal, score: e.target.value })}
              />
            </div>

            {overrideError&&<div style={{color:"var(--red)",fontSize:13,marginBottom:12}} role="alert">{overrideError}</div>}
            <div className="modal-actions" style={{justifyContent:"space-between"}}>
              {overrideModal.isOverridden ? (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{color:"var(--red)"}}
                  onClick={() => resetOverride(overrideModal.creator.id)}
                  disabled={savingOverride}
                >
                  ↩ Reset to Auto
                </button>
              ) : <div/>}

              <div style={{display:"flex",gap:8}}>
                <button className="btn btn-ghost btn-sm" onClick={() => setOverrideModal(null)}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={saveOverride}
                  disabled={savingOverride}
                >
                  {savingOverride ? "Saving..." : "Save Override"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
