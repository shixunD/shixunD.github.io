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

    // 权重公式的基准分：默认公式 weight = max(1, WEIGHT_BASE - score)，WEIGHT_BASE 仅作为默认公式里的常量使用
    const WEIGHT_BASE = 160;
    const MIN_WEIGHT = 1;
    // 权重公式默认值，g 代表成绩；用户可在设置页自定义（见 evaluateWeightFormula）
    const DEFAULT_WEIGHT_FORMULA = `${WEIGHT_BASE}-g`;

    const DEFAULT_SETTINGS = {
        // 转盘旋转分两个阶段（见 wheel.js 的 spin()）：
        // spinFastMs（x）—— 匀速阶段时长；spinFastTurns —— 这 x 毫秒内固定转几圈（支持小数，如 0.5），营造"公平"的既视感；
        // spinSlowMs（y）—— 减速阶段固定时长，从匀速阶段的转速逐渐匀减速到 0 并精确停在中奖扇区内随机
        // 选中的一点（落点的随机性见 wheel.js 的 SECTOR_LANDING_* 常量，不靠减速时长的随机性来制造悬念——
        // 实测发现减速时长忽长忽短反而会让减速曲线陡峭程度跟着变化，看起来像"突然刹车"而不是缓缓停下）
        spinFastMs: 400,
        spinFastTurns: 1,
        spinSlowMs: 2500,
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
        hideDrawHistory: false,
        // 抽奖音效：旋转期间随机播放 spin 素材（倍速匹配旋转时长）、中奖后随机播放 win 素材（原速播完），默认开启
        soundEffectsEnabled: true,
        // 权重计算公式（字符串），g 代表成绩，支持 + - * / ( ) 四则运算，见下方公式解析器
        weightFormula: DEFAULT_WEIGHT_FORMULA
    };

    const DEFAULT_CLASS_NAME = '默认班级';

    // 首次进入应用（IndexedDB 中还没有任何数据）时自动创建的示例班级：DEMO 班 + 50 个模拟学生，默认 130 分
    const DEMO_CLASS_NAME = 'DEMO';
    const DEMO_STUDENT_SCORE = 130;
    const DEMO_STUDENT_NAMES = [
        '王思远', '李雨桐', '张浩然', '刘欣怡', '陈子轩',
        '杨梓涵', '黄一诺', '赵梓萱', '周皓轩', '吴梦瑶',
        '徐俊杰', '孙悦然', '朱宇航', '马晨曦', '胡雨萱',
        '郭子墨', '林思妍', '何宇轩', '高艺涵', '梁诗涵',
        '谢明轩', '宋佳怡', '唐子豪', '许若曦', '韩雨泽',
        '冯欣妍', '邓皓宇', '曹雨欣', '彭俊熙', '曾梓彤',
        '肖宇宸', '田雨萌', '董思远', '袁梓涵', '潘晨阳',
        '蒋若汐', '蔡子涵', '余思颖', '杜浩宇', '叶欣然',
        '苏子腾', '魏雨桐', '程皓轩', '吕思宇', '丁梓睿',
        '沈欣悦', '任子墨', '姚雨萱', '卢梓萌', '姜宇泽'
    ];

    function makeDemoClass() {
        const students = DEMO_STUDENT_NAMES.map((name) => normalizeStudent({
            name,
            score: DEMO_STUDENT_SCORE,
            weightMode: 'score'
        }));
        return { id: uuid(), name: DEMO_CLASS_NAME, students, drawnStudentIds: [] };
    }

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

    // ---- 权重公式解析器：把用户输入的字符串（如 "160-g"、"(150-g)*2"）解析成可求值的表达式 ----
    // 只支持 + - * / ( ) 四则运算、数字、变量 g（代表成绩），任何其它字符都视为"不支持的数学符号"并抛错。
    function tokenizeFormula(formula) {
        const tokens = [];
        let i = 0;
        while (i < formula.length) {
            const ch = formula[i];
            if (/\s/.test(ch)) { i++; continue; }
            if (/[0-9.]/.test(ch)) {
                let j = i;
                let seenDot = false;
                while (j < formula.length && (/[0-9]/.test(formula[j]) || (formula[j] === '.' && !seenDot))) {
                    if (formula[j] === '.') seenDot = true;
                    j++;
                }
                const numStr = formula.slice(i, j);
                if (numStr === '.' || Number.isNaN(Number(numStr))) {
                    throw new Error(`无效的数字："${numStr}"`);
                }
                tokens.push({ type: 'num', value: Number(numStr) });
                i = j;
                continue;
            }
            if (ch === 'g' || ch === 'G') { tokens.push({ type: 'var' }); i++; continue; }
            if ('+-*/()'.includes(ch)) { tokens.push({ type: ch }); i++; continue; }
            throw new Error(`不支持的数学符号："${ch}"`);
        }
        return tokens;
    }

    // 递归下降解析：expr := term (('+'|'-') term)* ；term := factor (('*'|'/') factor)*
    // factor := '-' factor | '(' expr ')' | number | 'g'
    function parseFormulaTokens(tokens) {
        let pos = 0;
        const peek = () => tokens[pos];

        function parseExpr() {
            let node = parseTerm();
            while (peek() && (peek().type === '+' || peek().type === '-')) {
                const op = tokens[pos].type;
                pos++;
                node = { type: 'binop', op, left: node, right: parseTerm() };
            }
            return node;
        }
        function parseTerm() {
            let node = parseFactor();
            while (peek() && (peek().type === '*' || peek().type === '/')) {
                const op = tokens[pos].type;
                pos++;
                node = { type: 'binop', op, left: node, right: parseFactor() };
            }
            return node;
        }
        function parseFactor() {
            const t = peek();
            if (!t) throw new Error('公式不完整');
            if (t.type === '-') { pos++; return { type: 'neg', value: parseFactor() }; }
            if (t.type === '+') { pos++; return parseFactor(); }
            if (t.type === '(') {
                pos++;
                const node = parseExpr();
                if (!peek() || peek().type !== ')') throw new Error('括号不匹配，缺少 ")"');
                pos++;
                return node;
            }
            if (t.type === 'num') { pos++; return { type: 'num', value: t.value }; }
            if (t.type === 'var') { pos++; return { type: 'var' }; }
            throw new Error('公式格式错误，存在意外的符号');
        }

        const ast = parseExpr();
        if (pos !== tokens.length) throw new Error('公式格式错误，存在多余内容');
        return ast;
    }

    function evalFormulaAst(node, g) {
        switch (node.type) {
            case 'num': return node.value;
            case 'var': return g;
            case 'neg': return -evalFormulaAst(node.value, g);
            case 'binop': {
                const l = evalFormulaAst(node.left, g);
                const r = evalFormulaAst(node.right, g);
                if (node.op === '+') return l + r;
                if (node.op === '-') return l - r;
                if (node.op === '*') return l * r;
                if (node.op === '/') return r === 0 ? NaN : l / r;
                throw new Error(`未知运算符："${node.op}"`);
            }
            default:
                throw new Error('无法计算该公式');
        }
    }

    // 把公式字符串编译成 g -> 数值 的函数；公式非法（含不支持的符号/格式错误）时抛出 Error，message 说明原因
    function compileWeightFormula(formula) {
        if (typeof formula !== 'string' || !formula.trim()) throw new Error('公式不能为空');
        const tokens = tokenizeFormula(formula);
        if (tokens.length === 0) throw new Error('公式不能为空');
        const ast = parseFormulaTokens(tokens);
        return (g) => evalFormulaAst(ast, g);
    }

    // 供设置页在保存前校验公式是否合法，不影响当前已保存的公式
    function testWeightFormula(formula) {
        try {
            compileWeightFormula(formula)(100);
            return { ok: true };
        } catch (e) {
            return { ok: false, message: e.message };
        }
    }

    // score -> weight。score 为空/非数字时返回 null（交给调用方决定默认权重）
    // 实际计算公式取自 settings.weightFormula（用户可自定义，见 updateWeightFormula）；
    // 公式对当前 score 求值失败（如除以 0）时兜底为 MIN_WEIGHT，而不是让权重变成 NaN/Infinity。
    function scoreToWeight(score) {
        if (score === null || score === undefined || score === '') return null;
        const n = Number(score);
        if (Number.isNaN(n)) return null;
        let result;
        try {
            const formula = (state.settings && state.settings.weightFormula) || DEFAULT_WEIGHT_FORMULA;
            result = compileWeightFormula(formula)(n);
        } catch (e) {
            // 理论上不会发生（保存前已校验），万一发生则退回默认公式，避免权重计算彻底崩溃
            result = WEIGHT_BASE - n;
        }
        if (!Number.isFinite(result)) return MIN_WEIGHT;
        return Math.max(MIN_WEIGHT, result);
    }

    // 修改权重公式：校验通过后保存，并重新计算所有"按成绩自动计算权重"（weightMode==='score'）的学生的权重
    async function updateWeightFormula(formula) {
        const test = testWeightFormula(formula);
        if (!test.ok) throw new Error(test.message);
        state.settings = Object.assign({}, state.settings, { weightFormula: formula });
        state.classes.forEach((cls) => {
            cls.students = cls.students.map((s) => (s.weightMode === 'score' ? normalizeStudent(s) : s));
        });
        await persist();
        notify();
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
            const cls = makeDemoClass();
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
        DEFAULT_WEIGHT_FORMULA,
        testWeightFormula,
        updateWeightFormula,
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
