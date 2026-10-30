import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDown01Icon, Archive02Icon, ClipboardIcon, Key01Icon, MoneyReceive02Icon, Package01Icon,
  RotateLeft01Icon, UserBlock01Icon, Video01Icon,
} from '@hugeicons/core-free-icons';
import { supabase } from '../supabaseClient';
import Alert from '../ui/Alert';
import EmptyState from '../ui/EmptyState';
import Icon from '../ui/Icon';
import PageHeader from '../ui/PageHeader';
import { SkeletonTable } from '../ui/Skeleton';
import { EMPTY, fmtRelativeTime } from '../utils';

// Null when the API layer isn't running (local CRA answers with index.html).
async function getJson(path) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Your session has expired. Sign in again.');
  const res = await fetch(path, { headers: { Authorization: `Bearer ${session.access_token}` } });
  if (!(res.headers.get('content-type') || '').includes('application/json')) return null;
  const payload = await res.json().catch(() => null);
  if (!res.ok || payload?.ok === false) throw new Error(payload?.error?.message || payload?.message || `Request failed (${res.status})`);
  return payload?.data ?? payload;
}

const FILTERS = [
  { id: '', label: 'Everything' },
  { id: 'user', label: 'Users and roles' },
  { id: 'submission', label: 'Content reviews' },
  { id: 'campaign', label: 'Campaigns' },
  { id: 'client', label: 'Clients' },
  { id: 'withdrawal_request', label: 'Withdrawals' },
  { id: 'payout_batch', label: 'Payout batches' },
  { id: 'payment', label: 'Payments' },
];

const KIND = {
  role_changed: [Key01Icon, 'amber'], payment_manager_granted: [Key01Icon, 'amber'], payment_manager_revoked: [Key01Icon, 'red'],
  user_deactivated: [UserBlock01Icon, 'red'], payment_voided: [UserBlock01Icon, 'red'], reject_withdrawal: [UserBlock01Icon, 'red'],
  user_restored: [RotateLeft01Icon, 'green'], campaign_restored: [RotateLeft01Icon], client_restored: [RotateLeft01Icon], account_manager_restored: [RotateLeft01Icon],
  campaign_archived: [Archive02Icon, 'amber'], client_archived: [Archive02Icon, 'amber'], account_manager_archived: [Archive02Icon, 'amber'],
  concept_review: [Video01Icon], final_review: [Video01Icon], submission_review: [Video01Icon],
  approve_withdrawal: [MoneyReceive02Icon, 'green'], withdrawal_requested: [MoneyReceive02Icon], batch_marked_paid: [MoneyReceive02Icon, 'green'],
  batch_created: [Package01Icon], export_batch: [Package01Icon],
};

const when = (e) => e.occurred_at || e.created_at;
const fullTime = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const dayLabel = (iso) => {
  const d = new Date(iso); const today = new Date();
  const diff = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / 86400000);
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
};

function Row({ e, open, onToggle }) {
  const [icon, tone] = KIND[e.action] || [ClipboardIcon];
  return (
    <li className={`audit-row ${open ? 'open' : ''}`}>
      <button type="button" className="audit-hit" aria-expanded={open} onClick={onToggle}>
        <span className={`audit-icon ${tone ? `tone-${tone}` : ''}`}><Icon icon={icon} size={16} /></span>
        <span className="audit-main">
          <span className="audit-summary">{e.summary}</span>
          {e.reason && <span className="audit-reason">"{e.reason}"</span>}
        </span>
        <span className="audit-time" data-tip={fullTime(when(e))}>{fmtRelativeTime(when(e))}</span>
        <Icon icon={ArrowDown01Icon} size={14} className="audit-caret" />
      </button>
      {open && (
        <dl className="kv audit-detail">
          <dt>When</dt><dd>{fullTime(when(e))}</dd>
          <dt>By</dt><dd>{e.actor_email || e.actor_label || EMPTY}{e.actor_role ? ` · ${e.actor_role}` : ''}</dd>
          <dt>Action</dt><dd className="mono">{e.action}</dd>
          <dt>Target</dt><dd className="mono">{e.entity_type}{e.entity_id ? ` · ${e.entity_id}` : ''}</dd>
          {(e.from_value || e.to_value) && <><dt>Change</dt><dd>{e.from_value ?? EMPTY} to {e.to_value ?? EMPTY}</dd></>}
          {e.metadata && Object.keys(e.metadata).length > 0 && <><dt>Detail</dt><dd className="mono fs-12">{JSON.stringify(e.metadata)}</dd></>}
        </dl>
      )}
    </li>
  );
}

export default function AuditHistory() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [nextBefore, setNextBefore] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const url = useCallback((before) => {
    const params = new URLSearchParams({ limit: '50' });
    if (filter) params.set('entityType', filter);
    if (before) params.set('before', before);
    return `/api/admin/audit?${params}`;
  }, [filter]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await getJson(url(null));
      if (data && Array.isArray(data.events)) {
        setEvents(data.events);
        setNextBefore(data.hasMore ? data.nextBefore : null);
      } else {
        let q = supabase.from('admin_audit_logs').select('*').order('created_at', { ascending: false }).limit(50);
        if (filter) q = q.eq('entity_type', filter);
        const { data: rows, error: e } = await q;
        if (e) throw e;
        setEvents((rows || []).map(r => ({ ...r, source: 'admin', actor_label: r.actor_email || 'Owner', summary: `${r.actor_email || 'Owner'} performed ${r.action || 'an action'}` })));
        setNextBefore(null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [url, filter]);

  useEffect(() => { load(); }, [load]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const data = await getJson(url(nextBefore));
      if (data?.events) { setEvents(prev => [...prev, ...data.events]); setNextBefore(data.hasMore ? data.nextBefore : null); }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  };

  const days = [];
  events.forEach(e => {
    const label = dayLabel(when(e));
    if (days[days.length - 1]?.label !== label) days.push({ label, items: [] });
    days[days.length - 1].items.push(e);
  });
  const key = (e) => `${e.source || ''}-${e.id}`;

  return (
    <div className="content">
      <PageHeader title="Audit history" description="Every privileged action, who took it and when. The database writes these entries and they can't be edited or removed." />
      <div className="chip-row mb-16" role="group" aria-label="Filter by area">
        {FILTERS.map(f => <button key={f.id || 'all'} type="button" className="chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>)}
      </div>

      {error && <Alert tone="error" title="The history didn't load" action={<button className="btn btn-secondary btn-sm" onClick={load}>Try again</button>} style={{ marginBottom: 16 }}>{error}</Alert>}

      {loading ? <SkeletonTable rows={8} cols={3} /> : events.length === 0 ? (
        !error && <div className="card"><EmptyState icon={ClipboardIcon} title={filter ? 'Nothing in this area yet' : 'Nothing recorded yet'}>
          {filter ? 'Try another filter, or check back after someone takes an action here.' : 'Privileged actions show up here as they happen. If this stays empty on a live system, the audit migration may not be applied.'}
        </EmptyState></div>
      ) : (
        <div className="flex-col gap-24">
          {days.map(d => (
            <section key={d.label}>
              <h2 className="audit-day">{d.label}</h2>
              <ul className="card flush audit-list">
                {d.items.map(e => <Row key={key(e)} e={e} open={expanded === key(e)} onToggle={() => setExpanded(expanded === key(e) ? null : key(e))} />)}
              </ul>
            </section>
          ))}
          {nextBefore && (
            <div className="text-center">
              <button className="btn btn-secondary" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load older entries'}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
