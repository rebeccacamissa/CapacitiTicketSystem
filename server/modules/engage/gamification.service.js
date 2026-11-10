'use strict';
/**
 * XP, levels and badges. Awarding is idempotent (UNIQUE user/kind/ref), so hooks
 * can call award() freely. New badges create a feed post and a live event.
 */
const bus = require('../../realtime/bus');

const XP = { tour: 20, avatar: 20, request_created: 10, request_closed: 15, rating: 10, requirement: 20, milestone: 100, resolved: 10, announcement: 10 };

const BADGES = [
  { key: 'explorer', name: 'Explorer', description: 'Completed the guided walkthrough', icon: 'compass', roles: '*' },
  { key: 'stylist', name: 'Stylist', description: 'Designed your own avatar', icon: 'sparkle', roles: '*' },
  { key: 'first_request', name: 'First Steps', description: 'Raised your first support request', icon: 'ticket', roles: 'candidate' },
  { key: 'closer', name: 'Closer', description: 'Confirmed a resolution and closed a request', icon: 'check', roles: 'candidate' },
  { key: 'feedback', name: 'Voice Heard', description: 'Rated the support you received', icon: 'star', roles: 'candidate' },
  { key: 'milestone_training', name: 'Trained Up', description: 'Started the In Training stage', icon: 'flag', roles: 'candidate' },
  { key: 'milestone_work_ready', name: 'Work Ready', description: 'Signed off as work ready', icon: 'flag', roles: 'candidate' },
  { key: 'milestone_placed', name: 'Placed', description: 'Started a corporate internship', icon: 'trophy', roles: 'candidate' },
  { key: 'milestone_completed', name: 'Graduate', description: 'Completed the CAPACITI programme', icon: 'trophy', roles: 'candidate' },
  { key: 'solver', name: 'Problem Solver', description: 'Resolved 5 support requests', icon: 'bolt', roles: 'staff' },
  { key: 'helper', name: 'Town Crier', description: 'Posted your first announcement', icon: 'megaphone', roles: 'staff' },
];

const LEVEL_XP = 100;

async function badgeEarned(db, userId, key) {
  const has = async (kind, ref) => !!(await db.one(`SELECT 1 FROM xp_events WHERE user_id = ? AND kind = ?${ref ? ' AND ref = ?' : ''}`, userId, kind, ...(ref ? [ref] : [])));
  switch (key) {
    case 'explorer': return has('tour');
    case 'stylist': return has('avatar');
    case 'first_request': return has('request_created');
    case 'closer': return has('request_closed');
    case 'feedback': return has('rating');
    case 'solver': return (await db.one("SELECT COUNT(*) n FROM xp_events WHERE user_id = ? AND kind = 'resolved'", userId)).n >= 5;
    case 'helper': return has('announcement');
    default: return key.startsWith('milestone_') && has('milestone', key.slice(10));
  }
}

/** Award XP once per (kind, ref); then evaluate badges. Returns newly earned badges. */
async function award(db, userId, kind, ref = '') {
  const points = XP[kind] ?? 0;
  const { changes } = (await db.run('INSERT INTO xp_events (user_id, kind, ref, points) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', userId, kind, String(ref), points));
  if (!changes) return [];
  const earned = [];
  const owned = new Set((await db.all('SELECT badge_key FROM user_badges WHERE user_id = ?', userId)).map((r) => r.badge_key));
  for (const b of BADGES) {
    if (owned.has(b.key) || !(await badgeEarned(db, userId, b.key))) continue;
    (await db.run('INSERT INTO user_badges (user_id, badge_key) VALUES (?, ?) ON CONFLICT DO NOTHING', userId, b.key));
    earned.push(b);
    const u = (await db.one(`SELECT u.full_name, u.role, cp.cohort FROM users u LEFT JOIN candidate_profiles cp ON cp.user_id = u.id WHERE u.id = ?`, userId));
    if (u?.role === 'candidate') {
      (await db.run('INSERT INTO feed_posts (kind, subject_id, cohort, body, ref) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING', b.key.startsWith('milestone_') ? 'milestone' : 'badge', userId, u.cohort || null,
          b.key.startsWith('milestone_') ? `${u.full_name} reached a new milestone: ${b.description}.` : `${u.full_name} earned the ${b.name} badge.`,
          `badge:${userId}:${b.key}`));
      bus.publish('all', 'feed', {});
    }
  }
  bus.publish([userId], 'xp', { kind, points, badges: earned.map((b) => ({ key: b.key, name: b.name, description: b.description, icon: b.icon })) });
  return earned;
}

async function summary(db, userId, role) {
  const { xp } = (await db.one('SELECT COALESCE(SUM(points), 0) AS xp FROM xp_events WHERE user_id = ?', userId));
  const owned = Object.fromEntries((await db.all('SELECT badge_key, awarded_at FROM user_badges WHERE user_id = ?', userId)).map((r) => [r.badge_key, r.awarded_at]));
  const relevant = BADGES.filter((b) => b.roles === '*' || (b.roles === 'staff' ? role !== 'candidate' : role === 'candidate'));
  return {
    xp,
    level: Math.floor(xp / LEVEL_XP) + 1,
    levelProgress: xp % LEVEL_XP,
    levelSize: LEVEL_XP,
    badges: relevant.map((b) => ({ ...b, earned: !!owned[b.key], awardedAt: owned[b.key] || null })),
  };
}

const badgeSet = async (db, userId) => new Set((await db.all('SELECT badge_key FROM user_badges WHERE user_id = ?', userId)).map((r) => r.badge_key));

module.exports = { award, summary, badgeSet, BADGES, XP };
