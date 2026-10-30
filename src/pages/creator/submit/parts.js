import { useRef, useState } from "react";
import { CheckmarkCircle02Icon, Upload04Icon, Video01Icon } from "@hugeicons/core-free-icons";
import Icon from "../../../ui/Icon";
import { fmtCompactNum } from "../../../utils";

export function DropZone({ file, onFile, progress, busy }) {
  const [over, setOver] = useState(false);
  const input = useRef(null);
  const take = (f) => { if (f && f.type.startsWith("video/")) onFile(f); };
  return (
    <div>
      <input ref={input} id="videoUpload" type="file" accept="video/*" className="sr-only" onChange={e => take(e.target.files?.[0])} />
      <label htmlFor="videoUpload" className={`dropzone ${over ? "over" : ""} ${file ? "has-file" : ""}`}
        onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]); }}>
        <span className="empty-icon" style={{ margin: 0 }}><Icon icon={file ? Video01Icon : Upload04Icon} size={20} /></span>
        {file ? (
          <span style={{ minWidth: 0 }}>
            <span className="fw-600 fs-14 truncate" style={{ display: "block" }}>{file.name}</span>
            <span className="fs-12 text-muted">{(file.size / 1024 / 1024).toFixed(1)} MB · click or drop to replace</span>
          </span>
        ) : (
          <span>
            <span className="fw-600 fs-14" style={{ display: "block" }}>Drop a video here, or click to choose</span>
            <span className="fs-12 text-muted">MP4 or MOV works best</span>
          </span>
        )}
      </label>
      {busy && progress > 0 && (
        <div className="mt-8" aria-live="polite">
          <div className="flex-between fs-12 text-muted mb-4"><span>Uploading</span><span className="tnum">{progress}%</span></div>
          <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
        </div>
      )}
    </div>
  );
}

export function VerifiedVideo({ video }) {
  return (
    <div className="alert alert-success mt-12" style={{ alignItems: "center" }}>
      {video.thumbnailUrl
        ? <img src={video.thumbnailUrl} alt="" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} />
        : <span className="empty-icon" style={{ margin: 0, width: 48, height: 48 }}><Icon icon={Video01Icon} size={18} /></span>}
      <div className="alert-body">
        <div className="alert-title flex-center gap-4"><Icon icon={CheckmarkCircle02Icon} size={14} />It's yours{video.authorHandle ? `, posted by @${video.authorHandle}` : ""}</div>
        {video.title && <div className="truncate" style={{ color: "var(--ink2)" }}>{video.title}</div>}
        <div className="fs-12" style={{ color: "var(--ink2)" }}>
          {fmtCompactNum(video.views || 0)} views · {fmtCompactNum(video.likes || 0)} likes{video.comments > 0 ? ` · ${fmtCompactNum(video.comments)} comments` : ""}
        </div>
      </div>
    </div>
  );
}

export function HowItWorks({ type }) {
  const steps = [
    ["Send a concept", "A rough cut or draft for your account manager to approve before you post."],
    ["Get feedback", "Approval or notes usually land within 1 to 3 days. You'll see them in Submissions."],
    ["Post and send the link", "Once it's live, submit the final link. We confirm it's yours and start tracking views."],
  ];
  const active = type === "Final" ? 2 : 0;
  return (
    <aside className="card">
      <h2 className="card-title">How review works</h2>
      <ol className="steps">
        {steps.map(([t, d], i) => (
          <li key={t} className={i === active ? "active" : i < active ? "done" : ""}>
            <span className="step-num">{i + 1}</span>
            <span><span className="fw-600 fs-13" style={{ display: "block" }}>{t}</span><span className="fs-13 text-muted">{d}</span></span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
