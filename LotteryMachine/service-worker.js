// 抽奖点名机 Service Worker - PWA 离线支持 + network-first 缓存策略
// CACHE_NAME 每次发版时手动改一下（随便改，只要和上一个不同即可），用于清理旧缓存
const CACHE_NAME = 'lottery-cache-20260904120000';

const URLS_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',
    './icon.png',
    './icon-192.png',
    './styles/base.css',
    './styles/navbar.css',
    './styles/wheel.css',
    './styles/winnerEffects.css',
    './styles/roster.css',
    './styles/settings.css',
    './styles/onedrive.css',
    './styles/update.css',
    './styles/classSwitcher.css',
    './styles/drawHistory.css',
    './styles/responsive.css',
    './styles/mediaLoader.css',
    './scripts/shortcutUtil.js',
    './scripts/state.js',
    './scripts/navigation.js',
    './scripts/updateChecker.js',
    './scripts/persistence.js',
    './scripts/importExport.js',
    './scripts/pwaInstall.js',
    './scripts/onedrive/msalAuth.js',
    './scripts/onedrive/onedriveApi.js',
    './scripts/components/toast.js',
    './scripts/components/modal.js',
    './scripts/components/imageCropper.js',
    './scripts/components/classSwitcher.js',
    './scripts/components/drawHistory.js',
    './scripts/components/winnerEffects.js',
    './scripts/components/soundEffects.js',
    './scripts/components/mediaLoader.js',
    './scripts/pages/wheel.js',
    './scripts/pages/roster.js',
    './scripts/pages/settings.js',
    './scripts/app.js'
    // 注意：backgroundmusic/ 下的音效文件故意不放进这个预缓存列表——它们现在由
    // scripts/components/mediaLoader.js 在页面启动时单独 fetch 加载（带进度条的启动蒙版）。
    // 如果这里也列出同一批文件，install 阶段的 cache.addAll() 会和 mediaLoader.js 的 fetch
    // 在冷启动时**同时**各发一遍请求，16 个文件变成 32 个并发请求抢同一批连接/带宽，
    // 实测在连接数有限的环境下（比如本地单线程调试服务器）会导致蒙版长时间卡在 0% 不动——
    // 这是真实复现过的问题。音效文件最终还是会被缓存：mediaLoader.js 发起的 fetch 同样会
    // 经过下面 fetch 事件里的 cache-first 分支，缓存未命中时自动写入 Cache Storage，不需要
    // 在这里重复声明。
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(URLS_TO_CACHE).catch((err) => {
                console.warn('[SW] 部分资源预缓存失败:', err);
            }))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => Promise.all(
                cacheNames.map((name) => {
                    if (name !== CACHE_NAME) return caches.delete(name);
                })
            ))
            .then(() => self.clients.claim())
    );
});

// 大体积、几乎不会频繁变动的静态素材（目前只有音效）：命中缓存就直接用，完全不发网络请求——
// 不这么做的话，音效这种几百 KB～1.6MB 的文件会在每次打开页面时被 network-first 策略重新下载一遍，
// 流量/加载体验都不划算。**这类资源"多久能看到最新版"完全依赖发版时手动改的 CACHE_NAME**：
// CACHE_NAME 一变，activate 阶段会删掉旧缓存，下次访问触发 install 重新预缓存 URLS_TO_CACHE，
// 新增/替换过的素材自然会被重新拉取；不改 CACHE_NAME 就不会重新下载，所以新增音效后**必须**照
// PROJECT.md 第六节的发版清单把 CACHE_NAME、version.json 都改一遍，否则用户会一直用着旧缓存里的素材。
const CACHE_FIRST_PATTERNS = [/\/backgroundmusic\//];
function isCacheFirst(pathname) {
    return CACHE_FIRST_PATTERNS.some((re) => re.test(pathname));
}

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);
    if (url.origin !== location.origin) return;

    if (isCacheFirst(url.pathname)) {
        event.respondWith(
            caches.match(event.request).then((cached) => {
                if (cached) return cached; // 缓存命中，不发任何网络请求
                return fetch(event.request.url)
                    .then((response) => {
                        if (response && response.status === 200) {
                            const clone = response.clone();
                            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                        }
                        return response;
                    })
                    .catch(() => new Response('Network error - offline', {
                        status: 408,
                        headers: { 'Content-Type': 'text/plain' }
                    }));
            })
        );
        return;
    }

    // 其余资源（代码/样式/HTML/version.json 等）维持 network-first：在线时始终拿最新资源并更新
    // 缓存，离线时回退缓存。这些文件体积小、又直接决定"用户是否看到最新版本/最新更新提示"，
    // 不适合像音效那样长期缓存。
    event.respondWith(
        // cache: 'no-store' 显式绕过浏览器自身的 HTTP 缓存（GitHub Pages 等静态托管
        // 通常会给文件加较长的 Cache-Control，普通 fetch(event.request) 在缓存未过期时
        // 会直接复用浏览器磁盘缓存而不是真正发请求，导致"network-first"名不副实、
        // 用户看不到最新版本。用 URL 字符串发起请求可以避免 navigate 等特殊请求模式
        // 在被重新构造为 Request 时报错。
        fetch(event.request.url, { cache: 'no-store' })
            .then((response) => {
                if (response && response.status === 200) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                }
                return response;
            })
            .catch(() => caches.match(event.request).then((cached) => {
                if (cached) return cached;
                return new Response('Network error - offline', {
                    status: 408,
                    headers: { 'Content-Type': 'text/plain' }
                });
            }))
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    if (event.data && event.data.type === 'CLEAR_CACHE') {
        event.waitUntil(
            caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n))))
        );
    }
});
