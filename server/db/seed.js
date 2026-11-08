'use strict';
/**
 * Seeds demo users, requests (driven through the real workflow pipeline so the
 * audit trail is genuine) and roadmap progress.
 *   npm run db:seed    – seed if empty
 *   npm run db:reset   – delete DB and reseed
 */
const fs = require('node:fs');
const bcrypt = require('bcryptjs');
const { dbPath } = require('../config/env');

if (process.argv.includes('--reset')) {
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) if (fs.existsSync(f)) fs.rmSync(f);
  console.log('Database removed.');
}

const { getDb } = require('./connection');
const { createRequest } = require('../modules/requests/requests.service');
const wf = require('../modules/workflow/transition.service');

const db = getDb();
if (db.prepare('SELECT COUNT(*) n FROM users').get().n > 0) {
  console.log('Database already has users — skipping seed. Use `npm run db:reset` to start fresh.');
  process.exit(0);
}

const PASSWORD = 'Capaciti@2026';
const hash = bcrypt.hashSync(PASSWORD, 10);
/** DOB whose next birthday is `inDays` from today (so the birthday features always demo well). */
function dobIn(inDays, year) {
  const d = new Date();
  d.setDate(d.getDate() + inDays);
  return `${year}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const addUser = (name, email, role, dob, extra = {}) => {
  const [first, ...rest] = name.split(' ');
  const id = Number(db.prepare('INSERT INTO users (full_name, first_name, surname, email, password_hash, role, date_of_birth, gender, avatar_config) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(name, first, rest.join(' '), email, hash, role, dob, extra.gender || 'prefer-not', extra.avatar ? JSON.stringify({ ...extra.avatar, custom: true }) : null).lastInsertRowid);
  if (role === 'candidate') {
    db.prepare('INSERT INTO candidate_profiles (user_id, cohort, stream, mentor, tech_champ, supervisor) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, extra.cohort, extra.stream, extra.mentor, extra.techChamp, extra.supervisor);
  } else {
    db.prepare('INSERT INTO staff_profiles (user_id, position, employee_id) VALUES (?, ?, ?)').run(id, extra.position, extra.employeeId);
  }
  return { id, role, fullName: name, firstName: first };
};

const admin = addUser('Nomsa Dlamini', 'admin@capaciti.org.za', 'admin', '1985-03-14', { position: 'Operations Lead', employeeId: 'CAP-0001', gender: 'female', avatar: { v: 2, art: 'polished', look: 'runway', skin: '7b4a2a', hair: 'bun', hairColor: '2c1b18', rearHair: 'none', facialHair: 'none', clothing: 'openJacket', clothesColor: '151613', bg: 'studio' } });
const sup1 = addUser('Thabo Mokoena', 'thabo@capaciti.org.za', 'support', dobIn(21, 1992), { position: 'Programme Manager', employeeId: 'CAP-0142', gender: 'male' });
const sup2 = addUser('Aisha Patel', 'aisha@capaciti.org.za', 'support', '1994-07-02', { position: 'Support Specialist', employeeId: 'CAP-0187', gender: 'female', avatar: { v: 2, art: 'polished', look: 'doll', skin: 'b98e6a', hair: 'sideComed', hairColor: '2c1b18', rearHair: 'longStraight', facialHair: 'none', clothing: 'turtleNeck', clothesColor: 'be185d', bg: 'sunset' } });
const team = { mentor: 'Thabo Mokoena', techChamp: 'Kyle Adams', supervisor: 'Aisha Patel' };
const c1 = addUser('Lerato Khumalo', 'lerato@example.com', 'candidate', dobIn(9, 2001), { cohort: '2026 Cohort 1 · Cape Town', stream: 'Software Development', ...team, gender: 'female' });
const c2 = addUser('Sipho Ndlovu', 'sipho@example.com', 'candidate', dobIn(0, 2002), { cohort: '2026 Cohort 1 · Johannesburg', stream: 'Data Science & Analytics', mentor: 'Aisha Patel', techChamp: 'Naledi Sithole', supervisor: 'Thabo Mokoena', gender: 'male', avatar: { v: 2, art: 'classic', look: 'tactical', skin: '614335', hair: 'shortFlat', hairColor: '2c1b18', hatColor: '4b5320', facialHair: 'beardLight', clothing: 'hoodie', clothesColor: '4b5320', graphic: 'skullOutline', accessory: 'wayfarers', accessoryColor: '151613', bg: 'camo' } });
const c3 = addUser('Zanele Mthembu', 'zanele@example.com', 'candidate', dobIn(40, 2000), { cohort: '2026 Cohort 1 · Cape Town', stream: 'Cloud Engineering', ...team, gender: 'female', avatar: { v: 2, art: 'classic', look: 'doll', skin: 'ae5d29', hair: 'dreads02', hairColor: '2c1b18', hatColor: '1d2951', facialHair: 'none', clothing: 'shirtScoopNeck', clothesColor: 'ec4899', graphic: 'diamond', accessory: 'wayfarers', accessoryColor: 'f1d1d1', bg: 'sunset' } });
addUser('Kagiso Molefe', 'kagiso@example.com', 'candidate', dobIn(4, 2003), { cohort: '2026 Cohort 2 · Remote', stream: 'Cybersecurity', mentor: 'Aisha Patel', techChamp: 'Kyle Adams', supervisor: 'Nomsa Dlamini', gender: 'male' });
addUser('Amahle Zulu', 'amahle@example.com', 'candidate', '2001-11-30', { cohort: '2026 Cohort 2 · Cape Town', stream: 'UX/UI Design', ...team, gender: 'female', avatar: { v: 2, art: 'classic', look: 'runway', skin: '614335', hair: 'fro', hairColor: '2c1b18', hatColor: '1d2951', facialHair: 'none', clothing: 'blazerAndShirt', clothesColor: 'f25251', graphic: 'diamond', accessory: 'round', accessoryColor: 'd4af37', bg: 'night' } });

const cat = Object.fromEntries(db.prepare('SELECT id, name FROM categories').all().map((c) => [c.name, c.id]));

function backdate(id, hoursAgo) {
  db.prepare(`
    UPDATE requests SET
      created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now', '-' || ? || ' hours'),
      due_at = strftime('%Y-%m-%dT%H:%M:%fZ','now', '-' || ? || ' hours', '+' || (SELECT hours FROM priority_sla p WHERE p.priority = requests.priority) || ' hours')
    WHERE id = ?`).run(hoursAgo, hoursAgo, id);
}

function make(candidate, category, priority, title, description, hoursAgo, steps = []) {
  const r = createRequest(db, { actor: candidate, title, description, categoryId: cat[category], priority });
  backdate(r.id, hoursAgo);
  for (const s of steps) {
    if (s.assign) wf.assignRequest(db, r.id, { assigneeId: s.assign.id, actor: s.by, note: s.note });
    else if (s.msg) wf.addMessage(db, r.id, { actor: s.by, body: s.msg, isInternal: s.internal });
    else wf.transitionStatus(db, r.id, { toStatus: s.to, actor: s.by, note: s.note, message: s.message, resolution: s.resolution });
  }
  return r;
}

make(c1, 'Connectivity', 'High', 'Mobile data not loading for online classes',
  'Since Monday my data bundle has not been working and I cannot join the live sessions on Teams.', 30, [
    { assign: sup1, by: sup1, note: 'Taking this one — likely an APN issue.' },
    { to: 'In Progress', by: sup1 },
    { to: 'Waiting for Candidate', by: sup1, message: 'Please send a screenshot of your APN settings and your SIM network provider.' },
  ]);

make(c1, 'Learning platform access', 'Medium', 'Cannot log in to the learning platform',
  'I get an "account locked" error when I try to sign in to the learning platform.', 100, [
    { assign: sup2, by: admin },
    { to: 'In Progress', by: sup2 },
    { to: 'Resolved', by: sup2, resolution: 'Account unlocked and password reset link sent.', message: 'Your account is unlocked — please check your email.' },
    { to: 'Closed', by: c1 },
  ]);

make(c1, 'Career support', 'Low', 'Feedback on my CV draft',
  'Could someone review my CV before the work-readiness workshop next week?', 4);

make(c2, 'Attendance', 'Urgent', 'Attendance marked absent while on approved leave',
  'I was on approved family responsibility leave on 3 and 4 November but am showing as absent.', 10, [
    { assign: sup1, by: sup1 },
    { to: 'In Progress', by: sup1, note: 'Checking leave register with the facilitator.' },
  ]);

make(c2, 'Assessments', 'High', 'Request re-assessment for Module 4',
  'My Module 4 assessment submission failed to upload before the deadline due to load-shedding.', 60);

make(c2, 'Technical support', 'Medium', 'Laptop keyboard not working',
  'Several keys on my CAPACITI-issued laptop have stopped working.', 200, [
    { assign: sup2, by: sup2 },
    { to: 'In Progress', by: sup2 },
    { to: 'Resolved', by: sup2, resolution: 'Device swapped at the Cape Town office.' },
    { to: 'Reopened', by: c2, message: 'The replacement laptop has the same problem.' },
  ]);

make(c3, 'Administration', 'Low', 'Stipend payment date query',
  'When will the November stipend be paid? I need to plan my transport costs.', 150, [
    { assign: admin, by: admin },
    { to: 'In Progress', by: admin },
    { to: 'Resolved', by: admin, resolution: 'Confirmed stipend payment date of 25 November.' },
  ]);

make(c3, 'Well-being referral', 'High', 'Would like to speak to a counsellor',
  'I have been feeling overwhelmed and would like to be referred to a counsellor.', 80, [
    { assign: sup2, by: sup2 },
    { to: 'In Progress', by: sup2, note: 'Confidential — referral submitted to wellness partner.' },
  ]);

make(c3, 'Course content', 'Medium', 'Clarification on capstone brief',
  'The capstone brief mentions an API integration — is a public API acceptable?', 2);

// Roadmap progress -----------------------------------------------------
const reqs = db.prepare(`SELECT mr.id, m.sort_order AS m, mr.sort_order AS r FROM milestone_requirements mr JOIN milestones m ON m.id = mr.milestone_id ORDER BY m.sort_order, mr.sort_order`).all();
function progress(candidate, upToMilestone, partialCount, startDaysAgo) {
  let day = startDaysAgo;
  for (const r of reqs) {
    if (r.m < upToMilestone || (r.m === upToMilestone && r.r <= partialCount)) {
      db.prepare(`INSERT INTO candidate_requirement_progress (candidate_id, requirement_id, completed_at, verified_by)
                  VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now', '-' || ? || ' days'), ?)`).run(candidate.id, r.id, day, sup1.id);
      day = Math.max(1, day - 6);
    }
  }
}
progress(c1, 3, 2, 120); // in training, 2/4 done
progress(c2, 3, 1, 110);
progress(c3, 4, 1, 150); // work ready, 1/3 done

// ---- Engagement: XP, badges, ratings, feed -----------------------------------------
const gamify = require('../modules/engage/gamification.service');
for (const row of db.prepare('SELECT candidate_id, requirement_id FROM candidate_requirement_progress').all()) {
  gamify.award(db, row.candidate_id, 'requirement', row.requirement_id);
}
const { getRoadmap } = require('../modules/progress/progress.service');
for (const c of db.prepare("SELECT id FROM users WHERE role = 'candidate'").all()) {
  for (const m of getRoadmap(db, c.id).milestones) if (m.state === 'completed') gamify.award(db, c.id, 'milestone', m.key);
}
for (const r of db.prepare('SELECT id, candidate_id FROM requests').all()) gamify.award(db, r.candidate_id, 'request_created', r.id);
for (const r of db.prepare("SELECT id, candidate_id FROM requests WHERE status = 'Closed'").all()) gamify.award(db, r.candidate_id, 'request_closed', r.id);
for (const r of db.prepare("SELECT id, assigned_to FROM requests WHERE resolved_at IS NOT NULL AND assigned_to IS NOT NULL").all()) gamify.award(db, r.assigned_to, 'resolved', r.id);
for (const u of db.prepare('SELECT id FROM users WHERE avatar_config IS NOT NULL').all()) gamify.award(db, u.id, 'avatar');

const closed = db.prepare("SELECT id, candidate_id FROM requests WHERE status IN ('Resolved','Closed') ORDER BY id").all();
const ratings = [[5, 'Thabo sorted my login within an hour. Brilliant support!'], [4, 'Quick turnaround on the stipend date, thank you.'], [3, null]];
closed.forEach((r, i) => {
  if (!ratings[i]) return;
  db.prepare('INSERT INTO request_ratings (request_id, candidate_id, rating, comment) VALUES (?, ?, ?, ?)').run(r.id, r.candidate_id, ratings[i][0], ratings[i][1]);
  gamify.award(db, r.candidate_id, 'rating', r.id);
});

db.prepare("INSERT INTO feed_posts (kind, author_id, cohort, body, created_at) VALUES ('announcement', ?, NULL, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days'))")
  .run(admin.id, 'Welcome to the new CAPACITI Support portal! Meet Cammy, your assistant in the corner. She can walk you through everything.');
db.prepare("INSERT INTO feed_posts (kind, author_id, cohort, body, created_at) VALUES ('announcement', ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 hours'))")
  .run(sup1.id, '2026 Cohort 1 · Cape Town', 'Reminder: capstone project check-ins are this Thursday at 10:00 in the Woodstock lab. Bring your progress board.');
gamify.award(db, sup1.id, 'announcement');

console.log('Seed complete.\n');
console.table([
  { role: 'admin', email: 'admin@capaciti.org.za' },
  { role: 'support', email: 'thabo@capaciti.org.za' },
  { role: 'support', email: 'aisha@capaciti.org.za' },
  { role: 'candidate', email: 'lerato@example.com' },
  { role: 'candidate', email: 'sipho@example.com' },
  { role: 'candidate', email: 'zanele@example.com' },
]);
console.log(`All demo passwords: ${PASSWORD}`);
