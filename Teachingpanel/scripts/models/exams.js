// models/exams.js —— 考试业务逻辑：考试增删改、成绩录入、TXT 导入解析/导出、统计
// 全局命名空间：window.ExamModel
//
// 成绩 TXT 格式：每行「姓名 成绩 班级排名 [年级排名]」，例如
//   杨迪 101 3 25
//   罗门 103 1 NA
// 姓名、成绩、班级排名必填；年级排名可省略，也可写 NA / - ，都表示没有年级排名。
// 导出的文件第一行是表头「姓名 得分 班级排名 年级排名」（1.33.1 起）；导入时以「姓名」开头的表头行自动跳过。
// 分隔符兼容半角/全角空格、Tab、逗号；按姓名匹配当前班级学生（姓名在班级内唯一）。
// 排名存在考试的可选字段 classRanks / gradeRanks（{ [studentId]: 正整数 }），无需升 schema。

(function () {
    'use strict';

    function state() { return AppState.getState(); }

    function list(filter) {
        const f = filter || {};
        const classId = AppState.getActiveClassId();
        return state().exams
            .filter((e) => e.classId === classId)
            .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
    }

    function get(id) { return state().exams.find((e) => e.id === id) || null; }

    function create(data) {
        return AppState._commit((s) => {
            const exam = {
                id: Utils.uid('exam'),
                classId: AppState.getActiveClassId(),
                name: data.name || '考试',
                date: data.date || Utils.today(),
                fullScore: Number(data.fullScore) || 100,
                createdAt: Date.now(),
                scores: {}
            };
            s.exams.push(exam);
            return exam;
        });
    }

    function update(id, patch) {
        return AppState._commit(() => {
            const e = get(id);
            if (e) Object.assign(e, patch);
        });
    }

    function remove(id) {
        return AppState._commit((s) => { s.exams = s.exams.filter((e) => e.id !== id); });
    }

    // scores: { [studentId]: number|null }，null 表示清除（缺考，同时清掉排名）
    // ranks（可选，导入用）: { [studentId]: { cls: 正整数, grade: 正整数|null } }
    function setScores(examId, scores, ranks) {
        return AppState._commit(() => {
            const exam = get(examId);
            if (!exam) return;
            Object.keys(scores).forEach((sid) => {
                const v = scores[sid];
                if (v == null || Number.isNaN(v)) {
                    delete exam.scores[sid];
                    if (exam.classRanks) delete exam.classRanks[sid];
                    if (exam.gradeRanks) delete exam.gradeRanks[sid];
                } else exam.scores[sid] = v;
            });
            if (ranks) {
                Object.keys(ranks).forEach((sid) => {
                    const r = ranks[sid];
                    if (!r || exam.scores[sid] == null) return;
                    if (!exam.classRanks) exam.classRanks = {};
                    exam.classRanks[sid] = r.cls;
                    if (r.grade != null) {
                        if (!exam.gradeRanks) exam.gradeRanks = {};
                        exam.gradeRanks[sid] = r.grade;
                    } else if (exam.gradeRanks) delete exam.gradeRanks[sid];
                });
            }
        });
    }

    function parseScore(str) {
        const s = String(str).trim();
        if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
        return Number(s);
    }

    // 排名：正整数；年级排名允许 NA / N/A / - / 无 表示没有
    function parseRank(str) {
        const s = String(str).trim();
        if (!/^\d+$/.test(s) || Number(s) < 1) return undefined;
        return Number(s);
    }
    function isNA(str) { return /^(na|n\/a|-|—|无)$/i.test(String(str).trim()); }

    // 解析 TXT 文本 -> 预览结果（不写入）
    // 每行「姓名 成绩 班级排名 [年级排名]」
    // { matched: [{student, score, cls, grade, line}], unknown: [{name, line}], invalid: [line], duplicates: [name] }
    function parseTxt(text) {
        const result = { matched: [], unknown: [], invalid: [], duplicates: [] };
        const seen = {};
        String(text || '').replace(/^﻿/, '').split(/\r?\n/).forEach((raw) => {
            const line = raw.trim();
            if (!line) return;
            if (/^姓名[\s,，\t　]/.test(line) && !/\d/.test(line)) return;   // 表头行（导出的 TXT 第一行）
            const parts = line.split(/[\s,，\t　]+/).filter(Boolean);
            // 姓名 = 第一个纯数字片段之前的部分；其后依次是 成绩、班级排名、[年级排名]
            const first = parts.findIndex((p) => parseScore(p) != null);
            const rest = first > 0 ? parts.slice(first) : [];
            if (first <= 0 || rest.length < 2 || rest.length > 3) { result.invalid.push(line); return; }
            const name = parts.slice(0, first).join('');
            const score = parseScore(rest[0]);
            const cls = parseRank(rest[1]);
            let grade = null;
            if (rest.length === 3 && !isNA(rest[2])) {
                grade = parseRank(rest[2]);
                if (grade === undefined) { result.invalid.push(line); return; }
            }
            if (cls === undefined) { result.invalid.push(line); return; }
            const stu = AppState.getStudents().find((x) => x.name === name) || null;   // 只匹配在读学生（转出 / 休学的不导入）
            if (!stu) { result.unknown.push({ name, line }); return; }
            const item = { student: stu, score, cls, grade, line };
            if (seen[stu.id] != null) {
                // 同名重复出现：以最后一行为准
                result.duplicates.push(name);
                result.matched[seen[stu.id]] = item;
                return;
            }
            seen[stu.id] = result.matched.length;
            result.matched.push(item);
        });
        return result;
    }

    function formatScore(v) {
        return v == null ? '' : String(Math.round(v * 100) / 100);
    }

    // 导出为 TXT：第一行表头「姓名 得分 班级排名 年级排名」（1.33.1 起，方便别的程序识别字段），
    // 之后每行「姓名 成绩 班级排名 年级排名(没有写 NA)」，空格分隔，按学号顺序，缺考（无成绩）的学生不输出
    function exportTxt(examId) {
        const exam = get(examId);
        if (!exam) return '';
        const st = stats(exam);
        return '姓名 得分 班级排名 年级排名\n' + AppState.getStudents()
            .filter((stu) => exam.scores[stu.id] != null)
            .map((stu) => `${stu.name} ${formatScore(exam.scores[stu.id])} ${st.ranks[stu.id]} ${st.gradeRanks[stu.id] || 'NA'}`)
            .join('\n') + '\n';
    }

    // 单场统计：只统计当前班级在册学生的成绩
    function stats(exam) {
        const students = AppState.getStudents();
        const entries = students
            .filter((stu) => exam.scores[stu.id] != null)
            .map((stu) => ({ student: stu, score: exam.scores[stu.id] }))
            .sort((a, b) => b.score - a.score);
        const values = entries.map((x) => x.score);
        const n = values.length;
        const passLine = exam.fullScore * (AppState.getState().settings.passPercent || 60) / 100;
        // 并列同分同名次（1,2,2,4）
        // 导入时带的班级排名优先；没有（手工录入的成绩）才按分数计算
        const ranks = {};
        const gradeRanks = {};
        const computed = {};
        entries.forEach((x, i) => {
            computed[x.student.id] = i > 0 && x.score === entries[i - 1].score ? computed[entries[i - 1].student.id] : i + 1;
        });
        entries.forEach((x) => {
            const id = x.student.id;
            ranks[id] = (exam.classRanks && exam.classRanks[id]) || computed[id];
            if (exam.gradeRanks && exam.gradeRanks[id]) gradeRanks[id] = exam.gradeRanks[id];
        });
        return {
            count: n,
            total: students.length,
            avg: n ? values.reduce((a, b) => a + b, 0) / n : null,
            max: n ? values[0] : null,
            min: n ? values[n - 1] : null,
            passRate: n ? values.filter((v) => v >= passLine).length / n : null,
            passLine,
            entries,
            ranks,
            gradeRanks
        };
    }

    // 分数段分布：按满分的 10% 划分 10 段（最后一段含满分）
    function distribution(exam) {
        const bins = new Array(10).fill(0);
        stats(exam).entries.forEach((x) => {
            const ratio = exam.fullScore ? x.score / exam.fullScore : 0;
            bins[Math.max(0, Math.min(9, Math.floor(ratio * 10)))]++;
        });
        return bins.map((count, i) => ({
            label: `${Math.round(exam.fullScore * i / 10)}-`,
            count
        }));
    }

    // 某学生的历次考试（时间正序）：[{exam, score, rank, gradeRank, count, avg}]
    function studentHistory(studentId, filter) {
        return list(filter).slice().reverse().map((exam) => {
            const st = stats(exam);
            return {
                exam,
                score: exam.scores[studentId] != null ? exam.scores[studentId] : null,
                rank: st.ranks[studentId] || null,
                gradeRank: st.gradeRanks[studentId] || null,
                count: st.count,
                avg: st.avg
            };
        });
    }

    window.ExamModel = {
        list, get, create, update, remove, setScores,
        parseTxt, exportTxt, formatScore, stats, distribution, studentHistory
    };
})();
