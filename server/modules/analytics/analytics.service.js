'use strict';
/**
 * Dashboard analytics.
 * Owner: Member D
 */
const { avatarOf } = require('../avatar/catalog');
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const ACTIVE = "status NOT IN ('Resolved','Closed')";

function summary(db) {
  const totals = db.prepare(`
    SELECT
      COUNT(*)                                                                      AS total,
      SUM(status IN ('Open','Reopened'))                                            AS open,
      SUM(status IN ('Assigned','In Progress','Waiting for Candidate'))             AS in_progress,
      SUM(status = 'Waiting for Candidate')                                         AS waiting,
      SUM(status IN ('Resolved','Closed'))                                          AS resolved,
      SUM(${ACTIVE} AND due_at < ${NOW})                                            AS overdue,
      SUM(${ACTIVE} AND assigned_to IS NULL)                                        AS unassigned,
      ROUND(AVG(CASE WHEN resolved_at IS NOT NULL
                     THEN (julianday(resolved_at) - julianday(created_at)) * 24 END), 1) AS avg_resolution_hours
    FROM requests
  `).get();
  for (const k of Object.keys(totals)) totals[k] = totals[k] ?? 0;

  const byStatus = db.prepare(`
    SELECT s.name AS label, COUNT(r.id) AS count
    FROM request_statuses s LEFT JOIN requests r ON r.status = s.name
    GROUP BY s.name ORDER BY s.sort_order
  `).all();

  const byCategory = db.prepare(`
    SELECT c.name AS label, COUNT(r.id) AS count, SUM(CASE WHEN r.${ACTIVE} THEN 1 ELSE 0 END) AS active
    FROM categories c LEFT JOIN requests r ON r.category_id = c.id
    GROUP BY c.id ORDER BY count DESC, c.name
  `).all();

  const byPriority = db.prepare(`
    SELECT p.priority AS label, COUNT(r.id) AS count, SUM(CASE WHEN r.${ACTIVE} THEN 1 ELSE 0 END) AS active
    FROM priority_sla p LEFT JOIN requests r ON r.priority = p.priority
    GROUP BY p.priority ORDER BY p.rank DESC
  `).all();

  const workload = db.prepare(`
    SELECT u.id, u.full_name AS name, u.role, u.gender, u.avatar_config,
      SUM(CASE WHEN r.${ACTIVE} THEN 1 ELSE 0 END)                         AS active,
      SUM(CASE WHEN r.${ACTIVE} AND r.due_at < ${NOW} THEN 1 ELSE 0 END)    AS overdue,
      SUM(CASE WHEN r.resolved_at IS NOT NULL THEN 1 ELSE 0 END)            AS resolved,
      ROUND(AVG(CASE WHEN r.resolved_at IS NOT NULL
                     THEN (julianday(r.resolved_at) - julianday(r.created_at)) * 24 END), 1) AS avg_resolution_hours,
      (SELECT ROUND(AVG(rr.rating), 1) FROM request_ratings rr JOIN requests r2 ON r2.id = rr.request_id WHERE r2.assigned_to = u.id) AS avg_rating,
      (SELECT COUNT(*) FROM request_ratings rr JOIN requests r2 ON r2.id = rr.request_id WHERE r2.assigned_to = u.id) AS ratings
    FROM users u LEFT JOIN requests r ON r.assigned_to = u.id
    WHERE u.role IN ('support','admin') AND u.is_active = 1
    GROUP BY u.id ORDER BY active DESC, u.full_name
  `).all().map(({ avatar_config, gender, ...w }) => ({ ...w, avatar: avatarOf({ avatar_config, gender }) }));

  const resolutionByCategory = db.prepare(`
    SELECT c.name AS label,
      ROUND(AVG((julianday(r.resolved_at) - julianday(r.created_at)) * 24), 1) AS avg_hours,
      COUNT(r.id) AS resolved
    FROM requests r JOIN categories c ON c.id = r.category_id
    WHERE r.resolved_at IS NOT NULL
    GROUP BY c.id ORDER BY avg_hours DESC
  `).all();

  const oldestOverdue = db.prepare(`
    SELECT r.id, r.reference, r.title, r.priority, r.status, r.due_at, au.full_name AS assignee_name,
      ROUND((julianday(${NOW}) - julianday(r.due_at)) * 24, 1) AS hours_overdue
    FROM requests r LEFT JOIN users au ON au.id = r.assigned_to
    WHERE r.${ACTIVE} AND r.due_at < ${NOW}
    ORDER BY r.due_at ASC LIMIT 8
  `).all();

  // Daily created vs resolved for the last 14 days (zero-filled).
  const created = db.prepare(`SELECT substr(created_at,1,10) d, COUNT(*) n FROM requests WHERE created_at >= date('now','-13 days') GROUP BY d`).all();
  const resolvedRows = db.prepare(`SELECT substr(resolved_at,1,10) d, COUNT(*) n FROM requests WHERE resolved_at >= date('now','-13 days') GROUP BY d`).all();
  const cMap = Object.fromEntries(created.map((r) => [r.d, r.n]));
  const rMap = Object.fromEntries(resolvedRows.map((r) => [r.d, r.n]));
  const trend = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    trend.push({ date: d, created: cMap[d] || 0, resolved: rMap[d] || 0 });
  }

  const incoming = db.prepare(`
    SELECT r.id, r.reference, r.title, r.priority, r.status, r.created_at, c.name AS category,
           u.full_name AS candidate_name, u.gender, u.avatar_config
    FROM requests r JOIN categories c ON c.id = r.category_id JOIN users u ON u.id = r.candidate_id
    WHERE r.assigned_to IS NULL AND r.status IN ('Open','Reopened')
    ORDER BY (SELECT rank FROM priority_sla p WHERE p.priority = r.priority) DESC, r.created_at ASC
    LIMIT 6
  `).all().map(({ avatar_config, gender, ...r }) => ({ ...r, avatar: avatarOf({ avatar_config, gender }) }));

  const users = db.prepare(`SELECT role, COUNT(*) n, SUM(is_active) active FROM users GROUP BY role`).all();

  const csatRow = db.prepare('SELECT ROUND(AVG(rating), 2) AS avg, COUNT(*) AS count FROM request_ratings').get();
  const dist = Object.fromEntries(db.prepare('SELECT rating, COUNT(*) n FROM request_ratings GROUP BY rating').all().map((r) => [r.rating, r.n]));
  const recentRatings = db.prepare(`
    SELECT rr.rating, rr.comment, rr.created_at, r.reference, r.id, u.full_name AS candidate_name
    FROM request_ratings rr JOIN requests r ON r.id = rr.request_id JOIN users u ON u.id = rr.candidate_id
    WHERE rr.comment IS NOT NULL ORDER BY rr.created_at DESC LIMIT 4
  `).all();
  const csat = { avg: csatRow.avg, count: csatRow.count, distribution: [5, 4, 3, 2, 1].map((n) => ({ rating: n, count: dist[n] || 0 })), recent: recentRatings };

  return { csat, totals, byStatus, byCategory, byPriority, workload, resolutionByCategory, oldestOverdue, trend, incoming, users, generatedAt: new Date().toISOString() };
}

/** Candidate's own quick stats. */
function candidateSummary(db, candidateId) {
  return db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(${ACTIVE}) AS active,
      SUM(status = 'Waiting for Candidate') AS awaiting_you,
      SUM(status IN ('Resolved','Closed')) AS resolved
    FROM requests WHERE candidate_id = ?
  `).get(candidateId);
}

module.exports = { summary, candidateSummary };
