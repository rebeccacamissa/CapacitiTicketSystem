'use strict';
/** Cohort activity feed: announcements, milestones, badges and birthdays, with reactions. */
const bus = require('../../realtime/bus');
const { avatarOf } = require('../avatar/catalog');
const { badRequest, notFound } = require('../../utils/AppError');

const REACTIONS = ['cheer', 'love', 'fire', 'star'];

function cohortOf(db, userId) {
  return db.prepare('SELECT cohort FROM candidate_profiles WHERE user_id = ?').get(userId)?.cohort || null;
}

/** Lazily create today's birthday posts (idempotent via unique ref). */
function ensureBirthdayPosts(db) {
  const today = new Date();
  const md = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const ymd = today.toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT u.id, u.full_name, cp.cohort FROM users u LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
    WHERE u.is_active = 1 AND u.role = 'candidate' AND substr(u.date_of_birth, 6, 5) = ?
  `).all(md);
  let created = 0;
  for (const r of rows) {
    created += db.prepare('INSERT OR IGNORE INTO feed_posts (kind, subject_id, cohort, body, ref) VALUES (?, ?, ?, ?, ?)')
      .run('birthday', r.id, r.cohort || null, `It's ${r.full_name}'s birthday today. Send some love!`, `birthday:${r.id}:${ymd}`).changes;
  }
  if (created) bus.publish('all', 'feed', {});
}

function list(db, user, { limit = 20, before } = {}) {
  ensureBirthdayPosts(db);
  const where = [];
  const params = [];
  if (user.role === 'candidate') {
    where.push('(p.cohort IS NULL OR p.cohort = ?)');
    params.push(cohortOf(db, user.id));
  }
  if (before) { where.push('p.id < ?'); params.push(before); }
  const posts = db.prepare(`
    SELECT p.id, p.kind, p.cohort, p.body, p.created_at,
           a.id AS author_id, a.full_name AS author_name, a.role AS author_role, a.avatar_config AS a_cfg, a.gender AS a_gender,
           s.id AS subject_id, s.full_name AS subject_name, s.avatar_config AS s_cfg, s.gender AS s_gender
    FROM feed_posts p
    LEFT JOIN users a ON a.id = p.author_id
    LEFT JOIN users s ON s.id = p.subject_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY p.id DESC LIMIT ?
  `).all(...params, limit);

  const ids = posts.map((p) => p.id);
  const reacts = ids.length ? db.prepare(`SELECT post_id, reaction, COUNT(*) n, SUM(user_id = ?) mine FROM feed_reactions WHERE post_id IN (${ids.map(() => '?').join(',')}) GROUP BY post_id, reaction`).all(user.id, ...ids) : [];

  return posts.map((p) => {
    const person = p.subject_id
      ? { id: p.subject_id, name: p.subject_name, avatar: avatarOf({ avatar_config: p.s_cfg, gender: p.s_gender }) }
      : p.author_id ? { id: p.author_id, name: p.author_name, avatar: avatarOf({ avatar_config: p.a_cfg, gender: p.a_gender }) } : null;
    return {
      id: p.id, kind: p.kind, cohort: p.cohort, body: p.body, createdAt: p.created_at,
      author: p.author_id ? { id: p.author_id, name: p.author_name, role: p.author_role } : null,
      person,
      reactions: Object.fromEntries(REACTIONS.map((r) => {
        const row = reacts.find((x) => x.post_id === p.id && x.reaction === r);
        return [r, { count: row?.n || 0, mine: !!row?.mine }];
      })),
    };
  });
}

function post(db, user, { body, cohort }) {
  const { lastInsertRowid } = db.prepare('INSERT INTO feed_posts (kind, author_id, cohort, body) VALUES (?, ?, ?, ?)')
    .run('announcement', user.id, cohort || null, body);
  bus.publish('all', 'feed', { id: Number(lastInsertRowid) });
  return Number(lastInsertRowid);
}

function react(db, user, postId, reaction) {
  if (!REACTIONS.includes(reaction)) throw badRequest('Unknown reaction');
  const p = db.prepare('SELECT id, cohort FROM feed_posts WHERE id = ?').get(postId);
  if (!p || (user.role === 'candidate' && p.cohort && p.cohort !== cohortOf(db, user.id))) throw notFound('Post not found');
  const del = db.prepare('DELETE FROM feed_reactions WHERE post_id = ? AND user_id = ? AND reaction = ?').run(postId, user.id, reaction);
  if (!del.changes) db.prepare('INSERT INTO feed_reactions (post_id, user_id, reaction) VALUES (?, ?, ?)').run(postId, user.id, reaction);
  bus.publish('all', 'feed', { id: postId, reaction: true });
  return { active: !del.changes };
}

function remove(db, postId) {
  const r = db.prepare('DELETE FROM feed_posts WHERE id = ?').run(postId);
  if (!r.changes) throw notFound('Post not found');
  bus.publish('all', 'feed', {});
}

module.exports = { list, post, react, remove, REACTIONS };
