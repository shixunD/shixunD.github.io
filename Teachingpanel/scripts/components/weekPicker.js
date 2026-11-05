// weekPicker.js —— 周选择日历：可前后翻月，点任意一天 = 选中它所在的那一周（周一到周日）
// 全局命名空间：window.WeekPicker
// 用于新建 / 编辑背诵轮次时选择「第几周」。值 = 该周周一的日期 'YYYY-MM-DD'。
//
//   WeekPicker.mondayOf(dateStr)            某天所在周的周一
//   WeekPicker.rangeText(monday)            '11-02(星期一) ~ 11-08(星期日)'
//   WeekPicker.html(key)                    返回 HTML 外壳
//   WeekPicker.bind(root, key, { value, onChange })   绑定，返回 { get(), set(monday) }

(function () {
    'use strict';

    const HEAD = ['一', '二', '三', '四', '五', '六', '日'];

    function mondayOf(dateStr) {
        return Utils.addDays(dateStr, -((Utils.parseDate(dateStr).getDay() + 6) % 7));
    }

    function rangeText(monday) {
        return `${Utils.formatDate(monday)} ~ ${Utils.formatDate(Utils.addDays(monday, 6))}`;
    }

    function html(key) {
        return `<div class="week-picker" data-wp="${Utils.escapeHtml(key)}"></div>`;
    }

    function bind(root, key, opts) {
        const o = opts || {};
        const wrap = root.querySelector(`[data-wp="${key}"]`);
        let value = o.value ? mondayOf(o.value) : mondayOf(Utils.today());
        // 当前显示的月份（该月 1 号）
        let shown = Utils.parseDate(value);
        shown = new Date(shown.getFullYear(), shown.getMonth(), 1);

        function draw() {
            const today = Utils.today();
            const first = Utils.toDateStr ? Utils.toDateStr(shown) : `${shown.getFullYear()}-${String(shown.getMonth() + 1).padStart(2, '0')}-01`;
            const start = mondayOf(first);
            const cells = [];
            for (let i = 0; i < 42; i++) cells.push(Utils.addDays(start, i));
            // 最后一整行都不在本月就不画
            const rows = cells.slice(35).every((d) => Utils.parseDate(d).getMonth() !== shown.getMonth()) ? 5 : 6;
            const days = cells.slice(0, rows * 7);
            wrap.innerHTML = `
                <div class="wp-head">
                    <button type="button" class="btn-secondary btn-sm" data-wp-prev title="上个月">‹</button>
                    <b>${shown.getFullYear()} 年 ${shown.getMonth() + 1} 月</b>
                    <button type="button" class="btn-secondary btn-sm" data-wp-next title="下个月">›</button>
                    <button type="button" class="btn-secondary btn-sm" data-wp-today>回到本周</button>
                </div>
                <div class="wp-grid">
                    ${HEAD.map((h) => `<span class="wp-dow">${h}</span>`).join('')}
                    ${days.map((d) => {
                        const inMonth = Utils.parseDate(d).getMonth() === shown.getMonth();
                        const sel = mondayOf(d) === value;
                        return `<button type="button" class="wp-day ${inMonth ? '' : 'out'} ${sel ? 'sel' : ''} ${d === today ? 'is-today' : ''}" data-wp-day="${d}">${Utils.parseDate(d).getDate()}</button>`;
                    }).join('')}
                </div>
                <div class="hint wp-picked">已选：${rangeText(value)}${value === mondayOf(today) ? '（本周）' : ''}</div>`;
            wrap.querySelector('[data-wp-prev]').addEventListener('click', () => { shown = new Date(shown.getFullYear(), shown.getMonth() - 1, 1); draw(); });
            wrap.querySelector('[data-wp-next]').addEventListener('click', () => { shown = new Date(shown.getFullYear(), shown.getMonth() + 1, 1); draw(); });
            wrap.querySelector('[data-wp-today]').addEventListener('click', () => pick(today));
            wrap.querySelectorAll('[data-wp-day]').forEach((b) => b.addEventListener('click', () => pick(b.dataset.wpDay)));
        }

        function pick(dateStr) {
            value = mondayOf(dateStr);
            const d = Utils.parseDate(dateStr);
            shown = new Date(d.getFullYear(), d.getMonth(), 1);
            draw();
            if (o.onChange) o.onChange(value);
        }

        draw();
        return {
            get: () => value,
            set: (v) => { value = mondayOf(v); const d = Utils.parseDate(value); shown = new Date(d.getFullYear(), d.getMonth(), 1); draw(); }
        };
    }

    window.WeekPicker = { mondayOf, rangeText, html, bind };
})();
