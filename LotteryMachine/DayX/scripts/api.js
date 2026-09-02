// Browser-side API shim using IndexedDB (no Tauri)
// Provides the same method signatures as scripts/api.js but runs in the browser.

(function (global) {
  const DB_NAME = 'dayx_web_db_v2'; // 升级版本以添加 settings store
  const STORE_NAME = 'days';
  const SETTINGS_STORE = 'settings'; // 新增：存储 OneDrive token 等设置

  // ============ MSAL 静默刷新初始化 ============
  // MSAL.js v2 由 build-web.js 构建时从 CDN 注入，提供 window.msal 全局对象。
  // 相比手动 refresh_token，MSAL 能通过 SSO 会话 cookie 静默续签，绕过微软对 SPA 24 小时限制。
  const MSAL_CLIENT_ID = 'cf9e57d0-7dc3-4fd9-93f9-751d2abc1124';
  const MSAL_SCOPES = ['Files.ReadWrite.AppFolder'];

  let _msalInstance = null;
  let _msalInitPromise = null;

  // 构建 MSAL 配置（redirectUri 运行时自动检测）
  function _buildMSALConfig() {
    const redirectUri = window.location.hostname === 'localhost'
      ? 'http://localhost:8080'
      : (window.location.origin + window.location.pathname).replace(/\/$/, '/').replace(/\/[^/]*$/, '/');
    return {
      auth: {
        clientId: MSAL_CLIENT_ID,
        authority: 'https://login.microsoftonline.com/common',
        redirectUri,
        navigateToLoginRequestUrl: false,
      },
      cache: {
        // localStorage 确保页面刷新后 token 不丢失
        cacheLocation: 'localStorage',
        storeAuthStateInCookie: false,
      },
      system: {
        loggerOptions: {
          logLevel: 3, // Warning
          loggerCallback: (level, message, containsPii) => {
            if (!containsPii) console.log('[MSAL]', message);
          }
        }
      }
    };
  }

  // 动态加载 MSAL CDN（多源容灾：微软官方 → jsDelivr → unpkg）
  const MSAL_CDN_URLS = [
    'https://alcdn.msauth.net/browser/2.38.3/js/msal-browser.min.js',
    'https://cdn.jsdelivr.net/npm/@azure/msal-browser@2.38.3/lib/msal-browser.min.js',
    'https://unpkg.com/@azure/msal-browser@2.38.3/lib/msal-browser.min.js'
  ];

  function _tryLoadScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve(url);
      s.onerror = () => { s.remove(); reject(url); };
      document.head.appendChild(s);
    });
  }

  async function _loadMSALScript() {
    if (typeof msal !== 'undefined') return; // 已由 build-web.js 预注入
    for (const url of MSAL_CDN_URLS) {
      try {
        const loaded = await _tryLoadScript(url);
        console.log('[MSAL] CDN 加载成功:', loaded);
        return;
      } catch (failedUrl) {
        console.warn('[MSAL] CDN 加载失败:', failedUrl);
      }
    }
    throw new Error('所有 MSAL CDN 均不可用，请检查网络或使用桌面客户端');
  }

  // 移动端浏览器的 window.open 弹窗经常被系统当作整页跳转处理，
  // 导致 loginPopup 在返回页时报 block_nested_popups，因此移动端改用 loginRedirect。
  function _isMobileDevice() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  }

  // 清除 MSAL 残留的"交互进行中"标记，避免上一次未完成的登录导致
  // 后续登录被误判为 block_nested_popups / interaction_in_progress
  function _clearMsalInteractionStatus() {
    try {
      sessionStorage.removeItem('msal.interaction.status');
      Object.keys(sessionStorage)
        .filter(k => k.indexOf('interaction.status') !== -1)
        .forEach(k => sessionStorage.removeItem(k));
    } catch (e) { /* ignore */ }
  }

  // 始终启动 MSAL 初始化（不受 msal 全局变量是否存在影响）
  // 在 popup 返回本页时 handleRedirectPromise() 必须尽早调用
  _msalInitPromise = (async () => {
    try {
      await _loadMSALScript(); // 若已加载则立即 resolve
      const instance = new msal.PublicClientApplication(_buildMSALConfig());
      const redirectResponse = await instance.handleRedirectPromise();
      _msalInstance = instance;
      if (redirectResponse && redirectResponse.account) {
        // 移动端 loginRedirect 整页跳转回来后，在这里标记登录刚完成，
        // 供 app.js 在初始化后显示成功提示并刷新 OneDrive 状态
        global.__dayxOneDriveLoginJustCompleted = true;
        console.log('[MSAL] ✅ redirect 登录成功，账户:', redirectResponse.account.username);
      }
      console.log('[MSAL] ✅ 初始化完成，账户数:', instance.getAllAccounts().length);
      return instance;
    } catch (e) {
      console.warn('[MSAL] ⚠️ 初始化失败:', e.message);
      // 清理残留的交互状态，避免下次登录立即报 block_nested_popups
      _clearMsalInteractionStatus();
      return null;
    }
  })();

  // 获取 MSAL 实例（等待初始化完成）
  async function getMSAL() {
    if (_msalInitPromise) return await _msalInitPromise;
    return null;
  }

  // 请求持久化存储权限，防止数据被浏览器自动清理
  // 返回对象包含 granted（是否授予）和 persisted（最终是否持久化）
  async function requestPersistentStorage() {
    if (navigator.storage && navigator.storage.persist) {
      const isPersisted = await navigator.storage.persisted();
      if (!isPersisted) {
        const granted = await navigator.storage.persist();
        console.log(`🔒 持久化存储权限请求结果: ${granted ? '✅ 已授予' : '❌ 未授予'}`);
        const finalPersisted = await navigator.storage.persisted();

        // 检测浏览器类型
        const isChrome = /Chrome/.test(navigator.userAgent) && !/Edg/.test(navigator.userAgent);
        const isFirefox = /Firefox/.test(navigator.userAgent);

        // Chrome 需要额外条件（PWA、通知权限、高参与度）
        if (granted && !finalPersisted) {
          if (isChrome) {
            console.warn('⚠️ Chrome 浏览器需要满足以下条件之一才能获得持久化保护：');
            console.warn('  1️⃣ 将网站安装为 PWA（点击地址栏右侧的安装按钮）');
            console.warn('  2️⃣ 授予网站通知权限（地址栏 → 设置 → 通知 → 允许）');
            console.warn('  3️⃣ 经常访问该网站以提升参与度');
            console.warn('💡 建议：定期使用 OneDrive 云备份或导出数据功能');
          }
        }

        return {
          granted,
          persisted: finalPersisted,
          supported: true,
          isChrome,
          isFirefox
        };
      }
      console.log('✅ 数据已启用持久化存储');
      return { granted: true, persisted: true, supported: true };
    }
    console.warn('⚠️ 浏览器不支持持久化存储 API');
    return { granted: false, persisted: false, supported: false };
  }

  // 连接池：复用单个 IndexedDB 连接，避免每次调用都重新打开
  let _cachedDB = null;

  function openDB() {
    if (_cachedDB) return Promise.resolve(_cachedDB);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        // 创建词汇数据 store
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'date' });
          store.createIndex('date_idx', 'date');
        }
        // 创建设置 store（存储 OneDrive token 等）
        if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
          db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => {
        _cachedDB = req.result;
        // 连接意外关闭时清除缓存
        _cachedDB.onclose = () => { _cachedDB = null; };
        _cachedDB.onversionchange = () => { _cachedDB.close(); _cachedDB = null; };
        resolve(_cachedDB);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function withDB(fn) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      Promise.resolve(fn(store)).then(r => {
        tx.oncomplete = () => { resolve(r); };
      }).catch(err => { reject(err); });
    });
  }

  // 操作 settings store 的辅助函数
  async function withSettingsDB(fn) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SETTINGS_STORE, 'readwrite');
      const store = tx.objectStore(SETTINGS_STORE);
      Promise.resolve(fn(store)).then(r => {
        tx.oncomplete = () => { resolve(r); };
      }).catch(err => { reject(err); });
    });
  }

  // 保存设置到 IndexedDB
  async function saveSetting(key, value) {
    return withSettingsDB(store => {
      return new Promise((resolve, reject) => {
        const req = store.put({ key, value });
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    });
  }

  // 从 IndexedDB 读取设置
  async function getSetting(key) {
    return withSettingsDB(store => {
      return new Promise((resolve, reject) => {
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result?.value || null);
        req.onerror = () => reject(req.error);
      });
    });
  }

  // 从 IndexedDB 删除设置
  async function deleteSetting(key) {
    return withSettingsDB(store => {
      return new Promise((resolve, reject) => {
        const req = store.delete(key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    });
  }

  // 内存缓存：避免启动时多次全表扫描
  let _cachedAllDays = null;
  let _cacheValid = false;

  function _invalidateCache() {
    _cachedAllDays = null;
    _cacheValid = false;
  }

  // Utility to get all days sorted by date asc
  async function _getAllDaysSorted() {
    // 返回缓存副本（深拷贝以防止外部修改）
    if (_cacheValid && _cachedAllDays) {
      return JSON.parse(JSON.stringify(_cachedAllDays));
    }

    const result = await withDB(store => {
      return new Promise((resolve, reject) => {
        const items = [];
        const req = store.openCursor();
        req.onsuccess = (e) => {
          const cur = e.target.result;
          if (cur) { items.push(cur.value); cur.continue(); } else {
            // sort by date ascending
            items.sort((a, b) => a.date.localeCompare(b.date));
            // assign day_number
            items.forEach((d, i) => d.day_number = i + 1);
            resolve(items);
          }
        };
        req.onerror = () => reject(req.error);
      });
    });

    // 存入缓存
    _cachedAllDays = result;
    _cacheValid = true;
    return JSON.parse(JSON.stringify(result));
  }

  const WebAPI = {
    // ============ 环境检测 ============
    isWebBuild: true, // 标记这是 Web 构建版本

    // ============ 持久化存储 ============
    // 请求持久化存储权限，防止 IndexedDB 被浏览器自动清理
    requestPersistentStorage,

    // ============ 底层 API 方法（浏览器替代） ============

    // Tauri invoke 的浏览器替代（不会被直接调用，但保持兼容）
    async invoke(cmd, args) {
      console.warn(`Direct invoke() call to "${cmd}" in browser - method should be wrapped`);
      throw new Error(`Command "${cmd}" not available in browser build`);
    },

    // Tauri dialog.ask 的浏览器替代（使用原生 confirm）
    async ask(message, options) {
      const title = options?.title || '确认';
      return confirm(`${title}\n\n${message}`);
    },

    // Tauri dialog.save 的浏览器替代（返回默认文件名）
    async save(options) {
      const defaultPath = options?.defaultPath || `DayX_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      // 浏览器无法显示原生保存对话框，直接返回默认路径
      return defaultPath;
    },

    // Tauri path.desktopDir 的浏览器替代（返回空字符串）
    async desktopDir() {
      return ''; // 浏览器无法访问桌面路径
    },

    // confirmDelete 方法
    async confirmDelete(message, title = '确认删除') {
      return confirm(`${title}\n\n${message}`);
    },

    // 获取桌面路径（浏览器返回空）
    async getDesktopPath() {
      return '';
    },

    // 获取数据目录（浏览器无本地目录）
    async getDataDir() {
      return '';
    },

    // 显示保存对话框（浏览器返回默认路径）
    async showSaveDialog(defaultPath, filters) {
      return defaultPath || `DayX_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    },

    async getDaysByOffset(offsets) {
      const all = await _getAllDaysSorted();
      // 返回格式必须与 Tauri 后端一致: Vec<Option<DayRecord>>
      // 按 offsets 顺序返回，每个 offset 对应一个结果（找不到返回 null）
      if (all.length === 0) {
        // 没有数据时，返回全 null 数组
        return offsets.map(() => null);
      }

      const lastNum = all[all.length - 1].day_number;
      const results = [];

      for (const offset of offsets) {
        const targetDayNum = lastNum - offset;
        if (targetDayNum > 0) {
          const found = all.find(d => d.day_number === targetDayNum);
          results.push(found || null);
        } else {
          results.push(null);
        }
      }

      return results;
    },

    async getAllDays() {
      return await _getAllDaysSorted();
    },

    async getDayByDate(date) {
      // 需要获取所有数据并计算 day_number
      const all = await _getAllDaysSorted();
      const found = all.find(d => d.date === date);
      return found || null;
    },

    async getDatesWithWordCounts() {
      const all = await _getAllDaysSorted();
      // 返回格式必须与 Tauri 后端一致: [[date, count], [date, count], ...]
      return all.map(d => [d.date, (d.words || []).length]);
    },

    async addWordToDate(date, weekday, word) {
      const result = await withDB(store => {
        return new Promise((resolve, reject) => {
          const getReq = store.get(date);
          getReq.onsuccess = () => {
            const rec = getReq.result || { date, weekday, words: [], review_count: 0 };
            rec.words.push({ text: word, color: 'grey' });
            const putReq = store.put(rec);
            putReq.onsuccess = () => resolve(rec);
            putReq.onerror = () => reject(putReq.error);
          };
          getReq.onerror = () => reject(getReq.error);
        });
      });
      _invalidateCache();
      return result;
    },

    async findWord(word) {
      const all = await _getAllDaysSorted();
      // 返回格式必须与 Tauri 后端一致: [date, day_number] 或 null
      // Tauri 后端是精确匹配，这里也需要精确匹配
      for (const d of all) {
        for (const w of (d.words || [])) {
          if (String(w.text) === word) {
            return [d.date, d.day_number];
          }
        }
      }
      return null;
    },

    async searchWords(query) {
      const all = await _getAllDaysSorted();
      const queryLower = query.toLowerCase();
      const wordDates = new Map(); // word -> [dates]

      // 遍历所有日期的所有单词，模糊匹配
      for (const d of all) {
        for (const w of (d.words || [])) {
          const wordText = String(w.text);
          if (wordText.toLowerCase().includes(queryLower)) {
            if (!wordDates.has(wordText)) {
              wordDates.set(wordText, []);
            }
            wordDates.get(wordText).push(d.date);
          }
        }
      }

      // 转换为数组并按单词排序
      const result = Array.from(wordDates.entries())
        .sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase()));

      return result;
    },

    async deleteWord(dayNumber, wordIndex) {
      const all = await _getAllDaysSorted();
      const day = all.find(d => d.day_number === dayNumber);
      if (!day) throw new Error('Day not found');
      const date = day.date;
      const result = await withDB(store => {
        return new Promise((resolve, reject) => {
          const req = store.get(date);
          req.onsuccess = () => {
            const rec = req.result;
            if (!rec) return resolve(false);
            rec.words.splice(wordIndex, 1);

            // 如果删除后没有词条了，删除整个 Day 记录
            if (rec.words.length === 0) {
              const deleteReq = store.delete(date);
              deleteReq.onsuccess = () => resolve(true);
              deleteReq.onerror = () => reject(deleteReq.error);
            } else {
              const putReq = store.put(rec);
              putReq.onsuccess = () => resolve(true);
              putReq.onerror = () => reject(putReq.error);
            }
          };
          req.onerror = () => reject(req.error);
        });
      });
      _invalidateCache();
      return result;
    },

    async updateWordsOrder(dayNumber, words) {
      const all = await _getAllDaysSorted();
      const day = all.find(d => d.day_number === dayNumber);
      if (!day) throw new Error('Day not found');
      const date = day.date;
      const result = await withDB(store => {
        return new Promise((resolve, reject) => {
          const req = store.get(date);
          req.onsuccess = () => {
            const rec = req.result;
            rec.words = words;
            const putReq = store.put(rec);
            putReq.onsuccess = () => resolve(rec);
            putReq.onerror = () => reject(putReq.error);
          };
          req.onerror = () => reject(req.error);
        });
      });
      _invalidateCache();
      return result;
    },

    async updateWordColor(dayNumber, wordIndex, color) {
      const all = await _getAllDaysSorted();
      const day = all.find(d => d.day_number === dayNumber);
      if (!day) throw new Error('Day not found');
      const date = day.date;
      const result = await withDB(store => {
        return new Promise((resolve, reject) => {
          const req = store.get(date);
          req.onsuccess = () => {
            const rec = req.result;
            rec.words[wordIndex].color = color;
            const putReq = store.put(rec);
            putReq.onsuccess = () => resolve(rec);
            putReq.onerror = () => reject(putReq.error);
          };
          req.onerror = () => reject(req.error);
        });
      });
      _invalidateCache();
      return result;
    },

    async updateWordText(dayNumber, wordIndex, newText) {
      const all = await _getAllDaysSorted();
      const day = all.find(d => d.day_number === dayNumber);
      if (!day) throw new Error('Day not found');
      const date = day.date;
      const result = await withDB(store => {
        return new Promise((resolve, reject) => {
          const req = store.get(date);
          req.onsuccess = () => {
            const rec = req.result;
            rec.words[wordIndex].text = newText;
            const putReq = store.put(rec);
            putReq.onsuccess = () => resolve(rec);
            putReq.onerror = () => reject(putReq.error);
          };
          req.onerror = () => reject(req.error);
        });
      });
      _invalidateCache();
      return result;
    },

    async updateReviewCount(dayNumber, reviewCount) {
      const all = await _getAllDaysSorted();
      const day = all.find(d => d.day_number === dayNumber);
      if (!day) throw new Error('Day not found');
      const date = day.date;
      const result = await withDB(store => {
        return new Promise((resolve, reject) => {
          const req = store.get(date);
          req.onsuccess = () => {
            const rec = req.result;
            rec.review_count = reviewCount;
            const putReq = store.put(rec);
            putReq.onsuccess = () => resolve(rec);
            putReq.onerror = () => reject(putReq.error);
          };
          req.onerror = () => reject(req.error);
        });
      });
      _invalidateCache();
      return result;
    },

    async deleteAllData() {
      const result = await withDB(store => {
        return new Promise((resolve, reject) => {
          const req = store.clear();
          req.onsuccess = () => resolve(true);
          req.onerror = () => reject(req.error);
        });
      });
      _invalidateCache();
      return result;
    },

    async exportData() {
      const all = await _getAllDaysSorted();
      // 返回对象数组，与 Tauri 版本保持一致
      return all;
    },

    async exportDataToFile(filePath) {
      // In browser, trigger download
      const data = await this.exportData();
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filePath || `DayX_backup_${new Date().toISOString()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return true;
    },

    async importData(records) {
      // records should be array of day objects
      const result = await withDB(store => {
        return new Promise((resolve, reject) => {
          const clearReq = store.clear();
          clearReq.onsuccess = () => {
            let done = 0;
            if (!records || records.length === 0) return resolve(true);
            records.forEach(r => {
              const putReq = store.put(r);
              putReq.onsuccess = () => { done++; if (done === records.length) resolve(true); };
              putReq.onerror = () => reject(putReq.error);
            });
          };
          clearReq.onerror = () => reject(clearReq.error);
        });
      });
      _invalidateCache();
      return result;
    },

    async getDesktopPath() {
      return '';
    },

    async showSaveDialog(defaultPath) {
      // Browser can't show native OS save dialog; return default filename
      return defaultPath || `DayX_backup_${new Date().toISOString()}.json`;
    },

    async getStats() {
      const all = await _getAllDaysSorted();
      const totalDays = all.length;
      const totalWords = all.reduce((s, d) => s + (d.words ? d.words.length : 0), 0);
      return { totalDays, totalWords };
    },

    // ============ OneDrive OAuth 功能（浏览器版本）============

    // 标记：本构建支持 MSAL 静默刷新（桌面版为 false，由 api.js 负责）
    useMSAL: true,

    // OneDrive 配置
    _oneDriveConfig: {
      clientId: MSAL_CLIENT_ID, // 与 Tauri 版本相同，复用顶部常量
      // 自动检测 redirect_uri：本地开发用 localhost，生产用当前域名
      // ⚠️ 注意：需要在 Azure Portal 的应用注册中添加以下重定向 URI（类型：单页应用程序 SPA）：
      //   - http://localhost:8080 (本地开发)
      //   - https://shixund.github.io/DayX/ (GitHub Pages)
      get redirectUri() {
        if (window.location.hostname === 'localhost') {
          return 'http://localhost:8080';
        } else {
          // 固定使用 GitHub Pages 的基础路径（去除 index.html 等文件名）
          return 'https://shixund.github.io/DayX/';
        }
      },
      scopes: 'Files.ReadWrite.AppFolder offline_access',
      tokenKey: 'onedrive_token_web',      // 旧版 token 键（用于迁移兼容）
      pkceKey: 'onedrive_pkce_web'
    },

    // 生成 PKCE code_verifier 和 code_challenge
    async _generatePKCE() {
      const array = new Uint8Array(32);
      crypto.getRandomValues(array);
      const codeVerifier = btoa(String.fromCharCode(...array))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

      const encoder = new TextEncoder();
      const data = encoder.encode(codeVerifier);
      const hash = await crypto.subtle.digest('SHA-256', data);
      const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

      return { codeVerifier, codeChallenge };
    },

    // 生成随机 state
    _generateState() {
      const array = new Uint8Array(16);
      crypto.getRandomValues(array);
      return btoa(String.fromCharCode(...array)).replace(/[^a-zA-Z0-9]/g, '');
    },

    // 开始 OAuth 授权
    async startOneDriveAuth() {
      // 在授权前主动申请持久化存储权限，确保 token 不会丢失
      console.log('🔐 OneDrive 授权前检查持久化存储权限...');
      try {
        const storageStatus = await this.requestPersistentStorage();
        if (storageStatus && !storageStatus.persisted) {
          console.warn('⚠️ 未获得持久化存储权限，OneDrive token 可能会丢失！');
          console.warn('建议用户定期重新登录或使用导出数据功能备份。');
        } else if (storageStatus && storageStatus.persisted) {
          console.log('✅ 持久化存储已启用，OneDrive token 将受到保护');
        }
      } catch (error) {
        console.warn('⚠️ 持久化存储检查失败，继续授权流程:', error);
      }

      const { codeVerifier, codeChallenge } = await this._generatePKCE();
      const state = this._generateState();

      // 保存 PKCE 参数到 localStorage（供回调页面使用）
      localStorage.setItem(this._oneDriveConfig.pkceKey, JSON.stringify({
        codeVerifier,
        state,
        timestamp: Date.now()
      }));

      const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
        `client_id=${this._oneDriveConfig.clientId}` +
        `&response_type=code` +
        `&redirect_uri=${encodeURIComponent(this._oneDriveConfig.redirectUri)}` +
        `&response_mode=query` +
        `&scope=${encodeURIComponent(this._oneDriveConfig.scopes)}` +
        `&state=${state}` +
        `&code_challenge=${codeChallenge}` +
        `&code_challenge_method=S256`;

      return { auth_url: authUrl, state };
    },

    // 在新标签页中打开授权页面（旧方案，已由 MSAL popup 替代，保留供兼容）
    openAuthInNewTab(authUrl) {
      const authWindow = window.open(authUrl, '_blank', 'width=600,height=700');
      return authWindow;
    },

    /**
     * 使用 MSAL popup 完成 OneDrive 登录（Web 版推荐方式）。
     * 相比旧的"新标签页 + BroadcastChannel"方案，优势：
     *  1. MSAL 管理 token 生命周期，通过 SSO 会话 cookie 静默续签，不受 24h SPA 限制
     *  2. popup 由 MSAL 自动处理 auth code 交换，无需手动 BroadcastChannel
     *  3. 用户体验更佳（小弹窗，不跳转主页面）
     */
    async loginOneDriveViaPopup() {
      const msalInst = await getMSAL();
      if (!msalInst) {
        throw new Error('MSAL 未加载。请确保网络正常后刷新页面，或使用桌面客户端。');
      }

      // 清除上次可能残留的"交互进行中"标记，避免误判 block_nested_popups
      _clearMsalInteractionStatus();

      // 移动端：window.open 在很多移动浏览器中会被当作整页跳转，
      // 导致 loginPopup 在跳回本页时报 block_nested_popups。
      // 改用整页跳转的 loginRedirect，登录结果由初始化时的
      // handleRedirectPromise() 处理（见上方 _msalInitPromise）。
      if (_isMobileDevice()) {
        await msalInst.loginRedirect({
          scopes: MSAL_SCOPES,
          prompt: 'select_account',
        });
        // loginRedirect 会跳转整页，正常情况下不会执行到这里
        return null;
      }

      try {
        const response = await msalInst.loginPopup({
          scopes: MSAL_SCOPES,
          prompt: 'select_account',   // 让用户选择账号
        });
        console.log('[MSAL] ✅ popup 登录成功，账户:', response.account.username);
        return response;
      } catch (err) {
        if (err.errorCode === 'user_cancelled' || err.message?.includes('user_cancelled')) {
          throw new Error('user_cancelled');
        }
        if (err.errorCode === 'block_nested_popups' || err.errorCode === 'interaction_in_progress') {
          // 残留状态导致的误判，清理后提示用户重试
          _clearMsalInteractionStatus();
          throw new Error('登录状态异常，已自动清理，请重新点击登录');
        }
        throw err;
      }
    },

    // 消费"OneDrive 登录刚完成"标记（移动端 redirect 登录返回后使用）
    consumeOneDriveLoginJustCompleted() {
      const done = !!global.__dayxOneDriveLoginJustCompleted;
      global.__dayxOneDriveLoginJustCompleted = false;
      return done;
    },

    // 监听来自授权标签页的消息
    listenForAuthComplete() {
      return new Promise((resolve, reject) => {
        // 使用 BroadcastChannel 进行标签页间通信
        const channel = new BroadcastChannel('dayx_oauth_channel');

        // 设置 5 分钟超时
        const timeout = setTimeout(() => {
          channel.close();
          reject(new Error('授权超时'));
        }, 5 * 60 * 1000);

        channel.onmessage = (event) => {
          if (event.data.type === 'oauth_complete') {
            clearTimeout(timeout);
            channel.close();
            if (event.data.success) {
              resolve(event.data.token);
            } else {
              reject(new Error(event.data.error || '授权失败'));
            }
          }
        };

        // 同时轮询检查 localStorage（作为备用方案）
        const pollInterval = setInterval(async () => {
          const token = await this._getValidToken();
          if (token) {
            clearInterval(pollInterval);
            clearTimeout(timeout);
            channel.close();
            resolve({ access_token: token });
          }
        }, 2000);

        // 超时时也清理轮询
        setTimeout(() => clearInterval(pollInterval), 5 * 60 * 1000);
      });
    },

    // 通知原标签页授权完成
    notifyAuthComplete(success, tokenOrError) {
      const channel = new BroadcastChannel('dayx_oauth_channel');
      channel.postMessage({
        type: 'oauth_complete',
        success,
        token: success ? tokenOrError : null,
        error: success ? null : tokenOrError
      });
      channel.close();
    },

    // 检查并处理 OAuth 回调（在页面加载时调用）
    async checkAndHandleOAuthCallback() {
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      const state = urlParams.get('state');
      const error = urlParams.get('error');

      // 没有回调参数，不是回调页面
      if (!code && !error) {
        return { isCallback: false };
      }

      // 标记这是一个回调页面
      if (error) {
        // 通知原标签页授权失败
        this.notifyAuthComplete(false, `OAuth 授权失败: ${error}`);
        // 清除 URL 参数
        window.history.replaceState({}, document.title, window.location.pathname);
        return { isCallback: true, success: false, error };
      }

      // 获取保存的 PKCE 参数
      const pkceData = localStorage.getItem(this._oneDriveConfig.pkceKey);
      if (!pkceData) {
        const errorMsg = '未找到 PKCE 数据，请重新登录';
        this.notifyAuthComplete(false, errorMsg);
        window.history.replaceState({}, document.title, window.location.pathname);
        return { isCallback: true, success: false, error: errorMsg };
      }

      const { codeVerifier, state: expectedState } = JSON.parse(pkceData);

      // 验证 state
      if (state !== expectedState) {
        const errorMsg = 'State 验证失败，可能存在安全风险';
        this.notifyAuthComplete(false, errorMsg);
        window.history.replaceState({}, document.title, window.location.pathname);
        return { isCallback: true, success: false, error: errorMsg };
      }

      try {
        // 使用授权码换取 token
        const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: this._oneDriveConfig.clientId,
            scope: this._oneDriveConfig.scopes,
            code: code,
            redirect_uri: this._oneDriveConfig.redirectUri,
            grant_type: 'authorization_code',
            code_verifier: codeVerifier
          })
        });

        if (!tokenResponse.ok) {
          const errorText = await tokenResponse.text();
          const errorMsg = `Token 交换失败: ${errorText}`;
          this.notifyAuthComplete(false, errorMsg);
          window.history.replaceState({}, document.title, window.location.pathname);
          return { isCallback: true, success: false, error: errorMsg };
        }

        const tokenData = await tokenResponse.json();

        // 保存 token
        const token = {
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_in: tokenData.expires_in,
          expires_at: Math.floor(Date.now() / 1000) + tokenData.expires_in,
          token_type: tokenData.token_type
        };

        localStorage.setItem(this._oneDriveConfig.tokenKey, JSON.stringify(token));
        localStorage.removeItem(this._oneDriveConfig.pkceKey);

        // 再次确认持久化状态
        try {
          const persistStatus = await this.requestPersistentStorage();
          console.log('✅ Token 已保存到 localStorage:', {
            tokenKey: this._oneDriveConfig.tokenKey,
            hasRefreshToken: !!token.refresh_token,
            expiresAt: new Date(token.expires_at * 1000).toLocaleString(),
            persistentStorage: (persistStatus && persistStatus.persisted) ? '✅ 已保护' : '⚠️ 未保护'
          });
        } catch (error) {
          console.warn('⚠️ 持久化状态确认失败:', error);
          console.log('✅ Token 已保存到 localStorage:', {
            tokenKey: this._oneDriveConfig.tokenKey,
            hasRefreshToken: !!token.refresh_token,
            expiresAt: new Date(token.expires_at * 1000).toLocaleString()
          });
        }

        // 通知原标签页授权成功
        this.notifyAuthComplete(true, token);

        // 清除 URL 参数
        window.history.replaceState({}, document.title, window.location.pathname);

        return { isCallback: true, success: true, token };
      } catch (e) {
        const errorMsg = `授权处理失败: ${e.message}`;
        this.notifyAuthComplete(false, errorMsg);
        window.history.replaceState({}, document.title, window.location.pathname);
        return { isCallback: true, success: false, error: errorMsg };
      }
    },

    // 等待 OAuth 回调（已废弃，保留兼容性）
    async waitForOAuthCallback(expectedState) {
      // 这个方法在新的新标签页方案中不再直接使用
      // 保留以兼容桌面版本
      return null;
    },

    // 获取当前有效 token（优先 MSAL 静默续签，降级到旧版 refresh_token 兼容路径）
    async _getValidToken() {
      // ── 路径 A：MSAL 静默获取（推荐，Web 版主路径）──────────────────────────
      const msalInst = await getMSAL();
      if (msalInst) {
        const accounts = msalInst.getAllAccounts();
        if (accounts.length > 0) {
          try {
            // acquireTokenSilent 先查缓存；若 access_token 过期，通过 SSO 会话 cookie
            // 在隐藏 iframe 中静默换新 token，无需用户交互
            const response = await msalInst.acquireTokenSilent({
              scopes: MSAL_SCOPES,
              account: accounts[0],
            });
            console.log('[MSAL] 静默获取 token 成功，过期时间:', new Date(response.expiresOn).toLocaleString());
            return response.accessToken;
          } catch (silentErr) {
            // InteractionRequiredAuthError 意味着 SSO 会话也已过期，需要用户重新登录
            console.warn('[MSAL] ⚠️ 静默续签失败（需要用户交互）:', silentErr.message);
            return null;
          }
        }
        // MSAL 无账号：说明用户未通过 MSAL 登录，继续尝试旧版 token
      }

      // ── 路径 B：旧版 refresh_token（迁移兼容，适用于升级前已登录的用户）───────
      const tokenStr = localStorage.getItem(this._oneDriveConfig.tokenKey);
      console.log('[legacy] tokenStr 存在?', !!tokenStr);
      if (!tokenStr) return null;

      const token = JSON.parse(tokenStr);
      const now = Math.floor(Date.now() / 1000);
      console.log('[legacy] expires_at:', token.expires_at, ', now:', now, ', 剩余秒数:', token.expires_at - now);

      // 若旧 token 仍在有效期内（5 分钟余量）直接返回
      if (token.expires_at - now > 300) {
        return token.access_token;
      }

      // 旧版 refresh_token 续签（SPA 限制 24h，建议用户重新通过 MSAL 登录）
      if (!token.refresh_token) {
        localStorage.removeItem(this._oneDriveConfig.tokenKey);
        return null;
      }

      try {
        const refreshResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: this._oneDriveConfig.clientId,
            scope: this._oneDriveConfig.scopes,
            refresh_token: token.refresh_token,
            grant_type: 'refresh_token'
          })
        });

        if (!refreshResponse.ok) {
          console.warn('[legacy] refresh_token 已过期，需要重新登录');
          localStorage.removeItem(this._oneDriveConfig.tokenKey);
          return null;
        }

        const newTokenData = await refreshResponse.json();
        const newToken = {
          access_token: newTokenData.access_token,
          refresh_token: newTokenData.refresh_token || token.refresh_token,
          expires_in: newTokenData.expires_in,
          expires_at: Math.floor(Date.now() / 1000) + newTokenData.expires_in,
          token_type: newTokenData.token_type
        };

        localStorage.setItem(this._oneDriveConfig.tokenKey, JSON.stringify(newToken));
        return newToken.access_token;
      } catch (e) {
        localStorage.removeItem(this._oneDriveConfig.tokenKey);
        return null;
      }
    },

    // 获取 OneDrive 用户信息
    async getOneDriveUser() {
      const token = await this._getValidToken();
      if (!token) return null;

      const response = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) return null;

      const user = await response.json();
      return {
        display_name: user.displayName,
        mail: user.mail || user.userPrincipalName,
        id: user.id
      };
    },

    // 上传备份到 OneDrive
    async uploadBackupToOneDrive(filename, data) {
      const token = await this._getValidToken();
      if (!token) throw new Error('未登录 OneDrive');

      const uploadUrl = `https://graph.microsoft.com/v1.0/me/drive/special/approot:/DayX/${filename}:/content`;

      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: data
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`上传失败: ${errorText}`);
      }

      return await response.json();
    },

    // 列出 OneDrive 备份
    async listOneDriveBackups() {
      const token = await this._getValidToken();
      if (!token) throw new Error('未登录 OneDrive');

      // 从 approot/DayX 文件夹获取文件列表
      const listUrl = 'https://graph.microsoft.com/v1.0/me/drive/special/approot:/DayX:/children';

      console.log('正在获取 OneDrive 备份列表...');

      const response = await fetch(listUrl, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('获取备份列表失败:', response.status, errorText);
        return [];
      }

      const data = await response.json();
      console.log('OneDrive 备份列表响应:', data);

      // 过滤只显示 .json 文件
      const jsonFiles = (data.value || []).filter(item =>
        item.name && item.name.endsWith('.json')
      );

      return jsonFiles;
    },

    // 从 OneDrive 下载备份
    async downloadBackupFromOneDrive(fileId) {
      const token = await this._getValidToken();
      if (!token) throw new Error('未登录 OneDrive');

      const downloadUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/content`;

      const response = await fetch(downloadUrl, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        throw new Error('下载失败');
      }

      return await response.text();
    },

    // 退出 OneDrive 登录（清除 MSAL 缓存 + 旧版 token）
    async logoutOneDrive() {
      // 清除 MSAL 缓存（本地注销，不弹出微软退出页面）
      const msalInst = await getMSAL();
      if (msalInst) {
        // 清除 localStorage 中所有 MSAL 缓存键（格式：msal.{clientId}.xxx）
        const msalPrefix = `msal.${MSAL_CLIENT_ID}`;
        const keysToRemove = Object.keys(localStorage).filter(k =>
          k.startsWith(msalPrefix) || k.startsWith('msal.') || k === 'msal.cache.keys'
        );
        keysToRemove.forEach(k => localStorage.removeItem(k));
        // 重置实例，确保下次 getMSAL() 重新初始化
        _msalInstance = null;
        _msalInitPromise = null;
        console.log('[MSAL] 已清除本地缓存');
      }
      // 清除旧版 token
      localStorage.removeItem(this._oneDriveConfig.tokenKey);
      localStorage.removeItem(this._oneDriveConfig.pkceKey);
      return true;
    },

    // 检查是否已登录（MSAL 优先，兼容旧版 token）
    async isOneDriveLoggedIn() {
      console.log('isOneDriveLoggedIn: 开始检查...');
      const token = await this._getValidToken();
      console.log('isOneDriveLoggedIn: 结果:', !!token);
      return !!token;
    },

    async getDesktopPinStatus() { return { pinned: false }; },
    async enableAutostart() { throw new Error('Autostart not supported in browser build'); },
    async disableAutostart() { throw new Error('Autostart not supported in browser build'); },
    async isAutostartEnabled() { return false; },

    async toggleLockState() { return false; },
    async toggleDesktopPin() { return false; },
    async updateDesktopPinState(isPinned) { return false; },
    async getSavedWindowState() { return {}; },

    // 打开外部链接（Web 版本）
    async openExternalUrl(url) {
      window.open(url, '_blank');
      return true;
    }
  };

  // export to global as TauriAPI so existing code works without changes
  global.TauriAPI = WebAPI;
  if (global.SyncReminder) {
    global.SyncReminder.installApiHooks(WebAPI);
  }
})(window);
