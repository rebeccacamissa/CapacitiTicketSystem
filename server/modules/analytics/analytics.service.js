'use strict';
/**
 * Dashboard analytics.
 * Owner: Member D
 */
const { avatarOf } = require('../avatar/catalog');

const ACTIVE = "status NOT IN ('Resolved','Closed')";
const HOURS = (a, b) => `iso_hours(${a}, ${b})`;

async function summary(db) {
  const totals = await db.one(`
    SELECT
      COUNT(*)                                                                    AS total,
      COUNT(*) FILTER (WHERE status IN ('Open','Reopened'))                       AS open,
      COUNT(*) FILTER (WHERE status IN ('Assigned','In Progress','Waiting for Candidate')) AS in_progress,
      COUNT(*) FILTER (WHERE status = 'Waiting for Candidate')                    AS waiting,
      COUNT(*) FILTER (WHERE status IN ('Resolved','Closed'))                     AS resolved,
      COUNT(*) FILTER (WHERE ${ACTIVE} AND due_at < now_iso())                    AS overdue,
      COUNT(*) FILTER (WHERE ${ACTIVE} AND assigned_to IS NULL)                   AS unassigned,
      ROUND(AVG(${HOURS('created_at', 'resolved_at')}) FILTER (WHERE resolved_at IS NOT NULL)::numeric, 1) AS avg_resolution_hours
    FROM requests
  `);
  for (const k of Object.keys(totals)) totals[k] = totals[k] ?? 0;

  const byStatus = await db.all(`
    SELECT s.name AS label, COUNT(r.id) AS count
    FROM request_statuses s LEFT JOIN requests r ON r.status = s.name
    GROUP BY s.name, s.sort_order ORDER BY s.sort_order
  `);

  const byCategory = await db.all(`
    SELECT c.name AS label, COUNT(r.id) AS count, COUNT(r.id) FILTER (WHERE r.${ACTIVE}) AS active
    FROM categories c LEFT JOIN requests r ON r.category_id = c.id
    GROUP BY c.id ORDER BY count DESC, c.name
  `);

  const byPriority = await db.all(`
    SELECT p.priority AS label, COUNT(r.id) AS count, COUNT(r.id) FILTER (WHERE r.${ACTIVE}) AS active
    FROM priority_sla p LEFT JOIN requests r ON r.priority = p.priority
    GROUP BY p.priority ORDER BY p.rank DESC
  `);

  const workload = (await db.all(`
    SELECT u.id, u.full_name AS name, u.role, u.gender, u.avatar_config,
      COUNT(r.id) FILTER (WHERE r.${ACTIVE})                              AS active,
      COUNT(r.id) FILTER (WHERE r.${ACTIVE} AND r.due_at < now_iso())     AS overdue,
      COUNT(r.id) FILTER (WHERE r.resolved_at IS NOT NULL)                AS resolved,
      ROUND(AVG(${HOURS('r.created_at', 'r.resolved_at')}) FILTER (WHERE r.resolved_at IS NOT NULL)::numeric, 1) AS avg_resolution_hours,
      (SELECT ROUND(AVG(rr.rating), 1) FROM request_ratings rr JOIN requests r2 ON r2.id = rr.request_id WHERE r2.assigned_to = u.id) AS avg_rating,
      (SELECT COUNT(*) FROM request_ratings rr JOIN requests r2 ON r2.id = rr.request_id WHERE r2.assigned_to = u.id) AS ratings
    FROM users u LEFT JOIN requests r ON r.assigned_to = u.id
    WHERE u.role IN ('support','admin') AND u.is_active = 1
    GROUP BY u.id ORDER BY active DESC, u.full_name
  `)).map(({ avatar_config, gender, ...w }) => ({ ...w, avatar: avatarOf({ avatar_config, gender }) }));

  const resolutionByCategory = await db.all(`
    SELECT c.name AS label,
      ROUND(AVG(${HOURS('r.created_at', 'r.resolved_at')})::numeric, 1) AS avg_hours,
      COUNT(r.id) AS resolved
    FROM requests r JOIN categories c ON c.id = r.category_id
    WHERE r.resolved_at IS NOT NULL
    GROUP BY c.id ORDER BY avg_hours DESC
  `);

  const oldestOverdue = await db.all(`
    SELECT r.id, r.reference, r.title, r.priority, r.status, r.due_at, au.full_name AS assignee_name,
      ROUND(${HOURS('r.due_at', 'now_iso()')}::numeric, 1) AS hours_overdue
    FROM requests r LEFT JOIN users au ON au.id = r.assigned_to
    WHERE r.${ACTIVE} AND r.due_at < now_iso()
    ORDER BY r.due_at ASC LIMIT 8
  `);

  // Daily created vs resolved for the last 14 days (zero-filled).
  const since = new Date(Date.now() - 13 * 86_400_000).toISOString().slice(0, 10);
  const created = await db.all('SELECT substr(created_at,1,10) d, COUNT(*) n FROM requests WHERE created_at >= ? GROUP BY 1', since);
  const resolvedRows = await db.all('SELECT substr(resolved_at,1,10) d, COUNT(*) n FROM requests WHERE resolved_at >= ? GROUP BY 1', since);
  const cMap = Object.fromEntries(created.map((r) => [r.d, r.n]));
  const rMap = Object.fromEntries(resolvedRows.map((r) => [r.d, r.n]));
  const trend = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    trend.push({ date: d, created: cMap[d] || 0, resolved: rMap[d] || 0 });
  }

  const incoming = (await db.all(`
    SELECT r.id, r.reference, r.title, r.priority, r.status, r.created_at, c.name AS category,
           u.full_name AS candidate_name, u.gender, u.avatar_config
    FROM requests r JOIN categories c ON c.id = r.category_id JOIN users u ON u.id = r.candidate_id
    WHERE r.assigned_to IS NULL AND r.status IN ('Open','Reopened')
    ORDER BY (SELECT rank FROM priority_sla p WHERE p.priority = r.priority) DESC, r.created_at ASC
    LIMIT 6
  `)).map(({ avatar_config, gender, ...r }) => ({ ...r, avatar: avatarOf({ avatar_config, gender }) }));

  const users = await db.all('SELECT role, COUNT(*) n, SUM(is_active) active FROM users GROUP BY role');

  const csatRow = await db.one('SELECT ROUND(AVG(rating), 2) AS avg, COUNT(*) AS count FROM request_ratings');
  const dist = Object.fromEntries((await db.all('SELECT rating, COUNT(*) n FROM request_ratings GROUP BY rating')).map((r) => [r.rating, r.n]));
  const recentRatings = await db.all(`
    SELECT rr.rating, rr.comment, rr.created_at, r.reference, r.id, u.full_name AS candidate_name
    FROM request_ratings rr JOIN requests r ON r.id = rr.request_id JOIN users u ON u.id = rr.candidate_id
    WHERE rr.comment IS NOT NULL ORDER BY rr.created_at DESC LIMIT 4
  `);
  const csat = { avg: csatRow.avg, count: csatRow.count, distribution: [5, 4, 3, 2, 1].map((n) => ({ rating: n, count: dist[n] || 0 })), recent: recentRatings };

  return { csat, totals, byStatus, byCategory, byPriority, workload, resolutionByCategory, oldestOverdue, trend, incoming, users, generatedAt: new Date().toISOString() };
}

/** Candidate's own quick stats. */
async function candidateSummary(db, candidateId) {
  return db.one(`
    SELECT COUNT(*) AS total,
      COUNT(*) FILTER (WHERE ${ACTIVE}) AS active,
      COUNT(*) FILTER (WHERE status = 'Waiting for Candidate') AS awaiting_you,
      COUNT(*) FILTER (WHERE status IN ('Resolved','Closed')) AS resolved
    FROM requests WHERE candidate_id = ?
  `, candidateId);
}

module.exports = { summary, candidateSummary };
