'use strict';
// Owner: Member A
const express = require('express');
const { getDb } = require('../../db/connection');
const { validate, EMAIL_RE, PASSWORD_RE, DOB_RULE, NAME_RULE } = require('../../middleware/validate');
const { authenticate, signToken, setAuthCookie, clearAuthCookie } = require('../../middleware/auth');
const { rateLimit } = require('../../middleware/rateLimit');
const { demoMode } = require('../../config/env');
const { notFound } = require('../../utils/AppError');
const service = require('./auth.service');

const router = express.Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const PASSWORD = {
  type: 'string', required: true, trim: false, pattern: PASSWORD_RE, label: 'Password',
  patternMessage: 'Password needs 8+ characters with upper-case, lower-case and a number',
};

router.post(
  '/register',
  authLimiter,
  validate({
    firstName: NAME_RULE('First name'),
    surname: NAME_RULE('Surname'),
    dateOfBirth: { ...DOB_RULE, required: true },
    gender: { type: 'enum', required: true, values: ['female', 'male', 'non-binary', 'prefer-not'], label: 'Gender' },
    email: { type: 'string', required: true, max: 254, pattern: EMAIL_RE, patternMessage: 'Enter a valid email address', label: 'Email' },
    password: PASSWORD,
    cohort: { type: 'string', max: 80 },
    stream: { type: 'string', max: 80 },
    mentor: { type: 'string', max: 120 },
    techChamp: { type: 'string', max: 120 },
    supervisor: { type: 'string', max: 120 },
  }),
  async (req, res) => {
    const user = await service.register(req.body);
    setAuthCookie(res, signToken(user));
    res.status(201).json({ user });
  }
);

router.post(
  '/login',
  authLimiter,
  validate({
    email: { type: 'string', required: true, max: 254, label: 'Email' },
    password: { type: 'string', required: true, trim: false, max: 200, label: 'Password' },
  }),
  async (req, res) => {
    const user = await service.login({ ...req.body, email: req.body.email.toLowerCase() });
    setAuthCookie(res, signToken(user));
    res.json({ user });
  }
);

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.status(204).end();
});

router.get('/me', authenticate, (req, res) => res.json({ user: req.user, demoMode }));

router.post(
  '/change-password',
  authenticate,
  authLimiter,
  validate({ currentPassword: { type: 'string', required: true, trim: false, max: 200 }, newPassword: { ...PASSWORD, label: 'New password' } }),
  async (req, res) => {
    await service.changePassword(req.user.id, req.body);
    res.json({ ok: true });
  }
);

// ---- Password reset by email ------------------------------------------------------
const resetLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });

/** Always 202 with the same message, whether or not the account exists (no user enumeration). */
router.post(
  '/forgot-password',
  resetLimiter,
  validate({ email: { type: 'string', required: true, max: 254, pattern: EMAIL_RE, patternMessage: 'Enter a valid email address', label: 'Email' } }),
  async (req, res) => {
    await service.forgotPassword(req.body.email);
    res.status(202).json({ ok: true, message: 'If an account exists for that email, we have sent a reset link. It expires in 30 minutes.' });
  }
);

router.post(
  '/reset-password',
  resetLimiter,
  validate({ token: { type: 'string', required: true, min: 20, max: 200, trim: false }, newPassword: { ...PASSWORD, label: 'New password' } }),
  async (req, res) => {
    await service.resetPassword(req.body);
    res.json({ ok: true });
  }
);

// ---- Demo role switcher (DEMO_MODE=true, never in production) -------------------
const DEMO_EMAILS = {
  candidate: 'lerato@example.com',
  support: 'thabo@capaciti.org.za',
  admin: 'admin@capaciti.org.za',
  recruiter: 'recruiter@capaciti.org.za',
  facilitator: 'facilitator@capaciti.org.za',
};

router.get('/demo-accounts', async (req, res) => {
  if (!demoMode) return res.json({ enabled: false, accounts: [] });
  const rows = await getDb().all(`SELECT id, full_name, role, email FROM users WHERE email IN (${Object.values(DEMO_EMAILS).map(() => '?').join(',')}) AND is_active = 1`, Object.values(DEMO_EMAILS));
  res.json({ enabled: true, accounts: rows.map((r) => ({ role: r.role, name: r.full_name })) });
});

router.post('/demo-login', validate({ role: { type: 'enum', required: true, values: Object.keys(DEMO_EMAILS) } }), async (req, res) => {
  if (!demoMode) throw notFound();
  const u = await getDb().one('SELECT * FROM users WHERE email = ? AND is_active = 1', DEMO_EMAILS[req.body.role]);
  if (!u) throw notFound('Demo account not found — run npm run db:reset');
  const user = service.publicUser(u);
  setAuthCookie(res, signToken(user));
  res.json({ user });
});

module.exports = router;
