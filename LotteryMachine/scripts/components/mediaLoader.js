// mediaLoader.js —— 启动蒙版：全部音效素材确认写入缓存之前，遮住整个页面不让用户操作
// 全局命名空间：window.MediaLoader
//
// 为什么需要这一层，而不是只靠 soundEffects.js 里的后台预加载（warmUp）：后台预加载不会阻塞用户
// 点"开始抽奖"，如果这时候素材还没下载完，播放逻辑里临时等 loadedmetadata 就会出现"延迟/播放不完整"
// （见 PROJECT.md 抽奖音效小节的踩坑记录）。这里用一个强制蒙版把"能不能开始用"和"素材是否就绪"绑死，
// 从产品体验上彻底避免这个时序问题——代价是首次/缓存失效后的启动会多等一下，用进度条把这个等待过程
// 显式呈现出来，而不是让用户在不知情的情况下点"抽奖"却听不到完整音效。
//
// **蒙版消失的唯一条件是：清单里每一个文件都已经确认躺在 Cache Storage 里。** 没有"到点强制放行"
// 的固定超时——那是真实踩过的坑：16 个 wav 合计十几 MB，真实网络下经常超过原来的 15 秒硬超时，
// 一到点蒙版就把进度条拉到 100% 然后消失，其实文件还在后台下；用户这时候刷新，正在下载的请求全部
// 被中断，只有已经写完缓存的那几个留下来，下次进来就从 50% 左右重新走——表现就是"显示 100% 了
// 过一会儿又从一半开始、要进好几次才真正下完"。现在只保留两个逃生口：网络长时间零进度时提示，
// 以及用户自己点"跳过等待"。

(function () {
    'use strict';

    // 必须和 service-worker.js 里的 CACHE_NAME 保持一致——这里不经过 SW 拦截，直接用 Cache API
    // 读写同一个缓存桶（Cache Storage 在 window/SW 两侧是同一份数据，不需要 SW 参与也能读写）。
    const CACHE_NAME = 'lottery-cache-v1';

    // **这里没有硬编码文件数量或路径**：清单和每个文件的字节数都来自 backgroundmusic/manifest.json
    // （通过 SoundEffects.loadFileList() 读取，见 soundEffects.js 顶部关于"为什么不手写数组"的踩坑记录）。
    // 往 backgroundmusic/spin 或 win 目录加/删素材后只要跑一次 node scripts/generateMediaManifest.js，
    // 这里的进度计算、完整性校验都不需要跟着改一行代码，新文件会自动被算进总进度、下载完才放行。

    // 单个文件一轮里的重试次数；一轮跑完还有文件没进缓存的话，外层会隔 ROUND_RETRY_DELAY_MS 再来一轮，
    // 直到全部就绪或用户主动跳过——"确保全部正确加载"不能靠有限次数就放弃。
    const MAX_ATTEMPTS_PER_FILE = 3;
    const RETRY_BACKOFF_MS = 400;
    const ROUND_RETRY_DELAY_MS = 2000;

    // 连续这么久一个字节都没收到，判定网络不通/被卡住：不自动放行，只把提示文案和"跳过"入口亮出来，
    // 让用户自己决定；网络一恢复、字节继续到达，文案会自动改回正常
    const STALL_TIMEOUT_MS = 20000;
    // 加载较慢时才出现"跳过等待"链接，正常几秒内完成不会看到这个入口，不干扰大多数用户
    const SKIP_LINK_DELAY_MS = 8000;

    function els() {
        return {
            overlay: document.getElementById('media-loader-overlay'),
            fill: document.getElementById('media-loader-progress-fill'),
            percent: document.getElementById('media-loader-percent'),
            text: document.getElementById('media-loader-text'),
            skip: document.getElementById('media-loader-skip')
        };
    }

    function formatMB(bytes) {
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function setProgress(loadedBytes, totalBytes) {
        const { fill, percent } = els();
        const ratio = totalBytes > 0 ? Math.max(0, Math.min(1, loadedBytes / totalBytes)) : 0;
        const pct = Math.floor(ratio * 100); // 向下取整：没真正全部完成之前绝不显示 100%
        if (fill) fill.style.width = pct + '%';
        if (percent) {
            percent.textContent = totalBytes > 0
                ? pct + '%（' + formatMB(loadedBytes) + ' / ' + formatMB(totalBytes) + '）'
                : pct + '%';
        }
    }

    function setText(message) {
        const { text } = els();
        if (text) text.textContent = message;
    }

    let dismissed = false;
    function dismiss(message) {
        if (dismissed) return;
        dismissed = true;
        const { overlay, fill, percent } = els();
        if (!overlay) return;
        if (message) setText(message);
        if (fill) fill.style.width = '100%';
        if (percent) percent.textContent = '100%';
        setTimeout(() => {
            overlay.classList.add('media-loader-hidden');
            setTimeout(() => overlay.remove(), 400); // 等淡出动画播完再从 DOM 里移除，避免闪烁
        }, message ? 400 : 0); // 有提示文案时留一点时间让用户看清再消失
    }

    // 缓存里已有的文件优先读响应头里的 Content-Length（不用把十几 MB 的 blob 全读进内存），
    // 没有的再退化成读 blob.size
    async function cachedSize(cache, src) {
        const cached = await cache.match(src);
        if (!cached) return null;
        const len = Number(cached.headers.get('content-length')) || 0;
        if (len > 0) return len;
        const blob = await cached.clone().blob();
        return blob.size;
    }

    // 进度条分母必须在开始下载之前就定死：浏览器对同一个源的并发连接数有上限（常见 6 条），
    // 十几个文件不会真的同时开工，如果边下边把响应头到达的文件大小累加进分母，前几个文件下完时
    // 分母只有它们几个、比例冲到 100%，剩下的文件轮到连接才开始，分母突然变大、比例又掉回去。
    // manifest 里已经记录了每个文件的字节数，直接拿来当分母；manifest 里没写大小的（理论上不会有）
    // 才退化成发一次 HEAD 去问。HEAD 不会被 service-worker.js 拦截（它只处理 GET），是真实的轻量请求。
    //
    // "已缓存"的判定跟 service-worker.js 的 smartClearCache() 用同一套标准：缓存里有、而且字节数
    // 和 manifest 一致才算；大小对不上（文件被替换过、或上次下载中途被刷新掐断留下的残缺条目）
    // 一律当没缓存，重新下载覆盖。
    async function probeFile(cache, src, expectedSize) {
        const size = await cachedSize(cache, src);
        if (size !== null && (!expectedSize || size === expectedSize)) return { size, cached: true };
        if (expectedSize) return { size: expectedSize, cached: false };
        try {
            const res = await fetch(src, { method: 'HEAD', cache: 'no-store' });
            return { size: Number(res.headers.get('content-length')) || 0, cached: false };
        } catch (e) {
            return { size: 0, cached: false }; // 探测失败不阻塞：下载阶段自己会重试
        }
    }

    // 单个文件的下载：逐块读取正文汇报进度，读完后显式 await cache.put() 写进 Cache Storage——
    // 不依赖 service-worker.js 的 fetch 事件顺带缓存，那条路径是 fire-and-forget（没 await 就把
    // 响应还给页面），页面这边看到"下完了"时缓存可能还没写完，紧接着点"开始抽奖"会命中不了缓存。
    // 返回 true 表示已确认写入缓存；false 表示这轮失败（网络错误/中途断流），由外层决定再来一轮。
    // 4xx（文件根本不存在）单独返回 'missing'：这种重试多少次都没用，不能让它把所有用户永远堵在蒙版后面。
    async function loadOneFile(cache, src, onBytes) {
        for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_FILE; attempt++) {
            if (attempt > 1) await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * (attempt - 1)));
            let response;
            try {
                response = await fetch(src, { cache: 'no-store' });
            } catch (e) {
                continue;
            }
            if (response.status >= 400 && response.status < 500) {
                console.warn('[MediaLoader] 素材不存在（' + response.status + '）:', src);
                return 'missing';
            }
            if (!response.ok) continue;

            // 先 clone 一份专门喂给 cache.put，原始 response 留给下面的 reader 读进度——两份读的是
            // 同一个底层流的独立副本，互不影响
            const toCache = response.clone();
            let thisAttemptBytes = 0; // 这次尝试已报给 onBytes 的字节数，中途失败要整体退回去，避免污染总进度
            try {
                if (response.body) {
                    const reader = response.body.getReader();
                    for (;;) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        thisAttemptBytes += value.byteLength;
                        onBytes(value.byteLength);
                    }
                } else {
                    await response.arrayBuffer();
                }
                await cache.put(src, toCache);
                return true;
            } catch (e) {
                onBytes(-thisAttemptBytes);
                console.warn('[MediaLoader] 素材下载/写缓存失败，将重试:', src, e);
            }
        }
        return false;
    }

    async function run() {
        const { overlay, skip } = els();
        if (!overlay) return; // 没有这个蒙版容器（比如页面结构被改过），直接跳过，不影响主流程

        const skipTimer = setTimeout(() => {
            if (skip) skip.classList.add('media-loader-skip-visible');
        }, SKIP_LINK_DELAY_MS);
        if (skip) skip.addEventListener('click', () => dismiss('已跳过等待，音效可能要稍后才能正常播放'), { once: true });

        // 先拿清单：没有清单就不知道要下什么，只能放行（离线且从没缓存过的极端情况）
        const sizes = window.SoundEffects && typeof SoundEffects.loadFileList === 'function'
            ? await SoundEffects.loadFileList()
            : null;
        if (!sizes) { dismiss('音效清单加载失败，先带你进入应用'); return; }
        const FILES = Object.keys(sizes);
        if (!FILES.length) { dismiss(); return; }

        const cache = await caches.open(CACHE_NAME);

        // 第一阶段：确定每个文件的大小和是否已在缓存里，算出固定不变的总字节数
        const probes = await Promise.all(FILES.map((src) => probeFile(cache, src, sizes[src])));
        const totalBytes = probes.reduce((a, p) => a + p.size, 0);
        const loaded = probes.map((p) => (p.cached ? p.size : 0));
        const status = probes.map((p) => (p.cached ? true : false)); // true=已在缓存, false=待下载, 'missing'=服务器上不存在
        const mismatches = new Array(FILES.length).fill(0);

        // 零进度看门狗：每收到一块字节就重置；连续 STALL_TIMEOUT_MS 没动静才提示（不放行）
        let stallTimer = null;
        let stalled = false;
        function armStallTimer() {
            clearTimeout(stallTimer);
            stallTimer = setTimeout(() => {
                stalled = true;
                setText('网络似乎不太通畅，仍在等待素材下载…');
                if (skip) skip.classList.add('media-loader-skip-visible');
            }, STALL_TIMEOUT_MS);
        }
        function recompute() {
            setProgress(loaded.reduce((a, b) => a + b, 0), totalBytes);
        }
        function onBytes(i, chunkBytes) {
            loaded[i] += chunkBytes;
            recompute();
            if (chunkBytes > 0) {
                if (stalled) { stalled = false; setText('正在加载媒体文件…'); }
                armStallTimer();
            }
        }

        recompute();
        armStallTimer();

        // 第二阶段：一轮一轮地下载，直到清单里每个文件都确认在缓存里（或被判定为服务器上不存在）
        for (;;) {
            if (dismissed) return; // 用户点了"跳过"，后面的轮次没必要再跑
            const pending = [];
            FILES.forEach((src, i) => { if (status[i] === false) pending.push(i); });
            if (!pending.length) break;

            await Promise.all(pending.map(async (i) => {
                loaded[i] = 0;
                const result = await loadOneFile(cache, FILES[i], (bytes) => onBytes(i, bytes));
                if (result === true) {
                    // 下载完再对一次账：缓存里的字节数必须和 manifest 一致，否则当没下成功、下一轮重来
                    // （防止残缺/被截断的响应被当成完整文件放行）
                    const size = await cachedSize(cache, FILES[i]);
                    const expected = sizes[FILES[i]];
                    if (size === null || (expected && size !== expected && mismatches[i] < 1)) {
                        // 只重下一次：第二次还是同样对不上，说明是 manifest 忘了重新生成（清单里的
                        // 大小过期），而不是下载残缺，这时接受下载到的完整文件，不能无限重下把用户堵死
                        mismatches[i]++;
                        console.warn('[MediaLoader] 缓存大小与清单不符，将重新下载:', FILES[i], size, expected);
                        await cache.delete(FILES[i]).catch(() => {});
                        loaded[i] = 0;
                        status[i] = false;
                    } else {
                        loaded[i] = size;
                        status[i] = true;
                    }
                } else if (result === 'missing') {
                    status[i] = 'missing';
                    loaded[i] = probes[i].size; // 不存在的文件从待办里划掉，不让进度条永远差一截
                } else {
                    status[i] = false; // 这轮没成功，下一轮再来
                }
                recompute();
            }));

            const stillPending = status.some((s) => s === false);
            if (stillPending && !dismissed) {
                setText('部分素材下载失败，正在重试…');
                await new Promise((r) => setTimeout(r, ROUND_RETRY_DELAY_MS));
            }
        }

        clearTimeout(stallTimer);
        clearTimeout(skipTimer);

        // 到这里清单里每个文件要么已确认在缓存里、要么服务器上确实没有。接着让 soundEffects.js
        // 直接从这个 cache 里把 blob 读出来建好随时可播的 Audio 元素，**await 它就绪后再撤蒙版**——
        // 播放路径从此完全不经过 Service Worker/网络（首次访问时 SW 还没接管页面，走网络会再下一遍，
        // 见 soundEffects.js 里的踩坑记录），蒙版消失那一刻点"开始抽奖"就能立刻出声
        if (window.SoundEffects && typeof SoundEffects.warmUp === 'function') {
            setText('正在准备音效…');
            await SoundEffects.warmUp(FILES.filter((src, i) => status[i] === true), cache);
        }

        const missingCount = status.filter((s) => s === 'missing').length;
        dismiss(missingCount ? missingCount + ' 个音效素材在服务器上不存在，已跳过' : undefined);
    }

    window.MediaLoader = { run };
})();
