// 页面导航管理
const Navigation = {
    init() {
        const navButtons = document.querySelectorAll('.nav-btn');
        const pages = document.querySelectorAll('.page');

        navButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetPage = btn.dataset.page;

                // 移除所有激活状态
                navButtons.forEach(b => b.classList.remove('active'));
                pages.forEach(p => p.classList.remove('active'));

                // 激活目标页面
                btn.classList.add('active');
                const page = document.getElementById(`${targetPage}-page`);
                page.classList.add('active');

                // 加载页面内容
                this.loadPage(targetPage);
            });
        });
    },

    loadPage(pageName) {
        switch (pageName) {
            case 'home':
                // 如果标记需要刷新，则刷新主页
                if (AppState.homePageNeedsRefresh) {
                    HomePage.load();
                    AppState.homePageNeedsRefresh = false;
                }
                break;
            case 'input':
                InputPage.load();
                break;
            case 'settings':
                SettingsPage.load();
                break;
        }
    }
};
