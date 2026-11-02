// importExport.js —— 本地导入导出：SQLite 数据库文件（.db），全量（全部班级/学生/作业/背诵/考试 + 设置）
// 全局命名空间：window.ImportExport
// .db 的读写在 dbFile.js；这里负责下载文件、读取用户选的文件，并整体替换当前数据（AppState.replaceState）

(function () {
    'use strict';

    const DB_MIME = 'application/x-sqlite3';

    async function exportToFile() {
        const bytes = await DbFile.exportBytes(AppState.exportSnapshot());
        const filename = `${Utils.timestampName()}.db`;
        Utils.downloadText(filename, bytes, DB_MIME);
        return filename;
    }

    async function importFromFile(file) {
        const snapshot = await DbFile.importBytes(await file.arrayBuffer());
        if (!AppState.validateSnapshot(snapshot)) throw new Error('数据库内容不完整（缺少班级/学生数据）');
        await AppState.replaceState(snapshot);
        return snapshot;
    }

    window.ImportExport = {
        exportToFile,
        importFromFile,
        timestampName: Utils.timestampName,
        validateSnapshot: (obj) => AppState.validateSnapshot(obj)
    };
})();
