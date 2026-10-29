// models/homework.js —— 作业业务逻辑：状态定义、作业增删改、单人状态登记、补交、统计
// 全局命名空间：window.HomeworkModel
//
// 记录规则：homework.records 里"没有某个学生的记录" = 默认完全完成（done）。
// 这样新开一项作业不需要给全班每个人写一条记录，只登记少数没完成的人；
// 把学生改回"完全完成"且没有 comment 时，记录会被删除，保持数据精简。

(function () {
    'use strict';

    // 顺序即状态选择器里按钮的顺序。颜色是固定语义色，与主题主色无关
    const STATUSES = [
        { key: 'done', label: '完全完成', short: '完成', color: '#1e8e3e', text: '#fff' },
        { key: 'missing', label: '未完成', short: '未交', color: '#d93025', text: '#fff' },
        { key: 'poor', label: '未按要求完成', short: '不达标', color: '#f48fb1', text: '#5a1030' },
        { key: 'missing_fixed', label: '已补交', short: '已补交', color: '#1a4fa3', text: '#fff' },
        { key: 'poor_fixed', label: '已补改', short: '已补改', color: '#7fb8f0', text: '#0d2c52' }
    ];
    const STATUS_MAP = {};
    STATUSES.forEach((s) => { STATUS_MAP[s.key] = s; });

    // 未补上的问题状态 -> 补上后的状态
    const FIX_MAP = { missing: 'missing_fixed', poor: 'poor_fixed' };

    function state() { return AppState.getState(); }

    // 当前班级的作业，按日期倒序（同日期按创建时间倒序）。filter: {from, to}
    function list(filter) {
        const f = filter || {};
        const classId = AppState.getActiveClassId();
        return state().homework
            .filter((h) => h.classId === classId)
            .filter((h) => !f.from || h.date >= f.from)
            .filter((h) => !f.to || h.date <= f.to)
            .sort((a, b) => (b.date.localeCompare(a.date)) || ((b.createdAt || 0) - (a.createdAt || 0)));
    }

    function get(id) { return state().homework.find((h) => h.id === id) || null; }

    function create(data) {
        return AppState._commit((s) => {
            const hw = {
                id: Utils.uid('hw'),
                classId: AppState.getActiveClassId(),
                date: data.date || Utils.today(),
                title: data.title || '作业',
                note: data.note || '',
                createdAt: Date.now(),
                records: {}
            };
            s.homework.push(hw);
            return hw;
        });
    }

    function update(id, patch) {
        return AppState._commit(() => {
            const hw = get(id);
            if (hw) Object.assign(hw, patch);
        });
    }

    function remove(id) {
        return AppState._commit((s) => { s.homework = s.homework.filter((h) => h.id !== id); });
    }

    function getRecord(hw, studentId) {
        const rec = hw.records[studentId];
        return {
            status: rec && rec.status ? rec.status : 'done',
            comment: rec && rec.comment ? rec.comment : '',
            madeUpAt: rec && rec.madeUpAt ? rec.madeUpAt : null
        };
    }

    function writeRecord(hw, studentId, status, comment) {
        const prev = hw.records[studentId] || {};
        if (status === 'done' && !comment) {
            delete hw.records[studentId];
            return;
        }
        const rec = { status, comment: comment || '' };
        if (status === 'missing_fixed' || status === 'poor_fixed') {
            rec.madeUpAt = prev.madeUpAt && (prev.status === status) ? prev.madeUpAt : Utils.today();
        }
        hw.records[studentId] = rec;
    }

    // patch: {status?, comment?}，未提供的字段保持原值
    function setRecord(hwId, studentId, patch) {
        return AppState._commit(() => {
            const hw = get(hwId);
            if (!hw) return;
            const cur = getRecord(hw, studentId);
            writeRecord(hw, studentId,
                patch.status != null ? patch.status : cur.status,
                patch.comment != null ? patch.comment : cur.comment);
        });
    }

    // 一键"已补上"：未完成 -> 已补交；未按要求 -> 已补改
    function markFixed(hwId, studentId) {
        return AppState._commit(() => {
            const hw = get(hwId);
            if (!hw) return;
            const cur = getRecord(hw, studentId);
            if (FIX_MAP[cur.status]) writeRecord(hw, studentId, FIX_MAP[cur.status], cur.comment);
        });
    }

    function isProblem(status) { return status !== 'done'; }
    function isOutstanding(status) { return status === 'missing' || status === 'poor'; }

    // 单项作业的各状态人数
    function summarize(hw, students) {
        const counts = {};
        STATUSES.forEach((s) => { counts[s.key] = 0; });
        students.forEach((stu) => { counts[getRecord(hw, stu.id).status]++; });
        return counts;
    }

    // 所有仍未补上的记录（欠交清单），按作业分组：[{ hw, items: [{student, rec}] }]
    // 作业顺序同 list()（日期倒序），组内学生按学号
    function outstanding(filter) {
        const students = AppState.getStudents();
        const groups = [];
        list(filter).forEach((hw) => {
            const items = [];
            students.forEach((stu) => {
                const rec = getRecord(hw, stu.id);
                if (isOutstanding(rec.status)) items.push({ student: stu, rec });
            });
            if (items.length) groups.push({ hw, items });
        });
        return groups;
    }

    // 原样取出某条记录（用于撤销）；没有记录返回 null
    function snapshotRecord(hwId, studentId) {
        const hw = get(hwId);
        const rec = hw && hw.records[studentId];
        return rec ? Object.assign({}, rec) : null;
    }

    // 撤销：把记录恢复成 snapshotRecord() 取到的样子（null = 删除记录，即恢复为默认完成）
    function restoreRecord(hwId, studentId, snapshot) {
        return AppState._commit(() => {
            const hw = get(hwId);
            if (!hw) return;
            if (snapshot) hw.records[studentId] = Object.assign({}, snapshot);
            else delete hw.records[studentId];
        });
    }

    function countOutstanding() {
        return outstanding().reduce((n, g) => n + g.items.length, 0);
    }

    // 某学生的统计：各状态次数、按时完成率、最终完成率、按时间顺序的记录（旧 -> 新）
    function studentStats(studentId, filter) {
        const hws = list(filter).slice().reverse();
        const counts = {};
        STATUSES.forEach((s) => { counts[s.key] = 0; });
        const timeline = hws.map((hw) => {
            const rec = getRecord(hw, studentId);
            counts[rec.status]++;
            return { hw, rec };
        });
        const total = hws.length;
        return {
            total,
            counts,
            onTimeRate: total ? counts.done / total : null,
            finalRate: total ? (counts.done + counts.missing_fixed + counts.poor_fixed) / total : null,
            outstanding: counts.missing + counts.poor,
            timeline
        };
    }

    // 按周聚合的按时完成率（用于趋势折线），返回 [{label, rate}]
    function weeklyRates(studentId, filter) {
        const weeks = {};
        list(filter).forEach((hw) => {
            const d = Utils.parseDate(hw.date);
            const monday = Utils.addDays(hw.date, -((d.getDay() + 6) % 7));
            if (!weeks[monday]) weeks[monday] = { total: 0, done: 0 };
            weeks[monday].total++;
            if (getRecord(hw, studentId).status === 'done') weeks[monday].done++;
        });
        return Object.keys(weeks).sort().map((k) => ({ label: Utils.formatDate(k), rate: weeks[k].done / weeks[k].total }));
    }

    window.HomeworkModel = {
        STATUSES, STATUS_MAP, FIX_MAP,
        list, get, create, update, remove,
        getRecord, setRecord, markFixed, snapshotRecord, restoreRecord, isProblem, isOutstanding,
        summarize, outstanding, countOutstanding, studentStats, weeklyRates
    };
})();
