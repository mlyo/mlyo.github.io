import { api, getApiBase, getAuthKey, saveConfig, clearConfig } from './api.js';

const $ = id => document.getElementById(id);

function log(message, type = 'info') {
  const line = `[${new Date().toLocaleTimeString()}] ${type.toUpperCase()} ${message}`;
  $('logs').textContent = `${line}\n${$('logs').textContent}`.slice(0, 12000);
}

function showJson(el, data) {
  el.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

async function run(label, fn) {
  try {
    log(`${label}...`);
    const data = await fn();
    log(`${label}成功`, 'success');
    return data;
  } catch (e) {
    log(`${label}失败：${e.message}`, 'error');
    alert(e.message);
    throw e;
  }
}

function initConfig() {
  $('apiBase').value = getApiBase();
  $('authKey').value = getAuthKey();
}

$('btnSaveConfig').addEventListener('click', () => {
  saveConfig($('apiBase').value, $('authKey').value);
  log('配置已保存', 'success');
});

$('btnClearConfig').addEventListener('click', () => {
  clearConfig();
  initConfig();
  log('配置已清除');
});

$('btnPing').addEventListener('click', async () => {
  const data = await run('测试后端', () => api.ping());
  showJson($('checkResult'), data);
});

$('btnLoadPool').addEventListener('click', async () => {
  const poolKey = $('poolKey').value.trim() || 'pool';
  const data = await run('加载 IP 池', () => api.getPool(poolKey));
  $('poolText').value = data.pool || '';
  $('poolCount').textContent = data.count ?? 0;
});

async function savePool(mode) {
  const poolKey = $('poolKey').value.trim() || 'pool';
  const pool = $('poolText').value;
  const data = await run(`保存 IP 池：${mode}`, () => api.savePool({ poolKey, pool, mode }));
  $('poolCount').textContent = data.count ?? '-';
  showJson($('checkResult'), data);
}

$('btnAppendPool').addEventListener('click', () => savePool('append'));
$('btnReplacePool').addEventListener('click', () => {
  if (confirm('确定覆盖当前 IP 池？原内容会被替换。')) savePool('replace');
});
$('btnRemovePool').addEventListener('click', () => savePool('remove'));

$('btnCheckIp').addEventListener('click', async () => {
  const ip = $('checkIp').value.trim();
  if (!ip) return alert('请填写 IP:PORT');
  const data = await run('检测 ProxyIP', () => api.checkIP(ip));
  showJson($('checkResult'), data);
});

$('btnMaintain').addEventListener('click', async () => {
  if (!confirm('确定开始手动维护？')) return;
  const data = await run('手动维护', () => api.maintain());
  const logs = data.allLogs || data.reports?.flatMap(r => r.logs || []) || [];
  $('maintainLogs').textContent = logs.join('\n') || JSON.stringify(data, null, 2);
});

$('btnStatus').addEventListener('click', async () => {
  const target = $('targetIndex').value || '0';
  const data = await run('查看域名状态', () => api.currentStatus(target));
  showJson($('statusResult'), data);
});

$('btnLookup').addEventListener('click', async () => {
  const domain = $('lookupDomain').value.trim();
  if (!domain) return alert('请填写域名');
  const data = await run('查询域名解析', () => api.lookupDomain(domain));
  showJson($('lookupResult'), data);
});

$('btnLoadMapping').addEventListener('click', async () => {
  const data = await run('加载 IP 池映射', () => api.getDomainPoolMapping());
  $('mappingText').value = JSON.stringify(data.mapping || {}, null, 2);
});

$('btnSaveMapping').addEventListener('click', async () => {
  let mapping;
  try { mapping = JSON.parse($('mappingText').value || '{}'); }
  catch { return alert('映射内容不是有效 JSON'); }
  const data = await run('保存 IP 池映射', () => api.saveDomainPoolMapping(mapping));
  showJson($('statusResult'), data);
});

initConfig();
log('前端已就绪');
