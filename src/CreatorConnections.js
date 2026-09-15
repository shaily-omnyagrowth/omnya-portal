import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import LoadingSpinner from './components/LoadingSpinner';

// F-13. One page, one card, one API family.
//
// TikTok used to render from its own component (src/TikTokConnect.js) against
// /api/integrations/tiktok/*, above three generic cards driven by
// /api/social/connections + /api/auth/{platform}/start. Two state models on one
// screen is how the two TikTok integrations diverged in the first place, and it
// meant the richer TikTok card's status handling — reauth prompts, last_error,
// manual sync — never reached the other three.
//
// Everything now reads /api/social/connections and writes through
// /api/auth/{platform}/start and /api/auth/disconnect. /api/auth/tiktok/start
// delegates to api/integrations/tiktok/connect.js, so the encrypted flow is
// still the one that runs.

// TikTok has no emoji that reads as TikTok; the other three do.
function TikTokGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5
           2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01
           a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34
           6.34 6.34 0 006.33-6.34V8.75a8.19 8.19 0 004.78 1.52V6.82a4.85 4.85 0 01-1.01-.13z"
        fill="#ffffff"
      />
    </svg>
  );
}

// ─── Sync backends ──────────────────────────────────────────────────────────
//
// "Sync now" means one thing to a creator on any platform: go ask the provider
// what it knows and tell me whether this connection is still alive. Two
// endpoints implement it, so the platform table names which one to call and how
// to read the answer, rather than the card branching on the platform name.
//
// /api/analytics/manual-sync re-pulls metrics for the creator's Final Post
// submissions on one platform, and api/_utils/analytics.js stamps
// creator_social_accounts.last_synced_at / last_error / connection_status on the
// way out. That stamp is why the button belongs on this screen at all: it is
// what turns a quietly dead connection into 'sync_failed' with a reason.
//
// TikTok's sync is account-level (profile + video list) and does not need the
// creator to have submitted anything, so it keeps its own endpoint.

const ANALYTICS_SYNC = {
  endpoint: '/api/analytics/manual-sync',
  body: (platform) => ({ platform }),
  summarize: (d) => {
    const total = (d && d.submissionsTotal) || 0;
    if (!total) return 'Sync complete. No posted submissions on this platform yet.';
    const parts = [`${(d && d.updated) || 0} of ${total} post${total === 1 ? '' : 's'} refreshed`];
    if (d && d.failed) parts.push(`${d.failed} failed`);
    if (d && d.skipped) parts.push(`${d.skipped} skipped`);
    return `Sync complete. ${parts.join(', ')}.`;
  },
};

const TIKTOK_SYNC = {
  endpoint: '/api/integrations/tiktok/sync',
  body: () => ({}),
  summarize: (d) => {
    const videos =
      !d ? '' :
      d.video_access === 'scope_not_granted' ? ' Video access was not granted by TikTok.' :
      d.video_access === 'denied' ? ' Video access denied.' :
      d.video_access === 'error' ? ` Video sync error: ${d.video_error || 'unknown'}.` :
      d.videos_synced > 0 ? ` ${d.videos_synced} video${d.videos_synced === 1 ? '' : 's'} synced.` :
      ' No new videos.';
    return `Sync complete.${videos}`;
  },
};

const PLATFORM_META = {
  tiktok: {
    label: 'TikTok',
    icon: <TikTokGlyph />,
    iconBg: '#010101',
    subtitle: 'Videos & Analytics',
    sync: TIKTOK_SYNC,
    // TikTok grants video.list separately from user.info.basic. Without it the
    // sync returns a profile and no videos, which reads as a silent failure.
    scopeHints: [{ scope: 'video.list', label: 'Video access' }],
  },
  instagram: { label: 'Instagram', icon: '📸', subtitle: 'Analytics & Insights', sync: ANALYTICS_SYNC },
  facebook:  { label: 'Facebook',  icon: '👤', subtitle: 'Pages & Feed',         sync: ANALYTICS_SYNC },
  youtube:   { label: 'YouTube',   icon: '🎥', subtitle: 'Channel & Videos',     sync: ANALYTICS_SYNC },
};

// Order matches api/_utils/socialAccounts.js PLATFORMS so the cards line up
// with the order the endpoint returns them in.
const VISIBLE_PLATFORMS = ['tiktok', 'instagram', 'facebook', 'youtube'];

// ─── Connection status ──────────────────────────────────────────────────────
//
// The live CHECK on creator_social_accounts.connection_status accepts exactly
// these six values. Anything else reaching the UI is either legacy or a bug.

const STATUS_META = {
  connected:       { label: '● Connected',          color: '#10b981', bg: '#dcfce7', border: '#10b981' },
  not_connected:   { label: 'Not connected',        color: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' },
  disconnected:    { label: 'Not connected',        color: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' },
  expired:         { label: '● Token expired',      color: '#b45309', bg: '#fef3c7', border: '#f59e0b' },
  reauth_required: { label: '● Reconnect required', color: '#b45309', bg: '#fef3c7', border: '#f59e0b' },
  sync_failed:     { label: '● Sync failed',        color: '#b91c1c', bg: '#fee2e2', border: '#ef4444' },
};

// Spellings the CHECK rejects but that a legacy creator_tokens row or a
// hand-written fixture can still hand us. Mapped, not ignored — the old card
// silently fell through to "Not connected" and offered Connect on a live
// account, which is the failure this screen keeps producing.
const STATUS_ALIASES = { error: 'sync_failed', needs_reauth: 'reauth_required' };

// 'sync_failed' is not a reauth status: the token still works, the provider or
// a post link did not. It keeps Sync Now available and shows the reason below,
// matching REAUTH_STATUSES in api/_utils/socialAccounts.js.
const REAUTH_STATUSES = new Set(['expired', 'reauth_required']);
const OFF_STATUSES = new Set(['not_connected', 'disconnected']);

// Why a connection stopped working, in the creator's words. last_error from the
// API is appended when there is one; it is the provider's message, not ours.
const REAUTH_REASON = {
  expired:         'The access token has expired.',
  reauth_required: 'This account needs to be authorized again.',
  sync_failed:     'The last sync failed.',
};

/**
 * Fold one /api/social/connections row into the state the card renders.
 *
 * Exported so tests/social-connections.test.cjs can assert the mapping without
 * a browser — the six status values are a database constraint, and a card that
 * renders the wrong one for a live account is invisible until a creator
 * complains.
 */
export function deriveConnectionState(connection) {
  const raw = (connection && (connection.connectionStatus || connection.status)) || 'not_connected';
  const aliased = STATUS_ALIASES[raw] || raw;
  const status = STATUS_META[aliased] ? aliased : 'not_connected';

  // The server decides this (needsReauth in api/_utils/socialAccounts.js) and
  // is the only side that can see the token. Recompute from expiresAt only as
  // a floor, so a row that says 'connected' past its expiry is never trusted.
  const tokenDead = !!(
    connection &&
    connection.expiresAt &&
    new Date(connection.expiresAt).getTime() < Date.now()
  );
  const off = OFF_STATUSES.has(status);
  const needsReauth =
    !off && (connection?.needsReauth === true || REAUTH_STATUSES.has(status) || tokenDead);

  // 'connected' plus a dead token is not connected; show it as expired.
  const display = status === 'connected' && needsReauth ? 'expired' : status;
  const connected = display === 'connected';

  return {
    status: display,
    connected,
    needsReauth,
    canSync: connected,
    action: off ? 'connect' : needsReauth ? 'reconnect' : 'manage',
    reason: needsReauth ? REAUTH_REASON[display] || REAUTH_REASON.reauth_required : null,
    meta: STATUS_META[display],
  };
}

function fmtRelative(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function CreatorConnections({ currentUser }) {
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState({});
  const [message, setMessage] = useState({ type: '', text: '' });
  const [busy, setBusy] = useState(null); // { platform, action: 'connect'|'disconnect'|'sync' }

  // Surface OAuth callback success/error from URL on mount. Every callback —
  // including api/integrations/tiktok/callback.js — lands here as
  // ?page=social-connections&connected=<platform> or &error=<code>.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let changed = false;
    const connected = params.get('connected');
    const error = params.get('error');
    if (connected) {
      const meta = PLATFORM_META[connected];
      setMessage({ type: 'success', text: `Connected ${meta ? meta.label : connected} successfully.` });
      params.delete('connected');
      changed = true;
    }
    if (error) {
      setMessage({ type: 'error', text: `Connection failed: ${error.replace(/_/g, ' ')}.` });
      params.delete('error');
      changed = true;
    }
    if (changed) {
      // `page` is left alone — App.js routes off it.
      const url = new URL(window.location);
      url.search = params.toString();
      window.history.replaceState({}, document.title, url);
    }
  }, []);

  const authHeader = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not signed in');
    return { Authorization: `Bearer ${session.access_token}` };
  }, []);

  const loadConnections = useCallback(async () => {
    if (!currentUser || !currentUser.id) return;
    setLoading(true);
    try {
      const res = await fetch('/api/social/connections', { headers: await authHeader() });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok) {
        throw new Error((json.error && json.error.message) || 'Failed to load connections');
      }

      const byPlatform = {};
      for (const conn of json.data.connections || []) {
        byPlatform[conn.platform] = conn;
      }
      setConnections(byPlatform);
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Failed to load connections' });
    } finally {
      setLoading(false);
    }
  }, [currentUser, authHeader]);

  useEffect(() => { loadConnections(); }, [loadConnections]);

  const handleConnect = async (platform) => {
    setBusy({ platform, action: 'connect' });
    setMessage({ type: '', text: '' });
    try {
      const res = await fetch(`/api/auth/${platform}/start`, {
        method: 'POST',
        headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok || !(json.data && json.data.authorizationUrl)) {
        throw new Error((json.error && json.error.message) || `Failed to start ${platform} OAuth`);
      }
      // Hand off to the OAuth provider. The callback redirects back with
      // ?connected= or ?error= which the mount-effect surfaces.
      window.location.href = json.data.authorizationUrl;
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
      setBusy(null);
    }
  };

  const handleDisconnect = async (platform) => {
    const meta = PLATFORM_META[platform] || { label: platform };
    if (!window.confirm(`Disconnect ${meta.label}? We will stop syncing analytics for this account.`)) {
      return;
    }
    setBusy({ platform, action: 'disconnect' });
    setMessage({ type: '', text: '' });
    try {
      const res = await fetch('/api/auth/disconnect', {
        method: 'POST',
        headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok) {
        throw new Error((json.error && json.error.message) || 'Failed to disconnect');
      }

      setConnections((prev) => ({
        ...prev,
        [platform]: {
          ...prev[platform],
          status: 'disconnected',
          connectionStatus: 'disconnected',
          needsReauth: false,
          expiresAt: null,
          lastError: null,
        },
      }));
      setMessage({ type: 'success', text: `${meta.label} disconnected.` });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setBusy(null);
    }
  };

  const handleSync = async (platform) => {
    const meta = PLATFORM_META[platform];
    if (!meta || !meta.sync) return;
    setBusy({ platform, action: 'sync' });
    setMessage({ type: '', text: '' });
    try {
      const res = await fetch(meta.sync.endpoint, {
        method: 'POST',
        headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
        body: JSON.stringify(meta.sync.body(platform)),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok) {
        throw new Error((json.error && json.error.message) || `${meta.label} sync failed`);
      }
      setMessage({ type: 'success', text: `${meta.label}: ${meta.sync.summarize(json.data)}` });
      // The sync writes last_synced_at / last_error / connection_status, so the
      // card is stale until we re-read it.
      await loadConnections();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <LoadingSpinner label="Loading connections…" />;

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '20px' }}>
      <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '8px' }}>Social Connections</h2>
      <p style={{ color: '#6b7280', marginBottom: '24px' }}>
        Connect your accounts to automatically sync analytics for your submissions.
      </p>

      {message.text && (
        <div
          style={{
            padding: '12px',
            marginBottom: '20px',
            borderRadius: '6px',
            backgroundColor: message.type === 'success' ? '#dcfce7' : '#fee2e2',
            color: message.type === 'success' ? '#166534' : '#991b1b',
          }}
          role="status"
        >
          {message.text}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {VISIBLE_PLATFORMS.map((platform) => (
          <ConnectionCard
            key={platform}
            platform={platform}
            connection={connections[platform]}
            busy={busy && busy.platform === platform ? busy.action : null}
            onConnect={() => handleConnect(platform)}
            onDisconnect={() => handleDisconnect(platform)}
            onSync={() => handleSync(platform)}
          />
        ))}
      </div>
    </div>
  );
}

function ConnectionCard({ platform, connection, busy, onConnect, onDisconnect, onSync }) {
  const meta = PLATFORM_META[platform] || { label: platform, icon: '🔗' };
  const state = deriveConnectionState(connection);
  const scopes = (connection && connection.scopes) || [];
  // Only draw the profile block when the provider actually gave us something;
  // an empty grey panel under a healthy card reads as a half-loaded page.
  const hasProfile = !!(
    connection &&
    (connection.displayName || connection.username || connection.profileImageUrl)
  ) || (meta.scopeHints || []).length > 0;

  return (
    <div
      style={{
        padding: '20px',
        border: `1px solid ${state.meta.border}`,
        borderRadius: '12px',
        backgroundColor: '#fff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', minWidth: 0 }}>
          <div
            style={{
              width: 40, height: 40, borderRadius: 8, background: meta.iconBg || '#f3f4f6',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
              flexShrink: 0,
            }}
            aria-hidden="true"
          >
            {meta.icon}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h3 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>{meta.label}</h3>
              <span
                style={{
                  padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                  background: state.meta.bg, color: state.meta.color,
                }}
              >
                {state.meta.label}
              </span>
            </div>
            <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>
              <span>{meta.subtitle}</span>
              {connection && connection.platformUsername && (
                <>
                  <span style={{ margin: '0 8px' }}>|</span>
                  <span title={`Platform user ID: ${connection.platformUserId || 'n/a'}`}>
                    {connection.platformUsername}
                  </span>
                </>
              )}
              {connection && connection.lastSyncedAt && (
                <>
                  <span style={{ margin: '0 8px' }}>|</span>
                  <span>Synced {fmtRelative(connection.lastSyncedAt)}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {state.action === 'manage' && meta.sync && (
            <button
              onClick={onSync}
              disabled={!!busy}
              style={{
                padding: '8px 16px', borderRadius: '6px', border: '1px solid #d1d5db',
                background: '#fff', color: '#374151',
                cursor: busy ? 'wait' : 'pointer', fontSize: '14px',
              }}
            >
              {busy === 'sync' ? 'Syncing…' : 'Sync Now'}
            </button>
          )}
          {state.action === 'manage' && (
            <button
              onClick={onDisconnect}
              disabled={!!busy}
              style={{
                padding: '8px 16px', borderRadius: '6px', border: 'none',
                background: '#fee2e2', color: '#dc2626',
                cursor: busy ? 'wait' : 'pointer', fontSize: '14px',
              }}
            >
              {busy === 'disconnect' ? '…' : 'Disconnect'}
            </button>
          )}
          {state.action === 'reconnect' && (
            <button
              onClick={onConnect}
              disabled={busy === 'connect'}
              style={{
                padding: '8px 16px', borderRadius: '6px', border: 'none',
                background: '#f59e0b', color: '#fff',
                cursor: busy === 'connect' ? 'wait' : 'pointer', fontWeight: 600, fontSize: '14px',
              }}
            >
              {busy === 'connect' ? '…' : 'Reconnect'}
            </button>
          )}
          {state.action === 'connect' && (
            <button
              onClick={onConnect}
              disabled={busy === 'connect'}
              style={{
                padding: '8px 16px', borderRadius: '6px', border: 'none',
                background: '#0a0a0a', color: '#fff',
                cursor: busy === 'connect' ? 'wait' : 'pointer', fontWeight: 600, fontSize: '14px',
              }}
            >
              {busy === 'connect' ? '…' : 'Connect Account'}
            </button>
          )}
        </div>
      </div>

      {/* A connection that has silently stopped working is the failure mode
          this screen keeps producing. Say so, with the provider's own reason. */}
      {state.needsReauth && (
        <div
          role="alert"
          style={{
            marginTop: 14, padding: '10px 12px', borderRadius: 8,
            background: state.meta.bg, color: '#7c2d12', fontSize: 13,
          }}
        >
          <strong>Reconnect required.</strong>{' '}
          <span>{state.reason}</span>{' '}
          <span>Analytics for {meta.label} are not updating until you reconnect.</span>
          {connection && connection.lastError && (
            <div style={{ marginTop: 6, color: '#b91c1c', fontSize: 12, wordBreak: 'break-word' }}>
              {connection.lastError}
            </div>
          )}
        </div>
      )}

      {/* Not a reconnect: the token works, but a post could not be read or the
          provider was unavailable. Say which, so the creator can fix a link. */}
      {!state.needsReauth && connection && connection.lastError && (
        <div
          role="status"
          style={{
            marginTop: 14, padding: '10px 12px', borderRadius: 8,
            background: '#fff7ed', color: '#9a3412', fontSize: 13, wordBreak: 'break-word',
          }}
        >
          <strong>Last sync issue:</strong> {connection.lastError}
        </div>
      )}

      {state.connected && hasProfile && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 14, marginTop: 14,
            padding: '12px 14px', background: '#f9fafb', borderRadius: 8,
            border: '1px solid #f3f4f6',
          }}
        >
          {connection && connection.profileImageUrl && (
            <img
              src={connection.profileImageUrl}
              alt=""
              style={{
                width: 44, height: 44, borderRadius: '50%', objectFit: 'cover',
                flexShrink: 0, border: '2px solid #e5e7eb',
              }}
            />
          )}
          <div style={{ minWidth: 0 }}>
            {connection && connection.displayName && (
              <p style={{ margin: 0, fontWeight: 600, fontSize: 15, color: '#111827' }}>
                {connection.displayName}
              </p>
            )}
            {connection && connection.username && (
              <p style={{ margin: '2px 0 0', color: '#6b7280', fontSize: 13 }}>@{connection.username}</p>
            )}
            {(meta.scopeHints || []).map((hint) => {
              const granted = scopes.includes(hint.scope);
              return (
                <p
                  key={hint.scope}
                  style={{ margin: '4px 0 0', fontSize: 12, color: granted ? '#10b981' : '#f59e0b' }}
                >
                  {granted ? `✓ ${hint.label} granted` : `⚠ ${hint.label} not granted`}
                </p>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
