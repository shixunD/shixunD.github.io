// quickPhrases.js —— comment 快捷词：弹窗里的快捷词按钮条 + 主页的快捷词编辑卡片
// 全局命名空间：window.QuickPhrases
// kind: 'homework'（作业状态弹窗）| 'recitation'（背诵检查弹窗），两套词各自独立，存在 settings.quickPhrases

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);
    const KINDS = [
        { key: 'homework', label: '📝 作业' },
        { key: 'recitation', label: '📖 背诵' }
    ];
    const SEPARATOR = '；';

    // 弹窗里的快捷词按钮条
    function chipsHtml(kind) {
        const list = AppState.getQuickPhrases(kind);
        if (!list.length) return '<div class="qp-bar"><span class="hint">还没有快捷词，可在「主页 → comment 快捷词」添加</span></div>';
        return `<div class="qp-bar">${list.map((p) => `<button type="button" class="qp-chip" data-qp="${esc(p)}">${esc(p)}</button>`).join('')}</div>`;
    }

    // 点击快捷词：追加到 textarea 末尾（已有内容时用「；」分隔）
    function bind(container, textarea) {
        container.querySelectorAll('[data-qp]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const cur = textarea.value.replace(/\s+$/, '');
                const needSep = cur && !/[；;，,。、\n]$/.test(cur);
                textarea.value = cur + (needSep ? SEPARATOR : '') + btn.dataset.qp;
                textarea.focus();
                textarea.setSelectionRange(textarea.value.length, textarea.value.length);
            });
        });
    }

    // 主页编辑卡片
    function cardHtml() {
        return `
            <div class="card">
                <h2>💬 comment 快捷词</h2>
                <p class="hint">登记作业状态 / 背诵检查时，点一下快捷词就会追加到 comment 里。作业和背诵分开设置。</p>
                ${KINDS.map((k) => {
                    const list = AppState.getQuickPhrases(k.key);
                    return `
                        <div class="qp-group">
                            <div class="qp-group-title">${k.label} <span class="hint">${list.length} 个</span></div>
                            <div class="qp-edit-list">
                                ${list.map((p, i) => `
                                    <div class="qp-edit-row">
                                        <span class="qp-edit-text">${esc(p)}</span>
                                        <button type="button" class="class-item-btn" data-qp-move="${k.key}:${i}:-1" title="上移" ${i === 0 ? 'disabled' : ''}>↑</button>
                                        <button type="button" class="class-item-btn" data-qp-move="${k.key}:${i}:1" title="下移" ${i === list.length - 1 ? 'disabled' : ''}>↓</button>
                                        <button type="button" class="class-item-btn" data-qp-del="${k.key}:${i}" title="删除">✕</button>
                                    </div>`).join('') || '<div class="hint">暂无</div>'}
                            </div>
                            <form class="qp-add-row" data-qp-add="${k.key}">
                                <input type="text" placeholder="输入新的快捷词" autocomplete="off">
                                <button type="submit" class="btn-secondary btn-sm">添加</button>
                            </form>
                        </div>`;
                }).join('')}
            </div>`;
    }

    function bindCard(root) {
        root.querySelectorAll('[data-qp-add]').forEach((form) => {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const input = form.querySelector('input');
                try {
                    await AppState.addQuickPhrase(form.dataset.qpAdd, input.value);
                } catch (err) {
                    Toast.error(err.message);
                }
            });
        });
        root.querySelectorAll('[data-qp-del]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const [kind, i] = btn.dataset.qpDel.split(':');
                AppState.removeQuickPhrase(kind, Number(i));
            });
        });
        root.querySelectorAll('[data-qp-move]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const [kind, i, dir] = btn.dataset.qpMove.split(':');
                AppState.moveQuickPhrase(kind, Number(i), Number(dir));
            });
        });
    }

    window.QuickPhrases = { chipsHtml, bind, cardHtml, bindCard };
})();
