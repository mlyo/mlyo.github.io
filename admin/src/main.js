import { api, checkProxyDirect, getCheckConfig } from './api.js';

const $ = (id) => document.getElementById(id);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const pretty = (value) => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
let currentPool = 'pool';
let remotePreviewText = '';
let checkRun = null;
let checkRecords = [];
let activeCheckFilter = 'all';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

function toast(message, type = 'ok') {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast ${type}`;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 2600);
}

function setBusy(button, busy, text = '处理中...') {
  if (!button) return;
  if (busy) { button.dataset.oldText = button.textContent; button.textContent = text; button.disabled = true; }
  else { button.textContent = button.dataset.oldText || button.textContent; button.disabled = false; }
}

async function run(button, fn, busyText) {
  try {
    setBusy(button, true, busyText);
    const result = await fn();
    return result;
  } catch (e) {
    toast(e.message || '操作失败', 'err');
    throw e;
  } finally { setBusy(button, false); }
}

function switchPanel(name) {
  $$('.nav').forEach(btn => btn.classList.toggle('active', btn.dataset.panel === name));
  $$('.panel').forEach(panel => panel.classList.toggle('active', panel.id === `panel-${name}`));
}

function getPoolKeyInput() {
  const raw = $('customPoolKey').value.trim() || $('poolSelect').value || currentPool || 'pool';
  if (raw === 'pool' || raw === 'pool_trash' || raw.startsWith('pool_')) return raw;
  return 'pool_' + raw;
}

function normalizeLocalPoolText(text) {
  const seen = new Set();
  const out = [];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const [main, ...commentParts] = line.split('#');
    const target = main.trim();
    if (!target || seen.has(target)) continue;
    seen.add(target);
    out.push(commentParts.length ? `${target} # ${commentParts.join('#').trim()}` : target);
  }
  return out.join('\n');
}

async function loadHealth() {
  const h = await api.health();
  $('healthBadge').textContent = h.kv ? 'KV 正常' : 'KV 未绑定';
  $('healthBadge').className = `badge ${h.kv ? 'ok' : 'bad'}`;
  $('kvText').textContent = h.kv ? h.kvBinding : '未绑定';
  $('targetCount').textContent = h.targets;
}

async function loadConfig() {
  const cfg = await api.config();
  $('versionText').textContent = cfg.version;
  $('targetCount').textContent = cfg.targets.length;
  $('targetsBody').innerHTML = cfg.targets.map(t => `<tr><td>${t.mode}</td><td><code>${escapeHtml(t.domain)}</code></td><td>${t.port}</td><td>${t.minActive}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">未配置 CF_DOMAIN</td></tr>';
  const cards = $('targetsCards');
  if (cards) {
    cards.innerHTML = cfg.targets.length
      ? cfg.targets.map(t => `
        <article class="target-card">
          <div class="target-main"><code>${escapeHtml(t.domain)}</code><span>${t.mode}</span></div>
          <div class="target-meta"><span>端口 ${t.port}</span><span>最小活跃 ${t.minActive}</span></div>
        </article>`).join('')
      : '<div class="empty-card">未配置 CF_DOMAIN</div>';
  }
}

async function loadPools() {
  const { pools } = await api.pools();
  $('poolSelect').innerHTML = pools.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  if (!pools.includes(currentPool)) currentPool = 'pool';
  $('poolSelect').value = currentPool;
}

async function loadPool(poolKey = getPoolKeyInput()) {
  currentPool = poolKey;
  $('poolSelect').value = poolKey;
  $('customPoolKey').value = '';
  const data = await api.getPool(poolKey);
  $('poolText').value = data.pool || '';
  $('poolLabel').textContent = data.poolKey;
  $('poolCount').textContent = data.count;
}

async function savePool(mode) {
  const poolKey = getPoolKeyInput();
  const pool = $('poolText').value;
  const result = await api.savePool({ poolKey, pool, mode });
  currentPool = result.poolKey;
  await loadPools();
  await loadPool(currentPool);
  toast(`已保存：${result.count} 条`);
}

async function previewRemote() {
  const payload = { url: $('remoteUrl').value.trim(), cfCountry: $('remoteCountry').value.trim(), port: $('remotePort').value.trim() || '443', format: $('remoteFormat').value };
  const result = await api.loadRemote(payload);
  remotePreviewText = result.ips || '';
  $('remotePreview').textContent = `数量：${result.count}\n\n${remotePreviewText}`;
  toast(`预览 ${result.count} 条`);
}

function readTargets(textareaId) {
  return String($(textareaId).value || '').split(/\r?\n/).map(v => v.trim()).filter(Boolean);
}

async function doResolve() {
  const targets = readTargets('checkInput');
  const result = await api.resolveBatch(targets);
  const lines = [];
  for (const row of result.results || []) {
    lines.push(`# ${row.input}`);
    if (row.error) lines.push(`# ERROR: ${row.error}`);
    else lines.push(...(row.targets || []));
  }
  $('checkOutput').textContent = lines.join('\n') || pretty(result);
}

function initCheckConfig() {
  const cfg = getCheckConfig();
  $('checkConcurrency').value = localStorage.getItem('checkConcurrency') || String(cfg.concurrency);
  $('checkTimeout').value = localStorage.getItem('checkTimeout') || String(cfg.timeout);
}

function saveCheckConfig() {
  localStorage.setItem('checkConcurrency', $('checkConcurrency').value.trim());
  localStorage.setItem('checkTimeout', $('checkTimeout').value.trim());
}

function getRuntimeCheckConfig() {
  return {
    publicCheckApi: getCheckConfig().publicCheckApi,
    concurrency: Math.max(1, Math.min(30, Number($('checkConcurrency').value || 8))),
    timeout: Math.max(1000, Math.min(60000, Number($('checkTimeout').value || 30000)))
  };
}

function resetCheckUi(total = 0) {
  checkRecords = [];
  activeCheckFilter = 'all';
  $$('.filter').forEach(btn => btn.classList.toggle('active', btn.dataset.checkFilter === 'all'));
  $('checkResults').innerHTML = '';
  $('checkOutput').textContent = '';
  updateCheckStats(total, 0, 0, 0);
}

function updateCheckStats(total, done, success, failed) {
  $('checkStatTotal').textContent = total;
  $('checkStatDone').textContent = done;
  $('checkStatSuccess').textContent = success;
  $('checkStatFailed').textContent = failed;
  $('checkProgressBar').style.width = total ? `${Math.round(done / total * 100)}%` : '0%';
}

function createCheckRecord(target) {
  const record = { target, status: 'pending', source: '', result: null, error: '' };
  checkRecords.push(record);
  const row = document.createElement('article');
  row.className = 'check-item pending';
  row.dataset.status = 'pending';
  row.dataset.source = '';
  row.innerHTML = `
    <div class="check-item-head">
      <div class="check-target">${escapeHtml(target)}</div>
      <span class="status-badge pending">等待</span>
    </div>
    <div class="check-item-meta"><span class="meta-chip soft">等待检测</span></div>`;
  $('checkResults').appendChild(row);
  record.el = row;
  return record;
}

function sourceLabel(source) {
  if (source === 'direct') return '前端直连';
  if (source === 'worker') return 'Worker';
  return source || '-';
}

function chip(text, extra = '') {
  if (!text) return '';
  return `<span class="meta-chip${extra ? ' ' + extra : ''}">${escapeHtml(text)}</span>`;
}

function infoLine(text, extra = '') {
  if (!text) return '';
  return `<span class="check-info-line${extra ? ' ' + extra : ''}">${escapeHtml(text)}</span>`;
}

function cleanOrgName(exit) {
  const raw = String(exit?.asOrganization || exit?.org || '').trim();
  if (!raw) return '';
  return raw.replace(/^AS\d+\s+/i, '').trim();
}

function exitLocation(exit) {
  if (!exit) return '';
  const country = exit.country || exit.countryCode || '';
  const city = exit.city || exit.region || exit.regionCode || '';
  return [country, city].filter(Boolean).join(' · ');
}

function exitAsn(exit) {
  if (!exit) return '';
  const asn = exit.asn ? `AS${exit.asn}` : '';
  const org = cleanOrgName(exit);
  return [asn, org].filter(Boolean).join(' · ');
}

function pickPrimaryExit(result) {
  const exits = Array.isArray(result?.exits) ? result.exits.filter(Boolean) : [];
  if (!exits.length) return null;
  return exits.find(e => e.ipType === 'ipv4' || e.stack === 'ipv4') || exits[0];
}

function formatMs(value) {
  if (value === 0) return '0 ms';
  if (value === null || value === undefined || value === '') return '可用';
  const num = Number(value);
  if (Number.isFinite(num)) return `${Math.round(num)} ms`;
  return String(value).replace(/\s*ms$/i, '') + ' ms';
}

function formatLandingIp(result) {
  const exits = Array.isArray(result?.exits) ? result.exits.filter(e => e?.ip) : [];
  if (!exits.length) return '';
  const ips = [...new Set(exits.map(e => e.ip).filter(Boolean))];
  if (!ips.length) return '';
  return ips.length === 1 ? `落地 IP：${ips[0]}` : `落地 IP：${ips[0]} 等 ${ips.length} 个`;
}

function renderSuccessMeta(result) {
  const exits = Array.isArray(result?.exits) ? result.exits.filter(Boolean) : [];
  const primary = pickPrimaryExit(result);
  const loc = exitLocation(primary);
  const asn = exitAsn(primary);
  const landing = formatLandingIp(result);
  return [
    loc ? infoLine(loc, 'ok') : '',
    asn ? infoLine(asn) : '',
    infoLine(`${exits.length || 0}个出口`, 'soft'),
    landing ? infoLine(landing, 'landing') : ''
  ].filter(Boolean).join('');
}

function renderCheckRecord(record, patch) {
  Object.assign(record, patch);
  const row = record.el;
  row.className = `check-item ${record.status}`;
  row.dataset.status = record.status;
  row.dataset.source = record.source || '';
  const badge = row.querySelector('.status-badge');
  const meta = row.querySelector('.check-item-meta');

  if (record.status === 'success') {
    badge.className = 'status-badge ok';
    badge.textContent = formatMs(record.result?.responseTime);
  } else if (record.status === 'failed') {
    badge.className = 'status-badge bad';
    badge.textContent = '失败';
  } else if (record.status === 'stopped') {
    badge.className = 'status-badge bad';
    badge.textContent = '已停止';
  } else {
    badge.className = 'status-badge pending';
    badge.textContent = '检测中';
  }

  const result = record.result || {};
  if (record.status === 'success') {
    meta.innerHTML = renderSuccessMeta(result) || chip('可用', 'ok');
  } else if (record.status === 'pending') {
    meta.innerHTML = chip('检测中', 'soft');
  } else {
    meta.innerHTML = [
      chip(`来源：${sourceLabel(record.source)}`, 'bad'),
      chip(record.error || result.message || '检测未通过', 'soft')
    ].join('');
  }
  applyCheckFilter();
}

function applyCheckFilter() {
  for (const r of checkRecords) {
    const show = activeCheckFilter === 'all'
      || (activeCheckFilter === 'success' && r.status === 'success')
      || (activeCheckFilter === 'failed' && (r.status === 'failed' || r.status === 'stopped'))
      || (activeCheckFilter === 'direct' && r.source === 'direct')
      || (activeCheckFilter === 'worker' && r.source === 'worker');
    if (r.el) r.el.hidden = !show;
  }
}

function uniqueTargets(values) {
  const seen = new Set();
  const out = [];
  for (const v of values) {
    const t = String(v || '').trim();
    if (!t || seen.has(t)) continue;
    seen.add(t); out.push(t);
  }
  return out;
}

async function resolveInputTargets(inputs) {
  if (!$('resolveBeforeCheck').checked) return uniqueTargets(inputs);
  const result = await api.resolveBatch(inputs);
  const out = [];
  const lines = [];
  for (const row of result.results || []) {
    if (row.error) {
      lines.push(`${row.input} -> 解析失败：${row.error}`);
      continue;
    }
    const targets = Array.isArray(row.targets) ? row.targets : [];
    lines.push(`${row.input} -> ${targets.length} 个候选`);
    out.push(...targets);
  }
  const unique = uniqueTargets(out);
  $('checkOutput').textContent = `解析完成：输入 ${inputs.length} 个，候选 ${unique.length} 个\n` + lines.join('\n');
  return unique;
}

async function runCheckOne(target, cfg, signal) {
  return await checkProxyDirect(target, { publicCheckApi: cfg.publicCheckApi, timeout: cfg.timeout, signal });
}

async function runQueue(items, concurrency, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

async function doCheck() {
  const inputs = readTargets('checkInput');
  if (!inputs.length) { toast('请输入检测目标', 'err'); return; }
  saveCheckConfig();
  const cfg = getRuntimeCheckConfig();
  if (!cfg.publicCheckApi) { toast('缺少前端检测接口', 'err'); return; }
  const candidates = await resolveInputTargets(inputs);
  if (!candidates.length) { toast('没有可检测候选', 'err'); return; }
  resetCheckUi(candidates.length);
  const controller = new AbortController();
  checkRun = { controller, stopped: false };
  $('btnStopCheck').disabled = false;
  candidates.forEach(createCheckRecord);
  let done = 0, success = 0, failed = 0;
  const refreshStats = () => updateCheckStats(candidates.length, done, success, failed);
  try {
    await runQueue(checkRecords, cfg.concurrency, async (record) => {
      if (controller.signal.aborted) {
        renderCheckRecord(record, { status: 'stopped', error: '已停止' });
        return;
      }
      renderCheckRecord(record, { status: 'pending' });
      try {
        const result = await runCheckOne(record.target, cfg, controller.signal);
        if (result.success) {
          success++;
          renderCheckRecord(record, { status: 'success', source: result.source, result });
        } else {
          failed++;
          renderCheckRecord(record, { status: 'failed', source: result.source, result, error: result.message || '检测未通过' });
        }
      } catch (e) {
        if (controller.signal.aborted) {
          renderCheckRecord(record, { status: 'stopped', source: '', error: '已停止' });
        } else {
          failed++;
          renderCheckRecord(record, { status: 'failed', source: '', error: e.message || '检测失败' });
        }
      } finally {
        done++;
        refreshStats();
      }
    });
    toast(`检测完成：可用 ${success}，失败 ${failed}`);
  } finally {
    $('btnStopCheck').disabled = true;
    checkRun = null;
  }
}

function stopCheck() {
  if (!checkRun) return;
  checkRun.stopped = true;
  checkRun.controller.abort();
  for (const record of checkRecords) {
    if (record.status === 'pending') renderCheckRecord(record, { status: 'stopped', error: '已手动停止' });
  }
  toast('已停止检测');
}

function downloadText(filename, text, type = 'text/plain;charset=UTF-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportSuccess() {
  const text = checkRecords.filter(r => r.status === 'success').map(r => r.target).join('\n');
  if (!text) { toast('没有可导出的可用目标', 'err'); return; }
  downloadText('proxyip-success.txt', text + '\n');
}

function renderListChips(values, emptyText = '无') {
  if (!Array.isArray(values) || !values.length) return `<span class="meta-chip soft">${emptyText}</span>`;
  return values.map(v => chip(String(v), 'soft')).join('');
}

function renderDomainStatus(result) {
  const cards = [
    ['A', renderListChips(result.A)],
    ['AAAA', renderListChips(result.AAAA)],
    ['TXT', renderListChips(result.TXT)],
    ['映射池', result.pool ? chip(result.pool, 'ok') : chip('未映射', 'soft')]
  ];
  return `
    <article class="domain-card">
      <div class="domain-head"><code>${escapeHtml(result.domain || '-')}</code><span>DNS</span></div>
      <div class="domain-grid">
        ${cards.map(([name, value]) => `<div class="domain-row"><b>${name}</b><div>${value}</div></div>`).join('')}
      </div>
    </article>`;
}

async function domainStatus() {
  const domain = $('domainInput').value.trim();
  const result = await api.domainStatus(domain);
  $('domainOutput').innerHTML = renderDomainStatus(result);
}

async function loadMapping() {
  const data = await api.getMapping();
  $('mappingText').value = JSON.stringify(data.mapping || {}, null, 2);
}

async function saveMapping() {
  let mapping;
  try { mapping = JSON.parse($('mappingText').value || '{}'); }
  catch { toast('映射 JSON 无效', 'err'); return; }
  const result = await api.saveMapping(mapping);
  $('mappingText').value = JSON.stringify(result.mapping || {}, null, 2);
  toast('映射已保存');
}


function renderSourceRules(data) {
  const rules = data?.rules || [];
  if (!rules.length) {
    return '<div class="empty-card">未配置 SOURCE_URLS / SOURCE_URLS_KR / SOURCE_RULES</div>';
  }
  return rules.map(rule => `
    <article class="source-rule">
      <div class="source-rule-head"><b>${escapeHtml(rule.id || '-')}</b><span>${escapeHtml(rule.country || 'AUTO')}</span></div>
      <div class="source-rule-meta">
        <span>URL ${rule.urls || 0}</span>
        <span>${rule.pool ? '池 ' + escapeHtml(rule.pool) : '自动分池'}</span>
      </div>
    </article>
  `).join('');
}

function renderSourceReport(data) {
  const lines = [];
  lines.push(`源规则：${data.reports?.length || 0}`);
  lines.push(`候选：${data.totalCandidates || 0}`);
  lines.push(`检测：${data.totalChecked || 0}`);
  lines.push(`可用：${data.totalUsable || 0}`);
  lines.push(`耗时：${data.processingTime || 0}ms`);
  lines.push('');
  for (const report of data.reports || []) {
    lines.push(`== ${report.id}${report.country ? ' [' + report.country + ']' : ''} ==`);
    lines.push(`加载 ${report.loaded} · 检测 ${report.checked} · 可用 ${report.usable}`);
    const countries = Object.entries(report.countries || {}).map(([k,v]) => `${k}:${v}`).join(' ');
    if (countries) lines.push(`分布：${countries}`);
    for (const err of report.errors || []) lines.push(`! ${err.url} -> ${err.error}`);
    lines.push('');
  }
  if (data.pools?.length) {
    lines.push('== 写入池 ==');
    for (const p of data.pools) lines.push(`${p.poolKey}: 新增 ${p.added} · 更新 ${p.updated} · 总计 ${p.total}`);
  }
  return lines.join('\n');
}

async function loadSourcesConfig() {
  const data = await api.sourcesConfig();
  const box = $('sourceRules');
  if (box) box.innerHTML = renderSourceRules(data);
  if (data.last) $('sourceOutput').textContent = '上次刷新：\n' + renderSourceReport(data.last);
}

async function refreshSources() {
  const data = await api.refreshSources();
  $('sourceOutput').textContent = renderSourceReport(data);
  await loadPools().catch(() => {});
  toast('源刷新完成');
}

async function refreshSourcesThenMaintain() {
  const src = await api.refreshSources();
  $('sourceOutput').textContent = renderSourceReport(src);
  const result = await api.maintain();
  $('sourceOutput').textContent += '\n\n== DNS 维护 ==\n' + renderMaintainReport(result);
  await Promise.allSettled([loadPools(), loadConfig()]);
  toast('源刷新并维护完成');
}

function renderMaintainReport(data) {
  const lines = [];
  lines.push(`处理域名：${data.processedTargets}/${data.totalTargets}`);
  lines.push(`耗时：${data.processingTime}ms`);
  lines.push(`通知：${data.notified ? '已发送' : data.tgStatus?.reason || '未发送'}`);
  lines.push('');
  for (const report of data.reports || []) {
    lines.push(`== ${report.domain} [${report.mode}] ${report.status} ==`);
    lines.push(`活跃：${report.afterActive}/${report.minActive}，新增：${report.added?.length || 0}，移除：${report.removed?.length || 0}，池移除：${report.poolRemoved || 0}`);
    lines.push(...(report.logs || []));
    lines.push('');
  }
  return lines.join('\n');
}

async function doMaintain() {
  const result = await api.maintain();
  $('maintainOutput').textContent = renderMaintainReport(result);
  const fold = document.querySelector('#panel-maintain .inner-fold');
  if (fold) fold.open = true;
}

async function init() {
  initCheckConfig();
  $$('.nav').forEach(btn => btn.addEventListener('click', () => switchPanel(btn.dataset.panel)));
  $$('.filter').forEach(btn => btn.addEventListener('click', () => {
    activeCheckFilter = btn.dataset.checkFilter;
    $$('.filter').forEach(b => b.classList.toggle('active', b === btn));
    applyCheckFilter();
  }));
  $('btnLogout').addEventListener('click', api.logout);
  $('btnRefreshAll').addEventListener('click', () => boot());
  $('btnLoadConfig').addEventListener('click', () => run($('btnLoadConfig'), loadConfig, '读取中'));
  $('poolSelect').addEventListener('change', () => loadPool($('poolSelect').value));
  $('btnLoadPool').addEventListener('click', () => run($('btnLoadPool'), () => loadPool(getPoolKeyInput()), '加载中'));
  $('btnFormatPool').addEventListener('click', () => { $('poolText').value = normalizeLocalPoolText($('poolText').value); toast('已本地去重'); });
  $('btnAppend').addEventListener('click', () => run($('btnAppend'), () => savePool('append'), '保存中'));
  $('btnReplace').addEventListener('click', () => run($('btnReplace'), () => savePool('replace'), '保存中'));
  $('btnRemove').addEventListener('click', () => run($('btnRemove'), () => savePool('remove'), '删除中'));
  $('btnLoadTrash').addEventListener('click', () => loadPool('pool_trash'));
  $('btnClearTrash').addEventListener('click', async () => { if (confirm('确定清空垃圾桶？')) await run($('btnClearTrash'), async () => { await api.clearTrash(); await loadPool('pool_trash'); toast('垃圾桶已清空'); }, '清空中'); });
  $('btnCreatePool').addEventListener('click', () => run($('btnCreatePool'), async () => { const key = getPoolKeyInput(); await api.createPool(key); await loadPools(); await loadPool(key); toast('池已创建'); }, '创建中'));
  $('btnDeletePool').addEventListener('click', () => { const key = getPoolKeyInput(); if (confirm(`确定删除 ${key}？`)) run($('btnDeletePool'), async () => { await api.deletePool(key); currentPool = 'pool'; await loadPools(); await loadPool('pool'); toast('池已删除'); }, '删除中'); });
  $('btnPreviewRemote').addEventListener('click', () => run($('btnPreviewRemote'), previewRemote, '加载中'));
  $('btnImportRemote').addEventListener('click', () => run($('btnImportRemote'), async () => { if (!remotePreviewText) await previewRemote(); $('poolText').value = remotePreviewText; await savePool('append'); }, '导入中'));
  $('btnResolve').addEventListener('click', () => run($('btnResolve'), doResolve, '解析中'));
  $('btnCheck').addEventListener('click', () => run($('btnCheck'), doCheck, '检测中'));
  $('btnStopCheck').addEventListener('click', stopCheck);
  $('btnExportSuccess').addEventListener('click', exportSuccess);
  ['checkConcurrency', 'checkTimeout'].forEach(id => $(id).addEventListener('change', saveCheckConfig));
  $('btnDomainStatus').addEventListener('click', () => run($('btnDomainStatus'), domainStatus, '查询中'));
  $('btnLoadMapping').addEventListener('click', () => run($('btnLoadMapping'), loadMapping, '加载中'));
  $('btnSaveMapping').addEventListener('click', () => run($('btnSaveMapping'), saveMapping, '保存中'));
  $('btnMaintain').addEventListener('click', () => run($('btnMaintain'), doMaintain, '维护中'));
  $('btnLoadSources').addEventListener('click', () => run($('btnLoadSources'), loadSourcesConfig, '读取中'));
  $('btnRefreshSources').addEventListener('click', () => run($('btnRefreshSources'), refreshSources, '刷新中'));
  $('btnSourceToMaintain').addEventListener('click', () => run($('btnSourceToMaintain'), refreshSourcesThenMaintain, '执行中'));
  await boot();
}

async function boot() {
  await Promise.allSettled([loadHealth(), loadConfig(), loadPools(), loadMapping(), loadSourcesConfig()]);
  await loadPool(currentPool).catch(() => {});
}

init();
