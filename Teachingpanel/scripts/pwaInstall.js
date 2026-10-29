// pwaInstall.js —— 捕获 beforeinstallprompt，提供"安装到桌面"按钮逻辑
// 全局命名空间：window.PwaInstall

(function () {
    'use strict';

    let deferredPrompt = null;
    const listeners = [];

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        listeners.forEach((fn) => fn(true));
    });

    window.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        listeners.forEach((fn) => fn(false));
    });

    function isAvailable() {
        return !!deferredPrompt;
    }

    async function promptInstall() {
        if (!deferredPrompt) return null;
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        deferredPrompt = null;
        listeners.forEach((fn) => fn(false));
        return choice.outcome; // 'accepted' | 'dismissed'
    }

    function onAvailabilityChange(fn) {
        listeners.push(fn);
    }

    function isStandalone() {
        return window.matchMedia('(display-mode: standalone)').matches
            || window.navigator.standalone === true;
    }

    window.PwaInstall = { isAvailable, promptInstall, onAvailabilityChange, isStandalone };
})();
