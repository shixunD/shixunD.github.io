// reminders.js —— 背诵提醒（背诵计划）：导航栏角标 + 打开应用时的一次性提示 + 可选系统通知
// 全局命名空间：window.Reminders
//
// 限制：纯静态站点没有推送服务器，所以"到期提醒"只能在应用被打开（或从后台切回前台）时触发，
// 不能在应用关闭时推送。Handbook 里已向用户说明。

(function () {
    'use strict';

    const LS_LAST_NOTIFY = 'teachingPanel.reminder.lastNotified';

    function updateBadge() {
        const btn = document.querySelector('.nav-btn[data-page="recitation"]');
        if (!btn) return;
        const c = RecitationModel.reminderCounts();
        const n = c.today + c.overdue;
        let badge = btn.querySelector('.nav-badge');
        if (!n) { if (badge) badge.remove(); return; }
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'nav-badge';
            btn.appendChild(badge);
        }
        badge.textContent = n > 99 ? '99+' : String(n);
        badge.classList.toggle('nav-badge-danger', c.overdue > 0);
        btn.title = `今天背诵安排 ${c.today} · 已逾期 ${c.overdue}`;
    }

    // 每天（每个班级）最多主动提醒一次，避免每次切回页面都弹
    function remindOnce() {
        const c = RecitationModel.reminderCounts();
        if (!c.today && !c.overdue) return;
        const key = `${Utils.today()}|${AppState.getActiveClassId()}`;
        if (Utils.lsGet(LS_LAST_NOTIFY, '') === key) return;
        Utils.lsSet(LS_LAST_NOTIFY, key);

        const text = `背诵计划：今天 ${c.today} 人次${c.overdue ? `，已逾期 ${c.overdue} 人次` : ''}`;
        Toast.warning(`⏰ ${text}（见「背诵 → 时间看板」）`, 5000);

        if (AppState.getState().settings.reminderNotify && 'Notification' in window && Notification.permission === 'granted') {
            try { new Notification('学情看板', { body: text, icon: './icon-192.png', tag: 'recitation-reminder' }); } catch (e) { /* 部分移动端浏览器只允许 SW 发通知 */ }
        }
    }

    async function requestPermission() {
        if (!('Notification' in window)) return 'unsupported';
        if (Notification.permission === 'granted') return 'granted';
        return Notification.requestPermission();
    }

    function init() {
        updateBadge();
        remindOnce();
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible') return;
            updateBadge();
            remindOnce();
        });
        // 跨过午夜时日期变了，到期状态也要更新
        setInterval(updateBadge, 10 * 60 * 1000);
    }

    window.Reminders = { init, updateBadge, remindOnce, requestPermission };
})();
