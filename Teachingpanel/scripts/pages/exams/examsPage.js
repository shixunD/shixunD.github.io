// examsPage.js —— 考试页外壳（二级标签）+「考试」视图（列表 + 单场详情/统计/导入导出）
// 全局命名空间：window.ExamsPage
// 学生看板视图在 examStudent.js

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);
    const LS_TAB = 'teachingPanel.ui.examTab';
    const TABS = [
        { key: 'exams', label: '📋 考试' },
        { key: 'student', label: '📈 学生看板' }
    ];
    const ui = { tab: Utils.lsGet(LS_TAB, 'exams'), selectedId: null };

    function container() { return document.getElementById('exams-page-body'); }

    function render() {
        const el = container();
        if (!el) return;
        if (!TABS.some((t) => t.key === ui.tab)) ui.tab = 'exams';
        el.innerHTML = `
            <div class="page-head">
                <h1>考试情况</h1>
                ${UI.subTabs(TABS, ui.tab)}
            </div>
            <div id="exam-view"></div>
        `;
        el.querySelectorAll('[data-subtab]').forEach((btn) => btn.addEventListener('click', () => openTab(btn.dataset.subtab)));
        const view = el.querySelector('#exam-view');
        if (ui.tab === 'exams') renderExams(view);
        else ExamStudent.render(view);
    }

    function openTab(key) {
        ui.tab = key;
        Utils.lsSet(LS_TAB, key);
        render();
    }

    function renderExams(view) {
        const exams = ExamModel.list();
        if (!exams.some((e) => e.id === ui.selectedId)) ui.selectedId = exams.length ? exams[0].id : null;
        const exam = ui.selectedId ? ExamModel.get(ui.selectedId) : null;

        view.innerHTML = `
            <div class="split-layout">
                <aside class="card side-panel">
                    <div class="side-panel-head">
                        <button type="button" class="btn-primary btn-sm" data-new>＋ 新建考试</button>
                    </div>
                    <div class="side-list">
                        ${exams.length ? exams.map((e) => {
                            const st = ExamModel.stats(e);
                            return `<button type="button" class="side-item ${e.id === ui.selectedId ? 'active' : ''}" data-select="${e.id}">
                                <div class="side-item-top"><span class="side-item-date">${Utils.formatDate(e.date)}</span></div>
                                <div class="side-item-title">${esc(e.name)}</div>
                                <div class="side-item-sub">${st.count ? `${st.count} 人 · 均分 ${Utils.formatNumber(st.avg, 1)}` : '未录入成绩'}</div>
                            </button>`;
                        }).join('') : '<div class="empty-message">还没有考试，点击「新建考试」</div>'}
                    </div>
                </aside>
                <section class="main-panel">${exam ? detailHtml(exam) : '<div class="card empty-message">选择或新建一场考试</div>'}</section>
            </div>
        `;

        view.querySelector('[data-new]').addEventListener('click', () => {
            ExamDialogs.openForm(null, (created) => { ui.selectedId = created.id; render(); });
        });
        view.querySelectorAll('[data-select]').forEach((btn) => btn.addEventListener('click', () => { ui.selectedId = btn.dataset.select; render(); }));
        if (exam) bindDetail(view, exam);
    }

    function detailHtml(exam) {
        const st = ExamModel.stats(exam);
        const dist = ExamModel.distribution(exam);
        return `
            <div class="card">
                <div class="detail-head">
                    <div>
                        <div class="detail-title">${esc(exam.name)}</div>
                        <div class="detail-meta">${Utils.formatDate(exam.date)} · 满分 ${exam.fullScore}</div>
                    </div>
                    <div class="detail-actions">
                        <button type="button" class="btn-secondary btn-sm" data-edit>编辑</button>
                        <button type="button" class="btn-secondary btn-sm btn-danger-text" data-delete>删除</button>
                    </div>
                </div>
                <div class="action-row">
                    <button type="button" class="btn-primary btn-sm" data-entry>✏️ 录入成绩</button>
                    <button type="button" class="btn-secondary btn-sm" data-import>📥 导入 TXT</button>
                    <button type="button" class="btn-secondary btn-sm" data-export ${st.count ? '' : 'disabled'}>📤 导出 TXT</button>
                </div>
                <div class="stat-row">
                    ${UI.statTile('参考人数', `${st.count}/${st.total}`)}
                    ${UI.statTile('平均分', Utils.formatNumber(st.avg, 1))}
                    ${UI.statTile('最高分', st.max == null ? '-' : ExamModel.formatScore(st.max), null, '#1e8e3e')}
                    ${UI.statTile('最低分', st.min == null ? '-' : ExamModel.formatScore(st.min), null, '#d93025')}
                    ${UI.statTile('及格率', st.passRate == null ? '-' : `${Math.round(st.passRate * 100)}%`, `及格线 ${Utils.formatNumber(st.passLine, 1)}`)}
                </div>
                ${st.count ? `
                    <h3 class="section-title">分数段分布</h3>
                    ${SvgChart.bars({ labels: dist.map((d) => d.label), values: dist.map((d) => d.count), color: 'var(--primary-color)' })}
                    <h3 class="section-title">成绩排名</h3>
                    <table class="simple-table rank-table">
                        <thead><tr><th>名次</th><th>学号</th><th>姓名</th><th>成绩</th><th>得分率</th></tr></thead>
                        <tbody>${st.entries.map((x) => `<tr>
                            <td>${st.ranks[x.student.id]}</td><td>${esc(x.student.studentNo)}</td><td>${UI.studentLink(x.student)}</td>
                            <td><b>${ExamModel.formatScore(x.score)}</b></td><td>${Utils.percent(x.score, exam.fullScore)}</td></tr>`).join('')}
                        </tbody>
                    </table>
                    ${st.total > st.count ? `<div class="hint">未录入：${AppState.getStudents().filter((s) => exam.scores[s.id] == null).map((s) => esc(s.name)).join('、')}</div>` : ''}
                ` : '<div class="empty-message">还没有成绩，点击「录入成绩」或「导入 TXT」</div>'}
            </div>`;
    }

    function bindDetail(view, exam) {
        view.querySelector('[data-edit]').addEventListener('click', () => ExamDialogs.openForm(exam));
        view.querySelector('[data-delete]').addEventListener('click', async () => {
            const ok = await Modal.confirm({ title: '删除考试', text: `确定删除「${exam.name}」及全部成绩吗？此操作不可撤销。`, confirmText: '删除', danger: true });
            if (ok) await ExamModel.remove(exam.id);
        });
        view.querySelector('[data-entry]').addEventListener('click', () => ExamDialogs.openScoreEntry(exam.id));
        view.querySelector('[data-import]').addEventListener('click', () => ExamDialogs.openImport(exam.id));
        view.querySelector('[data-export]').addEventListener('click', () => {
            const name = `${exam.date}_${exam.name}.txt`.replace(/[\\/:*?"<>|]/g, '_');
            Utils.downloadText(name, ExamModel.exportTxt(exam.id));
        });
    }

    window.ExamsPage = { render, openTab };
})();
