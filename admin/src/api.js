const DIRECT_CHECK_API_ENDPOINT = 'https://api.090227.xyz/check?proxyip=';
const DIRECT_CHECK_TIMEOUT = 30000;
const DIRECT_CHECK_CONCURRENCY = 8;

export function getAuthKey() { return ''; }
export function setAuthKey() {}
export function clearAuth() {
  sessionStorage.removeItem('DDNS_AUTH_KEY');
  localStorage.removeItem('DDNS_AUTH_KEY');
}

function loginUrlForCurrentPage() {
  const login = new URL('/login', location.origin);
  login.searchParams.set('redirect', location.pathname + location.search + location.hash || '/admin/');
  return login.pathname + login.search;
}

function apiUrl(path) {
  const p = String(path || '');
  return p.startsWith('/') ? p : '/' + p;
}

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
    clearAuth();
    location.href = loginUrlForCurrentPage();
    throw new Error('未授权，请重新登录');
  }
  if (!res.ok || data?.success === false) throw new Error(normalizeError(data, res.status));
  return data?.data ?? data;
}

export async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type') && typeof options.body === 'string') headers.set('Content-Type', 'application/json');

  const key = getAuthKey();
  if (key && !headers.has('X-Auth-Key')) headers.set('X-Auth-Key', key);

  const timeout = options.timeout || 30000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(apiUrl(path), {
      ...options,
      headers,
      credentials: 'same-origin',
      signal: options.signal || controller.signal,
      cache: 'no-store'
    });
    return await parseResponse(res);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('请求超时');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function getCheckConfig() {
  return {
    publicCheckApi: DIRECT_CHECK_API_ENDPOINT,
    timeout: DIRECT_CHECK_TIMEOUT,
    concurrency: DIRECT_CHECK_CONCURRENCY
  };
}

function buildPublicCheckUrl(apiBase, target) {
  const base = String(apiBase || '').trim();
  if (!base) throw new Error('未配置直连检测接口');
  const encoded = encodeURIComponent(target);
  if (base.includes('{proxyip}')) return base.replace('{proxyip}', encoded);
  if (base.includes('proxyip=')) return base + encoded;
  return base + (base.includes('?') ? '&' : '?') + 'proxyip=' + encoded;
}

async function readJsonResponse(res) {
  const text = await res.text();
  try { return text ? JSON.parse(text) : null; }
  catch { return { success: false, message: '检测接口没有返回有效 JSON', raw: text }; }
}

export function normalizeCheckResult(data, target, source = 'direct') {
  const payload = data?.data ?? data ?? {};
  const probe = payload.probe_results || payload.probeResults || {};
  const ipv4Ok = Boolean(payload.supports_ipv4 ?? payload.supportsIPv4 ?? probe.ipv4?.ok);
  const ipv6Ok = Boolean(payload.supports_ipv6 ?? payload.supportsIPv6 ?? probe.ipv6?.ok);
  const success = Boolean(payload.success === true || payload.ok === true || payload.status === 'success' || ipv4Ok || ipv6Ok);
  const exits = [];
  if (Array.isArray(payload.exits)) exits.push(...payload.exits.filter(Boolean));
  if (probe.ipv4?.exit) exits.push({ stack: 'ipv4', ...probe.ipv4.exit });
  if (probe.ipv6?.exit) exits.push({ stack: 'ipv6', ...probe.ipv6.exit });
  if (!exits.length && payload.exit) exits.push({ stack: payload.ipType || 'exit', ...payload.exit });
  if (!exits.length && (payload.exitIP || payload.ip || payload.country || payload.city || payload.asn || payload.org)) {
    exits.push({ stack: payload.ipType || 'exit', ip: payload.exitIP || payload.ip || '', country: payload.country || '', city: payload.city || '', asn: payload.asn || '', asOrganization: payload.asOrganization || payload.org || '' });
  }
  const colo = payload.colo || payload.cfColo || exits.map(e => e.colo).filter(Boolean).join(',') || '';
  const responseTime = payload.responseTime ?? payload.time ?? payload.ms ?? payload.latency ?? '';
  return {
    target: payload.candidate || payload.target || payload.address || target,
    success,
    source,
    responseTime,
    colo,
    supportsIpv4: ipv4Ok,
    supportsIpv6: ipv6Ok,
    exits,
    message: payload.message || payload.error || (success ? 'OK' : '检测未通过')
  };
}

export async function checkProxyDirect(target, options = {}) {
  const timeout = Number(options.timeout || getCheckConfig().timeout || 30000);
  const controller = new AbortController();
  const linkedSignal = options.signal;
  const abort = () => controller.abort();
  if (linkedSignal) {
    if (linkedSignal.aborted) controller.abort();
    else linkedSignal.addEventListener('abort', abort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(buildPublicCheckUrl(options.publicCheckApi || getCheckConfig().publicCheckApi, target), {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal
    });
    const data = await readJsonResponse(res);
    if (!res.ok) data.success = false;
    const normalized = normalizeCheckResult(data, target, 'direct');
    if (!res.ok) normalized.message = normalized.message || `HTTP ${res.status}`;
    return normalized;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('前端直连检测超时');
    throw e;
  } finally {
    clearTimeout(timer);
    if (linkedSignal) linkedSignal.removeEventListener('abort', abort);
  }
}

export const api = {
  login: (password) => apiRequest('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
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
  async logout() {
    try { await apiRequest('/api/auth/logout', { method: 'POST' }); } catch {}
    clearAuth();
    location.href = loginUrlForCurrentPage();
  }
};
