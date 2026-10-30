import React, { useCallback, useEffect, useState } from 'react';
import { Settings02Icon } from '@hugeicons/core-free-icons';
import { supabase } from '../supabaseClient';
import Alert from '../ui/Alert';
import EmptyState from '../ui/EmptyState';
import PageHeader from '../ui/PageHeader';
import { SkeletonStats, SkeletonTable } from '../ui/Skeleton';

const SQLSetupModal = React.lazy(() => import('./owner/SQLSetupModal'));

// Read only: no endpoint changes configuration and no secret value is ever returned.
async function callApi(path, method = 'GET') {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Your session has expired. Sign in again.');
  const res = await fetch(path, { method, headers: { Authorization: `Bearer ${session.access_token}` } });
  if (!(res.headers.get('content-type') || '').includes('application/json')) {
    throw new Error(`The API isn't reachable here (${path} answered ${res.status} without JSON). Locally, run node tests/lib/devServer.cjs and use port 3100.`);
  }
  const payload = await res.json().catch(() => null);
  if (res.status === 403) throw new Error('Only owners can see the system configuration.');
  if (res.status === 429) throw new Error('Too many checks in a minute. Wait a moment, then try again.');
  if (res.status === 503 && payload?.code === 'rate_limit_unavailable') {
    throw new Error('Rate limiting is unavailable, so this check is refused. Check UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.');
  }
  if (!res.ok || payload?.ok === false) throw new Error(payload?.error?.message || payload?.error || `Request failed (${res.status}).`);
  return payload?.data ?? payload;
}

const STATE = {
  set: ['Set', 'green'], missing: ['Not set', 'red'], placeholder: ['Placeholder', 'orange'],
  invalid: ['Invalid', 'red'], 'not live': ['Not live', 'gray'],
};
const MIGRATION = {
  applied: ['Applied', 'green', null],
  broken: ['Broken', 'red', 'Recorded as applied, but its object is missing. Someone changed it by hand or it half failed.'],
  pending: ['Pending', 'orange', 'Not applied yet. Run npm run db:migrate.'],
  drift: ['Drift', 'orange', 'Present but not recorded. Run npm run db:migrate -- --baseline.'],
  manual: ['Manual', 'orange', 'No machine probe can prove this file, so it blocks readiness until it gets one.'],
};
const TEST = { ok: ['OK', 'green'], restricted_key: ['Restricted key', 'orange'], failed: ['Failed', 'red'] };
const PROVIDER = { upstash: 'Upstash (rate limits)', stripe: 'Stripe', resend: 'Resend', resend_domain: 'Resend sender domain' };

const Badge = ([label, tone]) => <span className={`badge badge-${tone}`}>{label}</span>;

function Section({ title, desc, meta, children }) {
  return (
    <section className="card">
      <div className="card-head">
        <div><h2 className="card-title">{title}</h2>{desc && <p className="card-desc">{desc}</p>}</div>
        {meta}
      </div>
      <div className="list-stack">{children}</div>
    </section>
  );
}

export default function SystemConfig() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tests, setTests] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState('');
  const [showSQL, setShowSQL] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await callApi('/api/admin/config-status')); } catch (err) { setError(err.message); } finally { setLoading(false); }
  }, []);

  const runTests = async () => {
    setTesting(true); setTestError('');
    try { setTests((await callApi('/api/admin/config-test', 'POST')).results || []); } catch (err) { setTestError(err.message); } finally { setTesting(false); }
  };

  useEffect(() => { load(); }, [load]);

  const header = (
    <PageHeader title="System config" description="What is configured and migrated on this deployment. Values are never shown, only whether they are set and well formed."
      actions={<>
        <button className="btn btn-secondary" onClick={() => setShowSQL(true)}>Database setup SQL</button>
        <button className="btn btn-secondary" onClick={runTests} disabled={testing || !data}>{testing ? 'Testing…' : 'Test connections'}</button>
        <button className="btn btn-primary" onClick={load} disabled={loading}>{loading ? 'Checking…' : 'Check again'}</button>
      </>} />
  );
  const sql = showSQL && <React.Suspense fallback={null}><SQLSetupModal onClose={() => setShowSQL(false)} /></React.Suspense>;

  if (loading && !data) return <div className="content">{header}<SkeletonStats /><SkeletonTable rows={6} cols={2} /></div>;
  if (error && !data) {
    return (
      <div className="content">
        {header}
        <div className="card"><EmptyState icon={Settings02Icon} title="The configuration check didn't run" action={<button className="btn btn-primary btn-sm" onClick={load}>Try again</button>}>{error}</EmptyState></div>
        {sql}
      </div>
    );
  }

  const s = data.summary || {};
  const problems = (s.missing || 0) + (s.placeholder || 0) + (s.invalid || 0);
  const mig = data.migrations || { available: false, rows: [] };
  const ms = mig.summary;
  const reasons = data.notReadyReasons || [];
  const envName = !data.environment || data.environment === 'unknown' ? 'this deployment' : data.environment;

  return (
    <div className="content">
      {header}
      {error && <Alert tone="error" title="The latest check failed" style={{ marginBottom: 16 }}>{error}</Alert>}

      <Alert tone={data.ready ? 'success' : 'warning'} style={{ marginBottom: 20 }}
        title={data.ready ? `${envName[0].toUpperCase()}${envName.slice(1)} is ready` : `${reasons.length} ${reasons.length === 1 ? 'item needs' : 'items need'} attention before ${envName} is ready`}>
        {data.ready ? 'Every required value is set and every migration is applied.' : (
          <>
            <ul className="reason-list">{reasons.map(r => <li key={r}>{r}</li>)}</ul>
            {!data.production && <p className="fs-12 text-muted mt-8">Format rules (live Stripe key, https URLs, key shapes) only apply in production. Here a value is just set or missing.</p>}
          </>
        )}
      </Alert>

      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">Environment</div><div className="stat-value">{data.environment === 'unknown' ? 'Not detected' : data.environment}</div></div>
        <div className="stat-card"><div className="stat-label">Values set</div><div className="stat-value">{s.set ?? 0}</div></div>
        <div className="stat-card"><div className="stat-label">Need attention</div><div className={`stat-value ${problems ? 'text-red' : ''}`}>{problems}</div></div>
        <div className="stat-card"><div className="stat-label">Migrations applied</div><div className="stat-value">{ms ? `${ms.applied} of ${ms.total}` : '--'}</div></div>
      </div>

      <div className="flex-col gap-16">
        {(tests || testError) && (
          <Section title="Connection test" desc="Read only pings to each provider.">
            {testError && <Alert tone="error">{testError}</Alert>}
            {(tests || []).map(t => (
              <div key={t.provider} className="list-item">
                <span className="fs-13 fw-550">{PROVIDER[t.provider] || t.provider}</span>
                <span className="flex-center gap-8">
                  {t.code && <span className="mono fs-12 text-muted">{t.code}</span>}
                  {t.ms > 0 && <span className="fs-12 text-muted">{t.ms} ms</span>}
                  {Badge(TEST[t.result] || TEST.failed)}
                </span>
              </div>
            ))}
          </Section>
        )}

        {(data.groups || []).map(g => {
          const n = g.vars.filter(v => v.required && v.state !== 'set').length;
          return (
            <Section key={g.group} title={g.group} desc={g.note} meta={n > 0 && <span className="badge badge-orange">{n} to set</span>}>
              {g.vars.map(v => (
                <div key={v.name} className="list-item">
                  <span className="mono fs-13 break-anywhere">{v.name}{!v.required && v.state !== 'not live' && <span className="text-muted fs-12"> optional</span>}</span>
                  <span className="flex-center gap-8">
                    {v.state !== 'set' && v.reason && <span className="fs-12 text-muted">{v.reason}</span>}
                    {Badge(STATE[v.state] || STATE.missing)}
                  </span>
                </div>
              ))}
            </Section>
          );
        })}

        {(data.oauth || []).length > 0 && (
          <Section title="Social sign in redirect URIs" desc="Each one must match the platform's developer console exactly, including www and https. If it doesn't, creators see the platform's own error page.">
            {data.oauth.map(o => (
              <div key={o.platform} className="list-item" style={{ display: 'block' }}>
                <div className="flex-between gap-12"><span className="fw-600 fs-13">{o.platform}</span><span className="fs-12 text-muted">from {o.source}</span></div>
                <div className="mono fs-12 break-anywhere mt-4" style={{ userSelect: 'all' }}>{o.redirectUri}</div>
                <div className="fs-12 text-muted mt-4">Register it under {o.console}</div>
                {o.problem && <Alert tone="error" style={{ marginTop: 8 }}>{o.problem}</Alert>}
              </div>
            ))}
          </Section>
        )}

        <Section title="Migrations" desc="One row per file in supabase/migrations. Apply pending ones with npm run db:migrate."
          meta={ms && <span className="fs-12 text-muted">{ms.applied} applied · {ms.pending} pending · {ms.drift + ms.broken + ms.manual} other</span>}>
          {!mig.available && <Alert tone="warning">{mig.hint}</Alert>}
          {mig.rows.map(r => {
            const st = MIGRATION[r.state] || MIGRATION.pending;
            return (
              <div key={r.file} className="list-item" style={{ alignItems: 'flex-start' }}>
                <div className="min-w-0">
                  <div className="fs-13 fw-600">{r.label}</div>
                  <div className="mono fs-12 text-muted break-anywhere mt-4">{r.file}</div>
                  {r.state !== 'applied' && <div className="fs-12 text-muted mt-4">{r.state === 'manual' ? r.why : `${st[2]} Checks: ${r.checks}.`}</div>}
                </div>
                {Badge(st)}
              </div>
            );
          })}
        </Section>
      </div>

      <p className="fs-12 text-muted mt-16">Checked {new Date(data.checkedAt || Date.now()).toLocaleString()}. Change values in the hosting project's environment settings, then redeploy.</p>
      {sql}
    </div>
  );
}
