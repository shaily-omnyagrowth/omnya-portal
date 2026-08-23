/* eslint-disable */
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { fmtDate, getInitials, getAvatarColor } from '../utils';
import LoadingSpinner from '../components/LoadingSpinner';

// ─────────────────────────────────────────────────────────────────────────────
// USER MANAGEMENT — scope §6.1
//
//   "Create, view, edit, deactivate/delete and restore users according to
//    data-retention policy."
//
// Only "view" existed, and "edit" only while the account sat in `pending`.
// Once a role was assigned there was no screen anywhere that could change it,
// suspend the account, or bring it back.
//
// WHY DELETE IS NOT A BUTTON HERE
//
// §6.1's own verb list settles it: "deactivate/delete AND RESTORE". You cannot
// restore a hard-deleted row, so deletion in this portal has always meant a
// reversible state change. §11.1 says the same thing from the data side. The
// database now refuses the irreversible kind outright.
//
// Erasure proper is deliberately absent: §6.1 makes it conditional on a
// data-retention policy, and Appendix C still lists that policy as an open
// decision. Building it before somebody decides the rule would be guessing.
// ─────────────────────────────────────────────────────────────────────────────

async function callApi(path, { method = 'POST', body = null } = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Your session has expired. Sign in again.');

  const res = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  let payload = null;
  try { payload = await res.json(); } catch (_) {}

  if (!res.ok || payload?.ok === false) {
    throw new Error(payload?.error?.message || payload?.message || `Request failed (${res.status})`);
  }
  return payload?.data ?? payload;
}

const ROLE_LABEL = {
  owner: 'Owner',
  am: 'Account Manager',
  account_manager: 'Account Manager',
  creator: 'Creator',
  client: 'Client',
  pending: 'Pending approval',
  denied: 'Denied',
};

const ROLE_COLOR = {
  owner: 'badge-gold',
  am: 'badge-blue',
  account_manager: 'badge-blue',
  creator: 'badge-green',
  client: 'badge-orange',
  pending: 'badge-gray',
  denied: 'badge-red',
};

// Roles an owner may assign. 'denied' is reachable from the pending queue, not
// from here — refusing an application and suspending an active account are
// different actions and should not share a control.
const ASSIGNABLE = ['creator', 'am', 'client', 'owner', 'pending'];

function Banner({ message, type, onDismiss }) {
  if (!message) return null;
  const palette = {
    error:   { bg: 'rgba(192,57,43,0.08)',  border: 'var(--red)',   color: 'var(--red)' },
    success: { bg: 'rgba(26,122,74,0.08)',  border: 'var(--green)', color: 'var(--green)' },
    info:    { bg: 'var(--bg2)',            border: 'var(--border)',color: 'var(--ink2)' },
  }[type] || {};
  return (
    <div style={{
      background: palette.bg, border: `1px solid ${palette.border}`,
      borderRadius: 'var(--radius-sm)', padding: '10px 14px', marginBottom: 16,
      fontSize: 13, color: palette.color, display: 'flex',
      justifyContent: 'space-between', alignItems: 'flex-start', gap: 12,
    }}>
      <span>{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 16, lineHeight: 1 }}
          aria-label="Dismiss"
        >×</button>
      )}
    </div>
  );
}

export default function UserManagement({ currentUser, onRefresh }) {
  const [users, setUsers] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [msg, setMsg] = useState({ text: '', type: '' });

  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ email: '', fullName: '', role: 'creator', sendInvite: true });

  const [roleTarget, setRoleTarget] = useState(null);
  const [newRole, setNewRole] = useState('');

  const [deactivateTarget, setDeactivateTarget] = useState(null);
  const [deactivateReason, setDeactivateReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await callApi('/api/admin/users', { method: 'GET' });
      setUsers(data.users || []);
      setCounts(data.counts || {});
    } catch (err) {
      setMsg({ text: `Could not load users: ${err.message}`, type: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const refreshAll = async () => {
    await load();
    if (onRefresh) await onRefresh();
  };

  // ─── actions ───────────────────────────────────────────────────────────────

  const createUser = async () => {
    setWorking(true);
    setMsg({ text: '', type: '' });
    try {
      const data = await callApi('/api/admin/users/create', { body: createForm });
      setMsg({ text: data.message, type: 'success' });
      setShowCreate(false);
      setCreateForm({ email: '', fullName: '', role: 'creator', sendInvite: true });
      await refreshAll();
    } catch (err) {
      setMsg({ text: err.message, type: 'error' });
    } finally {
      setWorking(false);
    }
  };

  const changeRole = async () => {
    setWorking(true);
    setMsg({ text: '', type: '' });
    try {
      const data = await callApi('/api/admin/users/role', {
        body: { userId: roleTarget.id, role: newRole },
      });
      setMsg({ text: data.message, type: 'success' });
      setRoleTarget(null);
      await refreshAll();
    } catch (err) {
      setMsg({ text: err.message, type: 'error' });
    } finally {
      setWorking(false);
    }
  };

  const deactivate = async () => {
    setWorking(true);
    setMsg({ text: '', type: '' });
    try {
      const data = await callApi('/api/admin/users/deactivate', {
        body: { userId: deactivateTarget.id, reason: deactivateReason.trim() },
      });
      setMsg({ text: data.message, type: 'success' });
      setDeactivateTarget(null);
      setDeactivateReason('');
      await refreshAll();
    } catch (err) {
      setMsg({ text: err.message, type: 'error' });
    } finally {
      setWorking(false);
    }
  };

  const restore = async (u) => {
    setWorking(true);
    setMsg({ text: '', type: '' });
    try {
      const data = await callApi('/api/admin/users/restore', { body: { userId: u.id } });
      setMsg({ text: data.message, type: 'success' });
      await refreshAll();
    } catch (err) {
      setMsg({ text: err.message, type: 'error' });
    } finally {
      setWorking(false);
    }
  };

  // ─── derived ───────────────────────────────────────────────────────────────

  const visible = users.filter((u) => {
    if (filter === 'active' && u.status !== 'active') return false;
    if (filter === 'deactivated' && u.status !== 'deactivated') return false;
    if (filter === 'pending' && u.role !== 'pending') return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (u.email || '').toLowerCase().includes(q)
        || (u.full_name || '').toLowerCase().includes(q);
  });

  const isSelf = (u) => u.id === currentUser?.id;
  const onlyOwner = (u) =>
    ['owner', 'admin'].includes(u.role) && (counts.activeOwners ?? 0) <= 1;

  if (loading) return <LoadingSpinner label="Loading users…" />;

  return (
    <div className="content">
      <div className="flex-between" style={{ marginBottom: 8, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>User Management</h2>
          <p style={{ color: 'var(--ink3)', fontSize: 13, margin: 0 }}>
            Create accounts, change roles, and suspend or restore access. Nothing here deletes a record.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Create User</button>
      </div>

      <Banner message={msg.text} type={msg.type} onDismiss={() => setMsg({ text: '', type: '' })} />

      {/* Counts double as filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        {[
          { id: 'all',         label: 'All',          n: counts.total },
          { id: 'active',      label: 'Active',       n: counts.active },
          { id: 'pending',     label: 'Awaiting role',n: counts.pending },
          { id: 'deactivated', label: 'Deactivated',  n: counts.deactivated },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setFilter(t.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
              background: filter === t.id ? 'var(--ink)' : 'var(--bg2)',
              color: filter === t.id ? '#fff' : 'var(--ink)',
              border: `1px solid ${filter === t.id ? 'var(--ink)' : 'var(--border)'}`,
              borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 13, fontWeight: 500,
            }}
          >
            {t.label}
            <span style={{
              background: filter === t.id ? 'rgba(255,255,255,0.2)' : 'var(--border)',
              borderRadius: 20, padding: '1px 8px', fontSize: 11, fontWeight: 700,
            }}>{t.n ?? 0}</span>
          </button>
        ))}
      </div>

      <input
        className="form-input"
        placeholder="Search by name or email…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 16, maxWidth: 380 }}
      />

      {/* The only-owner warning is worth stating before somebody tries. */}
      {(counts.activeOwners ?? 0) <= 1 && (
        <Banner
          type="info"
          message="There is only one active owner. Promote a second before deactivating or demoting them — otherwise nobody can undo it."
        />
      )}

      <div className="premium-card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="table" style={{ minWidth: 760 }}>
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Status</th>
              <th>Linked record</th>
              <th>Joined</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((u) => {
              const linked = u.linked_creator || u.linked_manager;
              const deactivated = u.status === 'deactivated';
              const locked = isSelf(u) || onlyOwner(u);

              return (
                <tr key={u.id} style={deactivated ? { opacity: 0.62 } : undefined}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div className={`creator-avatar ${getAvatarColor(u.full_name || u.email)}`}
                           style={{ width: 30, height: 30, fontSize: 11 }}>
                        {getInitials(u.full_name || u.email)}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div className="fw-600" style={{ fontSize: 13 }}>
                          {u.full_name || '—'}
                          {isSelf(u) && <span style={{ fontSize: 11, color: 'var(--ink3)', marginLeft: 6 }}>(you)</span>}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--ink3)', wordBreak: 'break-all' }}>{u.email}</div>
                      </div>
                    </div>
                  </td>

                  <td>
                    <span className={`badge ${ROLE_COLOR[u.role] || 'badge-gray'}`}>
                      {ROLE_LABEL[u.role] || u.role}
                    </span>
                    {u.role === 'pending' && u.requested_role && (
                      <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 3 }}>
                        asked for {ROLE_LABEL[u.requested_role] || u.requested_role}
                      </div>
                    )}
                  </td>

                  <td>
                    {deactivated ? (
                      <>
                        <span className="badge badge-red">Deactivated</span>
                        {u.deactivation_reason && (
                          <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 3, maxWidth: 220 }}>
                            {u.deactivation_reason}
                          </div>
                        )}
                      </>
                    ) : <span className="badge badge-green">Active</span>}
                  </td>

                  <td style={{ fontSize: 12, color: 'var(--ink3)' }}>
                    {linked ? `${u.linked_creator ? 'Creator' : 'Manager'} · ${linked.status || '—'}` : '—'}
                  </td>

                  <td style={{ fontSize: 12, color: 'var(--ink3)' }}>{fmtDate(u.created_at)}</td>

                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      {!deactivated && (
                        <button
                          className="btn btn-sm btn-ghost"
                          disabled={working || isSelf(u)}
                          title={isSelf(u) ? 'You cannot change your own role' : 'Change role'}
                          onClick={() => { setRoleTarget(u); setNewRole(u.role === 'account_manager' ? 'am' : u.role); }}
                        >Role</button>
                      )}

                      {!deactivated ? (
                        <button
                          className="btn btn-sm btn-ghost"
                          style={{ color: locked ? 'var(--ink3)' : 'var(--red)' }}
                          disabled={working || locked}
                          title={
                            isSelf(u) ? 'You cannot deactivate your own account'
                            : onlyOwner(u) ? 'This is the only active owner'
                            : 'Suspend access — the record is kept'
                          }
                          onClick={() => { setDeactivateTarget(u); setDeactivateReason(''); }}
                        >Deactivate</button>
                      ) : (
                        <button
                          className="btn btn-sm btn-green"
                          disabled={working}
                          onClick={() => restore(u)}
                        >Restore</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {visible.length === 0 && (
          <div className="empty" style={{ padding: 40 }}>
            <div className="empty-icon">👥</div>
            <h3>No users match</h3>
            <p>Try a different filter or search.</p>
          </div>
        )}
      </div>

      {/* ─── Create ──────────────────────────────────────────────────────── */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Create User</div>
            <div className="modal-sub">
              Sends an invitation so they set their own password. No password is
              ever typed here or stored by the portal.
            </div>

            <div className="form-group">
              <label className="form-label">Email <span style={{ color: 'var(--red)' }}>*</span></label>
              <input
                className="form-input" type="email" placeholder="person@example.com"
                value={createForm.email}
                onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Full name</label>
              <input
                className="form-input" placeholder="Optional"
                value={createForm.fullName}
                onChange={(e) => setCreateForm({ ...createForm, fullName: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Role</label>
              <select
                className="select" value={createForm.role}
                onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })}
              >
                {ASSIGNABLE.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
              <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 6 }}>
                Creator and Account Manager also get their linked record created,
                so they can start work immediately.
              </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8, cursor: 'pointer' }}>
              <input
                type="checkbox" checked={createForm.sendInvite}
                onChange={(e) => setCreateForm({ ...createForm, sendInvite: e.target.checked })}
              />
              Email them an invitation link
            </label>
            {!createForm.sendInvite && (
              <div style={{ fontSize: 11, color: 'var(--orange)', marginBottom: 8 }}>
                Without an invite they cannot sign in until you send a password reset.
              </div>
            )}

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={createUser}
                disabled={working || !createForm.email.trim()}
              >{working ? 'Creating…' : 'Create User'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Change role ─────────────────────────────────────────────────── */}
      {roleTarget && (
        <div className="modal-overlay" onClick={() => setRoleTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Change Role</div>
            <div className="modal-sub">{roleTarget.email}</div>

            <div className="form-group">
              <label className="form-label">New role</label>
              <select className="select" value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                {ASSIGNABLE.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </div>

            {newRole === 'owner' && (
              <div style={{ fontSize: 12, color: 'var(--orange)', marginBottom: 12 }}>
                Owners can do everything, including changing other owners' roles.
              </div>
            )}

            <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 12 }}>
              Recorded on the audit trail with your name and the previous role.
            </div>

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setRoleTarget(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={changeRole}
                disabled={working || !newRole || newRole === roleTarget.role}
              >{working ? 'Saving…' : 'Change Role'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Deactivate ──────────────────────────────────────────────────── */}
      {deactivateTarget && (
        <div className="modal-overlay" onClick={() => setDeactivateTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Deactivate {deactivateTarget.full_name || deactivateTarget.email}?</div>
            <div className="modal-sub">
              They are signed out immediately and cannot sign back in. Their
              submissions, earnings and history are kept, and you can restore
              them with their role intact.
            </div>

            <div className="form-group">
              <label className="form-label">Reason <span style={{ color: 'var(--red)' }}>*</span></label>
              <textarea
                className="textarea" rows={3}
                placeholder="e.g. Left the agency on 20 August"
                value={deactivateReason}
                onChange={(e) => setDeactivateReason(e.target.value)}
              />
            </div>

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setDeactivateTarget(null)}>Cancel</button>
              <button
                className="btn"
                style={{ background: 'var(--red)', color: '#fff' }}
                onClick={deactivate}
                disabled={working || !deactivateReason.trim()}
              >{working ? 'Deactivating…' : 'Deactivate'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
