// dbFile.js —— 导入导出用的 SQLite 数据库文件（.db）：state <-> .db 二进制
// 全局命名空间：window.DbFile
//
// 浏览器内部仍用 IndexedDB 整份存储（state.js）；只有"导出 / 导入 / OneDrive 备份恢复"走 .db 文件。
// SQLite 引擎用 sql.js（WebAssembly，放在 scripts/vendor/，离线可用），第一次导出/导入时才按需加载。
//
// 表结构见 TABLES / 下方 SCHEMA_SQL（PROJECT.md「导入导出（.db）」有说明）。约定：
//   - 主表的固定列与 state 字段一一对应；不在固定列里的字段一律放进该行的 extra 列（JSON），
//     这样以后给记录加了新字段，导出时也不会丢 —— 保持"全量"导出。
//   - 字段值为 undefined -> 列为 NULL，读回时不设置该字段；字段值为 null -> 记进 extra，读回时还原成 null。
//   - 导入：校验 SQLite 文件头、meta.app、必需的表，拼回与 AppState.exportSnapshot() 同结构的对象，
//     再交给 AppState.replaceState()（沿用 normalize / 旧版本迁移）。

(function () {
    'use strict';

    const APP_ID = 'TeachingPanel';
    const VENDOR_DIR = './scripts/vendor/';

    // 主表：state 集合名 -> { table, cols: [[字段, 列名, 类型]], nested: 由子表单独存放的字段 }
    // 类型：'text' | 'int' | 'real' | 'bool'（bool 存 0/1）
    const TABLES = [
        { key: 'classes', table: 'classes', cols: [['id', 'id', 'text'], ['name', 'name', 'text']] },
        {
            key: 'students', table: 'students',
            cols: [['id', 'id', 'text'], ['classId', 'class_id', 'text'], ['studentNo', 'student_no', 'text'], ['name', 'name', 'text'], ['note', 'note', 'text']]
        },
        {
            key: 'homework', table: 'homework', nested: ['records'],
            cols: [['id', 'id', 'text'], ['classId', 'class_id', 'text'], ['date', 'date', 'text'], ['title', 'title', 'text'], ['note', 'note', 'text'], ['createdAt', 'created_at', 'int']]
        },
        {
            key: 'recRounds', table: 'rec_rounds',
            cols: [['id', 'id', 'text'], ['classId', 'class_id', 'text'], ['title', 'title', 'text'], ['content', 'content', 'text'], ['archived', 'archived', 'bool'], ['createdAt', 'created_at', 'int']]
        },
        {
            key: 'recChecks', table: 'rec_checks', nested: ['nextDates'],
            cols: [['id', 'id', 'text'], ['roundId', 'round_id', 'text'], ['studentId', 'student_id', 'text'], ['date', 'date', 'text'], ['result', 'result', 'text'], ['note', 'note', 'text'], ['createdAt', 'created_at', 'int']]
        },
        {
            key: 'recPlans', table: 'rec_plans',
            cols: [['id', 'id', 'text'], ['roundId', 'round_id', 'text'], ['studentId', 'student_id', 'text'], ['date', 'date', 'text'], ['createdAt', 'created_at', 'int']]
        },
        {
            key: 'exams', table: 'exams', nested: ['scores'],
            cols: [['id', 'id', 'text'], ['classId', 'class_id', 'text'], ['name', 'name', 'text'], ['date', 'date', 'text'], ['fullScore', 'full_score', 'real'], ['createdAt', 'created_at', 'int']]
        }
    ];
    const HW_RECORD_COLS = [['status', 'status', 'text'], ['comment', 'comment', 'text'], ['madeUpAt', 'made_up_at', 'text']];
    const SQL_TYPE = { text: 'TEXT', int: 'INTEGER', real: 'REAL', bool: 'INTEGER' };

    // 顶层里由专门的表/位置存放的字段；其余未知的顶层字段写进 meta（key = 'extra:字段名'），同样不丢
    const TOP_LEVEL_KNOWN = new Set(['app', 'exportedAt', 'schemaVersion', 'activeClassId', 'settings'].concat(TABLES.map((t) => t.key)));

    function schemaSql() {
        const main = TABLES.map((t) => {
            const cols = t.cols.map(([, col, type]) => `${col} ${SQL_TYPE[type]}${col === 'id' ? ' PRIMARY KEY' : ''}`);
            return `CREATE TABLE ${t.table} (${cols.join(', ')}, extra TEXT);`;
        });
        return [
            'CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);',
            'CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);',
            'CREATE TABLE quick_phrases (kind TEXT, position INTEGER, text TEXT, PRIMARY KEY (kind, position));',
            ...main,
            'CREATE TABLE homework_records (homework_id TEXT, student_id TEXT, status TEXT, comment TEXT, made_up_at TEXT, extra TEXT, PRIMARY KEY (homework_id, student_id));',
            'CREATE TABLE rec_check_dates (check_id TEXT, position INTEGER, date TEXT, PRIMARY KEY (check_id, position));',
            'CREATE TABLE exam_scores (exam_id TEXT, student_id TEXT, score REAL, PRIMARY KEY (exam_id, student_id));'
        ].join('\n');
    }

    const REQUIRED_TABLES = ['meta', 'settings', 'quick_phrases', 'homework_records', 'rec_check_dates', 'exam_scores'].concat(TABLES.map((t) => t.table));

    // ---------- sql.js 按需加载 ----------

    let sqlPromise = null;

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.onload = () => resolve();
            s.onerror = () => { s.remove(); reject(new Error('数据库组件加载失败，请检查网络后重试')); };
            document.head.appendChild(s);
        });
    }

    function load() {
        if (sqlPromise) return sqlPromise;
        sqlPromise = (async () => {
            if (typeof window.initSqlJs !== 'function') await loadScript(VENDOR_DIR + 'sql-wasm.js');
            return window.initSqlJs({ locateFile: (file) => VENDOR_DIR + file });
        })().catch((e) => { sqlPromise = null; throw e; });
        return sqlPromise;
    }

    // ---------- 行 <-> 对象 ----------

    function toColumn(value, type) {
        if (value === undefined || value === null) return null;
        if (type === 'bool') return value ? 1 : 0;
        return value;
    }

    function fromColumn(value, type) {
        if (type === 'bool') return value === 1;
        return value;
    }

    // 对象 -> [固定列的值..., extra]；null 值和不在固定列里的字段进 extra
    function splitRow(obj, cols, nested) {
        const known = new Set(cols.map((c) => c[0]).concat(nested || []));
        const extra = {};
        Object.keys(obj).forEach((k) => {
            if (!known.has(k)) extra[k] = obj[k];
            else if (obj[k] === null && !(nested || []).includes(k)) extra[k] = null;
        });
        const values = cols.map(([field, , type]) => toColumn(obj[field], type));
        values.push(Object.keys(extra).length ? JSON.stringify(extra) : null);
        return values;
    }

    // 行（列名 -> 值）-> 对象；NULL 列不设置字段，再合并 extra
    function joinRow(row, cols) {
        const obj = {};
        cols.forEach(([field, col, type]) => {
            if (row[col] !== null && row[col] !== undefined) obj[field] = fromColumn(row[col], type);
        });
        if (row.extra) Object.assign(obj, JSON.parse(row.extra));
        return obj;
    }

    function insertAll(db, sql, rows) {
        if (!rows.length) return;
        const stmt = db.prepare(sql);
        try {
            rows.forEach((r) => stmt.run(r));
        } finally {
            stmt.free();
        }
    }

    function selectAll(db, sql) {
        const stmt = db.prepare(sql);
        const out = [];
        try {
            while (stmt.step()) out.push(stmt.getAsObject());
        } finally {
            stmt.free();
        }
        return out;
    }

    // ---------- 导出 ----------

    async function exportBytes(snapshot) {
        const SQL = await load();
        const db = new SQL.Database();
        try {
            db.run('BEGIN;');
            db.exec(schemaSql());

            const meta = [
                ['app', JSON.stringify(snapshot.app || APP_ID)],
                ['schemaVersion', JSON.stringify(snapshot.schemaVersion)],
                ['exportedAt', JSON.stringify(snapshot.exportedAt || new Date().toISOString())],
                ['activeClassId', JSON.stringify(snapshot.activeClassId === undefined ? null : snapshot.activeClassId)]
            ];
            Object.keys(snapshot).filter((k) => !TOP_LEVEL_KNOWN.has(k)).forEach((k) => meta.push([`extra:${k}`, JSON.stringify(snapshot[k])]));
            insertAll(db, 'INSERT INTO meta VALUES (?, ?);', meta);

            const settings = Object.assign({}, snapshot.settings || {});
            const phrases = settings.quickPhrases || {};
            delete settings.quickPhrases;
            // 快捷词的分组名单独记一份：某组被删空时 quick_phrases 里没有行，导入时仍要还原成空数组（而不是补回默认词）
            insertAll(db, 'INSERT INTO meta VALUES (?, ?);', [['quickPhraseKinds', JSON.stringify(Object.keys(phrases))]]);
            insertAll(db, 'INSERT INTO settings VALUES (?, ?);', Object.keys(settings).map((k) => [k, JSON.stringify(settings[k])]));
            const phraseRows = [];
            Object.keys(phrases).forEach((kind) => (phrases[kind] || []).forEach((text, i) => phraseRows.push([kind, i, text])));
            insertAll(db, 'INSERT INTO quick_phrases VALUES (?, ?, ?);', phraseRows);

            TABLES.forEach((t) => {
                const list = snapshot[t.key] || [];
                const placeholders = t.cols.map(() => '?').concat('?').join(', ');
                insertAll(db, `INSERT INTO ${t.table} VALUES (${placeholders});`, list.map((obj) => splitRow(obj, t.cols, t.nested)));
            });

            const recRows = [];
            (snapshot.homework || []).forEach((hw) => Object.keys(hw.records || {}).forEach((sid) => {
                recRows.push([hw.id, sid].concat(splitRow(hw.records[sid], HW_RECORD_COLS)));
            }));
            insertAll(db, 'INSERT INTO homework_records VALUES (?, ?, ?, ?, ?, ?);', recRows);

            const dateRows = [];
            (snapshot.recChecks || []).forEach((c) => (c.nextDates || []).forEach((d, i) => dateRows.push([c.id, i, d])));
            insertAll(db, 'INSERT INTO rec_check_dates VALUES (?, ?, ?);', dateRows);

            const scoreRows = [];
            (snapshot.exams || []).forEach((e) => Object.keys(e.scores || {}).forEach((sid) => scoreRows.push([e.id, sid, e.scores[sid]])));
            insertAll(db, 'INSERT INTO exam_scores VALUES (?, ?, ?);', scoreRows);

            db.run('COMMIT;');
            return db.export();
        } finally {
            db.close();
        }
    }

    // ---------- 导入 ----------

    function isSqliteFile(bytes) {
        const head = 'SQLite format 3\u0000';
        if (!bytes || bytes.length < head.length) return false;
        for (let i = 0; i < head.length; i++) if (bytes[i] !== head.charCodeAt(i)) return false;
        return true;
    }

    async function importBytes(input) {
        const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
        if (!isSqliteFile(bytes)) throw new Error('这不是数据库文件（.db），请选择本应用导出的数据库文件');
        const SQL = await load();
        let db;
        try {
            db = new SQL.Database(bytes);
        } catch (e) {
            throw new Error('数据库文件已损坏，无法打开');
        }
        try {
            const tables = new Set(selectAll(db, "SELECT name FROM sqlite_master WHERE type = 'table';").map((r) => r.name));
            if (!tables.has('meta')) throw new Error('不是本应用导出的数据库文件');
            const missing = REQUIRED_TABLES.filter((t) => !tables.has(t));
            if (missing.length) throw new Error('数据库文件不完整（缺少表：' + missing.join('、') + '）');

            const meta = {};
            selectAll(db, 'SELECT key, value FROM meta;').forEach((r) => { meta[r.key] = JSON.parse(r.value); });
            if (meta.app !== APP_ID) throw new Error('不是本应用导出的数据库文件');
            if (Number(meta.schemaVersion) > AppState.SCHEMA_VERSION) {
                throw new Error('这个数据库来自更新版本的学情看板，请先更新本页面（主页 → 检查更新）后再导入');
            }

            const snap = { app: APP_ID, exportedAt: meta.exportedAt, schemaVersion: meta.schemaVersion, activeClassId: meta.activeClassId };
            Object.keys(meta).filter((k) => k.startsWith('extra:')).forEach((k) => { snap[k.slice(6)] = meta[k]; });

            const settings = {};
            selectAll(db, 'SELECT key, value FROM settings;').forEach((r) => { settings[r.key] = JSON.parse(r.value); });
            const quickPhrases = {};
            (meta.quickPhraseKinds || []).forEach((kind) => { quickPhrases[kind] = []; });
            selectAll(db, 'SELECT kind, text FROM quick_phrases ORDER BY kind, position;').forEach((r) => {
                (quickPhrases[r.kind] = quickPhrases[r.kind] || []).push(r.text);
            });
            settings.quickPhrases = quickPhrases;
            snap.settings = settings;

            TABLES.forEach((t) => {
                snap[t.key] = selectAll(db, `SELECT * FROM ${t.table} ORDER BY rowid;`).map((row) => joinRow(row, t.cols));
            });

            const hwById = {};
            snap.homework.forEach((h) => { h.records = {}; hwById[h.id] = h; });
            selectAll(db, 'SELECT * FROM homework_records ORDER BY rowid;').forEach((row) => {
                const hw = hwById[row.homework_id];
                if (hw) hw.records[row.student_id] = joinRow(row, HW_RECORD_COLS);
            });

            // rec_check_dates：旧版本（schema ≤ 3）的复查日期；新版本没有数据。有才还原 nextDates，导入后由 migrate() 转成背诵计划
            const checkById = {};
            snap.recChecks.forEach((c) => { checkById[c.id] = c; });
            selectAll(db, 'SELECT * FROM rec_check_dates ORDER BY check_id, position;').forEach((row) => {
                const c = checkById[row.check_id];
                if (c) (c.nextDates = c.nextDates || []).push(row.date);
            });

            const examById = {};
            snap.exams.forEach((e) => { e.scores = {}; examById[e.id] = e; });
            selectAll(db, 'SELECT * FROM exam_scores ORDER BY rowid;').forEach((row) => {
                const e = examById[row.exam_id];
                if (e) e.scores[row.student_id] = row.score;
            });

            return snap;
        } finally {
            db.close();
        }
    }

    window.DbFile = { load, exportBytes, importBytes, isSqliteFile, TABLES };
})();
