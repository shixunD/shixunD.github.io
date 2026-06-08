'use strict';

const BACKUP_SCHEMA_VERSION = 2;
const BACKUP_FILE_PREFIX = 'paperdesign-backup';
const APP_PREF_PREFIX = 'pb-';
const ONEDRIVE_DEFAULT_CLIENT_ID = 'f5bc199c-44bd-495e-9168-7efb5262b048';
const ONEDRIVE_DEFAULT_TENANT = 'a27888d4-ada2-4871-b099-316283e9bdf5';
const ONEDRIVE_DEFAULT_REDIRECT_URI = 'https://shixund.github.io/PromptBuilder';
const ONEDRIVE_APP_FOLDER = 'PaperDesignBackups';
const ONEDRIVE_OAUTH_SCOPES = ['Files.ReadWrite.AppFolder', 'User.Read'];
const ONEDRIVE_HISTORY_PAGE_SIZE = 10;
const UPDATE_CHECK_LAST_REMOTE_KEY = 'pb-update-last-remote-pushed-at';
const UPDATE_CHECK_RELOAD_GUARD_KEY = 'pb-update-reload-guard';

const StartupUpdateChecker = {
  _isHttpPage() {
    return window.location.protocol === 'http:' || window.location.protocol === 'https:';
  },

  _resolveGitHubRepoCandidates() {
    const host = (window.location.hostname || '').toLowerCase();
    if (!host.endsWith('.github.io')) return null;

    const owner = host.slice(0, -'.github.io'.length);
    if (!owner) return null;

    const seg = (window.location.pathname || '')
      .split('/')
      .filter(Boolean);

    const candidates = [];
    const seen = new Set();

    const pushCandidate = (repo) => {
      const normalized = (repo || '').trim();
      if (!normalized) return;
      const key = `${owner}/${normalized}`.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({ owner, repo: normalized });
    };

    if (seg.length > 0) {
      pushCandidate(seg[0]);
    }
    pushCandidate(`${owner}.github.io`);

    return candidates.length > 0 ? candidates : null;
  },

  _buildReloadUrl(remoteStamp) {
    const url = new URL(window.location.href);
    const stamp = String(remoteStamp || Date.now());
    url.searchParams.set('pb_update', stamp);
    return url.toString();
  },

  async _fetchRemotePushStamp(owner, repo) {
    const endpoint = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const resp = await fetch(endpoint, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
      },
    });

    if (!resp.ok) {
      throw new Error(`GitHub API ${resp.status}`);
    }

    const data = await resp.json();
    return data && (data.pushed_at || data.updated_at || null);
  },

  async checkAndReloadIfUpdated() {
    if (!StartupUpdateChecker._isHttpPage()) return false;

    const repoCandidates = StartupUpdateChecker._resolveGitHubRepoCandidates();
    if (!repoCandidates || repoCandidates.length === 0) return false;

    let remoteStamp = null;
    let lastErr = null;
    try {
      for (const repoInfo of repoCandidates) {
        try {
          remoteStamp = await StartupUpdateChecker._fetchRemotePushStamp(repoInfo.owner, repoInfo.repo);
          if (remoteStamp) break;
        } catch (err) {
          lastErr = err;
        }
      }
    } catch {
      // noop
    }

    if (!remoteStamp) {
      if (lastErr) console.warn('Update check skipped:', lastErr);
      return false;
    }

    const previousRemoteStamp = localStorage.getItem(UPDATE_CHECK_LAST_REMOTE_KEY);
    localStorage.setItem(UPDATE_CHECK_LAST_REMOTE_KEY, String(remoteStamp));

    if (!previousRemoteStamp) return false;
    if (previousRemoteStamp === String(remoteStamp)) return false;

    const guard = sessionStorage.getItem(UPDATE_CHECK_RELOAD_GUARD_KEY);
    if (guard === String(remoteStamp)) return false;
    sessionStorage.setItem(UPDATE_CHECK_RELOAD_GUARD_KEY, String(remoteStamp));

    Toast.show('检测到线上更新，正在刷新到最新版本...', 1800);
    setTimeout(() => {
      window.location.replace(StartupUpdateChecker._buildReloadUrl(remoteStamp));
    }, 280);
    return true;
  },
};

const OneDriveOAuth = {
  _msalApp: null,
  _configKey: '',

  _normalizeRedirect(uri) {
    const text = (uri || '').trim();
    if (!text) return ONEDRIVE_DEFAULT_REDIRECT_URI;
    return text.endsWith('/') ? text.slice(0, -1) : text;
  },

  _presetConfig() {
    return {
      clientId: ONEDRIVE_DEFAULT_CLIENT_ID,
      tenant: ONEDRIVE_DEFAULT_TENANT,
      redirectUri: OneDriveOAuth._normalizeRedirect(ONEDRIVE_DEFAULT_REDIRECT_URI),
      source: 'preset',
    };
  },

  readConfig() {
    return OneDriveOAuth._presetConfig();
  },

  isConfigured(config) {
    return !!(config && config.clientId);
  },

  async ensureConfigured() {
    const config = OneDriveOAuth.readConfig();
    if (OneDriveOAuth.isConfigured(config)) return config;
    throw new Error('OneDrive OAuth 默认配置不可用，请联系维护者检查 Client ID');
  },

  _ensureSdkLoaded() {
    if (!window.msal || typeof window.msal.PublicClientApplication !== 'function') {
      throw new Error('OneDrive OAuth SDK 未加载，请检查网络或刷新页面');
    }
  },

  async _getMsalApp(config) {
    OneDriveOAuth._ensureSdkLoaded();
    const key = `${config.clientId}|${config.tenant}|${config.redirectUri}`;
    if (OneDriveOAuth._msalApp && OneDriveOAuth._configKey === key) {
      return OneDriveOAuth._msalApp;
    }

    const app = new window.msal.PublicClientApplication({
      auth: {
        clientId: config.clientId,
        authority: `https://login.microsoftonline.com/${config.tenant}`,
        redirectUri: config.redirectUri,
      },
      cache: {
        cacheLocation: 'localStorage',
        storeAuthStateInCookie: false,
      },
    });

    if (typeof app.initialize === 'function') {
      await app.initialize();
    }

    OneDriveOAuth._msalApp = app;
    OneDriveOAuth._configKey = key;
    return app;
  },

  async acquireAccessToken(interactive = true, forceSelectAccount = false) {
    const config = await OneDriveOAuth.ensureConfigured(interactive);
    const app = await OneDriveOAuth._getMsalApp(config);

    let account = forceSelectAccount ? null : (app.getAllAccounts()[0] || null);
    if (!account) {
      if (!interactive) {
        throw new Error('OneDrive 未登录，请先完成 OAuth 登录');
      }
      const loginResult = await app.loginPopup({
        scopes: ONEDRIVE_OAUTH_SCOPES,
        prompt: 'select_account',
      });
      account = (loginResult && loginResult.account) || app.getAllAccounts()[0] || null;
    }

    try {
      const silent = await app.acquireTokenSilent({
        account,
        scopes: ONEDRIVE_OAUTH_SCOPES,
      });
      return silent.accessToken;
    } catch {
      if (!interactive) {
        throw new Error('无法静默获取 OneDrive 令牌');
      }
      const popup = await app.acquireTokenPopup({
        account: account || undefined,
        scopes: ONEDRIVE_OAUTH_SCOPES,
        prompt: forceSelectAccount ? 'select_account' : 'consent',
      });
      return popup.accessToken;
    }
  },

  _extractServiceMessage(detail) {
    if (!detail) return '';
    try {
      const parsed = JSON.parse(detail);
      return (parsed && parsed.error && parsed.error.message) || '';
    } catch {
      return '';
    }
  },

  _buildGraphError(prefix, status, detail) {
    const serviceMessage = OneDriveOAuth._extractServiceMessage(detail);
    const shortDetail = detail ? detail.slice(0, 200) : '';
    const mergedMessage = `${serviceMessage} ${shortDetail}`.trim();

    if (/Tenant does not have a SPO license/i.test(mergedMessage)) {
      return new Error('当前登录账户所在租户未开通 OneDrive/SharePoint 许可证，请切换为个人微软账号或已分配许可证的 Microsoft 365 账号');
    }

    const text = (serviceMessage || shortDetail || '未知错误').trim();
    return new Error(`${prefix} (${status}) ${text}`.trim());
  },

  async uploadJson(fileName, jsonText, options = {}) {
    const token = await OneDriveOAuth.acquireAccessToken(true, !!options.forceSelectAccount);
    const safeName = (fileName || buildBackupFileName()).replace(/[\\/:*?"<>|]/g, '_');
    const encodedPath = `${ONEDRIVE_APP_FOLDER}/${safeName}`
      .split('/')
      .map(seg => encodeURIComponent(seg))
      .join('/');

    const resp = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/special/approot:/${encodedPath}:/content`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json;charset=utf-8',
        },
        body: jsonText,
      }
    );

    if (!resp.ok) {
      const detail = await resp.text();
      throw OneDriveOAuth._buildGraphError('OneDrive 上传失败', resp.status, detail);
    }

    return resp.json();
  },

  async listBackupHistory(nextLink = '') {
    const token = await OneDriveOAuth.acquireAccessToken(true);
    const endpoint = nextLink ||
      `https://graph.microsoft.com/v1.0/me/drive/special/approot:/${encodeURIComponent(ONEDRIVE_APP_FOLDER)}:/children?$top=${ONEDRIVE_HISTORY_PAGE_SIZE}&$orderby=lastModifiedDateTime desc&$select=id,name,size,lastModifiedDateTime,file`;

    const resp = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (resp.status === 404) {
      return { items: [], nextLink: '' };
    }

    if (!resp.ok) {
      const detail = await resp.text();
      throw OneDriveOAuth._buildGraphError('读取 OneDrive 历史失败', resp.status, detail);
    }

    const data = await resp.json();
    const rawItems = Array.isArray(data.value) ? data.value : [];
    const items = rawItems
      .filter((item) => item && item.file)
      .map((item) => ({
        id: item.id,
        name: item.name || '',
        size: Number.isFinite(item.size) ? item.size : Number(item.size || 0),
        lastModifiedDateTime: item.lastModifiedDateTime || '',
      }));

    return {
      items,
      nextLink: data['@odata.nextLink'] || '',
    };
  },

  async downloadHistoryItem(itemId) {
    const token = await OneDriveOAuth.acquireAccessToken(true);
    const resp = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(itemId)}/content`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!resp.ok) {
      const detail = await resp.text();
      throw OneDriveOAuth._buildGraphError('下载 OneDrive 历史备份失败', resp.status, detail);
    }

    return resp.blob();
  },
};

function appPrefKeys() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(APP_PREF_PREFIX)) keys.push(key);
  }
  return keys;
}

function collectAppPreferences() {
  const prefs = {};
  appPrefKeys().forEach((key) => {
    prefs[key] = localStorage.getItem(key);
  });
  return prefs;
}

function replaceAppPreferences(nextPrefs) {
  appPrefKeys().forEach((key) => localStorage.removeItem(key));
  Object.entries(nextPrefs || {}).forEach(([key, value]) => {
    if (!key.startsWith(APP_PREF_PREFIX)) return;
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  });
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function buildBackupFileName() {
  const now = new Date();
  const pad = (num) => String(num).padStart(2, '0');
  return `${BACKUP_FILE_PREFIX}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`;
}

function buildOneDriveDialogDefaultName() {
  const now = new Date();
  const pad = (num) => String(num).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}--${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

function normalizeOneDriveUploadName(fileName) {
  let name = (fileName || '').trim();
  if (!name) name = buildOneDriveDialogDefaultName();
  name = name.replace(/[\\/:*?"<>|]/g, '-');
  if (!/\.json$/i.test(name)) name += '.json';
  return name;
}

function formatOneDriveHistoryTime(isoText) {
  const ts = new Date(isoText || '');
  if (Number.isNaN(ts.getTime())) return '时间未知';
  const pad = (num) => String(num).padStart(2, '0');
  return `${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())} ${pad(ts.getHours())}:${pad(ts.getMinutes())}:${pad(ts.getSeconds())}`;
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function triggerBlobDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadJsonFile(fileName, jsonText) {
  const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
  triggerBlobDownload(blob, fileName);
}

function normalizeCanvasName(name, index) {
  const text = typeof name === 'string' ? name.trim() : '';
  return text || `Canvas ${index + 1}`;
}

function textToSafeHtml(text) {
  if (typeof text !== 'string' || !text) return '';

  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\r\n?/g, '\n')
    .replace(/\n/g, '<br>');
}

function collectPipelineSnapshot(canvases) {
  const pipelines = {};
  (canvases || []).forEach((canvas) => {
    if (!canvas || typeof canvas !== 'object' || typeof canvas.id !== 'string') return;
    pipelines[canvas.id] = Array.isArray(canvas.pipeline) ? canvas.pipeline : [];
  });
  return pipelines;
}

function collectUIState() {
  const panel = document.getElementById('canvas-panel');
  const result = document.getElementById('result-content');
  return {
    activeCanvasId: S.activeCanvasId || null,
    canvasScroll: {
      left: panel ? panel.scrollLeft : 0,
      top: panel ? panel.scrollTop : 0,
    },
    resultHtml: result ? result.innerHTML : '',
  };
}

function applyImportedUIState(uiState) {
  if (!uiState || typeof uiState !== 'object') return;
  const panel = document.getElementById('canvas-panel');
  if (!panel) return;

  const left = Number.isFinite(Number(uiState.canvasScroll && uiState.canvasScroll.left))
    ? Math.max(0, Number(uiState.canvasScroll.left))
    : 0;
  const top = Number.isFinite(Number(uiState.canvasScroll && uiState.canvasScroll.top))
    ? Math.max(0, Number(uiState.canvasScroll.top))
    : 0;

  requestAnimationFrame(() => {
    panel.scrollTo({ left, top, behavior: 'auto' });

    const result = document.getElementById('result-content');
    if (result && typeof uiState.resultHtml === 'string') {
      result.innerHTML = uiState.resultHtml;
    }
  });
}

function parseImportedPayload(text) {
  const parsed = JSON.parse(text);

  if (parsed && parsed.snapshot && typeof parsed.snapshot === 'object') {
    const snapshot = parsed.snapshot;
    const db = snapshot.db && typeof snapshot.db === 'object' ? snapshot.db : {};
    const stores = db.stores && typeof db.stores === 'object' ? db.stores : {};
    const settings = snapshot.settings && typeof snapshot.settings === 'object' ? snapshot.settings : {};

    const canvases = Array.isArray(db.canvases)
      ? db.canvases
      : (Array.isArray(stores.canvases) ? stores.canvases : null);
    const blocks = Array.isArray(db.blocks)
      ? db.blocks
      : (Array.isArray(stores.blocks) ? stores.blocks : null);

    if (Array.isArray(canvases) && Array.isArray(blocks)) {
      return {
        canvases,
        blocks,
        pipelines: db.pipelines && typeof db.pipelines === 'object' ? db.pipelines : null,
        preferences: settings.localStorage && typeof settings.localStorage === 'object'
          ? settings.localStorage
          : (settings.preferences && typeof settings.preferences === 'object' ? settings.preferences : {}),
        uiState: snapshot.ui && typeof snapshot.ui === 'object' ? snapshot.ui : {},
      };
    }
  }

  if (parsed && parsed.data && typeof parsed.data === 'object') {
    const data = parsed.data;
    if (Array.isArray(data.canvases) && Array.isArray(data.blocks)) {
      const settings = data.settings && typeof data.settings === 'object' ? data.settings : {};
      return {
        canvases: data.canvases,
        blocks: data.blocks,
        pipelines: data.pipelines && typeof data.pipelines === 'object' ? data.pipelines : null,
        preferences: data.preferences && typeof data.preferences === 'object'
          ? data.preferences
          : (settings.localStorage && typeof settings.localStorage === 'object' ? settings.localStorage : {}),
        uiState: data.uiState && typeof data.uiState === 'object'
          ? data.uiState
          : (parsed.uiState && typeof parsed.uiState === 'object' ? parsed.uiState : {}),
      };
    }
  }

  if (parsed && Array.isArray(parsed.canvases) && Array.isArray(parsed.blocks)) {
    return {
      canvases: parsed.canvases,
      blocks: parsed.blocks,
      pipelines: parsed.pipelines && typeof parsed.pipelines === 'object' ? parsed.pipelines : null,
      preferences: parsed.preferences && typeof parsed.preferences === 'object' ? parsed.preferences : {},
      uiState: parsed.uiState && typeof parsed.uiState === 'object' ? parsed.uiState : {},
    };
  }

  throw new Error('备份格式不正确');
}

function normalizeImportedData(rawData) {
  const rawCanvases = Array.isArray(rawData.canvases) ? rawData.canvases : [];
  const rawBlocks = Array.isArray(rawData.blocks) ? rawData.blocks : [];
  const rawPipelines = rawData.pipelines && typeof rawData.pipelines === 'object' ? rawData.pipelines : null;
  const rawPrefs = rawData.preferences && typeof rawData.preferences === 'object' ? rawData.preferences : {};
  const rawUiState = rawData.uiState && typeof rawData.uiState === 'object' ? rawData.uiState : {};

  const canvases = [];
  const rawPipelineByCanvas = new Map();
  const canvasIds = new Set();
  const oldToNewCanvasId = new Map();

  rawCanvases.forEach((item, idx) => {
    if (!item || typeof item !== 'object') return;
    const originalId = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : '';
    let id = originalId || uid();
    while (canvasIds.has(id)) id = uid();
    canvasIds.add(id);
    if (originalId) oldToNewCanvasId.set(originalId, id);

    canvases.push({
      id,
      name: normalizeCanvasName(item.name, idx),
      description: typeof item.description === 'string' ? item.description : '',
      createdAt: Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : (Date.now() - idx),
      pipeline: [],
    });

    rawPipelineByCanvas.set(id, Array.isArray(item.pipeline) ? item.pipeline : []);
  });

  if (rawPipelines) {
    Object.entries(rawPipelines).forEach(([rawCanvasId, pipeline]) => {
      if (!Array.isArray(pipeline)) return;
      const mappedCanvasId = oldToNewCanvasId.get(rawCanvasId) || rawCanvasId;
      if (!canvasIds.has(mappedCanvasId)) return;
      rawPipelineByCanvas.set(mappedCanvasId, pipeline);
    });
  }

  const blocks = [];
  const blockIds = new Set();
  const blockToCanvas = new Map();
  const oldToNewBlockId = new Map();

  rawBlocks.forEach((item, idx) => {
    if (!item || typeof item !== 'object') return;
    const rawCanvasId = typeof item.canvasId === 'string' ? item.canvasId.trim() : '';
    const canvasId = oldToNewCanvasId.get(rawCanvasId) || rawCanvasId;
    if (!canvasIds.has(canvasId)) return;

    const originalId = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : '';
    let id = originalId || uid();
    while (blockIds.has(id)) id = uid();
    blockIds.add(id);
    blockToCanvas.set(id, canvasId);
    if (originalId) oldToNewBlockId.set(originalId, id);

    const htmlContent = typeof item.htmlContent === 'string' ? item.htmlContent : '';
    const textContent = typeof item.textContent === 'string'
      ? item.textContent
      : (typeof item.content === 'string' ? item.content : '');

    blocks.push({
      id,
      canvasId,
      name: normalizeBlockName(typeof item.name === 'string' ? item.name : `块 ${idx + 1}`),
      htmlContent: htmlContent || textToSafeHtml(textContent),
      pipelineColor: BLOCK_COLOR_MAP[item.pipelineColor] ? item.pipelineColor : DEFAULT_BLOCK_COLOR,
      x: Number.isFinite(Number(item.x)) ? Math.max(0, Number(item.x)) : 0,
      y: Number.isFinite(Number(item.y)) ? Math.max(0, Number(item.y)) : 0,
      createdAt: Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : (Date.now() - idx),
    });
  });

  canvases.forEach((canvas) => {
    const seenItemIds = new Set();
    canvas.pipeline = (rawPipelineByCanvas.get(canvas.id) || [])
      .map((item) => {
        const originalBlockId = item && typeof item.blockId === 'string' ? item.blockId.trim() : '';
        const blockId = oldToNewBlockId.get(originalBlockId) || originalBlockId;
        if (!blockId || blockToCanvas.get(blockId) !== canvas.id) return null;

        let itemId = item && typeof item.itemId === 'string' && item.itemId.trim() ? item.itemId.trim() : uid();
        while (seenItemIds.has(itemId)) itemId = uid();
        seenItemIds.add(itemId);
        return { itemId, blockId };
      })
      .filter(Boolean);
  });

  const preferences = {};
  Object.entries(rawPrefs).forEach(([key, value]) => {
    if (!key.startsWith(APP_PREF_PREFIX)) return;
    preferences[key] = typeof value === 'string' ? value : JSON.stringify(value);
  });

  const rawActiveId = typeof rawUiState.activeCanvasId === 'string' ? rawUiState.activeCanvasId.trim() : '';
  const mappedActiveId = oldToNewCanvasId.get(rawActiveId) || rawActiveId;
  const uiState = {
    activeCanvasId: canvasIds.has(mappedActiveId) ? mappedActiveId : null,
    canvasScroll: {
      left: Number.isFinite(Number(rawUiState.canvasScroll && rawUiState.canvasScroll.left))
        ? Math.max(0, Number(rawUiState.canvasScroll.left))
        : 0,
      top: Number.isFinite(Number(rawUiState.canvasScroll && rawUiState.canvasScroll.top))
        ? Math.max(0, Number(rawUiState.canvasScroll.top))
        : 0,
    },
    resultHtml: typeof rawUiState.resultHtml === 'string' ? rawUiState.resultHtml : '',
  };

  return { canvases, blocks, preferences, uiState };
}

function refreshUIFromPreferences() {
  Theme.apply(localStorage.getItem('pb-theme') || 'light');

  const savedLayout = safeJsonParse(localStorage.getItem('pb-layout') || '{}', {});
  if (Number.isFinite(savedLayout.pipelineW)) LayoutResize.pipelineW = savedLayout.pipelineW;
  if (Number.isFinite(savedLayout.resultW)) LayoutResize.resultW = savedLayout.resultW;
  LayoutResize.apply();

  const savedFont = Number(localStorage.getItem(ResultFont.key));
  ResultFont.apply(Number.isFinite(savedFont) ? savedFont : 100, false);
}

const StoragePersistence = {
  _setUI(text, tone, title) {
    const badge = document.getElementById('storage-badge');
    const menuStatus = document.getElementById('data-storage-status');

    if (badge) {
      badge.classList.remove('ok', 'warn', 'unknown');
      badge.classList.add(tone || 'unknown');
      badge.textContent = `存储: ${text}`;
      if (title) badge.title = title;
    }
    if (menuStatus) {
      menuStatus.textContent = `存储持久化: ${text}`;
      if (title) menuStatus.title = title;
    }
  },

  async ensure() {
    StoragePersistence._setUI('检查中', 'unknown', '正在检查浏览器存储持久化状态');

    const storageApi = navigator.storage;
    if (!storageApi || typeof storageApi.persisted !== 'function' || typeof storageApi.persist !== 'function') {
      StoragePersistence._setUI('浏览器不支持', 'warn', '当前浏览器不支持 persistent storage API');
      return { supported: false, persisted: false };
    }

    try {
      const alreadyPersisted = await storageApi.persisted();
      if (alreadyPersisted) {
        StoragePersistence._setUI('已启用', 'ok', '浏览器已启用持久化存储');
        return { supported: true, persisted: true, requested: false };
      }

      const granted = await storageApi.persist();
      const persisted = granted || await storageApi.persisted();

      if (persisted) {
        StoragePersistence._setUI('已启用', 'ok', '已成功申请持久化存储权限');
      } else {
        StoragePersistence._setUI('未启用', 'warn', '浏览器未授予持久化权限，建议定期导出备份');
      }
      return { supported: true, persisted, requested: true, granted };
    } catch (err) {
      console.warn('Persistent storage check failed:', err);
      StoragePersistence._setUI('检测失败', 'warn', '无法检查持久化状态，建议定期导出备份');
      return { supported: true, persisted: false, error: err };
    }
  },
};

/* =====================================================================
   17. ACTIONS
   ===================================================================== */
const Actions = {
  async newCanvas() {
    showDialog('new-canvas', null);
  },

  async confirmDialog() {
    const name = document.getElementById('dlg-name').value.trim();
    if (!name) { Toast.show('名称不能为空'); return; }
    const desc = document.getElementById('dlg-desc').value.trim();
    hideDialog();

    if (_dlgMode === 'new-canvas') {
      const c = { id: uid(), name, description: desc, createdAt: Date.now(), pipeline: [] };
      await DB.saveCanvas(c);
      S.canvases.unshift(c);
      Render.sidebar();
      await Actions.selectCanvas(c.id);
    } else if (_dlgMode === 'rename-canvas') {
      const c = S.canvas;
      if (!c) return;
      c.name = name; c.description = desc;
      await DB.saveCanvas(c);
      Render.sidebar(); Render.header();
    }
  },

  async selectCanvas(id) {
    // Save any expanded block first
    if (_expandedId) BlockEdit.save(_expandedId, true);
    S.activeCanvasId = id;
    S.blocks = await DB.getBlocksByCanvas(id);
    await normalizeActiveBlocksMeta();
    Render.sidebar(); Render.header();
    renderAllBlocks();
    Render.pipeline();
    updateResult();
  },

  renameCanvas() {
    if (!S.canvas) return;
    showDialog('rename-canvas', S.canvas);
  },

  async duplicateCanvas() {
    const c = S.canvas;
    if (!c) return;
    const srcBlocks = await DB.getBlocksByCanvas(c.id);
    const nc = { id: uid(), name: c.name + ' (副本)', description: c.description, createdAt: Date.now(), pipeline: [] };
    await DB.saveCanvas(nc);

    // Map old blockId -> new blockId
    const idMap = {};
    for (const b of srcBlocks) {
      const newId = uid();
      idMap[b.id] = newId;
      await DB.saveBlock({ ...b, id: newId, canvasId: nc.id });
    }
    // Remap pipeline
    nc.pipeline = (c.pipeline || []).map(item => ({
      itemId: uid(), blockId: idMap[item.blockId] || item.blockId,
    })).filter(item => idMap[item.blockId] !== undefined);
    await DB.saveCanvas(nc);

    S.canvases.unshift(nc);
    Render.sidebar();
    await Actions.selectCanvas(nc.id);
    Toast.show('Canvas 已复制');
  },

  async deleteCanvas() {
    const c = S.canvas;
    if (!c) return;
    if (!confirm(`删除 Canvas「${c.name}」及其所有块？此操作不可撤销。`)) return;
    await DB.deleteBlocksByCanvas(c.id);
    await DB.deleteCanvas(c.id);
    S.canvases = S.canvases.filter(x => x.id !== c.id);
    S.activeCanvasId = null;
    S.blocks = [];
    if (S.canvases.length > 0) await Actions.selectCanvas(S.canvases[0].id);
    else {
      Render.sidebar(); Render.header(); renderAllBlocks(); Render.pipeline(); updateResult();
    }
    Toast.show('Canvas 已删除');
  },

  async addBlock(x, y) {
    if (!S.canvas) { Toast.show('请先选择或新建一个 Canvas'); return; }
    const pos   = (x !== undefined && y !== undefined) ? { x, y } : autoPos(S.blocks.length);
    const block = {
      id: uid(), canvasId: S.activeCanvasId,
      name: `块 ${S.blocks.length + 1}`,
      htmlContent: '',
      pipelineColor: DEFAULT_BLOCK_COLOR,
      x: pos.x,
      y: pos.y,
      createdAt: Date.now(),
    };
    S.blocks.push(block);
    await DB.saveBlock(block);
    updateCanvasHint();
    const el = renderBlock(block);
    bringToFront(el);
    // Scroll the new block into view
    document.getElementById('canvas-panel').scrollTo({
      left: Math.max(0, pos.x - 60), top: Math.max(0, pos.y - 60), behavior: 'smooth',
    });
    // Auto-expand for immediate editing
    BlockEdit.expand(block.id);
  },

  async duplicateBlock(blockId) {
    const b = S.blocks.find(x => x.id === blockId);
    if (!b) return;
    const nb = {
      ...b,
      id: uid(),
      name: `${normalizeBlockName(b.name)} (副本)`,
      pipelineColor: BLOCK_COLOR_MAP[b.pipelineColor] ? b.pipelineColor : DEFAULT_BLOCK_COLOR,
      x: b.x + 30,
      y: b.y + 30,
      createdAt: Date.now(),
    };
    S.blocks.push(nb);
    await DB.saveBlock(nb);
    renderBlock(nb);
    updateCanvasHint();
    Toast.show('块已复制');
  },

  openSendToCanvas(blockId) {
    showSendDialog(blockId);
  },

  async confirmSendToCanvas() {
    if (!_sendBlockId) {
      hideSendDialog();
      return;
    }

    const targetId = document.getElementById('send-target-canvas').value;
    if (!targetId) {
      Toast.show('请选择目标 Canvas');
      return;
    }

    const src = S.blocks.find(b => b.id === _sendBlockId);
    if (!src) {
      hideSendDialog();
      Toast.show('块不存在');
      return;
    }

    const targetBlocks = await DB.getBlocksByCanvas(targetId);
    const pos = autoPos(targetBlocks.length);
    const copied = {
      ...src,
      id: uid(),
      canvasId: targetId,
      x: pos.x,
      y: pos.y,
      createdAt: Date.now(),
      name: normalizeBlockName(src.name),
      pipelineColor: BLOCK_COLOR_MAP[src.pipelineColor] ? src.pipelineColor : DEFAULT_BLOCK_COLOR,
    };

    await DB.saveBlock(copied);
    const targetName = S.canvases.find(c => c.id === targetId)?.name || '目标 Canvas';
    hideSendDialog();
    Toast.show(`已发送到「${targetName}」`);
  },

  async deleteBlock(blockId) {
    if (!confirm('删除此块？')) return;
    PipelineMgr.removeByBlockId(blockId);
    S.blocks = S.blocks.filter(b => b.id !== blockId);
    await DB.deleteBlock(blockId);
    document.querySelector(`[data-block-id="${blockId}"]`)?.remove();
    updateCanvasHint();
    Toast.show('已删除');
  },

  async copyResult(mode) {
    const el = document.getElementById('result-content');
    if (!el.textContent.trim() || el.querySelector('.result-empty')) {
      Toast.show('结果为空'); return;
    }
    if (mode === 'rich') {
      try {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html':  new Blob([el.innerHTML],  { type: 'text/html'  }),
          'text/plain': new Blob([el.innerText],   { type: 'text/plain' }),
        })]);
        Toast.show('✓ 已复制富文本');
      } catch { Actions._fallback(el.innerText); }
    } else {
      try { await navigator.clipboard.writeText(el.innerText); Toast.show('✓ 已复制纯文本'); }
      catch { Actions._fallback(el.innerText); }
    }
  },

  _dbReady() {
    if (DB.isReady()) return true;
    Toast.show('浏览器存储不可用，无法执行该操作');
    return false;
  },

  _mergeLiveEditorDrafts(blocks) {
    if (!_expandedId || !Array.isArray(blocks) || blocks.length === 0) return blocks;

    const el = document.querySelector(`[data-block-id="${_expandedId}"]`);
    if (!el) return blocks;

    const nameInput = el.querySelector('.cb-name-input');
    const editor = el.querySelector('.cb-editor');
    if (!nameInput && !editor) return blocks;

    return blocks.map((block) => {
      if (block.id !== _expandedId) return block;
      return {
        ...block,
        name: typeof nameInput?.value === 'string' ? nameInput.value : block.name,
        htmlContent: typeof editor?.innerHTML === 'string' ? editor.innerHTML : block.htmlContent,
      };
    });
  },

  async exportData(download = true) {
    if (!Actions._dbReady()) return null;

    try {
      const canvases = await DB.getAllCanvases();
      const dbBlocks = await DB.getAllBlocks();
      const blocks = Actions._mergeLiveEditorDrafts(dbBlocks);
      const exportBlocks = blocks.map((block) => {
        const htmlContent = typeof block.htmlContent === 'string' ? block.htmlContent : '';
        const legacyText = typeof block.textContent === 'string'
          ? block.textContent
          : (typeof block.content === 'string' ? block.content : '');
        const textContent = htmlContent ? plainText(htmlContent) : legacyText;

        return {
          ...block,
          htmlContent,
          textContent: typeof textContent === 'string' ? textContent : '',
        };
      });
      const preferences = collectAppPreferences();
      const pipelines = collectPipelineSnapshot(canvases);
      const uiState = collectUIState();

      const payload = {
        schemaVersion: BACKUP_SCHEMA_VERSION,
        app: 'PaperDesign Prompt Builder',
        exportedAt: new Date().toISOString(),
        snapshot: {
          db: {
            name: DB_NAME,
            version: DB_VERSION,
            stores: { canvases, blocks: exportBlocks },
            pipelines,
          },
          settings: {
            localStorage: preferences,
          },
          ui: uiState,
        },
        data: {
          canvases,
          blocks: exportBlocks,
          pipelines,
          preferences,
          uiState,
        },
      };
      const jsonText = JSON.stringify(payload, null, 2);
      const fileName = buildBackupFileName();

      if (download) {
        downloadJsonFile(fileName, jsonText);
        Toast.show('已导出备份文件');
      }
      return { fileName, jsonText, payload };
    } catch (err) {
      console.error('Export data failed:', err);
      Toast.show('导出失败');
      return null;
    }
  },

  openImportDialog() {
    const input = document.getElementById('input-import-data');
    if (!input) return;
    input.value = '';
    input.click();
  },

  async importFromFile(file) {
    if (!Actions._dbReady()) return;
    if (!file) return;

    if (!confirm('导入会覆盖当前所有 Canvas、块和偏好设置，是否继续？')) {
      return;
    }

    try {
      const text = await file.text();
      const rawData = parseImportedPayload(text);
      const normalized = normalizeImportedData(rawData);

      if (_expandedId) {
        BlockEdit.collapse(_expandedId, false);
        _expandedId = null;
      }

      await DB.replaceAll(normalized.canvases, normalized.blocks);
      replaceAppPreferences(normalized.preferences);
      refreshUIFromPreferences();

      S.canvases = await DB.getAllCanvases();
      S.activeCanvasId = null;
      S.blocks = [];

      if (S.canvases.length > 0) {
        const preferredActiveId = normalized.uiState && normalized.uiState.activeCanvasId;
        const targetId = S.canvases.some(c => c.id === preferredActiveId)
          ? preferredActiveId
          : S.canvases[0].id;
        await Actions.selectCanvas(targetId);
        applyImportedUIState(normalized.uiState);
      } else {
        Render.sidebar();
        Render.header();
        renderAllBlocks();
        Render.pipeline();
        updateResult();
      }

      const pipelineCount = normalized.canvases.reduce((sum, c) => sum + ((c.pipeline && c.pipeline.length) || 0), 0);
      const prefCount = Object.keys(normalized.preferences).length;
      Toast.show(`导入完成：${normalized.canvases.length} 个 Canvas，${normalized.blocks.length} 个块，${pipelineCount} 条流水线项，${prefCount} 个设置`);
    } catch (err) {
      console.error('Import data failed:', err);
      Toast.show(`导入失败：${err.message || '文件无效'}`);
    }
  },

  _oneDriveHistoryState: {
    page: 1,
    pageCache: {},
    nextLinks: { 1: '' },
    loading: false,
    uploading: false,
  },

  _resetOneDriveHistoryState() {
    Actions._oneDriveHistoryState = {
      page: 1,
      pageCache: {},
      nextLinks: { 1: '' },
      loading: false,
      uploading: false,
    };
  },

  _setOneDriveUploadDefaultName() {
    const input = document.getElementById('od-backup-name');
    if (!input) return;
    input.value = buildOneDriveDialogDefaultName();
  },

  _renderOneDriveHistory(items, emptyText = '暂无备份历史') {
    const list = document.getElementById('od-history-list');
    if (!list) return;

    list.innerHTML = '';

    if (!Array.isArray(items) || items.length === 0) {
      list.innerHTML = `<div class="od-history-empty">${emptyText}</div>`;
      return;
    }

    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'od-history-item';

      const info = document.createElement('div');
      info.className = 'od-history-info';

      const name = document.createElement('div');
      name.className = 'od-history-name';
      name.textContent = item.name || '未命名备份';

      const meta = document.createElement('div');
      meta.className = 'od-history-meta';
      meta.textContent = `${formatOneDriveHistoryTime(item.lastModifiedDateTime)} · ${formatFileSize(item.size)}`;

      info.appendChild(name);
      info.appendChild(meta);

      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = '下载';
      btn.addEventListener('click', () => Actions.downloadOneDriveHistoryItem(item.id, item.name));

      row.appendChild(info);
      row.appendChild(btn);
      list.appendChild(row);
    });
  },

  _updateOneDriveHistoryPager() {
    const state = Actions._oneDriveHistoryState;
    const pageInfo = document.getElementById('od-page-info');
    const prevBtn = document.getElementById('btn-od-prev');
    const nextBtn = document.getElementById('btn-od-next');
    const refreshBtn = document.getElementById('btn-od-refresh');
    const uploadBtn = document.getElementById('btn-od-upload');

    if (pageInfo) pageInfo.textContent = `第 ${state.page} 页`;
    if (prevBtn) prevBtn.disabled = state.loading || state.page <= 1;
    if (nextBtn) nextBtn.disabled = state.loading || !state.nextLinks[state.page + 1];
    if (refreshBtn) refreshBtn.disabled = state.loading;
    if (uploadBtn) uploadBtn.disabled = state.uploading;
  },

  async _loadOneDriveHistoryPage(page, forceReload = false) {
    const state = Actions._oneDriveHistoryState;
    const list = document.getElementById('od-history-list');
    if (!list) return;
    if (state.loading) return;
    if (page < 1) return;

    if (!forceReload && state.pageCache[page]) {
      state.page = page;
      Actions._renderOneDriveHistory(state.pageCache[page]);
      Actions._updateOneDriveHistoryPager();
      return;
    }

    const pageLink = page === 1 ? '' : state.nextLinks[page];
    if (page > 1 && !pageLink) {
      Toast.show('没有更多历史备份');
      return;
    }

    state.loading = true;
    Actions._updateOneDriveHistoryPager();
    list.innerHTML = '<div class="od-history-empty">正在加载历史备份...</div>';

    try {
      const result = await OneDriveOAuth.listBackupHistory(pageLink || '');
      state.pageCache[page] = result.items;
      state.nextLinks[page + 1] = result.nextLink || '';
      state.page = page;
      Actions._renderOneDriveHistory(result.items);
    } catch (err) {
      console.error('Load OneDrive history failed:', err);
      list.innerHTML = '<div class="od-history-empty">读取失败，请稍后重试</div>';
      Toast.show(`读取历史失败：${(err && err.message) || '未知错误'}`);
    } finally {
      state.loading = false;
      Actions._updateOneDriveHistoryPager();
    }
  },

  async openOneDriveBackupDialog() {
    if (!Actions._dbReady()) return;

    Actions._resetOneDriveHistoryState();
    Actions._setOneDriveUploadDefaultName();
    document.getElementById('onedrive-overlay')?.classList.remove('hidden');
    Actions._renderOneDriveHistory([], '正在加载历史备份...');
    Actions._updateOneDriveHistoryPager();
    await Actions._loadOneDriveHistoryPage(1, true);
  },

  closeOneDriveBackupDialog() {
    document.getElementById('onedrive-overlay')?.classList.add('hidden');
  },

  async refreshOneDriveHistory() {
    Actions._resetOneDriveHistoryState();
    Actions._updateOneDriveHistoryPager();
    await Actions._loadOneDriveHistoryPage(1, true);
  },

  async prevOneDriveHistoryPage() {
    const targetPage = Actions._oneDriveHistoryState.page - 1;
    if (targetPage < 1) return;
    await Actions._loadOneDriveHistoryPage(targetPage);
  },

  async nextOneDriveHistoryPage() {
    const state = Actions._oneDriveHistoryState;
    const targetPage = state.page + 1;
    if (!state.nextLinks[targetPage]) {
      Toast.show('没有更多历史备份');
      return;
    }
    await Actions._loadOneDriveHistoryPage(targetPage);
  },

  async downloadOneDriveHistoryItem(itemId, fileName) {
    if (!itemId) {
      Toast.show('历史项无效');
      return;
    }

    try {
      const blob = await OneDriveOAuth.downloadHistoryItem(itemId);
      const safeName = normalizeOneDriveUploadName(fileName || buildOneDriveDialogDefaultName());
      triggerBlobDownload(blob, safeName);
      Toast.show('已下载历史备份文件');
    } catch (err) {
      console.error('Download OneDrive history item failed:', err);
      Toast.show(`下载失败：${(err && err.message) || '未知错误'}`);
    }
  },

  async _uploadToOneDriveWithRetry(fileName, jsonText) {
    try {
      return await OneDriveOAuth.uploadJson(fileName, jsonText);
    } catch (err) {
      let finalErr = err;
      const initialMsg = (err && err.message) || '';
      const isSPOProvisioningError = /Tenant does not have a SPO license|OneDrive\/SharePoint 许可证/i.test(initialMsg);

      if (isSPOProvisioningError) {
        const retryWithAnotherAccount = confirm(
          '检测到当前账号所在租户未开通 OneDrive/SharePoint 许可证。\n\n是否立即切换 Microsoft 账号后重试？\n建议选择个人微软账号，或已分配 OneDrive 许可证的 Microsoft 365 账号。'
        );

        if (retryWithAnotherAccount) {
          try {
            return await OneDriveOAuth.uploadJson(
              fileName,
              jsonText,
              { forceSelectAccount: true }
            );
          } catch (retryErr) {
            console.error('OneDrive OAuth retry upload failed:', retryErr);
            finalErr = retryErr;
          }
        }
      }

      throw finalErr;
    }
  },

  async uploadOneDriveBackupFromDialog() {
    if (!Actions._dbReady()) return;

    const state = Actions._oneDriveHistoryState;
    if (state.uploading) return;

    const uploadInput = document.getElementById('od-backup-name');
    const fileName = normalizeOneDriveUploadName(uploadInput ? uploadInput.value : '');
    let exported = null;

    state.uploading = true;
    Actions._updateOneDriveHistoryPager();

    try {
      exported = await Actions.exportData(false);
      if (!exported) return;

      await Actions._uploadToOneDriveWithRetry(fileName, exported.jsonText);
      Toast.show(`已上传到 OneDrive：${fileName}`);
      Actions._setOneDriveUploadDefaultName();
      await Actions.refreshOneDriveHistory();
    } catch (err) {
      console.error('OneDrive OAuth upload failed:', err);
      const askFallback = confirm(
        `OneDrive OAuth 备份失败：${(err && err.message) || '未知错误'}\n\n是否改为本地下载备份文件？`
      );
      if (!askFallback) {
        Toast.show('OneDrive 备份已取消');
        return;
      }
      if (!exported) return;
      downloadJsonFile(fileName, exported.jsonText);
      Toast.show('已下载备份文件');
    } finally {
      state.uploading = false;
      Actions._updateOneDriveHistoryPager();
    }
  },

  async backupToOneDrive() {
    await Actions.openOneDriveBackupDialog();
  },

  _fallback(text) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    Toast.show('✓ 已复制');
  },
};

/* =====================================================================
   18. CANVAS DROP ZONE (drag block from canvas into pipeline panel)
   ===================================================================== */
function initPipelineDropZone() {
  const zone = document.getElementById('pipeline-drop-zone');

  // Allow canvas blocks to be dragged as HTML5 drag if user drags them into pipeline
  // We'll use a simpler approach: hovering a canvas block over the pipeline triggers adding

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', (e) => {
    if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
  });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const blockId = e.dataTransfer.getData('blockId');
    if (blockId) PipelineMgr.addBlockToPipelineByDrop(blockId);
  });
}

/* =====================================================================
   19. COLUMN RESIZE (canvas / pipeline / result)
   ===================================================================== */
const LayoutResize = {
  minCanvas: 360,
  minPipeline: 220,
  minResult: 250,
  splitter: 6,
  pipelineW: 248,
  resultW: 300,

  init() {
    const work = document.getElementById('work-area');
    const saved = JSON.parse(localStorage.getItem('pb-layout') || '{}');
    if (Number.isFinite(saved.pipelineW)) LayoutResize.pipelineW = saved.pipelineW;
    if (Number.isFinite(saved.resultW)) LayoutResize.resultW = saved.resultW;

    LayoutResize.apply();

    document.getElementById('resizer-left').addEventListener('mousedown', (e) => LayoutResize.start(e, 'left'));
    document.getElementById('resizer-right').addEventListener('mousedown', (e) => LayoutResize.start(e, 'right'));

    window.addEventListener('resize', () => LayoutResize.apply());
    work.addEventListener('dblclick', (e) => {
      if (!e.target.closest('.col-resizer')) return;
      LayoutResize.pipelineW = 248;
      LayoutResize.resultW = 300;
      LayoutResize.apply();
      Toast.show('面板宽度已重置');
    });
  },

  apply() {
    const work = document.getElementById('work-area');
    const total = work.clientWidth;

    const maxPipeline = Math.max(LayoutResize.minPipeline, total - LayoutResize.minCanvas - LayoutResize.minResult - LayoutResize.splitter * 2);
    LayoutResize.pipelineW = clamp(LayoutResize.pipelineW, LayoutResize.minPipeline, maxPipeline);

    const maxResult = Math.max(LayoutResize.minResult, total - LayoutResize.minCanvas - LayoutResize.pipelineW - LayoutResize.splitter * 2);
    LayoutResize.resultW = clamp(LayoutResize.resultW, LayoutResize.minResult, maxResult);

    work.style.gridTemplateColumns =
      `minmax(${LayoutResize.minCanvas}px, 1fr) ${LayoutResize.splitter}px minmax(${LayoutResize.minPipeline}px, ${LayoutResize.pipelineW}px) ${LayoutResize.splitter}px minmax(${LayoutResize.minResult}px, ${LayoutResize.resultW}px)`;

    localStorage.setItem('pb-layout', JSON.stringify({
      pipelineW: LayoutResize.pipelineW,
      resultW: LayoutResize.resultW,
    }));
  },

  start(e, side) {
    e.preventDefault();
    const resizer = e.currentTarget;
    const work = document.getElementById('work-area');
    const rect = work.getBoundingClientRect();
    const total = rect.width;
    const startX = e.clientX;
    const startPipeline = LayoutResize.pipelineW;
    const startResult = LayoutResize.resultW;

    resizer.classList.add('dragging');

    const onMove = (ev) => {
      const dx = ev.clientX - startX;

      if (side === 'left') {
        const maxPipeline = Math.max(LayoutResize.minPipeline, total - LayoutResize.minCanvas - startResult - LayoutResize.splitter * 2);
        LayoutResize.pipelineW = clamp(startPipeline - dx, LayoutResize.minPipeline, maxPipeline);
      } else {
        const maxResult = Math.max(LayoutResize.minResult, total - LayoutResize.minCanvas - startPipeline - LayoutResize.splitter * 2);
        LayoutResize.resultW = clamp(startResult - dx, LayoutResize.minResult, maxResult);
      }

      LayoutResize.apply();
    };

    const onUp = () => {
      resizer.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  },
};

/* =====================================================================
  20. CANVAS STAGE DRAG -> PIPELINE SUPPORT
      Make canvas blocks draggable into pipeline via HTML5 DnD
      (works alongside custom mouse drag: dragstart fires only when
       the browser's native drag starts, which won't conflict with
       our mousedown→mousemove approach if we cancel it correctly)
   ===================================================================== */
// We attach dragstart on individual block headers when user presses on header
// with right mouse or uses keyboard drag. We'll make the add-btn a native drag source.

/* =====================================================================
  21. EVENT BINDING
   ===================================================================== */
function bindEvents() {
  // Theme
  document.getElementById('theme-toggle').addEventListener('click', Theme.toggle.bind(Theme));
  ResultFont.init();

  // Sidebar: new canvas
  document.getElementById('btn-new-canvas').addEventListener('click', Actions.newCanvas);

  // Header actions
  document.getElementById('btn-rename-canvas').addEventListener('click',    Actions.renameCanvas);
  document.getElementById('btn-duplicate-canvas').addEventListener('click', Actions.duplicateCanvas);
  document.getElementById('btn-delete-canvas').addEventListener('click',    Actions.deleteCanvas);
  document.getElementById('btn-add-block').addEventListener('click', () => Actions.addBlock());

  document.getElementById('btn-data-tools').addEventListener('click', (e) => {
    e.stopPropagation();
    DataCtxMenu.toggle(e.currentTarget);
  });

  document.getElementById('data-ctx-menu').addEventListener('click', (e) => {
    const item = e.target.closest('li[data-action]');
    if (!item) return;
    const act = item.dataset.action;
    if (act === 'noop') return;
    hideAllMenus();

    if (act === 'export-data') Actions.exportData();
    if (act === 'import-data') Actions.openImportDialog();
    if (act === 'backup-onedrive') Actions.backupToOneDrive();
  });

  const importInput = document.getElementById('input-import-data');
  importInput.addEventListener('change', () => {
    const file = importInput.files && importInput.files[0];
    if (!file) return;
    Actions.importFromFile(file);
    importInput.value = '';
  });

  // Pipeline
  document.getElementById('btn-clear-pipeline').addEventListener('click', PipelineMgr.clear.bind(PipelineMgr));

  // Result copy
  document.getElementById('btn-copy-rich').addEventListener('click',  () => Actions.copyResult('rich'));
  document.getElementById('btn-copy-plain').addEventListener('click', () => Actions.copyResult('plain'));

  // Dialog
  document.getElementById('btn-dlg-ok').addEventListener('click',     Actions.confirmDialog);
  document.getElementById('btn-dlg-cancel').addEventListener('click', hideDialog);
  document.getElementById('dialog-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('dialog-overlay')) hideDialog();
  });
  document.getElementById('dlg-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  Actions.confirmDialog();
    if (e.key === 'Escape') hideDialog();
  });
  document.getElementById('dlg-desc').addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  Actions.confirmDialog();
    if (e.key === 'Escape') hideDialog();
  });

  // Send-to-canvas dialog
  document.getElementById('btn-send-ok').addEventListener('click', () => Actions.confirmSendToCanvas());
  document.getElementById('btn-send-cancel').addEventListener('click', hideSendDialog);
  document.getElementById('send-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('send-overlay')) hideSendDialog();
  });
  document.getElementById('send-target-canvas').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') Actions.confirmSendToCanvas();
    if (e.key === 'Escape') hideSendDialog();
  });

  // OneDrive backup dialog
  document.getElementById('btn-od-close').addEventListener('click', () => Actions.closeOneDriveBackupDialog());
  document.getElementById('btn-od-upload').addEventListener('click', () => Actions.uploadOneDriveBackupFromDialog());
  document.getElementById('btn-od-refresh').addEventListener('click', () => Actions.refreshOneDriveHistory());
  document.getElementById('btn-od-prev').addEventListener('click', () => Actions.prevOneDriveHistoryPage());
  document.getElementById('btn-od-next').addEventListener('click', () => Actions.nextOneDriveHistoryPage());
  document.getElementById('od-backup-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') Actions.uploadOneDriveBackupFromDialog();
    if (e.key === 'Escape') Actions.closeOneDriveBackupDialog();
  });
  document.getElementById('onedrive-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('onedrive-overlay')) Actions.closeOneDriveBackupDialog();
  });

  // Canvas right-click (empty area -> new block)
  document.getElementById('canvas-panel').addEventListener('contextmenu', (e) => {
    if (e.target.closest('.canvas-block')) return;
    e.preventDefault();
    // Compute position in canvas stage coordinates
    const panel = document.getElementById('canvas-panel');
    const rect  = panel.getBoundingClientRect();
    _rightClickPos = {
      x: e.clientX - rect.left + panel.scrollLeft,
      y: e.clientY - rect.top  + panel.scrollTop,
    };
    if (S.activeCanvasId) CanvasCtxMenu.show(e.clientX, e.clientY);
    else Toast.show('请先选择一个 Canvas');
  });

  // Canvas context menu actions
  document.getElementById('canvas-ctx-menu').addEventListener('click', (e) => {
    const act = e.target.dataset.action;
    hideAllMenus();
    if (act === 'new-block') Actions.addBlock(_rightClickPos.x, _rightClickPos.y);
  });

  // Block context menu actions
  document.getElementById('block-ctx-menu').addEventListener('click', (e) => {
    const act = e.target.dataset.action;
    const id  = BlockCtxMenu._id;
    hideAllMenus();
    if (!id) return;
    if (act === 'add-pipeline') {
      if (blockInPipeline(id)) PipelineMgr.removeByBlockId(id);
      else PipelineMgr.add(id);
      // Refresh block card indicator
      renderAllBlocks();
    }
    if (act === 'dup-block')  Actions.duplicateBlock(id);
    if (act === 'send-to-canvas') Actions.openSendToCanvas(id);
    if (act === 'del-block')  Actions.deleteBlock(id);
  });

  // Hide menus on any click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.ctx-menu')) hideAllMenus();
  });

  // Collapse expanded block when clicking outside it
  document.addEventListener('mousedown', (e) => {
    if (_expandedId && !e.target.closest('.canvas-block')) {
      BlockEdit.save(_expandedId, true);
    }
  });

  // Resizable three-column layout
  LayoutResize.init();

  // Pipeline drop zone
  initPipelineDropZone();
}

/* =====================================================================
   21. INIT
   ===================================================================== */
async function init() {
  Theme.init();

  try {
    const reloading = await StartupUpdateChecker.checkAndReloadIfUpdated();
    if (reloading) return;
  } catch (err) {
    console.warn('Startup update check failed:', err);
  }

  try {
    await DB.open();
  } catch (err) {
    console.error('IndexedDB error:', err);
    document.body.insertAdjacentHTML('afterbegin',
      '<div style="position:fixed;top:0;left:0;right:0;padding:10px 16px;background:#e03131;color:#fff;z-index:9999;font-size:13px;text-align:center;">⚠ IndexedDB 不可用（可能是隐私模式），数据无法持久化</div>'
    );
  }

  bindEvents();

  await StoragePersistence.ensure();

  if (!DB.isReady()) {
    S.canvases = [];
    S.activeCanvasId = null;
    S.blocks = [];
    Render.sidebar();
    Render.header();
    renderAllBlocks();
    Render.pipeline();
    updateResult();
    return;
  }

  S.canvases = await DB.getAllCanvases();
  Render.sidebar();

  if (S.canvases.length > 0) {
    await Actions.selectCanvas(S.canvases[0].id);
  } else {
    Render.header();
    updateCanvasHint();
  }
}

document.addEventListener('DOMContentLoaded', init);

