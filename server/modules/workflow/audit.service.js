'use strict';
/**
 * Audit trail / activity history engine (append-only — see triggers in schema.sql).
 * Owner: Member C
 */

function writeAudit(db, { requestId, userId, action, oldStatus = null, newStatus = null, details = null, internalNotes = null, isOverride = false }) {
  db.prepare(`
    INSERT INTO audit_log (request_id, changed_by_user_id, action, old_status, new_status, details, internal_notes, is_override)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(requestId, userId, action, oldStatus, newStatus, details, internalNotes, isOverride ? 1 : 0);
}

/** Staff see everything; candidates see the timeline without internal notes or staff-only detail. */
function getHistory(db, requestId, viewer) {
  const rows = db.prepare(`
    SELECT a.id, a.action, a.old_status, a.new_status, a.details, a.internal_notes, a.is_override, a.timestamp,
           u.full_name AS changed_by, u.role AS changed_by_role
    FROM audit_log a JOIN users u ON u.id = a.changed_by_user_id
    WHERE a.request_id = ?
    ORDER BY a.id ASC
  `).all(requestId);

  if (viewer.role !== 'candidate') return rows;
  return rows
    .filter((r) => r.action === 'CREATED' || r.action === 'STATUS_CHANGE')
    .map(({ internal_notes, details, is_override, ...rest }) => rest);
}

module.exports = { writeAudit, getHistory };
