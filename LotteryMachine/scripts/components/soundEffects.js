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

    // 素材体积普遍有几百 KB～1.6MB（wav 无损格式），如果每次点"开始抽奖"才 new Audio() 现下载现播，
    // 首次播放某个文件时要等一次网络请求+解码（慢网络/慢磁盘下可能是几百毫秒甚至更久）才会真正出声——
    // 这段等待期间转盘视觉已经在转了，听感上就是"音效延迟"；更糟的是 playSpin() 原来按"旋转总时长"算
    // 倍速，如果播放起点因为这段等待往后错了，到 stopSpin() 强制停止的那一刻音效必然还没放完，就变成
    // "播放不完整"（真正的根因不是"放完了才截断"，而是"起点晚了、播放长度没跟着缩短"）。
    // 解法：应用一启动就在后台把全部素材静默预加载一遍（`preload='auto'` 触发浏览器把整个文件缓存到内存/
    // 磁盘缓存），并记下真实时长；引用必须存进这个数组保持"活着"，否则没有其它变量持有时对象可能被当
    // 垃圾提前回收，预加载等于白做。真正播放时 `new Audio(src)` 拿到的是命中浏览器缓存的第二份实例，
    // 不需要重新走网络，时长也大概率已经在缓存里、不用等 loadedmetadata 事件。
    const durationCacheMs = new Map(); // src -> 时长（毫秒）
    const preloadedAudioPool = [];

    // 不在这里模块加载时就自动调用——那时候 mediaLoader.js 还没跑完，Cache Storage 里啥也没有，
    // 这里发起的 new Audio(src) 请求会在没有缓存可命中的情况下自己现发一次网络请求，跟 mediaLoader
    // 正在做的下载抢带宽/连接数，还会让"第一次点抽奖"用到的时长信息来自一次仓促的加载。改成由
    // mediaLoader.js 在自己确认全部素材已经写入缓存之后再调这个函数（见该文件 run() 末尾），
    // 这时候这里的请求命中的都是缓存，是瞬时的。
    function warmUp(files) {
        files.forEach((src) => {
            const probe = new Audio();
            probe.preload = 'auto';
            probe.addEventListener('loadedmetadata', () => {
                durationCacheMs.set(src, probe.duration * 1000);
            }, { once: true });
            probe.src = src;
            preloadedAudioPool.push(probe);
        });
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
        const audio = new Audio(src);
        audio.preload = 'auto';
        currentSpinAudio = audio;

        const startPlayback = () => {
            if (currentSpinAudio !== audio) return; // 期间已经被 stopSpin()/新一轮 playSpin() 顶掉
            const naturalMs = (audio.duration || 0) * 1000 || durationCacheMs.get(src) || 0;
            const remainingMs = Math.max(50, deadline - performance.now());
            if (naturalMs > 0) {
                const rate = Math.min(MAX_RATE, Math.max(MIN_RATE, naturalMs / remainingMs));
                try { audio.playbackRate = rate; } catch (e) { /* 部分浏览器对极端倍率会抛错，忽略即可 */ }
            }
            audio.play().catch(() => { /* 自动播放被浏览器策略拦截时静默失败，不影响抽奖流程 */ });
        };

        if (durationCacheMs.has(src) || audio.readyState >= 1) {
            // 时长已经从预加载缓存里拿到（最常见的情况），不用再等这个新 Audio 实例自己触发一次
            // loadedmetadata，直接算倍速播放，消除等待窗口
            startPlayback();
        } else {
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
        const audio = new Audio(pickRandom(WIN_FILES));
        audio.play().catch(() => { /* 自动播放被拦截时静默失败 */ });
    }

    // loadFileList/SPIN_FILES/WIN_FILES 一并导出：mediaLoader.js 的启动蒙版先调 loadFileList() 拿到
    // 完整清单和字节数，再逐个下载/校验；warmUp 也导出，供 mediaLoader.js 在全部素材缓存完毕之后
    // 调用（原因见 warmUp 定义处的注释）
    window.SoundEffects = { playSpin, stopSpin, playWin, warmUp, loadFileList, SPIN_FILES, WIN_FILES };
})();
