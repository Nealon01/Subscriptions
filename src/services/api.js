const API_BASE = '/api';
const AUTH_BASE = '/auth';

function headers(sessionId) {
  const h = { 'Content-Type': 'application/json' };
  if (sessionId) {
    h['x-session-id'] = sessionId;
  }
  return h;
}

export async function checkAuth(sessionId) {
  const resp = await fetch(`${AUTH_BASE}/status`, {
    headers: headers(sessionId),
  });
  if (!resp.ok) return { authenticated: false };
  return resp.json();
}

export async function getLoginUrl() {
  const returnUrl = encodeURIComponent(window.location.origin);
  const resp = await fetch(`${AUTH_BASE}/login?returnUrl=${returnUrl}`);
  if (!resp.ok) throw new Error('Failed to get login URL');
  return resp.json();
}

export async function getFeed() {
  const resp = await fetch(`${API_BASE}/feed`);
  if (!resp.ok) return null;
  return resp.json();
}

export async function triggerRefresh(sessionId) {
  const resp = await fetch(`${API_BASE}/feed/refresh`, {
    method: 'POST',
    headers: headers(sessionId),
  });

  if (resp.status === 401) {
    throw new Error('SESSION_EXPIRED');
  }

  if (!resp.ok) throw new Error('Failed to start refresh');
  return resp.json();
}

export async function getSettings(sessionId) {
  const resp = await fetch(`${API_BASE}/settings`, {
    headers: headers(sessionId),
  });
  if (!resp.ok) return null;
  return resp.json();
}

export async function saveSettings(sessionId, settings) {
  const resp = await fetch(`${API_BASE}/settings`, {
    method: 'POST',
    headers: headers(sessionId),
    body: JSON.stringify(settings),
  });
  if (!resp.ok) throw new Error('Failed to save settings');
  return resp.json();
}

export async function ensurePlaylist(sessionId) {
  const resp = await fetch(`${API_BASE}/playlist/ensure`, {
    method: 'POST',
    headers: headers(sessionId),
  });
  if (!resp.ok) throw new Error('Failed to ensure playlist');
  return resp.json();
}

export async function addToPlaylist(sessionId, playlistId, videoId) {
  const resp = await fetch(`${API_BASE}/playlist/add`, {
    method: 'POST',
    headers: headers(sessionId),
    body: JSON.stringify({ playlistId, videoId }),
  });
  if (!resp.ok) throw new Error('Failed to add to playlist');
  return resp.json();
}

export async function removeFromPlaylist(sessionId, playlistId, videoId) {
  const resp = await fetch(`${API_BASE}/playlist/remove`, {
    method: 'POST',
    headers: headers(sessionId),
    body: JSON.stringify({ playlistId, videoId }),
  });
  if (!resp.ok) throw new Error('Failed to remove from playlist');
  return resp.json();
}

export async function getPlaylistItems(sessionId, playlistId) {
  const resp = await fetch(`${API_BASE}/playlist/items?playlistId=${playlistId}`, {
    headers: headers(sessionId),
  });

  if (resp.status === 401) {
    throw new Error('SESSION_EXPIRED');
  }

  if (!resp.ok) throw new Error('Failed to fetch playlist items');
  return resp.json();
}

export async function getQuota() {
  const resp = await fetch(`${API_BASE}/quota`);
  if (!resp.ok) return null;
  return resp.json();
}
