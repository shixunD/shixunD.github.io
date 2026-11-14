// backupReminder.js —— 备份提醒：记录「上次备份」时间，每天第一次打开时如果数据在上次备份之后有改动，就弹窗提醒备份
// 全局命名空间：window.BackupReminder
//
// 为什么要有：所有数据只在这个浏览器的 IndexedDB 里，清理浏览器数据、重装系统、换电脑都会让一整个学期的记录消失。
//
// 记在 localStorage（备份状态是"这台电脑上这份数据"的事，不进 state、不进 .db）：
//   lastAt      上次备份的时间（毫秒）
//   lastWhere   上次备份到哪里：'local'（下载 .db 到本地）| 'onedrive'
//   changedAt   上次备份之后第一次改数据的时间（毫秒）；空 = 备份之后没改过
//   checkedDay  今天是否已经检查过（YYYY-MM-DD）：每天只在第一次打开时提醒一次
// 「改动」来自 AppState.onDataChange：所有 _commit（切换班级这种界面状态除外）+ 旋转已保存的照片。
// 导入 .db / 从 OneDrive 恢复 = 数据和那份备份一样，算作没有改动。
// 下载 .db 只能确认"浏览器开始下载了"，确认不了老师真的保存了文件，这里按备份成功记。

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);
    const KEY = {
        lastAt: 'teachingPanel.backup.lastAt',
        lastWhere: 'teachingPanel.backup.lastWhere',
        changedAt: 'teachingPanel.backup.changedAt',
        checkedDay: 'teachingPanel.backup.checkedDay',
        seen: 'teachingPanel.backup.seen'
    };
    const WHERE_LABEL = { local: '下载到本地', onedrive: 'OneDrive' };

    const num = (key) => Number(Utils.lsGet(key, '')) || 0;

    function status() {
        const lastAt = num(KEY.lastAt);
        const changedAt = num(KEY.changedAt);
        return {
            lastAt,
            lastWhere: Utils.lsGet(KEY.lastWhere, ''),
            changedAt,
            // 有改动：备份之后改过数据（changedAt 只在"备份之后的第一次改动"时写入，所以 > lastAt 即可）
            dirty: !!changedAt && changedAt >= lastAt
        };
    }

    function markChanged() {
        if (num(KEY.changedAt)) return;   // 记第一次改动的时间就够了
        Utils.lsSet(KEY.changedAt, String(Date.now()));
    }

    function markBackedUp(where) {
        Utils.lsSet(KEY.lastAt, String(Date.now()));
        Utils.lsSet(KEY.lastWhere, where);
        Utils.lsSet(KEY.changedAt, '');
        if (window.Navigation && Navigation.getCurrent() === 'home' && window.SettingsPage) SettingsPage.render();
    }

    // 「11-14(星期五) 09:30」
    function formatTime(ms) {
        const d = new Date(ms);
        const pad = (x) => String(x).padStart(2, '0');
        return `${Utils.formatDate(Utils.toDateStr(d))} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function lastText(st) {
        if (!st.lastAt) return '这台电脑上还没有备份记录';
        return `上次备份：${formatTime(st.lastAt)}（${WHERE_LABEL[st.lastWhere] || st.lastWhere || '本地'}）`;
    }

    // 主页「💾 数据」卡片里的一行
    function cardLineHtml() {
        const st = status();
        const warn = st.dirty || !st.lastAt;
        return `<div class="backup-line ${warn ? 'backup-warn' : 'backup-ok'}">
            <span>${esc(lastText(st))}</span>
            <span class="backup-state">${st.dirty ? '之后数据有改动，建议备份' : (st.lastAt ? '之后没有改动' : '')}</span>
        </div>`;
    }

    // 下载 .db 到本地（主页按钮和提醒弹窗共用）
    async function backupLocal() {
        const name = await ImportExport.exportToFile();
        Toast.success(`已导出 ${name}，请确认文件已保存`);
    }

    function showReminder() {
        const st = status();
        Modal.open({
            title: '💾 该备份了',
            html: `
                <p>${st.lastAt
                    ? `上次备份是 <b>${esc(formatTime(st.lastAt))}</b>（${esc(WHERE_LABEL[st.lastWhere] || '本地')}），之后数据有改动。`
                    : '这台电脑上还没有备份记录，数据只保存在这个浏览器里。'}</p>
                <p class="hint">清理浏览器数据、重装系统或换电脑都可能让记录丢失。备份一份 .db 文件就能随时恢复。</p>
                <div class="btn-col">
                    <button type="button" class="btn-primary" data-backup-local>📤 下载到本地（.db）</button>
                    <button type="button" class="btn-secondary" data-backup-onedrive>⬆️ 上传到 OneDrive</button>
                    <button type="button" class="btn-secondary" data-dialog-close>稍后再说</button>
                </div>`,
            onMount(body, close) {
                body.querySelector('[data-backup-local]').addEventListener('click', async (e) => {
                    e.currentTarget.disabled = true;
                    try {
                        await backupLocal();
                        close();
                    } catch (err) {
                        e.currentTarget.disabled = false;
                        Toast.error('导出失败：' + err.message);
                    }
                });
                body.querySelector('[data-backup-onedrive]').addEventListener('click', async () => {
                    close();   // 没登录时 quickUpload 会打开 OneDrive 面板，先把提醒关掉
                    try {
                        if (await OneDriveApi.quickUpload()) Toast.success('已上传到 OneDrive');
                    } catch (err) {
                        Toast.error('上传失败：' + err.message);
                    }
                });
            }
        });
    }

    // 每天第一次打开（或跨天后切回页面）时检查一次；有改动才弹
    function check() {
        const today = Utils.today();
        if (Utils.lsGet(KEY.checkedDay, '') === today) return;
        // 更新弹窗还开着：老师可能马上点「更新」刷新页面，这次先不算，等下次打开 / 切回页面再查
        if (document.querySelector('.update-overlay')) return;
        Utils.lsSet(KEY.checkedDay, today);
        if (status().dirty) showReminder();
    }

    // 模块加载时就监听（不等 init）：init 要等更新检查结束，这期间的改动也要记上
    AppState.onDataChange((kind) => {
        if (kind === 'replace') Utils.lsSet(KEY.changedAt, '');   // 导入 / 恢复后 = 和那份备份一致
        else markChanged();
    });

    function init() {
        // 第一次用这个功能（升级上来的老用户）：不知道之前有没有备份过。已经有学生数据就当作"有改动"，马上提醒一次
        if (Utils.lsGet(KEY.seen, '') !== '1') {
            Utils.lsSet(KEY.seen, '1');
            if (!num(KEY.lastAt) && AppState.getState().students.length) markChanged();
        }
        check();
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') check();
        });
    }

    window.BackupReminder = { init, check, status, markBackedUp, cardLineHtml, backupLocal, showReminder };
})();
