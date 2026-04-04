import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://aglikzyarmqbdmjvkvyj.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnbGlrenlhcm1xYmRtanZrdnlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3MjMwNDcsImV4cCI6MjA4NzI5OTA0N30.vYAk33Z_x5lWkKc6zUhTxhHiWo2cZgk3dYmO7c0I6GM";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default function CreatorConnections({ currentUser }) {
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState({
    tiktok: null,
    meta: null
  });
  const [message, setMessage] = useState({ type: '', text: '' });
  const [disconnecting, setDisconnecting] = useState(null);

  // 1. Check URL parameters on mount for OAuth redirect alerts
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('success')) {
      setMessage({ type: 'success', text: `Successfully connected ${params.get('success').split('_')[0]}!` });
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    if (params.get('error')) {
      setMessage({ type: 'error', text: `Connection failed: ${params.get('error')}` });
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // 2. Load existing connections from Supabase
  useEffect(() => {
    async function loadConnections() {
      if (!currentUser || !currentUser.user_id) return;
      try {
        setLoading(true);
        // We look up the creator table first to get the creator UUID
        const { data: creator } = await supabase.from('creators').select('id').eq('user_id', currentUser.user_id).single();
        if (!creator) return;

        const { data, error } = await supabase
          .from('creator_tokens')
          .select('platform, updated_at, expires_at')
          .eq('creator_id', creator.id);

        if (error) throw error;
        
        const mapped = { tiktok: null, meta: null };
        data?.forEach(token => {
          mapped[token.platform] = token;
        });
        setConnections(mapped);
      } catch (err) {
        console.error('Error loading connections', err);
      } finally {
        setLoading(false);
      }
    }
    loadConnections();
  }, [currentUser]);

  // 3. Handlers
  const handleConnect = (platform) => {
    // Hard redirect to Vercel OAuth proxy
    window.location.href = `/api/auth/${platform}/start?userId=${currentUser.user_id}`;
  };

  const handleDisconnect = async (platform) => {
    if (!window.confirm(`Are you sure you want to disconnect ${platform}? We will stop syncing your analytics.`)) return;
    
    setDisconnecting(platform);
    setMessage({ type: '', text: '' });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      const res = await fetch(`/api/auth/${platform}/disconnect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ platform })
      });
      
      if (!res.ok) throw new Error('Failed to disconnect');
      
      setConnections(prev => ({ ...prev, [platform]: null }));
      setMessage({ type: 'success', text: `${platform} disconnected successfully.` });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setDisconnecting(null);
    }
  };

  if (loading) {
    return <div style={{ padding: 20 }}>Loading connections...</div>;
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '20px' }}>
      <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '8px' }}>Social Connections</h2>
      <p style={{ color: '#6b7280', marginBottom: '24px' }}>Connect your accounts to automatically sync analytics for your submissions.</p>
      
      {message.text && (
        <div style={{ 
          padding: '12px', 
          marginBottom: '20px', 
          borderRadius: '6px',
          backgroundColor: message.type === 'success' ? '#dcfce7' : '#fee2e2',
          color: message.type === 'success' ? '#166534' : '#991b1b'
        }}>
          {message.text}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <ConnectionCard 
          title="TikTok" 
          platform="tiktok"
          data={connections.tiktok}
          onConnect={() => handleConnect('tiktok')}
          onDisconnect={() => handleDisconnect('tiktok')}
          isDisconnecting={disconnecting === 'tiktok'}
        />

        <ConnectionCard 
          title="Instagram (via Meta)" 
          platform="meta"
          data={connections.meta}
          onConnect={() => handleConnect('meta')}
          onDisconnect={() => handleDisconnect('meta')}
          isDisconnecting={disconnecting === 'meta'}
        />

        <div style={{ opacity: 0.5 }}>
          <ConnectionCard title="YouTube" platform="youtube" data={null} disabled={true} />
        </div>
        <div style={{ opacity: 0.5 }}>
          <ConnectionCard title="Facebook" platform="facebook" data={null} disabled={true} />
        </div>
      </div>
    </div>
  );
}

function ConnectionCard({ title, platform, data, disabled, onConnect, onDisconnect, isDisconnecting }) {
  const isConnected = !!data;
  const isExpiringSoon = isConnected && data.expires_at && 
    (new Date(data.expires_at).getTime() - Date.now() < 3 * 24 * 60 * 60 * 1000);

  return (
    <div style={{ 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'space-between',
      padding: '20px',
      border: `1px solid ${isConnected ? '#10b981' : '#e5e7eb'}`,
      borderRadius: '8px',
      backgroundColor: '#fff'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div>
          <h3 style={{ fontSize: '18px', fontWeight: '600', margin: 0, textTransform: 'capitalize' }}>{title}</h3>
          {isConnected ? (
            <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>
              <span style={{ color: '#10b981', fontWeight: 500 }}>● Connected</span>
              <span style={{ margin: '0 8px' }}>|</span>
              Last synced: {new Date(data.updated_at).toLocaleDateString()}
              {isExpiringSoon && (
                <span style={{ color: '#d97706', marginLeft: '8px' }}>⚠️ Expires soon</span>
              )}
            </div>
          ) : (
             <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>
                 {disabled ? 'Coming soon' : 'Not connected'}
             </div>
          )}
        </div>
      </div>

      <div>
        {disabled ? (
           <button disabled style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #e5e7eb', background: '#f9fafb', color: '#9ca3af' }}>Coming Soon</button>
        ) : isConnected ? (
           <div style={{ display: 'flex', gap: '8px' }}>
             <button onClick={onConnect} style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer' }}>
               Reconnect
             </button>
             <button 
               onClick={onDisconnect} 
               disabled={isDisconnecting}
               style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: '#fee2e2', color: '#dc2626', cursor: isDisconnecting ? 'wait' : 'pointer' }}
             >
               {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
             </button>
           </div>
        ) : (
           <button onClick={onConnect} style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: '#000', color: '#fff', cursor: 'pointer', fontWeight: 500 }}>
             Connect Account
           </button>
        )}
      </div>
    </div>
  );
}
