// mediaLoader.js —— 启动蒙版：下载/命中缓存全部音效素材前，遮住整个页面不让用户操作
// 全局命名空间：window.MediaLoader
//
// 为什么需要这一层，而不是只靠 soundEffects.js 里的后台预加载（warmUp）：后台预加载不会阻塞用户
// 点"开始抽奖"，如果这时候素材还没下载完，播放逻辑里临时等 loadedmetadata 就会出现"延迟/播放不完整"
// （见 PROJECT.md 抽奖音效小节的踩坑记录）。这里用一个强制蒙版把"能不能开始用"和"素材是否就绪"绑死，
// 从产品体验上彻底避免这个时序问题——代价是首次/缓存失效后的启动会多等一下，用进度条把这个等待过程
// 显式呈现出来，而不是让用户在不知情的情况下点"抽奖"却听不到完整音效。

(function () {
    'use strict';

    // 必须和 service-worker.js 里的 CACHE_NAME 保持一致——这里不经过 SW 拦截，直接用 Cache API
    // 读写同一个缓存桶（Cache Storage 在 window/SW 两侧是同一份数据，不需要 SW 参与也能读写）。
    // 这样做的原因见下面 run() 里的说明：不能依赖"SW 是否已经接管这个页面"这种时序不确定的条件。
    const CACHE_NAME = 'lottery-cache-v1';

    // 素材实际下载走 fetch()，命中过缓存的文件直接从 Cache Storage 读，不用真的发网络请求——
    // 所以老用户重新打开时这个蒙版通常只会一闪而过，不是每次都要等真下载。
    //
    // **这里没有硬编码文件数量或路径**，全部从 SoundEffects.SPIN_FILES/WIN_FILES 这两个数组读——
    // 以后往那两个数组里加新素材（同时把文件放进 backgroundmusic/spin 或 win 目录），这里、
    // 下面的进度计算、Promise.all 都不需要跟着改一行代码，新文件会自动被算进总进度、下载完才放行。
    const FILES = [].concat(
        (window.SoundEffects && SoundEffects.SPIN_FILES) || [],
        (window.SoundEffects && SoundEffects.WIN_FILES) || []
    );

    // 单个文件下载失败时的重试次数（1 次首发 + 最多 2 次重试 = 最多 3 次尝试）：网络抖动这种瞬时故障
    // 重试基本就能过，"确保全部正确加载"不能只靠一次 fetch 失败就放弃——但也不能无限重试，
    // 真正离线/资源不存在时还是要交给下面的 HARD_TIMEOUT_MS 兜底放行，不能让重试本身变成新的卡死点。
    const MAX_ATTEMPTS_PER_FILE = 3;
    const RETRY_BACKOFF_MS = 400; // 每次重试间隔线性递增（400ms、800ms），不做指数级是因为本来就只重试 2 次

    // 素材加载失败/网络异常时的安全网：不能让用户永远卡在蒙版后面进不去（客服噩梦），
    // 超过这个时长强制放行，同时给一条降级提示
    const HARD_TIMEOUT_MS = 15000;
    // 加载较慢时才出现"跳过等待"链接，正常几百毫秒内完成不会看到这个入口，不干扰大多数用户
    const SKIP_LINK_DELAY_MS = 4000;

    function els() {
        return {
            overlay: document.getElementById('media-loader-overlay'),
            fill: document.getElementById('media-loader-progress-fill'),
            percent: document.getElementById('media-loader-percent'),
            text: document.getElementById('media-loader-text'),
            skip: document.getElementById('media-loader-skip')
        };
    }

    function setProgress(ratio) {
        const { fill, percent } = els();
        const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
        if (fill) fill.style.width = pct + '%';
        if (percent) percent.textContent = pct + '%';
    }

    let dismissed = false;
    function dismiss(message) {
        if (dismissed) return;
        dismissed = true;
        const { overlay, text } = els();
        if (!overlay) return;
        if (message && text) text.textContent = message;
        setProgress(1);
        setTimeout(() => {
            overlay.classList.add('media-loader-hidden');
            setTimeout(() => overlay.remove(), 400); // 等淡出动画播完再从 DOM 里移除，避免闪烁
        }, message ? 400 : 0); // 有降级提示时留一点时间让用户看清文案再消失
    }

    // 进度条以前的问题：总字节数 knownTotalSum 是"边下边发现"的——16 个文件的 fetch() 并不是真的
    // 同时开工，浏览器对同一个源的并发连接数有上限（常见 6 条），前几个文件的 Content-Length 先
    // 揭晓、下完、分母只有它们几个，比例冲到 100%；剩下的文件轮到连接空出来才开始，分母突然变大，
    // 比例又掉回去——表现就是"看着到 100% 了，过一会儿又从 50% 开始"。
    // 解法：先用一轮 HEAD（或直接读缓存里已有文件的大小）把全部文件的大小问清楚、算出一个固定不变
    // 的总字节数，再开始真正下载正文——分母定死之后，进度只会单调往前走，不会再回退。
    async function probeFile(cache, src) {
        const cached = await cache.match(src);
        if (cached) {
            const blob = await cached.clone().blob();
            return { size: blob.size, cached: true };
        }
        try {
            const res = await fetch(src, { method: 'HEAD', cache: 'no-store' });
            return { size: Number(res.headers.get('content-length')) || 0, cached: false };
        } catch (e) {
            return { size: 0, cached: false }; // 探测失败不阻塞：下面下载阶段自己还会重试
        }
    }

    // 单个文件的下载：用 ReadableStream 逐块读取正文，把已读字节数汇报给 onBytes 回调，用来驱动
    // 进度条；下载成功后显式 cache.put() 写入 Cache Storage 并 await 写完，不依赖 service-worker.js
    // 的 fetch 事件去顺带缓存——那条路径里 SW 是 fire-and-forget 地在后台写缓存（没有 await 就把
    // 响应还给页面），如果页面这边紧接着就点"开始抽奖"，Audio 元素发起的请求可能会正好卡在"缓存还
    // 没写完"的那个窗口期，命中不了缓存，只能现场再走一次网络——这正是"第一次点抽奖有几秒延迟，要
    // 刷新几次才正常"的根因。这里把写缓存这一步收回到蒙版自己手上并且真正等它写完，才能保证蒙版
    // 消失的那一刻，全部素材已经确确实实躺在 Cache Storage 里，之后任何请求都是秒读。
    // 失败（网络错误、读取中途断流）会重试到 MAX_ATTEMPTS_PER_FILE 次，重试前把这个文件已经算进
    // 总进度的字节数退回去，避免"重试重新数了一遍"导致百分比超过 100% 或者卡在一个偏大的数字上不动。
    async function loadOneFile(cache, src, onBytes) {
        for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_FILE; attempt++) {
            let response;
            try {
                response = await fetch(src, { cache: 'no-store' });
            } catch (e) {
                if (attempt < MAX_ATTEMPTS_PER_FILE) {
                    await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * attempt));
                    continue;
                }
                console.warn('[MediaLoader] 素材加载失败，已放弃重试:', src, e);
                onBytes(0);
                return;
            }
            if (!response.ok) {
                onBytes(0);
                return; // 404 等：不重试，跳过这个文件，不阻塞其它文件继续加载
            }
            // 先 clone 一份专门喂给 cache.put，原始 response 留给下面的 reader 读进度——两份读的是
            // 同一个底层流的独立副本，互不影响
            const toCache = response.clone();
            if (!response.body) {
                await response.arrayBuffer().catch(() => {});
                await cache.put(src, toCache).catch((e) => console.warn('[MediaLoader] 写入缓存失败:', src, e));
                onBytes(0);
                return;
            }
            let thisAttemptBytes = 0; // 这次尝试已经读到、已经报给 onBytes 的字节数，中途失败要整体退回去
            try {
                const reader = response.body.getReader();
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    thisAttemptBytes += value.byteLength;
                    onBytes(value.byteLength);
                }
                await cache.put(src, toCache).catch((e) => console.warn('[MediaLoader] 写入缓存失败:', src, e));
                return; // 正常读完、缓存写完，成功
            } catch (e) {
                onBytes(-thisAttemptBytes); // 把这次没读完就中断的字节数退回去，避免污染总进度（重试会从头算）
                if (attempt < MAX_ATTEMPTS_PER_FILE) {
                    await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * attempt));
                    continue;
                }
                console.warn('[MediaLoader] 素材读取中途失败，已放弃重试:', src, e);
                return;
            }
        }
    }

    async function run() {
        const { overlay, skip } = els();
        if (!overlay) return; // 没有这个蒙版容器（比如页面结构被改过），直接跳过，不影响主流程
        if (!FILES.length) { dismiss(); return; }

        const hardTimer = setTimeout(() => dismiss('部分音效素材加载超时，先带你进入应用'), HARD_TIMEOUT_MS);
        const skipTimer = setTimeout(() => {
            if (skip) skip.classList.add('media-loader-skip-visible');
        }, SKIP_LINK_DELAY_MS);
        if (skip) skip.addEventListener('click', () => dismiss('已跳过等待'), { once: true });

        const cache = await caches.open(CACHE_NAME);

        // 第一阶段：探清每个文件的大小（缓存里已有的直接读 blob.size，不用发请求；没有的发一次
        // HEAD），算出固定的总字节数，避免下面下载阶段进度条来回跳
        const probes = await Promise.all(FILES.map((src) => probeFile(cache, src)));
        const totalBytes = probes.reduce((a, p) => a + p.size, 0);
        const loaded = new Array(FILES.length).fill(0);

        function recompute() {
            if (totalBytes > 0) {
                setProgress(loaded.reduce((a, b) => a + b, 0) / totalBytes);
            }
        }

        // 已经在缓存里的文件不用再下载，直接把它的大小记成"已加载"，进度条立刻体现出来
        probes.forEach((p, i) => {
            if (p.cached) { loaded[i] = p.size; }
        });
        recompute();

        try {
            await Promise.all(FILES.map((src, i) => {
                if (probes[i].cached) return Promise.resolve(); // 已缓存，跳过下载
                return loadOneFile(cache, src, (chunkBytes) => { loaded[i] += chunkBytes; recompute(); });
            }));
        } catch (e) {
            // Promise.all 理论上不会走到这里（loadOneFile 内部已经吞掉了单文件失败），保留兜底以防万一
        }

        // 到这里全部文件要么命中缓存、要么下载并写缓存完毕（await 过 cache.put），后台音效预热
        // （读时长用于播放倍速计算）放在这之后触发，保证它发起的 new Audio(src) 请求命中的都是
        // 已经写好的缓存、瞬间可用，不会再跟这里的下载抢带宽，也不会自己触发一次未缓存的网络请求
        if (window.SoundEffects && typeof SoundEffects.warmUp === 'function') {
            SoundEffects.warmUp(FILES);
        }

        clearTimeout(hardTimer);
        clearTimeout(skipTimer);
        dismiss();
    }

    window.MediaLoader = { run };
})();
