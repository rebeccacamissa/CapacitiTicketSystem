'use strict';
const express = require('express');
const { getDb } = require('../../db/connection');
const { authenticate, authorize } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const svc = require('./stage.service');
const rules = require('./stage.rules');
const gamify = require('../engage/gamification.service');
const bus = require('../../realtime/bus');

const router = express.Router();
router.use(authenticate);

router.get('/', (req, res) => res.json({ stages: rules.stages(getDb()) }));

router.get('/candidates', authorize('admin', 'facilitator'), (req, res) => {
  const db = getDb();
  res.json({ candidates: svc.candidates(db, req.user), stages: rules.stages(db), streams: req.user.role === 'facilitator' ? rules.facilitatorStreams(db, req.user.id) : undefined });
});

router.get('/pipeline', authorize('admin', 'facilitator'), (req, res) => res.json(svc.pipeline(getDb(), req.user)));

router.get(
  '/decisions',
  authorize('admin', 'facilitator', 'candidate'),
  validate({ candidateId: { type: 'int', min: 1 }, limit: { type: 'int', min: 1, max: 500 } }, 'query'),
  (req, res) => res.json({ decisions: svc.history(getDb(), req.user, req.validQuery) })
);

router.post(
  '/candidates/:id/decisions',
  authorize('admin', 'facilitator'),
  validate({ id: { type: 'int', required: true, min: 1 } }, 'params'),
  validate({
    toStage: { type: 'string', required: true, max: 20, label: 'Proposed stage' },
    reason: { type: 'string', required: true, max: 1000, label: 'Reason' },
  }),
  (req, res) => {
    const db = getDb();
    const out = svc.decide(db, { candidateId: req.params.id, toStage: req.body.toStage, reason: req.body.reason, actor: req.user });
    // Reaching a new stage earns its milestone badge (idempotent; moving back never removes it).
    if (out.direction === 'forward') gamify.award(db, req.params.id, 'milestone', out.toStage);
    bus.publish([req.params.id], 'progress', {});
    bus.publish([req.params.id], 'notify', {});
    bus.publish('staff', 'people', {});
    res.status(201).json(out);
  }
);

module.exports = router;
