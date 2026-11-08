'use strict';
/**
 * SQLite connection (Node's built-in node:sqlite — no native build required).
 * Owner: Member C
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

function openDatabase(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
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
