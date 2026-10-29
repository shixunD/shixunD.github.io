// planView.js —— 背诵「🗓️ 计划背诵」子标签：选轮次 → 点日期 → 点学生即加入/取消这天的计划
// 全局命名空间：window.RecitationPlan
//
// 日期块用 DayPicker（本周/下周 各 7 天 + 日历框），块下方小字显示这天已计划几人；
// 选中某一天后，这天计划要检查的学生标绿（用户要求：标绿的是"那一天要查的人"，不是日期块）；
// 每个学生块上始终列出该生本轮已有的全部计划日期（不管当前选的是哪天）。
// 计划与检查状态互不影响（见 models/recitation.js 顶部说明）；这里只管增删计划，点击即保存。

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);
    const ui = { roundId: null, day: null };

    // 默认日期：今天
    function defaultDay() {
        return Utils.today();
    }

    function setRound(roundId) { ui.roundId = roundId; }

    function render(view) {
        const students = AppState.getStudents();
        const rounds = RecitationModel.rounds();
        if (!students.length) { view.innerHTML = `<div class="card">${UI.emptyStudentsHint()}</div>`; return; }
        if (!rounds.length) { view.innerHTML = '<div class="card empty-message">还没有背诵轮次，请先在「检查」里新建轮次</div>'; return; }
        if (!rounds.some((r) => r.id === ui.roundId)) ui.roundId = rounds[0].id;
        if (!ui.day) ui.day = defaultDay();

        const today = Utils.today();
        const allPlans = state().recPlans.filter((p) => p.roundId === ui.roundId && students.some((s) => s.id === p.studentId));
        const pending = allPlans.filter((p) => !RecitationModel.isPlanDone(p));
        // 日期块下方的人数提示：这天还有几条未完成的计划
        const marked = {};
        pending.forEach((p) => { marked[p.date] = `${(parseInt(marked[p.date], 10) || 0) + 1}人`; });
        const dayPlans = allPlans.filter((p) => p.date === ui.day);
        const byStudent = {};
        dayPlans.forEach((p) => { byStudent[p.studentId] = p; });
        const R = RecitationModel.RESULT_MAP;

        view.innerHTML = `
            <div class="toolbar card">
                <label>背诵轮次</label>
                <select data-plan-round>${rounds.map((r) => `<option value="${r.id}" ${r.id === ui.roundId ? 'selected' : ''}>${esc(r.title)}</option>`).join('')}</select>
                <span class="toolbar-info">点日期，再点学生即可加入 / 取消这天的计划（自动保存）；绿色 = 这天要检查的学生</span>
            </div>
            <div class="card">
                <label class="field-label">选择日期（块下方的数字 = 这天已计划几人）</label>
                ${DayPicker.html('planTab', { count: 7, min: today, color: '#2e9e48', marked })}
                <div class="plan-day-head">
                    <h3 class="section-title">${Utils.formatDate(ui.day)} · ${Utils.relativeDay(ui.day)}：已计划 <b>${dayPlans.length}</b> 人</h3>
                    <div class="plan-quick">
                        <button type="button" class="btn-secondary btn-sm" data-add-unpassed ${ui.day < today ? 'disabled' : ''}>把未过关的都加进来</button>
                        <button type="button" class="btn-secondary btn-sm" data-clear-day ${dayPlans.some((p) => !RecitationModel.isPlanDone(p)) ? '' : 'disabled'}>清空这天的计划</button>
                    </div>
                </div>
                <div class="plan-students plan-students-wide">
                    ${students.map((stu) => {
                        const plan = byStudent[stu.id];
                        const done = plan && RecitationModel.isPlanDone(plan);
                        const st = R[RecitationModel.statusOf(ui.roundId, stu.id)];
                        // 该生本轮全部计划日期（当前选中的那天加粗；已检查完成的带 ✓）
                        const mine = allPlans.filter((p) => p.studentId === stu.id).sort((a, b) => a.date.localeCompare(b.date));
                        const dateList = mine.map((p) => {
                            const txt = `${Utils.formatDate(p.date)}${RecitationModel.isPlanDone(p) ? '✓' : ''}`;
                            return p.date === ui.day ? `<b>${esc(txt)}</b>` : esc(txt);
                        }).join('、');
                        return `<button type="button" class="plan-stu ${plan ? 'selected' : ''} ${done ? 'done' : ''}" data-plan-sid="${stu.id}" ${done ? 'disabled title="这天的计划已检查完成"' : ''}>
                            <i style="background:${st.color}" title="${esc(st.label)}"></i><span class="row-no">${esc(stu.studentNo)}</span>${esc(stu.name)}
                            <small>${plan ? (done ? '✓ 这天已检查' : '✓ 这天已计划') : esc(st.label)}</small>
                            <small class="plan-stu-dates">${mine.length ? `🗓️ ${dateList}` : '暂无计划'}</small>
                        </button>`;
                    }).join('')}
                </div>
            </div>
            <div class="card">
                <h3 class="section-title" style="margin-top:0">本轮全部计划</h3>
                ${planListHtml(allPlans)}
            </div>
        `;

        view.querySelector('[data-plan-round]').addEventListener('change', (e) => { ui.roundId = e.target.value; render(view); });
        DayPicker.bind(view, 'planTab', { value: ui.day, onChange: (d) => { ui.day = d; render(view); } });
        view.querySelectorAll('[data-plan-sid]').forEach((btn) => btn.addEventListener('click', async () => {
            const sid = btn.dataset.planSid;
            const plan = byStudent[sid];
            if (plan) await RecitationModel.removePlan(plan.id);
            else await RecitationModel.addPlans(ui.roundId, [sid], ui.day);
        }));
        view.querySelector('[data-add-unpassed]').addEventListener('click', async () => {
            const ids = students.filter((s) => RecitationModel.statusOf(ui.roundId, s.id) !== 'pass').map((s) => s.id);
            const added = await RecitationModel.addPlans(ui.roundId, ids, ui.day);
            Toast.success(`已加入 ${added} 人`);
        });
        view.querySelector('[data-clear-day]').addEventListener('click', async () => {
            const targets = dayPlans.filter((p) => !RecitationModel.isPlanDone(p));
            const ok = await Modal.confirm({ title: '清空计划', text: `确定取消 ${Utils.formatDate(ui.day)} 的 ${targets.length} 条计划吗？`, confirmText: '清空', danger: true });
            if (!ok) return;
            await AppState._commit((s) => {
                const ids = new Set(targets.map((p) => p.id));
                s.recPlans = s.recPlans.filter((p) => !ids.has(p.id));
            });
        });
        view.querySelectorAll('[data-go-day]').forEach((btn) => btn.addEventListener('click', () => { ui.day = btn.dataset.goDay; render(view); }));
        view.querySelectorAll('[data-rm-plan-id]').forEach((btn) => btn.addEventListener('click', () => RecitationModel.removePlan(btn.dataset.rmPlanId)));
    }

    // 按日期分组的全部计划（未完成的在前面的日期里按学号；已完成的灰显）
    function planListHtml(plans) {
        if (!plans.length) return '<div class="hint">这一轮还没有计划</div>';
        const today = Utils.today();
        const byDate = {};
        plans.forEach((p) => { (byDate[p.date] = byDate[p.date] || []).push(p); });
        return Object.keys(byDate).sort().map((d) => {
            const list = byDate[d]
                .map((p) => ({ p, stu: AppState.getStudent(p.studentId), done: RecitationModel.isPlanDone(p) }))
                .sort((a, b) => Utils.compareStudentNo(a.stu, b.stu));
            const open = list.filter((x) => !x.done).length;
            return `
                <div class="plan-date-row ${d === ui.day ? 'current' : ''}">
                    <button type="button" class="plan-date-btn" data-go-day="${d}">${Utils.formatDate(d)} · ${Utils.relativeDay(d)}</button>
                    ${open && d < today ? '<span class="hint text-danger">已逾期</span>' : ''}
                    <div class="plan-date-people">
                        ${list.map((x) => `<span class="plan-person ${x.done ? 'done' : ''}">${esc(x.stu.name)}${x.done ? ' ✓' : `<button type="button" data-rm-plan-id="${x.p.id}" title="取消计划">✕</button>`}</span>`).join('')}
                    </div>
                </div>`;
        }).join('');
    }

    function state() { return AppState.getState(); }

    window.RecitationPlan = { render, setRound };
})();
