/* eslint-disable */
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import LoadingSpinner from '../components/LoadingSpinner';

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM CONFIGURATION — scope §6.1, spec 0001
//
//   "Review system analytics, history and administrative configuration."
//
// Note the verb: review, not edit. This page reports; it never writes. There
// is deliberately no endpoint that changes configuration — secrets belong in
// the Vercel project, not in a form in the browser. "Test connections" only
// pings the providers with read only calls.
//
// It answers one question: is production configured and migrated? One banner
// from the server's `ready` flag, then the reasons, per value and per
// migration file.
//
// Nothing here displays a secret. The endpoint returns states and fixed
// reasons — never a value, a prefix or a length.
//
// There is no fallback config. This page used to show a made up all green
// configuration whenever the API failed, which is exactly the answer it must
// never give: a failure is shown as a failure.
// ─────────────────────────────────────────────────────────────────────────────

async function callApi(path, method = 'GET') {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Your session has expired. Sign in again.');

  const res = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`The API is not reachable here (${path} answered HTTP ${res.status} without JSON). Locally, run node tests/lib/devServer.cjs and use port 3100.`);
  }

  let payload = null;
  try { payload = await res.json(); } catch (_) {}

  if (res.status === 403) throw new Error('Only the owner can see System Configuration.');
  if (res.status === 429) throw new Error('Too many checks in a minute. Wait a moment, then try again.');
  if (res.status === 503 && payload?.code === 'rate_limit_unavailable') {
    throw new Error('Rate limiting is unavailable, so this check is refused. Look at UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.');
  }
  if (!res.ok || payload?.ok === false) {
    throw new Error(payload?.error?.message || payload?.error || `Request failed (HTTP ${res.status}).`);
  }
  return payload?.data ?? payload;
}

const STATE_STYLE = {
  set:         { label: 'Set',         cls: 'badge-green' },
  missing:     { label: 'Not set',     cls: 'badge-red' },
  placeholder: { label: 'Placeholder', cls: 'badge-orange' },
  invalid:     { label: 'Invalid',     cls: 'badge-red' },
  'not live':  { label: 'Not live',    cls: 'badge-gray' },
};

// Spec 0001 state model: applied green, broken red, pending and drift amber.
const MIGRATION_STYLE = {
  applied: { label: 'Applied', cls: 'badge-green',  help: null },
  broken:  { label: 'Broken',  cls: 'badge-red',    help: 'Recorded as applied, but its object is missing. Someone changed it by hand or it half failed. A person resolves this.' },
  pending: { label: 'Pending', cls: 'badge-orange', help: 'Not applied yet. Run npm run db:migrate.' },
  drift:   { label: 'Drift',   cls: 'badge-orange', help: 'Present but not recorded. Run npm run db:migrate -- --baseline.' },
  manual:  { label: 'Manual',  cls: 'badge-orange', help: 'No machine probe can prove this file. Checked by hand; it blocks readiness until it gets one.' },
};

const TEST_STYLE = {
  ok:             { label: 'OK',             cls: 'badge-green' },
  restricted_key: { label: 'Restricted key', cls: 'badge-orange' },
  failed:         { label: 'Failed',         cls: 'badge-red' },
};

const PROVIDER_LABEL = {
  upstash: 'Upstash (rate limits)',
  stripe: 'Stripe',
  resend: 'Resend',
  resend_domain: 'Resend sender domain verified',
};

const alertBox = (color) => ({
  background: color === 'green' ? 'rgba(26,122,74,0.08)' : color === 'orange' ? 'rgba(194,90,0,0.08)' : 'rgba(192,57,43,0.08)',
  border: `1px solid var(--${color})`,
  borderRadius: 'var(--radius-sm)', padding: '12px 16px', fontSize: 13, lineHeight: 1.5,
});

export default function SystemConfig() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tests, setTests] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState('');

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

  const runTests = useCallback(async () => {
    setTesting(true);
    setTestError('');
    try {
      const d = await callApi('/api/admin/config-test', 'POST');
      setTests(d.results || []);
    } catch (err) {
      setTestError(err.message);
    } finally {
      setTesting(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingSpinner label="Checking configuration…" />;

  if (error) {
    return (
      <div className="content">
        <div role="alert" style={{ ...alertBox('red'), color: 'var(--red)' }}>{error}</div>
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={load}>↻ Try again</button>
      </div>
    );
  }

  const s = data.summary || {};
  const problems = (s.missing || 0) + (s.placeholder || 0) + (s.invalid || 0);
  const groups = data.groups || [];
  const mig = data.migrations || { available: false, rows: [] };
  const ms = mig.summary;

  return (
    <div className="content">
      <div className="flex-between" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>System Configuration</h2>
          <p style={{ color: 'var(--ink3)', fontSize: 13, margin: 0 }}>
            What is configured and migrated on this deployment. Read only. Values are never shown, only whether they are set and well formed.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost btn-sm" onClick={runTests} disabled={testing}>
            {testing ? 'Testing…' : 'Test connections'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={load}>↻ Re-check</button>
        </div>
      </div>

      {/* AC-9: one banner from the server's flag, plus every reason it is false. */}
      <div role="status" style={{ ...alertBox(data.ready ? 'green' : 'red'), marginBottom: 20 }}>
        <div style={{ fontWeight: 700, color: data.ready ? 'var(--green)' : 'var(--red)', marginBottom: data.ready ? 0 : 6 }}>
          {data.ready
            ? `Ready: every required value is set and every migration is applied (${data.environment}).`
            : `Not ready (${data.environment}): ${data.notReadyReasons.length} thing${data.notReadyReasons.length === 1 ? '' : 's'} to fix.`}
        </div>
        {!data.ready && (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--ink2)' }}>
            {data.notReadyReasons.map((r) => <li key={r} style={{ wordBreak: 'break-word' }}>{r}</li>)}
          </ul>
        )}
        {!data.production && (
          <div style={{ fontSize: 11.5, color: 'var(--ink3)', marginTop: 6 }}>
            Format rules (live Stripe key, https URLs, key shapes) apply only in production. Here a value is just set or missing.
          </div>
        )}
      </div>

      {(tests || testError) && (
        <div className="premium-card" style={{ marginBottom: 16 }}>
          <div className="card-title">Connection test</div>
          {testError && <div role="alert" style={{ ...alertBox('red'), color: 'var(--red)' }}>{testError}</div>}
          {(tests || []).map((t) => {
            const st = TEST_STYLE[t.result] || TEST_STYLE.failed;
            return (
              <div key={t.provider} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                padding: '9px 0', borderBottom: '1px solid var(--border2)', flexWrap: 'wrap',
              }}>
                <span style={{ fontSize: 13 }}>{PROVIDER_LABEL[t.provider] || t.provider}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {t.code && <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--ink3)' }}>{t.code}</span>}
                  {t.ms > 0 && <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{t.ms} ms</span>}
                  <span className={`badge ${st.cls}`}>{st.label}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-label">Environment</div>
          <div className="stat-value" style={{ fontSize: 20 }}>{data.environment}</div>
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
          <div className="stat-label">Migrations applied</div>
          <div className="stat-value">{ms ? `${ms.applied}/${ms.total}` : '?'}</div>
        </div>
      </div>

      {groups.map((g) => {
        const groupProblems = g.vars.filter((v) => v.required && v.state !== 'set').length;
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
                    background: 'var(--bg)', display: 'flex', alignItems: 'center', flexWrap: 'wrap',
                    justifyContent: 'space-between', gap: 12, padding: '9px 2px',
                  }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 12.5, wordBreak: 'break-all' }}>
                      {v.name}
                      {!v.required && v.state !== 'not live' && <span style={{ fontFamily: 'inherit', fontSize: 11, color: 'var(--ink3)' }}> (optional)</span>}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      {v.state !== 'set' && v.reason && <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{v.reason}</span>}
                      <span className={`badge ${st.cls}`}>{st.label}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {(data.oauth || []).length > 0 && (
        <div className="premium-card" style={{ marginBottom: 16 }}>
          <div className="card-title">Social sign-in redirect URIs</div>
          <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 12, lineHeight: 1.5 }}>
            The exact address the portal asks each platform to send creators back to.
            It has to match what is registered in that platform's developer console
            character for character, including <code>www</code> and <code>https</code>.
            When it does not, the creator sees the platform's own error page
            (TikTok: "Something went wrong"), not ours.
          </div>
          {data.oauth.map((o) => (
            <div key={o.platform} style={{ padding: '11px 0', borderBottom: '1px solid var(--border2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{o.platform}</div>
                <div style={{ fontSize: 11, color: 'var(--ink3)' }}>from {o.source}</div>
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: 12, margin: '4px 0', wordBreak: 'break-all', userSelect: 'all' }}>
                {o.redirectUri}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink3)' }}>Register it under: {o.console}</div>
              {o.problem && (
                <div role="alert" style={{
                  marginTop: 6, padding: '8px 10px', borderRadius: 6,
                  background: 'rgba(192,57,43,0.08)', color: 'var(--red)', fontSize: 12, lineHeight: 1.45,
                }}>
                  {o.problem}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="premium-card">
        <div className="flex-between" style={{ marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Migrations</div>
          {ms && (
            <span style={{ fontSize: 12, color: 'var(--ink3)' }}>
              {ms.applied} applied · {ms.pending} pending · {ms.drift} drift · {ms.broken} broken · {ms.manual} manual
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 12, lineHeight: 1.5 }}>
          One row per file in <code>supabase/migrations/</code>. Applied means it is recorded in the
          migration history and the object it creates is present. Apply with <code>npm run db:migrate</code>.
        </div>
        {!mig.available && (
          <div role="alert" style={{ ...alertBox('orange'), color: 'var(--orange)' }}>{mig.hint}</div>
        )}
        {mig.rows.map((r) => {
          const st = MIGRATION_STYLE[r.state] || MIGRATION_STYLE.pending;
          return (
            <div key={r.file} style={{
              padding: '11px 0', borderBottom: '1px solid var(--border2)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12,
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{r.label}</div>
                <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--ink3)', margin: '2px 0 4px', wordBreak: 'break-all' }}>
                  {r.file}
                </div>
                {r.state !== 'applied' && (
                  <div style={{ fontSize: 12, color: 'var(--ink3)', lineHeight: 1.45 }}>
                    {r.state === 'manual' ? r.why : `${st.help} Checks: ${r.checks}.`}
                  </div>
                )}
              </div>
              <span className={`badge ${st.cls}`} style={{ flexShrink: 0 }}>{st.label}</span>
            </div>
          );
        })}
      </div>

      <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 14 }}>
        Checked {new Date(data.checkedAt || Date.now()).toLocaleString()}. Change these values
        in the hosting project's environment settings, then re-deploy.
      </div>
    </div>
  );
}
