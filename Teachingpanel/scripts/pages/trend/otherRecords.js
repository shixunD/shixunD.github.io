// otherRecords.js —— 学生趋势页的「其他情况」：给选中的学生记学情（日期 + 文字 + 照片），可编辑、删除
// 全局命名空间：window.OtherRecords
// 选中的学生与作业/背诵/考试趋势共用（StudentTrend.pickerHtml）；数据走 RemarkModel
// 左右两栏：左边新增记录（日期 + 内容 + 照片），右边是该生以前的记录（可编辑、删除），写新记录时可对照着看

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);

    function render(view) {
        const students = AppState.getStudents();
        if (!students.length) { view.innerHTML = `<div class="card">${UI.emptyStudentsHint()}</div>`; return; }
        const student = AppState.getStudent(StudentTrend.currentId());
        const remarks = RemarkModel.listFor(student.id);

        view.innerHTML = `
            ${StudentTrend.pickerHtml('other')}
            <div class="other-split">
            <div class="card other-left">
                <div class="detail-head">
                    <div>
                        <div class="detail-title"><span class="row-no">${esc(student.studentNo)}</span>${esc(student.name)}</div>
                        <div class="detail-meta">新增一条记录</div>
                    </div>
                </div>
                <form class="form-grid remark-form" data-add-form>
                    <label>记录日期</label>
                    <input type="date" name="date" value="${Utils.today()}">
                    <label>记录内容</label>
                    <textarea name="text" rows="3" placeholder="记录这个学生的学情……"></textarea>
                    ${Photos.editorHtml()}
                    <div class="modal-actions"><button type="submit" class="btn-primary btn-sm">＋ 添加记录</button></div>
                </form>
            </div>
            <aside class="card other-right">
                <div class="detail-title">以前的记录 <span class="detail-meta">共 ${remarks.length} 条</span></div>
                <div class="remark-list">
                    ${remarks.length ? remarks.map((r) => `
                        <div class="remark-item">
                            <div class="remark-head">
                                <span class="remark-date">${Utils.formatDate(r.date)}</span>
                                <span class="remark-actions">
                                    <button type="button" class="remark-btn" data-edit="${r.id}">编辑</button>
                                    <button type="button" class="remark-btn remark-btn-danger" data-delete="${r.id}">删除</button>
                                </span>
                            </div>
                            ${r.text ? `<div class="remark-text">${esc(r.text)}</div>` : ''}
                            ${Photos.viewHtml(r.photoIds)}
                        </div>`).join('') : '<div class="empty-message">还没有记录</div>'}
                </div>
            </aside>
            </div>`;

        StudentTrend.bind(view, () => render(view));
        const form = view.querySelector('[data-add-form]');
        const photoEditor = Photos.bindEditor(form, []);
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const f = form.elements;
            try {
                if (!f.text.value.trim() && !(await hasPhotos(form))) throw new Error('请填写记录内容或添加照片');
                const photoIds = await photoEditor.finalize();
                await RemarkModel.add(student.id, { date: f.date.value || Utils.today(), text: f.text.value, photoIds });
            } catch (err) {
                Toast.error(err.message);
            }
        });
        view.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => openEdit(btn.dataset.edit)));
        view.querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', async () => {
            const ok = await Modal.confirm({ title: '删除记录', text: '确定删除这条记录吗？此操作不可撤销。', confirmText: '删除', danger: true });
            if (ok) await RemarkModel.remove(btn.dataset.delete);
        }));
    }

    // 编辑块里当前有没有（已保留的或新选的）照片
    function hasPhotos(root) {
        return Promise.resolve(root.querySelectorAll('[data-photo-list] .photo-thumb').length > 0);
    }

    function openEdit(id) {
        const r = RemarkModel.get(id);
        if (!r) return;
        Modal.open({
            title: '编辑记录',
            html: `
                <form class="form-grid" data-form>
                    <label>记录日期</label>
                    <input type="date" name="date" value="${esc(r.date)}">
                    <label>记录内容</label>
                    <textarea name="text" rows="5">${esc(r.text)}</textarea>
                    ${Photos.editorHtml()}
                    <div class="modal-actions">
                        <button type="button" class="btn-secondary" data-dialog-close>取消</button>
                        <button type="submit" class="btn-primary">保存</button>
                    </div>
                </form>`,
            onMount(body, close) {
                const form = body.querySelector('[data-form]');
                const f = form.elements;
                const photoEditor = Photos.bindEditor(body, r.photoIds || []);
                f.text.focus();
                form.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    try {
                        if (!f.text.value.trim() && !(await hasPhotos(body))) throw new Error('请填写记录内容或添加照片');
                        const photoIds = await photoEditor.finalize();
                        await RemarkModel.update(id, { date: f.date.value || r.date, text: f.text.value, photoIds });
                        close();
                    } catch (err) {
                        Toast.error(err.message);
                    }
                });
            }
        });
    }

    window.OtherRecords = { render };
})();
