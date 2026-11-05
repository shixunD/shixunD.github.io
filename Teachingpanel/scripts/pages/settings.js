// settings.js —— 主页（设置页）：今日概览、学生名单（RosterSection）、comment 快捷词（QuickPhrases）、数据导入导出与云备份、应用设置
// 全局命名空间：window.SettingsPage

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);
    let versionLabel = '…';

    function container() { return document.getElementById('home-page-body'); }

    function render() {
        const el = container();
        if (!el) return;
        const settings = AppState.getState().settings;
        const rem = RecitationModel.remainingCounts();
        const today = Utils.today();
        const monday = RecitationModel.weekStartOf(today);
        const oweToday = HomeworkModel.countOutstandingBetween(today, today);
        const oweWeek = HomeworkModel.countOutstandingBetween(monday, Utils.addDays(monday, 6));
        const persist = Persistence.getStatus();
        const notifyPerm = 'Notification' in window ? Notification.permission : 'unsupported';

        el.innerHTML = `
            <div class="page-head"><h1>主页</h1><span class="hint">${Utils.formatDate(Utils.today())}</span></div>

            <div class="overview-row">
                <button type="button" class="overview-tile" data-go="recitation:timeline" style="--tile-color:#f2b705">
                    <div class="ov-value">${rem.today}</div><div class="ov-label">今日背诵剩余人数</div>
                </button>
                <button type="button" class="overview-tile" data-go="homework:pending" style="--tile-color:#f48fb1">
                    <div class="ov-value">${oweToday}</div><div class="ov-label">今日作业未补</div>
                </button>
                <button type="button" class="overview-tile" data-go="recitation:overview" style="--tile-color:#d93025">
                    <div class="ov-value">${rem.week}</div><div class="ov-label">本周背诵剩余人数</div>
                </button>
                <button type="button" class="overview-tile" data-go="homework:pending" style="--tile-color:#e8590c">
                    <div class="ov-value">${oweWeek}</div><div class="ov-label">本周作业未补</div>
                </button>
            </div>

            <div class="home-grid">
                <div class="home-main">
                    ${RosterSection.rosterHtml()}
                </div>
                <div class="home-side">
                    ${QuickPhrases.cardHtml()}
                    ${CameraPicker.cardHtml()}

                    <div class="card">
                        <h2>💾 数据</h2>
                        <p class="hint">所有数据只保存在本浏览器。导出得到一个 .db 数据库文件（包含全部班级和数据，可用 DB Browser for SQLite 打开查看）；换电脑/换浏览器时在新设备上导入即可，也可以上传到 OneDrive。</p>
                        <div class="btn-col">
                            <button type="button" class="btn-primary" data-export>📤 导出数据库（.db）</button>
                            <button type="button" class="btn-secondary" data-import>📥 导入数据库（覆盖当前）</button>
                            <input type="file" accept=".db,.sqlite,.sqlite3" data-import-file hidden>
                            <button type="button" class="btn-secondary" data-onedrive>☁️ OneDrive 云备份</button>
                            <button type="button" class="btn-secondary" data-quick-upload>⬆️ 立即上传到 OneDrive</button>
                        </div>
                    </div>

                    <div class="card">
                        <h2>⚙️ 设置</h2>
                        <div class="setting-row">
                            <div><div>背诵计划系统通知</div><div class="hint">打开应用时若今天有背诵计划或计划已逾期，额外弹系统通知${notifyPerm === 'denied' ? '（浏览器已拒绝通知权限）' : ''}</div></div>
                            <button type="button" class="btn-toggle ${settings.reminderNotify ? 'btn-toggle-on' : ''}" data-notify>${settings.reminderNotify ? '已开启' : '已关闭'}</button>
                        </div>
                        <div class="setting-row">
                            <div><div>照片压缩：默认预览档位</div><div class="hint">拍照 / 手机拍 / 上传的照片收到后会弹出预览框，可逐档（WebP 质量 0.001–1.0，或不压缩）对比，点「确定」后只保留所选那一份，完整原图丢弃。这里选打开预览框时默认选中哪一档。只影响以后新拍/上传的照片</div></div>
                            <select data-photo-quality>${Photos.levelOptions().map((l) => `<option value="${l.key}" ${l.key === Photos.getLevel().key ? 'selected' : ''}>${esc(l.desc)}</option>`).join('')}</select>
                        </div>
                        <div class="setting-row">
                            <div><div>照片压缩：自定义档位的质量</div><div class="hint">预览框里「自定义」档的默认质量（0.001–1）。预览框里可临时改，但下次打开仍恢复这里的值</div></div>
                            <div class="inline-input"><input type="number" min="0.001" max="1" step="0.001" value="${Photos.getCustomQuality()}" data-photo-custom></div>
                        </div>
                        <div class="setting-row">
                            <div><div>手机拍：关窗后保持连接</div><div class="hint">手机已连上时，关掉「📱 手机拍」窗口后连接再保持这么多分钟，期间在别的块再点「手机拍」会直接复用，不用重新连接；到时间自动断开。填 0 = 关窗即断开（0–60，默认 2）</div></div>
                            <div class="inline-input"><input type="number" min="0" max="60" step="0.5" value="${PhoneLink.getKeepMinutes()}" data-phone-keep> 分钟</div>
                        </div>
                        <div class="setting-row">
                            <div><div>考试及格线</div><div class="hint">占满分的百分比</div></div>
                            <div class="inline-input"><input type="number" min="1" max="100" value="${settings.passPercent}" data-pass-percent> %</div>
                        </div>
                    </div>

                    <div class="card">
                        <h2>ℹ️ 应用</h2>
                        <div class="setting-row"><span>版本</span><span data-version>${esc(versionLabel)}</span></div>
                        <div class="setting-row"><span>本地存储</span><span>${persist ? (persist.supported ? `${persist.persisted ? '✅ 已持久化' : '⚠ 未持久化'} · ${persist.usageMB} MB` : '不支持') : '检测中…'}</span></div>
                        <div class="btn-col">
                            <button type="button" class="btn-secondary" data-check-update>🔄 检查更新</button>
                            <button type="button" class="btn-secondary" data-install ${PwaInstall.isAvailable() ? '' : 'hidden'}>📲 安装到桌面</button>
                            ${PwaInstall.isStandalone() ? '<div class="hint">✅ 当前以已安装应用方式运行</div>' : ''}
                            <a class="btn-secondary btn-link" href="./Handbook/" target="_blank" rel="noopener">📖 使用说明</a>
                        </div>
                    </div>
                </div>
            </div>
        `;
        bind(el);
    }

    function bind(el) {
        RosterSection.bind(el);
        QuickPhrases.bindCard(el);
        CameraPicker.bindCard(el);
        const q = (sel) => el.querySelector(sel);

        el.querySelectorAll('[data-go]').forEach((btn) => btn.addEventListener('click', () => {
            const [page, tab] = btn.dataset.go.split(':');
            Navigation.goTo(page);
            if (page === 'recitation') RecitationPage.openTab(tab);
            else if (page === 'homework') HomeworkPage.openTab(tab);
        }));

        q('[data-export]').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
                const name = await ImportExport.exportToFile();
                Toast.success(`已导出 ${name}`);
            } catch (err) {
                Toast.error('导出失败：' + err.message);
            } finally {
                btn.disabled = false;
            }
        });
        q('[data-import]').addEventListener('click', () => q('[data-import-file]').click());
        q('[data-import-file]').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            e.target.value = '';
            if (!file) return;
            const ok = await Modal.confirm({
                title: '导入数据库',
                text: `将用「${file.name}」覆盖当前全部数据（所有班级、学生、作业、背诵、考试和设置），此操作不可撤销。\n建议先导出一份当前数据作为备份。`,
                confirmText: '覆盖导入',
                danger: true
            });
            if (!ok) return;
            try {
                await ImportExport.importFromFile(file);
                Toast.success('导入成功');
            } catch (err) {
                Toast.error('导入失败：' + err.message);
            }
        });
        q('[data-onedrive]').addEventListener('click', () => OneDriveApi.open());
        q('[data-quick-upload]').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            btn.textContent = '上传中…';
            try {
                if (await OneDriveApi.quickUpload()) Toast.success('已上传到 OneDrive');
            } catch (err) {
                Toast.error('上传失败：' + err.message);
            } finally {
                btn.disabled = false;
                btn.textContent = '⬆️ 立即上传到 OneDrive';
            }
        });

        q('[data-notify]').addEventListener('click', async () => {
            const on = !AppState.getState().settings.reminderNotify;
            if (on) {
                const perm = await Reminders.requestPermission();
                if (perm !== 'granted') {
                    Toast.error(perm === 'unsupported' ? '当前浏览器不支持系统通知' : '未获得通知权限，请在浏览器设置中允许本站通知');
                    return;
                }
            }
            await AppState.updateSettings({ reminderNotify: on });
        });
        q('[data-photo-quality]').addEventListener('change', (e) => Photos.setLevel(e.target.value));
        q('[data-photo-custom]').addEventListener('change', (e) => {
            Photos.setCustomQuality(e.target.value);
            e.target.value = Photos.getCustomQuality();
            const opt = q('[data-photo-quality] option[value="custom"]');
            if (opt) opt.textContent = Photos.levelOptions()[0].desc;
        });
        q('[data-phone-keep]').addEventListener('change', (e) => {
            PhoneLink.setKeepMinutes(e.target.value);
            e.target.value = PhoneLink.getKeepMinutes();
        });
        q('[data-pass-percent]').addEventListener('change', (e) => {
            const v = Math.max(1, Math.min(100, Number(e.target.value) || 60));
            AppState.updateSettings({ passPercent: v });
        });

        q('[data-check-update]').addEventListener('click', async () => {
            Toast.info('正在检查更新…');
            const result = await UpdateChecker.check({ force: true });
            if (!result.ok) Toast.error('未检测到部署信息（本地开发环境或暂时离线），无法检查更新');
        });
        q('[data-install]').addEventListener('click', async () => {
            const outcome = await PwaInstall.promptInstall();
            if (outcome === 'accepted') Toast.success('已安装');
        });
    }

    async function init() {
        versionLabel = await UpdateChecker.getVersionLabel();
        PwaInstall.onAvailabilityChange(() => { if (Navigation.getCurrent() === 'home') render(); });
        if (Navigation.getCurrent() === 'home') render();
    }

    window.SettingsPage = { render, init };
})();
