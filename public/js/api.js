// Fetch-based API client. The JWT lives in an httpOnly cookie, so no token handling here.
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Timestamp of this tab's last write — lets live handlers skip "updated by someone" toasts for our own changes. */
export const activity = { lastWrite: 0 };

export async function api(path, { method = 'GET', body, query } = {}) {
  if (method !== 'GET') activity.lastWrite = Date.now();
  let url = `/api${path}`;
  if (query) {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    if ([...qs].length) url += `?${qs}`;
  }
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data.error || {};
    if (res.status === 401 && !['/', '/index', '/register'].includes(location.pathname)) {
      location.href = `/?next=${encodeURIComponent(location.pathname + location.search)}`;
    }
    if (e.code === 'PASSWORD_CHANGE_REQUIRED' && location.pathname !== '/change-password') {
      location.href = '/change-password';
    }
    throw new ApiError(res.status, e.code || 'ERROR', e.message || 'Request failed', e.details);
  }
  return data;
}
