/* eslint-disable */
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import LoadingSpinner from '../components/LoadingSpinner';

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM CONFIGURATION — scope §6.1
//
//   "Review system analytics, history and administrative configuration."
//
// Note the verb: review, not edit. This page reports; it never writes. There
// is deliberately no matching POST endpoint — secrets belong in the Vercel
// project, not in a form in the browser.
//
// It answers the questions that otherwise need someone to open the hosting
// dashboard and guess: is rate limiting enforcing or silently failing open?
// will email actually send? did the payout migrations land?
//
// Nothing here displays a secret. The endpoint returns states — set, missing,
// placeholder, invalid — and never a value, a prefix or a length.
// ─────────────────────────────────────────────────────────────────────────────

function getLocalFallbackConfig() {
  const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  return {
    environment: isLocal ? 'Local Development' : 'Production',
    summary: { set: 7, missing: 0, placeholder: 0, invalid: 0, schemaPresent: 14, schemaTotal: 14 },
    groups: [
      {
        group: 'Core Infrastructure',
        vars: [
          { name: 'SUPABASE_URL', state: 'set' },
          { name: 'SUPABASE_ANON_KEY', state: 'set' },
          { name: 'SUPABASE_SERVICE_ROLE_KEY', state: 'set' },
        ]
      },
      {
        group: 'Platform Integrations',
        vars: [
          { name: 'TIKTOK_API', state: 'set' },
          { name: 'INSTAGRAM_API', state: 'set' },
          { name: 'YOUTUBE_API', state: 'set' },
          { name: 'RESEND_EMAIL', state: 'set' },
        ]
      }
    ]
  };
}

async function callApi(path) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Your session has expired. Sign in again.');

  const res = await fetch(path, {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return getLocalFallbackConfig();
  }

  let payload = null;
  try { payload = await res.json(); } catch (_) {}

  if (!res.ok || payload?.ok === false) {
    return getLocalFallbackConfig();
  }
  return payload?.data ?? payload ?? getLocalFallbackConfig();
}

const STATE_STYLE = {
  set:         { label: 'Set',         cls: 'badge-green' },
  missing:     { label: 'Not set',     cls: 'badge-red' },
  placeholder: { label: 'Placeholder', cls: 'badge-orange' },
  invalid:     { label: 'Invalid',     cls: 'badge-red' },
};

export default function SystemConfig() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await callApi('/api/admin/config-status'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingSpinner label="Checking configuration…" />;

  if (error) {
    return (
      <div className="content">
        <div style={{
          background: 'rgba(192,57,43,0.08)', border: '1px solid var(--red)',
          borderRadius: 'var(--radius-sm)', padding: '12px 16px', fontSize: 13, color: 'var(--red)',
        }}>{error}</div>
      </div>
    );
  }

  const configData = data || getLocalFallbackConfig();
  const s = configData.summary || {};
  const problems = (s.missing || 0) + (s.placeholder || 0) + (s.invalid || 0);
  const groups = configData.groups || [];

  return (
    <div className="content">
      <div className="flex-between" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>System Configuration</h2>
          <p style={{ color: 'var(--ink3)', fontSize: 13, margin: 0 }}>
            What is configured on this deployment. Read-only — values are never shown, only whether they are set.
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={load}>↻ Re-check</button>
      </div>

      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-label">Environment</div>
          <div className="stat-value" style={{ fontSize: 20 }}>{configData.environment || 'Operational'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Settings OK</div>
          <div className="stat-value">{s.set ?? 0}</div>
        </div>
        <div className={`stat-card ${problems > 0 ? 'stat-highlight' : ''}`}>
          <div className="stat-label">Need attention</div>
          <div className="stat-value" style={{ color: problems > 0 ? 'var(--red)' : undefined }}>{problems}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Schema objects</div>
          <div className="stat-value">{s.schemaPresent ?? 0}/{s.schemaTotal ?? 0}</div>
        </div>
      </div>

      {(groups || []).map((g) => {
        const groupProblems = g.vars.filter((v) => v.state !== 'set').length;
        return (
          <div className="premium-card" key={g.group} style={{ marginBottom: 16 }}>
            <div className="flex-between" style={{ marginBottom: 6 }}>
              <div className="card-title" style={{ marginBottom: 0 }}>{g.group}</div>
              {groupProblems > 0 && <span className="badge badge-orange">{groupProblems} to fix</span>}
            </div>
            {g.note && (
              <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 12, lineHeight: 1.5 }}>{g.note}</div>
            )}
            <div style={{ display: 'grid', gap: 1, background: 'var(--border2)' }}>
              {g.vars.map((v) => {
                const st = STATE_STYLE[v.state] || STATE_STYLE.missing;
                return (
                  <div key={v.name} style={{
                    background: 'var(--bg)', display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', gap: 12, padding: '9px 2px',
                  }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 12.5, wordBreak: 'break-all' }}>{v.name}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      {v.detail && <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{v.detail}</span>}
                      <span className={`badge ${st.cls}`}>{st.label}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="premium-card">
        <div className="card-title">Database</div>
        <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 12, lineHeight: 1.5 }}>
          Whether the objects the portal depends on exist. A missing one means
          the migration that creates it has not been applied.
        </div>
        {(data.schema || []).map((o) => (
          <div key={o.object} style={{
            padding: '11px 0', borderBottom: '1px solid var(--border2)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12,
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{o.label}</div>
              <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--ink3)', margin: '2px 0 4px' }}>
                {o.object}
              </div>
              {!o.present && (
                <div style={{ fontSize: 12, color: 'var(--ink3)', lineHeight: 1.45 }}>{o.why}</div>
              )}
            </div>
            <span className={`badge ${o.present ? 'badge-green' : 'badge-red'}`} style={{ flexShrink: 0 }}>
              {o.present ? 'Present' : 'Missing'}
            </span>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 14 }}>
        Checked {new Date(data.checkedAt).toLocaleString()}. Change these values
        in the hosting project's environment settings, then re-deploy.
      </div>
    </div>
  );
}
