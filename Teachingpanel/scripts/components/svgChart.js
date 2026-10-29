// svgChart.js —— 手写 SVG 小图表（折线图 / 柱状图），不引入第三方图表库
// 全局命名空间：window.SvgChart
// 返回 SVG 字符串，宽度 100% 自适应容器（固定 viewBox 坐标系，等比缩放）。
// 颜色一律写进 style 而不是 fill/stroke 属性，这样才能传 var(--primary-color) 这类 CSS 变量

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);
    const W = 640;

    // line({labels, series:[{name, color, values:[number|null], dashed}], yMin, yMax, height, yFormat})
    function line(opts) {
        const { labels = [], series = [], height = 220, yFormat = (v) => Utils.formatNumber(v, 0) } = opts;
        const all = [];
        series.forEach((s) => s.values.forEach((v) => { if (v != null) all.push(v); }));
        if (!labels.length || !all.length) return '<div class="chart-empty">暂无数据</div>';

        let yMin = opts.yMin != null ? opts.yMin : Math.min.apply(null, all);
        let yMax = opts.yMax != null ? opts.yMax : Math.max.apply(null, all);
        if (yMax === yMin) { yMax += 1; yMin -= 1; }

        const pad = { l: 44, r: 16, t: 14, b: 40 };
        const iw = W - pad.l - pad.r;
        const ih = height - pad.t - pad.b;
        const x = (i) => pad.l + (labels.length === 1 ? iw / 2 : (iw * i) / (labels.length - 1));
        const y = (v) => pad.t + ih - ((v - yMin) / (yMax - yMin)) * ih;

        let grid = '';
        for (let k = 0; k <= 4; k++) {
            const v = yMin + ((yMax - yMin) * k) / 4;
            grid += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="chart-grid"/>`;
            grid += `<text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end" class="chart-axis">${esc(yFormat(v))}</text>`;
        }

        // 标签太多时抽稀显示
        const step = Math.ceil(labels.length / 8);
        const xLabels = labels.map((lb, i) => (i % step === 0 || i === labels.length - 1)
            ? `<text x="${x(i)}" y="${height - pad.b + 18}" text-anchor="middle" class="chart-axis">${esc(lb)}</text>` : '').join('');

        const lines = series.map((s) => {
            let d = '';
            let pen = false;
            s.values.forEach((v, i) => {
                if (v == null) { pen = false; return; }
                d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
                pen = true;
            });
            const dots = s.values.map((v, i) => v == null ? '' :
                `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" style="fill:${s.color}"><title>${esc(labels[i])} ${esc(s.name)}: ${esc(yFormat(v))}</title></circle>`).join('');
            return `<path d="${d}" style="fill:none;stroke:${s.color};stroke-width:2.2" ${s.dashed ? 'stroke-dasharray="5 4"' : ''}/>${dots}`;
        }).join('');

        const legend = series.length > 1 ? `<div class="chart-legend">${series.map((s) =>
            `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';

        return `<div class="chart-wrap"><svg viewBox="0 0 ${W} ${height}" class="chart-svg" role="img">${grid}${xLabels}${lines}</svg>${legend}</div>`;
    }

    // bars({labels, values, color, height})
    function bars(opts) {
        const { labels = [], values = [], color = 'var(--primary-color)', height = 200 } = opts;
        if (!values.length) return '<div class="chart-empty">暂无数据</div>';
        const max = Math.max(1, Math.max.apply(null, values));
        const pad = { l: 16, r: 16, t: 20, b: 30 };
        const iw = W - pad.l - pad.r;
        const ih = height - pad.t - pad.b;
        const bw = iw / values.length;
        const rects = values.map((v, i) => {
            const h = (v / max) * ih;
            const x = pad.l + i * bw + bw * 0.15;
            const yTop = pad.t + ih - h;
            return `<rect x="${x}" y="${yTop}" width="${bw * 0.7}" height="${h}" rx="4" style="fill:${color}"><title>${esc(labels[i])}: ${v}</title></rect>
                ${v ? `<text x="${x + bw * 0.35}" y="${yTop - 5}" text-anchor="middle" class="chart-value">${v}</text>` : ''}
                <text x="${x + bw * 0.35}" y="${height - 10}" text-anchor="middle" class="chart-axis">${esc(labels[i])}</text>`;
        }).join('');
        return `<div class="chart-wrap"><svg viewBox="0 0 ${W} ${height}" class="chart-svg" role="img">${rects}</svg></div>`;
    }

    window.SvgChart = { line, bars };
})();
