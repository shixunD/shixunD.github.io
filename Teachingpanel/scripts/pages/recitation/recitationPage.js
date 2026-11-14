// recitationPage.js —— 背诵页外壳（二级标签切换）+「检查」视图（单轮次）
// 全局命名空间：window.RecitationPage
// 其余视图：overview.js（总览 + 时间看板）；学生趋势在导航页「📈 学生趋势」（student.js 提供背诵那一块）

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);
    const LS_TAB = 'teachingPanel.ui.recTab';
    const TABS = [
        { key: 'check', label: '✅ 检查' },
        { key: 'plan', label: '🗓️ 计划背诵' },
        { key: 'timeline', label: '⏰ 时间看板' },
        { key: 'overview', label: '🧩 总览' }
    ];
    const FILTERS = [
        { key: '', label: '全部' },
        { key: 'none', label: '未检查' },
        { key: 'retry', label: '重新过关' },
        { key: 'fail', label: '未过关' },
        { key: 'pass', label: '完成过关' },
        { key: 'excel', label: '提前完成' },
        { key: 'cond', label: '条件过关' }
    ];

    const ui = {
        tab: Utils.lsGet(LS_TAB, 'check'),
        selectedId: null,
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
        else RecitationOverview.renderOverview(view);
        flashPending(view);
    }

    // 从学生趋势跳过来：定位到该学生的卡片并闪三秒（只闪一次，之后清掉）
    function flashPending(view) {
        const sid = ui.flashSid;
        if (!sid) return;
        ui.flashSid = null;
        const card = Array.from(view.querySelectorAll('.stu-card')).find((c) => c.dataset.sid === sid);
        const side = view.querySelector('.side-item.active');
        if (side) side.scrollIntoView({ block: 'nearest' });
        if (!card) return;
        card.scrollIntoView({ block: 'center' });
        card.classList.add('flash-student');
        setTimeout(() => card.classList.remove('flash-student'), 3000);
    }

    // 学生趋势 -> 背诵页：打开某个轮次的检查视图，并闪烁某个学生
    function jumpTo(roundId, studentId) {
        ui.tab = 'check';
        Utils.lsSet(LS_TAB, 'check');
        ui.selectedId = roundId;
        ui.filter = '';
        ui.flashSid = studentId;
        RecitationPlan.setRound(roundId);
        Navigation.goTo('recitation');
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
        const rounds = RecitationModel.rounds();
        if (!rounds.some((r) => r.id === ui.selectedId)) ui.selectedId = rounds.length ? rounds[0].id : null;
        const round = ui.selectedId ? RecitationModel.getRound(ui.selectedId) : null;

        view.innerHTML = `
            <div class="split-layout">
                <aside class="card side-panel">
                    <div class="side-panel-head">
                        <button type="button" class="btn-primary btn-sm" data-new>＋ 新建轮次</button>
                        <button type="button" class="btn-secondary btn-sm" data-new-group title="新建分组夹，可把轮次拖进去，点击可折叠">＋ 分组</button>
                    </div>
                    <div class="side-list">
                        ${UI.sideTreeHtml(RecitationModel.roundLayout(), (r) => itemHtml(r, students), '<div class="empty-message">还没有背诵轮次，点击「新建轮次」开始</div>')}
                    </div>
                </aside>
                <section class="main-panel">
                    ${round ? checkDetail(round, students) : '<div class="card empty-message">选择或新建一个背诵轮次</div>'}
                </section>
            </div>
        `;

        view.querySelector('[data-new]').addEventListener('click', () => {
            RecitationDialogs.openRoundForm(null, (created) => { ui.selectedId = created.id; render(); });
        });
        view.querySelectorAll('[data-select]').forEach((btn) => {
            btn.addEventListener('click', () => { ui.selectedId = btn.dataset.select; render(); });
        });
        bindRoundDrag(view);
        if (round) bindDetail(view, round);
    }

    function itemHtml(r, students) {
        const c = RecitationModel.roundSummary(r.id, students);
        return `
            <button type="button" class="side-item ${r.id === ui.selectedId ? 'active' : ''}" data-select="${r.id}" draggable="true" title="按住拖动可调整顺序">
                <div class="side-item-row">
                    <div class="side-item-title">${esc(r.title)}</div>
                    <div class="side-item-sub">${c.none ? `未检查 ${c.none} · ` : ''}过关 ${c.passed}/${students.length}</div>
                </div>
                <div class="mini-bar">${miniBar(c)}</div>
            </button>`;
    }

    // 侧栏拖动排序 + 分组夹（UI.bindSideTree）
    function bindRoundDrag(view) {
        view.querySelector('[data-new-group]').addEventListener('click', async () => {
            const name = await Modal.prompt({ title: '新建分组', placeholder: '如：第一单元' });
            if (name && name.trim()) await SideGroups.createGroup('rec', name.trim());
        });
        UI.bindSideTree(view, {
            move: (drag, drop) => RecitationModel.moveSide(drag, drop),
            toggle: (id) => SideGroups.updateGroup(id, { collapsed: !SideGroups.getGroup(id).collapsed }),
            rename: async (id) => {
                const g = SideGroups.getGroup(id);
                const name = await Modal.prompt({ title: '重命名分组', value: g.title });
                if (name && name.trim()) await SideGroups.updateGroup(id, { title: name.trim() });
            },
            remove: async (id) => {
                const g = SideGroups.getGroup(id);
                const ok = await Modal.confirm({ title: '删除分组', text: `确定删除分组「${g.title}」吗？里面的背诵轮次不会被删除，会回到列表中。`, confirmText: '删除', danger: true });
                if (ok) await RecitationModel.removeGroup(id);
            }
        });
    }

    function miniBar(c) {
        const R = RecitationModel.RESULT_MAP;
        return ['excel', 'pass', 'cond', 'retry', 'fail', 'none'].map((k) => c[k] ? `<span style="flex:${c[k]};background:${R[k].color}"></span>` : '').join('');
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
                        <button type="button" class="btn-secondary btn-sm btn-danger-text" data-delete>删除</button>
                    </div>
                </div>
                <div class="seg-bar">${miniBar(c)}</div>
                <div class="seg-legend">
                    <div class="seg-items">${['excel', 'pass', 'cond', 'retry', 'fail', 'none'].map((k) => `<span><i style="background:${R[k].color}"></i>${esc(R[k].label)} <b>${c[k]}</b></span>`).join('')}
                    <span><i style="background:${RecitationModel.PLAN.color}"></i>已计划</span>
                    <span><i class="due-legend"></i>今天要检查</span></div>
                    <span class="seg-rate">过关率 ${Utils.percent(c.passed, students.length)}</span>
                </div>
                <div class="brush-bar">
                    ${FILTERS.map((f) => `<button type="button" class="btn-toggle ${ui.filter === f.key ? 'btn-toggle-on' : ''}" data-filter="${f.key}">${esc(f.label)}</button>`).join('')}
                </div>
                ${students.length ? (shown.length ? `<div class="stu-grid">${shown.map((stu) => studentCard(round, stu)).join('')}</div>` : '<div class="empty-message">没有符合筛选条件的学生</div>') : UI.emptyStudentsHint()}
            </div>
        `;
    }

    // 学生卡片（检查 + 计划同时显示、互不影响）
    //   底色：看所有记录（检查 + 未完成的计划）的最后一天——
    //         最后一天只有计划（日期晚于最新一次检查，或一次都没检查过）-> 统一天蓝（PLAN），哪怕之前已经过关；
    //         最后一天有检查（同一天又有计划也算）-> 该检查的结果色；都没有 -> 灰（未检查）
    //   不再显示状态文字行
    //   日期：每行一个，按日期升序。检查记录：日期前加该结果色的小圆点；计划：日期前用 🗓️（逾期未检查的整行标红）
    //   今天需要检查（今天有计划）-> 粉色边框
    function studentCard(round, stu) {
        const R = RecitationModel.RESULT_MAP;
        const today = Utils.today();
        const pg = RecitationModel.progressOf(round.id, stu.id);
        const st = R[pg.status];
        const checks = RecitationModel.checksFor(round.id, stu.id);
        const plans = RecitationModel.pendingPlans(round.id, stu.id);
        // 所有记录里「最后一天」只有计划（比最新一次检查还晚）-> 天蓝；最后一天有检查（含同一天又有计划）-> 按该检查的结果色
        const lastPlanDate = plans.length ? plans[plans.length - 1].date : '';
        const planIsLast = lastPlanDate && (!pg.check || lastPlanDate > pg.check.date);
        const look = planIsLast ? RecitationModel.PLAN : st;
        const due = RecitationModel.dueToday(round.id, stu.id);
        const attempts = checks.length;

        // 同一天既有检查又有计划时，检查在前
        const rows = checks.map((c) => ({ date: c.date, order: 0, c }))
            .concat(plans.map((p) => ({ date: p.date, order: 1, p })))
            .sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
        const dateLines = rows.map((r) => r.c
            ? `<div class="stu-card-date"><span class="dl-mark"><i class="stu-dot" style="background:${(R[r.c.result] || RecitationModel.NONE).color}"></i></span>${esc(Utils.formatDate(r.date))}${r.c.note ? ' 💬' : ''}</div>`
            : `<div class="stu-card-date stu-card-plan ${r.date < today ? 'overdue' : ''}"><span class="dl-mark">🗓️</span>${esc(Utils.formatDate(r.date))}</div>`).join('');
        return `
            <div class="stu-card ${due ? 'due-today' : ''}" data-sid="${stu.id}" style="--st-color:${look.color};--st-text:${look.text}"
                title="${esc(st.label)}${plans.length ? ` · 计划：${plans.map((p) => Utils.formatDate(p.date)).join('、')}` : ''}${due ? ' · 今天需要检查' : ''}">
                <div class="stu-card-no">${esc(stu.studentNo)}${attempts > 1 ? ` · 第${attempts}次` : ''}</div>
                <div class="stu-card-name">${esc(stu.name)}</div>
                ${dateLines}
            </div>`;
    }

    function bindDetail(view, round) {
        view.querySelector('[data-plan]').addEventListener('click', () => openTab('plan', { roundId: round.id }));
        view.querySelector('[data-edit]').addEventListener('click', () => RecitationDialogs.openRoundForm(round));
        view.querySelector('[data-delete]').addEventListener('click', async () => {
            const ok = await Modal.confirm({
                title: '删除背诵轮次',
                text: `确定删除「${round.title}」及其全部检查记录吗？此操作不可撤销。`,
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

    window.RecitationPage = { render, openTab, jumpTo };
})();
