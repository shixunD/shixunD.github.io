// ui.js —— 各页面共用的小片段：页内二级标签栏、学生姓名链接、色块图例、统计块
// 全局命名空间：window.UI

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);

    // 页内二级标签栏：tabs = [{key, label}]，用 data-subtab 区分，由页面自行绑定点击
    function subTabs(tabs, activeKey) {
        return `<div class="sub-tabs">${tabs.map((t) => `
            <button type="button" class="sub-tab ${t.key === activeKey ? 'active' : ''}" data-subtab="${t.key}">${esc(t.label)}</button>
        `).join('')}</div>`;
    }

    // 学生姓名：点击跳到该生的学生趋势（全局委托监听在 studentTrend.js 顶层注册一次）
    function studentLink(stu) {
        return `<button type="button" class="student-link" data-profile-id="${stu.id}">${esc(stu.name)}</button>`;
    }

    function legend(items) {
        return `<div class="legend">${items.map((it) => `
            <span class="legend-item"><i style="background:${it.color}"></i>${esc(it.label)}</span>
        `).join('')}</div>`;
    }

    function emptyStudentsHint() {
        return `<div class="empty-message">当前班级还没有学生，请先到「主页」添加学生。</div>`;
    }

    function statTile(label, value, sub, color) {
        return `<div class="stat-tile"${color ? ` style="--tile-color:${color}"` : ''}>
            <div class="stat-value">${esc(value)}</div>
            <div class="stat-label">${esc(label)}</div>
            ${sub ? `<div class="stat-sub">${esc(sub)}</div>` : ''}
        </div>`;
    }

    // 侧栏列表（作业、背诵轮次共用）：最外层的条目 + 可折叠的分组夹。layout 来自 SideGroups.layout()，
    // renderItem(obj) 返回条目按钮的 HTML（需带 class="side-item" data-select draggable="true"）
    function sideTreeHtml(layout, renderItem, emptyHtml) {
        if (!layout.length) return emptyHtml;
        const body = layout.map((e) => {
            if (e.type === 'item') return renderItem(e.obj);
            const g = e.obj;
            return `<div class="side-group ${g.collapsed ? 'collapsed' : ''}" data-gid="${g.id}">
                <div class="side-group-head" draggable="true" data-group="${g.id}" title="点击折叠 / 展开；按住拖动可调整位置">
                    <svg class="side-group-arrow" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M5.5 3.5 10 8l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    <svg class="side-group-icon" viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" fill="currentColor" fill-opacity=".16" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
                    <span class="side-group-title">${esc(g.title)}</span>
                    <button type="button" class="side-group-btn" data-group-rename="${g.id}" title="重命名分组"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2.5 13.5 3 10l7.6-7.6a1.4 1.4 0 0 1 2 0l1 1a1.4 1.4 0 0 1 0 2L6 13zM9.5 3.5l3 3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/></svg></button>
                    <button type="button" class="side-group-btn" data-group-del="${g.id}" title="删除分组（里面的内容保留）"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
                    <span class="side-group-count">${e.children.length}</span>
                </div>
                ${g.collapsed ? '' : `<div class="side-group-body">${e.children.map((c) => renderItem(c.obj)).join('')}</div>`}
            </div>`;
        }).join('');
        return body + '<div class="side-end" title="拖到这里：移到最后 / 移出分组"></div>';
    }

    // 侧栏拖动排序 + 分组夹交互。h = { move(drag, drop), toggle(id), rename(id), remove(id) }
    //   条目可以落到：某条目的上半 / 下半（插到它前 / 后，并进入或留在它所在的分组夹）、分组夹标题（上 30% = 插到分组夹前面，
    //   其余 = 放进分组夹）、列表底部空白（移到最外层最后，即脱离分组夹）；分组夹只能在最外层移动
    function bindSideTree(root, h) {
        const all = () => root.querySelectorAll('.side-item, .side-group, .side-group-head, .side-end');
        const clear = () => {
            all().forEach((el) => el.classList.remove('drag-before', 'drag-after', 'drag-into', 'dragging'));
        };
        let drag = null;
        const half = (e, el) => e.clientY > el.getBoundingClientRect().top + el.offsetHeight / 2;
        const same = (t, id) => drag && drag.type === t && drag.id === id;

        root.querySelectorAll('.side-item[data-select]').forEach((el) => {
            const id = el.dataset.select;
            const wrap = el.closest('.side-group');
            el.addEventListener('dragstart', (e) => { e.stopPropagation(); drag = { type: 'item', id }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); el.classList.add('dragging'); });
            el.addEventListener('dragend', () => { drag = null; clear(); });
            el.addEventListener('dragover', (e) => {
                if (!drag || same('item', id)) return;
                if (drag.type === 'group' && wrap && wrap.dataset.gid === drag.id) return;
                e.preventDefault(); e.stopPropagation();
                clear();
                const target = drag.type === 'group' && wrap ? wrap : el;
                target.classList.add(half(e, target) ? 'drag-after' : 'drag-before');
            });
            el.addEventListener('drop', async (e) => {
                if (!drag || same('item', id)) return;
                e.preventDefault(); e.stopPropagation();
                const d = drag, after = half(e, drag.type === 'group' && wrap ? wrap : el);
                drag = null; clear();
                await h.move(d, d.type === 'group' && wrap ? { type: 'group', id: wrap.dataset.gid, after } : { type: 'item', id, after });
            });
        });

        root.querySelectorAll('.side-group-head[data-group]').forEach((head) => {
            const gid = head.dataset.group;
            const wrap = head.closest('.side-group');
            const collapsed = wrap.classList.contains('collapsed');
            head.addEventListener('dragstart', (e) => { e.stopPropagation(); drag = { type: 'group', id: gid }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', gid); wrap.classList.add('dragging'); });
            head.addEventListener('dragend', () => { drag = null; clear(); });
            const dropFor = (e) => {
                if (drag.type === 'group') return { type: 'group', id: gid, after: half(e, head) };
                const rect = head.getBoundingClientRect();
                if (e.clientY < rect.top + rect.height * 0.3) return { type: 'group', id: gid, after: false };
                return { type: 'group', id: gid, into: collapsed ? 'end' : 'start' };
            };
            head.addEventListener('dragover', (e) => {
                if (!drag || same('group', gid)) return;
                e.preventDefault(); e.stopPropagation();
                clear();
                const d = dropFor(e);
                if (d.into) head.classList.add('drag-into');
                else wrap.classList.add(d.after ? 'drag-after' : 'drag-before');
            });
            head.addEventListener('drop', async (e) => {
                if (!drag || same('group', gid)) return;
                e.preventDefault(); e.stopPropagation();
                const d = drag, to = dropFor(e);
                drag = null; clear();
                await h.move(d, to);
            });
            head.addEventListener('click', (e) => {
                if (e.target.closest('[data-group-rename], [data-group-del]')) return;
                h.toggle(gid);
            });
        });
        root.querySelectorAll('[data-group-rename]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); h.rename(b.dataset.groupRename); }));
        root.querySelectorAll('[data-group-del]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); h.remove(b.dataset.groupDel); }));

        const list = root.querySelector('.side-list');
        const end = root.querySelector('.side-end');
        [end, list].forEach((el) => {
            if (!el) return;
            el.addEventListener('dragover', (e) => {
                if (!drag) return;
                e.preventDefault();
                clear();
                if (end) end.classList.add('drag-into');
            });
            el.addEventListener('drop', async (e) => {
                if (!drag) return;
                e.preventDefault(); e.stopPropagation();
                const d = drag;
                drag = null; clear();
                await h.move(d, { type: 'end' });
            });
        });
    }

    // 所有日期输入框：点输入框任意位置（不只是右边的日历图标）都弹出日历。
    // showPicker() 需要用户手势，不支持或被拒绝时静默忽略（仍可点图标 / 键盘输入）；全局委托只注册一次
    document.addEventListener('click', (e) => {
        const input = e.target;
        if (!(input instanceof HTMLInputElement) || input.type !== 'date' || input.disabled || input.readOnly) return;
        try { input.showPicker(); } catch (err) { /* 不支持 showPicker 或已打开：忽略 */ }
    });

    window.UI = { sideTreeHtml, bindSideTree, subTabs, studentLink, legend, emptyStudentsHint, statTile };
})();
