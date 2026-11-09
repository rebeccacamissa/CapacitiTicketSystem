'use strict';
/**
 * Users, profiles, avatars, birthdays and notifications.
 * Owner: Member A (accounts) + Member D (dashboard data)
 */
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { transaction } = require('../../db/connection');
const { bcryptRounds } = require('../../config/env');
const { avatarOf } = require('../avatar/catalog');
const { badRequest, conflict, notFound } = require('../../utils/AppError');


// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/** 12-char temporary password that always satisfies the password policy. */
function generateTempPassword() {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#$%*?'];
  const all = sets.join('');
  const chars = sets.map((s) => s[crypto.randomInt(s.length)]);
  while (chars.length < 12) chars.push(all[crypto.randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** Replace a facilitator's stream assignments (names must be known streams). */
function setFacilitatorStreams(db, userId, streams) {
  const known = require('../../config/options').streams;
  const clean = [...new Set(streams)].filter((s) => known.includes(s));
  db.prepare('DELETE FROM facilitator_streams WHERE user_id = ?').run(userId);
  for (const s of clean) db.prepare('INSERT INTO facilitator_streams (user_id, stream) VALUES (?, ?)').run(userId, s);
  return clean;
}

async function createUser(db, u) {
  const email = u.email.toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    throw conflict('EMAIL_TAKEN', 'An account with that email already exists');
  }
  if (u.employeeId && db.prepare('SELECT 1 FROM staff_profiles WHERE employee_id = ?').get(u.employeeId)) {
    throw conflict('EMPLOYEE_ID_TAKEN', 'That employee ID is already in use');
  }
  const hash = await bcrypt.hash(u.password, bcryptRounds);
  return transaction(db, () => {
    const id = Number(db.prepare(`
      INSERT INTO users (full_name, first_name, surname, email, password_hash, role, date_of_birth, gender, must_change_password)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(`${u.firstName} ${u.surname}`, u.firstName, u.surname, email, hash, u.role,
      u.dateOfBirth || null, u.gender || 'prefer-not', u.mustChangePassword ? 1 : 0).lastInsertRowid);

    if (u.role === 'candidate') {
      db.prepare('INSERT INTO candidate_profiles (user_id, cohort, stream, mentor, tech_champ, supervisor, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, u.cohort || null, u.stream || null, u.mentor || null, u.techChamp || null, u.supervisor || null, u.createdBy || id);
    } else {
      db.prepare('INSERT INTO staff_profiles (user_id, position, employee_id) VALUES (?, ?, ?)')
        .run(id, u.position || null, u.employeeId || null);
    }
    if (u.role === 'facilitator') setFacilitatorStreams(db, id, u.streams || []);
    return id;
  });
}

function getProfile(db, userId) {
  const u = db.prepare(`
    SELECT u.id, u.full_name, u.first_name, u.surname, u.email, u.role, u.is_active, u.date_of_birth, u.gender, u.avatar_config, u.preferences, u.tour_done, u.accessibility, u.language, u.created_at,
           cp.cohort, cp.stream, cp.mentor, cp.tech_champ, cp.supervisor, cp.updated_at AS profile_updated_at,
           sp.position, sp.employee_id
    FROM users u
    LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
    LEFT JOIN staff_profiles sp ON sp.user_id = u.id
    WHERE u.id = ?
  `).get(userId);
  if (!u) throw notFound('User not found');
  const out = shapeProfile(u);
  if (u.role === 'facilitator') out.staff.streams = db.prepare('SELECT stream FROM facilitator_streams WHERE user_id = ? ORDER BY stream').all(userId).map((r) => r.stream);
  return out;
}

function shapeProfile(u) {
  return {
    id: u.id,
    fullName: u.full_name,
    firstName: u.first_name || u.full_name.split(' ')[0],
    surname: u.surname || u.full_name.split(' ').slice(1).join(' '),
    email: u.email,
    role: u.role,
    isActive: !!u.is_active,
    dateOfBirth: u.date_of_birth,
    gender: u.gender,
    avatar: avatarOf(u),
    preferences: JSON.parse(u.preferences || '{}'),
    tourDone: !!u.tour_done,
    language: u.language || 'en',
    accessibility: JSON.parse(u.accessibility || '{}'),
    createdAt: u.created_at,
    birthday: u.date_of_birth ? birthdayInfo(u.date_of_birth) : null,
    candidate: u.role === 'candidate'
      ? { cohort: u.cohort, stream: u.stream, mentor: u.mentor, techChamp: u.tech_champ, supervisor: u.supervisor, updatedAt: u.profile_updated_at }
      : undefined,
    staff: u.role !== 'candidate' ? { position: u.position, employeeId: u.employee_id } : undefined,
  };
}

function updateCandidateProfile(db, candidateId, data, actor) {
  const u = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'candidate'").get(candidateId);
  if (!u) throw notFound('Candidate not found');
  transaction(db, () => {
    if (data.firstName || data.surname || data.dateOfBirth !== undefined) {
      const cur = db.prepare('SELECT first_name, surname, full_name, date_of_birth FROM users WHERE id = ?').get(candidateId);
      const first = data.firstName || cur.first_name || cur.full_name.split(' ')[0];
      const last = data.surname || cur.surname || cur.full_name.split(' ').slice(1).join(' ');
      db.prepare('UPDATE users SET first_name = ?, surname = ?, full_name = ?, date_of_birth = ? WHERE id = ?')
        .run(first, last, `${first} ${last}`, data.dateOfBirth === undefined ? cur.date_of_birth : data.dateOfBirth || null, candidateId);
    }
    db.prepare(`
      INSERT INTO candidate_profiles (user_id, cohort, stream, mentor, tech_champ, supervisor, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        cohort = COALESCE(excluded.cohort, cohort), stream = COALESCE(excluded.stream, stream),
        mentor = COALESCE(excluded.mentor, mentor), tech_champ = COALESCE(excluded.tech_champ, tech_champ),
        supervisor = COALESCE(excluded.supervisor, supervisor),
        updated_by = excluded.updated_by, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    `).run(candidateId, data.cohort ?? null, data.stream ?? null, data.mentor ?? null, data.techChamp ?? null, data.supervisor ?? null, actor.id);
  });
  return getProfile(db, candidateId);
}

// ---------------------------------------------------------------------------
// Birthdays (server local time — SAST in production)
// ---------------------------------------------------------------------------
function nextBirthday(dob, now = new Date()) {
  const [, mm, dd] = dob.split('-').map(Number);
  const make = (y) => {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return new Date(y, mm - 1, mm === 2 && dd === 29 && !leap ? 28 : dd);
  };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = make(now.getFullYear());
  if (next < today) next = make(now.getFullYear() + 1);
  return next;
}

function birthdayInfo(dob, now = new Date()) {
  const next = nextBirthday(dob, now);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysUntil = Math.round((next - today) / 86_400_000);
  return { next: `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`, daysUntil, isToday: daysUntil === 0, turning: next.getFullYear() - Number(dob.slice(0, 4)) };
}

function birthdays(db, { withinDays = 14 } = {}) {
  const rows = db.prepare(`
    SELECT u.id, u.full_name, u.first_name, u.role, u.date_of_birth, u.gender, u.avatar_config, cp.cohort, cp.stream
    FROM users u LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
    WHERE u.is_active = 1 AND u.date_of_birth IS NOT NULL
  `).all();
  const list = rows.map((r) => {
    const b = birthdayInfo(r.date_of_birth);
    // Only month/day is shared with other users — never the birth year.
    return { id: r.id, name: r.full_name, firstName: r.first_name || r.full_name.split(' ')[0], role: r.role,
      cohort: r.cohort, stream: r.stream, avatar: avatarOf(r),
      date: b.next, daysUntil: b.daysUntil, isToday: b.isToday };
  }).filter((b) => b.daysUntil <= withinDays).sort((a, b) => a.daysUntil - b.daysUntil);
  return { today: list.filter((b) => b.isToday), upcoming: list.filter((b) => !b.isToday) };
}

// ---------------------------------------------------------------------------
// Notifications (computed, not stored)
// ---------------------------------------------------------------------------
function notifications(db, user) {
  const items = [];
  const { today } = birthdays(db, { withinDays: 0 });
  for (const b of today) {
    if (b.id === user.id) items.push({ type: 'birthday-self', tone: 'celebrate', title: `Happy birthday, ${b.firstName}!`, tkey: 'Happy birthday, {name}!', body: 'The whole CAPACITI team is celebrating you today.', bkey: 'The whole CAPACITI team is celebrating you today.', vars: { name: b.firstName }, href: user.role === 'candidate' ? '/dashboard' : null });
    else if (b.role === 'candidate' && ['support', 'admin'].includes(user.role)) items.push({ type: 'birthday', tone: 'celebrate', title: `It's ${b.firstName}'s birthday today`, tkey: "It's {name}'s birthday today", vars: { name: b.firstName }, body: b.cohort ? `${b.cohort}${b.stream ? ` · ${b.stream}` : ''}` : 'Send them some love!', href: null });
  }

  if (user.role === 'recruiter') return items;

  if (user.role === 'facilitator') {
    const ready = require('../stages/stage.service').candidates(db, user).filter((c) => c.readyForReview);
    if (ready.length) items.push({ type: 'review', tone: 'info', title: `${ready.length} candidate${ready.length > 1 ? 's' : ''} ready for a stage review`, tkey: 'Candidates ready for a stage review: {n}', bkey: 'Every exit criterion for their current stage is evidenced.', vars: { n: ready.length }, body: 'Every exit criterion for their current stage is evidenced.', href: '/stage-decisions' });
    return items;
  }

  if (user.role === 'candidate') {
    const last = db.prepare(`SELECT d.to_stage, d.direction, ps.label, d.created_at FROM stage_decisions d JOIN programme_stages ps ON ps.key = d.to_stage
      WHERE d.candidate_id = ? AND d.direction <> 'initial' AND d.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days') ORDER BY d.id DESC LIMIT 1`).get(user.id);
    if (last) items.push({ type: 'stage', tone: last.direction === 'forward' ? 'ok' : 'warn', title: `Your official stage is now ${last.label}`, tkey: 'Your official stage is now {stage}', vars: { stage: last.label }, body: 'Open your roadmap to see the decision.', bkey: 'Open your roadmap to see the decision.', href: '/dashboard#roadmap' });
  }

  if (user.role === 'candidate') {
    const waiting = db.prepare("SELECT id, reference, title FROM requests WHERE candidate_id = ? AND status = 'Waiting for Candidate'").all(user.id);
    for (const r of waiting) items.push({ type: 'action', tone: 'warn', title: `${r.reference} needs your reply`, tkey: '{ref} needs your reply', vars: { ref: r.reference }, body: r.title, href: `/request?id=${r.id}` });
    const resolved = db.prepare("SELECT id, reference FROM requests WHERE candidate_id = ? AND status = 'Resolved'").all(user.id);
    for (const r of resolved) items.push({ type: 'info', tone: 'ok', title: `${r.reference} was resolved`, tkey: '{ref} was resolved', bkey: 'Please confirm the fix or reopen it.', vars: { ref: r.reference }, body: 'Please confirm the fix or reopen it.', href: `/request?id=${r.id}` });
  } else {
    const { n: unassigned } = db.prepare("SELECT COUNT(*) n FROM requests WHERE assigned_to IS NULL AND status IN ('Open','Reopened')").get();
    if (unassigned) items.push({ type: 'queue', tone: 'info', title: `${unassigned} unassigned request${unassigned > 1 ? 's' : ''}`, tkey: 'Unassigned requests: {n}', bkey: 'New tickets are waiting in the queue.', vars: { n: unassigned }, body: 'New tickets are waiting in the queue.', href: '/requests?assigned=unassigned' });
    const { n: overdue } = db.prepare("SELECT COUNT(*) n FROM requests WHERE assigned_to = ? AND status NOT IN ('Resolved','Closed') AND due_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')").get(user.id);
    if (overdue) items.push({ type: 'overdue', tone: 'warn', title: `${overdue} of your cases ${overdue > 1 ? 'are' : 'is'} overdue`, tkey: 'Your overdue cases: {n}', bkey: 'Past the SLA due date.', vars: { n: overdue }, body: 'Past the SLA due date.', href: '/requests?assigned=me&overdue=true' });
    const replied = db.prepare(`
      SELECT r.id, r.reference FROM requests r
      WHERE r.assigned_to = ? AND r.status = 'In Progress'
        AND (SELECT u.role FROM request_messages m JOIN users u ON u.id = m.author_id WHERE m.request_id = r.id ORDER BY m.id DESC LIMIT 1) = 'candidate'
    `).all(user.id);
    for (const r of replied) items.push({ type: 'reply', tone: 'info', title: `New candidate reply on ${r.reference}`, tkey: 'New candidate reply on {ref}', bkey: 'The candidate has responded.', vars: { ref: r.reference }, body: 'The candidate has responded.', href: `/request?id=${r.id}` });
  }
  return items;
}

module.exports = {
  generateTempPassword, createUser, setFacilitatorStreams, getProfile, updateCandidateProfile,
  birthdays, birthdayInfo, notifications,
};
