'use strict';
const express = require('express');
const { getDb } = require('../../db/connection');
const { authenticate, authorize } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const svc = require('./recruiter.service');
const exportsSvc = require('../reports/exports');
const { badRequest } = require('../../utils/AppError');

const router = express.Router();
const httpsUrl = { type: 'string', max: 2048, pattern: /^https:\/\/\S+$/i, patternMessage: 'Enter a valid HTTPS URL' };
const candidateId = validate({ id: { type: 'int', required: true, min: 1 } }, 'params');
const projectId = validate({ projectId: { type: 'int', required: true, min: 1 } }, 'params');

router.use(authenticate);

router.get('/me', authorize('candidate'), async (req, res) => {
  res.json({ portfolio: await svc.getOwnPortfolio(getDb(), req.user.id) });
});

router.patch(
  '/me',
  authorize('candidate'),
  validate({
    isPublished: { type: 'bool' },
    headline: { type: 'string', max: 120 },
    summary: { type: 'string', max: 1000 },
    skills: { type: 'string', max: 500 },
    githubUrl: httpsUrl,
    cvUrl: httpsUrl,
  }),
  async (req, res) => res.json({ portfolio: await svc.saveOwnPortfolio(getDb(), req.user.id, req.body) })
);

router.post(
  '/me/projects',
  authorize('candidate'),
  validate({
    title: { type: 'string', required: true, min: 1, max: 120 },
    description: { type: 'string', max: 1000 },
    projectUrl: httpsUrl,
    evidenceUrl: httpsUrl,
  }),
  async (req, res) => res.status(201).json({ project: await svc.addProject(getDb(), req.user.id, req.body) })
);

router.delete('/me/projects/:projectId', authorize('candidate'), projectId, async (req, res) => {
  await svc.deleteProject(getDb(), req.user.id, req.params.projectId);
  res.status(204).end();
});

router.get('/summary', authorize('recruiter'), async (req, res) => res.json(await svc.summary(getDb(), req.user.id)));

router.get(
  '/talent',
  authorize('recruiter'),
  validate({
    q: { type: 'string', max: 100 },
    stream: { type: 'string', max: 80 },
    stage: { type: 'string', max: 40 },
    cohort: { type: 'string', max: 80 },
    skills: { type: 'string', max: 200 },
    documents: { type: 'enum', values: ['cv', 'certificate', 'any'] },
    sort: { type: 'enum', values: ['name', 'stage'] },
  }, 'query'),
  async (req, res) => {
    const data = await svc.summary(getDb());
    const stages = (await getDb().all('SELECT key, label AS title FROM programme_stages ORDER BY sort_order'));
    res.json({
      candidates: await svc.listTalent(getDb(), { ...req.validQuery, recruiterId: req.user.id }),
      streams: data.streams,
      cohorts: data.cohorts,
      skills: data.skills,
      stages,
    });
  }
);

router.get('/profiles/:id', authorize('recruiter'), candidateId, async (req, res) => {
  res.json({ profile: await svc.getPublishedProfile(getDb(), req.params.id, req.user.id) });
});

router.get('/portfolios', authorize('recruiter'), async (req, res) => {
  const candidates = await svc.listTalent(getDb(), { recruiterId: req.user.id });
  const projects = (await getDb().all(`
    SELECT id, candidate_id AS "candidateId", title, description,
           project_url AS "projectUrl", evidence_url AS "evidenceUrl"
    FROM portfolio_items ORDER BY created_at DESC, id DESC
  `));
  res.json({
    portfolios: candidates.map((candidate) => ({
      ...candidate,
      projects: projects.filter((project) => project.candidateId === candidate.id),
    })),
  });
});

// ---- Private shortlist: only the recruiter who saved it can see it ------------------
router.get('/shortlist', authorize('recruiter'), async (req, res) => res.json({ candidates: await svc.shortlist(getDb(), req.user.id) }));

router.put(
  '/shortlist/:id',
  authorize('recruiter'),
  candidateId,
  validate({ note: { type: 'string', max: 500, label: 'Note' } }),
  async (req, res) => res.json(await svc.saveToShortlist(getDb(), req.user.id, req.params.id, req.body.note || ''))
);

router.delete('/shortlist/:id', authorize('recruiter'), candidateId, async (req, res) => res.json(await svc.removeFromShortlist(getDb(), req.user.id, req.params.id)));

/** Download the recruiter's shortlist with notes (CSV or PDF). */
router.get('/shortlist/export.:format', authorize('recruiter'), async (req, res) => {
  const rows = await svc.shortlist(getDb(), req.user.id);
  const columns = [
    ['fullName', 'Candidate'], ['email', 'Email'], ['stream', 'Stream'], ['cohort', 'Cohort'], ['stageLabel', 'Official stage'],
    ['headline', 'Headline'], ['skills', 'Skills'], [(r) => (r.hasCv ? 'Yes' : 'No'), 'CV'], ['shortlistNote', 'My note'],
  ];
  if (req.params.format === 'csv') return exportsSvc.sendCsv(res, 'shortlist', columns, rows);
  if (req.params.format === 'pdf') return exportsSvc.sendTablePdf(res, 'shortlist', { title: 'My shortlist', subtitle: `${rows.length} candidates · ${req.user.fullName}`, columns, rows, widths: [80, 110, 75, 85, 55, 90, 100, 25, 140] });
  throw badRequest('Format must be csv or pdf');
});

// ---- Interview requests and placement reports -----------------------------------------
router.post(
  '/interviews',
  authorize('recruiter'),
  validate({
    candidateId: { type: 'int', required: true, min: 1 },
    company: { type: 'string', required: true, min: 2, max: 120, label: 'Company' },
    roleTitle: { type: 'string', required: true, min: 2, max: 120, label: 'Role' },
    message: { type: 'string', max: 1000, label: 'Message' },
    proposedAt: { type: 'string', max: 30, pattern: /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/, patternMessage: 'Choose a valid date and time', label: 'Proposed time' },
    mode: { type: 'enum', values: ['online', 'in-person', 'phone'], default: 'online' },
  }),
  async (req, res) => res.status(201).json({ interview: await svc.requestInterview(getDb(), req.user, req.body.candidateId, req.body) })
);

router.post('/interviews/:id/withdraw', authorize('recruiter'), candidateId, async (req, res) => res.json(await svc.withdrawInterview(getDb(), req.user.id, req.params.id)));

router.post(
  '/placements',
  authorize('recruiter'),
  validate({
    candidateId: { type: 'int', required: true, min: 1 },
    company: { type: 'string', required: true, min: 2, max: 120, label: 'Company' },
    roleTitle: { type: 'string', required: true, min: 2, max: 120, label: 'Role' },
    startDate: { type: 'string', max: 10, pattern: /^\d{4}-\d{2}-\d{2}$/, patternMessage: 'Choose a valid date', label: 'Start date' },
    note: { type: 'string', max: 1000 },
  }),
  async (req, res) => res.status(201).json(await svc.reportPlacement(getDb(), req.user, req.body.candidateId, req.body))
);

module.exports = router;
