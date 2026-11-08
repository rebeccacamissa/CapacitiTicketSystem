'use strict';
/**
 * Candidate module: create, list (search / filter / sort / paginate), detail.
 * Owner: Member B
 */
const { transaction } = require('../../db/connection');
const { badRequest, notFound } = require('../../utils/AppError');
const { writeAudit } = require('../workflow/audit.service');
const { allowedNext } = require('../workflow/stateMachine');
const { nextReference } = require('./reference');

const OVERDUE_SQL = `(r.status NOT IN ('Resolved','Closed') AND r.due_at < strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

function createRequest(db, { actor, title, description, categoryId, priority }) {
  return transaction(db, () => {
    const cat = db.prepare('SELECT id FROM categories WHERE id = ? AND is_active = 1').get(categoryId);
    if (!cat) throw badRequest('Please choose a valid category', { fields: { categoryId: 'Invalid category' } });

    const reference = nextReference(db);
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO requests (reference, candidate_id, category_id, title, description, priority, due_at)
      VALUES (?, ?, ?, ?, ?, ?,
        strftime('%Y-%m-%dT%H:%M:%fZ','now', '+' || (SELECT hours FROM priority_sla WHERE priority = ?) || ' hours'))
    `).run(reference, actor.id, categoryId, title, description, priority, priority);

    writeAudit(db, { requestId: lastInsertRowid, userId: actor.id, action: 'CREATED', newStatus: 'Open', details: `Created ${reference}` });
    return db.prepare('SELECT * FROM requests WHERE id = ?').get(lastInsertRowid);
  });
}

const SORTS = {
  created: 'r.created_at',
  updated: 'r.updated_at',
  due: 'r.due_at',
  priority: '(SELECT rank FROM priority_sla p WHERE p.priority = r.priority)',
  reference: 'r.reference',
  status: '(SELECT sort_order FROM request_statuses s WHERE s.name = r.status)',
};

function listRequests(db, actor, q) {
  const where = [];
  const params = [];

  if (actor.role === 'candidate') { where.push('r.candidate_id = ?'); params.push(actor.id); }

  if (q.q) {
    where.push('(r.reference LIKE ? OR r.title LIKE ? OR r.description LIKE ? OR cu.full_name LIKE ?)');
    const like = `%${q.q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
    params.push(like, like, like, like);
    where[where.length - 1] = where[where.length - 1].replace(/LIKE \?/g, "LIKE ? ESCAPE '\\'");
  }
  if (q.status === 'active') where.push("r.status NOT IN ('Resolved','Closed')");
  else if (q.status) { where.push('r.status = ?'); params.push(q.status); }
  if (q.categoryId) { where.push('r.category_id = ?'); params.push(q.categoryId); }
  if (q.priority) { where.push('r.priority = ?'); params.push(q.priority); }
  if (q.overdue) where.push(OVERDUE_SQL);
  if (actor.role !== 'candidate' && q.assigned) {
    if (q.assigned === 'me') { where.push('r.assigned_to = ?'); params.push(actor.id); }
    else if (q.assigned === 'unassigned') where.push('r.assigned_to IS NULL');
    else if (/^\d+$/.test(q.assigned)) { where.push('r.assigned_to = ?'); params.push(Number(q.assigned)); }
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sortCol = SORTS[q.sort] || SORTS.created;
  const dir = q.order === 'asc' ? 'ASC' : 'DESC';
  const pageSize = q.pageSize || 20;
  const page = q.page || 1;

  const from = `
    FROM requests r
    JOIN categories c ON c.id = r.category_id
    JOIN users cu ON cu.id = r.candidate_id
    LEFT JOIN users au ON au.id = r.assigned_to
    ${whereSql}`;

  const { total } = db.prepare(`SELECT COUNT(*) AS total ${from}`).get(...params);
  const rows = db.prepare(`
    SELECT r.id, r.reference, r.title, r.status, r.priority, r.created_at, r.updated_at, r.due_at,
           c.name AS category, cu.full_name AS candidate_name, au.full_name AS assignee_name,
           ${OVERDUE_SQL} AS is_overdue
    ${from}
    ORDER BY ${sortCol} ${dir}, r.id ${dir}
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, (page - 1) * pageSize);

  return { items: rows.map((r) => ({ ...r, is_overdue: !!r.is_overdue })), total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

function getRequestDetail(db, id, actor) {
  const r = db.prepare(`
    SELECT r.*, c.name AS category, c.is_blocker,
           cu.full_name AS candidate_name, cu.email AS candidate_email, cu.accessibility AS candidate_accessibility,
           au.full_name AS assignee_name, ${OVERDUE_SQL} AS is_overdue
    FROM requests r
    JOIN categories c ON c.id = r.category_id
    JOIN users cu ON cu.id = r.candidate_id
    LEFT JOIN users au ON au.id = r.assigned_to
    WHERE r.id = ?
  `).get(id);
  if (!r || (actor.role === 'candidate' && r.candidate_id !== actor.id)) throw notFound('Request not found');

  const messages = db.prepare(`
    SELECT m.id, m.body, m.is_internal, m.created_at, u.full_name AS author, u.role AS author_role, u.id AS author_id
    FROM request_messages m JOIN users u ON u.id = m.author_id
    WHERE m.request_id = ? ${actor.role === 'candidate' ? 'AND m.is_internal = 0' : ''}
    ORDER BY m.id ASC
  `).all(id);

  if (actor.role === 'candidate') { delete r.candidate_email; delete r.candidate_accessibility; }
  else r.candidate_accessibility = JSON.parse(r.candidate_accessibility || '{}');
  return {
    request: { ...r, is_overdue: !!r.is_overdue, is_blocker: !!r.is_blocker },
    messages: messages.map((m) => ({ ...m, is_internal: !!m.is_internal })),
    allowedNext: allowedNext(r.status, actor.role),
  };
}

module.exports = { createRequest, listRequests, getRequestDetail };
