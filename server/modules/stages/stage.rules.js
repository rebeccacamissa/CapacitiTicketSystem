'use strict';
/**
 * Shared stage helpers: the stage list, a candidate's current official stage,
 * and who may see which candidates (facilitators are limited to their streams).
 */
const { notFound } = require('../../utils/AppError');

async function stages(db) {
  return db.all('SELECT key, label, sort_order AS "sortOrder", target_days AS "targetDays" FROM programme_stages ORDER BY sort_order');
}

/** A candidate with no stage row is 'enrolled' (the starting stage). */
async function currentStage(db, candidateId) {
  return (await db.one('SELECT stage FROM candidate_stages WHERE candidate_id = ?', candidateId))?.stage || 'enrolled';
}

async function facilitatorStreams(db, userId) {
  return (await db.all('SELECT stream FROM facilitator_streams WHERE user_id = ? ORDER BY stream', userId)).map((r) => r.stream);
}

/**
 * SQL fragment + params restricting a candidate query (alias `cp` = candidate_profiles)
 * to what this user may see. Admin/support: everyone. Facilitator: their streams only.
 */
async function scopeSql(db, user) {
  if (user.role !== 'facilitator') return { sql: '1 = 1', params: [] };
  const streams = await facilitatorStreams(db, user.id);
  if (!streams.length) return { sql: '1 = 0', params: [] };
  return { sql: `cp.stream IN (${streams.map(() => '?').join(',')})`, params: streams };
}

/** Throws 404 (not 403, so existence isn't leaked) if the user can't see this candidate. */
async function assertCanSeeCandidate(db, user, candidateId) {
  const cand = await db.one(`
    SELECT u.id, u.is_active, cp.stream FROM users u LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
    WHERE u.id = ? AND u.role = 'candidate'
  `, candidateId);
  if (!cand) throw notFound('Candidate not found');
  if (user.role === 'candidate' && user.id !== cand.id) throw notFound('Candidate not found');
  if (user.role === 'facilitator' && !(await facilitatorStreams(db, user.id)).includes(cand.stream)) throw notFound('Candidate not found');
  if (user.role === 'recruiter') throw notFound('Candidate not found');
  return cand;
}

module.exports = { stages, currentStage, facilitatorStreams, scopeSql, assertCanSeeCandidate };
