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
const { AppError, badRequest, forbidden, conflict, notFound } = require('../../utils/AppError');
const { avatarOf } = require('../avatar/catalog');
const rules = require('./stage.rules');
const bus = require('../../realtime/bus');
const email = require('../../services/email');

const BACKWARD_REASON_MIN = 10;
const DAY_MS = 86_400_000;

async function decide(db, { candidateId, toStage, reason, actor }) {
  if (!['admin', 'facilitator'].includes(actor.role)) throw forbidden('Only an admin or a facilitator can make stage decisions');
  const cand = await rules.assertCanSeeCandidate(db, actor, candidateId);
  if (!cand.is_active) throw conflict('CANDIDATE_INACTIVE', 'This candidate account is deactivated');

  const all = await rules.stages(db);
  const order = Object.fromEntries(all.map((s) => [s.key, s.sortOrder]));
  if (!order[toStage]) throw badRequest('Unknown stage', { fields: { toStage: 'Choose a valid stage' } });
  const text = String(reason || '').trim();

  const out = await db.tx(async (t) => {
    // Lock the candidate's stage row (if any) so two simultaneous decisions can't race.
    await t.one('SELECT stage FROM candidate_stages WHERE candidate_id = ? FOR UPDATE', candidateId);
    const fromStage = await rules.currentStage(t, candidateId);
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

    const id = await t.insert(`
      INSERT INTO stage_decisions (candidate_id, from_stage, to_stage, direction, decided_by, reason) VALUES (?, ?, ?, ?, ?, ?)
    `, candidateId, fromStage, toStage, direction, actor.id, text);
    const { changes } = await t.run('UPDATE candidate_stages SET stage = ?, updated_at = now_iso() WHERE candidate_id = ?', toStage, candidateId);
    if (!changes) await t.run('INSERT INTO candidate_stages (candidate_id, stage) VALUES (?, ?)', candidateId, toStage);
    // A decision answers any open review request.
    await t.run("UPDATE review_requests SET status = 'resolved', resolved_at = now_iso() WHERE candidate_id = ? AND status = 'open'", candidateId);
    return { decision: await getDecision(t, id), fromStage, toStage, direction };
  });
  await afterDecision(db, out);
  return out;
}

/** Side effects after a committed decision: badge, live update, email. */
async function afterDecision(db, out) {
  const { decision } = out;
  if (out.direction === 'forward') await require('../engage/gamification.service').award(db, decision.candidateId, 'milestone', out.toStage);
  bus.publish([decision.candidateId], 'progress', {});
  bus.publish([decision.candidateId], 'notify', {});
  bus.publish('staff', 'people', {});
  const cand = await db.one('SELECT email, first_name, full_name FROM users WHERE id = ?', decision.candidateId);
  email.notify(db, {
    to: cand.email,
    kind: 'stage_decision',
    subject: out.direction === 'forward' ? `You've moved to ${decision.toLabel}` : `Your programme stage changed to ${decision.toLabel}`,
    heading: out.direction === 'forward' ? `Congratulations, ${cand.first_name || cand.full_name}!` : `Hi ${cand.first_name || cand.full_name}`,
    lines: [
      `Your official CAPACITI stage is now ${decision.toLabel} (previously ${decision.fromLabel}).`,
      `Reason from ${decision.decidedBy}: ${decision.reason}`,
    ],
    cta: { label: 'Open my roadmap', href: email.link('/dashboard#roadmap') },
  });
}

/** Approve the next stage for several candidates at once with one shared note. Each is its own transaction. */
async function batchDecide(db, { candidateIds, reason, actor }) {
  const results = [];
  for (const id of [...new Set(candidateIds)]) {
    try {
      const cand = await rules.assertCanSeeCandidate(db, actor, id);
      const all = await rules.stages(db);
      const cur = await rules.currentStage(db, cand.id);
      const next = all.find((s) => s.sortOrder === all.find((x) => x.key === cur).sortOrder + 1);
      if (!next) throw conflict('STAGE_UNCHANGED', 'Already at the final stage');
      const out = await decide(db, { candidateId: id, toStage: next.key, reason, actor });
      results.push({ candidateId: id, ok: true, toStage: out.toStage, toLabel: out.decision.toLabel });
    } catch (err) {
      results.push({ candidateId: id, ok: false, error: err.message, code: err.code });
    }
  }
  return results;
}

const DECISION_SQL = `
  SELECT d.id, d.candidate_id AS "candidateId", c.full_name AS "candidateName", cp.stream, cp.cohort,
         d.from_stage AS "fromStage", fs.label AS "fromLabel", d.to_stage AS "toStage", ts.label AS "toLabel",
         d.direction, d.reason, d.created_at AS "createdAt",
         d.decided_by AS "decidedById", COALESCE(u.full_name, 'System') AS "decidedBy", u.role AS "decidedByRole"
  FROM stage_decisions d
  JOIN users c ON c.id = d.candidate_id
  LEFT JOIN candidate_profiles cp ON cp.user_id = d.candidate_id
  LEFT JOIN programme_stages fs ON fs.key = d.from_stage
  JOIN programme_stages ts ON ts.key = d.to_stage
  LEFT JOIN users u ON u.id = d.decided_by`;

async function getDecision(db, id) {
  return db.one(`${DECISION_SQL} WHERE d.id = ?`, id);
}

/** Stage audit trail. Admin: all; facilitator: their streams; candidate: their own. */
async function history(db, user, { candidateId, limit = 100, from, to } = {}) {
  if (candidateId) await rules.assertCanSeeCandidate(db, user, candidateId);
  const where = [];
  const params = [];
  if (user.role === 'candidate') { where.push('d.candidate_id = ?'); params.push(user.id); }
  else {
    const scope = await rules.scopeSql(db, user);
    where.push(scope.sql); params.push(...scope.params);
  }
  if (candidateId) { where.push('d.candidate_id = ?'); params.push(candidateId); }
  if (from) { where.push('d.created_at >= ?'); params.push(from); }
  if (to) { where.push('d.created_at < ?'); params.push(to); }
  return db.all(`${DECISION_SQL} WHERE ${where.join(' AND ')} ORDER BY d.id DESC LIMIT ?`, [...params, limit]);
}

/** Candidates in scope with official stage, evidence for the current stage, and attention flags. */
async function candidates(db, user) {
  const scope = await rules.scopeSql(db, user);
  const rows = await db.all(`
    SELECT u.id, u.full_name AS "fullName", u.email, u.gender, u.avatar_config, u.created_at, cp.stream, cp.cohort,
           COALESCE(cs.stage, 'enrolled') AS stage, ps.label AS "stageLabel", ps.sort_order AS "stageOrder", ps.target_days AS "targetDays",
           COALESCE(cs.updated_at, u.created_at) AS "stageSince",
           (SELECT COUNT(*) FROM milestone_requirements mr JOIN milestones m ON m.id = mr.milestone_id WHERE m.key = COALESCE(cs.stage, 'enrolled')) AS "evidenceTotal",
           (SELECT COUNT(*) FROM candidate_requirement_progress p JOIN milestone_requirements mr ON mr.id = p.requirement_id
              JOIN milestones m ON m.id = mr.milestone_id WHERE p.candidate_id = u.id AND m.key = COALESCE(cs.stage, 'enrolled')) AS "evidenceDone",
           rr.created_at AS "reviewRequestedAt", rr.note AS "reviewNote",
           pl.id AS "placementId", pl.company AS "placementCompany", pl.role_title AS "placementRole"
    FROM users u
    LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
    LEFT JOIN candidate_stages cs ON cs.candidate_id = u.id
    JOIN programme_stages ps ON ps.key = COALESCE(cs.stage, 'enrolled')
    LEFT JOIN review_requests rr ON rr.candidate_id = u.id AND rr.status = 'open'
    LEFT JOIN placements pl ON pl.candidate_id = u.id AND pl.status = 'pending'
    WHERE u.role = 'candidate' AND u.is_active = 1 AND ${scope.sql}
    ORDER BY u.full_name
  `, scope.params);
  const all = await rules.stages(db);
  const now = Date.now();
  return rows.map(({ avatar_config, gender, created_at, ...r }) => {
    const next = all.find((s) => s.sortOrder === r.stageOrder + 1) || null;
    const daysInStage = Math.max(0, Math.floor((now - Date.parse(r.stageSince)) / DAY_MS));
    return {
      ...r,
      avatar: avatarOf({ avatar_config, gender }),
      nextStage: next && { key: next.key, label: next.label },
      readyForReview: !!next && r.evidenceDone >= r.evidenceTotal,
      reviewRequested: !!r.reviewRequestedAt,
      pendingPlacement: r.placementId ? { id: r.placementId, company: r.placementCompany, role: r.placementRole } : null,
      daysInStage,
      overdue: !!(next && r.targetDays && daysInStage > r.targetDays),
    };
  });
}

/** Pipeline counts by stage and by stream x stage (scoped like candidates()). */
async function pipeline(db, user) {
  const list = await candidates(db, user);
  const all = await rules.stages(db);
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
    awaitingReview: list.filter((c) => c.readyForReview || c.reviewRequested).length,
    overdue: list.filter((c) => c.overdue).length,
    byStream: [...streams.values()].sort((a, b) => b.total - a.total || a.stream.localeCompare(b.stream)),
    streams: user.role === 'facilitator' ? await rules.facilitatorStreams(db, user.id) : undefined,
  };
}

// ---- Candidate-requested review ---------------------------------------------------
async function requestReview(db, candidate, note = '') {
  const stage = await rules.currentStage(db, candidate.id);
  if (stage === 'completed') throw conflict('STAGE_UNCHANGED', 'You have already completed the programme');
  const existing = await db.one("SELECT id FROM review_requests WHERE candidate_id = ? AND status = 'open'", candidate.id);
  if (existing) throw conflict('REVIEW_ALREADY_REQUESTED', 'You have already asked for a review. Your facilitator will respond soon.');
  await db.run('INSERT INTO review_requests (candidate_id, stage, note) VALUES (?, ?, ?)', candidate.id, stage, note);
  const info = await db.one(`SELECT u.full_name, cp.stream, ps.label FROM users u LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
    JOIN programme_stages ps ON ps.key = ? WHERE u.id = ?`, stage, candidate.id);
  // Alert the stream's facilitators (or admins if the stream has none).
  let staff = await db.all(`SELECT u.id, u.email, u.first_name FROM users u JOIN facilitator_streams fs ON fs.user_id = u.id
    WHERE fs.stream = ? AND u.role = 'facilitator' AND u.is_active = 1`, info.stream || '');
  if (!staff.length) staff = await db.all("SELECT id, email, first_name FROM users WHERE role = 'admin' AND is_active = 1");
  for (const s of staff) {
    email.notify(db, {
      to: s.email, kind: 'review_request', subject: `${info.full_name} asked for a stage review`,
      heading: `${info.full_name} is asking for a stage review`,
      lines: [`Current stage: ${info.label}${info.stream ? ` (${info.stream})` : ''}.`, ...(note ? [`Their note: ${note}`] : [])],
      cta: { label: 'Review now', href: email.link(`/stage-decisions?candidate=${candidate.id}`) },
    });
  }
  bus.publish(staff.map((s) => s.id), 'notify', {});
  bus.publish('staff', 'people', {});
  return { ok: true };
}

async function myReviewRequest(db, candidateId) {
  return (await db.one(`SELECT id, stage, note, created_at AS "createdAt" FROM review_requests WHERE candidate_id = ? AND status = 'open'`, candidateId)) || null;
}

// ---- Placement confirmation (recruiter reports a hire; facilitator/admin confirms) --
async function handlePlacement(db, { placementId, approve, note, actor }) {
  const pl = await db.one("SELECT * FROM placements WHERE id = ? AND status = 'pending'", placementId);
  if (!pl) throw notFound('Pending placement not found');
  await rules.assertCanSeeCandidate(db, actor, pl.candidate_id);
  if (approve) {
    const cur = await rules.currentStage(db, pl.candidate_id);
    if (cur !== 'work_ready') throw conflict('PLACEMENT_STAGE', 'The candidate must be at Work Ready before a placement can be confirmed. Approve their stages first.');
    await decide(db, { candidateId: pl.candidate_id, toStage: 'placed', reason: `Placement confirmed: ${pl.role_title} at ${pl.company}.${note ? ` ${note}` : ''}`, actor });
  }
  await db.run('UPDATE placements SET status = ?, handled_by = ?, handled_at = now_iso(), handled_note = ? WHERE id = ?', approve ? 'confirmed' : 'rejected', actor.id, note || null, placementId);
  const rec = pl.recruiter_id && await db.one('SELECT email FROM users WHERE id = ?', pl.recruiter_id);
  if (rec) {
    email.notify(db, {
      to: rec.email, kind: 'placement', subject: `Placement ${approve ? 'confirmed' : 'not confirmed'}: ${pl.company}`,
      heading: `Your reported placement was ${approve ? 'confirmed' : 'not confirmed'}`,
      lines: [`${pl.role_title} at ${pl.company}.`, ...(note ? [`Note: ${note}`] : [])],
    });
  }
  bus.publish('staff', 'people', {});
  return { ok: true, status: approve ? 'confirmed' : 'rejected' };
}

module.exports = {
  decide, batchDecide, history, candidates, pipeline, getDecision, requestReview, myReviewRequest, handlePlacement, BACKWARD_REASON_MIN,
};
