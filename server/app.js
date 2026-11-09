'use strict';
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        // Inline style *attributes* drive progress widths / CSS variables (no script execution risk).
        styleSrcAttr: ["'unsafe-inline'"],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  }));
  // Ticket attachments (base64, up to 5 files x 5 MB) get a larger body limit than the rest of the API.
  const bigJson = express.json({ limit: '36mb' });
  app.use((req, res, next) => (/^\/api\/requests\/\d+\/attachments$/.test(req.path) ? bigJson(req, res, next) : next()));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/auth', require('./modules/auth/auth.routes'));
  app.use('/api/requests', require('./modules/requests/requests.routes'));
  app.use('/api/workflow', require('./modules/workflow/workflow.routes'));
  app.use('/api/analytics', require('./modules/analytics/analytics.routes'));
  app.use('/api/progress', require('./modules/progress/progress.routes'));
  app.use('/api/recruiter', require('./modules/recruiter/recruiter.routes'));
  app.use('/api/admin', require('./modules/admin/admin.routes'));
  app.use('/api/cammy', require('./modules/cammy/cammy.routes'));
  app.use('/api/events', require('./realtime/realtime.routes'));
  app.use('/api', require('./modules/avatar/avatar.routes')); // public avatar renderer
  // people.routes first: it serves the public /api/meta/options before requiring auth.
  app.use('/api', require('./modules/people/people.routes'));
  app.use('/api', require('./modules/engage/engage.routes'));
  app.use('/api', notFoundHandler);

  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'], index: 'index.html' }));
  app.use((req, res) => res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html')));

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
