'use strict';
const express = require('express');
const { authenticate } = require('../middleware/auth');
const bus = require('./bus');

const router = express.Router();

/** GET /api/events — Server-Sent Events stream for live updates. */
router.get('/', authenticate, async (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  res.write(`event: hello\ndata: ${JSON.stringify({ userId: req.user.id })}\n\n`);

  const unsubscribe = bus.subscribe(req.user, res);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
});

module.exports = router;
