// backJump.js —— 在「学生趋势」和作业 / 背诵 / 考试等页面之间跳转后，左上角的「返回」小按钮
// 每次跳转前记下出发的页面、（趋势页的）学生和滚动位置；点按钮回到出发处，回去后按钮就消失。
// 没点按钮时它一直留着，新的跳转会覆盖上一次的记录；记录只在内存里，刷新 / 关闭页面后不再显示
// 全局命名空间：window.BackJump

(function () {
    'use strict';

    let saved = null;   // { page, studentId, y }
    let btn = null;

    const ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';

    function place() {
        if (!btn) return;
        const nav = document.querySelector('.navbar');
        btn.style.top = ((nav ? nav.offsetHeight : 0) + 10) + 'px';
    }

    function ensureButton() {
        if (btn) return;
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'back-jump-btn';
        btn.title = '返回刚才的位置（右键关闭此按钮）';
        btn.setAttribute('aria-label', '返回刚才的位置');
        btn.innerHTML = ICON;
        btn.addEventListener('click', back);
        // 右键：不跳转，只关掉按钮
        btn.addEventListener('contextmenu', (e) => { e.preventDefault(); dismiss(); });
        document.body.appendChild(btn);
        window.addEventListener('resize', place);
    }

    // 跳走之前调用（这样滚动位置还是对的）：记录当前页、滚动位置，在趋势页时还有当前学生
    function mark() {
        const page = Navigation.getCurrent();
        saved = { page, studentId: page === 'trend' ? StudentTrend.currentId() : null, y: window.scrollY };
        ensureButton();
        place();
    }

    function dismiss() {
        saved = null;
        if (btn) btn.remove();
        btn = null;
    }

    function back() {
        if (!saved) return;
        const s = saved;
        dismiss();   // 用过一次就消失；下次跳转时再出现
        if (s.studentId) StudentTrend.setCurrent(s.studentId);
        Navigation.goTo(s.page);
        window.scrollTo(0, s.y);
    }

    window.BackJump = { mark };
})();
