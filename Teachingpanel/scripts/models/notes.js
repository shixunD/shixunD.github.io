// models/notes.js —— 笔记（全班级共用，不带 classId）
// 全局命名空间：window.NoteModel
//
// 数据：state.notes[] { id, title, html, photoIds, createdAt, updatedAt, groupId?, order? }
//   html：编辑器产出的受限 HTML（白名单标签，见 pages/notes/editor.js 的 sanitize）；图片是 <img data-photo="照片id">
//   photoIds：html 里引用的照片 id（保存时由编辑器从 DOM 收集），AppState.gcPhotos 靠它判断照片是否还被引用
// 文件夹复用 SideGroups（kind 'note'），布局规则同作业 / 背诵侧栏。

(function () {
    'use strict';

    function state() { return AppState.getState(); }

    // 默认顺序：最近修改的在前（手动拖动排过的按 order，见 SideGroups.layout）
    function cmpNote(a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); }

    function list() { return state().notes; }
    function get(id) { return state().notes.find((n) => n.id === id) || null; }
    function layout() { return SideGroups.layout('note', list(), cmpNote); }

    function create() {
        return AppState._commit((s) => {
            const now = Date.now();
            const note = { id: Utils.uid('note'), title: '', html: '', photoIds: [], createdAt: now, updatedAt: now };
            s.notes.push(note);
            return note;
        });
    }

    // patch：{ title?, html?, photoIds? }；内容真的变了才刷新 updatedAt
    function update(id, patch) {
        return AppState._commit(() => {
            const n = get(id);
            if (!n) return;
            let changed = false;
            ['title', 'html'].forEach((k) => { if (patch[k] != null && patch[k] !== n[k]) { n[k] = patch[k]; changed = true; } });
            if (Array.isArray(patch.photoIds)) n.photoIds = patch.photoIds.slice();
            if (changed) n.updatedAt = Date.now();
        });
    }

    function remove(id) {
        return AppState._commit((s) => { s.notes = s.notes.filter((n) => n.id !== id); });
    }

    function move(drag, drop) { return SideGroups.move('note', list(), cmpNote, drag, drop); }
    function removeGroup(id) { return SideGroups.removeGroup('note', list(), cmpNote, id); }

    // 笔记的纯文本（搜索、列表摘要用）
    function plainText(n) {
        const div = document.createElement('div');
        div.innerHTML = n.html || '';
        return (div.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function matches(n, q) {
        const k = String(q || '').trim().toLowerCase();
        if (!k) return true;
        return (n.title || '').toLowerCase().includes(k) || plainText(n).toLowerCase().includes(k);
    }

    window.NoteModel = { list, get, layout, create, update, remove, move, removeGroup, plainText, matches };
})();
