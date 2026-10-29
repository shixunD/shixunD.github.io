// matrix.js —— 作业「总览矩阵」（学生 × 作业色块表）与「欠交清单」（按作业分组）两个视图
// 全局命名空间：window.HomeworkMatrix

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);
    const RANGES = [
        { key: '14', label: '近 2 周' },
        { key: '30', label: '近 1 个月' },
        { key: '90', label: '近 3 个月' },
        { key: 'all', label: '全部' }
    ];
    const ui = { range: '30' };

    function filter() {
        return {
            from: ui.range === 'all' ? null : Utils.addDays(Utils.today(), -Number(ui.range))
        };
    }

    function toolbar() {
        return `
            <div class="toolbar card">
                <select data-f-range>${RANGES.map((r) => `<option value="${r.key}" ${r.key === ui.range ? 'selected' : ''}>${r.label}</option>`).join('')}</select>
                ${UI.legend(HomeworkModel.STATUSES.map((s) => ({ color: s.color, label: s.label })))}
            </div>`;
    }

    function bindToolbar(view, rerender) {
        view.querySelector('[data-f-range]').addEventListener('change', (e) => { ui.range = e.target.value; rerender(); });
    }

    // ---------- 总览矩阵 ----------

    function renderMatrix(view) {
        const students = AppState.getStudents();
        const hws = HomeworkModel.list(filter());

        let body;
        if (!students.length) body = UI.emptyStudentsHint();
        else if (!hws.length) body = '<div class="empty-message">该范围内没有作业</div>';
        else {
            body = `
                <div class="matrix-scroll">
                    <table class="matrix">
                        <thead><tr>
                            <th class="sticky-col">学生</th>
                            ${hws.map((hw) => {
                                const c = HomeworkModel.summarize(hw, students);
                                return `<th class="matrix-col-head" title="${esc(hw.title)}">
                                    <button type="button" class="matrix-head-btn" data-open-hw="${hw.id}">
                                        <span class="mh-date">${Utils.formatDate(hw.date)}</span>
                                        <span class="mh-sub">${esc(hw.title.slice(0, 4))}</span>
                                        <span class="mh-rate">${Utils.percent(c.done, students.length)}</span>
                                    </button>
                                </th>`;
                            }).join('')}
                            <th>未补</th>
                        </tr></thead>
                        <tbody>
                            ${students.map((stu) => {
                                let owe = 0;
                                const cells = hws.map((hw) => {
                                    const rec = HomeworkModel.getRecord(hw, stu.id);
                                    const st = HomeworkModel.STATUS_MAP[rec.status];
                                    if (HomeworkModel.isOutstanding(rec.status)) owe++;
                                    return `<td><button type="button" class="cell ${rec.comment ? 'has-comment' : ''}" style="background:${st.color}"
                                        data-hw="${hw.id}" data-sid="${stu.id}" title="${esc(hw.title)} · ${esc(st.label)}${rec.comment ? '：' + esc(rec.comment) : ''}"></button></td>`;
                                }).join('');
                                return `<tr>
                                    <th class="sticky-col"><span class="row-no">${esc(stu.studentNo)}</span>${UI.studentLink(stu)}</th>
                                    ${cells}
                                    <td class="owe ${owe ? 'owe-bad' : ''}">${owe || ''}</td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
                <div class="hint">点击色块修改状态；带角标的格子有 comment；点击列头进入该作业的登记页。</div>`;
        }

        view.innerHTML = `${toolbar()}<div class="card">${body}</div>`;
        bindToolbar(view, () => renderMatrix(view));

        view.querySelectorAll('.cell').forEach((cell) => {
            cell.addEventListener('click', () => HomeworkDialogs.openStatus(cell.dataset.hw, cell.dataset.sid));
        });
        view.querySelectorAll('[data-open-hw]').forEach((btn) => {
            btn.addEventListener('click', () => HomeworkPage.openTab('register', { homeworkId: btn.dataset.openHw }));
        });
    }

    // ---------- 欠交清单（按作业分组） ----------

    function renderPending(view) {
        const groups = HomeworkModel.outstanding();
        const total = groups.reduce((n, g) => n + g.items.length, 0);
        const people = new Set();
        groups.forEach((g) => g.items.forEach((x) => people.add(x.student.id)));

        view.innerHTML = `
            <div class="toolbar card">
                <span class="toolbar-info">共 <b>${total}</b> 人次未补上，涉及 <b>${groups.length}</b> 项作业、<b>${people.size}</b> 名学生</span>
            </div>
            ${groups.length ? `<div class="pending-grid">${groups.map(({ hw, items }) => `
                <div class="card pending-card">
                    <div class="pending-head">
                        <button type="button" class="pending-hw-link" data-open-hw="${hw.id}" title="打开该作业的登记页">
                            <span class="pending-hw-title">${esc(hw.title)}</span>
                            <span class="record-date">${Utils.formatDate(hw.date)}</span>
                        </button>
                        <span class="pending-count">${items.length} 人未补</span>
                    </div>
                    ${items.map(({ student, rec }) => {
                        const st = HomeworkModel.STATUS_MAP[rec.status];
                        return `<div class="pending-item">
                            <span class="status-pill" style="background:${st.color};color:${st.text}">${esc(st.short)}</span>
                            <div class="pending-item-main">
                                <div><span class="row-no">${esc(student.studentNo)}</span>${UI.studentLink(student)}</div>
                                ${rec.comment ? `<div class="pending-comment">💬 ${esc(rec.comment)}</div>` : ''}
                            </div>
                            <button type="button" class="btn-secondary btn-sm" data-fix-hw="${hw.id}" data-fix-sid="${student.id}">已补上</button>
                        </div>`;
                    }).join('')}
                </div>`).join('')}</div>`
                : '<div class="card empty-message">🎉 没有欠交的作业</div>'}
        `;

        view.querySelectorAll('[data-fix-hw]').forEach((btn) => {
            btn.addEventListener('click', () => HomeworkDialogs.markFixed(btn.dataset.fixHw, btn.dataset.fixSid, { confirm: true }));
        });
        view.querySelectorAll('[data-open-hw]').forEach((btn) => {
            btn.addEventListener('click', () => HomeworkPage.openTab('register', { homeworkId: btn.dataset.openHw }));
        });
    }

    window.HomeworkMatrix = { renderMatrix, renderPending };
})();
