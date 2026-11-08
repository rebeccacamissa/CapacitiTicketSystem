'use strict';
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const isProd = process.env.NODE_ENV === 'production';

if (isProd && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET must be set to at least 32 characters in production.');
}

module.exports = {
  port: Number(process.env.PORT) || 3000,
  isProd,
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-do-not-use-in-production-0123456789',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  dbPath: path.resolve(__dirname, '..', '..', process.env.DB_PATH || './data/capaciti.db'),
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 12,
  // Demo role switcher (one-click sign-in as seeded demo accounts). Never enable in production.
  // In production it additionally requires ALLOW_DEMO_IN_PRODUCTION=true (e.g. an assessment/demo deployment).
  demoMode: process.env.DEMO_MODE === 'true' && (!isProd || process.env.ALLOW_DEMO_IN_PRODUCTION === 'true'),
  uploadDir: path.resolve(__dirname, '..', '..', process.env.UPLOAD_DIR || './data/uploads'),
};
