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
        // 检查历史里的任务名 / 日期：跳到背诵页该轮次，并让该学生的卡片闪三秒
        view.querySelectorAll('[data-jump-rec]').forEach((el) => {
            el.addEventListener('click', () => { BackJump.mark(id); RecitationPage.jumpTo(el.dataset.jumpRec, id); });
        });
    }

    // 按背诵任务规定的周（轮次的 weekStart，不是检查日期）分组：周新→旧，相邻两周之间画虚线；allChecks 已按任务设定日期倒序
    function weekGroups(list) {
        const map = new Map();
        list.forEach((it) => {
            const key = RecitationModel.roundWeek(it.round);
            if (!map.has(key)) map.set(key, { key, items: [] });
            map.get(key).items.push(it);
        });
        const groups = [...map.values()].sort((x, y) => y.key.localeCompare(x.key));
        groups.forEach((g, i) => { g.split = i > 0; });
        return groups;
    }

    // 一周内再按背诵任务（轮次）分开：同一任务的记录用一条竖线串起来，不同任务各一条线（按各任务最新一条的先后排）
    function roundRuns(items) {
        const map = new Map();
        items.forEach((it) => {
            if (!map.has(it.round.id)) map.set(it.round.id, []);
            map.get(it.round.id).push(it);
        });
        return [...map.values()];
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
        // 按背诵任务设定的日期新→旧；同一天的任务按创建先后；同一任务内按检查日期新→旧（计划排在同日检查之后）
        allChecks.sort((a, b) => RecitationModel.roundDay(b.round).localeCompare(RecitationModel.roundDay(a.round))
            || (b.round.createdAt || 0) - (a.round.createdAt || 0) || (a.round.id < b.round.id ? -1 : a.round.id > b.round.id ? 1 : 0)
            || b.check.date.localeCompare(a.check.date) || (!!a.plan - !!b.plan) || (b.check.createdAt || 0) - (a.check.createdAt || 0));

        return `
            <div class="stat-row">
                ${UI.statTile('已过关', `${passed}/${rows.length}`, null, R.pass.color)}
                ${UI.statTile('重新过关/未过关', pending, null, pending ? R.fail.color : null)}
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
            ${allChecks.length ? weekGroups(allChecks).map((g) => `<div class="check-week${g.split ? ' check-week-split' : ''}">${roundRuns(g.items).map((run) => `<ul class="check-timeline"><li class="check-timeline-title"><button type="button" class="record-jump" data-jump-rec="${run[0].round.id}" title="跳到背诵页该轮次">${esc(run[0].round.title)}</button></li>${run.map(({ round, check, plan }) => `
                <li class="check-item" data-hist-round="${round.id}" data-hist-kind="${plan ? 'plan' : 'check'}" style="--dot-color:${plan ? RecitationModel.PLAN.accent : (R[check.result] || {}).color || '#9aa0a6'}">
                    <div class="check-item-head">
                        ${plan ? RecitationDialogs.planPill() : RecitationDialogs.statusPill(check.result)}
                        <span class="record-date">${Utils.formatDate(check.date)}</span>
                    </div>
                    ${check.note ? `<div class="check-comment"><span class="check-comment-icon">💬</span>${esc(check.note)}</div>` : ''}
                    ${Photos.viewHtml(check.photoIds)}
                </li>`).join('')}</ul>`).join('')}</div>`).join('')
                : '<div class="hint">还没有检查记录</div>'}
        `;
    }

    window.RecitationStudent = { render, summaryHtml };
})();
