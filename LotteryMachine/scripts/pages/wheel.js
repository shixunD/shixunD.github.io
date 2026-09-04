// wheel.js —— 抽奖页：绘制转盘、加权随机抽取、旋转动画
// 全局命名空间：window.WheelPage

(function () {
    'use strict';

    const SECTOR_COLORS = ['#4a6cf7', '#22c1a4', '#f5a623', '#ef5da8', '#7c5cff', '#2fb8e0', '#ff8b5c', '#5bd1a0'];
    const DRAWN_SECTOR_COLOR = '#c7cbd6'; // "不重复抽取"模式下，已抽过的学生扇区变灰
    // 中奖扇区两侧各留出的安全边距（占扇区宽度的比例），指针实际停靠点在扇区内 [1%, 99%] 范围随机，但不会精确停在分隔线上
    const SECTOR_LANDING_MARGIN_RATIO = 0.01;

    let currentRotation = 0; // 累计旋转角度（degree），只增不减，保证动画方向一致
    let spinning = false;

    // 转盘叶片头像缓存：key 是 photoDataUrl 本身（同一张照片复用同一个 Image 对象），
    // 避免每次 drawWheel（比如窗口 resize、重复渲染）都重新创建 Image 触发闪烁
    const photoImageCache = new Map();

    // 取（或异步加载）某张照片的 Image 对象；还没加载完成时返回 null，加载完成后自动触发一次重绘
    function getPhotoImage(dataUrl) {
        let entry = photoImageCache.get(dataUrl);
        if (entry) return entry.loaded ? entry.img : null;

        const img = new Image();
        entry = { img, loaded: false };
        photoImageCache.set(dataUrl, entry);
        img.onload = () => {
            entry.loaded = true;
            if (document.getElementById('wheel-page').classList.contains('active')) drawWheel();
        };
        img.src = dataUrl;
        return null;
    }

    function getEls() {
        return {
            container: document.getElementById('wheel-page-body'),
            canvas: document.getElementById('wheel-canvas'),
            hub: document.getElementById('wheel-hub')
        };
    }

    function drawWheel() {
        const { canvas } = getEls();
        if (!canvas) return;
        const students = AppState.getStudents();

        const dpr = window.devicePixelRatio || 1;
        const size = canvas.clientWidth || 480;
        canvas.width = size * dpr;
        canvas.height = size * dpr;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, size, size);

        const cx = size / 2;
        const cy = size / 2;
        const radius = size / 2;

        if (students.length === 0) {
            ctx.fillStyle = '#eef1fa';
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.fill();
            return;
        }

        const seg = (Math.PI * 2) / students.length;
        const startOffset = -Math.PI / 2; // 0号扇区从正上方（指针处）开始，顺时针排列

        const settings = AppState.getState().settings;
        const noRepeat = settings.noRepeatMode;
        const drawnIds = noRepeat ? new Set(AppState.getDrawnIds()) : null;
        const showPhotos = !!settings.showWheelPhotos;

        students.forEach((student, i) => {
            const start = startOffset + i * seg;
            const end = start + seg;
            const isDrawn = !!(drawnIds && drawnIds.has(student.id));

            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, radius, start, end);
            ctx.closePath();
            ctx.fillStyle = isDrawn ? DRAWN_SECTOR_COLOR : SECTOR_COLORS[i % SECTOR_COLORS.length];
            ctx.fill();

            // 扇区分隔线
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            const midAngle = start + seg / 2;

            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(midAngle);
            if (isDrawn) ctx.globalAlpha = 0.6; // 已抽过的学生头像/姓名一并调暗，呼应扇区变灰

            const photoImg = showPhotos && student.photoDataUrl ? getPhotoImage(student.photoDataUrl) : null;
            const fontSize = Math.max(10, Math.min(15, 220 / students.length));
            ctx.fillStyle = '#fff';
            ctx.font = `600 ${fontSize}px "Segoe UI", "Microsoft YaHei", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const label = student.name.length > 6 ? student.name.slice(0, 6) + '…' : student.name;

            if (photoImg) {
                // 头像画在扇区外侧、姓名画在头像内侧靠近圆心一点，两者都沿半径方向排列
                const photoRadius = Math.max(9, Math.min(20, (radius * seg) / 5));
                const photoCx = radius * 0.78;
                ctx.save();
                ctx.beginPath();
                ctx.arc(photoCx, 0, photoRadius, 0, Math.PI * 2);
                ctx.closePath();
                ctx.clip();
                ctx.drawImage(photoImg, photoCx - photoRadius, -photoRadius, photoRadius * 2, photoRadius * 2);
                ctx.restore();
                ctx.strokeStyle = 'rgba(255,255,255,0.8)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(photoCx, 0, photoRadius, 0, Math.PI * 2);
                ctx.stroke();

                ctx.fillText(label, radius * 0.45, 0);
            } else {
                ctx.fillText(label, radius * 0.65, 0);
            }

            ctx.restore();
        });
    }

    // 抽奖候选池：默认是全体学生；"不重复抽取"开启时排除本班已经抽过的人
    function getDrawPool(students) {
        const settings = AppState.getState().settings;
        if (!settings.noRepeatMode) return students;
        const drawnIds = new Set(AppState.getDrawnIds());
        return students.filter((s) => !drawnIds.has(s.id));
    }

    // 等权抽取开启时忽略权重，所有人被抽中的概率相同；pool 已经是排除过"已抽取"名单的候选池
    function weightedPick(pool) {
        if (AppState.getState().settings.equalWeightMode) {
            return pool[Math.floor(Math.random() * pool.length)];
        }
        const total = pool.reduce((sum, s) => sum + (s.weight || 0), 0);
        let r = Math.random() * total;
        for (const s of pool) {
            r -= s.weight || 0;
            if (r <= 0) return s;
        }
        return pool[pool.length - 1];
    }

    // 再次发起抽奖时，若上一次的中奖弹窗还没关闭，先自动关掉，避免多个弹窗叠加
    function closeExistingWinnerDialog() {
        document.querySelectorAll('.winner-overlay').forEach((el) => el.remove());
    }

    function showWinnerDialog(student) {
        closeExistingWinnerDialog();
        const overlay = document.createElement('div');
        overlay.className = 'winner-overlay';
        const photo = student.photoDataUrl
            ? `<img class="winner-photo" src="${student.photoDataUrl}" alt="${Modal.escapeHtml(student.name)}">`
            : `<div class="winner-photo" style="display:flex;align-items:center;justify-content:center;font-size:3rem;color:var(--primary-color);background:var(--bg-color);">${Modal.escapeHtml((student.name || '?')[0])}</div>`;
        overlay.innerHTML = `
            <div class="winner-dialog">
                ${photo}
                <div class="winner-label">🎉 恭喜中奖</div>
                <div class="winner-name">${Modal.escapeHtml(student.name)}</div>
                <button type="button" class="btn-primary" data-action="close">好的</button>
            </div>
        `;

        let autoCloseTimer = null;
        function close() {
            if (autoCloseTimer) clearTimeout(autoCloseTimer);
            overlay.remove();
        }

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay || e.target.closest('[data-action="close"]')) close();
        });
        document.body.appendChild(overlay);
        WinnerEffects.play(overlay); // 每次中奖随机触发一种庆祝动效（撒花/奖杯/欢呼等），见 winnerEffects.js

        const autoCloseMs = AppState.getState().settings.winnerAutoCloseMs;
        if (autoCloseMs > 0) {
            autoCloseTimer = setTimeout(close, autoCloseMs);
        }
    }

    // 旋转动画分两个阶段（时长/圈数由 settings.spinFastMs / spinFastTurns / spinSlowMs 控制，可在设置页调整）：
    //   阶段一（匀速）：x 毫秒内匀速转固定圈数，营造"公平"的既视感，与中奖者无关。
    //   阶段二（匀减速）：固定用 y 毫秒，从阶段一的转速开始匀速降低到 0，最终精确停在中奖扇区内
    //   随机选中的一点（不是固定停在扇区正中间，避免每次都停中间显得像"设计好的"）——
    //   减速阶段实际要走的角度是 (中奖所需角度 + k 整圈)，k 取让减速起始速度尽量贴近阶段一转速的那个整数，
    //   避免两阶段衔接处出现肉眼可见的速度突变（推导见 PROJECT.md 第四节"旋转与中奖逻辑"）。
    //   曾经试过让 y 是"时长上限"、实际时长在 [y/2,y] 内随机取——用户反馈这样反而容易有"突然停下"
    //   的观感：因为 decelStartVelocity = 2*decelDistance/slowMs，要走的距离差不多，时长却可能被
    //   随机砍到只剩一半，起始速度就要翻倍去追，减速曲线陡峭得多，看起来像急刹车而不是缓缓停下，
    //   于是改回固定用 y 毫秒，减速节奏才稳定可预期。
    function spin() {
        if (spinning) return;
        const students = AppState.getStudents();
        if (students.length < 2) {
            Toast.warning('至少需要 2 名学生才能抽奖');
            return;
        }

        const noRepeat = AppState.getState().settings.noRepeatMode;
        const pool = getDrawPool(students);
        if (noRepeat && pool.length === 0) {
            Toast.warning('本班同学已全部抽完，点击右侧"重置"后可重新开始');
            return;
        }

        closeExistingWinnerDialog(); // 再次抽奖时，上一次还没关闭的中奖弹窗直接关掉，不等新一轮抽完才关

        const { canvas, hub } = getEls();
        const winner = weightedPick(pool);
        const winnerIndex = students.indexOf(winner);
        const seg = 360 / students.length;
        // 落点在中奖扇区内 [1%, 99%] 范围均匀随机取一点，而不是每次都精确停在扇区正中间——固定停中间
        // 在视觉上像"设计好的"，缺乏真实转盘的随机感；也不会精确停在分隔线上（由 SECTOR_LANDING_MARGIN_RATIO 决定边距）。
        const rawFraction = Math.random();
        const clampedFraction = Math.min(1 - SECTOR_LANDING_MARGIN_RATIO, Math.max(SECTOR_LANDING_MARGIN_RATIO, rawFraction));
        const landingOffset = clampedFraction * seg;
        const winnerLandingAngle = winnerIndex * seg + landingOffset; // 相对 0 号扇区起点（正上方）的顺时针角度

        // 目标：转到某个角度后，中奖扇区内刚才随机选中的那一点恰好落在正上方（指针处）
        const desiredFinalAngle = (360 - (winnerLandingAngle % 360)) % 360;

        const settings = AppState.getState().settings;
        const fastMs = Math.max(100, settings.spinFastMs || 1000); // x：匀速阶段时长
        // x 毫秒内固定转几圈，可在设置页调整，支持小数（比如 0.5 圈）；不再强制取整
        const fastTurns = Math.max(0.1, Number(settings.spinFastTurns) || 3);
        const slowMs = Math.max(100, settings.spinSlowMs || 1000); // y：减速阶段固定时长，不再随机取值

        const fastDistance = fastTurns * 360; // 阶段一固定走的角度
        // fastTurns 支持小数后，fastDistance 不再保证是 360 的整数倍，阶段一结束时的 mod-360 位置
        // 相比阶段一开始前会有偏移，所以 delta 必须相对"阶段一结束后的角度"来算，不能再用阶段一开始前的角度
        const afterFastMod = ((currentRotation + fastDistance) % 360 + 360) % 360;
        const delta = ((desiredFinalAngle - afterFastMod) % 360 + 360) % 360;
        const fastVelocity = fastDistance / fastMs; // 阶段一角速度（度/毫秒）
        const idealDecelDistance = fastVelocity * slowMs / 2; // 若减速阶段起始速度恰好等于阶段一速度，理论上应走的角度
        // 在 delta 的基础上加 k 个整圈，让减速阶段实际角度尽量贴近 idealDecelDistance（保证速度衔接平滑）
        const extraTurns = Math.max(0, Math.round((idealDecelDistance - delta) / 360));
        const decelDistance = delta + extraTurns * 360; // 减速阶段实际要走的角度
        const decelStartVelocity = (2 * decelDistance) / slowMs; // 减速阶段起始角速度，从此匀减速到 0

        const startRotation = currentRotation;
        const nextRotation = startRotation + fastDistance + decelDistance;
        const totalMs = fastMs + slowMs;

        spinning = true;
        hub.classList.add('spinning');
        canvas.style.transition = 'none'; // 改用 requestAnimationFrame 逐帧驱动，不依赖 CSS transition
        SoundEffects.playSpin(totalMs); // spin 音效随机选一个，倍速拉伸/压缩到刚好等于本次旋转总时长

        const startTime = performance.now();
        let rafId = null;
        let finished = false;

        // 兜底：标签页被切到后台/最小化时，浏览器可能整个暂停 requestAnimationFrame 回调
        // （不只是降频，而是完全不再触发），如果 finish() 只从 rAF 循环里调用，转盘会永久卡在
        // "旋转中"，`开始抽奖`再也点不动——这正是旧版 CSS transition + transitionend 方案曾经踩过的
        // 同一类坑（见 PROJECT.md），只是触发条件从"transitionend 不触发"变成了"rAF 不触发"。
        // setTimeout 在后台标签页里会被降频但不会被完全暂停，用它做安全网可以保证无论如何都会收尾。
        function finish() {
            if (finished) return;
            finished = true;
            if (rafId) cancelAnimationFrame(rafId);
            clearTimeout(fallbackTimer);
            currentRotation = nextRotation;
            canvas.style.transform = `rotate(${nextRotation}deg)`;
            spinning = false;
            hub.classList.remove('spinning');
            SoundEffects.stopSpin(); // 倍速是按理论时长估算的，实际收尾时兜底停掉，避免拖尾
            SoundEffects.playWin(); // 指针停下、中奖者确定后播放，随机选一个，原速播完
            if (noRepeat) AppState.markDrawn(winner.id); // 触发重绘让中奖扇区变灰，不等待也不影响弹窗展示
            DrawHistory.add(winner, SECTOR_COLORS[winnerIndex % SECTOR_COLORS.length]); // 历史条卡片颜色跟当时的扇区颜色保持一致
            showWinnerDialog(winner);
        }
        const fallbackTimer = setTimeout(finish, totalMs + 500);

        function frame(now) {
            const elapsed = now - startTime;
            if (elapsed >= totalMs) { finish(); return; }

            let angle;
            if (elapsed <= fastMs) {
                angle = fastVelocity * elapsed;
            } else {
                const tau = elapsed - fastMs; // 减速阶段已经过去的毫秒数
                angle = fastDistance + decelStartVelocity * tau - (decelStartVelocity / (2 * slowMs)) * tau * tau;
            }
            canvas.style.transform = `rotate(${startRotation + angle}deg)`;
            rafId = requestAnimationFrame(frame);
        }

        rafId = requestAnimationFrame(frame);
    }

    function render() {
        const students = AppState.getStudents();
        const body = document.getElementById('wheel-page-body');
        if (!body) return;

        if (!document.getElementById('wheel-class-switcher-mount')) {
            body.innerHTML = `
                <div class="wheel-toolbar">
                    <div id="wheel-class-switcher-mount"></div>
                    <div class="wheel-toolbar-right">
                        <button type="button" class="btn-secondary" id="wheel-equal-weight-btn">⚖️ 等权抽取</button>
                        <button type="button" class="btn-secondary" id="wheel-no-repeat-btn">🚫 不重复抽取</button>
                        <button type="button" class="btn-secondary" id="wheel-reset-drawn-btn">🔄 重置</button>
                    </div>
                </div>
                <div id="wheel-stage-mount"></div>
            `;
            document.getElementById('wheel-equal-weight-btn').addEventListener('click', (e) => {
                const nowOn = !e.currentTarget.classList.contains('btn-toggle-on');
                AppState.updateSettings({ equalWeightMode: nowOn });
            });
            document.getElementById('wheel-no-repeat-btn').addEventListener('click', async (e) => {
                const nowOn = !e.currentTarget.classList.contains('btn-toggle-on');
                await AppState.updateSettings({ noRepeatMode: nowOn });
                // 取消开启时恢复原状：清空本班"已抽取"记录，扇区恢复原色
                if (!nowOn) await AppState.resetDrawn();
            });
            document.getElementById('wheel-reset-drawn-btn').addEventListener('click', async () => {
                await AppState.resetDrawn();
                Toast.success('已重置，全部同学可重新参与抽取');
            });
        }

        ClassSwitcher.renderInto(document.getElementById('wheel-class-switcher-mount'));
        const settings = AppState.getState().settings;
        // 用"重置"按钮同款的 .btn-secondary 外观，开启时叠加 .btn-toggle-on 变成主色，跟按钮组风格统一
        document.getElementById('wheel-equal-weight-btn').classList.toggle('btn-toggle-on', !!settings.equalWeightMode);
        document.getElementById('wheel-no-repeat-btn').classList.toggle('btn-toggle-on', !!settings.noRepeatMode);
        // 用 visibility（而不是 hidden 属性/display:none）隐藏"重置"按钮：按钮的盒子始终占着位置，
        // 只是开关时切换可见/不可见，这样 .wheel-toolbar-right 的总宽度永远不变，
        // "等权抽取"/"不重复抽取"两个按钮的绝对位置就不会跟着重置按钮的出现/消失而左右挪动
        document.getElementById('wheel-reset-drawn-btn').classList.toggle('wheel-reset-btn-off', !settings.noRepeatMode);

        const stageMount = document.getElementById('wheel-stage-mount');

        if (students.length === 0) {
            stageMount.innerHTML = `
                <div class="wheel-empty-hint">
                    <p>还没有学生名单，请先前往「录入」页面添加同学。</p>
                </div>
            `;
            return;
        }

        if (!document.getElementById('wheel-canvas')) {
            stageMount.innerHTML = `
                <div class="wheel-stage">
                    <div class="wheel-pointer"></div>
                    <div class="wheel-canvas-wrap">
                        <canvas id="wheel-canvas"></canvas>
                    </div>
                    <div class="wheel-hub" id="wheel-hub">开始<br>抽奖</div>
                </div>
                <span class="roster-stats" id="wheel-stats"></span>
            `;
            document.getElementById('wheel-hub').addEventListener('click', spin);
        }

        document.getElementById('wheel-stats').textContent = `共 ${students.length} 名学生`;
        drawWheel();
    }

    window.addEventListener('resize', () => {
        if (document.getElementById('wheel-page').classList.contains('active')) drawWheel();
    });

    // 供快捷键（app.js 的全局 keydown 监听）调用：直接复用点击中心按钮的同一个 spin()，
    // 天然继承里面所有的保护逻辑（<2人/candidate 池为空/正在旋转中都会被挡掉）
    function triggerShortcutSpin() {
        if (!document.getElementById('wheel-hub')) return; // 还没渲染出转盘（比如空名单）
        spin();
    }

    window.WheelPage = { render, triggerShortcutSpin };
})();
