// roster.js —— 主页里的「学生名单」卡片（列表、添加/编辑/删除、批量添加、转出 / 休学 / 恢复在读）
// 全局命名空间：window.RosterSection（由 SettingsPage 渲染进主页）

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);

    function joinedHtml(s) {
        return s.joinedOn ? `<span class="roster-tag" title="这天之前布置的作业不算该生">${esc(Utils.formatDate(s.joinedOn))} 入班</span>` : '';
    }

    // 只转出了某几类（1.54.0）：橙色小标签「作业已转出 · 日期」
    function outCatsHtml(s) {
        if (!s.outOf) return '';
        return Object.keys(AppState.OUT_CATS).filter((k) => s.outOf[k])
            .map((k) => `<span class="roster-tag roster-tag-out" title="${esc(AppState.OUT_CATS[k])}不再计入该生，其他照常；点「转出」可修改">${esc(AppState.OUT_CATS[k])}已转出 · ${esc(Utils.formatDate(s.outOf[k]))}</span>`).join('');
    }

    // 已转出 / 休学的学生：折叠区，记录都在，可恢复在读或彻底删除
    function inactiveHtml() {
        const list = AppState.getInactiveStudents();
        if (!list.length) return '';
        return `
            <details class="roster-inactive">
                <summary>已转出 ${list.length} 人（记录都保留，不出现在登记和统计里）</summary>
                <div class="table-scroll">
                    <table class="simple-table roster-table">
                        <tbody>${list.map((s) => `
                            <tr>
                                <td>${esc(s.studentNo) || '<span class="hint">-</span>'}</td>
                                <td>${UI.studentLink(s)}</td>
                                <td class="roster-note">${esc(AppState.STUDENT_STATUS[s.status])}${s.statusOn ? ' · ' + esc(Utils.formatDate(s.statusOn)) : ''}</td>
                                <td class="row-actions">
                                    <button type="button" class="link-btn" data-restore-student="${s.id}">恢复在读</button>
                                    <button type="button" class="link-btn danger" data-del-student="${s.id}">删除</button>
                                </td>
                            </tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            </details>`;
    }

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
                                    <td class="roster-note">${joinedHtml(s)}${outCatsHtml(s)}${esc(s.note)}</td>
                                    <td class="row-actions">
                                        <button type="button" class="link-btn" data-edit-student="${s.id}">编辑</button>
                                        <button type="button" class="link-btn" data-leave-student="${s.id}" title="可只转出作业 / 背诵 / 考试中的某几类；转出的那类不再计入，记录全部保留，可随时恢复">转出</button>
                                        <button type="button" class="link-btn danger" data-del-student="${s.id}">删除</button>
                                    </td>
                                </tr>`).join('')}
                            </tbody>
                        </table>
                    </div>` : '<div class="empty-message">还没有学生。点击「添加」或「批量添加」（可直接从表格复制粘贴）。</div>'}
                ${inactiveHtml()}
            </div>`;
    }

    function openStudentForm(stu) {
        const isEdit = !!stu;
        // 新加学生时班里已经有作业 = 很可能是中途转入：入班日期默认今天（之前的作业不算该生），开学建名单时留空
        const joined = isEdit ? (stu.joinedOn || '') : (HomeworkModel.list().length ? Utils.today() : '');
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
                    <label>入班日期（中途转入才填）</label>
                    <div>
                        <input type="date" name="joinedOn" value="${esc(joined)}">
                        <div class="hint">这天之前布置的作业不算该生（不计入完成率、欠交和导出统计）。从开学就在班里的留空。</div>
                    </div>
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
                    const data = { studentNo: f.studentNo.value, name: f.studentName.value, note: f.note.value.trim(), joinedOn: f.joinedOn.value };
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
        const max = AppState.getStudents({ all: true }).reduce((m, x) => (/^\d+$/.test(x.studentNo) ? Math.max(m, Number(x.studentNo)) : m), 0);
        return Utils.normalizeStudentNo(String(max + 1));
    }

    function openBulkAdd() {
        Modal.open({
            title: '批量添加学生',
            html: `
                <div class="hint">每行一个学生，格式「学号 姓名」（也支持「姓名 学号」或只写姓名——会自动接着现有最大学号编号）。可以直接从 Excel 复制两列粘贴进来。同名学生会被跳过。中途转入的学生，添加后在「编辑」里填入班日期。</div>
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
        root.querySelectorAll('[data-leave-student]').forEach((b) => b.addEventListener('click', () => openLeave(AppState.getStudent(b.dataset.leaveStudent))));
        root.querySelectorAll('[data-restore-student]').forEach((b) => b.addEventListener('click', async () => {
            const stu = AppState.getStudent(b.dataset.restoreStudent);
            await AppState.setStudentStatus(stu.id, null);
            Toast.success(`${stu.name} 已恢复在读`);
        }));
        root.querySelectorAll('[data-del-student]').forEach((b) => b.addEventListener('click', async () => {
            const stu = AppState.getStudent(b.dataset.delStudent);
            const ok = await Modal.confirm({
                title: '删除学生',
                text: `确定删除「${stu.name}」吗？\n该生的所有作业、背诵、考试记录也会一起删除，此操作不可撤销。\n只是不在这个班了的话，用「转出」，记录会保留。`,
                confirmText: '删除',
                danger: true
            });
            if (ok) await AppState.removeStudent(stu.id);
        }));
    }

    // 转出：记录全部保留（1.33.2 起界面上只有「转出」一种，不再单独选休学；以前设为休学的学生数据不变，名单里仍显示「休学」）
    // 1.54.0 起可只转出作业 / 背诵 / 考试中的某几类：默认三类全勾 = 整体转出（同以前）；只勾一部分 = 按类别转出，
    // 该生仍在名单里，转出的那类不再计入，其他照常。已按类别转出的再点「转出」：勾选框显示当前状态，全部取消 = 恢复各类都计入
    function openLeave(stu) {
        const cats = AppState.OUT_CATS;
        const keys = Object.keys(cats);
        const cur = stu.outOf ? keys.filter((k) => stu.outOf[k]) : keys;
        Modal.open({
            title: `${stu.name} · 转出`,
            html: `
                <p>勾选要转出的类别。转出的那类不再出现在该类的登记和统计里，也不计入导出统计；其他类照常计入。以前的所有记录都保留。</p>
                <div class="roster-out-cats">${keys.map((k) => `<label class="ex-item"><input type="checkbox" data-out-cat="${k}"${cur.includes(k) ? ' checked' : ''}><span>${esc(cats[k])}</span></label>`).join('')}</div>
                <p class="hint" data-out-hint></p>
                <div class="modal-actions">
                    <button type="button" class="btn-secondary" data-dialog-close>取消</button>
                    <button type="button" class="btn-primary" data-out-save>转出</button>
                </div>`,
            onMount(body, close) {
                const boxes = Array.from(body.querySelectorAll('[data-out-cat]'));
                const picked = () => boxes.filter((b) => b.checked).map((b) => b.dataset.outCat);
                const hint = body.querySelector('[data-out-hint]');
                const save = body.querySelector('[data-out-save]');
                const sync = () => {
                    const p = picked();
                    if (p.length === keys.length) { hint.textContent = '三类全选 = 整体转出：该生移到学生名单底部「已转出」，可随时恢复在读。'; save.textContent = '转出'; }
                    else if (p.length) { hint.textContent = `只转出${p.map((k) => cats[k]).join('、')}：该生仍在名单里，${keys.filter((k) => !p.includes(k)).map((k) => cats[k]).join('、')}照常计入。`; save.textContent = '转出'; }
                    else { hint.textContent = stu.outOf ? '全部不勾 = 恢复，作业、背诵、考试都照常计入。' : '至少勾选一类。'; save.textContent = stu.outOf ? '恢复' : '转出'; }
                    save.disabled = !p.length && !stu.outOf;
                };
                boxes.forEach((b) => b.addEventListener('change', sync));
                sync();
                save.addEventListener('click', async () => {
                    const p = picked();
                    if (!p.length && !stu.outOf) return;
                    await AppState.setStudentOutCats(stu.id, p);
                    close();
                    if (p.length === keys.length) Toast.success(`${stu.name} 已转出`);
                    else if (p.length) Toast.success(`${stu.name} 已转出${p.map((k) => cats[k]).join('、')}`);
                    else Toast.success(`${stu.name} 已恢复，各类都照常计入`);
                });
            }
        });
    }

    window.RosterSection = { rosterHtml, bind };
})();
