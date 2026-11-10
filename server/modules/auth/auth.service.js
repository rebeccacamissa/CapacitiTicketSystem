'use strict';
// Owner: Member A
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { getDb } = require('../../db/connection');
const { bcryptRounds } = require('../../config/env');
const { AppError, badRequest } = require('../../utils/AppError');
const { createUser } = require('../people/people.service');
const { avatarOf } = require('../avatar/catalog');
const email = require('../../services/email');

// Constant-ish response time for unknown emails (prevents user enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);
const RESET_MINUTES = 30;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Self-registration is ALWAYS a candidate; staff accounts are created by an admin. */
async function register(data) {
  const db = getDb();
  const id = await createUser(db, { ...data, role: 'candidate' });
  return publicUser(await db.one('SELECT * FROM users WHERE id = ?', id));
}

async function login({ email: addr, password }) {
  const user = await getDb().one('SELECT * FROM users WHERE email = ?', addr.toLowerCase());
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
  if (!user.is_active) throw new AppError(403, 'ACCOUNT_DISABLED', 'This account has been deactivated');
  return publicUser(user);
}

async function changePassword(userId, { currentPassword, newPassword }) {
  const db = getDb();
  const user = await db.one('SELECT password_hash FROM users WHERE id = ?', userId);
  if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
    throw badRequest('Current password is incorrect', { fields: { currentPassword: 'Current password is incorrect' } });
  }
  if (currentPassword === newPassword) {
    throw badRequest('Choose a password different from your current one', { fields: { newPassword: 'Must differ from the current password' } });
  }
  const hash = await bcrypt.hash(newPassword, bcryptRounds);
  await db.run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', hash, userId);
}

/**
 * Start a password reset. Always "succeeds" from the caller's point of view, so the
 * response never reveals whether an account exists. The token is random (256 bits),
 * only its SHA-256 hash is stored, it expires after 30 minutes and works once.
 * Returns the raw token only for tests (never sent in the HTTP response).
 */
async function forgotPassword(addr) {
  const db = getDb();
  const user = await db.one('SELECT id, first_name, full_name, email, is_active FROM users WHERE email = ?', addr.toLowerCase());
  if (!user || !user.is_active) return null;
  // At most 3 live tokens per user; older ones are invalidated.
  await db.run('UPDATE password_reset_tokens SET used_at = now_iso() WHERE user_id = ? AND used_at IS NULL AND id NOT IN (SELECT id FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL ORDER BY id DESC LIMIT 2)', user.id, user.id);
  const token = crypto.randomBytes(32).toString('base64url');
  await db.run("INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, iso_shift(? || ' minutes'))", user.id, sha256(token), RESET_MINUTES);
  email.notify(db, {
    to: user.email,
    kind: 'password_reset',
    subject: 'Reset your CAPACITI password',
    heading: `Hi ${user.first_name || user.full_name.split(' ')[0]}, reset your password`,
    lines: [
      `Someone (hopefully you) asked to reset the password for ${user.email}.`,
      `This link works once and expires in ${RESET_MINUTES} minutes. If you didn't ask for this, you can ignore this email: your password stays the same.`,
    ],
    cta: { label: 'Choose a new password', href: email.link(`/reset-password?token=${token}`) },
  });
  return token;
}

async function resetPassword({ token, newPassword }) {
  const db = getDb();
  const hash = await bcrypt.hash(newPassword, bcryptRounds);
  return db.tx(async (t) => {
    const row = await t.one(`
      SELECT prt.id, prt.user_id FROM password_reset_tokens prt JOIN users u ON u.id = prt.user_id
      WHERE prt.token_hash = ? AND prt.used_at IS NULL AND prt.expires_at > now_iso() AND u.is_active = 1
      FOR UPDATE OF prt
    `, sha256(String(token)));
    if (!row) throw new AppError(400, 'RESET_TOKEN_INVALID', 'This reset link is invalid or has expired. Please request a new one.');
    await t.run('UPDATE password_reset_tokens SET used_at = now_iso() WHERE user_id = ? AND used_at IS NULL', row.user_id);
    await t.run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', hash, row.user_id);
    return row.user_id;
  });
}

function publicUser(u) {
  return {
    id: u.id, fullName: u.full_name, firstName: u.first_name || u.full_name.split(' ')[0], email: u.email, role: u.role,
    gender: u.gender, avatar: avatarOf(u), mustChangePassword: !!u.must_change_password, tourDone: !!u.tour_done, language: u.language || 'en',
    privacyAcknowledged: !!u.privacy_ack_at,
  };
}

module.exports = { register, login, changePassword, forgotPassword, resetPassword, publicUser };
