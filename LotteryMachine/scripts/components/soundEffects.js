// soundEffects.js —— 抽奖音效：spin（旋转期间，倍速匹配旋转时长）+ win（中奖后，原速播完）
// 全局命名空间：window.SoundEffects

(function () {
    'use strict';

    // 素材来自 backgroundmusic/spin、backgroundmusic/win 两个文件夹，抽奖/中奖各随机选一个播放
    const SPIN_FILES = [
        './backgroundmusic/spin/mixkit-arcade-rising-231.wav',
        './backgroundmusic/spin/mixkit-casino-reward-1980.wav',
        './backgroundmusic/spin/mixkit-fast-bike-wheel-spin-1614.wav',
        './backgroundmusic/spin/mixkit-game-engine-hum-2644.wav',
        './backgroundmusic/spin/mixkit-payout-award-1934.wav',
        './backgroundmusic/spin/mixkit-slot-machine-win-1928.wav',
        './backgroundmusic/spin/mixkit-slot-machine-win-alarm-1995.wav',
        './backgroundmusic/spin/mixkit-spinning-whistle-toy-2647.wav'
    ];
    const WIN_FILES = [
        './backgroundmusic/win/mixkit-animated-small-group-applause-523.wav',
        './backgroundmusic/win/mixkit-ethereal-fairy-win-sound-2019.wav',
        './backgroundmusic/win/mixkit-male-voice-cheer-2010.wav',
        './backgroundmusic/win/mixkit-male-voice-cheer-victory-2011.wav',
        './backgroundmusic/win/mixkit-small-group-light-applause-517.wav',
        './backgroundmusic/win/mixkit-small-win-2020.wav',
        './backgroundmusic/win/mixkit-video-game-win-2016.wav',
        './backgroundmusic/win/mixkit-wind-chimes-2014.wav'
    ];

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
    warmUp(SPIN_FILES);
    warmUp(WIN_FILES);

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

    window.SoundEffects = { playSpin, stopSpin, playWin };
})();
