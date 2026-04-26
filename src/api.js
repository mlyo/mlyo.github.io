export function getApiBase() {
  return (localStorage.getItem('API_BASE') || '').replace(/\/$/, '');
}

export function getAuthKey() {
  return localStorage.getItem('AUTH_KEY') || '';
}

export function saveConfig(apiBase, authKey) {
  localStorage.setItem('API_BASE', (apiBase || '').trim().replace(/\/$/, ''));
  localStorage.setItem('AUTH_KEY', (authKey || '').trim());
}

export function clearConfig() {
  localStorage.removeItem('API_BASE');
  localStorage.removeItem('AUTH_KEY');
}

export async function apiRequest(path, options = {}) {
  const apiBase = getApiBase();
  const authKey = getAuthKey();

  if (!apiBase) throw new Error('请先填写 Worker API 地址');

  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (authKey) headers.set('X-Auth-Key', authKey);

  const res = await fetch(`${apiBase}${path}`, { ...options, headers });
  const text = await res.text();
  let data = null;

  try { data = text ? JSON.parse(text) : null; }
  catch { data = text; }

  if (!res.ok) {
    throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
  }
  return data;
}

export const api = {
  ping() {
    return apiRequest('/');
  },
  getPool(poolKey = 'pool') {
    return apiRequest(`/api/get-pool?poolKey=${encodeURIComponent(poolKey)}`);
  },
  savePool({ poolKey = 'pool', pool = '', mode = 'append' }) {
    return apiRequest('/api/save-pool', {
      method: 'POST',
      body: JSON.stringify({ poolKey, pool, mode })
    });
  },
  checkIP(ip, useBackup = false) {
    return apiRequest(`/api/check-ip?ip=${encodeURIComponent(ip)}&useBackup=${useBackup}`);
  },
  maintain() {
    return apiRequest('/api/maintain?manual=true', { method: 'POST' });
  },
  currentStatus(target = 0) {
    return apiRequest(`/api/current-status?target=${encodeURIComponent(target)}`);
  },
  lookupDomain(domain) {
    return apiRequest(`/api/lookup-domain?domain=${encodeURIComponent(domain)}`);
  },
  getDomainPoolMapping() {
    return apiRequest('/api/get-domain-pool-mapping');
  },
  saveDomainPoolMapping(mapping) {
    return apiRequest('/api/save-domain-pool-mapping', {
      method: 'POST',
      body: JSON.stringify({ mapping })
    });
  },
  createPool(poolKey) {
    return apiRequest('/api/create-pool', {
      method: 'POST',
      body: JSON.stringify({ poolKey })
    });
  },
  deletePool(poolKey) {
    return apiRequest(`/api/delete-pool?poolKey=${encodeURIComponent(poolKey)}`, { method: 'POST' });
  },
  clearTrash() {
    return apiRequest('/api/clear-trash', { method: 'POST' });
  },
  restoreFromTrash({ ips, restoreToSource = true, targetPool = 'pool' }) {
    return apiRequest('/api/restore-from-trash', {
      method: 'POST',
      body: JSON.stringify({ ips, restoreToSource, targetPool })
    });
  }
};
