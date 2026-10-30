import { useCallback, useEffect, useState } from 'react';
import { gooeyToast as toast } from 'goey-toast';
import { supabase } from '../../supabaseClient';

export const ROLE_LABEL = { owner: 'Owner', am: 'Account manager', account_manager: 'Account manager', creator: 'Creator', client: 'Brand', pending: 'Waiting for a role', denied: 'Denied' };

// Lifecycle actions go through /api/admin/users/*; the direct writes are the local fallback when the API isn't served.
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

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('API_NOT_AVAILABLE');
  }

  let payload = null;
  try { payload = await res.json(); } catch (_) {}

  if (!res.ok || !payload || payload?.ok === false) {
    throw new Error(payload?.error?.message || payload?.message || `Request failed (${res.status})`);
  }
  return payload?.data ?? payload;
}

export default function useUserAdmin({ currentUser, onRefresh }) {
  const [users, setUsers] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);





  const load = useCallback(async () => {
    setLoading(true);
    try {
      let data = null;
      try {
        data = await callApi('/api/admin/users', { method: 'GET' });
      } catch (apiErr) {
        console.warn('[UserManagement] /api/admin/users unavailable, falling back to direct Supabase query:', apiErr.message);
      }

      if (data && data.users) {
        setUsers(data.users || []);
        setCounts(data.counts || {});
        return;
      }

      // Direct Supabase fallback: Owner has full read access to user_profiles and domain tables
      const { data: profiles, error } = await supabase
        .from('user_profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const ids = (profiles || []).map((p) => p.id).filter(Boolean);

      const [{ data: creators }, { data: managers }, { data: clients }] = await Promise.all([
        supabase.from('creators').select('id, user_id, name, status').in('user_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']),
        supabase.from('account_managers').select('id, user_id, name, status').in('user_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']),
        supabase.from('clients').select('id, user_id, name, status').in('user_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']),
      ]);

      const creatorByUser = new Map((creators || []).map((c) => [c.user_id, c]));
      const managerByUser = new Map((managers || []).map((m) => [m.user_id, m]));
      const clientByUser = new Map((clients || []).map((c) => [c.user_id, c]));

      const resolvedUsers = (profiles || []).map((p) => ({
        ...p,
        status: p.status || 'active',
        linked_creator: creatorByUser.get(p.id) || null,
        linked_manager: managerByUser.get(p.id) || null,
        linked_client: clientByUser.get(p.id) || null,
      }));

      const activeOwners = resolvedUsers.filter(
        (u) => ['owner', 'admin'].includes(u.role) && (u.status === 'active' || !u.status)
      ).length;

      setUsers(resolvedUsers);
      setCounts({
        total: resolvedUsers.length,
        active: resolvedUsers.filter((u) => (u.status || 'active') === 'active').length,
        deactivated: resolvedUsers.filter((u) => u.status === 'deactivated').length,
        pending: resolvedUsers.filter((u) => u.role === 'pending').length,
        activeOwners,
      });
    } catch (err) {
      toast.error("Couldn't load users", { description: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const refreshAll = async () => {
    await load();
    if (onRefresh) await onRefresh();
  };

  const isSelf = (u) => u?.id === currentUser?.id;
  const onlyOwner = (u) =>
    ['owner', 'admin'].includes(u?.role) && (counts.activeOwners ?? 0) <= 1;


  const createUser = async (createForm) => {
    setWorking(true);
    try {
      const data = await callApi('/api/admin/users/create', { body: createForm });
      toast.success(data.message || 'User created');
      await refreshAll();
      return true;
    } catch (err) {
      if (err.message === 'API_NOT_AVAILABLE') {
        toast.error('Invites need the API server', { description: 'User invitation requires the backend API server. In local dev, run "node tests/lib/devServer.cjs" (port 3100) or deploy to Vercel to send user invites.' }); return false;
      } else {
        toast.error("That didn't work", { description: err.message }); return false;
      }
    } finally {
      setWorking(false);
    }
  };

  const changeRole = async (roleTarget, newRole) => {
    setWorking(true);
    try {
      let successMsg = '';
      try {
        const data = await callApi('/api/admin/users/role', {
          body: { userId: roleTarget.id, role: newRole },
        });
        successMsg = data.message;
      } catch (apiErr) {
        console.warn('[UserManagement] API unavailable for role change, falling back to direct Supabase:', apiErr.message);

        if (isSelf(roleTarget)) {
          throw new Error('You cannot change your own role.');
        }
        if (!['owner', 'admin'].includes(newRole) && onlyOwner(roleTarget)) {
          throw new Error('Cannot demote the only active owner.');
        }

        const patch = {
          role: newRole,
          role_changed_by: currentUser?.id,
          role_changed_at: new Date().toISOString(),
        };
        const { data: updated, error } = await supabase
          .from('user_profiles')
          .update(patch)
          .eq('id', roleTarget.id)
          .select('id, email, full_name, role')
          .maybeSingle();

        if (error) throw error;

        const displayName = updated?.full_name || roleTarget.full_name || (roleTarget.email || '').split('@')[0];

        if (newRole === 'creator') {
          await supabase.from('creators').upsert(
            { user_id: roleTarget.id, email: roleTarget.email, name: displayName, status: 'Active' },
            { onConflict: 'email' }
          );
        } else if (newRole === 'am' || newRole === 'account_manager') {
          await supabase.from('account_managers').upsert(
            { user_id: roleTarget.id, email: roleTarget.email, name: displayName, status: 'Active' },
            { onConflict: 'email' }
          );
        } else if (newRole === 'client') {
          await supabase.from('clients').upsert(
            { user_id: roleTarget.id, contact_email: roleTarget.email, name: displayName, status: 'Active' },
            { onConflict: 'user_id' }
          );
        }
        successMsg = `${roleTarget.email} is now ${ROLE_LABEL[newRole] || newRole}.`;
      }

      toast.success(successMsg);
      await refreshAll();
      return true;
    } catch (err) {
      toast.error("That didn't work", { description: err.message }); return false;
    } finally {
      setWorking(false);
    }
  };

  const deactivate = async (deactivateTarget, deactivateReason) => {
    setWorking(true);
    try {
      let successMsg = '';
      try {
        const data = await callApi('/api/admin/users/deactivate', {
          body: { userId: deactivateTarget.id, reason: deactivateReason.trim() },
        });
        successMsg = data.message;
      } catch (apiErr) {
        console.warn('[UserManagement] API unavailable for deactivation, falling back to direct Supabase:', apiErr.message);

        if (isSelf(deactivateTarget)) {
          throw new Error('You cannot deactivate your own account.');
        }
        if (onlyOwner(deactivateTarget)) {
          throw new Error('Cannot deactivate the only active owner.');
        }

        const patch = {
          status: 'deactivated',
          role_before_deactivation: deactivateTarget.role,
          deactivated_at: new Date().toISOString(),
          deactivated_by: currentUser?.id,
          deactivation_reason: deactivateReason.trim(),
        };
        const { error } = await supabase.from('user_profiles').update(patch).eq('id', deactivateTarget.id);
        if (error) throw error;

        await Promise.allSettled([
          supabase.from('creators').update({ status: 'Offboarded' }).eq('user_id', deactivateTarget.id),
          supabase.from('account_managers').update({
            status: 'Archived',
            archived_at: new Date().toISOString(),
            archived_by: currentUser?.id,
            archive_reason: deactivateReason.trim(),
          }).eq('user_id', deactivateTarget.id),
          supabase.from('clients').update({ status: 'Inactive' }).eq('user_id', deactivateTarget.id),
        ]);

        successMsg = `${deactivateTarget.email} is deactivated. Their records are kept and they can be restored.`;
      }

      toast.success(successMsg);
      await refreshAll();
      return true;
    } catch (err) {
      toast.error("That didn't work", { description: err.message }); return false;
    } finally {
      setWorking(false);
    }
  };

  const restore = async (u) => {
    setWorking(true);
    try {
      let successMsg = '';
      try {
        const data = await callApi('/api/admin/users/restore', { body: { userId: u.id } });
        successMsg = data.message;
      } catch (apiErr) {
        console.warn('[UserManagement] API unavailable for restore, falling back to direct Supabase:', apiErr.message);

        const restoredRole = u.role_before_deactivation || (u.role === 'pending' ? 'creator' : u.role) || 'pending';
        const patch = {
          status: 'active',
          role: restoredRole,
          deactivated_at: null,
          deactivated_by: null,
          deactivation_reason: null,
          role_before_deactivation: null,
        };
        if (restoredRole !== u.role) {
          patch.role_changed_by = currentUser?.id;
          patch.role_changed_at = new Date().toISOString();
        }
        const { error } = await supabase.from('user_profiles').update(patch).eq('id', u.id);
        if (error) throw error;

        const displayName = u.full_name || (u.email || '').split('@')[0];
        if (restoredRole === 'creator') {
          await supabase.from('creators').upsert(
            { user_id: u.id, email: u.email, name: displayName, status: 'Active' },
            { onConflict: 'email' }
          );
        } else if (restoredRole === 'am' || restoredRole === 'account_manager') {
          await supabase.from('account_managers').upsert(
            {
              user_id: u.id, email: u.email, name: displayName,
              status: 'Active', archived_at: null, archived_by: null, archive_reason: null,
            },
            { onConflict: 'email' }
          );
        } else if (restoredRole === 'client') {
          await supabase.from('clients').upsert(
            { user_id: u.id, contact_email: u.email, name: displayName, status: 'Active' },
            { onConflict: 'user_id' }
          );
        }

        successMsg = `${u.email} is active again as ${ROLE_LABEL[restoredRole] || restoredRole}.`;
      }

      toast.success(successMsg);
      await refreshAll();
      return true;
    } catch (err) {
      toast.error("That didn't work", { description: err.message }); return false;
    } finally {
      setWorking(false);
    }
  };

  return { users, counts, loading, working, isSelf, onlyOwner, createUser, changeRole, deactivate, restore };
}
