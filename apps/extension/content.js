(() => {
  const { detectPlatform, extractComment, findItems } = globalThis.LiveMateExtract;
  const platform = detectPlatform(location);
  if (!platform) return;

  const selectorKey = platform + 'Selectors';
  const captureKeys = ['enabled', selectorKey, 'serverUrl', 'roomCode', 'ingestKey'];
  const recent = new Map();
  let enabled;
  let overrides;
  let ready = false;
  let config;
  let container;
  let processed;
  let interval;
  let inFlight = false;
  let buffer = [];

  function pruneRecent(now) {
    for (const [key, time] of recent) {
      if (time > now - 30_000) break;
      recent.delete(key);
    }
  }

  function collect(item) {
    if (processed.has(item)) return;
    const comment = extractComment(item, config);
    if (!comment) return;
    processed.add(item);

    const now = Date.now();
    pruneRecent(now);
    const key = JSON.stringify([comment.buyerName, comment.text]);
    if (recent.has(key)) return;
    recent.set(key, now);
    buffer.push(comment);
  }

  function observeContainer(items) {
    observer.disconnect();
    container = items[0]?.parentElement ?? document.body;
    while (container !== document.body && !items.every((item) => container.contains(item))) {
      container = container.parentElement;
    }
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    for (let parent = container.parentElement; parent; parent = parent.parentElement) {
      observer.observe(parent, { childList: true });
    }
  }

  const observer = new MutationObserver((records) => {
    let needsRebind = !container.isConnected;
    for (const { target, addedNodes } of records) {
      for (const node of addedNodes) {
        if (!node.isConnected) continue;
        for (const item of findItems(node, config)) {
          if (!container.contains(item)) needsRebind = true;
          collect(item);
        }
      }
      if (!container.contains(target)) continue;
      const element = target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
      const item = element?.closest(config.item);
      if (item?.isConnected) collect(item);
    }
    if (needsRebind) observeContainer(findItems(document.body, config));
  });

  async function flush() {
    pruneRecent(Date.now());
    if (!enabled || inFlight || !buffer.length) return;
    const comments = buffer;
    buffer = [];
    inFlight = true;
    try {
      await chrome.runtime.sendMessage({ type: 'comments', platform, comments });
    } catch (error) {
      console.warn('LiveMate: không gửi được bình luận đến tiện ích.', error);
    } finally {
      inFlight = false;
    }
  }

  function restartCapture() {
    observer.disconnect();
    clearInterval(interval);
    buffer = [];
    recent.clear();
    if (!enabled) return;

    config = globalThis.LiveMateSelectors.getConfig(platform, overrides);
    try {
      document.querySelector(config.item);
    } catch (error) {
      if (error.name === 'SyntaxError') return;
      throw error;
    }
    const existing = findItems(document.body, config);
    processed = new WeakSet(existing);
    observeContainer(existing);
    interval = setInterval(flush, 1000);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !captureKeys.some((key) => key in changes)) return;
    if (changes.enabled) enabled = changes.enabled.newValue === true;
    if (changes[selectorKey]) overrides = changes[selectorKey].newValue ?? {};
    if (ready) restartCapture();
  });

  chrome.storage.local.get({ enabled: false, [selectorKey]: {} }).then((saved) => {
    enabled ??= saved.enabled === true;
    overrides ??= saved[selectorKey];
    ready = true;
    restartCapture();
  });

  function selectorParts(element, attributes) {
    const tag = CSS.escape(element.localName);
    const parts = [];
    for (const attribute of attributes) {
      const value = element.getAttribute(attribute);
      if (value) parts.push(tag + '[' + attribute + '="' + CSS.escape(value) + '"]');
    }
    for (const className of element.classList) parts.push(tag + '.' + CSS.escape(className));
    return parts;
  }

  function parentSelector(element) {
    if (element === document.body) return 'body';
    const parts = selectorParts(element, ['data-e2e', 'data-testid', 'aria-label', 'role']);
    if (element.id) parts.unshift('#' + CSS.escape(element.id));
    const unique = parts.find((part) => document.querySelectorAll(part).length === 1);
    if (unique) return unique;
    const siblings = Array.from(element.parentElement.children)
      .filter((sibling) => sibling.localName === element.localName);
    const position = siblings.indexOf(element) + 1;
    return parentSelector(element.parentElement) + ' > ' +
      CSS.escape(element.localName) + ':nth-of-type(' + position + ')';
  }

  function pickItem(target) {
    let repeatedTag;
    for (let element = target; element && element !== document.body; element = element.parentElement) {
      const parent = element.parentElement;
      if (!parent || !document.body.contains(element)) break;
      const siblings = Array.from(parent.children).filter((sibling) => sibling !== element);
      const parts = selectorParts(element, ['data-e2e', 'data-testid', 'role']);
      const repeated = parts.find((part) => siblings.some((sibling) => sibling.matches(part)));
      if (repeated) return parentSelector(parent) + ' > ' + repeated;
      if (!repeatedTag && siblings.some((sibling) => sibling.localName === element.localName)) {
        repeatedTag = { parent, tag: CSS.escape(element.localName) };
      }
    }
    return repeatedTag ? parentSelector(repeatedTag.parent) + ' > ' + repeatedTag.tag : null;
  }

  let notice;
  let noticeTimer;
  let pickTimer;

  function showNotice(text, duration) {
    clearTimeout(noticeTimer);
    if (!notice) {
      notice = document.createElement('div');
      notice.setAttribute('role', 'status');
      Object.assign(notice.style, {
        position: 'fixed', bottom: '16px', left: '16px', zIndex: '2147483647',
        maxWidth: 'calc(100vw - 32px)', boxSizing: 'border-box',
        padding: '10px 14px', borderRadius: '8px', background: '#172a25', color: '#fff',
        font: '14px/1.5 system-ui, sans-serif', pointerEvents: 'none',
      });
      document.body.append(notice);
    }
    notice.textContent = text;
    noticeTimer = setTimeout(() => {
      notice.remove();
      notice = undefined;
    }, duration);
  }

  function stopPicking() {
    clearTimeout(pickTimer);
    window.removeEventListener('click', handlePick, true);
    window.removeEventListener('keydown', cancelPick, true);
  }

  function cancelPick(event) {
    if (event.key !== 'Escape') return;
    stopPicking();
    showNotice('LiveMate đã hủy chọn khung bình luận.', 4000);
  }

  async function handlePick(event) {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    stopPicking();
    const target = event.target;
    target.animate([{ outline: '3px solid #10b981' }, { outline: '3px solid #10b981' }], 1800);
    const item = pickItem(target);
    if (!item) {
      showNotice('LiveMate chưa tìm thấy các dòng lặp lại. Hãy chọn trong một dòng bình luận.', 6000);
      return;
    }
    try {
      const result = await chrome.runtime.sendMessage({ type: 'selector-picked', platform, item });
      if (!result?.ok) throw new Error();
      showNotice('LiveMate đã lưu khung bình luận.', 4000);
    } catch {
      showNotice('LiveMate chưa lưu được khung bình luận. Hãy thử lại.', 6000);
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== 'pick' || sender.id !== chrome.runtime.id) return;
    stopPicking();
    showNotice('LiveMate: bấm vào một bình luận trong khung chat. Nhấn Esc để hủy.', 30_000);
    window.addEventListener('click', handlePick, true);
    window.addEventListener('keydown', cancelPick, true);
    pickTimer = setTimeout(stopPicking, 30_000);
    sendResponse({ ok: true });
  });
})();
