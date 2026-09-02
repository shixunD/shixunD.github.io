// onedriveApi.js —— OneDrive Graph API 封装（列表分页/上传/下载/删除）+ 备份弹窗 UI
// 全局命名空间：window.OneDriveApi
// 备份文件存放在本应用专属的 OneDrive AppFolder 下的 LotteryMachine 子文件夹里

(function () {
    'use strict';

    const APP_SUBFOLDER = 'LotteryMachine';
    const PAGE_SIZE = 10;
    const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

    // ---------- Graph API ----------

    async function authFetch(url, options) {
        const token = await MsalAuth.getAccessToken();
        const headers = Object.assign({}, (options && options.headers) || {}, {
            Authorization: `Bearer ${token}`
        });
        return fetch(url, Object.assign({}, options, { headers }));
    }

    async function getUserInfo() {
        const res = await authFetch(`${GRAPH_BASE}/me`);
        if (!res.ok) throw new Error('获取用户信息失败');
        return res.json();
    }

    // 上传（若同名文件已存在会被覆盖）
    async function uploadBackup(filename, jsonObject) {
        const url = `${GRAPH_BASE}/me/drive/special/approot:/${APP_SUBFOLDER}/${encodeURIComponent(filename)}:/content`;
        const body = JSON.stringify(jsonObject, null, 2);
        const res = await authFetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body
        });
        if (!res.ok) throw new Error(`上传失败: ${res.status}`);
        return res.json();
    }

    // 首页列表 URL：按文件名倒序（时间戳文件名倒序即最新在前）
    function firstListUrl() {
        const folder = `${GRAPH_BASE}/me/drive/special/approot:/${APP_SUBFOLDER}:/children`;
        return `${folder}?$top=${PAGE_SIZE}&$orderby=name desc`;
    }

    async function fetchPage(url) {
        const res = await authFetch(url);
        if (res.status === 404) return { value: [], '@odata.nextLink': null };
        if (!res.ok) throw new Error(`获取备份列表失败: ${res.status}`);
        return res.json();
    }

    async function downloadBackup(itemId) {
        const res = await authFetch(`${GRAPH_BASE}/me/drive/items/${itemId}/content`);
        if (!res.ok) throw new Error('下载备份失败');
        return res.json();
    }

    async function deleteBackup(itemId) {
        const res = await authFetch(`${GRAPH_BASE}/me/drive/items/${itemId}`, { method: 'DELETE' });
        if (!res.ok && res.status !== 204) throw new Error('删除备份失败');
    }

    // ---------- 分页游标管理 ----------
    // pageCursors[0] = 第一页请求 URL；pageCursors[i] = 第 i 页请求 URL（从抓取第 i-1 页时得到的 nextLink 填入）
    let pageCursors = [firstListUrl()];
    let currentPageIndex = 0;
    let currentPageItems = [];

    function resetPagination() {
        pageCursors = [firstListUrl()];
        currentPageIndex = 0;
        currentPageItems = [];
    }

    async function loadPage(index) {
        const url = pageCursors[index];
        if (!url) return null;
        const data = await fetchPage(url);
        currentPageIndex = index;
        currentPageItems = (data.value || []).filter((it) => it.file); // 只保留文件，忽略文件夹
        pageCursors[index + 1] = data['@odata.nextLink'] || null;
        return currentPageItems;
    }

    function hasNextPage() {
        return !!pageCursors[currentPageIndex + 1];
    }
    function hasPrevPage() {
        return currentPageIndex > 0;
    }

    // ---------- UI ----------

    let overlayEl = null;

    function ensureOverlay() {
        if (overlayEl) return overlayEl;
        overlayEl = document.createElement('div');
        overlayEl.className = 'onedrive-overlay';
        overlayEl.hidden = true;
        overlayEl.innerHTML = `
            <div class="onedrive-dialog">
                <div class="onedrive-header">
                    <h2 style="margin:0;">☁️ OneDrive 云备份</h2>
                    <button type="button" class="onedrive-close-btn" data-action="close">✕</button>
                </div>
                <div id="onedrive-body"></div>
            </div>
        `;
        document.body.appendChild(overlayEl);

        overlayEl.addEventListener('click', (e) => {
            if (e.target === overlayEl) close();
            const action = e.target.closest('[data-action]');
            if (action && action.dataset.action === 'close') close();
        });

        return overlayEl;
    }

    function close() {
        if (overlayEl) overlayEl.hidden = true;
    }

    async function open() {
        ensureOverlay().hidden = false;
        await render();
    }

    async function render() {
        const body = overlayEl.querySelector('#onedrive-body');
        const account = MsalAuth.getAccount();

        if (!account) {
            body.innerHTML = `
                <div class="onedrive-login-box">
                    <div style="font-size:2.4rem;">☁️</div>
                    <p>登录 OneDrive 后即可上传/恢复备份数据<br>数据仅保存在应用专属文件夹中</p>
                    <button type="button" class="btn-primary" id="onedrive-login-btn">🔑 登录 OneDrive</button>
                </div>
            `;
            body.querySelector('#onedrive-login-btn').addEventListener('click', async () => {
                try {
                    await MsalAuth.login();
                    Toast.success('登录成功');
                    resetPagination();
                    await render();
                } catch (e) {
                    if (e.message === 'user_cancelled') return;
                    Toast.error('登录失败: ' + e.message);
                }
            });
            return;
        }

        body.innerHTML = `
            <div class="onedrive-user-row">
                <div class="onedrive-avatar">👤</div>
                <div class="onedrive-user-meta">
                    <div class="onedrive-user-name">${Modal.escapeHtml(account.name || account.username)}</div>
                    <div class="onedrive-user-email">${Modal.escapeHtml(account.username)}</div>
                </div>
                <button type="button" class="btn-secondary" id="onedrive-logout-btn">退出</button>
            </div>
            <div class="onedrive-upload-row">
                <input type="text" id="onedrive-upload-name" value="${ImportExport.timestampName()}">
                <button type="button" class="btn-primary" id="onedrive-upload-btn">📤 上传备份</button>
            </div>
            <div class="onedrive-history-title">历史备份</div>
            <div class="onedrive-history-scroll" id="onedrive-history-scroll">
                <div class="onedrive-empty">加载中...</div>
            </div>
            <div class="onedrive-pagination">
                <button type="button" class="btn-icon" id="onedrive-prev-btn" title="上一页">◀</button>
                <span id="onedrive-page-label">第 1 页</span>
                <button type="button" class="btn-icon" id="onedrive-next-btn" title="下一页">▶</button>
            </div>
        `;

        body.querySelector('#onedrive-logout-btn').addEventListener('click', async () => {
            await MsalAuth.logout();
            Toast.info('已退出登录');
            await render();
        });

        body.querySelector('#onedrive-upload-btn').addEventListener('click', async () => {
            const nameInput = body.querySelector('#onedrive-upload-name');
            const name = (nameInput.value || ImportExport.timestampName()).trim();
            const btn = body.querySelector('#onedrive-upload-btn');
            btn.disabled = true;
            btn.textContent = '上传中...';
            try {
                await uploadBackup(`${name}.json`, AppState.exportSnapshot());
                Toast.success('备份上传成功');
                resetPagination();
                await renderHistory();
            } catch (e) {
                Toast.error('上传失败: ' + e.message);
            } finally {
                btn.disabled = false;
                btn.textContent = '📤 上传备份';
            }
        });

        body.querySelector('#onedrive-prev-btn').addEventListener('click', async () => {
            if (!hasPrevPage()) return;
            await loadPage(currentPageIndex - 1);
            renderHistoryList();
        });
        body.querySelector('#onedrive-next-btn').addEventListener('click', async () => {
            if (!hasNextPage()) return;
            await loadPage(currentPageIndex + 1);
            renderHistoryList();
        });

        resetPagination();
        await renderHistory();
    }

    async function renderHistory() {
        const scroll = overlayEl.querySelector('#onedrive-history-scroll');
        scroll.innerHTML = '<div class="onedrive-empty">加载中...</div>';
        try {
            await loadPage(0);
            renderHistoryList();
        } catch (e) {
            scroll.innerHTML = `<div class="onedrive-empty">加载失败：${Modal.escapeHtml(e.message)}</div>`;
        }
    }

    function formatSize(bytes) {
        if (!bytes) return '0 KB';
        const kb = bytes / 1024;
        if (kb < 1024) return `${kb.toFixed(1)} KB`;
        return `${(kb / 1024).toFixed(1)} MB`;
    }

    function renderHistoryList() {
        const scroll = overlayEl.querySelector('#onedrive-history-scroll');
        const pageLabel = overlayEl.querySelector('#onedrive-page-label');
        const prevBtn = overlayEl.querySelector('#onedrive-prev-btn');
        const nextBtn = overlayEl.querySelector('#onedrive-next-btn');

        pageLabel.textContent = `第 ${currentPageIndex + 1} 页`;
        prevBtn.disabled = !hasPrevPage();
        nextBtn.disabled = !hasNextPage();

        if (currentPageItems.length === 0) {
            scroll.innerHTML = '<div class="onedrive-empty">还没有云端备份，点击上方"上传备份"创建第一个吧</div>';
            return;
        }

        scroll.innerHTML = currentPageItems.map((item) => `
            <div class="onedrive-history-item" data-id="${item.id}">
                <span class="onedrive-history-icon">📄</span>
                <div class="onedrive-history-meta">
                    <div class="onedrive-history-name">${Modal.escapeHtml(item.name)}</div>
                    <div class="onedrive-history-size">${formatSize(item.size)} · ${new Date(item.lastModifiedDateTime).toLocaleString()}</div>
                </div>
                <div class="onedrive-history-actions">
                    <button type="button" class="restore-btn" data-action="restore" title="恢复到本地">⬇️</button>
                    <button type="button" class="delete-btn" data-action="delete" title="删除">🗑️</button>
                </div>
            </div>
        `).join('');

        scroll.querySelectorAll('.onedrive-history-item').forEach((row) => {
            const id = row.dataset.id;
            const item = currentPageItems.find((it) => it.id === id);

            row.querySelector('[data-action="restore"]').addEventListener('click', async () => {
                const ok = await Modal.confirm({
                    title: '恢复备份',
                    text: `将用「${item.name}」覆盖当前本地数据，此操作不可撤销，确定继续吗？`,
                    confirmText: '恢复',
                    danger: true
                });
                if (!ok) return;
                try {
                    const data = await downloadBackup(item.id);
                    if (!ImportExport.validateSnapshot(data)) throw new Error('备份文件格式无效');
                    await AppState.replaceState(data);
                    Toast.success('已恢复备份');
                    close();
                } catch (e) {
                    Toast.error('恢复失败: ' + e.message);
                }
            });

            row.querySelector('[data-action="delete"]').addEventListener('click', async () => {
                const ok = await Modal.confirm({
                    title: '删除备份',
                    text: `确定删除云端备份「${item.name}」吗？此操作不可撤销。`,
                    confirmText: '删除',
                    danger: true
                });
                if (!ok) return;
                try {
                    await deleteBackup(item.id);
                    Toast.success('已删除');
                    resetPagination();
                    await renderHistory();
                } catch (e) {
                    Toast.error('删除失败: ' + e.message);
                }
            });
        });
    }

    window.OneDriveApi = { open, close, getUserInfo, uploadBackup };
})();
