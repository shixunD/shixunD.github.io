// notesPage.js —— 笔记页：左边目录（可建文件夹、拖动归类、搜索），右边富文本编辑器（自动保存）
// 全局命名空间：window.NotesPage
//
// 自动保存与整页重绘的关系：AppState 每次提交都会让 app.js 重绘当前页，会毁掉正在编辑的编辑器（光标、选区、输入法）。
// 所以保存期间（ui.saving）以及有未保存改动时（dirty）收到的重绘只刷新左侧目录，编辑器原地不动；
// 只有「没有未保存改动」的外部变化（导入、云端恢复等）才整页重绘。切换笔记 / 离开本页 / 关闭页面前都会先把改动存掉。

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);
    const LS_SEL = 'teachingPanel.ui.noteId';
    const SAVE_DELAY = 800;

    const ui = { selectedId: Utils.lsGet(LS_SEL, '') || null, query: '' };
    let editor = null;          // NoteEditor.mount 的返回值（当前笔记）
    let editingId = null;       // 编辑器里当前是哪篇笔记
    let dirty = false;
    let saving = false;
    let timer = null;

    function container() { return document.getElementById('notes-page-body'); }

    // ---------- 保存 ----------

    function setStatus(text) {
        const el = document.querySelector('#notes-page-body [data-status]');
        if (el) el.textContent = text;
    }

    async function saveNow() {
        clearTimeout(timer);
        timer = null;
        if (!dirty || !editor || !editingId) return;
        const id = editingId;
        const titleEl = document.querySelector('#notes-page-body .note-title');
        const patch = { html: editor.getHtml(), photoIds: editor.getPhotoIds() };
        if (titleEl) patch.title = titleEl.value.trim();
        dirty = false;
        saving = true;
        setStatus('保存中…');
        try {
            await NoteModel.update(id, patch);
            setStatus(dirty ? '' : '已保存');
        } catch (err) {
            dirty = true;
            setStatus('保存失败');
            Toast.error('笔记保存失败：' + err.message);
        } finally {
            saving = false;
        }
    }

    function markDirty() {
        dirty = true;
        setStatus('编辑中…');
        clearTimeout(timer);
        timer = setTimeout(saveNow, SAVE_DELAY);
    }

    // 离开本页 / 关闭页面前把改动存掉
    Navigation.onPageChange((page) => { if (page !== 'notes') saveNow(); });
    window.addEventListener('pagehide', saveNow);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });

    // ---------- 目录 ----------

    function noteTitle(n) {
        if (n.title) return n.title;
        const t = NoteModel.plainText(n);
        return t ? t.slice(0, 24) : '无标题笔记';
    }

    function itemHtml(n) {
        const date = Utils.formatDate(Utils.toDateStr(new Date(n.updatedAt || n.createdAt || Date.now())));
        return `
            <button type="button" class="side-item ${n.id === ui.selectedId ? 'active' : ''}" data-select="${n.id}" draggable="true" title="按住拖动可调整顺序，也可拖进文件夹">
                <div class="side-item-title">${esc(noteTitle(n))}</div>
                <div class="side-item-sub">${esc(date)}</div>
            </button>`;
    }

    function listHtml() {
        const q = ui.query.trim();
        if (q) {
            const hits = NoteModel.list().filter((n) => NoteModel.matches(n, q)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
            return hits.length ? `<div class="side-list">${hits.map(itemHtml).join('')}</div>` : '<div class="side-list"><div class="empty-message">没有找到相关笔记</div></div>';
        }
        return `<div class="side-list">${UI.sideTreeHtml(NoteModel.layout(), itemHtml, '<div class="empty-message">还没有笔记，点击「新建笔记」开始</div>')}</div>`;
    }

    // 只重绘目录（编辑器不动）。目录整块替换，旧元素连同监听器一起丢弃，所以可以放心重新绑定
    function renderList() {
        const slot = document.querySelector('#notes-page-body .note-side-slot');
        if (!slot) return;
        slot.innerHTML = listHtml();
        slot.querySelectorAll('[data-select]').forEach((b) => {
            b.addEventListener('click', () => selectNote(b.dataset.select));
        });
        UI.bindSideTree(slot, {
            move: (drag, drop) => NoteModel.move(drag, drop),
            toggle: (id) => SideGroups.updateGroup(id, { collapsed: !SideGroups.getGroup(id).collapsed }),
            rename: async (id) => {
                const g = SideGroups.getGroup(id);
                const name = await Modal.prompt({ title: '重命名文件夹', value: g.title });
                if (name && name.trim()) await SideGroups.updateGroup(id, { title: name.trim() });
            },
            remove: async (id) => {
                const g = SideGroups.getGroup(id);
                const ok = await Modal.confirm({ title: '删除文件夹', text: `确定删除文件夹「${g.title}」吗？里面的笔记不会被删除，会回到列表中。`, confirmText: '删除', danger: true });
                if (ok) await NoteModel.removeGroup(id);
            }
        });
    }

    async function selectNote(id) {
        if (id === ui.selectedId && editor) return;
        await saveNow();
        ui.selectedId = id;
        Utils.lsSet(LS_SEL, id || '');
        render(true);
    }

    // ---------- 渲染 ----------

    function editorCardHtml(n) {
        return `
            <div class="card note-card" data-note="${n.id}">
                <div class="note-head">
                    <input type="text" class="note-title" maxlength="80" placeholder="标题（可不填）" value="${esc(n.title)}">
                    <span class="note-status" data-status></span>
                    <button type="button" class="btn-secondary btn-sm btn-danger-text" data-delete>删除</button>
                </div>
                <div class="ne-toolbar">${NoteEditor.toolbarHtml()}</div>
                <div class="note-editor ne-body" contenteditable="true" spellcheck="false" data-placeholder="在这里记录想法、谈话要点……可以直接粘贴 / 拖入图片"></div>
            </div>`;
    }

    // force：用户主动切换笔记 / 新建 / 删除时整页重建；否则（数据变化触发的重绘）有未保存改动或正在保存就只刷新目录
    function render(force) {
        const el = container();
        if (!el) return;
        const note = ui.selectedId ? NoteModel.get(ui.selectedId) : null;
        if (!force && editor && editingId && (saving || dirty) && NoteModel.get(editingId)) {
            renderList();
            return;
        }
        if (!note) ui.selectedId = null;   // 没选（或选的已被删 / 导入后不存在）就显示空状态，不自动选中，避免一进页面编辑器抢焦点

        el.innerHTML = `
            <div class="page-head"><h1>笔记</h1></div>
            <div class="split-layout note-layout">
                <aside class="card side-panel note-side">
                    <div class="side-panel-head">
                        <button type="button" class="btn-primary btn-sm" data-new>＋ 新建笔记</button>
                        <button type="button" class="btn-secondary btn-sm" data-new-group title="新建文件夹，可把笔记拖进去，点击可折叠">＋ 文件夹</button>
                    </div>
                    <input type="search" class="note-search" placeholder="搜索标题和内容" value="${esc(ui.query)}">
                    <div class="note-side-slot"></div>
                </aside>
                <section class="main-panel">
                    ${note ? editorCardHtml(note) : '<div class="card empty-message">选择或新建一篇笔记</div>'}
                </section>
            </div>`;

        renderList();
        el.querySelector('[data-new]').addEventListener('click', async () => {
            await saveNow();
            const n = await NoteModel.create();
            ui.query = '';
            ui.selectedId = n.id;
            Utils.lsSet(LS_SEL, n.id);
            render(true);
            const t = container().querySelector('.note-title');
            if (t) t.focus();
        });
        el.querySelector('[data-new-group]').addEventListener('click', async () => {
            const name = await Modal.prompt({ title: '新建文件夹', placeholder: '如：谈话记录' });
            if (name && name.trim()) await SideGroups.createGroup('note', name.trim());
        });
        const search = el.querySelector('.note-search');
        search.addEventListener('input', () => { ui.query = search.value; renderList(); });

        editor = null;
        editingId = null;
        dirty = false;
        if (!note) return;

        const card = el.querySelector('.note-card');
        editingId = note.id;
        editor = NoteEditor.mount(card, note.html, {
            onChange: markDirty,
            alive: () => editingId === note.id && document.body.contains(card)
        });
        card.querySelector('.note-title').addEventListener('input', markDirty);
        card.querySelector('[data-delete]').addEventListener('click', async () => {
            const ok = await Modal.confirm({ title: '删除笔记', text: `确定删除「${noteTitle(note)}」吗？笔记里的图片也会一并删除，无法恢复。`, confirmText: '删除', danger: true });
            if (!ok) return;
            clearTimeout(timer);
            dirty = false;
            ui.selectedId = null;
            Utils.lsSet(LS_SEL, '');
            await NoteModel.remove(note.id);
            render(true);
        });
    }

    window.NotesPage = { render: () => render(false) };
})();
