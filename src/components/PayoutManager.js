import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import PageHeader from '../ui/PageHeader';
import Tabs from '../ui/Tabs';
import BonusReviewSection from './payouts/BonusReviewSection';
import OverviewSection from './payouts/OverviewSection';
import PaymentManagersSection from './payouts/PaymentManagersSection';
import PayoutBatchesSection from './payouts/PayoutBatchesSection';
import ReconciliationSection from './payouts/ReconciliationSection';
import WithdrawalsSection from './payouts/WithdrawalsSection';

// N-18: every money action goes through /api/*, which also writes the audit log, emails the creator
// and runs Stripe transfers; the RPCs keep their own authorization behind it.
async function callApi(path, body, { method = 'POST' } = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Your session has expired. Sign in again.');
  const res = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body || {}) }),
  });
  // Without the API layer the SPA answers with index.html and a 200.
  if (!(res.headers.get('content-type') || '').includes('application/json')) {
    throw new Error('The payments API isn\'t responding. Locally, run "node tests/lib/devServer.cjs" instead of "npm start" alone.');
  }
  const json = await res.json().catch(() => null);
  // The error is an object ({ code, message }), so read its message rather than stringifying it.
  if (!res.ok || !json || json.ok === false) {
    throw new Error(json?.error?.message || (typeof json?.error === 'string' ? json.error : null) || `Request failed (${res.status})`);
  }
  return json.data;
}

export default function PayoutManager() {
  const [userRole, setUserRole] = useState('');
  const [tab, setTab] = useState('withdrawals');
  const [counts, setCounts] = useState({ bonus: null, withdrawals: null });

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) return;
      const { data } = await supabase.from('user_profiles').select('role').eq('id', session.user.id).single();
      const raw = (data?.role || '').toLowerCase();
      setUserRole(raw === 'admin' ? 'owner' : raw === 'account_manager' ? 'am' : raw);
    });
    Promise.all([
      supabase.from('creator_earnings').select('id', { count: 'exact', head: true }).in('status', ['needs_review', 'eligible']),
      supabase.from('withdrawal_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending_admin_approval'),
    ]).then(([earnings, withdrawals]) => {
      setCounts({ bonus: earnings.count ?? 0, withdrawals: withdrawals.count ?? 0 });
      if (!withdrawals.count && earnings.count) setTab('bonus');
    });
  }, []);

  const tabs = [
    { id: 'withdrawals', label: 'Withdrawals', count: counts.withdrawals || undefined },
    { id: 'bonus', label: 'Bonus review', count: counts.bonus || undefined },
    { id: 'batches', label: 'Batches' },
    { id: 'reconciliation', label: 'Reconciliation' },
    ...(userRole === 'owner' ? [{ id: 'managers', label: 'Payment managers' }] : []),
  ];

  return (
    <div className="content">
      <PageHeader title="Payouts" description="Approve withdrawals and bonuses, then batch and pay them. Every action is logged and creators are emailed automatically." />
      <OverviewSection userRole={userRole} callApi={callApi} />
      <div className="section">
        <Tabs label="Payout tasks" value={tab} onChange={setTab} tabs={tabs} />
        {tab === 'withdrawals' && <WithdrawalsSection callApi={callApi} />}
        {tab === 'bonus' && <BonusReviewSection />}
        {tab === 'batches' && <PayoutBatchesSection callApi={callApi} />}
        {tab === 'reconciliation' && <ReconciliationSection callApi={callApi} />}
        {tab === 'managers' && userRole === 'owner' && <PaymentManagersSection callApi={callApi} />}
      </div>
    </div>
  );
}
