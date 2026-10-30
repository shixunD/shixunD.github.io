// dayPicker.js —— 日期块选择器：本周 / 下周的日期块一键点选，找不到再用日历框
// 全局命名空间：window.DayPicker
// 用于背诵检查日期（单选）、计划背诵日期（多选）、作业日期（单选）。
// 每个块标注"本周一"+ 具体日期；超出 min/max 范围的块禁用。
//
//   DayPicker.html(key, { count: 7|5, min, max, color, marked })   返回 HTML
//     marked: { 'YYYY-MM-DD': '3人' } —— 这些日期块下方显示一行小字（例如这天已计划几人），不改变颜色
//   DayPicker.bind(root, key, { multi, value, onChange })   绑定事件，返回 { get(), set(v) }
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
        const marked = o.marked || {};
        return `
            <div class="day-picker" data-dp="${esc(key)}" style="--dp-cols:${count};${o.color ? `--dp-color:${o.color};` : ''}">
                ${weeks.map((w) => `
                    <div class="dp-week">
                        <span class="dp-week-label">${w.label}</span>
                        ${w.days.map((d) => `
                            <button type="button" class="dp-day ${d === today ? 'is-today' : ''} ${marked[d] ? 'marked' : ''}" data-dp-day="${d}" ${disabled(d) ? 'disabled' : ''}>
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
            if (!o.multi) { change(d); return; }
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
            set: (v) => { value = o.multi ? (v || []).slice().sort() : v; render(); }
        };
    }

    window.DayPicker = { html, bind };
})();
