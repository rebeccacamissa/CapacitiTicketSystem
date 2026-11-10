'use strict';
/**
 * Outgoing email via Resend (https://resend.com) using its REST API: no SDK needed.
 * Without RESEND_API_KEY, messages are written to the server log instead of sent,
 * so every flow still works in development. Every attempt is recorded in email_log
 * (recipient, subject, status; never the body, which may contain reset links).
 *
 * Sending never throws into the caller: a failed email must not break a stage
 * decision or a ticket reply. Callers fire-and-forget with send(...).catch(() => {}).
 */
const { resendApiKey, emailFrom, appUrl } = require('../config/env');

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** A simple branded HTML layout. `lines` are plain-text paragraphs (escaped). */
function layout({ heading, lines = [], cta }) {
  return `<!doctype html><html><body style="margin:0;background:#f4f2fb;font-family:Arial,Helvetica,sans-serif;color:#1d2951">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
      <tr><td style="background:#1d2951;padding:20px 28px;color:#ffffff;font-size:18px;font-weight:bold;letter-spacing:2px">CAPACITI</td></tr>
      <tr><td style="padding:28px">
        <h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(heading)}</h1>
        ${lines.map((l) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${escapeHtml(l)}</p>`).join('')}
        ${cta ? `<p style="margin:24px 0"><a href="${escapeHtml(cta.href)}" style="background:#6115d0;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:bold;display:inline-block">${escapeHtml(cta.label)}</a></p>` : ''}
        <p style="margin:24px 0 0;font-size:12px;color:#6b7280">You are receiving this because you have an account on the CAPACITI Candidate Support portal.</p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

const textVersion = ({ heading, lines = [], cta }) => [heading, '', ...lines, ...(cta ? ['', `${cta.label}: ${cta.href}`] : [])].join('\n');

async function log(db, row) {
  try {
    await db.run('INSERT INTO email_log (to_email, subject, kind, status, error) VALUES (?, ?, ?, ?, ?)', row.to, row.subject.slice(0, 200), row.kind, row.status, row.error || null);
  } catch { /* logging must never break the caller */ }
}

/**
 * @param {object} db
 * @param {{ to: string, subject: string, kind: string, heading: string, lines?: string[], cta?: {label: string, href: string} }} msg
 */
async function send(db, msg) {
  const { to, subject, kind } = msg;
  if (!to) return { status: 'skipped' };
  if (!resendApiKey) {
    console.log(`[email:${kind}] (not sent: RESEND_API_KEY not set) to=${to} subject="${subject}"${msg.cta ? ` link=${msg.cta.href}` : ''}`);
    await log(db, { to, subject, kind, status: 'logged' });
    return { status: 'logged' };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: emailFrom, to: [to], subject, html: layout(msg), text: textVersion(msg) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      console.error(`[email:${kind}] Resend error ${res.status}: ${detail}`);
      await log(db, { to, subject, kind, status: 'failed', error: `HTTP ${res.status}` });
      return { status: 'failed' };
    }
    await log(db, { to, subject, kind, status: 'sent' });
    return { status: 'sent' };
  } catch (err) {
    console.error(`[email:${kind}] ${err.message}`);
    await log(db, { to, subject, kind, status: 'failed', error: err.message.slice(0, 200) });
    return { status: 'failed' };
  }
}

/** Fire-and-forget helper used by notifications. */
const notify = (db, msg) => { send(db, msg).catch(() => {}); };

const link = (path) => `${appUrl}${path}`;

module.exports = { send, notify, link, layout };
