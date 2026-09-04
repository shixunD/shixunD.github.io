// 抽奖点名机 Service Worker - PWA 离线支持，全部资源统一走 cache-first
// CACHE_NAME 不需要每次发版手动改了——判重和"要不要拉新资源"完全交给 updateChecker.js
// （比较 deploy-tag.json 的内容，见该文件顶部注释），用户点"完成更新"时会显式发 CLEAR_CACHE
// 消息，不依赖 CACHE_NAME 变化来触发清理。这个值固定不变即可。
// 注意 CLEAR_CACHE 不是无脑清空整个缓存桶——音效素材（backgroundmusic/）走按"文件名+字节数"
// 核对 manifest 的选择性清理，没变过的音效不会被清掉、也就不会被重新下载，见 smartClearCache()。
const CACHE_NAME = 'lottery-cache-v1';

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

// **不用 cache.addAll(URLS_TO_CACHE) 的便捷写法，改成逐个 fetch(url, {cache:'no-store'}) 再手动
// cache.put()**——这是真实踩过的坑：cache.addAll() 内部发起的请求不会绕过浏览器自身的 HTTP 磁盘
// 缓存，如果某个文件之前被普通方式请求过、还在浏览器 HTTP 缓存的新鲜期内，addAll() 会直接拿浏览器
// 缓存里的旧内容去写入 Cache Storage——预缓存阶段本该拿到最新代码，结果缓存进去的是旧版本，之后
// 全部走 cache-first 也就一直用着这份旧代码，跟"改了文件却没生效"表现一模一样，非常隐蔽。显式加
// cache:'no-store' 强制每个文件都发真实网络请求，从根源杜绝这个问题。
async function precacheAll(cache) {
    await Promise.all(URLS_TO_CACHE.map(async (url) => {
        try {
            const response = await fetch(url, { cache: 'no-store' });
            if (response && response.status === 200) {
                await cache.put(url, response);
            }
        } catch (err) {
            console.warn('[SW] 预缓存失败:', url, err);
        }
    }));
}

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => precacheAll(cache))
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

// 全部同源 GET 请求统一走 cache-first：命中缓存就直接用，完全不发网络请求（音频/JS/CSS/HTML/
// 图标等等全部一视同仁，不再区分"大文件走 cache-first、代码文件走 network-first"）。
// 这套策略下"要不要重新下载"完全不看文件类型，只看 updateChecker.js 有没有检测到 deploy-tag.json
// 变化——检测到变化、用户点"完成更新"后会显式发 CLEAR_CACHE 消息清空所有缓存桶，刷新后 cache miss
// 触发重新下载，重新写入缓存；平时没有新部署的时候，一次网络请求都不用发，比 network-first 更快、
// 更省流量。**不要再指望靠"改 CACHE_NAME"来触发更新**——判重和清缓存都已经交给 updateChecker.js，
// CACHE_NAME 保持不变即可（见文件顶部注释）。
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);
    if (url.origin !== location.origin) return;

    // /deploy-tag.json 是 updateChecker.js 用来判断"有没有新部署"的信号文件，必须永远绕过缓存、
    // 直接走网络——如果也走 cache-first，它自己会在第一次被请求时就被写进缓存，之后所有判重请求
    // 都只会读到那份第一次缓存下来的旧内容，永远检测不到后续的真实变化，整个更新机制会失效。
    // 这个文件本身也不需要被存进 Cache Storage（内容本来就该常变，缓存了也没有意义）。
    if (url.pathname === '/deploy-tag.json') {
        event.respondWith(
            fetch(event.request.url, { cache: 'no-store' }).catch(() => new Response('Network error - offline', {
                status: 408,
                headers: { 'Content-Type': 'text/plain' }
            }))
        );
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached; // 缓存命中，不发任何网络请求
            // 缓存未命中时的兜底请求同样要加 cache:'no-store'（原因见 precacheAll 的注释）——
            // 否则第一次把这个文件写进 Cache Storage 时，也可能不小心存进浏览器 HTTP 缓存里的旧内容
            return fetch(event.request.url, { cache: 'no-store' })
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
});

// backgroundmusic/ 下的音效文件体积远大于 js/css/html（几十 KB 到 1MB+），大部分发版根本没碰过
// 音效素材，"完成更新"时如果照旧无脑清空整个缓存桶，会导致这批用户根本没变过的大文件也被强制
// 重新下载一遍，纯粹浪费流量。所以音效走独立的"按名字+大小核对"逻辑，其它文件（js/css/html/图标等，
// 单个体积小，改没改都无所谓重新拉一次）依然维持"直接清掉，下次 cache miss 自动重新下载"的老逻辑。
const MEDIA_PATH_SEGMENT = '/backgroundmusic/';
const MEDIA_MANIFEST_URL = './backgroundmusic/manifest.json';

// 把请求 URL 换算成 manifest.json 里用的 key（"backgroundmusic/xxx/yyy.wav"，与
// generateMediaManifest.js 生成的 key 拼法保持一致）
function mediaKeyFromUrl(url) {
    const idx = url.pathname.indexOf(MEDIA_PATH_SEGMENT);
    if (idx === -1) return null;
    return 'backgroundmusic/' + decodeURIComponent(url.pathname.slice(idx + MEDIA_PATH_SEGMENT.length));
}

async function smartClearCache() {
    const cache = await caches.open(CACHE_NAME);
    const requests = await cache.keys();

    // manifest 本身必须绕过缓存直接拿网络最新版本，否则拿到的还是上一次部署时的旧清单，
    // 核对出来的结果就完全不可信了
    let manifest = null;
    try {
        const res = await fetch(MEDIA_MANIFEST_URL, { cache: 'no-store' });
        if (res.ok) manifest = await res.json();
    } catch (e) {
        manifest = null; // 拿不到 manifest（离线/文件不存在）：走下面的保守兜底，音效按老逻辑清掉
    }

    await Promise.all(requests.map(async (req) => {
        const url = new URL(req.url);
        const mediaKey = mediaKeyFromUrl(url);

        if (mediaKey === null) {
            await cache.delete(req); // 非音效文件：维持老逻辑，直接清掉，下次 cache miss 自动重新下载
            return;
        }

        if (!manifest || !(mediaKey in manifest)) {
            // manifest 拿不到，或者这个文件已经不在 manifest 里了（被删除/改名）：
            // 保守起见清掉——拿不到 manifest 时没法判断"是不是没变"，清掉重新下载才安全
            await cache.delete(req);
            return;
        }

        const cachedRes = await cache.match(req);
        const cachedBlob = await cachedRes.clone().blob();
        if (cachedBlob.size !== manifest[mediaKey]) {
            await cache.delete(req); // 大小对不上，说明内容换了，删掉强制重新下载
        }
        // 名字和大小都对得上：什么都不做，保留这份缓存，不重新下载
    }));
}

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    if (event.data && event.data.type === 'CLEAR_CACHE') {
        event.waitUntil(smartClearCache());
    }
});
