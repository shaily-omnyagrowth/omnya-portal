import { useState } from 'react';
import Dialog from '../../ui/Dialog';
import { fmtMoney } from '../../utils';

export function StatCard({ label, value, sub, accent, highlight }) {
  return (
    <div className={`stat-card ${highlight ? 'stat-highlight' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={accent && !highlight ? { color: accent } : undefined}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

const pill = (map) => function Badge({ status }) {
  const [label, tone] = map[status] || [status ? String(status).replace(/_/g, ' ') : 'Unknown', 'gray'];
  return <span className={`badge badge-${tone}`}><span className="dot" />{label}</span>;
};
export const BatchStatusBadge = pill({ draft: ['Draft', 'gray'], approved: ['Approved', 'blue'], exported: ['Exported', 'blue'], paid: ['Paid', 'green'], cancelled: ['Cancelled', 'red'] });
export const WithdrawalStatusBadge = pill({ pending_admin_approval: ['Waiting for approval', 'orange'], approved: ['Approved', 'blue'], rejected: ['Rejected', 'red'], batched: ['In a batch', 'blue'], paid: ['Paid', 'green'] });
export const EarningStatusBadge = pill({ needs_review: ['Needs review', 'orange'], eligible: ['Eligible', 'blue'], approved: ['Approved', 'green'], forfeited: ['Forfeited', 'gray'] });

export function ConfirmModal({ title, body, confirmLabel, danger, onConfirm, onClose, working }) {
  return (
    <Dialog size="sm" title={title} onClose={working ? undefined : onClose}
      actions={<><button className="btn btn-secondary" onClick={onClose} disabled={working}>Cancel</button><button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={working}>{working ? 'Working…' : confirmLabel || 'Confirm'}</button></>}>
      {body && <p style={{ color: 'var(--ink2)' }}>{body}</p>}
    </Dialog>
  );
}

function ReasonModal({ title, description, label, placeholder, confirmLabel, workingLabel, onConfirm, onClose, working }) {
  const [reason, setReason] = useState('');
  return (
    <Dialog size="sm" title={title} description={description} onClose={working ? undefined : onClose}
      actions={<><button className="btn btn-secondary" onClick={onClose} disabled={working}>Cancel</button><button className="btn btn-danger" onClick={() => onConfirm(reason)} disabled={working || !reason.trim()}>{working ? workingLabel : confirmLabel}</button></>}>
      <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label" htmlFor="pm-reason">{label}</label><textarea id="pm-reason" className="textarea" rows={3} placeholder={placeholder} value={reason} onChange={e => setReason(e.target.value)} autoFocus /><span className="form-hint">The creator sees this.</span></div>
    </Dialog>
  );
}

export function ForfeitModal({ earning, ...rest }) {
  return <ReasonModal {...rest} title="Forfeit this bonus?" description={earning.creator_name || earning.creator_id} label="Reason" placeholder="Views couldn't be verified after 14 days" confirmLabel="Forfeit bonus" workingLabel="Saving…" />;
}

export function RejectModal({ withdrawal, ...rest }) {
  return <ReasonModal {...rest} title="Reject this withdrawal?" description={`${fmtMoney(withdrawal.amount, { cents: true })} for ${withdrawal.creator_name || withdrawal.creator_id}`} label="Reason" placeholder="The minimum payout hasn't been reached" confirmLabel="Reject" workingLabel="Rejecting…" />;
}

export function MarkPaidModal({ batch, onConfirm, onClose, working }) {
  return (
    <Dialog size="sm" title={`Mark batch ${batch.batch_number || batch.id?.substring(0, 8)} as paid?`} onClose={working ? undefined : onClose}
      actions={<><button className="btn btn-secondary" onClick={onClose} disabled={working}>Cancel</button><button className="btn btn-primary" onClick={onConfirm} disabled={working}>{working ? 'Paying…' : 'Mark as paid'}</button></>}>
      <p style={{ color: 'var(--ink2)' }}>Every withdrawal in this batch becomes paid, Stripe transfers are sent where set up, and creators get a confirmation email. This can't be undone.</p>
      <dl className="kv mt-16"><dt>Total</dt><dd className="fw-600">{fmtMoney(batch.total_amount, { cents: true })}</dd><dt>Creators</dt><dd>{batch.total_creators || 0}</dd></dl>
    </Dialog>
  );
}

export function CreateBatchModal({ selectedIds, totalAmount, onConfirm, onClose, working }) {
  return (
    <ConfirmModal title="Create a payout batch?" confirmLabel="Create batch" working={working} onConfirm={onConfirm} onClose={onClose}
      body={`Bundles ${selectedIds.length} approved ${selectedIds.length === 1 ? 'withdrawal' : 'withdrawals'} totalling ${fmtMoney(totalAmount, { cents: true })} so they can be exported and paid together.`} />
  );
}
