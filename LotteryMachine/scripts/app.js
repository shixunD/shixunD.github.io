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

    function bindSiteCredit() {
        const el = document.getElementById('site-credit');
        if (!el) return;
        el.addEventListener('click', () => {
            window.open('https://shixund.github.io', '_blank', 'noopener');
        });
    }

    function bindNavBrandHome() {
        const el = document.getElementById('nav-brand-home-btn');
        if (!el) return;
        el.addEventListener('click', () => Navigation.goTo('wheel'));
    }

    // 抽奖快捷键（默认 PageUp，配合翻页笔）：只在抽奖页激活时生效，
    // 且设置页正在"录入快捷键"监听下一次按键时会跳过（见 settings.js 的 window.__recordingShortcut 标记）
    function bindSpinShortcut() {
        document.addEventListener('keydown', (e) => {
            if (window.__recordingShortcut) return;
            const activePage = document.querySelector('.page.active');
            if (!activePage || activePage.id !== 'wheel-page') return;

            const shortcutKey = AppState.getState().settings.spinShortcutKey;
            if (!shortcutKey || e.key !== shortcutKey) return;

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
