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

const params = validate({ candidateId: { type: 'int', required: true, min: 1 }, requirementId: { type: 'int', required: true, min: 1 } }, 'params');

router.get('/me', authorize('candidate'), async (req, res) => res.json(await svc.getRoadmap(getDb(), req.user.id)));

// Support/admin see every candidate; facilitators only those in their streams.
router.get('/candidates', authorize('support', 'admin', 'facilitator'), async (req, res) => {
  const db = getDb();
  const scope = await rules.scopeSql(db, req.user);
  const rows = await db.all(`
    SELECT u.id, u.full_name, u.email FROM users u LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
    WHERE u.role = 'candidate' AND u.is_active = 1 AND ${scope.sql} ORDER BY u.full_name
  `, scope.params);
  res.json({ candidates: rows });
});

router.get(
  '/:candidateId',
  authorize('support', 'admin', 'facilitator'),
  validate({ candidateId: { type: 'int', required: true, min: 1 } }, 'params'),
  async (req, res) => {
    await rules.assertCanSeeCandidate(getDb(), req.user, req.params.candidateId);
    const roadmap = await svc.getRoadmap(getDb(), req.params.candidateId);
    // Staff can link evidence: include the candidate's documents.
    roadmap.files = await getDb().all('SELECT id, kind, title FROM portfolio_files WHERE candidate_id = ? ORDER BY created_at DESC', req.params.candidateId);
    res.json(roadmap);
  }
);

const changed = (cid) => { bus.publish([cid], 'progress', {}); bus.publish([cid], 'notify', {}); bus.publish('staff', 'people', {}); };

router.put(
  '/:candidateId/requirements/:requirementId',
  authorize('support', 'admin', 'facilitator'),
  params,
  validate({ completed: { type: 'bool', required: true }, fileId: { type: 'int', min: 1 } }),
  async (req, res) => {
    const db = getDb();
    const roadmap = await svc.setRequirement(db, { ...req.params, completed: req.body.completed, fileId: req.body.fileId, actor: req.user });
    // Evidence earns XP; milestone badges come from official stage decisions (stages module).
    if (req.body.completed) await gamify.award(db, req.params.candidateId, 'requirement', req.params.requirementId);
    changed(req.params.candidateId);
    roadmap.files = await db.all('SELECT id, kind, title FROM portfolio_files WHERE candidate_id = ? ORDER BY created_at DESC', req.params.candidateId);
    res.json(roadmap);
  }
);

/** Link an uploaded document to a verified checklist item (fileId null to unlink). */
router.put(
  '/:candidateId/requirements/:requirementId/evidence',
  authorize('support', 'admin', 'facilitator'),
  params,
  async (req, res) => {
    const fileId = req.body?.fileId === null ? null : Number(req.body?.fileId);
    const db = getDb();
    const roadmap = await svc.linkEvidence(db, { ...req.params, fileId: Number.isInteger(fileId) && fileId > 0 ? fileId : null, actor: req.user });
    changed(req.params.candidateId);
    roadmap.files = await db.all('SELECT id, kind, title FROM portfolio_files WHERE candidate_id = ? ORDER BY created_at DESC', req.params.candidateId);
    res.json(roadmap);
  }
);

module.exports = router;
