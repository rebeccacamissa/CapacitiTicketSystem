'use strict';
/**
 * Postgres connection layer.
 *
 *  - DATABASE_URL set (production, e.g. Neon): a `pg` connection pool.
 *  - Not set (local development and tests): PGlite, a real Postgres engine running
 *    in-process. Data is kept in PGLITE_DIR (default ./data/pglite), or in memory.
 *
 * Every query uses `?` placeholders (converted to $1, $2… here) and returns plain
 * rows. All writes that must happen together go through `db.tx(async (t) => …)`.
 * Business rules (the ticket state machine, stage decisions, audit immutability)
 * are enforced by triggers in schema.sql, exactly as before.
 * Owner: Member C
 */
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

/** Convert `?` placeholders to `$n`, skipping quoted strings and identifiers. */
function toPg(sql) {
  let out = '';
  let n = 0;
  let quote = null;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (quote) {
      out += ch;
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
    } else if (ch === '?') {
      n += 1;
      out += `$${n}`;
    } else {
      out += ch;
    }
  }
  return out;
}

const flat = (params) => (params.length === 1 && Array.isArray(params[0]) ? params[0] : params);

/** Wrap a low-level `query(text, values)` function in the app's small query API. */
function wrap(query, extra = {}) {
  const api = {
    /** All rows. */
    async all(sql, ...params) { return (await query(toPg(sql), flat(params))).rows; },
    /** First row or undefined. */
    async one(sql, ...params) { return (await query(toPg(sql), flat(params))).rows[0]; },
    /** Write; returns { changes, rows } (use RETURNING to get ids back). */
    async run(sql, ...params) {
      const r = await query(toPg(sql), flat(params));
      return { changes: r.rowCount ?? r.affectedRows ?? 0, rows: r.rows };
    },
    /** Insert … RETURNING id, returning the id. */
    async insert(sql, ...params) {
      const r = await query(`${toPg(sql)} RETURNING id`, flat(params));
      return r.rows[0].id;
    },
    ...extra,
  };
  return api;
}

const TYPE_PARSERS = {
  20: (v) => (v === null ? null : Number(v)), // int8 (COUNT, SUM) -> number
  1700: (v) => (v === null ? null : Number(v)), // numeric (AVG, ROUND) -> number
};

async function createPglite(dataDir) {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const pg = new PGlite(dataDir || undefined, { parsers: TYPE_PARSERS });
  await pg.waitReady;
  const query = (text, values) => pg.query(text, values);
  const db = wrap(query, {
    kind: 'pglite',
    async exec(sql) { await pg.exec(sql); },
    async tx(fn) {
      return pg.transaction(async (raw) => {
        const t = wrap((text, values) => raw.query(text, values), { kind: 'pglite', inTx: true, exec: (sql) => raw.exec(sql) });
        t.tx = (inner) => inner(t); // nested tx() calls reuse the open transaction
        return fn(t);
      });
    },
    async close() { await pg.close(); },
  });
  return db;
}

async function createPool(url) {
  const pgLib = require('pg');
  pgLib.types.setTypeParser(20, TYPE_PARSERS[20]);
  pgLib.types.setTypeParser(1700, TYPE_PARSERS[1700]);
  const local = /localhost|127\.0\.0\.1/.test(url);
  const pool = new pgLib.Pool({ connectionString: url, max: 10, ssl: local ? false : { rejectUnauthorized: false } });
  pool.on('error', (err) => console.error('[db] idle client error', err.message));
  const db = wrap((text, values) => pool.query(text, values), {
    kind: 'postgres',
    async exec(sql) { await pool.query(sql); },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const t = wrap((text, values) => client.query(text, values), { kind: 'postgres', inTx: true, exec: (sql) => client.query(sql) });
        t.tx = (inner) => inner(t);
        const out = await fn(t);
        await client.query('COMMIT');
        return out;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    async close() { await pool.end(); },
  });
  return db;
}

/**
 * Open a database and apply the (idempotent) schema.
 * @param {{ url?: string, dir?: string, memory?: boolean }} opts
 */
async function openDatabase({ url, dir, memory } = {}) {
  const db = url ? await createPool(url) : await createPglite(memory ? null : dir);
  // Serialise schema setup across instances starting at the same time (Postgres advisory lock).
  await db.tx(async (t) => {
    await t.run('SELECT pg_advisory_xact_lock(424242)');
    await t.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  });
  return db;
}

/** Run fn inside a transaction (kept for older call sites). */
const transaction = (db, fn) => db.tx(fn);

let instance = null;

async function initDb() {
  if (instance) return instance;
  const { databaseUrl, pgliteDir } = require('../config/env');
  instance = await openDatabase({ url: databaseUrl || undefined, dir: pgliteDir });
  return instance;
}

function getDb() {
  if (!instance) throw new Error('Database not initialised: call await initDb() first');
  return instance;
}

/** Tests inject their own (in-memory) database. */
function setDb(db) { instance = db; }

module.exports = { openDatabase, initDb, getDb, setDb, transaction, toPg };
