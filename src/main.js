import { api } from './api.js';

window.__DDNS_PRO_BOOTED = true;

const $ = (id) => document.getElementById(id);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const pretty = (data) => typeof data === 'string' ? data : JSON.stringify(data, null, 2);
let lastCheckResults = [];
let checkRunToken = 0;
let checkRunning = false;
const checkFilters = { status: 'all', source: 'all', country: 'all', colo: 'all', keyword: '' };
const checkProgress = { total: 0, done: 0, success: 0, failed: 0 };

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
  const n = Number($('frontendConcurrency')?.value || 30);
  if (!Number.isFinite(n)) return 30;
  return Math.max(1, Math.min(200, Math.floor(n)));
}

function normalizeExternalCheckResult(raw, candidate, source, responseTime) {
  if (!raw || typeof raw !== 'object') {
    return {
      candidate: String(candidate || ''),
      success: false,
      source,
      proxyIP: '',
      portRemote: parsePortFromTarget(candidate),
      responseTime: Number(responseTime || 0),
      checkColo: '',
      exitColo: '',
      message: '检测接口返回无效'
    };
  }

  const probe = raw.probe_results || {};
  const ipv4Exit = probe.ipv4?.exit || null;
  const ipv6Exit = probe.ipv6?.exit || null;
  const exit = ipv4Exit || ipv6Exit || {};
  const hasSuccessField = typeof raw.success === 'boolean';

  return {
    candidate: String(raw.candidate || candidate || ''),
    success: raw.success === true,
    source,
    proxyIP: String(raw.proxyIP || raw.proxyip || exit.ip || ''),
    portRemote: Number(raw.portRemote || raw.port || parsePortFromTarget(candidate) || 443),
    responseTime: Number(raw.responseTime || responseTime || 0),
    checkColo: String(raw.colo || ''),
    exitIP: String(exit.ip || ''),
    exitIpType: String(exit.ipType || ''),
    exitColo: String(exit.colo || ''),
    exitAsn: exit.asn ?? null,
    exitOrganization: String(exit.asOrganization || exit.org || ''),
    exitCountry: String(exit.country || ''),
    exitRegion: String(exit.region || exit.regionCode || ''),
    exitCity: String(exit.city || ''),
    ip: String(exit.ip || raw.ip || ''),
    ipType: String(exit.ipType || raw.ipType || ''),
    colo: String(exit.colo || ''),
    asn: exit.asn ?? raw.asn ?? null,
    asOrganization: String(exit.asOrganization || exit.org || raw.asOrganization || raw.org || ''),
    country: String(exit.country || raw.country || ''),
    region: String(exit.region || exit.regionCode || raw.region || raw.regionCode || ''),
    city: String(exit.city || raw.city || ''),
    message: String(raw.message || (hasSuccessField ? '' : '检测接口缺少 success 字段，可能参数名错误或返回的是普通 IP 信息')),
    inferredStack: String(raw.inferred_stack || ''),
    supportsIPv4: raw.supports_ipv4 === true,
    supportsIPv6: raw.supports_ipv6 === true,
    dualStack: raw.dual_stack === true
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

function buildFrontendBatchUrl(base, candidates) {
  const joined = candidates.map(item => String(item || '').trim()).filter(Boolean).join(',');
  return base + encodeURIComponent(joined);
}

function pickCheckRows(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.results)) return raw.results;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.data?.results)) return raw.data.results;
  if (raw && typeof raw === 'object' && typeof raw.success === 'boolean') return [raw];
  return [];
}

async function callExternalCheckBatch(candidates, source = 'main') {
  const list = candidates.map(item => String(item || '').trim()).filter(Boolean);
  if (!list.length) return [];
  const base = source === 'backup' ? FRONTEND_CHECK_API_BACKUP : FRONTEND_CHECK_API;
  const started = performance.now();
  const res = await fetch(buildFrontendBatchUrl(base, list), { cache: 'no-store' });
  const text = await res.text();
  let raw;
  try { raw = text ? JSON.parse(text) : {}; }
  catch { raw = { success: false, message: text || '检测接口返回非 JSON' }; }
  if (!res.ok) raw = { success: false, message: raw.message || ('HTTP ' + res.status) };

  const rows = pickCheckRows(raw);
  const byCandidate = new Map();
  for (const row of rows) {
    const key = String(row?.candidate || row?.proxyIP || row?.proxyip || row?.target || '').trim();
    if (key) byCandidate.set(key, row);
  }

  return list.map(candidate => {
    const row = byCandidate.get(candidate) || rows.find(item => String(item?.candidate || '').trim() === candidate) || null;
    if (!row) {
      return normalizeExternalCheckResult({ success: false, message: '批量接口未返回该候选结果' }, candidate, source, performance.now() - started);
    }
    return normalizeExternalCheckResult(row, candidate, source, performance.now() - started);
  });
}

async function checkCandidateBatch(candidates, useBackupOnly = false) {
  const list = candidates.map(item => String(item || '').trim()).filter(Boolean);
  if (!list.length) return [];
  if (useBackupOnly) return callExternalCheckBatch(list, 'backup');
  try {
    const main = await callExternalCheckBatch(list, 'main');
    if (main.some(item => item.success === true)) return main;
    try {
      const backup = await callExternalCheckBatch(list, 'backup');
      return backup.some(item => item.success === true) ? backup : main.map((item, index) => ({
        ...item,
        message: item.message || backup[index]?.message || '主备接口均未返回 success=true'
      }));
    } catch (e) {
      return main.map(item => ({ ...item, message: item.message || e.message || '备用接口异常' }));
    }
  } catch (e) {
    try { return await callExternalCheckBatch(list, 'backup'); }
    catch (be) {
      return list.map(candidate => ({ candidate, success: false, source: 'main', responseTime: 0, portRemote: parsePortFromTarget(candidate), message: be.message || e.message || '检测失败' }));
    }
  }
}

async function runWithConcurrency(items, limit, worker, onProgress, shouldStop = () => false) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && !shouldStop()) {
      const index = next++;
      try { results[index] = await worker(items[index], index); }
      catch (e) { results[index] = { candidate: items[index], success: false, source: 'main', responseTime: 0, portRemote: parsePortFromTarget(items[index]), message: e.message || '检测失败' }; }
      if (shouldStop()) break;
      done += 1;
      onProgress?.(done, items.length, results[index]);
    }
  });
  await Promise.all(workers);
  return results.filter(Boolean);
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
  const host = r.proxyIP || r.exitIP || r.ip || String(r.candidate || '').split(':')[0];
  const port = r.portRemote || parsePortFromTarget(r.candidate) || 443;
  const target = host ? `${host}:${port}` : String(r.candidate || '');
  const country = r.exitCountry || r.country || '';
  return country ? `${target}#${country}` : target;
}

function resetCheckProgress(total) {
  checkProgress.total = total;
  checkProgress.done = 0;
  checkProgress.success = 0;
  checkProgress.failed = 0;
  $('checkProgressBox')?.classList.remove('hidden');
  renderCheckProgress();
}

function updateCheckProgress(result) {
  checkProgress.done += 1;
  if (result?.success === true) checkProgress.success += 1;
  else checkProgress.failed += 1;
  renderCheckProgress();
}

function renderCheckProgress(label = '检测进度') {
  const percent = checkProgress.total ? Math.round((checkProgress.done / checkProgress.total) * 100) : 0;
  if ($('checkProgressLabel')) $('checkProgressLabel').textContent = label;
  if ($('checkProgressText')) $('checkProgressText').textContent = `${checkProgress.done} / ${checkProgress.total}`;
  if ($('checkProgressBar')) $('checkProgressBar').style.width = percent + '%';
  if ($('checkProgressStats')) $('checkProgressStats').textContent = `成功 ${checkProgress.success} · 失败 ${checkProgress.failed} · ${percent}%`;
}

function setCheckRunning(running) {
  checkRunning = running;
  if ($('btnCheckTargets')) $('btnCheckTargets').disabled = running;
  if ($('btnResolveTargets')) $('btnResolveTargets').disabled = running;
  if ($('btnStopCheck')) $('btnStopCheck').disabled = !running;
}

function stopCheckTargets() {
  if (!checkRunning) return;
  checkRunToken += 1;
  setCheckRunning(false);
  renderCheckProgress('已停止');
  toast('已停止检测，未开始的任务已取消');
}

function uniqueSorted(values) {
  return [...new Set(values.map(v => String(v || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function renderFilterOptions() {
  const countrySel = $('filterCountry');
  const coloSel = $('filterColo');
  if (!countrySel || !coloSel) return;
  const countryCurrent = checkFilters.country;
  const coloCurrent = checkFilters.colo;
  const countries = uniqueSorted(lastCheckResults.map(r => r.country));
  const colos = uniqueSorted(lastCheckResults.map(r => r.exitColo || r.colo));
  countrySel.innerHTML = '<option value="all">全部国家</option>' + countries.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  coloSel.innerHTML = '<option value="all">全部落地机房</option>' + colos.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  countrySel.value = countries.includes(countryCurrent) ? countryCurrent : 'all';
  coloSel.value = colos.includes(coloCurrent) ? coloCurrent : 'all';
  checkFilters.country = countrySel.value;
  checkFilters.colo = coloSel.value;
}

function getFilteredCheckResults() {
  return lastCheckResults.filter(item => {
    if (checkFilters.status === 'success' && item.success !== true) return false;
    if (checkFilters.status === 'failed' && item.success === true) return false;
    if (checkFilters.source !== 'all' && item.source !== checkFilters.source) return false;
    if (checkFilters.country !== 'all' && item.country !== checkFilters.country) return false;
    if (checkFilters.colo !== 'all' && (item.exitColo || item.colo) !== checkFilters.colo) return false;
    const keyword = String(checkFilters.keyword || '').trim().toLowerCase();
    if (keyword) {
      const haystack = [item.candidate, item.proxyIP, item.exitIP, item.ip, item.ipType, item.checkColo, item.exitColo, item.colo, item.country, item.region, item.city, item.asn, item.asOrganization, item.message, item.source].join(' ').toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  });
}

function updateFilterSummary(filtered) {
  const total = lastCheckResults.length;
  const success = lastCheckResults.filter(r => r.success === true).length;
  const failed = total - success;
  if ($('checkFilterSummary')) $('checkFilterSummary').textContent = `共 ${total} 条 · 当前显示 ${filtered.length} 条 · 可用 ${success} · 不可用 ${failed}`;
}

function setStatusFilter(status) {
  checkFilters.status = status;
  $$('[data-filter-status]').forEach(btn => btn.classList.toggle('active', btn.dataset.filterStatus === status));
  renderCheckResults(lastCheckResults, { keepFilters: true });
}

function clearCheckFilters() {
  checkFilters.status = 'all';
  checkFilters.source = 'all';
  checkFilters.country = 'all';
  checkFilters.colo = 'all';
  checkFilters.keyword = '';
  $$('[data-filter-status]').forEach(btn => btn.classList.toggle('active', btn.dataset.filterStatus === 'all'));
  if ($('filterSource')) $('filterSource').value = 'all';
  if ($('filterCountry')) $('filterCountry').value = 'all';
  if ($('filterColo')) $('filterColo').value = 'all';
  if ($('filterKeyword')) $('filterKeyword').value = '';
  renderCheckResults(lastCheckResults, { keepFilters: true });
}

function renderCheckResults(results, options = {}) {
  if (!options.keepResults) lastCheckResults = results || [];
  if (!options.keepFilters) renderFilterOptions();
  if ($('checkFilters')) $('checkFilters').classList.toggle('hidden', !lastCheckResults.length);
  const visible = getFilteredCheckResults();
  updateFilterSummary(visible);
  if (!lastCheckResults.length) {
    $('checkResult').innerHTML = '<div class="muted">没有检测结果</div>';
    return;
  }
  if (!visible.length) {
    $('checkResult').innerHTML = '<div class="muted">没有符合筛选条件的结果</div>';
    return;
  }
  $('checkResult').innerHTML = visible.map(r => {
    const ok = r.success === true;
    const location = [r.exitCountry || r.country, r.exitRegion || r.region, r.exitCity || r.city].filter(Boolean).join(' / ') || '-';
    const asn = [r.exitAsn || r.asn ? `AS${r.exitAsn || r.asn}` : '', r.exitOrganization || r.asOrganization].filter(Boolean).join(' · ') || '-';
    const exitIpText = [r.exitIP || r.ip || r.proxyIP || '-', r.exitIpType || r.ipType || ''].filter(Boolean).join(' ');
    const stack = [r.inferredStack, r.supportsIPv4 ? 'IPv4' : '', r.supportsIPv6 ? 'IPv6' : '', r.dualStack ? 'DualStack' : ''].filter(Boolean).join(' · ');
    return `<article class="check-card ${ok ? 'ok' : 'bad'}">
      <div class="check-title">${ok ? '代理验证通过' : '代理验证失败'} · ${r.source === 'backup' ? '备用接口' : '主接口'}</div>
      <dl>
        <div><dt>候选目标</dt><dd>${escapeHtml(r.candidate || '-')}</dd></div>
        <div><dt>代理目标</dt><dd>${escapeHtml((r.proxyIP || '-') + ':' + (r.portRemote || 443))}</dd></div>
        <div><dt>检测入口</dt><dd>${escapeHtml(r.checkColo || '-')}</dd></div>
        <div><dt>落地 IP</dt><dd>${escapeHtml(exitIpText)}</dd></div>
        <div><dt>落地机房</dt><dd>${escapeHtml(r.exitColo || r.colo || '-')}</dd></div>
        <div><dt>落地位置</dt><dd>${escapeHtml(location)}</dd></div>
        <div><dt>ASN</dt><dd>${escapeHtml(asn)}</dd></div>
        <div><dt>耗时</dt><dd>${escapeHtml(formatMs(r.responseTime))}</dd></div>
        ${stack ? `<div><dt>协议栈</dt><dd>${escapeHtml(stack)}</dd></div>` : ''}
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

  const runId = ++checkRunToken;
  setCheckRunning(true);
  lastCheckResults = [];
  clearCheckFilters();
  renderCheckResults([]);
  $('checkResult').innerHTML = '<div class="muted">准备检测...</div>';
  $('resolveResult').textContent = $('skipResolve').checked ? '已跳过解析' : '解析候选中...';

  try {
    let resolveData = null;
    if (!$('skipResolve').checked) {
      resolveData = inputs.length === 1 ? await api.resolve(inputs[0]) : await api.resolveBatch(inputs);
      if (runId !== checkRunToken) return;
      renderResolveResult(resolveData);
    }

    const candidates = collectResolvedTargets(resolveData, inputs);
    if (!candidates.length) throw new Error('没有可检测候选');

    const concurrency = getFrontendConcurrency();
    const useBackupOnly = $('useBackup').checked;
    resetCheckProgress(candidates.length);
    renderCheckProgress('检测中');

    const batchSize = 2; // 外部接口每次最多稳定检测 2 个 proxyip，前端通过多组并发提速。
    const batches = [];
    for (let i = 0; i < candidates.length; i += batchSize) batches.push(candidates.slice(i, i + batchSize));

    const results = await runWithConcurrency(
      batches,
      concurrency,
      (batch) => checkCandidateBatch(batch, useBackupOnly),
      (done, total, batchResults) => {
        if (runId !== checkRunToken) return;
        for (const result of batchResults) {
          lastCheckResults.push(result);
          updateCheckProgress(result);
        }
        renderCheckResults(lastCheckResults, { keepFilters: true });
      },
      () => runId !== checkRunToken
    ).then(groups => groups.flat());

    if (runId !== checkRunToken) return;
    renderCheckResults(results);
    renderCheckProgress('检测完成');
    const successCount = results.filter(r => r.success === true).length;
    toast('检测完成：可用 ' + successCount + ' / ' + results.length);
  } finally {
    if (runId === checkRunToken) setCheckRunning(false);
  }
}

function successfulResults(results = lastCheckResults) {
  return results.filter(r => r.success === true);
}

async function copyGoodResults() {
  const lines = successfulResults(lastCheckResults).map(targetLineFromResult);
  if (!lines.length) throw new Error('没有可复制的可用项');
  await navigator.clipboard.writeText(lines.join('\n'));
  toast(`已复制可用项 ${lines.length} 条`);
}

async function addGoodToPool() {
  const lines = successfulResults(lastCheckResults).map(targetLineFromResult);
  if (!lines.length) throw new Error('没有可加入的可用项');
  const key = selectedPoolKey();
  await api.savePool({ poolKey: key, pool: lines.join('\n'), mode: 'append' });
  await refreshPoolView(key).catch(() => {});
  toast(`已加入当前池：${lines.length} 条`);
}

async function copyFilteredResults() {
  const visible = getFilteredCheckResults();
  if (!visible.length) throw new Error('当前筛选没有结果');
  const lines = visible.map(targetLineFromResult);
  await navigator.clipboard.writeText(lines.join('\n'));
  toast(`已复制筛选结果 ${lines.length} 条`);
}

async function addFilteredGoodToPool() {
  const lines = successfulResults(getFilteredCheckResults()).map(targetLineFromResult);
  if (!lines.length) throw new Error('当前筛选没有可用项');
  const key = selectedPoolKey();
  await api.savePool({ poolKey: key, pool: lines.join('\n'), mode: 'append' });
  await refreshPoolView(key).catch(() => {});
  toast(`已加入筛选可用项：${lines.length} 条`);
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
  $('btnStopCheck').onclick = () => stopCheckTargets();
  $('btnCopyGood').onclick = () => copyGoodResults().catch(e => toast(e.message, 'err'));
  $('btnAddGoodToPool').onclick = () => addGoodToPool().catch(e => toast(e.message, 'err'));
  $('btnCopyFiltered').onclick = () => copyFilteredResults().catch(e => toast(e.message, 'err'));
  $('btnAddFilteredToPool').onclick = () => addFilteredGoodToPool().catch(e => toast(e.message, 'err'));
  $$('[data-filter-status]').forEach(btn => btn.onclick = () => setStatusFilter(btn.dataset.filterStatus || 'all'));
  $('filterSource').onchange = () => { checkFilters.source = $('filterSource').value; renderCheckResults(lastCheckResults, { keepFilters: true }); };
  $('filterCountry').onchange = () => { checkFilters.country = $('filterCountry').value; renderCheckResults(lastCheckResults, { keepFilters: true }); };
  $('filterColo').onchange = () => { checkFilters.colo = $('filterColo').value; renderCheckResults(lastCheckResults, { keepFilters: true }); };
  $('filterKeyword').oninput = () => { checkFilters.keyword = $('filterKeyword').value; renderCheckResults(lastCheckResults, { keepFilters: true }); };
  $('btnClearFilters').onclick = () => clearCheckFilters();
  $('btnDomainStatus').onclick = () => domainStatus().catch(e => toast(e.message, 'err'));
  $('btnStatus').onclick = async () => { $('statusResult').textContent = '查询中...'; const data = await run('', () => api.currentStatus($('targetIndex').value.trim() || 0)).catch(e => ({ error: e.message })); $('statusResult').textContent = pretty(data); };
  $('btnMaintain').onclick = () => maintain().catch(() => {});
  $('btnCopyLogs').onclick = () => copyLogs().catch(e => toast(e.message, 'err'));
  $('btnClearLogs').onclick = () => clearLogs();
  $('btnLoadMapping').onclick = () => loadMapping().catch(() => {});
  $('btnSaveMapping').onclick = () => saveMapping().catch(e => toast(e.message, 'err'));
}

async function initApp() {
  try {
    bind();
  } catch (e) {
    console.error('前端事件绑定失败:', e);
    if ($('healthBadge')) {
      $('healthBadge').textContent = '前端初始化异常 · ' + (e.message || '事件绑定失败');
      $('healthBadge').className = 'badge bad';
    }
    toast('前端初始化异常：' + (e.message || '事件绑定失败'), 'err');
    return;
  }

  try {
    await bootStatus();
  } catch (e) {
    console.error('状态检查失败:', e);
  }

  try {
    await refreshPools();
    await loadPool();
  } catch (e) {
    console.error('IP 池初始化失败:', e);
    toast('IP 池加载失败：' + (e.message || '未知错误'), 'err');
  }
}

initApp();
