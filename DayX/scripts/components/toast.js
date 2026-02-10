// Toast 通知组件
const Toast = {
    // 显示 Toast 通知
    show(message, duration = 3000, extraClass = '') {
        // 创建或获取 Toast 容器
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            document.body.appendChild(container);
        }

        // 创建 Toast 元素
        const toast = document.createElement('div');
        toast.className = `toast${extraClass ? ' ' + extraClass : ''}`;
        toast.textContent = message;

        // 添加到容器
        container.appendChild(toast);

        // 触发显示动画
        setTimeout(() => {
            toast.classList.add('show');
        }, 10);

        // 自动隐藏
        setTimeout(() => {
            toast.classList.remove('show');
            // 移除元素
            setTimeout(() => {
                container.removeChild(toast);
            }, 300); // 等待淡出动画完成
        }, duration);
    },

    // 成功提示（带图标）
    success(message, duration = 3000) {
        this.show(`✓ ${message}`, duration);
    },

    // 信息提示（带图标）
    info(message, duration = 3000) {
        this.show(`ℹ ${message}`, duration);
    },

    // 警告提示（带图标）
    warning(message, duration = 3000) {
        this.show(`⚠ ${message}`, duration);
    },

    // 错误提示（带图标，红色背景，默认5秒）
    error(message, duration = 5000) {
        this.show(`✕ ${message}`, duration, 'toast-error');
    }
};

// 导出到全局
window.Toast = Toast;
