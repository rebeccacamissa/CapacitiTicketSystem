'use strict';
/**
 * One-off: copy data from the old SQLite database (data/capaciti.db + data/uploads)
 * into Postgres (DATABASE_URL, e.g. Neon; or the embedded PGlite database).
 *
 *   node scripts/sqlite-to-postgres.js [path/to/capaciti.db] [path/to/uploads]
 *
 * The target must be empty (no users). Ids are preserved. Uploaded files are copied
 * into the database. Older databases with the five original milestones are mapped
 * onto the stage-aligned checklist by requirement label, and candidates without an
 * official stage get one from their evidence, recorded as a system "initial" decision.
 * Business-rule triggers are paused only for the duration of the copy transaction.
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { initDb } = require('../server/db/connection');

const SRC = path.resolve(process.argv[2] || path.join(__dirname, '..', 'data', 'capaciti.db'));
const UPLOADS = path.resolve(process.argv[3] || path.join(__dirname, '..', 'data', 'uploads'));

// Copy order respects foreign keys.
const TABLES = [
  'users', 'candidate_profiles', 'staff_profiles', 'facilitator_streams', 'categories', 'requests', 'request_messages', 'audit_log',
  'request_ratings', 'attachments', 'reference_counters', 'xp_events', 'user_badges', 'feed_posts', 'feed_reactions',
  'candidate_portfolios', 'portfolio_items', 'portfolio_files', 'recruiter_shortlist', 'candidate_stages', 'stage_decisions',
];
const GUARDED = ['requests', 'audit_log', 'candidate_stages', 'stage_decisions'];

(async () => {
  if (!fs.existsSync(SRC)) throw new Error(`SQLite database not found: ${SRC}`);
  const src = new DatabaseSync(SRC, { readOnly: true });
  const has = (t) => !!src.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  const db = await initDb();
  if ((await db.one('SELECT COUNT(*) n FROM users')).n > 0) throw new Error('Target database already has users. Use an empty database.');

  const summary = {};
  await db.tx(async (t) => {
    for (const g of GUARDED) await t.exec(`ALTER TABLE ${g} DISABLE TRIGGER USER`);
    await t.run('DELETE FROM categories'); // replaced by the source's own categories (same ids)

    for (const table of TABLES) {
      if (!has(table)) continue;
      const srcCols = src.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
      const pgCols = (await t.all('SELECT column_name FROM information_schema.columns WHERE table_name = ?', table)).map((c) => c.column_name);
      const cols = srcCols.filter((c) => pgCols.includes(c));
      let rows = src.prepare(`SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM ${table}`).all();
      if (table === 'users') rows = rows.map((r) => ({ ...r, email: String(r.email).toLowerCase() }));
      for (const r of rows) {
        await t.run(`INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT DO NOTHING`, cols.map((c) => r[c]));
      }
      summary[table] = rows.length;
    }

    // Requirement progress: map old requirement ids to the current checklist by label.
    const oldReq = Object.fromEntries(src.prepare('SELECT id, label FROM milestone_requirements').all().map((r) => [r.id, r.label]));
    const newReq = Object.fromEntries((await t.all('SELECT id, label FROM milestone_requirements')).map((r) => [r.label, r.id]));
    let progress = 0;
    for (const p of src.prepare('SELECT * FROM candidate_requirement_progress').all()) {
      const id = newReq[oldReq[p.requirement_id]];
      if (!id) continue;
      await t.run('INSERT INTO candidate_requirement_progress (candidate_id, requirement_id, completed_at, verified_by) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', p.candidate_id, id, p.completed_at, p.verified_by);
      progress += 1;
    }
    summary.candidate_requirement_progress = progress;

    // File contents into the database.
    let blobs = 0;
    for (const [table, dir] of [['attachments', 'attachments'], ['portfolio_files', 'portfolio']]) {
      for (const { stored_name: name } of await t.all(`SELECT stored_name FROM ${table}`)) {
        const file = path.join(UPLOADS, dir, name);
        if (fs.existsSync(file)) { await t.run('INSERT INTO file_blobs (stored_name, data) VALUES (?, ?) ON CONFLICT DO NOTHING', name, fs.readFileSync(file)); blobs += 1; }
        else console.warn(`  missing file on disk: ${dir}/${name}`);
      }
    }
    summary.file_blobs = blobs;

    // Candidates without an official stage: derive from evidence (first stage with unmet exit criteria).
    const stages = await t.all(`SELECT m.key, COUNT(mr.id) total FROM milestones m LEFT JOIN milestone_requirements mr ON mr.milestone_id = m.id GROUP BY m.id ORDER BY m.sort_order`);
    let backfilled = 0;
    for (const { id } of await t.all("SELECT id FROM users WHERE role = 'candidate' AND id NOT IN (SELECT candidate_id FROM candidate_stages)")) {
      const done = Object.fromEntries((await t.all(`SELECT m.key, COUNT(*) n FROM candidate_requirement_progress p JOIN milestone_requirements mr ON mr.id = p.requirement_id
        JOIN milestones m ON m.id = mr.milestone_id WHERE p.candidate_id = ? GROUP BY m.key`, id)).map((r) => [r.key, r.n]));
      const stage = stages.find((s) => (done[s.key] || 0) < s.total)?.key || 'completed';
      if (stage === 'enrolled') continue;
      await t.run("INSERT INTO stage_decisions (candidate_id, from_stage, to_stage, direction, decided_by, reason) VALUES (?, NULL, ?, 'initial', NULL, 'Imported from verified requirement progress when official stages were introduced.')", id, stage);
      await t.run('INSERT INTO candidate_stages (candidate_id, stage) VALUES (?, ?)', id, stage);
      backfilled += 1;
    }
    summary.stages_backfilled = backfilled;

    // Continue identity sequences after the copied ids.
    for (const table of await t.all("SELECT table_name FROM information_schema.columns WHERE column_name = 'id' AND is_identity = 'YES' AND table_schema = current_schema()")) {
      await t.run(`SELECT setval(pg_get_serial_sequence('${table.table_name}', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM ${table.table_name}), 0), 1))`);
    }
    for (const g of GUARDED) await t.exec(`ALTER TABLE ${g} ENABLE TRIGGER USER`);
  });
  src.close();
  console.table(summary);
  console.log('Copy complete. Business-rule triggers are active again.');
  await db.close();
})().catch((e) => { console.error(`Copy failed (nothing was changed): ${e.message}`); process.exit(1); });
