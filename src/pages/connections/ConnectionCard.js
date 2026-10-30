import { useState } from "react";
import { Alert02Icon, CheckmarkCircle02Icon, HelpCircleIcon } from "@hugeicons/core-free-icons";
import Dialog from "../../ui/Dialog";
import Icon from "../../ui/Icon";
import { fmtRelativeTime } from "../../utils";
import { deriveConnectionState, PLATFORM_META } from "./state";

export default function ConnectionCard({ platform, connection, busy, onConnect, onDisconnect, onSync }) {
  const meta = PLATFORM_META[platform];
  const state = deriveConnectionState(connection);
  const scopes = connection?.scopes || [];
  const handle = connection?.username || connection?.platformUsername;
  const [guideOpen, setGuideOpen] = useState(false);
  const pages = connection?.pages || [];

  return (
    <article className={`conn-card ${state.connected ? "is-connected" : ""}`}>
      <div className="conn-head">
        <span className={`conn-icon conn-${platform}`}><Icon icon={meta.icon} size={20} /></span>
        <div className="flex-1">
          <div className="flex-center gap-8 flex-wrap">
            <h2 className="fw-600 fs-16">{meta.label}</h2>
            <span className={`badge badge-${state.meta.tone}`}><span className="dot" />{state.meta.label}</span>
          </div>
          <div className="fs-13 text-muted mt-4 truncate">
            {state.connected && handle ? `@${String(handle).replace(/^@/, "")}` : meta.subtitle}
            {connection?.lastSyncedAt && ` · synced ${fmtRelativeTime(connection.lastSyncedAt).toLowerCase()}`}
          </div>
        </div>
        <div className="conn-actions">
          {meta.guide && <button className="btn btn-ghost btn-sm" onClick={() => setGuideOpen(true)}><Icon icon={HelpCircleIcon} size={16} />How to connect</button>}
          {state.action === "manage" && meta.sync && (
            <button className="btn btn-secondary btn-sm" onClick={onSync} disabled={!!busy}>
              {busy === "sync" ? "Syncing…" : "Sync now"}
            </button>
          )}
          {state.action === "manage" && <button className="btn btn-ghost btn-sm" onClick={onDisconnect} disabled={!!busy}>{busy === "disconnect" ? "Disconnecting…" : "Disconnect"}</button>}
          {state.action === "reconnect" && <button className="btn btn-primary btn-sm" onClick={onConnect} disabled={busy === "connect"}>{busy === "connect" ? "Opening…" : "Reconnect"}</button>}
          {state.action === "connect" && <button className="btn btn-primary btn-sm" onClick={onConnect} disabled={busy === "connect"}>{busy === "connect" ? "Opening…" : "Connect"}</button>}
        </div>
      </div>

      {state.needsReauth && (
        <div className="alert alert-warning mt-12" role="alert">
          <Icon icon={Alert02Icon} size={16} />
          <div className="alert-body">
            <div className="alert-title">Reconnect to keep views updating</div>
            <div>{state.reason} {meta.label} analytics are paused until you reconnect.</div>
            {connection?.lastError && <div className="fs-12 mt-4 break-anywhere" style={{ opacity: 0.85 }}>{connection.lastError}</div>}
          </div>
        </div>
      )}
      {!state.needsReauth && connection?.lastError && (
        <div className="alert alert-error mt-12" role="status">
          <Icon icon={Alert02Icon} size={16} />
          <div className="alert-body"><div className="alert-title">Last sync had a problem</div><div className="break-anywhere">{connection.lastError}</div></div>
        </div>
      )}

      {state.connected && (connection?.displayName || connection?.profileImageUrl || meta.scopeHints || meta.guide) && (
        <div className="conn-profile">
          {connection?.profileImageUrl && <img src={connection.profileImageUrl} alt="" width="36" height="36" />}
          <div style={{ minWidth: 0 }}>
            {connection?.displayName && <div className="fw-600 fs-13 truncate">{connection.displayName}</div>}
            {meta.guide && (
              <div className="fs-12 text-muted mt-4">{pages.length ? `Pages: ${pages.map(p => p.name).join(", ")}` : "No Pages shared yet"}</div>
            )}
            {(meta.scopeHints || []).map(h => {
              const granted = scopes.includes(h.scope);
              return (
                <div key={h.scope} className="fs-12 flex-center gap-4" style={{ color: granted ? "var(--green)" : "var(--amber)" }}>
                  <Icon icon={granted ? CheckmarkCircle02Icon : Alert02Icon} size={12} />{h.label} {granted ? "granted" : "not granted"}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {guideOpen && (
        <Dialog size="sm" title={`How to connect ${meta.label}`} onClose={() => setGuideOpen(false)}
          actions={<button className="btn btn-primary" onClick={() => setGuideOpen(false)}>Got it</button>}>
          <ol className="fs-14" style={{ listStyle: "decimal", paddingLeft: 18, display: "grid", gap: 8, color: "var(--ink2)" }}>
            {meta.guide.steps.map(s => <li key={s}>{s}</li>)}
          </ol>
          <p className="fs-13 text-muted mt-12">{meta.guide.note}</p>
        </Dialog>
      )}
    </article>
  );
}
