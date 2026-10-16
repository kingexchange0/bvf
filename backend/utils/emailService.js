// BrightVale Finance — centralized email service.
//
// Provider is selected with EMAIL_PROVIDER (brevo | resend). All credentials
// and sender details come from environment variables — never from the
// database, never from the client, never hardcoded. There is deliberately
// NO fallback/test transport: if the configured provider is not set up,
// sends fail with a clear error and startup validation reports it loudly.

const nodemailer = require('nodemailer');
const axios = require('axios');

// ---------------------------------------------------------------------------
// Configuration (env-only)
// ---------------------------------------------------------------------------

function getEmailConfig() {
  const provider = (process.env.EMAIL_PROVIDER || '').trim().toLowerCase();
  return {
    provider,
    fromName: process.env.EMAIL_FROM_NAME || 'BrightVale Finance',
    fromEmail: (process.env.EMAIL_FROM_EMAIL || '').trim().toLowerCase(),
    brevo: {
      host: process.env.EMAIL_BREVO_HOST || 'smtp-relay.brevo.com',
      port: parseInt(process.env.EMAIL_BREVO_PORT, 10) || 587,
      login: (process.env.EMAIL_BREVO_LOGIN || '').trim(),
      smtpKey: process.env.EMAIL_BREVO_SMTP_KEY || ''
    },
    resend: {
      apiKey: process.env.EMAIL_RESEND_API_KEY || ''
    }
  };
}

// Validate configuration. Returns { ok, errors: [] }.
function validateEmailConfig() {
  const cfg = getEmailConfig();
  const errors = [];

  if (!['brevo', 'resend'].includes(cfg.provider)) {
    errors.push(`EMAIL_PROVIDER must be "brevo" or "resend" (got "${cfg.provider || '(unset)'})"`);
  }
  if (!cfg.fromEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cfg.fromEmail)) {
    errors.push('EMAIL_FROM_EMAIL is missing or invalid');
  }
  if (cfg.provider === 'brevo') {
    if (!cfg.brevo.login) errors.push('EMAIL_BREVO_LOGIN is required for Brevo (your Brevo account email)');
    if (!cfg.brevo.smtpKey) errors.push('EMAIL_BREVO_SMTP_KEY is required for Brevo');
  }
  if (cfg.provider === 'resend') {
    if (!cfg.resend.apiKey) errors.push('EMAIL_RESEND_API_KEY is required for Resend');
  }
  return { ok: errors.length === 0, errors, config: cfg };
}

// Public status for the admin UI — contains NO secrets.
function getEmailStatus() {
  const { ok, errors, config } = validateEmailConfig();
  return {
    provider: config.provider || null,
    fromName: config.fromName,
    fromEmail: config.fromEmail || null,
    configured: ok,
    issues: errors,
    configuredVia: 'environment'
  };
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

let brevoTransporter = null;

async function getBrevoTransporter() {
  if (!brevoTransporter) {
    const cfg = getEmailConfig();
    brevoTransporter = nodemailer.createTransport({
      host: cfg.brevo.host,
      port: cfg.brevo.port,
      secure: cfg.brevo.port === 465,
      auth: {
        user: cfg.brevo.login,
        pass: cfg.brevo.smtpKey
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000
    });
  }
  return brevoTransporter;
}

async function sendViaBrevo({ from, to, subject, text, html }) {
  const transporter = await getBrevoTransporter();
  const info = await transporter.sendMail({ from, to, subject, text, html });
  return info.messageId;
}

async function sendViaResend({ from, to, subject, text, html }) {
  const cfg = getEmailConfig();
  const response = await axios.post(
    'https://api.resend.com/emails',
    { from, to: [to], subject, text, html },
    {
      headers: { Authorization: `Bearer ${cfg.resend.apiKey}` },
      timeout: 15000
    }
  );
  return response.data && response.data.id;
}

// ---------------------------------------------------------------------------
// Core send
// ---------------------------------------------------------------------------

// Recent-send dedupe: prevents accidental double-emails (double clicks,
// retried requests) for the same recipient + template within the window.
const recentSends = new Map();
const DEDUPE_MS = 30 * 1000;

function sendEmail(to, subject, html, text, { dedupeKey = null, dedupeMs = DEDUPE_MS } = {}) {
  return (async () => {
    const { ok, errors, config } = validateEmailConfig();
    if (!ok) {
      console.error(`Email not sent (${to}, "${subject}"): provider not configured. ${errors.join('; ')}`);
      return { success: false, error: 'Email provider not configured' };
    }

    if (dedupeKey) {
      const last = recentSends.get(dedupeKey);
      if (last && Date.now() - last < dedupeMs) {
        return { success: true, deduped: true };
      }
    }

    const from = `"${config.fromName}" <${config.fromEmail}>`;
    const payload = { from, to, subject, text: text || html.replace(/<[^>]*>/g, ''), html };

    let messageId;
    try {
      messageId = config.provider === 'resend'
        ? await sendViaResend(payload)
        : await sendViaBrevo(payload);
    } catch (error) {
      // Never log credentials or full request payloads
      const status = error.response && error.response.status;
      console.error(`Email send failed via ${config.provider} (${to}):`, status ? `HTTP ${status}` : error.message);
      return { success: false, error: status ? `Provider error (HTTP ${status})` : 'Provider error' };
    }

    if (dedupeKey) {
      recentSends.set(dedupeKey, Date.now());
      if (recentSends.size > 5000) {
        const cutoff = Date.now() - dedupeMs;
        for (const [k, v] of recentSends) if (v < cutoff) recentSends.delete(k);
      }
    }
    return { success: true, messageId };
  })();
}

// ---------------------------------------------------------------------------
// Convenience senders (preserve existing signatures)
// ---------------------------------------------------------------------------

async function sendEmailToUser(userId, subject, html, text, options = {}) {
  const User = require('../models/User');
  const user = await User.findById(userId).select('email name');
  if (!user) return { success: false, error: 'User not found' };

  const personalizedHtml = html.replace(/\{\{name\}\}/g, user.name).replace(/\{\{email\}\}/g, user.email);
  const personalizedText = text ? text.replace(/\{\{name\}\}/g, user.name).replace(/\{\{email\}\}/g, user.email) : null;

  return sendEmail(user.email, subject, personalizedHtml, personalizedText, options);
}

async function sendBroadcastToAll(subject, html, text) {
  const User = require('../models/User');
  const users = await User.find({ role: 'user', isActive: true }).select('email name');

  const results = { total: users.length, sent: 0, failed: 0, errors: [] };
  const batchSize = 50;

  for (let i = 0; i < users.length; i += batchSize) {
    const batch = users.slice(i, i + batchSize);
    await Promise.all(batch.map(async (user) => {
      const personalizedHtml = html.replace(/\{\{name\}\}/g, user.name).replace(/\{\{email\}\}/g, user.email);
      const personalizedText = text ? text.replace(/\{\{name\}\}/g, user.name).replace(/\{\{email\}\}/g, user.email) : null;
      const result = await sendEmail(user.email, subject, personalizedHtml, personalizedText);
      if (result.success) results.sent++;
      else { results.failed++; results.errors.push({ email: user.email, error: result.error }); }
    }));
    if (i + batchSize < users.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  return { success: true, results };
}

// ---------------------------------------------------------------------------
// Branded template helpers — every flow emails through these
// ---------------------------------------------------------------------------

function layout(title, bodyHtml) {
  return `
    <div style="margin:0;padding:24px;background:#0F0E13;font-family:Segoe UI,Arial,sans-serif;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#4C1D95,#6D28D9);padding:20px 28px;color:#ffffff;font-size:18px;font-weight:700;">
          BrightVale Finance
        </div>
        <div style="padding:28px;color:#241b3a;font-size:15px;line-height:1.6;">
          <h2 style="margin:0 0 16px;font-size:19px;">${title}</h2>
          ${bodyHtml}
        </div>
        <div style="padding:16px 28px;background:#f6f4fa;color:#8a8699;font-size:12px;">
          This is an automated message from BrightVale Finance. If you did not request it, please contact support.
        </div>
      </div>
    </div>`;
}

const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Fire-and-forget wrappers: failures are logged, never thrown into business flows.
const fire = (promise) => promise.catch((e) => console.warn('Email helper error:', e.message));

const sendVerificationCode = (userId, code) => fire(sendEmailToUser(
  userId,
  'Your BrightVale Finance verification code',
  layout('Verify your email', `<p>Hi {{name}},</p><p>Your verification code is:</p><p style="font-size:28px;letter-spacing:6px;font-weight:700;color:#4C1D95;">${code}</p><p>This code expires in <b>15 minutes</b> and can be used once.</p>`),
  `Your BrightVale Finance verification code is ${code}. It expires in 15 minutes.`,
  { dedupeKey: `verify:${userId}` }
));

const sendPasswordReset = (userId, resetUrl) => fire(sendEmailToUser(
  userId,
  'BrightVale Finance password reset',
  layout('Reset your password', `<p>Hi {{name}},</p><p>You requested a password reset. Click below to choose a new password — the link is valid for <b>1 hour</b> and works once.</p><p style="margin:24px 0;"><a href="${resetUrl}" style="background:#6D28D9;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;">Reset password</a></p><p style="word-break:break-all;color:#8a8699;">${resetUrl}</p>`),
  `Reset your BrightVale Finance password using this link (valid for 1 hour): ${resetUrl}`,
  { dedupeKey: `reset:${userId}` }
));

const sendWelcomeEmail = (userId, accountNumber) => fire(sendEmailToUser(
  userId,
  'Welcome to BrightVale Finance',
  layout('Welcome aboard', `<p>Hi {{name}},</p><p>Your account is verified and ready. Your BrightVale account number is <b>${accountNumber || 'available in your dashboard'}</b>.</p><p>You can now deposit, transfer between checking and savings, explore investment plans, and apply for loans — all from one dashboard.</p>`),
  'Welcome to BrightVale Finance — your account is verified and ready.',
  { dedupeKey: `welcome:${userId}` }
));

const sendLoginOtp = (userId, code) => fire(sendEmailToUser(
  userId,
  'Your BrightVale Finance sign-in code',
  layout('Sign-in verification', `<p>Hi {{name}},</p><p>Your sign-in code is:</p><p style="font-size:28px;letter-spacing:6px;font-weight:700;color:#4C1D95;">${code}</p><p>This code expires in <b>10 minutes</b>. If you did not attempt to sign in, change your password immediately.</p>`),
  `Your BrightVale Finance sign-in code is ${code}. It expires in 10 minutes.`,
  { dedupeKey: `loginotp:${userId}` }
));

const sendSecurityAlert = (userId, title, detailHtml) => fire(sendEmailToUser(
  userId,
  `BrightVale Finance security: ${title}`,
  layout(title, `<p>Hi {{name}},</p>${detailHtml}<p>If this was not you, contact support immediately.</p>`),
  `BrightVale Finance security notice: ${title}. If this was not you, contact support immediately.`,
  { dedupeKey: `sec:${userId}:${title}` }
));

const sendTransactionEmail = (userId, { title, amount, description, status }) => fire(sendEmailToUser(
  userId,
  `BrightVale Finance: ${title}`,
  layout(title, `<p>Hi {{name}},</p><table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:8px 0;color:#8a8699;">Transaction</td><td style="text-align:right;">${description}</td></tr>
      <tr><td style="padding:8px 0;color:#8a8699;">Amount</td><td style="text-align:right;font-weight:700;">${money(amount)}</td></tr>
      <tr><td style="padding:8px 0;color:#8a8699;">Status</td><td style="text-align:right;text-transform:capitalize;">${status}</td></tr>
    </table>`),
  `BrightVale Finance: ${title} — ${description}, ${money(amount)} (${status})`,
  { dedupeKey: `txn:${userId}:${title}:${description}:${amount}` }
));

module.exports = {
  sendEmail,
  sendEmailToUser,
  sendBroadcastToAll,
  getEmailStatus,
  validateEmailConfig,
  sendVerificationCode,
  sendPasswordReset,
  sendWelcomeEmail,
  sendLoginOtp,
  sendSecurityAlert,
  sendTransactionEmail
};
