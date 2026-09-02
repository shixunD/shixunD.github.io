// classSwitcher.js —— 班级切换/新建/重命名/删除组件，挂载在抽奖页和录入页左上角
// 全局命名空间：window.ClassSwitcher
// 用法：ClassSwitcher.renderInto(containerEl)，组件内部通过 AppState 读写数据，
// 数据变化会触发 AppState 的订阅者（页面 render）自动重绘，所以这里不需要自己维护额外状态。

(function () {
    'use strict';

    // 全局只注册一次的"点击面板外部即关闭"监听，避免每次组件重绘都叠加新监听器
    document.addEventListener('click', (e) => {
        document.querySelectorAll('.class-switcher-panel:not([hidden])').forEach((panel) => {
            if (!panel.closest('.class-switcher').contains(e.target)) panel.hidden = true;
        });
    });

    function renderInto(container) {
        if (!container) return;
        const activeClass = AppState.getActiveClass();
        const classes = AppState.getClasses();

        container.innerHTML = `
            <div class="class-switcher">
                <button type="button" class="class-switcher-current" data-action="toggle">
                    🏫 ${Modal.escapeHtml(activeClass.name)} ▾
                </button>
                <div class="class-switcher-panel" hidden>
                    <div class="class-switcher-list">
                        ${classes.map((c) => `
                            <div class="class-switcher-item ${c.id === activeClass.id ? 'active' : ''}" data-id="${c.id}">
                                <span class="class-item-name" data-action="switch">${Modal.escapeHtml(c.name)}</span>
                                <button type="button" class="class-item-btn" data-action="rename" title="重命名">✎</button>
                                <button type="button" class="class-item-btn" data-action="delete" title="删除班级" ${classes.length <= 1 ? 'disabled' : ''}>🗑️</button>
                            </div>
                        `).join('')}
                    </div>
                    <button type="button" class="class-switcher-add-btn" data-action="add">➕ 新建班级</button>
                </div>
            </div>
        `;

        const panel = container.querySelector('.class-switcher-panel');

        container.addEventListener('click', async (e) => {
            const action = e.target.closest('[data-action]');
            if (!action) return;
            e.stopPropagation();

            if (action.dataset.action === 'toggle') {
                panel.hidden = !panel.hidden;
                return;
            }

            const item = action.closest('.class-switcher-item');
            const classId = item ? item.dataset.id : null;

            if (action.dataset.action === 'switch' && classId) {
                await AppState.switchClass(classId);
                return;
            }

            if (action.dataset.action === 'rename' && classId) {
                const cls = classes.find((c) => c.id === classId);
                const name = window.prompt('重命名班级', cls ? cls.name : '');
                if (name && name.trim()) await AppState.renameClass(classId, name.trim());
                return;
            }

            if (action.dataset.action === 'delete' && classId) {
                const cls = classes.find((c) => c.id === classId);
                const ok = await Modal.confirm({
                    title: '删除班级',
                    text: `确定删除班级「${cls ? cls.name : ''}」吗？该班级下的所有学生数据将被永久删除，此操作不可撤销。`,
                    confirmText: '删除',
                    danger: true
                });
                if (ok) await AppState.removeClass(classId);
                return;
            }

            if (action.dataset.action === 'add') {
                const name = window.prompt('新班级名称', '');
                if (name && name.trim()) await AppState.addClass(name.trim());
            }
        });
    }

    window.ClassSwitcher = { renderInto };
})();
