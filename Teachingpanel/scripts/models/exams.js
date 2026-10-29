// models/exams.js —— 考试业务逻辑：考试增删改、成绩录入、TXT 导入解析/导出、统计
// 全局命名空间：window.ExamModel
//
// 成绩 TXT 格式：每行「姓名 成绩」，例如
//   杨迪 101
//   罗门 103
// 分隔符兼容半角/全角空格、Tab、逗号；按姓名匹配当前班级学生（姓名在班级内唯一）。

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

    // scores: { [studentId]: number|null }，null 表示清除（缺考）
    function setScores(examId, scores) {
        return AppState._commit(() => {
            const exam = get(examId);
            if (!exam) return;
            Object.keys(scores).forEach((sid) => {
                const v = scores[sid];
                if (v == null || Number.isNaN(v)) delete exam.scores[sid];
                else exam.scores[sid] = v;
            });
        });
    }

    function parseScore(str) {
        const s = String(str).trim();
        if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
        return Number(s);
    }

    // 解析 TXT 文本 -> 预览结果（不写入）
    // { matched: [{student, score, line}], unknown: [{name, line}], invalid: [line], duplicates: [name] }
    function parseTxt(text) {
        const result = { matched: [], unknown: [], invalid: [], duplicates: [] };
        const seen = {};
        String(text || '').replace(/^﻿/, '').split(/\r?\n/).forEach((raw) => {
            const line = raw.trim();
            if (!line) return;
            const parts = line.split(/[\s,，\t　]+/).filter(Boolean);
            if (parts.length < 2) { result.invalid.push(line); return; }
            const score = parseScore(parts[parts.length - 1]);
            const name = parts.slice(0, -1).join('');
            if (score == null) { result.invalid.push(line); return; }
            const stu = AppState.findStudentByName(name);
            if (!stu) { result.unknown.push({ name, line }); return; }
            if (seen[stu.id] != null) {
                // 同名重复出现：以最后一行为准
                result.duplicates.push(name);
                result.matched[seen[stu.id]] = { student: stu, score, line };
                return;
            }
            seen[stu.id] = result.matched.length;
            result.matched.push({ student: stu, score, line });
        });
        return result;
    }

    function formatScore(v) {
        return v == null ? '' : String(Math.round(v * 100) / 100);
    }

    // 导出为 TXT：按学号顺序，缺考（无成绩）的学生不输出
    function exportTxt(examId) {
        const exam = get(examId);
        if (!exam) return '';
        return AppState.getStudents()
            .filter((stu) => exam.scores[stu.id] != null)
            .map((stu) => `${stu.name} ${formatScore(exam.scores[stu.id])}`)
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
        const ranks = {};
        entries.forEach((x, i) => {
            ranks[x.student.id] = i > 0 && x.score === entries[i - 1].score ? ranks[entries[i - 1].student.id] : i + 1;
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
            ranks
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

    // 某学生的历次考试（时间正序）：[{exam, score, rank, count, avg}]
    function studentHistory(studentId, filter) {
        return list(filter).slice().reverse().map((exam) => {
            const st = stats(exam);
            return {
                exam,
                score: exam.scores[studentId] != null ? exam.scores[studentId] : null,
                rank: st.ranks[studentId] || null,
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
