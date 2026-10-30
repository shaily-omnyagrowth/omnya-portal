import { useCallback, useEffect, useState } from 'react';
import { Award01Icon } from '@hugeicons/core-free-icons';
import { gooeyToast as toast } from 'goey-toast';
import { supabase } from '../../supabaseClient';
import { callApi } from '../../lib/api';
import Alert from '../../ui/Alert';
import EmptyState from '../../ui/EmptyState';
import { SkeletonTable } from '../../ui/Skeleton';
import { EMPTY, fmtMoney, fmtNum, fmtRelativeTime } from '../../utils';
import { EarningStatusBadge, ForfeitModal } from './parts';
import Avatar from '../../ui/Avatar';
import usePagination from '../../ui/Pagination';

export default function BonusReviewSection() {
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [working, setWorking] = useState(false);
  const [forfeitTarget, setForfeitTarget] = useState(null);

  const load = useCallback(async () => {
    setLoadError('');
    const { data, error } = await supabase.from('creator_earnings').select('*, creators ( name, email )').in('status', ['needs_review', 'eligible']).order('created_at', { ascending: false });
    if (error) { setLoadError(error.message); setRows([]); return; }
    setRows((data || []).map(r => ({ ...r, creator_name: r.creators?.name || 'Unknown creator', creator_email: r.creators?.email || '' })));
  }, []);

  useEffect(() => { load(); }, [load]);

  const update = async (e, body, ok, fail) => {
    setWorking(true);
    try {
      await callApi('/api/earnings/review', { body: { earningId: e.id, ...body } });
    } catch (err) {
      toast.error(fail, { description: err.message });
      return false;
    } finally {
      setWorking(false);
    }
    toast.success(ok, { description: `${fmtMoney(e.amount, { cents: true })} for ${e.creator_name}` });
    load();
    return true;
  };

  const { rows: page, pager } = usePagination(rows, { label: 'bonuses' });

  if (!rows) return <SkeletonTable rows={4} cols={6} />;
  if (loadError) return <Alert tone="error" title="Bonuses didn't load" action={<button className="btn btn-secondary btn-sm" onClick={load}>Try again</button>}>{loadError}</Alert>;
  if (!rows.length) return <div className="card"><EmptyState compact icon={Award01Icon} title="No bonuses to review">When a video crosses a bonus tier, it shows up here for a quick check before it's paid.</EmptyState></div>;

  return (
    <>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Creator</th><th className="num">Views counted</th><th>Tier</th><th className="num">Bonus</th><th>Eligible</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {page.map(e => (
              <tr key={e.id}>
                <td><span className="flex-center gap-12"><Avatar name={e.creator_name} /><span className="min-w-0"><span className="fw-600 text-ink truncate" style={{ display: 'block', maxWidth: 200 }}>{e.creator_name}</span>{e.creator_email && <span className="fs-12 text-muted truncate" style={{ display: 'block', maxWidth: 200 }}>{e.creator_email}</span>}</span></span></td>
                <td className="num">{fmtNum(e.views_counted)}</td>
                <td className="text-muted">{e.bonus_tier || EMPTY}</td>
                <td className="num fw-600 text-ink">{fmtMoney(e.amount, { cents: true })}</td>
                <td className="text-muted">{fmtRelativeTime(e.eligible_at || e.created_at)}</td>
                <td><EarningStatusBadge status={e.status} /></td>
                <td className="num"><span className="flex gap-4" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn btn-red btn-sm" onClick={() => setForfeitTarget(e)} disabled={working}>Forfeit</button>
                  <button className="btn btn-primary btn-sm" onClick={() => update(e, { action: 'approve' }, 'Bonus approved', "Bonus wasn't approved")} disabled={working}>Approve</button>
                </span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pager}
      {forfeitTarget && <ForfeitModal earning={forfeitTarget} working={working}
        onConfirm={async (reason) => { if (await update(forfeitTarget, { action: 'forfeit', reason }, 'Bonus forfeited', "Bonus wasn't forfeited")) setForfeitTarget(null); }}
        onClose={() => setForfeitTarget(null)} />}
    </>
  );
}
