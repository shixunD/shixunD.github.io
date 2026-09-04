// updateChecker.js —— 检测 /deploy-tag.json 有没有变化，强制弹出"更新完成"弹窗（无法跳过/取消）
// 全局命名空间：window.UpdateChecker
//
// 判重信号是 /deploy-tag.json（仓库根目录，不是 LotteryMachine 自己目录下），这个文件不是本项目
// 维护的，是大项目（shixunD.github.io，Cloudflare Workers 通过 Git 集成部署）的 Build 命令在每次
// push 后自动生成的——内容是这次部署的 commit SHA + 构建时间。用绝对路径 `/deploy-tag.json`（而
// 不是相对路径）去请求，是因为 LotteryMachine 部署后挂在子目录（`xxxx.com/LotteryMachine/`），
// 这个文件却在仓库根目录，绝对路径能保证不管 LotteryMachine 部署在几层子目录下都能正确定位到它。
// 本地单独跑 LotteryMachine 开发调试时这个文件不存在，fetch 会 404，check() 会直接跳过检测，
// 不报错也不影响其它功能——这是有意的降级行为。
//
// 语义化版本号/更新说明（`semver`/`changelog`）依然由本项目自己的 version.json 人工维护，只是
// 不再靠它的内容变化来判重——避免了"只顾着改代码，忘了同步改 version.json 导致该弹的更新提示没弹"
// 这种人为失误，判重完全自动化，只要大项目发生任何一次 push 就一定会被发现。

(function () {
    'use strict';

    const LS_LAST_SEEN = 'lottery.updateMeta.lastSeenTag';

    function getLastSeen() { return localStorage.getItem(LS_LAST_SEEN); }
    function setLastSeen(v) { localStorage.setItem(LS_LAST_SEEN, v); }

    // 拿这次部署的指纹：直接读 /deploy-tag.json 的原始文本内容（commit SHA + 构建时间），
    // 内容不同就代表大项目有新的 push 部署过，不需要额外算哈希或读响应头
    async function fetchTag() {
        try {
            const res = await fetch('/deploy-tag.json', { cache: 'no-store' });
            if (!res.ok) return null;
            return await res.text();
        } catch (e) {
            return null; // 本地开发没有这个文件 / 离线：跳过这次检测，不误报
        }
    }

    // What's New 展示内容单独从本项目自己的 version.json 读，只用来展示、不参与判重
    async function fetchChangelog() {
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
    function showDialog(tag, semver, changelog) {
        const overlay = document.createElement('div');
        overlay.className = 'update-overlay';
        overlay.innerHTML = `
            <div class="update-dialog">
                <div class="update-icon">🎉</div>
                <div class="update-title">You have successfully updated${semver ? ` to v${Modal.escapeHtml(semver)}` : ''}!!!</div>
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
            setLastSeen(tag);
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
        const tag = await fetchTag();
        if (!tag) return; // 拿不到 deploy-tag.json（本地开发/离线/还没配置），跳过这次检测

        const lastSeen = getLastSeen();
        if (lastSeen === null) {
            // 首次访问：直接记录，不弹窗打扰
            setLastSeen(tag);
            return;
        }
        if (tag === lastSeen) return;

        const remote = await fetchChangelog();
        showDialog(tag, remote && remote.semver, remote && remote.changelog);
    }

    window.UpdateChecker = { check };
})();
