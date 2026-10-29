import { useEffect, useRef, useState } from "react";
import { sendEmail } from "../../lib/api";
import { supabase } from "../../supabaseClient";
import ErrorMsg from "../../ui/ErrorMsg";

// isOverride: §5.2 grants the owner "Submit content: Override/support" — filing
// a submission on a creator's behalf when something has to be recorded
// out-of-band. The owner is not a creator, so in override mode the creator is
// picked from a dropdown instead of resolved from the session.
const linkPlatform = (url) =>
  /tiktok\.com/i.test(url) ? "TikTok"
  : /instagram\.com/i.test(url) ? "Instagram"
  : /youtube\.com|youtu\.be/i.test(url) ? "YouTube"
  : /facebook\.com|fb\.watch/i.test(url) ? "Facebook"
  : null;

export default function SubmitContent({ user, db, onRefresh, setPage, isOverride = false }) {
  const ownCreator = db.creators.find(c=>c.user_id===user.id||c.email===user.email);

  // Every hook runs before any early return. The previous version returned
  // "Profile not found" partway down and declared six more useState calls
  // below it, so the hook order changed the moment a creator record appeared —
  // which React treats as a fatal error, not a warning.
  const [overrideCreatorId, setOverrideCreatorId] = useState("");
  const [form, setForm] = useState({
    campaign_id: "",
    type: "Concept",
    concept_link: "",
    posted_link: "",
    platform: "TikTok",
    comment: "",
  });
  const [file, setFile] = useState(null);
  const [uploadMode, setUploadMode] = useState("file"); // "file" or "link"
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [success, setSuccess] = useState(false);
  const [err, setErr] = useState("");
  const successRef = useRef(false);

  // Link verification state (spec 0003)
  const [verifying, setVerifying] = useState(false);
  const [verifyErr, setVerifyErr] = useState("");
  const [verifiedVideo, setVerifiedVideo] = useState(null);
  const [connectedPlatforms, setConnectedPlatforms] = useState(new Set());

  const creator = isOverride
    ? db.creators.find(c=>c.id===overrideCreatorId)
    : ownCreator;

  // Final videos can only be submitted for platforms whose stats we can pull
  useEffect(() => {
    setConnectedPlatforms(new Set());
    if (!creator?.user_id) return;
    supabase
      .from("creator_social_accounts_safe")
      .select("platform, connection_status, metadata")
      .eq("user_id", creator.user_id)
      .then(({ data }) => {
        const set = new Set();
        for (const a of data || []) {
          if (a.connection_status !== "connected") continue;
          set.add(a.platform);
        }
        setConnectedPlatforms(set);
      });
  }, [creator?.user_id]);
  const isConnected = (platform) => connectedPlatforms.has((platform || "").toLowerCase());

  const myJobs = db.campaigns.filter(
    c=>(c.assigned_creators||[]).includes(creator?.id)&&c.status!=="Completed"&&c.status!=="Archived"
  );

  const handlePlatformChange = (newPlatform) => {
    setForm(f => ({ ...f, platform: newPlatform }));
    setVerifiedVideo(null);
    setVerifyErr("");
  };

  const verifyLink = async (targetUrl, targetPlatform) => {
    const url = (targetUrl || form.concept_link || "").trim();
    const platform = (targetPlatform || form.platform || "TikTok").trim();

    if (!url) {
      setVerifyErr("Please enter a video link first.");
      return null;
    }
    const detected = linkPlatform(url);
    if (detected && detected !== platform) {
      setVerifyErr(`This link is from ${detected}. Set Platform to ${detected}.`);
      return null;
    }
    if (!isConnected(platform)) {
      setVerifyErr(`Connect ${platform} on the Social Channels page to verify ${platform} videos.`);
      return null;
    }

    setVerifying(true);
    setVerifyErr("");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        setVerifyErr("Authentication required. Please refresh the page.");
        setVerifying(false);
        return null;
      }

      const res = await fetch("/api/social/verify-video-link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ url, creatorId: creator?.id }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error?.message || data?.message || "Failed to verify video link.";
        setVerifyErr(msg);
        setVerifiedVideo(null);
        setVerifying(false);
        return null;
      }

      const video = data?.data?.video || null;
      setVerifiedVideo(video);
      setVerifyErr("");
      setVerifying(false);
      return video;
    } catch (e) {
      setVerifyErr(e.message || "Network error while verifying video link.");
      setVerifiedVideo(null);
      setVerifying(false);
      return null;
    }
  };

  // Keep the selected campaign valid as the creator changes underneath it.
  useEffect(() => {
    if (!myJobs.some(j => j.id === form.campaign_id)) {
      setForm(f => ({ ...f, campaign_id: myJobs[0]?.id || "" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creator?.id, myJobs.length]);

  if(isOverride && !creator) {
    return (
      <div className="content">
        <div className="premium-card" style={{maxWidth:520}}>
          <div className="card-title">Submit on a creator's behalf</div>
          <div style={{fontSize:12,color:"var(--ink3)",marginBottom:16,lineHeight:1.5}}>
            Use this when a submission has to be recorded out-of-band — the
            creator sent it by email, or their account was not yet set up. It is
            filed against their record exactly as if they had submitted it, and
            the action appears on the audit trail.
          </div>
          <div className="form-group">
            <label className="form-label">Creator</label>
            <select className="select" value={overrideCreatorId} onChange={e=>setOverrideCreatorId(e.target.value)}>
              <option value="">Select creator…</option>
              {db.creators.filter(c=>c.status!=="Offboarded").map(c=>(
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
    );
  }

  if(!creator) return <div className="content"><div className="empty"><div className="empty-icon">👤</div><h3>Profile not found</h3><p>Your creator profile hasn't been set up yet. Contact your account manager.</p></div></div>;
  if(myJobs.length===0) return (
    <div className="content">
      <div className="empty">
        <div className="empty-icon">📋</div>
        <h3>No active campaigns</h3>
        <p>{isOverride
          ? `${creator.name} is not assigned to any active campaign. Assign them first, then submit.`
          : "You haven't been assigned to any campaigns yet. Check Available Jobs or contact your account manager."}</p>
        {isOverride
          ? <button className="btn btn-ghost" style={{marginTop:16}} onClick={()=>setOverrideCreatorId("")}>← Pick another creator</button>
          : <button className="btn btn-primary" style={{marginTop:16}} onClick={()=>setPage("jobs")}>Browse Jobs</button>}
      </div>
    </div>
  );

  const uploadToSupabase = async (fileObj, campaignId) => {
    const campaign = db.campaigns.find(c=>c.id===campaignId);
    const fileName = `${creator?.name}_${campaign?.name}_${new Date().toISOString().split("T")[0]}_${fileObj.name}`
      .replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = `submissions/${campaignId}/${Date.now()}_${fileName}`;

    setUploadProgress(20);

    const { error } = await supabase.storage
      .from("submissions")
      .upload(filePath, fileObj, {
        cacheControl: "3600",
        upsert: false,
        onUploadProgress: (progress) => {
          const pct = Math.round((progress.loaded / progress.total) * 70) + 20;
          setUploadProgress(pct);
        }
      });

    if (error) throw new Error(error.message);

    setUploadProgress(95);

    const { data: urlData } = supabase.storage
      .from("submissions")
      .getPublicUrl(filePath);

    return urlData.publicUrl;
  };

  const submit = async () => {
    if (!form.campaign_id) { setErr("Please select a campaign"); return; }
    if (uploadMode==="file" && !file) { setErr("Please select a video file to upload"); return; }
    if (uploadMode==="link" && !form.concept_link) { setErr("Please enter a video link"); return; }
    if (form.type === "Final" && !isConnected(form.platform)) {
      setErr(`Connect ${form.platform} on the Social Channels page to submit ${form.platform} videos`);
      return;
    }
    
    setSubmitting(true); setErr(""); setUploadProgress(0);

    let fileLink = form.concept_link;

    if (uploadMode==="file" && file) {
      try {
        setUploadProgress(10);
        fileLink = await uploadToSupabase(file, form.campaign_id);
        setUploadProgress(90);
      } catch(e) {
        setErr("Upload failed: " + e.message);
        setSubmitting(false); setUploadProgress(0); return;
      }
    }

    // For final link submissions, verify ownership if not already verified
    let verified = verifiedVideo;
    if (form.type === "Final" && uploadMode === "link") {
      if (!verified) {
        verified = await verifyLink(form.concept_link, form.platform);
        if (!verified) {
          setSubmitting(false);
          return;
        }
      }
    }

    const postedUrl = (form.type === "Final" && uploadMode === "link")
      ? (verified?.url || fileLink)
      : (form.posted_link || null);

    const newSub = {
      creator_id: creator.id, campaign_id: form.campaign_id,
      submission_type: form.type, concept_link: fileLink,
      status: "Submitted",
      posted_link: postedUrl,
      posted_url: postedUrl,
      platform: form.platform,
      payment_status: "Unpaid",
      // An override submission says so in its own notes, so nobody reading the
      // review queue later has to wonder why the creator has no record of
      // sending it.
      notes: isOverride
        ? `[Filed by ${user.email} on the creator's behalf] ${form.comment||""}`.trim()
        : (form.comment||null),
    };

    const { data: insertedSub, error } = await supabase.from("submissions").insert(newSub).select().single();
    if (error) { setErr(error.message); setSubmitting(false); setUploadProgress(0); return; }

    // Once inserted, stamp verified view metrics server side with service role
    if (form.type === "Final" && uploadMode === "link" && insertedSub?.id) {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (token) {
          await fetch("/api/social/verify-video-link", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
              submissionId: insertedSub.id,
              url: postedUrl,
              platform: form.platform
            })
          });
        }
      } catch (_) {}
    } else if (postedUrl && insertedSub?.id) {
      (async () => {
        try {
          const { data: sessionData } = await supabase.auth.getSession();
          const token = sessionData?.session?.access_token;
          if (token) {
            await fetch("/api/analytics/manual-sync", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`
              },
              body: JSON.stringify({ submissionId: insertedSub.id })
            });
          }
        } catch (_) {}
      })();
    }

    // Email: notify AM about new submission
    try {
      const campaign = db.campaigns.find(c => c.id === form.campaign_id);
      const client = campaign ? db.clients.find(c => c.id === campaign.client_id) : null;
      const am = client ? db.accountManagers.find(a => a.id === client.am_id) : null;
      if (am?.email) {
        sendEmail("new_submission", {
          amEmail: am.email,
          creatorName: creator.name,
          campaignName: campaign?.name || "Unknown campaign",
          submissionType: form.type,
          platform: form.platform,
          notes: form.comment,
        });
      }
    } catch(_) {}

    setFile(null);
    setUploadProgress(0);
    setSubmitting(false);
    setForm({campaign_id:myJobs[0]?.id||"",type:"Concept",concept_link:"",posted_link:"",platform:"TikTok",comment:""});
    setVerifiedVideo(null);
    setVerifyErr("");
    if (onRefresh) onRefresh();
    if (isOverride) setSuccess(true);
    else setPage("submissions");
  };

  if (!creator) return <div className="content"><ErrorMsg msg="Creator profile not found." /></div>;

  if (success || successRef.current) return (
    <div className="content" style={{maxWidth:600}}>
      <div style={{textAlign:"center",padding:"48px 24px"}}>
        <div style={{fontSize:64,marginBottom:16}}>✅</div>
        <div style={{fontFamily:"Bebas Neue, sans-serif",fontSize:32,marginBottom:8}}>Content Uploaded!</div>
        <div style={{fontSize:15,color:"var(--ink2)",marginBottom:24,lineHeight:1.6}}>
          Your video has been uploaded and is now <strong>pending review</strong>.<br/>
          Your AM will review it and let you know if it's approved or needs changes.
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:12,maxWidth:320,margin:"0 auto 32px"}}>
          <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",background:"var(--bg2)",borderRadius:"var(--radius-sm)",textAlign:"left"}}>
            <div style={{fontSize:20}}>📋</div>
            <div>
              <div style={{fontSize:13,fontWeight:600}}>Status: Pending Review</div>
              <div style={{fontSize:12,color:"var(--ink3)"}}>Your AM has been notified</div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",background:"var(--bg2)",borderRadius:"var(--radius-sm)",textAlign:"left"}}>
            <div style={{fontSize:20}}>⏱️</div>
            <div>
              <div style={{fontSize:13,fontWeight:600}}>Review Time: 1-3 days</div>
              <div style={{fontSize:12,color:"var(--ink3)"}}>You'll see feedback in My Submissions</div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",background:"var(--bg2)",borderRadius:"var(--radius-sm)",textAlign:"left"}}>
            <div style={{fontSize:20}}>💬</div>
            <div>
              <div style={{fontSize:13,fontWeight:600}}>Check My Submissions</div>
              <div style={{fontSize:12,color:"var(--ink3)"}}>Track approval status and feedback there</div>
            </div>
          </div>
        </div>
        <div style={{display:"flex",gap:10,justifyContent:"center"}}>
          <button className="btn btn-ghost" onClick={()=>{successRef.current=false;setPage("submissions");}}>View My Submissions</button>
          <button className="btn btn-primary" onClick={()=>{setSuccess(false);successRef.current=false;}}>Submit Another</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="content" style={{maxWidth:640, margin: "0 auto"}}>
      <div className="premium-card">
        <div style={{
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          marginBottom: '24px',
          paddingBottom: '16px',
          borderBottom: '1px solid var(--border2)'
        }}>
          <div>
            <h2 style={{fontFamily: "'Bebas Neue', sans-serif", fontSize: '28px', color: 'var(--ink)', letterSpacing: '1px', marginBottom: '4px'}}>New Content Submission</h2>
            <div style={{fontSize: '13px', color: 'var(--ink3)'}}>Submit your video content for review and delivery.</div>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Campaign</label>
          <select className="select" value={form.campaign_id} onChange={e=>setForm({...form,campaign_id:e.target.value})}>
            {myJobs.length===0&&<option value="">No active jobs — apply to a job first</option>}
            {myJobs.map(j=><option key={j.id} value={j.id}>{j.name}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Submission Type</label>
          <div style={{display:"flex",gap:8}}>
            {["Concept","Final"].map(t=>(
              <button key={t} className={`btn ${form.type===t?"btn-primary":"btn-ghost"}`} onClick={()=>setForm({...form,type:t})}>
                {t==="Concept"?"📽️":"🎬"} {t} Video
              </button>
            ))}
          </div>
          <div className="form-hint">{form.type==="Concept"?"Submit your concept video for approval before posting":"Submit your final posted video link"}</div>
        </div>

        <div className="form-group">
          <label className="form-label">Upload Method</label>
          <div style={{display:"flex",gap:8,marginBottom:12}}>
            <button className={`btn btn-sm ${uploadMode==="file"?"btn-primary":"btn-ghost"}`} onClick={()=>setUploadMode("file")}>📁 Upload File</button>
            <button className={`btn btn-sm ${uploadMode==="link"?"btn-primary":"btn-ghost"}`} onClick={()=>setUploadMode("link")}>🔗 Paste Link</button>
          </div>

          {uploadMode==="file" ? (
            <div>
              <input type="file" accept="video/*" style={{display:"none"}} id="videoUpload" onChange={e=>setFile(e.target.files[0])}/>
              <label htmlFor="videoUpload" style={{display:"block",border:"2px dashed var(--border2)",borderRadius:"var(--radius-sm)",padding:"24px",textAlign:"center",cursor:"pointer",background:"var(--bg2)"}}>
                {file ? (
                  <div>
                    <div style={{fontSize:13,fontWeight:600,marginBottom:4}}>📹 {file.name}</div>
                    <div style={{fontSize:11,color:"var(--ink3)"}}>{(file.size/1024/1024).toFixed(1)}MB · Click to change</div>
                  </div>
                ) : (
                  <div>
                    <div style={{fontSize:24,marginBottom:8}}>📹</div>
                    <div style={{fontSize:13,fontWeight:600}}>Click to upload video</div>
                    <div style={{fontSize:11,color:"var(--ink3)",marginTop:4}}>MP4, MOV, AVI supported</div>
                  </div>
                )}
              </label>
              {submitting&&uploadProgress>0&&(
                <div style={{marginTop:8}}>
                  <div style={{fontSize:12,color:"var(--ink3)",marginBottom:4}}>Uploading... {uploadProgress}%</div>
                  <div className="progress-bar"><div className="progress-fill" style={{width:`${uploadProgress}%`,transition:"width 0.3s"}}/></div>
                </div>
              )}
            </div>
          ) : (
            <div>
              <input
                className="form-input"
                placeholder={form.type==="Concept" ? "https://loom.com/share/..." : "e.g. https://vt.tiktok.com/... or https://www.instagram.com/reel/..."}
                value={form.concept_link}
                onChange={e => {
                  const detected = form.type==="Final" ? linkPlatform(e.target.value) : null;
                  setForm({ ...form, concept_link: e.target.value, ...(detected ? { platform: detected } : {}) });
                  setVerifiedVideo(null);
                  setVerifyErr("");
                }}
              />
              <div className="form-hint" style={{ marginTop: 4 }}>
                {form.type==="Concept"
                  ? "Paste a Loom, Google Drive, or Frame.io review link."
                  : "Desktop URLs and mobile share links (vt.tiktok.com, youtu.be, etc.) are unrolled automatically."}
              </div>
            </div>
          )}
        </div>

        {form.type==="Final"&&(
          <>
            <div className="form-group">
              <label className="form-label">Platform</label>
              <select className="select" value={form.platform} onChange={e => handlePlatformChange(e.target.value)}>
                {["TikTok","Instagram","YouTube","Facebook"].map(p=><option key={p}>{p}</option>)}
              </select>
              {!isConnected(form.platform) && (
                <div className="form-hint" style={{ color: "var(--red)", marginTop: 4 }}>
                  Connect {form.platform} on the Social Channels page to submit {form.platform} videos.
                </div>
              )}
            </div>

            {uploadMode==="link"&&(
              <div className="form-group">
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div className="form-hint" style={{ flex: 1, margin: 0 }}>
                    We check the video is yours through your connected {form.platform}.
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => verifyLink()}
                    disabled={verifying || !form.concept_link || !isConnected(form.platform)}
                    style={{ whiteSpace: "nowrap" }}
                  >
                    {verifying ? "⏳ Verifying..." : "⚡ Verify Video"}
                  </button>
                </div>

                {verifyErr && (
                  <div style={{
                    marginTop: 10,
                    padding: "10px 14px",
                    background: "rgba(239, 68, 68, 0.08)",
                    border: "1px solid rgba(239, 68, 68, 0.25)",
                    borderRadius: "var(--radius-sm)",
                    color: "var(--red)",
                    fontSize: 12,
                    lineHeight: 1.5
                  }}>
                    ⚠️ {verifyErr}
                  </div>
                )}

                {verifiedVideo && (
                  <div style={{
                    marginTop: 10,
                    padding: 12,
                    background: "rgba(16, 185, 129, 0.08)",
                    border: "1px solid rgba(16, 185, 129, 0.3)",
                    borderRadius: "var(--radius-sm)",
                    display: "flex",
                    gap: 12,
                    alignItems: "center"
                  }}>
                    {verifiedVideo.thumbnailUrl ? (
                      <img
                        src={verifiedVideo.thumbnailUrl}
                        alt="Video thumbnail"
                        style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6, flexShrink: 0 }}
                      />
                    ) : (
                      <div style={{ width: 56, height: 56, borderRadius: 6, background: "var(--bg3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>
                        🎬
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--green)", letterSpacing: 0.5 }}>
                          ✓ Ownership Confirmed
                        </span>
                        {verifiedVideo.authorHandle && (
                          <span style={{ fontSize: 12, color: "var(--ink2)", fontWeight: 600 }}>
                            @{verifiedVideo.authorHandle}
                          </span>
                        )}
                      </div>
                      {verifiedVideo.title && (
                        <div style={{ fontSize: 12, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 4 }}>
                          {verifiedVideo.title}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 10, fontSize: 11, color: "var(--ink3)" }}>
                        <span>👁️ <strong>{Number(verifiedVideo.views || 0).toLocaleString()}</strong> views</span>
                        <span>❤️ <strong>{Number(verifiedVideo.likes || 0).toLocaleString()}</strong> likes</span>
                        {verifiedVideo.comments > 0 && <span>💬 <strong>{Number(verifiedVideo.comments).toLocaleString()}</strong></span>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <div className="form-group">
          <label className="form-label">Comment <span style={{color:"var(--ink3)",fontWeight:400}}>(optional)</span></label>
          <textarea className="textarea" rows={2} placeholder="Any notes for your AM about this submission..." value={form.comment} onChange={e=>setForm({...form,comment:e.target.value})}/>
        </div>

        {err&&<div style={{color:"var(--red)",fontSize:13,marginBottom:12}}>{err}</div>}
        <button className="btn btn-primary" onClick={submit} disabled={submitting||myJobs.length===0} style={{marginTop:8}}>
          {submitting ? (uploadProgress>0?"Uploading...":"Submitting...") : "Submit for Review →"}
        </button>
      </div>
    </div>
  );
}
