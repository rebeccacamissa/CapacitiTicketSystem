'use strict';
/**
 * Demonstrates that the PostgreSQL trigger layer blocks illegal changes even when
 * the application validator is bypassed entirely (raw SQL): the ticket state
 * machine, the audit log, and the official programme stages.
 *   npm run demo:illegal
 */
const { openDatabase } = require('../server/db/connection');
const { createRequest } = require('../server/modules/requests/requests.service');

(async () => {
  const db = await openDatabase({ memory: true });
  const uid = (role) => db.insert("INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, 'x', ?)", `${role} user`, `${role}@demo.test`, role);
  const candidate = { id: await uid('candidate'), role: 'candidate' };
  const admin = await uid('admin');
  const support = await uid('support');
  await db.run("INSERT INTO candidate_profiles (user_id, stream) VALUES (?, 'Software Development')", candidate.id);
  const catId = (await db.one('SELECT id FROM categories LIMIT 1')).id;
  const r = await createRequest(db, { actor: candidate, title: 'Demo request', description: 'Demonstrating DB enforcement', categoryId: catId, priority: 'Medium' });

  const ROLLBACK = Symbol('rollback');
  async function attempt(label, fn) {
    try {
      await db.tx(async (t) => { await fn(t); throw ROLLBACK; });
    } catch (e) {
      if (e === ROLLBACK) { console.log(`  ✔ ${label}: accepted (rolled back)`); return; }
      console.log(`  ✘ ${label}: BLOCKED → ${e.message}`);
    }
  }

  console.log(`\nRequest ${r.reference} is "${r.status}". Raw SQL, no application code:\n`);
  await attempt('Open → Closed (illegal jump)', (t) => t.run("UPDATE requests SET status = 'Closed' WHERE id = ?", r.id));
  await attempt('Open → Resolved (illegal jump)', (t) => t.run("UPDATE requests SET status = 'Resolved', resolution = 'x' WHERE id = ?", r.id));
  await attempt('Open → Assigned (audited) but no assignee', async (t) => {
    await t.run("INSERT INTO audit_log (request_id, changed_by_user_id, action, old_status, new_status) VALUES (?, ?, 'STATUS_CHANGE', 'Open', 'Assigned')", r.id, admin);
    await t.run("UPDATE requests SET status = 'Assigned' WHERE id = ?", r.id);
  });
  await attempt('Open → Assigned with assignee but NO audit row', (t) => t.run("UPDATE requests SET status = 'Assigned', assigned_to = ? WHERE id = ?", admin, r.id));
  await attempt('Tamper with audit_log', (t) => t.run("UPDATE audit_log SET new_status = 'Closed' WHERE request_id = ?", r.id));
  await attempt('Delete audit_log', (t) => t.run('DELETE FROM audit_log WHERE request_id = ?', r.id));

  console.log('\nWith audit row + assignee (legal path):');
  await db.tx(async (t) => {
    await t.run("INSERT INTO audit_log (request_id, changed_by_user_id, action, old_status, new_status) VALUES (?, ?, 'STATUS_CHANGE', 'Open', 'Assigned')", r.id, admin);
    await t.run("UPDATE requests SET status = 'Assigned', assigned_to = ? WHERE id = ?", admin, r.id);
  });
  console.log(`  ✔ Open → Assigned: accepted (status now "${(await db.one('SELECT status FROM requests WHERE id = ?', r.id)).status}")`);

  console.log('\nOfficial programme stages (candidate is Enrolled):\n');
  const decision = (t, from, to, dir, by) => t.run("INSERT INTO stage_decisions (candidate_id, from_stage, to_stage, direction, decided_by, reason) VALUES (?, ?, ?, ?, ?, 'demo reason')", candidate.id, from, to, dir, by);
  await attempt('Set stage to Placed with no decision', (t) => t.run("INSERT INTO candidate_stages (candidate_id, stage) VALUES (?, 'placed')", candidate.id));
  await attempt('Decision Enrolled → Placed (skips stages)', (t) => decision(t, 'enrolled', 'placed', 'forward', admin));
  await attempt('Decision Enrolled → Enrolled (same stage)', (t) => decision(t, 'enrolled', 'enrolled', 'forward', admin));
  await attempt('Support staff approve a stage', (t) => decision(t, 'enrolled', 'training', 'forward', support));
  await attempt('Admin: Enrolled → In Training (legal)', async (t) => {
    await decision(t, 'enrolled', 'training', 'forward', admin);
    await t.run("INSERT INTO candidate_stages (candidate_id, stage) VALUES (?, 'training')", candidate.id);
  });
  console.log('');
  await db.close();
})().catch((e) => { console.error(e); process.exit(1); });
