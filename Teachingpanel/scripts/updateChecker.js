// updateChecker.js —— 比对部署指纹 /deploy-tag.json 判断是否有新部署，弹出更新弹窗
// 全局命名空间：window.UpdateChecker
//
// 判重只看部署指纹（Cloudflare Workers Builds 构建命令自动生成，内容含 commit SHA），
// version.json 的 semver/changelog 只用于弹窗展示"更新了什么"，不参与判重。
//
// ⚠ 这里故意用绝对路径 '/deploy-tag.json'（违反"一律相对路径"的通用规则）：
// 指纹文件生成在宿主仓库根目录，本应用可能被挂在子路径下，相对路径会找不到它。不要"顺手"改成 './deploy-tag.json'。

(function () {
    'use strict';

    const LS_LAST_SEEN = 'teachingPanel.updateMeta.lastSeenTag';
    const DEPLOY_TAG_URL = '/deploy-tag.json';
    // 只清本应用的缓存（与 service-worker.js 的 CACHE_PREFIX 一致），同域名下别的 PWA 的缓存不能动
    const CACHE_PREFIX = 'teaching-panel-';

    function getLastSeen() { return Utils.lsGet(LS_LAST_SEEN, null); }
    function setLastSeen(v) { Utils.lsSet(LS_LAST_SEEN, v); }

    async function fetchTag() {
        try {
            const res = await fetch(DEPLOY_TAG_URL, { cache: 'no-store' });
            if (!res.ok) return null;
            const text = (await res.text()).trim();
            // 本地静态服务器对不存在的路径有时会回退返回 index.html，不能把它当成指纹
            if (!text || text.startsWith('<')) return null;
            return text;
        } catch (e) {
            return null;
        }
    }

    async function fetchVersionInfo() {
        try {
            const res = await fetch('./version.json', { cache: 'no-store' });
            if (!res.ok) return null;
            return await res.json();
        } catch (e) {
            return null;
        }
    }

    function changelogHtml(info) {
        const esc = Utils.escapeHtml;
        const list = info && Array.isArray(info.changelog) ? info.changelog.slice(0, 3) : [];
        if (!list.length) return '';
        return `<div class="update-changelog">
            ${list.map((c) => `<div class="update-cl-entry">
                <div class="update-cl-ver">v${esc(c.semver)} <span>${esc(c.date || '')}</span></div>
                <ul>${(c.items || []).map((it) => `<li>${esc(it)}</li>`).join('')}</ul>
            </div>`).join('')}
        </div>`;
    }

    // 没有遮罩点击/Esc 关闭；三个明确出口：立即更新 / 稍后（不记录，下次再问）/ 跳过此版本（记录但不刷新）
    function showDialog(tag, info) {
        if (document.querySelector('.update-overlay')) return;
        const overlay = document.createElement('div');
        overlay.className = 'update-overlay';
        overlay.innerHTML = `
            <div class="update-dialog">
                <div class="update-icon">🚀</div>
                <div class="update-title">发现新版本${info && info.semver ? ` v${Utils.escapeHtml(info.semver)}` : ''}</div>
                <div class="update-text">点击下方按钮完成更新（会清理旧缓存并刷新页面，数据不受影响）。</div>
                ${changelogHtml(info)}
                <div class="update-actions">
                    <button type="button" class="btn-primary" data-action="update">点此完成更新</button>
                    <div class="update-actions-row">
                        <button type="button" class="btn-secondary" data-action="later">稍后再说</button>
                        <button type="button" class="btn-secondary" data-action="skip">跳过此版本</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.addEventListener('click', async (e) => {
            const action = e.target.closest('[data-action]');
            if (!action) return;
            const type = action.dataset.action;
            if (type === 'update') {
                setLastSeen(tag);
                overlay.querySelector('.update-title').textContent = '正在更新…';
                overlay.querySelector('.update-text').textContent = '正在清理旧缓存并刷新，请稍候';
                await applyUpdate();
                location.reload();
            } else if (type === 'skip') {
                setLastSeen(tag);
                overlay.remove();
            } else {
                overlay.remove();
            }
        });
    }

    async function applyUpdate() {
        if (!('serviceWorker' in navigator)) return;
        try {
            const reg = await navigator.serviceWorker.getRegistration('./');
            if (reg && reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            if (reg && reg.active) reg.active.postMessage({ type: 'CLEAR_CACHE' });
            if ('caches' in window) {
                const names = await caches.keys();
                await Promise.all(names.map((n) => n.startsWith(CACHE_PREFIX) && caches.delete(n)));
            }
        } catch (e) { /* 忽略 */ }
    }

    // opts.force=true：设置页"检查更新"按钮用，跳过判重短路，只要拿到指纹就弹窗。
    // 返回 {ok, shown}；ok=false 表示拿不到部署指纹（本地开发/离线）
    async function check(opts) {
        const force = !!(opts && opts.force);
        const tag = await fetchTag();
        if (!tag) return { ok: false, shown: false };

        if (!force) {
            const lastSeen = getLastSeen();
            if (lastSeen === null) { setLastSeen(tag); return { ok: true, shown: false }; }
            if (lastSeen === tag) return { ok: true, shown: false };
        }
        showDialog(tag, await fetchVersionInfo());
        return { ok: true, shown: true };
    }

    async function getVersionLabel() {
        const info = await fetchVersionInfo();
        return info && info.semver ? `v${info.semver}` : '未知';
    }

    window.UpdateChecker = { check, getVersionLabel };
})();
