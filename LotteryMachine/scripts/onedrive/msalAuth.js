// msalAuth.js —— OneDrive 登录/登出/静默取 token（MSAL.js v2 PublicClientApplication）
// 独立的 Azure App 注册，与 DayX 项目完全隔离（各自的 Client ID、各自的 OneDrive AppFolder）
// 全局命名空间：window.MsalAuth

(function () {
    'use strict';

    const MSAL_CLIENT_ID = '77561bbd-07f6-4c50-a498-39b8bafdfcdd';
    const MSAL_SCOPES = ['Files.ReadWrite.AppFolder'];

    const MSAL_CDN_URLS = [
        'https://alcdn.msauth.net/browser/2.38.3/js/msal-browser.min.js',
        'https://cdn.jsdelivr.net/npm/@azure/msal-browser@2.38.3/lib/msal-browser.min.js'
    ];

    let msalInstance = null;
    let initPromise = null;

    function buildConfig() {
        const redirectUri = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
            ? window.location.origin + '/'
            : (window.location.origin + window.location.pathname).replace(/[^/]*$/, '');
        return {
            auth: {
                clientId: MSAL_CLIENT_ID,
                authority: 'https://login.microsoftonline.com/consumers',
                redirectUri,
                navigateToLoginRequestUrl: false
            },
            cache: {
                cacheLocation: 'localStorage',
                storeAuthStateInCookie: false
            }
        };
    }

    function loadScript(url) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = url;
            s.crossOrigin = 'anonymous';
            s.onload = () => resolve();
            s.onerror = () => { s.remove(); reject(new Error(url)); };
            document.head.appendChild(s);
        });
    }

    async function loadMsalScript() {
        if (typeof msal !== 'undefined') return;
        for (const url of MSAL_CDN_URLS) {
            try {
                await loadScript(url);
                return;
            } catch (e) { /* 尝试下一个源 */ }
        }
        throw new Error('MSAL 脚本加载失败，请检查网络连接');
    }

    function init() {
        if (initPromise) return initPromise;
        initPromise = (async () => {
            try {
                await loadMsalScript();
                const instance = new msal.PublicClientApplication(buildConfig());
                await instance.handleRedirectPromise();
                msalInstance = instance;
                return instance;
            } catch (e) {
                console.warn('[MsalAuth] 初始化失败:', e.message);
                return null;
            }
        })();
        return initPromise;
    }

    async function getInstance() {
        return init();
    }

    function isMobileDevice() {
        return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    }

    // 登录：返回 { account } 或抛出错误（'user_cancelled' 等）
    async function login() {
        const instance = await getInstance();
        if (!instance) throw new Error('MSAL 未初始化，无法登录');

        if (isMobileDevice()) {
            await instance.loginRedirect({ scopes: MSAL_SCOPES, prompt: 'select_account' });
            return null; // 整页跳转，不会执行到这里
        }

        try {
            const response = await instance.loginPopup({ scopes: MSAL_SCOPES, prompt: 'select_account' });
            return response;
        } catch (err) {
            if (err.errorCode === 'user_cancelled') throw new Error('user_cancelled');
            throw err;
        }
    }

    async function logout() {
        const instance = await getInstance();
        if (!instance) return;
        const account = instance.getAllAccounts()[0];
        try {
            await instance.logoutPopup({ account, mainWindowRedirectUri: window.location.href });
        } catch (e) {
            // popup 登出失败时，至少清掉本地缓存账户
            if (account) instance.setActiveAccount(null);
        }
    }

    function getAccount() {
        if (!msalInstance) return null;
        return msalInstance.getAllAccounts()[0] || null;
    }

    // 静默获取 access token；SSO 会话过期时抛出需要交互登录的错误
    async function getAccessToken() {
        const instance = await getInstance();
        if (!instance) throw new Error('MSAL 未初始化');
        const account = instance.getAllAccounts()[0];
        if (!account) throw new Error('not_logged_in');

        try {
            const response = await instance.acquireTokenSilent({ scopes: MSAL_SCOPES, account });
            return response.accessToken;
        } catch (silentErr) {
            const response = await instance.acquireTokenPopup({ scopes: MSAL_SCOPES, account });
            return response.accessToken;
        }
    }

    window.MsalAuth = { init, login, logout, getAccount, getAccessToken };
})();
