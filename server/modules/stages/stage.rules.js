'use strict';
/**
 * Shared stage helpers: the stage list, a candidate's current official stage,
 * and who may see which candidates (facilitators are limited to their streams).
 */
const { notFound } = require('../../utils/AppError');

function stages(db) {
  return db.prepare('SELECT key, label, sort_order AS sortOrder FROM programme_stages ORDER BY sort_order').all();
}

/** A candidate with no stage row is 'enrolled' (the starting stage). */
function currentStage(db, candidateId) {
  return db.prepare('SELECT stage FROM candidate_stages WHERE candidate_id = ?').get(candidateId)?.stage || 'enrolled';
}

/** First stage whose exit criteria are incomplete; 'completed' when everything is evidenced. Used for the one-off backfill. */
function stageFromEvidence(db, candidateId) {
  const rows = db.prepare(`
    SELECT m.key, COUNT(mr.id) AS total, COUNT(p.requirement_id) AS done
    FROM milestones m
    LEFT JOIN milestone_requirements mr ON mr.milestone_id = m.id
    LEFT JOIN candidate_requirement_progress p ON p.requirement_id = mr.id AND p.candidate_id = ?
    GROUP BY m.id ORDER BY m.sort_order
  `).all(candidateId);
  const open = rows.find((r) => r.done < r.total);
  return open ? open.key : 'completed';
}

function facilitatorStreams(db, userId) {
  return db.prepare('SELECT stream FROM facilitator_streams WHERE user_id = ? ORDER BY stream').all(userId).map((r) => r.stream);
}

/**
 * SQL fragment + params restricting a candidate query (alias `cp` = candidate_profiles)
 * to what this user may see. Admin/support: everyone. Facilitator: their streams only.
 */
function scopeSql(db, user) {
  if (user.role !== 'facilitator') return { sql: '1 = 1', params: [] };
  const streams = facilitatorStreams(db, user.id);
  if (!streams.length) return { sql: '0 = 1', params: [] };
  return { sql: `cp.stream IN (${streams.map(() => '?').join(',')})`, params: streams };
}

/** Throws 404 (not 403, so existence isn't leaked) if the user can't see this candidate. */
function assertCanSeeCandidate(db, user, candidateId) {
  const cand = db.prepare(`
    SELECT u.id, cp.stream FROM users u LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
    WHERE u.id = ? AND u.role = 'candidate'
  `).get(candidateId);
  if (!cand) throw notFound('Candidate not found');
  if (user.role === 'candidate' && user.id !== cand.id) throw notFound('Candidate not found');
  if (user.role === 'facilitator' && !facilitatorStreams(db, user.id).includes(cand.stream)) throw notFound('Candidate not found');
  return cand;
}

module.exports = { stages, currentStage, stageFromEvidence, facilitatorStreams, scopeSql, assertCanSeeCandidate };
