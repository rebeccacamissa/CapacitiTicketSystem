'use strict';
// Owner: Member A
const bcrypt = require('bcryptjs');
const { getDb } = require('../../db/connection');
const { bcryptRounds } = require('../../config/env');
const { AppError, badRequest } = require('../../utils/AppError');
const { createUser } = require('../people/people.service');
const { avatarOf } = require('../avatar/catalog');

// Constant-ish response time for unknown emails (prevents user enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

/** Self-registration is ALWAYS a candidate; staff accounts are created by an admin. */
async function register(data) {
  const db = getDb();
  const id = await createUser(db, { ...data, role: 'candidate' });
  return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

async function login({ email, password }) {
  const user = getDb().prepare('SELECT * FROM users WHERE email = ?').get(email);
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
  if (!user.is_active) throw new AppError(403, 'ACCOUNT_DISABLED', 'This account has been deactivated');
  return publicUser(user);
}

async function changePassword(userId, { currentPassword, newPassword }) {
  const db = getDb();
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
  if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
    throw badRequest('Current password is incorrect', { fields: { currentPassword: 'Current password is incorrect' } });
  }
  if (currentPassword === newPassword) {
    throw badRequest('Choose a password different from your current one', { fields: { newPassword: 'Must differ from the current password' } });
  }
  const hash = await bcrypt.hash(newPassword, bcryptRounds);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, userId);
}

function publicUser(u) {
  return {
    id: u.id, fullName: u.full_name, firstName: u.first_name || u.full_name.split(' ')[0], email: u.email, role: u.role,
    gender: u.gender, avatar: avatarOf(u), mustChangePassword: !!u.must_change_password, tourDone: !!u.tour_done, language: u.language || 'en',
  };
}

module.exports = { register, login, changePassword, publicUser };
