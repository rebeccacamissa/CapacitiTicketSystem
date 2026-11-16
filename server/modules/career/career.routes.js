'use strict';
/**
 * Candidate career tools: CV builder, AI mock interviews; and interview requests
 * (candidate responds; staff see them; recruiters see their own).
 */
const express = require('express');
const { getDb } = require('../../db/connection');
const { authenticate, authorize } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { rateLimit } = require('../../middleware/rateLimit');
const { notFound } = require('../../utils/AppError');
const builder = require('./cv-builder');
const mock = require('./mock-interview.service');
const portfolio = require('../portfolio/portfolio.service');
const recruiter = require('../recruiter/recruiter.service');
const ai = require('../../services/ai');

const router = express.Router();
router.use(authenticate);
const idParam = validate({ id: { type: 'int', required: true, min: 1 } }, 'params');

// ---- CV builder --------------------------------------------------------------------
/** CV data from what the programme already knows: profile, shared portfolio, projects, certificates. */
async function prefill(db, userId) {
  const p = await db.one(`SELECT u.full_name, u.email, cp.stream, pf.headline, pf.summary, pf.skills, pf.github_url
    FROM users u LEFT JOIN candidate_profiles cp ON cp.user_id = u.id LEFT JOIN candidate_portfolios pf ON pf.candidate_id = u.id WHERE u.id = ?`, userId);
  const projects = await db.all('SELECT title, description, project_url FROM portfolio_items WHERE candidate_id = ? ORDER BY id', userId);
  const certs = await db.all("SELECT title, created_at FROM portfolio_files WHERE candidate_id = ? AND kind = 'certificate' ORDER BY created_at", userId);
  return {
    fullName: p.full_name, email: p.email, headline: p.headline || (p.stream ? `${p.stream} candidate` : ''), summary: p.summary || '',
    skills: JSON.parse(p.skills || '[]'), github: p.github_url || '', phone: '', location: '', linkedin: '',
    experience: [], education: [{ qualification: `CAPACITI ${p.stream || 'Digital Skills'} Programme`, institution: 'CAPACITI (UVU Africa)', year: String(new Date().getFullYear()) }],
    projects: projects.map((x) => ({ name: x.title, description: x.description, link: x.project_url || '' })),
    certifications: certs.map((c) => ({ name: c.title, issuer: '', year: c.created_at.slice(0, 4) })),
  };
}

router.get('/cv', authorize('candidate'), async (req, res) => {
  const db = getDb();
  const row = await db.one('SELECT data, updated_at FROM cv_profiles WHERE candidate_id = ?', req.user.id);
  if (row) return res.json({ cv: JSON.parse(row.data), updatedAt: row.updated_at, limits: builder.LIMITS });
  // First visit: prefill from what we already know.
  res.json({ cv: await prefill(db, req.user.id), updatedAt: null, limits: builder.LIMITS });
});

/**
 * Offline CAPACITI CV template (works without any AI service). Uses the saved CV-builder
 * data, or the profile/portfolio, plus the programme record (stream, cohort, official stage,
 * verified achievements). With a target job, skills and projects the advert mentions are
 * listed first: nothing is added or reworded.
 */
router.post(
  '/cv/template',
  authorize('candidate'),
  validate({ jobTitle: { type: 'string', max: 120 }, jobDescription: { type: 'string', max: 6000 }, save: { type: 'bool' } }),
  async (req, res) => {
    const db = getDb();
    const row = await db.one('SELECT data FROM cv_profiles WHERE candidate_id = ?', req.user.id);
    const cv = builder.clean(row ? JSON.parse(row.data) : await prefill(db, req.user.id));
    const words = `${req.body.jobTitle || ''} ${req.body.jobDescription || ''}`.toLowerCase();
    if (words.trim()) {
      const hit = (term) => !!term && words.includes(String(term).toLowerCase());
      cv.skills = [...cv.skills.filter(hit), ...cv.skills.filter((x) => !hit(x))];
      const relevance = (x) => cv.skills.filter((k) => hit(k) && `${x.name} ${x.description}`.toLowerCase().includes(k.toLowerCase())).length;
      cv.projects = [...cv.projects].sort((a, b) => relevance(b) - relevance(a));
    }
    const prog = (await db.one(`SELECT cp.stream, cp.cohort, COALESCE(ps.label, 'Enrolled') AS stage FROM candidate_profiles cp
      LEFT JOIN candidate_stages cs ON cs.candidate_id = cp.user_id LEFT JOIN programme_stages ps ON ps.key = cs.stage WHERE cp.user_id = ?`, req.user.id)) || {};
    const achievements = (await db.all(`SELECT mr.label FROM candidate_requirement_progress p JOIN milestone_requirements mr ON mr.id = p.requirement_id
      JOIN milestones m ON m.id = mr.milestone_id WHERE p.candidate_id = ? AND m.key <> 'enrolled' ORDER BY m.sort_order, mr.sort_order`, req.user.id))
      .map((r) => `${r.label} (verified by CAPACITI)`);
    const pdf = await builder.renderPdf(cv, { template: 'capaciti', targetRole: req.body.jobTitle || '', programme: { stream: prog.stream, cohort: prog.cohort, stage: prog.stage || 'Enrolled', achievements } });
    const title = `${cv.fullName || 'My'} CAPACITI CV${req.body.jobTitle ? ` (${req.body.jobTitle})` : ''}`.slice(0, 120);
    if (req.body.save) {
      const file = await portfolio.saveGenerated(db, req.user.id, { title, buf: pdf, ext: 'pdf', mime: 'application/pdf', source: 'cv_builder' });
      return res.status(201).json({ file });
    }
    const safe = title.replace(/[^\w ()-]/g, '').trim() || 'CAPACITI CV';
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${safe}.pdf"`, 'Cache-Control': 'no-store' });
    res.send(pdf);
  }
);

router.put('/cv', authorize('candidate'), async (req, res) => {
  const cv = builder.clean(req.body?.cv);
  await getDb().run(`INSERT INTO cv_profiles (candidate_id, data) VALUES (?, ?)
    ON CONFLICT (candidate_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now_iso()`, req.user.id, JSON.stringify(cv));
  res.json({ cv });
});

/** Download the built CV as PDF; ?save=1 also stores it in the candidate's documents. */
router.get('/cv/pdf', authorize('candidate'), validate({ save: { type: 'bool' } }, 'query'), async (req, res) => {
  const db = getDb();
  const row = await db.one('SELECT data FROM cv_profiles WHERE candidate_id = ?', req.user.id);
  if (!row) throw notFound('Save your CV first');
  const cv = JSON.parse(row.data);
  const pdf = await builder.renderPdf(cv);
  if (req.validQuery.save) {
    const file = await portfolio.saveGenerated(db, req.user.id, { title: `${cv.fullName || 'My'} CV (CV builder)`, buf: pdf, ext: 'pdf', mime: 'application/pdf', source: 'cv_builder' });
    return res.status(201).json({ file });
  }
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${(cv.fullName || 'CV').replace(/[^\w ]/g, '').trim() || 'CV'} CV.pdf"`, 'Cache-Control': 'no-store' });
  res.send(pdf);
});

// ---- Mock interviews -----------------------------------------------------------------
router.get('/mock-interviews', authorize('candidate'), async (req, res) => {
  res.json({ interviews: await mock.listMine(getDb(), req.user.id), aiEnabled: ai.isEnabled() });
});

router.post(
  '/mock-interviews',
  authorize('candidate'),
  rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }),
  validate({
    jobTitle: { type: 'string', required: true, min: 2, max: 120, label: 'Job title' },
    jobDescription: { type: 'string', max: 6000 },
    fileId: { type: 'int', min: 1 },
    useBuilder: { type: 'bool' },
    consent: { type: 'bool' },
  }),
  async (req, res) => {
    const db = getDb();
    let cv = null;
    // Only send CV content to the AI service with explicit consent.
    if (ai.isEnabled() && req.body.consent) {
      if (req.body.fileId) {
        const f = await portfolio.open(db, req.user, req.body.fileId);
        if (f.row.candidate_id !== req.user.id || f.row.kind !== 'cv') throw notFound('CV not found');
        cv = { data: f.data, ext: f.ext };
      } else if (req.body.useBuilder) {
        const row = await db.one('SELECT data FROM cv_profiles WHERE candidate_id = ?', req.user.id);
        if (row) cv = { text: JSON.stringify(JSON.parse(row.data), null, 1) };
      }
    }
    res.status(201).json({ interview: await mock.start(db, req.user.id, { jobTitle: req.body.jobTitle, jobDescription: req.body.jobDescription, cv }) });
  }
);

router.post('/mock-interviews/:id/answers', authorize('candidate'), idParam, rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }), async (req, res) => {
  res.json({ interview: await mock.complete(getDb(), req.user.id, req.params.id, req.body?.answers) });
});

// ---- Interview requests from recruiters ----------------------------------------------
router.get('/interviews', authorize('candidate', 'recruiter', 'support', 'admin', 'facilitator'), async (req, res) => {
  res.json({ interviews: await recruiter.listInterviews(getDb(), req.user) });
});

router.post(
  '/interviews/:id/respond',
  authorize('candidate'),
  idParam,
  validate({ accept: { type: 'bool', required: true }, note: { type: 'string', max: 500 } }),
  async (req, res) => res.json({ interview: await recruiter.respondInterview(getDb(), req.user, req.params.id, req.body) })
);

module.exports = router;
