import React from 'react';

// The policy text lives only in public/privacy.html, public/terms.html and
// public/data-deletion.html. Those are static on purpose: TikTok and Meta
// review crawlers do not run JavaScript, and the URLs registered in both
// developer consoles must return the full text. This screen links to them so
// the in-app Legal Center can never drift from what the platforms reviewed.
const DOCS = [
  { href: '/privacy', title: 'PRIVACY POLICY', text: 'What the portal collects, including data from connected TikTok, Instagram, Facebook and YouTube accounts, who can see it and how long we keep it.' },
  { href: '/terms', title: 'TERMS OF SERVICE', text: 'The rules for using the portal: accounts, connected social accounts, content rights, payments and termination.' },
  { href: '/data-deletion', title: 'DATA DELETION', text: 'How to disconnect a social account, revoke access from the platform, or ask us to delete your data.' },
];

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;700&display=swap');

  .legal-page { min-height: 100vh; background: #f7f5f4; color: #0a0a0a; font-family: 'DM Sans', sans-serif; padding-bottom: 80px; }
  .legal-nav { display: flex; justify-content: space-between; align-items: center; padding: 24px 40px; background: #fff; border-bottom: 1px solid #e2e2e0; }
  .legal-nav-logo { font-family: 'Bebas Neue', sans-serif; font-size: 26px; }
  .legal-nav-btn { background: #1a1a1a; color: #fff; border: none; padding: 10px 24px; border-radius: 6px; font-family: 'Bebas Neue', sans-serif; font-size: 16px; letter-spacing: 0.5px; cursor: pointer; }
  .legal-header { padding: 64px 24px 40px; text-align: center; }
  .legal-pill { display: inline-block; padding: 6px 16px; background: #eeedec; border-radius: 100px; font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #7a7977; margin-bottom: 24px; }
  .legal-hero-title { font-family: 'Bebas Neue', sans-serif; font-size: 72px; font-weight: 400; line-height: 1; margin: 0; }
  .legal-body { max-width: 800px; margin: 0 auto; padding: 0 24px; display: flex; flex-direction: column; gap: 16px; }
  .legal-card { display: block; background: #fff; border-radius: 12px; padding: 32px 40px; border: 1px solid #e2e2e0; color: inherit; text-decoration: none; transition: border-color 0.2s; }
  .legal-card:hover { border-color: #0a0a0a; }
  .legal-section-title { font-family: 'Bebas Neue', sans-serif; font-size: 26px; letter-spacing: 0.5px; margin: 0 0 8px; }
  .legal-text { font-size: 15px; line-height: 1.7; color: #3a3a3a; margin: 0; }
  .legal-open { display: inline-block; margin-top: 12px; font-size: 13px; font-weight: 700; letter-spacing: 0.05em; }
  .legal-contact { background: #1a1a1a; border-radius: 12px; padding: 28px 40px; display: flex; justify-content: space-between; align-items: center; gap: 12px; color: #fff; }
  .legal-contact-label { font-size: 15px; color: #b0aea9; }
  .legal-contact-email { font-weight: 700; color: #fff; text-decoration: none; }

  @media (max-width: 640px) {
    .legal-nav { padding: 16px 20px; }
    .legal-hero-title { font-size: 44px; }
    .legal-card { padding: 24px 20px; }
    .legal-contact { flex-direction: column; text-align: center; padding: 24px 20px; }
  }
`;

const Legal = ({ onBack }) => (
  <div className="legal-page">
    <style>{styles}</style>

    {onBack && (
      <nav className="legal-nav">
        <div className="legal-nav-logo">OMNYA</div>
        <button className="legal-nav-btn" onClick={onBack}>GO TO PORTAL</button>
      </nav>
    )}

    <div className="legal-header">
      <div className="legal-pill">OMNYA GROWTH LLC</div>
      <h1 className="legal-hero-title">LEGAL CENTER</h1>
    </div>

    <div className="legal-body">
      {DOCS.map(d => (
        <a className="legal-card" key={d.href} href={d.href} target="_blank" rel="noopener noreferrer">
          <h2 className="legal-section-title">{d.title}</h2>
          <p className="legal-text">{d.text}</p>
          <span className="legal-open">READ →</span>
        </a>
      ))}

      <div className="legal-contact">
        <div className="legal-contact-label">Questions or data requests?</div>
        <a href="mailto:hello@omnyagrowth.com" className="legal-contact-email">hello@omnyagrowth.com</a>
      </div>
    </div>
  </div>
);

export default Legal;
