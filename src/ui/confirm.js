import { createRoot } from "react-dom/client";
import { useState } from "react";
import Dialog from "./Dialog";

function Confirm({ title, body, confirmLabel, cancelLabel, tone, onDone }) {
  const [open, setOpen] = useState(true);
  const finish = (value) => { setOpen(false); onDone(value); };
  return (
    <Dialog
      open={open}
      onClose={() => finish(false)}
      title={title}
      size="sm"
      actions={<>
        <button className="btn btn-secondary" onClick={() => finish(false)}>{cancelLabel}</button>
        <button className={`btn ${tone === "danger" ? "btn-danger" : "btn-primary"}`} onClick={() => finish(true)} autoFocus>{confirmLabel}</button>
      </>}
    >
      {body && <p style={{ color: "var(--ink2)" }}>{body}</p>}
    </Dialog>
  );
}

// Promise-based replacement for window.confirm.
export default function confirm({ title, body, confirmLabel = "Confirm", cancelLabel = "Cancel", tone = "default" }) {
  return new Promise(resolve => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onDone = (value) => {
      resolve(value);
      setTimeout(() => { root.unmount(); host.remove(); }, 250);
    };
    root.render(<Confirm {...{ title, body, confirmLabel, cancelLabel, tone, onDone }} />);
  });
}
