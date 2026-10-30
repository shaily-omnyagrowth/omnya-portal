import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { SkeletonStats } from '../../ui/Skeleton';
import { fmtMoney, fmtNum } from '../../utils';
import { gooeyToast as toast } from 'goey-toast';
import Alert from '../../ui/Alert';
import { ConfirmModal, StatCard } from './parts';


export default function OverviewSection({ userRole, callApi }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [confirmRecalc, setConfirmRecalc] = useState(false);

  const loadStats = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      const [
        { data: approvedUnpaid },
        { count: pendingBonus },
        { count: pendingWithdrawals },
        { data: paidThisMonth },
        { count: missingPayment },
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
        pendingBonusCount: pendingBonus ?? 0,
        pendingWithdrawalsCount: pendingWithdrawals ?? 0,
        totalPaidMonth,
        missingPaymentCount: missingPayment ?? 0,
      });
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  const handleRecalculate = async () => {
    setConfirmRecalc(false);
    setWorking(true);
    try {
      const data = await callApi('/api/earnings/recalculate');
      // bonusHeld: TikTok bonuses held for lack of verified views (spec 0002,
      // AC-10). Only non zero while TIKTOK_VERIFIED_BONUS_ONLY is on.
      const held = Number(data?.bonusHeld) || 0;
      toast.success('Earnings recalculated', { description: held > 0 ? `${held} TikTok bonus${held === 1 ? ' is' : 'es are'} held until the creator's views are verified.` : data?.message });
      loadStats();
    } catch (err) {
      toast.error("Earnings weren't recalculated", { description: err.message });
    } finally {
      setWorking(false);
    }
  };

  return (
    <div>
      {loadError && <Alert tone="error" title="Payout totals didn't load" action={<button className="btn btn-secondary btn-sm" onClick={loadStats}>Try again</button>} style={{ marginBottom: 16 }}>{loadError}</Alert>}
      {loading ? (
        <SkeletonStats count={5} />
      ) : stats ? (
        <div>
          <div className="stats-grid">
            <StatCard label="Approved, not paid yet" value={fmtMoney(stats.totalUnpaid)} highlight />
            <StatCard label="Bonuses to review" value={fmtNum(stats.pendingBonusCount)} sub="eligible or flagged" />
            <StatCard label="Withdrawals to approve" value={fmtNum(stats.pendingWithdrawalsCount)} sub="requested by creators" />
            <StatCard label="Paid this month" value={fmtMoney(stats.totalPaidMonth)} />
            <StatCard
              label="Creators without a payout method"
              value={fmtNum(stats.missingPaymentCount)}
              sub={stats.missingPaymentCount > 0 ? "they can't withdraw yet" : "everyone is set up"}
              accent={stats.missingPaymentCount > 0 ? 'var(--red)' : undefined}
            />
          </div>
          {(userRole === 'owner') && (
            <div className="flex-center gap-12" style={{ flexWrap: 'wrap', marginTop: 12 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setConfirmRecalc(true)} disabled={working}>
                {working ? 'Recalculating…' : 'Recalculate earnings'}
              </button>
              <span className="fs-12 text-muted">Use after changing bonus rules or pay per video.</span>
            </div>
          )}
        </div>
      ) : null}

      {confirmRecalc && (
        <ConfirmModal
          title="Recalculate all earnings?"
          body="Rebuilds every creator's earnings from current submissions and bonus rules. Approved and paid amounts are kept. It can take a minute."
          confirmLabel="Recalculate"
          working={working}
          onConfirm={handleRecalculate}
          onClose={() => setConfirmRecalc(false)}
        />
      )}
    </div>
  );
}
