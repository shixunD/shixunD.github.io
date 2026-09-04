// updateChecker.js —— 检测 version.json 是否有新版本，强制弹出"更新完成"弹窗（无法跳过/取消）
// 全局命名空间：window.UpdateChecker

(function () {
    'use strict';

    const LS_LAST_SEEN = 'lottery.updateMeta.lastSeenVersion';

    function getLastSeen() { return localStorage.getItem(LS_LAST_SEEN); }
    function setLastSeen(v) { localStorage.setItem(LS_LAST_SEEN, v); }

    async function fetchRemoteData() {
        try {
            const res = await fetch('./version.json', { cache: 'no-store' });
            if (!res.ok) return null;
            return await res.json();
        } catch (e) {
            return null;
        }
    }

    function renderChangelog(changelog) {
        const entries = (Array.isArray(changelog) ? changelog : []).slice(0, 3);
        if (entries.length === 0) {
            return '<div class="update-changelog-empty">暂无更新说明</div>';
        }
        return entries.map((entry) => `
            <div class="update-changelog-entry">
                <div class="update-changelog-version">
                    v${Modal.escapeHtml(entry.semver || '')}
                    <span class="update-changelog-date">${Modal.escapeHtml(entry.date || '')}</span>
                </div>
                <ul class="update-changelog-list">
                    ${(Array.isArray(entry.items) ? entry.items : []).map((i) => `<li>${Modal.escapeHtml(i)}</li>`).join('')}
                </ul>
            </div>
        `).join('');
    }

    // 强制更新弹窗：没有"取消"/"跳过"选项，唯一出口是点击"完成更新"按钮（清缓存+刷新页面）
    function showDialog(remoteVersion, semver, changelog) {
        const overlay = document.createElement('div');
        overlay.className = 'update-overlay';
        overlay.innerHTML = `
            <div class="update-dialog">
                <div class="update-icon">🎉</div>
                <div class="update-title">You have successfully updated to v${Modal.escapeHtml(semver || '')}!!!</div>
                <div class="update-whatsnew-title">What's New</div>
                <div class="update-changelog">${renderChangelog(changelog)}</div>
                <div class="update-actions">
                    <button type="button" class="btn-primary" data-action="finish">Click here to finish update</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.querySelector('[data-action="finish"]').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            setLastSeen(remoteVersion);
            overlay.querySelector('.update-title').textContent = '正在完成更新...';
            overlay.querySelector('.update-whatsnew-title').style.display = 'none';
            overlay.querySelector('.update-changelog').style.display = 'none';
            await applyUpdate();
            location.reload();
        });
    }

    async function applyUpdate() {
        if ('serviceWorker' in navigator) {
            try {
                const reg = await navigator.serviceWorker.getRegistration();
                if (reg && reg.waiting) {
                    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
                }
                if (reg) {
                    reg.active && reg.active.postMessage({ type: 'CLEAR_CACHE' });
                }
            } catch (e) { /* 忽略 */ }
        }
    }

    async function check() {
        const remote = await fetchRemoteData();
        if (!remote || !remote.version) return;

        const lastSeen = getLastSeen();
        if (lastSeen === null) {
            // 首次访问：直接记录当前版本，不弹窗打扰
            setLastSeen(remote.version);
            return;
        }
        if (remote.version === lastSeen) return;

        showDialog(remote.version, remote.semver, remote.changelog);
    }

    window.UpdateChecker = { check };
})();
