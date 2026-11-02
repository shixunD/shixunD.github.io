// dayPicker.js —— 日期块选择器：本周 / 下周的日期块一键点选，找不到再用日历框
// 全局命名空间：window.DayPicker
// 用于背诵检查日期（单选）、计划背诵日期（多选）、作业日期（单选）。
// 每个块标注"本周一"+ 具体日期；超出 min/max 范围的块禁用。
//
//   DayPicker.html(key, { count: 7|5, min, max, color, marked, dimPast, dimFuture, textColor })   返回 HTML（dimPast / dimFuture：过去 / 今后的日子变灰但仍可点）
//     marked: { 'YYYY-MM-DD': '3人' } —— 这些日期块下方显示一行小字（例如这天已计划几人），不改变颜色
//   DayPicker.bind(root, key, { multi, value, onChange, allowClear })   绑定事件，返回 { get(), set(v), setColor() }
//     allowClear：单选时再点一次已选的日期可以取消选择（值变 null）
//     单选：value/返回值是日期字符串或 null；多选：日期数组（可包含不在块里的日历日期）

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);

    // 块里只写 MM-DD：星期已经在上一行的「本周一」里了
    function dayLabel(d) {
        return esc(Utils.formatDate(d).replace(/\(.*\)$/, ''));
    }

    function html(key, opts) {
        const o = opts || {};
        const count = o.count || 7;
        const weeks = [
            { label: '本周', days: Utils.weekdaysOf(0, null, count) },
            { label: '下周', days: Utils.weekdaysOf(1, null, count) }
        ];
        const today = Utils.today();
        const disabled = (d) => (o.min && d < o.min) || (o.max && d > o.max);
        // dimPast：过去的日子只变灰、仍可点击（用于要回头修改历史数据的页面）
        const past = (d) => o.dimPast && d < today;
        // dimFuture：今后的日子只变灰、仍可点击（登记检查日期用，允许补录/提前登记）
        const future = (d) => o.dimFuture && d > today;
        const marked = o.marked || {};
        return `
            <div class="day-picker" data-dp="${esc(key)}" style="--dp-cols:${count};${o.color ? `--dp-color:${o.color};` : ''}${o.textColor ? `--dp-text:${o.textColor};` : ''}">
                ${weeks.map((w) => `
                    <div class="dp-week">
                        <span class="dp-week-label">${w.label}</span>
                        ${w.days.map((d) => `
                            <button type="button" class="dp-day ${d === today ? 'is-today' : ''} ${marked[d] ? 'marked' : ''} ${past(d) || future(d) ? 'is-past' : ''}" data-dp-day="${d}" ${disabled(d) ? 'disabled' : ''}>
                                <b>${w.label}${Utils.weekdayName(d).slice(-1)}</b>
                                <span>${dayLabel(d)}</span>
                                ${marked[d] ? `<small class="dp-mark">${esc(marked[d])}</small>` : ''}
                            </button>`).join('')}
                    </div>`).join('')}
                <div class="dp-week dp-other">
                    <span class="dp-week-label">其他</span>
                    <input type="date" data-dp-cal ${o.min ? `min="${o.min}"` : ''} ${o.max ? `max="${o.max}"` : ''} title="找不到就在日历里选">
                    <span class="hint" data-dp-picked></span>
                </div>
            </div>`;
    }

    function bind(root, key, opts) {
        const o = opts || {};
        const wrap = root.querySelector(`[data-dp="${key}"]`);
        const cal = wrap.querySelector('[data-dp-cal]');
        const picked = wrap.querySelector('[data-dp-picked]');
        let value = o.multi ? (o.value || []).slice().sort() : (o.value || null);

        function render() {
            const set = new Set(o.multi ? value : [value]);
            wrap.querySelectorAll('[data-dp-day]').forEach((b) => b.classList.toggle('selected', set.has(b.dataset.dpDay)));
            if (!o.multi) picked.textContent = value ? `已选：${Utils.formatDate(value)}（${Utils.relativeDay(value)}）` : '';
        }

        function change(next) {
            value = next;
            render();
            if (o.onChange) o.onChange(o.multi ? value.slice() : value);
        }

        function toggle(d) {
            // allowClear：单选时再点一次已选的日期 = 不选（value 变 null）
            if (!o.multi) { change(o.allowClear && value === d ? null : d); return; }
            change(value.includes(d) ? value.filter((x) => x !== d) : value.concat(d).sort());
        }

        wrap.querySelectorAll('[data-dp-day]').forEach((b) => b.addEventListener('click', () => toggle(b.dataset.dpDay)));
        cal.addEventListener('change', () => {
            if (!cal.value) return;
            if (o.multi) {
                if (!value.includes(cal.value)) change(value.concat(cal.value).sort());
                cal.value = '';
            } else change(cal.value);
        });
        render();

        return {
            get: () => (o.multi ? value.slice() : value),
            set: (v) => { value = o.multi ? (v || []).slice().sort() : v; render(); },
            // 随所属状态换色：color 为选中 / 今天的底色，textColor 为选中块上的文字色；不传 = 恢复默认
            setColor: (color, textColor) => {
                wrap.style.removeProperty('--dp-color');
                wrap.style.removeProperty('--dp-text');
                if (color) wrap.style.setProperty('--dp-color', color);
                if (textColor) wrap.style.setProperty('--dp-text', textColor);
            }
        };
    }

    window.DayPicker = { html, bind };
})();
