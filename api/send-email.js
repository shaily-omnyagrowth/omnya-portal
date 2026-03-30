// api/send-email.js — Vercel serverless function
// Proxies all transactional email sends via Resend.
// Set RESEND_API_KEY in Vercel Environment Variables.

const setCorsHeaders = (req) => ({
  'Access-Control-Allow-Origin': req.headers.origin || '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
});

// Email templates per trigger type
const buildEmail = (type, data) => {
  const portalUrl = 'https://www.portalomnyagrowth.com';

  switch (type) {
    case 'new_submission':
      return {
        to: data.amEmail,
        subject: `📥 New submission: ${data.creatorName} → ${data.campaignName}`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#f9f9f9;">
            <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e5e5e5;">
              <div style="font-size:24px;font-weight:700;margin-bottom:4px;font-family:'Helvetica Neue',sans-serif;">New Submission</div>
              <div style="color:#888;font-size:13px;margin-bottom:20px;">Review required</div>
              <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
                <tr><td style="padding:8px 0;color:#555;width:140px;">Creator</td><td style="padding:8px 0;font-weight:600;">${data.creatorName}</td></tr>
                <tr><td style="padding:8px 0;color:#555;">Campaign</td><td style="padding:8px 0;font-weight:600;">${data.campaignName}</td></tr>
                <tr><td style="padding:8px 0;color:#555;">Type</td><td style="padding:8px 0;">${data.submissionType}</td></tr>
                <tr><td style="padding:8px 0;color:#555;">Platform</td><td style="padding:8px 0;">${data.platform || '—'}</td></tr>
              </table>
              ${data.notes ? `<div style="background:#f5f5f5;border-radius:8px;padding:12px;font-size:13px;color:#444;margin-bottom:20px;">💬 "${data.notes}"</div>` : ''}
              <a href="${portalUrl}" style="display:inline-block;background:#0a0a0a;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Review in Portal →</a>
            </div>
            <div style="text-align:center;margin-top:16px;font-size:11px;color:#aaa;">Omnya Growth · Creator Portal</div>
          </div>`,
      };

    case 'revision_requested':
      return {
        to: data.creatorEmail,
        subject: `↺ Revisions requested on ${data.campaignName}`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#f9f9f9;">
            <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e5e5e5;">
              <div style="font-size:24px;font-weight:700;margin-bottom:4px;">Revisions Requested</div>
              <div style="color:#888;font-size:13px;margin-bottom:20px;">${data.amName} has requested changes on your submission</div>
              <div style="background:#fff8e6;border:1px solid #ffe066;border-radius:8px;padding:16px;margin-bottom:20px;">
                <div style="font-size:11px;font-weight:700;color:#b08800;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Feedback</div>
                <div style="font-size:14px;color:#333;line-height:1.6;">${data.feedback}</div>
              </div>
              <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
                <tr><td style="padding:6px 0;color:#555;width:140px;">Campaign</td><td style="padding:6px 0;font-weight:600;">${data.campaignName}</td></tr>
              </table>
              <a href="${portalUrl}" style="display:inline-block;background:#0a0a0a;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">View in Portal →</a>
            </div>
            <div style="text-align:center;margin-top:16px;font-size:11px;color:#aaa;">Omnya Growth · Creator Portal</div>
          </div>`,
      };

    case 'final_approved':
      return {
        to: data.creatorEmail,
        subject: `✅ Your video for ${data.campaignName} was approved!`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#f9f9f9;">
            <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e5e5e5;">
              <div style="font-size:36px;margin-bottom:12px;">🎉</div>
              <div style="font-size:24px;font-weight:700;margin-bottom:4px;">Video Approved!</div>
              <div style="color:#888;font-size:13px;margin-bottom:20px;">Great work — your final video has been approved</div>
              <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
                <tr><td style="padding:6px 0;color:#555;width:140px;">Campaign</td><td style="padding:6px 0;font-weight:600;">${data.campaignName}</td></tr>
                <tr><td style="padding:6px 0;color:#555;">Earning</td><td style="padding:6px 0;font-weight:600;color:#1a7a4a;">${data.amount ? `$${data.amount}` : 'Pending payment'}</td></tr>
              </table>
              <a href="${portalUrl}" style="display:inline-block;background:#1a7a4a;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">View My Earnings →</a>
            </div>
            <div style="text-align:center;margin-top:16px;font-size:11px;color:#aaa;">Omnya Growth · Creator Portal</div>
          </div>`,
      };

    case 'payment_sent':
      return {
        to: data.creatorEmail,
        subject: `💸 You've been paid $${data.amount} — ${data.campaignName}`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#f9f9f9;">
            <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e5e5e5;">
              <div style="font-size:36px;margin-bottom:12px;">💰</div>
              <div style="font-size:24px;font-weight:700;margin-bottom:4px;">Payment Sent!</div>
              <div style="color:#888;font-size:13px;margin-bottom:20px;">Your payment has been processed</div>
              <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
                <tr><td style="padding:6px 0;color:#555;width:140px;">Amount</td><td style="padding:6px 0;font-weight:700;font-size:18px;color:#1a7a4a;">$${data.amount}</td></tr>
                <tr><td style="padding:6px 0;color:#555;">Method</td><td style="padding:6px 0;font-weight:600;">${data.method}</td></tr>
                <tr><td style="padding:6px 0;color:#555;">Campaign</td><td style="padding:6px 0;">${data.campaignName}</td></tr>
                <tr><td style="padding:6px 0;color:#555;">Videos</td><td style="padding:6px 0;">${data.videosApproved} approved</td></tr>
              </table>
              <a href="${portalUrl}" style="display:inline-block;background:#0a0a0a;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">View Payment History →</a>
            </div>
            <div style="text-align:center;margin-top:16px;font-size:11px;color:#aaa;">Omnya Growth · Creator Portal</div>
          </div>`,
      };

    case 'campaign_assigned':
      return {
        to: data.creatorEmail,
        subject: `🎬 You've been added to ${data.campaignName}`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#f9f9f9;">
            <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e5e5e5;">
              <div style="font-size:24px;font-weight:700;margin-bottom:4px;">New Campaign!</div>
              <div style="color:#888;font-size:13px;margin-bottom:20px;">You've been assigned to a new campaign</div>
              <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
                <tr><td style="padding:6px 0;color:#555;width:140px;">Campaign</td><td style="padding:6px 0;font-weight:600;">${data.campaignName}</td></tr>
                <tr><td style="padding:6px 0;color:#555;">Client</td><td style="padding:6px 0;">${data.clientName || '—'}</td></tr>
                <tr><td style="padding:6px 0;color:#555;">Pay</td><td style="padding:6px 0;font-weight:600;color:#1a7a4a;">${data.payPerVideo ? `$${data.payPerVideo}/video` : '—'}</td></tr>
                <tr><td style="padding:6px 0;color:#555;">Deadline</td><td style="padding:6px 0;">${data.deadline || '—'}</td></tr>
              </table>
              ${data.description ? `<div style="background:#f5f5f5;border-radius:8px;padding:12px;font-size:13px;color:#444;margin-bottom:20px;line-height:1.6;">${data.description}</div>` : ''}
              <a href="${portalUrl}" style="display:inline-block;background:#0a0a0a;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">View Campaign Brief →</a>
            </div>
            <div style="text-align:center;margin-top:16px;font-size:11px;color:#aaa;">Omnya Growth · Creator Portal</div>
          </div>`,
      };

    case 'user_approved':
      return {
        to: data.userEmail,
        subject: `👋 Welcome to Omnya Creator Portal`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#f9f9f9;">
            <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e5e5e5;">
              <div style="font-size:24px;font-weight:700;margin-bottom:4px;">Welcome, ${data.displayName}!</div>
              <div style="color:#888;font-size:13px;margin-bottom:20px;">Your Omnya account has been approved</div>
              <div style="background:#f0faf5;border:1px solid #a8e0c0;border-radius:8px;padding:14px;margin-bottom:20px;font-size:14px;color:#155724;">
                ✅ Your account has been set up as a <strong>${data.role === 'am' || data.role === 'account_manager' ? 'Account Manager' : 'Creator'}</strong>.
              </div>
              <p style="font-size:14px;color:#555;line-height:1.7;margin-bottom:20px;">
                You can now sign in to the portal to ${data.role === 'creator' ? 'browse available jobs, submit content, and track your earnings' : 'manage your creators, review submissions, and track campaign performance'}.
              </p>
              <a href="${portalUrl}" style="display:inline-block;background:#0a0a0a;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Sign In to Portal →</a>
            </div>
            <div style="text-align:center;margin-top:16px;font-size:11px;color:#aaa;">Omnya Growth · Creator Portal</div>
          </div>`,
      };

    default:
      return null;
  }
};

module.exports = async (req, res) => {
  const corsHeaders = setCorsHeaders(req);
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — email skipped');
    return res.status(200).json({ skipped: true, reason: 'RESEND_API_KEY not configured' });
  }

  // FROM address: use verified domain sender if set, otherwise fall back to
  // Resend's built-in test address (works immediately, no DNS verification needed).
  // Once omnyagrowth.com is verified in Resend, add to Vercel env vars:
  //   RESEND_FROM_EMAIL=Omnya Growth <noreply@mail.omnyagrowth.com>
  const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Omnya Growth <onboarding@resend.dev>';

  try {
    // Vercel may or may not pre-parse the body — handle both cases
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) {}
    }

    const { type, data } = body || {};
    if (!type || !data) return res.status(400).json({ error: 'Missing type or data' });

    const email = buildEmail(type, data);
    if (!email) return res.status(400).json({ error: `Unknown email type: ${type}` });
    if (!email.to) return res.status(400).json({ error: 'No recipient email provided' });

    const payload = {
      from: FROM_EMAIL,
      to: [email.to],
      subject: email.subject,
      html: email.html,
    };

    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const result = await sendRes.json();

    if (!sendRes.ok) {
      console.error(`Resend error [${type}]:`, result);
      // Return 200 to the client so email failures don't surface as portal errors
      return res.status(200).json({ skipped: true, reason: result.message || 'Resend API error' });
    }

    console.log(`Email sent [${type}] → ${email.to} (id: ${result.id})`);
    return res.status(200).json({ success: true, id: result.id });
  } catch (err) {
    console.error('send-email error:', err);
    // Always return 200 — email errors must never break portal actions
    return res.status(200).json({ skipped: true, reason: 'Internal error' });
  }
};
