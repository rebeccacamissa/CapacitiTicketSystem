'use strict';
const { port, databaseUrl } = require('./config/env');
const { initDb, getDb } = require('./db/connection');
const { createApp } = require('./app');

(async () => {
  await initDb(); // connect + apply schema before accepting traffic
  console.log(databaseUrl ? 'Database: Postgres (DATABASE_URL)' : 'Database: embedded Postgres (PGlite). Set DATABASE_URL for persistent storage.');
  const server = createApp().listen(port, () => {
    console.log(`CAPACITI Support running at http://localhost:${port}`);
  });

  const shutdown = () => {
    server.close(async () => {
      try { await getDb().close(); } catch { /* already closed */ }
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
