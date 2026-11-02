// cameraPicker.js —— 摄像头管理：每次开相机前扫描设备、与已记录的名单对比、有新摄像头时弹选择框；主页的默认摄像头排序卡片
// 全局命名空间：window.CameraPicker
//
// 名单（按摄像头名称 label 记录，顺序 = 优先级，第一个当前已连接的就是默认摄像头）存 localStorage（每台电脑的摄像头不同，不进 .db）。
//   CameraPicker.choose()      开相机前调用：返回要用的 deviceId；null = 用浏览器默认；undefined = 用户取消
//   CameraPicker.cardHtml() / bindCard(root)   主页「默认摄像头」卡片
// 摄像头名称（label）只有授予过摄像头权限后才读得到，所以名称为空时会先临时打开一下摄像头拿权限再重新扫描。

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);
    const LS_KEY = 'teachingPanel.cameras';

    let connected = null;   // 最近一次扫描到的 [{label, deviceId}]；null = 本次打开页面还没扫描过

    function loadList() {
        try {
            const arr = JSON.parse(Utils.lsGet(LS_KEY, '[]'));
            return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string' && s) : [];
        } catch (e) { return []; }
    }
    function saveList(list) { Utils.lsSet(LS_KEY, JSON.stringify(list)); }

    function supported() { return !!(navigator.mediaDevices && navigator.mediaDevices.enumerateDevices); }

    async function enumerate() {
        const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        return all.filter((d) => d.kind === 'videoinput');
    }

    // 扫描当前连接的摄像头。unlock = 名称读不到时临时打开摄像头取得权限（会触发浏览器权限提示）
    async function scan(unlock) {
        if (!supported()) return [];
        let devs = await enumerate();
        if (unlock && devs.length && devs.some((d) => !d.label) && navigator.mediaDevices.getUserMedia) {
            try {
                const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                s.getTracks().forEach((t) => t.stop());
                devs = await enumerate();
            } catch (e) { /* 没权限：保持空名称，由调用方的 getUserMedia 报错 */ }
        }
        // 同名的（两个一模一样的摄像头）只保留第一个：名单按名称记录
        const seen = new Set();
        connected = devs.filter((d) => d.label && !seen.has(d.label) && seen.add(d.label)).map((d) => ({ label: d.label, deviceId: d.deviceId }));
        return connected;
    }

    // 把新摄像头追加到名单末尾，返回新出现的名称
    function remember(devs) {
        const list = loadList();
        const fresh = devs.map((d) => d.label).filter((l) => !list.includes(l));
        if (fresh.length) saveList(list.concat(fresh));
        return fresh;
    }

    function setDefault(label) {
        const list = loadList().filter((l) => l !== label);
        list.unshift(label);
        saveList(list);
    }

    // 已连接的摄像头里排在名单最前的那个
    function defaultOf(devs) {
        const order = loadList();
        return devs.slice().sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label))[0] || null;
    }

    // 发现新摄像头时的选择框。返回选中的设备；取消返回 null
    function askWhich(devs, fresh) {
        return new Promise((resolve) => {
            const preselect = fresh[0];
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay camera-pick-overlay';
            overlay.innerHTML = `
                <div class="modal-box" role="dialog" aria-modal="true">
                    <h2>📷 选择摄像头</h2>
                    <p class="modal-text">检测到新的摄像头，请选择这次使用哪一个。</p>
                    <div class="camera-pick-list">${devs.map((d, i) => `
                        <label class="camera-pick-item">
                            <input type="radio" name="cam" value="${i}" ${d.label === preselect ? 'checked' : ''}>
                            <span>${esc(d.label)}</span>${fresh.includes(d.label) ? '<em class="camera-new">新</em>' : ''}
                        </label>`).join('')}
                    </div>
                    <label class="camera-pick-remember"><input type="checkbox" data-cam-default checked> 设为默认摄像头（以后不再询问）</label>
                    <div class="modal-actions">
                        <button type="button" class="btn-secondary" data-action="cancel">取消</button>
                        <button type="button" class="btn-primary" data-action="confirm">使用</button>
                    </div>
                </div>`;
            const finish = (dev) => {
                if (dev && overlay.querySelector('[data-cam-default]').checked) setDefault(dev.label);
                overlay.remove();
                document.removeEventListener('keydown', onKey, true);
                resolve(dev);
            };
            const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); finish(null); } };
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) return finish(null);
                const action = e.target.closest('[data-action]');
                if (!action) return;
                if (action.dataset.action === 'cancel') return finish(null);
                const checked = overlay.querySelector('input[name="cam"]:checked');
                finish(checked ? devs[Number(checked.value)] : null);
            });
            document.addEventListener('keydown', onKey, true);
            document.body.appendChild(overlay);
            overlay.querySelector('[data-action="confirm"]').focus();
        });
    }

    // 开相机前调用：扫描 → 对比名单 → 没有新的用默认的，有新的弹选择框
    async function choose() {
        const devs = await scan(true);
        if (!devs.length) return null;
        const fresh = remember(devs);
        if (fresh.length && devs.length > 1) {
            const picked = await askWhich(devs, fresh);
            return picked ? picked.deviceId : undefined;
        }
        return defaultOf(devs).deviceId;
    }

    // ---------- 主页卡片 ----------

    function rowsHtml() {
        const list = loadList();
        if (!list.length) return '<div class="hint">还没有记录过摄像头。点「扫描摄像头」，或在电脑上第一次拍照时会自动记录。</div>';
        const on = connected ? new Set(connected.map((d) => d.label)) : null;
        return list.map((label, i) => `
            <div class="camera-row" draggable="true" data-cam-label="${esc(label)}">
                <span class="camera-grip" title="拖动调整顺序">⠿</span>
                <span class="camera-name">${esc(label)}</span>
                ${i === 0 ? '<em class="camera-badge">默认</em>' : ''}
                ${on ? `<em class="camera-state ${on.has(label) ? 'camera-on' : ''}">${on.has(label) ? '已连接' : '未连接'}</em>` : ''}
                <button type="button" class="camera-rm" data-cam-rm title="从名单移除">✕</button>
            </div>`).join('');
    }

    function cardHtml() {
        if (!supported()) return '';
        return `
            <div class="card" data-camera-card>
                <h2>📷 默认摄像头</h2>
                <p class="hint">电脑上拍照用的摄像头。拖动调整先后顺序，排在最前、且当前已连接的就是默认摄像头；插入新的摄像头后第一次拍照时会让你选择。手机/平板直接用系统相机，不受影响。</p>
                <div class="camera-list" data-camera-list>${rowsHtml()}</div>
                <div class="btn-col"><button type="button" class="btn-secondary" data-camera-scan>🔍 扫描摄像头</button></div>
            </div>`;
    }

    function bindCard(root) {
        const card = root.querySelector('[data-camera-card]');
        if (!card) return;
        const box = card.querySelector('[data-camera-list]');
        const redraw = () => { box.innerHTML = rowsHtml(); };

        card.querySelector('[data-camera-scan]').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
                const devs = await scan(true);
                const fresh = remember(devs);
                redraw();
                if (!devs.length) Toast.warning('没有检测到摄像头（或未授予摄像头权限）');
                else Toast.success(fresh.length ? `发现 ${fresh.length} 个新摄像头` : `共 ${devs.length} 个摄像头，没有新的`);
            } finally { btn.disabled = false; }
        });

        box.addEventListener('click', (e) => {
            const rm = e.target.closest('[data-cam-rm]');
            if (!rm) return;
            const label = rm.closest('[data-cam-label]').dataset.camLabel;
            saveList(loadList().filter((l) => l !== label));
            redraw();
        });

        // 拖动排序：落在某行上半部分 = 插到它前面，下半部分 = 插到它后面
        let dragLabel = null;
        const rows = () => Array.from(box.querySelectorAll('.camera-row'));
        const clear = () => rows().forEach((r) => r.classList.remove('drag-before', 'drag-after', 'dragging'));
        const isAfter = (e, el) => e.clientY > el.getBoundingClientRect().top + el.offsetHeight / 2;
        box.addEventListener('dragstart', (e) => {
            const row = e.target.closest('.camera-row');
            if (!row) return;
            dragLabel = row.dataset.camLabel;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', dragLabel);
            row.classList.add('dragging');
        });
        box.addEventListener('dragend', () => { dragLabel = null; clear(); });
        box.addEventListener('dragover', (e) => {
            const row = e.target.closest('.camera-row');
            if (!dragLabel || !row || row.dataset.camLabel === dragLabel) return;
            e.preventDefault();
            rows().forEach((r) => r.classList.remove('drag-before', 'drag-after'));
            row.classList.add(isAfter(e, row) ? 'drag-after' : 'drag-before');
        });
        box.addEventListener('drop', (e) => {
            const row = e.target.closest('.camera-row');
            if (!dragLabel || !row || row.dataset.camLabel === dragLabel) return;
            e.preventDefault();
            const moving = dragLabel;
            const after = isAfter(e, row);
            const target = row.dataset.camLabel;
            dragLabel = null;
            const list = loadList().filter((l) => l !== moving);
            const at = list.indexOf(target);
            list.splice(after ? at + 1 : at, 0, moving);
            saveList(list);
            redraw();
        });
    }

    window.CameraPicker = { choose, scan, cardHtml, bindCard };
})();
