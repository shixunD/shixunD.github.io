// 录入页面逻辑
const InputPage = {
    searchTimeout: null,  // 搜索防抖定时器

    init() {
        const addButton = document.getElementById('add-word-btn');
        const wordInput = document.getElementById('word-input');
        const yearOverviewBtn = document.getElementById('year-overview-btn');
        const syncBtn = document.getElementById('sync-onedrive-btn');
        const searchInput = document.getElementById('word-search-input');

        // 添加单词
        addButton.addEventListener('click', () => this.addWord());

        // 回车添加
        wordInput.addEventListener('keypress', async (e) => {
            if (e.key === 'Enter') {
                await this.addWord();
            }
        });

        // 年度总览按钮
        yearOverviewBtn.addEventListener('click', async () => {
            AppState.yearOverviewYear = AppState.calendarYear;
            await YearOverview.show();
        });

        // 同步按钮
        syncBtn.addEventListener('click', () => this.syncToOneDrive());

        // 搜索框事件
        searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));

        this.load();
    },

    async load() {
        const currentDayInfo = document.getElementById('current-day-info');
        const wordsList = document.getElementById('words-list');

        try {
            const dayData = await TauriAPI.getDayByDate(AppState.currentDate);

            if (dayData) {
                AppState.currentDayNumber = dayData.day_number;
                currentDayInfo.textContent = `Day${dayData.day_number} - ${dayData.date} ${dayData.weekday}`;
                this.renderWordsList(dayData.words);
            } else {
                AppState.currentDayNumber = null;
                currentDayInfo.textContent = `${AppState.currentDate} - 暂无记录`;
                wordsList.innerHTML = '<div class="empty-message">今天还没有添加词汇</div>';
            }
        } catch (error) {
            console.error('加载录入页面失败:', error);
            currentDayInfo.textContent = '加载失败';
            wordsList.innerHTML = `<div class="empty-message">加载失败: ${error}</div>`;
        }
    },

    renderWordsList(words) {
        const wordsList = document.getElementById('words-list');

        if (words.length === 0) {
            wordsList.innerHTML = '<div class="empty-message">还没有添加词汇</div>';
            return;
        }

        wordsList.innerHTML = '';

        words.forEach((word, index) => {
            const wordItem = document.createElement('div');
            wordItem.className = 'word-item';
            wordItem.dataset.index = index;

            // 获取单词文本和颜色（兼容老数据）
            const wordText = typeof word === 'string' ? word : word.text;
            const wordColor = typeof word === 'string' ? 'grey' : (word.color || 'grey');

            // 应用背景颜色
            wordItem.classList.add(`color-${wordColor}`);

            wordItem.innerHTML = `
                <div class="word-content">
                    <span class="word-number">${index + 1}</span>
                    <span class="word-text">${wordText}</span>
                </div>
                <div class="word-actions">
                    <button class="btn-delete" data-index="${index}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                        </svg>
                    </button>
                </div>
            `;

            // 删除按钮
            const deleteBtn = wordItem.querySelector('.btn-delete');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // 防止触发选中事件
                this.deleteWord(index);
            });

            // 点击选中/交换事件
            wordItem.addEventListener('click', () => this.handleWordClick(index));

            // 右键菜单事件
            wordItem.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showColorMenu(e, index);
            });

            wordsList.appendChild(wordItem);
        });
    },

    async addWord() {
        const wordInput = document.getElementById('word-input');
        const word = wordInput.value.trim();

        if (!word) {
            Toast.warning('请输入单词');
            return;
        }

        try {
            // 先检查单词是否已存在
            const existingWord = await TauriAPI.findWord(word);

            if (existingWord) {
                // 单词已存在，显示确认对话框
                const [existingDate, existingDayNumber] = existingWord;

                // 格式化日期信息用于展示
                const confirmed = await TauriAPI.ask(
                    `"${word}" 已在 ${existingDate} 收录\n\n请问需要再次收录吗？`,
                    { title: '词汇已存在', type: 'warning' }
                );

                if (!confirmed) {
                    // 用户选择否，取消录入
                    Toast.info('已取消录入');
                    return;
                }
                // 用户选择是，继续录入
            }

            // 计算当前日期的星期
            const weekday = this.getWeekday(AppState.currentDate);
            await TauriAPI.addWordToDate(AppState.currentDate, weekday, word);
            wordInput.value = '';

            // 只刷新当前录入页面，不刷新其他页面
            await this.load();

            // 仅更新日历的徽章数据，不重新渲染整个日历
            await this.updateCalendarBadge(AppState.currentDate);

            // 标记主页需要刷新（当用户切换到主页时再刷新）
            AppState.homePageNeedsRefresh = true;
            Toast.success('添加成功');
        } catch (error) {
            console.error('添加单词失败:', error);
            Toast.error(`添加失败: ${error}`);
        }
    },

    // 根据日期字符串计算星期（格式：Mon, Tue, Wed等）
    getWeekday(dateStr) {
        const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const date = new Date(dateStr + 'T00:00:00'); // 添加时间避免时区问题
        return weekdays[date.getDay()];
    },

    async deleteWord(index) {
        if (!AppState.currentDayNumber) {
            Toast.warning('没有选中的记录');
            return;
        }

        const confirmed = await TauriAPI.confirmDelete(
            '确定要删除这个词条吗？\n（如果这是该天最后一个词条，整个Day将被删除）'
        );

        if (!confirmed) {
            return;
        }

        try {
            await TauriAPI.deleteWord(AppState.currentDayNumber, index);

            // 只刷新当前录入页面
            await this.load();

            // 仅更新日历的徽章数据
            await this.updateCalendarBadge(AppState.currentDate);

            // 标记主页需要刷新
            AppState.homePageNeedsRefresh = true;

            Toast.success('已成功删除');
        } catch (error) {
            console.error('删除单词失败:', error);
            Toast.error(`删除失败: ${error}`);
        }
    },

    // 更新日历指定日期的徽章（局部更新，不重新渲染整个日历）
    async updateCalendarBadge(dateStr) {
        try {
            const dayData = await TauriAPI.getDayByDate(dateStr);
            const wordCount = dayData ? dayData.words.length : 0;

            // 更新缓存
            if (wordCount > 0) {
                AppState.datesWithWordCounts.set(dateStr, wordCount);
            } else {
                AppState.datesWithWordCounts.delete(dateStr);
            }

            // 只更新对应日期单元格的徽章
            const dayElements = document.querySelectorAll('.calendar-day');
            dayElements.forEach(dayElement => {
                if (dayElement.dataset.date === dateStr) {
                    const badge = dayElement.querySelector('.day-badge');
                    if (wordCount > 0) {
                        if (badge) {
                            badge.textContent = wordCount;
                        } else {
                            const newBadge = document.createElement('div');
                            newBadge.className = 'day-badge';
                            newBadge.textContent = wordCount;
                            dayElement.appendChild(newBadge);
                        }
                    } else {
                        if (badge) {
                            badge.remove();
                        }
                    }
                }
            });
        } catch (error) {
            console.error('更新日历徽章失败:', error);
        }
    },

    // 点击选中交换相关
    selectedWordIndex: null,

    async handleWordClick(index) {
        const wordItems = document.querySelectorAll('.word-item');

        // 如果没有选中的单词，设置当前为选中状态
        if (this.selectedWordIndex === null) {
            this.selectedWordIndex = index;
            wordItems[index].classList.add('selected');
            return;
        }

        // 如果点击的是已选中的单词，取消选中
        if (this.selectedWordIndex === index) {
            this.selectedWordIndex = null;
            wordItems[index].classList.remove('selected');
            return;
        }

        // 如果已有选中的单词，将A移动到B的前面
        const firstIndex = this.selectedWordIndex;  // A的位置
        const secondIndex = index;                   // B的位置

        try {
            const dayData = await TauriAPI.getDayByDate(AppState.currentDate);
            const words = [...dayData.words];

            // 将A移动到B的前面
            // 1. 先从原位置删除A
            const [movedWord] = words.splice(firstIndex, 1);

            // 2. 如果A在B的前面，删除A后B的索引需要-1；如果A在B的后面，删除A后B的索引不变
            const targetIndex = firstIndex < secondIndex ? secondIndex - 1 : secondIndex;

            // 3. 将A插入到B的前面
            words.splice(targetIndex, 0, movedWord);

            await TauriAPI.updateWordsOrder(AppState.currentDayNumber, words);

            // 重置选中状态
            this.selectedWordIndex = null;

            // 重新加载列表
            await this.load();

            // 刷新主页
            await HomePage.load();
        } catch (error) {
            console.error('交换单词位置失败:', error);
            Toast.error(`交换失败: ${error}`);
            // 出错时也要重置选中状态
            this.selectedWordIndex = null;
            wordItems.forEach(item => item.classList.remove('selected'));
        }
    },

    // 显示颜色菜单
    showColorMenu(event, wordIndex) {
        // 移除已存在的菜单
        const existingMenu = document.querySelector('.word-color-menu');
        if (existingMenu) {
            existingMenu.remove();
        }

        // 创建菜单
        const menu = document.createElement('div');
        menu.className = 'word-color-menu';

        // 菜单项配置（编辑 + 颜色）
        const menuItems = [];

        // 编辑选项
        const editConfig = {
            type: 'edit',
            html: `
                <svg class="menu-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
                <span class="color-label">编辑</span>
            `,
            handler: () => {
                menu.remove();
                this.startEditWord(wordIndex);
            }
        };
        menuItems.push(editConfig);

        // 颜色选项
        const colors = [
            { name: 'grey', label: '灰色' },
            { name: 'green', label: '绿色' },
            { name: 'blue', label: '蓝色' },
            { name: 'red', label: '红色' }
        ];

        colors.forEach(color => {
            menuItems.push({
                type: 'color',
                html: `
                    <span class="color-preview color-${color.name}"></span>
                    <span class="color-label">${color.label}</span>
                `,
                handler: () => {
                    this.changeWordColor(wordIndex, color.name);
                    menu.remove();
                }
            });
        });

        // 先添加到页面以计算高度
        document.body.appendChild(menu);

        // 检查是否需要向上展开
        const menuHeight = 5 * 40; // 5个选项，每个约40px高度
        const spaceBelow = window.innerHeight - event.clientY;
        const shouldOpenUpward = spaceBelow < menuHeight && event.clientY > menuHeight;

        // 如果需要向上展开，反转菜单项顺序
        if (shouldOpenUpward) {
            menuItems.reverse();
        }

        // 添加菜单项
        menuItems.forEach(item => {
            const itemElement = document.createElement('div');
            itemElement.className = 'color-menu-item';
            itemElement.innerHTML = item.html;
            itemElement.addEventListener('click', item.handler);
            menu.appendChild(itemElement);
        });

        // 定位菜单
        menu.style.left = `${event.pageX}px`;
        if (shouldOpenUpward) {
            // 向上展开：菜单底部对齐点击位置
            menu.style.bottom = `${window.innerHeight - event.pageY}px`;
            menu.style.top = 'auto';
        } else {
            // 向下展开：菜单顶部对齐点击位置
            menu.style.top = `${event.pageY}px`;
            menu.style.bottom = 'auto';
        }

        // 点击其他地方关闭菜单
        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 0);
    },

    // 改变单词颜色
    async changeWordColor(wordIndex, color) {
        if (!AppState.currentDayNumber) {
            Toast.warning('没有选中的记录');
            return;
        }

        try {
            await TauriAPI.updateWordColor(AppState.currentDayNumber, wordIndex, color);
            await this.load();
            Toast.success('颜色已更新');
        } catch (error) {
            console.error('更新颜色失败:', error);
            Toast.error(`更新失败: ${error}`);
        }
    },

    // 开始编辑单词
    startEditWord(wordIndex) {
        if (!AppState.currentDayNumber) {
            Toast.warning('没有选中的记录');
            return;
        }

        const wordItems = document.querySelectorAll('.word-item');
        const wordItem = wordItems[wordIndex];
        if (!wordItem) return;

        const wordTextSpan = wordItem.querySelector('.word-text');
        const originalText = wordTextSpan.textContent;

        // 使单词文本可编辑
        wordTextSpan.contentEditable = 'true';
        wordTextSpan.classList.add('editing');
        wordTextSpan.focus();

        // 选中所有文本
        const range = document.createRange();
        range.selectNodeContents(wordTextSpan);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        // 保存编辑
        const saveEdit = async () => {
            const newText = wordTextSpan.textContent.trim();
            wordTextSpan.contentEditable = 'false';
            wordTextSpan.classList.remove('editing');

            if (newText && newText !== originalText) {
                try {
                    await TauriAPI.updateWordText(AppState.currentDayNumber, wordIndex, newText);
                    Toast.success('单词已更新');
                    // 刷新页面以显示更新后的内容
                    await this.load();
                    // 标记主页需要刷新
                    AppState.homePageNeedsRefresh = true;
                } catch (error) {
                    console.error('更新单词失败:', error);
                    Toast.error(`更新失败: ${error}`);
                    wordTextSpan.textContent = originalText;
                }
            } else {
                wordTextSpan.textContent = originalText;
            }
        };

        // 取消编辑
        const cancelEdit = () => {
            wordTextSpan.contentEditable = 'false';
            wordTextSpan.classList.remove('editing');
            wordTextSpan.textContent = originalText;
        };

        // 键盘事件
        const handleKeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveEdit();
                wordTextSpan.removeEventListener('keydown', handleKeydown);
                wordTextSpan.removeEventListener('blur', handleBlur);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelEdit();
                wordTextSpan.removeEventListener('keydown', handleKeydown);
                wordTextSpan.removeEventListener('blur', handleBlur);
            }
        };

        // 失去焦点事件
        const handleBlur = () => {
            saveEdit();
            wordTextSpan.removeEventListener('keydown', handleKeydown);
            wordTextSpan.removeEventListener('blur', handleBlur);
        };

        wordTextSpan.addEventListener('keydown', handleKeydown);
        wordTextSpan.addEventListener('blur', handleBlur);
    },

    async syncToOneDrive() {
        const syncBtn = document.getElementById('sync-onedrive-btn');

        try {
            // 检查是否已登录
            const isLoggedIn = await TauriAPI.isOneDriveLoggedIn();
            if (!isLoggedIn) {
                const goToSettings = confirm('请先登录 OneDrive。\n\n是否前往设置页面？');
                if (goToSettings) {
                    Navigation.navigateTo('settings-page');
                }
                return;
            }

            // 显示加载状态
            syncBtn.classList.add('syncing');
            syncBtn.disabled = true;

            // 生成文件名
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            const seconds = String(now.getSeconds()).padStart(2, '0');
            const defaultFilename = `${year}-${month}-${day}-${hours}${minutes}${seconds}.json`;

            // 提示用户自定义文件名
            const filename = prompt('请输入备份文件名（不含路径）：', defaultFilename);
            if (!filename) {
                syncBtn.classList.remove('syncing');
                syncBtn.disabled = false;
                return;
            }

            // 确保文件名以 .json 结尾
            const finalFilename = filename.endsWith('.json') ? filename : `${filename}.json`;

            // 导出数据并序列化为 JSON 字符串
            const data = await TauriAPI.exportData();
            const jsonData = JSON.stringify(data, null, 2);

            // 上传到 OneDrive
            await TauriAPI.uploadBackupToOneDrive(finalFilename, jsonData);

            Toast.success(`同步成功！文件名：${finalFilename}`);
        } catch (error) {
            console.error('同步到 OneDrive 失败:', error);
            Toast.error(`同步失败: ${error}`);
        } finally {
            syncBtn.classList.remove('syncing');
            syncBtn.disabled = false;
        }
    },

    // 处理搜索（带防抖）
    handleSearch(query) {
        // 清除之前的定时器
        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
        }

        const resultsContainer = document.getElementById('word-search-results');

        // 如果搜索框为空，清空结果
        if (!query.trim()) {
            resultsContainer.innerHTML = '';
            return;
        }

        // 防抖：300ms 后执行搜索
        this.searchTimeout = setTimeout(async () => {
            await this.performSearch(query.trim());
        }, 300);
    },

    // 执行搜索
    async performSearch(query) {
        const resultsContainer = document.getElementById('word-search-results');

        try {
            const results = await TauriAPI.searchWords(query);

            if (results.length === 0) {
                resultsContainer.innerHTML = '<div class="search-no-results">未找到匹配的单词</div>';
                return;
            }

            // 渲染搜索结果
            resultsContainer.innerHTML = results.map(([word, dates]) => {
                const dateButtons = dates.map(date => {
                    // 格式化日期为 YY.MM.DD
                    const formattedDate = this.formatDateShort(date);
                    return `<button class="search-date-btn" data-date="${date}">${formattedDate}</button>`;
                }).join('');

                return `
                    <div class="search-result-item">
                        <div class="search-result-word">${this.escapeHtml(word)}</div>
                        <div class="search-result-dates">${dateButtons}</div>
                    </div>
                `;
            }).join('');

            // 绑定日期按钮点击事件
            resultsContainer.querySelectorAll('.search-date-btn').forEach(btn => {
                btn.addEventListener('click', () => this.jumpToDate(btn.dataset.date));
            });

        } catch (error) {
            console.error('搜索失败:', error);
            resultsContainer.innerHTML = '<div class="search-no-results">搜索出错</div>';
        }
    },

    // 格式化日期为 YY.MM.DD
    formatDateShort(dateStr) {
        const [year, month, day] = dateStr.split('-');
        return `${year.slice(2)}.${month}.${day}`;
    },

    // 跳转到指定日期
    async jumpToDate(dateStr) {
        // 更新当前日期
        AppState.currentDate = dateStr;

        // 解析日期更新日历视图
        const [year, month] = dateStr.split('-').map(Number);
        AppState.calendarYear = year;
        AppState.calendarMonth = month - 1;  // JavaScript 月份从 0 开始

        // 刷新日历和录入页面
        await Calendar.render();
        await this.load();
    },

    // HTML 转义（防止 XSS）
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};
