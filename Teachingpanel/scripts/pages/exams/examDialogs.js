// examDialogs.js —— 考试相关弹窗：新建/编辑考试、逐人录入成绩、TXT 导入（预览后确认）
// 全局命名空间：window.ExamDialogs

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);

    function openForm(exam, onCreated) {
        const isEdit = !!exam;
        Modal.open({
            title: isEdit ? '编辑考试' : '新建考试',
            html: `
                <form class="form-grid" data-form>
                    <label>考试名称</label>
                    <input type="text" name="examName" value="${esc(isEdit ? exam.name : '')}" placeholder="如：期中考试、第 3 次周测" autocomplete="off" required>
                    <label>考试日期</label>
                    <input type="date" name="date" value="${esc(isEdit ? exam.date : Utils.today())}">
                    <label>满分</label>
                    <input type="number" name="fullScore" value="${isEdit ? exam.fullScore : 100}" min="1" step="any">
                    <div class="modal-actions">
                        <button type="button" class="btn-secondary" data-dialog-close>取消</button>
                        <button type="submit" class="btn-primary">${isEdit ? '保存' : '创建'}</button>
                    </div>
                </form>`,
            onMount(body, close) {
                const form = body.querySelector('[data-form]');
                const f = form.elements;
                f.examName.focus();
                form.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const data = {
                        name: f.examName.value.trim() || '考试',
                        date: f.date.value || Utils.today(),
                        fullScore: Number(f.fullScore.value) || 100
                    };
                    close();
                    if (isEdit) await ExamModel.update(exam.id, data);
                    else {
                        const created = await ExamModel.create(data);
                        if (onCreated) onCreated(created);
                    }
                });
            }
        });
    }

    // 逐人录入：在弹窗里一次填完再统一保存（避免每输入一格就触发整页重绘、丢失输入焦点）
    function openScoreEntry(examId) {
        const exam = ExamModel.get(examId);
        const students = AppState.getStudents();
        if (!exam) return;
        if (!students.length) { Toast.warning('当前班级还没有学生'); return; }

        Modal.open({
            title: `录入成绩 · ${exam.name}`,
            wide: true,
            html: `
                <div class="hint">满分 ${exam.fullScore}；留空表示缺考/未录入。按 Enter 跳到下一个。</div>
                <div class="score-entry-grid">
                    ${students.map((stu) => `
                        <label class="score-entry-item">
                            <span><span class="row-no">${esc(stu.studentNo)}</span>${esc(stu.name)}</span>
                            <input type="number" step="any" data-sid="${stu.id}" value="${exam.scores[stu.id] != null ? exam.scores[stu.id] : ''}">
                        </label>`).join('')}
                </div>
                <div class="modal-actions">
                    <button type="button" class="btn-secondary" data-dialog-close>取消</button>
                    <button type="button" class="btn-primary" data-save>保存</button>
                </div>`,
            onMount(body, close) {
                const inputs = Array.from(body.querySelectorAll('input[data-sid]'));
                inputs.forEach((input, i) => {
                    input.addEventListener('keydown', (e) => {
                        if (e.key !== 'Enter') return;
                        e.preventDefault();
                        if (inputs[i + 1]) inputs[i + 1].focus();
                    });
                });
                if (inputs[0]) inputs[0].focus();
                body.querySelector('[data-save]').addEventListener('click', async () => {
                    const scores = {};
                    let over = 0;
                    inputs.forEach((input) => {
                        const v = input.value.trim();
                        scores[input.dataset.sid] = v === '' ? null : Number(v);
                        if (v !== '' && Number(v) > exam.fullScore) over++;
                    });
                    if (over) {
                        const ok = await Modal.confirm({ title: '分数超过满分', text: `有 ${over} 个分数高于满分 ${exam.fullScore}，确定保存吗？`, confirmText: '仍然保存' });
                        if (!ok) return;
                    }
                    close();
                    await ExamModel.setScores(examId, scores);
                    Toast.success('成绩已保存');
                });
            }
        });
    }

    // TXT 导入：粘贴或选择文件 -> 预览匹配结果 -> 确认写入
    function openImport(examId) {
        const exam = ExamModel.get(examId);
        if (!exam) return;
        let parsed = null;

        Modal.open({
            title: `导入成绩 · ${exam.name}`,
            wide: true,
            html: `
                <div class="hint">每行「姓名 成绩」，用空格分隔，例如：<code>杨迪 101</code>。可直接粘贴，或选择 .txt 文件。</div>
                <input type="file" accept=".txt,text/plain" data-file>
                <textarea rows="8" data-text placeholder="杨迪 101&#10;罗门 103"></textarea>
                <div data-preview></div>
                <div class="modal-actions">
                    <button type="button" class="btn-secondary" data-dialog-close>取消</button>
                    <button type="button" class="btn-primary" data-apply disabled>导入</button>
                </div>`,
            onMount(body, close) {
                const textarea = body.querySelector('[data-text]');
                const applyBtn = body.querySelector('[data-apply]');

                function preview() {
                    parsed = ExamModel.parseTxt(textarea.value);
                    const overwrite = parsed.matched.filter((m) => exam.scores[m.student.id] != null && exam.scores[m.student.id] !== m.score).length;
                    const missing = AppState.getStudents().filter((s) => !parsed.matched.some((m) => m.student.id === s.id));
                    body.querySelector('[data-preview]').innerHTML = textarea.value.trim() ? `
                        <div class="import-preview">
                            <div class="ok">✔ 匹配成功 <b>${parsed.matched.length}</b> 人${overwrite ? `（其中 ${overwrite} 人会覆盖已有成绩）` : ''}</div>
                            ${parsed.unknown.length ? `<div class="bad">✘ 名单中找不到 ${parsed.unknown.length} 人（将跳过）：${parsed.unknown.map((u) => esc(u.name)).join('、')}</div>` : ''}
                            ${parsed.invalid.length ? `<div class="bad">✘ 无法识别 ${parsed.invalid.length} 行（将跳过）：${parsed.invalid.map((l) => `「${esc(l)}」`).join(' ')}</div>` : ''}
                            ${parsed.duplicates.length ? `<div class="warn">⚠ 重复出现（以最后一行为准）：${parsed.duplicates.map(esc).join('、')}</div>` : ''}
                            ${missing.length && parsed.matched.length ? `<div class="warn">本次文件未包含 ${missing.length} 人：${missing.map((s) => esc(s.name)).join('、')}</div>` : ''}
                        </div>` : '';
                    applyBtn.disabled = !parsed.matched.length;
                }

                textarea.addEventListener('input', preview);
                body.querySelector('[data-file]').addEventListener('change', async (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    textarea.value = await readTextFile(file);
                    preview();
                });
                applyBtn.addEventListener('click', async () => {
                    const scores = {};
                    parsed.matched.forEach((m) => { scores[m.student.id] = m.score; });
                    close();
                    await ExamModel.setScores(examId, scores);
                    Toast.success(`已导入 ${parsed.matched.length} 人的成绩`);
                });
                textarea.focus();
            }
        });
    }

    // 兼容 GBK 编码的 TXT（Windows 记事本旧版默认 ANSI）：UTF-8 解码出现替换字符时回退 GB18030
    async function readTextFile(file) {
        const buf = await file.arrayBuffer();
        const utf8 = new TextDecoder('utf-8').decode(buf);
        if (!utf8.includes('�')) return utf8;
        try { return new TextDecoder('gb18030').decode(buf); } catch (e) { return utf8; }
    }

    window.ExamDialogs = { openForm, openScoreEntry, openImport };
})();
