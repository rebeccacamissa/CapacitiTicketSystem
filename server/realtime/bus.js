'use strict';
/**
 * Server-Sent Events hub. Each signed-in browser tab holds one EventSource
 * connection; services publish small "something changed" events and the
 * client refetches what it needs (no sensitive data travels in events).
 */
const clients = new Map(); // userId -> Set<{ res, role }>

function subscribe(user, res) {
  if (!clients.has(user.id)) clients.set(user.id, new Set());
  const entry = { res, role: user.role };
  clients.get(user.id).add(entry);
  return () => {
    const set = clients.get(user.id);
    set?.delete(entry);
    if (set && !set.size) clients.delete(user.id);
  };
}

/**
 * @param {'all'|'staff'|number[]} to
 * @param {string} type  e.g. 'request', 'notify', 'progress', 'feed', 'badge'
 * @param {object} data
 */
function publish(to, type, data = {}) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  const ids = Array.isArray(to) ? new Set(to.filter(Boolean)) : null;
  for (const [userId, set] of clients) {
    for (const c of set) {
      const match = to === 'all' || (to === 'staff' && c.role !== 'candidate') || (ids && ids.has(userId));
      if (match) c.res.write(payload);
    }
  }
}

const connectedCount = () => [...clients.values()].reduce((n, s) => n + s.size, 0);

module.exports = { subscribe, publish, connectedCount };
