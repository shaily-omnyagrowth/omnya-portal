import { useCallback, useEffect, useState } from 'react';
import Alert from '../../ui/Alert';
import { SkeletonTable } from '../../ui/Skeleton';
import { fmtMoney } from '../../utils';

// Reports drift between the append-only ledger and the earnings table; it never corrects anything.
export default function ReconciliationSection({ callApi }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setReport(await callApi('/api/payouts/reconcile', null, { method: 'GET' })); } catch (err) { setError(err.message); } finally { setLoading(false); }
  }, [callApi]);

  useEffect(() => { load(); }, [load]);

  if (loading && !report) return <SkeletonTable rows={3} cols={4} />;
  const recheck = <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>{loading ? 'Checking…' : 'Check again'}</button>;
  if (error) return <Alert tone="error" title="The ledger check didn't run" action={recheck}>{error}</Alert>;

  const s = report?.summary || {};
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  return (
    <div className="flex-col gap-16">
      <p className="fs-13 text-muted" style={{ maxWidth: '64ch' }}>
        Compares the payout ledger with the earnings table for every creator. Drift means a status changed outside the ledger, so investigate it instead of adjusting a balance.
      </p>
      <Alert tone={s.balanced ? 'success' : 'error'} action={recheck}
        title={s.balanced ? 'Balanced. The ledger and the earnings table agree.' : `${plural(s.creatorsWithDrift, 'creator')} out of balance`}>
        {plural(s.creators, 'creator')} checked · ledger {fmtMoney(s.totalLedger, { cents: true })} · table {fmtMoney(s.totalTable, { cents: true })}{!s.balanced && ` · net drift ${fmtMoney(s.totalDrift, { cents: true })}`}
      </Alert>

      {(report?.drifted || []).length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Creator</th><th className="num">Ledger</th><th className="num">Earnings table</th><th className="num">Drift</th></tr></thead>
            <tbody>
              {report.drifted.map(r => (
                <tr key={r.creator_id}>
                  <td className="fw-600 text-ink">{r.creator_name}</td>
                  <td className="num">{fmtMoney(r.ledger_balance, { cents: true })}</td>
                  <td className="num">{fmtMoney(r.table_balance, { cents: true })}</td>
                  <td className="num fw-600 text-red">{fmtMoney(r.drift, { cents: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="fs-12 text-muted">
        {report?.checkedAt && `Checked ${new Date(report.checkedAt).toLocaleString()}.`}
        {report?.source === 'payout_ledger_reconcile' && ' Using the raw reconcile function. Apply migration 20260823000000 for creator names.'}
      </p>
    </div>
  );
}
