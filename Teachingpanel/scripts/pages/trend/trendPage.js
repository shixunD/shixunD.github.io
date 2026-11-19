// trendPage.js —— 导航栏「📈 学生趋势」页：顶部固定的选择器（四块快速定位 + 全班学生小块），
// 下面是作业 / 背诵 / 考试 / 其他情况四块从上到下连成一页（流模式），点上面的按钮滚动定位到对应那块
// 全局命名空间：window.TrendPage

(function () {
    'use strict';

    const SECTIONS = [
        { key: 'homework', render: (el) => HomeworkStudent.render(el) },
        { key: 'recitation', render: (el) => RecitationStudent.render(el) },
        { key: 'exams', render: (el) => ExamStudent.render(el) },
        { key: 'other', render: (el) => OtherRecords.render(el) }
    ];
    let active = null;

    function pageEl() { return document.getElementById('trend-page-body'); }

    // 顶部固定区的高度写进 CSS 变量：章节滚动定位的留白、「其他情况」右栏的吸顶位置和最大高度都靠它。
    //   返回值 = 导航栏 + 选择器的高度，即选择器下沿在窗口里的位置（onScroll 用 getBoundingClientRect 比较，是窗口坐标）
    function measure() {
        const el = pageEl();
        if (!el) return 0;
        const nav = document.querySelector('.navbar');
        const picker = el.querySelector('.trend-picker');
        const navH = nav ? nav.offsetHeight : 0;
        const pickerH = picker ? picker.offsetHeight : 0;
        el.style.setProperty('--nav-h', navH + 'px');
        el.style.setProperty('--picker-h', pickerH + 'px');
        return navH + pickerH;
    }

    function setActive(key) {
        if (key === active) return;
        active = key;
        const el = pageEl();
        if (el) el.querySelectorAll('[data-trend-kind]').forEach((b) => b.classList.toggle('active', b.dataset.trendKind === key));
    }

    function render() {
        const el = pageEl();
        if (!el) return;
        const y = Utils.scrollBox().scrollTop;
        const kinds = StudentTrend.KINDS;
        if (!active || !kinds.some((k) => k.key === active)) active = StudentTrend.lastKind();

        if (!AppState.getStudents().length) {
            el.innerHTML = `<div class="page-head"><h1>学生趋势</h1></div><div class="card">${UI.emptyStudentsHint()}</div>`;
            return;
        }
        el.innerHTML = `
            ${StudentTrend.pickerHtml(active)}
            ${SECTIONS.map((s) => `
                <section class="trend-sec" id="trend-sec-${s.key}" data-sec="${s.key}">
                    <h2 class="trend-sec-title">${kinds.find((k) => k.key === s.key).label}</h2>
                    <div data-sec-body></div>
                </section>`).join('')}
        `;
        SECTIONS.forEach((s) => s.render(el.querySelector(`#trend-sec-${s.key} [data-sec-body]`)));
        StudentTrend.bind(el, render, (key) => scrollTo(key, true));
        measure();
        Utils.scrollBox().scrollTop = y;
    }

    function scrollTo(key, smooth) {
        const sec = document.getElementById('trend-sec-' + key);
        if (!sec) return;
        setActive(key);
        measure();
        sec.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
    }

    // 滚动时，按「最后一个顶边已经滚到固定区下面的那块」更新高亮
    function onScroll() {
        const el = pageEl();
        if (!el || Navigation.getCurrent() !== 'trend') return;
        const secs = [...el.querySelectorAll('.trend-sec')];
        if (!secs.length) return;
        const line = measure() + 24;
        let key = secs[0].dataset.sec;
        secs.forEach((s) => { if (s.getBoundingClientRect().top <= line) key = s.dataset.sec; });
        const box = Utils.scrollBox();
        if (box.clientHeight + box.scrollTop >= box.scrollHeight - 4) key = secs[secs.length - 1].dataset.sec;
        setActive(key);
    }
    Utils.scrollBox().addEventListener('scroll', onScroll, { passive: true });   // 滚动的是内容区，不是窗口
    window.addEventListener('resize', () => { if (Navigation.getCurrent() === 'trend') measure(); });

    window.TrendPage = { render, scrollTo };
})();
