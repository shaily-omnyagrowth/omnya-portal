import { useRef, useState } from "react";
import { Upload04Icon, Video01Icon } from "@hugeicons/core-free-icons";
import Icon from "../../../ui/Icon";

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

const POSTED_CHOICES = [
  ["Concept", "Not posted yet", "Send a draft for approval."],
  ["Final", "Already posted", "We'll confirm it's yours and track views."],
];

export function PostedChoice({ value, onChange }) {
  return (
    <fieldset className="choice-group">
      <legend className="form-label">Has this video been posted?</legend>
      <div className="choice-cards">
        {POSTED_CHOICES.map(([v, title, text]) => (
          <label key={v} className="choice-card">
            <input type="radio" name="posted" checked={value === v} onChange={() => onChange(v)} />
            <span>
              <strong>{title}</strong>
              <span className="choice-card-text">{text}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
