// examStudent.js —— 考试「学生看板」：某学生历次成绩折线（对比班级平均）+ 排名表
// 全局命名空间：window.ExamStudent

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);
    const ui = { mode: 'percent' };

    function render(view) {
        const students = AppState.getStudents();
        if (!students.length) { view.innerHTML = `<div class="card">${UI.emptyStudentsHint()}</div>`; return; }
        const id = StudentTrend.currentId();

        view.innerHTML = `
            ${StudentTrend.pickerHtml('exams')}
            <div class="toolbar card">
                <button type="button" class="btn-toggle ${ui.mode === 'percent' ? 'btn-toggle-on' : ''}" data-mode="percent">得分率</button>
                <button type="button" class="btn-toggle ${ui.mode === 'raw' ? 'btn-toggle-on' : ''}" data-mode="raw">原始分</button>
            </div>
            <div class="card">${summaryHtml(id, {}, ui.mode)}</div>
        `;
        StudentTrend.bind(view, () => render(view));
        view.querySelectorAll('[data-mode]').forEach((btn) => btn.addEventListener('click', () => { ui.mode = btn.dataset.mode; render(view); }));
    }

    // mode: 'percent'（得分率，不同满分的考试可比较）| 'raw'（原始分）
    function summaryHtml(studentId, filter, mode) {
        const hist = ExamModel.studentHistory(studentId, filter);
        if (!hist.length) return '<div class="empty-message">暂无考试记录</div>';
        const pct = mode !== 'raw';
        const val = (v, exam) => (v == null ? null : pct ? (v / exam.fullScore) * 100 : v);
        const taken = hist.filter((h) => h.score != null);
        const avgPct = taken.length ? taken.reduce((n, h) => n + h.score / h.exam.fullScore, 0) / taken.length : null;
        const last = taken[taken.length - 1];
        const prev = taken[taken.length - 2];
        const trend = last && prev ? (last.score / last.exam.fullScore - prev.score / prev.exam.fullScore) * 100 : null;

        return `
            <div class="stat-row">
                ${UI.statTile('参加考试', `${taken.length}/${hist.length}`)}
                ${UI.statTile('平均得分率', avgPct == null ? '-' : `${Math.round(avgPct * 100)}%`)}
                ${UI.statTile('最近一次名次', last && last.rank ? `${last.rank}/${last.count}` : '-')}
                ${UI.statTile('较上次', trend == null ? '-' : `${trend >= 0 ? '↑' : '↓'} ${Utils.formatNumber(Math.abs(trend), 1)}%`, '得分率变化', trend == null ? null : trend >= 0 ? '#1e8e3e' : '#d93025')}
            </div>
            ${SvgChart.line({
                labels: hist.map((h) => Utils.formatDate(h.exam.date)),
                series: [
                    { name: '本人', color: 'var(--primary-color)', values: hist.map((h) => val(h.score, h.exam)) },
                    { name: '班级平均', color: '#9ca3af', dashed: true, values: hist.map((h) => val(h.avg, h.exam)) }
                ],
                yMin: pct ? 0 : undefined,
                yMax: pct ? 100 : undefined,
                height: 240,
                yFormat: (v) => pct ? `${Math.round(v)}%` : Utils.formatNumber(v, 0)
            })}
            <table class="simple-table">
                <thead><tr><th>日期</th><th>考试</th><th>成绩</th><th>班级平均</th><th>名次</th></tr></thead>
                <tbody>${hist.slice().reverse().map((h) => `<tr>
                    <td>${Utils.formatDate(h.exam.date)}</td>
                    <td>${esc(h.exam.name)}</td>
                    <td>${h.score == null ? '<span class="hint">缺考</span>' : `<b>${ExamModel.formatScore(h.score)}</b> / ${h.exam.fullScore}`}</td>
                    <td>${Utils.formatNumber(h.avg, 1)}</td>
                    <td>${h.rank ? `${h.rank}/${h.count}` : '-'}</td>
                </tr>`).join('')}</tbody>
            </table>`;
    }

    window.ExamStudent = { render, summaryHtml };
})();
