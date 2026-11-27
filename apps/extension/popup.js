(() => {
  const byId = (id) => document.getElementById(id);
  const settingsForm = byId('settings');
  const settingsFields = byId('settings-fields');
  const enabled = byId('enabled');
  const serverUrl = byId('server-url');
  const roomCode = byId('room-code');
  const ingestKey = byId('ingest-key');
  const health = byId('health');
  const pick = byId('pick');
  const platform = byId('platform');
  const selectorFields = byId('selector-fields');
  const selectorInputs = {
    item: byId('item-selector'),
    name: byId('name-selector'),
    text: byId('text-selector'),
  };
  const selectorOverrides = {};
  const statsArea = chrome.storage.session ? 'session' : 'local';
  const numbers = new Intl.NumberFormat('vi-VN');
  const dates = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'medium' });
  let reading = false;

  function status(text, error = false) {
    const feedback = byId('status');
    feedback.textContent = text;
    feedback.classList.toggle('error', error);
  }

  function showStats(stats = {}) {
    for (const key of ['sent', 'accepted', 'duplicates']) {
      byId(key).textContent = numbers.format(stats[key] ?? 0);
    }
    const lastSent = byId('last-sent-at');
    if (stats.lastSentAt) {
      lastSent.dateTime = stats.lastSentAt;
      lastSent.textContent = dates.format(new Date(stats.lastSentAt));
    } else {
      lastSent.removeAttribute('datetime');
      lastSent.textContent = 'Chưa gửi';
    }
    const lastError = byId('last-error');
    lastError.textContent = stats.lastError ?? '';
    lastError.hidden = !stats.lastError;
  }

  function showSelectorFields() {
    const defaults = globalThis.LiveMateSelectors[platform.value];
    for (const [name, input] of Object.entries(selectorInputs)) {
      input.value = selectorOverrides[platform.value]?.[name] ?? '';
      input.placeholder = defaults[name];
    }
  }

  function isLocalHttp(url) {
    return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  }

  function readServerUrl() {
    let url;
    try {
      url = new URL(serverUrl.value.trim());
    } catch {
      throw new Error('Nhập địa chỉ máy chủ hợp lệ.');
    }
    if ((!isLocalHttp(url) && url.protocol !== 'https:') ||
        url.username || url.password || url.search || url.hash) {
      throw new Error('Dùng địa chỉ HTTPS hoặc HTTP trên localhost, không kèm tham số hay thông tin đăng nhập.');
    }
    url.search = '';
    url.hash = '';
    return url;
  }

  async function requestServerAccess(url) {
    if (!isLocalHttp(url) && !await chrome.permissions.request({ origins: [url.origin + '/*'] })) {
      throw new Error('Hãy cho LiveMate quyền truy cập địa chỉ máy chủ này.');
    }
  }

  async function saveSettings(turnOn = false) {
    const url = readServerUrl();
    const code = roomCode.value.trim();
    if (!code) throw new Error('Nhập mã phòng.');
    const settings = {
      serverUrl: url.href.replace(/\/+$/u, ''),
      roomCode: code,
      ingestKey: ingestKey.value.trim(),
    };
    if (turnOn) settings.enabled = true;
    await requestServerAccess(url);
    await chrome.storage.local.set(settings);
    serverUrl.value = settings.serverUrl;
    roomCode.value = settings.roomCode;
    ingestKey.value = settings.ingestKey;
  }

  settingsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    settingsFields.disabled = true;
    try {
      await saveSettings();
      status('Đã lưu cài đặt.');
    } catch (error) {
      status(error.message, true);
    } finally {
      settingsFields.disabled = false;
    }
  });

  enabled.addEventListener('change', async () => {
    const turnOn = enabled.checked;
    enabled.disabled = true;
    try {
      if (turnOn) await saveSettings(true);
      else await chrome.storage.local.set({ enabled: false });
      reading = turnOn;
      status(turnOn ? 'Đang đọc bình luận mới.' : 'Đã dừng đọc bình luận.');
    } catch (error) {
      status(error.message, true);
    } finally {
      enabled.checked = reading;
      enabled.disabled = false;
    }
  });

  health.addEventListener('click', async () => {
    health.disabled = true;
    try {
      const url = readServerUrl();
      await requestServerAccess(url);
      status('Đang kiểm tra kết nối…');
      let response;
      try {
        response = await fetch(url.href.replace(/\/+$/u, '') + '/health', {
          credentials: 'omit',
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        throw new Error('Không kết nối được với máy chủ LiveMate.');
      }
      if (!response.ok) throw new Error('Kiểm tra kết nối thất bại (HTTP ' + response.status + ').');
      status('Đã kết nối với máy chủ LiveMate.');
    } catch (error) {
      status(error.message, true);
    } finally {
      health.disabled = false;
    }
  });

  pick.addEventListener('click', async () => {
    pick.disabled = true;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id == null) throw new Error();
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'pick' }, { frameId: 0 });
      if (!response?.ok) throw new Error();
      status('Bấm vào một dòng bình luận trên trang live. Nhấn Esc để hủy.');
    } catch {
      status('Mở hoặc tải lại trang TikTok Live hoặc Facebook Live rồi thử lại.', true);
    } finally {
      pick.disabled = false;
    }
  });

  platform.addEventListener('change', showSelectorFields);
  byId('selectors').addEventListener('submit', async (event) => {
    event.preventDefault();
    const overrides = {};
    for (const [field, input] of Object.entries(selectorInputs)) {
      const selector = input.value.trim();
      if (!selector) continue;
      try {
        document.querySelector(selector);
      } catch {
        status('Bộ chọn CSS không hợp lệ. Hãy kiểm tra ô được chọn.', true);
        input.focus();
        return;
      }
      overrides[field] = selector;
    }

    selectorFields.disabled = true;
    try {
      await chrome.storage.local.set({ [platform.value + 'Selectors']: overrides });
      status('Đã lưu bộ chọn bình luận.');
    } catch {
      status('Không lưu được bộ chọn bình luận.', true);
    } finally {
      selectorFields.disabled = false;
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === statsArea && changes.stats) showStats(changes.stats.newValue);
    if (area !== 'local') return;
    if (changes.enabled) {
      reading = changes.enabled.newValue === true;
      enabled.checked = reading;
    }
    for (const name of ['tiktok', 'facebook']) {
      const change = changes[name + 'Selectors'];
      if (!change) continue;
      selectorOverrides[name] = change.newValue;
      if (platform.value === name) showSelectorFields();
    }
  });

  Promise.all([
    chrome.storage.local.get({
      serverUrl: 'http://localhost:4000', roomCode: 'DEMO', ingestKey: '',
      enabled: false, tiktokSelectors: {}, facebookSelectors: {},
    }),
    chrome.storage[statsArea].get('stats'),
  ]).then(([saved, { stats }]) => {
    serverUrl.value = saved.serverUrl;
    roomCode.value = saved.roomCode;
    ingestKey.value = saved.ingestKey;
    reading = saved.enabled === true;
    enabled.checked = reading;
    selectorOverrides.tiktok = saved.tiktokSelectors;
    selectorOverrides.facebook = saved.facebookSelectors;
    showSelectorFields();
    showStats(stats);
    settingsFields.disabled = false;
    selectorFields.disabled = false;
    enabled.disabled = false;
  }).catch(() => status('Không tải được cài đặt LiveMate.', true));
})();
