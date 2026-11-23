// models/recitation.js —— 背诵业务逻辑：轮次、检查记录、当前状态、背诵计划日程/提醒
// 全局命名空间：window.RecitationModel
//
// 轮次（round）= 一项背诵任务，不绑定日期；老师每天抽查一部分人，每次检查新增一条 recCheck。
// 学生在某轮次的"当前状态" = 最新一条检查记录的结果（提前完成 / 过关 / 重新过关 / 未过关），没有记录 = 未检查。
// "提前完成"= 过关里做得特别好的（深绿），所有"算不算过关"的统计都把它算作过关，用 isPassed() 判断。
// "重新过关 / 未过关"只是状态，不带日期（1.9.0 起）；"哪天再背"统一用背诵计划（recPlan）表示。
// 归档（1.38.0）：最新一条检查是 提前完成 / 完成过关 / 条件过关 / 未过关 = 这一轮对这个学生已经结束，
//   不能再登记别的状态、不能再加计划，只能改那条记录的备注 / 照片（删掉那条记录就解除归档）。
//   「未过关」是最终结论，不选检查日期（存成登记当天，只用来排序），界面上不显示日期；还要再背的用「重新过关」。
// 背诵计划（recPlan）= "计划某天让这个学生背"，与检查状态互不影响、可以同时存在（一个学生可有多个计划日期）。
//   登记检查不会删除计划；安排之后登记的、日期在计划日当天或之后的检查，会让这条计划算"已完成"
//   （不再出现在待办/提醒/粉框里，但保留在记录中）；只有老师手动"取消计划"才会删除。

(function () {
    'use strict';

    const RESULTS = [
        { key: 'excel', label: '提前完成', color: '#0b5c2a', text: '#fff' },
        { key: 'pass', label: '完成过关', color: '#1e8e3e', text: '#fff' },
        { key: 'cond', label: '条件过关', color: '#b9e8b0', text: '#1f5214' },
        { key: 'retry', label: '重新过关', color: '#f2b705', text: '#4a3500' },
        { key: 'fail', label: '未过关', color: '#d93025', text: '#fff' }
    ];
    const NONE = { key: 'none', label: '未检查', color: '#e5e7eb', text: '#6b7280' };
    // "计划背诵"的标识色（浅天蓝；不是检查结果，不进 RESULT_MAP）。有计划的学生卡片整体显示为这个颜色
    const PLAN = { key: 'plan', label: '计划背诵', color: '#bfe3f7', text: '#0d4a6b', accent: '#5bb8ec' };   // accent：窄色条用的天蓝（浅色在白底上太淡）
    // 笔记（1.46.0）：「未检查」状态下只记文字 / 照片 / 语音，不改状态。存在 recChecks 里（result: 'note'），
    // 但 checksFor / 状态 / 计划完成 / 归档 / 统计都看不见它；只有 notesFor 读它
    const NOTE = { key: 'note', label: '笔记', color: '#e5e7eb', text: '#374151' };
    const RESULT_MAP = { none: NONE, note: NOTE };
    RESULTS.forEach((r) => { RESULT_MAP[r.key] = r; });

    function state() { return AppState.getState(); }
    const isNote = (c) => c.result === 'note';
    const real = (list) => list.filter((c) => !isNote(c));

    // 提前完成、条件过关（勉强过）也算过关
    function isPassed(key) { return key === 'pass' || key === 'excel' || key === 'cond'; }
    // 会让这一轮归档的结果：过关的三种 + 未过关（最终结论）。只有「重新过关」不归档
    function isArchiveResult(key) { return isPassed(key) || key === 'fail'; }
    // 不带日期的结果（界面上不显示检查日期，登记时也不选日期）
    function isUndated(key) { return key === 'fail'; }

    // ---------- 轮次 ----------

    // 默认（没手动排过）新轮次在最前，按创建时间新→旧；手动排序 / 分组夹见 models/sideGroups.js
    function cmpRound(a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }

    function classRounds() {
        const classId = AppState.getActiveClassId();
        return state().recRounds.filter((r) => r.classId === classId);
    }

    function roundLayout() { return SideGroups.layout('rec', classRounds(), cmpRound); }
    // 按侧栏显示顺序拍平的轮次数组（总览、计划页也用这个顺序）
    function rounds() { return SideGroups.flatten(roundLayout()); }

    // 拖动排序 / 进出分组夹：drag、drop 的含义见 SideGroups.move
    function moveSide(drag, drop) { return SideGroups.move('rec', classRounds(), cmpRound, drag, drop); }
    function removeGroup(id) { return SideGroups.removeGroup('rec', classRounds(), cmpRound, id); }

    function getRound(id) { return state().recRounds.find((r) => r.id === id) || null; }

    function createRound(data) {
        return AppState._commit((s) => {
            const round = {
                id: Utils.uid('rnd'),
                classId: AppState.getActiveClassId(),
                title: data.title || '背诵',
                content: data.content || '',
                createdAt: Date.now(),
                archived: false,
                day: data.day || Utils.today(),
                weekStart: weekStartOf(data.day || Utils.today())
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
        return real(state().recChecks)
            .filter((c) => c.roundId === roundId && c.studentId === studentId)
            .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0));
    }

    // 某生某轮次的笔记（未检查状态下加的），按日期正序
    function notesFor(roundId, studentId) {
        return state().recChecks
            .filter((c) => isNote(c) && c.roundId === roundId && c.studentId === studentId)
            .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0));
    }

    // 添加笔记：只有「未检查」（没有任何检查记录）时才能加；文字 / 照片 / 语音至少要有一样
    function addNote(data) {
        return AppState._commit((s) => {
            if (real(s.recChecks).some((c) => c.roundId === data.roundId && c.studentId === data.studentId)) {
                throw new Error('已经有检查状态了，不能再单独添加笔记；请在登记检查时写备注');
            }
            const hasPhoto = data.photoIds && data.photoIds.length, hasAudio = data.audioIds && data.audioIds.length;
            if (!(data.note || '').trim() && !hasPhoto && !hasAudio) throw new Error('笔记内容不能为空（文字、照片或语音至少要有一样）');
            const n = { id: Utils.uid('chk'), roundId: data.roundId, studentId: data.studentId, date: data.date || Utils.today(), result: 'note', note: (data.note || '').trim(), createdAt: Date.now() };
            if (hasPhoto) n.photoIds = data.photoIds.slice();
            if (hasAudio) n.audioIds = data.audioIds.slice();
            s.recChecks.push(n);
            return n;
        });
    }

    function latestCheck(roundId, studentId) {
        const list = checksFor(roundId, studentId);
        return list.length ? list[list.length - 1] : null;
    }

    // 当前状态（所有地方的状态都从这里取）：返回 { status, check, passedOn, attemptsToPass }
    //   status          'none' | 'excel' | 'pass' | 'cond' | 'retry' | 'fail' —— 最新一条检查记录的结果
    //   check           最新一条检查记录（没有为 null）
    //   passedOn        当前处于"过关"时，这一段连续过关的第一次过关日期；attemptsToPass 到那次为止共检查了几次
    function progressOf(roundId, studentId) {
        const checks = checksFor(roundId, studentId);
        if (!checks.length) return { status: 'none', check: null, passedOn: null, attemptsToPass: null };
        const last = checks[checks.length - 1];
        if (!isPassed(last.result)) return { status: last.result, check: last, passedOn: null, attemptsToPass: null };
        let i = checks.length - 1;
        while (i > 0 && isPassed(checks[i - 1].result)) i--;
        return { status: last.result, check: last, passedOn: checks[i].date, attemptsToPass: i + 1 };
    }

    function statusOf(roundId, studentId) {
        return progressOf(roundId, studentId).status;
    }

    // ---------- 归档（1.32.1 只有提前完成，1.38.0 起 完成过关 / 条件过关 / 未过关 也一样） ----------
    // 锁定（= 归档）：最新一条检查是 isArchiveResult 的结果 —— 这一轮已经有结论，不能再加别的检查状态、不能再加计划，
    //   只能编辑这条记录的备注 / 照片
    // 不能选 excel：之前登记过 重新过关 / 未过关（ignoreDate 那天的记录会被这次保存替换，不算）
    const sortChecks = (list) => list.slice().sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0));
    function lastIn(checks) {
        const l = sortChecks(checks);
        return l.length ? l[l.length - 1] : null;
    }
    function lockedIn(checks) {
        const last = lastIn(checks);
        return !!last && isArchiveResult(last.result);
    }
    function excelBlockedIn(checks, ignoreDate) {
        return checks.some((c) => (c.result === 'retry' || c.result === 'fail') && c.date !== ignoreDate);
    }
    // exceptCheckId（可选）：算锁定时不看这一条（编辑那条记录自己时用）
    function isLocked(roundId, studentId, exceptCheckId) { return lockedIn(checksFor(roundId, studentId).filter((c) => c.id !== exceptCheckId)); }
    // 归档时是哪个结果（'excel' | 'pass' | 'cond' | 'fail'），没归档为 null
    function lockedResult(roundId, studentId) {
        const checks = checksFor(roundId, studentId);
        return lockedIn(checks) ? lastIn(checks).result : null;
    }
    function canExcel(roundId, studentId, ignoreDate) { return !excelBlockedIn(checksFor(roundId, studentId), ignoreDate); }
    function guardCheck(mine, result, date, selfId) {
        const others = selfId ? mine.filter((c) => c.id !== selfId) : mine;
        if (lockedIn(others)) {
            const ex = lastIn(others);
            if (!(result === ex.result && date === ex.date)) {
                throw new Error(`已经「${RESULT_MAP[ex.result].label}」（已归档），只能修改那条记录的备注和照片，不能再登记其他状态`);
            }
        } else if (result === 'excel' && excelBlockedIn(others, date)) {
            throw new Error('已有「重新过关 / 未过关」记录，不能再选「提前完成」');
        }
    }

    // 同一个学生、同一轮次、同一天只保留一个检查状态：这天已有记录时，把它改成新的结果（不新增）。计划（recPlan）不受这条限制
    function addCheck(data) {
        return AppState._commit((s) => {
            const date = data.date || Utils.today();
            guardCheck(real(s.recChecks).filter((c) => c.roundId === data.roundId && c.studentId === data.studentId), data.result, date, null);
            const same = real(s.recChecks).find((c) => c.roundId === data.roundId && c.studentId === data.studentId && c.date === date);
            if (same) {
                same.result = data.result;
                same.note = data.note || '';
                if (data.photoIds) same.photoIds = data.photoIds.slice();
                if (data.audioIds) { if (data.audioIds.length) same.audioIds = data.audioIds.slice(); else delete same.audioIds; }
                same.createdAt = Date.now();
                return same;
            }
            const check = {
                id: Utils.uid('chk'),
                roundId: data.roundId,
                studentId: data.studentId,
                date,
                result: data.result,
                note: data.note || '',
                createdAt: Date.now()
            };
            if (data.photoIds && data.photoIds.length) check.photoIds = data.photoIds.slice();
            if (data.audioIds && data.audioIds.length) check.audioIds = data.audioIds.slice();
            s.recChecks.push(check);
            return check;
        });
    }

    // 编辑一条检查记录（结果 / 日期 / 备注）
    function updateCheck(id, patch) {
        return AppState._commit((s) => {
            const c = s.recChecks.find((x) => x.id === id);
            if (!c) return;
            // 结果和日期都没变（只改备注 / 照片）不受限制
            if (isNote(c)) {   // 笔记：只改文字 / 照片 / 语音
                c.note = patch.note || '';
                if (patch.photoIds) { if (patch.photoIds.length) c.photoIds = patch.photoIds.slice(); else delete c.photoIds; }
                if (patch.audioIds) { if (patch.audioIds.length) c.audioIds = patch.audioIds.slice(); else delete c.audioIds; }
                return;
            }
            const mine = real(s.recChecks).filter((x) => x.roundId === c.roundId && x.studentId === c.studentId);
            if (patch.result !== c.result && lastIn(mine) === c && isArchiveResult(c.result)) {
                throw new Error(`这条「${RESULT_MAP[c.result].label}」已归档，只能修改备注和照片；要改状态请删除这条记录`);
            }
            if (!(patch.result === c.result && (patch.date || c.date) === c.date)) {
                guardCheck(mine, patch.result, patch.date || c.date, c.id);
            }
            c.result = patch.result;
            c.date = patch.date || c.date;
            c.note = patch.note || '';
            if (patch.photoIds) c.photoIds = patch.photoIds.slice();
            if (patch.audioIds) { if (patch.audioIds.length) c.audioIds = patch.audioIds.slice(); else delete c.audioIds; }
            // 改到的那天如果已有另一条记录，按「同一天只有一个状态」用这条替换掉它
            s.recChecks = s.recChecks.filter((x) => x.id === c.id || isNote(x)
                || !(x.roundId === c.roundId && x.studentId === c.studentId && x.date === c.date));
        });
    }

    function removeCheck(id) {
        return AppState._commit((s) => { s.recChecks = s.recChecks.filter((c) => c.id !== id); });
    }

    // 单轮次的状态统计；passed = 提前完成 + 过关 + 条件过关
    function roundSummary(roundId, students) {
        const counts = { excel: 0, pass: 0, cond: 0, retry: 0, fail: 0, none: 0 };
        (students || AppState.getStudents()).forEach((stu) => { counts[statusOf(roundId, stu.id)]++; });
        counts.passed = counts.excel + counts.pass + counts.cond;
        return counts;
    }

    // 每个学生全部轮次里「提前完成 + 完成过关 + 条件过关」的检查记录条数（含已归档的）：studentId -> 次数（1.44.0，背诵页名字旁显示）
    function passedTotals() {
        const map = new Map();
        real(state().recChecks).forEach((c) => { if (isPassed(c.result)) map.set(c.studentId, (map.get(c.studentId) || 0) + 1); });
        return map;
    }

    // ---------- 背诵计划 ----------

    // 某生某轮次的计划，按日期正序
    function plansFor(roundId, studentId) {
        return state().recPlans
            .filter((p) => p.roundId === roundId && p.studentId === studentId)
            .sort((a, b) => a.date.localeCompare(b.date));
    }

    // 计划是否已完成（1.33.0 起每次都按这个学生本轮的全部检查记录现算，不看保存的先后顺序）：
    //   计划日期之后有任何检查记录 → 完成（已经背过了）
    //   计划当天或之后有过关的检查（提前完成 / 完成过关 / 条件过关）→ 完成
    //     （以前要求"检查是在加计划之后登记的"：同一次保存里先存检查、再存计划，当天过关的计划就一直不打勾，要等到第二天）
    //   只有计划当天的 重新过关 / 未过关：计划日期已过去 → 完成；是今天 → 这条检查是加计划之后登记的才算完成
    //     （今天已经判了重新过关、又给今天加计划 = 今天还要再背一次，之前那次不算）
    function isPlanDone(plan) {
        const checks = real(state().recChecks).filter((c) => c.roundId === plan.roundId && c.studentId === plan.studentId && c.date >= plan.date);
        if (!checks.length) return false;
        if (checks.some((c) => c.date > plan.date || isPassed(c.result))) return true;
        if (plan.date < Utils.today()) return true;
        return checks.some((c) => (c.createdAt || 0) >= (plan.createdAt || 0));
    }

    // 还没完成的计划（待办），按日期正序
    function pendingPlans(roundId, studentId) {
        return plansFor(roundId, studentId).filter((p) => !isPlanDone(p));
    }

    // 批量加入计划：studentIds × dates（dates 可以是单个日期或数组）；已存在的同一天计划跳过。返回实际新增数量
    // notes（可选）：{ 'YYYY-MM-DD': 备注 } —— 给新增的那天的计划写备注（1.26.0）
    function addPlans(roundId, studentIds, dates, notes) {
        const list = (Array.isArray(dates) ? dates : [dates]).filter(Boolean);
        return AppState._commit((s) => {
            let added = 0;
            studentIds.forEach((studentId) => {
                // 已归档（提前完成 / 完成过关 / 条件过关 / 未过关）的学生不能再加计划
                if (lockedIn(real(s.recChecks).filter((c) => c.roundId === roundId && c.studentId === studentId))) return;
                list.forEach((date) => {
                    if (s.recPlans.some((p) => p.roundId === roundId && p.studentId === studentId && p.date === date)) return;
                    const plan = { id: Utils.uid('plan'), roundId, studentId, date, createdAt: Date.now() };
                    if (notes && notes[date]) plan.note = notes[date];
                    s.recPlans.push(plan);
                    added++;
                });
            });
            return added;
        });
    }

    // 改计划的备注（comment）；空串 = 删除备注字段
    function setPlanNote(id, note) {
        return AppState._commit((s) => {
            const p = s.recPlans.find((x) => x.id === id);
            if (!p) return;
            if (note) p.note = note; else delete p.note;
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

    // 某天所在周的周一
    function weekStartOf(dateStr) {
        return Utils.addDays(dateStr, -((Utils.parseDate(dateStr).getDay() + 6) % 7));
    }

    // 轮次设定的具体日期（精细排序用）：新建/编辑时选的那天；1.28.0–1.28.4 只有 weekStart（取周一）；更老的按创建当天
    function roundDay(r) {
        return r.day || r.weekStart || Utils.toDateStr(new Date(r.createdAt || Date.now()));
    }

    // 轮次所属周（周一日期，粗略分组用）：由设定日期推出
    function roundWeek(r) {
        return weekStartOf(roundDay(r));
    }

    // 今日背诵剩余人数：今天还有未完成计划的学生（跨轮次去重）
    // 本周背诵剩余人数：本周轮次里，状态不是 提前完成 / 过关 / 条件过关 的学生人次
    function remainingCounts() {
        const today = Utils.today();
        const thisWeek = weekStartOf(today);
        const todayIds = new Set(schedule().filter((x) => !x.overdue && x.nextDate === today).map((x) => x.student.id));
        let week = 0;
        const students = AppState.getStudents();
        rounds().filter((r) => roundWeek(r) === thisWeek).forEach((r) => {
            students.forEach((s) => { if (!isPassed(statusOf(r.id, s.id))) week++; });
        });
        return { today: todayIds.size, week };
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
                notes: notesFor(round.id, studentId),
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
        RESULTS, RESULT_MAP, NONE, NOTE, PLAN, isPassed, isArchiveResult, isUndated, moveSide, removeGroup,
        rounds, roundLayout, getRound, createRound, updateRound, removeRound,
        checksFor, notesFor, addNote, latestCheck, isLocked, lockedResult, canExcel, progressOf, statusOf, addCheck, updateCheck, removeCheck, roundSummary, passedTotals,
        plansFor, pendingPlans, isPlanDone, addPlans, setPlanNote, removePlan,
        schedule, nextArrangement, dueToday, reminderCounts, remainingCounts, weekStartOf, roundWeek, roundDay, studentOverview
    };
})();
