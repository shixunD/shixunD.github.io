// models/sideGroups.js —— 作业 / 背诵侧栏的「分组夹」与手动排序（两页共用）
// 全局命名空间：window.SideGroups
//
// 数据：state.sideGroups[] { id, classId, kind: 'hw'|'rec', title, collapsed, order?, createdAt }
//   作业 / 背诵轮次上可选字段：groupId（所在分组夹，没有 = 在最外层）、order（手动排序后才有）
// 排序规则：
//   - 最外层 = 没进分组的条目 + 分组夹，共用一套 order；分组夹内部的条目有自己的一套 order
//   - 没手动排过（无 order）的排在最前，条目之间按各页自己的默认顺序（cmpItem），条目和分组夹之间按创建时间新→旧；
//     手动排过的按 order 升序跟在后面
//   - 任何一次拖动都会把整个布局重新编号（order 连续），所以不会出现顺序漂移
// groupId 指向不存在 / 别的班级的分组夹时，条目当作在最外层。分组夹只有一层，不能嵌套。

(function () {
    'use strict';

    function state() { return AppState.getState(); }

    function groups(kind) {
        const classId = AppState.getActiveClassId();
        return state().sideGroups.filter((g) => g.classId === classId && g.kind === kind);
    }

    function getGroup(id) { return state().sideGroups.find((g) => g.id === id) || null; }

    function byOrder(cmpFallback) {
        return (a, b) => {
            const ha = a.obj.order != null, hb = b.obj.order != null;
            if (ha && hb) return a.obj.order - b.obj.order;
            if (ha !== hb) return ha ? 1 : -1;
            return cmpFallback(a, b);
        };
    }

    // 布局：[{ type:'item', obj } | { type:'group', obj, children:[{ type:'item', obj }] }]
    function layout(kind, items, cmpItem) {
        const gmap = new Map(groups(kind).map((g) => [g.id, { type: 'group', obj: g, children: [] }]));
        const top = [];
        items.forEach((it) => {
            const g = it.groupId && gmap.get(it.groupId);
            const entry = { type: 'item', obj: it };
            if (g) g.children.push(entry); else top.push(entry);
        });
        const cmpChild = byOrder((a, b) => cmpItem(a.obj, b.obj));
        gmap.forEach((g) => { g.children.sort(cmpChild); top.push(g); });
        top.sort(byOrder((a, b) => (a.type === 'item' && b.type === 'item')
            ? cmpItem(a.obj, b.obj)
            : (b.obj.createdAt || 0) - (a.obj.createdAt || 0)));
        return top;
    }

    // 按显示顺序拍平成条目数组（分组夹里的条目紧跟在分组夹的位置上）
    function flatten(top) {
        const out = [];
        top.forEach((e) => { if (e.type === 'item') out.push(e.obj); else e.children.forEach((c) => out.push(c.obj)); });
        return out;
    }

    function renumber(top) {
        top.forEach((e, i) => {
            e.obj.order = i;
            if (e.type === 'item') { delete e.obj.groupId; return; }
            e.children.forEach((c, j) => { c.obj.order = j; c.obj.groupId = e.obj.id; });
        });
    }

    function find(top, type, id) {
        for (const e of top) {
            if (e.type === type && e.obj.id === id) return { entry: e, list: top, group: null };
            if (e.type === 'group' && type === 'item') {
                const c = e.children.find((x) => x.obj.id === id);
                if (c) return { entry: c, list: e.children, group: e };
            }
        }
        return null;
    }

    // 拖动落点：drag = { type:'item'|'group', id }；
    //   drop = { type:'item'|'group', id, after?, into?:'start'|'end' } 或 { type:'end' }（最外层最后）
    // 条目可以落到：某条目前后（进入 / 留在它所在的分组夹）、分组夹标题上（into = 进入该分组夹）、最外层末尾（脱离分组夹）；
    // 分组夹只能在最外层移动：落到别的分组夹里面的条目上，等于落到那个分组夹的前后
    function move(kind, items, cmpItem, drag, drop) {
        const top = layout(kind, items, cmpItem);
        const src = find(top, drag.type, drag.id);
        if (!src) return Promise.resolve();
        if (drop.type === drag.type && drop.id === drag.id) return Promise.resolve();
        const dst = drop.type === 'end' ? null : find(top, drop.type, drop.id);
        if (drop.type !== 'end' && !dst) return Promise.resolve();
        if (drag.type === 'group' && dst && dst.group && dst.group.obj.id === drag.id) return Promise.resolve();

        src.list.splice(src.list.indexOf(src.entry), 1);
        let list, idx;
        if (!dst) { list = top; idx = top.length; }
        else if (drop.into && drag.type === 'item') {
            list = dst.entry.children; idx = drop.into === 'start' ? 0 : list.length;
        } else if (drag.type === 'group' && dst.group) {
            list = top; idx = top.indexOf(dst.group) + (drop.after ? 1 : 0);
        } else {
            list = dst.list; idx = list.indexOf(dst.entry) + (drop.after ? 1 : 0);
        }
        list.splice(idx, 0, src.entry);
        return AppState._commit(() => renumber(top));
    }

    function createGroup(kind, title) {
        return AppState._commit((s) => {
            const g = { id: Utils.uid('grp'), classId: AppState.getActiveClassId(), kind, title: title || '分组', collapsed: false, createdAt: Date.now() };
            s.sideGroups.push(g);
            return g;
        });
    }

    function updateGroup(id, patch) {
        return AppState._commit(() => {
            const g = getGroup(id);
            if (g) Object.assign(g, patch);
        });
    }

    // 删除分组夹：里面的条目留在原位置（最外层），不删除
    function removeGroup(kind, items, cmpItem, id) {
        const top = layout(kind, items, cmpItem);
        const at = top.findIndex((e) => e.type === 'group' && e.obj.id === id);
        if (at >= 0) top.splice(at, 1, ...top[at].children);
        return AppState._commit((s) => {
            s.sideGroups = s.sideGroups.filter((g) => g.id !== id);
            renumber(top);
        });
    }

    window.SideGroups = { layout, flatten, move, createGroup, updateGroup, removeGroup, getGroup };
})();
