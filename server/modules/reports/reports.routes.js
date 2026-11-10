'use strict';
/**
 * Programme reports for stakeholders: average time per stage, placement rate per
 * stream and cohort, completion velocity, and candidates past their stage target.
 * Admin sees everything; facilitators see their own streams. CSV exports included.
 */
const express = require('express');
const { getDb } = require('../../db/connection');
const { authenticate, authorize } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { badRequest } = require('../../utils/AppError');
const rules = require('../stages/stage.rules');
const stageSvc = require('../stages/stage.service');
const { sendCsv } = require('./exports');

const router = express.Router();
router.use(authenticate, authorize('admin', 'facilitator'));

const DAY = 86_400_000;
const days = (a, b) => Math.max(0, (Date.parse(b) - Date.parse(a)) / DAY);
const avg = (xs) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

async function buildReport(db, user, { stream, cohort } = {}) {
  const stages = await rules.stages(db);
  const order = Object.fromEntries(stages.map((s) => [s.key, s.sortOrder]));
  let candidates = await stageSvc.candidates(db, user);
  if (stream) candidates = candidates.filter((c) => c.stream === stream);
  if (cohort) candidates = candidates.filter((c) => c.cohort === cohort);
  const ids = candidates.map((c) => c.id);
  const joined = Object.fromEntries((ids.length ? await db.all(`SELECT id, created_at FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ids) : []).map((r) => [r.id, r.created_at]));
  const decisions = ids.length
    ? await db.all(`SELECT candidate_id, from_stage, to_stage, direction, created_at FROM stage_decisions WHERE candidate_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ids)
    : [];

  // Time spent in each stage: from entering it until the next decision moved the candidate on.
  const spans = Object.fromEntries(stages.map((s) => [s.key, []]));
  const reached = {}; // candidateId -> { placed: iso, completed: iso }
  const start = {};
  for (const c of candidates) {
    const mine = decisions.filter((d) => d.candidate_id === c.id);
    let current = 'enrolled';
    // Start of Enrolled: joining date, or the first decision if records predate the account (imports).
    let since = mine[0] && mine[0].created_at < joined[c.id] ? mine[0].created_at : joined[c.id];
    start[c.id] = since;
    for (const d of mine) {
      if (d.direction === 'initial') { current = d.to_stage; since = d.created_at; continue; }
      if (since) spans[current].push(days(since, d.created_at));
      current = d.to_stage;
      since = d.created_at;
      if (d.direction === 'forward' && (d.to_stage === 'placed' || d.to_stage === 'completed')) {
        reached[c.id] = { ...(reached[c.id] || {}), [d.to_stage]: d.created_at };
      }
    }
  }

  const group = (key) => {
    const map = new Map();
    for (const c of candidates) {
      const k = c[key] || `No ${key}`;
      if (!map.has(k)) map.set(k, { [key]: k, candidates: 0, workReady: 0, placed: 0, completed: 0, overdue: 0 });
      const g = map.get(k);
      g.candidates += 1;
      if (order[c.stage] >= order.work_ready) g.workReady += 1;
      if (order[c.stage] >= order.placed) g.placed += 1;
      if (c.stage === 'completed') g.completed += 1;
      if (c.overdue) g.overdue += 1;
    }
    return [...map.values()].map((g) => ({ ...g, placementRate: pct(g.placed, g.candidates), completionRate: pct(g.completed, g.candidates) }))
      .sort((a, b) => b.candidates - a.candidates);
  };

  const toPlaced = Object.entries(reached).filter(([, r]) => r.placed).map(([id, r]) => days(start[id], r.placed));
  const toCompleted = Object.entries(reached).filter(([, r]) => r.completed).map(([id, r]) => days(start[id], r.completed));
  const placedCount = candidates.filter((c) => order[c.stage] >= order.placed).length;

  return {
    generatedAt: new Date().toISOString(),
    filters: { stream: stream || null, cohort: cohort || null },
    totals: {
      candidates: candidates.length,
      placed: placedCount,
      completed: candidates.filter((c) => c.stage === 'completed').length,
      placementRate: pct(placedCount, candidates.length),
      overdue: candidates.filter((c) => c.overdue).length,
      awaitingReview: candidates.filter((c) => c.readyForReview || c.reviewRequested).length,
    },
    stageTimes: stages.filter((s) => s.key !== 'completed').map((s) => {
      const inNow = candidates.filter((c) => c.stage === s.key);
      return {
        key: s.key, label: s.label, targetDays: s.targetDays,
        completedSpans: spans[s.key].length,
        avgDays: avg(spans[s.key]),
        currentlyIn: inNow.length,
        avgDaysSoFar: avg(inNow.map((c) => c.daysInStage)),
        overdueNow: inNow.filter((c) => c.overdue).length,
      };
    }),
    velocity: { avgDaysToPlaced: avg(toPlaced), avgDaysToCompleted: avg(toCompleted), placedSample: toPlaced.length, completedSample: toCompleted.length },
    byStream: group('stream'),
    byCohort: group('cohort'),
    overdueCandidates: candidates.filter((c) => c.overdue).map((c) => ({ id: c.id, fullName: c.fullName, stream: c.stream, cohort: c.cohort, stage: c.stageLabel, daysInStage: c.daysInStage, targetDays: c.targetDays })),
    candidates,
    options: {
      streams: [...new Set((await stageSvc.candidates(db, user)).map((c) => c.stream).filter(Boolean))].sort(),
      cohorts: [...new Set((await stageSvc.candidates(db, user)).map((c) => c.cohort).filter(Boolean))].sort(),
    },
  };
}

const filters = validate({ stream: { type: 'string', max: 80 }, cohort: { type: 'string', max: 80 } }, 'query');

router.get('/programme', filters, async (req, res) => {
  const r = await buildReport(getDb(), req.user, req.validQuery);
  delete r.candidates;
  res.json(r);
});

router.get('/programme/export.csv', filters, validate({ type: { type: 'enum', required: true, values: ['candidates', 'streams', 'cohorts', 'stages'] } }, 'query'), async (req, res) => {
  const r = await buildReport(getDb(), req.user, req.validQuery);
  const t = req.validQuery.type;
  if (t === 'candidates') {
    return sendCsv(res, 'programme-candidates', [
      ['fullName', 'Candidate'], ['email', 'Email'], ['stream', 'Stream'], ['cohort', 'Cohort'], ['stageLabel', 'Official stage'],
      ['stageSince', 'In stage since'], ['daysInStage', 'Days in stage'], ['targetDays', 'Target days'], [(c) => (c.overdue ? 'Yes' : 'No'), 'Past target'],
      [(c) => `${c.evidenceDone}/${c.evidenceTotal}`, 'Exit criteria evidenced'], [(c) => (c.reviewRequested ? 'Yes' : 'No'), 'Review requested'],
    ], r.candidates);
  }
  if (t === 'streams' || t === 'cohorts') {
    const key = t === 'streams' ? 'stream' : 'cohort';
    return sendCsv(res, `programme-${t}`, [[key, key === 'stream' ? 'Stream' : 'Cohort'], ['candidates', 'Candidates'], ['workReady', 'Work ready or beyond'],
      ['placed', 'Placed or completed'], ['completed', 'Completed'], ['placementRate', 'Placement rate %'], ['completionRate', 'Completion rate %'], ['overdue', 'Past stage target']],
    t === 'streams' ? r.byStream : r.byCohort);
  }
  if (t === 'stages') {
    return sendCsv(res, 'programme-stage-times', [['label', 'Stage'], ['targetDays', 'Target days'], ['avgDays', 'Average days (completed)'], ['completedSpans', 'Sample size'],
      ['currentlyIn', 'Candidates in stage now'], ['avgDaysSoFar', 'Average days so far'], ['overdueNow', 'Past target now']], r.stageTimes);
  }
  throw badRequest('Unknown export');
});

module.exports = router;
module.exports.buildReport = buildReport;
