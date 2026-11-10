'use strict';
/**
 * Transaction pipeline for every workflow mutation.
 * Owner: Member C
 *
 * Every status change runs as:
 *   BEGIN
 *     -> load + lock the request row (SELECT … FOR UPDATE: concurrent changes serialise)
 *     -> authorise + application rule check (stateMachine.validateTransition)
 *     -> [admin override token]
 *     -> INSERT audit_log (STATUS_CHANGE)
 *     -> UPDATE requests  (DB trigger re-validates + verifies audit row)
 *     -> [public message]
 *   COMMIT   (any failure => ROLLBACK, nothing persists)
 */
const { AppError, notFound, forbidden, badRequest, conflict } = require('../../utils/AppError');
const { validateTransition, PRIORITIES } = require('./stateMachine');
const { writeAudit } = require('./audit.service');
const email = require('../../services/email');

async function loadRequest(db, requestId, actor, { lock = false } = {}) {
  const req = await db.one(`SELECT * FROM requests WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, requestId);
  // Candidates get 404 (not 403) for other people's requests — don't leak existence.
  if (!req || (actor.role === 'candidate' && req.candidate_id !== actor.id)) throw notFound('Request not found');
  return req;
}

async function getStaff(db, userId) {
  return db.one("SELECT id, full_name FROM users WHERE id = ? AND role IN ('support','admin') AND is_active = 1", userId);
}

/** Core: apply one status transition. Must be called inside a transaction. */
async function applyTransition(db, req, { toStatus, actor, note, message, resolution, assigneeId, override }) {
  const check = validateTransition({ from: req.status, to: toStatus, role: actor.role, override });
  if (!check.ok) {
    throw conflict(check.code, check.message, {
      enforcedBy: 'application', from: req.status, to: toStatus, allowed: check.allowed,
    });
  }

  let newAssignee = req.assigned_to;
  if (assigneeId !== undefined && assigneeId !== null && actor.role !== 'candidate') {
    if (!await getStaff(db, assigneeId)) throw badRequest('Assignee must be an active support or admin user');
    newAssignee = assigneeId;
  }
  if (toStatus === 'Assigned' && !newAssignee) newAssignee = actor.id; // "assign to me"

  if (toStatus === 'Resolved' && !(resolution && resolution.trim())) {
    throw badRequest('A resolution summary is required to resolve a request', { fields: { resolution: 'Resolution is required' } });
  }

  if (newAssignee !== req.assigned_to) {
    const staff = await getStaff(db, newAssignee);
    await writeAudit(db, { requestId: req.id, userId: actor.id, action: 'ASSIGNMENT', details: `Assigned to ${staff.full_name}` });
  }

  if (check.override) {
    await db.run(`INSERT INTO transition_overrides (request_id, to_status, authorized_by) VALUES (?, ?, ?)
      ON CONFLICT (request_id) DO UPDATE SET to_status = EXCLUDED.to_status, authorized_by = EXCLUDED.authorized_by, created_at = now_iso()`,
    req.id, toStatus, actor.id);
  }

  // Audit row is written immediately BEFORE the update — the DB trigger requires it.
  await writeAudit(db, {
    requestId: req.id, userId: actor.id, action: 'STATUS_CHANGE',
    oldStatus: req.status, newStatus: toStatus,
    internalNotes: actor.role === 'candidate' ? null : (note || null),
    details: check.override ? 'Administrator override' : null,
    isOverride: check.override,
  });

  await db.run(`
    UPDATE requests SET
      status      = ?,
      assigned_to = ?,
      resolution  = COALESCE(?, resolution),
      resolved_at = CASE WHEN ? = 'Resolved' THEN now_iso() WHEN ? = 'Reopened' THEN NULL ELSE resolved_at END,
      closed_at   = CASE WHEN ? = 'Closed'   THEN now_iso() WHEN ? = 'Reopened' THEN NULL ELSE closed_at END,
      updated_at  = now_iso()
    WHERE id = ?
  `, toStatus, newAssignee, resolution || null, toStatus, toStatus, toStatus, toStatus, req.id);

  if (message && message.trim()) {
    await db.run('INSERT INTO request_messages (request_id, author_id, body, is_internal) VALUES (?, ?, ?, 0)', req.id, actor.id, message.trim());
  }
}

/** Email the other party about a status change or reply (never for internal notes). */
async function notifyTicket(db, requestId, { actor, kind, text }) {
  const r = await db.one(`SELECT r.id, r.reference, r.title, r.status, r.candidate_id, r.assigned_to,
      c.email AS c_email, c.first_name AS c_first, a.email AS a_email
    FROM requests r JOIN users c ON c.id = r.candidate_id LEFT JOIN users a ON a.id = r.assigned_to WHERE r.id = ?`, requestId);
  if (!r) return;
  const toCandidate = actor.id !== r.candidate_id;
  const to = toCandidate ? r.c_email : r.a_email;
  if (!to) return;
  email.notify(db, {
    to,
    kind: `ticket_${kind}`,
    subject: kind === 'reply' ? `New reply on ${r.reference}` : `${r.reference} is now ${r.status}`,
    heading: kind === 'reply' ? `${actor.fullName} replied to ${r.reference}` : `${r.reference}: ${r.status}`,
    lines: [r.title, ...(text ? [text.length > 500 ? `${text.slice(0, 500)}…` : text] : []),
      ...(toCandidate && r.status === 'Waiting for Candidate' ? ['The support team is waiting for your reply.'] : [])],
    cta: { label: 'Open the request', href: email.link(`/request?id=${r.id}`) },
  });
}

async function transitionStatus(db, requestId, opts) {
  const out = await db.tx(async (t) => {
    const req = await loadRequest(t, requestId, opts.actor, { lock: true });
    if (opts.override && opts.actor.role !== 'admin') throw forbidden('Only administrators can override the workflow');
    await applyTransition(t, req, opts);
    return t.one('SELECT * FROM requests WHERE id = ?', requestId);
  });
  if (opts.notify !== false) await notifyTicket(db, requestId, { actor: opts.actor, kind: 'status', text: opts.message || (out.status === 'Resolved' ? out.resolution : '') });
  return out;
}

/** Assign/reassign. If the request is Open/Reopened, assignment also moves it to "Assigned". */
async function assignRequest(db, requestId, { assigneeId, actor, note }) {
  return db.tx(async (t) => {
    const req = await loadRequest(t, requestId, actor, { lock: true });
    const staff = await getStaff(t, assigneeId);
    if (!staff) throw badRequest('Assignee must be an active support or admin user');

    if (req.status === 'Open' || req.status === 'Reopened') {
      await applyTransition(t, req, { toStatus: 'Assigned', actor, note, assigneeId });
    } else if (['Resolved', 'Closed'].includes(req.status)) {
      throw conflict('REQUEST_FINALISED', `Cannot reassign a request that is ${req.status}. Reopen it first.`);
    } else {
      if (req.assigned_to === assigneeId) return req;
      await writeAudit(t, { requestId, userId: actor.id, action: 'ASSIGNMENT', details: `Reassigned to ${staff.full_name}`, internalNotes: note || null });
      await t.run('UPDATE requests SET assigned_to = ?, updated_at = now_iso() WHERE id = ?', assigneeId, requestId);
    }
    return t.one('SELECT * FROM requests WHERE id = ?', requestId);
  });
}

/** Priority change recalculates the SLA due date from the original creation time. */
async function changePriority(db, requestId, { priority, actor, note }) {
  if (!PRIORITIES.includes(priority)) throw badRequest('Invalid priority');
  return db.tx(async (t) => {
    const req = await loadRequest(t, requestId, actor, { lock: true });
    if (req.priority === priority) return req;
    await writeAudit(t, {
      requestId, userId: actor.id, action: 'PRIORITY_CHANGE',
      details: `Priority ${req.priority} → ${priority}`, internalNotes: note || null,
    });
    await t.run(`
      UPDATE requests SET priority = ?,
        due_at = iso_add(created_at, (SELECT hours FROM priority_sla WHERE priority = ?) || ' hours'),
        updated_at = now_iso()
      WHERE id = ?
    `, priority, priority, requestId);
    return t.one('SELECT * FROM requests WHERE id = ?', requestId);
  });
}

/**
 * Candidate/staff reply. A candidate reply on a "Waiting for Candidate" request
 * automatically moves it back to "In Progress" — through the same pipeline.
 */
async function addMessage(db, requestId, { actor, body, isInternal, notify = true }) {
  const internal = actor.role !== 'candidate' && isInternal ? 1 : 0;
  const out = await db.tx(async (t) => {
    const req = await loadRequest(t, requestId, actor, { lock: true });
    if (req.status === 'Closed' && actor.role === 'candidate') {
      throw conflict('REQUEST_CLOSED', 'This request is closed. Reopen it to continue the conversation.');
    }
    await t.run('INSERT INTO request_messages (request_id, author_id, body, is_internal) VALUES (?, ?, ?, ?)', requestId, actor.id, body, internal);

    let autoTransitioned = false;
    if (actor.role === 'candidate' && req.status === 'Waiting for Candidate') {
      await applyTransition(t, req, { toStatus: 'In Progress', actor });
      autoTransitioned = true;
    } else {
      await t.run('UPDATE requests SET updated_at = now_iso() WHERE id = ?', requestId);
    }
    return { autoTransitioned };
  });
  if (!internal && notify) await notifyTicket(db, requestId, { actor, kind: 'reply', text: body });
  return out;
}

/**
 * DIAGNOSTIC: bypasses the application validator entirely and issues raw SQL,
 * proving the database itself blocks illegal transitions. Always rolled back.
 */
const ROLLBACK = Symbol('probe-rollback');
async function dbProbe(db, requestId, { toStatus, actor, withAudit }) {
  const req = await db.one('SELECT * FROM requests WHERE id = ?', requestId);
  if (!req) throw notFound('Request not found');
  let result;
  try {
    await db.tx(async (t) => {
      try {
        if (withAudit) {
          await writeAudit(t, { requestId, userId: actor.id, action: 'STATUS_CHANGE', oldStatus: req.status, newStatus: toStatus, details: 'db-probe' });
        }
        await t.run('UPDATE requests SET status = ? WHERE id = ?', toStatus, requestId);
        result = { accepted: true, from: req.status, to: toStatus };
      } catch (err) {
        result = { accepted: false, from: req.status, to: toStatus, dbError: err.message };
      }
      throw ROLLBACK; // probe never persists anything
    });
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
  return result;
}

module.exports = { transitionStatus, assignRequest, changePriority, addMessage, dbProbe, loadRequest, AppError };
