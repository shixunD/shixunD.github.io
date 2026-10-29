// navigation.js —— 四个主页面（主页/作业/背诵/考试）切换
// 全局命名空间：window.Navigation

(function () {
    'use strict';

    const PAGES = ['home', 'homework', 'recitation', 'exams'];
    const LS_KEY = 'teachingPanel.ui.page';
    const listeners = [];
    let current = 'home';

    function goTo(pageName) {
        if (!PAGES.includes(pageName)) return;
        current = pageName;
        Utils.lsSet(LS_KEY, pageName);

        document.querySelectorAll('.page').forEach((el) => {
            el.classList.toggle('active', el.id === `${pageName}-page`);
        });
        document.querySelectorAll('.nav-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.page === pageName);
        });
        window.scrollTo(0, 0);

        listeners.forEach((fn) => {
            try { fn(pageName); } catch (e) { console.error('[navigation] listener error', e); }
        });
    }

    function onPageChange(fn) { listeners.push(fn); }
    function getCurrent() { return current; }
    function getInitialPage() {
        const saved = Utils.lsGet(LS_KEY, 'home');
        return PAGES.includes(saved) ? saved : 'home';
    }

    function init() {
        document.querySelectorAll('.nav-btn').forEach((btn) => {
            btn.addEventListener('click', () => goTo(btn.dataset.page));
        });
    }

    window.Navigation = { init, goTo, onPageChange, getCurrent, getInitialPage };
})();
