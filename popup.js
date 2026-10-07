const $ = id => document.getElementById(id);
let tabId;
async function send(type, extra = {}) {
  try {
    const result = await chrome.tabs.sendMessage(tabId, {type: `xhs-player:${type}`, ...extra});
    if (!result) throw new Error('no response');
    $('openXhs').hidden = true;
    $('status').hidden = false;
    $('status').textContent = `${result.message}\n队列：${result.total} 个视频 · 已选 ${result.index < 0 ? 0 : result.index + 1} 个`;
    $('loop').checked = result.loop;
    $('queueLoop').checked = result.queueLoop;
    $('sequential').checked = !result.loop && !result.queueLoop;
    $('muted').checked = result.muted;
  } catch {
    $('status').textContent = '';
    $('status').hidden = true;
    $('openXhs').hidden = false;
  }
}
async function init() {
  $('openXhs').onclick = async () => {
    await chrome.tabs.create({url: 'https://www.xiaohongshu.com/'});
    window.close();
  };
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  tabId = tab?.id;
  for (const type of ['start','stop','next','scan']) $(type).onclick = () => send(type);
  for (const key of ['sequential','loop','queueLoop','muted']) $(key).onchange = () => {
    const mode = $('loop').checked ? 'single' : $('queueLoop').checked ? 'queue' : 'sequential';
    return send('settings', {settings: {mode, muted: $('muted').checked}});
  };
  await send('status');
  setInterval(() => send('status'), 1000);
}
init();
