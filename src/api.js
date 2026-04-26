async function parseResponse(res) {
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; }
  catch { data = text; }
  if (res.status === 401) {
    location.href = '/login';
    throw new Error('未授权，请重新登录');
  }
  if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
  return data;
}

export async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type') && typeof options.body === 'string') headers.set('Content-Type', 'application/json');
  const res = await fetch(path, { ...options, headers, credentials: 'same-origin' });
  return parseResponse(res);
}

export const api = {
  getPool: (poolKey = 'pool') => apiRequest(`/api/get-pool?poolKey=${encodeURIComponent(poolKey)}`),
  loadRemoteUrl: ({ url, cfCountry = 'US', port = '443', defaultPort = '443', format = 'auto', ipColumn = '', portColumn = '', countryColumn = '' }) => apiRequest('/api/load-remote-url', {
    method: 'POST',
    body: JSON.stringify({ url, cfCountry, port, defaultPort, format, ipColumn, portColumn, countryColumn })
  }),
  savePool: ({ poolKey = 'pool', pool = '', mode = 'append' }) => apiRequest('/api/save-pool', { method: 'POST', body: JSON.stringify({ poolKey, pool, mode }) }),
  checkIP: (ip, useBackup = false) => apiRequest(`/api/check-ip?ip=${encodeURIComponent(ip)}&useBackup=${useBackup}`),
  maintain: () => apiRequest('/api/maintain?manual=true', { method: 'POST' }),
  currentStatus: (target = 0) => apiRequest(`/api/current-status?target=${encodeURIComponent(target)}`),
  lookupDomain: (domain) => apiRequest(`/api/lookup-domain?domain=${encodeURIComponent(domain)}`),
  getDomainPoolMapping: () => apiRequest('/api/get-domain-pool-mapping'),
  saveDomainPoolMapping: (mapping) => apiRequest('/api/save-domain-pool-mapping', { method: 'POST', body: JSON.stringify({ mapping }) }),
  createPool: (poolKey) => apiRequest('/api/create-pool', { method: 'POST', body: JSON.stringify({ poolKey }) }),
  deletePool: (poolKey) => apiRequest(`/api/delete-pool?poolKey=${encodeURIComponent(poolKey)}`, { method: 'POST' }),
  clearTrash: () => apiRequest('/api/clear-trash', { method: 'POST' }),
  logout: () => { location.href = '/logout'; }
};
