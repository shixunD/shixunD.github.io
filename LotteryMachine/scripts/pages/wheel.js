// wheel.js —— 抽奖页：绘制转盘、加权随机抽取、旋转动画
// 全局命名空间：window.WheelPage

(function () {
    'use strict';

    const SECTOR_COLORS = ['#4a6cf7', '#22c1a4', '#f5a623', '#ef5da8', '#7c5cff', '#2fb8e0', '#ff8b5c', '#5bd1a0'];
    const DRAWN_SECTOR_COLOR = '#c7cbd6'; // "不重复抽取"模式下，已抽过的学生扇区变灰
    const EXTRA_SPINS = 6; // 停止前额外转的整圈数，让动画更有仪式感

    let currentRotation = 0; // 累计旋转角度（degree），只增不减，保证动画方向一致
    let spinning = false;
    let photoImages = new Map(); // studentId -> HTMLImageElement 缓存，避免每帧重新解码 base64

    function getEls() {
        return {
            container: document.getElementById('wheel-page-body'),
            canvas: document.getElementById('wheel-canvas'),
            hub: document.getElementById('wheel-hub')
        };
    }

    function loadPhotoImage(student) {
        if (!student.photoDataUrl) return null;
        if (photoImages.has(student.id)) return photoImages.get(student.id);
        const img = new Image();
        img.onload = () => {
            const page = document.getElementById('wheel-page');
            if (page && page.classList.contains('active') && !spinning) drawWheel();
        };
        img.src = student.photoDataUrl;
        photoImages.set(student.id, img);
        return img;
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

        const noRepeat = AppState.getState().settings.noRepeatMode;
        const drawnIds = noRepeat ? new Set(AppState.getDrawnIds()) : null;

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

            // 头像（沿半径方向摆放的小圆形缩略图）
            const photoR = Math.min(22, radius * 0.14);
            const photoDist = radius * 0.62;
            const img = loadPhotoImage(student);

            ctx.save();
            ctx.translate(photoDist, 0);
            ctx.rotate(Math.PI / 2); // 让头像贴合切线方向，避免因扇区旋转而歪斜过头
            ctx.beginPath();
            ctx.arc(0, 0, photoR, 0, Math.PI * 2);
            ctx.closePath();
            ctx.fillStyle = '#fff';
            ctx.fill();
            ctx.save();
            ctx.clip();
            if (img && img.complete && img.naturalWidth > 0) {
                ctx.drawImage(img, -photoR, -photoR, photoR * 2, photoR * 2);
            } else {
                ctx.fillStyle = 'rgba(255,255,255,0.35)';
                ctx.fillRect(-photoR, -photoR, photoR * 2, photoR * 2);
                ctx.fillStyle = '#fff';
                ctx.font = `bold ${photoR}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText((student.name || '?')[0], 0, 1);
            }
            ctx.restore();
            ctx.restore();

            // 姓名文字（沿半径方向排列）
            ctx.fillStyle = '#fff';
            const fontSize = Math.max(10, Math.min(15, 220 / students.length));
            ctx.font = `600 ${fontSize}px "Segoe UI", "Microsoft YaHei", sans-serif`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            const label = student.name.length > 6 ? student.name.slice(0, 6) + '…' : student.name;
            ctx.fillText(label, radius * 0.78, 0);

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

        const autoCloseMs = AppState.getState().settings.winnerAutoCloseMs;
        if (autoCloseMs > 0) {
            autoCloseTimer = setTimeout(close, autoCloseMs);
        }
    }

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
        const winnerMidAngle = winnerIndex * seg + seg / 2; // 相对 0 号扇区起点（正上方）的顺时针角度

        // 目标：转到某个角度后，中奖扇区中心恰好落在正上方（指针处）
        const desiredFinalAngle = (360 - (winnerMidAngle % 360)) % 360;
        const currentMod = ((currentRotation % 360) + 360) % 360;
        let delta = ((desiredFinalAngle - currentMod) % 360 + 360) % 360;

        const durationMs = (AppState.getState().settings.spinDurationMs) || 2000;
        const nextRotation = currentRotation + EXTRA_SPINS * 360 + delta;

        spinning = true;
        hub.classList.add('spinning');

        canvas.style.transition = `transform ${durationMs}ms cubic-bezier(0.12,0.67,0.1,0.99)`;
        canvas.style.transform = `rotate(${nextRotation}deg)`;

        // 正常收尾路径：transitionend 触发时执行一次
        // 兜底路径：极短时长/被打断等极端情况下浏览器有时不会派发 transitionend，
        // 用一个略长于动画时长的 setTimeout 兜底，避免 spinning 卡死导致转盘再也点不动
        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            canvas.removeEventListener('transitionend', onEnd);
            clearTimeout(fallbackTimer);
            currentRotation = nextRotation;
            spinning = false;
            hub.classList.remove('spinning');
            if (noRepeat) AppState.markDrawn(winner.id); // 触发重绘让中奖扇区变灰，不等待也不影响弹窗展示
            DrawHistory.add(winner, SECTOR_COLORS[winnerIndex % SECTOR_COLORS.length]); // 历史条卡片颜色跟当时的扇区颜色保持一致
            showWinnerDialog(winner);
        };
        const onEnd = () => finish();
        canvas.addEventListener('transitionend', onEnd);
        const fallbackTimer = setTimeout(finish, durationMs + 300);
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
