// student.js —— 背诵「学生趋势」视图
// 全局命名空间：window.RecitationStudent

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);
    function render(view) {
        const students = AppState.getStudents();
        if (!students.length) { view.innerHTML = `<div class="card">${UI.emptyStudentsHint()}</div>`; return; }
        const id = StudentTrend.currentId();

        view.innerHTML = `
            ${StudentTrend.pickerHtml('recitation')}
            <div class="card">${summaryHtml(id, true)}</div>
        `;
        StudentTrend.bind(view, () => render(view));
        view.querySelectorAll('[data-check-round]').forEach((btn) => {
            btn.addEventListener('click', () => RecitationDialogs.openCheck(btn.dataset.checkRound, id));
        });
    }

    function summaryHtml(studentId, full) {
        const rows = RecitationModel.studentOverview(studentId);
        if (!rows.length) return '<div class="empty-message">暂无背诵轮次</div>';
        const passed = rows.filter((r) => RecitationModel.isPassed(r.status)).length;
        const pending = rows.filter((r) => r.status === 'retry' || r.status === 'fail').length;
        const unchecked = rows.filter((r) => r.status === 'none').length;
        const passedRows = rows.filter((r) => r.firstPassDate);
        const avgAttempts = passedRows.length
            ? passedRows.reduce((n, r) => n + r.attemptsToPass, 0) / passedRows.length : null;
        const R = RecitationModel.RESULT_MAP;
        const allChecks = [];
        rows.forEach((r) => r.checks.forEach((c) => allChecks.push({ round: r.round, check: c })));
        allChecks.sort((a, b) => b.check.date.localeCompare(a.check.date) || (b.check.createdAt || 0) - (a.check.createdAt || 0));

        return `
            <div class="stat-row">
                ${UI.statTile('已过关', `${passed}/${rows.length}`, null, R.pass.color)}
                ${UI.statTile('需重新过关/未过关', pending, null, pending ? R.fail.color : null)}
                ${UI.statTile('未检查', unchecked)}
                ${UI.statTile('平均几次过关', avgAttempts == null ? '-' : Utils.formatNumber(avgAttempts, 1))}
            </div>
            <h3 class="section-title">各轮次情况</h3>
            <table class="simple-table">
                <thead><tr><th>轮次</th><th>状态</th><th>下一次安排</th><th>检查次数</th><th>首次过关</th><th>用时</th>${full ? '<th></th>' : ''}</tr></thead>
                <tbody>
                    ${rows.map((r) => `<tr>
                        <td>${esc(r.round.title)}${r.round.archived ? ' <span class="hint">(归档)</span>' : ''}</td>
                        <td>${RecitationDialogs.statusPill(r.status)}</td>
                        <td>${arrangementText(r.round.id, studentId)}</td>
                        <td>${r.attempts || '-'}</td>
                        <td>${r.firstPassDate ? Utils.formatDate(r.firstPassDate) : '-'}</td>
                        <td>${r.daysToPass == null ? '-' : r.daysToPass === 0 ? '当天' : `${r.daysToPass} 天`}</td>
                        ${full ? `<td><button type="button" class="btn-secondary btn-sm" data-check-round="${r.round.id}">检查</button></td>` : ''}
                    </tr>`).join('')}
                </tbody>
            </table>
            <h3 class="section-title">检查历史</h3>
            ${allChecks.length ? `<ul class="check-timeline">${allChecks.map(({ round, check }) => `
                <li class="check-item" style="--dot-color:${(R[check.result] || {}).color || '#9aa0a6'}">
                    <div class="check-item-head">
                        ${RecitationDialogs.statusPill(check.result)}
                        <span class="check-item-round">${esc(round.title)}</span>
                        <span class="record-date">${Utils.formatDate(check.date)}</span>
                    </div>
                    ${check.note ? `<div class="check-comment"><span class="check-comment-icon">💬</span>${esc(check.note)}</div>` : ''}
                </li>`).join('')}</ul>`
                : '<div class="hint">还没有检查记录</div>'}
        `;
    }

    function arrangementText(roundId, studentId) {
        const next = RecitationModel.nextArrangement(roundId, studentId);
        if (!next) return '-';
        const what = '🗓️ 计划';
        return `<span class="${next.overdue ? 'text-danger' : ''}">${what} ${Utils.formatDate(next.date)}${next.overdue ? '（已逾期）' : ''}</span>`;
    }

    window.RecitationStudent = { render, summaryHtml };
})();
