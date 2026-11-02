// studentTrend.js —— 学生趋势的共享部分：当前选中的学生、学号+姓名的小块选择器、作业/背诵/考试/其他情况四块的快速定位
// 全局命名空间：window.StudentTrend
// 任意位置带 data-profile-id 的元素被点击，都会跳到导航页「📈 学生趋势」并定位到对应那一块（在作业/背诵/考试页点就定位到该类，
// 其他地方沿用上次看的那类）；四块在趋势页里从上到下连成一页，共用同一个选中学生

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);
    const LS_KIND = 'teachingPanel.ui.trendKind';
    const KINDS = [
        { key: 'homework', label: '📝 作业趋势' },
        { key: 'recitation', label: '🗣️ 背诵趋势' },
        { key: 'exams', label: '📋 考试趋势' },
        { key: 'other', label: '🗂️ 其他情况' }
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

    // 看某学生的趋势：跳到「📈 学生趋势」页并定位到 kind 那一块；id 为空表示学生不变。
    // kind 省略时：在作业/背诵/考试页点姓名就定位到该类，其他地方沿用上次看的那类
    function open(id, kind) {
        if (id && !AppState.getStudent(id)) return;
        if (id) studentId = id;
        const cur = Navigation.getCurrent();
        const key = kind || (KINDS.some((x) => x.key === cur) ? cur : lastKind());
        Utils.lsSet(LS_KIND, key);
        if (cur === 'trend') { TrendPage.render(); } else { Navigation.goTo('trend'); }
        TrendPage.scrollTo(key);
    }

    // 趋势页顶部固定的选择器：四块快速定位按钮 + 全班学生小块（学号 姓名）。active 是当前看到的那块
    function pickerHtml(active) {
        const students = AppState.getStudents();
        const sel = currentId();
        return `
            <div class="card trend-picker">
                <div class="trend-kinds">${KINDS.map((k) => `<button type="button" class="trend-kind ${k.key === active ? 'active' : ''}" data-trend-kind="${k.key}">${k.label}</button>`).join('')}</div>
                <div class="trend-chips">${students.map((s) => `<button type="button" class="trend-chip ${s.id === sel ? 'active' : ''}" data-trend-stu="${s.id}">${esc(s.studentNo ? s.studentNo + ' ' : '')}${esc(s.name)}</button>`).join('')}</div>
            </div>`;
    }

    // 绑定 pickerHtml 里的点击：选学生后 onPick 重绘；点类型 onKind(key) 滚动定位
    function bind(view, onPick, onKind) {
        view.querySelectorAll('[data-trend-stu]').forEach((b) => b.addEventListener('click', () => {
            studentId = b.dataset.trendStu;
            onPick();
        }));
        view.querySelectorAll('[data-trend-kind]').forEach((b) => b.addEventListener('click', () => {
            Utils.lsSet(LS_KIND, b.dataset.trendKind);
            onKind(b.dataset.trendKind);
        }));
    }

    // 弹窗标题「姓名 · 后缀」里的姓名变成可点链接：关掉弹窗，跳到该生趋势。在 Modal.open 的 onMount 里调用
    function linkDialogTitle(body, stu, suffix, close) {
        const h2 = body.closest('.dialog-box').querySelector('.dialog-header h2');
        h2.innerHTML = `<button type="button" class="student-link" title="查看学生趋势">${esc(stu.name)}</button> · ${esc(suffix)}`;
        h2.querySelector('button').addEventListener('click', () => { close(); open(stu.id); });
    }

    window.StudentTrend = { open, currentId, pickerHtml, bind, linkDialogTitle, KINDS, lastKind };
})();
