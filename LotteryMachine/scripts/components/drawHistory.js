// drawHistory.js —— 屏幕底部的"抽取历史"条：仅存于内存，刷新/关闭页面即清空，
// 但作为独立于 .page 容器之外的常驻 DOM，切换 抽奖/录入/设置 页面不会丢失
// 全局命名空间：window.DrawHistory

(function () {
    'use strict';

    const MAX_RECORDS = 50;
    const records = []; // { name, photoDataUrl, time: Date }，最新的排在最前面

    let barEl = null;

    function pad(n) { return String(n).padStart(2, '0'); }

    function formatTime(date) {
        return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }

    function ensureBar() {
        if (barEl) return barEl;
        barEl = document.createElement('div');
        barEl.className = 'draw-history-bar';
        barEl.innerHTML = `
            <span class="draw-history-title">🕘 抽取历史</span>
            <div class="draw-history-list" id="draw-history-list"></div>
        `;
        document.body.appendChild(barEl);
        applyVisibility();
        return barEl;
    }

    // 隐藏条件有两个：① settings.hideDrawHistory 用户手动关闭 ② 不在抽奖页时不显示（但记录本身不清空，
    // 切回抽奖页照常能看到之前的记录——这是"只在抽奖页显示"和"切页面不丢数据"两个要求的结合点）
    // 条本身还没创建（还没抽过奖）时无需处理
    function applyVisibility() {
        if (!barEl) return;
        const hiddenBySetting = !!AppState.getState().settings.hideDrawHistory;
        const activePage = document.querySelector('.page.active');
        const onWheelPage = !!activePage && activePage.id === 'wheel-page';
        barEl.classList.toggle('draw-history-bar-hidden', hiddenBySetting || !onWheelPage);
    }

    function render() {
        const list = barEl.querySelector('#draw-history-list');
        if (records.length === 0) {
            list.innerHTML = '<span class="draw-history-empty">暂无抽取记录</span>';
            return;
        }
        list.innerHTML = records.map((r) => {
            // 卡片背景色跟转盘扇区颜色保持一致（由 wheel.js 在抽中时算好传进来），fallback 到中性背景
            const bg = r.color || 'var(--bg-color)';
            const photo = r.photoDataUrl
                ? `<img class="draw-history-photo" src="${r.photoDataUrl}" alt="">`
                : `<div class="draw-history-photo" style="display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;background:rgba(255,255,255,0.3);">${Modal.escapeHtml((r.name || '?')[0])}</div>`;
            return `
                <div class="draw-history-item" style="background:${bg};">
                    ${photo}
                    <div class="draw-history-meta">
                        <div class="draw-history-name" style="color:#fff;">${Modal.escapeHtml(r.name)}</div>
                        <div class="draw-history-time" style="color:rgba(255,255,255,0.85);">${formatTime(r.time)}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // color：抽中那一刻该学生在转盘上的扇区颜色（wheel.js 传入），让历史条卡片和转盘视觉对应
    function add(student, color) {
        ensureBar();
        records.unshift({ name: student.name, photoDataUrl: student.photoDataUrl, time: new Date(), color });
        if (records.length > MAX_RECORDS) records.length = MAX_RECORDS;
        render();
    }

    AppState.subscribe(applyVisibility);

    window.DrawHistory = { add, refreshVisibility: applyVisibility };
})();
