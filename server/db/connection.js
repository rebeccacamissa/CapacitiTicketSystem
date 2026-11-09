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
  if (!table || table.sql.includes("'recruiter'")) return;

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
                               CHECK (role IN ('candidate', 'support', 'admin', 'recruiter')),
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

function openDatabase(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  migrateUserRoles(db);
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
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
