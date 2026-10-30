// checkDialog.js —— 背诵检查登记弹窗（结果 + 检查日期/计划日期用 DayPicker 日期块 + 备注 + 本轮计划/历史）、编辑检查记录、
//                   新建/编辑轮次表单（批量计划背诵在「🗓️ 计划背诵」子标签 planView.js）
// 全局命名空间：window.RecitationDialogs

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);

    // 检查弹窗：登记检查结果 和/或 安排计划背诵（两者互不影响，一次保存可以同时做）
    function openCheck(roundId, studentId) {
        const round = RecitationModel.getRound(roundId);
        const stu = AppState.getStudent(studentId);
        if (!round || !stu) return;

        const today = Utils.today();
        const pg = RecitationModel.progressOf(roundId, studentId);
        let result = null;          // 'excel' | 'pass' | 'retry' | 'fail' | null（再点一次已选的结果可以取消）
        let checkDate = today;
        let planOn = false;         // 「🗓️ 计划背诵」开关，独立于检查结果
        let planDates = [];
        const P = RecitationModel.PLAN;

        Modal.open({
            title: `${stu.name} · ${round.title}`,
            // 宽弹窗：两组 7 天日期块需要横向空间，日期+星期才能一行放下
            wide: true,
            html: `
                <div class="dialog-meta">当前：${statusPill(pg.status)}</div>
                <div class="status-options status-options-5">
                    ${RecitationModel.RESULTS.map((r) => `
                        <button type="button" class="status-option" data-result="${r.key}" style="--st-color:${r.color};--st-text:${r.text}">${esc(r.label)}</button>
                    `).join('')}
                    <button type="button" class="status-option" data-plan-toggle style="--st-color:${P.color};--st-text:${P.text}" title="可以和检查结果同时选">🗓️ ${esc(P.label)}</button>
                </div>
                <div class="hint" data-mode-hint></div>
                <div data-date-row>
                    <label class="field-label">检查日期（默认今天）</label>
                    ${DayPicker.html('check', { count: 7, max: today })}
                </div>
                <div data-plan-wrap hidden>
                    <label class="field-label">🗓️ 计划背诵日期（哪天再背，可点多个；当天会出现在时间看板和提醒里）</label>
                    ${DayPicker.html('plan', { count: 7, min: today, color: '#2e9e48' })}
                    <div class="date-chips" data-plan-chips></div>
                </div>
                <div data-note-wrap>
                    <label class="field-label">备注（comment）</label>
                    ${QuickPhrases.chipsHtml('recitation')}
                    <textarea rows="2" data-note placeholder="如：第二段不熟、卡在第 5 句…"></textarea>
                </div>
                <div class="modal-actions">
                    <button type="button" class="btn-secondary" data-dialog-close>取消</button>
                    <button type="button" class="btn-primary" data-save disabled>保存</button>
                </div>
                ${plansHtml(roundId, studentId)}
                ${historyHtml(roundId, studentId)}
            `,
            onMount(body, close) {
                StudentTrend.linkDialogTitle(body, stu, round.title, close);
                QuickPhrases.bind(body, body.querySelector('[data-note]'));
                const saveBtn = body.querySelector('[data-save]');
                const show = (sel, on) => { body.querySelector(sel).hidden = !on; };

                function chipsHtml(list, attr, emptyText) {
                    return list.length
                        ? '<span class="hint">已选：</span>' + list.map((d) => `<span class="date-chip">${Utils.formatDate(d)} · ${Utils.relativeDay(d)}<button type="button" ${attr}="${d}">✕</button></span>`).join('')
                        : `<span class="hint">${emptyText}</span>`;
                }

                function render() {
                    body.querySelector('[data-plan-chips]').innerHTML = chipsHtml(planDates, 'data-rm-plan-date', '还没选计划日期');
                    body.querySelector('[data-plan-toggle]').classList.toggle('selected', planOn);

                    const planOnly = planOn && !result;
                    show('[data-plan-wrap]', planOn);
                    show('[data-date-row]', !planOnly);
                    show('[data-note-wrap]', !planOnly);

                    // 只加计划时必须选日期；登记了结果时计划日期可选（没选就只登记结果）
                    const withPlan = planOn && planDates.length > 0;
                    let problem = '';
                    if (!result && !planOn) problem = '请选择检查结果，或安排计划背诵';
                    else if (!result && !planDates.length) problem = '请选择计划背诵的日期';
                    saveBtn.disabled = !!problem;
                    saveBtn.title = problem;
                    saveBtn.textContent = result && withPlan ? '保存并加入计划' : (!result && planOn) ? '加入计划' : '保存';
                    body.querySelector('[data-mode-hint]').textContent = result && planOn
                        ? (withPlan ? '将同时登记检查结果并加入背诵计划' : '可以顺便选哪天再背（加入背诵计划），不选就只登记结果')
                        : (result ? '' : '「计划背诵」可以和检查结果同时选，互不影响');
                }

                DayPicker.bind(body, 'check', { value: checkDate, onChange: (d) => { checkDate = d; } });
                const planPicker = DayPicker.bind(body, 'plan', { multi: true, onChange: (v) => { planDates = v; render(); } });

                body.querySelectorAll('[data-result]').forEach((btn) => btn.addEventListener('click', () => {
                    result = result === btn.dataset.result ? null : btn.dataset.result;
                    body.querySelectorAll('[data-result]').forEach((b) => b.classList.toggle('selected', b.dataset.result === result));
                    // 需重新过关 / 未过关：顺手打开「计划背诵」，方便选哪天再背（不选也能保存）
                    if (result === 'retry' || result === 'fail') planOn = true;
                    render();
                }));
                body.querySelector('[data-plan-toggle]').addEventListener('click', () => { planOn = !planOn; render(); });
                body.querySelector('[data-plan-chips]').addEventListener('click', (e) => {
                    const rm = e.target.closest('[data-rm-plan-date]');
                    if (!rm) return;
                    planDates = planDates.filter((d) => d !== rm.dataset.rmPlanDate);
                    planPicker.set(planDates);
                    render();
                });

                saveBtn.addEventListener('click', async () => {
                    try {
                        if (result) {
                            await RecitationModel.addCheck({
                                roundId, studentId, result,
                                date: checkDate || today,
                                note: body.querySelector('[data-note]').value.trim()
                            });
                        }
                        const withPlan = planOn && planDates.length > 0;
                        const added = withPlan ? await RecitationModel.addPlans(roundId, [studentId], planDates) : 0;
                        close();
                        if (withPlan) Toast.success(added ? `已加入计划：${planDates.map((d) => Utils.formatDate(d)).join('、')}` : '这些日期已有计划');
                    } catch (err) {
                        Toast.error(err.message);
                    }
                });
                body.querySelectorAll('[data-rm-plan]').forEach((btn) => {
                    btn.addEventListener('click', async () => {
                        close();
                        await RecitationModel.removePlan(btn.dataset.rmPlan);
                        Toast.info('已删除该计划');
                    });
                });
                body.querySelectorAll('[data-edit-check]').forEach((btn) => {
                    btn.addEventListener('click', () => openEditCheck(btn.dataset.editCheck));
                });
                body.querySelectorAll('[data-rm-check]').forEach((btn) => {
                    btn.addEventListener('click', async () => {
                        const ok = await Modal.confirm({ title: '删除检查记录', text: '确定删除这条检查记录吗？', confirmText: '删除', danger: true });
                        if (!ok) return;
                        close();
                        await RecitationModel.removeCheck(btn.dataset.rmCheck);
                    });
                });
                render();
            }
        });
    }

    // 编辑一条已登记的检查记录：结果 / 检查日期 / 备注。保存后回到该生的检查弹窗
    function openEditCheck(checkId) {
        const check = AppState.getState().recChecks.find((c) => c.id === checkId);
        if (!check) return;
        const round = RecitationModel.getRound(check.roundId);
        const stu = AppState.getStudent(check.studentId);
        if (!round || !stu) return;
        const today = Utils.today();
        let result = check.result;
        let date = check.date;
        const back = () => openCheck(check.roundId, check.studentId);

        Modal.open({
            title: `编辑检查记录 · ${stu.name} · ${round.title}`,
            wide: true,
            html: `
                <div class="dialog-meta">原记录：${statusPill(check.result)} ${Utils.formatDate(check.date)}</div>
                <div class="status-options status-options-4">
                    ${RecitationModel.RESULTS.map((r) => `
                        <button type="button" class="status-option ${r.key === result ? 'selected' : ''}" data-edit-result="${r.key}" style="--st-color:${r.color};--st-text:${r.text}">${esc(r.label)}</button>
                    `).join('')}
                </div>
                <label class="field-label">检查日期</label>
                ${DayPicker.html('editCheck', { count: 7, max: today })}
                <label class="field-label">备注（comment）</label>
                ${QuickPhrases.chipsHtml('recitation')}
                <textarea rows="2" data-edit-note>${esc(check.note)}</textarea>
                <div class="modal-actions">
                    <button type="button" class="btn-secondary" data-edit-back>返回</button>
                    <button type="button" class="btn-primary" data-edit-save>保存修改</button>
                </div>`,
            onMount(body, close) {
                QuickPhrases.bind(body, body.querySelector('[data-edit-note]'));
                const saveBtn = body.querySelector('[data-edit-save]');
                DayPicker.bind(body, 'editCheck', { value: date, onChange: (d) => { date = d; } });

                function render() {
                    body.querySelectorAll('[data-edit-result]').forEach((b) => b.classList.toggle('selected', b.dataset.editResult === result));
                }

                body.querySelectorAll('[data-edit-result]').forEach((b) => b.addEventListener('click', () => { result = b.dataset.editResult; render(); }));
                body.querySelector('[data-edit-back]').addEventListener('click', back);
                saveBtn.addEventListener('click', async () => {
                    try {
                        await RecitationModel.updateCheck(checkId, {
                            result, date,
                            note: body.querySelector('[data-edit-note]').value.trim()
                        });
                        Toast.success('检查记录已修改');
                        back();
                    } catch (err) {
                        Toast.error(err.message);
                    }
                });
                render();
            }
        });
    }

    function statusPill(key) {
        const r = RecitationModel.RESULT_MAP[key];
        return `<span class="status-pill" style="background:${r.color};color:${r.text}">${esc(r.label)}</span>`;
    }

    function planPill() {
        const P = RecitationModel.PLAN;
        return `<span class="status-pill" style="background:${P.color};color:${P.text}">${esc(P.label)}</span>`;
    }

    // 本轮的全部计划：未完成的可"取消计划"；已完成的（计划日当天或之后有检查记录）保留显示，也可删除
    function plansHtml(roundId, studentId) {
        const plans = RecitationModel.plansFor(roundId, studentId);
        if (!plans.length) return '';
        return `
            <h3 class="section-title">背诵计划</h3>
            <ul class="record-list">
                ${plans.map((p) => {
                    const done = RecitationModel.isPlanDone(p);
                    return `<li class="${done ? 'plan-done' : ''}">${planPill()} <span class="record-date">${Utils.formatDate(p.date)} · ${Utils.relativeDay(p.date)}</span>
                        ${done ? '<span class="hint">✓ 已检查</span>' : (p.date < Utils.today() ? '<span class="hint text-danger">已逾期</span>' : '')}
                        <button type="button" class="link-btn" data-rm-plan="${p.id}">${done ? '删除' : '取消计划'}</button></li>`;
                }).join('')}
            </ul>`;
    }

    function historyHtml(roundId, studentId) {
        const checks = RecitationModel.checksFor(roundId, studentId).slice().reverse();
        if (!checks.length) return '';
        return `
            <h3 class="section-title">本轮检查记录</h3>
            <ul class="record-list">
                ${checks.map((c) => `
                    <li>
                        ${statusPill(c.result)} <span class="record-date">${Utils.formatDate(c.date)}</span>
                        <button type="button" class="link-btn" data-edit-check="${c.id}">编辑</button>
                        <button type="button" class="link-btn danger" data-rm-check="${c.id}">删除</button>
                        ${c.note ? `<div class="record-comment">💬 ${esc(c.note)}</div>` : ''}
                    </li>`).join('')}
            </ul>`;
    }

    function openRoundForm(round, onCreated) {
        const isEdit = !!round;
        Modal.open({
            title: isEdit ? '编辑背诵轮次' : '新建背诵轮次',
            html: `
                <form class="form-grid" data-form>
                    <label>标题</label>
                    <input type="text" name="title" value="${esc(isEdit ? round.title : '')}" placeholder="如：第三单元 古诗两首" autocomplete="off" required>
                    <label>背诵内容/要求（可选）</label>
                    <textarea name="content" rows="3" placeholder="篇目、段落范围、过关标准等">${esc(isEdit ? round.content : '')}</textarea>
                    <div class="modal-actions">
                        <button type="button" class="btn-secondary" data-dialog-close>取消</button>
                        <button type="submit" class="btn-primary">${isEdit ? '保存' : '创建'}</button>
                    </div>
                </form>`,
            onMount(body, close) {
                const form = body.querySelector('[data-form]');
                const f = form.elements;
                f.title.focus();
                form.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const data = { title: f.title.value.trim() || '背诵', content: f.content.value.trim() };
                    close();
                    if (isEdit) await RecitationModel.updateRound(round.id, data);
                    else {
                        const created = await RecitationModel.createRound(data);
                        if (onCreated) onCreated(created);
                    }
                });
            }
        });
    }

    window.RecitationDialogs = { openCheck, openEditCheck, openRoundForm, statusPill, planPill };
})();
