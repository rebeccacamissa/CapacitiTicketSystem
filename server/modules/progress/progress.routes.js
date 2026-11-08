'use strict';
const express = require('express');
const { getDb } = require('../../db/connection');
const { authenticate, authorize } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const svc = require('./progress.service');
const gamify = require('../engage/gamification.service');
const bus = require('../../realtime/bus');

const router = express.Router();
router.use(authenticate);

router.get('/me', authorize('candidate'), (req, res) => res.json(svc.getRoadmap(getDb(), req.user.id)));

router.get('/candidates', authorize('support', 'admin'), (req, res) => {
  const rows = getDb().prepare("SELECT id, full_name, email FROM users WHERE role = 'candidate' AND is_active = 1 ORDER BY full_name").all();
  res.json({ candidates: rows });
});

router.get(
  '/:candidateId',
  authorize('support', 'admin'),
  validate({ candidateId: { type: 'int', required: true, min: 1 } }, 'params'),
  (req, res) => res.json(svc.getRoadmap(getDb(), req.params.candidateId))
);

router.put(
  '/:candidateId/requirements/:requirementId',
  authorize('support', 'admin'),
  validate({ candidateId: { type: 'int', required: true, min: 1 }, requirementId: { type: 'int', required: true, min: 1 } }, 'params'),
  validate({ completed: { type: 'bool', required: true } }),
  (req, res) => {
    const db = getDb();
    const roadmap = svc.setRequirement(db, { ...req.params, completed: req.body.completed, actor: req.user });
    const cid = req.params.candidateId;
    if (req.body.completed) {
      gamify.award(db, cid, 'requirement', req.params.requirementId);
      for (const m of roadmap.milestones) if (m.state === 'completed') gamify.award(db, cid, 'milestone', m.key);
    }
    bus.publish([cid], 'progress', {});
    bus.publish([cid], 'notify', {});
    res.json(roadmap);
  }
);

module.exports = router;
