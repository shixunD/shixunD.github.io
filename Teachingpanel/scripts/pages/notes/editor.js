// pages/notes/editor.js —— 笔记的富文本编辑器（原生 contenteditable + document.execCommand，不引入库）
// 全局命名空间：window.NoteEditor
//
//   NoteEditor.toolbarHtml()                 工具栏 HTML（放在 .ne-toolbar 里）
//   NoteEditor.mount(card, html, hooks)      绑定工具栏和 .note-editor；返回 { getHtml(), getPhotoIds(), focus() }
//       hooks.onChange()                     内容有改动（输入、格式、插图）
//       hooks.alive()                        编辑器是否还在页面上（用于放弃过期的插图）
//   NoteEditor.sanitize(html)                把任意 HTML 清洗成白名单内的受限 HTML（保存、粘贴、载入都过一遍）
//
// 存储的 HTML 只含：b/strong/i/em/u/s/strike/del/span(受限 style)/div/p/br/ul/ol/li/blockquote/hr/h1-h3/img[data-photo]。
// 图片只存 data-photo（照片 id），没有 src：src 是 object URL，由 photos.js 的 MutationObserver 按 id 补上。
// 待办清单 = <ul class="todo"> + <li data-todo="0|1">，勾选框是 CSS 画的，点 li 左侧切换。

(function () {
    'use strict';

    const KEEP_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'SPAN', 'DIV', 'P', 'BR', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'HR', 'H1', 'H2', 'H3', 'IMG']);
    const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'TITLE', 'HEAD', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT']);
    const STYLE_PROPS = new Set(['color', 'background-color', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'text-align']);
    const SAFE_VALUE = /^[#\w\s(),.%-]+$/;    // 颜色 / 关键字 / 数值；不允许 url()、引号、分号以外的符号

    const COLORS = ['#2b2420', '#d93025', '#e06a1f', '#b8860b', '#1e8e3e', '#1a4fa3', '#7b3fa0', '#7a6f68'];
    const BGS = ['#fff3a8', '#c8f0cf', '#cfe5ff', '#ffd6e0', '#ffe0c2', '#e6e0da'];
    const SIZES = [
        { v: 2, label: '小', css: 'small' },
        { v: 3, label: '正常', css: '' },
        { v: 5, label: '大', css: 'x-large' },
        { v: 6, label: '特大', css: 'xx-large' }
    ];

    // ---------- 清洗 ----------

    function cleanStyle(style) {
        return String(style || '').split(';').map((decl) => {
            const i = decl.indexOf(':');
            if (i < 0) return '';
            const prop = decl.slice(0, i).trim().toLowerCase();
            const val = decl.slice(i + 1).trim();
            if (!STYLE_PROPS.has(prop) || !val || !SAFE_VALUE.test(val)) return '';
            // 正文默认字号 / 黑色不用存；pt/px 的字号来自 Word / 网页，统一丢掉，只保留关键字字号
            if (prop === 'font-size' && !/^(x{0,2}-)?small$|^(x{1,2}-)?large$|^xxx-large$/.test(val)) return '';
            return `${prop}: ${val}`;
        }).filter(Boolean).join('; ');
    }

    function cleanNode(node, out) {
        node.childNodes.forEach((n) => {
            if (n.nodeType === 3) { out.appendChild(document.createTextNode(n.nodeValue)); return; }
            if (n.nodeType !== 1) return;
            const tag = n.tagName;
            if (DROP_TAGS.has(tag)) return;
            if (tag === 'IMG') {
                const id = n.getAttribute('data-photo');
                if (!id) return;                       // 外链 / base64 图片一律不要（粘贴图片文件走压缩流程）
                const img = document.createElement('img');
                img.setAttribute('data-photo', id);
                img.alt = '照片';
                out.appendChild(img);
                return;
            }
            if (!KEEP_TAGS.has(tag)) { cleanNode(n, out); return; }   // 不认识的标签：去掉标签留内容
            const el = document.createElement(tag.toLowerCase());
            const style = cleanStyle(n.getAttribute('style'));
            // styleWithCSS 下浏览器会把颜色 / 背景直接加在已有的 b / i / u 等标签上，所以除 br / hr 外都保留受限 style
            if (style && tag !== 'BR' && tag !== 'HR') el.setAttribute('style', style);
            if (tag === 'UL' && n.classList.contains('todo')) el.className = 'todo';
            if (tag === 'LI' && n.hasAttribute('data-todo')) el.setAttribute('data-todo', n.getAttribute('data-todo') === '1' ? '1' : '0');
            cleanNode(n, el);
            out.appendChild(el);
        });
    }

    function sanitize(html) {
        const doc = new DOMParser().parseFromString(`<body>${String(html || '')}</body>`, 'text/html');
        const box = document.createElement('div');
        cleanNode(doc.body, box);
        return box.innerHTML;
    }

    // ---------- 工具栏 ----------

    function btn(cmd, label, title, extra) {
        return `<button type="button" class="ne-btn" data-cmd="${cmd}" title="${title}"${extra || ''}>${label}</button>`;
    }

    function toolbarHtml() {
        const touch = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
        return `
            ${btn('undo', '↶', '撤销（Ctrl+Z）')}${btn('redo', '↷', '重做（Ctrl+Y）')}
            <span class="ne-sep"></span>
            ${btn('bold', '<b>B</b>', '加粗（Ctrl+B）')}${btn('italic', '<i>I</i>', '斜体（Ctrl+I）')}${btn('underline', '<u>U</u>', '下划线（Ctrl+U）')}${btn('strikeThrough', '<s>S</s>', '删除线')}
            <span class="ne-sep"></span>
            <button type="button" class="ne-btn ne-wide" data-pop="size" title="字号">字号 ▾</button>
            <button type="button" class="ne-btn" data-pop="color" title="文字颜色"><span class="ne-a">A</span><i class="ne-bar" data-color-bar style="background:#d93025"></i></button>
            <button type="button" class="ne-btn" data-pop="bg" title="背景高亮色"><span class="ne-a ne-a-bg">A</span><i class="ne-bar" data-bg-bar style="background:#fff3a8"></i></button>
            <span class="ne-sep"></span>
            ${btn('insertUnorderedList', '•&#8202;≡', '无序列表')}${btn('insertOrderedList', '1.≡', '有序列表')}${btn('todo', '☑', '待办清单（点方框勾选）')}
            <span class="ne-sep"></span>
            ${btn('justifyLeft', '⇤', '左对齐')}${btn('justifyCenter', '↔', '居中')}${btn('justifyRight', '⇥', '右对齐')}
            <span class="ne-sep"></span>
            ${btn('quote', '❝', '引用')}${btn('hr', '—', '分割线')}${btn('clear', 'Tx', '清除选中文字的格式')}${btn('date', '📅', '插入今天日期')}
            <span class="ne-sep"></span>
            <button type="button" class="ne-btn ne-wide" data-ins-upload title="插入图片（会先弹出压缩框，可裁剪 / 翻转）">🖼️ 图片</button>
            <button type="button" class="ne-btn" data-ins-camera title="拍照插入">📷</button>
            ${touch ? '' : '<button type="button" class="ne-btn" data-ins-phone title="用手机拍，照片传回电脑">📱</button>'}
            <input type="file" accept="image/*" multiple hidden data-ins-input>
            <input type="file" accept="image/*" capture="environment" hidden data-ins-input-cam>
            <div class="ne-pop" data-popbox hidden></div>`;
    }

    function swatches(kind, list) {
        return `<div class="ne-sw">${list.map((c) => `<button type="button" class="ne-swatch" data-${kind}="${c}" style="background:${c}" title="${c}"></button>`).join('')}
            ${kind === 'bgc' ? '<button type="button" class="ne-swatch ne-none" data-bgc="" title="去掉背景色">∅</button>' : ''}
            <label class="ne-swatch ne-custom" title="自定义颜色">+<input type="color" data-custom="${kind}"></label></div>`;
    }

    // ---------- 挂载 ----------

    function mount(card, html, hooks) {
        const body = card.querySelector('.note-editor');
        const bar = card.querySelector('.ne-toolbar');
        const popBox = bar.querySelector('[data-popbox]');
        let savedRange = null;

        body.innerHTML = sanitize(html);
        const onChange = () => { if (hooks.onChange) hooks.onChange(); };

        const inBody = (node) => node && body.contains(node);
        function remember() {
            const sel = window.getSelection();
            if (sel.rangeCount && inBody(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
        }
        function restore() {
            body.focus();
            const sel = window.getSelection();
            // 还没点过正文（没有记住的光标）就接在内容末尾
            let range = savedRange;
            if (!range || !inBody(range.startContainer)) {
                range = document.createRange();
                range.selectNodeContents(body);
                range.collapse(false);
            }
            sel.removeAllRanges();
            sel.addRange(range);
        }
        function exec(cmd, value) {
            body.focus();
            try { document.execCommand('styleWithCSS', false, true); } catch (e) { /* 忽略 */ }
            document.execCommand(cmd, false, value);
            remember();
            onChange();
            syncState();
        }

        // 当前选区所在的 li（待办用）
        function currentLi() {
            const sel = window.getSelection();
            let n = sel.anchorNode;
            while (n && n !== body) { if (n.nodeType === 1 && n.tagName === 'LI') return n; n = n.parentNode; }
            return null;
        }
        function toggleTodoList() {
            body.focus();
            let li = currentLi();
            let list = li && li.parentNode;
            if (list && list.tagName === 'UL' && list.classList.contains('todo')) {      // 已经是待办 -> 还原成普通段落
                document.execCommand('insertUnorderedList');
            } else {
                if (!list || list.tagName !== 'UL') document.execCommand('insertUnorderedList');
                li = currentLi();
                list = li && li.parentNode;
                if (list && list.tagName === 'UL') {
                    list.classList.add('todo');
                    list.querySelectorAll(':scope > li').forEach((x) => { if (!x.hasAttribute('data-todo')) x.setAttribute('data-todo', '0'); });
                }
            }
            remember(); onChange(); syncState();
        }
        function toggleQuote() {
            body.focus();
            const sel = window.getSelection();
            let n = sel.anchorNode, inQuote = false;
            while (n && n !== body) { if (n.nodeType === 1 && n.tagName === 'BLOCKQUOTE') { inQuote = true; break; } n = n.parentNode; }
            document.execCommand('formatBlock', false, inQuote ? 'div' : 'blockquote');
            remember(); onChange();
        }
        function clearFormat() {
            body.focus();
            document.execCommand('removeFormat');
            // removeFormat 不动背景色 / 字号的 span，再补一刀
            document.execCommand('hiliteColor', false, 'transparent');
            document.execCommand('foreColor', false, '#2b2420');
            remember(); onChange(); syncState();
        }
        function insertHtml(h) {
            body.focus();
            document.execCommand('insertHTML', false, h);
            remember(); onChange();
        }

        const actions = {
            todo: toggleTodoList,
            quote: toggleQuote,
            clear: clearFormat,
            hr: () => insertHtml('<hr><div><br></div>'),
            date: () => { body.focus(); document.execCommand('insertText', false, `${Utils.formatDate(Utils.today())} `); remember(); onChange(); }
        };

        // 工具栏按钮：mousedown 不抢焦点，选区才不会丢
        bar.addEventListener('mousedown', (e) => { if (!e.target.closest('input')) e.preventDefault(); });
        bar.addEventListener('click', (e) => {
            const cmdBtn = e.target.closest('[data-cmd]');
            if (cmdBtn) {
                closePop();
                const cmd = cmdBtn.dataset.cmd;
                if (actions[cmd]) actions[cmd](); else exec(cmd);
                return;
            }
            const pop = e.target.closest('[data-pop]');
            if (pop) { togglePop(pop); return; }
            const sz = e.target.closest('[data-size]');
            if (sz) { restore(); exec('fontSize', sz.dataset.size); closePop(); return; }
            const fc = e.target.closest('[data-fc]');
            if (fc) { applyColor('foreColor', fc.dataset.fc); return; }
            const bg = e.target.closest('[data-bgc]');
            if (bg) { applyColor('hiliteColor', bg.dataset.bgc); }
        });
        bar.addEventListener('change', (e) => {
            const input = e.target.closest('[data-custom]');
            if (!input) return;
            applyColor(input.dataset.custom === 'fc' ? 'foreColor' : 'hiliteColor', input.value);
        });

        function applyColor(cmd, value) {
            restore();
            if (cmd === 'hiliteColor' && !value) {
                exec('hiliteColor', 'transparent');
            } else {
                exec(cmd, value);
                const barEl = bar.querySelector(cmd === 'foreColor' ? '[data-color-bar]' : '[data-bg-bar]');
                if (barEl && value) barEl.style.background = value;
            }
            closePop();
        }

        function closePop() { popBox.hidden = true; popBox.dataset.kind = ''; }
        function togglePop(trigger) {
            const kind = trigger.dataset.pop;
            if (!popBox.hidden && popBox.dataset.kind === kind) { closePop(); return; }
            remember();
            popBox.innerHTML = kind === 'size'
                ? SIZES.map((s) => `<button type="button" class="ne-size" data-size="${s.v}" style="${s.css ? `font-size:${s.css}` : ''}">${s.label}</button>`).join('')
                : swatches(kind === 'color' ? 'fc' : 'bgc', kind === 'color' ? COLORS : BGS);
            popBox.dataset.kind = kind;
            popBox.hidden = false;
            // 浮层贴在触发按钮下面（相对工具栏定位）
            const br = trigger.getBoundingClientRect(), pr = bar.getBoundingClientRect();
            popBox.style.left = `${Math.max(0, Math.min(br.left - pr.left, pr.width - popBox.offsetWidth - 4))}px`;
            popBox.style.top = `${br.bottom - pr.top + 4}px`;
        }
        const onDocDown = (e) => {
            if (!document.body.contains(card)) { document.removeEventListener('mousedown', onDocDown); document.removeEventListener('selectionchange', syncState); return; }
            if (!e.target.closest('.ne-pop') && !e.target.closest('[data-pop]')) closePop();
        };
        document.addEventListener('mousedown', onDocDown);

        // 工具栏按钮的「已启用」状态（加粗 / 斜体 / 列表 / 对齐跟着光标变）
        function syncState() {
            if (!document.body.contains(card)) return;
            const sel = window.getSelection();
            if (!sel.rangeCount || !inBody(sel.anchorNode)) return;
            remember();
            bar.querySelectorAll('[data-cmd]').forEach((b) => {
                const c = b.dataset.cmd;
                if (actions[c] || c === 'undo' || c === 'redo') return;
                let on = false;
                try { on = document.queryCommandState(c); } catch (e) { /* 忽略 */ }
                b.classList.toggle('on', on);
            });
            const li = currentLi();
            bar.querySelector('[data-cmd="todo"]').classList.toggle('on', !!(li && li.parentNode.classList && li.parentNode.classList.contains('todo')));
        }
        document.addEventListener('selectionchange', syncState);

        // ---------- 正文事件 ----------

        body.addEventListener('input', (e) => {
            // 清空后浏览器会留一个 <br>，占位提示靠 :empty，所以清掉
            if (!body.querySelector('img') && !body.textContent && body.innerHTML.length < 20 && !/<(ul|ol|hr|blockquote)/.test(body.innerHTML)) body.innerHTML = '';
            // 勾选的待办回车新建的下一项不应该继承「已完成」
            if (e.inputType === 'insertParagraph') {
                const li = currentLi();
                if (li && li.getAttribute('data-todo') === '1' && !li.textContent.trim()) li.setAttribute('data-todo', '0');
            }
            onChange();
        });
        body.addEventListener('keyup', remember);
        body.addEventListener('mouseup', remember);

        // 点待办的方框（li 左侧）切换勾选
        body.addEventListener('click', (e) => {
            const li = e.target.closest && e.target.closest('li[data-todo]');
            if (!li || !body.contains(li) || !li.parentNode.classList.contains('todo')) return;
            if (e.clientX - li.getBoundingClientRect().left > 26) return;
            e.preventDefault();
            li.setAttribute('data-todo', li.getAttribute('data-todo') === '1' ? '0' : '1');
            onChange();
        });
        // 点图片：选中它（之后按 Delete / Backspace 即可删除）；放大由 photos.js 的全局点击处理
        body.addEventListener('mousedown', (e) => {
            if (e.target.tagName !== 'IMG') return;
            const r = document.createRange();
            r.selectNode(e.target);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(r);
        });

        // 图片：选择 / 拍照 / 手机拍 / 粘贴 / 拖入 都走照片压缩预览框
        const inserter = Photos.bindInserter(card, {
            alive: () => document.body.contains(card) && (hooks.alive ? hooks.alive() : true),
            onPhoto: (id) => { restore(); insertHtml(`<div><img data-photo="${Utils.escapeHtml(id)}" alt="照片"></div><div><br></div>`); }
        });
        const imageFiles = (list) => Array.from(list || []).filter((f) => f.type && f.type.startsWith('image/'));

        body.addEventListener('paste', (e) => {
            const cd = e.clipboardData;
            if (!cd) return;
            e.preventDefault();
            const files = imageFiles(cd.files);
            if (files.length) { remember(); inserter.addFiles(files); return; }
            const h = cd.getData('text/html');
            if (h) insertHtml(sanitize(h));
            else document.execCommand('insertText', false, cd.getData('text/plain'));
            onChange();
        });
        body.addEventListener('dragover', (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault(); });
        body.addEventListener('drop', (e) => {
            const files = imageFiles(e.dataTransfer && e.dataTransfer.files);
            if (!files.length) return;
            e.preventDefault();
            inserter.addFiles(files);
        });

        syncState();
        return {
            getHtml() { return sanitize(body.innerHTML); },
            getPhotoIds() { return Array.from(new Set(Array.from(body.querySelectorAll('img[data-photo]')).map((im) => im.getAttribute('data-photo')))); },
            focus() { body.focus(); }
        };
    }

    window.NoteEditor = { toolbarHtml, mount, sanitize };
})();
