// 日历组件
const Calendar = {
    init() {
        const prevMonthBtn = document.getElementById('prev-month-btn');
        const nextMonthBtn = document.getElementById('next-month-btn');

        // 初始化日历
        const today = new Date();
        AppState.calendarYear = today.getFullYear();
        AppState.calendarMonth = today.getMonth();

        // 日历导航按钮
        prevMonthBtn.addEventListener('click', async () => {
            AppState.calendarMonth--;
            if (AppState.calendarMonth < 0) {
                AppState.calendarMonth = 11;
                AppState.calendarYear--;
            }
            await this.render();
        });

        nextMonthBtn.addEventListener('click', async () => {
            AppState.calendarMonth++;
            if (AppState.calendarMonth > 11) {
                AppState.calendarMonth = 0;
                AppState.calendarYear++;
            }
            await this.render();
        });

        this.render();
    },

    async render() {
        const calendarTitle = document.getElementById('calendar-title');
        const calendarGrid = document.getElementById('calendar-grid');

        // 设置标题
        const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月',
            '七月', '八月', '九月', '十月', '十一月', '十二月'];
        calendarTitle.textContent = `${AppState.calendarYear}年 ${monthNames[AppState.calendarMonth]}`;

        // 获取所有有记录的日期及词条数量
        try {
            const dateWordCounts = await TauriAPI.getDatesWithWordCounts();
            AppState.datesWithWordCounts.clear();
            dateWordCounts.forEach(([date, count]) => {
                AppState.datesWithWordCounts.set(date, count);
            });

            // 获取所有日期数据用于计算重复词条
            const allDays = await TauriAPI.getAllDays();
            AppState.computeMonthlyDuplicates(allDays);
        } catch (error) {
            console.error('获取日期记录失败:', error);
            AppState.datesWithWordCounts.clear();
        }

        // 获取当月第一天和最后一天
        const firstDay = new Date(AppState.calendarYear, AppState.calendarMonth, 1);
        const lastDay = new Date(AppState.calendarYear, AppState.calendarMonth + 1, 0);

        // 获取当月第一天是星期几 (0=周日, 1=周一, ..., 6=周六)
        // 转换为：0=周一, 1=周二, ..., 6=周日
        let firstDayOfWeek = firstDay.getDay();
        firstDayOfWeek = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;

        // 获取当月总天数
        const daysInMonth = lastDay.getDate();

        // 获取上个月的最后几天
        const prevMonthLastDay = new Date(AppState.calendarYear, AppState.calendarMonth, 0).getDate();

        // 清空日历
        calendarGrid.innerHTML = '';

        const today = new Date().toISOString().split('T')[0];

        // 计算每周和每月的总数
        let monthTotal = 0;
        let currentWeekTotal = 0;

        // 填充上个月的日期（如果第一天不是星期一）
        for (let i = firstDayOfWeek - 1; i >= 0; i--) {
            const day = prevMonthLastDay - i;
            const prevMonth = AppState.calendarMonth === 0 ? 11 : AppState.calendarMonth - 1;
            const prevYear = AppState.calendarMonth === 0 ? AppState.calendarYear - 1 : AppState.calendarYear;
            const dateStr = this.formatDate(prevYear, prevMonth, day);

            const wordCount = AppState.datesWithWordCounts.get(dateStr) || 0;
            currentWeekTotal += wordCount;

            const dayElement = this.createCalendarDay(day, dateStr, true);
            calendarGrid.appendChild(dayElement);
        }

        // 填充当月的日期
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = this.formatDate(AppState.calendarYear, AppState.calendarMonth, day);
            const wordCount = AppState.datesWithWordCounts.get(dateStr) || 0;
            monthTotal += wordCount;
            currentWeekTotal += wordCount;

            const dayElement = this.createCalendarDay(day, dateStr, false);
            calendarGrid.appendChild(dayElement);

            // 计算当前是星期几（以星期一为第一天）
            const currentDate = new Date(AppState.calendarYear, AppState.calendarMonth, day);
            let currentDayOfWeek = currentDate.getDay();
            currentDayOfWeek = currentDayOfWeek === 0 ? 6 : currentDayOfWeek - 1;

            // 如果是星期日（一周的最后一天），添加周总数
            if (currentDayOfWeek === 6) {
                const weekSummary = this.createWeekSummary(currentWeekTotal);
                calendarGrid.appendChild(weekSummary);
                currentWeekTotal = 0;
            }
        }

        // 获取最后一天是星期几
        let lastDayOfWeek = lastDay.getDay();
        lastDayOfWeek = lastDayOfWeek === 0 ? 6 : lastDayOfWeek - 1;

        // 填充下个月的日期以填满最后一周（如果需要）
        if (lastDayOfWeek !== 6) {
            const remainingDays = 6 - lastDayOfWeek;
            for (let day = 1; day <= remainingDays; day++) {
                const nextMonth = AppState.calendarMonth === 11 ? 0 : AppState.calendarMonth + 1;
                const nextYear = AppState.calendarMonth === 11 ? AppState.calendarYear + 1 : AppState.calendarYear;
                const dateStr = this.formatDate(nextYear, nextMonth, day);

                const wordCount = AppState.datesWithWordCounts.get(dateStr) || 0;
                currentWeekTotal += wordCount;

                const dayElement = this.createCalendarDay(day, dateStr, true);
                calendarGrid.appendChild(dayElement);
            }

            // 添加最后一周的总数
            const weekSummary = this.createWeekSummary(currentWeekTotal);
            calendarGrid.appendChild(weekSummary);
        }

        // 在日历标题下方添加月总数显示
        const yearMonth = `${AppState.calendarYear}-${String(AppState.calendarMonth + 1).padStart(2, '0')}`;
        const monthDuplicates = AppState.monthlyDuplicateCounts.get(yearMonth) || 0;
        this.updateMonthSummary(monthTotal, monthDuplicates);
    },

    createCalendarDay(day, dateStr, isOtherMonth) {
        const dayElement = document.createElement('div');
        dayElement.className = 'calendar-day';
        dayElement.dataset.date = dateStr;

        // 创建日期数字
        const dayNumber = document.createElement('div');
        dayNumber.className = 'day-number';
        dayNumber.textContent = day;
        dayElement.appendChild(dayNumber);

        // 获取该日期的词条数量
        const wordCount = AppState.datesWithWordCounts.get(dateStr) || 0;

        // 如果有词条，显示数量
        if (wordCount > 0) {
            const countBadge = document.createElement('div');
            countBadge.className = 'word-count-badge';
            countBadge.textContent = wordCount;
            dayElement.appendChild(countBadge);
        }

        const today = new Date().toISOString().split('T')[0];

        if (isOtherMonth) {
            dayElement.classList.add('other-month');
        }

        if (dateStr === today) {
            dayElement.classList.add('today');
        }

        if (dateStr === AppState.currentDate) {
            dayElement.classList.add('selected');
        }

        // 点击事件
        dayElement.addEventListener('click', async () => {
            AppState.currentDate = dateStr;

            // 如果点击的是其他月份的日期，切换到那个月
            if (isOtherMonth) {
                const clickedDate = new Date(dateStr);
                AppState.calendarYear = clickedDate.getFullYear();
                AppState.calendarMonth = clickedDate.getMonth();
            }

            await this.render();
            await InputPage.load();
        });

        return dayElement;
    },

    createWeekSummary(total) {
        const summaryElement = document.createElement('div');
        summaryElement.className = 'week-summary';
        summaryElement.innerHTML = `
            <div class="summary-count">${total}</div>
        `;
        return summaryElement;
    },

    updateMonthSummary(total, duplicates) {
        let monthSummary = document.getElementById('month-summary');
        if (!monthSummary) {
            monthSummary = document.createElement('div');
            monthSummary.id = 'month-summary';
            monthSummary.className = 'month-summary';

            const calendarHeader = document.querySelector('.calendar-header');
            calendarHeader.parentNode.insertBefore(monthSummary, calendarHeader.nextSibling);
        }

        const yearMonth = `${AppState.calendarYear}-${String(AppState.calendarMonth + 1).padStart(2, '0')}`;
        const dupHtml = duplicates > 0 ? `<span class="dup-count">(${duplicates}重复)</span>` : '';
        monthSummary.innerHTML = `本月总计: <strong>${total}</strong> 个词条${dupHtml}`;

        // 绑定重复数点击事件
        const dupEl = monthSummary.querySelector('.dup-count');
        if (dupEl) {
            dupEl.addEventListener('click', () => {
                this.showDuplicateWords(yearMonth);
            });
        }
    },

    // 点击重复数显示重复词条到搜索结果区域
    showDuplicateWords(yearMonth) {
        const dupMap = AppState.monthlyDuplicateWords.get(yearMonth);
        if (!dupMap || dupMap.size === 0) return;

        const resultsContainer = document.getElementById('word-search-results');
        const searchInput = document.getElementById('word-search-input');
        if (searchInput) searchInput.value = '';

        const items = [];
        dupMap.forEach((dates, word) => {
            const dateButtons = dates.map(date => {
                const [y, m, d] = date.split('-');
                const short = `${y.slice(2)}.${m}.${d}`;
                return `<button class="search-date-btn" data-date="${date}">${short}</button>`;
            }).join('');
            items.push(`
                <div class="search-result-item">
                    <div class="search-result-word">${word}</div>
                    <div class="search-result-dates">${dateButtons}</div>
                </div>
            `);
        });

        resultsContainer.innerHTML = `<div class="search-dup-header">本月重复词条 (${dupMap.size}个词)</div>` + items.join('');

        resultsContainer.querySelectorAll('.search-date-btn').forEach(btn => {
            btn.addEventListener('click', () => InputPage.jumpToDate(btn.dataset.date));
        });
    },

    formatDate(year, month, day) {
        const m = (month + 1).toString().padStart(2, '0');
        const d = day.toString().padStart(2, '0');
        return `${year}-${m}-${d}`;
    }
};
