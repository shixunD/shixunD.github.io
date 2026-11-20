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

    // Markdown 里状态一律写文字（1.36.0 起不用 emoji：🩵 / 💙 几乎分不清，正式文件里也不专业）

    // 'na' = 中途入班的学生入班前的作业（灰格，不计分）
    const hwStatus = (k) => (k === 'na' ? HomeworkModel.NA : (HomeworkModel.STATUS_MAP[k] || HomeworkModel.STATUS_MAP.done));
    // 导出里的背诵状态只分两类（1.40.1）：过关的（提前完成 / 完成过关 / 条件过关，各显示本来的颜色和名字），
    // 其余——重新过关、未过关、计划背诵、未检查——一律显示成红色「未过关」。以「是否过关」（ScoreReport.recOf 的 pass，
    // 和加减分同一个判定）为准，所以按规则不算过关的条件过关、过关后又排了计划的也显示未过关。应用里的原始状态和计分都不变
    const recShown = (x) => (x.pass ? (RecitationModel.RESULT_MAP[x.status] || RecitationModel.RESULT_MAP.pass) : RecitationModel.RESULT_MAP.fail);
    const hex = (c) => c.replace('#', '').toUpperCase();
    const hwLabel = (hw) => `${cnDate(hw.date)} ${hw.title}`;

    // 报表里的日期统一写「11月6日（周五）」；导出时间「2026年11月18日 06:58」；统计范围按所选作业 / 背诵的日期算
    function cnDate(str) {
        if (!str) return '';
        const d = Utils.parseDate(str);
        return `${d.getMonth() + 1}月${d.getDate()}日（周${'日一二三四五六'[d.getDay()]}）`;
    }
    function cnStamp(stamp) {   // 'YYYY-MM-DD HH:MM' → '2026年11月18日 06:58'
        const m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(stamp || '');
        return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日${m[4]}` : (stamp || '');
    }
    function rangeText(dates) {
        const ds = dates.filter(Boolean).sort();
        if (!ds.length) return '';
        const a = Utils.parseDate(ds[0]), b = Utils.parseDate(ds[ds.length - 1]);
        const full = (d) => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
        if (ds[0] === ds[ds.length - 1]) return full(a);
        if (a.getFullYear() !== b.getFullYear()) return `${full(a)}至${full(b)}`;
        if (a.getMonth() !== b.getMonth()) return `${full(a)}至${b.getMonth() + 1}月${b.getDate()}日`;
        return `${full(a)}至${b.getDate()}日`;
    }
    const classRange = (rp) => rangeText(rp.hws.map((h) => h.date).concat(rp.rounds.map((r) => r.day)));
    const personalRange = (p) => rangeText(p.hws.map((x) => x.hw.date).concat(p.rounds.map((x) => x.round.day)));

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
        if (rp.summary.lateJoin) items.push({ keys: ['na'], text: `中途入班的 ${rp.summary.lateJoin} 人：入班前的作业不计入，按入班后的作业数算加分` });
        return items;
    }

    function recRuleText(rp) {
        const r = rp.rules;
        return `背诵过关 = 最新一次检查是 提前完成 / 完成过关${r.condPass ? ' / 条件过关' : ''}` +
            (r.planBlocks ? '，且之后没有还未完成的背诵计划' : '（过关之后多出来的计划不影响）') + '；其余判不过关';
    }

    function recScoreText(rp) {
        const r = rp.rules;
        return `背诵加减分：提前完成 ${signed(r.recEarly)}；无计划或只有一次计划且计划当日过关 ${signed(r.recOnPlan)}；` +
            `多个计划日期、或计划当日没过关但最终过关 ${signed(r.recLate)}（过关之后才排的计划不算）；最终没过关（计划中 / 重新过关 / 未过关 / 未检查）${signed(-r.recFail)}`;
    }

    function metaLine(rp) {
        const bits = [];
        if (rp.className) bits.push(rp.className);
        if (rp.n) bits.push(`作业 ${rp.n} 项`);
        if (rp.rounds.length) bits.push(`背诵 ${rp.rounds.length} 项`);
        bits.push(`${rp.summary.students} 人`);
        const range = classRange(rp);
        if (range) bits.push(`统计范围：${range}`);
        bits.push(`导出于 ${cnStamp(rp.exportedAt)}`);
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
            L.push('**加减分规则：** ' + ruleItems(rp).map((it) => it.text).join(' ｜ '), '');
            L.push('**统计的作业：**', '');
            rp.hws.forEach((hw, i) => L.push(`${i + 1}. ${hwLabel(hw)}`));
            L.push('');
        }
        if (rp.rounds.length) L.push('**背诵判定：** ' + recRuleText(rp), '', '**背诵加减分：** ' + recScoreText(rp).replace(/^背诵加减分：/, ''), '');

        const head = ['学号', '学生'];
        const align = ['---:', '---'];
        if (rp.n) { head.push('作业完成情况', '加分', '扣分', '作业得分'); align.push('---', ':---:', ':---:', ':---:'); }
        rp.rounds.forEach((r) => { head.push(`背诵：${mdCell(r.title)}`); align.push(':---:'); });
        // 1.33.1 起不再单列「背诵得分」（各任务的分已经逐列显示）；有背诵就显示总分 = 作业得分 + 各背诵任务得分
        if (rp.rounds.length) { head.push('总分'); align.push(':---:'); }
        L.push(`| ${head.join(' | ')} |`, `|${align.join('|')}|`);
        rp.rows.forEach((row) => {
            const c = [mdCell(row.student.studentNo), mdCell(row.student.name)];
            if (rp.n) {
                c.push(ORDER.filter((k) => row.counts[k]).map((k) => `${hwStatus(k).label}×${row.counts[k]}`).join(' '),
                    signed(row.bonus), signed(-row.penalty), `**${signed(row.final)}**`);
            }
            row.rec.forEach((x) => c.push(signed(x.score)));
            if (rp.rounds.length) c.push(`**${signed(row.total)}**`);
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
            unfixedByHw(rp).forEach((g) => L.push(`- ${hwLabel(g.hw)}：${g.items.map((x) => `${x.student.name}（${hwStatus(x.status).label}）`).join('、')}`));
            L.push('');
        }
        return L.join('\n');
    }

    // ---------- 网页（预览 / 打印） ----------

    const dot = (k) => `<i class="rp-dot" style="background:${hwStatus(k).color}"></i>`;

    function summaryTable(rp) {
        const sep = (i) => (rp.n && i === 0 ? ' rp-sep' : '');   // 作业得分与背诵之间的细分隔线（只加在表身；表头靠背诵列的深一号绿色区分）
        const recHead = rp.rounds.map((r, i) => `<th class="rp-num rp-rec-h rp-rec-th">背诵<small>${esc(r.title)}</small></th>`).join('');
        const recSum = rp.rounds.length ? '<th class="rp-num">总分</th>' : '';
        const body = rp.rows.map((row) => {
            const cls = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
            const hw = rp.n ? `
                <td class="rp-status">${ORDER.filter((k) => row.counts[k]).map((k) => `<span class="rp-cnt">${dot(k)}×${row.counts[k]}</span>`).join('')}</td>
                <td class="rp-num">${signed(row.bonus)}</td>
                <td class="rp-num">${signed(-row.penalty)}</td>
                <td class="rp-num rp-final ${cls(row.final)}">${signed(row.final)}</td>` : '';
            const rec = row.rec.map((x, i) => `<td class="rp-num rp-final ${cls(x.score)}${sep(i)}">${signed(x.score)}</td>`).join('') +
                (rp.rounds.length ? `<td class="rp-num rp-final rp-sep ${cls(row.total)}">${signed(row.total)}</td>` : '');   // 背诵与总分之间同样一根细分隔线
            return `<tr><td class="rp-no">${esc(row.student.studentNo)}</td><td class="rp-name">${esc(row.student.name)}</td>${hw}${rec}</tr>`;
        }).join('');
        return `
            <table class="rp-table rp-sum${rp.n ? '' : ' rp-auto'}">
                <thead><tr>
                    <th class="rp-c">学号</th><th>学生</th>
                    ${rp.n ? '<th>作业完成情况</th><th class="rp-num">加分</th><th class="rp-num">扣分</th><th class="rp-num">作业得分</th>' : ''}
                    ${recHead}${recSum}
                </tr></thead>
                <tbody>${body}</tbody>
            </table>`;
    }

    function detailTable(rp, rows, short) {
        const hwHead = rp.hws.map((hw, i) => `<th class="rp-c" title="${esc(hwLabel(hw))}">${i + 1}</th>`).join('');
        const sep = (i) => (rp.n && i === 0 ? ' rp-sep' : '');   // 作业列与背诵列之间的细分隔线（同上）
        const recHead = rp.rounds.map((r, i) => `<th class="rp-c rp-rec-th" title="${esc(r.title)}">背${i + 1}</th>`).join('');
        const body = rows.map((row) => `
            <tr><td class="rp-no">${esc(row.student.studentNo)}</td><td class="rp-name">${esc(row.student.name)}</td>
                ${row.statuses.map((k) => { const s = hwStatus(k); return `<td class="rp-c"><i class="rp-sq" style="background:${s.color}"></i></td>`; }).join('')}
                ${row.rec.map((x, i) => `<td class="rp-c${sep(i)}"><i class="rp-sq" style="background:${recShown(x).color}"></i></td>`).join('')}
            </tr>`).join('');
        return `<table class="rp-table rp-detail ${short ? 'rp-half' : ''}"><thead><tr><th class="rp-c">学号</th><th>学生</th>${hwHead}${recHead}</tr></thead><tbody>${body}</tbody></table>`;
    }

    // 两种报表共用的头部：标题 + 右上角徽标，下面一行班级 / 统计范围 / 导出时间
    function headHtml(title, badge, metaBits) {
        return `
                <div class="rp-head">
                    <h1>${esc(title)}</h1>
                    ${badge ? `<span class="rp-badge">${esc(badge)}</span>` : ''}
                </div>
                <div class="rp-meta">${esc(metaBits.filter(Boolean).join(' · '))}</div>`;
    }
    const cardHtml = (c) => `<div class="rp-card"><div class="rp-card-l"><b class="rp-card-tag${c.sub ? ' rp-card-tag-rec' : ''}">${c.tag}</b><span${c.sub ? ` class="rp-card-sub" title="${esc(c.label)}"` : ''}>${esc(c.label)}</span></div><div class="rp-card-v">${esc(c.v)}<small>${esc(c.unit || '')}</small></div></div>`;
    // 一行最多 5 格；超过就拆成几行、每行尽量一样多
    const cardsHtml = (cards) => cards.length ? `<div class="rp-cards" style="grid-template-columns:repeat(${Math.ceil(cards.length / Math.max(1, Math.ceil(cards.length / 5)))}, minmax(0, 1fr))">${cards.map(cardHtml).join('')}</div>` : '';
    const legendHtml = (name, list) => `<div class="rp-rules rp-legend"><b>${name}：</b>${list.map((st) => `<span class="rp-rule"><i class="rp-sq" style="background:${st.color}"></i>${esc(st.label)}</span>`).join('')}</div>`;
    const recStatuses = () => RecitationModel.RESULTS.filter((r) => RecitationModel.isPassed(r.key)).concat([RecitationModel.RESULT_MAP.fail]);

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


        let sec = 0;
        const h = (t) => `<h2 class="rp-h2">${['一', '二', '三', '四', '五', '六'][sec++]}、${esc(t)}</h2>`;

        return `
            <div class="rp">
                ${headHtml(rp.title, [rp.n ? `作业 ${rp.n} 项` : '', rp.rounds.length ? `背诵 ${rp.rounds.length} 项` : '', `${s.students} 人`].filter(Boolean).join(' · '),
                    [rp.className, classRange(rp) ? `统计范围：${classRange(rp)}` : '', `导出于 ${cnStamp(rp.exportedAt)}（以导出时的状态为准）`])}
                ${rules ? `<div class="rp-rules">${rules}</div>` : ''}
                <div class="rp-line"></div>
                ${cardsHtml(cards)}
                ${summaryTable(rp)}

                <div class="rp-section">
                    ${h('逐项明细')}
                    <div class="rp-key">
                        ${rp.n ? `<div class="rp-key-label">作业</div><div class="rp-key-items rp-hwlist">${rp.hws.map((hw, i) => `<span class="rp-key-item"><b>${i + 1}</b><span>${esc(hw.title)}</span><small>${esc(cnDate(hw.date))}</small></span>`).join('')}</div>` : ''}
                        ${rp.rounds.length ? `<div class="rp-key-label rp-key-rec">背诵</div><div class="rp-key-items rp-reclist">${rp.rounds.map((r, i) => `<span class="rp-key-item"><b>${i + 1}</b><span>${esc(r.title)}</span></span>`).join('')}</div>` : ''}
                    </div>
                    ${detail}
                    <div class="rp-rules-after">
                        ${rp.n ? legendHtml('作业状态', HomeworkModel.STATUSES) : ''}
                        ${rp.rounds.length ? legendHtml('背诵状态', recStatuses()) : ''}
                    </div>
                </div>

                ${rp.recFails.map((f) => `
                    <div class="rp-section rp-keep">
                        ${h(`背诵未过关名单${rp.rounds.length > 1 ? '：' + f.round.title : ''}（${f.students.length} 人）`)}
                        <p class="rp-names">${f.students.length ? esc(f.students.map((st) => st.name).join('、')) : '全部过关'}</p>
                    </div>`).join('')}

                ${rp.n ? `
                    <div class="rp-section">
                        ${h(`仍未补交 / 未补改（${rp.unfixed.length} 人）`)}
                        ${rp.unfixed.length ? `<ul class="rp-unfixed">${unfixedByHw(rp).map((g) => `<li><b>${esc(hwLabel(g.hw))}</b>${g.items.map((x) => `<span class="rp-cnt">${dot(x.status)}${esc(x.student.name)}</span>`).join('')}</li>`).join('')}</ul>` : '<p class="rp-names">没有未补的作业</p>'}
                    </div>` : ''}
            </div>`;
    }

    // ---------- 个人学情（PersonalReport.build 的结果；没有加减分，只写完成情况） ----------

    const sq = (c) => `<i class="rp-sq" style="background:${c}"></i>`;
    const personalWho = (p) => `${p.student.name}${p.student.studentNo ? '（学号 ' + p.student.studentNo + '）' : ''}`;
    const personalMetaBits = (p) => {
        const range = personalRange(p);
        return [p.className, personalWho(p), range ? `统计范围：${range}` : '', `导出于 ${cnStamp(p.exportedAt)}`];
    };
    const personalMeta = (p) => personalMetaBits(p).filter(Boolean).join(' · ');
    const personalBadge = (p) => [p.hws.length ? `作业 ${p.hws.length} 项` : '', p.rounds.length ? `背诵 ${p.rounds.length} 项` : ''].filter(Boolean).join(' · ');
    const plansText = (p) => p.plans.map((d) => cnDate(d)).join('、');

    function personalSummary(p) {
        const bits = [];
        if (p.hws.length) {
            const S = HomeworkModel.STATUS_MAP;
            bits.push(`作业 ${p.hws.length} 项：` + ORDER.filter((k) => p.counts[k]).map((k) => `${S[k].label} ${p.counts[k]} 项`).join('，'));
        }
        if (p.rounds.length) bits.push(`背诵 ${p.rounds.length} 项：过关 ${p.recPass} 项，未过关 ${p.rounds.length - p.recPass} 项`);
        return bits.join('；');
    }

    // 个人版的汇总卡片：和班级版同一套样式（作业 = 绿色标签、背诵 = 深绿标签）
    function personalCards(p) {
        const c = p.counts, cards = [];
        if (p.hws.length) {
            cards.push({ tag: '作业', label: '按时完成', v: `${c.done || 0}/${p.hws.length}`, unit: '项' });
            cards.push({ tag: '作业', label: '已补交 / 已补改', v: (c.missing_fixed || 0) + (c.poor_fixed || 0), unit: '项' });
            cards.push({ tag: '作业', label: '仍未完成 / 未按要求', v: (c.missing || 0) + (c.poor || 0), unit: '项' });
        }
        if (p.rounds.length) cards.push({ tag: '背诵', sub: true, label: '过关', v: `${p.recPass}/${p.rounds.length}`, unit: '项' });
        return cards;
    }

    function personalMarkdown(p) {
        const L = [`# ${p.title}`, '', personalMeta(p), '', `**概况：** ${personalSummary(p)}`, ''];
        if (p.hws.length) {
            L.push('## 作业', '', '| # | 日期 | 作业 | 完成情况 | 备注 |', '|---:|---|---|---|---|');
            p.hws.forEach((x) => L.push(`| ${x.no} | ${mdCell(cnDate(x.hw.date))} | ${mdCell(x.hw.title)} | ${x.label} | ${mdCell(x.comment)} |`));
            L.push('');
        }
        if (p.rounds.length) {
            L.push('## 背诵', '', '| # | 任务 | 当前情况 | 是否过关 | 最近检查 | 检查次数 | 待完成计划 | 备注 |', '|---:|---|---|:---:|---|---:|---|---|');
            p.rounds.forEach((x) => L.push(`| ${x.no} | ${mdCell(x.round.title)} | ${recShown(x).label} | ${x.pass ? '过关' : '未过关'} | ${x.lastDate ? mdCell(cnDate(x.lastDate)) : '—'} | ${x.attempts} | ${mdCell(plansText(x)) || '—'} | ${mdCell(x.comment)} |`));
            L.push('');
        }
        return L.join('\n');
    }

    function personalHtml(p) {
        const hwRows = p.hws.map((x) => {
            const s = hwStatus(x.status);
            return `<tr><td class="rp-c">${x.no}</td><td class="rp-date">${esc(cnDate(x.hw.date))}</td><td>${esc(x.hw.title)}</td><td class="rp-pstatus">${sq(s.color)}${esc(x.label)}</td><td>${esc(x.comment)}</td></tr>`;
        }).join('');
        const recRows = p.rounds.map((x) => {
            const s = recShown(x);
            const label = s.label;
            return `<tr><td class="rp-c">${x.no}</td><td>${esc(x.round.title)}</td><td class="rp-pstatus">${sq(s.color)}${esc(label)}</td><td class="rp-c rp-mark ${x.pass ? 'pos' : 'neg'}">${x.pass ? '✓ 过关' : '✗ 未过关'}</td><td class="rp-date">${x.lastDate ? esc(cnDate(x.lastDate)) : '—'}</td><td class="rp-num">${x.attempts}</td><td>${esc(plansText(x)) || '—'}</td><td>${esc(x.comment)}</td></tr>`;
        }).join('');
        let sec = 0;
        const h = (t) => `<h2 class="rp-h2">${['一', '二'][sec++]}、${t}</h2>`;
        return `
            <div class="rp rp-personal">
                ${headHtml(p.title, personalBadge(p), personalMetaBits(p))}
                <div class="rp-line"></div>
                ${cardsHtml(personalCards(p))}
                ${p.hws.length ? `<div class="rp-section">${h('作业完成情况')}
                    <table class="rp-table"><thead><tr><th class="rp-c">#</th><th>日期</th><th>作业</th><th>完成情况</th><th>备注</th></tr></thead><tbody>${hwRows}</tbody></table>
                    <div class="rp-rules-after">${legendHtml('作业状态', HomeworkModel.STATUSES)}</div></div>` : ''}
                ${p.rounds.length ? `<div class="rp-section">${h('背诵情况')}
                    <table class="rp-table"><thead><tr><th class="rp-c rp-rec-th">#</th><th class="rp-rec-th">任务</th><th class="rp-rec-th">当前情况</th><th class="rp-c rp-rec-th">是否过关</th><th class="rp-rec-th">最近检查</th><th class="rp-num rp-rec-th">检查次数</th><th class="rp-rec-th">待完成计划</th><th class="rp-rec-th">备注</th></tr></thead><tbody>${recRows}</tbody></table>
                    <div class="rp-rules-after">${legendHtml('背诵状态', recStatuses())}</div></div>` : ''}
            </div>`;
    }

    // Excel 共用：颜色、表头格、打印设置（A4、缩到一页宽、每页重复表头、页脚带页码）
    const XL = { GREEN: '1E8E3E', REC: '166B30', RED: 'D93025', MUTED: '6B7280', TEXT: '333333' };
    const xlTh = (v, extra) => ({ v, s: Object.assign({ bold: true, color: 'FFFFFF', fill: XL.GREEN, align: 'center', border: true, wrap: true }, extra || {}) });
    const xlTd = (v, s) => ({ v, s: Object.assign({ border: true }, s || {}) });
    const xlColor = (v) => (v > 0 ? XL.GREEN : v < 0 ? XL.RED : XL.TEXT);
    const colLetter = (n) => { let t = ''; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) t = String.fromCharCode(65 + ((x - 1) % 26)) + t; return t; };
    const xlPrint = (headRow, footer, landscape) => ({ landscape: !!landscape, titleRows: headRow ? [headRow, headRow] : null, footer });

    function personalXlsx(p) {
        const footer = [p.className, p.title].filter(Boolean).join(' · ');
        const top = (width) => [
            [{ v: p.title, s: { bold: true, size: 16 } }],
            [{ v: personalMeta(p), s: { color: XL.MUTED } }],
            [{ v: personalSummary(p) }],
            []
        ];
        const merges = (width) => (width > 1 ? [1, 2, 3].map((r) => `A${r}:${colLetter(width)}${r}`) : []);
        const sheets = [];
        if (p.hws.length) {
            const rows = top(5).concat([[xlTh('#'), xlTh('日期'), xlTh('作业', { align: 'left' }), xlTh('完成情况'), xlTh('备注', { align: 'left' })]]);
            p.hws.forEach((x) => { const s = hwStatus(x.status); rows.push([xlTd(x.no, { align: 'center' }), xlTd(cnDate(x.hw.date)), xlTd(x.hw.title), xlTd(x.label, { align: 'center', fill: hex(s.color), color: hex(s.text) }), xlTd(x.comment)]); });
            sheets.push({ name: '作业', cols: [6, 16, 34, 14, 36], freeze: 5, rows, merges: merges(5), print: xlPrint(5, footer) });
        }
        if (p.rounds.length) {
            const th = (v, extra) => xlTh(v, Object.assign({ fill: XL.REC }, extra || {}));
            const rows = top(8).concat([[th('#'), th('任务', { align: 'left' }), th('当前情况'), th('是否过关'), th('最近检查'), th('检查次数'), th('待完成计划', { align: 'left' }), th('备注', { align: 'left' })]]);
            p.rounds.forEach((x) => { const s = recShown(x); rows.push([xlTd(x.no, { align: 'center' }), xlTd(x.round.title), xlTd(s.label, { align: 'center', fill: hex(s.color), color: hex(s.text) }), xlTd(x.pass ? '✓ 过关' : '✗ 未过关', { align: 'center', bold: true, color: x.pass ? XL.GREEN : XL.RED }), xlTd(x.lastDate ? cnDate(x.lastDate) : '—', { align: 'center' }), xlTd(x.attempts, { align: 'center' }), xlTd(plansText(x) || '—'), xlTd(x.comment)]); });
            sheets.push({ name: '背诵', cols: [6, 28, 14, 12, 16, 10, 24, 30], freeze: 5, rows, merges: merges(8), print: xlPrint(5, footer, true) });
        }
        if (!sheets.length) sheets.push({ name: '个人学情', cols: [40], rows: top(1) });
        return XlsxLite.build(sheets);
    }

    // 打印（另存为 PDF）：打印框里的默认文件名取自 document.title
    // 页脚：左边「班级 · 报表名」，右边「第 X 页 / 共 Y 页」（CSS 页边距区，Chrome / Edge 131 起支持）。
    //   浏览器自己的「页眉和页脚」（网址、时间）要在打印窗口的「更多设置」里关掉，导出弹窗的提示里有写。
    function print(rp) { printHtml(html(rp), fileBase(rp), [rp.className, rp.title].filter(Boolean).join(' · ')); }
    function printHtml(content, base, footer) {
        const old = document.getElementById('tp-print-root');
        if (old) old.remove();
        const oldPage = document.getElementById('tp-print-page');
        if (oldPage) oldPage.remove();
        const root = document.createElement('div');
        root.id = 'tp-print-root';
        root.innerHTML = content;
        document.body.appendChild(root);
        const cssStr = (t) => '"' + String(t || '').replace(/[\\"]/g, '\\$&').replace(/[\r\n]+/g, ' ') + '"';
        const page = document.createElement('style');
        page.id = 'tp-print-page';
        page.textContent = `@page {
            @bottom-left { content: ${cssStr(footer)}; font-size: 9px; color: #6b7280; }
            @bottom-right { content: "第 " counter(page) " 页 / 共 " counter(pages) " 页"; font-size: 9px; color: #6b7280; }
        }`;
        document.head.appendChild(page);
        const title = document.title;
        document.title = base;
        const cleanup = () => {
            document.title = title;
            root.remove();
            page.remove();
            window.removeEventListener('afterprint', cleanup);
        };
        window.addEventListener('afterprint', cleanup);
        window.print();
    }

    // ---------- Excel ----------

    function xlsx(rp) {
        const { REC, MUTED } = XL;
        const th = xlTh, td = xlTd, colorOf = xlColor;
        const thRec = (v) => xlTh(v, { fill: REC });
        const footer = [rp.className, rp.title].filter(Boolean).join(' · ');
        const s = rp.summary;
        const width = 2 + (rp.n ? 4 : 0) + rp.rounds.length + (rp.rounds.length ? 1 : 0);

        // 表 1：汇总
        const rows1 = [
            [{ v: rp.title, s: { bold: true, size: 16 } }],
            [{ v: metaLine(rp), s: { color: MUTED } }],
            [{ runs: ruleItems(rp).reduce((a, it, i) => a.concat(i ? [{ t: '   ' }] : [], it.keys.map((k) => ({ t: '●', color: hex(hwStatus(k).color) })), [{ t: ' ' + it.text }]), []) }],
            []
        ];
        const head = [th('学号'), th('学生', { align: 'left' })];
        if (rp.n) head.push(th('作业完成情况', { align: 'left' }), th('加分'), th('扣分'), th('作业得分'));
        rp.rounds.forEach((r) => head.push(thRec(`背诵：${r.title}`)));
        if (rp.rounds.length) head.push(th('总分'));
        rows1.push(head);
        rp.rows.forEach((row) => {
            const no = row.student.studentNo;
            const line = [td(/^\d+$/.test(no) ? Number(no) : no, { align: 'center', color: MUTED }), td(row.student.name, { bold: true })];
            if (rp.n) {
                const runs = [];
                ORDER.filter((k) => row.counts[k]).forEach((k) => runs.push({ t: '●', color: hex(hwStatus(k).color) }, { t: `×${row.counts[k]}  ` }));
                line.push({ runs, s: { border: true } },
                    td(row.bonus, { align: 'center', signed: true }),
                    td(-row.penalty || 0, { align: 'center', signed: true }),
                    td(row.final, { align: 'center', signed: true, bold: true, color: colorOf(row.final) }));
            }
            row.rec.forEach((x) => line.push(td(x.score, { align: 'center', signed: true, bold: true, color: colorOf(x.score) })));
            if (rp.rounds.length) line.push(td(row.total, { align: 'center', signed: true, bold: true, color: colorOf(row.total) }));
            rows1.push(line);
        });
        const cols1 = [7, 12].concat(rp.n ? [30, 8, 8, 14] : [], rp.rounds.map((r) => Math.max(12, Math.min(40, r.title.length * 2 + 8))), rp.rounds.length ? [10] : []);
        const lastCol = colLetter(width);

        // 表 2：逐项明细（单元格底色 = 状态色）
        const head2 = [th('学号'), th('学生', { align: 'left' })]
            .concat(rp.hws.map((hw, i) => th(`${i + 1}. ${hw.title}\n${cnDate(hw.date)}`)), rp.rounds.map((r) => thRec(`背诵：${r.title}`)));
        const rows2 = [head2];
        rp.rows.slice().sort((a, b) => Utils.compareStudentNo(a.student, b.student)).forEach((row) => {
            const no = row.student.studentNo;
            rows2.push([td(/^\d+$/.test(no) ? Number(no) : no, { align: 'center', color: MUTED }), td(row.student.name, { bold: true })]
                .concat(row.statuses.map((k) => { const st = hwStatus(k); return td(st.short, { align: 'center', fill: hex(st.color), color: hex(st.text) }); }),
                    row.rec.map((x) => { const st = recShown(x); return td(st.label, { align: 'center', fill: hex(st.color), color: hex(st.text) }); })));
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
            { name: '汇总', cols: cols1, freeze: 5, rows: rows1, merges: width > 1 ? [`A1:${lastCol}1`, `A2:${lastCol}2`, `A3:${lastCol}3`] : [], print: xlPrint(5, footer, width > 7) },
            { name: '逐项明细', cols: cols2, freeze: 1, rows: rows2, print: xlPrint(1, footer, cols2.length > 8) },
            { name: '说明与名单', cols: [26, 90], rows: rows3, print: xlPrint(0, footer) }
        ]);
    }

    // 文件名（不含扩展名）：去掉文件名里不能用的字符
    function fileBase(rp) {
        return `${rp.title}_${rp.exportedAt.slice(0, 10)}`.replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim();
    }

    window.ReportOutput = {
        markdown, html, print, xlsx, fileBase,
        personal: { markdown: personalMarkdown, html: personalHtml, xlsx: personalXlsx, print: (p) => printHtml(personalHtml(p), fileBase(p), [p.className, p.title].filter(Boolean).join(' · ')) }
    };
})();
