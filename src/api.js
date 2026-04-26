function normalizeError(data, status) {
  if (data?.error?.message) return data.error.message;
  if (typeof data?.error === 'string') return data.error;
  if (data?.message) return data.message;
  return `HTTP ${status}`;
}

async function parseResponse(res) {
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (res.status === 401) {
    location.href = '/login';
    throw new Error('未授权，请重新登录');
  }
  if (!res.ok || data?.success === false) throw new Error(normalizeError(data, res.status));
  return data?.data ?? data;
}

export async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type') && typeof options.body === 'string') headers.set('Content-Type', 'application/json');
  const timeout = options.timeout || 30000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(path, { ...options, headers, credentials: 'same-origin', signal: controller.signal, cache: 'no-store' });
    return await parseResponse(res);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('请求超时');
    throw e;
  } finally { clearTimeout(timer); }
}

export const api = {
  health: () => apiRequest('/api/health'),
  version: () => apiRequest('/api/version'),
  config: () => apiRequest('/api/config'),
  pools: () => apiRequest('/api/pools'),
  getPool: (poolKey = 'pool') => apiRequest(`/api/get-pool?poolKey=${encodeURIComponent(poolKey)}`),
  savePool: ({ poolKey, pool, mode }) => apiRequest('/api/save-pool', { method: 'POST', body: JSON.stringify({ poolKey, pool, mode }) }),
  createPool: (poolKey) => apiRequest('/api/create-pool', { method: 'POST', body: JSON.stringify({ poolKey }) }),
  deletePool: (poolKey) => apiRequest(`/api/delete-pool?poolKey=${encodeURIComponent(poolKey)}`, { method: 'POST' }),
  clearTrash: () => apiRequest('/api/clear-trash', { method: 'POST' }),
  restoreTrash: (ips, targetPool = 'pool') => apiRequest('/api/restore-from-trash', { method: 'POST', body: JSON.stringify({ ips, targetPool }) }),
  loadRemote: (payload) => apiRequest('/api/load-remote-url', { method: 'POST', body: JSON.stringify(payload), timeout: 45000 }),
  resolveBatch: (targets) => apiRequest('/api/resolve-batch', { method: 'POST', body: JSON.stringify({ targets }), timeout: 45000 }),
  checkBatch: ({ targets, resolve }) => apiRequest('/api/check', { method: 'POST', body: JSON.stringify({ targets, resolve }), timeout: 120000 }),
  domainStatus: (domain) => apiRequest(`/api/domain/status?domain=${encodeURIComponent(domain)}`),
  getMapping: () => apiRequest('/api/get-domain-pool-mapping'),
  saveMapping: (mapping) => apiRequest('/api/save-domain-pool-mapping', { method: 'POST', body: JSON.stringify({ mapping }) }),
  maintain: () => apiRequest('/api/maintain?manual=true', { method: 'POST', timeout: 180000 }),
  logout: () => { location.href = '/logout'; }
};
