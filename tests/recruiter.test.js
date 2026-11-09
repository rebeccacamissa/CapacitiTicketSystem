'use strict';
process.env.NODE_ENV = 'test';
process.env.BCRYPT_ROUNDS = '4';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const { openDatabase, setDb } = require('../server/db/connection');

const db = openDatabase(':memory:');
setDb(db);
const { createApp } = require('../server/app');
let server, base;
const cookies = {};
const ids = {};

async function call(who, method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookies[who] ? { Cookie: cookies[who] } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const cookie = response.headers.get('set-cookie');
  if (cookie) cookies[who] = cookie.split(';')[0];
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function addUser(name, email, role) {
  return Number(db.prepare('INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name, email, bcrypt.hashSync('Passw0rd!', 4), role).lastInsertRowid);
}

before(async () => {
  ids.recruiter = addUser('Recruiter User', 'recruiter@test.example', 'recruiter');
  ids.candidate = addUser('Candidate User', 'candidate@test.example', 'candidate');
  ids.support = addUser('Support User', 'support@test.example', 'support');
  db.prepare('INSERT INTO candidate_profiles (user_id, stream, cohort) VALUES (?, ?, ?)')
    .run(ids.candidate, 'Software Development', 'Test cohort');
  const requirement = db.prepare(`
    SELECT mr.id FROM milestone_requirements mr
    JOIN milestones m ON m.id = mr.milestone_id
    ORDER BY m.sort_order, mr.sort_order LIMIT 1
  `).get();
  db.prepare('INSERT INTO candidate_requirement_progress (candidate_id, requirement_id, verified_by) VALUES (?, ?, ?)')
    .run(ids.candidate, requirement.id, ids.support);

  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  for (const [user, email] of [
    ['recruiter', 'recruiter@test.example'],
    ['candidate', 'candidate@test.example'],
    ['support', 'support@test.example'],
  ]) {
    const response = await call(user, 'POST', '/auth/login', { email, password: 'Passw0rd!' });
    assert.equal(response.status, 200);
  }
});

after(() => server.close());

test('existing database user roles migrate without breaking candidate references', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'capaciti-role-migration-'));
  const dbPath = path.join(directory, 'legacy.db');
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'candidate'
        CHECK (role IN ('candidate', 'support', 'admin')),
      is_active INTEGER NOT NULL DEFAULT 1, first_name TEXT, surname TEXT, date_of_birth TEXT,
      gender TEXT NOT NULL DEFAULT 'prefer-not', avatar_config TEXT, preferences TEXT NOT NULL DEFAULT '{}',
      tour_done INTEGER NOT NULL DEFAULT 0, accessibility TEXT NOT NULL DEFAULT '{}',
      language TEXT NOT NULL DEFAULT 'en', must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE candidate_profiles (user_id INTEGER PRIMARY KEY REFERENCES users(id), stream TEXT);
    CREATE TRIGGER legacy_candidate_user_lookup AFTER INSERT ON candidate_profiles
      BEGIN SELECT COUNT(*) FROM users; END;
    INSERT INTO users (full_name, email, password_hash, role) VALUES ('Legacy Candidate', 'legacy@test.example', 'hash', 'candidate');
    INSERT INTO candidate_profiles (user_id, stream) VALUES (1, 'Software Development');
  `);
  legacy.close();

  const migrated = openDatabase(dbPath);
  assert.equal(migrated.prepare("SELECT role FROM users WHERE email = 'legacy@test.example'").get().role, 'candidate');
  assert.equal(migrated.prepare("SELECT stream FROM candidate_profiles WHERE user_id = 1").get().stream, 'Software Development');
  assert.ok(migrated.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'legacy_candidate_user_lookup'").get());
  migrated.prepare(`
    INSERT INTO users (full_name, email, password_hash, role)
    VALUES ('New Recruiter', 'new-recruiter@test.example', 'hash', 'recruiter')
  `).run();
  assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(), []);
  migrated.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('recruiters see only published profiles and cannot access ticket or candidate-management APIs', async () => {
  const summary = await call('recruiter', 'GET', '/recruiter/summary');
  assert.equal(summary.status, 200);
  assert.equal(summary.body.visibleProfiles, 0);
  assert.equal((await call('recruiter', 'GET', '/recruiter/profiles/1')).status, 404);
  assert.equal((await call('recruiter', 'GET', '/requests')).status, 403);
  assert.equal((await call('recruiter', 'GET', '/workflow/rules')).status, 403);
  assert.equal((await call('recruiter', 'GET', '/search?q=Candidate')).status, 403);
  assert.equal((await call('recruiter', 'GET', '/people/birthdays')).status, 403);
  assert.equal((await call('candidate', 'GET', '/recruiter/talent')).status, 403);
});

test('candidates can publish their own portfolios and recruiters can read only the shared data', async () => {
  const privateDraft = await call('candidate', 'GET', '/recruiter/me');
  assert.equal(privateDraft.status, 200);
  assert.equal(privateDraft.body.portfolio.isPublished, false);

  const publish = await call('candidate', 'PATCH', '/recruiter/me', {
    isPublished: true,
    headline: 'Junior software developer',
    summary: 'Interested in accessible web applications.',
    skills: 'JavaScript, SQL, JavaScript',
    githubUrl: 'https://github.com/candidate',
  });
  assert.equal(publish.status, 200);
  assert.deepEqual(publish.body.portfolio.skills, ['JavaScript', 'SQL']);

  const project = await call('candidate', 'POST', '/recruiter/me/projects', {
    title: 'Accessible application',
    description: 'Built an accessible application prototype.',
    projectUrl: 'https://example.com/project',
    evidenceUrl: 'https://example.com/evidence',
  });
  assert.equal(project.status, 201);

  const board = await call('recruiter', 'GET', '/recruiter/talent?q=JavaScript&stream=Software%20Development');
  assert.equal(board.status, 200);
  assert.equal(board.body.candidates.length, 1);
  assert.equal(board.body.candidates[0].fullName, 'Candidate User');
  assert.equal(board.body.candidates[0].stage, 'screening');

  const profile = await call('recruiter', 'GET', `/recruiter/profiles/${ids.candidate}`);
  assert.equal(profile.status, 200);
  assert.equal(profile.body.profile.email, 'candidate@test.example');
  assert.equal(profile.body.profile.verifiedCredentials.length, 1);
  assert.equal(profile.body.profile.verifiedCredentials[0].verifiedBy, 'Support User');
  assert.equal(profile.body.profile.projects.length, 1);

  const rejectedLink = await call('candidate', 'PATCH', '/recruiter/me', { cvUrl: 'javascript:alert(1)' });
  assert.equal(rejectedLink.status, 400);
  assert.equal((await call('recruiter', 'PATCH', `/recruiter/profiles/${ids.candidate}`, { summary: 'Not allowed' })).status, 404);

  await call('candidate', 'PATCH', '/recruiter/me', { isPublished: false });
  assert.equal((await call('recruiter', 'GET', '/recruiter/summary')).body.visibleProfiles, 0);
  assert.equal((await call('recruiter', 'GET', `/recruiter/profiles/${ids.candidate}`)).status, 404);
});
