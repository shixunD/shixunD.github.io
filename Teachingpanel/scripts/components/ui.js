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

    // 学生姓名：点击打开学生档案（全局委托监听在 studentProfile.js 顶层注册一次）
    function studentLink(stu) {
        return `<button type="button" class="student-link" data-profile-id="${stu.id}">${esc(stu.name)}</button>`;
    }

    function legend(items) {
        return `<div class="legend">${items.map((it) => `
            <span class="legend-item"><i style="background:${it.color}"></i>${esc(it.label)}</span>
        `).join('')}</div>`;
    }

    function studentOptions(selectedId) {
        return AppState.getStudents().map((s) => `
            <option value="${s.id}" ${s.id === selectedId ? 'selected' : ''}>${esc(s.studentNo ? s.studentNo + ' ' : '')}${esc(s.name)}</option>
        `).join('');
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

    window.UI = { subTabs, studentLink, legend, studentOptions, emptyStudentsHint, statTile };
})();
