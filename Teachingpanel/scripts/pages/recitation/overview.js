// overview.js —— 背诵「⏰ 时间看板」（背诵计划日程）与「总览」（学生 × 轮次矩阵）
// 全局命名空间：window.RecitationOverview

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);
    const ui = { includeArchived: false, horizon: 'all' };

    // ---------- 时间看板 ----------
    // 内容 = 所有未完成的背诵计划（1.9.0 起"需重新过关/未过关"不再带日期，哪天再背都用计划表示）。
    // 已逾期（计划日期已过仍未检查）置顶；之后按日期分组列出今天起的全部安排（默认不限天数，可切到只看未来 7/14/30 天）。

    const HORIZONS = [
        { key: 'all', label: '全部未来安排' },
        { key: '7', label: '未来 7 天' },
        { key: '14', label: '未来 14 天' },
        { key: '30', label: '未来 30 天' }
    ];

    function renderTimeline(view) {
        const today = Utils.today();
        const end = ui.horizon === 'all' ? null : Utils.addDays(today, Number(ui.horizon));
        const items = RecitationModel.schedule();
        const overdue = items.filter((x) => x.overdue).sort((a, b) => a.nextDate.localeCompare(b.nextDate));

        const byDate = {};
        let later = 0;
        items.filter((x) => !x.overdue).forEach((x) => {
            x.dates.filter((d) => d >= today).forEach((d) => {
                if (end && d > end) { later++; return; }
                (byDate[d] = byDate[d] || []).push(x);
            });
        });
        const dates = Object.keys(byDate).sort();
        const todayCount = (byDate[today] || []).length;
        const planCount = items.filter((x) => x.type === 'plan' && !x.overdue).length;

        view.innerHTML = `
            <div class="toolbar card">
                <span class="toolbar-info">今天 <b>${todayCount}</b> 人次 · 已逾期 <b class="${overdue.length ? 'text-danger' : ''}">${overdue.length}</b> 人次 · 计划中 <b>${planCount}</b> 人次</span>
                <select data-horizon>
                    ${HORIZONS.map((h) => `<option value="${h.key}" ${h.key === ui.horizon ? 'selected' : ''}>${h.label}</option>`).join('')}
                </select>
                <span class="hint">每条右侧显示该生当前状态</span>
            </div>
            ${overdue.length ? section('⚠ 已逾期', 'overdue', overdue, true) : ''}
            ${dates.map((d) => section(`${Utils.formatDate(d)} · ${Utils.relativeDay(d)}`, d === today ? 'today' : '', byDate[d], false)).join('')}
            ${later ? `<div class="hint">另有 ${later} 人次安排在所选范围之后</div>` : ''}
            ${!overdue.length && !dates.length ? '<div class="card empty-message">还没有安排。可以在「🗓️ 计划背诵」里安排学生哪天背，或在检查时顺便选「哪天再背」。</div>' : ''}
        `;

        view.querySelector('[data-horizon]').addEventListener('change', (e) => { ui.horizon = e.target.value; renderTimeline(view); });
        view.querySelectorAll('[data-check-round]').forEach((btn) => {
            btn.addEventListener('click', () => RecitationDialogs.openCheck(btn.dataset.checkRound, btn.dataset.checkSid));
        });
        view.querySelectorAll('[data-cancel-plan]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const ok = await Modal.confirm({ title: '取消计划', text: '确定取消这条背诵计划吗？', confirmText: '取消计划', cancelText: '保留', danger: true });
                if (ok) await RecitationModel.removePlan(btn.dataset.cancelPlan);
            });
        });
    }

    function section(title, cls, list, showDate) {
        return `
            <div class="card timeline-day ${cls}">
                <div class="timeline-day-head">${esc(title)} <span class="timeline-count">${list.length}</span></div>
                <div class="timeline-items">
                    ${list.map((x) => {
                        // 最新一次检查的备注（例如没过关的原因）
                        const note = x.check && x.check.note ? x.check.note : '';
                        return `
                        <div class="timeline-item">
                            ${RecitationDialogs.planPill()}
                            ${UI.studentLink(x.student)}
                            <span class="timeline-round">${esc(x.round.title)}</span>
                            ${showDate ? `<span class="hint">计划于 ${Utils.formatDate(x.nextDate)} · ${Utils.relativeDay(x.nextDate)}</span>` : ''}
                            ${RecitationDialogs.statusPill(RecitationModel.statusOf(x.round.id, x.student.id))}
                            ${note ? `<span class="hint">💬 ${esc(note)}</span>` : ''}
                            <button type="button" class="btn-secondary btn-sm" data-cancel-plan="${x.plan.id}">取消计划</button>
                            <button type="button" class="btn-primary btn-sm" data-check-round="${x.round.id}" data-check-sid="${x.student.id}">检查</button>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
    }

    // ---------- 总览（所有轮次） ----------

    function renderOverview(view) {
        const students = AppState.getStudents();
        const rounds = RecitationModel.rounds({ includeArchived: ui.includeArchived }).slice().reverse();
        const R = RecitationModel.RESULT_MAP;

        let body;
        if (!students.length) body = UI.emptyStudentsHint();
        else if (!rounds.length) body = '<div class="empty-message">还没有背诵轮次</div>';
        else {
            body = `
                <div class="matrix-scroll">
                    <table class="matrix">
                        <thead><tr>
                            <th class="sticky-col">学生</th>
                            ${rounds.map((r) => {
                                const c = RecitationModel.roundSummary(r.id, students);
                                return `<th class="matrix-col-head" title="${esc(r.title)}">
                                    <button type="button" class="matrix-head-btn" data-open-round="${r.id}">
                                        <span class="mh-title">${esc(r.title)}</span>
                                        <span class="mh-rate">${Utils.percent(c.pass, students.length)}</span>
                                    </button></th>`;
                            }).join('')}
                            <th>过关</th>
                        </tr></thead>
                        <tbody>
                            ${students.map((stu) => {
                                let passed = 0;
                                const cells = rounds.map((r) => {
                                    const checks = RecitationModel.checksFor(r.id, stu.id);
                                    const key = RecitationModel.statusOf(r.id, stu.id);
                                    if (key === 'pass') passed++;
                                    // 色块按该生在这一轮所有检查记录的结果数量分段：过关(绿) / 需重新过关(黄) / 未过关(红)，从左到右按数量比例占宽度
                                    const n = { pass: 0, retry: 0, fail: 0 };
                                    checks.forEach((c) => { if (n[c.result] != null) n[c.result]++; });
                                    const segs = ['pass', 'retry', 'fail'].filter((k) => n[k])
                                        .map((k) => `<span style="flex:${n[k]};background:${R[k].color}"></span>`).join('');
                                    const tip = checks.length
                                        ? `过关 ${n.pass} · 需重新过关 ${n.retry} · 未过关 ${n.fail}（当前：${R[key].label}）`
                                        : '未检查';
                                    return `<td><button type="button" class="cell cell-text cell-bar ${checks.length ? '' : 'cell-empty'}"
                                        data-round="${r.id}" data-sid="${stu.id}" title="${esc(r.title)} · ${esc(tip)}">${segs}${checks.length ? `<b class="cell-count">${checks.length}</b>` : ''}</button></td>`;
                                }).join('');
                                return `<tr><th class="sticky-col"><span class="row-no">${esc(stu.studentNo)}</span>${UI.studentLink(stu)}</th>${cells}<td class="owe">${passed}/${rounds.length}</td></tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
                <div class="hint">每个色块按这个学生在该轮所有检查的结果数量分段：绿 = 过关、黄 = 需重新过关、红 = 未过关（数字是检查次数，灰色 = 未检查）；点击格子登记检查；点击列头进入该轮次；最右列按当前状态统计。</div>`;
        }

        view.innerHTML = `
            <div class="toolbar card">
                <label class="checkbox-label-inline"><input type="checkbox" data-archived ${ui.includeArchived ? 'checked' : ''}> 包含已归档轮次</label>
                ${UI.legend(['pass', 'retry', 'fail', 'none'].map((k) => ({ color: R[k].color, label: R[k].label })))}
            </div>
            <div class="card">${body}</div>
        `;
        view.querySelector('[data-archived]').addEventListener('change', (e) => { ui.includeArchived = e.target.checked; renderOverview(view); });
        view.querySelectorAll('.cell').forEach((cell) => {
            cell.addEventListener('click', () => RecitationDialogs.openCheck(cell.dataset.round, cell.dataset.sid));
        });
        view.querySelectorAll('[data-open-round]').forEach((btn) => {
            btn.addEventListener('click', () => RecitationPage.openTab('check', { roundId: btn.dataset.openRound }));
        });
    }

    window.RecitationOverview = { renderTimeline, renderOverview };
})();
