// models/recitation.js —— 背诵业务逻辑：轮次、检查记录、当前状态、背诵计划日程/提醒
// 全局命名空间：window.RecitationModel
//
// 轮次（round）= 一项背诵任务，不绑定日期；老师每天抽查一部分人，每次检查新增一条 recCheck。
// 学生在某轮次的"当前状态" = 最新一条检查记录的结果（过关 / 需重新过关 / 未过关），没有记录 = 未检查。
// "需重新过关 / 未过关"只是状态，不带日期（1.9.0 起）；"哪天再背"统一用背诵计划（recPlan）表示。
// 背诵计划（recPlan）= "计划某天让这个学生背"，与检查状态互不影响、可以同时存在（一个学生可有多个计划日期）。
//   登记检查不会删除计划；安排之后登记的、日期在计划日当天或之后的检查，会让这条计划算"已完成"
//   （不再出现在待办/提醒/粉框里，但保留在记录中）；只有老师手动"取消计划"才会删除。

(function () {
    'use strict';

    const RESULTS = [
        { key: 'pass', label: '过关', color: '#1e8e3e', text: '#fff' },
        { key: 'retry', label: '需重新过关', color: '#f2b705', text: '#4a3500' },
        { key: 'fail', label: '未过关', color: '#d93025', text: '#fff' }
    ];
    const NONE = { key: 'none', label: '未检查', color: '#e5e7eb', text: '#6b7280' };
    // "计划背诵"的标识色（浅绿；不是检查结果，不进 RESULT_MAP）。有计划的学生卡片整体显示为这个颜色
    const PLAN = { key: 'plan', label: '计划背诵', color: '#b9e8b0', text: '#1f5214' };
    const RESULT_MAP = { none: NONE };
    RESULTS.forEach((r) => { RESULT_MAP[r.key] = r; });

    function state() { return AppState.getState(); }

    // ---------- 轮次 ----------

    function rounds(opts) {
        const o = opts || {};
        const classId = AppState.getActiveClassId();
        return state().recRounds
            .filter((r) => r.classId === classId)
            .filter((r) => o.includeArchived || !r.archived)
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }

    function getRound(id) { return state().recRounds.find((r) => r.id === id) || null; }

    function createRound(data) {
        return AppState._commit((s) => {
            const round = {
                id: Utils.uid('rnd'),
                classId: AppState.getActiveClassId(),
                title: data.title || '背诵',
                content: data.content || '',
                createdAt: Date.now(),
                archived: false
            };
            s.recRounds.push(round);
            return round;
        });
    }

    function updateRound(id, patch) {
        return AppState._commit(() => {
            const r = getRound(id);
            if (r) Object.assign(r, patch);
        });
    }

    function removeRound(id) {
        return AppState._commit((s) => {
            s.recRounds = s.recRounds.filter((r) => r.id !== id);
            s.recChecks = s.recChecks.filter((c) => c.roundId !== id);
            s.recPlans = s.recPlans.filter((p) => p.roundId !== id);
        });
    }

    // ---------- 检查记录 ----------

    // 某生某轮次的全部检查记录，按时间正序（日期相同按录入先后）
    function checksFor(roundId, studentId) {
        return state().recChecks
            .filter((c) => c.roundId === roundId && c.studentId === studentId)
            .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0));
    }

    function latestCheck(roundId, studentId) {
        const list = checksFor(roundId, studentId);
        return list.length ? list[list.length - 1] : null;
    }

    // 当前状态（所有地方的状态都从这里取）：返回 { status, check, passedOn, attemptsToPass }
    //   status          'none' | 'pass' | 'retry' | 'fail' —— 最新一条检查记录的结果
    //   check           最新一条检查记录（没有为 null）
    //   passedOn        当前处于"过关"时，这一段连续过关的第一次过关日期；attemptsToPass 到那次为止共检查了几次
    function progressOf(roundId, studentId) {
        const checks = checksFor(roundId, studentId);
        if (!checks.length) return { status: 'none', check: null, passedOn: null, attemptsToPass: null };
        const last = checks[checks.length - 1];
        if (last.result !== 'pass') return { status: last.result, check: last, passedOn: null, attemptsToPass: null };
        let i = checks.length - 1;
        while (i > 0 && checks[i - 1].result === 'pass') i--;
        return { status: 'pass', check: last, passedOn: checks[i].date, attemptsToPass: i + 1 };
    }

    function statusOf(roundId, studentId) {
        return progressOf(roundId, studentId).status;
    }

    function addCheck(data) {
        return AppState._commit((s) => {
            const check = {
                id: Utils.uid('chk'),
                roundId: data.roundId,
                studentId: data.studentId,
                date: data.date || Utils.today(),
                result: data.result,
                note: data.note || '',
                createdAt: Date.now()
            };
            s.recChecks.push(check);
            return check;
        });
    }

    // 编辑一条检查记录（结果 / 日期 / 备注）
    function updateCheck(id, patch) {
        return AppState._commit((s) => {
            const c = s.recChecks.find((x) => x.id === id);
            if (!c) return;
            c.result = patch.result;
            c.date = patch.date || c.date;
            c.note = patch.note || '';
        });
    }

    function removeCheck(id) {
        return AppState._commit((s) => { s.recChecks = s.recChecks.filter((c) => c.id !== id); });
    }

    // 单轮次的状态统计
    function roundSummary(roundId, students) {
        const counts = { pass: 0, retry: 0, fail: 0, none: 0 };
        (students || AppState.getStudents()).forEach((stu) => { counts[statusOf(roundId, stu.id)]++; });
        return counts;
    }

    // ---------- 背诵计划 ----------

    // 某生某轮次的计划，按日期正序
    function plansFor(roundId, studentId) {
        return state().recPlans
            .filter((p) => p.roundId === roundId && p.studentId === studentId)
            .sort((a, b) => a.date.localeCompare(b.date));
    }

    // 计划是否已完成：安排计划之后登记了一次检查，且检查日期在计划日期当天或之后
    // （"安排之后"用 createdAt 判断：今天已经查过、又给今天加计划时，之前那次检查不算完成这条新计划）
    function isPlanDone(plan) {
        return state().recChecks.some((c) => c.roundId === plan.roundId && c.studentId === plan.studentId
            && c.date >= plan.date && (c.createdAt || 0) >= (plan.createdAt || 0));
    }

    // 还没完成的计划（待办），按日期正序
    function pendingPlans(roundId, studentId) {
        return plansFor(roundId, studentId).filter((p) => !isPlanDone(p));
    }

    // 批量加入计划：studentIds × dates（dates 可以是单个日期或数组）；已存在的同一天计划跳过。返回实际新增数量
    function addPlans(roundId, studentIds, dates) {
        const list = (Array.isArray(dates) ? dates : [dates]).filter(Boolean);
        return AppState._commit((s) => {
            let added = 0;
            studentIds.forEach((studentId) => {
                list.forEach((date) => {
                    if (s.recPlans.some((p) => p.roundId === roundId && p.studentId === studentId && p.date === date)) return;
                    s.recPlans.push({ id: Utils.uid('plan'), roundId, studentId, date, createdAt: Date.now() });
                    added++;
                });
            });
            return added;
        });
    }

    function removePlan(id) {
        return AppState._commit((s) => { s.recPlans = s.recPlans.filter((p) => p.id !== id); });
    }

    // ---------- 日程（背诵计划） ----------
    // 返回当前班级（未归档轮次）所有未完成的计划：
    //   { type:'plan', round, student, plan, check(最新检查或 null), dates:[date], nextDate:date, overdue: date < 今天 }
    function schedule() {
        const today = Utils.today();
        const students = AppState.getStudents();
        const items = [];
        rounds().forEach((round) => {
            students.forEach((stu) => {
                const c = latestCheck(round.id, stu.id);
                pendingPlans(round.id, stu.id).forEach((plan) => {
                    items.push({
                        type: 'plan', round, student: stu, plan, check: c,
                        dates: [plan.date], nextDate: plan.date, overdue: plan.date < today
                    });
                });
            });
        });
        return items;
    }

    // 学生卡片 / 学生趋势里的"下一次安排"：逾期的计划优先，其次最早的计划；返回 { type:'plan', date, overdue } 或 null
    function nextArrangement(roundId, studentId) {
        const today = Utils.today();
        const plans = pendingPlans(roundId, studentId);
        if (!plans.length) return null;
        const overdue = plans.find((p) => p.date < today);
        const p = overdue || plans[0];
        return { type: 'plan', date: p.date, overdue: !!overdue };
    }

    // 今天是否需要检查这个学生（今天有未完成的计划）——卡片加粉色边框
    function dueToday(roundId, studentId) {
        const today = Utils.today();
        return pendingPlans(roundId, studentId).some((p) => p.date === today);
    }

    function reminderCounts() {
        const today = Utils.today();
        const items = schedule();
        return {
            overdue: items.filter((x) => x.overdue).length,
            today: items.filter((x) => !x.overdue && x.nextDate === today).length
        };
    }

    // 某学生在所有轮次（含归档）的情况，按轮次创建时间正序
    function studentOverview(studentId) {
        return rounds({ includeArchived: true }).slice().reverse().map((round) => {
            const checks = checksFor(round.id, studentId);
            const pg = progressOf(round.id, studentId);
            return {
                round,
                checks,
                progress: pg,
                status: pg.status,
                attempts: checks.length,
                // 过关日期 = 当前这一段连续过关的第一次过关日期
                firstPassDate: pg.passedOn,
                attemptsToPass: pg.attemptsToPass,
                daysToPass: pg.passedOn ? Utils.diffDays(checks[0].date, pg.passedOn) : null
            };
        });
    }

    window.RecitationModel = {
        RESULTS, RESULT_MAP, NONE, PLAN,
        rounds, getRound, createRound, updateRound, removeRound,
        checksFor, latestCheck, progressOf, statusOf, addCheck, updateCheck, removeCheck, roundSummary,
        plansFor, pendingPlans, isPlanDone, addPlans, removePlan,
        schedule, nextArrangement, dueToday, reminderCounts, studentOverview
    };
})();
