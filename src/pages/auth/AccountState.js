import { Clock01Icon, LockIcon } from "@hugeicons/core-free-icons";
import Icon from "../../ui/Icon";

const COPY = {
  pending: {
    icon: Clock01Icon,
    title: "Your account is waiting for approval",
    body: "An Omnya admin will assign your role shortly. We'll email you when it's ready, and this page updates on its own.",
  },
  denied: {
    icon: LockIcon,
    title: "This account doesn't have access",
    body: "Your request wasn't approved. If you think that's a mistake, email hello@omnyagrowth.com.",
  },
};

export default function AccountState({ kind, onCheck, checking, onLogout }) {
  const c = COPY[kind];
  return (
    <div className="state-screen">
      <div className="state-card">
        <img src="/brand/mark.png" alt="Omnya" width="30" height="40" style={{ margin: "0 auto 28px" }} />
        <div className="empty-icon"><Icon icon={c.icon} size={20} /></div>
        <h1>{c.title}</h1>
        <p>{c.body}</p>
        <div className="state-actions">
          {onCheck && <button className="btn btn-primary" onClick={onCheck} disabled={checking}>{checking ? "Checking…" : "Check status"}</button>}
          <button className="btn btn-secondary" onClick={onLogout}>Sign out</button>
        </div>
      </div>
    </div>
  );
}
