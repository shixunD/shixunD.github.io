// modal.js —— 通用确认弹窗 helper
// 全局命名空间：window.Modal

(function () {
    'use strict';

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
                    <h2>${escapeHtml(title)}</h2>
                    <p style="color:var(--text-secondary);font-size:0.9rem;line-height:1.6;white-space:pre-line;">${escapeHtml(text)}</p>
                    <div class="modal-actions">
                        <button type="button" class="btn-secondary" data-action="cancel">${escapeHtml(cancelText)}</button>
                        <button type="button" class="${danger ? 'btn-danger' : 'btn-primary'}" data-action="confirm">${escapeHtml(confirmText)}</button>
                    </div>
                </div>
            `;

            function cleanup(result) {
                overlay.remove();
                document.removeEventListener('keydown', onKeydown);
                resolve(result);
            }

            function onKeydown(e) {
                if (e.key === 'Escape') cleanup(false);
            }

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) cleanup(false);
                const action = e.target.closest('[data-action]');
                if (!action) return;
                cleanup(action.dataset.action === 'confirm');
            });

            document.addEventListener('keydown', onKeydown);
            document.body.appendChild(overlay);
        });
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    window.Modal = {
        confirm: confirmDialog,
        escapeHtml
    };
})();
