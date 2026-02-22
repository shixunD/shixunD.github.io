// DayX Service Worker - PWA 支持
// 版本号用于缓存管理 - 构建脚本会自动替换为构建时间戳
const CACHE_NAME = 'dayx-cache-20260222064054';

// 需要缓存的关键资源（离线时使用）
const URLS_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',
    './favicon.ico',
    './styles/base.css',
    './styles/navbar.css',
    './styles/home.css',
    './styles/input.css',
    './styles/calendar.css',
    './styles/settings.css',
    './styles/toast.css',
    './styles/responsive.css',
    './scripts/app.js',
    './scripts/api.js',
    './scripts/state.js',
    './scripts/navigation.js',
    './scripts/pages/home.js',
    './scripts/pages/input.js',
    './scripts/pages/settings.js',
    './scripts/components/calendar.js',
    './scripts/components/toast.js',
    './scripts/components/yearOverview.js'
];

// 安装事件 - 预缓存资源
self.addEventListener('install', (event) => {
    console.log('[Service Worker] 安装中...', CACHE_NAME);

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[Service Worker] 预缓存应用资源');
                return cache.addAll(URLS_TO_CACHE).catch(err => {
                    console.warn('[Service Worker] 部分资源预缓存失败:', err);
                    return Promise.resolve();
                });
            })
            .then(() => {
                console.log('[Service Worker] 安装完成，立即激活');
                // 强制激活，不等待旧 Service Worker
                return self.skipWaiting();
            })
    );
});

// 激活事件 - 清理旧缓存并立即接管页面
self.addEventListener('activate', (event) => {
    console.log('[Service Worker] 激活中...');

    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((cacheName) => {
                        if (cacheName !== CACHE_NAME) {
                            console.log('[Service Worker] 删除旧缓存:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => {
                console.log('[Service Worker] 激活完成，接管所有页面');
                return self.clients.claim();
            })
    );
});

// 拦截网络请求 - Network First 策略（网络优先，离线回退缓存）
// 确保在线时始终获取最新内容，解决 GitHub Pages 更新后浏览器显示旧版本的问题
self.addEventListener('fetch', (event) => {
    // 只处理 GET 请求
    if (event.request.method !== 'GET') {
        return;
    }

    // 跳过外部请求（如 Google Fonts、Microsoft OAuth、CDN）
    const url = new URL(event.request.url);
    if (url.origin !== location.origin) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // 网络请求成功 - 更新缓存并返回最新内容
                if (response && response.status === 200) {
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return response;
            })
            .catch(() => {
                // 网络不可用 - 回退到缓存（离线模式）
                return caches.match(event.request).then((cachedResponse) => {
                    if (cachedResponse) {
                        console.log('[Service Worker] 离线模式，从缓存返回:', event.request.url);
                        return cachedResponse;
                    }
                    return new Response('Network error - offline', {
                        status: 408,
                        headers: { 'Content-Type': 'text/plain' },
                    });
                });
            })
    );
});

// 消息事件 - 支持手动缓存刷新
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        console.log('[Service Worker] 收到跳过等待消息');
        self.skipWaiting();
    }

    if (event.data && event.data.type === 'CLEAR_CACHE') {
        console.log('[Service Worker] 清除所有缓存');
        event.waitUntil(
            caches.keys().then((cacheNames) => {
                return Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
            })
        );
    }
});

console.log('[Service Worker] 脚本已加载');
