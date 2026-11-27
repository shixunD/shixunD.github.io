// exportReport.js —— 主页「📤 导出统计」卡片 + 选择作业 / 背诵任务的导出弹窗（单周 / 多周 / 个人）+ 「加减分规则」设置弹窗
// 全局命名空间：window.ExportReport
// 计分在 models/scoreReport.js，三种输出在 reportOutput.js；这里只管界面。
// 1.42.0 起每次打开都一项不勾、不记上次的选择（以前记在 localStorage teachingPanel.export.*，打开时顺手删掉）。
// 勾选：最上面「全选全部内容」、每栏「全选」、每个分组夹前的复选框，部分选中时显示半选。

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
                <p class="hint">勾选作业（可整个分组夹）和背诵任务：「单周学情」把勾选的内容当作一个统计周期，生成每位学生的作业加减分与背诵过关表；「多周学情」按周勾选，每周的作业、背诵分开计分再算总分；「个人学情」选一位学生，写清每项的完成情况（不计分）。可导出为 PDF、Excel 或 Markdown。当前班级有 ${hwCount} 项作业、${rdCount} 项背诵任务。</p>
                <div class="btn-col">
                    <button type="button" class="btn-primary" data-export-report>📤 导出单周学情</button>
                    <button type="button" class="btn-primary" data-export-multi>🗓️ 导出多周学情</button>
                    <button type="button" class="btn-primary" data-export-personal>👤 导出个人学情</button>
                </div>
            </div>`;
    }

    function bindCard(root) {
        const btn = root.querySelector('[data-export-report]');
        if (btn) btn.addEventListener('click', () => openDialog());
        const mbtn = root.querySelector('[data-export-multi]');
        if (mbtn) mbtn.addEventListener('click', openMultiDialog);
        const pbtn = root.querySelector('[data-export-personal]');
        if (pbtn) pbtn.addEventListener('click', openPersonalDialog);
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

    // layout: SideGroups 布局；返回带复选框的树（默认都不勾）。分组夹的复选框 = 全选 / 取消全选里面的条目
    // weekOf（多周导出）：条目所在周的周一，写在 data-ex-wk 上，给最上面「按周勾选」用；分组的 icon 默认 📁
    function treeHtml(layout, kind, labelOf, weekOf, icon) {
        const item = (it) => `
            <label class="ex-item"><input type="checkbox" data-ex-item="${kind}" value="${it.id}"${weekOf ? ` data-ex-wk="${weekOf(it)}"` : ''}><span>${labelOf(it)}</span></label>`;
        const html = layout.map((e) => {
            if (e.type === 'item') return item(e.obj);
            if (!e.children.length) return '';
            return `
                <div class="ex-group">
                    <label class="ex-item ex-group-head" title="全选 / 取消全选这个分组夹"><input type="checkbox" data-ex-group><span>${icon || '📁'} ${esc(e.obj.title)}</span><em>${e.children.length}</em></label>
                    <div class="ex-group-body">${e.children.map((c) => item(c.obj)).join('')}</div>
                </div>`;
        }).join('');
        return html || '<div class="hint">暂无</div>';
    }

    // 一栏的表头：标题、已选几项、「全选」复选框
    function colHeadHtml(kind, title) {
        return `<div class="ex-col-head"><b>${title}</b><span class="hint" data-ex-count="${kind}"></span>
            <label class="ex-all" title="全选 / 取消全选这一栏"><input type="checkbox" data-ex-col="${kind}">全选</label></div>`;
    }
    const masterHtml = () => '<label class="ex-all ex-master"><input type="checkbox" data-ex-master>全选全部内容（作业和背诵任务）</label>';

    // 汇总复选框（分组夹 / 一栏 / 全部）按里面条目的勾选情况显示：全勾 = 勾，部分 = 半选，没有 = 不勾
    function setTri(box, items) {
        if (!box) return;
        const on = items.filter((b) => b.checked).length;
        box.checked = on > 0 && on === items.length;
        box.indeterminate = on > 0 && on < items.length;
        box.disabled = !items.length;
    }
    function syncGroups(body) {
        body.querySelectorAll('.ex-group').forEach((g) => setTri(g.querySelector('[data-ex-group]'), Array.from(g.querySelectorAll('[data-ex-item]'))));
        body.querySelectorAll('[data-ex-col]').forEach((c) => setTri(c, Array.from(body.querySelectorAll(`[data-ex-item="${c.dataset.exCol}"]`))));
        body.querySelectorAll('[data-ex-week]').forEach((c) => setTri(c, Array.from(body.querySelectorAll(`[data-ex-wk="${c.dataset.exWeek}"]`))));
        setTri(body.querySelector('[data-ex-master]'), Array.from(body.querySelectorAll('[data-ex-item]')));
    }
    // 点汇总复选框：把它管的条目全勾 / 全不勾（半选时点 = 全勾）
    function applyBulk(body, target) {
        let scope = null;
        if (target.closest('[data-ex-group]')) scope = target.closest('.ex-group').querySelectorAll('[data-ex-item]');
        else if (target.dataset.exCol) scope = body.querySelectorAll(`[data-ex-item="${target.dataset.exCol}"]`);
        else if (target.dataset.exWeek) scope = body.querySelectorAll(`[data-ex-wk="${target.dataset.exWeek}"]`);
        else if (target.hasAttribute('data-ex-master')) scope = body.querySelectorAll('[data-ex-item]');
        if (scope) scope.forEach((b) => { b.checked = target.checked; });
    }
    // 以前版本记住的勾选（1.42.0 起不再使用）：打开导出窗口时删掉
    function dropSaved(classId) {
        [LS_PREFIX + classId, LS_PREFIX + 'personal.' + classId].forEach((k) => { try { localStorage.removeItem(k); } catch (e) { /* 忽略 */ } });
    }

    // ---------- 多周：按自然周（周一到周日）分组 ----------
    // 作业看作业日期，背诵看任务设定的日期；分组夹不再起作用（一周里来自不同分组夹的作业放在一起）
    const weekRangeOf = (monday) => ReportOutput.multi.weekRange({ monday, sunday: Utils.addDays(monday, 6) });
    function weekLayout(items, weekOf) {
        const map = new Map();
        items.forEach((it) => { const m = weekOf(it); if (!map.has(m)) map.set(m, []); map.get(m).push(it); });
        return Array.from(map.keys()).sort().reverse()   // 新的一周在上，和侧栏一样
            .map((m) => ({ type: 'group', monday: m, obj: { title: weekRangeOf(m) }, children: map.get(m).map((obj) => ({ obj })) }));
    }
    // 最上面「按周勾选」：一周一个复选框，管这一周的作业和背诵任务
    function weeksStripHtml(hwLayout, rdLayout) {
        const map = new Map();
        const add = (lay, key) => lay.forEach((g) => { const x = map.get(g.monday) || { hw: 0, rec: 0 }; x[key] = g.children.length; map.set(g.monday, x); });
        add(hwLayout, 'hw'); add(rdLayout, 'rec');
        const ms = Array.from(map.keys()).sort().reverse();
        if (!ms.length) return '';
        return `<div class="ex-weeks"><span class="ex-weeks-label">按周勾选：</span>${ms.map((m) => {
            const x = map.get(m);
            const n = [x.hw ? `作业 ${x.hw}` : '', x.rec ? `背诵 ${x.rec}` : ''].filter(Boolean).join(' · ');
            return `<label class="ex-week" title="勾选 / 取消这一周的全部作业和背诵任务"><input type="checkbox" data-ex-week="${m}">${esc(weekRangeOf(m))}<small>${esc(n)}</small></label>`;
        }).join('')}</div>`;
    }

    // 单周学情（1.52.0 前叫「班级学情」）与多周学情共用这一个弹窗；multi = true 时按周列出、按周计分
    function openDialog() { openClassDialog(false); }
    function openMultiDialog() { openClassDialog(true); }

    function openClassDialog(multi) {
        const classId = AppState.getActiveClassId();
        if (!AppState.getStudents().length) { Toast.error('当前班级还没有学生'); return; }
        const hwLabel = (h) => `${esc(h.title)}<small>${esc(Utils.formatDate(h.date))}</small>`;
        const hwLayout = multi ? weekLayout(HomeworkModel.list(), ScoreReport.hwWeek) : HomeworkModel.sideLayout();
        const rdLayout = multi ? weekLayout(RecitationModel.rounds(), RecitationModel.roundWeek) : RecitationModel.roundLayout();
        const hwTree = multi ? treeHtml(hwLayout, 'hw', hwLabel, ScoreReport.hwWeek, '🗓️') : treeHtml(hwLayout, 'hw', hwLabel);
        const rdTree = multi ? treeHtml(rdLayout, 'rec', (r) => esc(r.title), RecitationModel.roundWeek, '🗓️') : treeHtml(rdLayout, 'rec', (r) => esc(r.title));
        const OUT = multi ? ReportOutput.multi : ReportOutput;
        const buildOf = (sel) => (multi ? ScoreReport.buildMulti(sel) : ScoreReport.build(sel));
        dropSaved(classId);
        let titleEdited = false;

        Modal.open({
            title: multi ? '🗓️ 导出多周学情' : '📤 导出单周学情',
            wide: true,
            dirtyKey: () => '',   // 只是选择内容，没有要保存的东西，关闭时不询问
            html: `
                <div class="ex-dialog">
                    ${masterHtml()}
                    ${multi ? weeksStripHtml(hwLayout, rdLayout) : ''}
                    <div class="ex-cols">
                        <div class="ex-col">
                            ${colHeadHtml('hw', multi ? '📝 作业（按周）' : '📝 作业')}
                            <div class="ex-tree">${hwTree}</div>
                        </div>
                        <div class="ex-col">
                            ${colHeadHtml('rec', multi ? '📖 背诵任务（按周）' : '📖 背诵任务')}
                            <div class="ex-tree">${rdTree}</div>
                        </div>
                    </div>
                    <div class="ex-opts">
                        <label class="ex-title">标题<input type="text" data-ex-title autocomplete="off"></label>
                        <label>排序<select data-ex-sort>
                            <option value="no">按学号</option>
                            <option value="score">${multi ? '按总分（高→低）' : '按最终得分（高→低）'}</option>
                        </select></label>
                    </div>
                    <div class="ex-actions">
                        <button type="button" class="btn-primary" data-ex-out="pdf">🖨️ PDF（打印）</button>
                        <button type="button" class="btn-primary" data-ex-out="xlsx">📊 Excel</button>
                        <button type="button" class="btn-primary" data-ex-out="md">📝 Markdown</button>
                        <button type="button" class="btn-secondary" data-ex-out="copy">📋 复制 Markdown</button>
                    </div>
                    ${multi ? '<p class="hint">按自然周（周一到周日）分：作业看作业日期，背诵看任务设定的日期。每周单独计分（作业的全部按时完成 / 差一项加分按那一周的作业数算），再把各周相加。报表前面是多周总分和各周概览，后面每周一份完整的单周学情；PDF 里每周从新的一页开始，Excel 里每周三张表。</p>' : ''}
                    <p class="hint">PDF：会打开浏览器的打印窗口，「打印机」选「另存为 PDF」即可保存；在「更多设置」里取消勾选「页眉和页脚」，否则会多印网址和时间（页码报表自带）。加减分规则在「主页 → ⚙️ 设置」里调整。</p>
                    <div class="ex-preview" data-ex-preview></div>
                </div>`,
            onMount(body) {
                const q = (sel) => body.querySelector(sel);
                const picked = (kind) => Array.from(body.querySelectorAll(`[data-ex-item="${kind}"]:checked`)).map((b) => b.value);

                // 默认标题：勾的作业正好全在同一个分组夹里 → 用分组夹名；否则用班级名
                function autoTitle(hwIds) {
                    if (multi) {
                        const cls = AppState.getActiveClass();
                        const k = ScoreReport.splitWeeks(hwIds, picked('rec')).length;
                        return `${cls ? cls.name + ' ' : ''}多周学情${k ? `（${k} 周）` : ''}`;
                    }
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
                    const empty = !sel.hwIds.length && !sel.roundIds.length;
                    body.querySelectorAll('[data-ex-out]').forEach((b) => { b.disabled = empty; });
                    q('[data-ex-preview]').innerHTML = empty
                        ? `<div class="empty-message">先在上面勾选要统计的${multi ? '几周的' : ''}作业或背诵任务</div>`
                        : OUT.html(buildOf(sel));
                }

                body.addEventListener('change', (e) => {
                    if (e.target.closest('[data-ex-title]')) return;
                    applyBulk(body, e.target);
                    refresh();
                });
                q('[data-ex-title]').addEventListener('input', (e) => { titleEdited = e.target.value.trim() !== ''; });
                q('[data-ex-title]').addEventListener('change', refresh);

                body.querySelectorAll('[data-ex-out]').forEach((btn) => btn.addEventListener('click', async () => {
                    const rp = buildOf(current());
                    const base = ReportOutput.fileBase(rp);
                    try {
                        if (btn.dataset.exOut === 'pdf') OUT.print(rp);
                        else if (btn.dataset.exOut === 'xlsx') {
                            Utils.downloadText(base + '.xlsx', OUT.xlsx(rp), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                            Toast.success(`已导出 ${base}.xlsx`);
                        } else if (btn.dataset.exOut === 'md') {
                            Utils.downloadText(base + '.md', OUT.markdown(rp), 'text/markdown;charset=utf-8');
                            Toast.success(`已导出 ${base}.md`);
                        } else {
                            await navigator.clipboard.writeText(OUT.markdown(rp));
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

    // ---------- 个人学情 ----------

    function openPersonalDialog() {
        const classId = AppState.getActiveClassId();
        const students = AppState.getStudents().slice().sort(Utils.compareStudentNo);
        if (!students.length) { Toast.error('当前班级还没有学生'); return; }
        dropSaved(classId);
        let titleEdited = false;

        Modal.open({
            title: '👤 导出个人学情',
            wide: true,
            dirtyKey: () => '',
            html: `
                <div class="ex-dialog">
                    <div class="ex-opts">
                        <label>学生<select data-ex-student>${students.map((s) => `<option value="${s.id}">${esc(s.studentNo ? s.studentNo + ' ' : '')}${esc(s.name)}</option>`).join('')}</select></label>
                        <label class="ex-title">标题<input type="text" data-ex-title autocomplete="off"></label>
                    </div>
                    ${masterHtml()}
                    <div class="ex-cols">
                        <div class="ex-col">
                            ${colHeadHtml('hw', '📝 作业')}
                            <div class="ex-tree">${treeHtml(HomeworkModel.sideLayout(), 'hw', (h) => `${esc(h.title)}<small>${esc(Utils.formatDate(h.date))}</small>`)}</div>
                        </div>
                        <div class="ex-col">
                            ${colHeadHtml('rec', '📖 背诵任务')}
                            <div class="ex-tree">${treeHtml(RecitationModel.roundLayout(), 'rec', (r) => esc(r.title))}</div>
                        </div>
                    </div>
                    <div class="ex-actions">
                        <button type="button" class="btn-primary" data-ex-out="pdf">🖨️ PDF（打印）</button>
                        <button type="button" class="btn-primary" data-ex-out="xlsx">📊 Excel</button>
                        <button type="button" class="btn-primary" data-ex-out="md">📝 Markdown</button>
                        <button type="button" class="btn-secondary" data-ex-out="copy">📋 复制 Markdown</button>
                    </div>
                    <p class="hint">只写出该生每项作业 / 背诵的完成情况，不计加减分。PDF：打印窗口里「打印机」选「另存为 PDF」，并在「更多设置」里取消勾选「页眉和页脚」（页码报表自带）。</p>
                    <div class="ex-preview" data-ex-preview></div>
                </div>`,
            onMount(body) {
                const q = (sel) => body.querySelector(sel);
                const picked = (kind) => Array.from(body.querySelectorAll(`[data-ex-item="${kind}"]:checked`)).map((b) => b.value);
                const nameOf = () => { const s = students.find((x) => x.id === q('[data-ex-student]').value); return s ? s.name : ''; };

                function current() {
                    if (!titleEdited) q('[data-ex-title]').value = `${nameOf()} 学情`;
                    return { studentId: q('[data-ex-student]').value, hwIds: picked('hw'), roundIds: picked('rec'), title: q('[data-ex-title]').value };
                }

                function refresh() {
                    syncGroups(body);
                    const sel = current();
                    q('[data-ex-count="hw"]').textContent = `已选 ${sel.hwIds.length} 项`;
                    q('[data-ex-count="rec"]').textContent = `已选 ${sel.roundIds.length} 项`;
                    const empty = !sel.hwIds.length && !sel.roundIds.length;
                    body.querySelectorAll('[data-ex-out]').forEach((b) => { b.disabled = empty; });
                    q('[data-ex-preview]').innerHTML = empty
                        ? '<div class="empty-message">先在上面勾选要导出的作业或背诵任务</div>'
                        : ReportOutput.personal.html(PersonalReport.build(sel));
                }

                body.addEventListener('change', (e) => {
                    if (e.target.closest('[data-ex-title]')) return;
                    applyBulk(body, e.target);
                    refresh();
                });
                q('[data-ex-title]').addEventListener('input', (e) => { titleEdited = e.target.value.trim() !== ''; });
                q('[data-ex-title]').addEventListener('change', refresh);

                body.querySelectorAll('[data-ex-out]').forEach((btn) => btn.addEventListener('click', async () => {
                    const P = ReportOutput.personal;
                    const rp = PersonalReport.build(current());
                    const base = ReportOutput.fileBase(rp);
                    try {
                        if (btn.dataset.exOut === 'pdf') P.print(rp);
                        else if (btn.dataset.exOut === 'xlsx') {
                            Utils.downloadText(base + '.xlsx', P.xlsx(rp), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                            Toast.success(`已导出 ${base}.xlsx`);
                        } else if (btn.dataset.exOut === 'md') {
                            Utils.downloadText(base + '.md', P.markdown(rp), 'text/markdown;charset=utf-8');
                            Toast.success(`已导出 ${base}.md`);
                        } else {
                            await navigator.clipboard.writeText(P.markdown(rp));
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

    window.ExportReport = { cardHtml, bindCard, settingRowHtml, openDialog, openMultiDialog, openPersonalDialog, openRules };
})();
