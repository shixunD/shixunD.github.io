// modal.js —— 通用确认弹窗 + 通用表单弹窗
// 全局命名空间：window.Modal
//
// Modal.confirm(...)  二次确认，z-index 9000（.modal-overlay），必须高于所有可能从中触发它的弹窗
// Modal.open(...)     业务表单弹窗（状态选择、背诵检查、成绩录入等），z-index 6000（.dialog-overlay）

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);

    // confirm({title, text, confirmText, cancelText, danger}) -> Promise<boolean>
    function confirmDialog(opts) {
        const {
            title = '确认操作',
            text = '',
            confirmText = '确定',
            cancelText = '取消',
            danger = false
        } = opts || {};

        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';

            overlay.innerHTML = `
                <div class="modal-box" role="dialog" aria-modal="true">
                    <h2>${esc(title)}</h2>
                    <p class="modal-text">${esc(text)}</p>
                    <div class="modal-actions">
                        <button type="button" class="btn-secondary" data-action="cancel">${esc(cancelText)}</button>
                        <button type="button" class="${danger ? 'btn-danger' : 'btn-primary'}" data-action="confirm">${esc(confirmText)}</button>
                    </div>
                </div>
            `;

            function cleanup(result) {
                overlay.remove();
                document.removeEventListener('keydown', onKeydown, true);
                resolve(result);
            }

            function onKeydown(e) {
                if (e.key === 'Escape') { e.stopPropagation(); cleanup(false); }
            }

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) cleanup(false);
                const action = e.target.closest('[data-action]');
                if (!action) return;
                cleanup(action.dataset.action === 'confirm');
            });

            // capture 阶段注册：确认框叠在表单弹窗之上时，Esc 只关确认框，不连带关掉下面的表单弹窗
            document.addEventListener('keydown', onKeydown, true);
            document.body.appendChild(overlay);
            overlay.querySelector('[data-action="confirm"]').focus();
        });
    }

    // open({title, html, wide, onMount(body, close)}) -> close()
    // 点遮罩 / Esc / 右上角 ✕ / 「取消」（data-dialog-close）均视为放弃：表单已有改动（文字、选项、照片增删）时先弹窗询问是否放弃；
    // 「保存」走各弹窗自己调用的 close()，不询问。是否有改动 = 打开后弹窗内容的快照与现在不同（见 snapshot）。
    // 同一时刻只保留一个表单弹窗：再次打开会先关掉上一个，避免连续快速操作时弹窗叠罗汉。
    let current = null;

    function open(opts) {
        if (current) current();
        const { title = '', html = '', wide = false, onMount } = opts || {};

        const overlay = document.createElement('div');
        overlay.className = 'dialog-overlay';
        overlay.innerHTML = `
            <div class="dialog-box ${wide ? 'dialog-wide' : ''}" role="dialog" aria-modal="true">
                <div class="dialog-header">
                    <h2>${esc(title)}</h2>
                    <button type="button" class="dialog-close-btn" data-dialog-close title="关闭">✕</button>
                </div>
                <div class="dialog-body">${html}</div>
            </div>
        `;

        const bodyEl = overlay.querySelector('.dialog-body');

        // 内容快照：表单控件的值 + 去掉照片 src 的 HTML（涵盖选中状态、日期块、已选日期、照片增删）
        function snapshot() {
            const clone = bodyEl.cloneNode(true);
            clone.querySelectorAll('img[data-photo]').forEach((im) => im.removeAttribute('src'));
            const vals = Array.from(bodyEl.querySelectorAll('input, textarea, select'))
                .filter((el) => el.type !== 'file')
                .map((el) => (el.type === 'checkbox' || el.type === 'radio') ? el.checked : el.value);
            return JSON.stringify(vals) + clone.innerHTML;
        }
        let baseline = '';
        let touched = false;
        const isDirty = () => baseline !== '' && snapshot() !== baseline;

        function close() {
            overlay.remove();
            document.removeEventListener('keydown', onKeydown);
            if (current === close) current = null;
        }

        let asking = false;
        async function requestClose() {
            if (asking) return;
            if (isDirty()) {
                asking = true;
                const discard = await confirmDialog({
                    title: '有未保存的修改',
                    text: '你修改了内容或照片但还没保存。要继续编辑保留这些修改，还是放弃修改并关闭？',
                    confirmText: '放弃修改',
                    cancelText: '继续编辑',
                    danger: true
                });
                asking = false;
                if (!discard) return;
            }
            close();
        }

        function onKeydown(e) {
            if (e.key === 'Escape') requestClose();
        }

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay || e.target.closest('[data-dialog-close]')) requestClose();
        });
        ['input', 'change', 'click'].forEach((t) => bodyEl.addEventListener(t, () => { touched = true; }, true));
        document.addEventListener('keydown', onKeydown);
        document.body.appendChild(overlay);
        current = close;

        if (onMount) onMount(bodyEl, close);
        baseline = snapshot();
        // 个别组件挂载后下一帧才补渲染内容：用户还没操作时重新取一次基准，避免误报
        requestAnimationFrame(() => { if (!touched && document.body.contains(overlay)) baseline = snapshot(); });
        return close;
    }

    // 单行文本输入，替代 window.prompt（样式统一、移动端体验更好）。取消返回 null
    function prompt(opts) {
        const { title = '请输入', label = '', value = '', placeholder = '', confirmText = '确定' } = opts || {};
        return new Promise((resolve) => {
            let done = false;
            const finish = (v, close) => { if (done) return; done = true; close(); resolve(v); };
            open({
                title,
                html: `
                    <form class="form-grid" data-form>
                        ${label ? `<label>${esc(label)}</label>` : ''}
                        <input type="text" name="value" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off">
                        <div class="modal-actions">
                            <button type="button" class="btn-secondary" data-dialog-close>取消</button>
                            <button type="submit" class="btn-primary">${esc(confirmText)}</button>
                        </div>
                    </form>`,
                onMount(body, close) {
                    const form = body.querySelector('[data-form]');
                    const input = form.querySelector('input');
                    input.focus();
                    input.select();
                    form.addEventListener('submit', (e) => {
                        e.preventDefault();
                        finish(input.value.trim(), close);
                    });
                    // 通过 ✕/遮罩/Esc 关闭时 resolve(null)
                    const observer = new MutationObserver(() => {
                        if (!document.body.contains(body)) { observer.disconnect(); finish(null, () => {}); }
                    });
                    observer.observe(document.body, { childList: true });
                }
            });
        });
    }

    window.Modal = { confirm: confirmDialog, open, prompt, escapeHtml: esc };
})();
