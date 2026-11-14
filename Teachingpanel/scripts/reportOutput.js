// reportOutput.js —— 把 ScoreReport.build() 的结果输出成 Markdown / 网页（预览 + 打印成 PDF）/ Excel
// 全局命名空间：window.ReportOutput
//
// PDF 不用 PDF 库：把报表渲染进 #tp-print-root，调浏览器打印，由用户在打印框里选「另存为 PDF」。
//   原因：纯前端生成 PDF 要内嵌几 MB 的中文字体，否则汉字全是空白；打印出来的还是矢量文字。
//   打印样式在 styles/exportReport.css（@media print 时只显示 #tp-print-root）。

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);
    const signed = (n) => ScoreReport.signed(n);
    const ORDER = ScoreReport.STATUS_ORDER;

    // Markdown 里的状态符号（没有粉红色圆形 emoji，粉色用 🩷）
    const EMOJI = { done: '✅', poor_fixed: '🩵', missing_fixed: '💙', poor: '🩷', missing: '🔴' };

    const hwStatus = (k) => HomeworkModel.STATUS_MAP[k] || HomeworkModel.STATUS_MAP.done;
    const recLook = (k) => (k === 'plan' ? RecitationModel.PLAN : (RecitationModel.RESULT_MAP[k] || RecitationModel.NONE));
    const hex = (c) => c.replace('#', '').toUpperCase();
    const hwLabel = (hw) => `${Utils.formatDate(hw.date)} ${hw.title}`;

    // 规则图例：[{ keys: [状态], text }]
    function ruleItems(rp) {
        const r = rp.rules, n = rp.n, items = [];
        if (!n) return items;
        items.push({ keys: ['done'], text: `${n} 项按时完成 ${signed(r.bonusAll)} 分` });
        if (n >= 2) items.push({ keys: ['done'], text: `${n - 1} 项按时完成 ${signed(r.bonusOneOff)} 分` });
        const free = [];
        ['poor', 'missing', 'poor_fixed', 'missing_fixed'].forEach((k) => {
            if (r.penalty[k] > 0) items.push({ keys: [k], text: `${hwStatus(k).label} ${signed(-r.penalty[k])} 分／项` });
            else free.push(k);
        });
        if (free.length) items.push({ keys: free, text: `${free.map((k) => hwStatus(k).label).join('、')} 不扣分` });
        return items;
    }

    function recRuleText(rp) {
        const r = rp.rules;
        return `背诵过关 = 学生卡片底色为绿色：最新一次检查是 提前完成 / 完成过关${r.condPass ? ' / 条件过关' : ''}` +
            (r.planBlocks ? '，且之后没有还未完成的背诵计划' : '') + '；其余判不过关';
    }

    function recScoreText(rp) {
        const r = rp.rules;
        return `背诵加减分：提前完成 ${signed(r.recEarly)}；无计划或只有一次计划且计划当日过关 ${signed(r.recOnPlan)}；` +
            `多个计划日期、或计划当日没过关但最终过关 ${signed(r.recLate)}；最终没过关（计划中 / 重新过关 / 未过关 / 未检查）${signed(-r.recFail)}`;
    }

    function metaLine(rp) {
        const bits = [];
        if (rp.className) bits.push(rp.className);
        if (rp.n) bits.push(`作业 ${rp.n} 项`);
        if (rp.rounds.length) bits.push(`背诵 ${rp.rounds.length} 项`);
        bits.push(`${rp.summary.students} 人`);
        bits.push(`导出于 ${rp.exportedAt}`);
        return bits.join(' · ');
    }

    // 仍未补交 / 未补改：按作业归类（rp.unfixed 是按人的）→ [{ hw, items: [{ student, status }] }]，只保留有人的作业
    function unfixedByHw(rp) {
        return rp.hws.map((hw) => {
            const items = [];
            rp.unfixed.forEach((u) => u.items.forEach((x) => { if (x.hw === hw || x.hw.id === hw.id) items.push({ student: u.student, status: x.status }); }));
            return { hw, items };
        }).filter((g) => g.items.length);
    }

    // ---------- Markdown ----------

    function mdCell(s) { return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' '); }

    function markdown(rp) {
        const L = [];
        L.push(`# ${rp.title}`, '', metaLine(rp), '');
        if (rp.n) {
            L.push('**加减分规则：** ' + ruleItems(rp).map((it) => `${it.keys.map((k) => EMOJI[k]).join('')} ${it.text}`).join(' ｜ '), '');
            L.push('**统计的作业：**', '');
            rp.hws.forEach((hw, i) => L.push(`${i + 1}. ${hwLabel(hw)}`));
            L.push('');
        }
        if (rp.rounds.length) L.push('**背诵判定：** ' + recRuleText(rp), '', '**' + recScoreText(rp) + '**', '');

        const head = ['学号', '学生'];
        const align = ['---:', '---'];
        if (rp.n) { head.push('作业完成情况', '加分', '扣分', '作业得分'); align.push('---', '---:', '---:', '---:'); }
        rp.rounds.forEach((r) => { head.push(`背诵：${mdCell(r.title)}`); align.push(':---:'); });
        if (rp.rounds.length) { head.push('背诵得分'); align.push('---:'); }
        if (rp.rounds.length && rp.n) { head.push('总分'); align.push('---:'); }
        L.push(`| ${head.join(' | ')} |`, `|${align.join('|')}|`);
        rp.rows.forEach((row) => {
            const c = [mdCell(row.student.studentNo), mdCell(row.student.name)];
            if (rp.n) {
                c.push(ORDER.filter((k) => row.counts[k]).map((k) => `${EMOJI[k]}×${row.counts[k]}`).join(' '),
                    signed(row.bonus), signed(-row.penalty), `**${signed(row.final)}**`);
            }
            row.rec.forEach((x) => c.push(signed(x.score)));
            if (rp.rounds.length) c.push(`**${signed(row.recScore)}**`);
            if (rp.rounds.length && rp.n) c.push(`**${signed(row.total)}**`);
            L.push(`| ${c.join(' | ')} |`);
        });
        L.push('');

        const s = rp.summary;
        if (rp.n) {
            L.push(`**汇总：** 全班总分 ${signed(s.total)} ｜ 人均 ${signed(s.avg)} ｜ 全部按时完成 ${s.full} 人${rp.n >= 2 ? ` ｜ 部分按时完成（差一项）${s.oneOff} 人` : ''} ｜ 正分 / 0 / 负分：${s.pos} / ${s.zero} / ${s.neg}`, '');
        }
        s.rec.forEach((x, i) => {
            const names = rp.recFails[i].students.map((st) => st.name).join('、');
            L.push(`**背诵「${x.round.title}」：** 过关 ${x.pass} 人（${Utils.percent(x.pass, s.students)}），未过关 ${x.fail} 人${names ? '：' + names : ''}`, '');
        });
        if (rp.unfixed.length) {
            L.push('**仍未补交 / 未补改：**', '');
            unfixedByHw(rp).forEach((g) => L.push(`- ${hwLabel(g.hw)}：${g.items.map((x) => `${EMOJI[x.status]} ${x.student.name}`).join('、')}`));
            L.push('');
        }
        return L.join('\n');
    }

    // ---------- 网页（预览 / 打印） ----------

    const dot = (k) => `<i class="rp-dot" style="background:${hwStatus(k).color}"></i>`;

    function summaryTable(rp) {
        const sep = (i) => (rp.n && i === 0 ? ' rp-sep' : '');   // 作业得分与背诵之间的细分隔线（只加在表身；表头靠背诵列的深一号绿色区分）
        const recHead = rp.rounds.map((r, i) => `<th class="rp-c rp-rec-h${rp.n ? ' rp-rec-th' : ''}">背诵<small>${esc(r.title)}</small></th>`).join('');
        const recSum = rp.rounds.length ? `<th class="rp-c rp-rec-th">背诵得分</th>${rp.n ? '<th class="rp-c">总分</th>' : ''}` : '';
        const body = rp.rows.map((row) => {
            const cls = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
            const hw = rp.n ? `
                <td class="rp-status">${ORDER.filter((k) => row.counts[k]).map((k) => `<span class="rp-cnt">${dot(k)}×${row.counts[k]}</span>`).join('')}</td>
                <td class="rp-c">${signed(row.bonus)}</td>
                <td class="rp-c">${signed(-row.penalty)}</td>
                <td class="rp-c rp-final ${row.final > 0 ? 'pos' : row.final < 0 ? 'neg' : ''}">${signed(row.final)}</td>` : '';
            const rec = row.rec.map((x, i) => `<td class="rp-c rp-mark ${cls(x.score)}${sep(i)}">${signed(x.score)}</td>`).join('') +
                (rp.rounds.length ? `<td class="rp-c rp-final ${cls(row.recScore)}">${signed(row.recScore)}</td>${rp.n ? `<td class="rp-c rp-final ${cls(row.total)}">${signed(row.total)}</td>` : ''}` : '');
            return `<tr><td class="rp-no">${esc(row.student.studentNo)}</td><td class="rp-name">${esc(row.student.name)}</td>${hw}${rec}</tr>`;
        }).join('');
        return `
            <table class="rp-table">
                <thead><tr>
                    <th class="rp-c">学号</th><th>学生</th>
                    ${rp.n ? '<th>作业完成情况</th><th class="rp-c">加分</th><th class="rp-c">扣分</th><th class="rp-c">作业得分</th>' : ''}
                    ${recHead}${recSum}
                </tr></thead>
                <tbody>${body}</tbody>
            </table>`;
    }

    function detailTable(rp, rows, short) {
        const hwHead = rp.hws.map((hw, i) => `<th class="rp-c" title="${esc(hwLabel(hw))}">${i + 1}</th>`).join('');
        const sep = (i) => (rp.n && i === 0 ? ' rp-sep' : '');   // 作业列与背诵列之间的细分隔线（同上）
        const recHead = rp.rounds.map((r, i) => `<th class="rp-c${rp.n ? ' rp-rec-th' : ''}" title="${esc(r.title)}">背${i + 1}</th>`).join('');
        const body = rows.map((row) => `
            <tr><td class="rp-no">${esc(row.student.studentNo)}</td><td class="rp-name">${esc(row.student.name)}</td>
                ${row.statuses.map((k) => { const s = hwStatus(k); return `<td class="rp-c"><i class="rp-sq" style="background:${s.color}"></i></td>`; }).join('')}
                ${row.rec.map((x, i) => `<td class="rp-c${sep(i)}"><i class="rp-sq" style="background:${recLook(x.look).color}"></i></td>`).join('')}
            </tr>`).join('');
        return `<table class="rp-table rp-detail ${short ? 'rp-half' : ''}"><thead><tr><th class="rp-c">学号</th><th>学生</th>${hwHead}${recHead}</tr></thead><tbody>${body}</tbody></table>`;
    }

    function html(rp) {
        const s = rp.summary;
        // 汇总卡片：作业的几项在前、背诵跟在后面连着排。一行最多 5 格；超过就拆成几行、每行尽量一样多（奇数时上面多一个），
        // 格子等宽所以下面一行自然左对齐。（试过「作业一排、背诵另起一排」：背诵常常只有一两个，上 5 下 1 很不平衡）
        const hwCards = [], recCards = [];
        if (rp.n) {
            hwCards.push({ tag: '作业', label: '全班总分', v: signed(s.total) });
            hwCards.push({ tag: '作业', label: '人均得分', v: signed(s.avg) });
            hwCards.push({ tag: '作业', label: '正分 / 0 / 负分', v: `${s.pos} / ${s.zero} / ${s.neg}` });
            hwCards.push({ tag: '作业', label: `全部按时完成 ${signed(rp.rules.bonusAll)}`, v: s.full, unit: '人' });
            if (rp.n >= 2) hwCards.push({ tag: '作业', label: `部分按时完成 ${signed(rp.rules.bonusOneOff)}`, v: s.oneOff, unit: '人' });
        }
        // 背诵卡片：「背诵 任务名」一行放得下就一行；放不下时任务名换到第二行，再放不下用 … 截断（见 .rp-card-l 的 flex-wrap）
        s.rec.forEach((x) => recCards.push({ tag: '背诵', label: x.round.title, sub: true, v: x.pass, unit: `人过关 · ${Utils.percent(x.pass, s.students)}` }));
        const cards = hwCards.concat(recCards);
        const cardCols = Math.ceil(cards.length / Math.max(1, Math.ceil(cards.length / 5)));
        const cardHtml = (c) => `<div class="rp-card"><div class="rp-card-l"><b class="rp-card-tag${c.sub ? ' rp-card-tag-rec' : ''}">${c.tag}</b><span${c.sub ? ` class="rp-card-sub" title="${esc(c.label)}"` : ''}>${esc(c.label)}</span></div><div class="rp-card-v">${esc(c.v)}<small>${esc(c.unit || '')}</small></div></div>`;

        const rules = ruleItems(rp).map((it) => `<span class="rp-rule">${it.keys.map(dot).join('')}${esc(it.text)}</span>`).join('') +
            (rp.rounds.length ? `<span class="rp-rule" style="white-space:normal">${esc(recScoreText(rp))}</span>` : '');

        // 逐项明细：人多且列不多时拆成左右两半，省纸
        const cols = rp.n + rp.rounds.length;
        const sorted = rp.rows.slice().sort((a, b) => Utils.compareStudentNo(a.student, b.student));
        const split = sorted.length > 24 && cols <= 9;
        const half = Math.ceil(sorted.length / 2);
        const detail = split
            ? `<div class="rp-two">${detailTable(rp, sorted.slice(0, half), true)}${detailTable(rp, sorted.slice(half), true)}</div>`
            : detailTable(rp, sorted, false);

        const hwLegend = rp.n ? HomeworkModel.STATUSES.map((st) => `<span class="rp-rule"><i class="rp-sq" style="background:${st.color}"></i>${esc(st.label)}</span>`).join('') : '';
        const recLegend = rp.rounds.length ? RecitationModel.RESULTS.concat([RecitationModel.PLAN, RecitationModel.NONE]).map((st) => {
            return `<span class="rp-rule"><i class="rp-sq" style="background:${st.color}"></i>${esc(st.label)}</span>`;
        }).join('') : '';

        let sec = 0;
        const h = (t) => `<h2 class="rp-h2">${['一', '二', '三', '四', '五', '六'][sec++]}、${esc(t)}</h2>`;

        return `
            <div class="rp">
                <div class="rp-head">
                    <h1>${esc(rp.title)}</h1>
                    <span class="rp-badge">${[rp.n ? `作业 ${rp.n} 项` : '', rp.rounds.length ? `背诵 ${rp.rounds.length} 项` : '', `${s.students} 人`].filter(Boolean).join(' · ')}</span>
                </div>
                <div class="rp-meta">${esc([rp.className, `导出于 ${rp.exportedAt}（以导出时的状态为准）`].filter(Boolean).join(' · '))}</div>
                ${rules ? `<div class="rp-rules">${rules}</div>` : ''}
                <div class="rp-line"></div>
                <div class="rp-cards" style="grid-template-columns:repeat(${cardCols}, minmax(0, 1fr))">${cards.map(cardHtml).join('')}</div>
                ${summaryTable(rp)}

                <div class="rp-section">
                    ${h(rp.n ? '逐项明细' : '背诵卡片颜色')}
                    <div class="rp-key">
                        ${rp.n ? `<div class="rp-key-label">作业</div><div class="rp-key-items rp-hwlist">${rp.hws.map((hw, i) => `<span class="rp-key-item"><b>${i + 1}</b><span>${esc(hw.title)}</span><small>${esc(Utils.formatDate(hw.date))}</small></span>`).join('')}</div>` : ''}
                        ${rp.rounds.length ? `<div class="rp-key-label rp-key-rec">背诵</div><div class="rp-key-items rp-reclist">${rp.rounds.map((r, i) => `<span class="rp-key-item"><b>${i + 1}</b><span>${esc(r.title)}</span></span>`).join('')}</div>` : ''}
                    </div>
                    ${detail}
                    ${hwLegend ? `<div class="rp-rules rp-rules-after rp-legend"><b>作业卡片颜色：</b>${hwLegend}</div>` : ''}
                    ${recLegend ? `<div class="rp-rules rp-legend"><b>背诵卡片颜色：</b>${recLegend}</div>` : ''}
                </div>

                ${rp.recFails.map((f) => `
                    <div class="rp-section rp-keep">
                        ${h(`背诵未过关名单${rp.rounds.length > 1 ? '：' + f.round.title : ''}（${f.students.length} 人）`)}
                        <p class="rp-names">${f.students.length ? esc(f.students.map((st) => st.name).join('、')) : '全部过关 🎉'}</p>
                    </div>`).join('')}

                ${rp.n ? `
                    <div class="rp-section">
                        ${h(`仍未补交 / 未补改（${rp.unfixed.length} 人）`)}
                        ${rp.unfixed.length ? `<ul class="rp-unfixed">${unfixedByHw(rp).map((g) => `<li><b>${esc(hwLabel(g.hw))}</b>${g.items.map((x) => `<span class="rp-cnt">${dot(x.status)}${esc(x.student.name)}</span>`).join('')}</li>`).join('')}</ul>` : '<p class="rp-names">没有未补的作业 🎉</p>'}
                    </div>` : ''}
            </div>`;
    }

    // 打印（另存为 PDF）：打印框里的默认文件名取自 document.title
    function print(rp) {
        const old = document.getElementById('tp-print-root');
        if (old) old.remove();
        const root = document.createElement('div');
        root.id = 'tp-print-root';
        root.innerHTML = html(rp);
        document.body.appendChild(root);
        const title = document.title;
        document.title = fileBase(rp);
        const cleanup = () => {
            document.title = title;
            root.remove();
            window.removeEventListener('afterprint', cleanup);
        };
        window.addEventListener('afterprint', cleanup);
        window.print();
    }

    // ---------- Excel ----------

    function xlsx(rp) {
        const GREEN = '1E8E3E', RED = 'D93025';
        const th = (v, extra) => ({ v, s: Object.assign({ bold: true, color: 'FFFFFF', fill: GREEN, align: 'center', border: true, wrap: true }, extra || {}) });
        const td = (v, s) => ({ v, s: Object.assign({ border: true }, s || {}) });
        const s = rp.summary;
        const width = 2 + (rp.n ? 4 : 0) + rp.rounds.length + (rp.rounds.length ? (rp.n ? 2 : 1) : 0);

        // 表 1：汇总
        const rows1 = [
            [{ v: rp.title, s: { bold: true, size: 16 } }],
            [{ v: metaLine(rp), s: { color: '7A6F68' } }],
            [{ runs: ruleItems(rp).reduce((a, it, i) => a.concat(i ? [{ t: '   ' }] : [], it.keys.map((k) => ({ t: '●', color: hex(hwStatus(k).color) })), [{ t: ' ' + it.text }]), []) }],
            []
        ];
        const head = [th('学号'), th('学生', { align: 'left' })];
        if (rp.n) head.push(th('作业完成情况', { align: 'left' }), th('加分'), th('扣分'), th('作业得分'));
        rp.rounds.forEach((r) => head.push(th(`背诵：${r.title}`)));
        if (rp.rounds.length) head.push(th('背诵得分'));
        if (rp.rounds.length && rp.n) head.push(th('总分'));
        rows1.push(head);
        rp.rows.forEach((row) => {
            const no = row.student.studentNo;
            const line = [td(/^\d+$/.test(no) ? Number(no) : no, { align: 'center', color: '7A6F68' }), td(row.student.name, { bold: true })];
            if (rp.n) {
                const runs = [];
                ORDER.filter((k) => row.counts[k]).forEach((k) => runs.push({ t: '●', color: hex(hwStatus(k).color) }, { t: `×${row.counts[k]}  ` }));
                line.push({ runs, s: { border: true } },
                    td(row.bonus, { align: 'center', signed: true }),
                    td(-row.penalty || 0, { align: 'center', signed: true }),
                    td(row.final, { align: 'center', signed: true, bold: true, color: row.final > 0 ? GREEN : row.final < 0 ? RED : '333333' }));
            }
            const colorOf = (v) => (v > 0 ? GREEN : v < 0 ? RED : '333333');
            row.rec.forEach((x) => line.push(td(x.score, { align: 'center', signed: true, bold: true, color: colorOf(x.score) })));
            if (rp.rounds.length) line.push(td(row.recScore, { align: 'center', signed: true, bold: true, color: colorOf(row.recScore) }));
            if (rp.rounds.length && rp.n) line.push(td(row.total, { align: 'center', signed: true, bold: true, color: colorOf(row.total) }));
            rows1.push(line);
        });
        const cols1 = [7, 12].concat(rp.n ? [30, 8, 8, 14] : [], rp.rounds.map((r) => Math.max(12, Math.min(40, r.title.length * 2 + 8))), rp.rounds.length ? (rp.n ? [10, 10] : [10]) : []);
        const lastCol = String.fromCharCode(64 + Math.min(width, 26));

        // 表 2：逐项明细（单元格底色 = 状态色）
        const head2 = [th('学号'), th('学生', { align: 'left' })]
            .concat(rp.hws.map((hw, i) => th(`${i + 1}. ${hw.title}\n${Utils.formatDate(hw.date)}`)), rp.rounds.map((r) => th(`背诵：${r.title}`)));
        const rows2 = [head2];
        rp.rows.slice().sort((a, b) => Utils.compareStudentNo(a.student, b.student)).forEach((row) => {
            const no = row.student.studentNo;
            rows2.push([td(/^\d+$/.test(no) ? Number(no) : no, { align: 'center', color: '7A6F68' }), td(row.student.name, { bold: true })]
                .concat(row.statuses.map((k) => { const st = hwStatus(k); return td(st.short, { align: 'center', fill: hex(st.color), color: hex(st.text) }); }),
                    row.rec.map((x) => { const st = recLook(x.look); return td(st.label, { align: 'center', fill: hex(st.color), color: hex(st.text) }); })));
        });
        const cols2 = [7, 12].concat(rp.hws.map(() => 16), rp.rounds.map(() => 18));

        // 表 3：说明与名单
        const b = { bold: true };
        const rows3 = [[{ v: rp.title, s: { bold: true, size: 14 } }], [metaLine(rp)], []];
        if (rp.n) {
            rows3.push([{ v: '汇总', s: b }],
                ['全班总分', { v: s.total, s: { signed: true, align: 'left' } }], ['人均得分', { v: s.avg, s: { signed: true, align: 'left' } }],
                ['全部按时完成人数', s.full]);
            if (rp.n >= 2) rows3.push(['部分按时完成（差一项）人数', s.oneOff]);
            rows3.push(['正分 / 0 / 负分', `${s.pos} / ${s.zero} / ${s.neg}`], []);
            rows3.push([{ v: '加减分规则', s: b }]);
            ruleItems(rp).forEach((it) => rows3.push([{ runs: it.keys.map((k) => ({ t: '●', color: hex(hwStatus(k).color) })) }, it.text]));
            rows3.push([], [{ v: '统计的作业', s: b }]);
            rp.hws.forEach((hw, i) => rows3.push([i + 1, hwLabel(hw)]));
            rows3.push([]);
        }
        if (rp.rounds.length) {
            rows3.push([{ v: '背诵', s: b }], ['判定', recRuleText(rp)], ['加减分', recScoreText(rp)]);
            s.rec.forEach((x, i) => {
                rows3.push([x.round.title, `过关 ${x.pass} 人（${Utils.percent(x.pass, s.students)}），未过关 ${x.fail} 人`]);
                if (x.fail) rows3.push(['未过关名单', rp.recFails[i].students.map((st) => st.name).join('、')]);
            });
            rows3.push([]);
        }
        if (rp.n) {
            rows3.push([{ v: `仍未补交 / 未补改（${rp.unfixed.length} 人）`, s: b }]);
            unfixedByHw(rp).forEach((g) => rows3.push([hwLabel(g.hw), g.items.map((x) => `${x.student.name}（${hwStatus(x.status).label}）`).join('、')]));
        }

        return XlsxLite.build([
            { name: '汇总', cols: cols1, freeze: 5, rows: rows1, merges: width > 1 ? [`A1:${lastCol}1`, `A2:${lastCol}2`, `A3:${lastCol}3`] : [] },
            { name: '逐项明细', cols: cols2, freeze: 1, rows: rows2 },
            { name: '说明与名单', cols: [26, 90], rows: rows3 }
        ]);
    }

    // 文件名（不含扩展名）：去掉文件名里不能用的字符
    function fileBase(rp) {
        return `${rp.title}_${rp.exportedAt.slice(0, 10)}`.replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim();
    }

    window.ReportOutput = { markdown, html, print, xlsx, fileBase };
})();
