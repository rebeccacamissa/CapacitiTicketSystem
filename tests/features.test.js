'use strict';
/**
 * End-to-end tests for: password reset, production (non-demo) mode, review requests,
 * batch stage approval, stagnation flags, evidence linking, interview requests,
 * placement confirmation, exports (CSV/PDF), programme reports, POPIA tools,
 * CV builder and mock interviews (without an AI key).
 */
process.env.NODE_ENV = 'test';
process.env.BCRYPT_ROUNDS = '4';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.RESEND_API_KEY;
process.env.DEMO_MODE = 'false'; // dotenv never overrides an existing value

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { openDatabase, setDb } = require('../server/db/connection');
const { createApp } = require('../server/app');
const auth = require('../server/modules/auth/auth.service');

let db, server, base;
const jars = {};
const ids = {};

async function call(who, method, url, body, { raw = false } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(jars[who] ? { Cookie: jars[who] } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const cookie = res.headers.get('set-cookie');
  if (cookie) jars[who] = cookie.split(';')[0];
  if (raw) return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed, headers: res.headers };
}

async function addUser(key, name, role, extra = {}) {
  ids[key] = await db.insert('INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, ?)', name, `${key}@t.test`, bcrypt.hashSync('Passw0rd!', 4), role);
  if (role === 'candidate') await db.run('INSERT INTO candidate_profiles (user_id, stream, cohort) VALUES (?, ?, ?)', ids[key], extra.stream || 'Software Development', extra.cohort || 'C1');
}
const login = (k) => call(k, 'POST', '/auth/login', { email: `${k}@t.test`, password: 'Passw0rd!' });

before(async () => {
  db = await openDatabase({ memory: true });
  setDb(db);
  await addUser('admin', 'Ada Admin', 'admin');
  await addUser('admin2', 'Second Admin', 'admin');
  await addUser('fac', 'Fay Facil', 'facilitator');
  await addUser('rec', 'Rex Recruiter', 'recruiter');
  await addUser('ann', 'Ann Candidate', 'candidate');
  await addUser('ben', 'Ben Candidate', 'candidate');
  await addUser('cat', 'Cat Candidate', 'candidate', { stream: 'Data Science & Analytics', cohort: 'C2' });
  await db.run("INSERT INTO facilitator_streams (user_id, stream) VALUES (?, 'Software Development'), (?, 'Data Science & Analytics')", ids.fac, ids.fac);
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  for (const k of Object.keys(ids)) await login(k);
});
after(async () => { server.close(); await db.close(); });

test('demo shortcuts are off unless DEMO_MODE=true', async () => {
  assert.deepEqual((await call('x', 'GET', '/auth/demo-accounts')).body, { enabled: false, accounts: [] });
  assert.equal((await call('x', 'POST', '/auth/demo-login', { role: 'admin' })).status, 404);
});

test('password reset: no enumeration, single-use, expiring token', async () => {
  const unknown = await call('x', 'POST', '/auth/forgot-password', { email: 'nobody@t.test' });
  const known = await call('x', 'POST', '/auth/forgot-password', { email: 'ann@t.test' });
  assert.equal(unknown.status, 202);
  assert.deepEqual(unknown.body, known.body); // same response either way
  const logged = await db.one("SELECT status FROM email_log WHERE kind = 'password_reset' AND to_email = 'ann@t.test'");
  assert.equal(logged.status, 'logged'); // no RESEND_API_KEY in tests
  const token = await auth.forgotPassword('ann@t.test');
  assert.equal((await call('x', 'POST', '/auth/reset-password', { token: 'x'.repeat(43), newPassword: 'NewPassw0rd' })).status, 400);
  assert.equal((await call('x', 'POST', '/auth/reset-password', { token, newPassword: 'weak' })).status, 400);
  assert.equal((await call('x', 'POST', '/auth/reset-password', { token, newPassword: 'NewPassw0rd' })).status, 200);
  assert.equal((await call('x', 'POST', '/auth/reset-password', { token, newPassword: 'Another1Pw' })).status, 400); // single use
  assert.equal((await call('ann2', 'POST', '/auth/login', { email: 'ann@t.test', password: 'NewPassw0rd' })).status, 200);
  // Expired tokens are rejected.
  const t2 = await auth.forgotPassword('ann@t.test');
  await db.run("UPDATE password_reset_tokens SET expires_at = iso_shift('-1 minutes') WHERE used_at IS NULL");
  assert.equal((await call('x', 'POST', '/auth/reset-password', { token: t2, newPassword: 'NewPassw0rd2' })).status, 400);
});

test('candidate-requested review alerts the facilitator; a decision resolves it', async () => {
  const first = await call('ann', 'POST', '/stages/me/review', { note: 'Please check my onboarding evidence' });
  assert.equal(first.status, 201);
  assert.equal((await call('ann', 'POST', '/stages/me/review', {})).status, 409);
  const list = await call('fac', 'GET', '/stages/candidates');
  assert.equal(list.body.candidates.find((c) => c.id === ids.ann).reviewRequested, true);
  assert.ok((await db.one("SELECT 1 FROM email_log WHERE kind = 'review_request' AND to_email = 'fac@t.test'")));
  const notes = await call('fac', 'GET', '/notifications');
  assert.ok(notes.body.items.some((n) => n.type === 'review'));
  await call('fac', 'POST', `/stages/candidates/${ids.ann}/decisions`, { toStage: 'training', reason: 'Evidence checked with the candidate.' });
  assert.equal((await call('ann', 'GET', '/stages/me/review')).body.request, null);
  assert.ok(await db.one("SELECT 1 FROM email_log WHERE kind = 'stage_decision' AND to_email = 'ann@t.test'"));
});

test('batch approval: one shared note, per-candidate results, scope respected', async () => {
  const out = await call('fac', 'POST', '/stages/batch', { candidateIds: [ids.ben, ids.cat, 99999], reason: 'Cohort onboarding signed off.' });
  assert.equal(out.status, 200);
  assert.equal(out.body.approved, 2);
  assert.equal(out.body.failed, 1);
  const trail = await call('admin', 'GET', '/stages/decisions');
  assert.equal(trail.body.decisions.filter((d) => d.reason === 'Cohort onboarding signed off.').length, 2);
  assert.equal((await call('fac', 'POST', '/stages/batch', { candidateIds: [], reason: 'x x x' })).status, 400);
});

test('candidates past their stage target are flagged', async () => {
  await db.run("UPDATE programme_stages SET target_days = 1 WHERE key = 'training'");
  await db.run("UPDATE candidate_stages SET updated_at = iso_shift('-5 days') WHERE candidate_id = ?", ids.ben);
  const c = (await call('fac', 'GET', '/stages/candidates')).body.candidates.find((x) => x.id === ids.ben);
  assert.equal(c.overdue, true);
  assert.ok(c.daysInStage >= 5);
  assert.equal((await call('fac', 'GET', '/stages/pipeline')).body.overdue >= 1, true);
  await db.run("UPDATE programme_stages SET target_days = 120 WHERE key = 'training'");
});

const TXT = (s) => `data:text/plain;base64,${Buffer.from(s).toString('base64')}`;

test('evidence linking: staff link a candidate document to a verified checklist item', async () => {
  const up = await call('ann', 'POST', '/portfolio/files', { kind: 'project', title: 'Capstone', name: 'capstone.txt', data: TXT('capstone report') });
  const other = await call('ben', 'POST', '/portfolio/files', { kind: 'project', title: 'Ben', name: 'ben.txt', data: TXT('ben') });
  const req = await db.one("SELECT mr.id FROM milestone_requirements mr JOIN milestones m ON m.id = mr.milestone_id WHERE m.key = 'training' AND mr.sort_order = 4");
  assert.equal((await call('fac', 'PUT', `/progress/${ids.ann}/requirements/${req.id}`, { completed: true, fileId: other.body.file.id })).status, 400);
  const ok = await call('fac', 'PUT', `/progress/${ids.ann}/requirements/${req.id}`, { completed: true, fileId: up.body.file.id });
  assert.equal(ok.status, 200);
  const item = ok.body.milestones.find((m) => m.key === 'training').requirements.find((r) => r.id === req.id);
  assert.equal(item.evidence.title, 'Capstone');
  const me = await call('ann', 'GET', '/progress/me');
  assert.ok(me.body.whatsNext && me.body.whatsNext.tip); // "What's next" guidance
  assert.equal((await call('fac', 'PUT', `/progress/${ids.ann}/requirements/${req.id}/evidence`, { fileId: null })).status, 200);
});

test('interview requests: recruiter invites, candidate responds, staff can see', async () => {
  await call('ann', 'PATCH', '/recruiter/me', { isPublished: true, headline: 'Developer', skills: 'JavaScript, SQL' });
  assert.equal((await call('rec', 'POST', '/recruiter/interviews', { candidateId: ids.ben, company: 'Acme', roleTitle: 'Dev' })).status, 404); // not published
  const inv = await call('rec', 'POST', '/recruiter/interviews', { candidateId: ids.ann, company: 'Acme Ltd', roleTitle: 'Junior Developer', proposedAt: '2026-12-01T10:00', mode: 'online' });
  assert.equal(inv.status, 201);
  assert.equal((await call('rec', 'POST', '/recruiter/interviews', { candidateId: ids.ann, company: 'Acme Ltd', roleTitle: 'Junior Developer' })).status, 409);
  const mine = await call('ann', 'GET', '/career/interviews');
  assert.equal(mine.body.interviews[0].status, 'pending');
  assert.equal((await call('ben', 'POST', `/career/interviews/${inv.body.interview.id}/respond`, { accept: true })).status, 404);
  const resp = await call('ann', 'POST', `/career/interviews/${inv.body.interview.id}/respond`, { accept: true, note: 'See you then' });
  assert.equal(resp.body.interview.status, 'accepted');
  assert.equal((await call('fac', 'GET', '/career/interviews')).body.interviews.length, 1);
  assert.equal((await call('rec', 'GET', '/notifications')).body.items.some((n) => n.type === 'interview'), true);
});

test('placement: recruiter reports, facilitator confirms only from Work Ready', async () => {
  const rep = await call('rec', 'POST', '/recruiter/placements', { candidateId: ids.ann, company: 'Acme Ltd', roleTitle: 'Junior Developer', startDate: '2027-01-10' });
  assert.equal(rep.status, 201);
  assert.equal((await call('rec', 'POST', '/recruiter/placements', { candidateId: ids.ann, company: 'X Co', roleTitle: 'Dev' })).status, 409);
  const early = await call('fac', 'POST', `/stages/placements/${rep.body.id}`, { approve: true });
  assert.equal(early.status, 409); // Ann is In Training, not Work Ready
  await call('fac', 'POST', `/stages/candidates/${ids.ann}/decisions`, { toStage: 'work_ready', reason: 'All assessments passed.' });
  const ok = await call('fac', 'POST', `/stages/placements/${rep.body.id}`, { approve: true, note: 'Contract seen.' });
  assert.equal(ok.body.status, 'confirmed');
  assert.equal((await db.one('SELECT stage FROM candidate_stages WHERE candidate_id = ?', ids.ann)).stage, 'placed');
  const d = (await call('admin', 'GET', `/stages/decisions?candidateId=${ids.ann}`)).body.decisions[0];
  assert.match(d.reason, /Placement confirmed: Junior Developer at Acme Ltd/);
});

test('talent filters: skills, cohort, documents and stage sort', async () => {
  await call('rec', 'PUT', `/recruiter/shortlist/${ids.ann}`, { note: '=HYPERLINK("bad")' });
  assert.equal((await call('rec', 'GET', '/recruiter/talent?skills=javascript,sql')).body.candidates.length, 1);
  assert.equal((await call('rec', 'GET', '/recruiter/talent?skills=python')).body.candidates.length, 0);
  assert.equal((await call('rec', 'GET', '/recruiter/talent?cohort=C1')).body.candidates.length, 1);
  assert.equal((await call('rec', 'GET', '/recruiter/talent?documents=cv')).body.candidates.length, 0);
  assert.deepEqual((await call('rec', 'GET', '/recruiter/talent')).body.cohorts, ['C1']);
});

test('exports: shortlist and audit trail as CSV (formula-safe) and PDF', async () => {
  const csv = await call('rec', 'GET', '/recruiter/shortlist/export.csv', undefined, { raw: true });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  const text = csv.buf.toString('utf8');
  assert.match(text, /Ann Candidate/);
  assert.match(text, /'=HYPERLINK/); // neutralised spreadsheet formula
  const pdf = await call('rec', 'GET', '/recruiter/shortlist/export.pdf', undefined, { raw: true });
  assert.equal(pdf.buf.subarray(0, 5).toString(), '%PDF-');
  const trail = await call('fac', 'GET', '/stages/decisions/export.csv', undefined, { raw: true });
  assert.match(trail.buf.toString('utf8'), /Placement confirmed/);
  assert.equal((await call('fac', 'GET', '/stages/decisions/export.pdf', undefined, { raw: true })).buf.subarray(0, 5).toString(), '%PDF-');
  assert.equal((await call('ann', 'GET', '/stages/decisions/export.csv')).status, 403);
});

test('programme reports: stage times, placement rates, velocity, CSV', async () => {
  const r = await call('admin', 'GET', '/reports/programme');
  assert.equal(r.status, 200);
  assert.equal(r.body.totals.candidates, 3);
  assert.equal(r.body.totals.placed, 1);
  assert.ok(r.body.stageTimes.find((s) => s.key === 'enrolled').completedSpans >= 3);
  assert.ok(r.body.byStream.length >= 2);
  assert.equal(r.body.velocity.placedSample, 1);
  const f = await call('fac', 'GET', '/reports/programme?stream=Data%20Science%20%26%20Analytics');
  assert.equal(f.body.totals.candidates, 1);
  const csv = await call('admin', 'GET', '/reports/programme/export.csv?type=streams', undefined, { raw: true });
  assert.match(csv.buf.toString('utf8'), /Placement rate %/);
  assert.equal((await call('rec', 'GET', '/reports/programme')).status, 403);
});

test('CV builder: validate, save and generate a PDF into documents', async () => {
  const first = await call('ben', 'GET', '/career/cv');
  assert.equal(first.body.cv.fullName, 'Ben Candidate'); // prefilled
  assert.equal((await call('ben', 'PUT', '/career/cv', { cv: { fullName: 'Ben', github: 'http://insecure' } })).status, 400);
  const saved = await call('ben', 'PUT', '/career/cv', { cv: { ...first.body.cv, summary: 'Motivated developer.', skills: ['JavaScript'], experience: [{ role: 'Intern', organisation: 'Shop', start: '2025', end: '2026', points: ['Helped customers'] }] } });
  assert.equal(saved.status, 200);
  const pdf = await call('ben', 'GET', '/career/cv/pdf', undefined, { raw: true });
  assert.equal(pdf.buf.subarray(0, 5).toString(), '%PDF-');
  const stored = await call('ben', 'GET', '/career/cv/pdf?save=1');
  assert.equal(stored.status, 201);
  assert.equal(stored.body.file.source, 'cv_builder');
  assert.equal((await call('rec', 'GET', '/career/cv')).status, 403);
});

test('mock interview works without AI: question bank and self-review feedback', async () => {
  const started = await call('ben', 'POST', '/career/mock-interviews', { jobTitle: 'Junior Developer' });
  assert.equal(started.status, 201);
  assert.equal(started.body.interview.source, 'bank');
  const n = started.body.interview.questions.length;
  assert.equal((await call('ben', 'POST', `/career/mock-interviews/${started.body.interview.id}/answers`, { answers: ['only one'] })).status, 400);
  const done = await call('ben', 'POST', `/career/mock-interviews/${started.body.interview.id}/answers`, { answers: Array(n).fill('In my capstone I built an API and learned testing.') });
  assert.equal(done.body.interview.status, 'completed');
  assert.equal(done.body.interview.feedback.source, 'self-review');
  assert.equal((await call('ann', 'POST', `/career/mock-interviews/${started.body.interview.id}/answers`, { answers: Array(n).fill('x') })).status, 404);
});

test('POPIA: export my data, request deletion, admin anonymises', async () => {
  const exp = await call('ben', 'GET', '/privacy/export-data', undefined, { raw: true });
  assert.match(exp.headers.get('content-disposition'), /attachment/);
  const data = JSON.parse(exp.buf.toString('utf8'));
  assert.equal(data.account.email, 'ben@t.test');
  assert.ok(Array.isArray(data.stageDecisions) && data.stageDecisions.length >= 1);
  assert.equal(data.account.password_hash, undefined);
  assert.equal((await call('ben', 'POST', '/privacy/acknowledge')).status, 200);
  assert.equal((await call('ben', 'POST', '/privacy/deletion-request', { reason: 'Leaving the programme' })).status, 201);
  assert.equal((await call('ben', 'POST', '/privacy/deletion-request', {})).status, 409);
  const reqs = await call('admin', 'GET', '/privacy/requests');
  const r = reqs.body.requests.find((x) => x.userId === ids.ben);
  assert.equal((await call('admin', 'POST', `/privacy/requests/${r.id}`, { action: 'decline' })).status, 409); // reason needed
  assert.equal((await call('admin', 'POST', `/privacy/requests/${r.id}`, { action: 'complete' })).status, 200);
  const u = await db.one('SELECT full_name, email, is_active, date_of_birth FROM users WHERE id = ?', ids.ben);
  assert.equal(u.full_name, `Deleted user #${ids.ben}`);
  assert.equal(u.is_active, 0);
  assert.equal((await db.one('SELECT COUNT(*) n FROM portfolio_files WHERE candidate_id = ?', ids.ben)).n, 0);
  assert.ok((await db.one('SELECT COUNT(*) n FROM stage_decisions WHERE candidate_id = ?', ids.ben)).n >= 1); // audit trail kept
  assert.equal((await call('ben', 'GET', '/auth/me')).status, 401); // can no longer sign in
  assert.equal((await call('ann', 'GET', '/privacy/requests')).status, 403);
});
