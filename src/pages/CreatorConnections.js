import { useCallback, useEffect, useRef, useState } from 'react';
import { gooeyToast as toast } from 'goey-toast';
import { supabase } from '../supabaseClient';
import ConnectDialog from './connections/ConnectDialog';
import ConnectionCard from './connections/ConnectionCard';
import {
  describeOAuthError, deriveConnectionState, flowFor, OAUTH_CHANNEL, OAUTH_STORAGE_KEY,
  PLATFORM_META, platformFromError, VISIBLE_PLATFORMS,
} from './connections/state';
import confirm from '../ui/confirm';
import PageHeader from '../ui/PageHeader';
import { Skeleton } from '../ui/Skeleton';

// F-13: one page, one card, one API family (/api/social/connections and /api/auth/{platform}/*).
export default function CreatorConnections({ currentUser }) {
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState({});
  const [busy, setBusy] = useState(null);
  const [connectingModal, setConnectingModal] = useState(null);

  // Full-page fallback flow: /oauth-complete returns here with the result in the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const error = params.get('error');
    const retry = params.get('retry');
    const platform = params.get('platform');
    if (!connected && !error && !retry) return;

    if (connected) {
      toast.success(`${PLATFORM_META[connected]?.label || 'Your account'} is connected`, { description: 'Views from this account are now verified automatically.' });
    } else {
      const target = PLATFORM_META[retry] ? retry : PLATFORM_META[platform] ? platform : platformFromError(error);
      if (target) {
        setConnectingModal({ platform: target, status: 'error', errorText: error ? describeOAuthError(error) : `Press Try again to reconnect ${PLATFORM_META[target].label}.` });
      } else {
        toast.error('Connection failed', { description: describeOAuthError(error) });
      }
    }
    ['connected', 'error', 'retry', 'platform'].forEach((k) => params.delete(k));
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
    if (!currentUser?.id) return;
    try {
      const res = await fetch('/api/social/connections', { headers: await authHeader() });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error?.message || "Couldn't load your connections");
      const byPlatform = {};
      for (const conn of json.data.connections || []) byPlatform[conn.platform] = conn;
      setConnections(byPlatform);
    } catch (err) {
      toast.error("Couldn't load your connections", { description: err.message });
    } finally {
      setLoading(false);
    }
  }, [currentUser, authHeader]);

  useEffect(() => { loadConnections(); }, [loadConnections]);

  // The provider opens in a popup. Production's COOP severs window.opener and makes popup.closed
  // unreliable, so the result arrives on a BroadcastChannel from /oauth-complete.js, then a
  // localStorage event, with polling /api/social/connections as the backstop.
  const connectStartedAt = useRef(0);
  const popupRef = useRef(null);
  const handledResult = useRef(null);

  const finishConnect = useCallback((result) => {
    if (!result || result.type !== 'oauth_result') return;
    if (result.at && connectStartedAt.current && result.at < connectStartedAt.current - 1000) return;
    // The channel, storage and polling can all report the same attempt; handle it once.
    const key = `${result.platform}:${result.status}:${connectStartedAt.current || result.at}`;
    if (handledResult.current === key) return;
    handledResult.current = key;
    try { window.localStorage.removeItem(OAUTH_STORAGE_KEY); } catch (_) { /* private mode */ }
    popupRef.current = null;
    setBusy(null);
    if (result.status === 'success') {
      setConnectingModal(null);
      toast.success(`${PLATFORM_META[result.platform]?.label || 'Your account'} is connected`, { description: 'Views from this account are now verified automatically.' });
      loadConnections();
    } else {
      setConnectingModal((prev) => ({
        platform: (PLATFORM_META[result.platform] && result.platform) || prev?.platform || null,
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
          // The ack tells the popup a portal tab is alive, so it closes itself.
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

  const waitingPlatform = connectingModal?.status === 'waiting' ? connectingModal.platform : null;
  useEffect(() => {
    if (!waitingPlatform) return undefined;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch('/api/social/connections', { headers: await authHeader() });
        const json = await res.json().catch(() => ({}));
        if (cancelled || !res.ok || !json.ok) return;
        const row = (json.data.connections || []).find((c) => c.platform === waitingPlatform);
        const updated = row?.updatedAt ? new Date(row.updatedAt).getTime() : 0;
        if (row && row.connectionStatus === 'connected' && updated >= connectStartedAt.current - 5000) {
          finishConnect({ type: 'oauth_result', platform: waitingPlatform, status: 'success', at: Date.now() });
        }
      } catch (_) { /* next tick retries */ }
    };
    const id = setInterval(tick, 4000);
    return () => { cancelled = true; clearInterval(id); };
  }, [waitingPlatform, authHeader, finishConnect]);

  const cancelConnect = () => {
    try { if (popupRef.current) popupRef.current.close(); } catch (_) { /* severed by COOP */ }
    popupRef.current = null;
    setConnectingModal(null);
    setBusy(null);
  };

  const handleConnect = async (platform) => {
    setBusy({ platform, action: 'connect' });
    connectStartedAt.current = Date.now();
    try { window.localStorage.removeItem(OAUTH_STORAGE_KEY); } catch (_) { /* private mode */ }

    // Open the window inside the click; browsers block window.open after an await.
    const width = 600, height = 760;
    const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
    const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
    let popup = null;
    try {
      popup = window.open('', `omnya_oauth_${platform}`, `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,status=no`);
      if (popup && popup.document) {
        popup.document.title = 'Connecting...';
        popup.document.body.textContent = 'Opening the sign-in page...';
      }
    } catch (_) { popup = null; }
    popupRef.current = popup;

    setConnectingModal({ platform, status: 'opening' });
    try {
      const res = await fetch(`/api/auth/${flowFor(platform)}/start`, {
        method: 'POST',
        headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok || !json.data?.authorizationUrl) throw new Error(json.error?.message || `Couldn't start the ${PLATFORM_META[platform]?.label || platform} sign in`);
      const authUrl = json.data.authorizationUrl;
      if (popup && !popup.closed) {
        popup.location.href = authUrl;
        setConnectingModal({ platform, status: 'waiting' });
      } else {
        // Popup blocked: take this tab to the provider; /oauth-complete brings the creator back.
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
    const label = PLATFORM_META[platform]?.label || platform;
    const ok = await confirm({
      title: `Disconnect ${label}?`,
      body: `We'll stop syncing views from this account. Videos you've already submitted stay, but new views won't be verified until you reconnect.`,
      confirmLabel: 'Disconnect', tone: 'danger',
    });
    if (!ok) return;
    setBusy({ platform, action: 'disconnect' });
    try {
      const res = await fetch('/api/auth/disconnect', {
        method: 'POST',
        headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: flowFor(platform) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error?.message || "Couldn't disconnect");
      setConnections((prev) => ({ ...prev, [platform]: { ...prev[platform], status: 'disconnected', connectionStatus: 'disconnected', needsReauth: false, expiresAt: null, lastError: null } }));
      toast(`${label} disconnected`);
    } catch (err) {
      toast.error(`Couldn't disconnect ${label}`, { description: err.message });
    } finally {
      setBusy(null);
    }
  };

  const handleSync = async (platform) => {
    const meta = PLATFORM_META[platform];
    if (!meta?.sync) return;
    setBusy({ platform, action: 'sync' });
    const run = (async () => {
      const res = await fetch(meta.sync.endpoint, {
        method: 'POST',
        headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
        body: JSON.stringify(meta.sync.body(platform)),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error?.message || `${meta.label} sync failed`);
      await loadConnections();
      return json.data;
    })();
    toast.promise(run, {
      loading: `Syncing ${meta.label}…`,
      success: (d) => `${meta.label}: ${meta.sync.summarize(d)}`,
      error: (e) => e?.message || `${meta.label} sync failed`,
    });
    try { await run; } catch (_) { /* reported by the toast */ } finally { setBusy(null); }
  };

  const connectedCount = VISIBLE_PLATFORMS.filter(p => deriveConnectionState(connections[p]).connected).length;

  return (
    <div className="content">
      <PageHeader
        title="Social channels"
        description="Connect the accounts you post from. Connected accounts verify your views automatically, which is what bonuses are paid on."
      />
      <div className="conn-summary fs-13 text-muted mb-16">
        {loading ? <Skeleton w={160} h={14} /> : `${connectedCount} of ${VISIBLE_PLATFORMS.length} connected`}
      </div>
      <div className="conn-list">
        {loading
          ? VISIBLE_PLATFORMS.map(p => <div key={p} className="conn-card" aria-hidden="true"><div className="conn-head"><Skeleton w={40} h={40} r={10} /><div className="flex-1"><Skeleton w={120} h={16} /><Skeleton w={180} h={12} style={{ marginTop: 8 }} /></div><Skeleton w={84} h={32} r={6} /></div></div>)
          : VISIBLE_PLATFORMS.map((platform) => (
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
        <ConnectDialog
          modal={connectingModal}
          onCancel={cancelConnect}
          onClose={() => { setConnectingModal(null); setBusy(null); }}
          onRetry={() => handleConnect(connectingModal.platform)}
        />
      )}
    </div>
  );
}
