// 设置页面逻辑
const SettingsPage = {
    init() {
        // 显示 Web 版本数据持久化提示（仅 Web 版）
        if (TauriAPI.isWebBuild) {
            const webDataNotice = document.getElementById('web-data-notice');
            if (webDataNotice) {
                webDataNotice.style.display = 'block';
            }
        }

        const saveBtn = document.getElementById('save-settings-btn');
        const resetBtn = document.getElementById('reset-settings-btn');
        const deleteAllBtn = document.getElementById('delete-all-btn');
        const exportBtn = document.getElementById('export-data-btn');
        const importBtn = document.getElementById('import-data-btn');
        const importFileInput = document.getElementById('import-file-input');

        // 删除弹窗相关元素
        const deleteModal = document.getElementById('delete-modal');
        const closeDeleteModal = document.getElementById('close-delete-modal');
        const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
        const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
        const deleteVocabCheckbox = document.getElementById('delete-vocab-data');
        const deleteSettingsCheckbox = document.getElementById('delete-settings-data');
        const deleteOneDriveCheckbox = document.getElementById('delete-onedrive-token');

        // OneDrive 相关按钮
        const oneDriveLoginBtn = document.getElementById('onedrive-login-btn');
        const oneDriveLogoutBtn = document.getElementById('onedrive-logout-btn');
        const refreshBackupsBtn = document.getElementById('refresh-backups-btn');

        saveBtn.addEventListener('click', () => this.saveSettings());
        resetBtn.addEventListener('click', () => this.resetSettings());
        deleteAllBtn.addEventListener('click', () => this.openDeleteModal());
        exportBtn.addEventListener('click', () => this.exportData());
        importBtn.addEventListener('click', () => importFileInput.click());
        importFileInput.addEventListener('change', (e) => this.importData(e));

        // 删除弹窗事件监听
        closeDeleteModal.addEventListener('click', () => this.closeDeleteModal());
        cancelDeleteBtn.addEventListener('click', () => this.closeDeleteModal());
        confirmDeleteBtn.addEventListener('click', () => this.deleteSelectedData());

        // 监听复选框变化，更新确认按钮状态
        const updateConfirmButton = () => {
            const anyChecked = deleteVocabCheckbox.checked ||
                deleteSettingsCheckbox.checked ||
                deleteOneDriveCheckbox.checked;
            confirmDeleteBtn.disabled = !anyChecked;
        };

        deleteVocabCheckbox.addEventListener('change', updateConfirmButton);
        deleteSettingsCheckbox.addEventListener('change', updateConfirmButton);
        deleteOneDriveCheckbox.addEventListener('change', updateConfirmButton);

        // 点击弹窗外部关闭
        deleteModal.addEventListener('click', (e) => {
            if (e.target === deleteModal) {
                this.closeDeleteModal();
            }
        });

        // OneDrive 事件监听
        oneDriveLoginBtn.addEventListener('click', () => this.loginOneDrive());
        oneDriveLogoutBtn.addEventListener('click', () => this.openLogoutModal());
        refreshBackupsBtn.addEventListener('click', () => this.refreshBackupsList());

        // 开机自启事件监听
        const autostartCheckbox = document.getElementById('autostart-checkbox');
        autostartCheckbox.addEventListener('change', () => this.toggleAutostart());

        // 开启时同步最新数据事件监听
        const syncOnStartupCheckbox = document.getElementById('sync-on-startup-checkbox');
        syncOnStartupCheckbox.addEventListener('change', () => this.toggleSyncOnStartup());

        // 退出登录弹窗事件监听
        const logoutModal = document.getElementById('logout-onedrive-modal');
        const closeLogoutModal = document.getElementById('close-logout-modal');
        const cancelLogoutBtn = document.getElementById('cancel-logout-btn');
        const confirmLogoutBtn = document.getElementById('confirm-logout-btn');

        closeLogoutModal.addEventListener('click', () => this.closeLogoutModal());
        cancelLogoutBtn.addEventListener('click', () => this.closeLogoutModal());
        confirmLogoutBtn.addEventListener('click', () => this.confirmLogoutOneDrive());

        // 点击弹窗外部关闭
        logoutModal.addEventListener('click', (e) => {
            if (e.target === logoutModal) {
                this.closeLogoutModal();
            }
        });

        this.load();
    },

    openLogoutModal() {
        const logoutModal = document.getElementById('logout-onedrive-modal');
        logoutModal.style.display = 'flex';
    },

    closeLogoutModal() {
        const logoutModal = document.getElementById('logout-onedrive-modal');
        logoutModal.style.display = 'none';
    },

    openDeleteModal() {
        const deleteModal = document.getElementById('delete-modal');
        deleteModal.style.display = 'flex';
        // 重置所有复选框
        document.getElementById('delete-vocab-data').checked = false;
        document.getElementById('delete-settings-data').checked = false;
        document.getElementById('delete-onedrive-token').checked = false;
        document.getElementById('confirm-delete-btn').disabled = true;
    },

    closeDeleteModal() {
        const deleteModal = document.getElementById('delete-modal');
        deleteModal.style.display = 'none';
    },

    async load() {
        const offsetsInput = document.getElementById('display-offsets');
        offsetsInput.value = AppState.displayOffsets.join(',');

        const columnsInput = document.getElementById('columns-per-row');
        columnsInput.value = AppState.columnsPerRow;

        this.updatePreview();
        this.loadStats();
        await this.checkOneDriveStatus();
        await this.loadAutostartStatus();
        this.loadSyncOnStartupStatus();

        // Web 版本：显示存储状态
        if (TauriAPI.isWebBuild) {
            await this.checkStorageStatus();
        }
    },

    updatePreview() {
        const preview = document.getElementById('settings-preview');
        preview.innerHTML = AppState.displayOffsets.map(offset => {
            return `<div class="preview-tag">Day ${offset}</div>`;
        }).join('');
    },

    async saveSettings() {
        const offsetsInput = document.getElementById('display-offsets');
        const value = offsetsInput.value.trim();

        const columnsInput = document.getElementById('columns-per-row');
        const columnsValue = columnsInput.value.trim();

        if (!value) {
            Toast.warning('请输入配置');
            return;
        }

        if (!columnsValue) {
            Toast.warning('请输入每行列数');
            return;
        }

        try {
            const offsets = value.split(',').map(s => {
                const num = parseInt(s.trim());
                if (isNaN(num) || num < 0) {
                    throw new Error('无效的数字');
                }
                return num;
            });

            const columns = parseInt(columnsValue);
            if (isNaN(columns) || columns < 1) {
                throw new Error('列数必须是大于0的整数');
            }

            AppState.displayOffsets = offsets;
            AppState.columnsPerRow = columns;
            AppState.saveSettings();

            this.updatePreview();
            Toast.success('设置已保存');

            // 刷新主页
            await HomePage.load();
        } catch (error) {
            Toast.error('配置格式错误：' + error.message);
        }
    },

    resetSettings() {
        AppState.displayOffsets = [0, 1, 2, 5, 7, 14, 30];
        AppState.columnsPerRow = 7;
        AppState.saveSettings();

        const offsetsInput = document.getElementById('display-offsets');
        offsetsInput.value = AppState.displayOffsets.join(',');

        const columnsInput = document.getElementById('columns-per-row');
        columnsInput.value = AppState.columnsPerRow;

        this.updatePreview();
        Toast.success('已恢复默认设置');
    },

    async loadStats() {
        const statsInfo = document.getElementById('stats-info');

        try {
            const stats = await TauriAPI.getStats();

            statsInfo.innerHTML = `
                <div class="stat-card">
                    <div class="stat-value">${stats.totalDays}</div>
                    <div class="stat-label">总天数</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${stats.totalWords}</div>
                    <div class="stat-label">总词汇</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${stats.totalWords > 0 ? (stats.totalWords / stats.totalDays).toFixed(1) : 0}</div>
                    <div class="stat-label">平均值</div>
                </div>
            `;
        } catch (error) {
            console.error('加载统计信息失败:', error);
            statsInfo.innerHTML = '<div class="empty-message">加载失败</div>';
        }
    },

    async deleteSelectedData() {
        const deleteVocab = document.getElementById('delete-vocab-data').checked;
        const deleteSettings = document.getElementById('delete-settings-data').checked;
        const deleteOneDrive = document.getElementById('delete-onedrive-token').checked;

        try {
            const deletedItems = [];

            // 1. 删除词汇数据
            if (deleteVocab) {
                await TauriAPI.deleteAllData();
                deletedItems.push('词汇数据');
            }

            // 2. 清除用户设置
            if (deleteSettings) {
                localStorage.removeItem('displayOffsets');
                localStorage.removeItem('columnsPerRow');
                localStorage.removeItem('syncOnStartup');
                // 恢复默认设置
                AppState.displayOffsets = [0, 1, 2, 5, 7, 14, 30];
                AppState.columnsPerRow = 7;
                AppState.syncOnStartup = false;
                await AppState.saveSyncOnStartupToBackend();
                deletedItems.push('用户设置');
            }

            // 3. 退出 OneDrive 登录
            if (deleteOneDrive) {
                try {
                    await TauriAPI.logoutOneDrive();
                    deletedItems.push('OneDrive 登录状态');
                } catch (e) {
                    console.warn('清除 OneDrive 登录状态失败:', e);
                }
            }

            // 关闭弹窗
            this.closeDeleteModal();

            Toast.success(`删除成功！已删除：${deletedItems.join('、')}`);

            // 刷新相关页面
            if (deleteVocab) {
                await HomePage.load();
                await InputPage.load();
                await Calendar.render();
                await this.loadStats();
            }

            if (deleteSettings) {
                await this.load(); // 刷新设置页面显示
                await HomePage.load(); // 刷新主页以应用默认设置
            }

            if (deleteOneDrive) {
                await this.checkOneDriveStatus(); // 更新登录状态显示
            }
        } catch (error) {
            console.error('删除数据失败:', error);
            this.closeDeleteModal();
            Toast.error(`删除失败: ${error}`);
        }
    },

    async exportData() {
        try {
            const data = await TauriAPI.exportData();

            if (!data || data.length === 0) {
                Toast.warning('没有数据可以导出');
                return;
            }

            // 生成默认文件名（包含日期时间）
            const now = new Date();
            const dateStr = now.toISOString().split('T')[0];
            const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
            const filename = `DayX_backup_${dateStr}_${timeStr}.json`;

            // 获取桌面路径
            const desktopPath = await TauriAPI.getDesktopPath();
            const defaultPath = `${desktopPath}${filename}`;

            // 显示保存文件对话框
            const filePath = await TauriAPI.showSaveDialog(defaultPath, [
                { name: 'JSON 文件', extensions: ['json'] },
                { name: '所有文件', extensions: ['*'] }
            ]);

            if (!filePath) {
                // 用户取消了保存
                return;
            }

            // 导出到选择的文件路径
            await TauriAPI.exportDataToFile(filePath);

            Toast.success(`数据已导出！共 ${data.length} 天的记录`);
        } catch (error) {
            console.error('导出数据失败:', error);
            Toast.error(`导出失败: ${error}`);
        }
    },

    async importData(event) {
        const file = event.target.files[0];
        if (!file) {
            return;
        }

        // 重置文件输入，允许重复选择同一文件
        event.target.value = '';

        try {
            const text = await file.text();
            const data = JSON.parse(text);

            // 验证数据格式
            if (!Array.isArray(data)) {
                throw new Error('文件格式错误：数据应该是数组');
            }

            // 验证每条记录的格式
            for (const record of data) {
                if (!record.day_number || !record.date || !record.weekday || !Array.isArray(record.words)) {
                    throw new Error('文件格式错误：缺少必要字段或字段类型不正确');
                }
            }

            const confirmed = confirm(
                `⚠️ 警告：导入数据将替换所有现有数据！\n\n` +
                `文件信息：\n` +
                `- 文件名：${file.name}\n` +
                `- 记录数：${data.length} 天\n` +
                `- 总词汇：${data.reduce((sum, d) => sum + d.words.length, 0)} 个\n\n` +
                `确定要继续吗？`
            );

            if (!confirmed) {
                return;
            }

            await TauriAPI.importData(data);

            Toast.success(`数据导入成功！已导入 ${data.length} 天的记录`);

            // 刷新所有页面
            await HomePage.load();
            await InputPage.load();
            await Calendar.render();
            await this.loadStats();
        } catch (error) {
            console.error('导入数据失败:', error);
            Toast.error(`导入失败: ${error.message || error}`);
        }
    },

    // OneDrive 相关方法
    async checkOneDriveStatus() {
        console.log('checkOneDriveStatus: 开始检查 OneDrive 状态...');
        try {
            const isLoggedIn = await TauriAPI.isOneDriveLoggedIn();
            console.log('checkOneDriveStatus: isLoggedIn =', isLoggedIn);
            const loginSection = document.getElementById('onedrive-login-section');
            const loggedInSection = document.getElementById('onedrive-logged-in-section');
            console.log('checkOneDriveStatus: loginSection存在?', !!loginSection, ', loggedInSection存在?', !!loggedInSection);

            if (isLoggedIn) {
                console.log('checkOneDriveStatus: 用户已登录，显示已登录界面');
                loginSection.style.display = 'none';
                loggedInSection.style.display = 'block';
                await this.loadOneDriveUser();
                await this.refreshBackupsList();
            } else {
                console.log('checkOneDriveStatus: 用户未登录，显示登录按钮');
                loginSection.style.display = 'block';
                loggedInSection.style.display = 'none';
            }
        } catch (error) {
            console.error('检查 OneDrive 登录状态失败:', error);
        }
    },

    async loginOneDrive() {
        try {
            // ── Web 版本：MSAL popup 登录（静默续签，彻底告别 24h SPA 过期问题）────
            if (TauriAPI.isWebBuild) {
                Toast.info('正在打开 Microsoft 登录弹窗...');
                try {
                    await TauriAPI.loginOneDriveViaPopup();
                    Toast.success('OneDrive 登录成功！');
                    await this.checkOneDriveStatus();
                } catch (err) {
                    if (err.message === 'user_cancelled') {
                        Toast.info('已取消 Microsoft 登录');
                    } else {
                        // MSAL 可能抛出含具体 errorCode 的错误
                        console.error('MSAL 登录失败:', err);
                        Toast.error(`登录失败: ${err.message || err}`);
                    }
                }
                return;
            }

            // ── Tauri 桌面版本：生成授权 URL → 外部浏览器打开 ─────────────────────
            // 1. 生成授权 URL
            const authResponse = await TauriAPI.startOneDriveAuth();
            const { auth_url, state } = authResponse;

            // 2. 显示选择对话框
            const userChoice = await this.showAuthDialog(auth_url);

            if (userChoice === 'cancel') {
                return; // 用户取消
            }

            // 3. 根据用户选择打开浏览器或复制链接
            if (userChoice === 'browser') {
                await window.__TAURI__.shell.open(auth_url);
            } else if (userChoice === 'copy') {
                await navigator.clipboard.writeText(auth_url);
                Toast.success('授权链接已复制到剪贴板\n请在浏览器中打开该链接完成授权');
            }

            // 4. 启动后台监听（不阻塞）
            TauriAPI.waitForOAuthCallback(state).then(async () => {
                await this.checkOneDriveStatus();
            }).catch(error => {
                console.error('OAuth 回调失败:', error);
            });

            // 5. 同时启动轮询作为备用方案（每 2 秒检查一次）
            const startTime = Date.now();
            const maxWaitTime = 5 * 60 * 1000; // 5 分钟

            const pollInterval = setInterval(async () => {
                const elapsed = Date.now() - startTime;

                // 超时停止
                if (elapsed > maxWaitTime) {
                    clearInterval(pollInterval);
                    return;
                }

                try {
                    // 检查是否已登录
                    const status = await TauriAPI.isOneDriveLoggedIn();
                    if (status) {
                        clearInterval(pollInterval);
                        await this.checkOneDriveStatus();
                    }
                } catch (error) {
                    // 继续等待
                }
            }, 2000);

        } catch (error) {
            console.error('登录 OneDrive 失败:', error);
            Toast.error(`登录失败: ${error}`);
        }
    },

    // 显示等待授权对话框
    showAuthWaitingDialog() {
        // 移除已存在的对话框
        this.closeAuthWaitingDialog();

        const dialog = document.createElement('div');
        dialog.id = 'auth-waiting-dialog';
        dialog.className = 'auth-dialog-overlay';
        dialog.innerHTML = `
            <div class="auth-dialog">
                <div class="auth-dialog-header">
                    <h3>⏳ 等待授权</h3>
                </div>
                <div class="auth-dialog-body">
                    <p>已在新标签页打开 Microsoft 登录页面</p>
                    <p class="auth-tip">请在新标签页中完成登录授权</p>
                    <div class="auth-waiting-spinner">
                        <div class="spinner"></div>
                        <span>正在等待授权完成...</span>
                    </div>
                    <p class="auth-hint">授权完成后，此对话框将自动关闭</p>
                </div>
                <div class="auth-dialog-footer">
                    <button class="btn-cancel" id="auth-waiting-cancel-btn">取消</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);

        // 绑定取消按钮事件
        const cancelBtn = dialog.querySelector('#auth-waiting-cancel-btn');
        cancelBtn.addEventListener('click', () => {
            this.closeAuthWaitingDialog();
            Toast.info('已取消登录');
        });
    },

    // 关闭等待授权对话框
    closeAuthWaitingDialog() {
        const dialog = document.getElementById('auth-waiting-dialog');
        if (dialog) {
            dialog.remove();
        }
    },

    /**
     * 显示授权方式选择对话框
     * @param {string} authUrl - 授权 URL
     * @returns {Promise<'browser'|'copy'|'cancel'>} 用户选择
     */
    async showAuthDialog(authUrl) {
        return new Promise((resolve) => {
            // 创建弹窗 HTML
            const dialog = document.createElement('div');
            dialog.className = 'auth-dialog-overlay';
            dialog.innerHTML = `
                <div class="auth-dialog">
                    <div class="auth-dialog-header">
                        <h3>🌐 OneDrive 登录</h3>
                        <button class="close-btn" id="auth-close-btn" aria-label="关闭">&times;</button>
                    </div>
                    <div class="auth-dialog-body">
                        <p>即将打开浏览器进行 OneDrive 授权验证</p>
                        <p class="auth-tip">请选择打开方式：</p>
                        <div class="auth-buttons">
                            <button class="auth-btn primary" id="auth-browser-btn">
                                🌐 在浏览器中打开
                            </button>
                            <button class="auth-btn secondary" id="auth-copy-btn">
                                📋 复制授权链接
                            </button>
                        </div>
                        <div class="auth-url-preview">
                            <label>授权链接预览：</label>
                            <input type="text" readonly value="${authUrl}" onclick="this.select()">
                        </div>
                    </div>
                    <div class="auth-dialog-footer">
                        <button class="btn-cancel" id="auth-cancel-btn">取消</button>
                    </div>
                </div>
            `;

            document.body.appendChild(dialog);

            // 绑定事件
            const browserBtn = dialog.querySelector('#auth-browser-btn');
            const copyBtn = dialog.querySelector('#auth-copy-btn');
            const cancelBtn = dialog.querySelector('#auth-cancel-btn');
            const closeBtn = dialog.querySelector('#auth-close-btn');

            const cleanup = () => {
                document.body.removeChild(dialog);
            };

            browserBtn.addEventListener('click', () => {
                cleanup();
                resolve('browser');
            });

            copyBtn.addEventListener('click', () => {
                cleanup();
                resolve('copy');
            });

            cancelBtn.addEventListener('click', () => {
                cleanup();
                resolve('cancel');
            });

            closeBtn.addEventListener('click', () => {
                cleanup();
                resolve('cancel');
            });

            // 点击外部关闭
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) {
                    cleanup();
                    resolve('cancel');
                }
            });
        });
    },

    async loadOneDriveUser() {
        try {
            const user = await TauriAPI.getOneDriveUser();
            document.getElementById('onedrive-user-name').textContent = user.display_name;
            document.getElementById('onedrive-user-email').textContent = user.mail || '无邮箱';
        } catch (error) {
            console.error('加载用户信息失败:', error);
        }
    },

    async confirmLogoutOneDrive() {
        // 先关闭模态框
        this.closeLogoutModal();

        // 防止重复点击
        if (this.isLoggingOut) return;

        this.isLoggingOut = true;
        const logoutBtn = document.getElementById('onedrive-logout-btn');
        const originalText = logoutBtn.textContent;
        logoutBtn.textContent = '退出中...';
        logoutBtn.disabled = true;

        try {
            await TauriAPI.logoutOneDrive();
            // 成功后静默刷新 UI，不弹提示
            await this.checkOneDriveStatus();
            Toast.success('已退出登录');
        } catch (error) {
            console.error('退出登录失败:', error);
            Toast.error(`退出失败: ${error}`);
            // 恢复按钮状态（如果失败）
            logoutBtn.textContent = originalText;
            logoutBtn.disabled = false;
        } finally {
            this.isLoggingOut = false;
        }
    },

    async refreshBackupsList() {
        const listContainer = document.getElementById('onedrive-backups-list');

        try {
            const backups = await TauriAPI.listOneDriveBackups();
            console.log('云端备份列表:', backups);

            if (!backups || backups.length === 0) {
                listContainer.innerHTML = '<div class="empty-backups">暂无云端备份</div>';
                return;
            }

            // 按日期从新到旧排序
            const sortedBackups = backups.sort((a, b) => {
                const dateA = new Date(a.createdDateTime || a.created_date_time);
                const dateB = new Date(b.createdDateTime || b.created_date_time);
                return dateB - dateA; // 降序：最新的在前
            });

            // 过滤：只显示近5条 + 近7天的内容
            const now = new Date();
            const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

            const filteredBackups = sortedBackups.filter((backup, index) => {
                // 前5条必须显示
                if (index < 5) return true;

                // 或者是近7天内的
                const backupDate = new Date(backup.createdDateTime || backup.created_date_time);
                return backupDate >= sevenDaysAgo;
            });

            if (filteredBackups.length === 0) {
                listContainer.innerHTML = '<div class="empty-backups">暂无符合条件的备份</div>';
                return;
            }

            listContainer.innerHTML = filteredBackups.map(backup => {
                // Microsoft Graph API 返回 createdDateTime (camelCase)
                const date = new Date(backup.createdDateTime || backup.created_date_time);
                const dateStr = date.toLocaleString('zh-CN');
                const sizeKB = (backup.size / 1024).toFixed(2);

                return `
                    <div class="backup-item">
                        <div class="backup-info">
                            <div class="backup-name">📁 ${backup.name}</div>
                            <div class="backup-meta">${dateStr} · ${sizeKB} KB</div>
                        </div>
                        <div class="backup-actions">
                            <button class="btn-primary" onclick="SettingsPage.restoreFromOneDrive('${backup.id}', '${backup.name}')">恢复</button>
                        </div>
                    </div>
                `;
            }).join('');
        } catch (error) {
            console.error('获取备份列表失败:', error);
            listContainer.innerHTML = '<div class="empty-backups">加载失败</div>';
        }
    },

    async restoreFromOneDrive(fileId, filename) {
        const confirmed = confirm(
            `⚠️ 确定要从云端恢复数据吗？\n\n` +
            `备份文件：${filename}\n\n` +
            `这将替换所有现有数据！`
        );

        if (!confirmed) return;

        try {
            // 下载备份文件
            const jsonData = await TauriAPI.downloadBackupFromOneDrive(fileId);
            const data = JSON.parse(jsonData);

            // 导入数据
            await TauriAPI.importData(data);

            Toast.success(`恢复成功！已从云端恢复 ${data.length} 天的记录`);

            // 刷新所有页面
            await HomePage.load();
            await InputPage.load();
            await Calendar.render();
            await this.loadStats();
        } catch (error) {
            console.error('恢复数据失败:', error);
            Toast.error(`恢复失败: ${error}`);
        }
    },

    // 加载开机自启状态
    async loadAutostartStatus() {
        const checkbox = document.getElementById('autostart-checkbox');
        const autostartSection = document.getElementById('settings-autostart');

        // Web 版本隐藏开机自启功能
        if (TauriAPI.isWebBuild) {
            if (autostartSection) {
                autostartSection.style.display = 'none';
            }
            return;
        }

        try {
            const isEnabled = await TauriAPI.isAutostartEnabled();
            checkbox.checked = isEnabled;
        } catch (error) {
            console.error('加载开机自启状态失败:', error);
        }
    },

    // 切换开机自启
    async toggleAutostart() {
        // Web 版本不支持开机自启
        if (TauriAPI.isWebBuild) {
            Toast.warning('Web 版本不支持开机自启功能');
            return;
        }

        const checkbox = document.getElementById('autostart-checkbox');
        const isEnabled = checkbox.checked;

        try {
            if (isEnabled) {
                await TauriAPI.enableAutostart();
                Toast.success('已启用开机自启');
            } else {
                await TauriAPI.disableAutostart();
                Toast.success('已禁用开机自启');
            }
        } catch (error) {
            console.error('设置开机自启失败:', error);
            Toast.error(`设置失败: ${error}`);
            // 恢复复选框状态
            checkbox.checked = !isEnabled;
        }
    },

    // 加载开启时同步复选框状态
    loadSyncOnStartupStatus() {
        const checkbox = document.getElementById('sync-on-startup-checkbox');
        if (!checkbox) {
            console.warn('sync-on-startup-checkbox 元素未找到');
            return;
        }
        checkbox.checked = AppState.syncOnStartup;
        console.log('loadSyncOnStartupStatus: checkbox.checked =', checkbox.checked);
    },

    // 切换开启时自动同步最新数据
    async toggleSyncOnStartup() {
        const checkbox = document.getElementById('sync-on-startup-checkbox');
        if (!checkbox) {
            console.warn('sync-on-startup-checkbox 元素未找到');
            return;
        }
        AppState.syncOnStartup = checkbox.checked;
        AppState.saveSettings();
        await AppState.saveSyncOnStartupToBackend();
        console.log('toggleSyncOnStartup: saved', checkbox.checked);
        if (checkbox.checked) {
            Toast.success('已开启启动时自动同步');
        } else {
            Toast.info('已关闭启动时自动同步');
        }
    },

    // 检查并显示存储状态（仅 Web 版）
    async checkStorageStatus() {
        const statusBody = document.getElementById('storage-status-body');
        if (!statusBody) return;

        try {
            // 调用 TauriAPI 的持久化检查方法
            const storageStatus = await TauriAPI.requestPersistentStorage();

            if (!storageStatus || !storageStatus.supported) {
                // 不支持持久化存储 API
                statusBody.innerHTML = `
                    <div class="storage-status-unsupported">
                        浏览器不支持持久化存储 API
                        <div class="storage-status-details">
                            您的浏览器可能不支持持久化存储功能，数据可能在清理时丢失。<br>
                            建议使用最新版 Chrome、Edge 或 Firefox。
                        </div>
                    </div>
                `;
            } else if (storageStatus.persisted) {
                // 已获得持久化保护
                statusBody.innerHTML = `
                    <div class="storage-status-protected">
                        持久化存储已启用，数据受到保护
                        <div class="storage-status-details">
                            您的词汇数据已申请持久化保护，<br>
                            不会在常规浏览器清理中被删除。
                        </div>
                    </div>
                `;
            } else {
                // 未获得持久化保护 - 区分 Chrome 和其他浏览器
                const isChrome = storageStatus.isChrome;
                const isFirefox = storageStatus.isFirefox;

                let browserHelp = '';
                if (isChrome) {
                    browserHelp = `
                        <div class="storage-status-browser-help chrome-help">
                            <strong>💡 Chrome 用户专属提示：</strong><br>
                            Chrome 需要满足以下条件之一才能授予持久化保护：<br>
                            <ul style="margin: 0.5rem 0; padding-left: 1.5rem; line-height: 1.8;">
                                <li>点击地址栏右侧的<strong>安装按钮</strong>（⊕ 或 <svg style="display: inline; width: 16px; height: 16px; vertical-align: middle;">📥</svg>），将网站安装为应用</li>
                                <li>授予网站<strong>通知权限</strong>（地址栏锁图标 → 网站设置 → 通知 → 允许）</li>
                                <li>经常访问该网站，让 Chrome 认为您信任此网站</li>
                            </ul>
                            <div style="margin-top: 0.5rem; padding: 0.5rem; background: rgba(255,152,0,0.1); border-radius: 4px;">
                                🎯 <strong>推荐操作</strong>：点击地址栏的安装按钮，将 DayX 安装为桌面应用
                            </div>
                        </div>
                    `;
                } else if (isFirefox) {
                    browserHelp = `
                        <div class="storage-status-browser-help firefox-help">
                            💡 Firefox 通常会自动授予持久化权限。如果未获得，请检查浏览器隐私设置。
                        </div>
                    `;
                }

                statusBody.innerHTML = `
                    <div class="storage-status-unprotected">
                        未获得持久化存储权限
                        <div class="storage-status-details">
                            浏览器可能会在存储空间不足时自动清理数据。<br>
                            建议定期使用"导出数据"或"OneDrive 云备份"功能。
                        </div>
                        ${browserHelp}
                    </div>
                `;
            }
        } catch (error) {
            console.error('检查存储状态失败:', error);
            statusBody.innerHTML = `
                <div class="storage-status-loading">检查失败: ${error.message}</div>
            `;
        }
    }
};
