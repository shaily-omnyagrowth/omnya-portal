import { useEffect, useRef, useState } from 'react';
import { gooeyToast as toast } from 'goey-toast';
import { supabase } from '../supabaseClient';
import Alert from '../ui/Alert';
import confirm from '../ui/confirm';
import Dialog from '../ui/Dialog';

// The main action gets a sendable link: enable and copy when off, copy when on. Safari refuses a
// clipboard write after an await, so a refused copy selects the link and asks for Cmd or Ctrl+C.
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
  useEffect(() => { if (copyHint && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [copyHint]);

  const callManageShare = async (action, extra = {}) => {
    setLoading(true); setError(''); setCopyHint('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('You must be signed in.');
      const res = await fetch('/api/campaigns/manage-share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ campaignId: campaign.id, action, ...extra }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok || !json.data) throw new Error(json.error?.message || "Couldn't update the share settings.");
      setShareToken(json.data.share_token);
      setShareEnabled(json.data.share_enabled);
      onUpdated?.(json.data);
      return json.data;
    } catch (err) {
      setError(err.message || 'That didn’t work.');
      return null;
    } finally {
      setLoading(false);
    }
  };

  const copyLink = async (url) => {
    setCopyHint('');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(url);
      setCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2500);
      toast.success('Link copied', { description: 'Anyone with it can view this report.' });
      return true;
    } catch {
      setCopied(false);
      setCopyHint(`Your browser blocked copying. The link is selected; press ${isMac ? 'Cmd' : 'Ctrl'}+C.`);
      return false;
    }
  };

  const enableAndCopy = async () => {
    const data = await callManageShare('toggle', { enabled: true });
    if (data?.share_enabled && data.share_token) await copyLink(urlFor(data.share_token));
  };

  const toggle = async () => {
    setCopied(false);
    const data = await callManageShare('toggle', { enabled: !shareEnabled });
    if (data) toast(data.share_enabled ? 'Link turned on' : 'Link turned off', { description: data.share_enabled ? undefined : 'The old link stops working right away.' });
  };

  const regenerate = async () => {
    const ok = await confirm({ title: 'Make a new link?', body: 'The current link stops working immediately. Anyone who has it will need the new one.', confirmLabel: 'Make new link', tone: 'danger' });
    if (!ok) return;
    setCopied(false);
    if (await callManageShare('regenerate')) toast.success('New link created');
  };

  return (
    <Dialog title="Share campaign results" description={`A read-only report for ${campaign.name}. Budgets, margins and creator pay are never shown.`} onClose={onClose}
      actions={<button className="btn btn-secondary" onClick={onClose}>Done</button>}>
      {error && <Alert tone="error" style={{ marginBottom: 16 }}>{error}</Alert>}
      <div className="flex-between mb-8">
        <span className="form-label">Report link</span>
        <span className={`badge ${shareEnabled ? 'badge-green' : 'badge-gray'}`}><span className="dot" />{shareEnabled ? 'On' : 'Off'}</span>
      </div>
      <div className="flex gap-8">
        <input ref={inputRef} className="form-input" readOnly aria-label="Report link"
          value={shareEnabled ? shareUrl : 'Turn the link on to get a URL'}
          onFocus={e => shareEnabled && e.target.select()} style={{ flex: 1, color: shareEnabled ? 'var(--ink)' : 'var(--ink3)' }} />
        {shareEnabled
          ? <button className="btn btn-primary" disabled={loading} onClick={() => copyLink(shareUrl)}>{copied ? 'Copied' : 'Copy'}</button>
          : <button className="btn btn-primary" disabled={loading} onClick={enableAndCopy}>{loading ? 'Turning on…' : 'Turn on and copy'}</button>}
      </div>
      {copyHint && <p className="form-hint mt-8" style={{ color: 'var(--amber)' }}>{copyHint}</p>}

      <div className="list-stack mt-16">
        <div className="list-item">
          <div><div className="fw-600 fs-13">Link access</div><div className="fs-12 text-muted">Anyone with the link can view the report.</div></div>
          <button className={`btn btn-sm ${shareEnabled ? 'btn-red' : 'btn-secondary'}`} disabled={loading} onClick={toggle}>{shareEnabled ? 'Turn off' : 'Turn on'}</button>
        </div>
        <div className="list-item">
          <div><div className="fw-600 fs-13">New link</div><div className="fs-12 text-muted">Replace the link if it was shared with the wrong person.</div></div>
          <button className="btn btn-ghost btn-sm" disabled={loading} onClick={regenerate}>Make new link</button>
        </div>
      </div>
      <p className="fs-12 text-muted mt-12">Reports show deliverables, verified views and top posts only.</p>
    </Dialog>
  );
}
