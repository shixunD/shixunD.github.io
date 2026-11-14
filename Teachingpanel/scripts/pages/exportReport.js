// exportReport.js —— 主页「📤 导出统计」卡片 + 选择作业 / 背诵任务的导出弹窗 + 「加减分规则」设置弹窗
// 全局命名空间：window.ExportReport
// 计分在 models/scoreReport.js，三种输出在 reportOutput.js；这里只管界面。
// 上次勾选记在 localStorage（teachingPanel.export.<班级 id>，仅界面偏好，不进 .db）。

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);
    const LS_PREFIX = 'teachingPanel.export.';

    function cardHtml() {
        const hwCount = HomeworkModel.list().length;
        const rdCount = RecitationModel.rounds().length;
        return `
            <div class="card">
                <h2>📤 导出统计</h2>
                <p class="hint">勾选作业（可整个分组夹）和背诵任务，生成每位学生的作业加减分与背诵过关表，导出为 PDF、Excel 或 Markdown。当前班级有 ${hwCount} 项作业、${rdCount} 项背诵任务。</p>
                <div class="btn-col">
                    <button type="button" class="btn-primary" data-export-report>📤 选择内容并导出…</button>
                </div>
            </div>`;
    }

    function bindCard(root) {
        const btn = root.querySelector('[data-export-report]');
        if (btn) btn.addEventListener('click', openDialog);
        const rules = root.querySelector('[data-score-rules]');
        if (rules) rules.addEventListener('click', openRules);
    }

    // 「⚙️ 设置」里的一行
    function settingRowHtml() {
        const r = ScoreReport.getRules();
        const S = HomeworkModel.STATUS_MAP;
        const pen = ScoreReport.PENALTY_KEYS.filter((k) => r.penalty[k] > 0).map((k) => `${S[k].label} −${r.penalty[k]}`).join('、') || '不扣分';
        return `
            <div class="setting-row">
                <div><div>导出统计：加减分规则</div><div class="hint">全部按时完成 +${r.bonusAll}、差一项 +${r.bonusOneOff}；每项 ${esc(pen)}；条件过关${r.condPass ? '算' : '不算'}过关；过关后还有未完成计划${r.planBlocks ? '判不过关' : '仍算过关'}</div></div>
                <button type="button" class="btn-secondary btn-sm" data-score-rules>调整</button>
            </div>`;
    }

    // ---------- 选择树 ----------

    // layout: SideGroups 布局；返回带复选框的树。分组夹的复选框 = 全选 / 全不选里面的条目
    function treeHtml(layout, kind, labelOf, checked) {
        const item = (it) => `
            <label class="ex-item"><input type="checkbox" data-ex-item="${kind}" value="${it.id}" ${checked.has(it.id) ? 'checked' : ''}><span>${labelOf(it)}</span></label>`;
        const html = layout.map((e) => {
            if (e.type === 'item') return item(e.obj);
            if (!e.children.length) return '';
            return `
                <div class="ex-group">
                    <label class="ex-item ex-group-head"><input type="checkbox" data-ex-group><span>📁 ${esc(e.obj.title)}</span><em>${e.children.length}</em></label>
                    <div class="ex-group-body">${e.children.map((c) => item(c.obj)).join('')}</div>
                </div>`;
        }).join('');
        return html || '<div class="hint">暂无</div>';
    }

    function syncGroups(body) {
        body.querySelectorAll('.ex-group').forEach((g) => {
            const boxes = Array.from(g.querySelectorAll('[data-ex-item]'));
            const on = boxes.filter((b) => b.checked).length;
            const head = g.querySelector('[data-ex-group]');
            head.checked = on > 0 && on === boxes.length;
            head.indeterminate = on > 0 && on < boxes.length;
        });
    }

    function readSaved(classId) {
        try { return JSON.parse(Utils.lsGet(LS_PREFIX + classId, 'null')) || {}; } catch (e) { return {}; }
    }

    function openDialog() {
        const classId = AppState.getActiveClassId();
        if (!AppState.getStudents().length) { Toast.error('当前班级还没有学生'); return; }
        const hwLayout = HomeworkModel.sideLayout();
        const rdLayout = RecitationModel.roundLayout();
        const saved = readSaved(classId);
        const hwChecked = new Set(saved.hw || []);
        const rdChecked = new Set(saved.rec || []);
        let titleEdited = false;

        Modal.open({
            title: '📤 导出统计',
            wide: true,
            dirtyKey: () => '',   // 只是选择内容，没有要保存的东西，关闭时不询问
            html: `
                <div class="ex-dialog">
                    <div class="ex-cols">
                        <div class="ex-col">
                            <div class="ex-col-head"><b>📝 作业</b><span class="hint" data-ex-count="hw"></span>
                                <button type="button" class="btn-secondary btn-sm" data-ex-all="hw">全选</button>
                                <button type="button" class="btn-secondary btn-sm" data-ex-none="hw">清空</button></div>
                            <div class="ex-tree">${treeHtml(hwLayout, 'hw', (h) => `${esc(h.title)}<small>${esc(Utils.formatDate(h.date))}</small>`, hwChecked)}</div>
                        </div>
                        <div class="ex-col">
                            <div class="ex-col-head"><b>📖 背诵任务</b><span class="hint" data-ex-count="rec"></span>
                                <button type="button" class="btn-secondary btn-sm" data-ex-none="rec">清空</button></div>
                            <div class="ex-tree">${treeHtml(rdLayout, 'rec', (r) => esc(r.title), rdChecked)}</div>
                        </div>
                    </div>
                    <div class="ex-opts">
                        <label class="ex-title">标题<input type="text" data-ex-title autocomplete="off"></label>
                        <label>排序<select data-ex-sort>
                            <option value="no">按学号</option>
                            <option value="score" ${saved.sort === 'score' ? 'selected' : ''}>按最终得分（高→低）</option>
                        </select></label>
                    </div>
                    <div class="ex-actions">
                        <button type="button" class="btn-primary" data-ex-out="pdf">🖨️ PDF（打印）</button>
                        <button type="button" class="btn-primary" data-ex-out="xlsx">📊 Excel</button>
                        <button type="button" class="btn-primary" data-ex-out="md">📝 Markdown</button>
                        <button type="button" class="btn-secondary" data-ex-out="copy">📋 复制 Markdown</button>
                    </div>
                    <p class="hint">PDF：会打开浏览器的打印窗口，「打印机」选「另存为 PDF」即可保存。加减分规则在「主页 → ⚙️ 设置」里调整。</p>
                    <div class="ex-preview" data-ex-preview></div>
                </div>`,
            onMount(body) {
                const q = (sel) => body.querySelector(sel);
                const picked = (kind) => Array.from(body.querySelectorAll(`[data-ex-item="${kind}"]:checked`)).map((b) => b.value);

                // 默认标题：勾的作业正好全在同一个分组夹里 → 用分组夹名；否则用班级名
                function autoTitle(hwIds) {
                    const groups = new Set(hwIds.map((id) => { const h = HomeworkModel.get(id); return (h && h.groupId) || ''; }));
                    if (hwIds.length && groups.size === 1) {
                        const g = SideGroups.getGroup(Array.from(groups)[0]);
                        if (g) return `${g.title} ${picked('rec').length ? '作业与背诵统计' : '作业统计'}`;
                    }
                    const cls = AppState.getActiveClass();
                    const kind = hwIds.length && picked('rec').length ? '作业与背诵统计' : (hwIds.length ? '作业统计' : '背诵统计');
                    return `${cls ? cls.name + ' ' : ''}${kind}`;
                }

                function current() {
                    const hwIds = picked('hw'), roundIds = picked('rec');
                    if (!titleEdited) q('[data-ex-title]').value = autoTitle(hwIds);
                    return { hwIds, roundIds, sort: q('[data-ex-sort]').value, title: q('[data-ex-title]').value };
                }

                function refresh() {
                    syncGroups(body);
                    const sel = current();
                    q('[data-ex-count="hw"]').textContent = `已选 ${sel.hwIds.length} 项`;
                    q('[data-ex-count="rec"]').textContent = `已选 ${sel.roundIds.length} 项`;
                    Utils.lsSet(LS_PREFIX + classId, JSON.stringify({ hw: sel.hwIds, rec: sel.roundIds, sort: sel.sort }));
                    const empty = !sel.hwIds.length && !sel.roundIds.length;
                    body.querySelectorAll('[data-ex-out]').forEach((b) => { b.disabled = empty; });
                    q('[data-ex-preview]').innerHTML = empty
                        ? '<div class="empty-message">先在上面勾选要统计的作业或背诵任务</div>'
                        : ReportOutput.html(ScoreReport.build(sel));
                }

                body.addEventListener('change', (e) => {
                    const g = e.target.closest('[data-ex-group]');
                    if (g) g.closest('.ex-group').querySelectorAll('[data-ex-item]').forEach((b) => { b.checked = g.checked; });
                    if (e.target.closest('[data-ex-title]')) return;
                    refresh();
                });
                q('[data-ex-title]').addEventListener('input', (e) => { titleEdited = e.target.value.trim() !== ''; });
                q('[data-ex-title]').addEventListener('change', refresh);
                body.querySelectorAll('[data-ex-all], [data-ex-none]').forEach((btn) => btn.addEventListener('click', () => {
                    const kind = btn.dataset.exAll || btn.dataset.exNone;
                    body.querySelectorAll(`[data-ex-item="${kind}"]`).forEach((b) => { b.checked = !!btn.dataset.exAll; });
                    refresh();
                }));

                body.querySelectorAll('[data-ex-out]').forEach((btn) => btn.addEventListener('click', async () => {
                    const rp = ScoreReport.build(current());
                    const base = ReportOutput.fileBase(rp);
                    try {
                        if (btn.dataset.exOut === 'pdf') ReportOutput.print(rp);
                        else if (btn.dataset.exOut === 'xlsx') {
                            Utils.downloadText(base + '.xlsx', ReportOutput.xlsx(rp), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                            Toast.success(`已导出 ${base}.xlsx`);
                        } else if (btn.dataset.exOut === 'md') {
                            Utils.downloadText(base + '.md', ReportOutput.markdown(rp), 'text/markdown;charset=utf-8');
                            Toast.success(`已导出 ${base}.md`);
                        } else {
                            await navigator.clipboard.writeText(ReportOutput.markdown(rp));
                            Toast.success('Markdown 已复制到剪贴板');
                        }
                    } catch (err) {
                        Toast.error('导出失败：' + err.message);
                    }
                }));

                refresh();
            }
        });
    }

    // ---------- 加减分规则 ----------

    function openRules() {
        const r = ScoreReport.getRules();
        const S = HomeworkModel.STATUS_MAP;
        const sq = (k) => `<i class="rp-sq" style="background:${S[k].color}"></i>`;
        const numRow = (name, label, value, hint) => `
            <div class="setting-row">
                <div><div>${label}</div>${hint ? `<div class="hint">${hint}</div>` : ''}</div>
                <div class="inline-input"><input type="number" name="${name}" min="0" max="100" step="0.5" value="${value}"> 分</div>
            </div>`;
        Modal.open({
            title: '导出统计：加减分规则',
            html: `
                <form data-form>
                    <div class="qp-group-title">📝 作业加分</div>
                    ${numRow('bonusAll', `${sq('done')} 全部作业都是绿色`, r.bonusAll, '只有 1 项作业时也按这一档：绿色加分，否则不加')}
                    ${numRow('bonusOneOff', `${sq('done')} 只差 1 项不是绿色`, r.bonusOneOff, '作业不少于 2 项时才有这一档；蓝色（已补）不算绿色')}
                    <div class="qp-group-title">📝 作业扣分（每项）</div>
                    ${numRow('p_poor', `${sq('poor')} ${S.poor.label}`, r.penalty.poor)}
                    ${numRow('p_missing', `${sq('missing')} ${S.missing.label}`, r.penalty.missing)}
                    ${numRow('p_poor_fixed', `${sq('poor_fixed')} ${S.poor_fixed.label}`, r.penalty.poor_fixed, '填 0 = 不扣分')}
                    ${numRow('p_missing_fixed', `${sq('missing_fixed')} ${S.missing_fixed.label}`, r.penalty.missing_fixed, '填 0 = 不扣分')}
                    <div class="qp-group-title">📖 背诵加减分（每个任务）</div>
                    ${numRow('recEarly', '提前完成', r.recEarly, '检查里有「提前完成」（直接加，不看计划）')}
                    ${numRow('recOnPlan', '计划当日完成', r.recOnPlan, '没有计划，或只有一次计划且计划当日过关（完成过关 / 条件过关）；过关之后才排的计划不算')}
                    ${numRow('recLate', '拖到之后才完成', r.recLate, '过关前有多个计划日期，或计划当日没过关 / 之后又重新过关，但最终过关')}
                    ${numRow('recFail', '最终没过关（扣分）', r.recFail, '最终仍是计划中（蓝）/ 重新过关（黄）/ 未过关（红）/ 未检查')}
                    <div class="qp-group-title">📖 背诵过关判定</div>
                    <label class="setting-row ex-check"><div><div>「条件过关」算过关</div><div class="hint">关掉后只有提前完成、完成过关算 ✓</div></div><input type="checkbox" name="condPass" ${r.condPass ? 'checked' : ''}></label>
                    <label class="setting-row ex-check"><div><div>过关后还有未完成的背诵计划 → 判不过关</div><div class="hint">打开 = 按检查页学生卡片的底色判（卡片是天蓝色就不算过关）。默认关：只看最新一次检查结果，过关后多出来的计划多半是误操作</div></div><input type="checkbox" name="planBlocks" ${r.planBlocks ? 'checked' : ''}></label>
                    <div class="modal-actions">
                        <button type="button" class="btn-secondary" data-reset>恢复默认</button>
                        <button type="button" class="btn-secondary" data-dialog-close>取消</button>
                        <button type="submit" class="btn-primary">保存</button>
                    </div>
                </form>`,
            onMount(body, close) {
                const form = body.querySelector('[data-form]');
                const el = form.elements;
                const fill = (x) => {
                    el.bonusAll.value = x.bonusAll; el.bonusOneOff.value = x.bonusOneOff;
                    ['recEarly', 'recOnPlan', 'recLate', 'recFail'].forEach((k) => { el[k].value = x[k]; });
                    ScoreReport.PENALTY_KEYS.forEach((k) => { el['p_' + k].value = x.penalty[k]; });
                    el.condPass.checked = x.condPass; el.planBlocks.checked = x.planBlocks;
                };
                body.querySelector('[data-reset]').addEventListener('click', () => fill(ScoreReport.defaultRules()));
                form.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const penalty = {};
                    ScoreReport.PENALTY_KEYS.forEach((k) => { penalty[k] = el['p_' + k].value; });
                    await ScoreReport.saveRules({
                        bonusAll: el.bonusAll.value, bonusOneOff: el.bonusOneOff.value, penalty,
                        recEarly: el.recEarly.value, recOnPlan: el.recOnPlan.value, recLate: el.recLate.value, recFail: el.recFail.value,
                        condPass: el.condPass.checked, planBlocks: el.planBlocks.checked
                    });
                    close();
                    Toast.success('加减分规则已保存');
                });
            }
        });
    }

    window.ExportReport = { cardHtml, bindCard, settingRowHtml, openDialog, openRules };
})();
