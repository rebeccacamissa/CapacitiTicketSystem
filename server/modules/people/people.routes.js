'use strict';
const express = require('express');
const { getDb } = require('../../db/connection');
const { authenticate, authorize } = require('../../middleware/auth');
const { validate, DOB_RULE } = require('../../middleware/validate');
const options = require('../../config/options');
const svc = require('./people.service');
const { avatarOf } = require('../avatar/catalog');

const router = express.Router();

/** Public: dropdown options for registration. */
router.get('/meta/options', (req, res) => res.json(options));

router.use(authenticate);

// ---- Own profile ------------------------------------------------------------
router.get('/profile/me', (req, res) => res.json({ profile: svc.getProfile(getDb(), req.user.id) }));

router.patch(
  '/profile/me',
  validate({
    firstName: { type: 'string', min: 1, max: 60 },
    surname: { type: 'string', min: 1, max: 60 },
    dateOfBirth: DOB_RULE,
    gender: { type: 'enum', values: ['female', 'male', 'non-binary', 'prefer-not'] },
  }),
  (req, res) => {
    const db = getDb();
    const cur = svc.getProfile(db, req.user.id);
    if (req.body.gender) db.prepare('UPDATE users SET gender = ? WHERE id = ?').run(req.body.gender, req.user.id);
    const first = req.body.firstName || cur.firstName;
    const last = req.body.surname || cur.surname;
    db.prepare('UPDATE users SET first_name = ?, surname = ?, full_name = ?, date_of_birth = COALESCE(?, date_of_birth) WHERE id = ?')
      .run(first, last, `${first} ${last}`, req.body.dateOfBirth || null, req.user.id);
    res.json({ profile: svc.getProfile(db, req.user.id) });
  }
);

// ---- Birthdays & notifications ----------------------------------------------
router.get('/people/birthdays', (req, res) => res.json(svc.birthdays(getDb())));
router.get('/notifications', (req, res) => res.json({ items: svc.notifications(getDb(), req.user) }));

// ---- Candidate information (managers / support) ------------------------------
router.get('/candidates', authorize('support', 'admin'), (req, res) => {
  const rows = getDb().prepare(`
    SELECT u.id, u.full_name, u.email, u.gender, u.avatar_config, u.accessibility, cp.cohort, cp.stream, cp.mentor, cp.supervisor,
      (SELECT COUNT(*) FROM requests r WHERE r.candidate_id = u.id AND r.status NOT IN ('Resolved','Closed')) AS open_requests
    FROM users u LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
    WHERE u.role = 'candidate' AND u.is_active = 1 ORDER BY u.full_name
  `).all();
  res.json({ candidates: rows.map(({ avatar_config, accessibility, ...r }) => ({ ...r, avatar: avatarOf({ avatar_config, gender: r.gender }), accessibility: JSON.parse(accessibility || '{}') })) });
});

router.get(
  '/candidates/:id',
  authorize('support', 'admin'),
  validate({ id: { type: 'int', required: true, min: 1 } }, 'params'),
  (req, res) => res.json({ profile: svc.getProfile(getDb(), req.params.id) })
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
  (req, res) => res.json({ profile: svc.updateCandidateProfile(getDb(), req.params.id, req.body, req.user) })
);

module.exports = router;
