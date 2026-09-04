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

        const audio = new Audio(pickRandom(SPIN_FILES));
        audio.preload = 'auto';
        currentSpinAudio = audio;

        const startPlayback = () => {
            if (currentSpinAudio !== audio) return; // 期间已经被 stopSpin()/新一轮 playSpin() 顶掉
            const naturalMs = (audio.duration || 0) * 1000;
            if (naturalMs > 0) {
                const rate = Math.min(MAX_RATE, Math.max(MIN_RATE, naturalMs / durationMs));
                try { audio.playbackRate = rate; } catch (e) { /* 部分浏览器对极端倍率会抛错，忽略即可 */ }
            }
            audio.play().catch(() => { /* 自动播放被浏览器策略拦截时静默失败，不影响抽奖流程 */ });
        };

        if (audio.readyState >= 1) {
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
