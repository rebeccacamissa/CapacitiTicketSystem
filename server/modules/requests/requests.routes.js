'use strict';
// Owner: Member B
const express = require('express');
const { getDb } = require('../../db/connection');
const { authenticate, authorize } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { STATUSES, PRIORITIES } = require('../workflow/stateMachine');
const svc = require('./requests.service');
const attachments = require('./attachments.service');
const gamify = require('../engage/gamification.service');
const bus = require('../../realtime/bus');
const { transaction } = require('../../db/connection');
const { badRequest, notFound, conflict } = require('../../utils/AppError');

const router = express.Router();
router.use(authenticate, authorize('candidate', 'support', 'admin'));

router.get('/categories', (req, res) => {
  const rows = getDb().prepare('SELECT id, name, description, is_blocker FROM categories WHERE is_active = 1 ORDER BY name').all();
  res.json({ categories: rows.map((c) => ({ ...c, is_blocker: !!c.is_blocker })) });
});

router.get('/staff', authorize('support', 'admin'), (req, res) => {
  const staff = getDb().prepare("SELECT id, full_name, role FROM users WHERE role IN ('support','admin') AND is_active = 1 ORDER BY full_name").all();
  res.json({ staff });
});

router.get(
  '/',
  validate({
    q: { type: 'string', max: 100 },
    status: { type: 'enum', values: [...STATUSES, 'active'] },
    categoryId: { type: 'int', min: 1 },
    priority: { type: 'enum', values: PRIORITIES },
    assigned: { type: 'string', max: 20 },
    overdue: { type: 'bool' },
    sort: { type: 'enum', values: ['created', 'updated', 'due', 'priority', 'reference', 'status'] },
    order: { type: 'enum', values: ['asc', 'desc'] },
    page: { type: 'int', min: 1, max: 10000 },
    pageSize: { type: 'int', min: 5, max: 100 },
  }, 'query'),
  (req, res) => res.json(svc.listRequests(getDb(), req.user, req.validQuery))
);

router.post(
  '/',
  authorize('candidate'),
  validate({
    title: { type: 'string', required: true, min: 5, max: 150, label: 'Subject' },
    description: { type: 'string', required: true, min: 10, max: 5000, label: 'Description' },
    categoryId: { type: 'int', required: true, min: 1, label: 'Category' },
    priority: { type: 'enum', values: PRIORITIES, default: 'Medium', label: 'Priority' },
  }),
  (req, res) => {
    const db = getDb();
    const created = svc.createRequest(db, { ...req.body, actor: req.user });
    const badges = gamify.award(db, req.user.id, 'request_created', created.id);
    bus.publish('staff', 'request', { id: created.id, kind: 'created' });
    bus.publish('staff', 'notify', {});
    res.status(201).json({ request: created, badges });
  }
);

const idParam = validate({ id: { type: 'int', required: true, min: 1 } }, 'params');

router.get('/attachments/:id', idParam, (req, res) => {
  const f = attachments.open(getDb(), req.params.id, req.user);
  res.set({
    'Content-Type': f.mime,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    'Cache-Control': 'private, max-age=3600',
    'Content-Disposition': `${f.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
  });
  res.sendFile(f.path);
});

router.get(
  '/:id',
  validate({ id: { type: 'int', required: true, min: 1 } }, 'params'),
  (req, res) => {
    const db = getDb();
    const detail = svc.getRequestDetail(db, req.params.id, req.user);
    detail.attachments = attachments.list(db, req.params.id, req.user);
    detail.rating = db.prepare('SELECT rating, comment, created_at FROM request_ratings WHERE request_id = ?').get(req.params.id) || null;
    res.json(detail);
  }
);


/** Upload up to 5 files (base64) to a request. */
router.post(
  '/:id/attachments',
  idParam,
  (req, res) => {
    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    if (!files.length || files.length > 5) throw badRequest('Attach between 1 and 5 files');
    const db = getDb();
    const ids = transaction(db, () => files.map((f) => attachments.save(db, req.params.id, req.user, { ...f, isInternal: !!req.body.isInternal })));
    const r = db.prepare('SELECT candidate_id, assigned_to FROM requests WHERE id = ?').get(req.params.id);
    bus.publish([r.candidate_id, r.assigned_to], 'request', { id: req.params.id, kind: 'attachment' });
    res.status(201).json({ ids });
  }
);

/** Candidate satisfaction rating (once resolved; can be updated). */
router.post(
  '/:id/rating',
  authorize('candidate'),
  idParam,
  validate({ rating: { type: 'int', required: true, min: 1, max: 5, label: 'Rating' }, comment: { type: 'string', max: 1000 } }),
  (req, res) => {
    const db = getDb();
    const r = db.prepare('SELECT id, candidate_id, status, assigned_to FROM requests WHERE id = ?').get(req.params.id);
    if (!r || r.candidate_id !== req.user.id) throw notFound('Request not found');
    if (!['Resolved', 'Closed'].includes(r.status)) throw conflict('NOT_RESOLVED', 'You can rate a request once it has been resolved');
    db.prepare(`
      INSERT INTO request_ratings (request_id, candidate_id, rating, comment) VALUES (?, ?, ?, ?)
      ON CONFLICT(request_id) DO UPDATE SET rating = excluded.rating, comment = excluded.comment,
        created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    `).run(r.id, req.user.id, req.body.rating, req.body.comment || null);
    const badges = gamify.award(db, req.user.id, 'rating', r.id);
    bus.publish('staff', 'request', { id: r.id, kind: 'rating' });
    res.json({ ok: true, badges });
  }
);

module.exports = router;
