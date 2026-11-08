'use strict';
/**
 * Transaction pipeline for every workflow mutation.
 * Owner: Member C
 *
 * Every status change runs as:
 *   BEGIN IMMEDIATE
 *     -> load + authorise
 *     -> application rule check (stateMachine.validateTransition)
 *     -> [admin override token]
 *     -> INSERT audit_log (STATUS_CHANGE)
 *     -> UPDATE requests  (DB trigger re-validates + verifies audit row)
 *     -> [public message]
 *   COMMIT   (any failure => ROLLBACK, nothing persists)
 */
const { transaction } = require('../../db/connection');
const { AppError, notFound, forbidden, badRequest, conflict } = require('../../utils/AppError');
const { validateTransition, PRIORITIES } = require('./stateMachine');
const { writeAudit } = require('./audit.service');

function loadRequest(db, requestId, actor) {
  const req = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
  // Candidates get 404 (not 403) for other people's requests — don't leak existence.
  if (!req || (actor.role === 'candidate' && req.candidate_id !== actor.id)) throw notFound('Request not found');
  return req;
}

function getStaff(db, userId) {
  return db.prepare("SELECT id, full_name FROM users WHERE id = ? AND role IN ('support','admin') AND is_active = 1").get(userId);
}

/** Core: apply one status transition. Must be called inside a transaction. */
function applyTransition(db, req, { toStatus, actor, note, message, resolution, assigneeId, override }) {
  const check = validateTransition({ from: req.status, to: toStatus, role: actor.role, override });
  if (!check.ok) {
    throw conflict(check.code, check.message, {
      enforcedBy: 'application', from: req.status, to: toStatus, allowed: check.allowed,
    });
  }

  let newAssignee = req.assigned_to;
  if (assigneeId !== undefined && assigneeId !== null && actor.role !== 'candidate') {
    if (!getStaff(db, assigneeId)) throw badRequest('Assignee must be an active support or admin user');
    newAssignee = assigneeId;
  }
  if (toStatus === 'Assigned' && !newAssignee) newAssignee = actor.id; // "assign to me"

  if (toStatus === 'Resolved' && !(resolution && resolution.trim())) {
    throw badRequest('A resolution summary is required to resolve a request', { fields: { resolution: 'Resolution is required' } });
  }

  if (newAssignee !== req.assigned_to) {
    const staff = getStaff(db, newAssignee);
    writeAudit(db, { requestId: req.id, userId: actor.id, action: 'ASSIGNMENT', details: `Assigned to ${staff.full_name}` });
  }

  if (check.override) {
    db.prepare('INSERT OR REPLACE INTO transition_overrides (request_id, to_status, authorized_by) VALUES (?, ?, ?)')
      .run(req.id, toStatus, actor.id);
  }

  // Audit row is written immediately BEFORE the update — the DB trigger requires it.
  writeAudit(db, {
    requestId: req.id, userId: actor.id, action: 'STATUS_CHANGE',
    oldStatus: req.status, newStatus: toStatus,
    internalNotes: actor.role === 'candidate' ? null : (note || null),
    details: check.override ? 'Administrator override' : null,
    isOverride: check.override,
  });

  db.prepare(`
    UPDATE requests SET
      status      = ?,
      assigned_to = ?,
      resolution  = CASE WHEN ? IS NOT NULL THEN ? ELSE resolution END,
      resolved_at = CASE WHEN ? = 'Resolved' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now')
                         WHEN ? = 'Reopened' THEN NULL ELSE resolved_at END,
      closed_at   = CASE WHEN ? = 'Closed'   THEN strftime('%Y-%m-%dT%H:%M:%fZ','now')
                         WHEN ? = 'Reopened' THEN NULL ELSE closed_at END,
      updated_at  = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ?
  `).run(toStatus, newAssignee, resolution || null, resolution || null,
    toStatus, toStatus, toStatus, toStatus, req.id);

  if (message && message.trim()) {
    db.prepare('INSERT INTO request_messages (request_id, author_id, body, is_internal) VALUES (?, ?, ?, 0)')
      .run(req.id, actor.id, message.trim());
  }
}

function transitionStatus(db, requestId, opts) {
  return transaction(db, () => {
    const req = loadRequest(db, requestId, opts.actor);
    if (opts.override && opts.actor.role !== 'admin') throw forbidden('Only administrators can override the workflow');
    applyTransition(db, req, opts);
    return db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
  });
}

/** Assign/reassign. If the request is Open/Reopened, assignment also moves it to "Assigned". */
function assignRequest(db, requestId, { assigneeId, actor, note }) {
  return transaction(db, () => {
    const req = loadRequest(db, requestId, actor);
    const staff = getStaff(db, assigneeId);
    if (!staff) throw badRequest('Assignee must be an active support or admin user');

    if (req.status === 'Open' || req.status === 'Reopened') {
      applyTransition(db, req, { toStatus: 'Assigned', actor, note, assigneeId });
    } else if (['Resolved', 'Closed'].includes(req.status)) {
      throw conflict('REQUEST_FINALISED', `Cannot reassign a request that is ${req.status}. Reopen it first.`);
    } else {
      if (req.assigned_to === assigneeId) return req;
      writeAudit(db, { requestId, userId: actor.id, action: 'ASSIGNMENT', details: `Reassigned to ${staff.full_name}`, internalNotes: note || null });
      db.prepare("UPDATE requests SET assigned_to = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
        .run(assigneeId, requestId);
    }
    return db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
  });
}

/** Priority change recalculates the SLA due date from the original creation time. */
function changePriority(db, requestId, { priority, actor, note }) {
  if (!PRIORITIES.includes(priority)) throw badRequest('Invalid priority');
  return transaction(db, () => {
    const req = loadRequest(db, requestId, actor);
    if (req.priority === priority) return req;
    writeAudit(db, {
      requestId, userId: actor.id, action: 'PRIORITY_CHANGE',
      details: `Priority ${req.priority} → ${priority}`, internalNotes: note || null,
    });
    db.prepare(`
      UPDATE requests SET priority = ?,
        due_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+' || (SELECT hours FROM priority_sla WHERE priority = ?) || ' hours'),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?
    `).run(priority, priority, requestId);
    return db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
  });
}

/**
 * Candidate/staff reply. A candidate reply on a "Waiting for Candidate" request
 * automatically moves it back to "In Progress" — through the same pipeline.
 */
function addMessage(db, requestId, { actor, body, isInternal }) {
  return transaction(db, () => {
    const req = loadRequest(db, requestId, actor);
    const internal = actor.role !== 'candidate' && isInternal ? 1 : 0;
    if (req.status === 'Closed' && actor.role === 'candidate') {
      throw conflict('REQUEST_CLOSED', 'This request is closed. Reopen it to continue the conversation.');
    }
    db.prepare('INSERT INTO request_messages (request_id, author_id, body, is_internal) VALUES (?, ?, ?, ?)')
      .run(requestId, actor.id, body, internal);

    let autoTransitioned = false;
    if (actor.role === 'candidate' && req.status === 'Waiting for Candidate') {
      applyTransition(db, req, { toStatus: 'In Progress', actor });
      autoTransitioned = true;
    } else {
      db.prepare("UPDATE requests SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(requestId);
    }
    return { autoTransitioned };
  });
}

/**
 * DIAGNOSTIC: bypasses the application validator entirely and issues raw SQL,
 * proving the database itself blocks illegal transitions. Always rolled back.
 */
function dbProbe(db, requestId, { toStatus, actor, withAudit }) {
  const req = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
  if (!req) throw notFound('Request not found');
  db.exec('BEGIN IMMEDIATE TRANSACTION;');
  try {
    if (withAudit) {
      writeAudit(db, { requestId, userId: actor.id, action: 'STATUS_CHANGE', oldStatus: req.status, newStatus: toStatus, details: 'db-probe' });
    }
    db.prepare('UPDATE requests SET status = ? WHERE id = ?').run(toStatus, requestId);
    return { accepted: true, from: req.status, to: toStatus };
  } catch (err) {
    return { accepted: false, from: req.status, to: toStatus, sqliteError: err.message };
  } finally {
    db.exec('ROLLBACK;'); // probe never persists anything
  }
}

module.exports = { transitionStatus, assignRequest, changePriority, addMessage, dbProbe, loadRequest, AppError };
