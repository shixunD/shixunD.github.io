// state.js —— 数据模型核心：IndexedDB 持久化、订阅广播、班级/学生/设置/快捷词、导入导出的迁移与校验
// 全局命名空间：window.AppState
//
// 整个应用只有这一份 state（单一数据源），所有修改必须走 AppState 暴露的方法（或业务模型通过 _commit），
// 由 _commit 负责持久化 + 广播给订阅者重绘页面。作业/背诵/考试的业务方法在 scripts/models/*.js。
//
// 数据结构（详见 PROJECT.md「数据模型」）：
//   classes[]   { id, name }
//   students[]  { id, classId, name, studentNo, note }     姓名在同一班级内唯一
//   homework[]  { id, classId, date, title, note, createdAt, records: { [studentId]: {status, comment, madeUpAt} } }
//   recRounds[] { id, classId, title, content, createdAt, archived }
//   recChecks[] { id, roundId, studentId, date, result, note, createdAt }          （v4 起不再有 nextDates）
//   recPlans[]  { id, roundId, studentId, date, createdAt }   计划某天背诵（还没检查），检查后自动消耗
//   exams[]     { id, classId, name, date, fullScore, createdAt, scores: { [studentId]: number } }
//   settings    { reminderNotify, passPercent, quickPhrases: { homework[], recitation[] } }

(function () {
    'use strict';

    const DB_NAME = 'teaching-panel-db';
    const DB_VERSION = 1;
    const STORE_NAME = 'app-state';
    const STATE_KEY = 'main';

    const SCHEMA_VERSION = 4;
    const APP_ID = 'TeachingPanel';

    const DEFAULT_SETTINGS = {
        // 打开应用时若有到期/逾期的背诵复查，是否额外弹系统通知（需用户授权 Notification）
        reminderNotify: false,
        // 考试统计的及格线（占满分的百分比）
        passPercent: 60
    };

    // comment 快捷词：作业、背诵各一套，主页可编辑
    const DEFAULT_QUICK_PHRASES = {
        homework: [],
        recitation: ['复习体系混乱', '复习体系有条理', '书写有一定问题', '格式需要改善']
    };
    const PHRASE_KINDS = Object.keys(DEFAULT_QUICK_PHRASES);

    const COLLECTIONS = ['classes', 'students', 'homework', 'recRounds', 'recChecks', 'recPlans', 'exams'];

    let state = emptyState();
    let db = null;
    let dbReadyPromise = null;
    const listeners = [];

    function emptyState() {
        return {
            schemaVersion: SCHEMA_VERSION,
            classes: [], students: [],
            homework: [], recRounds: [], recChecks: [], recPlans: [], exams: [],
            activeClassId: null,
            settings: defaultSettings()
        };
    }

    function defaultSettings() {
        return Object.assign({}, DEFAULT_SETTINGS, { quickPhrases: JSON.parse(JSON.stringify(DEFAULT_QUICK_PHRASES)) });
    }

    // ---------- IndexedDB ----------

    function openDb() {
        if (dbReadyPromise) return dbReadyPromise;
        dbReadyPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const database = req.result;
                if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
            };
            req.onsuccess = () => { db = req.result; resolve(db); };
            req.onerror = () => reject(req.error);
        });
        return dbReadyPromise;
    }

    function idbGet(key) {
        return openDb().then((database) => new Promise((resolve, reject) => {
            const tx = database.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        }));
    }

    function idbSet(key, value) {
        return openDb().then((database) => new Promise((resolve, reject) => {
            const tx = database.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        }));
    }

    // ---------- 迁移 / 规范化 ----------
    // load() 与 replaceState()（本地导入、云端恢复共用）两处都必须经过 normalize()，
    // 否则旧版本数据/旧版本导出的备份文件会解析失败被兜底成空状态，表现为"数据凭空消失"。

    // 按 schemaVersion 逐级升级，不要直接改旧字段语义。没有 schemaVersion 的数据视为 v1
    function migrate(raw) {
        const data = Object.assign({}, raw);
        const from = Number(data.schemaVersion) || 1;
        if (from < 2) {
            // v1 -> v2：取消"科目"功能，删除 subjects 列表和各记录上的 subjectId
            delete data.subjects;
            ['homework', 'recRounds', 'exams'].forEach((key) => {
                if (Array.isArray(data[key])) data[key].forEach((x) => { if (x && typeof x === 'object') delete x.subjectId; });
            });
        }
        // v2 -> v3：新增 recPlans（背诵计划）。无需转换，normalize() 会把缺失的集合补成空数组
        if (from < 4) {
            // v3 -> v4："需重新过关 / 未过关"不再带复查日期——把每条检查记录上的 nextDates 转成背诵计划，再删掉 nextDates。
            // 计划的 createdAt 用原检查记录的 createdAt：之后登记的、日期 >= 计划日的检查会让它算完成（与 isPlanDone 规则一致）
            const plans = Array.isArray(data.recPlans) ? data.recPlans.slice() : [];
            const has = new Set(plans.map((p) => `${p.roundId}|${p.studentId}|${p.date}`));
            (Array.isArray(data.recChecks) ? data.recChecks : []).forEach((c) => {
                if (!c || typeof c !== 'object') return;
                (Array.isArray(c.nextDates) ? c.nextDates : []).forEach((date) => {
                    const key = `${c.roundId}|${c.studentId}|${date}`;
                    if (!date || has.has(key)) return;
                    has.add(key);
                    plans.push({ id: Utils.uid('plan'), roundId: c.roundId, studentId: c.studentId, date, createdAt: c.createdAt || 0 });
                });
                delete c.nextDates;
            });
            data.recPlans = plans;
        }
        data.schemaVersion = SCHEMA_VERSION;
        return data;
    }

    function normalize(raw) {
        const data = migrate(raw || {});
        const out = emptyState();
        COLLECTIONS.forEach((key) => {
            out[key] = Array.isArray(data[key]) ? data[key].filter((x) => x && typeof x === 'object' && x.id) : [];
        });
        out.settings = Object.assign(defaultSettings(), data.settings || {});
        out.settings.quickPhrases = normalizePhrases(data.settings && data.settings.quickPhrases);
        out.activeClassId = data.activeClassId || null;

        out.students.forEach((s) => {
            s.name = String(s.name || '').trim();
            s.studentNo = s.studentNo == null ? '' : String(s.studentNo).trim();
            s.note = s.note || '';
        });
        out.homework.forEach((h) => { if (!h.records || typeof h.records !== 'object') h.records = {}; });
        out.exams.forEach((e) => { if (!e.scores || typeof e.scores !== 'object') e.scores = {}; });

        ensureDefaults(out);
        return out;
    }

    // 快捷词深合并：缺哪一组补默认值，非字符串/空串/重复项过滤掉
    function normalizePhrases(raw) {
        const out = {};
        PHRASE_KINDS.forEach((kind) => {
            const list = raw && Array.isArray(raw[kind]) ? raw[kind] : DEFAULT_QUICK_PHRASES[kind];
            out[kind] = Array.from(new Set(list.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean)));
        });
        return out;
    }

    function ensureDefaults(s) {
        if (s.classes.length === 0) s.classes.push({ id: Utils.uid('cls'), name: '默认班级' });
        if (!s.classes.some((c) => c.id === s.activeClassId)) s.activeClassId = s.classes[0].id;
    }

    // 校验导入文件/云端备份是否是本应用的数据。顶层结构变化时必须同步更新这里，并兼容旧版本导出的文件
    function validateSnapshot(obj) {
        return !!obj && typeof obj === 'object' && Array.isArray(obj.classes) && Array.isArray(obj.students);
    }

    // ---------- 读写核心 ----------

    async function load() {
        let saved = null;
        try {
            saved = await idbGet(STATE_KEY);
        } catch (e) {
            console.error('[AppState] 读取 IndexedDB 失败', e);
        }
        state = normalize(saved);
        if (!saved) await persist();
    }

    function persist() {
        return idbSet(STATE_KEY, state).catch((e) => {
            console.error('[AppState] 保存失败', e);
            if (window.Toast) Toast.error('保存失败：' + (e && e.message ? e.message : e));
        });
    }

    function notify() {
        listeners.forEach((fn) => {
            try { fn(state); } catch (e) { console.error('[AppState] listener error', e); }
        });
    }

    // 业务模型修改数据的唯一入口：mutator 直接修改 state，之后统一持久化 + 广播
    async function commit(mutator) {
        const result = mutator(state);
        await persist();
        notify();
        return result;
    }

    function subscribe(fn) { listeners.push(fn); }
    function getState() { return state; }

    function exportSnapshot() {
        return Object.assign({ app: APP_ID, exportedAt: new Date().toISOString() }, JSON.parse(JSON.stringify(state)));
    }

    async function replaceState(data) {
        if (!validateSnapshot(data)) throw new Error('数据格式无效（缺少 classes/students 字段）');
        const next = normalize(JSON.parse(JSON.stringify(data)));
        delete next.app;
        delete next.exportedAt;
        state = next;
        await persist();
        notify();
    }

    // ---------- 班级 ----------

    function getClasses() { return state.classes; }
    function getActiveClass() { return state.classes.find((c) => c.id === state.activeClassId) || state.classes[0]; }
    function getActiveClassId() { return getActiveClass().id; }

    function addClass(name) {
        return commit((s) => {
            const cls = { id: Utils.uid('cls'), name };
            s.classes.push(cls);
            s.activeClassId = cls.id;
            return cls;
        });
    }

    function renameClass(id, name) {
        return commit((s) => {
            const cls = s.classes.find((c) => c.id === id);
            if (cls) cls.name = name;
        });
    }

    // 删除班级：连带删除该班级的学生和所有作业/背诵/考试记录
    function removeClass(id) {
        return commit((s) => {
            if (s.classes.length <= 1) return;
            const roundIds = new Set(s.recRounds.filter((r) => r.classId === id).map((r) => r.id));
            s.classes = s.classes.filter((c) => c.id !== id);
            s.students = s.students.filter((x) => x.classId !== id);
            s.homework = s.homework.filter((x) => x.classId !== id);
            s.recRounds = s.recRounds.filter((x) => x.classId !== id);
            s.recChecks = s.recChecks.filter((x) => !roundIds.has(x.roundId));
            s.recPlans = s.recPlans.filter((x) => !roundIds.has(x.roundId));
            s.exams = s.exams.filter((x) => x.classId !== id);
            if (s.activeClassId === id) s.activeClassId = s.classes[0].id;
        });
    }

    function switchClass(id) {
        return commit((s) => {
            if (s.classes.some((c) => c.id === id)) s.activeClassId = id;
        });
    }

    // ---------- 学生（均指当前激活班级） ----------

    function getStudents() {
        const classId = getActiveClassId();
        return state.students.filter((x) => x.classId === classId).sort(Utils.compareStudentNo);
    }

    function getStudent(id) { return state.students.find((x) => x.id === id) || null; }

    function findStudentByName(name) {
        const classId = getActiveClassId();
        return state.students.find((x) => x.classId === classId && x.name === name) || null;
    }

    function assertUniqueName(name, exceptId) {
        if (!name) throw new Error('姓名不能为空');
        const dup = findStudentByName(name);
        if (dup && dup.id !== exceptId) throw new Error(`本班已有同名学生「${name}」，姓名需唯一（可加后缀区分，如 张三B）`);
    }

    function addStudent(data) {
        const name = String(data.name || '').trim();
        assertUniqueName(name);
        return commit((s) => {
            const stu = {
                id: Utils.uid('stu'),
                classId: getActiveClassId(),
                name,
                studentNo: String(data.studentNo || '').trim(),
                note: data.note || ''
            };
            s.students.push(stu);
            return stu;
        });
    }

    function updateStudent(id, patch) {
        if (patch.name != null) {
            patch.name = String(patch.name).trim();
            assertUniqueName(patch.name, id);
        }
        if (patch.studentNo != null) patch.studentNo = String(patch.studentNo).trim();
        return commit(() => {
            const stu = getStudent(id);
            if (stu) Object.assign(stu, patch);
        });
    }

    // 删除学生：连带清除其所有作业/背诵/考试记录
    function removeStudent(id) {
        return commit((s) => {
            s.students = s.students.filter((x) => x.id !== id);
            s.homework.forEach((h) => { delete h.records[id]; });
            s.recChecks = s.recChecks.filter((c) => c.studentId !== id);
            s.recPlans = s.recPlans.filter((p) => p.studentId !== id);
            s.exams.forEach((e) => { delete e.scores[id]; });
        });
    }

    // 批量添加：每行「学号 姓名」或「姓名 学号」或只有「姓名」（自动接在当前最大学号之后）
    // 返回 { added, skipped: [{line, reason}] }，同名学生跳过不覆盖
    function bulkAddStudents(text) {
        const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const existing = new Set(getStudents().map((x) => x.name));
        const parsed = lines.map((line) => {
            const parts = line.split(/[\s,，\t\u3000]+/).filter(Boolean);
            if (parts.length >= 2 && /^\d+$/.test(parts[0])) return { line, no: parts[0], name: parts.slice(1).join('') };
            if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1])) return { line, no: parts[parts.length - 1], name: parts.slice(0, -1).join('') };
            return { line, no: null, name: parts.join('') };
        });
        // 自动编号要接在"现有学生 + 本次粘贴里显式写了学号的行"的最大值之后，避免和同批次后面的学号撞号
        const numeric = getStudents().map((x) => x.studentNo).concat(parsed.map((p) => p.no)).filter((n) => /^\d+$/.test(n || ''));
        let nextNo = numeric.reduce((m, n) => Math.max(m, Number(n)), 0) + 1;
        const toAdd = [];
        const skipped = [];

        parsed.forEach((p) => {
            if (existing.has(p.name)) { skipped.push({ line: p.line, reason: '姓名已存在' }); return; }
            existing.add(p.name);
            toAdd.push({ name: p.name, studentNo: p.no || String(nextNo++) });
        });

        return commit((s) => {
            const classId = getActiveClassId();
            toAdd.forEach((x) => s.students.push({ id: Utils.uid('stu'), classId, name: x.name, studentNo: x.studentNo, note: '' }));
            return { added: toAdd.length, skipped };
        });
    }

    // ---------- 设置 ----------

    function updateSettings(patch) {
        return commit((s) => { Object.assign(s.settings, patch); });
    }

    // ---------- comment 快捷词（kind: 'homework' | 'recitation'） ----------

    function getQuickPhrases(kind) {
        return (state.settings.quickPhrases && state.settings.quickPhrases[kind]) || [];
    }

    function addQuickPhrase(kind, text) {
        const t = String(text || '').trim();
        if (!t) return Promise.reject(new Error('快捷词不能为空'));
        if (getQuickPhrases(kind).includes(t)) return Promise.reject(new Error('快捷词已存在'));
        return commit((s) => { s.settings.quickPhrases[kind].push(t); });
    }

    function removeQuickPhrase(kind, index) {
        return commit((s) => { s.settings.quickPhrases[kind].splice(index, 1); });
    }

    // dir: -1 上移 / 1 下移
    function moveQuickPhrase(kind, index, dir) {
        return commit((s) => {
            const list = s.settings.quickPhrases[kind];
            const j = index + dir;
            if (j < 0 || j >= list.length) return;
            [list[index], list[j]] = [list[j], list[index]];
        });
    }

    window.AppState = {
        SCHEMA_VERSION,
        load, subscribe, getState, exportSnapshot, replaceState, validateSnapshot,
        _commit: commit,
        getClasses, getActiveClass, getActiveClassId, addClass, renameClass, removeClass, switchClass,
        getStudents, getStudent, findStudentByName, addStudent, updateStudent, removeStudent, bulkAddStudents,
        updateSettings, getQuickPhrases, addQuickPhrase, removeQuickPhrase, moveQuickPhrase
    };
})();
