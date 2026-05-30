/* eslint-disable */
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { fmtMoney, fmtDate, fmtNum, getInitials, getAvatarColor } from '../utils';
import LoadingSpinner from './LoadingSpinner';

// ─── tiny helpers ────────────────────────────────────────────────────────────

function Msg({ message }) {
  if (!message.text) return null;
  const isOk = message.type === 'success';
  return (
    <div style={{
      padding: '12px 16px',
      borderRadius: 'var(--radius)',
      marginBottom: 16,
      fontSize: 13,
      background: isOk ? 'rgba(26,122,74,0.08)' : 'rgba(192,57,43,0.08)',
      border: `1px solid ${isOk ? 'rgba(26,122,74,0.2)' : 'rgba(192,57,43,0.2)'}`,
      color: isOk ? 'var(--green)' : 'var(--red)',
    }}>
      {isOk ? '✓ ' : '⚠ '}{message.text}
    </div>
  );
}

function SectionHeader({ title, open, onToggle, badge }) {
  return (
    <button
      onClick={onToggle}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
        padding: '14px 18px', cursor: 'pointer', marginBottom: open ? 0 : 0,
        borderBottomLeftRadius: open ? 0 : 'var(--radius)',
        borderBottomRightRadius: open ? 0 : 'var(--radius)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{title}</span>
        {badge != null && (
          <span style={{
            background: 'var(--gold)', color: '#fff', borderRadius: 99,
            fontSize: 11, fontWeight: 700, padding: '2px 8px', minWidth: 20, textAlign: 'center',
          }}>{badge}</span>
        )}
      </div>
      <span style={{ fontSize: 12, color: 'var(--ink3)', transform: open ? 'rotate(180deg)' : 'none', transition: '0.2s' }}>▼</span>
    </button>
  );
}

function SectionBody({ open, children }) {
  if (!open) return null;
  return (
    <div style={{
      border: '1px solid var(--border)', borderTop: 'none',
      borderBottomLeftRadius: 'var(--radius)', borderBottomRightRadius: 'var(--radius)',
      padding: '20px 18px', background: 'var(--bg)',
    }}>
      {children}
    </div>
  );
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="card" style={{ flex: '1 1 160px', minWidth: 140 }}>
      <div style={{ fontSize: 11, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: accent || 'var(--ink)', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function BatchStatusBadge({ status }) {
  const map = {
    draft:    { bg: 'rgba(152,108,0,0.1)',   color: 'var(--gold)',   label: 'Draft' },
    approved: { bg: 'rgba(37,99,235,0.1)',   color: '#2563eb',       label: 'Approved' },
    exported: { bg: 'rgba(124,58,237,0.1)',  color: '#7c3aed',       label: 'Exported' },
    paid:     { bg: 'rgba(26,122,74,0.1)',   color: 'var(--green)',  label: 'Paid' },
    cancelled:{ bg: 'rgba(192,57,43,0.1)',   color: 'var(--red)',    label: 'Cancelled' },
  };
  const s = map[status] || { bg: 'var(--bg2)', color: 'var(--ink3)', label: status || '—' };
  return (
    <span style={{
      background: s.bg, color: s.color, borderRadius: 99,
      fontSize: 11, fontWeight: 700, padding: '3px 10px',
    }}>{s.label}</span>
  );
}

function WithdrawalStatusBadge({ status }) {
  const map = {
    pending_admin_approval: { bg: 'rgba(152,108,0,0.1)',  color: 'var(--gold)',  label: 'Pending' },
    approved:               { bg: 'rgba(37,99,235,0.1)',  color: '#2563eb',      label: 'Approved' },
    rejected:               { bg: 'rgba(192,57,43,0.1)', color: 'var(--red)',   label: 'Rejected' },
    batched:                { bg: 'rgba(124,58,237,0.1)', color: '#7c3aed',     label: 'Batched' },
    paid:                   { bg: 'rgba(26,122,74,0.1)',  color: 'var(--green)', label: 'Paid' },
  };
  const s = map[status] || { bg: 'var(--bg2)', color: 'var(--ink3)', label: status || '—' };
  return (
    <span style={{
      background: s.bg, color: s.color, borderRadius: 99,
      fontSize: 11, fontWeight: 700, padding: '3px 10px',
    }}>{s.label}</span>
  );
}

function EarningStatusBadge({ status }) {
  const map = {
    needs_review: { bg: 'rgba(192,57,43,0.1)',  color: 'var(--red)',   label: 'Needs Review' },
    eligible:     { bg: 'rgba(152,108,0,0.1)',  color: 'var(--gold)',  label: 'Eligible' },
    approved:     { bg: 'rgba(26,122,74,0.1)',  color: 'var(--green)', label: 'Approved' },
    forfeited:    { bg: 'rgba(100,100,100,0.1)',color: 'var(--ink3)',  label: 'Forfeited' },
  };
  const s = map[status] || { bg: 'var(--bg2)', color: 'var(--ink3)', label: status || '—' };
  return (
    <span style={{
      background: s.bg, color: s.color, borderRadius: 99,
      fontSize: 11, fontWeight: 700, padding: '3px 10px',
    }}>{s.label}</span>
  );
}

// ─── confirmation modal ──────────────────────────────────────────────────────

function ConfirmModal({ title, body, confirmLabel, danger, onConfirm, onClose, working }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        {body && <div style={{ fontSize: 14, color: 'var(--ink2)', marginBottom: 20, lineHeight: 1.5 }}>{body}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={working}>Cancel</button>
          <button
            className="btn btn-primary"
            style={danger ? { background: 'var(--red)', borderColor: 'var(--red)' } : {}}
            onClick={onConfirm}
            disabled={working}
          >
            {working ? 'Processing…' : (confirmLabel || 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── forfeit reason modal ─────────────────────────────────────────────────────

function ForfeitModal({ earning, onConfirm, onClose, working }) {
  const [reason, setReason] = useState('');
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <div className="modal-title">Forfeit Bonus</div>
        <div style={{ fontSize: 13, color: 'var(--ink3)', marginBottom: 14 }}>
          Creator: <strong>{earning.creator_name || earning.creator_id}</strong>
        </div>
        <div className="form-group">
          <label className="form-label">Reason for forfeiture</label>
          <textarea
            className="form-input"
            rows={3}
            placeholder="e.g. Views could not be verified after 14 days…"
            value={reason}
            onChange={e => setReason(e.target.value)}
            style={{ resize: 'vertical' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={working}>Cancel</button>
          <button
            className="btn btn-primary"
            style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
            onClick={() => onConfirm(reason)}
            disabled={working || !reason.trim()}
          >
            {working ? 'Saving…' : 'Forfeit Bonus'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── reject withdrawal modal ──────────────────────────────────────────────────

function RejectModal({ withdrawal, onConfirm, onClose, working }) {
  const [reason, setReason] = useState('');
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <div className="modal-title">Reject Withdrawal</div>
        <div style={{ fontSize: 13, color: 'var(--ink3)', marginBottom: 14 }}>
          Amount: <strong>{fmtMoney(withdrawal.amount)}</strong> — {withdrawal.creator_name || withdrawal.creator_id}
        </div>
        <div className="form-group">
          <label className="form-label">Rejection reason</label>
          <textarea
            className="form-input"
            rows={3}
            placeholder="e.g. Minimum payout threshold not reached…"
            value={reason}
            onChange={e => setReason(e.target.value)}
            style={{ resize: 'vertical' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={working}>Cancel</button>
          <button
            className="btn btn-primary"
            style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
            onClick={() => onConfirm(reason)}
            disabled={working || !reason.trim()}
          >
            {working ? 'Rejecting…' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── mark-paid confirmation modal ─────────────────────────────────────────────

function MarkPaidModal({ batch, onConfirm, onClose, working }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <div className="modal-title">Mark Batch as Paid</div>
        <div style={{ fontSize: 14, color: 'var(--ink2)', marginBottom: 20, lineHeight: 1.6 }}>
          <strong>WARNING:</strong> This will permanently mark all withdrawal requests in{' '}
          <strong>Batch #{(batch.batch_number || batch.id?.substring(0, 8) || '—')}</strong> as <strong>PAID</strong>{' '}
          and dispatch email confirmations to creators.
          <br /><br />
          Total payout: <strong style={{ color: 'var(--green)', fontSize: 16 }}>{fmtMoney(batch.total_amount)}</strong>
          {' '}across <strong>{batch.total_creators || 0}</strong> creator(s).
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={working}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={working}
          >
            {working ? 'Processing…' : 'Confirm Mark as Paid'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── create-batch confirmation ────────────────────────────────────────────────

function CreateBatchModal({ selectedIds, totalAmount, onConfirm, onClose, working }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
        <div className="modal-title">Create Payout Batch</div>
        <div style={{ fontSize: 14, color: 'var(--ink2)', marginBottom: 20, lineHeight: 1.6 }}>
          Bundle <strong>{selectedIds.length}</strong> approved withdrawal request(s) into a new payout batch?
          <br />
          Total: <strong style={{ color: 'var(--green)', fontSize: 16 }}>{fmtMoney(totalAmount)}</strong>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={working}>Cancel</button>
          <button className="btn btn-primary" onClick={onConfirm} disabled={working}>
            {working ? 'Creating…' : 'Create Batch'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── section 1 — dashboard overview ──────────────────────────────────────────

function OverviewSection({ userRole }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [confirmRecalc, setConfirmRecalc] = useState(false);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      const [
        { data: approvedUnpaid },
        { data: pendingBonus },
        { data: pendingWithdrawals },
        { data: paidThisMonth },
        { data: missingPayment },
      ] = await Promise.all([
        supabase
          .from('creator_earnings')
          .select('amount')
          .eq('status', 'approved'),
        supabase
          .from('creator_earnings')
          .select('id', { count: 'exact', head: true })
          .in('status', ['needs_review', 'eligible']),
        supabase
          .from('withdrawal_requests')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending_admin_approval'),
        supabase
          .from('payments')
          .select('amount')
          .eq('status', 'paid')
          .gte('processed_at', monthStart),
        supabase
          .from('creators')
          .select('id', { count: 'exact', head: true })
          .or('payment_method_status.eq.missing,payment_method_status.is.null'),
      ]);

      const totalUnpaid = (approvedUnpaid || []).reduce((s, r) => s + Number(r.amount || 0), 0);
      const totalPaidMonth = (paidThisMonth || []).reduce((s, r) => s + Number(r.amount || 0), 0);

      setStats({
        totalUnpaid,
        pendingBonusCount: pendingBonus?.length ?? 0,
        pendingWithdrawalsCount: pendingWithdrawals?.length ?? 0,
        totalPaidMonth,
        missingPaymentCount: missingPayment?.length ?? 0,
      });
    } catch (err) {
      setMessage({ text: 'Failed to load overview stats: ' + err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  const handleRecalculate = async () => {
    setConfirmRecalc(false);
    setWorking(true);
    setMessage({ text: '', type: '' });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/earnings/recalculate', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token || ''}`,
          'Content-Type': 'application/json',
        },
      });
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        throw new Error('API server unavailable. Use "vercel dev" instead of "npm start" for local development.');
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Recalculation failed');
      setMessage({ text: data.message || 'Earnings recalculated successfully.', type: 'success' });
      loadStats();
    } catch (err) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setWorking(false);
    }
  };

  return (
    <div>
      <Msg message={message} />
      {loading ? (
        <LoadingSpinner label="Loading overview…" />
      ) : stats ? (
        <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
            <StatCard label="Total Approved Unpaid" value={fmtMoney(stats.totalUnpaid)} accent="var(--green)" />
            <StatCard label="Pending Bonus Review" value={fmtNum(stats.pendingBonusCount)} sub="needs_review / eligible" accent="var(--gold)" />
            <StatCard label="Pending Withdrawals" value={fmtNum(stats.pendingWithdrawalsCount)} sub="awaiting admin approval" />
            <StatCard label="Paid This Month" value={fmtMoney(stats.totalPaidMonth)} accent="var(--ink)" />
            <StatCard
              label="Missing Payment Method"
              value={fmtNum(stats.missingPaymentCount)}
              sub="creators"
              accent={stats.missingPaymentCount > 0 ? 'var(--red)' : undefined}
            />
          </div>
          {(userRole === 'owner') && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setConfirmRecalc(true)}
              disabled={working}
            >
              {working ? 'Recalculating…' : '↻ Recalculate Earnings'}
            </button>
          )}
        </div>
      ) : null}

      {confirmRecalc && (
        <ConfirmModal
          title="Recalculate All Earnings"
          body="This will reprocess all creator earnings from scratch based on current submission data and bonus rules. This may take a moment. Proceed?"
          confirmLabel="Recalculate"
          working={working}
          onConfirm={handleRecalculate}
          onClose={() => setConfirmRecalc(false)}
        />
      )}
    </div>
  );
}

// ─── section 2 — bonus review ─────────────────────────────────────────────────

function BonusReviewSection() {
  const [earnings, setEarnings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [forfeitTarget, setForfeitTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('creator_earnings')
        .select(`
          *,
          creators ( name, email )
        `)
        .in('status', ['needs_review', 'eligible'])
        .order('created_at', { ascending: false });

      if (error) throw error;
      const rows = (data || []).map(r => ({
        ...r,
        creator_name: r.creators?.name || '—',
        creator_email: r.creators?.email || '',
      }));
      setEarnings(rows);
    } catch (err) {
      setMessage({ text: 'Failed to load bonus review: ' + err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const approve = async (id) => {
    setWorking(true);
    setMessage({ text: '', type: '' });
    try {
      const { error } = await supabase
        .from('creator_earnings')
        .update({ status: 'approved' })
        .eq('id', id);
      if (error) throw error;
      setMessage({ text: 'Bonus approved.', type: 'success' });
      load();
    } catch (err) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setWorking(false);
    }
  };

  const forfeit = async (id, reason) => {
    setWorking(true);
    setMessage({ text: '', type: '' });
    try {
      const { error } = await supabase
        .from('creator_earnings')
        .update({ status: 'forfeited', bonus_forfeit_reason: reason })
        .eq('id', id);
      if (error) throw error;
      setMessage({ text: 'Bonus forfeited.', type: 'success' });
      setForfeitTarget(null);
      load();
    } catch (err) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setWorking(false);
    }
  };

  const daysSince = (dateStr) => {
    if (!dateStr) return '—';
    const diff = Date.now() - new Date(dateStr).getTime();
    return Math.floor(diff / 86400000) + 'd';
  };

  return (
    <div>
      <Msg message={message} />
      {loading ? (
        <LoadingSpinner label="Loading bonuses…" />
      ) : earnings.length === 0 ? (
        <div className="empty" style={{ padding: '32px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>No bonuses pending review</div>
          <div style={{ fontSize: 13, color: 'var(--ink3)' }}>All earnings have been processed.</div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="premium-table">
            <thead>
              <tr>
                <th>Creator</th>
                <th>Submission</th>
                <th>Views Submitted</th>
                <th>Views Verified</th>
                <th>Bonus</th>
                <th>Days Since Post</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {earnings.map(e => (
                <tr key={e.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: '50%', display: 'flex',
                        alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700,
                        background: `var(--${getAvatarColor(e.creator_name)})`, color: '#fff', flexShrink: 0,
                      }}>{getInitials(e.creator_name)}</div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{e.creator_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{e.creator_email}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--ink3)' }}>
                    {e.submission_id ? e.submission_id.substring(0, 8) : '—'}
                  </td>
                  <td>{fmtNum(e.views_submitted)}</td>
                  <td>{fmtNum(e.views_verified)}</td>
                  <td style={{ fontWeight: 700, color: 'var(--green)' }}>{fmtMoney(e.amount)}</td>
                  <td>{daysSince(e.post_date || e.created_at)}</td>
                  <td><EarningStatusBadge status={e.status} /></td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => approve(e.id)}
                        disabled={working}
                      >Approve</button>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--red)', borderColor: 'var(--red)' }}
                        onClick={() => setForfeitTarget(e)}
                        disabled={working}
                      >Forfeit</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {forfeitTarget && (
        <ForfeitModal
          earning={forfeitTarget}
          working={working}
          onConfirm={(reason) => forfeit(forfeitTarget.id, reason)}
          onClose={() => setForfeitTarget(null)}
        />
      )}
    </div>
  );
}

// ─── section 3 — withdrawal requests ─────────────────────────────────────────

const WITHDRAWAL_TABS = [
  { id: 'pending_admin_approval', label: 'Pending' },
  { id: 'approved',               label: 'Approved' },
  { id: 'rejected',               label: 'Rejected' },
  { id: 'batched',                label: 'Batched' },
  { id: 'paid',                   label: 'Paid' },
];

function WithdrawalsSection() {
  const [tab, setTab] = useState('pending_admin_approval');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [rejectTarget, setRejectTarget] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [showBatchConfirm, setShowBatchConfirm] = useState(false);

  const load = useCallback(async (status) => {
    setLoading(true);
    setSelectedIds([]);
    try {
      const { data, error } = await supabase
        .from('withdrawal_requests')
        .select(`*, creators ( name, email, payment_method )`)
        .eq('status', status)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setRows((data || []).map(r => ({
        ...r,
        creator_name: r.creators?.name || '—',
        creator_email: r.creators?.email || '',
      })));
    } catch (err) {
      setMessage({ text: 'Failed to load withdrawals: ' + err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(tab); }, [tab, load]);

  const approveWithdrawal = async (id) => {
    setWorking(true);
    setMessage({ text: '', type: '' });
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase.rpc('approve_withdrawal_request', {
        p_request_id: id,
        p_approved_by: user.id,
      });
      if (error) throw error;
      if (data?.success === false) throw new Error(data.message || 'Approval failed');
      setMessage({ text: 'Withdrawal approved.', type: 'success' });
      load(tab);
    } catch (err) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setWorking(false);
    }
  };

  const rejectWithdrawal = async (id, reason) => {
    setWorking(true);
    setMessage({ text: '', type: '' });
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase.rpc('reject_withdrawal_request', {
        p_request_id: id,
        p_rejected_by: user.id,
        p_reason: reason,
      });
      if (error) throw error;
      if (data?.success === false) throw new Error(data.message || 'Rejection failed');
      setMessage({ text: 'Withdrawal rejected.', type: 'success' });
      setRejectTarget(null);
      load(tab);
    } catch (err) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setWorking(false);
    }
  };

  const createBatch = async () => {
    setShowBatchConfirm(false);
    setWorking(true);
    setMessage({ text: '', type: '' });
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase.rpc('create_payout_batch', {
        p_withdrawal_request_ids: selectedIds,
        p_generated_by: user.id,
        p_notes: null,
      });
      if (error) throw error;
      if (data?.success === false) throw new Error(data.message || 'Batch creation failed');
      const batchNum = data?.batch_number || '';
      setMessage({
        text: `Batch${batchNum ? ' #' + batchNum : ''} created with ${selectedIds.length} request(s).`,
        type: 'success',
      });
      setSelectedIds([]);
      load(tab);
    } catch (err) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setWorking(false);
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };
  const toggleAll = () => {
    setSelectedIds(prev => prev.length === rows.length ? [] : rows.map(r => r.id));
  };

  const selectedTotal = rows
    .filter(r => selectedIds.includes(r.id))
    .reduce((s, r) => s + Number(r.amount || 0), 0);

  return (
    <div>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {WITHDRAWAL_TABS.map(t => (
          <button
            key={t.id}
            className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab(t.id)}
          >{t.label}</button>
        ))}
      </div>

      {/* Create Batch CTA */}
      {tab === 'approved' && selectedIds.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.2)',
          borderRadius: 'var(--radius)', padding: '12px 16px', marginBottom: 16,
        }}>
          <div style={{ fontSize: 13, color: 'var(--ink)' }}>
            <strong>{selectedIds.length}</strong> selected — Total: <strong style={{ color: 'var(--green)' }}>{fmtMoney(selectedTotal)}</strong>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setShowBatchConfirm(true)} disabled={working}>
            Create Payout Batch
          </button>
        </div>
      )}

      <Msg message={message} />

      {loading ? (
        <LoadingSpinner label="Loading withdrawals…" />
      ) : rows.length === 0 ? (
        <div className="empty" style={{ padding: '32px 0' }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📭</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>No withdrawals in this status</div>
          <div style={{ fontSize: 13, color: 'var(--ink3)' }}>Check other tabs for pending items.</div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="premium-table">
            <thead>
              <tr>
                {tab === 'approved' && (
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.length === rows.length && rows.length > 0}
                      onChange={toggleAll}
                    />
                  </th>
                )}
                <th>Creator</th>
                <th>Amount</th>
                <th>Method</th>
                <th>Destination</th>
                <th>Requested</th>
                <th>Status</th>
                {(tab === 'pending_admin_approval' || tab === 'approved') && (
                  <th style={{ textAlign: 'right' }}>Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  {tab === 'approved' && (
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(r.id)}
                        onChange={() => toggleSelect(r.id)}
                      />
                    </td>
                  )}
                  <td>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{r.creator_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{r.creator_email}</div>
                    </div>
                  </td>
                  <td style={{ fontWeight: 700, color: 'var(--green)' }}>{fmtMoney(r.amount)}</td>
                  <td style={{ fontSize: 12 }}>{r.payment_method || '—'}</td>
                  <td style={{ fontSize: 12, color: 'var(--ink3)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.payment_destination || r.destination || '—'}
                  </td>
                  <td style={{ fontSize: 12 }}>{fmtDate(r.created_at)}</td>
                  <td><WithdrawalStatusBadge status={r.status} /></td>
                  {tab === 'pending_admin_approval' && (
                    <td>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => approveWithdrawal(r.id)}
                          disabled={working}
                        >Approve</button>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--red)', borderColor: 'var(--red)' }}
                          onClick={() => setRejectTarget(r)}
                          disabled={working}
                        >Reject</button>
                      </div>
                    </td>
                  )}
                  {tab === 'approved' && (
                    <td>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--red)', borderColor: 'var(--red)' }}
                          onClick={() => setRejectTarget(r)}
                          disabled={working}
                        >Reject</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rejectTarget && (
        <RejectModal
          withdrawal={rejectTarget}
          working={working}
          onConfirm={(reason) => rejectWithdrawal(rejectTarget.id, reason)}
          onClose={() => setRejectTarget(null)}
        />
      )}

      {showBatchConfirm && (
        <CreateBatchModal
          selectedIds={selectedIds}
          totalAmount={selectedTotal}
          working={working}
          onConfirm={createBatch}
          onClose={() => setShowBatchConfirm(false)}
        />
      )}
    </div>
  );
}

// ─── section 4 — payout batches ───────────────────────────────────────────────

function PayoutBatchesSection() {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [markPaidTarget, setMarkPaidTarget] = useState(null);
  const [exportingId, setExportingId] = useState(null);

  const MARKABLE_STATUSES = ['draft', 'approved', 'exported'];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('payout_batches')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setBatches(data || []);
    } catch (err) {
      setMessage({ text: 'Failed to load batches: ' + err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleExportCSV = async (batchId) => {
    setExportingId(batchId);
    setMessage({ text: '', type: '' });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/payouts/export?batchId=${batchId}`, {
        headers: { 'Authorization': `Bearer ${session?.access_token || ''}` },
      });
      const ct = res.headers.get('content-type') || '';
      if (!res.ok || ct.includes('text/html')) {
        throw new Error('Export unavailable. Use "vercel dev" for local development, or export from the deployed app.');
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payout_batch_${batchId}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      setMessage({ text: 'CSV exported.', type: 'success' });
    } catch (err) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setExportingId(null);
    }
  };

  const handleMarkPaid = async () => {
    const batch = markPaidTarget;
    setMarkPaidTarget(null);
    setWorking(true);
    setMessage({ text: '', type: '' });
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase.rpc('mark_payout_batch_paid', {
        p_batch_id: batch.id,
        p_marked_paid_by: user.id,
      });
      if (error) throw error;
      if (data?.success === false) throw new Error(data.message || 'Mark paid failed');
      setMessage({ text: `Batch marked as PAID. ${data?.paid_count || ''} payment(s) processed.`, type: 'success' });
      load();
    } catch (err) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setWorking(false);
    }
  };

  return (
    <div>
      <Msg message={message} />
      {loading ? (
        <LoadingSpinner label="Loading batches…" />
      ) : batches.length === 0 ? (
        <div className="empty" style={{ padding: '32px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📦</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>No payout batches yet</div>
          <div style={{ fontSize: 13, color: 'var(--ink3)' }}>Create a batch by approving withdrawal requests first.</div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="premium-table">
            <thead>
              <tr>
                <th>Batch #</th>
                <th>Status</th>
                <th>Total Amount</th>
                <th>Creators</th>
                <th>Payments</th>
                <th>Created</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {batches.map(b => (
                <tr key={b.id}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>
                    #{b.batch_number || b.id.substring(0, 8)}
                  </td>
                  <td><BatchStatusBadge status={b.status} /></td>
                  <td style={{ fontWeight: 700, color: 'var(--green)' }}>{fmtMoney(b.total_amount)}</td>
                  <td>{b.total_creators || 0}</td>
                  <td>{b.total_payments || b.payment_count || 0}</td>
                  <td style={{ fontSize: 12 }}>{fmtDate(b.created_at)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleExportCSV(b.id)}
                        disabled={exportingId === b.id}
                      >
                        {exportingId === b.id ? 'Exporting…' : 'Export CSV'}
                      </button>
                      {MARKABLE_STATUSES.includes(b.status) && (
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => setMarkPaidTarget(b)}
                          disabled={working}
                        >Mark Paid</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {markPaidTarget && (
        <MarkPaidModal
          batch={markPaidTarget}
          working={working}
          onConfirm={handleMarkPaid}
          onClose={() => setMarkPaidTarget(null)}
        />
      )}
    </div>
  );
}

// ─── section 5 — payment managers (owner only) ───────────────────────────────

const ALL_PERMISSIONS = [
  { key: 'can_view_payouts',    label: 'View Payouts' },
  { key: 'can_approve_payouts', label: 'Approve Payouts' },
  { key: 'can_create_batches',  label: 'Create Batches' },
  { key: 'can_mark_paid',       label: 'Mark Paid' },
  { key: 'can_export',          label: 'Export CSV' },
];

function PaymentManagersSection() {
  const [managers, setManagers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [revokeTarget, setRevokeTarget] = useState(null);

  const [grantForm, setGrantForm] = useState({
    userIdOrEmail: '',
    can_view_payouts: true,
    can_approve_payouts: false,
    can_create_batches: false,
    can_mark_paid: false,
    can_export: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Step 1: load payment_managers (user_id → auth.users, no direct FK to user_profiles)
      const { data: mgrs, error } = await supabase
        .from('payment_managers')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;

      // Step 2: fetch matching user_profiles by id (user_profiles.id = auth.users.id)
      const userIds = (mgrs || []).map(m => m.user_id).filter(Boolean);
      let profileMap = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('user_profiles')
          .select('id, full_name, email')
          .in('id', userIds);
        (profiles || []).forEach(p => { profileMap[p.id] = p; });
      }

      const rows = (mgrs || []).map(m => ({
        ...m,
        display_name: profileMap[m.user_id]?.full_name || m.user_id,
        display_email: profileMap[m.user_id]?.email || '',
      }));
      setManagers(rows);
    } catch (err) {
      setMessage({ text: 'Failed to load payment managers: ' + err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const grantManager = async () => {
    const input = grantForm.userIdOrEmail.trim();
    if (!input) return;
    setWorking(true);
    setMessage({ text: '', type: '' });
    try {
      const { data: { user } } = await supabase.auth.getUser();

      // Resolve email → user_id if needed
      let targetUserId = input;
      if (input.includes('@')) {
        const { data: profile, error: profileErr } = await supabase
          .from('user_profiles')
          .select('id')
          .eq('email', input)
          .single();
        if (profileErr || !profile) throw new Error('No user found with that email.');
        targetUserId = profile.id;
      }

      const { error } = await supabase
        .from('payment_managers')
        .upsert({
          user_id: targetUserId,
          granted_by: user.id,
          can_view_payouts: grantForm.can_view_payouts ?? true,
          can_approve_withdrawals: grantForm.can_approve_payouts ?? false,
          can_export_batches: grantForm.can_export ?? false,
          can_mark_paid: grantForm.can_mark_paid ?? false,
          active: true,
        }, { onConflict: 'user_id' });
      if (error) throw error;
      setMessage({ text: 'Payment manager access granted.', type: 'success' });
      setGrantForm({
        userIdOrEmail: '',
        can_view_payouts: true,
        can_approve_payouts: false,
        can_create_batches: false,
        can_mark_paid: false,
        can_export: false,
      });
      load();
    } catch (err) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setWorking(false);
    }
  };

  const revokeManager = async (userId) => {
    setRevokeTarget(null);
    setWorking(true);
    setMessage({ text: '', type: '' });
    try {
      const { error } = await supabase
        .from('payment_managers')
        .update({ active: false })
        .eq('user_id', userId);
      if (error) throw error;
      setMessage({ text: 'Manager access revoked.', type: 'success' });
      load();
    } catch (err) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setWorking(false);
    }
  };

  return (
    <div>
      <Msg message={message} />

      {/* Add manager form */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title" style={{ marginBottom: 14 }}>Add Payment Manager</div>
        <div className="form-group" style={{ marginBottom: 12 }}>
          <label className="form-label">User ID or Email</label>
          <input
            className="form-input"
            placeholder="user@example.com or UUID"
            value={grantForm.userIdOrEmail}
            onChange={e => setGrantForm({ ...grantForm, userIdOrEmail: e.target.value })}
          />
        </div>
        <div style={{ marginBottom: 14 }}>
          <div className="form-label" style={{ marginBottom: 8 }}>Permissions</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {ALL_PERMISSIONS.map(p => (
              <label key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={!!grantForm[p.key]}
                  onChange={e => setGrantForm({ ...grantForm, [p.key]: e.target.checked })}
                />
                {p.label}
              </label>
            ))}
          </div>
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={grantManager}
          disabled={working || !grantForm.userIdOrEmail.trim()}
        >
          {working ? 'Granting…' : 'Grant Access'}
        </button>
      </div>

      {/* Managers table */}
      {loading ? (
        <LoadingSpinner label="Loading managers…" />
      ) : managers.length === 0 ? (
        <div className="empty" style={{ padding: '24px 0' }}>
          <div style={{ fontSize: 13, color: 'var(--ink3)' }}>No payment managers assigned yet.</div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="premium-table">
            <thead>
              <tr>
                <th>Name / Email</th>
                <th>Permissions</th>
                <th>Active</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {managers.map(m => (
                <tr key={m.id || m.user_id}>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{m.display_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{m.display_email}</div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {ALL_PERMISSIONS.filter(p => m[p.key] || (m.permissions && m.permissions[p.key])).map(p => (
                        <span key={p.key} style={{
                          background: 'rgba(37,99,235,0.1)', color: '#2563eb',
                          borderRadius: 99, fontSize: 10, fontWeight: 700, padding: '2px 7px',
                        }}>{p.label}</span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <span style={{
                      background: m.is_active !== false ? 'rgba(26,122,74,0.1)' : 'rgba(192,57,43,0.1)',
                      color: m.is_active !== false ? 'var(--green)' : 'var(--red)',
                      borderRadius: 99, fontSize: 11, fontWeight: 700, padding: '3px 10px',
                    }}>
                      {m.is_active !== false ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--red)', borderColor: 'var(--red)' }}
                        onClick={() => setRevokeTarget(m)}
                        disabled={working}
                      >Revoke</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {revokeTarget && (
        <ConfirmModal
          title="Revoke Manager Access"
          body={`Remove payment manager access for "${revokeTarget.display_name}"? They will no longer be able to perform payout operations.`}
          confirmLabel="Revoke Access"
          danger
          working={working}
          onConfirm={() => revokeManager(revokeTarget.user_id)}
          onClose={() => setRevokeTarget(null)}
        />
      )}
    </div>
  );
}

// ─── main export ──────────────────────────────────────────────────────────────

export default function PayoutManager() {
  const [userRole, setUserRole] = useState('');
  const [openSections, setOpenSections] = useState({
    overview: true,
    bonusReview: true,
    withdrawals: true,
    batches: true,
    managers: false,
  });
  const [bonusPendingCount, setBonusPendingCount] = useState(null);
  const [withdrawalPendingCount, setWithdrawalPendingCount] = useState(null);

  useEffect(() => {
    // Resolve current user role
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) return;
      const { data } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('id', session.user.id)
        .single();
      const raw = (data?.role || '').toLowerCase();
      const resolved = raw === 'admin' ? 'owner' : raw === 'account_manager' ? 'am' : raw;
      setUserRole(resolved);
      if (resolved === 'owner') {
        setOpenSections(prev => ({ ...prev, managers: true }));
      }
    });

    // Quick badge counts
    Promise.all([
      supabase
        .from('creator_earnings')
        .select('id', { count: 'exact', head: true })
        .in('status', ['needs_review', 'eligible']),
      supabase
        .from('withdrawal_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending_admin_approval'),
    ]).then(([earnings, withdrawals]) => {
      setBonusPendingCount(earnings.count ?? 0);
      setWithdrawalPendingCount(withdrawals.count ?? 0);
    });
  }, []);

  const toggle = (key) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="content">
      {/* Page header */}
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 24, fontWeight: 800, margin: 0, marginBottom: 4 }}>Payout Manager</h2>
        <p style={{ fontSize: 14, color: 'var(--ink3)', margin: 0 }}>
          Review bonuses, manage withdrawal requests, and process creator payouts.
        </p>
      </div>

      {/* Section 1 — Overview */}
      <div style={{ marginBottom: 16 }}>
        <SectionHeader
          title="Overview"
          open={openSections.overview}
          onToggle={() => toggle('overview')}
        />
        <SectionBody open={openSections.overview}>
          <OverviewSection userRole={userRole} />
        </SectionBody>
      </div>

      {/* Section 2 — Bonus Review */}
      <div style={{ marginBottom: 16 }}>
        <SectionHeader
          title="Bonus Review"
          open={openSections.bonusReview}
          onToggle={() => toggle('bonusReview')}
          badge={bonusPendingCount != null && bonusPendingCount > 0 ? bonusPendingCount : undefined}
        />
        <SectionBody open={openSections.bonusReview}>
          <BonusReviewSection />
        </SectionBody>
      </div>

      {/* Section 3 — Withdrawal Requests */}
      <div style={{ marginBottom: 16 }}>
        <SectionHeader
          title="Withdrawal Requests"
          open={openSections.withdrawals}
          onToggle={() => toggle('withdrawals')}
          badge={withdrawalPendingCount != null && withdrawalPendingCount > 0 ? withdrawalPendingCount : undefined}
        />
        <SectionBody open={openSections.withdrawals}>
          <WithdrawalsSection />
        </SectionBody>
      </div>

      {/* Section 4 — Payout Batches */}
      <div style={{ marginBottom: 16 }}>
        <SectionHeader
          title="Payout Batches"
          open={openSections.batches}
          onToggle={() => toggle('batches')}
        />
        <SectionBody open={openSections.batches}>
          <PayoutBatchesSection />
        </SectionBody>
      </div>

      {/* Section 5 — Payment Managers (owner only) */}
      {userRole === 'owner' && (
        <div style={{ marginBottom: 16 }}>
          <SectionHeader
            title="Payment Managers"
            open={openSections.managers}
            onToggle={() => toggle('managers')}
          />
          <SectionBody open={openSections.managers}>
            <PaymentManagersSection />
          </SectionBody>
        </div>
      )}
    </div>
  );
}
