(() => {
  'use strict';
  if (globalThis.__xhsVideoQueue) return;
  globalThis.__xhsVideoQueue = true;
  const CARD = 'section.note-item, .note-item, [data-note-id]';
  const DETAIL = '.note-detail-mask, .note-detail, #noteContainer, .note-container';
  let settings = {mode: 'sequential', loop: false, queueLoop: false, muted: false};
  function normalizeSettings(value, changedKey) {
    const next = {loop: !!value.loop, queueLoop: !!value.queueLoop, muted: !!value.muted};
    if (value.mode !== undefined) {
      next.loop = value.mode === 'single';
      next.queueLoop = value.mode === 'queue';
    }
    if (next.loop && next.queueLoop) {
      if (changedKey === 'queueLoop') next.loop = false;
      else next.queueLoop = false;
    }
    return {...next, mode: next.loop ? 'single' : next.queueLoop ? 'queue' : 'sequential'};
  }
  let running = false, queue = [], index = -1, video = null, original = null;
  let generation = 0, busy = false, message = '准备就绪，点击开始播放。';
  let lastSource = '', opening = false;
  const visible = el => !!el && el.isConnected && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const keyOf = href => {
    try {
      const url = new URL(href, location.href);
      if (url.origin !== location.origin && url.origin !== 'https://www.xiaohongshu.com') return null;
      // 作者页笔记使用 /user/profile/<作者ID>/<笔记ID>；作者主页本身不是笔记。
      return url.pathname.match(/^\/(?:explore|discovery\/item)\/([a-zA-Z0-9]+)\/?$/)?.[1] ||
        url.pathname.match(/^\/user\/profile\/[a-zA-Z0-9]+\/([a-zA-Z0-9]+)\/?$/)?.[1] || null;
    } catch {return null;}
  };
  const currentKey = () => keyOf(location.href);
  function cards() {
    const seen = new Set();
    return [...document.querySelectorAll(CARD)].filter(visible).map((card, order) => {
      const links = [...card.querySelectorAll('a[href]')];
      const anchor = links.find(a => a.matches('a.cover') && keyOf(a.href)) ||
        links.find(a => a.matches('a.title') && keyOf(a.href)) || links.find(a => keyOf(a.href)) ||
        card.querySelector('a.cover, .cover');
      const dataId = card.getAttribute('data-note-id');
      const id = (anchor?.href && keyOf(anchor.href)) || (/^[a-zA-Z0-9]{24}$/.test(dataId || '') ? dataId : null);
      const marker = card.querySelector('video, .play-icon, .video-icon, [class*="video-play"], [class*="play-icon"], [class*="video-icon"]') ||
        [...card.querySelectorAll('use')].some(el => /video|play/i.test(el.getAttribute('href') || el.getAttribute('xlink:href') || ''));
      if (!anchor || !id || !marker || seen.has(id)) return null;
      seen.add(id);
      const rect = card.getBoundingClientRect();
      return {id, anchor, top: rect.top, left: rect.left, order};
    }).filter(Boolean).sort((a,b) => a.top - b.top || a.left - b.left || a.order - b.order);
  }
  function scan() {
    const found = cards();
    const selected = queue[index]?.id;
    queue = found.map(({id}) => ({id}));
    index = queue.findIndex(item => item.id === (selected || currentKey()));
    message = `已找到 ${queue.length} 个视频。${queue.length ? '' : '请返回列表并向下滚动加载视频，或打开一个视频使用循环。'}`;
  }
  function activeVideo() {
    const all = [...document.querySelectorAll('video')].filter(visible).filter(v => v.closest(DETAIL) || !v.closest(CARD));
    return all.sort((a,b) => {
      const score = v => (v.closest(DETAIL) ? 1e8 : 0) + v.getBoundingClientRect().width * v.getBoundingClientRect().height;
      return score(b) - score(a);
    })[0] || null;
  }
  function release() {
    if (!video) return;
    video.removeEventListener('ended', onEnded);
    video.removeEventListener('play', onPlay);
    video.removeEventListener('error', onError);
    if (original) {video.loop = original.loop; video.muted = original.muted;}
    video = null; original = null; lastSource = '';
  }
  function stop(reason = '已停止接管，播放器恢复原设置。') {
    running = false; generation++; busy = false; opening = false; release(); message = reason;
  }
  async function play(v, token) {
    try {await v.play();} catch (error) {
      if (running && generation === token && error.name !== 'AbortError') message = '自动播放被阻止：请手动点击一次播放，或开启静音后重新开始。';
    }
  }
  function onPlay() {if (running) message = settings.loop ? '正在循环当前视频。' : '正在顺序播放。';}
  function onError() {if (running) stop('视频加载失败，已停止。请在网页中确认视频可播放后重试。');}
  function bind(v) {
    if (video !== v) {
      release(); video = v; original = {loop: v.loop, muted: v.muted};
      v.addEventListener('ended', onEnded); v.addEventListener('play', onPlay); v.addEventListener('error', onError);
    }
    v.loop = false; v.muted = settings.muted;
    lastSource = v.currentSrc || v.src;
    if (v.ended) {onEnded();} else {play(v, generation);}
  }
  function replayButton(v) {
    const root = v.closest(DETAIL) || v.parentElement;
    if (!root) return null;
    const nativeReplay = [...root.querySelectorAll('xg-replay.xgplayer-replay')].find(visible);
    if (nativeReplay) return nativeReplay;
    return [...root.querySelectorAll('button, [role="button"], [class*="replay"], span, div')]
      .filter(visible).find(el => /^(重播|重新播放|再看一遍|Replay)$/i.test((el.textContent || '').trim()) && el.children.length <= 1) ||
      [...root.querySelectorAll('[class*="replay"], [aria-label="重播"]')].find(visible);
  }
  async function onEnded() {
    if (!running || busy || !video) return;
    busy = true;
    const token = generation, v = video;
    if (!settings.loop) {
      busy = false;
      if (!queue.length) {stop('当前视频播放完毕。返回列表后可建立顺序播放队列。'); return;}
      await next(); return;
    }
    message = '视频结束，正在重播…';
    await delay(250);
    if (!running || token !== generation || video !== v) return;
    const button = replayButton(v);
    if (button) button.click();
    await delay(350);
    if (!running || token !== generation || video !== v) return;
    if (v.ended || v.paused) {
      try {v.currentTime = 0;} catch {}
      await play(v, token);
    }
    busy = false;
  }
  async function waitFor(fn, token, timeout = 12000) {
    const end = Date.now() + timeout;
    while (running && token === generation && Date.now() < end) {
      const result = fn(); if (result) return result;
      await delay(200);
    }
    return null;
  }
  async function openItem(target) {
    if (!running || busy) return;
    if (target >= queue.length) {
      if (settings.queueLoop && queue.length) target = 0;
      else {stop('当前队列已播放完毕。加载更多视频后可刷新队列。'); return;}
    }
    const token = ++generation;
    busy = true; opening = true; message = '正在打开下一个视频…';
    const old = video || activeVideo();
    if (old) old.pause();
    release();
    if (old) {
      const root = old.closest('.note-detail-mask') || document.querySelector('.note-detail-mask') || old.closest(DETAIL);
      const close = root?.querySelector('.close-circle, .close-icon, [aria-label="关闭"], button.close') || document.querySelector('.close-circle');
      if (!visible(close)) {stop('无法找到详情关闭按钮。请返回列表后重新开始。'); return;}
      close.click();
      const closed = await waitFor(() => !visible(old), token, 4000);
      if (!closed) {if (token === generation) stop('详情未关闭，请返回列表后重新开始。'); return;}
    }
    if (!running || token !== generation) return;
    const item = cards().find(card => card.id === queue[target].id);
    if (!item) {stop('下一条卡片已从页面移除，请返回列表刷新队列。'); return;}
    index = target;
    item.anchor.scrollIntoView({block:'center'});
    item.anchor.click();
    const v = await waitFor(activeVideo, token);
    if (!running || token !== generation) return;
    busy = false; opening = false;
    if (!v) {stop('未检测到视频。可能需要登录、视频加载失败或页面结构已变化。'); return;}
    message = settings.loop ? '正在循环当前视频。' : '正在顺序播放。';
    bind(v);
  }
  async function next() {
    if (busy) return;
    if (!queue.length) {message = '没有视频队列，请返回列表刷新队列。'; return;}
    running = true;
    await openItem(index + 1);
  }
  async function start() {
    stop(); running = true;
    const v = activeVideo();
    // SPA 从首页进入作者主页不会重新注入脚本，不能沿用上个列表的队列。
    if (!v || !queue.length) scan();
    if (v) {
      index = queue.findIndex(item => item.id === currentKey());
      message = settings.loop ? '正在循环当前视频。' : '正在播放当前视频，结束后继续队列。';
      bind(v);
    } else if (queue.length) {await openItem(0);}
    else {stop('未找到视频。请加载视频卡片，或手动打开一个视频后开始。');}
  }
  const ready = chrome.storage.local.get('xhsPlayerSettings').then(async data => {
    const saved = data.xhsPlayerSettings || {};
    settings = normalizeSettings({...saved, mode: saved.mode || 'sequential'});
    if (saved.mode !== settings.mode || saved.loop !== settings.loop || saved.queueLoop !== settings.queueLoop) {
      await chrome.storage.local.set({xhsPlayerSettings: settings});
    }
  }).catch(() => {});
  chrome.runtime.onMessage.addListener((request, sender, respond) => {
    if (!request.type?.startsWith('xhs-player:')) return;
    ready.then(async () => {
      const type = request.type.slice(11);
      if (type === 'settings') {
        settings = normalizeSettings(request.settings, request.changedKey);
        await chrome.storage.local.set({xhsPlayerSettings: settings});
        if (video) video.muted = settings.muted;
      }
      if (type === 'scan') {stop(); scan();}
      if (type === 'start') void start();
      if (type === 'stop') stop();
      if (type === 'next') void next();
      respond({...settings, running, total: queue.length, index, message});
    }).catch(error => respond({...settings, total: queue.length, index, message: `操作失败：${error.message}`}));
    return true;
  });
  setInterval(() => {
    if (!running || opening || busy) return;
    const v = activeVideo();
    if (!v) {if (video) stop('详情已关闭，自动播放已停止。'); return;}
    if (v !== video || (v.currentSrc || v.src) !== lastSource) {bind(v); return;}
    // 网站可能重新设置 loop；关闭原生循环，确保 ended 能驱动队列。
    if (v.loop) v.loop = false;
  }, 500);
  window.addEventListener('pagehide', () => stop());
})();
