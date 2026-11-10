'use strict';
/**
 * POPIA tools.
 *  - Every user can download all personal data the system holds about them (JSON).
 *  - Every user can ask for their account to be deleted. An administrator handles the
 *    request: "completed" anonymises the account (records that must be kept for the
 *    audit trail stay, but no longer identify the person); "declined" needs a reason.
 *  - Users acknowledge the privacy notice once (shown at first sign-in).
 */
const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../../db/connection');
const { authenticate, authorize } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { notFound, conflict } = require('../../utils/AppError');
const bus = require('../../realtime/bus');
const email = require('../../services/email');

const router = express.Router();
router.use(authenticate);

const safeJson = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

async function collect(db, userId) {
  const q = (sql) => db.all(sql, userId);
  const user = await db.one(`SELECT id, full_name, first_name, surname, email, role, is_active, date_of_birth, gender, preferences, accessibility,
    language, avatar_config, privacy_ack_at, created_at FROM users WHERE id = ?`, userId);
  user.preferences = safeJson(user.preferences, {});
  user.accessibility = safeJson(user.accessibility, {});
  user.avatar_config = safeJson(user.avatar_config, null);
  return {
    exportedAt: new Date().toISOString(),
    notice: 'This file contains the personal information the CAPACITI Candidate Support portal holds about you (POPIA section 23). Uploaded file contents are listed by name; download them from your profile.',
    account: user,
    candidateProfile: (await q('SELECT cohort, stream, mentor, tech_champ, supervisor, updated_at FROM candidate_profiles WHERE user_id = ?'))[0] || null,
    staffProfile: (await q('SELECT position, employee_id FROM staff_profiles WHERE user_id = ?'))[0] || null,
    supportRequests: await q('SELECT id, reference, title, description, priority, status, resolution, created_at, updated_at, resolved_at, closed_at FROM requests WHERE candidate_id = ? ORDER BY id'),
    messages: await q('SELECT request_id, body, created_at FROM request_messages WHERE author_id = ? AND is_internal = 0 ORDER BY id'),
    ratings: await q('SELECT request_id, rating, comment, created_at FROM request_ratings WHERE candidate_id = ?'),
    officialStage: (await q('SELECT stage, updated_at FROM candidate_stages WHERE candidate_id = ?'))[0] || null,
    stageDecisions: await q('SELECT from_stage, to_stage, direction, reason, created_at FROM stage_decisions WHERE candidate_id = ? ORDER BY id'),
    evidence: await q(`SELECT mr.label, p.completed_at FROM candidate_requirement_progress p JOIN milestone_requirements mr ON mr.id = p.requirement_id WHERE p.candidate_id = ?`),
    portfolio: (await q('SELECT is_published, headline, summary, skills, github_url, cv_url, updated_at FROM candidate_portfolios WHERE candidate_id = ?'))[0] || null,
    projects: await q('SELECT title, description, project_url, evidence_url, created_at FROM portfolio_items WHERE candidate_id = ?'),
    documents: await q('SELECT kind, title, original_name, size, source, created_at FROM portfolio_files WHERE candidate_id = ?'),
    cvBuilder: ((await q('SELECT data, updated_at FROM cv_profiles WHERE candidate_id = ?'))[0] || null),
    mockInterviews: await q('SELECT job_title, questions, answers, feedback, status, created_at FROM mock_interviews WHERE candidate_id = ?'),
    interviewRequests: await q('SELECT company, role_title, status, candidate_note, created_at, responded_at FROM interview_requests WHERE candidate_id = ?'),
    reviewRequests: await q('SELECT stage, note, status, created_at FROM review_requests WHERE candidate_id = ?'),
    xp: await q('SELECT kind, points, created_at FROM xp_events WHERE user_id = ?'),
    badges: await q('SELECT badge_key, awarded_at FROM user_badges WHERE user_id = ?'),
    deletionRequests: await q('SELECT reason, status, handled_note, created_at, handled_at FROM deletion_requests WHERE user_id = ?'),
  };
}

/** GET /api/privacy/export-data — download everything held about the signed-in user. */
router.get('/export-data', async (req, res) => {
  const data = await collect(getDb(), req.user.id);
  res.set({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="capaciti-my-data-${new Date().toISOString().slice(0, 10)}.json"`,
    'Cache-Control': 'no-store',
  });
  res.send(JSON.stringify(data, null, 2));
});

router.post('/acknowledge', async (req, res) => {
  await getDb().run('UPDATE users SET privacy_ack_at = COALESCE(privacy_ack_at, now_iso()) WHERE id = ?', req.user.id);
  res.json({ ok: true });
});

router.get('/deletion-request', async (req, res) => {
  res.json({ request: (await getDb().one(`SELECT id, reason, status, handled_note AS "handledNote", created_at AS "createdAt", handled_at AS "handledAt"
    FROM deletion_requests WHERE user_id = ? ORDER BY id DESC LIMIT 1`, req.user.id)) || null });
});

router.post('/deletion-request', validate({ reason: { type: 'string', max: 1000 } }), async (req, res) => {
  const db = getDb();
  if (req.user.role === 'admin' && (await db.one("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND is_active = 1")).n <= 1) {
    throw conflict('LAST_ADMIN', 'You are the only active administrator. Add another administrator first.');
  }
  if (await db.one("SELECT 1 FROM deletion_requests WHERE user_id = ? AND status = 'open'", req.user.id)) {
    throw conflict('DELETION_PENDING', 'You already have a deletion request waiting for an administrator.');
  }
  await db.run('INSERT INTO deletion_requests (user_id, reason) VALUES (?, ?)', req.user.id, req.body.reason || '');
  for (const a of await db.all("SELECT id, email FROM users WHERE role = 'admin' AND is_active = 1")) {
    email.notify(db, { to: a.email, kind: 'privacy_request', subject: 'Account deletion request (POPIA)', heading: `${req.user.fullName} asked for their account to be deleted`, lines: ['Please review it in the Control centre.'], cta: { label: 'Open privacy requests', href: email.link('/admin#privacy') } });
    bus.publish([a.id], 'notify', {});
  }
  res.status(201).json({ ok: true });
});

router.delete('/deletion-request', async (req, res) => {
  const { changes } = await getDb().run("DELETE FROM deletion_requests WHERE user_id = ? AND status = 'open'", req.user.id);
  if (!changes) throw notFound('No open deletion request');
  res.status(204).end();
});

// ---- Administrator handling ---------------------------------------------------------
router.get('/requests', authorize('admin'), async (req, res) => {
  res.json({ requests: await getDb().all(`
    SELECT d.id, d.user_id AS "userId", u.full_name AS "userName", u.email, u.role, d.reason, d.status, d.handled_note AS "handledNote",
           h.full_name AS "handledBy", d.created_at AS "createdAt", d.handled_at AS "handledAt"
    FROM deletion_requests d JOIN users u ON u.id = d.user_id LEFT JOIN users h ON h.id = d.handled_by
    ORDER BY (d.status = 'open') DESC, d.id DESC LIMIT 200`) });
});

/** Anonymise an account: keeps rows the audit trail needs, removes what identifies the person. */
async function anonymise(t, userId) {
  const tag = `Deleted user #${userId}`;
  const randomHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 4);
  await t.run(`UPDATE users SET full_name = ?, first_name = 'Deleted', surname = 'user', email = ?, password_hash = ?, is_active = 0,
    date_of_birth = NULL, avatar_config = NULL, preferences = '{}', accessibility = '{}' WHERE id = ?`, tag, `deleted-${userId}@deleted.invalid`, randomHash, userId);
  await t.run('UPDATE candidate_profiles SET mentor = NULL, tech_champ = NULL, supervisor = NULL WHERE user_id = ?', userId);
  await t.run('UPDATE staff_profiles SET position = NULL, employee_id = NULL WHERE user_id = ?', userId);
  const files = await t.all('SELECT stored_name FROM portfolio_files WHERE candidate_id = ?', userId);
  await t.run('DELETE FROM portfolio_files WHERE candidate_id = ?', userId);
  for (const f of files) await t.run('DELETE FROM file_blobs WHERE stored_name = ?', f.stored_name);
  for (const table of ['candidate_portfolios', 'portfolio_items', 'cv_profiles', 'mock_interviews', 'review_requests']) await t.run(`DELETE FROM ${table} WHERE candidate_id = ?`, userId);
  await t.run('DELETE FROM recruiter_shortlist WHERE candidate_id = ? OR recruiter_id = ?', userId, userId);
  await t.run("UPDATE interview_requests SET status = 'withdrawn', message = '', candidate_note = NULL WHERE (candidate_id = ? OR recruiter_id = ?) AND status = 'pending'", userId, userId);
  await t.run('DELETE FROM feed_posts WHERE subject_id = ? OR author_id = ?', userId, userId);
  await t.run('DELETE FROM password_reset_tokens WHERE user_id = ?', userId);
  await t.run('DELETE FROM facilitator_streams WHERE user_id = ?', userId);
}

router.post(
  '/requests/:id',
  authorize('admin'),
  validate({ id: { type: 'int', required: true, min: 1 } }, 'params'),
  validate({ action: { type: 'enum', required: true, values: ['complete', 'decline'] }, note: { type: 'string', max: 1000 } }),
  async (req, res) => {
    const db = getDb();
    const r = await db.one("SELECT d.*, u.email, u.first_name FROM deletion_requests d JOIN users u ON u.id = d.user_id WHERE d.id = ? AND d.status = 'open'", req.params.id);
    if (!r) throw notFound('Open deletion request not found');
    if (r.user_id === req.user.id) throw conflict('OWN_REQUEST', 'Another administrator must handle your own deletion request');
    if (req.body.action === 'decline' && !(req.body.note || '').trim()) throw conflict('REASON_REQUIRED', 'Explain why the request is declined');
    const notifyTo = r.email;
    await db.tx(async (t) => {
      if (req.body.action === 'complete') await anonymise(t, r.user_id);
      await t.run('UPDATE deletion_requests SET status = ?, handled_by = ?, handled_note = ?, handled_at = now_iso() WHERE id = ?',
        req.body.action === 'complete' ? 'completed' : 'declined', req.user.id, req.body.note || null, r.id);
    });
    email.notify(db, {
      to: notifyTo, kind: 'privacy_outcome', subject: req.body.action === 'complete' ? 'Your CAPACITI account has been deleted' : 'About your account deletion request',
      heading: req.body.action === 'complete' ? 'Your account has been deleted' : 'Your deletion request was not completed',
      lines: req.body.action === 'complete'
        ? ['Your personal information has been removed. Records we must keep for the programme audit trail no longer identify you.']
        : [`Reason: ${req.body.note}`, 'You can reply to the programme team if you have questions.'],
    });
    bus.publish('all', 'people', {});
    res.json({ ok: true });
  }
);

module.exports = router;
module.exports.collect = collect;
