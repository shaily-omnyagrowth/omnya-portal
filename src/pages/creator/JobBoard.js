import { useState } from "react";
import { describeWriteError, uploadDemoVideo } from "../../lib/db";
import { supabase } from "../../supabaseClient";
import ErrorMsg from "../../ui/ErrorMsg";
import { fmtDate, fmtMoney } from "../../utils";

export default function JobBoard({ user, db, onRefresh }) {
  const creator = db.creators.find(c=>c.user_id===user.id||c.email===user.email);
  const openJobs = db.campaigns.filter(c=>c.status==="Open"&&c.application_type==="Open Application");
  const [applying, setApplying] = useState(null);
  const [commitment, setCommitment] = useState(1);
  const [demoVideoUrl, setDemoVideoUrl] = useState("");
  const [demoFile, setDemoFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [applyError, setApplyError] = useState("");

  // F-10 still holds: the row in campaign_creators is the record, and
  // campaigns.assigned_creators is a trigger-maintained mirror of it.
  //
  // What changed is that an application is no longer an assignment. The row
  // goes in as status 'Applied'; the mirror only copies 'Approved' rows, so the
  // creator is not on the campaign until a manager says so. RLS pins the status
  // on the way in (campaign_creators_creator_apply), so this cannot be talked
  // into 'Approved' from the browser.
  //
  // A plain insert, not an upsert: creators have no UPDATE policy on this
  // table, and a second application should say so, not overwrite the first.
  const apply = async (campaignId) => {
    if (!creator) return;
    const count = Math.floor(Number(commitment));
    if (!Number.isFinite(count) || count < 1) { setApplyError("Tell us how many videos you can commit to (at least 1)."); return; }
    const link = demoVideoUrl.trim();
    if (link && !/^https?:\/\//i.test(link)) { setApplyError("The demo link needs to start with http:// or https://"); return; }

    setLoading(true);
    setApplyError("");

    let demoUrl = link || null;
    if (demoFile) {
      try {
        demoUrl = await uploadDemoVideo(demoFile, campaignId, creator.name);
      } catch (e) {
        setApplyError("Your demo video could not be uploaded: " + e.message);
        setLoading(false);
        return;
      }
    }

    const { error: applyErr } = await supabase
      .from("campaign_creators")
      .insert({
        campaign_id: campaignId,
        creator_id: creator.id,
        assigned_by: user.id,
        commitment: count,
        demo_video_url: demoUrl,
        status: "Applied",
      });

    if (applyErr) {
      setApplyError(applyErr.code === "23505"
        ? "You have already applied to this campaign."
        : "Could not submit your application: " + describeWriteError(applyErr));
      setLoading(false);
      return;
    }

    await onRefresh();
    setApplying(null);
    setCommitment(1);
    setDemoVideoUrl("");
    setDemoFile(null);
    setLoading(false);
  };

  if (!creator) return <div className="content"><ErrorMsg msg="Creator profile not found. Contact your account manager." /></div>;

  return (
    <div className="content">
      {applyError && <ErrorMsg msg={applyError} />}
      <div className="mb-16" style={{fontSize:13,color:"var(--ink3)"}}>{openJobs.length} open position{openJobs.length!==1?"s":""} available</div>
      {openJobs.length===0&&<div className="empty"><div className="empty-icon">💼</div><h3>No open jobs right now</h3><p>Check back soon</p></div>}
      {openJobs.map(job=>{
        const client=db.clients.find(c=>c.id===job.client_id);
        const myApp = (db.campaignCreators || []).find(cc => cc.campaign_id === job.id && cc.creator_id === creator.id);
        const isAssigned = (job.assigned_creators||[]).includes(creator.id) || (myApp && myApp.status === "Approved");
        const isPending = !isAssigned && myApp && myApp.status === "Applied";
        const isDeclined = !isAssigned && myApp && myApp.status === "Declined";

        return (
          <div key={job.id} className="premium-card mb-24 fade-in">
            <div className="flex-between mb-16">
              <div>
                <div className="flex-center gap-8 mb-8">
                  <span className="status-pill status-pill-blue">{job.format}</span>
                  {new Date(job.deadline) - new Date() <= 3 * 86400000 && (
                    <span className="status-pill status-pill-orange" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div className="dot pulse-amber" style={{ background: '#f59e0b', width: 6, height: 6 }}></div>
                      URGENT
                    </span>
                  )}
                </div>
                <div className="heading-lg" style={{marginBottom: 4}}>{job.name}</div>
                <div className="flex-center gap-8" style={{fontSize:13, color:'var(--ink3)', fontWeight: 500}}>
                  <span>{client?.name}</span>
                </div>
              </div>
              <div style={{textAlign:"right"}}>
                <div className="heading-xl" style={{color:"var(--green)"}}>{fmtMoney(job.pay_per_video)}<span style={{fontSize:14,color:"var(--ink3)",fontFamily:"'Space Grotesk', sans-serif"}}>/vid</span></div>
                <div style={{fontSize:12,color:"var(--ink3)", fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5}}>Due {fmtDate(job.deadline)}</div>
              </div>
            </div>
            <p style={{fontSize:14,color:"var(--ink2)",marginBottom:24, lineHeight: 1.6}}>{job.description}</p>
            <div className="flex-between border-top" style={{paddingTop: 16, borderTop: '1px solid var(--border)'}}>
              <div className="flex-center gap-8" style={{fontSize:13,color:"var(--ink3)", fontWeight: 600}}>
                <div className="dot dot-orange"></div> {job.videos_needed} spots left
              </div>
              {isAssigned ? (
                <span className="status-pill status-pill-green">✓ Assigned to Campaign</span>
              ) : isPending ? (
                <span className="status-pill status-pill-orange">⏳ Application Pending Review{myApp.commitment?` · ${myApp.commitment} video${myApp.commitment===1?"":"s"}`:""}</span>
              ) : isDeclined ? (
                <span className="status-pill" style={{background:"var(--bg2)",color:"var(--ink3)"}}>Not selected for this campaign</span>
              ) : (
                <button className="btn btn-primary" onClick={()=>{ setApplying(job); setCommitment(1); setDemoVideoUrl(""); setDemoFile(null); setApplyError(""); }}>
                  Apply for Campaign →
                </button>
              )}
            </div>
          </div>
        );
      })}
      {applying&&(
        <div className="modal-overlay" onClick={()=>setApplying(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-title">Apply for {applying.name}</div>
            <div className="modal-sub">{db.clients.find(c=>c.id===applying.client_id)?.name} · {fmtMoney(applying.pay_per_video)}/video</div>
            <p style={{fontSize:13,color:"var(--ink2)",marginBottom:16}}>{applying.description}</p>

            <div className="form-group">
              <label className="form-label">Video Commitment <span style={{color:"var(--red)"}}>*</span></label>
              <input
                className="form-input"
                type="number"
                min="1"
                max={Math.max(1, Number(applying.videos_needed)||1)}
                step="1"
                value={commitment}
                onChange={e=>setCommitment(e.target.value)}
              />
              <div style={{fontSize:11,color:"var(--ink3)",marginTop:4}}>
                How many videos can you commit to delivering? This campaign needs {applying.videos_needed||"several"} in total.
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Demo Video</label>
              <input
                className="form-input"
                type="file"
                accept="video/*"
                onChange={e=>{ setDemoFile(e.target.files?.[0]||null); }}
              />
              <div style={{fontSize:11,color:"var(--ink3)",margin:"6px 0"}}>…or paste a link instead:</div>
              <input
                className="form-input"
                placeholder="https://tiktok.com/@you/video/… or a Drive link"
                value={demoVideoUrl}
                disabled={!!demoFile}
                onChange={e=>setDemoVideoUrl(e.target.value)}
              />
              <div style={{fontSize:11,color:"var(--ink3)",marginTop:4}}>A sample of your work, so the team can review it before approving you.</div>
            </div>

            {applyError&&<div style={{color:"var(--red)",fontSize:13,marginBottom:12}} role="alert">{applyError}</div>}

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={()=>setApplying(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={()=>apply(applying.id)} disabled={loading}>
                {loading?"Submitting...":"Submit Application"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
