// toast.js —— 轻量提示条
// 全局命名空间：window.Toast

(function () {
    'use strict';

    let container = null;

    function ensureContainer() {
        if (container) return container;
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
        return container;
    }

    function show(message, type = 'info', duration = 2600) {
        const el = document.createElement('div');
        el.className = `toast toast-${type}`;
        el.textContent = message;
        ensureContainer().appendChild(el);

        requestAnimationFrame(() => el.classList.add('toast-in'));

        setTimeout(() => {
            el.classList.remove('toast-in');
            setTimeout(() => el.remove(), 220);
        }, duration);
    }

    // 带操作按钮的提示（如「撤销」）：点按钮执行 onAction 并立即消失；超时未点则自动消失
    function action(message, actionLabel, onAction, duration = 8000) {
        const el = document.createElement('div');
        el.className = 'toast toast-info toast-action';
        const text = document.createElement('span');
        text.textContent = message;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = actionLabel;
        el.appendChild(text);
        el.appendChild(btn);
        ensureContainer().appendChild(el);
        requestAnimationFrame(() => el.classList.add('toast-in'));

        let done = false;
        function dismiss() {
            if (done) return;
            done = true;
            el.classList.remove('toast-in');
            setTimeout(() => el.remove(), 220);
        }
        btn.addEventListener('click', () => {
            if (done) return;
            dismiss();
            onAction();
        });
        setTimeout(dismiss, duration);
    }

    window.Toast = {
        show,
        action,
        info: (msg, d) => show(msg, 'info', d),
        success: (msg, d) => show(msg, 'success', d),
        error: (msg, d) => show(msg, 'error', d),
        warning: (msg, d) => show(msg, 'warning', d)
    };
})();
