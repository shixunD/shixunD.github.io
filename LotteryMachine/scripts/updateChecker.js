// updateChecker.js —— 检测 /deploy-tag.json 有没有变化，弹出"更新完成"弹窗
// 全局命名空间：window.UpdateChecker
//
// 弹窗有三个按钮："完成更新"（清缓存+刷新，立即用上新版本）、"Maybe Later"（这次先不管，下次打开
// 应用照样会再弹一次）、"Skip This Version"（跳过这一个具体版本，直到下一次真的有新部署才再提示）——
// 具体行为见 showDialog() 顶部注释。
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

    // 更新弹窗：三个出口——
    // 1. "完成更新"：清缓存（智能清理，见 service-worker.js）+ 刷新，立即用上新版本。
    // 2. "Maybe Later"：直接关掉弹窗，不写 lastSeenTag——下次打开应用时 tag 还是和 lastSeenTag
    //    不一致，会照样再弹一次，相当于"这次先不管，下次打开再问我"。
    // 3. "Skip This Version"：把 lastSeenTag 更新成这次的 tag 但不清缓存/不刷新——这个具体版本
    //    以后不会再提示，但缓存也没清，用户依然在用旧版本运行；等下一次大仓库再 push、tag 变成
    //    新的值，才会重新弹出提示。
    // 后两者都不清缓存，所以旧版本代码依然会继续跑——这是有意的（用户主动选择"先不更新"），
    // 不是 bug。
    function showDialog(tag, semver, changelog) {
        const overlay = document.createElement('div');
        overlay.className = 'update-overlay';
        overlay.innerHTML = `
            <div class="update-dialog">
                <div class="update-icon">🎉</div>
                <div class="update-title">We have successfully updated${semver ? ` to v${Modal.escapeHtml(semver)}` : ''}!!!</div>
                <div class="update-whatsnew-title">What's New</div>
                <div class="update-changelog">${renderChangelog(changelog)}</div>
                <div class="update-actions">
                    <button type="button" class="btn-secondary" data-action="later">Maybe Later</button>
                    <button type="button" class="btn-secondary" data-action="skip">Skip This Version</button>
                    <button type="button" class="btn-primary" data-action="finish">Click here to finish update</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        function closeDialog() {
            overlay.remove();
        }

        overlay.querySelector('[data-action="later"]').addEventListener('click', () => {
            closeDialog(); // 不写 lastSeenTag，下次打开应用照样会再弹一次
        });

        overlay.querySelector('[data-action="skip"]').addEventListener('click', () => {
            setLastSeen(tag); // 只记这一版跳过，不清缓存/不刷新，等下一次真正有新部署才会再提示
            closeDialog();
        });

        overlay.querySelector('[data-action="finish"]').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            overlay.querySelectorAll('button').forEach((b) => { b.disabled = true; });
            setLastSeen(tag);
            overlay.querySelector('.update-title').textContent = '正在完成更新...';
            overlay.querySelector('.update-whatsnew-title').style.display = 'none';
            overlay.querySelector('.update-changelog').style.display = 'none';
            overlay.querySelector('.update-actions').style.display = 'none';
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

    // opts.force：跳过"首次访问直接记录"和"tag 没变就不弹"这两条判重逻辑，无条件走一遍
    // "tag 变化后开启网页"本该发生的流程（拉最新 changelog + 弹更新弹窗）——用于设置页
    // "🔄 检查更新"按钮：用户主动点击时应该立刻看到当前版本的更新内容，而不是因为 tag
    // 恰好没变就悄悄什么反应都没有。
    // 返回 { ok, shown }：ok=false 表示没拿到 tag（本地开发/离线），调用方可以据此提示用户；
    // shown 表示这次有没有真的弹出弹窗。
    async function check(opts) {
        const force = !!(opts && opts.force);
        const tag = await fetchTag();
        if (!tag) return { ok: false, shown: false }; // 拿不到 deploy-tag.json（本地开发/离线/还没配置），跳过这次检测

        const lastSeen = getLastSeen();
        if (!force) {
            if (lastSeen === null) {
                // 首次访问：直接记录，不弹窗打扰
                setLastSeen(tag);
                return { ok: true, shown: false };
            }
            if (tag === lastSeen) return { ok: true, shown: false };
        }

        const remote = await fetchChangelog();
        showDialog(tag, remote && remote.semver, remote && remote.changelog);
        return { ok: true, shown: true };
    }

    window.UpdateChecker = { check };
})();
