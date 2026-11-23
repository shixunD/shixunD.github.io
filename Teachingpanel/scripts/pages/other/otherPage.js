// otherPage.js —— 导航页「🗂️ 其他」：当前班级所有学生的「其他情况」记录并排显示，方便横向比较
// 全局命名空间：window.OtherPage
// 数据来自 RemarkModel（和学生趋势里的「其他情况」是同一份）；新增记录仍在学生趋势里做，这里只看 / 改 / 删。
// 每个学生一张卡片（学号序），卡片自动横向排列；顶部可筛「只看有记录的」和关键词（关键词筛选只隐藏 DOM，不重绘，输入不丢焦点）

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);
    const ui = { onlyWith: true, q: '' };

    function container() { return document.getElementById('other-page-body'); }

    function recordHtml(r) {
        return `
            <div class="remark-item" data-remark-text="${esc(r.text || '')}">
                <div class="remark-head">
                    <span class="remark-date">${Utils.formatDate(r.date)}</span>
                    <span class="remark-actions">
                        <button type="button" class="remark-btn" data-edit="${r.id}">编辑</button>
                        <button type="button" class="remark-btn remark-btn-danger" data-delete="${r.id}">删除</button>
                    </span>
                </div>
                ${r.text ? `<div class="remark-text">${esc(r.text)}</div>` : ''}
                ${Photos.viewHtml(r.photoIds)}${AudioRec.viewHtml(r.audioIds)}
            </div>`;
    }

    function render() {
        const view = container();
        if (!view) return;
        const students = AppState.getStudents().slice().sort(Utils.compareStudentNo);
        if (!students.length) { view.innerHTML = `<div class="card">${UI.emptyStudentsHint()}</div>`; return; }

        const rows = students.map((s) => ({ s, list: RemarkModel.listFor(s.id) }));
        const total = rows.reduce((n, x) => n + x.list.length, 0);
        const shown = ui.onlyWith ? rows.filter((x) => x.list.length) : rows;

        view.innerHTML = `
            <div class="card other-all-head">
                <div class="detail-title">🗂️ 其他 <span class="detail-meta">全班共 ${total} 条记录；要新增记录，到「📈 学生趋势 → 其他情况」</span></div>
                <div class="other-all-tools">
                    <label class="other-all-check"><input type="checkbox" data-only-with ${ui.onlyWith ? 'checked' : ''}> 只看有记录的学生</label>
                    <input type="search" class="other-all-q" data-q placeholder="按内容筛选…" value="${esc(ui.q)}">
                    <span class="detail-meta" data-q-count></span>
                </div>
            </div>
            <div class="other-all-grid">
                ${shown.length ? shown.map(({ s, list }) => `
                    <section class="card other-all-card" data-stu="${s.id}">
                        <div class="other-all-name"><span class="row-no">${esc(s.studentNo)}</span>${UI.studentLink(s)}
                            <span class="detail-meta">${list.length} 条</span></div>
                        <div class="remark-list">
                            ${list.length ? list.map(recordHtml).join('') : '<div class="empty-message">还没有记录</div>'}
                        </div>
                    </section>`).join('') : '<div class="card"><div class="empty-message">全班还没有任何记录</div></div>'}
            </div>`;

        view.querySelector('[data-only-with]').addEventListener('change', (e) => { ui.onlyWith = e.target.checked; render(); });
        const q = view.querySelector('[data-q]');
        q.addEventListener('input', () => { ui.q = q.value; applyFilter(view); });
        view.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => OtherRecords.openEdit(btn.dataset.edit)));
        view.querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', () => OtherRecords.confirmRemove(btn.dataset.delete)));
        applyFilter(view);
    }

    // 关键词：记录文字里含就留下；整张卡片没有匹配的记录就隐藏
    function applyFilter(view) {
        const kw = ui.q.trim().toLowerCase();
        let n = 0;
        view.querySelectorAll('.other-all-card').forEach((card) => {
            let any = false;
            card.querySelectorAll('.remark-item').forEach((it) => {
                const hit = !kw || (it.dataset.remarkText || '').toLowerCase().includes(kw);
                it.hidden = !hit;
                if (hit) { any = true; n += 1; }
            });
            card.hidden = !!kw && !any;
        });
        const c = view.querySelector('[data-q-count]');
        if (c) c.textContent = kw ? `匹配 ${n} 条` : '';
    }

    window.OtherPage = { render };
})();
