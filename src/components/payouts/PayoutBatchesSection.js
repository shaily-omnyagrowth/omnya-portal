import { useCallback, useEffect, useState } from 'react';
import { Package01Icon } from '@hugeicons/core-free-icons';
import { gooeyToast as toast } from 'goey-toast';
import { supabase } from '../../supabaseClient';
import Alert from '../../ui/Alert';
import EmptyState from '../../ui/EmptyState';
import { SkeletonTable } from '../../ui/Skeleton';
import { fmtDate, fmtMoney } from '../../utils';
import { BatchStatusBadge, MarkPaidModal } from './parts';
import usePagination from '../../ui/Pagination';

const MARKABLE = ['draft', 'approved', 'exported'];
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export default function PayoutBatchesSection({ callApi }) {
  const [batches, setBatches] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [working, setWorking] = useState(false);
  const [markPaidTarget, setMarkPaidTarget] = useState(null);
  const [exportingId, setExportingId] = useState(null);

  const load = useCallback(async () => {
    setLoadError('');
    const { data, error } = await supabase.from('payout_batches').select('*').order('created_at', { ascending: false });
    if (error) { setLoadError(error.message); setBatches([]); return; }
    setBatches(data || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const exportCsv = async (b) => {
    setExportingId(b.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/payouts/export?batchId=${b.id}`, { headers: { Authorization: `Bearer ${session?.access_token || ''}` } });
      if (!res.ok || (res.headers.get('content-type') || '').includes('text/html')) throw new Error('The export API isn\'t responding. Locally, run node tests/lib/devServer.cjs.');
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement('a'), { href: url, download: `payout_batch_${b.batch_number || b.id}.csv` });
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      toast.success('CSV downloaded', { description: `Batch ${b.batch_number || b.id.slice(0, 8)}` });
    } catch (err) {
      toast.error("Export didn't run", { description: err.message });
    } finally {
      setExportingId(null);
    }
  };

  // Moves money: the endpoint runs Stripe transfers for eligible creators, then emails them.
  const markPaid = async () => {
    const b = markPaidTarget;
    setMarkPaidTarget(null); setWorking(true);
    try {
      const d = await callApi('/api/payouts/mark-paid', { batchId: b.id });
      const desc = [plural(d?.paidCount ?? 0, 'payment') + ' processed', d?.emailsSent && `${plural(d.emailsSent, 'creator')} emailed`, d?.emailsFailed && `${plural(d.emailsFailed, 'email')} failed`].filter(Boolean).join(' · ');
      if (d?.warning) toast.warning('Batch paid, with a problem', { description: `${desc}. ${d.warning}` });
      else toast.success('Batch marked as paid', { description: desc });
      load();
    } catch (err) {
      toast.error('Batch wasn\'t marked as paid', { description: err.message });
    } finally {
      setWorking(false);
    }
  };

  const { rows: page, pager } = usePagination(batches, { label: 'batches' });

  if (!batches) return <SkeletonTable rows={4} cols={6} />;
  if (loadError) return <Alert tone="error" title="Batches didn't load" action={<button className="btn btn-secondary btn-sm" onClick={load}>Try again</button>}>{loadError}</Alert>;
  if (!batches.length) return <div className="card"><EmptyState compact icon={Package01Icon} title="No payout batches yet">Approve withdrawals, select them on the Withdrawals tab and create a batch.</EmptyState></div>;

  return (
    <>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Batch</th><th>Status</th><th className="num">Total</th><th className="num">Creators</th><th className="num">Payments</th><th>Created</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {page.map(b => (
              <tr key={b.id}>
                <td className="mono fw-600 text-ink">{b.batch_number || b.id.substring(0, 8)}</td>
                <td><BatchStatusBadge status={b.status} /></td>
                <td className="num fw-600 text-ink">{fmtMoney(b.total_amount, { cents: true })}</td>
                <td className="num">{b.total_creators || 0}</td>
                <td className="num">{b.total_payments || b.payment_count || 0}</td>
                <td className="text-muted">{fmtDate(b.created_at)}</td>
                <td className="num"><span className="flex gap-4" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => exportCsv(b)} disabled={exportingId === b.id}>{exportingId === b.id ? 'Exporting…' : 'Export CSV'}</button>
                  {MARKABLE.includes(b.status) && <button className="btn btn-primary btn-sm" onClick={() => setMarkPaidTarget(b)} disabled={working}>Mark as paid</button>}
                </span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pager}
      {markPaidTarget && <MarkPaidModal batch={markPaidTarget} working={working} onConfirm={markPaid} onClose={() => setMarkPaidTarget(null)} />}
    </>
  );
}
