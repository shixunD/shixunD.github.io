// studentProfile.js —— 学生档案面板：一次看全某学生的作业、背诵、考试情况（家长会/谈话时用）
// 全局命名空间：window.StudentProfile
// 任意位置带 data-profile-id 的元素被点击都会打开档案（全局委托，模块加载时只注册一次）
// 层级：.profile-overlay z-index 6500 —— 高于业务弹窗（6000），低于云备份面板（7000）和确认框（7500）

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);
    let overlay = null;
    let currentId = null;
    let tab = 'homework';

    document.addEventListener('click', (e) => {
        const trigger = e.target.closest('[data-profile-id]');
        if (!trigger) return;
        e.preventDefault();
        open(trigger.dataset.profileId);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay && !document.querySelector('.dialog-overlay, .modal-overlay')) close();
    });

    // 从哪个页面点进来，档案就默认打开对应的标签（作业页→作业、背诵页→背诵、考试页→考试）；
    // 从主页点进来则沿用上次看的标签
    const PAGE_TO_TAB = { homework: 'homework', recitation: 'recitation', exams: 'exams' };

    function open(studentId) {
        if (!AppState.getStudent(studentId)) return;
        currentId = studentId;
        const fromTab = PAGE_TO_TAB[Navigation.getCurrent()];
        if (fromTab) tab = fromTab;
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'profile-overlay';
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay || e.target.closest('[data-profile-close]')) close();
                const t = e.target.closest('[data-profile-tab]');
                if (t) { tab = t.dataset.profileTab; render(); }
            });
            document.body.appendChild(overlay);
        }
        render();
    }

    function close() {
        if (overlay) overlay.remove();
        overlay = null;
        currentId = null;
    }

    function render() {
        if (!overlay) return;
        const stu = AppState.getStudent(currentId);
        if (!stu) { close(); return; }
        const tabs = [
            { key: 'homework', label: '作业' },
            { key: 'recitation', label: '背诵' },
            { key: 'exams', label: '考试' }
        ];
        let body;
        if (tab === 'homework') body = HomeworkStudent.summaryHtml(stu.id, {}, true);
        else if (tab === 'recitation') body = RecitationStudent.summaryHtml(stu.id, false);
        else body = ExamStudent.summaryHtml(stu.id, {}, 'percent');

        overlay.innerHTML = `
            <div class="profile-panel" role="dialog" aria-modal="true">
                <div class="profile-head">
                    <div class="profile-avatar">${esc(stu.name.slice(-2))}</div>
                    <div class="profile-meta">
                        <div class="profile-name">${esc(stu.name)}</div>
                        <div class="hint">学号 ${esc(stu.studentNo || '-')} · ${esc(AppState.getActiveClass().name)}${stu.note ? ` · ${esc(stu.note)}` : ''}</div>
                    </div>
                    <button type="button" class="dialog-close-btn" data-profile-close title="关闭">✕</button>
                </div>
                <div class="sub-tabs">${tabs.map((t) => `<button type="button" class="sub-tab ${t.key === tab ? 'active' : ''}" data-profile-tab="${t.key}">${t.label}</button>`).join('')}</div>
                <div class="profile-body">${body}</div>
            </div>`;
        // 档案面板内的"检查"按钮等交互不在这里提供，保持只读，避免与页面视图的事件绑定重复
        overlay.querySelectorAll('.profile-body [data-check-round]').forEach((b) => b.remove());
    }

    // 数据变化时（比如在档案打开期间切换了班级、删除了学生）同步刷新
    function refresh() { if (overlay) render(); }

    window.StudentProfile = { open, close, refresh };
})();
