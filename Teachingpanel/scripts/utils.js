// utils.js —— 无依赖的通用工具：HTML 转义、id 生成、日期处理、学号排序
// 全局命名空间：window.Utils

(function () {
    'use strict';

    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function uid(prefix) {
        return `${prefix || 'id'}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    }

    function pad(n) { return String(n).padStart(2, '0'); }

    // 所有日期统一存本地时区的 'YYYY-MM-DD' 字符串：字符串比较即可排序，导出 JSON 也直观可读。
    // 不要用 toISOString().slice(0,10)——那是 UTC 日期，北京时间早上 8 点前会得到"昨天"。
    function toDateStr(date) {
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    function parseDate(str) {
        const [y, m, d] = String(str).split('-').map(Number);
        return new Date(y, (m || 1) - 1, d || 1);
    }

    function today() { return toDateStr(new Date()); }

    function addDays(dateStr, n) {
        const d = parseDate(dateStr);
        d.setDate(d.getDate() + n);
        return toDateStr(d);
    }

    function diffDays(a, b) {
        return Math.round((parseDate(b) - parseDate(a)) / 86400000);
    }

    const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

    function weekdayName(dateStr) {
        return `星期${WEEKDAYS[parseDate(dateStr).getDay()]}`;
    }

    // 界面上所有日期统一显示为 '10-29(星期四)'（用户要求：日期后面一律括号标注星期几）
    function formatDate(dateStr) {
        if (!dateStr) return '';
        const d = parseDate(dateStr);
        return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}(${weekdayName(dateStr)})`;
    }

    // 本周 / 下周从周一开始的 count 天（默认 5 = 周一到周五，7 = 整周）：offsetWeeks=0 本周，1 下周
    function weekdaysOf(offsetWeeks, fromDate, count) {
        const base = fromDate || today();
        const monday = addDays(base, -((parseDate(base).getDay() + 6) % 7) + 7 * (offsetWeeks || 0));
        return Array.from({ length: count || 5 }, (_, i) => addDays(monday, i));
    }

    // 相对今天的友好描述：今天/明天/昨天/3 天后/2 天前
    function relativeDay(dateStr) {
        const n = diffDays(today(), dateStr);
        if (n === 0) return '今天';
        if (n === 1) return '明天';
        if (n === 2) return '后天';
        if (n === -1) return '昨天';
        return n > 0 ? `${n} 天后` : `${-n} 天前`;
    }

    // 生成 "年-月-日--时-分-秒" 格式的文件名（不含扩展名），本地导出与 OneDrive 上传共用
    function timestampName(date = new Date()) {
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
            `--${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
    }

    // 学号排序：纯数字按数值比较，混合字符串用 numeric collation；没填学号的排最后
    function compareStudentNo(a, b) {
        const na = (a.studentNo || '').trim();
        const nb = (b.studentNo || '').trim();
        if (!na && !nb) return a.name.localeCompare(b.name, 'zh-CN');
        if (!na) return 1;
        if (!nb) return -1;
        const cmp = na.localeCompare(nb, 'zh-CN', { numeric: true });
        return cmp !== 0 ? cmp : a.name.localeCompare(b.name, 'zh-CN');
    }

    function formatNumber(n, digits) {
        if (n == null || Number.isNaN(n)) return '-';
        const d = digits == null ? 1 : digits;
        return String(Math.round(n * Math.pow(10, d)) / Math.pow(10, d));
    }

    function percent(part, total) {
        if (!total) return '-';
        return `${Math.round((part / total) * 100)}%`;
    }

    // 触发浏览器下载；data 可以是字符串或二进制（Uint8Array，如 .db 数据库文件）
    function downloadText(filename, data, mime) {
        const blob = new Blob([data], { type: mime || 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // localStorage 只放"每个浏览器自己的界面偏好"（如上次打开的子标签），读写都可能抛错（隐私模式），一律兜底
    function lsGet(key, fallback) {
        try {
            const v = localStorage.getItem(key);
            return v == null ? fallback : v;
        } catch (e) { return fallback; }
    }
    function lsSet(key, value) {
        try { localStorage.setItem(key, value); } catch (e) { /* 忽略 */ }
    }

    window.Utils = {
        escapeHtml, uid, toDateStr, parseDate, today, addDays, diffDays,
        formatDate, weekdayName, weekdaysOf, relativeDay, timestampName, compareStudentNo, formatNumber, percent,
        downloadText, lsGet, lsSet
    };
})();
