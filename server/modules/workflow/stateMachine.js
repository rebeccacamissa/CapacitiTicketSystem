'use strict';
/**
 * Application-level state machine rules (mirrors the DB whitelist in schema.sql).
 * Owner: Member C
 *
 * Two layers of enforcement:
 *   1. validateTransition() here — gives clear, role-aware 409 errors.
 *   2. trg_requests_status_guard in SQLite — the final authority; cannot be bypassed.
 */

const STATUSES = Object.freeze([
  'Open', 'Assigned', 'In Progress', 'Waiting for Candidate', 'Resolved', 'Closed', 'Reopened',
]);

const TRANSITIONS = Object.freeze({
  'Open': ['Assigned'],
  'Assigned': ['In Progress'],
  'In Progress': ['Waiting for Candidate', 'Resolved'],
  'Waiting for Candidate': ['In Progress', 'Resolved'],
  'Resolved': ['Closed', 'Reopened'],
  'Closed': ['Reopened'],
  'Reopened': ['Assigned', 'In Progress'],
});

/** Candidates may only make these moves on their OWN requests. */
const CANDIDATE_TRANSITIONS = Object.freeze({
  'Waiting for Candidate': ['In Progress'], // happens automatically when they reply
  'Resolved': ['Closed', 'Reopened'],       // accept or dispute the resolution
  'Closed': ['Reopened'],
});

const PRIORITIES = Object.freeze(['Low', 'Medium', 'High', 'Urgent']);
const ACTIVE_STATUSES = Object.freeze(['Open', 'Assigned', 'In Progress', 'Waiting for Candidate', 'Reopened']);

function allowedNext(from, role) {
  if (role === 'candidate') return [...(CANDIDATE_TRANSITIONS[from] || [])];
  return [...(TRANSITIONS[from] || [])];
}

/**
 * @returns {{ ok: true, override: boolean } | { ok: false, code: string, message: string, allowed: string[] }}
 */
function validateTransition({ from, to, role, override = false }) {
  if (!STATUSES.includes(to)) {
    return { ok: false, code: 'UNKNOWN_STATUS', message: `"${to}" is not a valid status`, allowed: allowedNext(from, role) };
  }
  if (from === to) {
    return { ok: false, code: 'NO_CHANGE', message: `Request is already "${to}"`, allowed: allowedNext(from, role) };
  }
  const allowed = allowedNext(from, role);
  if (allowed.includes(to)) return { ok: true, override: false };

  if (override && role === 'admin') return { ok: true, override: true };

  return {
    ok: false,
    code: 'ILLEGAL_STATUS_TRANSITION',
    message: `Cannot move a request from "${from}" to "${to}".` +
      (allowed.length ? ` Allowed next: ${allowed.join(', ')}.` : ' No further moves are available to you.') +
      (role === 'admin' ? ' Admins may apply an explicit override.' : ''),
    allowed,
  };
}

module.exports = {
  STATUSES, TRANSITIONS, CANDIDATE_TRANSITIONS, PRIORITIES, ACTIVE_STATUSES,
  allowedNext, validateTransition,
};
