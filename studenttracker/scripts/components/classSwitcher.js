// classSwitcher.js —— 班级切换/新建/重命名/删除，常驻在顶部导航栏
// 全局命名空间：window.ClassSwitcher
// 用法：ClassSwitcher.renderInto(containerEl)；数据变化由 AppState 订阅者触发重绘

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);

    // 全局只注册一次的"点击面板外部即关闭"监听，避免每次重绘都叠加新监听器
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
                <button type="button" class="class-switcher-current" data-action="toggle" title="切换班级">
                    🏫 <span class="class-switcher-name">${esc(activeClass.name)}</span> ▾
                </button>
                <div class="class-switcher-panel" hidden>
                    <div class="class-switcher-list">
                        ${classes.map((c) => `
                            <div class="class-switcher-item ${c.id === activeClass.id ? 'active' : ''}" data-id="${c.id}">
                                <span class="class-item-name" data-action="switch">${esc(c.name)}</span>
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

        container.querySelector('.class-switcher').addEventListener('click', async (e) => {
            const action = e.target.closest('[data-action]');
            if (!action) return;
            e.stopPropagation();
            const type = action.dataset.action;

            if (type === 'toggle') { panel.hidden = !panel.hidden; return; }

            const item = action.closest('.class-switcher-item');
            const cls = item ? classes.find((c) => c.id === item.dataset.id) : null;
            panel.hidden = true;

            if (type === 'switch' && cls) {
                await AppState.switchClass(cls.id);
                Toast.info(`已切换到「${cls.name}」`);
            } else if (type === 'rename' && cls) {
                const name = await Modal.prompt({ title: '重命名班级', value: cls.name });
                if (name) await AppState.renameClass(cls.id, name);
            } else if (type === 'delete' && cls) {
                const ok = await Modal.confirm({
                    title: '删除班级',
                    text: `确定删除班级「${cls.name}」吗？\n该班级的学生及其全部作业、背诵、考试记录都会被永久删除，此操作不可撤销。`,
                    confirmText: '删除',
                    danger: true
                });
                if (ok) await AppState.removeClass(cls.id);
            } else if (type === 'add') {
                const name = await Modal.prompt({ title: '新建班级', placeholder: '如：高一(3)班' });
                if (name) await AppState.addClass(name);
            }
        });
    }

    window.ClassSwitcher = { renderInto };
})();
