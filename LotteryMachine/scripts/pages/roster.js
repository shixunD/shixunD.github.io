// roster.js —— 录入页：学生增删改、照片上传裁剪、权重编辑、TXT 批量导入
// 全局命名空间：window.RosterPage

(function () {
    'use strict';

    function getBody() {
        return document.getElementById('roster-page-body');
    }

    function studentCardHtml(student) {
        const photo = student.photoDataUrl
            ? `<img class="student-photo" src="${student.photoDataUrl}" alt="${Modal.escapeHtml(student.name)}">`
            : `<div class="student-photo" style="display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--primary-color);">${Modal.escapeHtml((student.name || '?')[0] || '?')}</div>`;

        const isManual = student.weightMode === 'manual';

        return `
            <div class="student-card" data-id="${student.id}">
                <div class="student-card-top">
                    <div class="student-photo-wrap">
                        ${photo}
                        <button type="button" class="student-photo-edit-btn" data-action="edit-photo" title="更换照片">✎</button>
                    </div>
                    <input type="text" class="student-name-input" data-field="name" value="${Modal.escapeHtml(student.name)}" placeholder="姓名">
                </div>
                <div class="student-fields">
                    <div class="student-field">
                        <label>成绩</label>
                        <input type="number" data-field="score" value="${student.score === null || student.score === undefined ? '' : student.score}" placeholder="未录入">
                    </div>
                    <div class="student-field">
                        <label>权重${isManual ? '（手动）' : `（=${AppState.WEIGHT_BASE}-成绩）`}</label>
                        <input type="number" data-field="weight" value="${student.weight}" min="1" ${isManual ? '' : 'readonly'}>
                    </div>
                </div>
                <label class="weight-mode-toggle">
                    <input type="checkbox" data-field="weightMode" ${isManual ? 'checked' : ''}>
                    <span>手动设置权重（不随成绩联动）</span>
                </label>
                <div class="student-card-footer">
                    <button type="button" class="student-remove-btn" data-action="remove">🗑️ 删除</button>
                </div>
            </div>
        `;
    }

    function render() {
        const body = getBody();
        if (!body) return;
        const students = AppState.getStudents();

        body.innerHTML = `
            <div id="roster-class-switcher" style="margin-bottom:0.9rem;"></div>
            <div class="roster-toolbar">
                <span class="roster-stats">共 ${students.length} 名学生 · 总权重 ${AppState.getTotalWeight()}</span>
                <div class="roster-toolbar-actions">
                    <button type="button" class="btn-primary" id="roster-import-txt-btn">📄 TXT 批量导入</button>
                    <button type="button" class="btn-primary" id="roster-add-btn">➕ 添加学生</button>
                    <button type="button" class="btn-primary" id="roster-onedrive-btn">☁️ 打开 OneDrive 备份</button>
                    <button type="button" class="btn-primary" id="roster-quick-sync-btn">📤 立即上传</button>
                </div>
            </div>
            <div class="roster-grid" id="roster-grid">
                ${students.length ? students.map(studentCardHtml).join('') : '<div class="empty-message">暂无学生，点击"添加学生"开始录入</div>'}
            </div>
            <input type="file" id="roster-txt-input" accept=".txt" hidden>
        `;

        ClassSwitcher.renderInto(body.querySelector('#roster-class-switcher'));

        body.querySelector('#roster-add-btn').addEventListener('click', handleAdd);
        body.querySelector('#roster-onedrive-btn').addEventListener('click', () => {
            OneDriveApi.open();
        });
        body.querySelector('#roster-quick-sync-btn').addEventListener('click', handleQuickSync);
        body.querySelector('#roster-import-txt-btn').addEventListener('click', () => {
            body.querySelector('#roster-txt-input').click();
        });
        body.querySelector('#roster-txt-input').addEventListener('change', handleTxtFile);

        bindCardEvents(body);
    }

    function bindCardEvents(body) {
        body.querySelectorAll('.student-card').forEach((card) => {
            const id = card.dataset.id;

            card.querySelector('[data-field="name"]').addEventListener('change', (e) => {
                AppState.updateStudent(id, { name: e.target.value.trim() || '未命名' });
            });

            card.querySelector('[data-field="score"]').addEventListener('change', (e) => {
                const val = e.target.value === '' ? null : Number(e.target.value);
                AppState.updateStudent(id, { score: val });
            });

            card.querySelector('[data-field="weight"]').addEventListener('change', (e) => {
                AppState.updateStudent(id, { weight: Number(e.target.value) || 1 });
            });

            card.querySelector('[data-field="weightMode"]').addEventListener('change', (e) => {
                AppState.updateStudent(id, { weightMode: e.target.checked ? 'manual' : 'score' });
            });

            card.querySelector('[data-action="edit-photo"]').addEventListener('click', () => handleEditPhoto(id));

            card.querySelector('[data-action="remove"]').addEventListener('click', async () => {
                const student = AppState.getStudents().find((s) => s.id === id);
                const ok = await Modal.confirm({
                    title: '删除学生',
                    text: `确定要删除「${student ? student.name : ''}」吗？`,
                    confirmText: '删除',
                    danger: true
                });
                if (ok) AppState.removeStudent(id);
            });
        });
    }

    async function handleAdd() {
        await AppState.addStudent({ name: '新同学', score: 130 });
        Toast.success('已添加');
    }

    async function handleEditPhoto(studentId) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.addEventListener('change', async () => {
            const file = input.files[0];
            if (!file) return;
            const dataUrl = await ImageCropper.open(file);
            if (!dataUrl) return;
            await AppState.updateStudent(studentId, { photoDataUrl: dataUrl });
            Toast.success('照片已更新');
        });
        input.click();
    }

    // "立即上传"：跳过 OneDrive 弹窗，直接把当前全部班级数据（含设置）上传成一份新备份；
    // 未登录时改为打开 OneDrive 弹窗引导登录，登录后用户可以在弹窗里手动上传
    async function handleQuickSync() {
        const account = MsalAuth.getAccount();
        if (!account) {
            Toast.info('请先登录 OneDrive');
            OneDriveApi.open();
            return;
        }
        const btn = document.getElementById('roster-quick-sync-btn');
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = '上传中...';
        try {
            await OneDriveApi.uploadBackup(`${ImportExport.timestampName()}.json`, AppState.exportSnapshot());
            Toast.success('已上传到 OneDrive');
        } catch (err) {
            Toast.error('上传失败: ' + err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }

    async function handleTxtFile(e) {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        const text = await file.text();
        const result = AppState.parseImportText(text);

        if (!result.ok) {
            showImportIssues(result);
            return;
        }

        if (result.created.length === 0 && result.updated.length === 0) {
            Toast.warning('未解析到任何有效行，一行一个姓名，或「姓名+Tab+成绩」');
            return;
        }

        showImportPreview(result);
    }

    // 格式冲突（有解析失败的行，或者「Tab+成绩」和「仅姓名」两种格式混用）：
    // 不做任何写入，列出每一行具体问题，要求用户改完文本后重新导入
    function showImportIssues(result) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        const rows = result.issues.map((it) => `
            <div class="import-issue-row">
                <div class="import-issue-line">第 ${it.lineNumber} 行：<code>${Modal.escapeHtml(it.content)}</code></div>
                <div class="import-issue-reason">⚠️ ${Modal.escapeHtml(it.reason)}</div>
            </div>
        `).join('');

        const hint = result.mixedFormat
            ? '检测到同一份文件里「姓名+Tab+成绩」和「仅姓名」两种格式混用了。每次导入只能用其中一种格式，请统一后重新导入。'
            : '以下几行内容无法解析，请修改后重新导入。';

        overlay.innerHTML = `
            <div class="modal-box">
                <h2>⚠️ 批量导入 - 数据格式冲突</h2>
                <p style="color:var(--text-secondary);font-size:0.88rem;">${hint}</p>
                <div class="import-preview-list">${rows}</div>
                <div class="modal-actions">
                    <button type="button" class="btn-primary" data-action="close">知道了</button>
                </div>
            </div>
        `;

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay || e.target.closest('[data-action="close"]')) overlay.remove();
        });

        document.body.appendChild(overlay);
    }

    // preview.updated 里的都是"姓名已存在"的学生，需要用户逐个或批量选择 覆盖/跳过；
    // preview.created 都是全新姓名，直接新增，不需要用户决策。
    function showImportPreview(preview) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        const createdRows = preview.created.map((it) => `
            <div class="import-preview-row">
                <span>${Modal.escapeHtml(it.name)} — 成绩 ${it.score}，权重 ${it.weight}</span>
                <span class="import-preview-tag new">新增</span>
            </div>
        `).join('');

        const conflictRows = preview.updated.map((it, i) => `
            <div class="import-preview-row">
                <label class="checkbox-label-inline">
                    <input type="checkbox" class="import-conflict-checkbox" data-index="${i}" checked>
                    <span>${Modal.escapeHtml(it.name)} — 成绩 ${it.oldScore ?? '无'} → ${it.newScore}，权重 ${it.oldWeight} → ${it.newWeight}</span>
                </label>
                <span class="import-preview-tag update">已存在</span>
            </div>
        `).join('');

        const conflictSection = preview.updated.length === 0 ? '' : `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:0.9rem;">
                <div style="font-size:0.85rem;color:var(--text-secondary);">以下 ${preview.updated.length} 人已在名单中，选择要覆盖的（不勾选则跳过，保留原有数据）</div>
                <div style="display:flex;gap:0.4rem;">
                    <button type="button" class="btn-secondary" data-action="check-all" style="padding:0.3rem 0.7rem;font-size:0.8rem;">全部覆盖</button>
                    <button type="button" class="btn-secondary" data-action="uncheck-all" style="padding:0.3rem 0.7rem;font-size:0.8rem;">全部跳过</button>
                </div>
            </div>
            <div class="import-preview-list">${conflictRows}</div>
        `;

        overlay.innerHTML = `
            <div class="modal-box">
                <h2>批量导入预览</h2>
                <p style="color:var(--text-secondary);font-size:0.88rem;">新增 ${preview.created.length} 人，已存在 ${preview.updated.length} 人。权重按 (${AppState.WEIGHT_BASE} - 成绩) 自动计算。</p>
                ${createdRows ? `<div class="import-preview-list">${createdRows}</div>` : ''}
                ${conflictSection}
                <div class="modal-actions">
                    <button type="button" class="btn-secondary" data-action="cancel">取消</button>
                    <button type="button" class="btn-primary" data-action="confirm">确认导入</button>
                </div>
            </div>
        `;

        overlay.addEventListener('click', async (e) => {
            if (e.target === overlay) { overlay.remove(); return; }
            const action = e.target.closest('[data-action]');
            if (!action) return;

            if (action.dataset.action === 'cancel') { overlay.remove(); return; }

            if (action.dataset.action === 'check-all' || action.dataset.action === 'uncheck-all') {
                const checked = action.dataset.action === 'check-all';
                overlay.querySelectorAll('.import-conflict-checkbox').forEach((cb) => { cb.checked = checked; });
                return;
            }

            if (action.dataset.action === 'confirm') {
                const checkedIndexes = new Set(
                    Array.from(overlay.querySelectorAll('.import-conflict-checkbox:checked')).map((cb) => Number(cb.dataset.index))
                );
                const finalPreview = {
                    created: preview.created,
                    updated: preview.updated.filter((_, i) => checkedIndexes.has(i))
                };
                const skippedCount = preview.updated.length - finalPreview.updated.length;
                await AppState.applyScoreImport(finalPreview);
                Toast.success(`导入完成${skippedCount ? `，跳过 ${skippedCount} 人` : ''}`);
                overlay.remove();
            }
        });

        document.body.appendChild(overlay);
    }

    window.RosterPage = { render };
})();
