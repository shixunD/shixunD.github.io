// soundEffects.js —— 抽奖音效：spin（旋转期间，倍速匹配旋转时长）+ win（中奖后，原速播完）
// 全局命名空间：window.SoundEffects

(function () {
    'use strict';

    // 素材来自 backgroundmusic/spin、backgroundmusic/win 两个文件夹，抽奖/中奖各随机选一个播放。
    // **清单不在这里硬编码，唯一来源是 backgroundmusic/manifest.json**（由 scripts/generateMediaManifest.js
    // 扫描两个文件夹生成，key 形如 "backgroundmusic/win/xxx.wav"，值是字节数）。这是真实踩过的坑：
    // 以前这里手写两个数组，往 win/ 文件夹里新加了 3 个 wav 并重新生成了 manifest，却忘了同步改
    // 这里的数组——结果启动蒙版把"清单里的 16 个"下完就显示 100% 放行，文件夹里另外 3 个从来没被
    // 下载、也从来没被播放过，看起来就是"没有把文件夹里的音频全部加载完"。改成两边都读同一份
    // manifest 之后，加/删素材只需要放文件 + 跑一次生成脚本，不会再出现两处清单对不上的情况。
    // 两个数组在 loadFileList() 里原地填充（不重新赋值），外部拿到的引用始终有效。
    const MANIFEST_URL = './backgroundmusic/manifest.json';
    const SPIN_FILES = [];
    const WIN_FILES = [];

    // 返回 { "./backgroundmusic/spin/xxx.wav": 字节数, ... }（key 已经转成本模块使用的相对路径形式）；
    // 加载失败（离线且缓存里也没有）返回 null，此时两个数组保持为空，播放函数会静默不出声，不会报错
    async function loadFileList() {
        let manifest;
        try {
            const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
            if (!res.ok) return null;
            manifest = await res.json();
        } catch (e) {
            console.warn('[SoundEffects] 音效清单加载失败:', e);
            return null;
        }
        SPIN_FILES.length = 0;
        WIN_FILES.length = 0;
        const sizes = {};
        Object.keys(manifest).sort().forEach((key) => {
            const src = './' + key;
            if (key.startsWith('backgroundmusic/spin/')) SPIN_FILES.push(src);
            else if (key.startsWith('backgroundmusic/win/')) WIN_FILES.push(src);
            else return;
            sizes[src] = Number(manifest[key]) || 0;
        });
        return sizes;
    }

    // 浏览器 playbackRate 的实际可用范围比标称的 [0.0625, 16] 更窄才稳妥（超出后部分浏览器会静音或报错），
    // 音效素材时长与旋转时长差距不会太离谱，这个区间足够覆盖，同时避免变速到无法辨识
    const MIN_RATE = 0.25;
    const MAX_RATE = 4;

    let currentSpinAudio = null; // 当前正在播放的 spin 音效（用于旋转提前结束/被打断时能立刻停掉）

    // 素材体积普遍有几百 KB～1.7MB（wav 无损格式）。如果点"开始抽奖"时才 `new Audio(src)` 让浏览器
    // 自己去取，取数据这一步要经过 Service Worker/网络，起点一晚，转盘视觉已经在转，听感上就是"音效
    // 延迟"，随后 stopSpin() 一掐就是"播不全"（根因是"起点晚了、播放长度没跟着缩短"）。
    // **这是真实踩过的坑，而且只在第一次访问时出现、刷新几次就好**：首次访问时 Service Worker 还在
    // 安装（同时在预缓存四十多个 js/css），这个页面还没被它接管，`new Audio(src)` 的请求不走缓存、
    // 而是又去服务器重新下一遍 wav；第二次以后 SW 已接管、命中缓存，就正常了。
    // 解法：播放路径彻底不依赖 SW/网络——mediaLoader.js 把素材写进 Cache Storage 后调 warmUp()，
    // 这里直接用页面侧的 Cache API 把 blob 读出来（不需要 SW 接管也能读），转成 object URL 建好
    // Audio 元素并等到拿到时长，之后播放就是操作一个已经完全就绪的内存对象，零等待。
    const ready = new Map(); // src -> { audio, durationMs }
    const WARMUP_TIMEOUT_MS = 5000; // 单个元素等 loadedmetadata 的上限，防止某个异常文件把蒙版永远挂住

    function prepareOne(src, blob) {
        return new Promise((resolve) => {
            const audio = new Audio();
            audio.preload = 'auto';
            const entry = { audio, durationMs: 0 };
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                if (audio.duration && isFinite(audio.duration)) entry.durationMs = audio.duration * 1000;
                if (audio.error) {
                    console.warn('[SoundEffects] 素材无法解码，播放时将退回网络加载:', src, audio.error);
                    resolve();
                    return;
                }
                ready.set(src, entry);
                resolve();
            };
            audio.addEventListener('loadedmetadata', finish, { once: true });
            audio.addEventListener('error', finish, { once: true });
            setTimeout(finish, WARMUP_TIMEOUT_MS);
            audio.src = URL.createObjectURL(blob);
            audio.load();
        });
    }

    // cache：mediaLoader.js 打开的那个 Cache 对象（和 service-worker.js 同一个缓存桶）。
    // 返回 Promise，全部元素就绪（或超时/失败）后 resolve——mediaLoader.js 会 await 它再撤蒙版，
    // 保证蒙版消失的那一刻点"开始抽奖"就能立刻出声。
    async function warmUp(files, cache) {
        await Promise.all(files.map(async (src) => {
            try {
                const res = cache && await cache.match(src);
                if (!res) return;
                await prepareOne(src, await res.blob());
            } catch (e) {
                console.warn('[SoundEffects] 预热失败，播放时将退回网络加载:', src, e);
            }
        }));
    }

    function pickRandom(list) {
        return list[Math.floor(Math.random() * list.length)];
    }

    function soundEnabled() {
        const settings = window.AppState && AppState.getState().settings;
        return !settings || settings.soundEffectsEnabled !== false;
    }

    // durationMs：本次转盘旋转的总时长（匀速阶段 + 悬念阶段），音效通过 playbackRate 倍速拉伸/压缩到刚好这么长
    function playSpin(durationMs) {
        stopSpin();
        if (!soundEnabled() || !durationMs) return;

        const src = pickRandom(SPIN_FILES);
        // 用"必须播完的绝对时刻"而不是固定的 durationMs 来算倍速：不管音效实际几点才真正开始播
        // （哪怕预加载没命中、还是要等一次 loadedmetadata），都按"距离这个时刻还剩多久"重新拉伸，
        // 保证不会被 finish() 里的 stopSpin() 提前掐断——这是修复"播放延迟就等于播放不完整"的关键。
        const deadline = performance.now() + durationMs;
        const entry = ready.get(src);
        // 最常见的情况：预热好的元素，直接复用（同一时刻只会有一个 spin 在播，stopSpin 会把它停掉）
        const audio = entry ? entry.audio : new Audio(src);
        if (!entry) audio.preload = 'auto';
        currentSpinAudio = audio;

        const startPlayback = () => {
            if (currentSpinAudio !== audio) return; // 期间已经被 stopSpin()/新一轮 playSpin() 顶掉
            const naturalMs = (audio.duration || 0) * 1000 || (entry && entry.durationMs) || 0;
            const remainingMs = Math.max(50, deadline - performance.now());
            if (naturalMs > 0) {
                const rate = Math.min(MAX_RATE, Math.max(MIN_RATE, naturalMs / remainingMs));
                try { audio.playbackRate = rate; } catch (e) { /* 部分浏览器对极端倍率会抛错，忽略即可 */ }
            }
            try { audio.currentTime = 0; } catch (e) { /* 还没有元数据时 seek 会抛错，此时本来就在开头 */ }
            audio.play().catch(() => { /* 自动播放被浏览器策略拦截时静默失败，不影响抽奖流程 */ });
        };

        if (entry || audio.readyState >= 1) {
            startPlayback();
        } else {
            // 预热没覆盖到（比如该文件解码失败、或用户跳过了等待）：退回老路，等元数据到了再播
            audio.addEventListener('loadedmetadata', startPlayback, { once: true });
        }
    }

    // 旋转动画结束（含兜底 setTimeout 提前触发的情况）时调用，避免倍速估算误差导致音效拖尾
    function stopSpin() {
        if (currentSpinAudio) {
            currentSpinAudio.pause();
            currentSpinAudio = null;
        }
    }

    // 中奖后调用：原速播完，不受旋转时长影响
    function playWin() {
        if (!soundEnabled()) return;
        const src = pickRandom(WIN_FILES);
        const entry = ready.get(src);
        let audio;
        if (entry && entry.audio.paused) {
            audio = entry.audio;
        } else if (entry) {
            audio = entry.audio.cloneNode(); // 上一次中奖的同一个音效还没放完：克隆一份叠着放，源是内存里的 blob，瞬时可用
        } else {
            audio = new Audio(src);
        }
        try { audio.playbackRate = 1; audio.currentTime = 0; } catch (e) { /* 同上 */ }
        audio.play().catch(() => { /* 自动播放被拦截时静默失败 */ });
    }

    // loadFileList/SPIN_FILES/WIN_FILES 一并导出：mediaLoader.js 的启动蒙版先调 loadFileList() 拿到
    // 完整清单和字节数，再逐个下载/校验；warmUp 也导出，供 mediaLoader.js 在全部素材缓存完毕之后
    // 调用（原因见 warmUp 定义处的注释）
    window.SoundEffects = { playSpin, stopSpin, playWin, warmUp, loadFileList, SPIN_FILES, WIN_FILES };
})();
