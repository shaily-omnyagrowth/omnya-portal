import Alert from "../../ui/Alert";
import Dialog from "../../ui/Dialog";
import Icon from "../../ui/Icon";
import Spinner from "../../ui/Spinner";
import { PLATFORM_META } from "./state";

export default function ConnectDialog({ modal, onCancel, onClose, onRetry }) {
  const meta = PLATFORM_META[modal.platform];
  const label = meta?.label || "your account";
  const failed = modal.status === "error";
  return (
    <Dialog
      size="sm"
      title={failed ? `${label} isn't connected yet` : `Connecting ${label}`}
      onClose={failed ? onClose : onCancel}
      actions={failed
        ? <><button className="btn btn-secondary" onClick={onClose}>Back to the portal</button><button className="btn btn-primary" onClick={onRetry}>Try again</button></>
        : <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>}
    >
      <div className="flex-center gap-12 mb-16">
        {meta && <span className={`conn-icon conn-${modal.platform}`}><Icon icon={meta.icon} size={20} /></span>}
        {!failed && <Spinner inline label="Waiting for sign in" />}
      </div>
      {failed
        ? <Alert tone="error">{modal.errorText || "The sign in wasn't completed."}</Alert>
        : <p className="fs-14" style={{ color: "var(--ink2)" }}>Finish signing in in the window that just opened. This page updates on its own once you're connected. If that window shows an error, close it and press Cancel.</p>}
    </Dialog>
  );
}
