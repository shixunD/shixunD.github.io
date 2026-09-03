// settings.js —— 设置页：抽奖时长、数据管理、PWA 安装、持久化存储、版本信息
// 全局命名空间：window.SettingsPage

(function () {
    'use strict';

    const APP_VERSION_EL_ID = 'settings-current-version';

    function getBody() {
        return document.getElementById('settings-page-body');
    }

    function render() {
        const body = getBody();
        if (!body) return;
        const settings = AppState.getState().settings;

        body.innerHTML = `
            <div class="settings-container">
                <div class="settings-left-column">
                    <div class="settings-section">
                        <h2>🎯 抽奖设置</h2>
                        <div class="setting-item">
                            <label>转盘旋转时长（毫秒）</label>
                            <input type="number" id="setting-spin-duration" min="500" max="10000" step="100" value="${settings.spinDurationMs}">
                            <div class="setting-help">点击"开始抽奖"后转盘旋转多久才停下，默认 2000ms</div>
                        </div>
                        <div class="setting-item">
                            <label>中奖弹窗自动关闭（秒）</label>
                            <input type="number" id="setting-winner-autoclose" min="0" max="60" step="1" value="${Math.round((settings.winnerAutoCloseMs || 0) / 1000)}" ${settings.winnerAutoCloseMs > 0 ? '' : 'disabled'}>
                            <label class="checkbox-label-inline" style="margin-top:0.4rem;">
                                <input type="checkbox" id="setting-winner-no-autoclose" ${settings.winnerAutoCloseMs > 0 ? '' : 'checked'}>
                                <span>不自动关闭，需手动点击"好的"</span>
                            </label>
                            <div class="setting-help">中奖后弹窗展示多久自动消失，默认 5 秒</div>
                        </div>
                        <div class="setting-item">
                            <label>抽奖快捷键</label>
                            <div class="setting-row" style="align-items:center;">
                                <span class="shortcut-key-badge" id="setting-shortcut-display">${Modal.escapeHtml(settings.spinShortcutKey || '未设置')}</span>
                                <button type="button" class="btn-secondary" id="setting-shortcut-record-btn">🎹 录入键盘快捷键</button>
                            </div>
                            <div class="setting-help">在「抽奖」页按下这个键（或组合键，如 Ctrl+T）等同于点击"开始抽奖"，默认 <code>PageUp</code>（大多数翻页笔/演示遥控器的翻页键）</div>
                        </div>
                        <div class="setting-item">
                            <label class="checkbox-label-inline">
                                <input type="checkbox" id="setting-hide-draw-history" ${settings.hideDrawHistory ? 'checked' : ''}>
                                <span>隐藏底部"抽取历史"条</span>
                            </label>
                            <div class="setting-help">抽奖页底部会显示最近抽中的头像/姓名/时间，仅在本次打开页面期间保留（刷新即清空）；勾选后隐藏，默认不开启</div>
                        </div>
                    </div>

                    <div class="settings-section">
                        <h2>🖥️ 安装与存储</h2>
                        <div class="setting-item">
                            <button type="button" class="btn-secondary" id="settings-install-btn" disabled>📥 安装到桌面</button>
                            <div class="setting-help" id="settings-install-help">检测安装可用性中...</div>
                        </div>
                        <div class="storage-status-card">
                            <div class="storage-status-header">
                                <span>🔒</span><span>持久化存储状态</span>
                            </div>
                            <div class="storage-status-body" id="settings-storage-status">检查中...</div>
                        </div>
                        <div class="setting-help">开启后浏览器清理站点数据时不易误删本应用数据；仍建议定期导出或使用 OneDrive 备份。</div>
                    </div>
                </div>

                <div class="settings-right-column">
                    <div class="settings-section">
                        <h2>💾 数据导入导出</h2>
                        <p class="settings-desc">备份或恢复所有班级的学生名单与设置（不含跳过更新等临时标记）</p>
                        <div class="import-export-actions">
                            <button type="button" class="btn-primary" id="settings-export-btn">📤 导出数据</button>
                            <button type="button" class="btn-secondary" id="settings-import-btn">📥 导入数据</button>
                            <input type="file" id="settings-import-input" accept=".json" hidden>
                        </div>
                    </div>

                    <div class="settings-section">
                        <h2>☁️ OneDrive 云备份</h2>
                        <p class="settings-desc">上传备份到云端，或从历史备份中恢复</p>
                        <button type="button" class="btn-primary" id="settings-onedrive-btn">☁️ 打开 OneDrive 备份</button>
                    </div>

                    <div class="settings-section">
                        <h2>📦 版本信息</h2>
                        <div class="version-info-row">
                            <span class="version-info-label">当前版本</span>
                            <span id="${APP_VERSION_EL_ID}">加载中...</span>
                        </div>
                        <div class="settings-btn-row" style="margin-top:0.8rem;">
                            <button type="button" class="btn-secondary" id="settings-check-update-btn">🔄 检查更新</button>
                            <a class="btn-secondary" href="./Handbook/index.html" target="_blank" rel="noopener">📖 产品说明</a>
                        </div>
                    </div>

                    <div class="settings-section danger-zone">
                        <h2>⚠️ 危险区域</h2>
                        <p class="settings-desc danger-desc">以下操作不可撤销，请谨慎操作</p>
                        <button type="button" class="btn-danger" id="settings-clear-btn">🗑️ 清空全部学生数据</button>
                    </div>
                </div>
            </div>
        `;

        bindEvents(body);
        loadStorageStatus();
        loadVersionInfo();
        bindInstallButton();
    }

    function bindEvents(body) {
        body.querySelector('#setting-spin-duration').addEventListener('change', (e) => {
            const val = Math.max(500, Number(e.target.value) || 2000);
            AppState.updateSettings({ spinDurationMs: val });
            Toast.success('已保存');
        });

        const autoCloseInput = body.querySelector('#setting-winner-autoclose');
        const noAutoCloseCheckbox = body.querySelector('#setting-winner-no-autoclose');

        autoCloseInput.addEventListener('change', () => {
            const seconds = Math.max(0, Number(autoCloseInput.value) || 0);
            AppState.updateSettings({ winnerAutoCloseMs: seconds * 1000 });
            Toast.success('已保存');
        });

        noAutoCloseCheckbox.addEventListener('change', () => {
            if (noAutoCloseCheckbox.checked) {
                autoCloseInput.disabled = true;
                AppState.updateSettings({ winnerAutoCloseMs: 0 });
            } else {
                autoCloseInput.disabled = false;
                const seconds = Math.max(1, Number(autoCloseInput.value) || 5);
                autoCloseInput.value = seconds;
                AppState.updateSettings({ winnerAutoCloseMs: seconds * 1000 });
            }
            Toast.success('已保存');
        });

        bindShortcutRecorder(body);

        body.querySelector('#setting-hide-draw-history').addEventListener('change', (e) => {
            AppState.updateSettings({ hideDrawHistory: e.target.checked });
            Toast.success('已保存');
        });

        body.querySelector('#settings-export-btn').addEventListener('click', () => {
            const filename = ImportExport.exportToFile();
            Toast.success(`已导出 ${filename}`);
        });

        body.querySelector('#settings-import-btn').addEventListener('click', () => {
            body.querySelector('#settings-import-input').click();
        });

        body.querySelector('#settings-import-input').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            e.target.value = '';
            if (!file) return;
            const ok = await Modal.confirm({
                title: '导入数据',
                text: '导入将覆盖当前所有学生数据和设置，确定继续吗？',
                confirmText: '导入',
                danger: true
            });
            if (!ok) return;
            try {
                await ImportExport.importFromFile(file);
                Toast.success('导入成功');
                render();
            } catch (err) {
                Toast.error('导入失败: ' + err.message);
            }
        });

        body.querySelector('#settings-onedrive-btn').addEventListener('click', () => {
            OneDriveApi.open();
        });

        body.querySelector('#settings-check-update-btn').addEventListener('click', async () => {
            Toast.info('正在检查更新...');
            await UpdateChecker.check();
        });

        body.querySelector('#settings-clear-btn').addEventListener('click', async () => {
            const ok = await Modal.confirm({
                title: '清空全部学生数据',
                text: '此操作将删除所有学生名单，且不可恢复。建议先导出备份。确定要清空吗？',
                confirmText: '清空',
                danger: true
            });
            if (!ok) return;
            await AppState.clearStudents();
            Toast.success('已清空');
        });
    }

    // "录入键盘快捷键"：点击后进入监听状态，支持组合键（Ctrl/Alt/Shift + 某个键），
    // 单独按下修饰键时先不结束录入，继续等待完整组合的最后一下非修饰键；
    // window.__recordingShortcut 是给 app.js 的全局快捷键监听看的标记，避免录入过程中的这次按键被误当成触发抽奖
    function bindShortcutRecorder(body) {
        const btn = body.querySelector('#setting-shortcut-record-btn');
        const display = body.querySelector('#setting-shortcut-display');

        btn.addEventListener('click', () => {
            window.__recordingShortcut = true;
            const originalText = btn.textContent;
            btn.textContent = '请按下要设置的按键...（Esc 取消）';
            btn.disabled = true;

            const onKeydown = async (e) => {
                e.preventDefault();
                const combo = ShortcutUtil.formatFromEvent(e);
                if (!combo) return; // 只按了修饰键，继续等待下一次按键组成完整组合

                document.removeEventListener('keydown', onKeydown, true);
                window.__recordingShortcut = false;
                btn.textContent = originalText;
                btn.disabled = false;

                if (combo === 'Escape') return; // 取消录入，保留原快捷键

                await AppState.updateSettings({ spinShortcutKey: combo });
                display.textContent = combo;
                Toast.success(`已设置快捷键：${combo}`);
            };
            document.addEventListener('keydown', onKeydown, true);
        });
    }

    async function loadStorageStatus() {
        const el = document.getElementById('settings-storage-status');
        if (!el) return;
        const status = await Persistence.requestPersistence();
        if (!status.supported) {
            el.innerHTML = '当前浏览器不支持持久化存储 API';
            return;
        }
        el.innerHTML = `
            状态：${status.persisted ? '✅ 已持久化，不易被自动清理' : '⚠️ 未持久化，浏览器空间紧张时数据可能被清理'}<br>
            已用空间：约 ${status.usageMB} MB / ${status.quotaMB} MB
        `;
    }

    async function loadVersionInfo() {
        const el = document.getElementById(APP_VERSION_EL_ID);
        if (!el) return;
        try {
            const res = await fetch('./version.json', { cache: 'no-store' });
            const data = await res.json();
            el.textContent = data.version || '未知';
        } catch (e) {
            el.textContent = '获取失败';
        }
    }

    function bindInstallButton() {
        const btn = document.getElementById('settings-install-btn');
        const help = document.getElementById('settings-install-help');
        if (!btn) return;

        function refresh() {
            if (PwaInstall.isStandalone()) {
                btn.disabled = true;
                help.textContent = '已在独立窗口中运行（已安装）';
                return;
            }
            if (PwaInstall.isAvailable()) {
                btn.disabled = false;
                help.textContent = '点击后可安装到桌面/开始菜单，获得独立窗口体验';
            } else {
                btn.disabled = true;
                help.textContent = '当前浏览器暂不支持一键安装，或已安装过';
            }
        }

        btn.addEventListener('click', async () => {
            const outcome = await PwaInstall.promptInstall();
            if (outcome === 'accepted') Toast.success('安装成功');
        });

        PwaInstall.onAvailabilityChange(refresh);
        refresh();
    }

    window.SettingsPage = { render };
})();
