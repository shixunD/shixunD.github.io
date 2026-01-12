// Browser-side API shim using IndexedDB (no Tauri)
// Provides the same method signatures as scripts/api.js but runs in the browser.

(function (global) {
  const DB_NAME = 'dayx_web_db_v1';
  const STORE_NAME = 'days';

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'date' });
          store.createIndex('date_idx', 'date');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function withDB(fn) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      Promise.resolve(fn(store)).then(r => {
        tx.oncomplete = () => { db.close(); resolve(r); };
      }).catch(err => { db.close(); reject(err); });
    });
  }

  // Utility to get all days sorted by date asc
  async function _getAllDaysSorted() {
    return withDB(store => {
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
  }

  const WebAPI = {
    // ============ 环境检测 ============
    isWebBuild: true, // 标记这是 Web 构建版本

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
      return withDB(store => {
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
      return withDB(store => {
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
    },

    async updateWordsOrder(dayNumber, words) {
      const all = await _getAllDaysSorted();
      const day = all.find(d => d.day_number === dayNumber);
      if (!day) throw new Error('Day not found');
      const date = day.date;
      return withDB(store => {
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
    },

    async updateWordColor(dayNumber, wordIndex, color) {
      const all = await _getAllDaysSorted();
      const day = all.find(d => d.day_number === dayNumber);
      if (!day) throw new Error('Day not found');
      const date = day.date;
      return withDB(store => {
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
    },

    async updateWordText(dayNumber, wordIndex, newText) {
      const all = await _getAllDaysSorted();
      const day = all.find(d => d.day_number === dayNumber);
      if (!day) throw new Error('Day not found');
      const date = day.date;
      return withDB(store => {
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
    },

    async updateReviewCount(dayNumber, reviewCount) {
      const all = await _getAllDaysSorted();
      const day = all.find(d => d.day_number === dayNumber);
      if (!day) throw new Error('Day not found');
      const date = day.date;
      return withDB(store => {
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
    },

    async deleteAllData() {
      return withDB(store => {
        return new Promise((resolve, reject) => {
          const req = store.clear();
          req.onsuccess = () => resolve(true);
          req.onerror = () => reject(req.error);
        });
      });
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
      return withDB(store => {
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

    // OneDrive 配置
    _oneDriveConfig: {
      clientId: 'cf9e57d0-7dc3-4fd9-93f9-751d2abc1124', // 与 Tauri 版本相同
      // 自动检测 redirect_uri：本地开发用 localhost，生产用 GitHub Pages
      redirectUri: window.location.hostname === 'localhost'
        ? 'http://localhost:8080'
        : 'https://aaaableng.github.io/DayX/',
      scopes: 'Files.ReadWrite.AppFolder offline_access',
      tokenKey: 'onedrive_token_web',
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
      const { codeVerifier, codeChallenge } = await this._generatePKCE();
      const state = this._generateState();

      // 保存 PKCE 参数到 localStorage
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

    // 等待 OAuth 回调（浏览器版本直接检查 URL 参数）
    async waitForOAuthCallback(expectedState) {
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      const state = urlParams.get('state');
      const error = urlParams.get('error');

      if (error) {
        throw new Error(`OAuth 授权失败: ${error}`);
      }

      if (!code || !state) {
        return null; // 没有回调参数
      }

      if (state !== expectedState) {
        throw new Error('State 验证失败，可能存在安全风险');
      }

      // 获取保存的 PKCE 参数
      const pkceData = localStorage.getItem(this._oneDriveConfig.pkceKey);
      if (!pkceData) {
        throw new Error('未找到 PKCE 数据');
      }

      const { codeVerifier } = JSON.parse(pkceData);

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
        throw new Error(`Token 交换失败: ${errorText}`);
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

      console.log('✅ Token 已保存到 localStorage:', {
        tokenKey: this._oneDriveConfig.tokenKey,
        hasRefreshToken: !!token.refresh_token,
        expiresAt: new Date(token.expires_at * 1000).toLocaleString()
      });

      // 清除 URL 参数
      window.history.replaceState({}, document.title, window.location.pathname);

      return token;
    },

    // 获取当前 token（自动刷新）
    async _getValidToken() {
      const tokenStr = localStorage.getItem(this._oneDriveConfig.tokenKey);
      if (!tokenStr) return null;

      const token = JSON.parse(tokenStr);
      const now = Math.floor(Date.now() / 1000);

      // 如果 token 还有 5 分钟以上有效期，直接返回
      if (token.expires_at - now > 300) {
        return token.access_token;
      }

      // 需要刷新 token
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

    // 退出 OneDrive 登录
    async logoutOneDrive() {
      localStorage.removeItem(this._oneDriveConfig.tokenKey);
      localStorage.removeItem(this._oneDriveConfig.pkceKey);
      return true;
    },

    // 检查是否已登录
    async isOneDriveLoggedIn() {
      const token = await this._getValidToken();
      console.log('检查 OneDrive 登录状态:', {
        hasToken: !!token,
        tokenKey: this._oneDriveConfig.tokenKey,
        localStorageValue: localStorage.getItem(this._oneDriveConfig.tokenKey)
      });
      return !!token;
    },

    async getDesktopPinStatus() { return { pinned: false }; },
    async enableAutostart() { throw new Error('Autostart not supported in browser build'); },
    async disableAutostart() { throw new Error('Autostart not supported in browser build'); },
    async isAutostartEnabled() { return false; },

    async toggleLockState() { return false; },
    async toggleDesktopPin() { return false; },
    async updateDesktopPinState(isPinned) { return false; },
    async getSavedWindowState() { return {}; }
  };

  // export to global as TauriAPI so existing code works without changes
  global.TauriAPI = WebAPI;
})(window);
