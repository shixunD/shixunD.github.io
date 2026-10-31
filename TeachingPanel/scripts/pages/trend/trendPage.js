// trendPage.js —— 导航栏「🗂️ 其它」页：默认就是「🗂️ 其他情况」（学情记录）
// 全局命名空间：window.TrendPage
// 顶部选择器里的作业/背诵/考试趋势是跳转按钮：会转到对应的作业/背诵/考试页下的「📈 学生趋势」标签（StudentTrend.open）。

(function () {
    'use strict';

    function render() {
        const el = document.getElementById('trend-page-body');
        if (!el) return;
        el.innerHTML = `
            <div class="page-head"><h1>其他情况</h1></div>
            <div id="trend-view"></div>
        `;
        const view = el.querySelector('#trend-view');
        OtherRecords.render(view);
    }

    window.TrendPage = { render };
})();
