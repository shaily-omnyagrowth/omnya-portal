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
      if (!currentUser || !currentUser.id) return;
      try {
        setLoading(true);
        // We look up the creator table first to get the creator UUID
        const { data: creator } = await supabase.from('creators').select('id').eq('user_id', currentUser.id).single();
        if (!creator) return;

        const { data, error } = await supabase
          .from('creator_tokens')
          .select('platform, updated_at, expires_at, account_name')
          .eq('creator_id', creator.id);

        if (error) throw error;
        
        const mapped = { tiktok: null, instagram: null, facebook: null };
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
    const queryParams = `?userId=${currentUser.id}`;
    
    // Snappy, direct redirection to platform-specific branded login
    window.location.href = `/api/auth/${platform}/start${queryParams}`;
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
          title="Instagram" 
          platform="instagram"
          subtitle="Analytics & Insights"
          data={connections.instagram}
          onConnect={() => handleConnect('instagram')}
          onDisconnect={() => handleDisconnect('instagram')}
          isDisconnecting={disconnecting === 'instagram'}
        />

        <ConnectionCard 
          title="Facebook" 
          platform="facebook"
          subtitle="Pages & Feed"
          data={connections.facebook}
          onConnect={() => handleConnect('facebook')}
          onDisconnect={() => handleDisconnect('facebook')}
          isDisconnecting={disconnecting === 'facebook'}
        />

        <div style={{ opacity: 0.5 }}>
          <ConnectionCard title="YouTube" platform="youtube" data={null} disabled={true} />
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
      borderRadius: '12px',
      backgroundColor: '#fff',
      boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div style={{width:40, height:40, borderRadius:8, background:'#f3f4f6', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20}}>
            {platform === 'tiktok' && '📱'}
            {platform === 'instagram' && '📸'}
            {platform === 'facebook' && '👤'}
            {platform === 'youtube' && '🎥'}
        </div>
        <div>
          <h3 style={{ fontSize: '18px', fontWeight: '600', margin: 0 }}>{title}</h3>
          {isConnected ? (
            <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>
              <span style={{ color: '#10b981', fontWeight: 500 }}>● Connected</span>
              <span style={{ margin: '0 8px' }}>|</span>
              {data.account_name || 'Active'}
            </div>
          ) : (
             <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>
                 {disabled ? 'Coming soon' : 'Ready to sync'}
             </div>
          )}
        </div>
      </div>

      <div>
        {disabled ? (
           <button disabled style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #e5e7eb', background: '#f9fafb', color: '#9ca3af' }}>Coming Soon</button>
        ) : isConnected ? (
           <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
             <div style={{ padding: '8px 16px', borderRadius: '6px', background: '#ecfdf5', color: '#10b981', fontWeight: 600, fontSize: '14px', border: '1px solid #10b981' }}>
                Connected
             </div>
             <button 
               onClick={onDisconnect} 
               disabled={isDisconnecting}
               style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: '#fee2e2', color: '#dc2626', cursor: isDisconnecting ? 'wait' : 'pointer', fontSize: '14px' }}
             >
               {isDisconnecting ? '...' : 'Disconnect'}
             </button>
           </div>
        ) : (
           <button onClick={onConnect} style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: '#000', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '14px' }}>
             Connect Account
           </button>
        )}
      </div>
    </div>
  );
}
