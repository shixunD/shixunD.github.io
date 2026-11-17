// examStudent.js —— 考试「学生趋势」：某学生历次成绩折线（对比班级平均）+ 排名表（每行小眼睛控制该场是否画进折线图）
// 全局命名空间：window.ExamStudent

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);
    const ui = { mode: 'percent' };

    // 折线图里隐藏哪些考试（1.35.0）：成绩表每行前面的小眼睛切换，表头的小眼睛 = 全部显示。
    // 只影响折线图，不影响上面的统计和下面的表格。按班级记在 localStorage（是这台电脑上的查看偏好，不进 state / .db），所有学生共用
    const hiddenKey = () => 'teachingPanel.examTrend.hidden.' + (AppState.getActiveClassId() || '');
    function hiddenSet() {
        try { return new Set(JSON.parse(Utils.lsGet(hiddenKey(), '[]'))); } catch (e) { return new Set(); }
    }
    function saveHidden(set) { Utils.lsSet(hiddenKey(), JSON.stringify([...set])); }
    const EYE = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
    const EYE_OFF = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" stroke-width="2"/></svg>';

    function render(view) {
        const students = AppState.getStudents();
        if (!students.length) { view.innerHTML = `<div class="card">${UI.emptyStudentsHint()}</div>`; return; }
        const id = StudentTrend.currentId();

        view.innerHTML = `
            <div class="toolbar card">
                <button type="button" class="btn-toggle ${ui.mode === 'raw' ? 'btn-toggle-on' : ''}" data-mode="raw">原始分</button>
                <button type="button" class="btn-toggle ${ui.mode === 'percent' ? 'btn-toggle-on' : ''}" data-mode="percent">得分率</button>
            </div>
            <div class="card">${summaryHtml(id, {}, ui.mode)}</div>
        `;
        view.querySelectorAll('[data-mode]').forEach((btn) => btn.addEventListener('click', () => { ui.mode = btn.dataset.mode; render(view); }));
        // 小眼睛：每行切换这场考试在折线图里显示 / 隐藏；表头的 = 全部显示
        view.querySelectorAll('[data-eye-exam]').forEach((btn) => btn.addEventListener('click', () => {
            const set = hiddenSet();
            const eid = btn.dataset.eyeExam;
            if (set.has(eid)) set.delete(eid); else set.add(eid);
            saveHidden(set);
            render(view);
        }));
        const all = view.querySelector('[data-eye-all]');
        if (all) all.addEventListener('click', () => { saveHidden(new Set()); render(view); });
        // 表格里的考试名：跳到考试页该场考试，并让该学生的成绩行闪三秒
        view.querySelectorAll('[data-jump-exam]').forEach((el) => {
            el.addEventListener('click', () => { BackJump.mark(id); ExamsPage.jumpTo(el.dataset.jumpExam, id); });
        });
    }

    // mode: 'percent'（得分率，不同满分的考试可比较）| 'raw'（原始分）
    function summaryHtml(studentId, filter, mode) {
        const hist = ExamModel.studentHistory(studentId, filter);
        if (!hist.length) return '<div class="empty-message">暂无考试记录</div>';
        const pct = mode !== 'raw';
        const val = (v, exam) => (v == null ? null : pct ? (v / exam.fullScore) * 100 : v);
        const taken = hist.filter((h) => h.score != null);
        const avgPct = taken.length ? taken.reduce((n, h) => n + h.score / h.exam.fullScore, 0) / taken.length : null;
        const ranked = taken.filter((h) => h.rank);
        const avgRank = ranked.length ? ranked.reduce((n, h) => n + h.rank, 0) / ranked.length : null;
        const last = taken[taken.length - 1];
        const prev = taken[taken.length - 2];
        const trend = last && prev ? (last.score / last.exam.fullScore - prev.score / prev.exam.fullScore) * 100 : null;
        const hidden = hiddenSet();
        const shown = hist.filter((h) => !hidden.has(h.exam.id));
        const hiddenHere = hist.length - shown.length;   // 这个学生的考试里被隐藏了几场

        return `
            <div class="stat-row">
                ${UI.statTile('参加考试', `${taken.length}/${hist.length}`)}
                ${UI.statTile('平均得分率', avgPct == null ? '-' : `${Math.round(avgPct * 100)}%`)}
                ${UI.statTile('平均班级排名', avgRank == null ? '-' : Utils.formatNumber(avgRank, 1))}
                ${UI.statTile('较上次', trend == null ? '-' : `${trend >= 0 ? '↑' : '↓'} ${Utils.formatNumber(Math.abs(trend), 1)}%`, '得分率变化', trend == null ? null : trend >= 0 ? '#1e8e3e' : '#d93025')}
            </div>
            <div class="exam-trend-split">
            ${shown.length ? SvgChart.line({
                labels: shown.map((h) => Utils.formatDate(h.exam.date)),
                series: [
                    { name: '本人', color: 'var(--primary-color)', values: shown.map((h) => val(h.score, h.exam)) },
                    { name: '班级平均', color: '#9ca3af', dashed: true, values: shown.map((h) => val(h.avg, h.exam)) }
                ],
                yMin: pct ? 0 : undefined,
                yMax: pct ? 100 : undefined,
                height: 240,
                yFormat: (v) => pct ? `${Math.round(v)}%` : Utils.formatNumber(v, 0)
            }) : '<div class="chart-empty">考试都隐藏了，点表格左上角的小眼睛全部显示</div>'}
            <table class="simple-table exam-trend-table">
                <thead><tr><th class="eye-col"><button type="button" class="eye-btn" data-eye-all ${hiddenHere ? '' : 'disabled'} title="${hiddenHere ? `折线图里隐藏了 ${hiddenHere} 场，点击全部显示` : '全部考试都在折线图里显示'}" aria-label="全部显示">${EYE}</button></th><th>日期</th><th>考试</th><th>成绩</th><th>班级平均</th><th>班级排名</th><th>年级排名</th></tr></thead>
                <tbody>${hist.slice().reverse().map((h) => { const off = hidden.has(h.exam.id); return `<tr class="${off ? 'exam-row-off' : ''}">
                    <td class="eye-col"><button type="button" class="eye-btn${off ? ' eye-off' : ''}" data-eye-exam="${h.exam.id}" title="${off ? '折线图里已隐藏，点击显示' : '点击在折线图里隐藏这场考试'}" aria-label="${off ? '显示' : '隐藏'}" aria-pressed="${off ? 'false' : 'true'}">${off ? EYE_OFF : EYE}</button></td>
                    <td>${Utils.formatDate(h.exam.date)}</td>
                    <td><button type="button" class="record-jump" data-jump-exam="${h.exam.id}" title="跳到考试页该场考试">${esc(h.exam.name)}</button></td>
                    <td>${h.score == null ? '<span class="hint">缺考</span>' : `<b>${ExamModel.formatScore(h.score)}</b> / ${h.exam.fullScore}`}</td>
                    <td>${Utils.formatNumber(h.avg, 1)}</td>
                    <td>${h.rank ? `${h.rank}/${h.count}` : '-'}</td>
                    <td>${h.score == null ? '-' : (h.gradeRank || 'NA')}</td>
                </tr>`; }).join('')}</tbody>
            </table>
            </div>`;
    }

    window.ExamStudent = { render, summaryHtml };
})();
