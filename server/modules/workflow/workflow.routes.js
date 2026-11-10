'use strict';
// Owner: Member C
const express = require('express');
const { getDb } = require('../../db/connection');
const { authenticate, authorize } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { fromDbError } = require('../../utils/AppError');
const { STATUSES, PRIORITIES, CANDIDATE_TRANSITIONS, allowedNext } = require('./stateMachine');
const svc = require('./transition.service');
const { getHistory } = require('./audit.service');
const gamify = require('../engage/gamification.service');
const bus = require('../../realtime/bus');

/** Tell everyone who can see this request that it changed. */
async function announce(db, id, kind) {
  const r = (await db.one('SELECT candidate_id, assigned_to FROM requests WHERE id = ?', id));
  if (!r) return;
  bus.publish([r.candidate_id, r.assigned_to], 'request', { id, kind });
  bus.publish('staff', 'request', { id, kind });
  bus.publish([r.candidate_id, r.assigned_to], 'notify', {});
  bus.publish('staff', 'notify', {});
}

const router = express.Router();
router.use(authenticate, authorize('candidate', 'support', 'admin'));

const idParam = validate({ id: { type: 'int', required: true, min: 1 } }, 'params');

/** Workflow rules — transitions read straight from the DB whitelist table. */
router.get('/rules', async (req, res) => {
  const transitions = (await getDb().all('SELECT from_status AS "from", to_status AS "to" FROM status_transitions'));
  res.json({ statuses: STATUSES, priorities: PRIORITIES, transitions, candidateTransitions: CANDIDATE_TRANSITIONS });
});

/**
 * POST /api/workflow/requests/:id/transition
 * Illegal moves return 409 with code ILLEGAL_STATUS_TRANSITION (application layer)
 * or DB_ILLEGAL_TRANSITION (database trigger layer).
 */
router.post(
  '/requests/:id/transition',
  idParam,
  validate({
    toStatus: { type: 'enum', required: true, values: STATUSES, label: 'Status' },
    note: { type: 'string', max: 2000, label: 'Internal note' },
    message: { type: 'string', max: 5000, label: 'Message' },
    resolution: { type: 'string', max: 5000, label: 'Resolution' },
    assigneeId: { type: 'int', min: 1 },
    override: { type: 'bool', default: false },
  }),
  async (req, res) => {
    const db = getDb();
    const updated = await svc.transitionStatus(db, req.params.id, { ...req.body, actor: req.user });
    let badges = [];
    if (updated.status === 'Closed' && req.user.role === 'candidate') badges = await gamify.award(db, req.user.id, 'request_closed', updated.id);
    if (updated.status === 'Resolved' && req.user.role !== 'candidate') badges = await gamify.award(db, req.user.id, 'resolved', updated.id);
    await announce(db, updated.id, 'status');
    res.json({ request: updated, allowedNext: allowedNext(updated.status, req.user.role), badges });
  }
);

router.post(
  '/requests/:id/assign',
  authorize('support', 'admin'),
  idParam,
  validate({ assigneeId: { type: 'int', required: true, min: 1 }, note: { type: 'string', max: 2000 } }),
  async (req, res) => {
    const request = await svc.assignRequest(getDb(), req.params.id, { ...req.body, actor: req.user });
    await announce(getDb(), request.id, 'assign');
    res.json({ request });
  }
);

router.post(
  '/requests/:id/priority',
  authorize('support', 'admin'),
  idParam,
  validate({ priority: { type: 'enum', required: true, values: PRIORITIES }, note: { type: 'string', max: 2000 } }),
  async (req, res) => {
    const request = await svc.changePriority(getDb(), req.params.id, { ...req.body, actor: req.user });
    await announce(getDb(), request.id, 'priority');
    res.json({ request });
  }
);

router.post(
  '/requests/:id/messages',
  idParam,
  validate({ body: { type: 'string', required: true, min: 1, max: 5000, label: 'Message' }, isInternal: { type: 'bool', default: false } }),
  async (req, res) => {
    const result = await svc.addMessage(getDb(), req.params.id, { ...req.body, actor: req.user });
    await announce(getDb(), req.params.id, 'message');
    res.status(201).json(result);
  }
);

router.get('/requests/:id/history', idParam, async (req, res) => {
  const db = getDb();
  await svc.loadRequest(db, req.params.id, req.user); // ownership check
  res.json({ history: await getHistory(db, req.params.id, req.user) });
});

/**
 * POST /api/workflow/db-probe   (admin only)
 * Skips the application validator and fires a raw UPDATE at SQLite to
 * demonstrate that the trigger layer blocks illegal transitions on its own.
 * Always rolled back. Returns 409 DB_ILLEGAL_TRANSITION when blocked.
 */
router.post(
  '/db-probe',
  authorize('admin'),
  validate({
    requestId: { type: 'int', required: true, min: 1 },
    toStatus: { type: 'enum', required: true, values: STATUSES },
    withAudit: { type: 'bool', default: true },
  }),
  async (req, res) => {
    const result = await svc.dbProbe(getDb(), req.body.requestId, { ...req.body, actor: req.user });
    if (result.accepted) {
      return res.json({ ...result, note: 'Database would accept this transition (probe rolled back, nothing saved).' });
    }
    const mapped = fromDbError(new Error(result.dbError));
    res.status(409).json({
      error: {
        code: mapped ? mapped.code : 'DB_REJECTED',
        message: mapped ? mapped.message : result.dbError,
        details: { enforcedBy: 'database-trigger', from: result.from, to: result.to, dbError: result.dbError },
      },
    });
  }
);

module.exports = router;
