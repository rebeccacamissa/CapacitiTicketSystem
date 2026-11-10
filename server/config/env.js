'use strict';
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const isProd = process.env.NODE_ENV === 'production';

if (isProd && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET must be set to at least 32 characters in production.');
}

const demoMode = process.env.DEMO_MODE === 'true' && (!isProd || process.env.ALLOW_DEMO_IN_PRODUCTION === 'true');

module.exports = {
  port: Number(process.env.PORT) || 3000,
  isProd,
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-do-not-use-in-production-0123456789',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  // Persistent Postgres (e.g. Neon). Without it, an in-process Postgres (PGlite) is used:
  // stored in PGLITE_DIR locally, which is NOT persistent on hosts with ephemeral disks.
  databaseUrl: process.env.DATABASE_URL || process.env.POSTGRES_URL || '',
  pgliteDir: path.resolve(__dirname, '..', '..', process.env.PGLITE_DIR || './data/pglite'),
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 12,
  // DEMO_MODE=true: one-click demo role sign-in and the "Preview as" switcher.
  // DEMO_MODE=false (production): individual accounts only; demo endpoints return 404.
  // In production demo mode additionally requires ALLOW_DEMO_IN_PRODUCTION=true.
  demoMode,
  // Public URL used in emails (password reset links). Falls back to Render's URL.
  appUrl: (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000').replace(/\/$/, ''),
  // Email via Resend. Without RESEND_API_KEY, emails are written to the server log instead.
  resendApiKey: process.env.RESEND_API_KEY || '',
  emailFrom: process.env.EMAIL_FROM || 'CAPACITI Support <onboarding@resend.dev>',
};
