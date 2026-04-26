import { api } from './api.js';

const $ = (id) => document.getElementById(id);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const pretty = (value) => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
let currentPool = 'pool';
let remotePreviewText = '';

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
  return $('customPoolKey').value.trim() || $('poolSelect').value || currentPool || 'pool';
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
    out.push(commentParts.length ? `${target} #${commentParts.join('#').trim()}` : target);
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
  $('targetsBody').innerHTML = cfg.targets.map(t => `<tr><td>${t.mode}</td><td><code>${t.domain}</code></td><td>${t.port}</td><td>${t.minActive}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">未配置 CF_DOMAIN</td></tr>';
}

async function loadPools() {
  const { pools } = await api.pools();
  $('poolSelect').innerHTML = pools.map(p => `<option value="${p}">${p}</option>`).join('');
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
  $('checkOutput').textContent = pretty(result);
}

async function doCheck() {
  const targets = readTargets('checkInput');
  const result = await api.checkBatch({ targets, resolve: $('resolveBeforeCheck').checked });
  $('checkOutput').textContent = pretty(result);
}

async function domainStatus() {
  const domain = $('domainInput').value.trim();
  const result = await api.domainStatus(domain);
  $('domainOutput').textContent = pretty(result);
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
}

async function init() {
  $$('.nav').forEach(btn => btn.addEventListener('click', () => switchPanel(btn.dataset.panel)));
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
  $('btnCreatePool').addEventListener('click', () => run($('btnCreatePool'), async () => { await api.createPool(getPoolKeyInput()); await loadPools(); await loadPool(getPoolKeyInput()); toast('池已创建'); }, '创建中'));
  $('btnDeletePool').addEventListener('click', () => { const key = getPoolKeyInput(); if (confirm(`确定删除 ${key}？`)) run($('btnDeletePool'), async () => { await api.deletePool(key); currentPool = 'pool'; await loadPools(); await loadPool('pool'); toast('池已删除'); }, '删除中'); });
  $('btnPreviewRemote').addEventListener('click', () => run($('btnPreviewRemote'), previewRemote, '加载中'));
  $('btnImportRemote').addEventListener('click', () => run($('btnImportRemote'), async () => { if (!remotePreviewText) await previewRemote(); $('poolText').value = remotePreviewText; await savePool('append'); }, '导入中'));
  $('btnResolve').addEventListener('click', () => run($('btnResolve'), doResolve, '解析中'));
  $('btnCheck').addEventListener('click', () => run($('btnCheck'), doCheck, '检测中'));
  $('btnDomainStatus').addEventListener('click', () => run($('btnDomainStatus'), domainStatus, '查询中'));
  $('btnLoadMapping').addEventListener('click', () => run($('btnLoadMapping'), loadMapping, '加载中'));
  $('btnSaveMapping').addEventListener('click', () => run($('btnSaveMapping'), saveMapping, '保存中'));
  $('btnMaintain').addEventListener('click', () => run($('btnMaintain'), doMaintain, '维护中'));
  await boot();
}

async function boot() {
  await Promise.allSettled([loadHealth(), loadConfig(), loadPools(), loadMapping()]);
  await loadPool(currentPool).catch(() => {});
}

init();
