import { useCallback, useEffect, useState } from 'react';
import { MoneyReceive02Icon } from '@hugeicons/core-free-icons';
import { gooeyToast as toast } from 'goey-toast';
import { supabase } from '../../supabaseClient';
import Alert from '../../ui/Alert';
import EmptyState from '../../ui/EmptyState';
import { SkeletonTable } from '../../ui/Skeleton';
import { EMPTY, fmtDate, fmtMoney } from '../../utils';
import { CreateBatchModal, RejectModal, WithdrawalStatusBadge } from './parts';

const STATUSES = [
  ['pending_admin_approval', 'Waiting', 'Nothing waiting for approval', 'New withdrawal requests from creators show up here.'],
  ['approved', 'Approved', 'Nothing approved yet', 'Approve a waiting request and it moves here, ready to batch.'],
  ['rejected', 'Rejected', 'No rejected requests', 'Requests you turn down are kept here with the reason.'],
  ['batched', 'In a batch', 'Nothing batched', 'Approved requests move here once they are added to a payout batch.'],
  ['paid', 'Paid', 'Nothing paid yet', 'Requests show up here once their batch is marked as paid.'],
];

export default function WithdrawalsSection({ callApi }) {
  const [status, setStatus] = useState('pending_admin_approval');
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [working, setWorking] = useState(false);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [selected, setSelected] = useState([]);
  const [confirmBatch, setConfirmBatch] = useState(false);

  const load = useCallback(async () => {
    setRows(null); setSelected([]); setLoadError('');
    const { data, error } = await supabase.from('withdrawal_requests').select('*, creators ( name, email, payment_method )').eq('status', status).order('created_at', { ascending: false });
    if (error) { setLoadError(error.message); setRows([]); return; }
    setRows((data || []).map(r => ({ ...r, creator_name: r.creators?.name || 'Unknown creator', creator_email: r.creators?.email || '' })));
  }, [status]);

  useEffect(() => { load(); }, [load]);

  const run = async (fn, ok, fail) => {
    setWorking(true);
    try { await fn(); toast.success(...(typeof ok === 'function' ? ok() : ok)); load(); return true; } catch (err) { toast.error(fail, { description: err.message }); return false; } finally { setWorking(false); }
  };

  const approve = (r) => run(() => callApi('/api/withdrawals/approve', { withdrawalRequestId: r.id }), [`${fmtMoney(r.amount, { cents: true })} approved`, { description: `${r.creator_name} has been emailed.` }], "Withdrawal wasn't approved");
  const reject = async (r, reason) => { if (await run(() => callApi('/api/withdrawals/reject', { withdrawalRequestId: r.id, reason }), ['Withdrawal rejected', { description: `${r.creator_name} has been emailed the reason.` }], "Withdrawal wasn't rejected")) setRejectTarget(null); };
  const createBatch = async () => {
    setConfirmBatch(false);
    let num = '';
    await run(async () => { num = (await callApi('/api/payouts/create-batch', { withdrawalRequestIds: selected, notes: null }))?.batch_number || ''; },
      () => [`Batch${num ? ` ${num}` : ''} created`, { description: `${selected.length} ${selected.length === 1 ? 'request' : 'requests'} are ready to export.` }], "Batch wasn't created");
  };

  const total = (rows || []).filter(r => selected.includes(r.id)).reduce((s, r) => s + Number(r.amount || 0), 0);
  const [, , emptyTitle, emptyText] = STATUSES.find(s => s[0] === status);
  const selectable = status === 'approved';
  const actionable = status === 'pending_admin_approval' || status === 'approved';

  return (
    <div className="flex-col gap-16">
      <div className="chip-row" role="group" aria-label="Withdrawal status">
        {STATUSES.map(([id, label]) => <button key={id} type="button" className="chip" aria-pressed={status === id} onClick={() => setStatus(id)}>{label}</button>)}
      </div>

      {selectable && selected.length > 0 && (
        <div className="selection-bar">
          <span className="fs-13"><strong>{selected.length}</strong> selected · <strong className="tnum">{fmtMoney(total, { cents: true })}</strong></span>
          <button className="btn btn-primary btn-sm" onClick={() => setConfirmBatch(true)} disabled={working}>Create payout batch</button>
        </div>
      )}

      {loadError && <Alert tone="error" title="Withdrawals didn't load" action={<button className="btn btn-secondary btn-sm" onClick={load}>Try again</button>}>{loadError}</Alert>}

      {!rows ? <SkeletonTable rows={4} cols={6} /> : rows.length === 0 ? (!loadError && <div className="card"><EmptyState compact icon={MoneyReceive02Icon} title={emptyTitle}>{emptyText}</EmptyState></div>) : (
        <div className="table-wrap">
          <table>
            <thead><tr>
              {selectable && <th style={{ width: 40 }}><input type="checkbox" aria-label="Select all" checked={selected.length === rows.length} onChange={() => setSelected(selected.length === rows.length ? [] : rows.map(r => r.id))} /></th>}
              <th>Creator</th><th className="num">Amount</th><th>Method</th><th>Destination</th><th>Requested</th><th>Status</th>{actionable && <th><span className="sr-only">Actions</span></th>}
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  {selectable && <td><input type="checkbox" aria-label={`Select ${r.creator_name}`} checked={selected.includes(r.id)} onChange={() => setSelected(s => (s.includes(r.id) ? s.filter(x => x !== r.id) : [...s, r.id]))} /></td>}
                  <td><div className="fw-600 text-ink truncate" style={{ maxWidth: 200 }}>{r.creator_name}</div>{r.creator_email && <div className="fs-12 text-muted truncate" style={{ maxWidth: 200 }}>{r.creator_email}</div>}</td>
                  <td className="num fw-600 text-ink">{fmtMoney(r.amount, { cents: true })}</td>
                  <td>{r.payment_method || EMPTY}</td>
                  <td className="text-muted"><span className="truncate" style={{ display: 'block', maxWidth: 160 }}>{r.payment_destination || r.destination || EMPTY}</span></td>
                  <td className="text-muted">{fmtDate(r.created_at)}</td>
                  <td><WithdrawalStatusBadge status={r.status} /></td>
                  {actionable && (
                    <td className="num"><span className="flex gap-4" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn btn-red btn-sm" onClick={() => setRejectTarget(r)} disabled={working}>Reject</button>
                      {status === 'pending_admin_approval' && <button className="btn btn-primary btn-sm" onClick={() => approve(r)} disabled={working}>Approve</button>}
                    </span></td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rejectTarget && <RejectModal withdrawal={rejectTarget} working={working} onConfirm={(reason) => reject(rejectTarget, reason)} onClose={() => setRejectTarget(null)} />}
      {confirmBatch && <CreateBatchModal selectedIds={selected} totalAmount={total} working={working} onConfirm={createBatch} onClose={() => setConfirmBatch(false)} />}
    </div>
  );
}
