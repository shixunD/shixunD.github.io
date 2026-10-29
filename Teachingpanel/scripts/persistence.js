// persistence.js —— 申请持久化存储 (navigator.storage.persist)，并在设置页展示状态
// 全局命名空间：window.Persistence

(function () {
    'use strict';

    let cachedStatus = null; // { persisted: boolean, usageMB: number, quotaMB: number, supported: boolean }

    async function requestPersistence() {
        if (!(navigator.storage && navigator.storage.persist)) {
            cachedStatus = { supported: false, persisted: false, usageMB: 0, quotaMB: 0 };
            return cachedStatus;
        }

        let persisted = await navigator.storage.persisted();
        if (!persisted) {
            persisted = await navigator.storage.persist();
        }

        let usageMB = 0;
        let quotaMB = 0;
        if (navigator.storage.estimate) {
            const est = await navigator.storage.estimate();
            usageMB = Math.round(((est.usage || 0) / 1024 / 1024) * 10) / 10;
            quotaMB = Math.round(((est.quota || 0) / 1024 / 1024) * 10) / 10;
        }

        cachedStatus = { supported: true, persisted, usageMB, quotaMB };
        return cachedStatus;
    }

    function getStatus() {
        return cachedStatus;
    }

    window.Persistence = { requestPersistence, getStatus };
})();
