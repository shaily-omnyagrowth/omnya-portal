import { Alert02Icon, CheckmarkCircle02Icon, Refresh01Icon } from "@hugeicons/core-free-icons";
import Icon from "../../ui/Icon";
import { fmtRelativeTime } from "../../utils";
import { deriveConnectionState, PLATFORM_META } from "./state";

export default function ConnectionCard({ platform, connection, busy, onConnect, onDisconnect, onSync }) {
  const meta = PLATFORM_META[platform];
  const state = deriveConnectionState(connection);
  const scopes = connection?.scopes || [];
  const handle = connection?.username || connection?.platformUsername;

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
          {state.action === "manage" && meta.sync && (
            <button className="btn btn-secondary btn-sm" onClick={onSync} disabled={!!busy}>
              <Icon icon={Refresh01Icon} size={14} className={busy === "sync" ? "spin" : undefined} />{busy === "sync" ? "Syncing…" : "Sync now"}
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

      {state.connected && (connection?.displayName || connection?.profileImageUrl || meta.scopeHints) && (
        <div className="conn-profile">
          {connection?.profileImageUrl && <img src={connection.profileImageUrl} alt="" width="36" height="36" />}
          <div style={{ minWidth: 0 }}>
            {connection?.displayName && <div className="fw-600 fs-13 truncate">{connection.displayName}</div>}
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
    </article>
  );
}
