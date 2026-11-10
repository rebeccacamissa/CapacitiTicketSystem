'use strict';
process.env.NODE_ENV = 'test';
process.env.BCRYPT_ROUNDS = '4';
delete process.env.ANTHROPIC_API_KEY; // AI tailoring must degrade gracefully without a key

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `capaciti-test-uploads-${process.pid}`);

const { openDatabase, setDb } = require('../server/db/connection');
let db;
const { createApp } = require('../server/app');
const bcrypt = require('bcryptjs');
const { numbersNotInOriginal } = require('../server/modules/portfolio/cv-tailor.service');

let server, base;
const jars = {};
async function call(who, method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(jars[who] ? { Cookie: jars[who] } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const cookie = res.headers.get('set-cookie');
  if (cookie) jars[who] = cookie.split(';')[0];
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

const ids = {};
async function addUser(key, name, role, stream) {
  ids[key] = await db.insert('INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, ?)', name, `${key}@t.test`, bcrypt.hashSync('Passw0rd!', 4), role);
  if (role === 'candidate') await db.run('INSERT INTO candidate_profiles (user_id, stream) VALUES (?, ?)', ids[key], stream);
}
const stageOf = async (id) => (await db.one('SELECT stage FROM candidate_stages WHERE candidate_id = ?', id))?.stage || 'enrolled';

before(async () => {
  db = await openDatabase({ memory: true });
  setDb(db);
  await addUser('admin', 'Admin User', 'admin');
  await addUser('support', 'Support User', 'support');
  await addUser('fac', 'Facil User', 'facilitator');
  await addUser('rec', 'Recruiter One', 'recruiter');
  await addUser('rec2', 'Recruiter Two', 'recruiter');
  await addUser('dev', 'Dev Candidate', 'candidate', 'Software Development');
  await addUser('cloud', 'Cloud Candidate', 'candidate', 'Cloud Engineering');
  (await db.run("INSERT INTO facilitator_streams (user_id, stream) VALUES (?, 'Software Development')", ids.fac));
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  for (const k of Object.keys(ids)) await call(k, 'POST', '/auth/login', { email: `${k}@t.test`, password: 'Passw0rd!' });
});
after(() => server.close());

test('facilitators only see candidates in their streams', async () => {
  const list = await call('fac', 'GET', '/stages/candidates');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.candidates.map((c) => c.fullName), ['Dev Candidate']);
  assert.equal((await call('fac', 'GET', `/progress/${ids.cloud}`)).status, 404);
  assert.equal((await call('fac', 'GET', `/candidates/${ids.cloud}`)).status, 404);
  assert.equal((await call('fac', 'GET', `/progress/${ids.dev}`)).status, 200);
  assert.equal((await call('fac', 'GET', '/requests')).status, 403);
  assert.equal((await call('support', 'POST', `/stages/candidates/${ids.dev}/decisions`, { toStage: 'training', reason: 'Not my call' })).status, 403);
});

test('forward decisions go one step at a time; same-stage decisions are blocked', async () => {
  const skip = await call('fac', 'POST', `/stages/candidates/${ids.dev}/decisions`, { toStage: 'work_ready', reason: 'Trying to skip' });
  assert.equal(skip.status, 409);
  assert.equal(skip.body.error.code, 'STAGE_SKIP');
  const same = await call('fac', 'POST', `/stages/candidates/${ids.dev}/decisions`, { toStage: 'enrolled', reason: 'Already here' });
  assert.equal(same.status, 409);
  assert.equal(same.body.error.code, 'STAGE_UNCHANGED');
  const noReason = await call('fac', 'POST', `/stages/candidates/${ids.dev}/decisions`, { toStage: 'training', reason: '' });
  assert.equal(noReason.status, 400);

  const ok = await call('fac', 'POST', `/stages/candidates/${ids.dev}/decisions`, { toStage: 'training', reason: 'Onboarding evidence verified.' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.direction, 'forward');
  assert.equal(await stageOf(ids.dev), 'training');
  const out = await call('fac', 'POST', `/stages/candidates/${ids.cloud}/decisions`, { toStage: 'training', reason: 'Not my stream' });
  assert.equal(out.status, 404);
});

test('backward moves are admin-only and need a written reason', async () => {
  const fac = await call('fac', 'POST', `/stages/candidates/${ids.dev}/decisions`, { toStage: 'enrolled', reason: 'Moving back for missing documents' });
  assert.equal(fac.status, 403);
  assert.equal(fac.body.error.code, 'STAGE_BACKWARD_ADMIN_ONLY');
  const short = await call('admin', 'POST', `/stages/candidates/${ids.dev}/decisions`, { toStage: 'enrolled', reason: 'oops' });
  assert.equal(short.status, 400);
  const ok = await call('admin', 'POST', `/stages/candidates/${ids.dev}/decisions`, { toStage: 'enrolled', reason: 'Contract was not signed; returning to Enrolled until it is.' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.direction, 'backward');
  assert.equal(await stageOf(ids.dev), 'enrolled');
});

test('the database itself rejects stage changes that bypass the rules', async () => {
  // A raw stage update with no matching decision.
  await assert.rejects(() => db.run("UPDATE candidate_stages SET stage = 'placed' WHERE candidate_id = ?", ids.dev), /STAGE_AUDIT_REQUIRED/);
  await assert.rejects(() => db.run("INSERT INTO candidate_stages (candidate_id, stage) VALUES (?, 'placed')", ids.cloud), /STAGE_AUDIT_REQUIRED/);
  // A raw decision that skips a stage, comes from the wrong person, or moves back without an admin.
  await assert.rejects(() => db.run("INSERT INTO stage_decisions (candidate_id, from_stage, to_stage, direction, decided_by, reason) VALUES (?, 'enrolled', 'placed', 'forward', ?, 'skip it')", ids.dev, ids.admin), /STAGE_SKIP/);
  await assert.rejects(() => db.run("INSERT INTO stage_decisions (candidate_id, from_stage, to_stage, direction, decided_by, reason) VALUES (?, 'enrolled', 'training', 'forward', ?, 'not allowed')", ids.cloud, ids.fac), /STAGE_NOT_AUTHORISED/);
  await assert.rejects(() => db.run("INSERT INTO stage_decisions (candidate_id, from_stage, to_stage, direction, decided_by, reason) VALUES (?, 'enrolled', 'training', 'forward', ?, 'support cannot')", ids.dev, ids.support), /STAGE_NOT_AUTHORISED/);
  await assert.rejects(() => db.run("INSERT INTO stage_decisions (candidate_id, from_stage, to_stage, direction, decided_by, reason) VALUES (?, 'enrolled', 'enrolled', 'forward', ?, 'same stage')", ids.dev, ids.admin), /STAGE_UNCHANGED/);
  // The trail is append-only.
  await assert.rejects(() => db.run("UPDATE stage_decisions SET reason = 'edited'"), /AUDIT_LOG_IMMUTABLE/);
  await assert.rejects(() => db.run('DELETE FROM stage_decisions'), /AUDIT_LOG_IMMUTABLE/);
});

test('stage audit trail: admin sees all, facilitator their streams, candidate their own', async () => {
  await call('admin', 'POST', `/stages/candidates/${ids.cloud}/decisions`, { toStage: 'training', reason: 'Enrolment complete.' });
  const all = await call('admin', 'GET', '/stages/decisions');
  assert.equal(all.body.decisions.length, 3);
  assert.deepEqual(all.body.decisions[0], { ...all.body.decisions[0], decidedBy: 'Admin User', candidateName: 'Cloud Candidate' });
  const fac = await call('fac', 'GET', '/stages/decisions');
  assert.ok(fac.body.decisions.length === 2 && fac.body.decisions.every((d) => d.candidateName === 'Dev Candidate'));
  assert.equal((await call('fac', 'GET', `/stages/decisions?candidateId=${ids.cloud}`)).status, 404);
  const mine = await call('dev', 'GET', '/stages/decisions');
  assert.ok(mine.body.decisions.every((d) => d.candidateId === ids.dev));
  assert.equal((await call('support', 'GET', '/stages/decisions')).status, 403);
  assert.equal((await call('rec', 'GET', '/stages/decisions')).status, 403);
});

test('pipeline counts candidates by stage and stream', async () => {
  const p = await call('admin', 'GET', '/stages/pipeline');
  assert.equal(p.status, 200);
  assert.equal(p.body.total, 2);
  assert.equal(p.body.byStage.enrolled, 1);
  assert.equal(p.body.byStage.training, 1);
  assert.equal(p.body.byStream.length, 2);
  const f = await call('fac', 'GET', '/stages/pipeline');
  assert.equal(f.body.total, 1);
  assert.equal((await call('dev', 'GET', '/stages/pipeline')).status, 403);
});

const PDF = `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n% test cv\n').toString('base64')}`;
test('portfolio files: real type checks and access rules', async () => {
  const fake = await call('dev', 'POST', '/portfolio/files', { kind: 'cv', name: 'cv.pdf', data: `data:application/pdf;base64,${Buffer.from('MZ not a pdf').toString('base64')}` });
  assert.equal(fake.status, 400);
  const wrongKind = await call('dev', 'POST', '/portfolio/files', { kind: 'certificate', name: 'notes.txt', data: `data:text/plain;base64,${Buffer.from('hello').toString('base64')}` });
  assert.equal(wrongKind.status, 400);
  const up = await call('dev', 'POST', '/portfolio/files', { kind: 'cv', title: 'My CV', name: 'cv.pdf', data: PDF });
  assert.equal(up.status, 201);
  const id = up.body.file.id;
  assert.equal((await call('dev', 'GET', `/portfolio/files/${id}`)).status, 200);
  assert.equal((await call('fac', 'GET', `/portfolio/files/${id}`)).status, 200);
  assert.equal((await call('cloud', 'GET', `/portfolio/files/${id}`)).status, 404);
  // Recruiters only once the candidate publishes.
  assert.equal((await call('rec', 'GET', `/portfolio/files/${id}`)).status, 404);
  await call('dev', 'PATCH', '/recruiter/me', { isPublished: true, headline: 'Developer' });
  assert.equal((await call('rec', 'GET', `/portfolio/files/${id}`)).status, 200);
  const profile = await call('rec', 'GET', `/recruiter/profiles/${ids.dev}`);
  assert.equal(profile.body.profile.files.length, 1);
  assert.equal(profile.body.profile.stage, 'enrolled');
});

test('recruiter shortlist is saved and private to each recruiter', async () => {
  assert.equal((await call('rec', 'PUT', `/recruiter/shortlist/${ids.cloud}`, { note: 'unpublished' })).status, 404);
  const add = await call('rec', 'PUT', `/recruiter/shortlist/${ids.dev}`, { note: 'Strong accessibility focus' });
  assert.equal(add.status, 200);
  const mine = await call('rec', 'GET', '/recruiter/shortlist');
  assert.equal(mine.body.candidates.length, 1);
  assert.equal(mine.body.candidates[0].shortlistNote, 'Strong accessibility focus');
  assert.equal((await call('rec2', 'GET', '/recruiter/shortlist')).body.candidates.length, 0);
  assert.equal((await call('rec', 'GET', '/recruiter/talent')).body.candidates[0].shortlisted, true);
  assert.equal((await call('rec2', 'GET', '/recruiter/talent')).body.candidates[0].shortlisted, false);
  assert.equal((await call('dev', 'GET', '/recruiter/shortlist')).status, 403);
  await call('rec', 'DELETE', `/recruiter/shortlist/${ids.dev}`);
  assert.equal((await call('rec', 'GET', '/recruiter/shortlist')).body.candidates.length, 0);
});

test('AI CV tailoring needs consent and reports itself unavailable without a key', async () => {
  assert.equal((await call('dev', 'GET', '/portfolio/cv/ai-status')).body.enabled, false);
  const noConsent = await call('dev', 'POST', '/portfolio/cv/tailor', { jobTitle: 'Junior developer', cvText: 'x'.repeat(80), consent: false });
  assert.equal(noConsent.status, 400);
  const off = await call('dev', 'POST', '/portfolio/cv/tailor', { jobTitle: 'Junior developer', cvText: 'Experience: built a web app. '.repeat(5), consent: true });
  assert.equal(off.status, 503);
  assert.equal(off.body.error.code, 'AI_NOT_CONFIGURED');
  assert.equal((await call('rec', 'POST', '/portfolio/cv/tailor', { jobTitle: 'x', consent: true })).status, 403);
  // Saving a reviewed version stores it as an AI-tailored CV file.
  const saved = await call('dev', 'POST', '/portfolio/cv/tailored', { title: 'CV for Junior developer', text: 'Dev Candidate\nSkills: JavaScript, SQL\n' });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.file.source, 'ai_tailored');
});

test('invented numbers in a tailored CV are flagged for the candidate to check', () => {
  assert.deepEqual(numbersNotInOriginal('Built 2 apps in 2025.', 'Built 2 apps in 2025, improving speed by 40%.'), ['40%']);
  assert.deepEqual(numbersNotInOriginal('Led a team of 3.', 'Led a team of 3.'), []);
});
