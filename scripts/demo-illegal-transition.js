'use strict';
/**
 * Demonstrates that the SQLite trigger layer blocks illegal transitions even
 * when the application validator is bypassed entirely (raw SQL).
 *   npm run demo:illegal
 */
const { openDatabase } = require('../server/db/connection');
const { createRequest } = require('../server/modules/requests/requests.service');

const db = openDatabase(':memory:');
const uid = (role) => Number(db.prepare("INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, 'x', ?)")
  .run(`${role} user`, `${role}@demo.test`, role).lastInsertRowid);
const candidate = { id: uid('candidate'), role: 'candidate' };
const admin = uid('admin');
const catId = db.prepare('SELECT id FROM categories LIMIT 1').get().id;
const r = createRequest(db, { actor: candidate, title: 'Demo request', description: 'Demonstrating DB enforcement', categoryId: catId, priority: 'Medium' });

function attempt(label, sql, ...params) {
  try {
    db.exec('BEGIN');
    if (typeof sql === 'function') sql();
    else db.prepare(sql).run(...params);
    db.exec('ROLLBACK');
    console.log(`  ✔ ${label}: accepted`);
  } catch (e) {
    db.exec('ROLLBACK');
    console.log(`  ✘ ${label}: BLOCKED → ${e.message}`);
  }
}

console.log(`\nRequest ${r.reference} is "${r.status}". Raw SQL, no application code:\n`);
attempt('Open → Closed (illegal jump)', "UPDATE requests SET status = 'Closed' WHERE id = ?", r.id);
attempt('Open → Resolved (illegal jump)', "UPDATE requests SET status = 'Resolved', resolution = 'x' WHERE id = ?", r.id);
attempt('Open → Assigned (audited) but no assignee', () => {
  db.prepare("INSERT INTO audit_log (request_id, changed_by_user_id, action, old_status, new_status) VALUES (?, ?, 'STATUS_CHANGE', 'Open', 'Assigned')").run(r.id, admin);
  db.prepare("UPDATE requests SET status = 'Assigned' WHERE id = ?").run(r.id);
});
attempt('Open → Assigned with assignee but NO audit row', "UPDATE requests SET status = 'Assigned', assigned_to = ? WHERE id = ?", admin, r.id);
attempt('Tamper with audit_log', "UPDATE audit_log SET new_status = 'Closed' WHERE request_id = ?", r.id);
attempt('Delete audit_log', 'DELETE FROM audit_log WHERE request_id = ?', r.id);

console.log('\nWith audit row + assignee (legal path):');
db.exec('BEGIN');
db.prepare("INSERT INTO audit_log (request_id, changed_by_user_id, action, old_status, new_status) VALUES (?, ?, 'STATUS_CHANGE', 'Open', 'Assigned')").run(r.id, admin);
db.prepare("UPDATE requests SET status = 'Assigned', assigned_to = ? WHERE id = ?").run(admin, r.id);
db.exec('COMMIT');
console.log(`  ✔ Open → Assigned: accepted (status now "${db.prepare('SELECT status FROM requests WHERE id = ?').get(r.id).status}")\n`);
