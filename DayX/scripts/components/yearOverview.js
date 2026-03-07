// 年度总览组件
const YearOverview = {
    init() {
        const prevYearBtn = document.getElementById('prev-year-btn');
        const nextYearBtn = document.getElementById('next-year-btn');
        const closeYearOverview = document.getElementById('close-year-overview');
        const yearOverviewModal = document.getElementById('year-overview-modal');

        AppState.yearOverviewYear = new Date().getFullYear();

        // 关闭年度总览
        closeYearOverview.addEventListener('click', () => {
            yearOverviewModal.classList.remove('active');
        });

        // 点击模态框背景关闭
        yearOverviewModal.addEventListener('click', (e) => {
            if (e.target === yearOverviewModal) {
                yearOverviewModal.classList.remove('active');
            }
        });

        // 年度总览导航
        prevYearBtn.addEventListener('click', async () => {
            AppState.yearOverviewYear--;
            await this.render();
        });

        nextYearBtn.addEventListener('click', async () => {
            AppState.yearOverviewYear++;
            await this.render();
        });
    },

    async show() {
        const modal = document.getElementById('year-overview-modal');
        modal.classList.add('active');
        await this.render();
    },

    async render() {
        const yearTitle = document.getElementById('year-title');
        const monthsGrid = document.getElementById('months-grid');

        // 获取所有有记录的日期及词条数量
        try {
            const allDays = await TauriAPI.getAllDays();
            AppState.datesWithWordCounts.clear();
            AppState.monthlyWordCounts.clear();

            allDays.forEach(day => {
                AppState.datesWithWordCounts.set(day.date, day.words.length);

                const yearMonth = day.date.substring(0, 7); // YYYY-MM
                const currentCount = AppState.monthlyWordCounts.get(yearMonth) || 0;
                AppState.monthlyWordCounts.set(yearMonth, currentCount + day.words.length);
            });

            // 计算重复词条
            AppState.computeMonthlyDuplicates(allDays);
        } catch (error) {
            console.error('获取日期数据失败:', error);
        }

        // 计算当年总词条和总重复
        let yearTotal = 0;
        let yearDuplicates = 0;
        for (let month = 0; month < 12; month++) {
            const ym = `${AppState.yearOverviewYear}-${String(month + 1).padStart(2, '0')}`;
            yearTotal += AppState.monthlyWordCounts.get(ym) || 0;
            yearDuplicates += AppState.monthlyDuplicateCounts.get(ym) || 0;
        }

        const dupHtml = yearDuplicates > 0 ? `<span class="year-dup-count">(${yearDuplicates}重复)</span>` : '';
        yearTitle.innerHTML = `${AppState.yearOverviewYear}年 <span class="year-total-count">${yearTotal}词条${dupHtml}</span>`;

        // 月份名称
        const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月',
            '七月', '八月', '九月', '十月', '十一月', '十二月'];

        // 清空并重新生成月份卡片
        monthsGrid.innerHTML = '';

        const currentYearMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

        for (let month = 0; month < 12; month++) {
            const yearMonth = `${AppState.yearOverviewYear}-${String(month + 1).padStart(2, '0')}`;
            const count = AppState.monthlyWordCounts.get(yearMonth) || 0;

            const monthCard = document.createElement('div');
            monthCard.className = 'month-card';

            if (count === 0) {
                monthCard.classList.add('empty');
            }

            if (yearMonth === currentYearMonth) {
                monthCard.classList.add('current-month');
            }

            const dupCount = AppState.monthlyDuplicateCounts.get(yearMonth) || 0;
            const monthDupHtml = dupCount > 0 ? `<div class="month-dup">(${dupCount}重复)</div>` : '';

            monthCard.innerHTML = `
                <div class="month-name">${monthNames[month]}</div>
                <div class="month-count">${count}</div>
                <div class="month-label">个词条${monthDupHtml}</div>
            `;

            // 点击月份卡片切换到该月
            monthCard.addEventListener('click', async () => {
                AppState.calendarYear = AppState.yearOverviewYear;
                AppState.calendarMonth = month;
                await Calendar.render();

                // 关闭年度总览
                const modal = document.getElementById('year-overview-modal');
                modal.classList.remove('active');
            });

            monthsGrid.appendChild(monthCard);
        }
    }
};
