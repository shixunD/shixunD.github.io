// 用于标记页面初始化是否完成，同步刷新时需要等待
let _resolveInitReady;
const initReadyPromise = new Promise(resolve => { _resolveInitReady = resolve; });

// 主应用入口
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DayX 应用初始化...');

    // 0. 检查是否是 Web 版本的 OAuth 回调（仅 Web 版本）
    if (typeof TauriAPI !== 'undefined' && TauriAPI.isWebBuild) {
        // 🔒 主动申请持久化存储权限（fire-and-forget，不阻塞启动）
        if (TauriAPI.requestPersistentStorage) {
            TauriAPI.requestPersistentStorage().then(status => {
                if (status && status.persisted) {
                    console.log('✅ 持久化存储已启用，数据将受到保护');
                } else if (status && !status.persisted) {
                    console.warn('⚠️ 未获得持久化存储权限，数据可能在浏览器清理时丢失');
                }
            }).catch(err => console.warn('⚠️ 持久化存储检查失败:', err));
        }

        // 📱 注册 Service Worker（fire-and-forget，不阻塞启动）
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./service-worker.js').then(registration => {
                console.log('✅ Service Worker 注册成功:', registration.scope);
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            if (typeof Toast !== 'undefined') {
                                Toast.info('新版本已准备就绪，刷新页面即可更新');
                            }
                        }
                    });
                });
            }).catch(err => console.warn('⚠️ Service Worker 注册失败:', err));
        }

        await handleWebOAuthCallback();
    }

    // 1. 加载设置
    AppState.loadSettings();

    // 2. 立即检查是否需要启动时同步，如果需要则立即显示遮罩
    const syncEnabled = AppState.syncOnStartup;
    let syncPromise = null;
    if (syncEnabled) {
        // 立即显示遮罩（不等待任何异步操作）
        const overlay = document.getElementById('sync-freeze-overlay');
        if (overlay) overlay.style.display = 'flex';

        // 启动同步流程（完全并行，不阻塞）
        syncPromise = performStartupSync();
    }

    // 3. 初始化导航
    Navigation.init();

    // 4. 并行初始化所有页面和组件（不 await，让数据库加载和同步完全并行）
    const initPromises = [
        HomePage.init(),
        // InputPage 和 SettingsPage 是同步的，可以直接调用
        Promise.resolve(InputPage.init()),
        Promise.resolve(SettingsPage.init()),
        Promise.resolve(Calendar.init()),
        Promise.resolve(YearOverview.init())
    ];

    // 5. 初始化窗口拖动功能（同步操作）
    initWindowDrag();

    // 6. 初始化导航栏右键菜单
    const contextMenuPromise = initNavbarContextMenu();

    // 7. 监听后端状态变化事件
    setupEventListeners();

    // 8. 等待所有初始化完成
    await Promise.all([...initPromises, contextMenuPromise]);

    // 标记页面初始化完成，同步刷新可以安全执行了
    _resolveInitReady();

    // 9. 等待同步完成（如果还在进行中的话）
    if (syncPromise) {
        await syncPromise;
    }

    console.log('DayX 应用初始化完成！');
});

// Web 版本 OAuth 回调处理
async function handleWebOAuthCallback() {
    // MSAL 接管：若 web_api.js 已启用 MSAL（useMSAL: true），
    // MSAL 的 handleRedirectPromise() 在 web_api.js 初始化时已自动处理 popup 回调并关闭窗口，
    // 无需旧版手动 code exchange 流程，跳过即可。
    if (TauriAPI.useMSAL) {
        return;
    }

    // 使用新的回调检查方法
    if (!TauriAPI.checkAndHandleOAuthCallback) {
        console.warn('checkAndHandleOAuthCallback 方法不存在');
        return;
    }

    try {
        const result = await TauriAPI.checkAndHandleOAuthCallback();

        if (!result.isCallback) {
            return; // 不是 OAuth 回调页面
        }

        console.log('检测到 OAuth 回调，处理结果:', result);

        if (result.success) {
            // 授权成功 - 显示成功页面
            showOAuthSuccessPage();
        } else {
            // 授权失败 - 显示错误信息
            setTimeout(() => {
                if (typeof Toast !== 'undefined') {
                    Toast.error(`登录失败: ${result.error}`);
                }
            }, 500);
        }
    } catch (error) {
        console.error('OAuth 回调处理失败:', error);
    }
}

// 显示 OAuth 授权成功页面（在回调标签页中）
function showOAuthSuccessPage() {
    // 创建成功提示覆盖层
    const overlay = document.createElement('div');
    overlay.className = 'oauth-success-overlay';
    overlay.innerHTML = `
        <div class="oauth-success-content">
            <div class="oauth-success-icon">✅</div>
            <h2>授权成功！</h2>
            <p>OneDrive 登录已完成</p>
            <p class="oauth-success-hint">您可以关闭此标签页，返回原页面继续使用</p>
            <button class="oauth-close-btn" onclick="window.close()">关闭此标签页</button>
        </div>
    `;

    // 添加样式
    const style = document.createElement('style');
    style.textContent = `
        .oauth-success-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: var(--bg-color, #fff);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        }
        .oauth-success-content {
            text-align: center;
            padding: 40px;
        }
        .oauth-success-icon {
            font-size: 64px;
            margin-bottom: 20px;
        }
        .oauth-success-content h2 {
            color: var(--primary-color, #2196F3);
            margin-bottom: 10px;
        }
        .oauth-success-content p {
            color: var(--text-secondary, #666);
            margin-bottom: 8px;
        }
        .oauth-success-hint {
            font-size: 14px;
            opacity: 0.8;
        }
        .oauth-close-btn {
            margin-top: 24px;
            padding: 12px 32px;
            background: var(--primary-color, #2196F3);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            cursor: pointer;
            transition: background-color 0.2s;
        }
        .oauth-close-btn:hover {
            background: var(--primary-hover, #1976D2);
        }
    `;

    document.head.appendChild(style);
    document.body.appendChild(overlay);

    // 5秒后自动关闭标签页
    setTimeout(() => {
        window.close();
    }, 5000);
}

// 窗口拖动状态
let isWindowLocked = false;

// 初始化窗口拖动功能（通过 navbar 拖动窗口）
function initWindowDrag() {
    const navbar = document.querySelector('.navbar');

    if (!navbar) {
        console.warn('未找到 navbar 元素');
        return;
    }

    // 为 navbar 添加用户选择禁用，避免拖动时选中文字
    navbar.style.userSelect = 'none';
    navbar.style.webkitUserSelect = 'none';

    // 为 nav-brand 和 nav-homepagedirector 添加点击事件，打开链接
    const navBrand = document.querySelector('.nav-brand');
    const navDirector = document.querySelector('.nav-homepagedirector');

    if (navBrand) {
        navBrand.addEventListener('click', () => {
            openExternalLink('https://shixund.github.io/');
        });
    }

    if (navDirector) {
        navDirector.addEventListener('click', (e) => {
            e.stopPropagation(); // 防止事件冒泡
            openExternalLink('https://shixund.github.io/');
        });
    }

    // 双击 navbar 空白区域触发 OneDrive 备份（PC 和 Web 都支持）
    navbar.addEventListener('dblclick', (e) => {
        // 排除已有按钮和品牌链接区域
        if (e.target.closest('.nav-btn') || e.target.closest('.nav-brand-container') || e.target.closest('.nav-links')) {
            return;
        }
        // 调用 InputPage 的 syncToOneDrive 方法
        if (typeof InputPage !== 'undefined' && InputPage.syncToOneDrive) {
            InputPage.syncToOneDrive();
        }
    });

    // Web 版本不支持窗口拖动
    if (TauriAPI.isWebBuild) {
        navbar.style.cursor = 'default';
        return;
    }

    navbar.style.webkitAppRegion = 'no-drag'; // 重要：防止默认拖动行为

    navbar.addEventListener('mousedown', (e) => {
        // 如果窗口已锁定，不允许拖动
        if (isWindowLocked) {
            return;
        }

        // 只在点击 navbar 背景区域时触发拖动，不在按钮或品牌链接上
        if (e.target.closest('.nav-btn') || e.target.closest('.nav-brand-container')) {
            return;
        }

        // 设置拖动样式
        navbar.style.cursor = 'grabbing';

        // 使用 Tauri invoke 调用窗口拖动命令
        if (window.__TAURI__ && window.__TAURI__.window) {
            window.__TAURI__.window.appWindow.startDragging().catch(err => {
                console.error('窗口拖动失败:', err);
            });
        } else {
            console.warn('Tauri API 未加载');
        }
    });

    navbar.addEventListener('mouseup', () => {
        if (!isWindowLocked) {
            navbar.style.cursor = 'grab';
        }
    });

    // 设置初始鼠标样式提示可拖动
    updateNavbarCursor();
}

// 更新导航栏鼠标样式
function updateNavbarCursor() {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;

    if (isWindowLocked) {
        navbar.style.cursor = 'default';
    } else {
        navbar.style.cursor = 'grab';
    }
}

// 初始化导航栏右键菜单
async function initNavbarContextMenu() {
    const navbar = document.querySelector('.navbar');
    const contextMenu = document.getElementById('navbar-context-menu');
    const lockMenuItem = document.getElementById('toggle-lock-menu-item');
    const lockMenuText = document.getElementById('lock-menu-text');
    const desktopPinMenuItem = document.getElementById('toggle-desktop-pin-menu-item');
    const desktopPinMenuText = document.getElementById('desktop-pin-menu-text');

    if (!navbar || !contextMenu || !lockMenuItem || !desktopPinMenuItem) {
        console.warn('右键菜单元素未找到');
        return;
    }

    // Web 版本不支持窗口锁定和桌面固定，隐藏菜单
    if (TauriAPI.isWebBuild) {
        contextMenu.style.display = 'none';
        return;
    }

    // 从后端加载保存的窗口状态
    try {
        const savedState = await TauriAPI.getSavedWindowState();
        if (savedState) {
            // 恢复锁定位置状态
            if (savedState.is_locked) {
                isWindowLocked = true;
                lockMenuText.textContent = '🔓 解锁位置';
                updateNavbarCursor();
                console.log('✅ 已恢复锁定位置状态');
            }

            // 恢复桌面固定状态（仅更新菜单文本，实际固定由后端在启动时完成）
            if (savedState.is_desktop_pinned) {
                desktopPinMenuText.textContent = '📍 取消桌面固定';
                console.log('✅ 已恢复桌面固定菜单状态');
            }
        }
    } catch (err) {
        console.error('加载窗口状态失败:', err);
        // 降级到 localStorage（向后兼容）
        const savedLockState = localStorage.getItem('windowLocked');
        if (savedLockState === 'true') {
            isWindowLocked = true;
            lockMenuText.textContent = '🔓 解锁位置';
            updateNavbarCursor();
        }
    }

    // 右键点击导航栏显示菜单
    navbar.addEventListener('contextmenu', async (e) => {
        e.preventDefault();

        // 从后端查询当前状态（确保与托盘菜单操作同步）
        try {
            const savedState = await TauriAPI.getSavedWindowState();
            if (savedState) {
                // 同步锁定位置状态
                isWindowLocked = savedState.is_locked;
                updateNavbarCursor();
                lockMenuText.textContent = isWindowLocked ? '🔓 解锁位置' : '🔒 固定位置';
            }
        } catch (err) {
            console.error('查询窗口状态失败:', err);
        }

        // 从后端查询当前桌面固定状态
        const isDesktopPinned = await TauriAPI.getDesktopPinStatus();

        // 更新菜单文本
        desktopPinMenuText.textContent = isDesktopPinned ? '📍 取消桌面固定' : '📌 固定到桌面';

        // 显示菜单
        contextMenu.classList.add('show');
        contextMenu.style.left = `${e.clientX}px`;
        contextMenu.style.top = `${e.clientY}px`;
    });

    // 点击菜单项切换锁定状态
    lockMenuItem.addEventListener('click', async () => {
        try {
            // 🔑 调用统一的切换命令
            const newState = await TauriAPI.toggleLockState();
            console.log('✅ 固定位置状态已切换:', newState);

            // 状态会通过事件自动同步，这里只显示 Toast
            const message = newState ? '窗口位置已固定' : '窗口位置已解锁';
            if (window.Toast) {
                Toast.info(message);
            }
        } catch (err) {
            console.error('切换固定位置失败:', err);
            if (window.Toast) {
                Toast.error('操作失败: ' + err);
            }
        }

        // 隐藏菜单
        contextMenu.classList.remove('show');
    });

    // 点击桌面固定菜单项
    desktopPinMenuItem.addEventListener('click', async () => {
        try {
            // 🔑 调用统一的切换命令
            const newState = await TauriAPI.toggleDesktopPin();
            console.log('✅ 桌面固定状态已切换:', newState);

            // 显示提示
            if (window.Toast) {
                if (newState) {
                    Toast.success('已固定到桌面层（图标下方）');
                } else {
                    Toast.info('已恢复为正常窗口');
                }
            }
        } catch (err) {
            console.error('桌面固定操作失败:', err);
            if (window.Toast) {
                Toast.error('操作失败: ' + err);
            }
        }

        // 隐藏菜单
        contextMenu.classList.remove('show');
    });

    // 点击页面其他地方隐藏菜单
    document.addEventListener('click', (e) => {
        if (!contextMenu.contains(e.target)) {
            contextMenu.classList.remove('show');
        }
    });

    // 右键点击其他地方也隐藏菜单
    document.addEventListener('contextmenu', (e) => {
        if (!navbar.contains(e.target)) {
            contextMenu.classList.remove('show');
        }
    });
}

// 设置事件监听器，监听后端状态变化
function setupEventListeners() {
    if (!window.__TAURI__?.event) {
        console.warn('Tauri event API 未加载');
        return;
    }

    // 监听锁定位置状态变化事件（来自托盘菜单操作）
    window.__TAURI__.event.listen('lock-state-changed', (event) => {
        const newLockState = event.payload;
        console.log('📡 收到锁定状态变化事件:', newLockState);

        // 同步前端状态
        isWindowLocked = newLockState;
        updateNavbarCursor();

        // 显示提示
        const message = newLockState ? '窗口位置已固定' : '窗口位置已解锁';
        if (window.Toast) {
            Toast.info(message);
        }
    });

    console.log('✅ 事件监听器已设置');
}

// 打开外部链接
async function openExternalLink(url) {
    try {
        if (TauriAPI && TauriAPI.openExternalUrl) {
            // 使用统一的 API（桌面版和 Web 版都支持）
            await TauriAPI.openExternalUrl(url);
        } else {
            // 降级处理：直接使用 window.open
            window.open(url, '_blank');
        }
    } catch (err) {
        console.error('打开链接失败:', err);
        // 如果 API 调用失败，降级使用 window.open
        window.open(url, '_blank');
    }
}

// 启动时自动同步 OneDrive 最新数据
// 启动时同步数据（假设已经显示了遮罩）
async function performStartupSync() {
    const overlay = document.getElementById('sync-freeze-overlay');
    const subtextEl = overlay ? overlay.querySelector('.sync-freeze-subtext') : null;
    const cancelBtn = document.getElementById('sync-cancel-btn');

    // 检查是否已登录 OneDrive
    let isLoggedIn = false;
    try {
        isLoggedIn = await TauriAPI.isOneDriveLoggedIn();
    } catch (e) {
        console.warn('检查 OneDrive 登录状态失败:', e);
        if (overlay) overlay.style.display = 'none';
        if (typeof Toast !== 'undefined') {
            Toast.info('OneDrive 未登录，使用本地数据');
        }
        return;
    }

    if (!isLoggedIn) {
        if (overlay) overlay.style.display = 'none';
        if (typeof Toast !== 'undefined') {
            Toast.info('OneDrive 未登录，使用本地数据');
        }
        return;
    }

    // 用于标记是否取消同步
    let syncCancelled = false;

    // 绑定取消按钮事件
    const cancelHandler = () => {
        syncCancelled = true;
        if (overlay) overlay.style.display = 'none';
        if (typeof Toast !== 'undefined') {
            Toast.info('已取消同步，使用本地数据');
        }
    };
    if (cancelBtn) {
        cancelBtn.addEventListener('click', cancelHandler);
    }

    const MAX_RETRIES = 3;
    let success = false;
    let hasData = false;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        // 检查是否已取消
        if (syncCancelled) {
            if (cancelBtn) cancelBtn.removeEventListener('click', cancelHandler);
            return;
        }

        try {
            if (subtextEl) subtextEl.textContent = `正在获取备份列表...（第 ${attempt} 次尝试）`;

            // 1. 获取备份列表
            const backups = await TauriAPI.listOneDriveBackups();

            // 检查是否在获取列表后取消
            if (syncCancelled) {
                if (cancelBtn) cancelBtn.removeEventListener('click', cancelHandler);
                return;
            }

            if (!backups || backups.length === 0) {
                success = true; // 无备份不算失败
                break;
            }

            // 2. 按时间排序，获取最新的备份
            const sorted = backups.sort((a, b) => {
                const dateA = new Date(a.createdDateTime || a.created_date_time);
                const dateB = new Date(b.createdDateTime || b.created_date_time);
                return dateB - dateA; // 降序：最新的在前
            });

            const latest = sorted[0];
            if (subtextEl) subtextEl.textContent = `正在下载: ${latest.name}`;

            // 检查是否在下载前取消
            if (syncCancelled) {
                if (cancelBtn) cancelBtn.removeEventListener('click', cancelHandler);
                return;
            }

            // 3. 下载最新备份
            const jsonData = await TauriAPI.downloadBackupFromOneDrive(latest.id);
            const data = JSON.parse(jsonData);

            // 检查是否在下载后取消
            if (syncCancelled) {
                if (cancelBtn) cancelBtn.removeEventListener('click', cancelHandler);
                return;
            }

            if (subtextEl) subtextEl.textContent = '正在导入数据...';

            // 4. 导入数据
            await TauriAPI.importData(data);

            // 检查是否在导入后取消
            if (syncCancelled) {
                if (cancelBtn) cancelBtn.removeEventListener('click', cancelHandler);
                return;
            }

            // 5. 等待页面初始化完成后再刷新，避免竞态条件
            if (subtextEl) subtextEl.textContent = '正在刷新页面...';
            await initReadyPromise;
            await HomePage.load();
            await InputPage.load();
            await Calendar.render();

            success = true;
            hasData = true;
            break;
        } catch (error) {
            console.error(`启动同步第 ${attempt} 次尝试失败:`, error);

            // 检查是否在错误处理时取消
            if (syncCancelled) {
                if (cancelBtn) cancelBtn.removeEventListener('click', cancelHandler);
                return;
            }

            if (attempt < MAX_RETRIES) {
                if (subtextEl) subtextEl.textContent = `同步失败，正在重试...（${attempt}/${MAX_RETRIES}）`;
                await new Promise(r => setTimeout(r, 1000)); // 等1秒再重试
            }
        }
    }

    // 移除取消按钮事件监听器
    if (cancelBtn) {
        cancelBtn.removeEventListener('click', cancelHandler);
    }

    // 隐藏冻结遮罩
    if (overlay) overlay.style.display = 'none';

    if (!success) {
        // 三次失败：红色 toast 提示，5秒后消失
        if (typeof Toast !== 'undefined') {
            Toast.error('网络连接错误，请重试...');
        }
    } else if (hasData) {
        if (typeof Toast !== 'undefined') {
            Toast.success('已同步最新云端数据');
        }
    }
}
