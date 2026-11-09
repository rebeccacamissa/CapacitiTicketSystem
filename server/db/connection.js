'use strict';
/**
 * SQLite connection (Node's built-in node:sqlite — no native build required).
 * Owner: Member C
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

function migrateUserRoles(db) {
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  if (!table || table.sql.includes("'facilitator'")) return;

  const dependentTriggers = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND sql LIKE '%users%'").all();
  db.exec('PRAGMA foreign_keys = OFF;');
  for (const trigger of dependentTriggers) {
    db.prepare('DROP TRIGGER ' + `"${trigger.name.replace(/"/g, '""')}"`).run();
  }
  try {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE users_recruiter_migration (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name      TEXT    NOT NULL CHECK (length(trim(full_name)) BETWEEN 2 AND 120),
        email          TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        password_hash  TEXT    NOT NULL,
        role           TEXT    NOT NULL DEFAULT 'candidate'
                               CHECK (role IN ('candidate', 'support', 'admin', 'recruiter', 'facilitator')),
        is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        first_name     TEXT,
        surname        TEXT,
        date_of_birth  TEXT    CHECK (date_of_birth IS NULL OR date_of_birth GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
        gender         TEXT    NOT NULL DEFAULT 'prefer-not'
                               CHECK (gender IN ('female', 'male', 'non-binary', 'prefer-not')),
        avatar_config  TEXT    CHECK (avatar_config IS NULL OR json_valid(avatar_config)),
        preferences    TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(preferences)),
        tour_done      INTEGER NOT NULL DEFAULT 0 CHECK (tour_done IN (0, 1)),
        accessibility  TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(accessibility)),
        language       TEXT    NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'zu', 'xh', 'af', 'nso')),
        must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
        created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      INSERT INTO users_recruiter_migration
        SELECT id, full_name, email, password_hash, role, is_active, first_name, surname,
               date_of_birth, gender, avatar_config, preferences, tour_done, accessibility,
               language, must_change_password, created_at
        FROM users;
      DROP TABLE users;
      ALTER TABLE users_recruiter_migration RENAME TO users;
      COMMIT;
    `);
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK;');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
    for (const trigger of dependentTriggers) db.exec(trigger.sql);
  }
}

/**
 * Databases created before official stages existed had five milestones
 * (screening, onboarding, training, work_ready, placed). Re-key them in place to the
 * stage-aligned roadmap, keeping every candidate's verified requirement progress.
 * Returns true when it ran, so stages can be backfilled once the schema exists.
 */
function migrateMilestones(db) {
  const hasOld = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'milestones'").get()
    && db.prepare("SELECT 1 FROM milestones WHERE key = 'screening'").get();
  if (!hasOld) return false;
  const id = (key) => db.prepare('SELECT id FROM milestones WHERE key = ?').get(key)?.id;
  transaction(db, () => {
    const [screening, onboarding, training, workReady, placed] = ['screening', 'onboarding', 'training', 'work_ready', 'placed'].map(id);
    db.exec('UPDATE milestones SET sort_order = sort_order + 100;');
    // Screening + onboarding become "Enrolled" (onboarding requirements follow as items 5-8).
    db.prepare('UPDATE milestone_requirements SET milestone_id = ?, sort_order = sort_order + 4 WHERE milestone_id = ?').run(screening, onboarding);
    db.prepare('DELETE FROM milestones WHERE id = ?').run(onboarding);
    // Partner matching and the agreement are exit criteria of Work Ready; Placed keeps "First day".
    db.prepare("UPDATE milestone_requirements SET milestone_id = ?, sort_order = 4 WHERE milestone_id = ? AND label = 'Matched with a corporate partner'").run(workReady, placed);
    db.prepare("UPDATE milestone_requirements SET milestone_id = ?, sort_order = 5 WHERE milestone_id = ? AND label = 'Internship agreement signed'").run(workReady, placed);
    db.prepare("UPDATE milestone_requirements SET sort_order = 1 WHERE milestone_id = ? AND label = 'First day at host company'").run(placed);
    const set = db.prepare('UPDATE milestones SET key = ?, title = ?, description = ?, sort_order = ? WHERE id = ?');
    set.run('enrolled', 'Enrolled', 'You are accepted into a cohort and set up for training.', 1, screening);
    set.run('training', 'In Training', 'You attend training, complete modules and pass assessments.', 2, training);
    set.run('work_ready', 'Work Ready', 'You are prepared for the workplace and matched with a corporate partner.', 3, workReady);
    set.run('placed', 'Placed', 'You are on your internship with a corporate partner.', 4, placed);
    db.exec("UPDATE OR IGNORE user_badges SET badge_key = 'milestone_training' WHERE badge_key = 'milestone_onboarding';");
    db.exec("DELETE FROM user_badges WHERE badge_key IN ('milestone_screening', 'milestone_onboarding');");
  });
  return true;
}

/**
 * One-off: give existing candidates an official stage that matches the progress they
 * already had (first stage whose exit criteria are incomplete). Recorded as a system
 * 'initial' decision so the stage audit trail explains where it came from.
 */
function backfillStages(db) {
  const { stageFromEvidence } = require('../modules/stages/stage.rules');
  transaction(db, () => {
    const candidates = db.prepare("SELECT id FROM users WHERE role = 'candidate' AND id NOT IN (SELECT candidate_id FROM candidate_stages)").all();
    for (const { id } of candidates) {
      const stage = stageFromEvidence(db, id);
      if (stage === 'enrolled') continue;
      db.prepare("INSERT INTO stage_decisions (candidate_id, from_stage, to_stage, direction, decided_by, reason) VALUES (?, NULL, ?, 'initial', NULL, ?)")
        .run(id, stage, 'Imported from verified requirement progress when official stages were introduced.');
      db.prepare('INSERT INTO candidate_stages (candidate_id, stage) VALUES (?, ?)').run(id, stage);
    }
  });
}

function openDatabase(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  migrateUserRoles(db);
  const migrated = migrateMilestones(db);
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  if (migrated) backfillStages(db);
  return db;
}

/**
 * Run `fn` inside BEGIN IMMEDIATE ... COMMIT. Any thrown error triggers ROLLBACK.
 * IMMEDIATE takes the write lock up front, so concurrent transitions serialise.
 */
function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE TRANSACTION;');
  try {
    const result = fn();
    db.exec('COMMIT;');
    return result;
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK;');
    throw err;
  }
}

let instance = null;

function getDb() {
  if (!instance) {
    const { dbPath } = require('../config/env');
    instance = openDatabase(dbPath);
  }
  return instance;
}

/** Tests can inject an in-memory database. */
function setDb(db) {
  instance = db;
}

module.exports = { openDatabase, transaction, getDb, setDb };
