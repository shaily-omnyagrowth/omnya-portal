import React, { useState } from 'react';

const Legal = () => {
  const [activeTab, setActiveTab] = useState('tos');

  const styles = `
    .legal-container {
      max-width: 900px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 12px;
      border: 1px solid #e0e0dc;
      overflow: hidden;
      font-family: 'Barlow', sans-serif;
      color: #1a1a1a;
    }
    .legal-header {
      padding: 40px;
      background: #fdfdfb;
      border-bottom: 1px solid #e0e0dc;
    }
    .legal-title {
      font-family: 'Barlow Condensed', sans-serif;
      font-size: 42px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: -0.5px;
      margin-bottom: 10px;
      line-height: 1;
    }
    .legal-subtitle {
      color: #7a7977;
      font-size: 16px;
    }
    .legal-tabs {
      display: flex;
      background: #f5f5f3;
      padding: 4px;
      gap: 4px;
    }
    .legal-tab {
      flex: 1;
      padding: 14px;
      text-align: center;
      font-weight: 600;
      cursor: pointer;
      border-radius: 6px;
      transition: all 0.2s;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .legal-tab.active {
      background: #ffffff;
      color: #000;
      box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }
    .legal-content {
      padding: 60px;
      line-height: 1.8;
      font-size: 16px;
    }
    .legal-content h2 {
      font-family: 'Barlow Condensed', sans-serif;
      font-size: 24px;
      margin: 40px 0 20px;
      text-transform: uppercase;
      border-bottom: 2px solid #000;
      display: inline-block;
    }
    .legal-content p {
      margin-bottom: 20px;
      color: #4a4a4a;
    }
    .legal-content ul {
      margin-bottom: 20px;
      padding-left: 20px;
    }
    .legal-content li {
      margin-bottom: 10px;
    }
    @media (max-width: 640px) {
      .legal-content { padding: 30px 20px; }
      .legal-header { padding: 30px 20px; }
      .legal-title { font-size: 32px; }
    }
  `;

  return (
    <div className="content">
      <style>{styles}</style>
      <div className="legal-container">
        <div className="legal-header">
          <div className="legal-title">Legal Center</div>
          <div className="legal-subtitle">Omnya Growth — Last updated March 2026</div>
        </div>
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
        
        <div className="legal-content">
          {activeTab === 'tos' ? (
            <div className="tos-section">
              <h2>1. Agreement to Terms</h2>
              <p>By accessing or using Omnya Growth's creator portal, you agree to be bound by these Terms of Service. If you do not agree to all of these terms, do not use the service.</p>
              
              <h2>2. Description of Service</h2>
              <p>Omnya Growth providing a platform for creators and brands to collaborate on UGC (User Generated Content) campaigns. The portal allows for job discovery, content submission, and earnings tracking.</p>
              
              <h2>3. Creator Obligations</h2>
              <p>Creators represent and warrant that any content submitted is their own original work and does not infringe upon the intellectual property rights of any third party.</p>
              
              <h2>4. Payment Terms</h2>
              <p>Payment cycles are processed according to the specific campaign agreements. Omnya Growth reserves the right to withhold payment if content does not meet the specified brief requirements.</p>
            </div>
          ) : (
            <div className="pp-section">
              <h2>1. Information We Collect</h2>
              <p>We collect information you provide directly to us, including name, email address, payment information, and social media handles required for campaign verification.</p>
              
              <h2>2. How We Use Information</h2>
              <p>We use the information we collect to operate, maintain, and provide the features of the service, including processing payments and facilitating brand matches.</p>
              
              <h2>3. Data Sharing</h2>
              <p>We may share your content and basic profile information with potential brand partners. We do not sell your personal data to third parties.</p>
              
              <h2>4. Your Choices</h2>
              <p>You may update your profile information at any time through the portal settings. For data deletion requests, please contact our support team.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Legal;
