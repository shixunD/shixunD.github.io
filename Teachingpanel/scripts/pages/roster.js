// roster.js —— 主页里的「学生名单」卡片（列表、添加/编辑/删除、批量添加）
// 全局命名空间：window.RosterSection（由 SettingsPage 渲染进主页）

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);

    function rosterHtml() {
        const students = AppState.getStudents();
        return `
            <div class="card">
                <div class="card-head">
                    <h2>👥 学生名单 <span class="hint">${esc(AppState.getActiveClass().name)} · ${students.length} 人 · 按学号排序</span></h2>
                    <div class="card-head-actions">
                        <button type="button" class="btn-primary btn-sm" data-add-student>＋ 添加</button>
                        <button type="button" class="btn-secondary btn-sm" data-bulk-add>批量添加</button>
                    </div>
                </div>
                ${students.length ? `
                    <div class="table-scroll">
                        <table class="simple-table roster-table">
                            <thead><tr><th>学号</th><th>姓名</th><th>备注</th><th></th></tr></thead>
                            <tbody>${students.map((s) => `
                                <tr>
                                    <td>${esc(s.studentNo) || '<span class="hint">-</span>'}</td>
                                    <td>${UI.studentLink(s)}</td>
                                    <td class="roster-note">${esc(s.note)}</td>
                                    <td class="row-actions">
                                        <button type="button" class="link-btn" data-edit-student="${s.id}">编辑</button>
                                        <button type="button" class="link-btn danger" data-del-student="${s.id}">删除</button>
                                    </td>
                                </tr>`).join('')}
                            </tbody>
                        </table>
                    </div>` : '<div class="empty-message">还没有学生。点击「添加」或「批量添加」（可直接从表格复制粘贴）。</div>'}
            </div>`;
    }

    function openStudentForm(stu) {
        const isEdit = !!stu;
        Modal.open({
            title: isEdit ? '编辑学生' : '添加学生',
            html: `
                <form class="form-grid" data-form>
                    <label>学号</label>
                    <input type="text" name="studentNo" value="${esc(isEdit ? stu.studentNo : suggestNextNo())}" autocomplete="off">
                    <label>姓名（班级内唯一）</label>
                    <input type="text" name="studentName" value="${esc(isEdit ? stu.name : '')}" autocomplete="off" required>
                    <label>备注（可选）</label>
                    <input type="text" name="note" value="${esc(isEdit ? stu.note : '')}" autocomplete="off" placeholder="如：课代表、需重点关注">
                    <div class="modal-actions">
                        ${isEdit ? '' : '<button type="button" class="btn-secondary" data-save-next>保存并继续添加</button>'}
                        <button type="submit" class="btn-primary">保存</button>
                    </div>
                </form>`,
            onMount(body, close) {
                const form = body.querySelector('[data-form]');
                const f = form.elements;
                (isEdit ? f.studentName : f.studentName).focus();
                async function save(keepOpen) {
                    const data = { studentNo: f.studentNo.value, name: f.studentName.value, note: f.note.value.trim() };
                    try {
                        if (isEdit) await AppState.updateStudent(stu.id, data);
                        else await AppState.addStudent(data);
                    } catch (err) {
                        Toast.error(err.message);
                        return;
                    }
                    if (keepOpen) {
                        Toast.success(`已添加 ${data.name.trim()}`);
                        openStudentForm(null);
                    } else close();
                }
                form.addEventListener('submit', (e) => { e.preventDefault(); save(false); });
                const next = body.querySelector('[data-save-next]');
                if (next) next.addEventListener('click', () => save(true));
            }
        });
    }

    function suggestNextNo() {
        const max = AppState.getStudents().reduce((m, x) => (/^\d+$/.test(x.studentNo) ? Math.max(m, Number(x.studentNo)) : m), 0);
        return String(max + 1);
    }

    function openBulkAdd() {
        Modal.open({
            title: '批量添加学生',
            html: `
                <div class="hint">每行一个学生，格式「学号 姓名」（也支持「姓名 学号」或只写姓名——会自动接着现有最大学号编号）。可以直接从 Excel 复制两列粘贴进来。同名学生会被跳过。</div>
                <textarea rows="10" data-text placeholder="1 杨迪&#10;2 罗门&#10;3 张三"></textarea>
                <div class="modal-actions">
                    <button type="button" class="btn-secondary" data-dialog-close>取消</button>
                    <button type="button" class="btn-primary" data-save>添加</button>
                </div>`,
            onMount(body, close) {
                const ta = body.querySelector('[data-text]');
                ta.focus();
                body.querySelector('[data-save]').addEventListener('click', async () => {
                    if (!ta.value.trim()) return;
                    close();
                    const res = await AppState.bulkAddStudents(ta.value);
                    if (res.skipped.length) Toast.warning(`已添加 ${res.added} 人，跳过 ${res.skipped.length} 个重名：${res.skipped.map((x) => x.line).join('、')}`, 5000);
                    else Toast.success(`已添加 ${res.added} 人`);
                });
            }
        });
    }

    function bind(root) {
        const q = (sel) => root.querySelector(sel);
        q('[data-add-student]').addEventListener('click', () => openStudentForm(null));
        q('[data-bulk-add]').addEventListener('click', openBulkAdd);
        root.querySelectorAll('[data-edit-student]').forEach((b) => b.addEventListener('click', () => openStudentForm(AppState.getStudent(b.dataset.editStudent))));
        root.querySelectorAll('[data-del-student]').forEach((b) => b.addEventListener('click', async () => {
            const stu = AppState.getStudent(b.dataset.delStudent);
            const ok = await Modal.confirm({
                title: '删除学生',
                text: `确定删除「${stu.name}」吗？\n该生的所有作业、背诵、考试记录也会一起删除，此操作不可撤销。`,
                confirmText: '删除',
                danger: true
            });
            if (ok) await AppState.removeStudent(stu.id);
        }));
    }

    window.RosterSection = { rosterHtml, bind };
})();
