import { useEffect, useMemo, useState } from 'react';
import { Alert02Icon, ArrowRight01Icon, Briefcase01Icon, CheckmarkCircle02Icon, Link01Icon } from '@hugeicons/core-free-icons';
import { NavLink } from '../app/Sidebar';
import { supabase } from '../supabaseClient';
import { BarChart } from '../ui/charts';
import EmptyState from '../ui/EmptyState';
import Icon from '../ui/Icon';
import PageHeader from '../ui/PageHeader';
import { daysLeftLabel, fmtMoney, fmtRelativeTime, platformMeta, statusBadge } from '../utils';

const PENDING = new Set(['pending', 'eligible', 'needs_review', 'locked']);

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

function useConnections(userId) {
  const [connected, setConnected] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        // Token-free projection from the API; never read token tables in the browser.
        const res = await fetch('/api/social/connections', { headers: { Authorization: `Bearer ${session.access_token}` } });
        const json = await res.json().catch(() => ({}));
        if (cancelled || !res.ok || !json.ok) return;
        setConnected(new Set((json.data.connections || []).filter(c => c.connectionStatus === 'connected').map(c => c.platform)));
      } catch {
        if (!cancelled) setConnected(new Set());
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);
  return connected;
}

function useEarnings(creatorId) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    if (!creatorId) return undefined;
    let cancelled = false;
    supabase.from('creator_earnings').select('amount,status,created_at').eq('creator_id', creatorId)
      .then(({ data }) => { if (!cancelled) setRows(data || []); });
    return () => { cancelled = true; };
  }, [creatorId]);
  return rows;
}

export default function CreatorDashboard({ user, db, onNavigate }) {
  const creator = db.creators.find(c => c.user_id === user.id || c.email === user.email);
  const connected = useConnections(user.id);
  const earnings = useEarnings(creator?.id);

  const subs = useMemo(() => creator ? db.submissions.filter(s => s.creator_id === creator.id) : [], [creator, db.submissions]);
  const campaignName = id => db.campaigns.find(c => c.id === id)?.name || 'Campaign';

  const months = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
      const total = (earnings || []).filter(e => {
        const c = new Date(e.created_at);
        return c.getFullYear() === d.getFullYear() && c.getMonth() === d.getMonth() && e.status !== 'forfeited' && e.status !== 'cancelled';
      }).reduce((a, e) => a + Number(e.amount || 0), 0);
      return { label: d.toLocaleDateString('en-US', { month: 'short' }), fullLabel: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), value: total };
    });
  }, [earnings]);

  if (!creator) {
    return (
      <div className="content">
        <EmptyState icon={Briefcase01Icon} title="Your profile is being set up">
          Your account manager will activate it shortly. You'll get an email when you can start applying to jobs.
        </EmptyState>
      </div>
    );
  }

  const inReview = subs.filter(s => s.status === 'Submitted' || s.status === 'Under Review');
  const approved = subs.filter(s => s.status === 'Approved' || s.status === 'Published/Tracked');
  const decided = subs.filter(s => ['Approved', 'Published/Tracked', 'Rejected', 'Revision Requested'].includes(s.status));
  const attention = subs.filter(s => s.status === 'Revision Requested' || s.status === 'Rejected')
    .sort((a, b) => new Date(b.reviewed_at || b.created_at) - new Date(a.reviewed_at || a.created_at));
  const jobs = db.campaigns.filter(c => c.assigned_creators?.includes(creator.id) && !['Completed', 'Archived', 'Cancelled'].includes(c.status));
  const available = (earnings || []).filter(e => e.status === 'approved').reduce((a, e) => a + Number(e.amount || 0), 0);
  const pending = (earnings || []).filter(e => PENDING.has(e.status)).reduce((a, e) => a + Number(e.amount || 0), 0);
  const firstName = (creator.name || user.full_name || '').split(' ')[0];

  return (
    <div className="content">
      <PageHeader
        title={`${greeting()}${firstName ? `, ${firstName}` : ''}`}
        description={attention.length ? `${attention.length} ${attention.length === 1 ? 'video needs' : 'videos need'} your attention.` : inReview.length ? `${inReview.length} in review. We'll let you know as soon as there's a decision.` : "You're all caught up. Find a new job or submit your next video."}
        actions={<>
          <button className="btn btn-secondary" onClick={() => onNavigate('jobs')}>Find jobs</button>
          <button className="btn btn-primary" onClick={() => onNavigate('submit')}>Submit content</button>
        </>}
      />

      {connected && connected.size === 0 && (
        <div className="card mb-24" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div className="empty-icon" style={{ margin: 0 }}><Icon icon={Link01Icon} size={20} /></div>
          <div className="flex-1">
            <div className="fw-600">Connect the accounts you post from</div>
            <div className="fs-13 text-muted">Connected accounts verify your views automatically, which is what bonuses are paid on.</div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => onNavigate('social-connections')}>Connect accounts</button>
        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">In review</div><div className="stat-value">{inReview.length}</div><div className="stat-sub">{subs.length} sent in total</div></div>
        <div className="stat-card"><div className="stat-label">Approved videos</div><div className="stat-value">{approved.length}</div><div className="stat-sub">{subs.filter(s => new Date(s.created_at) > Date.now() - 7 * 86400000).length} sent this week</div></div>
        <div className="stat-card"><div className="stat-label">Approval rate</div><div className="stat-value">{decided.length ? `${Math.round((approved.length / decided.length) * 100)}%` : '–'}</div><div className="stat-sub">{decided.length ? `of ${decided.length} reviewed` : 'No decisions yet'}</div></div>
        <div className="stat-card stat-highlight"><div className="stat-label">Ready to withdraw</div><div className="stat-value">{earnings ? fmtMoney(available) : '–'}</div><div className="stat-sub">{fmtMoney(pending)} pending approval</div></div>
      </div>

      <div className="dash-grid">
        <section className="card card-stacked">
          <div className="card-head">
            <div><h2 className="card-title">Earnings</h2><p className="card-desc">Everything earned in the last six months, by month.</p></div>
            <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('payout-manager')}>Payments<Icon icon={ArrowRight01Icon} size={14} /></button>
          </div>
          <BarChart data={months} height={210} format={(v) => fmtMoney(v)} ariaLabel="Earnings per month for the last six months" />
        </section>

        <section className="card">
          <div className="card-head"><h2 className="card-title">Needs your attention</h2></div>
          {attention.length === 0 ? (
            <EmptyState compact icon={CheckmarkCircle02Icon} title="Nothing to fix">Requested changes will show up here.</EmptyState>
          ) : (
            <div className="list-stack">
              {attention.slice(0, 4).map(s => (
                <NavLink key={s.id} id="submissions" onNavigate={onNavigate} className="list-item" style={{ textDecoration: 'none', color: 'inherit', alignItems: 'flex-start' }}>
                  <span style={{ color: s.status === 'Rejected' ? 'var(--red)' : 'var(--amber)', marginTop: 2 }}><Icon icon={Alert02Icon} size={16} /></span>
                  <span className="flex-1">
                    <span className="fw-600 truncate" style={{ display: 'block' }}>{campaignName(s.campaign_id)}</span>
                    <span className="fs-13 text-muted" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.feedback || (s.status === 'Rejected' ? 'Not approved.' : 'Changes requested.')}</span>
                  </span>
                  {statusBadge(s.status)}
                </NavLink>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="section">
        <div className="flex-between mb-12">
          <h2 className="section-title" style={{ margin: 0 }}>Active projects</h2>
          {jobs.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('active-jobs')}>View all<Icon icon={ArrowRight01Icon} size={14} /></button>}
        </div>
        {jobs.length === 0 ? (
          <div className="card"><EmptyState compact icon={Briefcase01Icon} title="No active projects" action={<button className="btn btn-secondary btn-sm" onClick={() => onNavigate('jobs')}>Browse open jobs</button>}>When an application is approved, the campaign shows up here.</EmptyState></div>
        ) : (
          <div className="grid-auto">
            {jobs.slice(0, 6).map(job => {
              const done = subs.filter(s => s.campaign_id === job.id && (s.status === 'Approved' || s.status === 'Published/Tracked')).length;
              const p = platformMeta(job.format);
              return (
                <NavLink key={job.id} id="active-jobs" onNavigate={onNavigate} className="card hover-card" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
                  <div className="flex-between" style={{ alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="fw-600 truncate">{job.name}</div>
                      {db.clients.find(c => c.id === job.client_id)?.name && <div className="fs-13 text-muted truncate">{db.clients.find(c => c.id === job.client_id).name}</div>}
                    </div>
                    <span className="badge badge-outline"><Icon icon={p.icon} size={12} />{p.name}</span>
                  </div>
                  <div className="flex-between fs-13 mt-16">
                    <span className="text-muted">{daysLeftLabel(job.deadline)}</span>
                    <span className="fw-600">{fmtMoney(job.pay_per_video)} per video</span>
                  </div>
                  <div className="flex-between fs-12 text-muted mt-8">
                    <span>{done} delivered</span><span>Updated {fmtRelativeTime(job.updated_at || job.created_at)}</span>
                  </div>
                </NavLink>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
