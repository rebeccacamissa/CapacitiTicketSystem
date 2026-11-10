'use strict';
/**
 * Administrator control centre: users/roles (with temporary passwords) and request categories.
 * Owner: Member A (users/roles) + Member D (categories)
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../../db/connection');
const { authenticate, authorize } = require('../../middleware/auth');
const { validate, EMAIL_RE, DOB_RULE, NAME_RULE } = require('../../middleware/validate');
const { bcryptRounds } = require('../../config/env');
const { badRequest, notFound, conflict } = require('../../utils/AppError');
const people = require('../people/people.service');
const { avatarOf } = require('../avatar/catalog');

const router = express.Router();
router.use(authenticate, authorize('admin'));

const idParam = validate({ id: { type: 'int', required: true, min: 1 } }, 'params');

// ---- Users ----------------------------------------------------------
router.get('/users', async (req, res) => {
  const users = (await getDb().all(`
    SELECT u.id, u.full_name, u.email, u.role, u.is_active, u.created_at, u.gender, u.avatar_config, u.must_change_password,
      sp.position, sp.employee_id, cp.cohort, cp.stream,
      (SELECT COUNT(*) FROM requests r WHERE r.assigned_to = u.id AND r.status NOT IN ('Resolved','Closed')) AS active_assigned,
      (SELECT COUNT(*) FROM requests r WHERE r.candidate_id = u.id) AS requests_raised
    FROM users u
    LEFT JOIN staff_profiles sp ON sp.user_id = u.id
    LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
    ORDER BY u.role, u.full_name
  `));
  const streams = (await getDb().all('SELECT user_id, stream FROM facilitator_streams ORDER BY stream'));
  res.json({ users: users.map((u) => ({
    ...u, streams: u.role === 'facilitator' ? streams.filter((s) => s.user_id === u.id).map((s) => s.stream) : undefined, is_active: !!u.is_active, must_change_password: !!u.must_change_password,
    avatar: avatarOf(u), avatar_config: undefined,
  })) });
});

/**
 * Create any user. The server generates a temporary password, returns it ONCE,
 * and flags the account so the user must change it at first sign-in.
 */
router.post(
  '/users',
  validate({
    firstName: NAME_RULE('First name'),
    surname: NAME_RULE('Surname'),
    email: { type: 'string', required: true, max: 254, pattern: EMAIL_RE, patternMessage: 'Enter a valid email address', label: 'Email' },
    role: { type: 'enum', required: true, values: ['candidate', 'support', 'admin', 'recruiter', 'facilitator'] },
    dateOfBirth: DOB_RULE,
    gender: { type: 'enum', values: ['female', 'male', 'non-binary', 'prefer-not'], default: 'prefer-not' },
    position: { type: 'string', max: 80 },
    employeeId: { type: 'string', max: 20, pattern: /^[A-Za-z0-9-]+$/, patternMessage: 'Employee ID may contain letters, numbers and hyphens' },
    cohort: { type: 'string', max: 80 },
    stream: { type: 'string', max: 80 },
    mentor: { type: 'string', max: 120 },
    techChamp: { type: 'string', max: 120 },
    supervisor: { type: 'string', max: 120 },
    streams: { type: 'array', of: 'string', max: 20, itemMax: 80 },
  }),
  async (req, res) => {
    if (req.body.role !== 'candidate' && !req.body.employeeId) {
      throw badRequest('Employee ID is required for staff accounts', { fields: { employeeId: 'Employee ID is required for staff' } });
    }
    const tempPassword = people.generateTempPassword();
    const streams = Array.isArray(req.body.streams) ? req.body.streams.filter((x) => typeof x === 'string') : [];
    const id = await people.createUser(getDb(), { ...req.body, streams, password: tempPassword, mustChangePassword: true, createdBy: req.user.id });
    res.status(201).json({ id, tempPassword });
  }
);

/** Assign a facilitator to one or more streams (replaces the current list). */
router.put('/users/:id/streams', idParam, async (req, res) => {
  const db = getDb();
  const u = (await db.one('SELECT role FROM users WHERE id = ?', req.params.id));
  if (!u) throw notFound('User not found');
  if (u.role !== 'facilitator') throw badRequest('Only facilitators are assigned to streams');
  if (!Array.isArray(req.body?.streams) || req.body.streams.some((x) => typeof x !== 'string')) throw badRequest('streams must be a list of stream names');
  const streams = await db.tx((t) => people.setFacilitatorStreams(t, req.params.id, req.body.streams));
  res.json({ streams });
});

router.post('/users/:id/reset-password', idParam, async (req, res) => {
  const db = getDb();
  if (!(await db.one('SELECT 1 FROM users WHERE id = ?', req.params.id))) throw notFound('User not found');
  const tempPassword = people.generateTempPassword();
  const hash = await bcrypt.hash(tempPassword, bcryptRounds);
  (await db.run('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?', hash, req.params.id));
  res.json({ tempPassword });
});

router.patch(
  '/users/:id',
  idParam,
  validate({ role: { type: 'enum', values: ['candidate', 'support', 'admin', 'recruiter', 'facilitator'] }, isActive: { type: 'bool' } }),
  async (req, res) => {
    const db = getDb();
    const { id } = req.params;
    const user = (await db.one('SELECT * FROM users WHERE id = ?', id));
    if (!user) throw notFound('User not found');
    if (id === req.user.id && ((req.body.role && req.body.role !== 'admin') || req.body.isActive === false)) {
      throw badRequest('You cannot remove your own admin access');
    }
    const demotingStaff = user.role !== 'candidate' && (req.body.role === 'candidate' || req.body.isActive === false);
    if (demotingStaff) {
      const { n } = (await db.one("SELECT COUNT(*) n FROM requests WHERE assigned_to = ? AND status NOT IN ('Resolved','Closed')", id));
      if (n > 0) throw conflict('HAS_ACTIVE_ASSIGNMENTS', `Reassign this user's ${n} active request(s) first`);
    }
    await db.tx(async (t) => {
      if (req.body.role) {
        await t.run('UPDATE users SET role = ? WHERE id = ?', req.body.role, id);
        if (req.body.role === 'candidate') await t.run('INSERT INTO candidate_profiles (user_id, updated_by) VALUES (?, ?) ON CONFLICT DO NOTHING', id, req.user.id);
        else await t.run('INSERT INTO staff_profiles (user_id) VALUES (?) ON CONFLICT DO NOTHING', id);
      }
      if (req.body.isActive !== undefined) (await t.run('UPDATE users SET is_active = ? WHERE id = ?', req.body.isActive ? 1 : 0, id));
    });
    res.json({ ok: true });
  }
);

/**
 * Permanently remove a user. Accounts with any support history are kept for the
 * audit trail — those must be deactivated instead.
 */
router.delete('/users/:id', idParam, async (req, res) => {
  const db = getDb();
  const { id } = req.params;
  if (id === req.user.id) throw badRequest('You cannot remove your own account');
  if (!(await db.one('SELECT 1 FROM users WHERE id = ?', id))) throw notFound('User not found');
  const { n } = (await db.one(`
    SELECT (SELECT COUNT(*) FROM requests WHERE candidate_id = ? OR assigned_to = ?)
         + (SELECT COUNT(*) FROM request_messages WHERE author_id = ?)
         + (SELECT COUNT(*) FROM audit_log WHERE changed_by_user_id = ?)
         + (SELECT COUNT(*) FROM stage_decisions WHERE candidate_id = ? OR decided_by = ?) AS n
  `, id, id, id, id, id, id));
  if (n > 0) {
    throw conflict('USER_HAS_HISTORY', 'This user has support history that must be kept for the audit trail. Deactivate them instead.');
  }
  await db.tx(async (db) => {
    (await db.run('DELETE FROM candidate_requirement_progress WHERE candidate_id = ?', id));
    (await db.run('UPDATE candidate_requirement_progress SET verified_by = NULL WHERE verified_by = ?', id));
    (await db.run('DELETE FROM candidate_stages WHERE candidate_id = ?', id));
    (await db.run('DELETE FROM candidate_profiles WHERE user_id = ?', id));
    (await db.run('UPDATE candidate_profiles SET updated_by = NULL WHERE updated_by = ?', id));
    (await db.run('DELETE FROM staff_profiles WHERE user_id = ?', id));
    (await db.run('DELETE FROM users WHERE id = ?', id));
  });
  res.status(204).end();
});


// ---- Categories ------------------------------------------------------
router.get('/categories', async (req, res) => {
  const rows = (await getDb().all(`
    SELECT c.*, (SELECT COUNT(*) FROM requests r WHERE r.category_id = c.id) AS request_count
    FROM categories c ORDER BY c.name
  `));
  res.json({ categories: rows.map((c) => ({ ...c, is_active: !!c.is_active, is_blocker: !!c.is_blocker })) });
});

router.post(
  '/categories',
  validate({
    name: { type: 'string', required: true, min: 2, max: 60 },
    description: { type: 'string', max: 200 },
    isBlocker: { type: 'bool', default: false },
  }),
  async (req, res) => {
    const id = await getDb().insert('INSERT INTO categories (name, description, is_blocker) VALUES (?, ?, ?)', req.body.name, req.body.description || null, req.body.isBlocker ? 1 : 0);
    res.status(201).json({ id });
  }
);

router.patch(
  '/categories/:id',
  idParam,
  validate({
    name: { type: 'string', min: 2, max: 60 },
    description: { type: 'string', max: 200 },
    isActive: { type: 'bool' },
    isBlocker: { type: 'bool' },
  }),
  async (req, res) => {
    const db = getDb();
    if (!(await db.one('SELECT 1 FROM categories WHERE id = ?', req.params.id))) throw notFound('Category not found');
    const b = req.body;
    (await db.run(`
      UPDATE categories SET
        name = COALESCE(?, name), description = COALESCE(?, description),
        is_active = COALESCE(?, is_active), is_blocker = COALESCE(?, is_blocker)
      WHERE id = ?
    `, b.name ?? null, b.description ?? null,
      b.isActive === undefined ? null : Number(b.isActive), b.isBlocker === undefined ? null : Number(b.isBlocker), req.params.id));
    res.json({ ok: true });
  }
);

module.exports = router;
