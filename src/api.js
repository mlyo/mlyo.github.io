function normalizeError(data, status) {
  if (data?.error?.message) return data.error.message;
  if (typeof data?.error === 'string') return data.error;
  if (data?.message) return data.message;
  return `HTTP ${status}`;
}

async function parseResponse(res) {
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; }
  catch { data = text; }

  if (res.status === 401) {
    location.href = '/login';
    throw new Error('未授权，请重新登录');
  }
  if (!res.ok || data?.success === false) {
    throw new Error(normalizeError(data, res.status));
  }
  return data?.data ?? data;
}

export async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type') && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  const controller = new AbortController();
  const timeout = options.timeout || 20000;
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(path, { ...options, headers, credentials: 'same-origin', signal: controller.signal });
    return await parseResponse(res);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('请求超时');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  version: () => apiRequest('/api/version'),
  health: () => apiRequest('/api/health'),
  me: () => apiRequest('/api/auth/me'),
  getPool: (poolKey = 'pool') => apiRequest(`/api/get-pool?poolKey=${encodeURIComponent(poolKey)}`),
  loadRemoteUrl: ({ url, cfCountry = 'US', port = '443', defaultPort = '443', format = 'auto', ipColumn = '', portColumn = '', countryColumn = '' }) => apiRequest('/api/load-remote-url', {
    method: 'POST',
    body: JSON.stringify({ url, cfCountry, port, defaultPort, format, ipColumn, portColumn, countryColumn }),
    timeout: 30000
  }),
  savePool: ({ poolKey = 'pool', pool = '', mode = 'append' }) => apiRequest('/api/save-pool', { method: 'POST', body: JSON.stringify({ poolKey, pool, mode }) }),
  checkIP: (ip, useBackup = false) => apiRequest(`/api/check-ip?ip=${encodeURIComponent(ip)}&useBackup=${useBackup}`),
  maintain: () => apiRequest('/api/maintain?manual=true', { method: 'POST', timeout: 60000 }),
  currentStatus: (target = 0) => apiRequest(`/api/current-status?target=${encodeURIComponent(target)}`),
  lookupDomain: (domain) => apiRequest(`/api/lookup-domain?domain=${encodeURIComponent(domain)}`),
  getDomainPoolMapping: () => apiRequest('/api/get-domain-pool-mapping'),
  saveDomainPoolMapping: (mapping) => apiRequest('/api/save-domain-pool-mapping', { method: 'POST', body: JSON.stringify({ mapping }) }),
  createPool: (poolKey) => apiRequest('/api/create-pool', { method: 'POST', body: JSON.stringify({ poolKey }) }),
  deletePool: (poolKey) => apiRequest(`/api/delete-pool?poolKey=${encodeURIComponent(poolKey)}`, { method: 'POST' }),
  clearTrash: () => apiRequest('/api/clear-trash', { method: 'POST' }),
  logout: () => { location.href = '/logout'; }
};
