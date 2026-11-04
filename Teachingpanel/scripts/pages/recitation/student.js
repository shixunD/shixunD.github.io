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
            <div class="card">${summaryHtml(id, true)}</div>
        `;
        // 点时间轴的块：跳到该轮次最近一条记录的检查历史，并闪两次定位
        view.querySelectorAll('[data-jump-round]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const rid = btn.dataset.jumpRound;
                const target = view.querySelector(`.check-item[data-hist-round="${rid}"][data-hist-kind="check"]`)
                    || view.querySelector(`.check-item[data-hist-round="${rid}"]`);
                if (!target) { Toast.info('这一轮还没有检查记录'); return; }
                target.scrollIntoView({ block: 'center' });
                target.classList.remove('flash-locate');
                void target.offsetWidth;   // 重新触发动画
                target.classList.add('flash-locate');
                setTimeout(() => target.classList.remove('flash-locate'), 1400);
            });
        });
    }

    // 按周（周一起）分组：不同周的记录各用一条竖线，不连在一起；allChecks 已按日期倒序
    function weekGroups(list) {
        const groups = [];
        list.forEach((it) => {
            const d = new Date(it.check.date + 'T00:00:00');
            d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
            const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            let g = groups[groups.length - 1];
            if (!g || g.key !== key) { g = { key, items: [] }; groups.push(g); }
            g.items.push(it);
        });
        return groups;
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
        // 计划背诵也放进检查历史（时间轴上不画）
        rows.forEach((r) => RecitationModel.plansFor(r.round.id, studentId).forEach((p) => allChecks.push({ round: r.round, plan: p, check: p })));
        allChecks.sort((a, b) => b.check.date.localeCompare(a.check.date) || (!!a.plan - !!b.plan) || (b.check.createdAt || 0) - (a.check.createdAt || 0));

        return `
            <div class="stat-row">
                ${UI.statTile('已过关', `${passed}/${rows.length}`, null, R.pass.color)}
                ${UI.statTile('需重新过关/未过关', pending, null, pending ? R.fail.color : null)}
                ${UI.statTile('未检查', unchecked)}
                ${UI.statTile('平均几次过关', avgAttempts == null ? '-' : Utils.formatNumber(avgAttempts, 1))}
            </div>
            <div class="count-chips">
                ${[...RecitationModel.RESULTS, RecitationModel.NONE].map((s) => `<span class="status-pill" style="background:${s.color};color:${s.text}">${esc(s.label)} ${rows.filter((r) => r.status === s.key).length}</span>`).join('')}
            </div>
            <h3 class="section-title">时间轴（旧 → 新）</h3>
            <div class="strip">
                ${rows.map((r) => {
                    const s = R[r.status] || RecitationModel.NONE;
                    const next = RecitationModel.nextArrangement(r.round.id, studentId);
                    const tip = `${r.round.title} · ${s.label} · 检查 ${r.attempts || 0} 次` + (r.firstPassDate ? ` · 首次过关 ${Utils.formatDate(r.firstPassDate)}` : '') + (r.daysToPass == null ? '' : r.daysToPass === 0 ? ' · 当天过关' : ` · 用时 ${r.daysToPass} 天`) + (next ? ` · 下一次 ${Utils.formatDate(next.date)}${next.overdue ? '（已逾期）' : ''}` : '');
                    return full
                        ? `<button type="button" class="strip-cell strip-btn" style="background:${s.color}" data-jump-round="${r.round.id}" title="${esc(tip)}（点击跳到检查历史）"></button>`
                        : `<span class="strip-cell" style="background:${s.color}" title="${esc(tip)}"></span>`;
                }).join('')}
            </div>
            <h3 class="section-title">检查历史</h3>
            ${allChecks.length ? weekGroups(allChecks).map((g) => `<div class="check-week"><ul class="check-timeline">${g.items.map(({ round, check, plan }) => `
                <li class="check-item" data-hist-round="${round.id}" data-hist-kind="${plan ? 'plan' : 'check'}" style="--dot-color:${plan ? RecitationModel.PLAN.accent : (R[check.result] || {}).color || '#9aa0a6'}">
                    <div class="check-item-head">
                        ${plan ? RecitationDialogs.planPill() : RecitationDialogs.statusPill(check.result)}
                        <span class="check-item-round">${esc(round.title)}</span>
                        <span class="record-date">${Utils.formatDate(check.date)}</span>
                    </div>
                    ${plan && RecitationModel.isPlanDone(plan) ? '<div class="hint">✓ 已检查</div>' : ''}
                    ${check.note ? `<div class="check-comment"><span class="check-comment-icon">💬</span>${esc(check.note)}</div>` : ''}
                    ${Photos.viewHtml(check.photoIds)}
                </li>`).join('')}</ul></div>`).join('')
                : '<div class="hint">还没有检查记录</div>'}
        `;
    }

    window.RecitationStudent = { render, summaryHtml };
})();
