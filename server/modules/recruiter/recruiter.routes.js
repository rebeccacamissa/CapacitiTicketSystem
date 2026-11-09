'use strict';
const express = require('express');
const { getDb } = require('../../db/connection');
const { authenticate, authorize } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const svc = require('./recruiter.service');

const router = express.Router();
const httpsUrl = { type: 'string', max: 2048, pattern: /^https:\/\/\S+$/i, patternMessage: 'Enter a valid HTTPS URL' };
const candidateId = validate({ id: { type: 'int', required: true, min: 1 } }, 'params');
const projectId = validate({ projectId: { type: 'int', required: true, min: 1 } }, 'params');

router.use(authenticate);

router.get('/me', authorize('candidate'), (req, res) => {
  res.json({ portfolio: svc.getOwnPortfolio(getDb(), req.user.id) });
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
  (req, res) => res.json({ portfolio: svc.saveOwnPortfolio(getDb(), req.user.id, req.body) })
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
  (req, res) => res.status(201).json({ project: svc.addProject(getDb(), req.user.id, req.body) })
);

router.delete('/me/projects/:projectId', authorize('candidate'), projectId, (req, res) => {
  svc.deleteProject(getDb(), req.user.id, req.params.projectId);
  res.status(204).end();
});

router.get('/summary', authorize('recruiter'), (req, res) => res.json(svc.summary(getDb(), req.user.id)));

router.get(
  '/talent',
  authorize('recruiter'),
  validate({
    q: { type: 'string', max: 100 },
    stream: { type: 'string', max: 80 },
    stage: { type: 'string', max: 40 },
  }, 'query'),
  (req, res) => {
    const data = svc.summary(getDb());
    const stages = getDb().prepare('SELECT key, label AS title FROM programme_stages ORDER BY sort_order').all();
    res.json({
      candidates: svc.listTalent(getDb(), { ...req.validQuery, recruiterId: req.user.id }),
      streams: data.streams,
      stages,
    });
  }
);

router.get('/profiles/:id', authorize('recruiter'), candidateId, (req, res) => {
  res.json({ profile: svc.getPublishedProfile(getDb(), req.params.id, req.user.id) });
});

router.get('/portfolios', authorize('recruiter'), (req, res) => {
  const candidates = svc.listTalent(getDb(), { recruiterId: req.user.id });
  const projects = getDb().prepare(`
    SELECT id, candidate_id AS candidateId, title, description,
           project_url AS projectUrl, evidence_url AS evidenceUrl
    FROM portfolio_items ORDER BY created_at DESC, id DESC
  `).all();
  res.json({
    portfolios: candidates.map((candidate) => ({
      ...candidate,
      projects: projects.filter((project) => project.candidateId === candidate.id),
    })),
  });
});

// ---- Private shortlist: only the recruiter who saved it can see it ------------------
router.get('/shortlist', authorize('recruiter'), (req, res) => res.json({ candidates: svc.shortlist(getDb(), req.user.id) }));

router.put(
  '/shortlist/:id',
  authorize('recruiter'),
  candidateId,
  validate({ note: { type: 'string', max: 500, label: 'Note' } }),
  (req, res) => res.json(svc.saveToShortlist(getDb(), req.user.id, req.params.id, req.body.note || ''))
);

router.delete('/shortlist/:id', authorize('recruiter'), candidateId, (req, res) => res.json(svc.removeFromShortlist(getDb(), req.user.id, req.params.id)));

module.exports = router;
