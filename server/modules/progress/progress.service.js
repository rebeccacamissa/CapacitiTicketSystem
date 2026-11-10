'use strict';
/**
 * Candidate programme roadmap.
 * Owner: Member D (dashboard)
 *
 * The active node is the candidate's OFFICIAL stage (candidate_stages, changed only by
 * audited stage decisions). Each stage's requirement checklist is supporting evidence:
 * its exit criteria, reviewed by a facilitator before the next stage is approved.
 * A checklist item can link to an uploaded portfolio document as proof.
 */
const { notFound, badRequest } = require('../../utils/AppError');
const { avatarOf } = require('../avatar/catalog');
const rules = require('../stages/stage.rules');

const DAY_MS = 86_400_000;

async function getRoadmap(db, candidateId) {
  const cand = await db.one(`
    SELECT u.id, u.full_name, u.created_at, u.gender, u.avatar_config, cp.stream
    FROM users u LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
    WHERE u.id = ? AND u.role = 'candidate'`, candidateId);
  if (!cand) throw notFound('Candidate not found');

  const ms = await db.all('SELECT id, key, title, description FROM milestones ORDER BY sort_order');
  const reqRows = await db.all(`
    SELECT mr.id, mr.milestone_id, mr.label, mr.tip, mr.evidence_kind, p.completed_at, v.full_name AS verified_by,
           f.id AS file_id, f.title AS file_title, f.kind AS file_kind
    FROM milestone_requirements mr
    LEFT JOIN candidate_requirement_progress p ON p.requirement_id = mr.id AND p.candidate_id = ?
    LEFT JOIN users v ON v.id = p.verified_by
    LEFT JOIN portfolio_files f ON f.id = p.file_id
    ORDER BY mr.milestone_id, mr.sort_order
  `, candidateId);
  const milestones = ms.map((m) => ({
    ...m,
    requirements: reqRows.filter((r) => r.milestone_id === m.id).map((r) => ({
      id: r.id, label: r.label, tip: r.tip, evidenceKind: r.evidence_kind,
      completed: !!r.completed_at, completedAt: r.completed_at, verifiedBy: r.verified_by,
      evidence: r.file_id ? { id: r.file_id, title: r.file_title, kind: r.file_kind } : null,
    })),
  }));

  const stageKey = await rules.currentStage(db, candidateId);
  const stageRow = await db.one('SELECT updated_at FROM candidate_stages WHERE candidate_id = ?', candidateId);
  const decisions = await db.all(`
    SELECT d.from_stage, d.to_stage, d.direction, d.reason, d.created_at, COALESCE(u.full_name, 'System') AS decided_by
    FROM stage_decisions d LEFT JOIN users u ON u.id = d.decided_by
    WHERE d.candidate_id = ? ORDER BY d.id
  `, candidateId);

  const allComplete = stageKey === 'completed';
  const activeIndex = Math.max(0, milestones.findIndex((m) => m.key === stageKey));
  const indexOf = (key) => milestones.findIndex((x) => x.key === key);

  milestones.forEach((m, i) => {
    const done = m.requirements.filter((r) => r.completed);
    m.completedCount = done.length;
    m.totalCount = m.requirements.length;
    m.state = i < activeIndex || allComplete ? 'completed' : i === activeIndex ? 'current' : 'upcoming';
    const passed = decisions.filter((d) => d.direction !== 'backward' && indexOf(d.to_stage) > i && (d.from_stage === m.key || d.direction === 'initial'));
    const entered = decisions.filter((d) => d.to_stage === m.key);
    const by = passed.at(-1);
    m.achievedAt = m.state === 'completed' ? (by?.created_at || entered.at(-1)?.created_at || done.map((r) => r.completedAt).sort().at(-1) || null) : null;
    m.startedAt = entered.at(-1)?.created_at || (i === 0 ? cand.created_at : null);
    m.decision = m.state === 'completed' && by ? { by: by.decided_by, reason: by.reason, at: by.created_at } : null;
  });

  const blockers = (await db.all(`
    SELECT r.id, r.reference, r.title, r.status, r.priority, c.name AS category
    FROM requests r JOIN categories c ON c.id = r.category_id
    WHERE r.candidate_id = ? AND c.is_blocker = 1 AND r.status NOT IN ('Resolved','Closed')
    ORDER BY CASE r.status WHEN 'Waiting for Candidate' THEN 0 ELSE 1 END, r.created_at DESC
  `, candidateId)).map((b) => ({ ...b, needsYourAction: b.status === 'Waiting for Candidate' }));

  const current = milestones[activeIndex];
  const frac = current.totalCount ? current.completedCount / current.totalCount : 0;
  const last = decisions.at(-1);
  const stages = await rules.stages(db);
  const stage = stages.find((s) => s.key === stageKey);
  const next = stages.find((s) => s.sortOrder === stage.sortOrder + 1) || null;
  const since = stageRow?.updated_at || cand.created_at;
  const daysInStage = Math.max(0, Math.floor((Date.now() - Date.parse(since)) / DAY_MS));
  const nextItem = allComplete ? null : current.requirements.find((r) => !r.completed) || null;

  return {
    candidate: { id: cand.id, name: cand.full_name, joinedAt: cand.created_at, stream: cand.stream, avatar: avatarOf(cand) },
    milestones,
    activeIndex,
    allComplete,
    percentComplete: allComplete ? 100 : Math.round(((activeIndex + frac) / (milestones.length - 1)) * 100),
    stage: {
      key: stageKey,
      label: stage.label,
      since,
      daysInStage,
      targetDays: next ? stage.targetDays : null,
      overdue: !!(next && stage.targetDays && daysInStage > stage.targetDays),
      next: next && { key: next.key, label: next.label },
      lastDecision: last ? { by: last.decided_by, reason: last.reason, at: last.created_at, direction: last.direction, toStage: last.to_stage } : null,
    },
    // "What's next": the first unticked exit criterion of the current stage, with a tip.
    whatsNext: nextItem && { id: nextItem.id, label: nextItem.label, tip: nextItem.tip, evidenceKind: nextItem.evidenceKind },
    readyForReview: !allComplete && current.completedCount >= current.totalCount,
    blockers,
  };
}

async function setRequirement(db, { candidateId, requirementId, completed, fileId, actor }) {
  await rules.assertCanSeeCandidate(db, actor, candidateId);
  if (!await db.one('SELECT 1 FROM milestone_requirements WHERE id = ?', requirementId)) throw badRequest('Unknown requirement');
  if (fileId && !await db.one('SELECT 1 FROM portfolio_files WHERE id = ? AND candidate_id = ?', fileId, candidateId)) {
    throw badRequest("That document doesn't belong to this candidate", { fields: { fileId: 'Choose one of the candidate\'s documents' } });
  }
  if (completed) {
    await db.run(`INSERT INTO candidate_requirement_progress (candidate_id, requirement_id, verified_by, file_id) VALUES (?, ?, ?, ?)
      ON CONFLICT (candidate_id, requirement_id) DO UPDATE SET file_id = COALESCE(EXCLUDED.file_id, candidate_requirement_progress.file_id)`,
    candidateId, requirementId, actor.id, fileId || null);
  } else {
    await db.run('DELETE FROM candidate_requirement_progress WHERE candidate_id = ? AND requirement_id = ?', candidateId, requirementId);
  }
  return getRoadmap(db, candidateId);
}

/** Link (or unlink with null) an evidence document on an already-verified item. */
async function linkEvidence(db, { candidateId, requirementId, fileId, actor }) {
  await rules.assertCanSeeCandidate(db, actor, candidateId);
  if (fileId && !await db.one('SELECT 1 FROM portfolio_files WHERE id = ? AND candidate_id = ?', fileId, candidateId)) {
    throw badRequest("That document doesn't belong to this candidate");
  }
  const { changes } = await db.run('UPDATE candidate_requirement_progress SET file_id = ? WHERE candidate_id = ? AND requirement_id = ?', fileId || null, candidateId, requirementId);
  if (!changes) throw badRequest('Verify the item first, then link a document to it');
  return getRoadmap(db, candidateId);
}

module.exports = { getRoadmap, setRequirement, linkEvidence };
