'use strict';
const express = require('express');
const { getDb } = require('../../db/connection');
const { authenticate } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { rateLimit } = require('../../middleware/rateLimit');
const { reply } = require('./cammy.service');

const router = express.Router();
router.use(authenticate);

router.post('/chat', rateLimit({ windowMs: 60_000, max: 40 }), validate({ message: { type: 'string', max: 500 } }), (req, res) => {
  res.json(reply(getDb(), req.user, req.body.message || ''));
});

module.exports = router;
