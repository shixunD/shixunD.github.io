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
    './scripts/pages/wheel.js',
    './scripts/pages/roster.js',
    './scripts/pages/settings.js',
    './scripts/app.js',
    './backgroundmusic/spin/mixkit-arcade-rising-231.wav',
    './backgroundmusic/spin/mixkit-casino-reward-1980.wav',
    './backgroundmusic/spin/mixkit-fast-bike-wheel-spin-1614.wav',
    './backgroundmusic/spin/mixkit-game-engine-hum-2644.wav',
    './backgroundmusic/spin/mixkit-payout-award-1934.wav',
    './backgroundmusic/spin/mixkit-slot-machine-win-1928.wav',
    './backgroundmusic/spin/mixkit-slot-machine-win-alarm-1995.wav',
    './backgroundmusic/spin/mixkit-spinning-whistle-toy-2647.wav',
    './backgroundmusic/win/mixkit-animated-small-group-applause-523.wav',
    './backgroundmusic/win/mixkit-ethereal-fairy-win-sound-2019.wav',
    './backgroundmusic/win/mixkit-male-voice-cheer-2010.wav',
    './backgroundmusic/win/mixkit-male-voice-cheer-victory-2011.wav',
    './backgroundmusic/win/mixkit-small-group-light-applause-517.wav',
    './backgroundmusic/win/mixkit-small-win-2020.wav',
    './backgroundmusic/win/mixkit-video-game-win-2016.wav',
    './backgroundmusic/win/mixkit-wind-chimes-2014.wav'
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

// network-first：在线时始终拿最新资源并更新缓存，离线时回退缓存
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);
    if (url.origin !== location.origin) return;

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
