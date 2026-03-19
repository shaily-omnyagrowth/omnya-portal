import React, { useState } from 'react';

const Legal = ({ onBack }) => {
  const [activeTab, setActiveTab] = useState('tos');

  const styles = `
    .legal-page {
      min-height: 100vh;
      background: #f7f5f4;
      color: #0a0a0a;
      font-family: 'DM Sans', sans-serif;
      padding-bottom: 100px;
    }
    
    /* Nav */
    .legal-nav {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 24px 40px;
      background: #fff;
      border-bottom: 1px solid #e2e2e0;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .legal-nav-logo {
      font-family: 'Bebas Neue', sans-serif;
      font-size: 24px;
      letter-spacing: 1px;
    }
    .legal-nav-right {
      display: flex;
      align-items: center;
      gap: 32px;
    }
    .legal-nav-link {
      font-family: 'DM Sans', sans-serif;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.05em;
      color: #7a7977;
      text-transform: uppercase;
    }
    .legal-nav-btn {
      background: #0a0a0a;
      color: #fff;
      border: none;
      padding: 10px 24px;
      border-radius: 6px;
      font-family: 'Bebas Neue', sans-serif;
      font-size: 16px;
      letter-spacing: 1px;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    .legal-nav-btn:hover { opacity: 0.9; }

    /* Header */
    .legal-header {
      padding: 80px 24px 60px;
      text-align: center;
    }
    .legal-pill {
      display: inline-block;
      padding: 6px 16px;
      background: #eeedec;
      border-radius: 100px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #7a7977;
      margin-bottom: 24px;
    }
    .legal-hero-title {
      font-family: 'Bebas Neue', sans-serif;
      font-size: 64px;
      letter-spacing: 2px;
      line-height: 1;
      margin-bottom: 16px;
    }
    .legal-hero-sub {
      font-size: 14px;
      color: #b0aea9;
    }

    /* Tabs */
    .legal-tabs-wrap {
      border-bottom: 1px solid #e2e2e0;
      margin-bottom: 60px;
    }
    .legal-tabs {
      display: flex;
      justify-content: center;
      gap: 40px;
      max-width: 1200px;
      margin: 0 auto;
    }
    .legal-tab {
      padding: 20px 0;
      font-family: 'DM Sans', sans-serif;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: #7a7977;
      cursor: pointer;
      position: relative;
    }
    .legal-tab.active {
      color: #0a0a0a;
    }
    .legal-tab.active::after {
      content: '';
      position: absolute;
      bottom: -1px;
      left: 0;
      right: 0;
      height: 2px;
      background: #0a0a0a;
    }

    /* Content Cards */
    .legal-body {
      max-width: 800px;
      margin: 0 auto;
      padding: 0 24px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .legal-card {
      background: #fff;
      border-radius: 12px;
      padding: 40px;
      border: 1px solid #e2e2e0;
    }
    .legal-section-head {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 20px;
    }
    .legal-num {
      background: #f7f5f4;
      color: #b0aea9;
      font-family: 'DM Sans', sans-serif;
      font-size: 11px;
      font-weight: 700;
      padding: 4px 8px;
      border-radius: 4px;
    }
    .legal-section-title {
      font-family: 'Bebas Neue', sans-serif;
      font-size: 24px;
      letter-spacing: 1px;
    }
    .legal-text {
      font-size: 15px;
      line-height: 1.7;
      color: #3a3a3a;
    }

    /* Contact Card */
    .legal-contact {
      background: #1a1a1a;
      border-radius: 12px;
      padding: 32px 40px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: #fff;
      margin-top: 20px;
    }
    .legal-contact-label {
      font-size: 15px;
      color: #b0aea9;
    }
    .legal-contact-email {
      font-family: 'DM Sans', sans-serif;
      font-size: 16px;
      font-weight: 700;
      color: #fff;
      text-decoration: none;
    }

    .legal-footer {
      text-align: center;
      padding: 60px 24px;
      font-size: 11px;
      color: #b0aea9;
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }

    @media (max-width: 640px) {
      .legal-nav { padding: 16px 20px; }
      .legal-nav-link { display: none; }
      .legal-hero-title { font-size: 40px; }
      .legal-card { padding: 30px 20px; }
      .legal-contact { flex-direction: column; text-align: center; gap: 12px; }
    }
  `;

  const sections = {
    tos: [
      { id: '01', title: 'ACCEPTANCE OF TERMS', text: 'By accessing or using any services provided by Omnya Growth ("we," "us," or "our"), you agree to be bound by these Terms of Service. If you do not agree, please do not use our services.' },
      { id: '02', title: 'SERVICES', text: 'Omnya Growth provides UGC strategy, creator marketing, content production, and social media management services. The scope of services for each client is defined in a separate agreement or proposal.' },
      { id: '03', title: 'PAYMENT & FEES', text: 'All fees are outlined in your proposal or contract. Invoices are due within the timeframe specified. Late payments may result in a pause of services. All fees are non-refundable unless otherwise agreed in writing.' },
      { id: '04', title: 'INTELLECTUAL PROPERTY', text: 'Upon receipt of full payment, you own the final deliverables created for your campaign. Omnya Growth retains the right to display work in our portfolio unless you request otherwise in writing. All proprietary processes, templates, and systems remain the property of Omnya Growth.' },
      { id: '05', title: 'CONTENT & COMPLIANCE', text: 'Clients are responsible for ensuring that all products, claims, and campaign briefs comply with applicable laws and platform guidelines (Meta, TikTok, etc.). Omnya Growth is not liable for content that violates platform policies due to inaccurate or incomplete information provided by the client.' },
      { id: '06', title: 'CONFIDENTIALITY', text: 'Both parties agree to keep confidential any proprietary information shared during the engagement, including but not limited to campaign strategies, pricing, and business operations.' },
      { id: '07', title: 'LIMITATION OF LIABILITY', text: 'Omnya Growth is not liable for indirect, incidental, or consequential damages arising from the use of our services. Our total liability shall not exceed the amount paid by you in the 30 days preceding the claim.' },
      { id: '08', title: 'TERMINATION', text: 'Either party may terminate the engagement with written notice as specified in your agreement. Upon termination, all outstanding payments become immediately due.' },
      { id: '09', title: 'GOVERNING LAW', text: 'These terms are governed by the laws of the United States. Any disputes shall be resolved through binding arbitration.' }
    ],
    pp: [
      { id: '01', title: 'INFORMATION COLLECTION', text: 'We collect information you provide directly to us, including your name, email, payment details, and social media profiles needed for campaign fulfillment.' },
      { id: '02', title: 'USE OF DATA', text: 'We use your information to facilitate brand partnerships, process payments, and improve our services. We do not sell your personal data to third parties.' },
      { id: '03', title: 'THIRD-PARTY SHARING', text: 'Information may be shared with brand partners only as necessary to fulfill specific campaign requirements.' },
      { id: '04', title: 'SECURITY', text: 'We implement industry-standard security measures to protect your data. However, no method of transmission over the internet is 100% secure.' },
      { id: '05', title: 'YOUR RIGHTS', text: 'You have the right to request access to or deletion of your personal data at any time by contacting our support team.' }
    ]
  };

  return (
    <div className="legal-page">
      <style>{styles}</style>
      
      <nav className="legal-nav">
        <div className="legal-nav-logo">OMNYA</div>
        <div className="legal-nav-right">
          <span className="legal-nav-link">LEGAL</span>
          <button className="legal-nav-btn" onClick={onBack}>GO TO PORTAL</button>
        </div>
      </nav>

      <div className="legal-header">
        <div className="legal-pill">OMNYA GROWTH LLC</div>
        <h1 className="legal-hero-title">LEGAL DOCUMENTS</h1>
        <div className="legal-hero-sub">Last updated March 2026</div>
      </div>

      <div className="legal-tabs-wrap">
        <div className="legal-tabs">
          <div 
            className={`legal-tab ${activeTab === 'tos' ? 'active' : ''}`}
            onClick={() => setActiveTab('tos')}
          >
            Terms of Service
          </div>
          <div 
            className={`legal-tab ${activeTab === 'pp' ? 'active' : ''}`}
            onClick={() => setActiveTab('pp')}
          >
            Privacy Policy
          </div>
        </div>
      </div>

      <div className="legal-body">
        {sections[activeTab].map(s => (
          <div className="legal-card" key={s.id}>
            <div className="legal-section-head">
              <div className="legal-num">{s.id}</div>
              <h2 className="legal-section-title">{s.title}</h2>
            </div>
            <p className="legal-text">{s.text}</p>
          </div>
        ))}

        <div className="legal-contact">
          <div className="legal-contact-label">Questions about these terms?</div>
          <a href="mailto:hello@omnyagrowth.com" className="legal-contact-email">hello@omnyagrowth.com</a>
        </div>
      </div>

      <footer className="legal-footer">
        © 2026 OMNYA GROWTH LLC - ALL RIGHTS RESERVED
      </footer>
    </div>
  );
};

export default Legal;
