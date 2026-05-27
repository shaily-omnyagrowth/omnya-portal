import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import LoadingSpinner from './components/LoadingSpinner';

// Connection statuses surfaced by /api/social/connections.
// 'disconnected' is the default for platforms with no row yet.
const PLATFORM_META = {
  tiktok:    { label: 'TikTok',    icon: '📱', subtitle: 'Videos & Analytics' },
  instagram: { label: 'Instagram', icon: '📸', subtitle: 'Analytics & Insights' },
  facebook:  { label: 'Facebook',  icon: '👤', subtitle: 'Pages & Feed' },
  youtube:   { label: 'YouTube',   icon: '🎥', subtitle: 'Channel & Videos' },
};

const VISIBLE_PLATFORMS = ['tiktok', 'instagram', 'facebook', 'youtube'];

// Treat a connection as expired if expires_at < now or status === 'expired'.
function isExpired(conn) {
  if (!conn) return false;
  if (conn.status === 'expired') return true;
  if (!conn.expiresAt) return false;
  return new Date(conn.expiresAt).getTime() < Date.now();
}

function isActive(conn) {
  return conn && conn.status === 'connected' && !isExpired(conn);
}

function statusFor(conn) {
  if (!conn || conn.status === 'disconnected') return 'disconnected';
  if (conn.status === 'error') return 'error';
  if (isExpired(conn)) return 'expired';
  if (conn.status === 'connected') return 'connected';
  return conn.status;
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
  const [busy, setBusy] = useState(null); // { platform, action: 'connect'|'disconnect' }

  // Surface OAuth callback success/error from URL on mount.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let changed = false;
    const connected = params.get('connected');
    const error = params.get('error');
    if (connected) {
      setMessage({ type: 'success', text: `Connected ${connected} successfully.` });
      params.delete('connected');
      changed = true;
    }
    if (error) {
      setMessage({ type: 'error', text: `Connection failed: ${error.replace(/_/g, ' ')}.` });
      params.delete('error');
      changed = true;
    }
    if (changed) {
      const url = new URL(window.location);
      url.search = params.toString();
      window.history.replaceState({}, document.title, url);
    }
  }, []);

  const loadConnections = useCallback(async () => {
    if (!currentUser || !currentUser.id) return;
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not signed in');

      const res = await fetch('/api/social/connections', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
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
  }, [currentUser]);

  useEffect(() => { loadConnections(); }, [loadConnections]);

  const handleConnect = async (platform) => {
    setBusy({ platform, action: 'connect' });
    setMessage({ type: '', text: '' });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not signed in');

      const res = await fetch(`/api/auth/${platform}/start`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok || !(json.data && json.data.authorizationUrl)) {
        throw new Error((json.error && json.error.message) || `Failed to start ${platform} OAuth`);
      }
      // Hand off to the OAuth provider. The callback will redirect back with
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
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not signed in');

      const res = await fetch('/api/auth/disconnect', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ platform }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok) {
        throw new Error((json.error && json.error.message) || 'Failed to disconnect');
      }

      setConnections((prev) => ({
        ...prev,
        [platform]: { ...prev[platform], status: 'disconnected', expiresAt: null, lastSyncedAt: prev[platform]?.lastSyncedAt },
      }));
      setMessage({ type: 'success', text: `${meta.label} disconnected.` });
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
          />
        ))}
      </div>
    </div>
  );
}

function ConnectionCard({ platform, connection, busy, onConnect, onDisconnect }) {
  const meta = PLATFORM_META[platform] || { label: platform, icon: '🔗' };
  const status = statusFor(connection);
  const active = isActive(connection);

  const borderColor =
    status === 'connected' ? '#10b981' :
    status === 'expired'   ? '#f59e0b' :
    status === 'error'     ? '#ef4444' :
    '#e5e7eb';

  const statusBadge = (() => {
    switch (status) {
      case 'connected':    return { color: '#10b981', text: '● Connected' };
      case 'expired':      return { color: '#b45309', text: '● Token expired' };
      case 'error':        return { color: '#b91c1c', text: '● Connection error' };
      default:             return { color: '#6b7280', text: 'Not connected' };
    }
  })();

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '20px',
        border: `1px solid ${borderColor}`,
        borderRadius: '12px',
        backgroundColor: '#fff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        gap: 16,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', minWidth: 0 }}>
        <div
          style={{
            width: 40, height: 40, borderRadius: 8, background: '#f3f4f6',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
            flexShrink: 0,
          }}
          aria-hidden="true"
        >
          {meta.icon}
        </div>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>{meta.label}</h3>
          <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>
            <span style={{ color: statusBadge.color, fontWeight: 500 }}>{statusBadge.text}</span>
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
          {connection && connection.lastError && (
            <div style={{ fontSize: '12px', color: '#b91c1c', marginTop: 4 }}>
              {connection.lastError}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        {active ? (
          <button
            onClick={onDisconnect}
            disabled={busy === 'disconnect'}
            style={{
              padding: '8px 16px', borderRadius: '6px', border: 'none',
              background: '#fee2e2', color: '#dc2626',
              cursor: busy === 'disconnect' ? 'wait' : 'pointer', fontSize: '14px',
            }}
          >
            {busy === 'disconnect' ? '…' : 'Disconnect'}
          </button>
        ) : status === 'expired' || status === 'error' ? (
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
        ) : (
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
  );
}
