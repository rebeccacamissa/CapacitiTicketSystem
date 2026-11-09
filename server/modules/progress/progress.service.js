'use strict';
/**
 * Candidate programme roadmap.
 * Owner: Member D (dashboard)
 *
 * The active node is the candidate's OFFICIAL stage (candidate_stages, changed only by
 * audited stage decisions). Each stage's requirement checklist is supporting evidence:
 * its exit criteria, reviewed by a facilitator before the next stage is approved.
 */
const { notFound, badRequest } = require('../../utils/AppError');
const { avatarOf } = require('../avatar/catalog');
const rules = require('../stages/stage.rules');

function getRoadmap(db, candidateId) {
  const cand = db.prepare(`
    SELECT u.id, u.full_name, u.created_at, u.gender, u.avatar_config, cp.stream
    FROM users u LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
    WHERE u.id = ? AND u.role = 'candidate'`).get(candidateId);
  if (!cand) throw notFound('Candidate not found');

  const ms = db.prepare('SELECT id, key, title, description FROM milestones ORDER BY sort_order').all();
  const reqRows = db.prepare(`
    SELECT mr.id, mr.milestone_id, mr.label, p.completed_at, v.full_name AS verified_by
    FROM milestone_requirements mr
    LEFT JOIN candidate_requirement_progress p ON p.requirement_id = mr.id AND p.candidate_id = ?
    LEFT JOIN users v ON v.id = p.verified_by
    ORDER BY mr.milestone_id, mr.sort_order
  `).all(candidateId);
  const milestones = ms.map((m) => ({
    ...m,
    requirements: reqRows.filter((r) => r.milestone_id === m.id).map((r) => ({
      id: r.id, label: r.label, completed: !!r.completed_at, completedAt: r.completed_at, verifiedBy: r.verified_by,
    })),
  }));

  const stageKey = rules.currentStage(db, candidateId);
  const stageRow = db.prepare('SELECT updated_at FROM candidate_stages WHERE candidate_id = ?').get(candidateId);
  const decisions = db.prepare(`
    SELECT d.from_stage, d.to_stage, d.direction, d.reason, d.created_at, COALESCE(u.full_name, 'System') AS decided_by
    FROM stage_decisions d LEFT JOIN users u ON u.id = d.decided_by
    WHERE d.candidate_id = ? ORDER BY d.id
  `).all(candidateId);

  const allComplete = stageKey === 'completed';
  const activeIndex = Math.max(0, milestones.findIndex((m) => m.key === stageKey));
  const indexOf = (key) => milestones.findIndex((x) => x.key === key);

  milestones.forEach((m, i) => {
    const done = m.requirements.filter((r) => r.completed);
    m.completedCount = done.length;
    m.totalCount = m.requirements.length;
    m.state = i < activeIndex || allComplete ? 'completed' : i === activeIndex ? 'current' : 'upcoming';
    // Achieved = the latest decision that moved the candidate past this stage.
    const passed = decisions.filter((d) => d.direction !== 'backward' && indexOf(d.to_stage) > i && (d.from_stage === m.key || d.direction === 'initial'));
    const entered = decisions.filter((d) => d.to_stage === m.key);
    const by = passed.at(-1);
    m.achievedAt = m.state === 'completed' ? (by?.created_at || entered.at(-1)?.created_at || done.map((r) => r.completedAt).sort().at(-1) || null) : null;
    m.startedAt = entered.at(-1)?.created_at || (i === 0 ? cand.created_at : null);
    m.decision = m.state === 'completed' && by ? { by: by.decided_by, reason: by.reason, at: by.created_at } : null;
  });

  // Open tickets in blocker categories = active support intervention.
  const blockers = db.prepare(`
    SELECT r.id, r.reference, r.title, r.status, r.priority, c.name AS category
    FROM requests r JOIN categories c ON c.id = r.category_id
    WHERE r.candidate_id = ? AND c.is_blocker = 1 AND r.status NOT IN ('Resolved','Closed')
    ORDER BY CASE r.status WHEN 'Waiting for Candidate' THEN 0 ELSE 1 END, r.created_at DESC
  `).all(candidateId).map((b) => ({ ...b, needsYourAction: b.status === 'Waiting for Candidate' }));

  const current = milestones[activeIndex];
  const frac = current.totalCount ? current.completedCount / current.totalCount : 0;
  const last = decisions.at(-1);
  const stages = rules.stages(db);
  const stage = stages.find((s) => s.key === stageKey);
  const next = stages.find((s) => s.sortOrder === stage.sortOrder + 1) || null;

  return {
    candidate: { id: cand.id, name: cand.full_name, joinedAt: cand.created_at, stream: cand.stream, avatar: avatarOf(cand) },
    milestones,
    activeIndex,
    allComplete,
    percentComplete: allComplete ? 100 : Math.round(((activeIndex + frac) / (milestones.length - 1)) * 100),
    stage: {
      key: stageKey,
      label: stage.label,
      since: stageRow?.updated_at || cand.created_at,
      next: next && { key: next.key, label: next.label },
      lastDecision: last ? { by: last.decided_by, reason: last.reason, at: last.created_at, direction: last.direction, toStage: last.to_stage } : null,
    },
    // Every exit criterion for the current stage is evidenced: a facilitator can review it.
    readyForReview: !allComplete && current.completedCount >= current.totalCount,
    blockers,
  };
}

function setRequirement(db, { candidateId, requirementId, completed, actor }) {
  rules.assertCanSeeCandidate(db, actor, candidateId);
  if (!db.prepare('SELECT 1 FROM milestone_requirements WHERE id = ?').get(requirementId)) throw badRequest('Unknown requirement');
  if (completed) {
    db.prepare('INSERT OR IGNORE INTO candidate_requirement_progress (candidate_id, requirement_id, verified_by) VALUES (?, ?, ?)')
      .run(candidateId, requirementId, actor.id);
  } else {
    db.prepare('DELETE FROM candidate_requirement_progress WHERE candidate_id = ? AND requirement_id = ?').run(candidateId, requirementId);
  }
  return getRoadmap(db, candidateId);
}

module.exports = { getRoadmap, setRequirement };
