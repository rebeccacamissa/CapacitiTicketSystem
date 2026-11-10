'use strict';
const express = require('express');
const { getDb } = require('../../db/connection');
const { authenticate, authorize } = require('../../middleware/auth');
const { validate, DOB_RULE } = require('../../middleware/validate');
const options = require('../../config/options');
const svc = require('./people.service');
const { avatarOf } = require('../avatar/catalog');
const rules = require('../stages/stage.rules');

const router = express.Router();

/** Public: dropdown options for registration. */
router.get('/meta/options', (req, res) => res.json(options));

router.use(authenticate);

// ---- Own profile ------------------------------------------------------------
router.get('/profile/me', async (req, res) => res.json({ profile: await svc.getProfile(getDb(), req.user.id) }));

router.patch(
  '/profile/me',
  validate({
    firstName: { type: 'string', min: 1, max: 60 },
    surname: { type: 'string', min: 1, max: 60 },
    dateOfBirth: DOB_RULE,
    gender: { type: 'enum', values: ['female', 'male', 'non-binary', 'prefer-not'] },
  }),
  async (req, res) => {
    const db = getDb();
    const cur = await svc.getProfile(db, req.user.id);
    if (req.body.gender) await db.run('UPDATE users SET gender = ? WHERE id = ?', req.body.gender, req.user.id);
    const first = req.body.firstName || cur.firstName;
    const last = req.body.surname || cur.surname;
    await db.run('UPDATE users SET first_name = ?, surname = ?, full_name = ?, date_of_birth = COALESCE(?, date_of_birth) WHERE id = ?',
      first, last, `${first} ${last}`, req.body.dateOfBirth || null, req.user.id);
    res.json({ profile: await svc.getProfile(db, req.user.id) });
  }
);

// ---- Birthdays & notifications ----------------------------------------------
router.get('/people/birthdays', authorize('candidate', 'support', 'admin', 'facilitator'), async (req, res) => res.json(await svc.birthdays(getDb())));
router.get('/notifications', async (req, res) => res.json({ items: await svc.notifications(getDb(), req.user) }));

// ---- Candidate information (support/admin: all; facilitators: their streams) ----
router.get('/candidates', authorize('support', 'admin', 'facilitator'), async (req, res) => {
  const db = getDb();
  const scope = await rules.scopeSql(db, req.user);
  const rows = await db.all(`
    SELECT u.id, u.full_name, u.email, u.gender, u.avatar_config, u.accessibility, cp.cohort, cp.stream, cp.mentor, cp.supervisor,
      (SELECT COUNT(*) FROM requests r WHERE r.candidate_id = u.id AND r.status NOT IN ('Resolved','Closed')) AS open_requests
    FROM users u LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
    WHERE u.role = 'candidate' AND u.is_active = 1 AND ${scope.sql} ORDER BY u.full_name
  `, scope.params);
  res.json({ candidates: rows.map(({ avatar_config, accessibility, ...r }) => ({ ...r, avatar: avatarOf({ avatar_config, gender: r.gender }), accessibility: JSON.parse(accessibility || '{}') })) });
});

router.get(
  '/candidates/:id',
  authorize('support', 'admin', 'facilitator'),
  validate({ id: { type: 'int', required: true, min: 1 } }, 'params'),
  async (req, res) => {
    await rules.assertCanSeeCandidate(getDb(), req.user, req.params.id);
    res.json({ profile: await svc.getProfile(getDb(), req.params.id) });
  }
);

router.patch(
  '/candidates/:id',
  authorize('support', 'admin'),
  validate({ id: { type: 'int', required: true, min: 1 } }, 'params'),
  validate({
    firstName: { type: 'string', min: 1, max: 60 },
    surname: { type: 'string', min: 1, max: 60 },
    dateOfBirth: DOB_RULE,
    cohort: { type: 'string', max: 80 },
    stream: { type: 'string', max: 80 },
    mentor: { type: 'string', max: 120 },
    techChamp: { type: 'string', max: 120 },
    supervisor: { type: 'string', max: 120 },
  }),
  async (req, res) => res.json({ profile: await svc.updateCandidateProfile(getDb(), req.params.id, req.body, req.user) })
);

module.exports = router;
