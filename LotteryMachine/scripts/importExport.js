// importExport.js —— 本地 JSON 导入导出
// 全局命名空间：window.ImportExport

(function () {
    'use strict';

    function pad(n) { return String(n).padStart(2, '0'); }

    // 生成 "年-月-日--时-分-秒" 格式的文件名（不含扩展名）
    function timestampName(date = new Date()) {
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
            `--${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
    }

    function exportToFile() {
        const snapshot = AppState.exportSnapshot();
        const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${timestampName()}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        return a.download;
    }

    // 当前多班级格式用 classes 数组存学生；validateSnapshot 也要兼容旧版单班级（顶层 students）的备份
    function validateSnapshot(obj) {
        return obj && typeof obj === 'object' && (Array.isArray(obj.classes) || Array.isArray(obj.students));
    }

    async function importFromFile(file) {
        const text = await file.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            throw new Error('文件不是有效的 JSON');
        }
        if (!validateSnapshot(data)) {
            throw new Error('文件内容不是有效的备份数据（缺少 classes/students 字段）');
        }
        await AppState.replaceState(data);
        return data;
    }

    window.ImportExport = { exportToFile, importFromFile, timestampName, validateSnapshot };
})();
