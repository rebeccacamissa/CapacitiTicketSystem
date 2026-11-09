'use strict';
process.env.NODE_ENV = 'test';
process.env.BCRYPT_ROUNDS = '4';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase, setDb } = require('../server/db/connection');
const { validateTransition } = require('../server/modules/workflow/stateMachine');

const db = openDatabase(':memory:');
setDb(db);
const { createApp } = require('../server/app');

let server, base;
const jars = {};

async function call(who, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(jars[who] ? { Cookie: jars[who] } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const cookie = res.headers.get('set-cookie');
  if (cookie) jars[who] = cookie.split(';')[0];
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const bcrypt = require('bcryptjs');
function addUser(name, email, role) {
  return Number(db.prepare('INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name, email, bcrypt.hashSync('Passw0rd!', 4), role).lastInsertRowid);
}

let ids = {};
before(async () => {
  ids.admin = addUser('Admin', 'admin@t.test', 'admin');
  ids.support = addUser('Support', 'support@t.test', 'support');
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  await call('admin', 'POST', '/auth/login', { email: 'admin@t.test', password: 'Passw0rd!' });
  await call('support', 'POST', '/auth/login', { email: 'support@t.test', password: 'Passw0rd!' });
  await call('cand', 'POST', '/auth/register', { firstName: 'Cand', surname: 'One', dateOfBirth: '2001-05-05', gender: 'female', email: 'c1@t.test', password: 'Passw0rd1', cohort: 'C1', stream: 'Software Development' });
  await call('cand2', 'POST', '/auth/register', { firstName: 'Cand', surname: 'Two', dateOfBirth: '2002-06-06', gender: 'male', email: 'c2@t.test', password: 'Passw0rd1' });
});
after(() => server.close());

test('state machine rules (application layer)', () => {
  assert.equal(validateTransition({ from: 'Open', to: 'Assigned', role: 'support' }).ok, true);
  assert.equal(validateTransition({ from: 'Open', to: 'Closed', role: 'support' }).code, 'ILLEGAL_STATUS_TRANSITION');
  assert.equal(validateTransition({ from: 'Open', to: 'Closed', role: 'admin', override: true }).override, true);
  assert.equal(validateTransition({ from: 'In Progress', to: 'Resolved', role: 'candidate' }).ok, false);
  assert.equal(validateTransition({ from: 'Resolved', to: 'Closed', role: 'candidate' }).ok, true);
});

test('registration always creates a candidate and rejects weak passwords', async () => {
  const weak = await call('x', 'POST', '/auth/register', { firstName: 'Weak', surname: 'Pw', dateOfBirth: '2000-01-01', gender: 'female', email: 'w@t.test', password: 'short' });
  assert.equal(weak.status, 400);
  const me = await call('cand', 'GET', '/auth/me');
  assert.equal(me.body.user.role, 'candidate');
});

let reqId;
test('candidate creates request with REQ-YYYY-NNNN reference', async () => {
  const cat = db.prepare("SELECT id FROM categories WHERE name = 'Connectivity'").get().id;
  const r = await call('cand', 'POST', '/requests', { title: 'No internet at home', description: 'Router is broken since Monday', categoryId: cat, priority: 'High' });
  assert.equal(r.status, 201);
  assert.match(r.body.request.reference, new RegExp(`^REQ-${new Date().getUTCFullYear()}-\\d{4}$`));
  assert.equal(r.body.request.status, 'Open');
  reqId = r.body.request.id;
});

test('candidates cannot see other candidates\' requests', async () => {
  assert.equal((await call('cand2', 'GET', `/requests/${reqId}`)).status, 404);
  assert.equal((await call('cand2', 'GET', '/requests')).body.total, 0);
});

test('illegal transition Open → Closed is rejected with 409', async () => {
  const r = await call('support', 'POST', `/workflow/requests/${reqId}/transition`, { toStatus: 'Closed' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'ILLEGAL_STATUS_TRANSITION');
  assert.equal(db.prepare('SELECT status FROM requests WHERE id = ?').get(reqId).status, 'Open');
});

test('DB probe proves the trigger blocks illegal transitions independently', async () => {
  const r = await call('admin', 'POST', '/workflow/db-probe', { requestId: reqId, toStatus: 'Closed' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'DB_ILLEGAL_TRANSITION');
  assert.equal(r.body.error.details.enforcedBy, 'database-trigger');
  assert.equal((await call('support', 'POST', '/workflow/db-probe', { requestId: reqId, toStatus: 'Closed' })).status, 403);
});

test('full workflow with audit trail + candidate auto-transition on reply', async () => {
  assert.equal((await call('support', 'POST', `/workflow/requests/${reqId}/assign`, { assigneeId: ids.support })).status, 200);
  assert.equal((await call('support', 'POST', `/workflow/requests/${reqId}/transition`, { toStatus: 'In Progress', note: 'checking' })).status, 200);
  assert.equal((await call('support', 'POST', `/workflow/requests/${reqId}/transition`, { toStatus: 'Waiting for Candidate', message: 'Router model?' })).status, 200);

  // Roadmap shows a blocker while the connectivity ticket is open
  const rm = await call('cand', 'GET', '/progress/me');
  assert.equal(rm.body.blockers.length, 1);
  assert.equal(rm.body.blockers[0].needsYourAction, true);
  assert.equal(rm.body.activeIndex, 0);

  const reply = await call('cand', 'POST', `/workflow/requests/${reqId}/messages`, { body: 'TP-Link Archer' });
  assert.equal(reply.body.autoTransitioned, true);

  const noRes = await call('support', 'POST', `/workflow/requests/${reqId}/transition`, { toStatus: 'Resolved' });
  assert.equal(noRes.status, 400);
  assert.equal((await call('support', 'POST', `/workflow/requests/${reqId}/transition`, { toStatus: 'Resolved', resolution: 'Router replaced' })).status, 200);
  assert.equal((await call('cand', 'POST', `/workflow/requests/${reqId}/transition`, { toStatus: 'Closed' })).status, 200);

  const statusRows = db.prepare("SELECT old_status, new_status FROM audit_log WHERE request_id = ? AND action = 'STATUS_CHANGE' ORDER BY id").all(reqId);
  assert.deepEqual(statusRows.map((r) => `${r.old_status}>${r.new_status}`), [
    'Open>Assigned', 'Assigned>In Progress', 'In Progress>Waiting for Candidate',
    'Waiting for Candidate>In Progress', 'In Progress>Resolved', 'Resolved>Closed',
  ]);

  // Candidates never see internal notes
  const hist = await call('cand', 'GET', `/workflow/requests/${reqId}/history`);
  assert.ok(hist.body.history.every((h) => !('internal_notes' in h)));
});

test('admin override is allowed, audited, and one-shot', async () => {
  const cat = db.prepare('SELECT id FROM categories LIMIT 1').get().id;
  const { body } = await call('cand', 'POST', '/requests', { title: 'Override me', description: 'Testing override path', categoryId: cat });
  const id = body.request.id;
  assert.equal((await call('support', 'POST', `/workflow/requests/${id}/transition`, { toStatus: 'Closed', override: true })).status, 403);
  const r = await call('admin', 'POST', `/workflow/requests/${id}/transition`, { toStatus: 'Closed', override: true });
  assert.equal(r.status, 200);
  assert.equal(db.prepare('SELECT is_override FROM audit_log WHERE request_id = ? ORDER BY id DESC').get(id).is_override, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM transition_overrides').get().n, 0);
});

test('audit log is immutable', () => {
  assert.throws(() => db.prepare('DELETE FROM audit_log').run(), /AUDIT_LOG_IMMUTABLE/);
  assert.throws(() => db.prepare("UPDATE audit_log SET details = 'x'").run(), /AUDIT_LOG_IMMUTABLE/);
});

test('verified evidence marks a stage ready for review but never moves the official stage', async () => {
  const cand = db.prepare("SELECT id FROM users WHERE email = 'c1@t.test'").get().id;
  const reqs = db.prepare("SELECT mr.id FROM milestone_requirements mr JOIN milestones m ON m.id = mr.milestone_id WHERE m.key = 'enrolled'").all();
  let last;
  for (const r of reqs) last = await call('support', 'PUT', `/progress/${cand}/requirements/${r.id}`, { completed: true });
  assert.equal(last.status, 200);
  assert.equal(last.body.activeIndex, 0);
  assert.equal(last.body.stage.key, 'enrolled');
  assert.equal(last.body.readyForReview, true);
  assert.equal(last.body.milestones[0].completedCount, last.body.milestones[0].totalCount);
  assert.equal((await call('cand', 'PUT', `/progress/${cand}/requirements/${reqs[0].id}`, { completed: false })).status, 403);
});

test('analytics summary is staff-only', async () => {
  assert.equal((await call('cand', 'GET', '/analytics/summary')).status, 403);
  const s = await call('admin', 'GET', '/analytics/summary');
  assert.equal(s.status, 200);
  assert.ok(s.body.totals.total >= 2);
  assert.ok(Array.isArray(s.body.workload));
});

test('admin creates staff with a temporary password that must be changed', async () => {
  const bad = await call('admin', 'POST', '/admin/users', { firstName: 'No', surname: 'Id', email: 'noid@t.test', role: 'support' });
  assert.equal(bad.status, 400);
  const r = await call('admin', 'POST', '/admin/users', {
    firstName: 'Temp', surname: 'Staff', email: 'temp@t.test', role: 'support', position: 'Support Specialist', employeeId: 'CAP-9001', dateOfBirth: '1990-02-02',
  });
  assert.equal(r.status, 201);
  assert.match(r.body.tempPassword, /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12}$/);

  const login = await call('temp', 'POST', '/auth/login', { email: 'temp@t.test', password: r.body.tempPassword });
  assert.equal(login.body.user.mustChangePassword, true);
  const blocked = await call('temp', 'GET', '/requests');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await call('temp', 'POST', '/auth/change-password', { currentPassword: r.body.tempPassword, newPassword: 'NewPassw0rd' })).status, 200);
  assert.equal((await call('temp', 'GET', '/requests')).status, 200);

  // Never-used account can be removed; one with history cannot
  assert.equal((await call('admin', 'DELETE', `/admin/users/${r.body.id}`)).status, 204);
  const cand = db.prepare("SELECT id FROM users WHERE email = 'c1@t.test'").get().id;
  assert.equal((await call('admin', 'DELETE', `/admin/users/${cand}`)).body.error.code, 'USER_HAS_HISTORY');
});

test('support can update candidate programme details; candidates cannot', async () => {
  const cand = db.prepare("SELECT id FROM users WHERE email = 'c2@t.test'").get().id;
  const r = await call('support', 'PATCH', `/candidates/${cand}`, { mentor: 'Jane Mentor', techChamp: 'Kyle', stream: 'Cybersecurity' });
  assert.equal(r.status, 200);
  assert.equal(r.body.profile.candidate.mentor, 'Jane Mentor');
  assert.equal((await call('cand', 'PATCH', `/candidates/${cand}`, { mentor: 'x' })).status, 403);
  const me = await call('cand2', 'GET', '/profile/me');
  assert.equal(me.body.profile.candidate.stream, 'Cybersecurity');
  assert.equal(typeof me.body.profile.birthday.daysUntil, 'number');
});

test('Cammy answers with personalised context', async () => {
  const r = await call('cand', 'POST', '/cammy/chat', { message: 'Where am I on my journey?' });
  assert.equal(r.status, 200);
  assert.match(r.body.reply, /step \d of 5/);
  const help = await call('cand', 'POST', '/cammy/chat', { message: 'my wifi is not working' });
  assert.ok(help.body.actions.some((a) => a.href.includes('Connectivity')));
});

test('new users get a plain gender-based avatar; designs are validated and locked items enforced', async () => {
  const me = await call('cand', 'GET', '/auth/me');
  assert.equal(me.body.user.avatar.look, 'plain');
  assert.equal(me.body.user.avatar.hair, 'longButNotTooLong');
  assert.equal(me.body.user.tourDone, false);
  const design = { v: 2, art: 'classic', look: 'doll', skin: 'ae5d29', hair: 'hijab', hairColor: '2c1b18', hatColor: '6115d0', facialHair: 'none', clothing: 'shirtScoopNeck', clothesColor: 'ec4899', graphic: 'diamond', accessory: 'round', accessoryColor: 'f1d1d1', bg: 'sunset' };
  assert.equal((await call('cand', 'PUT', '/profile/avatar', { avatar: { ...design, accessory: 'eyepatch' } })).status, 400); // locked until the training milestone
  assert.equal((await call('cand', 'PUT', '/profile/avatar', { avatar: { ...design, art: 'polished' } })).status, 400); // hijab isn't a toonHead option
  const svg = await fetch(`${base}/avatar.svg?c=${Buffer.from(JSON.stringify(design)).toString('base64url')}&s=celebrating`);
  assert.equal(svg.status, 200);
  assert.match(svg.headers.get('content-type'), /svg/);
  assert.match(await svg.text(), /^<svg/);
  const ok = await call('cand', 'PUT', '/profile/avatar', { avatar: design });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.badges.some((b) => b.key === 'stylist'));
  const prog = await call('cand', 'GET', '/me/progress');
  assert.ok(prog.body.xp >= 20);
});

test('candidate rates a resolved request; attachments are type-checked and access controlled', async () => {
  const closedId = db.prepare("SELECT id FROM requests WHERE status = 'Closed' AND candidate_id = (SELECT id FROM users WHERE email = 'c1@t.test')").get().id;
  const r = await call('cand', 'POST', `/requests/${closedId}/rating`, { rating: 5, comment: 'Great help' });
  assert.equal(r.status, 200);
  assert.ok(r.body.badges.some((b) => b.key === 'feedback'));
  const summary = await call('admin', 'GET', '/analytics/summary');
  assert.equal(summary.body.csat.count, 1);

  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8ffbf1e0005fe02fea735817e0000000049454e44ae426082', 'hex');
  const bad = await call('cand', 'POST', `/requests/${closedId}/attachments`, { files: [{ name: 'evil.png', data: `data:image/png;base64,${Buffer.from('<script>').toString('base64')}` }] });
  assert.equal(bad.status, 400);
  const up = await call('cand', 'POST', `/requests/${closedId}/attachments`, { files: [{ name: 'screenshot.png', data: `data:image/png;base64,${png.toString('base64')}` }] });
  assert.equal(up.status, 201);
  const attId = up.body.ids[0];
  assert.equal((await call('cand2', 'GET', `/requests/attachments/${attId}`)).status, 404);
  const res = await fetch(`${base}/requests/attachments/${attId}`, { headers: { Cookie: jars.support } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('cohort feed: staff announce, everyone reacts; search is scoped', async () => {
  assert.equal((await call('cand', 'POST', '/feed', { body: 'hi' })).status, 403);
  const p = await call('support', 'POST', '/feed', { body: 'Welcome cohort!' });
  assert.equal(p.status, 201);
  const react = await call('cand', 'POST', `/feed/${p.body.id}/react`, { reaction: 'cheer' });
  assert.equal(react.body.active, true);
  const feed = await call('cand', 'GET', '/feed');
  assert.equal(feed.body.posts.find((x) => x.id === p.body.id).reactions.cheer.count, 1);

  const s1 = await call('cand2', 'GET', '/search?q=REQ');
  assert.ok(s1.body.requests.every((r) => db.prepare('SELECT candidate_id FROM requests WHERE id = ?').get(r.id).candidate_id === db.prepare("SELECT id FROM users WHERE email = 'c2@t.test'").get().id));
  assert.deepEqual(s1.body.candidates, []);
  assert.ok((await call('support', 'GET', '/search?q=Cand')).body.candidates.length >= 1);
});

test('preferences and walkthrough completion persist', async () => {
  await call('cand2', 'PATCH', '/profile/preferences', { theme: 'light', textSize: 'large' });
  const t = await call('cand2', 'POST', '/profile/tour', { done: true });
  assert.ok(t.body.badges.some((b) => b.key === 'explorer'));
  const me = await call('cand2', 'GET', '/auth/me');
  assert.equal(me.body.user.preferences.theme, 'light');
  assert.equal(me.body.user.tourDone, true);
});

test('accessibility needs are private to the candidate and staff', async () => {
  const bad = await call('cand', 'PUT', '/profile/accessibility', { needs: ['not_a_need'] });
  assert.equal(bad.status, 400);
  const ok = await call('cand', 'PUT', '/profile/accessibility', { needs: ['sasl_interpreter', 'extra_time'], notes: 'Prefer morning sessions' });
  assert.equal(ok.status, 200);
  const reqId = db.prepare("SELECT id FROM requests WHERE candidate_id = (SELECT id FROM users WHERE email = 'c1@t.test') LIMIT 1").get().id;
  const staffView = await call('support', 'GET', `/requests/${reqId}`);
  assert.deepEqual(staffView.body.request.candidate_accessibility.needs, ['sasl_interpreter', 'extra_time']);
  const ownView = await call('cand', 'GET', `/requests/${reqId}`);
  assert.equal(ownView.body.request.candidate_accessibility, undefined);
});

test('language preference is saved and Cammy answers in that language', async () => {
  assert.equal((await call('cand2', 'PUT', '/profile/language', { language: 'xx' })).status, 400);
  assert.equal((await call('cand2', 'PUT', '/profile/language', { language: 'zu' })).status, 200);
  assert.equal((await call('cand2', 'GET', '/auth/me')).body.user.language, 'zu');
  const r = await call('cand2', 'POST', '/cammy/chat', { message: 'sawubona' });
  assert.match(r.body.reply, /NginguCammy/);
  assert.ok(r.body.suggestions.every((s) => s.label && s.q)); // translated label, English intent
  await call('cand2', 'PUT', '/profile/language', { language: 'en' });
});

test('extended accessibility preferences validate', async () => {
  assert.equal((await call('cand', 'PATCH', '/profile/preferences', { theme: 'contrast', textSize: 'largest', font: 'lexend', spacing: true, easyRead: true, speechRate: '1.25' })).status, 200);
  assert.equal((await call('cand', 'PATCH', '/profile/preferences', { textSize: 'gigantic' })).status, 400);
});
