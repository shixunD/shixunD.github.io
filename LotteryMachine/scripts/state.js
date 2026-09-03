// state.js —— 数据模型、IndexedDB 持久化、权重计算、多班级管理
// 全局命名空间：window.AppState
//
// 数据分两层：
//   state.classes   —— 班级数组，每个班级 { id, name, students: Student[] }
//   state.activeClassId —— 当前正在查看/操作的班级 id
// 抽奖页/录入页看到的"学生名单"，实际上都是"当前激活班级"的 students。

(function () {
    'use strict';

    const DB_NAME = 'lottery-machine-db';
    const DB_VERSION = 1;
    const STORE_NAME = 'app-state';
    const STATE_KEY = 'main';

    // 权重公式的基准分：weight = max(1, WEIGHT_BASE - score)
    const WEIGHT_BASE = 160;
    const MIN_WEIGHT = 1;

    const DEFAULT_SETTINGS = {
        spinDurationMs: 2000,
        // 中奖弹窗自动关闭的毫秒数；0 表示不自动关闭，需手动点击"好的"
        winnerAutoCloseMs: 5000,
        // 等权抽取：开启后抽奖时忽略每个学生的权重，所有人概率相等；默认关闭
        equalWeightMode: false,
        // 不重复抽取：开启后已经抽中过的学生本轮不再参与抽取（扇区变灰），默认关闭
        noRepeatMode: false,
        // 抽奖快捷键：在抽奖页按下这个键（或组合键，见 ShortcutUtil.formatFromEvent 的标准化格式，如 "Ctrl+T"）
        // 等同于点击"开始抽奖"，默认 PageUp 是为了配合翻页笔／演示遥控器（大多数型号翻页键发送的就是 PageUp/PageDown）
        spinShortcutKey: 'PageUp',
        // 隐藏屏幕底部的"抽取历史"条，默认不开启（即默认显示）
        hideDrawHistory: false
    };

    const DEFAULT_CLASS_NAME = '默认班级';

    // 内存中的当前状态
    let state = {
        classes: [],
        activeClassId: null,
        settings: Object.assign({}, DEFAULT_SETTINGS)
    };

    let db = null;
    let dbReadyPromise = null;
    const listeners = [];

    function openDb() {
        if (dbReadyPromise) return dbReadyPromise;
        dbReadyPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const database = req.result;
                if (!database.objectStoreNames.contains(STORE_NAME)) {
                    database.createObjectStore(STORE_NAME);
                }
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

    function uuid() {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }

    // score -> weight。score 为空/非数字时返回 null（交给调用方决定默认权重）
    function scoreToWeight(score) {
        if (score === null || score === undefined || score === '') return null;
        const n = Number(score);
        if (Number.isNaN(n)) return null;
        return Math.max(MIN_WEIGHT, WEIGHT_BASE - n);
    }

    function normalizeStudent(raw) {
        const student = {
            id: raw.id || uuid(),
            name: (raw.name || '').trim(),
            photoDataUrl: raw.photoDataUrl || null,
            score: raw.score === undefined || raw.score === null || raw.score === '' ? null : Number(raw.score),
            weightMode: raw.weightMode === 'manual' ? 'manual' : 'score',
            weight: MIN_WEIGHT
        };
        if (student.weightMode === 'score') {
            const computed = scoreToWeight(student.score);
            student.weight = computed === null ? MIN_WEIGHT : computed;
        } else {
            const n = Number(raw.weight);
            student.weight = Number.isFinite(n) && n > 0 ? n : MIN_WEIGHT;
        }
        return student;
    }

    function normalizeClass(raw) {
        const students = Array.isArray(raw.students) ? raw.students.map(normalizeStudent) : [];
        const validIds = new Set(students.map((s) => s.id));
        return {
            id: raw.id || uuid(),
            name: (raw.name || DEFAULT_CLASS_NAME).trim() || DEFAULT_CLASS_NAME,
            students,
            // "不重复抽取"模式下本班已经抽过的学生 id 列表，随班级持久化，切换班级/刷新页面都不会丢
            drawnStudentIds: Array.isArray(raw.drawnStudentIds)
                ? raw.drawnStudentIds.filter((id) => validIds.has(id))
                : []
        };
    }

    function makeEmptyClass(name) {
        return { id: uuid(), name: name || DEFAULT_CLASS_NAME, students: [], drawnStudentIds: [] };
    }

    // 兼容旧版本（单班级、无 classes 字段）数据结构，迁移成多班级格式
    function migrateLegacy(saved) {
        const cls = normalizeClass({ name: DEFAULT_CLASS_NAME, students: saved.students || [] });
        return { classes: [cls], activeClassId: cls.id };
    }

    async function load() {
        const saved = await idbGet(STATE_KEY);
        if (saved && Array.isArray(saved.classes) && saved.classes.length > 0) {
            state.classes = saved.classes.map(normalizeClass);
            state.activeClassId = state.classes.some((c) => c.id === saved.activeClassId)
                ? saved.activeClassId
                : state.classes[0].id;
        } else if (saved && Array.isArray(saved.students)) {
            const migrated = migrateLegacy(saved);
            state.classes = migrated.classes;
            state.activeClassId = migrated.activeClassId;
        } else {
            const cls = makeEmptyClass('班级 1');
            state.classes = [cls];
            state.activeClassId = cls.id;
        }
        state.settings = Object.assign({}, DEFAULT_SETTINGS, (saved && saved.settings) || {});
        await persist();
        return state;
    }

    function persist() {
        return idbSet(STATE_KEY, {
            classes: state.classes,
            activeClassId: state.activeClassId,
            settings: state.settings
        });
    }

    function notify() {
        listeners.forEach((fn) => {
            try { fn(state); } catch (e) { console.error('[state] listener error', e); }
        });
    }

    function subscribe(fn) {
        listeners.push(fn);
        return () => {
            const idx = listeners.indexOf(fn);
            if (idx >= 0) listeners.splice(idx, 1);
        };
    }

    function getState() { return state; }

    function getActiveClass() {
        return state.classes.find((c) => c.id === state.activeClassId) || state.classes[0];
    }

    function getClasses() { return state.classes; }
    function getActiveClassId() { return state.activeClassId; }

    async function switchClass(classId) {
        if (!state.classes.some((c) => c.id === classId)) return;
        state.activeClassId = classId;
        await persist();
        notify();
    }

    async function addClass(name) {
        const cls = makeEmptyClass(name);
        state.classes.push(cls);
        state.activeClassId = cls.id;
        await persist();
        notify();
        return cls;
    }

    async function renameClass(classId, name) {
        const cls = state.classes.find((c) => c.id === classId);
        if (!cls) return;
        cls.name = (name || '').trim() || cls.name;
        await persist();
        notify();
    }

    // 删除班级，至少保留一个；若删除的是当前激活班级，自动切换到列表中第一个剩余班级
    async function removeClass(classId) {
        if (state.classes.length <= 1) return false;
        state.classes = state.classes.filter((c) => c.id !== classId);
        if (state.activeClassId === classId) {
            state.activeClassId = state.classes[0].id;
        }
        await persist();
        notify();
        return true;
    }

    function getStudents() {
        const cls = getActiveClass();
        return cls ? cls.students : [];
    }

    function getTotalWeight() {
        return getStudents().reduce((sum, s) => sum + (s.weight || 0), 0);
    }

    async function addStudent(data) {
        const student = normalizeStudent(data || { name: '新同学' });
        getActiveClass().students.push(student);
        await persist();
        notify();
        return student;
    }

    async function updateStudent(id, patch) {
        const students = getStudents();
        const idx = students.findIndex((s) => s.id === id);
        if (idx === -1) return null;
        const merged = Object.assign({}, students[idx], patch);
        students[idx] = normalizeStudent(merged);
        await persist();
        notify();
        return students[idx];
    }

    async function removeStudent(id) {
        const cls = getActiveClass();
        cls.students = cls.students.filter((s) => s.id !== id);
        cls.drawnStudentIds = cls.drawnStudentIds.filter((d) => d !== id);
        await persist();
        notify();
    }

    async function clearStudents() {
        const cls = getActiveClass();
        cls.students = [];
        cls.drawnStudentIds = [];
        await persist();
        notify();
    }

    // "不重复抽取"：当前激活班级已经抽中过的学生 id 列表
    function getDrawnIds() {
        const cls = getActiveClass();
        return cls ? cls.drawnStudentIds : [];
    }

    async function markDrawn(studentId) {
        const cls = getActiveClass();
        if (!cls || cls.drawnStudentIds.includes(studentId)) return;
        cls.drawnStudentIds.push(studentId);
        await persist();
        notify();
    }

    // 清空当前激活班级的"已抽取"记录（点击"重置"按钮，或取消勾选"不重复抽取"时调用）
    async function resetDrawn() {
        const cls = getActiveClass();
        if (!cls) return;
        cls.drawnStudentIds = [];
        await persist();
        notify();
    }

    // 默认名字类型的分数：只有姓名、没有成绩的那种行统一按这个分算权重
    const NAME_ONLY_DEFAULT_SCORE = 130;

    // TXT 批量导入解析（针对当前激活班级）。支持两种格式，二选一，不能混用：
    //   A) 姓名<Tab>成绩   —— 用真正的 Tab 字符分隔，空格不算分隔符
    //   B) 只有姓名        —— 整行就是一个姓名，没有分隔符，成绩固定按 NAME_ONLY_DEFAULT_SCORE 算
    // 返回值二选一：
    //   成功：{ ok: true, created: [{name, score, weight}], updated: [{id, name, oldScore, newScore, oldWeight, newWeight}] }
    //   失败：{ ok: false, issues: [{lineNumber, content, reason}], mixedFormat: boolean }
    //   —— 失败时不会返回任何 created/updated，调用方必须要求用户改完文本重新导入，不允许部分导入。
    function parseImportText(text) {
        const rawLines = text.split(/\r?\n/);
        const parsedLines = [];

        rawLines.forEach((raw, idx) => {
            const line = raw.trim();
            if (!line) return; // 空行直接跳过，不计入问题
            const lineNumber = idx + 1;

            if (line.includes('\t')) {
                const parts = line.split('\t').map((p) => p.trim()).filter((p) => p !== '');
                if (parts.length !== 2) {
                    parsedLines.push({
                        lineNumber, content: line, type: 'invalid',
                        reason: `使用了 Tab 分隔，但有效字段数是 ${parts.length} 个（应为「姓名」+「成绩」两个字段）`
                    });
                    return;
                }
                const [name, scoreStr] = parts;
                const score = Number(scoreStr);
                if (Number.isNaN(score)) {
                    parsedLines.push({
                        lineNumber, content: line, type: 'invalid',
                        reason: `成绩「${scoreStr}」不是有效数字`
                    });
                    return;
                }
                parsedLines.push({ lineNumber, content: line, type: 'score', name, score });
                return;
            }

            if (/\s/.test(line)) {
                parsedLines.push({
                    lineNumber, content: line, type: 'invalid',
                    reason: '含有空格，无法判断是姓名还是"姓名+成绩"——空格不作为分隔符，带成绩请用 Tab 分隔，纯姓名请去掉空格'
                });
                return;
            }

            parsedLines.push({ lineNumber, content: line, type: 'name', name: line, score: NAME_ONLY_DEFAULT_SCORE });
        });

        const invalidLines = parsedLines.filter((l) => l.type === 'invalid');
        const scoreLines = parsedLines.filter((l) => l.type === 'score');
        const nameLines = parsedLines.filter((l) => l.type === 'name');
        const mixedFormat = scoreLines.length > 0 && nameLines.length > 0;

        if (invalidLines.length > 0 || mixedFormat) {
            const issues = invalidLines.map((l) => ({ lineNumber: l.lineNumber, content: l.content, reason: l.reason }));
            if (mixedFormat) {
                scoreLines.forEach((l) => issues.push({ lineNumber: l.lineNumber, content: l.content, reason: '本行是「姓名 + Tab + 成绩」格式' }));
                nameLines.forEach((l) => issues.push({ lineNumber: l.lineNumber, content: l.content, reason: '本行是「仅姓名」格式' }));
            }
            issues.sort((a, b) => a.lineNumber - b.lineNumber);
            return { ok: false, issues, mixedFormat };
        }

        const students = getStudents();
        const created = [];
        const updated = [];
        const seenNames = new Set();
        const validLines = scoreLines.length > 0 ? scoreLines : nameLines;

        validLines.forEach(({ name, score }) => {
            if (seenNames.has(name)) return; // 同一次导入中重复姓名只取第一行
            seenNames.add(name);

            const existing = students.find((s) => s.name === name);
            const newWeight = scoreToWeight(score);
            if (existing) {
                updated.push({
                    id: existing.id,
                    name,
                    oldScore: existing.score,
                    newScore: score,
                    oldWeight: existing.weight,
                    newWeight
                });
            } else {
                created.push({ name, score, weight: newWeight });
            }
        });

        return { ok: true, created, updated };
    }

    // preview.updated 中只有被调用方筛选后（用户选择"覆盖"）的条目才会真正写入
    async function applyScoreImport(preview) {
        const students = getStudents();
        preview.updated.forEach((item) => {
            const idx = students.findIndex((s) => s.id === item.id);
            if (idx === -1) return;
            students[idx] = normalizeStudent(Object.assign({}, students[idx], {
                score: item.newScore,
                weightMode: 'score'
            }));
        });
        preview.created.forEach((item) => {
            students.push(normalizeStudent({
                name: item.name,
                score: item.score,
                weightMode: 'score'
            }));
        });
        await persist();
        notify();
    }

    async function updateSettings(patch) {
        state.settings = Object.assign({}, state.settings, patch);
        await persist();
        notify();
    }

    // 本地导入导出 / OneDrive 备份：整体替换所有班级数据
    async function replaceState(newState) {
        if (Array.isArray(newState.classes) && newState.classes.length > 0) {
            state.classes = newState.classes.map(normalizeClass);
            state.activeClassId = state.classes.some((c) => c.id === newState.activeClassId)
                ? newState.activeClassId
                : state.classes[0].id;
        } else if (Array.isArray(newState.students)) {
            // 兼容导入旧版本（无班级概念）导出的备份文件
            const migrated = migrateLegacy(newState);
            state.classes = migrated.classes;
            state.activeClassId = migrated.activeClassId;
        }
        state.settings = Object.assign({}, DEFAULT_SETTINGS, newState.settings || {});
        await persist();
        notify();
    }

    function exportSnapshot() {
        return {
            classes: state.classes,
            activeClassId: state.activeClassId,
            settings: state.settings,
            exportedAt: new Date().toISOString()
        };
    }

    window.AppState = {
        WEIGHT_BASE,
        MIN_WEIGHT,
        load,
        subscribe,
        getState,
        getStudents,
        getTotalWeight,
        addStudent,
        updateStudent,
        removeStudent,
        clearStudents,
        scoreToWeight,
        parseImportText,
        applyScoreImport,
        updateSettings,
        replaceState,
        exportSnapshot,
        getClasses,
        getActiveClass,
        getActiveClassId,
        switchClass,
        addClass,
        renameClass,
        removeClass,
        getDrawnIds,
        markDrawn,
        resetDrawn,
        uuid
    };
})();
