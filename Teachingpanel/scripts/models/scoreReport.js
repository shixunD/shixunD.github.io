// models/scoreReport.js —— 「导出统计」的计分：作业加减分 + 背诵过关判定（只读统计，不改业务数据）
// 全局命名空间：window.ScoreReport
//
// 规则存在 settings.scoreRules（主页「⚙️ 设置 → 加减分规则」里改），读取时与 DEFAULT_RULES 合并，
// 所以旧数据 / 旧备份没有这个字段也能用，不需要升 schema。
//
// 作业（一次导出 = 一个统计周期，N = 勾选的作业总数，不管来自几个分组夹）：
//   全部 N 项绿色 → 加 bonusAll；N ≥ 2 且恰好 N-1 项绿色 → 加 bonusOneOff；其余不加分。N = 1 时只有「全绿加分 / 不加分」两档
//   每项按最终状态扣 penalty[status]（默认 粉 0.5、红 1、两种蓝 0）；蓝色不算绿色，会影响加分
//   最终得分 = 加分 - 扣分
// 背诵（每个任务单独判 ✓ / ✗）：按检查页学生卡片的底色判——
//   卡片底色 = 最新检查结果的颜色；但「最后一天只有未完成的计划」时卡片是天蓝（与 recitationPage.studentCard 同一规则）
//   （1.32.0 起另有背诵加减分，见 recScore；✓/✗ 仍用于「过关人数」统计）
//   ✓ = 最新结果是 提前完成 / 完成过关 /（condPass 开时）条件过关，且（planBlocks 开时）卡片不是天蓝

(function () {
    'use strict';

    const DEFAULT_RULES = {
        bonusAll: 2,
        bonusOneOff: 1,
        penalty: { poor: 0.5, missing: 1, poor_fixed: 0, missing_fixed: 0 },
        recEarly: 3,         // 背诵：提前完成加分
        recOnPlan: 2,        // 背诵：无计划，或只有一次计划且计划当日过关
        recLate: 1,          // 背诵：多个计划日期 / 计划当日没过关，但最终过关
        recFail: 2,          // 背诵：一周最终没过关（蓝 / 黄 / 红 / 未检查）扣分
        condPass: true,      // 条件过关算不算过关
        planBlocks: true     // 过关后又排了还没完成的计划（卡片天蓝）是否判不过关
    };
    const PENALTY_KEYS = ['poor', 'missing', 'poor_fixed', 'missing_fixed'];
    // 作业完成情况里各状态的显示顺序
    const STATUS_ORDER = ['done', 'poor_fixed', 'missing_fixed', 'poor', 'missing'];

    function num(v, fallback) {
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : fallback;
    }

    function normalizeRules(raw) {
        const r = raw && typeof raw === 'object' ? raw : {};
        const p = r.penalty && typeof r.penalty === 'object' ? r.penalty : {};
        const out = {
            bonusAll: num(r.bonusAll, DEFAULT_RULES.bonusAll),
            bonusOneOff: num(r.bonusOneOff, DEFAULT_RULES.bonusOneOff),
            penalty: {},
            recEarly: num(r.recEarly, DEFAULT_RULES.recEarly),
            recOnPlan: num(r.recOnPlan, DEFAULT_RULES.recOnPlan),
            recLate: num(r.recLate, DEFAULT_RULES.recLate),
            recFail: num(r.recFail, DEFAULT_RULES.recFail),
            condPass: r.condPass == null ? DEFAULT_RULES.condPass : !!r.condPass,
            planBlocks: r.planBlocks == null ? DEFAULT_RULES.planBlocks : !!r.planBlocks
        };
        PENALTY_KEYS.forEach((k) => { out.penalty[k] = num(p[k], DEFAULT_RULES.penalty[k]); });
        return out;
    }

    function getRules() { return normalizeRules(AppState.getState().settings.scoreRules); }
    function saveRules(rules) { return AppState.updateSettings({ scoreRules: normalizeRules(rules) }); }
    function defaultRules() { return normalizeRules(null); }

    const round2 = (n) => Math.round(n * 100) / 100;

    // 带正负号的分数：+2 / -0.5 / 0（负号用普通连字符，方便复制到表格里）
    function signed(n) {
        const v = round2(n);
        if (v > 0) return '+' + v;
        if (v < 0) return '-' + Math.abs(v);
        return '0';
    }

    function bonusOf(green, n, rules) {
        if (!n) return 0;
        if (green === n) return rules.bonusAll;
        if (n >= 2 && green === n - 1) return rules.bonusOneOff;
        return 0;
    }

    // 某生某背诵任务：{ pass, look }；look = 卡片底色对应的 key（'plan' | 'none' | 检查结果）
    function recOf(round, studentId, rules) {
        const pg = RecitationModel.progressOf(round.id, studentId);
        const plans = RecitationModel.pendingPlans(round.id, studentId);
        const lastPlan = plans.length ? plans[plans.length - 1].date : '';
        const planIsLast = !!lastPlan && (!pg.check || lastPlan > pg.check.date);
        const ok = pg.status === 'excel' || pg.status === 'pass' || (pg.status === 'cond' && rules.condPass);
        const pass = ok && !(rules.planBlocks && planIsLast);
        return { pass, look: planIsLast ? 'plan' : pg.status, status: pg.status, score: recScore(round, studentId, pass, rules) };
    }

    // 背诵加减分（每个任务一项）：
    //   最终没过关（卡片是蓝 / 黄 / 红 / 灰）→ -recFail
    //   过关：检查里有「提前完成」→ +recEarly；
    //         否则没有计划，或只有一次计划且计划当日有过关的检查 → +recOnPlan；
    //         否则（多个计划日期，或计划当日没过关，最终才过关）→ +recLate
    function recScore(round, studentId, pass, rules) {
        if (!pass) return -rules.recFail;
        const checks = RecitationModel.checksFor(round.id, studentId);
        if (checks.some((c) => c.result === 'excel')) return rules.recEarly;
        const plans = RecitationModel.plansFor(round.id, studentId);
        if (!plans.length) return rules.recOnPlan;
        if (plans.length === 1 && checks.some((c) => c.date === plans[0].date && RecitationModel.isPassed(c.result))) return rules.recOnPlan;
        return rules.recLate;
    }

    // opts: { hwIds[], roundIds[], sort: 'no' | 'score', title }
    function build(opts) {
        const o = opts || {};
        const rules = getRules();
        const students = AppState.getStudents();
        const hwSet = new Set(o.hwIds || []);
        const rdSet = new Set(o.roundIds || []);
        // 作业按日期从早到晚编号（第 1 项 = 最早），背诵任务按侧栏顺序
        const hws = HomeworkModel.list().filter((h) => hwSet.has(h.id)).reverse();
        const rounds = RecitationModel.rounds().filter((r) => rdSet.has(r.id));
        const n = hws.length;

        const rows = students.map((stu) => {
            const counts = {};
            STATUS_ORDER.forEach((k) => { counts[k] = 0; });
            const statuses = hws.map((hw) => {
                const st = HomeworkModel.getRecord(hw, stu.id).status;
                counts[st] = (counts[st] || 0) + 1;
                return st;
            });
            const bonus = bonusOf(counts.done, n, rules);
            const penalty = round2(PENALTY_KEYS.reduce((sum, k) => sum + counts[k] * rules.penalty[k], 0));
            const rec = rounds.map((r) => recOf(r, stu.id, rules));
            const recScoreSum = round2(rec.reduce((sum, x) => sum + x.score, 0));
            const final = round2(bonus - penalty);
            return {
                student: stu, counts, statuses, bonus, penalty, final,
                rec, recScore: recScoreSum, total: round2(final + recScoreSum)
            };
        });
        if (o.sort === 'score' && n) rows.sort((a, b) => b.final - a.final);   // sort 稳定：同分保持学号顺序

        const total = round2(rows.reduce((s, r) => s + r.final, 0));
        const summary = {
            students: rows.length,
            total,
            avg: rows.length ? round2(total / rows.length) : 0,
            recTotal: round2(rows.reduce((sum, r) => sum + r.recScore, 0)),
            full: rows.filter((r) => n && r.counts.done === n).length,           // 全部按时完成
            oneOff: rows.filter((r) => n >= 2 && r.counts.done === n - 1).length,   // 只差一项（N ≥ 2 才有这一档）
            pos: rows.filter((r) => r.final > 0).length,
            zero: rows.filter((r) => r.final === 0).length,
            neg: rows.filter((r) => r.final < 0).length,
            rec: rounds.map((r, i) => {
                const pass = rows.filter((x) => x.rec[i].pass).length;
                return { round: r, pass, fail: rows.length - pass };
            })
        };

        // 仍未补交 / 未补改：[{ student, items: [{ no, hw, status }] }]，按学号
        const unfixed = rows.map((r) => ({
            student: r.student,
            items: r.statuses.map((st, i) => ({ no: i + 1, hw: hws[i], status: st })).filter((x) => HomeworkModel.isOutstanding(x.status))
        })).filter((x) => x.items.length).sort((a, b) => Utils.compareStudentNo(a.student, b.student));

        const recFails = rounds.map((r, i) => ({
            round: r,
            students: rows.filter((x) => !x.rec[i].pass).map((x) => x.student).sort(Utils.compareStudentNo)
        }));

        const cls = AppState.getActiveClass();
        const now = new Date();
        const pad = (x) => String(x).padStart(2, '0');
        return {
            title: (o.title || '').trim() || '作业与背诵统计',
            className: cls ? cls.name : '',
            exportedAt: `${Utils.toDateStr(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
            rules, n, hws, rounds, rows, summary, unfixed, recFails
        };
    }

    window.ScoreReport = {
        DEFAULT_RULES, PENALTY_KEYS, STATUS_ORDER,
        getRules, saveRules, defaultRules, normalizeRules, signed, bonusOf, build
    };
})();
