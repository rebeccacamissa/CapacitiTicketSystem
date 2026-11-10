'use strict';
/**
 * JWT authentication + role-based access control.
 * Owner: Member A (Auth & Roles)
 *
 * The token lives in an httpOnly, SameSite=Strict cookie so client JS can't
 * read it (XSS-resistant) and cross-site requests can't send it (CSRF-resistant).
 */
const jwt = require('jsonwebtoken');
const { jwtSecret, jwtExpiresIn, isProd } = require('../config/env');
const { getDb } = require('../db/connection');
const { avatarOf } = require('../modules/avatar/catalog');
const { AppError, unauthorized, forbidden } = require('../utils/AppError');

const COOKIE_NAME = 'capaciti_token';

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, jwtSecret, { expiresIn: jwtExpiresIn });
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProd,
    maxAge: 8 * 60 * 60 * 1000,
    path: '/',
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/** Requires a valid token AND an active user; re-reads role from DB so role changes apply immediately. */
async function authenticate(req, res, next) {
  const header = req.get('authorization') || '';
  const token = req.cookies?.[COOKIE_NAME] || (header.startsWith('Bearer ') ? header.slice(7) : null);
  if (!token) return next(unauthorized());

  let payload;
  try {
    payload = jwt.verify(token, jwtSecret);
  } catch {
    return next(unauthorized('Your session has expired. Please sign in again.'));
  }

  let user;
  try {
    user = await getDb().one('SELECT id, full_name, first_name, email, role, is_active, gender, avatar_config, preferences, tour_done, language, must_change_password, privacy_ack_at FROM users WHERE id = ?', payload.sub);
  } catch (err) { return next(err); }
  if (!user || !user.is_active) return next(unauthorized('Account not found or deactivated'));

  req.user = {
    id: user.id,
    fullName: user.full_name,
    firstName: user.first_name || user.full_name.split(' ')[0],
    email: user.email,
    role: user.role,
    gender: user.gender,
    avatar: avatarOf(user),
    preferences: JSON.parse(user.preferences || '{}'),
    tourDone: !!user.tour_done,
    language: user.language || 'en',
    mustChangePassword: !!user.must_change_password,
    privacyAcknowledged: !!user.privacy_ack_at,
  };

  // Temporary-password accounts may only change their password (or read/sign out) until they do.
  const allowed = ['/api/auth/me', '/api/auth/change-password', '/api/auth/logout'];
  if (req.user.mustChangePassword && !allowed.includes(req.originalUrl.split('?')[0])) {
    return next(new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Please set a new password before continuing'));
  }
  next();
}

/** Usage: authorize('support', 'admin') */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

const isStaff = (user) => user.role === 'support' || user.role === 'admin';

module.exports = { signToken, setAuthCookie, clearAuthCookie, authenticate, authorize, isStaff, COOKIE_NAME };
