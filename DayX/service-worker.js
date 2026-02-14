// DayX Service Worker - PWA 支持
// 版本号用于缓存管理
const CACHE_NAME = 'dayx-cache-v1.3.14';

// 需要缓存的关键资源
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/styles/base.css',
  '/styles/navbar.css',
  '/styles/home.css',
  '/styles/input.css',
  '/styles/calendar.css',
  '/styles/settings.css',
  '/styles/toast.css',
  '/styles/responsive.css',
  '/scripts/app.js',
  '/scripts/api.js',
  '/scripts/state.js',
  '/scripts/navigation.js',
  '/scripts/pages/home.js',
  '/scripts/pages/input.js',
  '/scripts/pages/settings.js',
  '/scripts/components/calendar.js',
  '/scripts/components/toast.js',
  '/scripts/components/yearOverview.js'
];

// 安装事件 - 缓存资源
self.addEventListener('install', (event) => {
  console.log('[Service Worker] 安装中...', CACHE_NAME);
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] 缓存应用资源');
        // 使用 addAll 批量缓存，失败时继续
        return cache.addAll(URLS_TO_CACHE).catch(err => {
          console.warn('[Service Worker] 部分资源缓存失败:', err);
          // 即使部分失败也继续安装
          return Promise.resolve();
        });
      })
      .then(() => {
        console.log('[Service Worker] 安装完成');
        // 强制激活，不等待旧 Service Worker
        return self.skipWaiting();
      })
  );
});

// 激活事件 - 清理旧缓存
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] 激活中...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            // 删除旧版本缓存
            if (cacheName !== CACHE_NAME) {
              console.log('[Service Worker] 删除旧缓存:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('[Service Worker] 激活完成');
        // 立即控制所有页面
        return self.clients.claim();
      })
  );
});

// 拦截网络请求 - 缓存优先策略（Cache First）
self.addEventListener('fetch', (event) => {
  // 只处理 GET 请求
  if (event.request.method !== 'GET') {
    return;
  }

  // 跳过外部请求（如 Google Fonts、Microsoft OAuth）
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // 缓存命中，返回缓存
        if (response) {
          // console.log('[Service Worker] 从缓存返回:', event.request.url);
          return response;
        }

        // 缓存未命中，发起网络请求
        // console.log('[Service Worker] 网络请求:', event.request.url);
        return fetch(event.request).then((response) => {
          // 检查响应有效性
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }

          // 克隆响应（因为响应流只能读一次）
          const responseToCache = response.clone();

          // 将新资源添加到缓存
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });

          return response;
        }).catch((error) => {
          console.warn('[Service Worker] 网络请求失败:', event.request.url, error);
          // 可以返回一个离线页面
          return new Response('Network error', {
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
