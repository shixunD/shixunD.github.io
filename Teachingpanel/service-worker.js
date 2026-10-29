// 学情看板 Service Worker —— 全部资源 cache-first，是否更新由 /deploy-tag.json 判重（见 updateChecker.js）
// CACHE_NAME 不需要每次发版修改：更新时由页面发 CLEAR_CACHE 清空缓存后刷新，所有资源 cache miss 后重新拉取。
// 新增/改名文件时记得同步 URLS_TO_CACHE（否则该文件离线不可用；在线时首次请求会自动补进缓存）。
const CACHE_NAME = 'teaching-panel-cache-v1';
const DEPLOY_TAG_PATH = '/deploy-tag.json';

const URLS_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',
    './version.json',
    './icon.png',
    './icon-192.png',
    './styles/base.css',
    './styles/board.css',
    './styles/charts.css',
    './styles/layout.css',
    './styles/navbar.css',
    './styles/onedrive.css',
    './styles/profile.css',
    './styles/quickPhrases.css',
    './styles/dayPicker.css',
    './styles/recitation.css',
    './styles/responsive.css',
    './styles/settings.css',
    './styles/update.css',
    './scripts/app.js',
    './scripts/dbFile.js',
    './scripts/importExport.js',
    './scripts/vendor/sql-wasm.js',
    './scripts/vendor/sql-wasm.wasm',
    './scripts/navigation.js',
    './scripts/persistence.js',
    './scripts/pwaInstall.js',
    './scripts/reminders.js',
    './scripts/state.js',
    './scripts/updateChecker.js',
    './scripts/utils.js',
    './scripts/components/classSwitcher.js',
    './scripts/components/modal.js',
    './scripts/components/studentProfile.js',
    './scripts/components/svgChart.js',
    './scripts/components/toast.js',
    './scripts/components/ui.js',
    './scripts/components/quickPhrases.js',
    './scripts/components/dayPicker.js',
    './scripts/models/exams.js',
    './scripts/models/homework.js',
    './scripts/models/recitation.js',
    './scripts/onedrive/msalAuth.js',
    './scripts/onedrive/onedriveApi.js',
    './scripts/pages/roster.js',
    './scripts/pages/settings.js',
    './scripts/pages/recitation/checkDialog.js',
    './scripts/pages/recitation/overview.js',
    './scripts/pages/recitation/recitationPage.js',
    './scripts/pages/recitation/planView.js',
    './scripts/pages/recitation/student.js',
    './scripts/pages/exams/examDialogs.js',
    './scripts/pages/exams/examStudent.js',
    './scripts/pages/exams/examsPage.js',
    './scripts/pages/homework/homeworkPage.js',
    './scripts/pages/homework/matrix.js',
    './scripts/pages/homework/statusPicker.js',
    './scripts/pages/homework/student.js',
    './Handbook/index.html'
];

const offlineResponse = () => new Response('Network error - offline', { status: 408, headers: { 'Content-Type': 'text/plain' } });

// 不用 cache.addAll()：它不绕过浏览器 HTTP 磁盘缓存，可能把旧文件写进 Cache Storage。
// 逐个 fetch(url, {cache:'no-store'}) 后手动 put。
async function precacheAll(cache) {
    await Promise.all(URLS_TO_CACHE.map(async (url) => {
        try {
            const response = await fetch(url, { cache: 'no-store' });
            if (response && response.status === 200) await cache.put(url, response);
        } catch (err) {
            console.warn('[SW] 预缓存失败:', url, err);
        }
    }));
}

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then(precacheAll).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(names.map((n) => n !== CACHE_NAME && caches.delete(n))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    if (url.origin !== location.origin) return;

    // 判重信号必须永远走网络，不能被它要判断"该不该清空"的缓存缓存住
    if (url.pathname === DEPLOY_TAG_PATH) {
        event.respondWith(fetch(event.request.url, { cache: 'no-store' }).catch(() => offlineResponse()));
        return;
    }

    event.respondWith(
        caches.match(event.request, { ignoreSearch: true }).then((cached) => {
            if (cached) return cached;
            return fetch(event.request.url, { cache: 'no-store' })
                .then((response) => {
                    if (response && response.status === 200) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
                    }
                    return response;
                })
                .catch(() => offlineResponse());
        })
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
    if (event.data && event.data.type === 'CLEAR_CACHE') {
        event.waitUntil(caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n)))));
    }
});
