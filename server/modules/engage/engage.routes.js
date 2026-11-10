'use strict';
/** Avatar builder, XP/badges, preferences, walkthrough, command-palette search and cohort feed. */
const express = require('express');
const { getDb } = require('../../db/connection');
const { authenticate, authorize } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { badRequest } = require('../../utils/AppError');
const avatarCatalog = require('../avatar/catalog');
const gamify = require('./gamification.service');
const feed = require('./feed.service');
const bus = require('../../realtime/bus');
const { NEEDS } = require('../../config/accessibility');

const router = express.Router();
router.use(authenticate);

// ---- Avatar ------------------------------------------------------------------
router.get('/avatar/catalog', async (req, res) => {
  res.json(avatarCatalog.catalog(req.user.role, await gamify.badgeSet(getDb(), req.user.id)));
});

router.put('/profile/avatar', async (req, res) => {
  const db = getDb();
  let cfg;
  try {
    cfg = avatarCatalog.validate(req.body?.avatar, { role: req.user.role, badges: await gamify.badgeSet(db, req.user.id) });
  } catch (msg) {
    throw badRequest(String(msg));
  }
  (await db.run('UPDATE users SET avatar_config = ? WHERE id = ?', JSON.stringify(cfg), req.user.id));
  const badges = await gamify.award(db, req.user.id, 'avatar');
  bus.publish('all', 'people', { id: req.user.id });
  res.json({ avatar: cfg, badges });
});

router.delete('/profile/avatar', async (req, res) => {
  (await getDb().run('UPDATE users SET avatar_config = NULL WHERE id = ?', req.user.id));
  res.status(204).end();
});

// ---- XP & badges -------------------------------------------------------------
router.get('/me/progress', async (req, res) => res.json(await gamify.summary(getDb(), req.user.id, req.user.role)));

// ---- Preferences & walkthrough -------------------------------------------------
router.patch(
  '/profile/preferences',
  validate({
    theme: { type: 'enum', values: ['dark', 'light', 'system', 'contrast'] },
    reduceMotion: { type: 'bool' },
    textSize: { type: 'enum', values: ['normal', 'large', 'larger', 'largest'] },
    font: { type: 'enum', values: ['default', 'lexend', 'atkinson'] },
    spacing: { type: 'bool' },
    cbSafe: { type: 'bool' },
    largeTargets: { type: 'bool' },
    easyRead: { type: 'bool' },
    readingGuide: { type: 'bool' },
    autoRead: { type: 'bool' },
    speechRate: { type: 'enum', values: ['0.75', '1', '1.25', '1.5'] },
  }),
  async (req, res) => {
    const db = getDb();
    const cur = JSON.parse((await db.one('SELECT preferences FROM users WHERE id = ?', req.user.id)).preferences || '{}');
    const next = { ...cur, ...req.body };
    (await db.run('UPDATE users SET preferences = ? WHERE id = ?', JSON.stringify(next), req.user.id));
    res.json({ preferences: next });
  }
);

/** Accessibility needs (optional, self-declared). */
router.put(
  '/profile/accessibility',
  async (req, res, next) => {
    const needs = Array.isArray(req.body?.needs) ? req.body.needs : [];
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : '';
    if (needs.some((n) => !NEEDS.includes(n)) || needs.length > NEEDS.length) return next(badRequest('Unknown accessibility need'));
    if (notes.length > 500) return next(badRequest('Notes must be 500 characters or fewer'));
    const value = { needs: [...new Set(needs)], notes };
    (await getDb().run('UPDATE users SET accessibility = ? WHERE id = ?', JSON.stringify(value), req.user.id));
    bus.publish('staff', 'people', { id: req.user.id });
    res.json({ accessibility: value });
  }
);

router.put('/profile/language', validate({ language: { type: 'enum', required: true, values: ['en', 'zu', 'xh', 'af', 'nso'] } }), async (req, res) => {
  (await getDb().run('UPDATE users SET language = ? WHERE id = ?', req.body.language, req.user.id));
  res.json({ language: req.body.language });
});

router.post('/profile/tour', validate({ done: { type: 'bool', default: true } }), async (req, res) => {
  const db = getDb();
  (await db.run('UPDATE users SET tour_done = ? WHERE id = ?', req.body.done ? 1 : 0, req.user.id));
  const badges = req.body.done ? await gamify.award(db, req.user.id, 'tour') : [];
  res.json({ ok: true, badges });
});

// ---- Command palette search ---------------------------------------------------
router.get('/search', authorize('candidate', 'support', 'admin'), validate({ q: { type: 'string', required: true, min: 1, max: 80 } }, 'query'), async (req, res) => {
  const db = getDb();
  const like = `%${req.validQuery.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const own = req.user.role === 'candidate';
  const requests = (await db.all(`
    SELECT r.id, r.reference, r.title, r.status FROM requests r JOIN users u ON u.id = r.candidate_id
    WHERE (r.reference ILIKE ? ESCAPE '\\' OR r.title ILIKE ? ESCAPE '\\' ${own ? '' : "OR u.full_name ILIKE ? ESCAPE '\\'"})
      ${own ? 'AND r.candidate_id = ?' : ''}
    ORDER BY r.updated_at DESC LIMIT 6
  `, ...(own ? [like, like, req.user.id] : [like, like, like])));
  const candidates = own ? [] : (await db.all(`
    SELECT u.id, u.full_name, u.email, cp.stream FROM users u LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
    WHERE u.role = 'candidate' AND u.is_active = 1 AND (u.full_name ILIKE ? ESCAPE '\\' OR u.email ILIKE ? ESCAPE '\\')
    ORDER BY u.full_name LIMIT 5
  `, like, like));
  res.json({ requests, candidates });
});

// ---- Cohort feed -------------------------------------------------------------
router.get('/feed', authorize('candidate', 'support', 'admin', 'facilitator'), validate({ limit: { type: 'int', min: 1, max: 50 }, before: { type: 'int', min: 1 } }, 'query'), async (req, res) => {
  res.json({ posts: await feed.list(getDb(), req.user, req.validQuery) });
});

router.post(
  '/feed',
  authorize('support', 'admin'),
  validate({ body: { type: 'string', required: true, min: 1, max: 1000, label: 'Announcement' }, cohort: { type: 'string', max: 80 } }),
  async (req, res) => {
    const db = getDb();
    const id = await feed.post(db, req.user, req.body);
    await gamify.award(db, req.user.id, 'announcement');
    res.status(201).json({ id });
  }
);

router.post(
  '/feed/:id/react',
  authorize('candidate', 'support', 'admin', 'facilitator'),
  validate({ id: { type: 'int', required: true, min: 1 } }, 'params'),
  validate({ reaction: { type: 'enum', required: true, values: feed.REACTIONS } }),
  async (req, res) => res.json(await feed.react(getDb(), req.user, req.params.id, req.body.reaction))
);

router.delete('/feed/:id', authorize('support', 'admin'), validate({ id: { type: 'int', required: true, min: 1 } }, 'params'), async (req, res) => {
  await feed.remove(getDb(), req.params.id);
  res.status(204).end();
});

module.exports = router;
