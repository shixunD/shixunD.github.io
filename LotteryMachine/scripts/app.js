// app.js —— 启动入口：初始化数据、注册 Service Worker、挂导航、触发更新检查/持久化申请

(function () {
    'use strict';

    function registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        window.addEventListener('load', () => {
            // updateViaCache: 'none' 是真实踩过的一个大坑——不加这个选项，
            // navigator.serviceWorker.register() 拉取 service-worker.js 这个文件本身时，
            // 依然会遵守浏览器自己的 HTTP 磁盘缓存：如果这个 URL 之前被普通方式请求过（哪怕只是
            // 浏览器自己按启发式规则缓存过），register()/后续的更新检查可能会一直用着缓存住的
            // 旧版 SW 脚本执行，代码里已经改过的 install/fetch 逻辑完全不会生效，且没有任何报错、
            // 表现就是"怎么改 service-worker.js 都跟没改一样"，非常隐蔽难查。'none' 强制每次都绕过
            // HTTP 缓存去更新检查 SW 脚本本身（对它的 importScripts 依赖同样生效，虽然本项目没用）。
            navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' }).catch((err) => {
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
        MediaLoader.run(); // 不 await：蒙版本身已经挡住了交互，不需要拖慢下面的数据加载/页面渲染
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
