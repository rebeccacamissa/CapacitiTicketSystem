'use strict';

class AppError extends Error {
  /**
   * @param {number} status  HTTP status
   * @param {string} code    Stable machine-readable error code
   * @param {string} message Human-readable message
   * @param {object} [details]
   */
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (msg, details) => new AppError(400, 'VALIDATION_ERROR', msg, details);
const unauthorized = (msg = 'Authentication required') => new AppError(401, 'UNAUTHENTICATED', msg);
const forbidden = (msg = 'You do not have permission to do that') => new AppError(403, 'FORBIDDEN', msg);
const notFound = (msg = 'Not found') => new AppError(404, 'NOT_FOUND', msg);
const conflict = (code, msg, details) => new AppError(409, code, msg, details);

/**
 * Map SQLite RAISE(ABORT, 'CODE: message') errors from our triggers to API errors.
 * This is how DB-level enforcement surfaces to clients.
 */
const DB_ERROR_CODES = {
  ILLEGAL_TRANSITION: 409,
  ASSIGNEE_REQUIRED: 409,
  RESOLUTION_REQUIRED: 409,
  AUDIT_REQUIRED: 409,
  INVALID_ASSIGNEE: 409,
  AUDIT_LOG_IMMUTABLE: 409,
};

function fromDbError(err) {
  const msg = String(err && err.message);
  const match = msg.match(/\b([A-Z_]+): (.+)$/m);
  if (match && DB_ERROR_CODES[match[1]]) {
    return new AppError(DB_ERROR_CODES[match[1]], `DB_${match[1]}`, match[2], {
      enforcedBy: 'database-trigger',
    });
  }
  if (/UNIQUE constraint failed/.test(msg)) return conflict('DUPLICATE', 'That record already exists');
  if (/FOREIGN KEY constraint failed/.test(msg)) return badRequest('A referenced record does not exist');
  if (/CHECK constraint failed/.test(msg)) return badRequest('A field failed database validation');
  return null;
}

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict, fromDbError };
