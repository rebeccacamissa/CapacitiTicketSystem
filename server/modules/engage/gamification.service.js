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
  { key: 'milestone_screening', name: 'Screened In', description: 'Completed Application & Screening', icon: 'flag', roles: 'candidate' },
  { key: 'milestone_onboarding', name: 'On Board', description: 'Completed Enrolled & Onboarding', icon: 'flag', roles: 'candidate' },
  { key: 'milestone_training', name: 'Trained Up', description: 'Completed In Training & Active Support', icon: 'flag', roles: 'candidate' },
  { key: 'milestone_work_ready', name: 'Work Ready', description: 'Signed off as work ready', icon: 'flag', roles: 'candidate' },
  { key: 'milestone_placed', name: 'Placed', description: 'Started a corporate internship', icon: 'trophy', roles: 'candidate' },
  { key: 'solver', name: 'Problem Solver', description: 'Resolved 5 support requests', icon: 'bolt', roles: 'staff' },
  { key: 'helper', name: 'Town Crier', description: 'Posted your first announcement', icon: 'megaphone', roles: 'staff' },
];

const LEVEL_XP = 100;

function badgeEarned(db, userId, key) {
  const has = (kind, ref) => !!db.prepare(`SELECT 1 FROM xp_events WHERE user_id = ? AND kind = ?${ref ? ' AND ref = ?' : ''}`).get(userId, kind, ...(ref ? [ref] : []));
  switch (key) {
    case 'explorer': return has('tour');
    case 'stylist': return has('avatar');
    case 'first_request': return has('request_created');
    case 'closer': return has('request_closed');
    case 'feedback': return has('rating');
    case 'solver': return db.prepare("SELECT COUNT(*) n FROM xp_events WHERE user_id = ? AND kind = 'resolved'").get(userId).n >= 5;
    case 'helper': return has('announcement');
    default: return key.startsWith('milestone_') && has('milestone', key.slice(10));
  }
}

/** Award XP once per (kind, ref); then evaluate badges. Returns newly earned badges. */
function award(db, userId, kind, ref = '') {
  const points = XP[kind] ?? 0;
  const { changes } = db.prepare('INSERT OR IGNORE INTO xp_events (user_id, kind, ref, points) VALUES (?, ?, ?, ?)').run(userId, kind, String(ref), points);
  if (!changes) return [];
  const earned = [];
  const owned = new Set(db.prepare('SELECT badge_key FROM user_badges WHERE user_id = ?').all(userId).map((r) => r.badge_key));
  for (const b of BADGES) {
    if (owned.has(b.key) || !badgeEarned(db, userId, b.key)) continue;
    db.prepare('INSERT OR IGNORE INTO user_badges (user_id, badge_key) VALUES (?, ?)').run(userId, b.key);
    earned.push(b);
    const u = db.prepare(`SELECT u.full_name, u.role, cp.cohort FROM users u LEFT JOIN candidate_profiles cp ON cp.user_id = u.id WHERE u.id = ?`).get(userId);
    if (u?.role === 'candidate') {
      db.prepare('INSERT OR IGNORE INTO feed_posts (kind, subject_id, cohort, body, ref) VALUES (?, ?, ?, ?, ?)')
        .run(b.key.startsWith('milestone_') ? 'milestone' : 'badge', userId, u.cohort || null,
          b.key.startsWith('milestone_') ? `${u.full_name} reached a new milestone: ${b.description}.` : `${u.full_name} earned the ${b.name} badge.`,
          `badge:${userId}:${b.key}`);
      bus.publish('all', 'feed', {});
    }
  }
  bus.publish([userId], 'xp', { kind, points, badges: earned.map((b) => ({ key: b.key, name: b.name, description: b.description, icon: b.icon })) });
  return earned;
}

function summary(db, userId, role) {
  const { xp } = db.prepare('SELECT COALESCE(SUM(points), 0) AS xp FROM xp_events WHERE user_id = ?').get(userId);
  const owned = Object.fromEntries(db.prepare('SELECT badge_key, awarded_at FROM user_badges WHERE user_id = ?').all(userId).map((r) => [r.badge_key, r.awarded_at]));
  const relevant = BADGES.filter((b) => b.roles === '*' || (b.roles === 'staff' ? role !== 'candidate' : role === 'candidate'));
  return {
    xp,
    level: Math.floor(xp / LEVEL_XP) + 1,
    levelProgress: xp % LEVEL_XP,
    levelSize: LEVEL_XP,
    badges: relevant.map((b) => ({ ...b, earned: !!owned[b.key], awardedAt: owned[b.key] || null })),
  };
}

const badgeSet = (db, userId) => new Set(db.prepare('SELECT badge_key FROM user_badges WHERE user_id = ?').all(userId).map((r) => r.badge_key));

module.exports = { award, summary, badgeSet, BADGES, XP };
