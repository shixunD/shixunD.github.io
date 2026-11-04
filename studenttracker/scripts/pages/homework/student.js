// student.js —— 作业「学生趋势」视图；summaryHtml() 同时供学生档案（StudentProfile）复用
// 全局命名空间：window.HomeworkStudent

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);
    const ui = { studentId: null };

    function render(view) {
        const students = AppState.getStudents();
        if (!students.length) { view.innerHTML = `<div class="card">${UI.emptyStudentsHint()}</div>`; return; }
        if (!students.some((s) => s.id === ui.studentId)) ui.studentId = students[0].id;

        view.innerHTML = `
            <div class="toolbar card">
                <select data-f-student>${UI.studentOptions(ui.studentId)}</select>
                <button type="button" class="btn-secondary btn-sm" data-profile-id="${ui.studentId}">查看完整档案</button>
            </div>
            <div class="card">${summaryHtml(ui.studentId, {}, true)}</div>
        `;
        view.querySelector('[data-f-student]').addEventListener('change', (e) => { ui.studentId = e.target.value; render(view); });
    }

    // full 参数保留给调用方区分页面视图/学生档案（目前两者内容相同）
    function summaryHtml(studentId, filter, full) {
        const st = HomeworkModel.studentStats(studentId, filter);
        if (!st.total) return '<div class="empty-message">暂无作业记录</div>';
        const S = HomeworkModel.STATUS_MAP;
        const weekly = HomeworkModel.weeklyRates(studentId, filter);
        const comments = st.timeline.filter((x) => x.rec.comment || x.rec.status !== 'done').reverse();

        return `
            <div class="stat-row">
                ${UI.statTile('作业总数', st.total)}
                ${UI.statTile('按时完成率', st.onTimeRate == null ? '-' : Utils.percent(st.counts.done, st.total), null, S.done.color)}
                ${UI.statTile('最终完成率', Utils.percent(st.counts.done + st.counts.missing_fixed + st.counts.poor_fixed, st.total), '含补上', S.missing_fixed.color)}
                ${UI.statTile('仍未补上', st.outstanding, null, st.outstanding ? S.missing.color : null)}
            </div>
            <div class="count-chips">
                ${HomeworkModel.STATUSES.map((s) => `<span class="status-pill" style="background:${s.color};color:${s.text}">${esc(s.label)} ${st.counts[s.key]}</span>`).join('')}
            </div>
            <h3 class="section-title">时间轴（旧 → 新）</h3>
            <div class="strip">
                ${st.timeline.map(({ hw, rec }) => {
                    const s = S[rec.status];
                    return `<span class="strip-cell" style="background:${s.color}" title="${Utils.formatDate(hw.date)} ${esc(hw.title)} · ${esc(s.label)}${rec.comment ? '：' + esc(rec.comment) : ''}"></span>`;
                }).join('')}
            </div>
            ${weekly.length > 1 ? `<h3 class="section-title">每周按时完成率</h3>
                ${SvgChart.line({ labels: weekly.map((w) => w.label), series: [{ name: '按时完成率', color: S.done.color, values: weekly.map((w) => w.rate * 100) }], yMin: 0, yMax: 100, height: 200, yFormat: (v) => `${Math.round(v)}%` })}` : ''}
            <h3 class="section-title">问题记录与 comment</h3>
            ${comments.length ? `<ul class="record-list">${comments.map(({ hw, rec }) => {
                const s = S[rec.status];
                return `<li><span class="status-pill" style="background:${s.color};color:${s.text}">${esc(s.short)}</span>
                    <span class="record-date">${Utils.formatDate(hw.date)}</span> ${esc(hw.title)}
                    ${rec.comment ? `<div class="record-comment">💬 ${esc(rec.comment)}</div>` : ''}</li>`;
            }).join('')}</ul>` : '<div class="hint">没有问题记录，表现很好 👍</div>'}
        `;
    }

    function setStudent(id) { ui.studentId = id; }

    window.HomeworkStudent = { render, summaryHtml, setStudent };
})();
