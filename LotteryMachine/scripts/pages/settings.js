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

                        <div class="setting-group-title">转盘节奏</div>
                        <div class="setting-item">
                            <label>旋转时长（毫秒）与圈数</label>
                            <div class="setting-row spin-timing-row">
                                <div class="spin-timing-field">
                                    <span class="spin-timing-field-label">匀速时长 x</span>
                                    <input type="number" id="setting-spin-fast" min="200" max="5000" step="100" value="${settings.spinFastMs}">
                                </div>
                                <div class="spin-timing-field spin-timing-field-turns">
                                    <span class="spin-timing-field-label">圈数</span>
                                    <input type="number" id="setting-spin-turns" min="0.1" max="20" step="0.1" value="${settings.spinFastTurns}">
                                </div>
                                <div class="spin-timing-field">
                                    <span class="spin-timing-field-label">悬念时长 y</span>
                                    <input type="number" id="setting-spin-slow" min="200" max="10000" step="100" value="${settings.spinSlowMs}">
                                </div>
                            </div>
                            <div class="setting-help">点击"开始抽奖"后先在 <b>x 毫秒</b>内匀速转指定<b>圈数</b>（表示公平）；接着用固定的 <b>y 毫秒</b>匀减速停下（悬念感来自落点随机落在扇区内的哪个位置，不是减速时长本身）。默认 x=400、圈数=1、y=2500。</div>
                        </div>

                        <div class="setting-divider"></div>
                        <div class="setting-group-title">中奖提示</div>
                        <div class="setting-item">
                            <label>弹窗自动关闭（秒）</label>
                            <input type="number" id="setting-winner-autoclose" min="0" max="60" step="1" value="${Math.round((settings.winnerAutoCloseMs || 0) / 1000)}" ${settings.winnerAutoCloseMs > 0 ? '' : 'disabled'}>
                            <label class="checkbox-label-inline" style="margin-top:0.4rem;">
                                <input type="checkbox" id="setting-winner-no-autoclose" ${settings.winnerAutoCloseMs > 0 ? '' : 'checked'}>
                                <span>不自动关闭，需手动点击"好的"</span>
                            </label>
                            <div class="setting-help">中奖后弹窗展示多久自动消失，默认 5 秒</div>
                        </div>

                    </div>

                    <div class="settings-section">
                        <h2>🧮 权重公式</h2>
                        <div class="setting-item">
                            <label>权重计算公式</label>
                            <input type="text" id="setting-weight-formula" class="formula-input" value="${Modal.escapeHtml(settings.weightFormula || AppState.DEFAULT_WEIGHT_FORMULA)}" placeholder="如 160-g">
                            <div class="setting-help">g 代表学生成绩，支持 <code>+ - * / ( )</code> 四则运算与括号，如 <code>160-g</code>、<code>(150-g)*2</code>。保存后会立即重新计算所有"按成绩自动计算权重"的学生；输入不支持的符号会提示错误并恢复上次保存的内容。</div>
                            <div class="settings-btn-row" style="margin-top:0.5rem;">
                                <button type="button" class="btn-secondary" id="setting-weight-formula-reset">↺ 重置为默认（${Modal.escapeHtml(AppState.DEFAULT_WEIGHT_FORMULA)}）</button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="settings-right-column">
                    <div class="settings-section">
                        <h2>🎮 操作方式</h2>
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
                        <div class="setting-item">
                            <label class="checkbox-label-inline">
                                <input type="checkbox" id="setting-sound-effects" ${settings.soundEffectsEnabled !== false ? 'checked' : ''}>
                                <span>🔊 开启抽奖音效</span>
                            </label>
                            <div class="setting-help">旋转期间随机播放一段音效（自动倍速匹配旋转时长），指针停下后随机播放一段中奖音效，默认开启</div>
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
        body.querySelector('#setting-spin-fast').addEventListener('change', (e) => {
            const val = Math.max(200, Number(e.target.value) || 1000);
            e.target.value = val;
            AppState.updateSettings({ spinFastMs: val });
            Toast.success('已保存');
        });
        body.querySelector('#setting-spin-turns').addEventListener('change', (e) => {
            // 支持小数圈数（比如 0.5 圈），不强制取整
            const val = Math.max(0.1, Number(e.target.value) || 3);
            e.target.value = val;
            AppState.updateSettings({ spinFastTurns: val });
            Toast.success('已保存');
        });
        body.querySelector('#setting-spin-slow').addEventListener('change', (e) => {
            const val = Math.max(200, Number(e.target.value) || 1000);
            e.target.value = val;
            AppState.updateSettings({ spinSlowMs: val });
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
        bindWeightFormula(body);

        body.querySelector('#setting-hide-draw-history').addEventListener('change', (e) => {
            AppState.updateSettings({ hideDrawHistory: e.target.checked });
            Toast.success('已保存');
        });

        body.querySelector('#setting-sound-effects').addEventListener('change', (e) => {
            AppState.updateSettings({ soundEffectsEnabled: e.target.checked });
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

    // 权重公式输入框：保存前用 AppState.testWeightFormula 校验，失败则红色 toast 提示并恢复上次保存的内容；
    // "重置为默认"按钮直接把公式设回 AppState.DEFAULT_WEIGHT_FORMULA
    function bindWeightFormula(body) {
        const input = body.querySelector('#setting-weight-formula');
        let lastSaved = AppState.getState().settings.weightFormula || AppState.DEFAULT_WEIGHT_FORMULA;

        async function saveFormula(formula) {
            const val = (formula || '').trim();
            if (!val) {
                Toast.error('公式不能为空，已恢复上次保存的内容');
                input.value = lastSaved;
                return;
            }
            const test = AppState.testWeightFormula(val);
            if (!test.ok) {
                Toast.error(`公式包含不支持的数学符号：${test.message}`);
                input.value = lastSaved;
                return;
            }
            try {
                await AppState.updateWeightFormula(val);
                lastSaved = val;
                input.value = val;
                Toast.success('已保存，权重已重新计算');
            } catch (err) {
                Toast.error('公式包含不支持的数学符号，已恢复上次保存的内容');
                input.value = lastSaved;
            }
        }

        input.addEventListener('change', () => saveFormula(input.value));

        body.querySelector('#setting-weight-formula-reset').addEventListener('click', () => {
            saveFormula(AppState.DEFAULT_WEIGHT_FORMULA);
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
            el.textContent = data.semver ? `v${data.semver}（${data.version || '未知'}）` : (data.version || '未知');
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
