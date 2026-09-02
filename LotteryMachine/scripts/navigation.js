// navigation.js —— 三页面（抽奖/录入/设置）切换
// 全局命名空间：window.Navigation

(function () {
    'use strict';

    const PAGES = ['wheel', 'roster', 'settings'];
    const listeners = [];

    function goTo(pageName) {
        if (!PAGES.includes(pageName)) return;

        document.querySelectorAll('.page').forEach((el) => {
            el.classList.toggle('active', el.id === `${pageName}-page`);
        });
        document.querySelectorAll('.nav-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.page === pageName);
        });

        listeners.forEach((fn) => {
            try { fn(pageName); } catch (e) { console.error('[navigation] listener error', e); }
        });
    }

    function onPageChange(fn) {
        listeners.push(fn);
    }

    function init() {
        document.querySelectorAll('.nav-btn').forEach((btn) => {
            btn.addEventListener('click', () => goTo(btn.dataset.page));
        });
    }

    window.Navigation = { init, goTo, onPageChange };
})();
