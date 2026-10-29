// homeworkPage.js —— 作业页外壳（二级标签切换）+「登记」视图
// 全局命名空间：window.HomeworkPage
// 其余视图：matrix.js（总览矩阵 + 欠交清单）、student.js（学生趋势）

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);
    const LS_TAB = 'teachingPanel.ui.hwTab';
    const TABS = [
        { key: 'register', label: '📝 登记' },
        { key: 'matrix', label: '🧩 总览' },
        { key: 'pending', label: '⏳ 欠交清单' },
        { key: 'student', label: '📈 学生趋势' }
    ];

    // 页面级界面状态（不进 AppState，不持久化业务数据）
    const ui = {
        tab: Utils.lsGet(LS_TAB, 'register'),
        selectedId: null,
        // 刷子模式：null = 点击学生弹出登记框；其他 = 点击直接套用该状态
        brush: null
    };

    function container() { return document.getElementById('homework-page-body'); }

    function render() {
        const el = container();
        if (!el) return;
        if (!TABS.some((t) => t.key === ui.tab)) ui.tab = 'register';

        el.innerHTML = `
            <div class="page-head">
                <h1>作业情况</h1>
                ${UI.subTabs(TABS, ui.tab)}
            </div>
            <div id="hw-view"></div>
        `;
        el.querySelectorAll('[data-subtab]').forEach((btn) => {
            btn.addEventListener('click', () => openTab(btn.dataset.subtab));
        });

        const view = el.querySelector('#hw-view');
        if (ui.tab === 'register') renderRegister(view);
        else if (ui.tab === 'matrix') HomeworkMatrix.renderMatrix(view);
        else if (ui.tab === 'pending') HomeworkMatrix.renderPending(view);
        else HomeworkStudent.render(view);
    }

    function openTab(key, opts) {
        ui.tab = key;
        Utils.lsSet(LS_TAB, key);
        if (opts && opts.homeworkId) { ui.selectedId = opts.homeworkId; }
        render();
    }

    // ---------- 登记视图 ----------

    const BRUSHES = [
        { key: null, label: '点击弹窗登记' },
        { key: 'missing', label: '刷：未完成' },
        { key: 'poor', label: '刷：未按要求' },
        { key: 'fix', label: '刷：已补上' },
        { key: 'done', label: '刷：恢复完成' }
    ];

    function renderRegister(view) {
        const students = AppState.getStudents();
        const list = HomeworkModel.list();
        if (!list.some((h) => h.id === ui.selectedId)) ui.selectedId = list.length ? list[0].id : null;
        const hw = ui.selectedId ? HomeworkModel.get(ui.selectedId) : null;

        view.innerHTML = `
            <div class="split-layout">
                <aside class="card side-panel">
                    <div class="side-panel-head">
                        <button type="button" class="btn-primary btn-sm" data-new>＋ 新建作业</button>
                    </div>
                    <div class="side-list">
                        ${list.length ? list.map((h) => {
                            const c = HomeworkModel.summarize(h, students);
                            const problems = students.length - c.done;
                            return `
                                <button type="button" class="side-item ${h.id === ui.selectedId ? 'active' : ''}" data-select="${h.id}">
                                    <div class="side-item-top"><span class="side-item-date">${Utils.formatDate(h.date)}</span></div>
                                    <div class="side-item-title">${esc(h.title)}</div>
                                    <div class="side-item-sub">${problems ? `<span class="dot" style="background:#d93025"></span>${c.missing + c.poor} 未补 · ${c.missing_fixed + c.poor_fixed} 已补` : '全部完成'}</div>
                                </button>`;
                        }).join('') : '<div class="empty-message">还没有作业，点击「新建作业」开始登记</div>'}
                    </div>
                </aside>
                <section class="main-panel">
                    ${hw ? registerDetail(hw, students) : `<div class="card empty-message">选择或新建一项作业</div>`}
                </section>
            </div>
        `;

        view.querySelector('[data-new]').addEventListener('click', () => {
            HomeworkDialogs.openForm(null, (created) => { ui.selectedId = created.id; render(); });
        });
        view.querySelectorAll('[data-select]').forEach((btn) => {
            btn.addEventListener('click', () => { ui.selectedId = btn.dataset.select; render(); });
        });
        if (hw) bindDetail(view, hw);
    }

    function registerDetail(hw, students) {
        const c = HomeworkModel.summarize(hw, students);
        const total = students.length || 1;
        return `
            <div class="card">
                <div class="detail-head">
                    <div>
                        <div class="detail-title">${esc(hw.title)}</div>
                        <div class="detail-meta">${Utils.formatDate(hw.date)}${hw.note ? ` · ${esc(hw.note)}` : ''}</div>
                    </div>
                    <div class="detail-actions">
                        <button type="button" class="btn-secondary btn-sm" data-edit>编辑</button>
                        <button type="button" class="btn-secondary btn-sm btn-danger-text" data-delete>删除</button>
                    </div>
                </div>
                <div class="seg-bar">
                    ${HomeworkModel.STATUSES.map((s) => c[s.key] ? `<span style="flex:${c[s.key]};background:${s.color}" title="${esc(s.label)} ${c[s.key]}"></span>` : '').join('')}
                </div>
                <div class="seg-legend">
                    ${HomeworkModel.STATUSES.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)} <b>${c[s.key]}</b></span>`).join('')}
                    <span class="seg-rate">按时完成率 ${Utils.percent(c.done, total)}</span>
                </div>
                <div class="brush-bar">
                    ${BRUSHES.map((b) => `<button type="button" class="btn-toggle ${ui.brush === b.key ? 'btn-toggle-on' : ''}" data-brush="${b.key || ''}">${esc(b.label)}</button>`).join('')}
                </div>
                ${students.length ? `<div class="stu-grid">${students.map((stu) => studentCard(hw, stu)).join('')}</div>` : UI.emptyStudentsHint()}
            </div>
        `;
    }

    function studentCard(hw, stu) {
        const rec = HomeworkModel.getRecord(hw, stu.id);
        const st = HomeworkModel.STATUS_MAP[rec.status];
        const canFix = HomeworkModel.isOutstanding(rec.status);
        return `
            <div class="stu-card" data-sid="${stu.id}" style="--st-color:${st.color};--st-text:${st.text}" title="${esc(st.label)}${rec.comment ? '：' + esc(rec.comment) : ''}">
                <div class="stu-card-no">${esc(stu.studentNo)}</div>
                <div class="stu-card-name">${esc(stu.name)}</div>
                <div class="stu-card-status">${esc(st.short)}${rec.comment ? ' 💬' : ''}</div>
                ${canFix ? `<button type="button" class="stu-card-fix" data-fix="${stu.id}" title="标记为已补上">补</button>` : ''}
            </div>`;
    }

    function bindDetail(view, hw) {
        view.querySelector('[data-edit]').addEventListener('click', () => HomeworkDialogs.openForm(hw));
        view.querySelector('[data-delete]').addEventListener('click', async () => {
            const ok = await Modal.confirm({
                title: '删除作业',
                text: `确定删除「${hw.title}」（${Utils.formatDate(hw.date)}）及其全部登记记录吗？`,
                confirmText: '删除',
                danger: true
            });
            if (ok) await HomeworkModel.remove(hw.id);
        });
        view.querySelectorAll('[data-brush]').forEach((btn) => {
            btn.addEventListener('click', () => { ui.brush = btn.dataset.brush || null; render(); });
        });
        const grid = view.querySelector('.stu-grid');
        if (!grid) return;
        grid.addEventListener('click', async (e) => {
            const fixBtn = e.target.closest('[data-fix]');
            if (fixBtn) {
                e.stopPropagation();
                await HomeworkDialogs.markFixed(hw.id, fixBtn.dataset.fix);
                return;
            }
            const card = e.target.closest('[data-sid]');
            if (!card) return;
            const sid = card.dataset.sid;
            if (!ui.brush) { HomeworkDialogs.openStatus(hw.id, sid); return; }
            if (ui.brush === 'fix') await HomeworkDialogs.markFixed(hw.id, sid);
            else await HomeworkModel.setRecord(hw.id, sid, { status: ui.brush });
        });
    }

    window.HomeworkPage = { render, openTab, ui };
})();
