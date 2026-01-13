// 主应用入口
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DayX 应用初始化...');

    // 0. 检查是否是 Web 版本的 OAuth 回调（仅 Web 版本）
    if (typeof TauriAPI !== 'undefined' && TauriAPI.isWebBuild) {
        // 请求持久化存储权限（防止 IndexedDB 被清理）
        if (TauriAPI.requestPersistentStorage) {
            await TauriAPI.requestPersistentStorage();
        }
        await handleWebOAuthCallback();
    }

    // 1. 加载设置
    AppState.loadSettings();

    // 2. 初始化导航
    Navigation.init();

    // 3. 初始化各个页面
    await HomePage.init();
    InputPage.init();
    SettingsPage.init();

    // 4. 初始化组件
    Calendar.init();
    YearOverview.init();

    // 5. 初始化窗口拖动功能
    initWindowDrag();

    // 6. 初始化导航栏右键菜单
    await initNavbarContextMenu();

    // 7. 监听后端状态变化事件
    setupEventListeners();

    console.log('DayX 应用初始化完成！');
});

// Web 版本 OAuth 回调处理
async function handleWebOAuthCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');

    if (!code || !state) return; // 不是 OAuth 回调

    console.log('检测到 OAuth 回调参数，处理中...');

    try {
        // 获取保存的 PKCE 数据
        const pkceKey = TauriAPI._oneDriveConfig?.pkceKey || 'onedrive_pkce_web';
        const pkceData = localStorage.getItem(pkceKey);

        if (!pkceData) {
            console.error('未找到 PKCE 数据');
            return;
        }

        const { codeVerifier, state: savedState } = JSON.parse(pkceData);

        if (state !== savedState) {
            console.error('State 不匹配');
            return;
        }

        // 使用授权码换取 token
        await TauriAPI.waitForOAuthCallback(savedState);
        console.log('✅ OAuth 登录成功');

        // 显示成功提示
        setTimeout(() => {
            if (typeof Toast !== 'undefined') {
                Toast.success('OneDrive 登录成功！');
            }

            // 刷新设置页面的 OneDrive 状态
            if (typeof SettingsPage !== 'undefined' && SettingsPage.checkOneDriveStatus) {
                SettingsPage.checkOneDriveStatus();
            }
        }, 500);
    } catch (error) {
        console.error('OAuth 回调处理失败:', error);
    }
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

    // Web 版本不支持窗口拖动
    if (TauriAPI.isWebBuild) {
        navbar.style.cursor = 'default';
        return;
    }

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

    // 为 navbar 添加用户选择禁用，避免拖动时选中文字
    navbar.style.userSelect = 'none';
    navbar.style.webkitUserSelect = 'none';
    navbar.style.webkitAppRegion = 'no-drag'; // 重要：防止默认拖动行为

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
function openExternalLink(url) {
    if (TauriAPI && TauriAPI.openExternalUrl) {
        // 桌面版本使用 Tauri API
        TauriAPI.openExternalUrl(url).catch(err => {
            console.error('打开链接失败:', err);
        });
    } else {
        // Web 版本使用原生 window.open
        window.open(url, '_blank');
    }
}
