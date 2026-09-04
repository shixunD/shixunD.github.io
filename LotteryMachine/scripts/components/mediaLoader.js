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

    // 素材实际下载走 fetch()，请求会被 service-worker.js 的 fetch 事件拦截：已经缓存过的文件
    // （cache-first 策略，见 service-worker.js）直接从 Cache Storage 秒读，只有没缓存过/被清缓存后
    // 才会真的走网络——所以老用户重新打开时这个蒙版通常只会一闪而过，不是每次都要等真下载。
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

    // 单个文件的下载进度：fetch() 的 Promise 一旦拿到响应头（含 Content-Length）就会 resolve，
    // 不需要等整个 body 下载完，可以用它提前拿到文件大小；之后再用 ReadableStream 逐块读取正文，
    // 把已读字节数汇报给 onBytes 回调。失败（网络错误、读取中途断流）会重试到 MAX_ATTEMPTS_PER_FILE
    // 次，重试前把这个文件已经算进总进度的字节数退回去，避免"重试重新数了一遍"导致百分比超过 100%
    // 或者卡在一个偏大的数字上不动。
    async function loadOneFile(src, onTotalKnown, onBytes) {
        for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_FILE; attempt++) {
            let response;
            try {
                response = await fetch(src);
            } catch (e) {
                if (attempt < MAX_ATTEMPTS_PER_FILE) {
                    await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * attempt));
                    continue;
                }
                console.warn('[MediaLoader] 素材加载失败，已放弃重试:', src, e);
                onBytes(0);
                return; // 三次都失败：跳过这个文件，不阻塞其它文件继续加载（见 HARD_TIMEOUT_MS 兜底）
            }
            const total = Number(response.headers.get('content-length')) || 0;
            onTotalKnown(total);
            if (!response.body || !total) {
                // 部分环境可能拿不到可读流或长度信息，直接消费掉响应体让它被 SW 缓存，进度按整体折算
                await response.arrayBuffer().catch(() => {});
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
                return; // 正常读完，成功
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

        const totals = new Array(FILES.length).fill(0);
        const loaded = new Array(FILES.length).fill(0);
        let knownTotalSum = 0;

        function recompute() {
            const loadedSum = loaded.reduce((a, b) => a + b, 0);
            if (knownTotalSum > 0) {
                setProgress(loadedSum / knownTotalSum);
            }
        }

        try {
            await Promise.all(FILES.map((src, i) => loadOneFile(
                src,
                (total) => { totals[i] = total; knownTotalSum = totals.reduce((a, b) => a + b, 0); },
                (chunkBytes) => { loaded[i] += chunkBytes; recompute(); }
            )));
        } catch (e) {
            // Promise.all 理论上不会走到这里（loadOneFile 内部已经吞掉了单文件失败），保留兜底以防万一
        }

        clearTimeout(hardTimer);
        clearTimeout(skipTimer);
        dismiss();
    }

    window.MediaLoader = { run };
})();
