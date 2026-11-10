'use strict';
const express = require('express');
const { getDb } = require('../../db/connection');
const { authenticate, authorize } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { badRequest } = require('../../utils/AppError');
const svc = require('./stage.service');
const rules = require('./stage.rules');
const exportsSvc = require('../reports/exports');

const router = express.Router();
router.use(authenticate);
const idParam = validate({ id: { type: 'int', required: true, min: 1 } }, 'params');

router.get('/', async (req, res) => res.json({ stages: await rules.stages(getDb()) }));

router.get('/candidates', authorize('admin', 'facilitator'), async (req, res) => {
  const db = getDb();
  res.json({
    candidates: await svc.candidates(db, req.user),
    stages: await rules.stages(db),
    streams: req.user.role === 'facilitator' ? await rules.facilitatorStreams(db, req.user.id) : undefined,
  });
});

router.get('/pipeline', authorize('admin', 'facilitator'), async (req, res) => res.json(await svc.pipeline(getDb(), req.user)));

const trailQuery = validate({
  candidateId: { type: 'int', min: 1 },
  limit: { type: 'int', min: 1, max: 5000 },
  from: { type: 'string', max: 30, pattern: /^\d{4}-\d{2}-\d{2}/ },
  to: { type: 'string', max: 30, pattern: /^\d{4}-\d{2}-\d{2}/ },
}, 'query');

router.get('/decisions', authorize('admin', 'facilitator', 'candidate'), trailQuery,
  async (req, res) => res.json({ decisions: await svc.history(getDb(), req.user, req.validQuery) }));

/** Downloadable stage audit trail (CSV or PDF), scoped like the trail itself. */
router.get('/decisions/export.:format', authorize('admin', 'facilitator'), trailQuery, async (req, res) => {
  const rows = await svc.history(getDb(), req.user, { ...req.validQuery, limit: req.validQuery.limit || 5000 });
  const columns = [
    ['createdAt', 'Date (UTC)'], ['candidateName', 'Candidate'], ['stream', 'Stream'], ['cohort', 'Cohort'],
    ['fromLabel', 'From'], ['toLabel', 'To'], ['direction', 'Direction'], ['decidedBy', 'Decided by'], ['reason', 'Reason'],
  ];
  if (req.params.format === 'csv') return exportsSvc.sendCsv(res, 'stage-audit-trail', columns, rows);
  if (req.params.format === 'pdf') return exportsSvc.sendTablePdf(res, 'stage-audit-trail', { title: 'Stage audit trail', subtitle: `${rows.length} decisions · exported by ${req.user.fullName}`, columns, rows, widths: [70, 75, 65, 60, 50, 50, 45, 65, 170] });
  throw badRequest('Format must be csv or pdf');
});

router.post(
  '/candidates/:id/decisions',
  authorize('admin', 'facilitator'),
  idParam,
  validate({
    toStage: { type: 'string', required: true, max: 20, label: 'Proposed stage' },
    reason: { type: 'string', required: true, max: 1000, label: 'Reason' },
  }),
  async (req, res) => {
    const out = await svc.decide(getDb(), { candidateId: req.params.id, toStage: req.body.toStage, reason: req.body.reason, actor: req.user });
    res.status(201).json(out);
  }
);

/** Stage approval inbox: approve the next stage for several candidates with one shared note. */
router.post(
  '/batch',
  authorize('admin', 'facilitator'),
  validate({
    candidateIds: { type: 'array', of: 'int', required: true, min: 1, max: 100, label: 'Candidates' },
    reason: { type: 'string', required: true, min: 3, max: 1000, label: 'Shared approval note' },
  }),
  async (req, res) => {
    const results = await svc.batchDecide(getDb(), { candidateIds: req.body.candidateIds, reason: req.body.reason, actor: req.user });
    res.json({ results, approved: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
  }
);

// ---- Candidate-requested review ---------------------------------------------------
router.get('/me/review', authorize('candidate'), async (req, res) => res.json({ request: await svc.myReviewRequest(getDb(), req.user.id) }));
router.post(
  '/me/review',
  authorize('candidate'),
  validate({ note: { type: 'string', max: 500, label: 'Note' } }),
  async (req, res) => res.status(201).json(await svc.requestReview(getDb(), req.user, req.body.note || ''))
);

// ---- Placement confirmation ---------------------------------------------------------
router.get('/placements', authorize('admin', 'facilitator'), async (req, res) => {
  const db = getDb();
  const scope = await rules.scopeSql(db, req.user);
  const rows = await db.all(`
    SELECT p.id, p.candidate_id AS "candidateId", u.full_name AS "candidateName", cp.stream, p.company, p.role_title AS "roleTitle",
           p.start_date AS "startDate", p.note, p.status, p.created_at AS "createdAt", r.full_name AS "recruiterName",
           COALESCE(cs.stage, 'enrolled') AS stage
    FROM placements p JOIN users u ON u.id = p.candidate_id
    LEFT JOIN candidate_profiles cp ON cp.user_id = p.candidate_id
    LEFT JOIN candidate_stages cs ON cs.candidate_id = p.candidate_id
    LEFT JOIN users r ON r.id = p.recruiter_id
    WHERE ${scope.sql} ORDER BY (p.status = 'pending') DESC, p.id DESC LIMIT 200`, scope.params);
  res.json({ placements: rows });
});

router.post(
  '/placements/:id',
  authorize('admin', 'facilitator'),
  idParam,
  validate({ approve: { type: 'bool', required: true }, note: { type: 'string', max: 500 } }),
  async (req, res) => res.json(await svc.handlePlacement(getDb(), { placementId: req.params.id, approve: req.body.approve, note: req.body.note, actor: req.user }))
);

module.exports = router;
