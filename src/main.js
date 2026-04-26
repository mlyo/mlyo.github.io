import { api } from './api.js';

const $ = (id) => document.getElementById(id);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const pretty = (data) => typeof data === 'string' ? data : JSON.stringify(data, null, 2);
let lastCheckResults = [];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function formatMs(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? `${Math.round(n)} ms` : '-';
}

const FRONTEND_CHECK_API = 'https://cf.090227.xyz/check?proxyip=';
const FRONTEND_CHECK_API_BACKUP = 'https://api.090227.xyz/check?proxyip=';

function getFrontendConcurrency() {
  const n = Number($('frontendConcurrency')?.value || 20);
  if (!Number.isFinite(n)) return 20;
  return Math.max(1, Math.min(50, Math.floor(n)));
}

function normalizeExternalCheckResult(raw, candidate, source, responseTime) {
  const probe = raw?.probe_results || {};
  const ipv4 = probe.ipv4 || {};
  const ipv6 = probe.ipv6 || {};
  const light = ipv4.ip ? ipv4 : (ipv6.ip ? ipv6 : {});
  return {
    candidate: String(raw?.candidate || candidate || ''),
    success: raw?.success === true,
    source,
    proxyIP: String(raw?.proxyIP || raw?.proxyip || ''),
    portRemote: Number(raw?.portRemote || raw?.port || parsePortFromTarget(candidate) || 443),
    responseTime: Number(raw?.responseTime || responseTime || 0),
    colo: String(raw?.colo || light.colo || ''),
    message: String(raw?.message || ''),
    ip: String(light.ip || raw?.ip || ''),
    ipType: String(light.ipType || raw?.ipType || ''),
    asn: light.asn ?? raw?.asn ?? null,
    asOrganization: String(light.asOrganization || light.org || raw?.asOrganization || raw?.org || ''),
    country: String(light.country || raw?.country || ''),
    region: String(light.region || light.regionCode || raw?.region || raw?.regionCode || ''),
    city: String(light.city || raw?.city || '')
  };
}

function parsePortFromTarget(target) {
  const text = String(target || '').split('#')[0].trim();
  const m6 = text.match(/^\[[^\]]+\]:(\d+)$/);
  if (m6) return Number(m6[1]);
  const colonCount = (text.match(/:/g) || []).length;
  if (colonCount === 1) {
    const maybe = Number(text.slice(text.lastIndexOf(':') + 1));
    if (Number.isInteger(maybe) && maybe >= 1 && maybe <= 65535) return maybe;
  }
  return 443;
}

async function callExternalCheck(candidate, source = 'main') {
  const base = source === 'backup' ? FRONTEND_CHECK_API_BACKUP : FRONTEND_CHECK_API;
  const started = performance.now();
  const res = await fetch(base + encodeURIComponent(candidate), { cache: 'no-store' });
  const text = await res.text();
  let raw;
  try { raw = text ? JSON.parse(text) : {}; }
  catch { raw = { success: false, message: text || '检测接口返回非 JSON' }; }
  if (!res.ok) raw = { ...raw, success: false, message: raw.message || ('HTTP ' + res.status) };
  return normalizeExternalCheckResult(raw, candidate, source, performance.now() - started);
}

async function checkOneCandidate(candidate, useBackupOnly = false) {
  if (useBackupOnly) return callExternalCheck(candidate, 'backup');
  try {
    const main = await callExternalCheck(candidate, 'main');
    if (main.success === true) return main;
    try {
      const backup = await callExternalCheck(candidate, 'backup');
      return backup.success === true ? backup : { ...main, source: 'main', message: main.message || backup.message || '主备接口均未返回 success=true' };
    } catch (e) {
      return { ...main, message: main.message || e.message || '备用接口异常' };
    }
  } catch (e) {
    try { return await callExternalCheck(candidate, 'backup'); }
    catch (be) { return { candidate, success: false, source: 'main', responseTime: 0, portRemote: parsePortFromTarget(candidate), message: be.message || e.message || '检测失败' }; }
  }
}

async function runWithConcurrency(items, limit, worker, onProgress) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      try { results[index] = await worker(items[index], index); }
      catch (e) { results[index] = { candidate: items[index], success: false, message: e.message || '检测失败' }; }
      done += 1;
      onProgress?.(done, items.length, results[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function collectResolvedTargets(resolveData, fallbackInputs) {
  if (!resolveData) return fallbackInputs;
  const out = [];
  const push = v => { const s = String(v || '').trim(); if (s && !out.includes(s)) out.push(s); };
  if (Array.isArray(resolveData.targets)) resolveData.targets.forEach(push);
  if (Array.isArray(resolveData.results)) {
    for (const item of resolveData.results) (item.targets || []).forEach(push);
  }
  return out.length ? out : fallbackInputs;
}


function toast(message, type = 'ok') {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast show ${type}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.className = 'toast'; }, 2400);
}

async function run(label, fn) {
  try {
    const result = await fn();
    if (label) toast(label);
    return result;
  } catch (e) {
    toast(e.message || '操作失败', 'err');
    throw e;
  }
}

function switchPanel(name) {
  $$('.nav').forEach(btn => btn.classList.toggle('active', btn.dataset.panel === name));
  $$('.panel').forEach(panel => panel.classList.toggle('active', panel.id === `panel-${name}`));
}

function normalizeLines(text) {
  const seen = new Set();
  const lines = [];
  for (const raw of (text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    const key = line.split('#')[0].trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  return lines;
}

function selectedPoolKey() {
  const sel = $('poolSelect');
  if (sel.value === '__custom__') return normalizePoolName($('customPoolKey').value);
  return sel.value || 'pool';
}

function normalizePoolName(name) {
  let v = String(name || '').trim();
  if (!v) return 'pool';
  if (v === 'pool' || v === 'pool_trash') return v;
  v = v.replace(/[^\u4e00-\u9fa5a-zA-Z0-9_-]/g, '_');
  return v.startsWith('pool_') ? v : `pool_${v}`;
}

function setCurrentPool(key) {
  const sel = $('poolSelect');
  if ([...sel.options].some(o => o.value === key)) {
    sel.value = key;
    $('customPoolKey').classList.add('hidden');
  } else {
    sel.value = '__custom__';
    $('customPoolKey').classList.remove('hidden');
    $('customPoolKey').value = key;
  }
  updateSummary(key, $('poolCount').textContent);
}

function updateSummary(key, count) {
  $('summaryPool').textContent = key || 'pool';
  $('poolKeyLabel').textContent = key || 'pool';
  $('summaryCount').textContent = count ?? '-';
}

async function refreshPools(prefer) {
  const data = await api.pools();
  const pools = data.pools || ['pool', 'pool_trash'];
  const sel = $('poolSelect');
  const current = prefer || selectedPoolKey();
  sel.innerHTML = pools.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('') + '<option value="__custom__">自定义...</option>';
  setCurrentPool(pools.includes(current) ? current : current || data.defaultPool || 'pool');
}

async function refreshPoolView(prefer = selectedPoolKey()) {
  await refreshPools(prefer);
  await loadPool(prefer);
  toast('IP 池已同步');
}

async function bootStatus() {
  try {
    const [version, health] = await Promise.all([api.version(), api.health()]);
    $('summaryVersion').textContent = version.version || '-';
    const kvText = health.kv ? `KV 正常${health.kvBinding ? ' · ' + health.kvBinding : ''}` : `KV 异常${health.kvBinding ? ' · ' + health.kvBinding : ''}`;
    $('healthBadge').textContent = kvText;
    $('healthBadge').className = `badge ${health.kv ? 'ok' : 'bad'}`;
  } catch (e) {
    $('healthBadge').textContent = `状态异常 · ${e.message || '接口不可用'}`;
    $('healthBadge').className = 'badge bad';
  }
}

async function loadPool(key = selectedPoolKey()) {
  key = normalizePoolName(key);
  const data = await run('', () => api.getPool(key));
  $('poolText').value = data.pool || '';
  $('poolCount').textContent = data.count ?? 0;
  updateSummary(key, data.count ?? 0);
  setCurrentPool(key);
  toast(`已加载 ${key}`);
}

async function savePool(mode) {
  const key = selectedPoolKey();
  if (mode === 'replace' && !confirm(`确认覆盖 ${key}？原内容会被替换。`)) return;
  if (mode === 'remove' && !confirm(`确认从 ${key} 删除文本框中的 IP？`)) return;
  await run('保存成功', () => api.savePool({ poolKey: key, pool: $('poolText').value, mode }));
  await refreshPoolView(key).catch(() => {});
}

function formatPoolText() {
  const lines = normalizeLines($('poolText').value);
  $('poolText').value = lines.join('\n');
  $('poolCount').textContent = lines.length;
  updateSummary(selectedPoolKey(), lines.length);
  toast(`已去重格式化：${lines.length} 条`);
}

async function loadRemote({ autoSave = false } = {}) {
  const url = $('remoteUrl').value.trim();
  const cfCountry = $('remoteCountry').value.trim() || 'US';
  const port = $('remotePort').value.trim() || '443';
  const defaultPort = port;
  const format = $('remoteFormat')?.value || 'auto';
  if (!url) throw new Error('请填写远程地址');

  $('remotePreview').textContent = '远程加载中...';
  const data = await run('', () => api.loadRemoteUrl({ url, cfCountry, port, defaultPort, format }));
  const ips = data.ips || '';
  if (!ips) {
    $('remotePreview').textContent = pretty(data);
    toast(`没有匹配 CF归属国=${cfCountry} 且端口=${port} 的 IP`, 'err');
    return;
  }

  const lines = normalizeLines(ips);
  $('remotePreview').textContent = `匹配数量：${lines.length}\n\n${lines.slice(0, 60).join('\n')}${lines.length > 60 ? '\n...' : ''}`;

  const current = $('poolText').value.trim();
  $('poolText').value = current ? `${current}\n${lines.join('\n')}` : lines.join('\n');
  formatPoolText();

  if (autoSave) {
    const key = selectedPoolKey();
    await run('远程 IP 已追加保存', () => api.savePool({ poolKey: key, pool: lines.join('\n'), mode: 'append' }));
    await refreshPoolView(key).catch(() => {});
  } else {
    toast(`已预览并放入编辑框：${lines.length} 条`);
  }
}

function getCheckInputs() {
  return normalizeLines($('checkTargets').value).map(line => line.split('#')[0].trim()).filter(Boolean);
}

function renderResolveResult(data) {
  const items = data.results || [{ input: data.input, targets: data.targets || [] }];
  const html = items.map(item => `<div class="resolve-item"><b>${escapeHtml(item.input)}</b><div>${item.error ? `<span class="bad-text">${escapeHtml(item.error)}</span>` : (item.targets || []).map(t => `<code>${escapeHtml(t)}</code>`).join(' ')}</div></div>`).join('');
  $('resolveResult').innerHTML = html || '无解析结果';
}

function targetLineFromResult(r) {
  const target = r.candidate || `${r.proxyIP || r.ip}:${r.portRemote || 443}`;
  const meta = [r.country, r.region, r.city, r.asn ? `AS${r.asn}` : '', r.asOrganization].filter(Boolean).join(' ');
  return meta ? `${target}#${meta}` : target;
}

function renderCheckResults(results) {
  lastCheckResults = results || [];
  if (!lastCheckResults.length) {
    $('checkResult').innerHTML = '<div class="muted">没有检测结果</div>';
    return;
  }
  $('checkResult').innerHTML = lastCheckResults.map(r => {
    const ok = r.success === true;
    const location = [r.country, r.region, r.city].filter(Boolean).join(' / ') || '-';
    const asn = [r.asn ? `AS${r.asn}` : '', r.asOrganization].filter(Boolean).join(' · ') || '-';
    return `<article class="check-card ${ok ? 'ok' : 'bad'}">
      <div class="check-title">${ok ? '可用' : '不可用'} · ${r.source === 'backup' ? '备用接口' : '主接口'}</div>
      <dl>
        <div><dt>候选目标</dt><dd>${escapeHtml(r.candidate || '-')}</dd></div>
        <div><dt>出口 IP</dt><dd>${escapeHtml(r.ip || r.proxyIP || '-')} ${escapeHtml(r.ipType || '')}</dd></div>
        <div><dt>目标端口</dt><dd>${escapeHtml(r.portRemote ?? '-')}</dd></div>
        <div><dt>CF 机房</dt><dd>${escapeHtml(r.colo || '-')}</dd></div>
        <div><dt>位置</dt><dd>${escapeHtml(location)}</dd></div>
        <div><dt>ASN</dt><dd>${escapeHtml(asn)}</dd></div>
        <div><dt>耗时</dt><dd>${escapeHtml(formatMs(r.responseTime))}</dd></div>
        ${r.message ? `<div><dt>说明</dt><dd>${escapeHtml(r.message)}</dd></div>` : ''}
      </dl>
    </article>`;
  }).join('');
}

async function resolveTargets() {
  const inputs = getCheckInputs();
  if (!inputs.length) throw new Error('请输入检测目标');
  $('resolveResult').textContent = '解析中...';
  const data = inputs.length === 1 ? await api.resolve(inputs[0]) : await api.resolveBatch(inputs);
  renderResolveResult(data);
  return data;
}

async function checkTargets() {
  const inputs = getCheckInputs();
  if (!inputs.length) throw new Error('请输入检测目标');

  $('checkResult').innerHTML = '<div class="check-progress">准备检测...</div>';
  $('resolveResult').textContent = $('skipResolve').checked ? '已跳过解析' : '解析候选中...';

  let resolveData = null;
  if (!$('skipResolve').checked) {
    resolveData = inputs.length === 1 ? await api.resolve(inputs[0]) : await api.resolveBatch(inputs);
    renderResolveResult(resolveData);
  }

  const candidates = collectResolvedTargets(resolveData, inputs);
  if (!candidates.length) throw new Error('没有可检测候选');

  const concurrency = getFrontendConcurrency();
  const useBackupOnly = $('useBackup').checked;
  lastCheckResults = [];
  renderCheckResults([]);
  $('checkResult').innerHTML = '<div class="check-progress">检测中：0 / ' + candidates.length + '，并发 ' + concurrency + '</div>';

  const results = await runWithConcurrency(
    candidates,
    concurrency,
    (candidate) => checkOneCandidate(candidate, useBackupOnly),
    (done, total, result) => {
      lastCheckResults.push(result);
      renderCheckResults(lastCheckResults);
      $('checkResult').insertAdjacentHTML('afterbegin', '<div class="check-progress">检测中：' + done + ' / ' + total + '，可用 ' + lastCheckResults.filter(r => r.success).length + '</div>');
    }
  );

  renderCheckResults(results);
  const successCount = results.filter(r => r.success === true).length;
  toast('检测完成：可用 ' + successCount + ' / ' + results.length);
}

async function copyGoodResults() {
  const lines = lastCheckResults.filter(r => r.success).map(targetLineFromResult);
  if (!lines.length) throw new Error('没有可复制的成功项');
  await navigator.clipboard.writeText(lines.join('\n'));
  toast(`已复制 ${lines.length} 条`);
}

async function addGoodToPool() {
  const lines = lastCheckResults.filter(r => r.success).map(targetLineFromResult);
  if (!lines.length) throw new Error('没有可加入的成功项');
  const key = selectedPoolKey();
  await api.savePool({ poolKey: key, pool: lines.join('\n'), mode: 'append' });
  await refreshPoolView(key).catch(() => {});
  toast(`已加入当前池：${lines.length} 条`);
}

async function domainStatus() {
  const domain = $('domainStatusInput').value.trim();
  if (!domain) throw new Error('请输入域名');
  $('domainStatusResult').textContent = '查询中...';
  const data = await api.domainStatus(domain);
  $('domainStatusResult').textContent = pretty(data);
}

async function maintain() {
  if (!confirm('确认立即执行维护？建议先确认 IP 池和映射配置无误。')) return;
  $('logs').textContent = '维护中...';
  const data = await run('维护完成', () => api.maintain());
  const logs = data.allLogs || data.reports?.flatMap(r => r.logs || []) || [];
  $('logs').textContent = logs.length ? logs.join('\n') : pretty(data);
  await refreshPoolView(selectedPoolKey()).catch(() => {});
}

async function loadMapping() {
  const data = await run('映射已加载', () => api.getDomainPoolMapping());
  $('mappingText').value = JSON.stringify(data.mapping || {}, null, 2);
}

async function saveMapping() {
  let mapping;
  try { mapping = JSON.parse($('mappingText').value || '{}'); }
  catch { throw new Error('映射不是有效 JSON'); }
  if (!confirm('确认保存域名与 IP 池映射？')) return;
  await run('映射已保存', () => api.saveDomainPoolMapping(mapping));
}

async function copyLogs() {
  const text = ($('logs')?.innerText || $('logs')?.textContent || '').trim();
  if (!text || text === '暂无日志') throw new Error('暂无日志可复制');
  await navigator.clipboard.writeText(text);
  toast('日志已复制');
}

function clearLogs() {
  $('logs').textContent = '暂无日志';
  toast('日志已清空');
}

function bind() {
  $$('.nav').forEach(btn => btn.onclick = () => switchPanel(btn.dataset.panel));
  $$('[data-go]').forEach(btn => btn.onclick = () => switchPanel(btn.dataset.go));
  $('btnLogout').onclick = () => api.logout();
  $('btnRefreshAll').onclick = () => { bootStatus(); refreshPools().then(() => loadPool()).catch(() => {}); };
  $('poolSelect').onchange = () => {
    $('customPoolKey').classList.toggle('hidden', $('poolSelect').value !== '__custom__');
    updateSummary(selectedPoolKey(), $('poolCount').textContent);
  };
  $('customPoolKey').oninput = () => updateSummary(selectedPoolKey(), $('poolCount').textContent);
  $('btnLoadPool').onclick = () => loadPool().catch(() => {});
  $('btnFormatPool').onclick = () => formatPoolText();
  $('btnAppend').onclick = () => savePool('append').catch(() => {});
  $('btnReplace').onclick = () => savePool('replace').catch(() => {});
  $('btnRemove').onclick = () => savePool('remove').catch(() => {});
  $('btnLoadRemote').onclick = () => loadRemote({ autoSave: false }).catch(() => {});
  $('btnLoadRemoteAppend').onclick = () => loadRemote({ autoSave: true }).catch(() => {});
  $('btnLoadTrash').onclick = () => { setCurrentPool('pool_trash'); switchPanel('pool'); loadPool('pool_trash').catch(() => {}); };
  $('btnClearTrash').onclick = async () => { if (!confirm('确定清空垃圾桶？此操作不可恢复。')) return; await run('垃圾桶已清空', () => api.clearTrash()).catch(() => {}); await refreshPoolView(selectedPoolKey()).catch(() => {}); };
  $('btnCreatePool').onclick = async () => { const key = selectedPoolKey(); await run('IP 池已创建', () => api.createPool(key)).catch(() => {}); await refreshPools(key).catch(() => {}); loadPool(key).catch(() => {}); };
  $('btnDeletePool').onclick = async () => { const key = selectedPoolKey(); if (!confirm(`确定删除 ${key}？`)) return; await run('IP 池已删除', () => api.deletePool(key)).catch(() => {}); await refreshPools('pool').catch(() => {}); loadPool('pool').catch(() => {}); };
  $('btnResolveTargets').onclick = () => resolveTargets().catch(e => toast(e.message, 'err'));
  $('btnCheckTargets').onclick = () => checkTargets().catch(e => toast(e.message, 'err'));
  $('btnCopyGood').onclick = () => copyGoodResults().catch(e => toast(e.message, 'err'));
  $('btnAddGoodToPool').onclick = () => addGoodToPool().catch(e => toast(e.message, 'err'));
  $('btnDomainStatus').onclick = () => domainStatus().catch(e => toast(e.message, 'err'));
  $('btnStatus').onclick = async () => { $('statusResult').textContent = '查询中...'; const data = await run('', () => api.currentStatus($('targetIndex').value.trim() || 0)).catch(e => ({ error: e.message })); $('statusResult').textContent = pretty(data); };
  $('btnMaintain').onclick = () => maintain().catch(() => {});
  $('btnCopyLogs').onclick = () => copyLogs().catch(e => toast(e.message, 'err'));
  $('btnClearLogs').onclick = () => clearLogs();
  $('btnLoadMapping').onclick = () => loadMapping().catch(() => {});
  $('btnSaveMapping').onclick = () => saveMapping().catch(e => toast(e.message, 'err'));
}

bind();
bootStatus();
refreshPools().then(() => loadPool()).catch(() => loadPool().catch(() => {}));
