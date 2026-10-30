import { useState } from 'react';
import { Search01Icon } from '@hugeicons/core-free-icons';
import Alert from '../ui/Alert';
import Dialog from '../ui/Dialog';
import Icon from '../ui/Icon';
import PageHeader from '../ui/PageHeader';
import { SkeletonTable } from '../ui/Skeleton';
import { fmtDate, getInitials } from '../utils';
import useUserAdmin, { ROLE_LABEL } from './users/useUserAdmin';

const ROLE_TONE = { owner: 'ink', am: 'blue', account_manager: 'blue', creator: 'green', client: 'orange', pending: 'gray', denied: 'red' };
const ASSIGNABLE = ['creator', 'am', 'client', 'owner', 'pending'];
const BLANK = { email: '', fullName: '', role: 'creator', sendInvite: true };

export default function UserManagement({ currentUser, onRefresh }) {
  const a = useUserAdmin({ currentUser, onRefresh });
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [create, setCreate] = useState(null);
  const [roleTarget, setRoleTarget] = useState(null);
  const [newRole, setNewRole] = useState('');
  const [deact, setDeact] = useState(null);
  const [reason, setReason] = useState('');

  const visible = a.users.filter(u => {
    const st = u.status || 'active';
    if (filter === 'active' && st !== 'active') return false;
    if (filter === 'deactivated' && st !== 'deactivated') return false;
    if (filter === 'pending' && u.role !== 'pending') return false;
    const q = search.trim().toLowerCase();
    return !q || `${u.email || ''} ${u.full_name || ''}`.toLowerCase().includes(q);
  });

  return (
    <div className="content">
      <PageHeader title="Users" description="Every sign in account and its role. Deactivating signs someone out everywhere but keeps all of their records."
        actions={<button className="btn btn-primary" onClick={() => setCreate({ ...BLANK })}>Invite user</button>} />
      {(a.counts.activeOwners ?? 0) <= 1 && !a.loading && (
        <Alert tone="info" style={{ marginBottom: 16 }}>You're the only active owner. Make someone else an owner before you could ever be locked out.</Alert>
      )}
      <div className="toolbar">
        <div className="chip-row">
          {[['all', 'All', a.counts.total], ['active', 'Active', a.counts.active], ['pending', 'Waiting for a role', a.counts.pending], ['deactivated', 'Deactivated', a.counts.deactivated]].map(([id, l, n]) => (
            <button key={id} className="chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>{l} <span className="text-muted">{n ?? 0}</span></button>
          ))}
        </div>
        <label className="toolbar-search" style={{ maxWidth: 320 }}><Icon icon={Search01Icon} size={16} /><span className="sr-only">Search users</span><input className="form-input" type="search" placeholder="Search name or email" value={search} onChange={e => setSearch(e.target.value)} /></label>
      </div>
      {a.loading ? <SkeletonTable rows={8} cols={5} /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Linked record</th><th>Joined</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {visible.map(u => {
                const linked = u.linked_creator || u.linked_manager || u.linked_client;
                const off = u.status === 'deactivated';
                const locked = a.isSelf(u) || a.onlyOwner(u);
                return (
                  <tr key={u.id} style={off ? { opacity: 0.6 } : undefined}>
                    <td><span className="flex-center gap-12"><span className="avatar">{getInitials(u.full_name || u.email)}</span><span style={{ minWidth: 0 }}>
                      <span className="fw-600 truncate" style={{ display: 'block', color: 'var(--ink)', maxWidth: 260 }}>{u.full_name || u.email.split('@')[0]}{a.isSelf(u) && <span className="text-muted fw-500"> (you)</span>}</span>
                      <span className="fs-12 text-muted truncate" style={{ display: 'block', maxWidth: 260 }}>{u.email}</span></span></span></td>
                    <td><span className={`badge badge-${ROLE_TONE[u.role] || 'gray'}`}>{ROLE_LABEL[u.role] || u.role}</span>{u.role === 'pending' && u.requested_role && <div className="fs-12 text-muted mt-4">asked for {(ROLE_LABEL[u.requested_role] || u.requested_role).toLowerCase()}</div>}</td>
                    <td>{off ? <span className="badge badge-red" title={u.deactivation_reason || ''}>Deactivated</span> : <span className="badge badge-green">Active</span>}</td>
                    <td className="text-muted">{linked ? `${u.linked_creator ? 'Creator' : u.linked_manager ? 'Manager' : 'Brand'} · ${linked.status || 'no status'}` : 'None'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(u.created_at)}</td>
                    <td className="num"><span className="flex gap-4" style={{ justifyContent: 'flex-end' }}>
                      {!off && <button className="btn btn-ghost btn-sm" disabled={a.working || a.isSelf(u)} title={a.isSelf(u) ? "You can't change your own role" : undefined} onClick={() => { setRoleTarget(u); setNewRole(u.role === 'account_manager' ? 'am' : u.role); }}>Change role</button>}
                      {off ? <button className="btn btn-secondary btn-sm" disabled={a.working} onClick={() => a.restore(u)}>Restore</button>
                        : <button className="btn btn-ghost btn-sm" disabled={a.working || locked} title={a.isSelf(u) ? "You can't deactivate yourself" : a.onlyOwner(u) ? 'This is the only active owner' : undefined} onClick={() => { setDeact(u); setReason(''); }}>Deactivate</button>}
                    </span></td>
                  </tr>
                );
              })}
              {visible.length === 0 && <tr><td colSpan={6} className="text-center text-muted" style={{ padding: 32 }}>No users match. Try another filter or search.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {create && (
        <Dialog title="Invite a user" description="They get an email to set their own password. Creators and account managers get their working record straight away." onClose={() => setCreate(null)}
          actions={<><button className="btn btn-secondary" onClick={() => setCreate(null)}>Cancel</button><button className="btn btn-primary" disabled={a.working || !create.email.trim()} onClick={async () => { if (await a.createUser(create)) setCreate(null); }}>{a.working ? 'Inviting…' : 'Send invite'}</button></>}>
          <div className="form-group"><label className="form-label" htmlFor="u-email">Email</label><input id="u-email" className="form-input" type="email" inputMode="email" value={create.email} onChange={e => setCreate({ ...create, email: e.target.value })} autoFocus /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label" htmlFor="u-name">Full name <span className="text-muted" style={{ fontWeight: 400 }}>(optional)</span></label><input id="u-name" className="form-input" value={create.fullName} onChange={e => setCreate({ ...create, fullName: e.target.value })} /></div>
            <div className="form-group"><label className="form-label" htmlFor="u-role">Role</label><select id="u-role" className="select" value={create.role} onChange={e => setCreate({ ...create, role: e.target.value })}>{ASSIGNABLE.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></div>
          </div>
          <label className="check"><input type="checkbox" checked={create.sendInvite} onChange={e => setCreate({ ...create, sendInvite: e.target.checked })} /><span>Email them an invite link</span></label>
          {!create.sendInvite && <p className="form-hint mt-8" style={{ color: 'var(--amber)' }}>Without an invite they can't sign in until you send a password reset.</p>}
        </Dialog>
      )}

      {roleTarget && (
        <Dialog size="sm" title="Change role" description={roleTarget.email} onClose={() => setRoleTarget(null)}
          actions={<><button className="btn btn-secondary" onClick={() => setRoleTarget(null)}>Cancel</button><button className="btn btn-primary" disabled={a.working || !newRole || newRole === roleTarget.role} onClick={async () => { if (await a.changeRole(roleTarget, newRole)) setRoleTarget(null); }}>{a.working ? 'Saving…' : 'Change role'}</button></>}>
          <div className="form-group"><label className="form-label" htmlFor="u-newrole">New role</label><select id="u-newrole" className="select" value={newRole} onChange={e => setNewRole(e.target.value)}>{ASSIGNABLE.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></div>
          {newRole === 'owner' && <Alert tone="warning">Owners can do everything, including changing other owners.</Alert>}
          <p className="fs-12 text-muted mt-8">The change is recorded in the audit history with your name.</p>
        </Dialog>
      )}

      {deact && (
        <Dialog title={`Deactivate ${deact.full_name || deact.email}?`} description="They're signed out right away and can't sign back in. Their work, earnings and history stay, and you can restore them with the same role." onClose={() => setDeact(null)}
          actions={<><button className="btn btn-secondary" onClick={() => setDeact(null)}>Cancel</button><button className="btn btn-danger" disabled={a.working || !reason.trim()} onClick={async () => { if (await a.deactivate(deact, reason)) setDeact(null); }}>{a.working ? 'Deactivating…' : 'Deactivate'}</button></>}>
          <div className="form-group"><label className="form-label" htmlFor="u-reason">Reason</label><textarea id="u-reason" className="textarea" rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="Left the agency on 20 August" autoFocus /></div>
        </Dialog>
      )}
    </div>
  );
}
