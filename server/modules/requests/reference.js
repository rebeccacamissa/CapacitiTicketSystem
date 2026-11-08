'use strict';
/**
 * Unique reference generator: REQ-<YEAR>-<NNNN>
 * Owner: Member B
 * Must run inside the same transaction as the INSERT so the counter and the
 * request commit (or roll back) together — no gaps or duplicates under concurrency.
 */
function nextReference(db, now = new Date()) {
  const year = now.getUTCFullYear();
  const { last_value } = db.prepare(`
    INSERT INTO reference_counters (year, last_value) VALUES (?, 1)
    ON CONFLICT(year) DO UPDATE SET last_value = last_value + 1
    RETURNING last_value
  `).get(year);
  return `REQ-${year}-${String(last_value).padStart(4, '0')}`;
}

module.exports = { nextReference };
