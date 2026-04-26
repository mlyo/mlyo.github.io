import { api } from './api.js';

const $ = (id) => document.getElementById(id);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const pretty = (data) => typeof data === 'string' ? data : JSON.stringify(data, null, 2);

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

const poolKey = () => $('poolKey').value.trim() || 'pool';

function updateSummary(key, count) {
  $('summaryPool').textContent = key;
  $('summaryCount').textContent = count ?? '-';
}

async function bootStatus() {
  try {
    const [version, health] = await Promise.all([api.version(), api.health()]);
    $('summaryVersion').textContent = version.version || '-';
    const kvText = health.kv ? `KV 正常${health.kvBinding ? ' · ' + health.kvBinding : ''}` : `KV 异常${health.kvBinding ? ' · ' + health.kvBinding : ''}`;
    $('healthBadge').textContent = kvText;
    $('healthBadge').className = `badge ${health.kv ? 'ok' : 'bad'}`;
  } catch (e) {
    $('healthBadge').textContent = '状态异常';
    $('healthBadge').className = 'badge bad';
  }
}

async function loadPool(key = poolKey()) {
  const data = await run('', () => api.getPool(key));
  $('poolText').value = data.pool || '';
  $('poolCount').textContent = data.count ?? 0;
  updateSummary(key, data.count ?? 0);
  toast(`已加载 ${key}`);
}

async function savePool(mode) {
  if (mode === 'replace' && !confirm(`确认覆盖 ${poolKey()}？原内容会被替换。`)) return;
  if (mode === 'remove' && !confirm(`确认从 ${poolKey()} 删除文本框中的 IP？`)) return;
  const data = await run('保存成功', () => api.savePool({ poolKey: poolKey(), pool: $('poolText').value, mode }));
  $('poolCount').textContent = data.count ?? '-';
  updateSummary(poolKey(), data.count ?? '-');
}

function formatPoolText() {
  const lines = normalizeLines($('poolText').value);
  $('poolText').value = lines.join('\n');
  $('poolCount').textContent = lines.length;
  updateSummary(poolKey(), lines.length);
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
    const saved = await run('远程 IP 已追加保存', () => api.savePool({ poolKey: poolKey(), pool: lines.join('\n'), mode: 'append' }));
    $('poolCount').textContent = saved.count ?? '-';
    updateSummary(poolKey(), saved.count ?? '-');
  } else {
    toast(`已预览并放入编辑框：${lines.length} 条`);
  }
}

async function maintain() {
  if (!confirm('确认立即执行维护？建议先确认 IP 池和映射配置无误。')) return;
  $('logs').textContent = '维护中...';
  const data = await run('维护完成', () => api.maintain());
  const logs = data.allLogs || data.reports?.flatMap(r => r.logs || []) || [];
  $('logs').textContent = logs.length ? logs.join('\n') : pretty(data);
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

function bind() {
  $$('.nav').forEach(btn => btn.onclick = () => switchPanel(btn.dataset.panel));
  $$('[data-go]').forEach(btn => btn.onclick = () => switchPanel(btn.dataset.go));
  $('btnLogout').onclick = () => api.logout();
  $('btnRefreshAll').onclick = () => { bootStatus(); loadPool().catch(() => {}); };
  $('btnLoadPool').onclick = () => loadPool().catch(() => {});
  $('btnFormatPool').onclick = () => formatPoolText();
  $('btnAppend').onclick = () => savePool('append').catch(() => {});
  $('btnReplace').onclick = () => savePool('replace').catch(() => {});
  $('btnRemove').onclick = () => savePool('remove').catch(() => {});
  $('btnLoadRemote').onclick = () => loadRemote({ autoSave: false }).catch(() => {});
  $('btnLoadRemoteAppend').onclick = () => loadRemote({ autoSave: true }).catch(() => {});
  $('btnLoadTrash').onclick = () => { $('poolKey').value = 'pool_trash'; switchPanel('pool'); loadPool('pool_trash').catch(() => {}); };
  $('btnClearTrash').onclick = async () => { if (!confirm('确定清空垃圾桶？此操作不可恢复。')) return; await run('垃圾桶已清空', () => api.clearTrash()).catch(() => {}); if (poolKey() === 'pool_trash') loadPool('pool_trash').catch(() => {}); };
  $('btnCreatePool').onclick = async () => { await run('IP 池已创建', () => api.createPool(poolKey())).catch(() => {}); loadPool().catch(() => {}); };
  $('btnDeletePool').onclick = async () => { if (!confirm(`确定删除 ${poolKey()}？`)) return; await run('IP 池已删除', () => api.deletePool(poolKey())).catch(() => {}); };
  $('btnCheckIp').onclick = async () => { $('checkResult').textContent = '检测中...'; const data = await run('', () => api.checkIP($('checkIp').value.trim(), $('useBackup').checked)).catch(e => ({ error: e.message })); $('checkResult').textContent = pretty(data); };
  $('btnStatus').onclick = async () => { $('statusResult').textContent = '查询中...'; const data = await run('', () => api.currentStatus($('targetIndex').value.trim() || 0)).catch(e => ({ error: e.message })); $('statusResult').textContent = pretty(data); };
  $('btnLookup').onclick = async () => { $('lookupResult').textContent = '查询中...'; const data = await run('', () => api.lookupDomain($('lookupDomain').value.trim())).catch(e => ({ error: e.message })); $('lookupResult').textContent = pretty(data); };
  $('btnMaintain').onclick = () => maintain().catch(() => {});
  $('btnLoadMapping').onclick = () => loadMapping().catch(() => {});
  $('btnSaveMapping').onclick = () => saveMapping().catch(e => toast(e.message, 'err'));
}

bind();
bootStatus();
loadPool().catch(() => {});
