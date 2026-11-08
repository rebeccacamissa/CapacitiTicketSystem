'use strict';
const { port } = require('./config/env');
const { getDb } = require('./db/connection');
const { createApp } = require('./app');

getDb(); // open DB + apply schema before accepting traffic

const server = createApp().listen(port, () => {
  console.log(`CAPACITI Support running at http://localhost:${port}`);
});

function shutdown() {
  server.close(() => {
    try { getDb().close(); } catch { /* already closed */ }
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
