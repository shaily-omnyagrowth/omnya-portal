import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';

// The one thing people come here to do is get a link they can send. So the
// button in the status card is that action: with the link off it enables the
// link and copies it; with the link on it copies. "Disable" and "Reset Token"
// stay below for the rarer cases.
//
// Copying happens after an awaited fetch. Chrome allows a clipboard write
// there; Safari does not (it wants the write inside the click itself), and a
// browser may refuse for other reasons. A refused write never claims success:
// the link is selected in the box and the user is told to press Ctrl+C.
export default function CampaignShareModal({ campaign, onClose, onUpdated }) {
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyHint, setCopyHint] = useState('');
  const [error, setError] = useState('');
  const [shareToken, setShareToken] = useState(campaign.share_token || '');
  const [shareEnabled, setShareEnabled] = useState(campaign.share_enabled || false);
  const inputRef = useRef(null);
  const copiedTimer = useRef(null);

  const urlFor = (token) => `${window.location.origin}/share/campaign?token=${token}`;
  const shareUrl = urlFor(shareToken);
  const isMac = /Mac|iP(hone|ad)/.test(navigator.userAgent);

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  // Runs after the render that put the URL in the box, so what gets selected
  // is the link and not the "currently disabled" placeholder.
  useEffect(() => {
    if (copyHint && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [copyHint]);

  // Resolves to the new share state, or null when the request failed (the
  // error banner is already showing).
  const callManageShare = async (action, extra = {}) => {
    setLoading(true);
    setError('');
    setCopyHint('');
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
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error?.message || 'Failed to update share settings.');
      }

      setShareToken(json.data.share_token);
      setShareEnabled(json.data.share_enabled);
      if (onUpdated) onUpdated(json.data);
      return json.data;
    } catch (err) {
      setError(err.message || 'Action failed.');
      return null;
    } finally {
      setLoading(false);
    }
  };

  const copyLink = async (url) => {
    setCopyHint('');
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        throw new Error('Clipboard API unavailable');
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2500);
      return true;
    } catch {
      setCopied(false);
      setCopyHint(`The browser blocked copying. The link is selected below; press ${isMac ? 'Cmd' : 'Ctrl'}+C.`);
      return false;
    }
  };

  const enableAndCopy = async () => {
    const data = await callManageShare('toggle', { enabled: true });
    if (data && data.share_enabled && data.share_token) {
      await copyLink(urlFor(data.share_token));
    }
  };

  const setLinkEnabled = async (enabled) => {
    setCopied(false);
    await callManageShare('toggle', { enabled });
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

          {/* URL box with the one action that matters for its state */}
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              ref={inputRef}
              type="text"
              readOnly
              value={shareEnabled ? shareUrl : 'Link is off. Enable it to get a URL.'}
              onFocus={e => { if (shareEnabled) e.target.select(); }}
              onClick={e => { if (shareEnabled) e.target.select(); }}
              aria-label="Share link"
              style={{
                flex: 1,
                fontSize: 12,
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: shareEnabled ? '#fff' : 'var(--bg2)',
                color: shareEnabled ? 'var(--ink)' : 'var(--ink3)',
                cursor: shareEnabled ? 'text' : 'default'
              }}
            />
            {shareEnabled ? (
              <button
                className="btn btn-primary btn-sm"
                disabled={loading}
                onClick={() => copyLink(shareUrl)}
                style={{ padding: '0 14px', whiteSpace: 'nowrap' }}
              >
                {copied ? '✓ Copied!' : '📋 Copy'}
              </button>
            ) : (
              <button
                className="btn btn-green btn-sm"
                disabled={loading}
                onClick={enableAndCopy}
                style={{ padding: '0 14px', whiteSpace: 'nowrap' }}
              >
                {loading ? 'Enabling…' : '🔗 Enable & Copy Link'}
              </button>
            )}
          </div>
          {copyHint && (
            <div style={{ fontSize: 11, color: 'var(--orange)', marginTop: 8 }}>{copyHint}</div>
          )}
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
              onClick={() => setLinkEnabled(!shareEnabled)}
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
                  setCopied(false);
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
