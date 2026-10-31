// studentTrend.js —— 学生趋势的共享部分：当前选中的学生、学号+姓名的小块选择器、作业/背诵/考试趋势快速切换
// 全局命名空间：window.StudentTrend
// 任意位置带 data-profile-id 的元素被点击，都会跳到该学生的趋势（在作业/背诵/考试页点就留在该页的「📈 学生趋势」，
// 其他地方沿用上次看的那类）；四类（作业/背诵/考试趋势 + 导航页「🗂️ 其它」里的其他情况）共用同一个选中学生

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);
    const LS_KIND = 'teachingPanel.ui.trendKind';
    const KINDS = [
        { key: 'homework', label: '📝 作业趋势', page: () => window.HomeworkPage },
        { key: 'recitation', label: '🗣️ 背诵趋势', page: () => window.RecitationPage },
        { key: 'exams', label: '📋 考试趋势', page: () => window.ExamsPage },
        // 「🗂️ 其它」导航页：只放其他情况（学情记录）
        { key: 'other', label: '🗂️ 其他情况', page: () => null }
    ];
    let studentId = null;

    document.addEventListener('click', (e) => {
        const trigger = e.target.closest('[data-profile-id]');
        if (!trigger) return;
        e.preventDefault();
        open(trigger.dataset.profileId);
    });

    function lastKind() {
        const k = Utils.lsGet(LS_KIND, 'homework');
        return KINDS.some((x) => x.key === k) ? k : 'homework';
    }

    // 当前选中的学生；不在当前班级（切换班级、被删除）时回退到第一个
    function currentId() {
        const students = AppState.getStudents();
        if (!students.some((s) => s.id === studentId)) studentId = students.length ? students[0].id : null;
        return studentId;
    }

    // 看某学生的趋势；id 为空表示只切换类型、学生不变。
    // 作业/背诵/考试趋势 = 对应页面下的「📈 学生趋势」标签；其他情况 = 「🗂️ 其它」导航页。
    // kind 省略时：在作业/背诵/考试页点姓名就留在该页，其他地方沿用上次看的那类
    function open(id, kind) {
        if (id && !AppState.getStudent(id)) return;
        if (id) studentId = id;
        const cur = Navigation.getCurrent();
        const key = kind || (KINDS.some((x) => x.key === cur) ? cur : lastKind());
        const k = KINDS.find((x) => x.key === key);
        Utils.lsSet(LS_KIND, k.key);
        if (k.key === 'other') { Navigation.goTo('trend'); return; }
        k.page().openTab('student');
        Navigation.goTo(k.key);
    }

    // 趋势页顶部：类型快速切换 + 全班学生小块（学号 姓名）。放在每个学生趋势视图最上面
    function pickerHtml(kind) {
        const students = AppState.getStudents();
        const sel = currentId();
        return `
            <div class="card trend-picker">
                <div class="trend-kinds">${KINDS.map((k) => `<button type="button" class="trend-kind ${k.key === kind ? 'active' : ''}" data-trend-kind="${k.key}">${k.label}</button>`).join('')}</div>
                <div class="trend-chips">${students.map((s) => `<button type="button" class="trend-chip ${s.id === sel ? 'active' : ''}" data-trend-stu="${s.id}">${esc(s.studentNo ? s.studentNo + ' ' : '')}${esc(s.name)}</button>`).join('')}</div>
            </div>`;
    }

    // 绑定 pickerHtml 里的点击；onPick 在选中学生变化后重绘本视图
    function bind(view, onPick) {
        view.querySelectorAll('[data-trend-stu]').forEach((b) => b.addEventListener('click', () => {
            studentId = b.dataset.trendStu;
            onPick();
        }));
        view.querySelectorAll('[data-trend-kind]').forEach((b) => b.addEventListener('click', () => open(null, b.dataset.trendKind)));
    }

    // 弹窗标题「姓名 · 后缀」里的姓名变成可点链接：关掉弹窗，跳到该生趋势。在 Modal.open 的 onMount 里调用
    function linkDialogTitle(body, stu, suffix, close) {
        const h2 = body.closest('.dialog-box').querySelector('.dialog-header h2');
        h2.innerHTML = `<button type="button" class="student-link" title="查看学生趋势">${esc(stu.name)}</button> · ${esc(suffix)}`;
        h2.querySelector('button').addEventListener('click', () => { close(); open(stu.id); });
    }

    window.StudentTrend = { open, currentId, pickerHtml, bind, linkDialogTitle };
})();
