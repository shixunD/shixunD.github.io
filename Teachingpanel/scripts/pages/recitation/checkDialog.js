// checkDialog.js —— 背诵检查登记弹窗（结果 + 检查日期/计划日期用 DayPicker 日期块 + 备注 + 本轮计划/历史）、编辑检查记录、
//                   新建/编辑轮次表单（批量计划背诵在「🗓️ 计划背诵」子标签 planView.js）
// 全局命名空间：window.RecitationDialogs

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);

    // 检查弹窗：登记检查结果 和/或 安排计划背诵（两者互不影响，一次保存可以同时做）
    // 1.26.0 起：没有「计划背诵」开关，计划日期选择器始终显示；选了日期就是要计划。
    //   每个日期都只有一个检查状态、一个计划：点到已有记录的日期会自动载入那天的备注（检查日期还会载入结果和照片），可改可存。
    //   1.27.4 起弹窗里不再编辑计划备注（已选日期条、计划备注框都去掉）；已有计划的备注原样保留。
    function openCheck(roundId, studentId) {
        const round = RecitationModel.getRound(roundId);
        const stu = AppState.getStudent(studentId);
        if (!round || !stu) return;

        const pg = RecitationModel.progressOf(roundId, studentId);
        // 默认检查日期 = 今天；今天已有检查记录就载入它的结果 / 备注 / 照片，没有就结果留空（不再默认「过关」）
        let result = null;        // 'excel' | 'pass' | 'cond' | 'retry' | 'fail' | null（再点一次已选的结果可以取消）
        // 再点一次已选的检查日期可以取消；不选日期 = 这次不登记检查结果（只处理计划）
        // 已「提前完成」= 锁定：只能改那条记录的备注 / 照片，不能再登记别的状态、不能再加计划
        let locked = RecitationModel.isLocked(roundId, studentId);
        const lockedCheck = () => RecitationModel.checksFor(roundId, studentId).slice().pop();
        let checkDate = locked ? lockedCheck().date : Utils.today();
        // 该生本轮已有的（未完成）计划日期：直接显示为选中，再点一次 = 取消那天的计划
        const plansAll = () => RecitationModel.plansFor(roundId, studentId);
        let existingDates = RecitationModel.pendingPlans(roundId, studentId).map((p) => p.date);
        let planDates = existingDates.slice();
        const P = RecitationModel.PLAN;
        let noteVal = () => '';
        let photoFp = () => '';

        Modal.open({
            title: `${stu.name} · ${round.title}`,
            // 宽弹窗：两组 7 天日期块需要横向空间，日期+星期才能一行放下
            wide: true,
            // 是否有未保存改动：只看「是否选了结果（及其日期/备注/照片）」和「计划日期是否变了」，选了又取消 = 没改动
            dirtyKey: () => JSON.stringify([
                result ? [result, checkDate, noteVal(), photoFp()] : null,
                planDates.slice().sort()
            ]),
            html: `
                <div class="dialog-meta" data-cur-status>当前：${statusPill(pg.status)}</div>
                <div class="status-options status-options-5">
                    ${RecitationModel.RESULTS.map((r) => `
                        <button type="button" class="status-option" data-result="${r.key}" style="--st-color:${r.color};--st-text:${r.text}">${esc(r.label)}</button>
                    `).join('')}
                </div>
                <div class="hint" data-mode-hint></div>
                <div data-date-row>
                    <label class="field-label">检查日期（请手动选；不选 = 这次不登记检查结果，再点一次已选的日期可取消；点到已有记录的日期会自动载入当天的结果和备注）</label>
                    ${DayPicker.html('check', { count: 7, dimFuture: true })}
                    <div class="hint text-danger" data-replace-hint></div>
                </div>
                <div data-note-wrap>
                    <label class="field-label">备注（comment）</label>
                    ${QuickPhrases.chipsHtml('recitation')}
                    <textarea rows="5" data-note placeholder="如：第二段不熟、卡在第 5 句…"></textarea>
                    ${Photos.editorHtml()}
                </div>
                <div data-plan-wrap>
                    <label class="field-label">🗓️ 计划背诵日期（哪天再背，可点多个；当天会出现在时间看板和提醒里）</label>
                    ${DayPicker.html('plan', { count: 7, dimPast: true, color: P.color, textColor: P.text })}
                </div>
                <div class="modal-actions">
                    <button type="button" class="btn-secondary" data-dialog-close>取消</button>
                    <button type="button" class="btn-primary" data-save disabled>保存</button>
                </div>
                <div data-lists>${plansHtml(roundId, studentId)}${historyHtml(roundId, studentId)}</div>
            `,
            onMount(body, close) {
                StudentTrend.linkDialogTitle(body, stu, round.title, close);
                const noteEl = body.querySelector('[data-note]');
                QuickPhrases.bind(body, noteEl);
                const photoEditor = Photos.bindEditor(body, []);
                noteVal = () => noteEl.value.trim();
                photoFp = () => photoEditor.fingerprint();
                const saveBtn = body.querySelector('[data-save]');
                const show = (sel, on) => { body.querySelector(sel).hidden = !on; };

                const addedDates = () => planDates.filter((d) => !existingDates.includes(d));
                const removedDates = () => existingDates.filter((d) => !planDates.includes(d));
                const planChanged = () => addedDates().length > 0 || removedDates().length > 0;

                function render() {
                    // 「提前完成」的限制：锁定时只有提前完成可点；之前有重新过关 / 未过关时提前完成不可点
                    const canEx = RecitationModel.canExcel(roundId, studentId, checkDate);
                    if (!locked && result === 'excel' && !canEx) setResult(null);
                    body.querySelectorAll('[data-result]').forEach((b) => {
                        const k = b.dataset.result;
                        b.disabled = locked ? k !== 'excel' : (k === 'excel' && !canEx);
                        b.title = b.disabled ? (locked ? '已提前完成，不能再登记其他状态' : '已有重新过关 / 未过关记录，不能再选提前完成') : '';
                    });
                    // 选了提前完成 = 不能再计划新的日期（已有的计划保留）
                    if (!locked && result === 'excel' && addedDates().length) { planDates = existingDates.slice(); planPicker.set(planDates); }
                    show('[data-date-row]', !locked);
                    show('[data-plan-wrap]', !locked && result !== 'excel');
                    // 检查日期始终显示（锁定时隐藏）；备注只在选了检查结果后才出现
                    show('[data-note-wrap]', !!result);

                    // 同一天只能有一个检查状态：这天已有记录时提醒，保存会改成新的结果
                    const sameDay = checkDate && RecitationModel.checksFor(roundId, studentId).find((c) => c.date === checkDate);
                    const R = RecitationModel.RESULT_MAP;
                    body.querySelector('[data-replace-hint]').textContent = result && sameDay
                        ? `${Utils.formatDate(sameDay.date)} 已有检查记录「${(R[sameDay.result] || R.none).label}」，保存后会改成「${R[result].label}」（同一天只保留一个状态）`
                        : '';

                    // 只改计划时必须有改动（新选了日期、取消了已有的日期）；登记了结果时计划可以不动
                    const withPlan = planChanged();
                    const recordCheck = !!(result && checkDate);
                    let problem = '';
                    if (!recordCheck && !withPlan) problem = result ? '请选择检查日期（或改计划日期 / 备注）' : '请选择检查结果，或选计划日期、改计划备注';
                    saveBtn.disabled = !!problem;
                    saveBtn.title = problem;
                    saveBtn.textContent = recordCheck && withPlan ? '保存并更新计划' : (!recordCheck && withPlan) ? '保存计划' : '保存';
                    body.querySelector('[data-mode-hint]').textContent = locked
                        ? '已提前完成：这一轮已过关，只能修改这条记录的备注 / 照片，不能再登记其他状态或计划'
                        : result && !checkDate
                            ? '还没选检查日期：不选的话这次不会登记检查结果（只处理计划）'
                            : '';
                }

                // 点到有检查记录的日期：载入结果 / 备注 / 照片；换到没记录的日期时，只清掉之前自动载入、且没被改过的内容
                let loaded = null;   // { note } 当前备注框里的内容来自某条已有记录
                function setResult(r) {
                    result = r;
                    body.querySelectorAll('[data-result]').forEach((b) => b.classList.toggle('selected', b.dataset.result === result));
                    const rs = RecitationModel.RESULT_MAP[result];
                    checkPicker.setColor(rs && rs.color, rs && rs.text);
                }
                function loadCheckFor(d) {
                    const ex = d && RecitationModel.checksFor(roundId, studentId).find((c) => c.date === d);
                    if (ex) {
                        setResult(ex.result);
                        noteEl.value = ex.note || '';
                        photoEditor.setKept(ex.photoIds || []);
                        loaded = { note: ex.note || '' };
                    } else if (loaded) {
                        if (noteEl.value === loaded.note) noteEl.value = '';
                        photoEditor.setKept([]);
                        loaded = null;
                    }
                }

                const checkPicker = DayPicker.bind(body, 'check', { value: checkDate, allowClear: true, onChange: (d) => { checkDate = d; loadCheckFor(d); render(); } });
                const planPicker = DayPicker.bind(body, 'plan', {
                    multi: true, value: planDates,
                    onChange: (v) => { planDates = v; render(); }
                });

                body.querySelectorAll('[data-result]').forEach((btn) => btn.addEventListener('click', () => {
                    if (btn.disabled || locked) return;
                    setResult(result === btn.dataset.result ? null : btn.dataset.result);
                    render();
                }));
                // 默认选中的结果：按钮高亮 + 检查日期块用该结果的颜色
                setResult(result);
                loadCheckFor(checkDate);   // 今天已有记录就直接载入
                saveBtn.addEventListener('click', async () => {
                    try {
                        if (result && checkDate) {
                            await RecitationModel.addCheck({
                                roundId, studentId, result,
                                date: checkDate,
                                note: noteEl.value.trim(),
                                photoIds: await photoEditor.finalize()
                            });
                        }
                        const add = addedDates();
                        const drop = removedDates();
                        if (drop.length) {
                            const ids = RecitationModel.pendingPlans(roundId, studentId).filter((p) => drop.includes(p.date)).map((p) => p.id);
                            await AppState._commit((s) => { s.recPlans = s.recPlans.filter((p) => !ids.includes(p.id)); });
                        }
                        if (add.length) await RecitationModel.addPlans(roundId, [studentId], add, {});
                        close();
                        if (add.length || drop.length) {
                            Toast.success([add.length ? `已加入计划：${add.map((d) => Utils.formatDate(d)).join('、')}` : '', drop.length ? `已取消计划：${drop.map((d) => Utils.formatDate(d)).join('、')}` : ''].filter(Boolean).join('；'));
                        }
                    } catch (err) {
                        Toast.error(err.message);
                    }
                });
                // 删除计划 / 检查记录：不关弹窗，原地刷新「当前状态」和下面两个列表；没保存的选择、备注、照片都保留
                function refreshLists() {
                    // 删掉提前完成的记录后解除锁定
                    if (locked && !RecitationModel.isLocked(roundId, studentId)) { locked = false; setResult(null); loaded = null; }
                    body.querySelector('[data-cur-status]').innerHTML = `当前：${statusPill(RecitationModel.progressOf(roundId, studentId).status)}`;
                    body.querySelector('[data-lists]').innerHTML = plansHtml(roundId, studentId) + historyHtml(roundId, studentId);
                    bindLists();
                    render();
                }
                function bindLists() {
                    body.querySelectorAll('[data-rm-plan]').forEach((btn) => {
                        btn.addEventListener('click', async () => {
                            const plan = RecitationModel.plansFor(roundId, studentId).find((x) => x.id === btn.dataset.rmPlan);
                            await RecitationModel.removePlan(btn.dataset.rmPlan);
                            if (plan) {
                                // 这天的计划已经没了：从「已有计划」和日期选择里一并去掉，免得保存时又被当成改动
                                existingDates = existingDates.filter((d) => d !== plan.date);
                                planDates = planDates.filter((d) => d !== plan.date);
                                planPicker.set(planDates);
                            }
                            Toast.info('已删除该计划');
                            refreshLists();
                        });
                    });
                    body.querySelectorAll('[data-edit-check]').forEach((btn) => {
                        btn.addEventListener('click', () => openEditCheck(btn.dataset.editCheck));
                    });
                    body.querySelectorAll('[data-rm-check]').forEach((btn) => {
                        btn.addEventListener('click', async () => {
                            const ok = await Modal.confirm({ title: '删除检查记录', text: '确定删除这条检查记录吗？', confirmText: '删除', danger: true });
                            if (!ok) return;
                            await RecitationModel.removeCheck(btn.dataset.rmCheck);
                            refreshLists();
                        });
                    });
                }
                bindLists();
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
                ${DayPicker.html('editCheck', { count: 7, dimFuture: true })}
                <label class="field-label">备注（comment）</label>
                ${QuickPhrases.chipsHtml('recitation')}
                <textarea rows="5" data-edit-note>${esc(check.note)}</textarea>
                ${Photos.editorHtml()}
                <div class="modal-actions">
                    <button type="button" class="btn-secondary" data-edit-back>返回</button>
                    <button type="button" class="btn-primary" data-edit-save>保存修改</button>
                </div>`,
            onMount(body, close) {
                QuickPhrases.bind(body, body.querySelector('[data-edit-note]'));
                const photoEditor = Photos.bindEditor(body, check.photoIds || []);
                const saveBtn = body.querySelector('[data-edit-save]');
                const datePicker = DayPicker.bind(body, 'editCheck', { value: date, onChange: (d) => { date = d; } });

                // 提前完成的限制：别处已提前完成 → 只能保持这条原来的结果；有重新过关 / 未过关（别的记录）→ 不能改成提前完成
                const lockedByOthers = RecitationModel.isLocked(check.roundId, check.studentId, check.id);
                function render() {
                    const canEx = RecitationModel.canExcel(check.roundId, check.studentId, date);
                    body.querySelectorAll('[data-edit-result]').forEach((b) => {
                        const k = b.dataset.editResult;
                        // 提前完成这条自己：只能改备注 / 照片，不能改成别的状态
                        b.disabled = k !== check.result && (check.result === 'excel' || lockedByOthers || (k === 'excel' && !canEx));
                        b.title = b.disabled ? '这一轮的「提前完成」限制：不能选这个状态' : '';
                    });
                    body.querySelectorAll('[data-edit-result]').forEach((b) => b.classList.toggle('selected', b.dataset.editResult === result));
                    // 检查日期块的颜色跟所选结果的颜色一致
                    const rs = RecitationModel.RESULT_MAP[result];
                    datePicker.setColor(rs && rs.color, rs && rs.text);
                }

                body.querySelectorAll('[data-edit-result]').forEach((b) => b.addEventListener('click', () => { if (b.disabled) return; result = b.dataset.editResult; render(); }));
                body.querySelector('[data-edit-back]').addEventListener('click', back);
                saveBtn.addEventListener('click', async () => {
                    try {
                        await RecitationModel.updateCheck(checkId, {
                            result, date,
                            note: body.querySelector('[data-edit-note]').value.trim(),
                            photoIds: await photoEditor.finalize()
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
                        <button type="button" class="link-btn" data-rm-plan="${p.id}">${done ? '删除' : '取消计划'}</button>
                        ${p.note ? `<div class="record-comment">💬 ${esc(p.note)}</div>` : ''}</li>`;
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
                        ${Photos.viewHtml(c.photoIds)}
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
                    <label>所属周数（必选：点日历里的任意一天，即选中那一周）</label>
                    ${WeekPicker.html('roundWeek')}
                    <div class="modal-actions">
                        <button type="button" class="btn-secondary" data-dialog-close>取消</button>
                        <button type="submit" class="btn-primary">${isEdit ? '保存' : '创建'}</button>
                    </div>
                </form>`,
            onMount(body, close) {
                const form = body.querySelector('[data-form]');
                const f = form.elements;
                f.title.focus();
                const weekPicker = WeekPicker.bind(body, 'roundWeek', { value: isEdit ? RecitationModel.roundDay(round) : Utils.today() });
                form.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const data = { title: f.title.value.trim() || '背诵', content: f.content.value.trim(), day: weekPicker.get(), weekStart: RecitationModel.weekStartOf(weekPicker.get()) };
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
