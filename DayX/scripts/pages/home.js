// 主页面逻辑
const HomePage = {
    // 存储当前卡片的 Day 数据，用于右键菜单操作
    currentCardDayData: null,

    async init() {
        await this.load();
    },

    async load() {
        const reviewGrid = document.getElementById('review-grid');
        reviewGrid.innerHTML = '<div class="empty-message">加载中...</div>';

        try {
            const dayRecords = await TauriAPI.getDaysByOffset(AppState.displayOffsets);

            reviewGrid.innerHTML = '';

            // 动态设置网格列数
            const actualColumns = Math.min(AppState.displayOffsets.length, AppState.columnsPerRow);
            reviewGrid.style.gridTemplateColumns = `repeat(${actualColumns}, 1fr)`;

            // 如果实际列数少于设置的列数，添加空占位符
            const emptySlots = AppState.columnsPerRow - actualColumns;

            if (dayRecords.every(record => record === null)) {
                reviewGrid.innerHTML = '<div class="empty-message">还没有任何词汇记录<br>请前往"录入"页面开始添加</div>';
                return;
            }

            for (let i = 0; i < AppState.displayOffsets.length; i++) {
                const offset = AppState.displayOffsets[i];
                const dayData = dayRecords[i];

                const card = document.createElement('div');
                card.className = 'review-card';

                // 生成时间描述：今日、(-xD)
                const timeLabel = offset === 0 ? '今日' : `-${offset}D`;

                if (dayData === null) {
                    card.innerHTML = `
                        <div class="review-card-header">
                            <div class="day-title">${timeLabel}</div>
                            <div class="day-date">无数据</div>
                        </div>
                        <div class="review-card-body">
                            <div class="empty-message">暂无词汇</div>
                        </div>
                    `;
                } else {
                    // 创建卡片头部
                    const header = document.createElement('div');
                    header.className = 'review-card-header';

                    const leftSection = document.createElement('div');
                    leftSection.className = 'header-left';
                    leftSection.innerHTML = `
                        <div class="day-title">Day${dayData.day_number} (${timeLabel})</div>
                        <div class="day-date">${dayData.date} ${dayData.weekday}</div>
                    `;

                    const rightSection = document.createElement('div');
                    rightSection.className = 'header-right';
                    rightSection.innerHTML = `
                        <div class="review-count">已复习: ${dayData.review_count || 0} 次</div>
                        <div class="review-count-controls">
                            <button class="count-btn count-btn-minus" data-day-number="${dayData.day_number}">−</button>
                            <button class="count-btn count-btn-plus" data-day-number="${dayData.day_number}">+</button>
                        </div>
                    `;

                    header.appendChild(leftSection);
                    header.appendChild(rightSection);

                    // 添加按钮事件监听
                    const minusBtn = rightSection.querySelector('.count-btn-minus');
                    const plusBtn = rightSection.querySelector('.count-btn-plus');

                    minusBtn.addEventListener('click', async () => {
                        const newCount = Math.max(0, (dayData.review_count || 0) - 1);
                        await this.updateReviewCount(dayData.day_number, newCount);
                        dayData.review_count = newCount;
                    });

                    plusBtn.addEventListener('click', async () => {
                        const newCount = (dayData.review_count || 0) + 1;
                        await this.updateReviewCount(dayData.day_number, newCount);
                        dayData.review_count = newCount;
                    });

                    // 创建卡片体部
                    const body = document.createElement('div');
                    body.className = 'review-card-body';

                    // 为每个单词创建 DOM 元素，这样可以添加事件监听
                    dayData.words.forEach((word, index) => {
                        // 获取单词文本和颜色（兼容老数据）
                        const wordText = typeof word === 'string' ? word : word.text;
                        const wordColor = typeof word === 'string' ? 'grey' : (word.color || 'grey');

                        const wordItem = document.createElement('div');
                        wordItem.className = `word-item-review color-${wordColor}`;
                        wordItem.dataset.dayNumber = dayData.day_number;
                        wordItem.dataset.wordIndex = index;

                        wordItem.innerHTML = `
                            <span class="word-number">${index + 1}</span>
                            <span class="word-text">${wordText}</span>
                        `;

                        // 添加右键菜单事件
                        wordItem.addEventListener('contextmenu', (e) => {
                            e.preventDefault();
                            this.showColorMenu(e, dayData, index);
                        });

                        body.appendChild(wordItem);
                    });

                    card.appendChild(header);
                    card.appendChild(body);
                }

                reviewGrid.appendChild(card);
            }

            // 添加空占位符（如果需要）
            for (let i = 0; i < emptySlots; i++) {
                const placeholder = document.createElement('div');
                placeholder.className = 'review-card-placeholder';
                reviewGrid.appendChild(placeholder);
            }
        } catch (error) {
            console.error('加载主页数据失败:', error);
            reviewGrid.innerHTML = `<div class="empty-message">加载失败: ${error}</div>`;
        }
    },

    // 显示颜色菜单（与录入页面相同的功能）
    showColorMenu(event, dayData, wordIndex) {
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
                this.startEditWord(dayData.day_number, wordIndex);
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
                    this.changeWordColor(dayData.day_number, wordIndex, color.name);
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
    async changeWordColor(dayNumber, wordIndex, color) {
        try {
            await TauriAPI.updateWordColor(dayNumber, wordIndex, color);

            // 更新对应单词项的颜色
            const wordItem = document.querySelector(
                `.word-item-review[data-day-number="${dayNumber}"][data-word-index="${wordIndex}"]`
            );
            if (wordItem) {
                // 移除旧的颜色类
                wordItem.classList.remove('color-grey', 'color-green', 'color-blue', 'color-red');
                // 添加新的颜色类
                wordItem.classList.add(`color-${color}`);
            }

            Toast.success('颜色已更新');
        } catch (error) {
            console.error('更新颜色失败:', error);
            Toast.error(`更新失败: ${error}`);
        }
    },

    // 开始编辑单词
    startEditWord(dayNumber, wordIndex) {
        const wordItem = document.querySelector(
            `.word-item-review[data-day-number="${dayNumber}"][data-word-index="${wordIndex}"]`
        );
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
                    await TauriAPI.updateWordText(dayNumber, wordIndex, newText);
                    Toast.success('单词已更新');
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

    // 更新复习次数
    async updateReviewCount(dayNumber, newCount) {
        try {
            await TauriAPI.updateReviewCount(dayNumber, newCount);

            // 更新UI显示
            const reviewCountElement = document.querySelector(
                `.review-card-header .header-right .review-count`
            );
            const cards = document.querySelectorAll('.review-card');

            // 找到对应的卡片并更新
            cards.forEach(card => {
                const btn = card.querySelector(`[data-day-number="${dayNumber}"]`);
                if (btn) {
                    const countElement = card.querySelector('.review-count');
                    if (countElement) {
                        countElement.textContent = `已复习: ${newCount} 次`;
                    }
                }
            });

            Toast.success('复习次数已更新');
        } catch (error) {
            console.error('更新复习次数失败:', error);
            Toast.error(`更新失败: ${error}`);
        }
    }
};
