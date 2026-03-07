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
    monthlyDuplicateCounts: new Map(), // 存储每个月的重复词条数量 {YYYY-MM: count}
    monthlyDuplicateWords: new Map(), // 存储每个月的重复词详情 {YYYY-MM: Map<word, [dates]>}
    homePageNeedsRefresh: false, // 标记主页是否需要刷新

    // 计算每月重复词条数（非首次添加的词条）
    computeMonthlyDuplicates(allDays) {
        const sorted = [...allDays].sort((a, b) => a.date.localeCompare(b.date));
        const seen = new Map(); // word -> first date
        this.monthlyDuplicateCounts.clear();
        this.monthlyDuplicateWords.clear();

        for (const day of sorted) {
            const yearMonth = day.date.substring(0, 7);
            let dayDuplicates = 0;

            for (const word of day.words) {
                const text = (typeof word === 'string' ? word : word.text).toLowerCase().trim();
                if (seen.has(text)) {
                    dayDuplicates++;
                    // 记录重复词详情
                    if (!this.monthlyDuplicateWords.has(yearMonth)) {
                        this.monthlyDuplicateWords.set(yearMonth, new Map());
                    }
                    const monthMap = this.monthlyDuplicateWords.get(yearMonth);
                    if (!monthMap.has(text)) {
                        monthMap.set(text, [seen.get(text)]); // 首次出现的日期
                    }
                    if (!monthMap.get(text).includes(day.date)) {
                        monthMap.get(text).push(day.date);
                    }
                } else {
                    seen.set(text, day.date);
                }
            }

            if (dayDuplicates > 0) {
                this.monthlyDuplicateCounts.set(yearMonth, (this.monthlyDuplicateCounts.get(yearMonth) || 0) + dayDuplicates);
            }
        }
    },

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

        // syncOnStartup: 桌面版从 Rust 后端加载（通过 loadSyncOnStartupFromBackend）
        // Web 版从 localStorage 加载
        if (typeof TauriAPI !== 'undefined' && TauriAPI.isWebBuild) {
            const savedSyncOnStartup = localStorage.getItem('syncOnStartup');
            if (savedSyncOnStartup !== null) {
                this.syncOnStartup = savedSyncOnStartup === 'true';
            }
        }
    },

    // 从后端加载 syncOnStartup（桌面版专用，异步）
    async loadSyncOnStartupFromBackend() {
        if (typeof TauriAPI !== 'undefined' && !TauriAPI.isWebBuild && TauriAPI.getSyncOnStartup) {
            try {
                this.syncOnStartup = await TauriAPI.getSyncOnStartup();
            } catch (e) {
                console.warn('从后端加载 syncOnStartup 失败:', e);
            }
        }
    },

    // 保存设置
    saveSettings() {
        localStorage.setItem('displayOffsets', JSON.stringify(this.displayOffsets));
        localStorage.setItem('columnsPerRow', this.columnsPerRow.toString());
        // syncOnStartup: Web 版存 localStorage，桌面版存后端
        if (typeof TauriAPI !== 'undefined' && TauriAPI.isWebBuild) {
            localStorage.setItem('syncOnStartup', this.syncOnStartup.toString());
        }
    },

    // 保存 syncOnStartup 到后端（桌面版专用，异步）
    async saveSyncOnStartupToBackend() {
        if (typeof TauriAPI !== 'undefined' && !TauriAPI.isWebBuild && TauriAPI.setSyncOnStartup) {
            try {
                await TauriAPI.setSyncOnStartup(this.syncOnStartup);
            } catch (e) {
                console.warn('保存 syncOnStartup 到后端失败:', e);
            }
        }
    }
};
