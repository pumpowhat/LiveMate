importScripts('extract.js');

const defaults = {
  serverUrl: 'http://localhost:4000',
  roomCode: 'DEMO',
  ingestKey: '',
  enabled: false,
};
const emptyStats = { sent: 0, accepted: 0, duplicates: 0, lastError: '', lastSentAt: null };
const statsStorage = chrome.storage.session ?? chrome.storage.local;
const maxBatchSize = 100;
const maxRetries = 3;
let queue = Promise.resolve();
let settingsVersion = 0;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(defaults).some((key) => key in changes)) settingsVersion++;
});

async function postBatch(settings, platform, comments, version) {
  const headers = { 'Content-Type': 'application/json' };
  if (settings.ingestKey) headers['X-Ingest-Key'] = settings.ingestKey;
  const url = settings.serverUrl.replace(/\/+$/u, '') + '/api/ingest';
  const body = JSON.stringify({ roomCode: settings.roomCode, platform, comments });

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (version !== settingsVersion) return null;
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      if (attempt === maxRetries) throw new Error('Không kết nối được với máy chủ LiveMate.');
      await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
      continue;
    }
    if (!response.ok) throw new Error('Gửi bình luận thất bại (HTTP ' + response.status + ').');
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error('Phản hồi từ máy chủ không hợp lệ.');
    }
    const { accepted, duplicates } = result ?? {};
    if (![accepted, duplicates].every((count) => Number.isSafeInteger(count) && count >= 0)) {
      throw new Error('Phản hồi từ máy chủ không hợp lệ.');
    }
    return { accepted, duplicates };
  }
}

async function sendComments(platform, comments, version) {
  if (version !== settingsVersion) return;
  const settings = await chrome.storage.local.get(defaults);
  if (!settings.enabled) return;
  const stored = await statsStorage.get('stats');
  const stats = { ...emptyStats, ...stored.stats };
  for (let index = 0; index < comments.length; index += maxBatchSize) {
    const batch = comments.slice(index, index + maxBatchSize);
    try {
      const result = await postBatch(settings, platform, batch, version);
      if (!result) return;
      stats.sent += batch.length;
      stats.accepted += result.accepted;
      stats.duplicates += result.duplicates;
      stats.lastError = '';
      stats.lastSentAt = new Date().toISOString();
    } catch (error) {
      stats.lastError = error.message;
    }
    await statsStorage.set({ stats });
    await chrome.action.setBadgeText({ text: String(stats.accepted) });
  }
}

async function savePickedSelector(platform, item) {
  const key = platform + 'Selectors';
  const stored = await chrome.storage.local.get({ [key]: {} });
  await chrome.storage.local.set({ [key]: { ...stored[key], item } });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.tab || !sender.url || !message) return;
  const url = new URL(sender.url);
  const platform = globalThis.LiveMateExtract.detectPlatform(url);
  if (url.protocol !== 'https:' || !platform || platform !== message.platform) return;

  if (message.type === 'selector-picked' && typeof message.item === 'string' && message.item) {
    savePickedSelector(platform, message.item)
      .then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  if (message.type !== 'comments' || !Array.isArray(message.comments)) {
    return;
  }

  const comments = message.comments
    .filter((comment) => typeof comment?.buyerName === 'string' && comment.buyerName &&
      typeof comment.text === 'string' && comment.text)
    .map(({ buyerName, text, buyerExternalId, externalId }) => ({
      buyerName, text,
      ...(typeof buyerExternalId === 'string' ? { buyerExternalId } : {}),
      ...(typeof externalId === 'string' ? { externalId } : {}),
    }));
  const version = settingsVersion;
  const task = queue.then(() => sendComments(platform, comments, version));
  queue = task.catch(() => {});
  task.then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
  return true;
});
