// ui.js —— 各页面共用的小片段：页内二级标签栏、学生姓名链接、色块图例、统计块
// 全局命名空间：window.UI

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);

    // 页内二级标签栏：tabs = [{key, label}]，用 data-subtab 区分，由页面自行绑定点击
    function subTabs(tabs, activeKey) {
        return `<div class="sub-tabs">${tabs.map((t) => `
            <button type="button" class="sub-tab ${t.key === activeKey ? 'active' : ''}" data-subtab="${t.key}">${esc(t.label)}</button>
        `).join('')}</div>`;
    }

    // 学生姓名：点击跳到该生的学生趋势（全局委托监听在 studentTrend.js 顶层注册一次）
    function studentLink(stu) {
        return `<button type="button" class="student-link" data-profile-id="${stu.id}">${esc(stu.name)}</button>`;
    }

    function legend(items) {
        return `<div class="legend">${items.map((it) => `
            <span class="legend-item"><i style="background:${it.color}"></i>${esc(it.label)}</span>
        `).join('')}</div>`;
    }

    function emptyStudentsHint() {
        return `<div class="empty-message">当前班级还没有学生，请先到「主页」添加学生。</div>`;
    }

    function statTile(label, value, sub, color) {
        return `<div class="stat-tile"${color ? ` style="--tile-color:${color}"` : ''}>
            <div class="stat-value">${esc(value)}</div>
            <div class="stat-label">${esc(label)}</div>
            ${sub ? `<div class="stat-sub">${esc(sub)}</div>` : ''}
        </div>`;
    }

    // 侧栏列表拖动排序（作业、背诵轮次共用）：落在某项上半部分 = 插到它前面，下半部分 = 插到它后面。
    // root 内的 .side-item[data-select] 需要 draggable="true"；move(id, beforeId|null, done) 里完成保存后重绘
    function bindSideDrag(root, move) {
        const items = Array.from(root.querySelectorAll('.side-item[data-select]'));
        let dragId = null;
        const clear = () => items.forEach((el) => el.classList.remove('drag-before', 'drag-after', 'dragging'));
        const isAfter = (e, el) => e.clientY > el.getBoundingClientRect().top + el.offsetHeight / 2;
        items.forEach((el, i) => {
            el.addEventListener('dragstart', (e) => {
                dragId = el.dataset.select;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', dragId);
                el.classList.add('dragging');
            });
            el.addEventListener('dragend', () => { dragId = null; clear(); });
            el.addEventListener('dragover', (e) => {
                if (!dragId || dragId === el.dataset.select) return;
                e.preventDefault();
                items.forEach((x) => x.classList.remove('drag-before', 'drag-after'));
                el.classList.add(isAfter(e, el) ? 'drag-after' : 'drag-before');
            });
            el.addEventListener('drop', async (e) => {
                if (!dragId || dragId === el.dataset.select) return;
                e.preventDefault();
                const next = isAfter(e, el) ? items[i + 1] : el;
                const id = dragId;
                dragId = null;
                clear();
                await move(id, next ? next.dataset.select : null);
            });
        });
    }

    // 所有日期输入框：点输入框任意位置（不只是右边的日历图标）都弹出日历。
    // showPicker() 需要用户手势，不支持或被拒绝时静默忽略（仍可点图标 / 键盘输入）；全局委托只注册一次
    document.addEventListener('click', (e) => {
        const input = e.target;
        if (!(input instanceof HTMLInputElement) || input.type !== 'date' || input.disabled || input.readOnly) return;
        try { input.showPicker(); } catch (err) { /* 不支持 showPicker 或已打开：忽略 */ }
    });

    window.UI = { bindSideDrag, subTabs, studentLink, legend, emptyStudentsHint, statTile };
})();
