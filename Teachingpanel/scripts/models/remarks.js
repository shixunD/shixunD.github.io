// models/remarks.js —— 「其他」页：对学生的学情记录（备注）增删改查
// 全局命名空间：window.RemarkModel
// 数据：state.remarks[] { id, studentId, date, text, photoIds?, createdAt }；随学生级联删除（AppState.removeStudent / removeClass）

(function () {
    'use strict';

    function state() { return AppState.getState(); }

    // 某学生的全部记录：日期新→旧，同一天按创建时间新→旧
    function listFor(studentId) {
        return state().remarks
            .filter((r) => r.studentId === studentId)
            .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
    }

    function countFor(studentId) {
        return state().remarks.reduce((n, r) => n + (r.studentId === studentId ? 1 : 0), 0);
    }

    function get(id) { return state().remarks.find((r) => r.id === id) || null; }

    function add(studentId, data) {
        const text = String(data.text || '').trim();
        const photoIds = Array.isArray(data.photoIds) ? data.photoIds.slice() : [];
        if (!text && !photoIds.length) return Promise.reject(new Error('记录内容和照片至少要有一样'));
        return AppState._commit((s) => {
            const remark = { id: Utils.uid('rmk'), studentId, date: data.date || Utils.today(), text, createdAt: Date.now() };
            if (photoIds.length) remark.photoIds = photoIds;
            s.remarks.push(remark);
            return remark;
        });
    }

    function update(id, patch) {
        const next = Object.assign({}, patch);
        if (next.text != null) next.text = String(next.text).trim();
        return AppState._commit(() => {
            const r = get(id);
            if (!r) return;
            Object.assign(r, next);
            if (Array.isArray(r.photoIds) && !r.photoIds.length) delete r.photoIds;
        });
    }

    function remove(id) {
        return AppState._commit((s) => { s.remarks = s.remarks.filter((r) => r.id !== id); });
    }

    window.RemarkModel = { listFor, countFor, get, add, update, remove };
})();
