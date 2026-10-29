const styles = `
  /* Bebas Neue and DM Sans are loaded by <link> tags in public/index.html.
     They were an @import here, which the browser could not discover until this
     whole stylesheet had been shipped inside the JS bundle and parsed — four
     serial round trips before any glyph existed. See the note in index.html. */

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    color-scheme: light;
    --bg: #F7F5F4;
    --bg2: #EFEEED;
    --bg3: #E8E7E5;
    --surface: #FFFFFF;
    --surface2: rgba(255,255,255,0.7);
    --ink: #0A0A0A;
    --ink2: #3A3A3A;
    --ink3: #4A4A48;
    --ink4: #6B6965;
    --chrome: linear-gradient(135deg, #E8E8E8 0%, #C8C8C8 25%, #F0F0F0 50%, #B8B8B8 75%, #E0E0E0 100%);
    --chrome-flat: #C8C8C6;
    --accent: #0A0A0A;
    --blue: #1A1AF0;
    --blue-light: #4040FF;
    --green: #1A7A4A;
    --green-light: #2FAF6A;
    --red: #C0392B;
    --red-light: #E74C3C;
    --orange: #C25A00;
    --orange-light: #E67E22;
    --gold: #9A7A00;
    --gold-light: #C9A227;
    --border: rgba(10,10,10,0.1);
    --border2: rgba(10,10,10,0.06);
    --shadow: 0 2px 12px rgba(0,0,0,0.06);
    --shadow-lg: 0 8px 32px rgba(0,0,0,0.1);
    --radius: 14px;
    --radius-sm: 8px;
  }

  body {
    font-family: 'DM Sans', sans-serif;
    background: var(--bg);
    color: var(--ink);
    min-height: 100vh;
    font-size: 14px;
    line-height: 1.5;
  }

  h1,h2,h3,h4,h5 { font-family: 'Bebas Neue', sans-serif; letter-spacing: 0.5px; }

  .public-footer {
    padding: 32px 24px;
    text-align: center;
    font-size: 11px;
    color: var(--ink3);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    display: flex;
    justify-content: center;
    gap: 24px;
    background: transparent;
    width: 100%;
    margin-top: auto;
  }
  .public-footer span {
    cursor: pointer;
    transition: color 0.2s;
  }
  .public-footer span:hover {
    color: var(--ink);
    text-decoration: underline;
  }

  /* LOGIN */
  .login-wrap {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg);
    padding: 24px;
    position: relative;
    overflow: hidden;
  }
  .login-wrap::before {
    content: '';
    position: absolute;
    top: -200px; right: -200px;
    width: 600px; height: 600px;
    background: radial-gradient(circle, rgba(200,200,198,0.3) 0%, transparent 60%);
    border-radius: 50%;
    pointer-events: none;
  }
  .login-wrap::after {
    content: '';
    position: absolute;
    bottom: -150px; left: -150px;
    width: 400px; height: 400px;
    background: radial-gradient(circle, rgba(180,180,178,0.2) 0%, transparent 60%);
    border-radius: 50%;
    pointer-events: none;
  }
  .login-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 20px;
    padding: 48px;
    width: 100%;
    max-width: 420px;
    box-shadow: var(--shadow-lg);
    position: relative;
    z-index: 1;
  }
  .login-logo { display: flex; align-items: center; gap: 14px; margin-bottom: 36px; }
  .login-logo-img { width: 44px; height: 44px; object-fit: contain; }
  .login-logo-text { font-family: 'Bebas Neue', sans-serif; font-size: 28px; letter-spacing: 2px; color: var(--ink); }
  .login-title { font-family: 'Bebas Neue', sans-serif; font-size: 36px; letter-spacing: 1px; margin-bottom: 6px; color: var(--ink); }
  .login-sub { color: var(--ink3); margin-bottom: 32px; font-size: 14px; }
  .field { margin-bottom: 16px; }
  .form-label, .field label { display: block; font-size: 11px; font-weight: 600; color: #262626 !important; margin-bottom: 6px; letter-spacing: 0.8px; text-transform: uppercase; opacity: 1 !important; visibility: visible !important; }
  .field input {
    width: 100%; padding: 12px 16px; background: var(--bg2);
    border: 1px solid var(--border); border-radius: var(--radius-sm);
    color: var(--ink); font-size: 14px; font-family: 'DM Sans', sans-serif;
    outline: none; transition: border-color 0.2s;
  }
  .field input:focus { border-color: var(--ink); background: var(--surface); }
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    padding: 10px 18px; border-radius: var(--radius-sm); font-size: 14px;
    font-weight: 600; font-family: 'DM Sans', sans-serif; cursor: pointer; border: none;
    transition: all 0.15s; white-space: nowrap;
  }
  .btn-primary { background: var(--ink); color: white; }
  .btn-primary:hover { background: #2A2A2A; }
  /* A disabled button must look disabled. Without this, "Copy" on a share
     link that is still off looked clickable and did nothing (2026-09-19). */
  .btn:disabled, .btn[disabled] { opacity: 0.45; cursor: not-allowed; pointer-events: none; }
  .btn-full { width: 100%; }
  .btn-sm { padding: 6px 12px; font-size: 12px; }
  .btn-ghost { background: transparent; color: var(--ink2); border: 1px solid var(--border); }
  .btn-ghost:hover { background: var(--bg2); }
  .btn-green { background: var(--green); color: white; }
  .btn-green:hover { background: var(--green-light); }
  .btn-red { background: var(--red); color: white; }
  .btn-red:hover { background: var(--red-light); }
  .btn-orange { background: var(--orange); color: white; }
  .btn-orange:hover { background: var(--orange-light); }
  .btn-gold { background: var(--gold); color: white; }
  .btn-gold:hover { background: var(--gold-light); }
  .demo-hints { margin-top: 24px; background: var(--bg2); border-radius: var(--radius-sm); padding: 16px; border: 1px solid var(--border2); }
  .demo-hints p { font-size: 10px; color: var(--ink4); margin-bottom: 8px; font-weight: 600; letter-spacing: 0.8px; text-transform: uppercase; }
  .demo-hint { font-size: 12px; color: var(--ink2); margin-bottom: 4px; cursor: pointer; padding: 5px 8px; border-radius: 4px; transition: background 0.15s; }
  .demo-hint:hover { background: var(--bg3); }
  .demo-hint span { color: var(--blue); font-family: monospace; }

  /* LAYOUT */
  .app { display: flex; min-height: 100vh; }
  .sidebar {
    width: 240px; min-width: 240px; background: var(--surface);
    border-right: 1px solid var(--border); display: flex; flex-direction: column;
    position: fixed; top: 0; left: 0; height: 100vh; z-index: 100;
    box-shadow: 2px 0 12px rgba(0,0,0,0.03);
  }
  .sidebar-header { padding: 24px 20px; border-bottom: 1px solid var(--border2); }
  .sidebar-logo { display: flex; align-items: center; gap: 12px; }
  .sidebar-logo-img { width: 28px; height: 28px; object-fit: contain; }
  .sidebar-logo-text { font-family: 'Bebas Neue', sans-serif; font-size: 22px; letter-spacing: 2px; color: var(--ink); }
  .sidebar-role { font-size: 10px; color: var(--ink4); margin-top: 1px; text-transform: uppercase; letter-spacing: 1px; font-weight: 600; }
  .sidebar-nav { flex: 1; padding: 16px 12px; overflow-y: auto; }
  .nav-section { margin-bottom: 24px; }
  .nav-section-label { font-size: 10px; color: var(--ink4); text-transform: uppercase; letter-spacing: 0.8px; font-weight: 600; padding: 0 8px; margin-bottom: 6px; }
  .nav-item {
    display: flex; align-items: center; gap: 10px; padding: 9px 10px;
    border-radius: var(--radius-sm); cursor: pointer; color: var(--ink3);
    font-size: 13px; font-weight: 500; transition: all 0.15s; margin-bottom: 2px;
  }
  .nav-item:hover { background: var(--bg2); color: var(--ink); }
  .nav-item.active { background: var(--ink); color: white; }
  .nav-item .icon { font-size: 15px; width: 20px; text-align: center; }
  .nav-badge {
    margin-left: auto; background: var(--red); color: white;
    font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 99px;
  }
  .sidebar-footer { padding: 16px 12px; border-top: 1px solid var(--border2); }
  .user-chip { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: var(--radius-sm); }
  .user-avatar {
    width: 30px; height: 30px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 700; flex-shrink: 0;
    background: var(--bg3); color: var(--ink);
  }
  .user-info { flex: 1; min-width: 0; }
  .user-name { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--ink); }
  .user-email { font-size: 11px; color: var(--ink3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .logout-btn { font-size: 11px; color: var(--ink3); background: none; border: none; cursor: pointer; padding: 4px 10px; margin-top: 6px; width: 100%; text-align: left; }
  .logout-btn:hover { color: var(--red); }

  .main { margin-left: 240px; flex: 1; min-height: 100vh; background: var(--bg); }
  .topbar {
    padding: 18px 32px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between;
    position: sticky; top: 0; background: rgba(244,243,240,0.92); backdrop-filter: blur(12px); z-index: 10;
  }
  .page-title { font-family: 'Bebas Neue', sans-serif; font-size: 28px; letter-spacing: 1px; color: var(--ink); }
  .page-sub { font-size: 12px; color: var(--ink4); margin-top: 1px; letter-spacing: 0.3px; }
  .content { padding: 32px; }

  /* CARDS */
  .card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 20px;
    box-shadow: var(--shadow);
  }
  .card-title { font-family: 'Bebas Neue', sans-serif; font-size: 13px; font-weight: 400; letter-spacing: 1.5px; margin-bottom: 16px; color: var(--ink3); text-transform: uppercase; }

  /* STATS GRID */
  .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 28px; }
  .stat-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 20px;
    box-shadow: var(--shadow);
  }
  .stat-card.stat-highlight { background: var(--ink); }
  .stat-card.stat-highlight .stat-label { color: rgba(255,255,255,0.5); }
  .stat-card.stat-highlight .stat-value { color: white; }
  .stat-card.stat-highlight .stat-sub { color: rgba(255,255,255,0.4); }
  .stat-blue::before, .stat-green::before, .stat-gold::before, .stat-orange::before, .stat-red::before { display: none; }
  .stat-label { font-size: 10px; color: var(--ink3); text-transform: uppercase; letter-spacing: 1px; font-weight: 600; margin-bottom: 10px; }
  .stat-value { font-family: 'Bebas Neue', sans-serif; font-size: 36px; letter-spacing: 1px; color: var(--ink); line-height: 1; }
  .stat-sub { font-size: 11px; color: var(--ink4); margin-top: 6px; }

  /* TABLE */
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; }
  thead th {
    text-align: left; padding: 10px 14px; font-size: 10px; font-weight: 600;
    color: var(--ink4); text-transform: uppercase; letter-spacing: 0.8px;
    border-bottom: 1px solid var(--border);
  }
  tbody tr { border-bottom: 1px solid var(--border2); transition: background 0.1s; }
  tbody tr:hover { background: var(--bg2); }
  tbody tr:last-child { border-bottom: none; }
  td { padding: 12px 14px; font-size: 13px; }

  /* BADGES */
  .badge {
    display: inline-flex; align-items: center; padding: 3px 9px;
    border-radius: 99px; font-size: 11px; font-weight: 600; letter-spacing: 0.2px;
  }
  .badge-blue { background: rgba(26,26,240,0.08); color: var(--blue); border: 1px solid rgba(26,26,240,0.15); }
  .badge-green { background: rgba(26,122,74,0.08); color: var(--green); border: 1px solid rgba(26,122,74,0.15); }
  .badge-red { background: rgba(192,57,43,0.08); color: var(--red); border: 1px solid rgba(192,57,43,0.12); }
  .badge-orange { background: rgba(194,90,0,0.08); color: var(--orange); border: 1px solid rgba(194,90,0,0.12); }
  .badge-gold { background: rgba(154,122,0,0.08); color: var(--gold); border: 1px solid rgba(154,122,0,0.12); }
  .badge-gray { background: rgba(10,10,10,0.05); color: var(--ink3); border: 1px solid var(--border); }

  /* PROGRESS BAR */
  .progress-bar { height: 4px; background: var(--bg3); border-radius: 99px; overflow: hidden; }
  .progress-fill { height: 100%; border-radius: 99px; background: var(--ink); }

  /* TABS */
  .tabs { display: flex; gap: 0; margin-bottom: 20px; border-bottom: 1px solid var(--border); }
  .tab {
    padding: 10px 16px; font-size: 13px; font-weight: 500; cursor: pointer;
    color: var(--ink3); border-bottom: 2px solid transparent; margin-bottom: -1px;
    transition: all 0.15s;
  }
  .tab:hover { color: var(--ink); }
  .tab.active { color: var(--ink); border-bottom-color: var(--ink); }

  /* MODAL */
  .modal-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 1000;
    display: flex; align-items: center; justify-content: center; padding: 24px;
    backdrop-filter: blur(4px);
  }
  .modal {
    background: var(--surface); border: 1px solid var(--border); border-radius: 20px;
    padding: 32px; width: 100%; max-width: 540px; max-height: 85vh; overflow-y: auto;
    box-shadow: var(--shadow-lg);
  }
  .modal-title { font-family: 'Bebas Neue', sans-serif; font-size: 26px; letter-spacing: 1px; margin-bottom: 4px; color: var(--ink); }
  .modal-sub { font-size: 13px; color: var(--ink3); margin-bottom: 24px; }
  .modal-actions { display: flex; gap: 10px; margin-top: 24px; justify-content: flex-end; }
  .textarea {
    width: 100%; padding: 12px 16px; background: var(--bg2);
    border: 1px solid var(--border); border-radius: var(--radius-sm);
    color: var(--ink); font-size: 14px; font-family: 'DM Sans', sans-serif;
    outline: none; transition: border-color 0.2s; resize: vertical; min-height: 80px;
  }
  .textarea:focus { border-color: var(--ink); background: var(--surface); }
  .select {
    width: 100%; padding: 12px 16px; background: var(--bg2);
    border: 1px solid var(--border); border-radius: var(--radius-sm);
    color: var(--ink); font-size: 14px; font-family: 'DM Sans', sans-serif;
    outline: none; cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%237A7977' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 14px center;
    padding-right: 36px;
  }

  /* GRID */
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }

  /* EMPTY STATE */
  .empty { text-align: center; padding: 56px 24px; color: var(--ink4); }
  .empty-icon { font-size: 36px; margin-bottom: 12px; opacity: 0.5; }
  .empty h3 { font-family: 'Bebas Neue', sans-serif; font-size: 20px; color: var(--ink3); margin-bottom: 6px; letter-spacing: 1px; }
  .empty p { font-size: 13px; color: var(--ink4); }

  /* NOTIFICATION */
  .notif {
    display: flex; align-items: flex-start; gap: 12px; padding: 12px 14px;
    border-radius: var(--radius-sm); margin-bottom: 8px; background: var(--bg2);
    border: 1px solid var(--border2);
  }
  .notif-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; margin-top: 6px; }
  .notif-dot-green { background: var(--green); }
  .notif-dot-blue { background: var(--blue); }
  .notif-dot-orange { background: var(--orange); }
  .notif-text { font-size: 13px; color: var(--ink2); }
  .notif-text strong { color: var(--ink); }
  .notif-time { font-size: 11px; color: var(--ink4); margin-top: 2px; }

  /* REVIEW CARD */
  .review-card {
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 18px; margin-bottom: 12px; box-shadow: var(--shadow);
    transition: box-shadow 0.15s;
  }
  .review-card:hover { box-shadow: var(--shadow-lg); }
  .review-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  .creator-avatar {
    width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700;
    background: var(--bg3); color: var(--ink);
  }
  .review-meta { flex: 1; }
  .review-name { font-weight: 600; font-size: 14px; color: var(--ink); }
  .review-campaign { font-size: 12px; color: var(--ink3); }
  .review-actions { display: flex; gap: 8px; flex-wrap: wrap; }

  /* FORM */
  .form-group { margin-bottom: 16px; }
  .form-label { display: block; font-size: 11px; font-weight: 600; color: #262626 !important; margin-bottom: 6px; letter-spacing: 0.8px; text-transform: uppercase; opacity: 1 !important; visibility: visible !important; }
  .form-hint { font-size: 11px; color: var(--ink4); margin-top: 4px; }
  .form-input {
    width: 100%; padding: 12px 16px; background: var(--bg2);
    border: 1px solid var(--border); border-radius: var(--radius-sm);
    color: var(--ink); font-size: 14px; font-family: 'DM Sans', sans-serif;
    outline: none; transition: all 0.2s;
  }
  .form-input:focus { border-color: var(--ink); background: var(--surface); }

  /* AVATAR — single neutral style */
  .av-blue, .av-green, .av-gold, .av-orange, .av-red { background: var(--bg3); color: var(--ink2); }

  /* PERF BAR */
  .perf-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
  .perf-label { width: 100px; font-size: 12px; color: var(--ink2); flex-shrink: 0; }
  .perf-bar { flex: 1; height: 4px; background: var(--bg3); border-radius: 99px; overflow: hidden; }
  .perf-fill { height: 100%; border-radius: 99px; }
  .perf-val { width: 36px; text-align: right; font-size: 12px; color: var(--ink3); font-weight: 600; }

  /* AI INSIGHTS */
  .ai-panel {
    background: var(--surface);
    border: 1px solid rgba(10,10,10,0.12);
    border-radius: var(--radius);
    padding: 20px;
    box-shadow: var(--shadow);
  }
  .ai-score-ring {
    width: 72px; height: 72px; border-radius: 50%; flex-shrink: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    position: relative;
  }
  .ai-score-num { font-family: 'Bebas Neue', sans-serif; font-size: 24px; line-height: 1; letter-spacing: 1px; }
  .ai-score-sub { font-size: 8px; color: var(--ink4); text-transform: uppercase; letter-spacing: 0.5px; margin-top: 1px; }
  .ai-badge {
    display: inline-flex; align-items: center; gap: 6px;
    background: var(--ink); color: white;
    padding: 4px 12px; border-radius: 99px;
    font-size: 11px; font-weight: 600; letter-spacing: 0.3px;
  }
  .ai-loading {
    display: flex; align-items: center; gap: 10px;
    padding: 20px; font-size: 13px; color: var(--ink3);
  }
  .ai-spinner {
    width: 18px; height: 18px; border: 2px solid var(--bg3);
    border-top-color: var(--ink); border-radius: 50%;
    animation: spin 0.8s linear infinite; flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .insight-pill {
    display: inline-flex; align-items: flex-start; gap: 6px;
    padding: 7px 10px; border-radius: var(--radius-sm);
    font-size: 12px; margin-bottom: 6px; width: 100%; line-height: 1.4;
  }
  .insight-strength { background: rgba(26,122,74,0.07); color: var(--green); border: 1px solid rgba(26,122,74,0.12); }
  .insight-improve { background: rgba(154,122,0,0.07); color: var(--gold); border: 1px solid rgba(154,122,0,0.12); }
  .metrics-row {
    display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 16px;
  }
  .metric-mini {
    background: var(--bg2); border-radius: var(--radius-sm); padding: 10px 8px; text-align: center;
    border: 1px solid var(--border2);
  }
  .metric-mini-val { font-family: 'Bebas Neue', sans-serif; font-weight: 400; font-size: 18px; letter-spacing: 0.5px; color: var(--ink); }
  .metric-mini-label { font-size: 9px; color: var(--ink4); margin-top: 2px; text-transform: uppercase; letter-spacing: 0.5px; }

  /* OWNER BADGE */
  .owner-badge {
    display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px;
    background: var(--ink); color: white; border-radius: 99px; font-size: 10px;
    font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;
  }

  /* CARDS */
  .premium-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 20px; box-shadow: var(--shadow);
  }
  .hover-card { transition: transform 0.15s, box-shadow 0.15s; }
  .hover-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-lg); }

  /* TABLE */
  .premium-table { width: 100%; border-collapse: collapse; font-size: 14px; }
  .premium-table thead tr { border-bottom: 1px solid var(--border); background: var(--bg2); }
  .premium-table thead th { padding: 10px 16px; text-align: left; font-size: 11px; font-weight: 600; color: var(--ink3); text-transform: uppercase; letter-spacing: 0.6px; }
  .premium-table tbody tr { border-bottom: 1px solid var(--border2); transition: background 0.1s; }
  .premium-table tbody tr:last-child { border-bottom: none; }
  .premium-table tbody tr:hover { background: var(--bg2); }
  .premium-table td { padding: 12px 16px; color: var(--ink2); vertical-align: middle; }

  /* MISC */
  .divider { height: 1px; background: var(--border2); margin: 20px 0; }
  .text-muted { color: var(--ink3); }
  .text-center { text-align: center; }
  .fw-700 { font-weight: 700; }
  .btn-secondary { background: var(--bg2); color: var(--ink2); border: 1px solid var(--border); }
  .btn-secondary:hover { background: var(--bg3); }
  .text-blue { color: var(--blue); }
  .text-green { color: var(--green); }
  .text-gold { color: var(--gold); }
  .text-red { color: var(--red); }
  .text-orange { color: var(--orange); }
  .flex { display: flex; }
  .flex-center { display: flex; align-items: center; }
  .flex-between { display: flex; align-items: center; justify-content: space-between; }
  .gap-8 { gap: 8px; }
  .gap-12 { gap: 12px; }
  .mb-8 { margin-bottom: 8px; }
  .mb-16 { margin-bottom: 16px; }
  .mb-24 { margin-bottom: 24px; }
  .mt-8 { margin-top: 8px; }
  .fw-600 { font-weight: 600; }
  .fs-12 { font-size: 12px; }
  .fs-13 { font-size: 13px; }
  .link { color: var(--blue); text-decoration: none; font-size: 12px; font-weight: 500; }
  .link:hover { text-decoration: underline; }
  .submit-link-row { display: flex; gap: 8px; align-items: center; }
  .submit-link-row input { flex: 1; }

  /* MOBILE RESPONSIVENESS */
  .mobile-toggle {
    display: none;
    background: none;
    border: none;
    font-size: 24px;
    cursor: pointer;
    color: var(--ink);
    padding: 4px;
  }

  .sidebar-overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    z-index: 95;
    backdrop-filter: blur(2px);
  }

  @media (max-width: 1024px) {
    .sidebar {
      transform: translateX(-100%);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .sidebar.open {
      transform: translateX(0);
    }
    .main {
      margin-left: 0;
    }
    .topbar {
      padding: 14px 20px;
    }
    .mobile-toggle {
      display: block;
    }
    .sidebar-open .sidebar-overlay {
      display: block;
    }
    .desktop-only {
      display: none;
    }
    .stats-grid {
      grid-template-columns: repeat(2, 1fr);
    }
    .content {
      padding: 20px;
    }
  }

  @media (max-width: 640px) {
    .stats-grid {
      grid-template-columns: 1fr;
    }
    .grid-2 {
      grid-template-columns: 1fr;
    }
    .login-card {
      padding: 32px 24px;
    }
    .modal {
      padding: 24px 20px;
    }
    .metric-mini-val {
      font-size: 14px;
    }
  }
`;

export default styles;
