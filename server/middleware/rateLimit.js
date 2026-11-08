'use strict';
/** Minimal in-memory fixed-window rate limiter (per IP + route). Swap for Redis-backed in multi-instance deployments. */
const { AppError } = require('../utils/AppError');

function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();

  return (req, res, next) => {
    if (process.env.NODE_ENV === 'test') return next();
    const key = `${req.ip}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.reset < now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      return next(new AppError(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.'));
    }
    next();
  };
}

module.exports = { rateLimit };
