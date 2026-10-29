// recitationPage.js —— 背诵页外壳（二级标签切换）+「检查」视图（单轮次）
// 全局命名空间：window.RecitationPage
// 其余视图：overview.js（总览 + 时间看板）、student.js（学生趋势）

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);
    const LS_TAB = 'teachingPanel.ui.recTab';
    const TABS = [
        { key: 'check', label: '✅ 检查' },
        { key: 'plan', label: '🗓️ 计划背诵' },
        { key: 'timeline', label: '⏰ 时间看板' },
        { key: 'overview', label: '🧩 总览' },
        { key: 'student', label: '📈 学生趋势' }
    ];
    const FILTERS = [
        { key: '', label: '全部' },
        { key: 'none', label: '未检查' },
        { key: 'retry', label: '需重新过关' },
        { key: 'fail', label: '未过关' },
        { key: 'pass', label: '已过关' },
        { key: 'excel', label: '超额完成' }
    ];

    const ui = {
        tab: Utils.lsGet(LS_TAB, 'check'),
        selectedId: null,
        showArchived: false,
        filter: ''
    };

    function container() { return document.getElementById('recitation-page-body'); }

    function render() {
        const el = container();
        if (!el) return;
        if (!TABS.some((t) => t.key === ui.tab)) ui.tab = 'check';
        const rc = RecitationModel.reminderCounts();
        const badge = rc.today + rc.overdue;

        el.innerHTML = `
            <div class="page-head">
                <h1>背诵情况</h1>
                ${UI.subTabs(TABS.map((t) => t.key === 'timeline' && badge ? { key: t.key, label: `${t.label} (${badge})` } : t), ui.tab)}
            </div>
            <div id="rec-view"></div>
        `;
        el.querySelectorAll('[data-subtab]').forEach((btn) => {
            btn.addEventListener('click', () => openTab(btn.dataset.subtab));
        });
        const view = el.querySelector('#rec-view');
        if (ui.tab === 'check') renderCheck(view);
        else if (ui.tab === 'plan') RecitationPlan.render(view);
        else if (ui.tab === 'timeline') RecitationOverview.renderTimeline(view);
        else if (ui.tab === 'overview') RecitationOverview.renderOverview(view);
        else RecitationStudent.render(view);
    }

    function openTab(key, opts) {
        ui.tab = key;
        Utils.lsSet(LS_TAB, key);
        if (opts && opts.roundId) {
            ui.selectedId = opts.roundId;
            RecitationPlan.setRound(opts.roundId);
        }
        render();
    }

    // ---------- 检查视图 ----------

    function renderCheck(view) {
        const students = AppState.getStudents();
        const rounds = RecitationModel.rounds({ includeArchived: ui.showArchived });
        if (!rounds.some((r) => r.id === ui.selectedId)) ui.selectedId = rounds.length ? rounds[0].id : null;
        const round = ui.selectedId ? RecitationModel.getRound(ui.selectedId) : null;

        view.innerHTML = `
            <div class="split-layout">
                <aside class="card side-panel">
                    <div class="side-panel-head">
                        <label class="checkbox-label-inline"><input type="checkbox" data-archived ${ui.showArchived ? 'checked' : ''}> 显示已归档</label>
                        <button type="button" class="btn-primary btn-sm" data-new>＋ 新建轮次</button>
                    </div>
                    <div class="side-list">
                        ${rounds.length ? rounds.map((r) => {
                            const c = RecitationModel.roundSummary(r.id, students);
                            return `
                                <button type="button" class="side-item ${r.id === ui.selectedId ? 'active' : ''} ${r.archived ? 'archived' : ''}" data-select="${r.id}">
                                    ${r.archived ? '<div class="side-item-top"><span class="side-item-date">已归档</span></div>' : ''}
                                    <div class="side-item-title">${esc(r.title)}</div>
                                    <div class="mini-bar">${miniBar(c)}</div>
                                    <div class="side-item-sub">过关 ${c.passed}/${students.length}${c.retry + c.fail ? ` · 未过关 ${c.retry + c.fail}` : ''}</div>
                                </button>`;
                        }).join('') : '<div class="empty-message">还没有背诵轮次，点击「新建轮次」开始</div>'}
                    </div>
                </aside>
                <section class="main-panel">
                    ${round ? checkDetail(round, students) : '<div class="card empty-message">选择或新建一个背诵轮次</div>'}
                </section>
            </div>
        `;

        view.querySelector('[data-archived]').addEventListener('change', (e) => { ui.showArchived = e.target.checked; render(); });
        view.querySelector('[data-new]').addEventListener('click', () => {
            RecitationDialogs.openRoundForm(null, (created) => { ui.selectedId = created.id; render(); });
        });
        view.querySelectorAll('[data-select]').forEach((btn) => {
            btn.addEventListener('click', () => { ui.selectedId = btn.dataset.select; render(); });
        });
        if (round) bindDetail(view, round);
    }

    function miniBar(c) {
        const R = RecitationModel.RESULT_MAP;
        return ['excel', 'pass', 'retry', 'fail', 'none'].map((k) => c[k] ? `<span style="flex:${c[k]};background:${R[k].color}"></span>` : '').join('');
    }

    function checkDetail(round, students) {
        const c = RecitationModel.roundSummary(round.id, students);
        const R = RecitationModel.RESULT_MAP;
        const shown = students.filter((stu) => !ui.filter || RecitationModel.statusOf(round.id, stu.id) === ui.filter);

        return `
            <div class="card">
                <div class="detail-head">
                    <div>
                        <div class="detail-title">${esc(round.title)}</div>
                        ${round.content ? `<div class="detail-meta">${esc(round.content)}</div>` : ''}
                    </div>
                    <div class="detail-actions">
                        <button type="button" class="btn-primary btn-sm" data-plan>🗓️ 计划背诵</button>
                        <button type="button" class="btn-secondary btn-sm" data-edit>编辑</button>
                        <button type="button" class="btn-secondary btn-sm" data-archive>${round.archived ? '取消归档' : '归档'}</button>
                        <button type="button" class="btn-secondary btn-sm btn-danger-text" data-delete>删除</button>
                    </div>
                </div>
                <div class="seg-bar">${miniBar(c)}</div>
                <div class="seg-legend">
                    ${['excel', 'pass', 'retry', 'fail', 'none'].map((k) => `<span><i style="background:${R[k].color}"></i>${esc(R[k].label)} <b>${c[k]}</b></span>`).join('')}
                    <span><i style="background:${RecitationModel.PLAN.color}"></i>已计划</span>
                    <span><i class="due-legend"></i>今天要检查</span>
                    <span class="seg-rate">过关率 ${Utils.percent(c.passed, students.length)}</span>
                </div>
                <div class="brush-bar">
                    ${FILTERS.map((f) => `<button type="button" class="btn-toggle ${ui.filter === f.key ? 'btn-toggle-on' : ''}" data-filter="${f.key}">${esc(f.label)}</button>`).join('')}
                </div>
                ${students.length ? (shown.length ? `<div class="stu-grid">${shown.map((stu) => studentCard(round, stu)).join('')}</div>` : '<div class="empty-message">没有符合筛选条件的学生</div>') : UI.emptyStudentsHint()}
            </div>
        `;
    }

    // 学生卡片：状态和背诵计划同时显示、互不影响
    //   底色：有未完成的计划 -> 浅绿；否则按状态（最新一次检查的结果）
    //   第 3 行：状态（有计划时前面加状态色圆点，免得被浅绿底色盖住）
    //   第 4 行：最近检查日期；第 5 行：🗓️ 计划日期（多个时 +N）
    //   今天需要检查（今天有计划）-> 粉色边框
    function studentCard(round, stu) {
        const R = RecitationModel.RESULT_MAP;
        const today = Utils.today();
        const last = RecitationModel.latestCheck(round.id, stu.id);
        const pg = RecitationModel.progressOf(round.id, stu.id);
        const st = R[pg.status];
        const plans = RecitationModel.pendingPlans(round.id, stu.id);
        const look = plans.length ? RecitationModel.PLAN : st;
        const due = RecitationModel.dueToday(round.id, stu.id);
        const attempts = RecitationModel.checksFor(round.id, stu.id).length;

        const statusText = st.label;
        const dateLine = last ? Utils.formatDate(last.date) : '';
        let planLine = '';
        if (plans.length) {
            const overdue = plans.filter((p) => p.date < today);
            const next = overdue.length ? overdue[0] : plans[0];
            planLine = `${overdue.length ? '⚠ ' : ''}🗓️ 计划 ${Utils.formatDate(next.date)}${plans.length > 1 ? ` +${plans.length - 1}` : ''}`;
        }
        return `
            <div class="stu-card ${due ? 'due-today' : ''}" data-sid="${stu.id}" style="--st-color:${look.color};--st-text:${look.text}"
                title="${esc(st.label)}${plans.length ? ` · 计划：${plans.map((p) => Utils.formatDate(p.date)).join('、')}` : ''}${due ? ' · 今天需要检查' : ''}">
                <div class="stu-card-no">${esc(stu.studentNo)}${attempts > 1 ? ` · 第${attempts}次` : ''}</div>
                <div class="stu-card-name">${esc(stu.name)}</div>
                <div class="stu-card-status">${plans.length ? `<i class="stu-dot" style="background:${st.color}"></i>` : ''}${esc(statusText)}${last && last.note ? ' 💬' : ''}</div>
                ${dateLine ? `<div class="stu-card-date">${esc(dateLine)}</div>` : ''}
                ${planLine ? `<div class="stu-card-date stu-card-plan">${esc(planLine)}</div>` : ''}
            </div>`;
    }

    function bindDetail(view, round) {
        view.querySelector('[data-plan]').addEventListener('click', () => openTab('plan', { roundId: round.id }));
        view.querySelector('[data-edit]').addEventListener('click', () => RecitationDialogs.openRoundForm(round));
        view.querySelector('[data-archive]').addEventListener('click', () => RecitationModel.updateRound(round.id, { archived: !round.archived }));
        view.querySelector('[data-delete]').addEventListener('click', async () => {
            const ok = await Modal.confirm({
                title: '删除背诵轮次',
                text: `确定删除「${round.title}」及其全部检查记录吗？此操作不可撤销。\n（只是不想再显示的话，可以用"归档"）`,
                confirmText: '删除',
                danger: true
            });
            if (ok) await RecitationModel.removeRound(round.id);
        });
        view.querySelectorAll('[data-filter]').forEach((btn) => {
            btn.addEventListener('click', () => { ui.filter = btn.dataset.filter; render(); });
        });
        const grid = view.querySelector('.stu-grid');
        if (!grid) return;
        grid.addEventListener('click', (e) => {
            const card = e.target.closest('[data-sid]');
            if (!card) return;
            RecitationDialogs.openCheck(round.id, card.dataset.sid);
        });
    }

    window.RecitationPage = { render, openTab };
})();
