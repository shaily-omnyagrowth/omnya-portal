import { useCallback, useEffect, useState } from 'react';
import { UserLock01Icon } from '@hugeicons/core-free-icons';
import { gooeyToast as toast } from 'goey-toast';
import { supabase } from '../../supabaseClient';
import Alert from '../../ui/Alert';
import EmptyState from '../../ui/EmptyState';
import { SkeletonTable } from '../../ui/Skeleton';
import { ConfirmModal } from './parts';

const PERMISSIONS = [
  { key: 'can_view_payouts', label: 'View payouts' },
  { key: 'can_approve_payouts', label: 'Approve payouts' },
  { key: 'can_create_batches', label: 'Create batches' },
  { key: 'can_mark_paid', label: 'Mark paid' },
  { key: 'can_export', label: 'Export CSV' },
];
const BLANK = { userIdOrEmail: '', can_view_payouts: true, can_approve_payouts: false, can_create_batches: false, can_mark_paid: false, can_export: false };

export default function PaymentManagersSection({ callApi }) {
  const [managers, setManagers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [form, setForm] = useState(BLANK);

  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      const { data: mgrs, error: e } = await supabase.from('payment_managers').select('*').order('created_at', { ascending: false });
      if (e) throw e;
      // payment_managers.user_id points at auth.users, so profiles are fetched separately.
      const ids = (mgrs || []).map(m => m.user_id).filter(Boolean);
      const { data: profiles } = ids.length ? await supabase.from('user_profiles').select('id, full_name, email').in('id', ids) : { data: [] };
      const byId = Object.fromEntries((profiles || []).map(p => [p.id, p]));
      setManagers((mgrs || []).map(m => ({ ...m, display_name: byId[m.user_id]?.full_name || byId[m.user_id]?.email || m.user_id, display_email: byId[m.user_id]?.email || '' })));
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const grant = async (e) => {
    e.preventDefault();
    const input = form.userIdOrEmail.trim();
    if (!input) return;
    setWorking(true); setError('');
    try {
      let userId = input;
      if (input.includes('@')) {
        const { data: profile } = await supabase.from('user_profiles').select('id').eq('email', input.toLowerCase()).maybeSingle();
        if (!profile) throw new Error(`No account uses ${input}.`);
        userId = profile.id;
      }
      // N-18: grants go through the owner-only endpoint, which also writes payment_audit_logs.
      await callApi('/api/payment-managers/grant', {
        userId,
        can_view_payouts: form.can_view_payouts,
        can_approve_withdrawals: form.can_approve_payouts,
        can_export_batches: form.can_export,
        can_mark_paid: form.can_mark_paid,
      });
      toast.success('Payment access granted', { description: input });
      setForm(BLANK);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setWorking(false);
    }
  };

  const revoke = async (m) => {
    setWorking(true);
    try {
      await callApi('/api/payment-managers/revoke', { userId: m.user_id });
      toast.success('Access revoked', { description: m.display_name });
      setRevokeTarget(null);
      load();
    } catch (err) {
      toast.error("Access wasn't revoked", { description: err.message });
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="dash-grid" style={{ alignItems: 'start' }}>
      <section className="card flush" style={{ alignSelf: "stretch" }}>
        <div className="card-head" style={{ padding: '20px 20px 0' }}>
          <div><h2 className="card-title">Payment managers</h2><p className="card-desc">People outside the owner role who can work on payouts.</p></div>
        </div>
        {loading ? <div style={{ padding: 20 }}><SkeletonTable rows={3} cols={3} /></div>
          : loadError ? <div style={{ padding: 20 }}><Alert tone="error" title="Managers didn't load" action={<button className="btn btn-secondary btn-sm" onClick={load}>Try again</button>}>{loadError}</Alert></div>
          : managers.length === 0 ? <EmptyState compact icon={UserLock01Icon} title="No payment managers yet">Grant access with the form, and it shows up here.</EmptyState>
          : (
            <div className="table-wrap" style={{ border: 0, borderRadius: 0, marginTop: 16 }}>
              <table>
                <thead><tr><th>Person</th><th>Can</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {managers.map(m => {
                    const active = m.is_active !== false;
                    return (
                      <tr key={m.id || m.user_id}>
                        <td><div className="fw-600 text-ink truncate" style={{ maxWidth: 220 }}>{m.display_name}</div>{m.display_email && m.display_email !== m.display_name && <div className="fs-12 text-muted truncate" style={{ maxWidth: 220 }}>{m.display_email}</div>}</td>
                        <td><div className="chip-row">{PERMISSIONS.filter(p => m[p.key] || m.permissions?.[p.key]).map(p => <span key={p.key} className="badge badge-gray">{p.label}</span>)}</div></td>
                        <td><span className={`badge badge-${active ? 'green' : 'gray'}`}>{active ? 'Active' : 'Inactive'}</span></td>
                        <td className="num"><button className="btn btn-red btn-sm" onClick={() => setRevokeTarget(m)} disabled={working}>Revoke</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </section>

      <form className="card" onSubmit={grant}>
        <h2 className="card-title">Grant access</h2>
        <div className="form-group">
          <label className="form-label" htmlFor="pm-user">Email or user ID</label>
          <input id="pm-user" className="form-input" placeholder="name@omnya.com" value={form.userIdOrEmail} onChange={e => setForm({ ...form, userIdOrEmail: e.target.value })} />
        </div>
        <fieldset className="form-group" style={{ border: 0, padding: 0, margin: '0 0 16px' }}>
          <legend className="form-label mb-8">They can</legend>
          <div className="flex-col gap-8">
            {PERMISSIONS.map(p => (
              <label key={p.key} className="check"><input type="checkbox" checked={!!form[p.key]} onChange={e => setForm({ ...form, [p.key]: e.target.checked })} /><span>{p.label}</span></label>
            ))}
          </div>
        </fieldset>
        {error && <Alert tone="error" style={{ marginBottom: 16 }}>{error}</Alert>}
        <button type="submit" className="btn btn-primary btn-full" disabled={working || !form.userIdOrEmail.trim()}>{working ? 'Granting…' : 'Grant access'}</button>
      </form>

      {revokeTarget && (
        <ConfirmModal title={`Revoke access for ${revokeTarget.display_name}?`} body="They lose every payout permission straight away. You can grant it again later." confirmLabel="Revoke access" danger working={working}
          onConfirm={() => revoke(revokeTarget)} onClose={() => setRevokeTarget(null)} />
      )}
    </div>
  );
}
