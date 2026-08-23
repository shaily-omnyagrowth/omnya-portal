/* eslint-disable */
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { getInitials, getAvatarColor } from '../utils';
import LoadingSpinner from '../components/LoadingSpinner';

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT HISTORY — scope §5.2 ("View audit history: Owner Yes")
//
// The events were being written all along and nothing ever showed them. Two
// journals, one history:
//
//   admin_audit_logs    role changes, deactivation, restoration, archiving,
//                       content review decisions, payment voids      (§5.1)
//   payment_audit_logs  withdrawal approve/reject, batch creation,
//                       mark-paid, exports, manager grants
//
// Both are append-only, so paging by timestamp is stable — a row can never
// shift between pages while you read.
// ─────────────────────────────────────────────────────────────────────────────

async function callApi(path) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Your session has expired. Sign in again.');

  const res = await fetch(path, {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  let payload = null;
  try { payload = await res.json(); } catch (_) {}

  if (!res.ok || payload?.ok === false) {
    throw new Error(payload?.error?.message || payload?.message || `Request failed (${res.status})`);
  }
  return payload?.data ?? payload;
}

// Grouping the filter by what someone is actually looking for, rather than by
// which table the row happens to live in.
const FILTERS = [
  { id: '',                  label: 'Everything' },
  { id: 'user',              label: 'Users & roles',   entityType: 'user' },
  { id: 'submission',        label: 'Content reviews', entityType: 'submission' },
  { id: 'campaign',          label: 'Campaigns',       entityType: 'campaign' },
  { id: 'client',            label: 'Clients',         entityType: 'client' },
  { id: 'withdrawal_request',label: 'Withdrawals',     entityType: 'withdrawal_request' },
  { id: 'payout_batch',      label: 'Payout batches',  entityType: 'payout_batch' },
  { id: 'payment',           label: 'Payments',        entityType: 'payment' },
];

const ICON = {
  role_changed: '🔑', user_deactivated: '🚫', user_restored: '↩',
  campaign_archived: '🗄', campaign_restored: '↩',
  client_archived: '🗄', client_restored: '↩',
  account_manager_archived: '🗄', account_manager_restored: '↩',
  concept_review: '📽', final_review: '🎬',
  payment_voided: '🚫',
  approve_withdrawal: '✅', reject_withdrawal: '✕', withdrawal_requested: '💸',
  batch_created: '📦', batch_marked_paid: '💰', export_batch: '📤',
  payment_manager_granted: '🔓', payment_manager_revoked: '🔒',
};

// Financial and destructive actions get a colour; routine ones stay quiet, so
// the eye lands on what matters.
const TONE = {
  user_deactivated: 'var(--red)',
  payment_voided: 'var(--red)',
  reject_withdrawal: 'var(--red)',
  payment_manager_revoked: 'var(--red)',
  role_changed: 'var(--gold)',
  campaign_archived: 'var(--orange)',
  client_archived: 'var(--orange)',
  account_manager_archived: 'var(--orange)',
  payment_manager_granted: 'var(--gold)',
  approve_withdrawal: 'var(--green)',
  batch_marked_paid: 'var(--green)',
  user_restored: 'var(--green)',
};

function relativeTime(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function fullTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function AuditHistory() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [nextBefore, setNextBefore] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const buildUrl = (before) => {
    const params = new URLSearchParams({ limit: '50' });
    const f = FILTERS.find((x) => x.id === filter);
    if (f?.entityType) params.set('entityType', f.entityType);
    if (before) params.set('before', before);
    return `/api/admin/audit?${params.toString()}`;
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await callApi(buildUrl(null));
      setEvents(data.events || []);
      setHasMore(!!data.hasMore);
      setNextBefore(data.nextBefore);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const loadMore = async () => {
    if (!nextBefore) return;
    setLoadingMore(true);
    try {
      const data = await callApi(buildUrl(nextBefore));
      setEvents((prev) => [...prev, ...(data.events || [])]);
      setHasMore(!!data.hasMore);
      setNextBefore(data.nextBefore);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="content">
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Audit History</h2>
        <p style={{ color: 'var(--ink3)', fontSize: 13, margin: 0 }}>
          Every sensitive action, with who did it and when. Entries are written
          by the database and can never be edited or removed.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button
            key={f.id || 'all'}
            onClick={() => setFilter(f.id)}
            style={{
              padding: '7px 13px',
              background: filter === f.id ? 'var(--ink)' : 'var(--bg2)',
              color: filter === f.id ? '#fff' : 'var(--ink)',
              border: `1px solid ${filter === f.id ? 'var(--ink)' : 'var(--border)'}`,
              borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              fontSize: 12.5, fontWeight: 500,
            }}
          >{f.label}</button>
        ))}
      </div>

      {error && (
        <div style={{
          background: 'rgba(192,57,43,0.08)', border: '1px solid var(--red)',
          borderRadius: 'var(--radius-sm)', padding: '10px 14px',
          marginBottom: 16, fontSize: 13, color: 'var(--red)',
        }}>{error}</div>
      )}

      {loading ? <LoadingSpinner label="Loading history…" /> : (
        <>
          <div className="premium-card" style={{ padding: 0 }}>
            {events.map((e) => {
              const open = expanded === e.id;
              const tone = TONE[e.action] || 'var(--border)';
              return (
                <div
                  key={`${e.source}-${e.id}`}
                  style={{
                    padding: '13px 16px',
                    borderBottom: '1px solid var(--border2)',
                    borderLeft: `3px solid ${tone}`,
                    cursor: 'pointer',
                  }}
                  onClick={() => setExpanded(open ? null : e.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
                    <span style={{ fontSize: 16, lineHeight: 1.3 }}>{ICON[e.action] || '•'}</span>

                    <div className={`creator-avatar ${getAvatarColor(e.actor_label || '?')}`}
                         style={{ width: 26, height: 26, fontSize: 10, flexShrink: 0 }}>
                      {getInitials(e.actor_label || '?')}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, lineHeight: 1.45 }}>{e.summary}</div>
                      {e.reason && (
                        <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 3, fontStyle: 'italic' }}>
                          "{e.reason}"
                        </div>
                      )}
                      {open && (
                        <div style={{
                          marginTop: 10, padding: 11, background: 'var(--bg2)',
                          borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--ink2)',
                        }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 14px' }}>
                            <span style={{ color: 'var(--ink3)' }}>When</span>
                            <span>{fullTime(e.occurred_at)}</span>

                            <span style={{ color: 'var(--ink3)' }}>Actor</span>
                            <span>{e.actor_email || e.actor_label}{e.actor_role ? ` · ${e.actor_role}` : ''}</span>

                            <span style={{ color: 'var(--ink3)' }}>Action</span>
                            <span style={{ fontFamily: 'monospace' }}>{e.action}</span>

                            <span style={{ color: 'var(--ink3)' }}>Target</span>
                            <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                              {e.entity_type}{e.entity_id ? ` · ${e.entity_id}` : ''}
                            </span>

                            {(e.from_value || e.to_value) && (
                              <>
                                <span style={{ color: 'var(--ink3)' }}>Change</span>
                                <span>{e.from_value ?? '—'} → {e.to_value ?? '—'}</span>
                              </>
                            )}

                            {e.metadata && Object.keys(e.metadata).length > 0 && (
                              <>
                                <span style={{ color: 'var(--ink3)' }}>Detail</span>
                                <span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>
                                  {JSON.stringify(e.metadata)}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    <div style={{ fontSize: 11, color: 'var(--ink3)', whiteSpace: 'nowrap', flexShrink: 0 }}
                         title={fullTime(e.occurred_at)}>
                      {relativeTime(e.occurred_at)}
                    </div>
                  </div>
                </div>
              );
            })}

            {events.length === 0 && (
              <div className="empty" style={{ padding: 48 }}>
                <div className="empty-icon">📜</div>
                <h3>Nothing recorded yet</h3>
                <p>
                  Sensitive actions appear here as they happen. An empty list on a
                  live system may mean the audit migration has not been applied.
                </p>
              </div>
            )}
          </div>

          {hasMore && (
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <button className="btn btn-ghost" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load older entries'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
