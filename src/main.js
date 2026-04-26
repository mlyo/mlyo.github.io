import { api } from './api.js';

const $ = (id) => document.getElementById(id);
const pretty = (data) => typeof data === 'string' ? data : JSON.stringify(data, null, 2);

function toast(message, type = 'ok') {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast show ${type}`;
  setTimeout(() => { el.className = 'toast'; }, 2400);
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

const poolKey = () => $('poolKey').value.trim() || 'pool';

async function loadPool(key = poolKey()) {
  const data = await run('', () => api.getPool(key));
  $('poolText').value = data.pool || '';
  $('poolCount').textContent = data.count ?? 0;
  toast(`已加载 ${key}`);
}

async function savePool(mode) {
  const data = await run('保存成功', () => api.savePool({ poolKey: poolKey(), pool: $('poolText').value, mode }));
  $('poolCount').textContent = data.count ?? '-';
}


async function loadRemote({ autoSave = false } = {}) {
  const url = $('remoteUrl').value.trim();
  const cfCountry = $('remoteCountry').value.trim() || 'US';
  const port = $('remotePort').value.trim() || '443';
  const defaultPort = port;
  if (!url) throw new Error('请填写远程地址');

  const data = await run('', () => api.loadRemoteUrl({ url, cfCountry, port, defaultPort }));
  const ips = data.ips || '';
  if (!ips) {
    toast(`远程加载完成，但没有匹配 CF归属国=${cfCountry} 且端口=${port} 的 IP`, 'err');
    return;
  }

  const current = $('poolText').value.trim();
  $('poolText').value = current ? `${current}\n${ips}` : ips;
  toast(`已加载 ${data.count || 0} 个远程 IP`);

  if (autoSave) {
    const saved = await run('远程 IP 已追加保存', () => api.savePool({ poolKey: poolKey(), pool: ips, mode: 'append' }));
    $('poolCount').textContent = saved.count ?? '-';
  }
}

async function maintain() {
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
  await run('映射已保存', () => api.saveDomainPoolMapping(mapping));
}

function bind() {
  $('btnLogout').onclick = () => api.logout();
  $('btnRefreshAll').onclick = () => loadPool().catch(() => {});
  $('btnLoadPool').onclick = () => loadPool().catch(() => {});
  $('btnAppend').onclick = () => savePool('append').catch(() => {});
  $('btnReplace').onclick = () => savePool('replace').catch(() => {});
  $('btnRemove').onclick = () => savePool('remove').catch(() => {});
  $('btnLoadRemote').onclick = () => loadRemote({ autoSave: false }).catch(() => {});
  $('btnLoadRemoteAppend').onclick = () => loadRemote({ autoSave: true }).catch(() => {});
  $('btnLoadTrash').onclick = () => { $('poolKey').value = 'pool_trash'; loadPool('pool_trash').catch(() => {}); };
  $('btnClearTrash').onclick = async () => { if (!confirm('确定清空垃圾桶？')) return; await run('垃圾桶已清空', () => api.clearTrash()).catch(() => {}); if (poolKey() === 'pool_trash') loadPool('pool_trash').catch(() => {}); };
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
loadPool().catch(() => {});
