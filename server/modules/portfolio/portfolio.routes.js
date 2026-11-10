'use strict';
const express = require('express');
const { getDb } = require('../../db/connection');
const { authenticate, authorize } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { rateLimit } = require('../../middleware/rateLimit');
const { badRequest, notFound } = require('../../utils/AppError');
const svc = require('./portfolio.service');
const ai = require('./cv-tailor.service');

const router = express.Router();
router.use(authenticate);
const idParam = validate({ id: { type: 'int', required: true, min: 1 } }, 'params');

router.get('/files', authorize('candidate'), async (req, res) => res.json({ files: await svc.list(getDb(), req.user.id), maxFiles: svc.MAX_FILES }));

router.post(
  '/files',
  authorize('candidate'),
  validate({
    kind: { type: 'enum', required: true, values: Object.keys(svc.KINDS), label: 'Type' },
    title: { type: 'string', max: 120, label: 'Title' },
    name: { type: 'string', required: true, max: 200 },
    data: { type: 'string', required: true, trim: false, max: 7_200_000 },
  }),
  async (req, res) => res.status(201).json({ file: await svc.upload(getDb(), req.user.id, req.body) })
);

router.delete('/files/:id', authorize('candidate'), idParam, async (req, res) => {
  await svc.remove(getDb(), req.user.id, req.params.id);
  res.status(204).end();
});

/** Download / view. Access is checked per file (owner, staff in scope, recruiters if published). */
router.get('/files/:id', idParam, async (req, res) => {
  const f = await svc.open(getDb(), req.user, req.params.id);
  res.set({
    'Content-Type': f.mime,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    'Cache-Control': 'private, max-age=600',
    'Content-Disposition': `${f.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
  });
  res.send(f.data);
});

// ---- AI CV tailoring (optional) -----------------------------------------------
router.get('/cv/ai-status', authorize('candidate'), async (req, res) => res.json({ enabled: await ai.isEnabled() }));

router.post(
  '/cv/tailor',
  authorize('candidate'),
  rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }),
  validate({
    fileId: { type: 'int', min: 1 },
    cvText: { type: 'string', max: 30000, label: 'CV text' },
    jobTitle: { type: 'string', required: true, min: 2, max: 120, label: 'Job title' },
    jobDescription: { type: 'string', max: 6000, label: 'Job description' },
    consent: { type: 'bool', required: true },
  }),
  async (req, res) => {
    if (!req.body.consent) throw badRequest('Please confirm you agree to send your CV to the AI service', { fields: { consent: 'Consent is required' } });
    const db = getDb();
    let file = null;
    if (req.body.fileId) {
      const f = await svc.open(db, req.user, req.body.fileId);
      if (f.row.candidate_id !== req.user.id || f.row.kind !== 'cv') throw notFound('CV not found');
      file = f;
    } else if (!req.body.cvText || req.body.cvText.trim().length < 50) {
      throw badRequest('Choose one of your uploaded CVs, or paste your CV text', { fields: { cvText: 'Paste at least a few lines of your CV' } });
    }
    const result = await ai.tailor({ file, text: file ? null : req.body.cvText, jobTitle: req.body.jobTitle, jobDescription: req.body.jobDescription });
    res.json({ result });
  }
);

/** Save a tailored CV after the candidate has reviewed (and possibly edited) it. */
router.post(
  '/cv/tailored',
  authorize('candidate'),
  validate({ title: { type: 'string', required: true, min: 1, max: 120, label: 'Title' }, text: { type: 'string', required: true, min: 20, max: 60000, trim: false, label: 'CV text' } }),
  async (req, res) => res.status(201).json({ file: await svc.saveTailored(getDb(), req.user.id, req.body) })
);

module.exports = router;
