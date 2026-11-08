// student.js —— 作业「学生趋势」视图
// 全局命名空间：window.HomeworkStudent

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);
    function render(view) {
        const students = AppState.getStudents();
        if (!students.length) { view.innerHTML = `<div class="card">${UI.emptyStudentsHint()}</div>`; return; }
        const id = StudentTrend.currentId();

        view.innerHTML = `
            <div class="card">${summaryHtml(id, {}, true)}</div>
        `;
        // 时间轴块 / 问题记录里的日期：跳到作业页该项作业，并让该学生的卡片闪三秒
        view.querySelectorAll('[data-jump-hw]').forEach((el) => {
            el.addEventListener('click', () => { BackJump.mark(id); HomeworkPage.jumpTo(el.dataset.jumpHw, id); });
        });
        // 时间轴块：定位到本页「问题记录」里该作业那一条并闪一下（没有问题记录的作业没有对应条目）
        view.querySelectorAll('[data-locate-hw]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const target = Array.from(view.querySelectorAll('.record-list > li')).find((li) => li.dataset.histHw === btn.dataset.locateHw);
                if (!target) { Toast.info('这项作业没有问题记录'); return; }
                target.scrollIntoView({ block: 'center' });
                target.classList.remove('flash-locate');
                void target.offsetWidth;
                target.classList.add('flash-locate');
                setTimeout(() => target.classList.remove('flash-locate'), 1400);
            });
        });
    }

    // full 参数目前未使用，保留签名
    function summaryHtml(studentId, filter, full) {
        const st = HomeworkModel.studentStats(studentId, filter);
        if (!st.total) return '<div class="empty-message">暂无作业记录</div>';
        const S = HomeworkModel.STATUS_MAP;
        const weekly = HomeworkModel.weeklyRates(studentId, filter);
        const comments = st.timeline.filter((x) => x.rec.comment || x.rec.photoIds.length || x.rec.status !== 'done').reverse();

        return `
            <div class="stat-row">
                ${UI.statTile('作业总数', st.total)}
                ${UI.statTile('按时完成率', st.onTimeRate == null ? '-' : Utils.percent(st.counts.done, st.total), null, S.done.color)}
                ${UI.statTile('最终完成率', Utils.percent(st.counts.done + st.counts.missing_fixed + st.counts.poor_fixed, st.total), '含补上', S.missing_fixed.color)}
                ${UI.statTile('仍未补上', st.outstanding, null, st.outstanding ? S.missing.color : null)}
            </div>
            <div class="count-chips">
                ${HomeworkModel.STATUSES.map((s) => `<span class="status-pill" style="background:${s.color};color:${s.text}">${esc(s.label)} ${st.counts[s.key]}</span>`).join('')}
            </div>
            <h3 class="section-title">时间轴（旧 → 新）</h3>
            <div class="strip">
                ${st.timeline.map(({ hw, rec }) => {
                    const s = S[rec.status];
                    return `<button type="button" class="strip-cell strip-btn" style="background:${s.color}" data-locate-hw="${hw.id}" title="${Utils.formatDate(hw.date)} ${esc(hw.title)} · ${esc(s.label)}${rec.comment ? '：' + esc(rec.comment) : ''}（点击定位到问题记录）"></button>`;
                }).join('')}
            </div>
            ${weekly.length > 1 ? `<h3 class="section-title">每周按时完成率</h3>
                ${SvgChart.line({ labels: weekly.map((w) => w.label), series: [{ name: '按时完成率', color: S.done.color, values: weekly.map((w) => w.rate * 100) }], yMin: 0, yMax: 100, height: 200, yFormat: (v) => `${Math.round(v)}%` })}` : ''}
            <h3 class="section-title">问题记录与 comment</h3>
            ${comments.length ? `<ul class="record-list">${comments.map(({ hw, rec }) => {
                const s = S[rec.status];
                return `<li data-hist-hw="${hw.id}"><span class="status-pill" style="background:${s.color};color:${s.text}">${esc(s.short)}</span>
                    <span class="record-date">${Utils.formatDate(hw.date)}</span> <button type="button" class="record-jump" data-jump-hw="${hw.id}" title="跳到作业页该项作业">${esc(hw.title)}</button>
                    ${rec.comment ? `<div class="record-comment">💬 ${esc(rec.comment)}</div>` : ''}
                    ${Photos.viewHtml(rec.photoIds)}</li>`;
            }).join('')}</ul>` : '<div class="hint">没有问题记录，表现很好 👍</div>'}
        `;
    }

    window.HomeworkStudent = { render, summaryHtml };
})();
