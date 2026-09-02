// updateChecker.js —— 检测 version.json 是否有新版本，弹窗提示升级/跳过
// 全局命名空间：window.UpdateChecker

(function () {
    'use strict';

    const LS_LAST_SEEN = 'lottery.updateMeta.lastSeenVersion';
    const LS_SKIPPED = 'lottery.updateMeta.skippedVersion';

    function getLastSeen() { return localStorage.getItem(LS_LAST_SEEN); }
    function setLastSeen(v) { localStorage.setItem(LS_LAST_SEEN, v); }
    function getSkipped() { return localStorage.getItem(LS_SKIPPED); }
    function setSkipped(v) { localStorage.setItem(LS_SKIPPED, v); }

    async function fetchRemoteVersion() {
        try {
            const res = await fetch('./version.json', { cache: 'no-store' });
            if (!res.ok) return null;
            const data = await res.json();
            return data.version || null;
        } catch (e) {
            return null;
        }
    }

    function showDialog(remoteVersion) {
        const overlay = document.createElement('div');
        overlay.className = 'update-overlay';
        overlay.innerHTML = `
            <div class="update-dialog">
                <div class="update-icon">🚀</div>
                <div class="update-title">发现新版本</div>
                <div class="update-text">检测到应用有更新，建议立即升级以获得最新功能和修复。</div>
                <div class="update-version">${Modal.escapeHtml(remoteVersion)}</div>
                <div class="update-skip-row">
                    <label class="checkbox-label-inline">
                        <input type="checkbox" id="update-skip-checkbox">
                        <span>本版本不再提示</span>
                    </label>
                </div>
                <div class="update-actions">
                    <button type="button" class="btn-secondary" data-action="cancel">取消</button>
                    <button type="button" class="btn-primary" data-action="confirm">立即升级</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.addEventListener('click', async (e) => {
            const action = e.target.closest('[data-action]');
            if (!action) return;
            const skip = overlay.querySelector('#update-skip-checkbox').checked;

            if (action.dataset.action === 'confirm') {
                setLastSeen(remoteVersion);
                overlay.querySelector('.update-title').textContent = '正在升级...';
                overlay.querySelector('.update-text').textContent = '正在清理旧缓存并刷新，请稍候';
                await applyUpdate();
                location.reload();
                return;
            }

            // 取消
            if (skip) setSkipped(remoteVersion);
            overlay.remove();
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
        const remoteVersion = await fetchRemoteVersion();
        if (!remoteVersion) return;

        const lastSeen = getLastSeen();
        if (lastSeen === null) {
            // 首次访问：直接记录当前版本，不弹窗打扰
            setLastSeen(remoteVersion);
            return;
        }
        if (remoteVersion === lastSeen) return;
        if (remoteVersion === getSkipped()) return;

        showDialog(remoteVersion);
    }

    window.UpdateChecker = { check };
})();
