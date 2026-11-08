'use strict';
/**
 * Candidate programme roadmap.
 * Owner: Member D (dashboard) — milestone data lives in milestones /
 * milestone_requirements / candidate_requirement_progress.
 *
 * Active node = the first milestone whose requirements are not all complete.
 */
const { notFound, badRequest } = require('../../utils/AppError');
const { avatarOf } = require('../avatar/catalog');

function getRoadmap(db, candidateId) {
  const cand = db.prepare("SELECT id, full_name, created_at, gender, avatar_config FROM users WHERE id = ? AND role = 'candidate'").get(candidateId);
  if (!cand) throw notFound('Candidate not found');

  const rows = db.prepare(`
    SELECT m.id AS milestone_id, m.key, m.title, m.description, m.sort_order,
           mr.id AS requirement_id, mr.label, p.completed_at, v.full_name AS verified_by
    FROM milestones m
    JOIN milestone_requirements mr ON mr.milestone_id = m.id
    LEFT JOIN candidate_requirement_progress p ON p.requirement_id = mr.id AND p.candidate_id = ?
    LEFT JOIN users v ON v.id = p.verified_by
    ORDER BY m.sort_order, mr.sort_order
  `).all(candidateId);

  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.milestone_id)) {
      map.set(r.milestone_id, { id: r.milestone_id, key: r.key, title: r.title, description: r.description, requirements: [] });
    }
    map.get(r.milestone_id).requirements.push({
      id: r.requirement_id, label: r.label, completed: !!r.completed_at, completedAt: r.completed_at, verifiedBy: r.verified_by,
    });
  }
  const milestones = [...map.values()];

  let activeIndex = milestones.findIndex((m) => m.requirements.some((r) => !r.completed));
  const allComplete = activeIndex === -1;
  if (allComplete) activeIndex = milestones.length - 1;

  milestones.forEach((m, i) => {
    const done = m.requirements.filter((r) => r.completed);
    m.completedCount = done.length;
    m.totalCount = m.requirements.length;
    m.state = i < activeIndex || (allComplete && i === activeIndex) ? 'completed' : i === activeIndex ? 'current' : 'upcoming';
    m.achievedAt = m.state === 'completed' ? done.map((r) => r.completedAt).sort().at(-1) : null;
    m.startedAt = done.length ? done.map((r) => r.completedAt).sort()[0] : null;
  });

  // Open tickets in blocker categories = active support intervention.
  const blockers = db.prepare(`
    SELECT r.id, r.reference, r.title, r.status, r.priority, c.name AS category
    FROM requests r JOIN categories c ON c.id = r.category_id
    WHERE r.candidate_id = ? AND c.is_blocker = 1 AND r.status NOT IN ('Resolved','Closed')
    ORDER BY CASE r.status WHEN 'Waiting for Candidate' THEN 0 ELSE 1 END, r.created_at DESC
  `).all(candidateId).map((b) => ({ ...b, needsYourAction: b.status === 'Waiting for Candidate' }));

  const totalReq = milestones.reduce((s, m) => s + m.totalCount, 0);
  const doneReq = milestones.reduce((s, m) => s + m.completedCount, 0);

  return {
    candidate: { id: cand.id, name: cand.full_name, joinedAt: cand.created_at, avatar: avatarOf(cand) },
    milestones,
    activeIndex,
    allComplete,
    percentComplete: totalReq ? Math.round((doneReq / totalReq) * 100) : 0,
    blockers,
  };
}

function setRequirement(db, { candidateId, requirementId, completed, actor }) {
  if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'candidate'").get(candidateId)) throw notFound('Candidate not found');
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
