'use strict';
// Owner: Member D
const express = require('express');
const { getDb } = require('../../db/connection');
const { authenticate, authorize } = require('../../middleware/auth');
const svc = require('./analytics.service');

const router = express.Router();
router.use(authenticate);

router.get('/summary', authorize('support', 'admin'), (req, res) => res.json(svc.summary(getDb())));

router.get('/me', authorize('candidate'), (req, res) => {
  const s = svc.candidateSummary(getDb(), req.user.id);
  for (const k of Object.keys(s)) s[k] = s[k] ?? 0;
  res.json(s);
});

module.exports = router;
