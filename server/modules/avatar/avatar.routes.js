'use strict';
/**
 * GET /api/avatar.svg?c=<base64url JSON design>&s=<frame>
 * Public and deterministic (designs contain no personal data), so responses are
 * cached immutably. Input is size-limited and normalised before rendering.
 */
const express = require('express');
const { renderSvg } = require('./render');

const router = express.Router();

router.get('/avatar.svg', (req, res) => {
  const c = String(req.query.c || '');
  let cfg = null;
  if (c && c.length <= 1200) {
    try { cfg = JSON.parse(Buffer.from(c, 'base64url').toString('utf8')); } catch { cfg = null; }
  }
  res.set({
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
  });
  res.send(renderSvg(cfg, String(req.query.s || 'idle')));
});

module.exports = router;
