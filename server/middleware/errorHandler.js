'use strict';
const { AppError, fromDbError } = require('../utils/AppError');
const { isProd } = require('../config/env');

function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let appErr = err instanceof AppError ? err : fromDbError(err);

  if (!appErr && err.type === 'entity.parse.failed') {
    appErr = new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON');
  }
  if (!appErr) {
    console.error('[unhandled]', err);
    appErr = new AppError(500, 'INTERNAL_ERROR', isProd ? 'Something went wrong' : err.message);
  }

  const body = { error: { code: appErr.code, message: appErr.message } };
  if (appErr.details) body.error.details = appErr.details;
  res.status(appErr.status).json(body);
}

module.exports = { notFoundHandler, errorHandler };
