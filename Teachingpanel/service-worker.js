// 学情看板 Service Worker —— 全部资源 cache-first，是否更新由 /deploy-tag.json 判重（见 updateChecker.js）
// CACHE_NAME 不需要每次发版修改：更新时由页面发 CLEAR_CACHE 清空缓存后刷新，所有资源 cache miss 后重新拉取。
// 新增/改名文件时记得同步 URLS_TO_CACHE（否则该文件离线不可用；在线时首次请求会自动补进缓存）。
// Cache Storage 按源共享：同域名下可能还有别的 PWA，清理缓存只动 CACHE_PREFIX 开头的（本应用自己的），
// 不能 caches.keys() 全删，否则会把别的应用的离线缓存一起清掉。updateChecker.js 里有同名前缀，改名要两边同步。
// v1→v2（1.18.1）：手机拍照页以前也是缓存优先，又不经过主页的更新检测，手机上一直停在第一次缓存的旧版本；
// 改名让所有设备重装 SW、整个换掉旧缓存（activate 只删本前缀下的旧缓存）
const CACHE_PREFIX = 'teaching-panel-';
const CACHE_NAME = CACHE_PREFIX + 'cache-v2';
const DEPLOY_TAG_PATH = '/deploy-tag.json';
// 手机拍照页及其脚本走网络优先（断网才用缓存）：手机上没有「检查更新」，缓存优先会让修复永远到不了手机
const NETWORK_FIRST = /\/(phone(\.html)?|scripts\/phone\.js|scripts\/phoneConfig\.js|scripts\/vendor\/peerjs\.min\.js)$/;

const URLS_TO_CACHE = [
    './',
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
    './styles/photos.css',
    './styles/notes.css',
    './styles/trend.css',
    './styles/quickPhrases.css',
    './styles/exportReport.css',
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
    './scripts/components/studentTrend.js',
    './scripts/components/backJump.js',
    './scripts/components/svgChart.js',
    './scripts/components/cameraPicker.js',
    './scripts/components/phoneLink.js',
    './scripts/phoneConfig.js',
    './scripts/phone.js',
    './phone.html',
    './scripts/vendor/peerjs.min.js',
    './scripts/vendor/qrcode.js',
    './scripts/components/photos.js',
    './scripts/components/toast.js',
    './scripts/components/ui.js',
    './scripts/components/quickPhrases.js',
    './scripts/components/dayPicker.js',
    './scripts/components/weekPicker.js',
    './scripts/models/exams.js',
    './scripts/models/sideGroups.js',
    './scripts/models/homework.js',
    './scripts/models/recitation.js',
    './scripts/models/remarks.js',
    './scripts/models/notes.js',
    './scripts/pages/notes/editor.js',
    './scripts/pages/notes/notesPage.js',
    './scripts/onedrive/msalAuth.js',
    './scripts/vendor/msal-browser.min.js',
    './scripts/onedrive/onedriveApi.js',
    './scripts/models/scoreReport.js',
    './scripts/xlsxLite.js',
    './scripts/reportOutput.js',
    './scripts/pages/exportReport.js',
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
    './scripts/pages/trend/otherRecords.js',
    './scripts/pages/trend/trendPage.js',
    './scripts/pages/homework/homeworkPage.js',
    './scripts/pages/homework/matrix.js',
    './scripts/pages/homework/statusPicker.js',
    './scripts/pages/homework/student.js',
    './Handbook/'
];

const offlineResponse = () => new Response('Network error - offline', { status: 408, headers: { 'Content-Type': 'text/plain' } });

// 不用 cache.addAll()：它不绕过浏览器 HTTP 磁盘缓存，可能把旧文件写进 Cache Storage。
// 逐个 fetch(url, {cache:'no-store'}) 后手动 put。
async function precacheAll(cache) {
    await Promise.all(URLS_TO_CACHE.map(async (url) => {
        try {
            const response = await fetch(url, { cache: 'no-store' });
            // 被重定向过的响应（如 /index.html → /）不能缓存：用它回应页面导航会报错打不开
            if (response && response.status === 200 && !response.redirected) await cache.put(url, response);
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
            .then((names) => Promise.all(names.map((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE_NAME && caches.delete(n))))
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

    if (NETWORK_FIRST.test(url.pathname)) {
        // 页面导航要原样转发请求：phone.html 在 Cloudflare 上会 307 到 /phone，自己按 URL 重新 fetch 得到的「已跟随重定向」响应不能用来回应导航
        const fresh = event.request.mode === 'navigate' ? fetch(event.request) : fetch(event.request.url, { cache: 'no-store' });
        event.respondWith(
            fresh.then((response) => {
                if (response && response.status === 200 && !response.redirected) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
                }
                return response;
            }).catch(() => caches.match(event.request, { ignoreSearch: true }).then((cached) => cached || offlineResponse()))
        );
        return;
    }

    event.respondWith(
        caches.match(event.request, { ignoreSearch: true }).then((cached) => {
            if (cached) return cached;
            return fetch(event.request.url, { cache: 'no-store' })
                .then((response) => {
                    if (response && response.status === 200 && !response.redirected) {
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
        event.waitUntil(caches.keys().then((names) => Promise.all(names.map((n) => n.startsWith(CACHE_PREFIX) && caches.delete(n)))));
    }
});
