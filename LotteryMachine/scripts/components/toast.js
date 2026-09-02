// toast.js —— 轻量提示条
// 全局命名空间：window.Toast

(function () {
    'use strict';

    let container = null;

    function ensureContainer() {
        if (container) return container;
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = [
            'position:fixed', 'top:16px', 'left:50%', 'transform:translateX(-50%)',
            'z-index:9500', 'display:flex', 'flex-direction:column', 'gap:8px',
            'align-items:center', 'pointer-events:none'
        ].join(';');
        document.body.appendChild(container);
        return container;
    }

    const COLORS = {
        info: '#4a6cf7',
        success: '#22c1a4',
        error: '#e74c3c',
        warning: '#f5a623'
    };

    function show(message, type = 'info', duration = 2600) {
        const el = document.createElement('div');
        el.textContent = message;
        el.style.cssText = [
            `background:${COLORS[type] || COLORS.info}`,
            'color:#fff', 'padding:10px 18px', 'border-radius:10px',
            'font-size:0.88rem', 'box-shadow:0 6px 20px rgba(0,0,0,0.18)',
            'opacity:0', 'transform:translateY(-8px)',
            'transition:opacity 0.2s ease, transform 0.2s ease',
            'max-width:80vw', 'text-align:center'
        ].join(';');
        ensureContainer().appendChild(el);

        requestAnimationFrame(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        });

        setTimeout(() => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(-8px)';
            setTimeout(() => el.remove(), 220);
        }, duration);
    }

    window.Toast = {
        show,
        info: (msg, d) => show(msg, 'info', d),
        success: (msg, d) => show(msg, 'success', d),
        error: (msg, d) => show(msg, 'error', d),
        warning: (msg, d) => show(msg, 'warning', d)
    };
})();
