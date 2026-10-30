// statusPicker.js —— 作业状态登记弹窗（5 种状态 + comment 快捷词）、新建/编辑作业表单、"已补上"（确认 + 撤销）
// 全局命名空间：window.HomeworkDialogs

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);

    // 打开某学生在某项作业上的状态登记弹窗
    function openStatus(hwId, studentId) {
        const hw = HomeworkModel.get(hwId);
        const stu = AppState.getStudent(studentId);
        if (!hw || !stu) return;
        const rec = HomeworkModel.getRecord(hw, studentId);
        let selected = rec.status;

        Modal.open({
            title: `${stu.name} · ${hw.title}`,
            html: `
                <div class="dialog-meta"><span>${Utils.formatDate(hw.date)}</span></div>
                <div class="status-options">
                    ${HomeworkModel.STATUSES.map((s) => `
                        <button type="button" class="status-option ${s.key === selected ? 'selected' : ''}" data-status="${s.key}"
                            style="--st-color:${s.color};--st-text:${s.text}">${esc(s.label)}</button>
                    `).join('')}
                </div>
                <label class="field-label">情况说明（comment）</label>
                ${QuickPhrases.chipsHtml('homework')}
                <textarea rows="3" data-comment placeholder="如：缺第 3 题、字迹潦草、周五前补交…">${esc(rec.comment)}</textarea>
                ${rec.madeUpAt ? `<div class="hint">补上日期：${Utils.formatDate(rec.madeUpAt)}</div>` : ''}
                <div class="modal-actions">
                    <button type="button" class="btn-secondary" data-dialog-close>取消</button>
                    <button type="button" class="btn-primary" data-save>保存</button>
                </div>`,
            onMount(body, close) {
                StudentTrend.linkDialogTitle(body, stu, hw.title, close);
                QuickPhrases.bind(body, body.querySelector('[data-comment]'));
                body.querySelector('.status-options').addEventListener('click', (e) => {
                    const btn = e.target.closest('[data-status]');
                    if (!btn) return;
                    selected = btn.dataset.status;
                    body.querySelectorAll('.status-option').forEach((b) => b.classList.toggle('selected', b === btn));
                });
                body.querySelector('[data-save]').addEventListener('click', async () => {
                    const comment = body.querySelector('[data-comment]').value.trim();
                    close();
                    await HomeworkModel.setRecord(hwId, studentId, { status: selected, comment });
                });
            }
        });
    }

    // 新建 / 编辑作业。编辑时传 hw；新建成功后回调 onCreated(hw)
    function openForm(hw, onCreated) {
        const isEdit = !!hw;
        let date = isEdit ? hw.date : Utils.today();
        Modal.open({
            title: isEdit ? '编辑作业' : '新建作业',
            // 宽弹窗：日期用本周/下周 14 天日期块（带星期）快速点选，找不到再用日历框
            wide: true,
            html: `
                <form class="form-grid" data-form>
                    <label>日期（默认今天）</label>
                    ${DayPicker.html('hwDate', { count: 7 })}
                    <label>作业标题</label>
                    <input type="text" name="title" value="${esc(isEdit ? hw.title : '')}" placeholder="如：练习册 P23-25" autocomplete="off">
                    <label>备注（可选）</label>
                    <textarea name="note" rows="2" placeholder="作业要求、截止时间等">${esc(isEdit ? hw.note : '')}</textarea>
                    ${isEdit ? '' : '<div class="hint">新建后全班默认"完全完成"，只需登记没完成的同学。</div>'}
                    <div class="modal-actions">
                        <button type="button" class="btn-secondary" data-dialog-close>取消</button>
                        <button type="submit" class="btn-primary">${isEdit ? '保存' : '创建'}</button>
                    </div>
                </form>`,
            onMount(body, close) {
                const form = body.querySelector('[data-form]');
                // 用 form.elements 取字段：form.title / form.name 会命中 <form> 自身的同名属性
                const f = form.elements;
                DayPicker.bind(body, 'hwDate', { value: date, onChange: (d) => { date = d; } });
                f.title.focus();
                form.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    if (!date) date = Utils.today();
                    const data = {
                        date,
                        title: f.title.value.trim() || `作业 ${Utils.formatDate(date)}`,
                        note: f.note.value.trim()
                    };
                    close();
                    if (isEdit) {
                        await HomeworkModel.update(hw.id, data);
                    } else {
                        const created = await HomeworkModel.create(data);
                        if (onCreated) onCreated(created);
                    }
                });
            }
        });
    }

    // 标记"已补上"：opts.confirm=true 时先二次确认；执行后弹带「撤销」的提示，撤销会把记录原样恢复（含 comment）
    async function markFixed(hwId, studentId, opts) {
        const hw = HomeworkModel.get(hwId);
        const stu = AppState.getStudent(studentId);
        if (!hw || !stu || !HomeworkModel.isOutstanding(HomeworkModel.getRecord(hw, studentId).status)) return;
        if (opts && opts.confirm) {
            const ok = await Modal.confirm({
                title: '确认已补上',
                text: `确认「${stu.name}」已补上作业「${hw.title}」（${Utils.formatDate(hw.date)}）吗？`,
                confirmText: '确认已补上'
            });
            if (!ok) return;
        }
        const snapshot = HomeworkModel.snapshotRecord(hwId, studentId);
        await HomeworkModel.markFixed(hwId, studentId);
        Toast.action(`已标记 ${stu.name} 补上「${hw.title}」`, '撤销', async () => {
            await HomeworkModel.restoreRecord(hwId, studentId, snapshot);
            Toast.info(`已撤销：${stu.name} 恢复为未补上`);
        });
    }

    window.HomeworkDialogs = { openStatus, openForm, markFixed };
})();
