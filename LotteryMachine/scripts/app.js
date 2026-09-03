// app.js —— 启动入口：初始化数据、注册 Service Worker、挂导航、触发更新检查/持久化申请

(function () {
    'use strict';

    function registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./service-worker.js').catch((err) => {
                console.warn('[app] Service Worker 注册失败:', err);
            });
        });
    }

    function renderCurrentPage(pageName) {
        if (pageName === 'wheel') WheelPage.render();
        if (pageName === 'roster') RosterPage.render();
        if (pageName === 'settings') SettingsPage.render();
    }

    // 站点根目录：用当前部署所在的域名动态拼，而不是写死 shixund.github.io——
    // 这样部署到别的域名/别人 fork 之后，Logo 和署名点击仍然指向"这次实际部署所在网站"的根目录，而不是固定跳到作者的站点
    function siteRootUrl() {
        return `${window.location.origin}/`;
    }

    function bindSiteCredit() {
        const el = document.getElementById('site-credit');
        if (!el) return;
        el.addEventListener('click', () => {
            window.open(siteRootUrl(), '_blank', 'noopener');
        });
    }

    function bindNavBrandHome() {
        const el = document.getElementById('nav-brand-home-btn');
        if (!el) return;
        el.addEventListener('click', () => {
            window.open(siteRootUrl(), '_blank', 'noopener');
        });
    }

    // 抽奖快捷键（默认 PageUp，配合翻页笔；支持 Ctrl/Alt/Shift 等组合键）：只在抽奖页激活时生效，
    // 且设置页正在"录入快捷键"监听下一次按键时会跳过（见 settings.js 的 window.__recordingShortcut 标记）
    function bindSpinShortcut() {
        document.addEventListener('keydown', (e) => {
            if (window.__recordingShortcut) return;
            const activePage = document.querySelector('.page.active');
            if (!activePage || activePage.id !== 'wheel-page') return;

            const shortcutKey = AppState.getState().settings.spinShortcutKey;
            if (!ShortcutUtil.matches(e, shortcutKey)) return;

            e.preventDefault(); // 避免 PageUp 等默认键触发浏览器自身的翻页/滚动
            WheelPage.triggerShortcutSpin();
        });
    }

    async function init() {
        registerServiceWorker();
        bindSiteCredit();
        await MsalAuth.init();

        await AppState.load();

        Navigation.init();
        Navigation.onPageChange(renderCurrentPage);
        Navigation.onPageChange(() => DrawHistory.refreshVisibility()); // 只在抽奖页显示，切到录入/设置页时隐藏（记录本身不清空）
        bindNavBrandHome();
        bindSpinShortcut();

        // 数据变化时，重新渲染当前激活的页面
        AppState.subscribe(() => {
            const activePage = document.querySelector('.page.active');
            if (!activePage) return;
            renderCurrentPage(activePage.id.replace('-page', ''));
        });

        renderCurrentPage('wheel');

        Persistence.requestPersistence();
        UpdateChecker.check();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
