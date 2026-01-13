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
                // 恢复默认设置
                AppState.displayOffsets = [0, 1, 2, 5, 7, 14, 30];
                AppState.columnsPerRow = 7;
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
        try {
            const isLoggedIn = await TauriAPI.isOneDriveLoggedIn();
            const loginSection = document.getElementById('onedrive-login-section');
            const loggedInSection = document.getElementById('onedrive-logged-in-section');

            if (isLoggedIn) {
                loginSection.style.display = 'none';
                loggedInSection.style.display = 'block';
                await this.loadOneDriveUser();
                await this.refreshBackupsList();
            } else {
                loginSection.style.display = 'block';
                loggedInSection.style.display = 'none';
            }
        } catch (error) {
            console.error('检查 OneDrive 登录状态失败:', error);
        }
    },

    async loginOneDrive() {
        try {
            // 1. 生成授权 URL
            const authResponse = await TauriAPI.startOneDriveAuth();
            const { auth_url, state } = authResponse;

            // 检查是否是 Web 版本
            if (TauriAPI.isWebBuild) {
                // Web 版本：直接重定向到授权页面
                Toast.info('正在跳转到 Microsoft 登录页面...');
                window.location.href = auth_url;
                return;
            }

            // Tauri 桌面版本：显示选择对话框
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

            listContainer.innerHTML = backups.map(backup => {
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
    }
};
