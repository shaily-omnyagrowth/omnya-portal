import React, { useState } from 'react';
import { supabase } from '../supabaseClient';

export default function CampaignShareModal({ campaign, onClose, onUpdated }) {
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [shareToken, setShareToken] = useState(campaign.share_token || '');
  const [shareEnabled, setShareEnabled] = useState(campaign.share_enabled || false);

  const shareUrl = `${window.location.origin}/share/campaign?token=${shareToken}`;

  const callManageShare = async (action, extra = {}) => {
    setLoading(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('You must be signed in.');

      const res = await fetch('/api/campaigns/manage-share', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          campaignId: campaign.id,
          action,
          ...extra
        })
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(json.error?.message || 'Failed to update share settings.');
      }

      setShareToken(json.data.share_token);
      setShareEnabled(json.data.share_enabled);
      if (onUpdated) onUpdated(json.data);
    } catch (err) {
      setError(err.message || 'Action failed.');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 540 }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex-between mb-16">
          <div>
            <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>🔗</span>
              <span>Share Campaign Analytics</span>
            </div>
            <div className="modal-sub">
              Create a secure, client-ready report link for <strong>{campaign.name}</strong>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {error && (
          <div style={{
            background: 'rgba(220, 53, 69, 0.1)',
            color: 'var(--red)',
            padding: '10px 14px',
            borderRadius: 6,
            fontSize: 13,
            marginBottom: 16
          }}>
            {error}
          </div>
        )}

        {/* Share Link Status Card */}
        <div style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 16,
          marginBottom: 20
        }}>
          <div className="flex-between mb-12">
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
              Public Link Status:
            </span>
            <span className={`badge ${shareEnabled ? 'badge-green' : 'badge-gray'}`}>
              {shareEnabled ? 'Active & Shared' : 'Disabled / Private'}
            </span>
          </div>

          {/* URL Input with Copy Button */}
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              readOnly
              value={shareEnabled ? shareUrl : 'Link is currently disabled'}
              style={{
                flex: 1,
                fontSize: 12,
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: shareEnabled ? '#fff' : 'var(--bg2)',
                color: shareEnabled ? 'var(--ink)' : 'var(--ink3)'
              }}
            />
            <button
              className="btn btn-primary btn-sm"
              disabled={!shareEnabled || loading}
              onClick={copyToClipboard}
              style={{ padding: '0 14px', whiteSpace: 'nowrap' }}
            >
              {copied ? '✓ Copied!' : '📋 Copy'}
            </button>
          </div>
        </div>

        {/* Controls: Enable/Disable & Regenerate */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
          <div className="flex-between" style={{ padding: '10px 0', borderBottom: '1px solid var(--border2)' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Link Access</div>
              <div style={{ fontSize: 11, color: 'var(--ink3)' }}>
                Allow anyone with this unique token to view campaign reporting.
              </div>
            </div>
            <button
              className={`btn btn-sm ${shareEnabled ? 'btn-red' : 'btn-green'}`}
              disabled={loading}
              onClick={() => callManageShare('toggle')}
            >
              {shareEnabled ? 'Disable Link' : 'Enable Link'}
            </button>
          </div>

          <div className="flex-between" style={{ padding: '10px 0' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Revoke & Regenerate Token</div>
              <div style={{ fontSize: 11, color: 'var(--ink3)' }}>
                Invalidate previous link and create a new secure address.
              </div>
            </div>
            <button
              className="btn btn-ghost btn-sm"
              disabled={loading}
              onClick={() => {
                if (window.confirm('Are you sure you want to regenerate this link? The old link will stop working immediately.')) {
                  callManageShare('regenerate');
                }
              }}
              style={{ color: 'var(--orange)' }}
            >
              🔄 Reset Token
            </button>
          </div>
        </div>

        {/* Privacy Notice */}
        <div style={{
          background: 'var(--bg2)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '12px 14px',
          fontSize: 11,
          color: 'var(--ink2)',
          display: 'flex',
          gap: 8,
          alignItems: 'flex-start'
        }}>
          <span style={{ fontSize: 14 }}>🛡️</span>
          <div>
            <strong>Agency Privacy Protected:</strong> Shared reports strictly expose deliverables, verified views, and top posts. Internal agency budgets, margins, creator payout rates, and other client data are 100% hidden.
          </div>
        </div>

        {/* Modal Actions */}
        <div className="modal-actions" style={{ marginTop: 20 }}>
          <button className="btn btn-secondary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
