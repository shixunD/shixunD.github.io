// models/personalReport.js —— 「导出个人学情」：某个学生在所选作业 / 背诵任务上的完成情况（只读，不计加减分）
// 全局命名空间：window.PersonalReport
// 背诵过关判定沿用单周学情的 ScoreReport.recOf（同一套规则）。

(function () {
    'use strict';

    // opts: { studentId, hwIds[], roundIds[], title }
    function build(opts) {
        const o = opts || {};
        const stu = AppState.getStudents().find((s) => s.id === o.studentId);
        const rules = ScoreReport.getRules();
        const hwSet = new Set(o.hwIds || []);
        const rdSet = new Set(o.roundIds || []);
        const S = HomeworkModel.STATUS_MAP;

        // 作业按日期从早到晚编号
        // 已转出作业 / 背诵的（1.54.0）：那一类不出现在个人学情里
        if (AppState.isOutOf(stu, 'hw')) hwSet.clear();
        if (AppState.isOutOf(stu, 'rec')) rdSet.clear();
        const hws = HomeworkModel.list().filter((h) => hwSet.has(h.id) && (!stu || HomeworkModel.appliesTo(h, stu))).reverse().map((hw, i) => {
            const rec = HomeworkModel.getRecord(hw, o.studentId);
            return { no: i + 1, hw, status: rec.status, label: S[rec.status].label, comment: rec.comment };
        });
        const counts = {};
        ScoreReport.STATUS_ORDER.forEach((k) => { counts[k] = 0; });
        hws.forEach((x) => { counts[x.status] = (counts[x.status] || 0) + 1; });

        const rounds = RecitationModel.rounds().filter((r) => rdSet.has(r.id)).map((round, i) => {
            const pg = RecitationModel.progressOf(round.id, o.studentId);
            const r = ScoreReport.recOf(round, o.studentId, rules);
            const checks = RecitationModel.checksFor(round.id, o.studentId);
            const plans = RecitationModel.pendingPlans(round.id, o.studentId);
            return {
                no: i + 1, round,
                look: r.look,                       // 'plan' | 状态 key（用于配色）
                status: pg.status,
                label: (RecitationModel.RESULT_MAP[pg.status] || RecitationModel.NONE).label,
                lastDate: pg.check && !RecitationModel.isUndated(pg.check.result) ? pg.check.date : '',   // 未过关不带日期
                attempts: checks.length,
                pass: r.pass,
                plans: plans.map((p) => p.date),
                comment: pg.check ? (pg.check.note || '') : ''
            };
        });

        const cls = AppState.getActiveClass();
        const now = new Date();
        const pad = (x) => String(x).padStart(2, '0');
        return {
            title: (o.title || '').trim() || `${stu ? stu.name : ''} 学情`,
            className: cls ? cls.name : '',
            student: stu || { name: '', studentNo: '' },
            exportedAt: `${Utils.toDateStr(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
            hws, counts, rounds,
            recPass: rounds.filter((r) => r.pass).length
        };
    }

    window.PersonalReport = { build };
})();
