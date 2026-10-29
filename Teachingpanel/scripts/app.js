// app.js —— 启动入口：注册 Service Worker、加载数据、挂导航、订阅重绘、提醒/持久化/更新检查
// 必须是 index.html 里最后一个加载的脚本

(function () {
    'use strict';

    function registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        window.addEventListener('load', () => {
            // updateViaCache:'none'：拉取 service-worker.js 本身也绕过浏览器 HTTP 缓存，
            // 否则 SW 脚本可能一直是旧版且不报错，改了 SW 逻辑却"跟没改一样"
            // scope 显式限定在本应用目录，不去接管同域名下别的路径（别的 PWA）
            navigator.serviceWorker.register('./service-worker.js', { scope: './', updateViaCache: 'none' }).catch((err) => {
                console.warn('[app] Service Worker 注册失败:', err);
            });
        });
    }

    function renderCurrentPage(pageName) {
        if (pageName === 'home') SettingsPage.render();
        else if (pageName === 'homework') HomeworkPage.render();
        else if (pageName === 'recitation') RecitationPage.render();
        else if (pageName === 'exams') ExamsPage.render();
    }

    // "回到网站首页"语义：用当前部署域名动态拼，不硬编码作者域名（fork 部署后依然正确）
    function siteRootUrl() {
        return `${window.location.origin}/`;
    }

    function bindSiteLinks() {
        ['site-credit', 'nav-brand-home-btn'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', () => window.open(siteRootUrl(), '_blank', 'noopener'));
        });
    }

    function renderClassSwitcher() {
        ClassSwitcher.renderInto(document.getElementById('nav-class-switcher'));
    }

    async function init() {
        registerServiceWorker();
        bindSiteLinks();

        await AppState.load();

        Navigation.init();
        Navigation.onPageChange(renderCurrentPage);
        renderClassSwitcher();

        // 数据变化：重绘当前页面 + 班级切换器 + 提醒角标 + 打开中的学生档案
        AppState.subscribe(() => {
            renderCurrentPage(Navigation.getCurrent());
            renderClassSwitcher();
            Reminders.updateBadge();
            StudentProfile.refresh();
        });

        Navigation.goTo(Navigation.getInitialPage());
        Reminders.init();
        SettingsPage.init();

        Persistence.requestPersistence().then(() => {
            if (Navigation.getCurrent() === 'home') SettingsPage.render();
        });
        UpdateChecker.check();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
