// api/send-email.js — Vercel serverless function
// Proxies all transactional email sends via Resend.
// Set RESEND_API_KEY in Vercel Environment Variables.

const { applyCors } = require('./_utils/cors');
const { requireAuth, getBearerToken } = require('./_utils/auth');
const { Errors, sendOk } = require('./_utils/errors');
const { getSupabaseAdminClient } = require('./_utils/supabaseAdmin');
const { applyRateLimit } = require('./_utils/rateLimit');


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

    case 'user_signup_waiting_approval':
      return {
        to: process.env.OWNER_NOTIFICATION_EMAIL,
        subject: `🔔 New User Signup: Waiting for Approval`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#f9f9f9;">
            <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e5e5e5;">
              <div style="font-size:24px;font-weight:700;margin-bottom:4px;">New User Registered!</div>
              <div style="color:#888;font-size:13px;margin-bottom:20px;">Waiting for admin/owner approval</div>
              <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
                <tr><td style="padding:6px 0;color:#555;width:140px;">Email</td><td style="padding:6px 0;font-weight:600;">${data.userEmail}</td></tr>
                <tr><td style="padding:6px 0;color:#555;">Name</td><td style="padding:6px 0;">${data.displayName || '—'}</td></tr>
                <tr><td style="padding:6px 0;color:#555;">Requested Role</td><td style="padding:6px 0;font-weight:600;text-transform:uppercase;">${data.requestedRole === 'am' || data.requestedRole === 'account_manager' ? 'Account Manager' : 'Creator'}</td></tr>
              </table>
              <a href="${portalUrl}/?page=pending-users" style="display:inline-block;background:#0a0a0a;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Approve in Portal →</a>
            </div>
            <div style="text-align:center;margin-top:16px;font-size:11px;color:#aaa;">Omnya Growth · Creator Portal</div>
          </div>`,
      };

    case 'supabase_auth': {
      const authType = data.email_data?.email_action_type || 'signup';
      const tokenHash = data.email_data?.token_hash;
      const redirectTo = data.email_data?.redirect_to || portalUrl;
      const supabaseUrl = process.env.SUPABASE_URL;
      if (!supabaseUrl) {
        throw new Error('SUPABASE_URL env var is not set — cannot build auth action URL');
      }
      const actionUrl = `${supabaseUrl}/auth/v1/verify?token=${tokenHash}&type=${authType}&redirect_to=${encodeURIComponent(redirectTo)}`;

      let subject = 'Verify your email';
      let title = 'Verify your account';
      let bodyText = 'Please verify your email address to complete your registration.';
      let buttonText = 'Verify Email →';

      if (authType === 'recovery') {
        subject = 'Reset your password';
        title = 'Password Reset';
        bodyText = 'You requested a password reset. Click the button below to set a new password.';
        buttonText = 'Reset Password →';
      } else if (authType === 'magiclink') {
        subject = 'Your magic sign-in link';
        title = 'Sign in';
        bodyText = 'Click the button below to sign in to your account securely.';
        buttonText = 'Sign In →';
      }

      return {
        to: data.user.email,
        subject: `🔒 ${subject}`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#f9f9f9;">
            <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e5e5e5;text-align:center;">
              <div style="font-size:24px;font-weight:700;margin-bottom:12px;">${title}</div>
              <p style="color:#555;font-size:15px;line-height:1.6;margin-bottom:24px;">
                ${bodyText}
              </p>
              <a href="${actionUrl}" style="display:inline-block;background:#0a0a0a;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">${buttonText}</a>
              <p style="color:#999;font-size:12px;margin-top:24px;">
                If you didn't request this, you can safely ignore this email.
              </p>
            </div>
            <div style="text-align:center;margin-top:16px;font-size:11px;color:#aaa;">Omnya Growth · Creator Portal</div>
          </div>`,
      };
    }

    default:
      return null;
  }
};

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  // Rate limit: 10 email sends per minute per IP/user.
  const blocked = await applyRateLimit(req, res, {
    max: 10,
    windowSecs: 60,
    endpoint: 'send-email',
  });
  if (blocked) return;

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — email skipped');
    return sendOk(res, { skipped: true, reason: 'RESEND_API_KEY not configured' });
  }

  // 1. Authenticate Request
  let authorized = false;
  let callerUser = null;
  const token = getBearerToken(req);

  // Allow service role or cron secret key bypass (for Supabase webhooks and backend crons)
  if (token && (
    (process.env.SUPABASE_SERVICE_ROLE_KEY && token === process.env.SUPABASE_SERVICE_ROLE_KEY) ||
    (process.env.CRON_SECRET && token === process.env.CRON_SECRET)
  )) {
    authorized = true;
  } else {
    // Authenticate standard user JWT
    callerUser = await requireAuth(req, res);
    if (!callerUser) return; // requireAuth already responded with 401/403
    authorized = true;
  }

  if (!authorized) {
    return Errors.unauthorized(res, "Unauthorized email trigger");
  }

  const supabase = getSupabaseAdminClient();
  const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Omnya Growth <onboarding@resend.dev>';

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) {}
    }

    let { type, data } = body || {};

    // Auto-detect Supabase Auth Custom Email webhook payloads
    if (body?.user && body?.email_data) {
      type = 'supabase_auth';
      data = body;
    }

    if (!type || !data) return Errors.badRequest(res, 'Missing type or data');

    // 2. Phishing Protection: Server-side validation of recipient address
    // Verify that the caller is authorized to trigger the email type and send to the specified recipient.
    if (callerUser) {
      if (type === 'new_submission') {
        const { data: amProfile } = await supabase
          .from('user_profiles')
          .select('email, role')
          .eq('email', data.amEmail)
          .single();
        if (!amProfile || (amProfile.role !== 'am' && amProfile.role !== 'owner' && amProfile.role !== 'account_manager')) {
          return Errors.forbidden(res, "Recipient is not an authorized manager");
        }
      } else if (['revision_requested', 'final_approved', 'payment_sent', 'campaign_assigned'].includes(type)) {
        const { data: creatorProfile } = await supabase
          .from('user_profiles')
          .select('email')
          .eq('email', data.creatorEmail)
          .single();
        if (!creatorProfile) {
          return Errors.forbidden(res, "Recipient is not a registered creator");
        }
      } else if (type === 'user_approved') {
        const { data: userProfile } = await supabase
          .from('user_profiles')
          .select('email')
          .eq('email', data.userEmail)
          .single();
        if (!userProfile) {
          return Errors.forbidden(res, "Recipient profile not found");
        }
      } else if (type === 'user_signup_waiting_approval') {
        // Hardcoded recipient is safe
      } else {
        return Errors.badRequest(res, `Unauthorized email type: ${type}`);
      }
    }

    // 3. Phishing Protection: Escaping client HTML input to prevent injection
    const escapeHtml = (str) => {
      if (typeof str !== 'string') return '';
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
    };

    // Escape every user-controlled string that will be interpolated into HTML.
    const userFields = [
      'notes', 'feedback', 'description',
      'creatorName', 'campaignName', 'clientName',
      'amName', 'displayName', 'requestedRole',
      'userEmail', 'submissionType', 'platform',
      'method', 'deadline',
    ];
    for (const field of userFields) {
      if (data[field] !== undefined && data[field] !== null) {
        data[field] = escapeHtml(String(data[field]));
      }
    }

    const email = buildEmail(type, data);
    if (!email) return Errors.badRequest(res, `Unknown email type: ${type}`);
    if (!email.to) {
      if (type === 'user_signup_waiting_approval') {
        console.error('[send-email] OWNER_NOTIFICATION_EMAIL env var is not set — signup notification skipped');
      }
      return Errors.badRequest(res, 'No recipient email provided');
    }

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
      return Errors.internal(res, result.message || 'Resend API error');
    }

    console.log(`Email sent [${type}] → ${email.to} (id: ${result.id})`);
    return sendOk(res, { id: result.id });
  } catch (err) {
    console.error('send-email error:', err);
    return Errors.internal(res, err.message);
  }
};
