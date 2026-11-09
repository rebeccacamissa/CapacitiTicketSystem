'use strict';
const express = require('express');
const { getDb } = require('../../db/connection');
const { authenticate, authorize } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const svc = require('./progress.service');
const rules = require('../stages/stage.rules');
const gamify = require('../engage/gamification.service');
const bus = require('../../realtime/bus');

const router = express.Router();
router.use(authenticate);

router.get('/me', authorize('candidate'), (req, res) => res.json(svc.getRoadmap(getDb(), req.user.id)));

// Support/admin see every candidate; facilitators only those in their streams.
router.get('/candidates', authorize('support', 'admin', 'facilitator'), (req, res) => {
  const db = getDb();
  const scope = rules.scopeSql(db, req.user);
  const rows = db.prepare(`
    SELECT u.id, u.full_name, u.email FROM users u LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
    WHERE u.role = 'candidate' AND u.is_active = 1 AND ${scope.sql} ORDER BY u.full_name
  `).all(...scope.params);
  res.json({ candidates: rows });
});

router.get(
  '/:candidateId',
  authorize('support', 'admin', 'facilitator'),
  validate({ candidateId: { type: 'int', required: true, min: 1 } }, 'params'),
  (req, res) => {
    rules.assertCanSeeCandidate(getDb(), req.user, req.params.candidateId);
    res.json(svc.getRoadmap(getDb(), req.params.candidateId));
  }
);

router.put(
  '/:candidateId/requirements/:requirementId',
  authorize('support', 'admin', 'facilitator'),
  validate({ candidateId: { type: 'int', required: true, min: 1 }, requirementId: { type: 'int', required: true, min: 1 } }, 'params'),
  validate({ completed: { type: 'bool', required: true } }),
  (req, res) => {
    const db = getDb();
    const roadmap = svc.setRequirement(db, { ...req.params, completed: req.body.completed, actor: req.user });
    const cid = req.params.candidateId;
    // Evidence earns XP; milestone badges come from official stage decisions (stages module).
    if (req.body.completed) gamify.award(db, cid, 'requirement', req.params.requirementId);
    bus.publish([cid], 'progress', {});
    bus.publish([cid], 'notify', {});
    bus.publish('staff', 'people', {});
    res.json(roadmap);
  }
);

module.exports = router;
