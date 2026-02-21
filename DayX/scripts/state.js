// 全局状态管理
const AppState = {
    currentDayNumber: null,
    currentDate: new Date().toISOString().split('T')[0],
    displayOffsets: [0, 1, 2, 5, 7, 14, 30], // 默认显示配置
    columnsPerRow: 7, // 默认每行显示7列
    syncOnStartup: false, // 开启时同步最新数据
    calendarYear: new Date().getFullYear(),
    calendarMonth: new Date().getMonth(), // 0-11
    datesWithWordCounts: new Map(), // 存储有单词记录的日期及其词条数量 {date: count}
    yearOverviewYear: new Date().getFullYear(), // 年度总览的年份
    monthlyWordCounts: new Map(), // 存储每个月的词条数量 {YYYY-MM: count}
    homePageNeedsRefresh: false, // 标记主页是否需要刷新

    // 加载保存的设置
    loadSettings() {
        const saved = localStorage.getItem('displayOffsets');
        if (saved) {
            try {
                this.displayOffsets = JSON.parse(saved);
            } catch (error) {
                console.error('加载设置失败:', error);
            }
        }

        const savedColumns = localStorage.getItem('columnsPerRow');
        if (savedColumns) {
            try {
                this.columnsPerRow = parseInt(savedColumns);
                if (isNaN(this.columnsPerRow) || this.columnsPerRow < 1) {
                    this.columnsPerRow = 7; // 恢复默认值
                }
            } catch (error) {
                console.error('加载列数设置失败:', error);
            }
        }

        const savedSyncOnStartup = localStorage.getItem('syncOnStartup');
        if (savedSyncOnStartup !== null) {
            this.syncOnStartup = savedSyncOnStartup === 'true';
        }
    },

    // 保存设置
    saveSettings() {
        localStorage.setItem('displayOffsets', JSON.stringify(this.displayOffsets));
        localStorage.setItem('columnsPerRow', this.columnsPerRow.toString());
        localStorage.setItem('syncOnStartup', this.syncOnStartup.toString());
    }
};
