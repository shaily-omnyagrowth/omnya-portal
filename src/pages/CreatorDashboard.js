import React, { useState, useEffect } from 'react';
import { statusBadge, fmtDate, fmtMoney } from '../utils';
import { supabase } from '../supabaseClient';

export default function CreatorDashboard({ user, db, onNavigate }) {
  const creator = db.creators.find(c => c.user_id === user.id || c.email === user.email);
  const [connections, setConnections] = useState({ tiktok: false, instagram: false, facebook: false });

  // Connection state comes from /api/social/connections, never from a table
  // read here.
  //
  // This used to select straight from creator_tokens in the browser. Two
  // problems with that: the row carries access_token and refresh_token
  // alongside the platform, so the query was one edited column list away from
  // shipping a creator's OAuth tokens to the client; and creator_tokens is now
  // the legacy table, so after F-3/F-13 a freshly connected account would not
  // have appeared here at all.
  //
  // The endpoint projects a token-free column set and asserts it on every
  // request, so the tokens cannot leak even if this component asks wrongly.
  useEffect(() => {
    let cancelled = false;

    async function checkConns() {
      if (!user?.id) return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const res = await fetch('/api/social/connections', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled || !res.ok || !json.ok) return;

        const mapped = { tiktok: false, instagram: false, facebook: false };
        for (const conn of json.data.connections || []) {
          // 'connected' is the only status that means usable. A row flagged
          // expired or reauth_required exists but cannot sync, and showing it
          // as connected is how a creator ends up wondering why their views
          // stopped updating.
          if (conn.connectionStatus !== 'connected') continue;
          if (conn.platform in mapped) mapped[conn.platform] = true;
        }
        setConnections(mapped);
      } catch {
        // A failed check leaves the badges as they are; this is a dashboard
        // hint, not something worth surfacing an error banner for.
      }
    }

    checkConns();
    return () => { cancelled = true; };
  }, [user]);

  if (!creator) return <div className="content"><div className="empty"><div className="empty-icon">👋</div><h3>Profile being set up</h3><p>Your account manager will activate your profile shortly.</p></div></div>;
  
  const mySubs = db.submissions.filter(s => s.creator_id === creator.id);
  const thisWeek = mySubs.filter(s => new Date(s.created_at) > new Date(Date.now() - 7 * 86400000)).length;
  const earnings = mySubs.filter(s => s.final_status === "Approved" && s.payment_status === "Unpaid").length * (creator.weekly_rate / creator.videos_per_week || 10);
  const myJobs = db.campaigns.filter(c => c.assigned_creators?.includes(creator.id) && c.status !== "Completed");
  const notifs = [
    ...mySubs.filter(s => s.concept_status === "Approved").slice(0, 2).map(s => ({ type: "green", text: <>Concept approved: <strong>{db.campaigns.find(c => c.id === s.campaign_id)?.name}</strong></>, time: "Recent" })),
    ...mySubs.filter(s => s.final_status === "Approved").slice(0, 2).map(s => ({ type: "green", text: <>Final approved: <strong>{db.campaigns.find(c => c.id === s.campaign_id)?.name}</strong></>, time: "Recent" })),
    ...mySubs.filter(s => s.concept_status === "Revisions Needed").slice(0, 2).map(s => ({ type: "orange", text: <>Revisions needed: <strong>{db.campaigns.find(c => c.id === s.campaign_id)?.name}</strong></>, time: "Recent" })),
  ].slice(0, 4);

  return (
    <div className="content">
      <div className="premium-card mb-24" style={{ cursor: 'pointer' }} onClick={() => onNavigate('social-connections')}>
        <div className="flex-between">
          <div>
              <div className="heading-md">Integration Pulse</div>
              <div className="fs-12 text-muted">Verification Status: { (connections.tiktok && (connections.instagram || connections.facebook)) ? "Ready" : "Action Required" }</div>
          </div>
          <div className="flex-center gap-16">
              <div className="flex-center gap-8">
                  <div className={`dot ${connections.tiktok ? 'dot-green' : ''}`} style={{ background: connections.tiktok ? '#10b981' : '#e5e7eb' }}></div>
                  <span className="fs-13 fw-500" style={{ color: connections.tiktok ? '#10b981' : '#9ca3af' }}>TikTok</span>
              </div>
              <div className="flex-center gap-8">
                  <div className={`dot ${connections.instagram ? 'dot-green' : ''}`} style={{ background: connections.instagram ? '#10b981' : '#e5e7eb' }}></div>
                  <span className="fs-13 fw-500" style={{ color: connections.instagram ? '#10b981' : '#9ca3af' }}>Instagram</span>
              </div>
              <div className="flex-center gap-8">
                  <div className={`dot ${connections.facebook ? 'dot-green' : ''}`} style={{ background: connections.facebook ? '#10b981' : '#e5e7eb' }}></div>
                  <span className="fs-13 fw-500" style={{ color: connections.facebook ? '#10b981' : '#9ca3af' }}>Facebook</span>
              </div>
              {(!connections.tiktok || !connections.instagram || !connections.facebook) && (
                  <button className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); onNavigate('social-connections'); }}>
                     Manage
                  </button>
              )}
          </div>
        </div>
      </div>
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">Submitted This Week</div><div className="stat-value">{thisWeek}</div></div>
        <div className="stat-card"><div className="stat-label">Total Approved</div><div className="stat-value">{mySubs.filter(s => s.final_status === "Approved").length}</div></div>
        <div className="stat-card stat-highlight"><div className="stat-label">Approval Rate</div><div className="stat-value">{mySubs.length > 0 ? Math.round((mySubs.filter(s => s.final_status === "Approved").length / mySubs.length) * 100) : 0}%</div></div>
        <div className="stat-card"><div className="stat-label">Pending Earnings</div><div className="stat-value">{fmtMoney(earnings)}</div></div>
      </div>
      <div className="grid-2">
        <div className="premium-card">
          <div className="card-title">Notifications</div>
          {notifs.length === 0 && <div className="empty" style={{ padding: 24 }}><div className="empty-icon">🔔</div><h3>All caught up!</h3></div>}
          {notifs.map((n, i) => (
            <div key={i} className="notif">
              <div className={`notif-dot notif-dot-${n.type === "orange" ? "orange" : "green"}`} />
              <div><div className="notif-text">{n.text}</div><div className="notif-time">{n.time}</div></div>
            </div>
          ))}
        </div>
        <div className="premium-card">
          <div className="card-title">Active Jobs</div>
          {myJobs.length === 0 && <div className="empty" style={{ padding: 24 }}><div className="empty-icon">💼</div><h3>No active jobs</h3></div>}
          {myJobs.map(job => {
            const client = db.clients.find(c => c.id === job.client_id);
            return (
              <div key={job.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--border2)" }}>
                <div className="flex-between mb-8"><div className="fw-600 fs-13">{job.name}</div>{statusBadge(job.status)}</div>
                <div className="flex-center gap-8" style={{ fontSize: 12, color: "var(--ink3)" }}>
                  <span>{client?.name}</span><span>·</span><span>Due {fmtDate(job.deadline)}</span>
                  <span>·</span><span className="text-green">{fmtMoney(job.pay_per_video)}/video</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
