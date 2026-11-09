'use strict';
/**
 * Official stage decisions.
 *
 * Rules (checked here for friendly errors, and again by database triggers so a raw
 * SQL write cannot bypass them):
 *   - forward moves go one step at a time, approved by an admin or the candidate's
 *     stream facilitator;
 *   - a decision to the stage the candidate is already at is rejected;
 *   - backward moves are admin-only and need a written reason;
 *   - every change is recorded in the append-only stage_decisions trail.
 */
const { transaction } = require('../../db/connection');
const { AppError, badRequest, forbidden, conflict } = require('../../utils/AppError');
const { avatarOf } = require('../avatar/catalog');
const rules = require('./stage.rules');

const BACKWARD_REASON_MIN = 10;

function decide(db, { candidateId, toStage, reason, actor }) {
  if (!['admin', 'facilitator'].includes(actor.role)) throw forbidden('Only an admin or a facilitator can make stage decisions');
  rules.assertCanSeeCandidate(db, actor, candidateId);
  const active = db.prepare('SELECT is_active FROM users WHERE id = ?').get(candidateId);
  if (!active.is_active) throw conflict('CANDIDATE_INACTIVE', 'This candidate account is deactivated');

  const all = rules.stages(db);
  const order = Object.fromEntries(all.map((s) => [s.key, s.sortOrder]));
  if (!order[toStage]) throw badRequest('Unknown stage', { fields: { toStage: 'Choose a valid stage' } });
  const fromStage = rules.currentStage(db, candidateId);
  const text = String(reason || '').trim();

  if (toStage === fromStage) throw conflict('STAGE_UNCHANGED', 'The candidate is already at this stage');
  const direction = order[toStage] > order[fromStage] ? 'forward' : 'backward';
  if (direction === 'forward' && order[toStage] !== order[fromStage] + 1) {
    const next = all.find((s) => s.sortOrder === order[fromStage] + 1);
    throw conflict('STAGE_SKIP', `Stages move one step at a time. The next stage is ${next.label}.`);
  }
  if (direction === 'backward') {
    if (actor.role !== 'admin') throw new AppError(403, 'STAGE_BACKWARD_ADMIN_ONLY', 'Only an administrator can move a candidate back a stage');
    if (text.length < BACKWARD_REASON_MIN) {
      throw badRequest('Explain why the candidate is moving back a stage', { fields: { reason: `Write at least ${BACKWARD_REASON_MIN} characters` } });
    }
  }
  if (text.length < 3) throw badRequest('Give a reason for this decision', { fields: { reason: 'A reason is required' } });

  const decisionId = transaction(db, () => {
    const id = Number(db.prepare(`
      INSERT INTO stage_decisions (candidate_id, from_stage, to_stage, direction, decided_by, reason) VALUES (?, ?, ?, ?, ?, ?)
    `).run(candidateId, fromStage, toStage, direction, actor.id, text).lastInsertRowid);
    const { changes } = db.prepare("UPDATE candidate_stages SET stage = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE candidate_id = ?").run(toStage, candidateId);
    if (!changes) db.prepare('INSERT INTO candidate_stages (candidate_id, stage) VALUES (?, ?)').run(candidateId, toStage);
    return id;
  });
  return { decision: getDecision(db, decisionId), fromStage, toStage, direction };
}

const DECISION_SQL = `
  SELECT d.id, d.candidate_id AS candidateId, c.full_name AS candidateName, cp.stream, cp.cohort,
         d.from_stage AS fromStage, fs.label AS fromLabel, d.to_stage AS toStage, ts.label AS toLabel,
         d.direction, d.reason, d.created_at AS createdAt,
         d.decided_by AS decidedById, COALESCE(u.full_name, 'System') AS decidedBy, u.role AS decidedByRole
  FROM stage_decisions d
  JOIN users c ON c.id = d.candidate_id
  LEFT JOIN candidate_profiles cp ON cp.user_id = d.candidate_id
  LEFT JOIN programme_stages fs ON fs.key = d.from_stage
  JOIN programme_stages ts ON ts.key = d.to_stage
  LEFT JOIN users u ON u.id = d.decided_by`;

function getDecision(db, id) {
  return db.prepare(`${DECISION_SQL} WHERE d.id = ?`).get(id);
}

/** Stage audit trail. Admin: all; facilitator: their streams; candidate: their own. */
function history(db, user, { candidateId, limit = 100 } = {}) {
  if (candidateId) rules.assertCanSeeCandidate(db, user, candidateId);
  const where = [];
  const params = [];
  if (user.role === 'candidate') { where.push('d.candidate_id = ?'); params.push(user.id); }
  else {
    const scope = rules.scopeSql(db, user);
    where.push(scope.sql); params.push(...scope.params);
  }
  if (candidateId) { where.push('d.candidate_id = ?'); params.push(candidateId); }
  return db.prepare(`${DECISION_SQL} WHERE ${where.join(' AND ')} ORDER BY d.id DESC LIMIT ?`).all(...params, limit);
}

/** Candidates in scope with official stage + evidence for the current stage. */
function candidates(db, user) {
  const scope = rules.scopeSql(db, user);
  const rows = db.prepare(`
    SELECT u.id, u.full_name AS fullName, u.email, u.gender, u.avatar_config, cp.stream, cp.cohort,
           COALESCE(cs.stage, 'enrolled') AS stage, ps.label AS stageLabel, ps.sort_order AS stageOrder,
           cs.updated_at AS stageSince,
           (SELECT COUNT(*) FROM milestone_requirements mr JOIN milestones m ON m.id = mr.milestone_id WHERE m.key = COALESCE(cs.stage, 'enrolled')) AS evidenceTotal,
           (SELECT COUNT(*) FROM candidate_requirement_progress p JOIN milestone_requirements mr ON mr.id = p.requirement_id
              JOIN milestones m ON m.id = mr.milestone_id WHERE p.candidate_id = u.id AND m.key = COALESCE(cs.stage, 'enrolled')) AS evidenceDone
    FROM users u
    LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
    LEFT JOIN candidate_stages cs ON cs.candidate_id = u.id
    JOIN programme_stages ps ON ps.key = COALESCE(cs.stage, 'enrolled')
    WHERE u.role = 'candidate' AND u.is_active = 1 AND ${scope.sql}
    ORDER BY u.full_name
  `).all(...scope.params);
  const all = rules.stages(db);
  return rows.map(({ avatar_config, gender, ...r }) => {
    const next = all.find((s) => s.sortOrder === r.stageOrder + 1) || null;
    return {
      ...r,
      avatar: avatarOf({ avatar_config, gender }),
      nextStage: next && { key: next.key, label: next.label },
      readyForReview: !!next && r.evidenceDone >= r.evidenceTotal,
    };
  });
}

/** Pipeline counts by stage and by stream x stage (scoped like candidates()). */
function pipeline(db, user) {
  const list = candidates(db, user);
  const all = rules.stages(db);
  const byStage = Object.fromEntries(all.map((s) => [s.key, 0]));
  const streams = new Map();
  for (const c of list) {
    byStage[c.stage] += 1;
    const name = c.stream || 'No stream';
    if (!streams.has(name)) streams.set(name, { stream: name, total: 0, ...Object.fromEntries(all.map((s) => [s.key, 0])) });
    const row = streams.get(name);
    row.total += 1;
    row[c.stage] += 1;
  }
  return {
    stages: all,
    total: list.length,
    byStage,
    awaitingReview: list.filter((c) => c.readyForReview).length,
    byStream: [...streams.values()].sort((a, b) => b.total - a.total || a.stream.localeCompare(b.stream)),
    streams: user.role === 'facilitator' ? rules.facilitatorStreams(db, user.id) : undefined,
  };
}

module.exports = { decide, history, candidates, pipeline, getDecision, BACKWARD_REASON_MIN };
