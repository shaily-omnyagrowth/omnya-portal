import { useEffect, useRef } from "react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import Icon from "./Icon";

export default function Dialog({ open = true, onClose, title, description, children, actions, size = "md", dismissable = true }) {
  const ref = useRef(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { if (d.showModal) d.showModal(); else d.setAttribute("open", ""); }
    if (!open && d.open) { if (d.close) d.close(); else d.removeAttribute("open"); }
  }, [open]);

  useEffect(() => () => { const d = ref.current; if (d?.open && d.close) d.close(); }, []);

  const close = () => { if (dismissable) onClose?.(); };

  return (
    <dialog
      ref={ref}
      className={`dialog dialog-${size}`}
      aria-label={typeof title === "string" ? title : undefined}
      onCancel={e => { e.preventDefault(); close(); }}
      onMouseDown={e => { if (e.target === ref.current) close(); }}
    >
      <div className="dialog-panel">
        {(title || onClose) && (
          <div className="dialog-head">
            <div style={{ minWidth: 0 }}>
              {title && <h2 className="modal-title">{title}</h2>}
              {description && <p className="modal-sub">{description}</p>}
            </div>
            {onClose && dismissable && (
              <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close">
                <Icon icon={Cancel01Icon} size={16} />
              </button>
            )}
          </div>
        )}
        <div className="dialog-body">{children}</div>
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </dialog>
  );
}
