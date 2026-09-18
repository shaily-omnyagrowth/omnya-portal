import React, { useState, useEffect, useCallback, useRef } from 'react';
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

// Must match public/oauth-complete.js.
const OAUTH_CHANNEL = 'omnya-oauth';
const OAUTH_STORAGE_KEY = 'omnya_oauth_result';

// Callback error codes are `<platform>_<reason>`; Facebook's come back as meta_*.
function platformFromError(code) {
  const prefix = String(code || '').split('_')[0];
  if (prefix === 'meta') return 'facebook';
  return PLATFORM_META[prefix] ? prefix : null;
}

const OAUTH_ERROR_TEXT = {
  auth_denied: 'The sign-in was cancelled, or access was not granted. Choose Allow / Continue on every screen.',
  missing_params: 'The provider sent you back without an authorization code. Please start again.',
  invalid_state: 'That sign-in link expired or was already used (they last 10 minutes). Please start again.',
  misconfigured: 'This platform is not fully set up on our side yet. Please let your account manager know.',
  token_failed: 'The provider refused to complete the sign-in. This is usually a configuration issue on our side. Please let your account manager know.',
  token_exchange_failed: 'The provider refused to complete the sign-in. This is usually a configuration issue on our side. Please let your account manager know.',
  encryption_failed: 'We could not store the connection securely, so nothing was saved. Please let your account manager know.',
  storage_failed: 'The sign-in worked but we could not save it. Please try again in a moment.',
  server_error: 'Something went wrong on our side. Please try again in a moment.',
};

export function describeOAuthError(code) {
  const clean = String(code || '').replace(/[^a-z0-9_]/gi, '');
  const reason = clean.replace(/^(tiktok|instagram|facebook|youtube|meta)_/, '');
  const text = OAUTH_ERROR_TEXT[reason] || 'The connection could not be completed. Please try again.';
  return clean ? `${text} (Reference: ${clean})` : text;
}

export default function CreatorConnections({ currentUser }) {
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState({});
  const [message, setMessage] = useState({ type: '', text: '' });
  const [busy, setBusy] = useState(null); // { platform, action: 'connect'|'disconnect'|'sync' }
  const [connectingModal, setConnectingModal] = useState(null); // { platform, status: 'opening'|'waiting'|'error', errorText }

  // Surface an OAuth result carried in the URL. This is the FULL-PAGE flow only
  // (popup blocked, so the portal itself navigated to the provider and came
  // back through /oauth-complete). The popup flow reports over the channel
  // below and never touches this tab's URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const error = params.get('error');
    const retry = params.get('retry');
    const platform = params.get('platform');
    if (!connected && !error && !retry) return;

    if (connected) {
      const meta = PLATFORM_META[connected];
      setMessage({ type: 'success', text: `Connected ${meta ? meta.label : 'your account'} successfully.` });
    } else {
      // Land on the same modal the popup flow uses, so there is always a Try
      // Again one click away rather than a red banner and nothing to press.
      const target = PLATFORM_META[retry] ? retry : PLATFORM_META[platform] ? platform : platformFromError(error);
      if (target) {
        setConnectingModal({
          platform: target,
          status: 'error',
          errorText: error
            ? describeOAuthError(error)
            : `Ready when you are. Press Try Again to reconnect ${PLATFORM_META[target].label}.`,
        });
      } else {
        setMessage({ type: 'error', text: describeOAuthError(error) });
      }
    }

    ['connected', 'error', 'retry', 'platform'].forEach((k) => params.delete(k));
    // `page` is left alone: App.js routes off it.
    const url = new URL(window.location);
    url.search = params.toString();
    window.history.replaceState({}, document.title, url);
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

  // --- The OAuth hand-off -----------------------------------------------------
  //
  // The provider opens in a popup so that the portal is never the page that
  // gets stranded. TikTok, Meta and Google all show their OWN error page for a
  // bad redirect URI, an unapproved scope or an app still in sandbox, and none
  // of those pages links back here. In a popup that is a window to close; as a
  // full-page redirect it was a dead end that meant retyping the portal URL.
  //
  // Three things this deliberately does NOT rely on, because production sends
  // Cross-Origin-Opener-Policy: same-origin (vercel.json) and the dev server
  // does not, so each of them works locally and fails once deployed:
  //
  //   window.opener / postMessage   severed as soon as the popup visits the
  //                                 provider; null even after it comes back
  //   popup.closed                  reads TRUE for that severed popup while it
  //                                 is still open, so polling it reports
  //                                 "you closed the window" one second in
  //   window.open() after an await  no longer inside the click, so Safari and
  //                                 Firefox block it; opened first, aimed after
  //
  // The result arrives on a BroadcastChannel from /oauth-complete.js, with a
  // localStorage event as the fallback, and polling /api/social/connections as
  // the backstop for a broadcast nobody was awake to hear.
  const connectStartedAt = useRef(0);
  const popupRef = useRef(null);

  const finishConnect = useCallback((result) => {
    if (!result || result.type !== 'oauth_result') return;
    // Ignore a stale result left in storage by an earlier attempt.
    if (result.at && connectStartedAt.current && result.at < connectStartedAt.current - 1000) return;
    try { window.localStorage.removeItem(OAUTH_STORAGE_KEY); } catch (_) { /* private mode */ }
    popupRef.current = null;
    setBusy(null);

    if (result.status === 'success') {
      const meta = PLATFORM_META[result.platform];
      setConnectingModal(null);
      setMessage({ type: 'success', text: `Connected ${meta ? meta.label : 'your account'} successfully.` });
      loadConnections();
    } else {
      setConnectingModal((prev) => ({
        platform: (PLATFORM_META[result.platform] && result.platform) || (prev && prev.platform) || null,
        status: 'error',
        errorText: describeOAuthError(result.error),
      }));
    }
  }, [loadConnections]);

  useEffect(() => {
    let channel = null;
    try {
      if ('BroadcastChannel' in window) {
        channel = new BroadcastChannel(OAUTH_CHANNEL);
        channel.onmessage = (ev) => {
          if (!ev.data || ev.data.type !== 'oauth_result') return;
          // The ack is how the popup learns a portal tab is alive, and
          // therefore that it should close itself instead of navigating.
          try { channel.postMessage({ type: 'oauth_ack' }); } catch (_) { /* closed */ }
          finishConnect(ev.data);
        };
      }
    } catch (_) { channel = null; }

    const onStorage = (ev) => {
      if (ev.key !== OAUTH_STORAGE_KEY || !ev.newValue) return;
      try {
        const data = JSON.parse(ev.newValue);
        try { window.localStorage.setItem(`${OAUTH_STORAGE_KEY}_ack`, String(Date.now())); } catch (_) { /* ignore */ }
        finishConnect(data);
      } catch (_) { /* not ours */ }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      window.removeEventListener('storage', onStorage);
      if (channel) { try { channel.close(); } catch (_) { /* ignore */ } }
    };
  }, [finishConnect]);

  // Backstop. While a connect is in flight, ask the server every few seconds
  // whether the row has turned 'connected' since we started. Covers a missed
  // broadcast and a creator who finishes in the popup and just closes it.
  const waitingPlatform =
    connectingModal && connectingModal.status === 'waiting' ? connectingModal.platform : null;
  useEffect(() => {
    if (!waitingPlatform) return undefined;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch('/api/social/connections', { headers: await authHeader() });
        const json = await res.json().catch(() => ({}));
        if (cancelled || !res.ok || !json.ok) return;
        const row = (json.data.connections || []).find((c) => c.platform === waitingPlatform);
        const updated = row && row.updatedAt ? new Date(row.updatedAt).getTime() : 0;
        if (row && row.connectionStatus === 'connected' && updated >= connectStartedAt.current - 5000) {
          finishConnect({ type: 'oauth_result', platform: waitingPlatform, status: 'success', at: Date.now() });
        }
      } catch (_) { /* transient; the next tick tries again */ }
    };
    const id = setInterval(tick, 4000);
    return () => { cancelled = true; clearInterval(id); };
  }, [waitingPlatform, authHeader, finishConnect]);

  const cancelConnect = () => {
    // Best effort: a popup already severed by COOP cannot be closed from here.
    try { if (popupRef.current) popupRef.current.close(); } catch (_) { /* ignore */ }
    popupRef.current = null;
    setConnectingModal(null);
    setBusy(null);
  };

  const handleConnect = async (platform) => {
    setBusy({ platform, action: 'connect' });
    setMessage({ type: '', text: '' });
    connectStartedAt.current = Date.now();
    try { window.localStorage.removeItem(OAUTH_STORAGE_KEY); } catch (_) { /* private mode */ }

    // Open the window NOW, inside the click, and point it at the provider once
    // we have the URL. Browsers only honour window.open during the gesture.
    const width = 600, height = 760;
    const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
    const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
    let popup = null;
    try {
      popup = window.open('', `omnya_oauth_${platform}`,
        `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,status=no`);
      if (popup && popup.document) {
        popup.document.title = 'Connecting...';
        popup.document.body.textContent = 'Opening the sign-in page...';
      }
    } catch (_) { popup = null; }
    popupRef.current = popup;

    setConnectingModal({ platform, status: 'opening' });
    try {
      const res = await fetch(`/api/auth/${platform}/start`, {
        method: 'POST',
        headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok || !(json.data && json.data.authorizationUrl)) {
        throw new Error((json.error && json.error.message) || `Failed to start ${platform} OAuth`);
      }
      const authUrl = json.data.authorizationUrl;

      if (popup && !popup.closed) {
        popup.location.href = authUrl;
        setConnectingModal({ platform, status: 'waiting' });
      } else {
        // Popup blocked. Fall back to taking this tab to the provider;
        // /oauth-complete hears no ack and brings the creator back here.
        window.location.href = authUrl;
      }
    } catch (err) {
      try { if (popup) popup.close(); } catch (_) { /* ignore */ }
      popupRef.current = null;
      setConnectingModal({ platform, status: 'error', errorText: err.message });
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

      {connectingModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 20,
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 16,
              maxWidth: 440,
              width: '100%',
              padding: 28,
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 12,
                background: PLATFORM_META[connectingModal.platform]?.iconBg || '#f3f4f6',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 28,
                marginBottom: 16,
              }}
            >
              {PLATFORM_META[connectingModal.platform]?.icon || '🔗'}
            </div>

            <h3 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px 0', color: '#111827' }}>
              {connectingModal.status === 'error'
                ? 'Connection Incomplete'
                : `Connecting to ${PLATFORM_META[connectingModal.platform]?.label || connectingModal.platform}`}
            </h3>

            {(connectingModal.status === 'opening' || connectingModal.status === 'waiting') && (
              <>
                <p style={{ fontSize: 14, color: '#4b5563', margin: '0 0 12px 0', lineHeight: 1.5 }}>
                  Finish signing in using the window that just opened. This page updates by itself
                  as soon as the connection is made.
                </p>
                <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 20px 0', lineHeight: 1.5 }}>
                  If the sign-in window shows an error or you change your mind, just close it and
                  press the button below. You will not lose your place here.
                </p>

                <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 16 }}>
                  <button
                    onClick={cancelConnect}
                    style={{
                      padding: '8px 18px',
                      borderRadius: 8,
                      border: '1px solid #d1d5db',
                      background: '#fff',
                      color: '#374151',
                      fontSize: 14,
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel and go back
                  </button>
                </div>
              </>
            )}

            {connectingModal.status === 'error' && (
              <>
                <div
                  style={{
                    padding: 12,
                    background: '#fef2f2',
                    borderRadius: 8,
                    color: '#991b1b',
                    fontSize: 13,
                    margin: '12px 0 20px 0',
                    textAlign: 'left',
                    lineHeight: 1.5,
                  }}
                >
                  {connectingModal.errorText || 'The authorization process was not completed.'}
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
                  <button
                    onClick={() => {
                      setConnectingModal(null);
                      setBusy(null);
                    }}
                    style={{
                      padding: '9px 18px',
                      borderRadius: 8,
                      border: '1px solid #d1d5db',
                      background: '#fff',
                      color: '#374151',
                      fontSize: 14,
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    Return to Portal
                  </button>
                  <button
                    onClick={() => handleConnect(connectingModal.platform)}
                    style={{
                      padding: '9px 18px',
                      borderRadius: 8,
                      border: 'none',
                      background: '#0a0a0a',
                      color: '#fff',
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Try Again
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
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
