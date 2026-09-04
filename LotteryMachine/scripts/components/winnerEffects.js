// winnerEffects.js —— 中奖弹窗的随机庆祝动效（撒花/奖杯/欢呼等），纯 CSS 动画 + emoji，无第三方库
// 全局命名空间：window.WinnerEffects
//
// 设计：10 种"效果配方"（emoji 组合 + 参数）复用 5 种"运动方式"（fall/rise/float/twinkle/burst，
// 见 styles/winnerEffects.css 里对应的 @keyframes）。运动方式是真正意义上会重复的动作模式
// （下落/上升/漂浮/闪烁/爆开），10 种效果只是给同一套运动方式换不同的 emoji 和参数，
// 不是 10 份几乎相同代码的复制粘贴。

(function () {
    'use strict';

    // 每次中奖随机选一种，effect 之间没有优先级
    const EFFECTS = [
        { key: 'confetti', label: '撒花', motion: 'fall', emojis: ['🎊', '🎉', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪'], count: 26 },
        { key: 'trophy', label: '冠军奖杯', motion: 'pop', heroEmoji: '🏆', burstEmojis: ['✨', '⭐'], burstCount: 10 },
        { key: 'cheer', label: '举手欢呼', motion: 'rise', emojis: ['🙌'], count: 10 },
        { key: 'fireworks', label: '烟花', motion: 'burst', emojis: ['✨', '💥', '🎆'], count: 22, origin: 'center', dist: [100, 240] },
        { key: 'balloons', label: '气球', motion: 'float', emojis: ['🎈'], count: 12, hueShift: true },
        { key: 'streamers', label: '彩带', motion: 'fall', emojis: ['🎗️', '🎀', '🎊'], count: 18, sway: true },
        { key: 'stars', label: '星光闪烁', motion: 'twinkle', emojis: ['⭐', '🌟', '✨'], count: 22 },
        { key: 'clap', label: '鼓掌', motion: 'burst', emojis: ['👏'], count: 14, origin: 'center', dist: [60, 150] },
        { key: 'popper', label: '派对礼炮', motion: 'burst', emojis: ['🎉'], count: 16, origin: 'corners', dist: [120, 260] },
        { key: 'crown', label: '皇冠', motion: 'float', emojis: ['👑', '💖', '✨'], count: 12 }
    ];

    function randomIn([min, max]) { return min + Math.random() * (max - min); }

    // origin: 'center' 从弹窗中心向四周炸开；'corners' 从屏幕左右下角向内上方炸开（派对礼炮效果）
    function burstOriginAndAngle(origin, index) {
        if (origin === 'corners') {
            return index % 2 === 0
                ? { ox: '2%', oy: '98%', angle: randomIn([-115, -25]) }
                : { ox: '98%', oy: '98%', angle: randomIn([205, 295]) };
        }
        return { ox: '50%', oy: '46%', angle: randomIn([0, 360]) };
    }

    function makeParticle(emoji, motionClass) {
        const span = document.createElement('span');
        span.className = `winner-fx-particle winner-fx-${motionClass}`;
        span.textContent = emoji;
        span.style.setProperty('--delay', `${randomIn([0, 0.5]).toFixed(2)}s`);
        span.style.setProperty('--duration', `${randomIn([1.3, 2.6]).toFixed(2)}s`);
        return span;
    }

    function buildLayer(effect) {
        const layer = document.createElement('div');
        layer.className = 'winner-fx-layer';

        if (effect.motion === 'pop') {
            const hero = document.createElement('span');
            hero.className = 'winner-fx-particle winner-fx-hero';
            hero.textContent = effect.heroEmoji;
            layer.appendChild(hero);
            for (let i = 0; i < effect.burstCount; i++) {
                const emoji = effect.burstEmojis[Math.floor(Math.random() * effect.burstEmojis.length)];
                const span = makeParticle(emoji, 'burst');
                const { ox, oy, angle } = burstOriginAndAngle('center', i);
                const dist = randomIn([70, 160]);
                span.style.left = ox;
                span.style.top = oy;
                span.style.setProperty('--tx', `${(Math.cos(angle * Math.PI / 180) * dist).toFixed(0)}px`);
                span.style.setProperty('--ty', `${(Math.sin(angle * Math.PI / 180) * dist).toFixed(0)}px`);
                layer.appendChild(span);
            }
            return layer;
        }

        for (let i = 0; i < effect.count; i++) {
            const emoji = effect.emojis[Math.floor(Math.random() * effect.emojis.length)];
            const span = makeParticle(emoji, effect.motion);

            if (effect.motion === 'fall') {
                span.style.setProperty('--x', `${randomIn([0, 100])}%`);
                span.style.setProperty('--drift', `${randomIn(effect.sway ? [-40, 40] : [-15, 15]).toFixed(0)}px`);
                span.style.setProperty('--rot', `${Math.floor(randomIn([0, 360]))}deg`);
            } else if (effect.motion === 'rise') {
                span.style.setProperty('--x', `${randomIn([10, 90])}%`);
            } else if (effect.motion === 'float') {
                span.style.setProperty('--x', `${randomIn([5, 95])}%`);
                span.style.setProperty('--drift', `${randomIn([-20, 20]).toFixed(0)}px`);
                if (effect.hueShift) span.style.filter = `hue-rotate(${Math.floor(randomIn([0, 360]))}deg)`;
            } else if (effect.motion === 'twinkle') {
                span.style.setProperty('--x', `${randomIn([0, 100])}%`);
                span.style.setProperty('--y', `${randomIn([0, 100])}%`);
            } else if (effect.motion === 'burst') {
                const { ox, oy, angle } = burstOriginAndAngle(effect.origin, i);
                const dist = randomIn(effect.dist);
                span.style.left = ox;
                span.style.top = oy;
                span.style.setProperty('--tx', `${(Math.cos(angle * Math.PI / 180) * dist).toFixed(0)}px`);
                span.style.setProperty('--ty', `${(Math.sin(angle * Math.PI / 180) * dist).toFixed(0)}px`);
            }
            layer.appendChild(span);
        }
        return layer;
    }

    // 在 winner-overlay 内追加一层随机庆祝动效；动效元素随弹窗一起被移除，不需要单独清理
    function play(overlayEl) {
        if (!overlayEl) return;
        const effect = EFFECTS[Math.floor(Math.random() * EFFECTS.length)];
        overlayEl.appendChild(buildLayer(effect));
    }

    window.WinnerEffects = { play };
})();
