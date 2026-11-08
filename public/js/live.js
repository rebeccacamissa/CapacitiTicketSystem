// Live updates over Server-Sent Events. Pages subscribe with onLive('request', fn).
const TYPES = ['request', 'notify', 'progress', 'feed', 'xp', 'people'];
let source = null;

export function startLive() {
  if (source || !('EventSource' in window)) return;
  source = new EventSource('/api/events');
  const setStatus = (on) => document.dispatchEvent(new CustomEvent('live:status', { detail: { connected: on } }));
  source.addEventListener('hello', () => setStatus(true));
  source.onerror = () => setStatus(false); // the browser reconnects automatically
  for (const t of TYPES) {
    source.addEventListener(t, (e) => {
      let data = {};
      try { data = JSON.parse(e.data); } catch { /* ignore */ }
      document.dispatchEvent(new CustomEvent(`live:${t}`, { detail: data }));
    });
  }
  addEventListener('beforeunload', () => source?.close());
}

/** Subscribe to a live event type; rapid bursts are debounced. Returns an unsubscribe fn. */
export function onLive(type, fn, wait = 250) {
  let timer;
  const handler = (e) => { clearTimeout(timer); timer = setTimeout(() => fn(e.detail), wait); };
  document.addEventListener(`live:${type}`, handler);
  return () => document.removeEventListener(`live:${type}`, handler);
}
