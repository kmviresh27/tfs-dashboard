import useStore from '../store/useStore.js';

/** Returns the active department id from the global store, or 'default'. */
export function getActiveDeptId() {
  return useStore.getState().activeDept?.id || 'default';
}

/**
 * Returns the API base prefix for the currently active department.
 * - default dept → '/api'
 * - non-default   → '/api/d/<deptId>'
 */
export function getApiPrefix() {
  const deptId = getActiveDeptId();
  return deptId === 'default' ? '/api' : `/api/d/${deptId}`;
}

/**
 * Rewrites a URL that starts with /api/ so it is scoped to the active dept.
 * Pass-through for already-scoped URLs or non-/api/ paths.
 */
function scopeUrl(url) {
  const prefix = getApiPrefix();
  if (prefix === '/api') return url;                    // default — no change
  if (!url.startsWith('/api/')) return url;             // non-API path — no change
  if (url.startsWith(`/api/d/`)) return url;            // already scoped — no change
  return prefix + url.slice(4);                         // /api/x → /api/d/<id>/x
}

// Auth endpoints that are expected to return 401 — never redirect from these
const AUTH_PATHS = ['/api/auth/me', '/api/auth/tfs-login', '/api/auth/tfs-check-user', '/api/auth/logout'];

function handleUnauthorized(url) {
  const plain = url.split('?')[0];
  if (AUTH_PATHS.some(p => plain.endsWith(p))) return; // login flow — no redirect
  // Avoid redirect loops if already on the login page
  if (window.location.pathname === '/login') return;
  // Navigate to login, preserving the current path so we can return after login
  window.location.href = '/login';
}

export async function apiFetch(url, options = {}) {
  const res = await fetch(scopeUrl(url), {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 401) {
    handleUnauthorized(url);
    throw new Error('Session expired — please log in again.');
  }
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

/** POST to switch the server-side session to a different department. */
export async function switchDeptApi(deptId) {
  const res = await fetch('/api/auth/switch-dept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deptId }),
  });
  if (res.status === 401) {
    handleUnauthorized('/api/auth/switch-dept');
    throw new Error('Session expired — please log in again.');
  }
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}
