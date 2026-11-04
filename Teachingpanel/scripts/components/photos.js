// photos.js —— 照片：登记弹窗里的「拍照 / 上传」编辑器、记录里的缩略图、点击放大
// 全局命名空间：window.Photos
//
// 记录（作业登记 record / 背诵检查 recCheck / 其他记录 remark）只存 photoIds: string[]，照片本体在 IndexedDB 的 photos 存储（见 state.js）。
//   Photos.editorHtml()                         弹窗里的照片编辑块 HTML
//   Photos.bindEditor(root, existingIds)        绑定，返回 { finalize() }：把新选的照片存起来，返回最终的 photoIds
//   Photos.viewHtml(ids)                        只读缩略图（空数组返回空串）；<img data-photo> 由全局 MutationObserver 自动补 src
// 拍照：手机/平板（pointer: coarse）用 <input capture> 拉起系统相机；电脑 capture 无效，改用 getUserMedia 页内相机（openCamera）。
// 收到照片后弹预览框，逐档（质量 0.1–1.0 每 0.1 一档 / 不压缩）对比，确定后只存所选那一份（WebP，不支持时 JPEG），原图丢弃；默认档在主页设置里选。

(function () {
    'use strict';

    const urlCache = new Map();    // 照片 id -> object URL

    function urlFor(id) {
        if (urlCache.has(id)) return Promise.resolve(urlCache.get(id));
        return AppState.photoGet(id).then((blob) => {
            if (!blob) return null;
            const url = URL.createObjectURL(blob);
            urlCache.set(id, url);
            return url;
        });
    }

    // 压缩档位（1.22.0 起）：只调 WebP 质量，分辨率保持原样（最长边超过 MAX_SIDE 才等比缩小）。
    // 拍照 / 上传 / 手机回传收到的照片先不保存，弹出预览框让用户逐档对比（chooseLevel），确定后只留所选档位那一份，完整原图丢弃。
    // 「不压缩」= 原样保存收到的那份文件。默认选中的档位在主页「⚙️ 设置」里选。
    // 质量 0.01 / 0.03 / 0.05 / 0.08 四个极限压缩档（1.23.1 起），0.1–1.0 每 0.1 一档，外加「不压缩」
    // 1.25.0 起再加 0.001 / 0.005 两档，并有「自定义」档（质量值在主页设置里改，预览框里可临时改）
    const LEVELS = [0.1, 0.5, 1, 3, 5, 8, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((n) => {
        const q = Math.round(n * 10) / 1000;
        const text = q < 0.01 ? q.toFixed(3) : (q < 0.1 || Math.round(q * 100) % 10 ? q.toFixed(2) : q.toFixed(1));
        return { key: 'q' + n, label: text, quality: q, desc: '质量 ' + text };
    }).concat([{ key: 'raw', label: '不压缩', quality: null, desc: '不压缩（保留收到的原图）' }]);
    // 预览框打开时自动计算的档位（从左到右）；其余档位点到才算，省资源
    const AUTO_KEYS = ['custom', 'q0.1', 'q0.5', 'q1', 'q10', 'q50'];
    const DEFAULT_LEVEL = 'q60';
    const LS_LEVEL = 'teachingPanel.photoPreviewLevel';
    const LS_CUSTOM = 'teachingPanel.photoCustomQuality';
    const DEFAULT_CUSTOM = 0.2;
    const clampQ = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0.001, Math.round(n * 1000) / 1000)) : DEFAULT_CUSTOM; };
    function getCustomQuality() { return clampQ(Utils.lsGet(LS_CUSTOM, DEFAULT_CUSTOM)); }
    function setCustomQuality(v) { Utils.lsSet(LS_CUSTOM, clampQ(v)); }
    function customLevel(q = getCustomQuality()) {
        return { key: 'custom', label: '自定义 ' + q, quality: q, desc: '自定义（质量 ' + q + '）' };
    }
    function levelOf(key, customQ) {
        return key === 'custom' ? customLevel(customQ) : LEVELS.find((l) => l.key === key);
    }
    function levelOptions() { return [customLevel()].concat(LEVELS); }
    const MAX_SIDE = 4096;       // 超过才缩小，防止超大图撑爆内存/存储
    const ROTATE_Q = 0.92;       // 旋转时重新编码用的质量（默认档是「不压缩」时也用它）

    function getLevel() {
        const key = Utils.lsGet(LS_LEVEL, DEFAULT_LEVEL);
        return levelOf(key) || levelOf(DEFAULT_LEVEL);
    }
    function setLevel(key) { if (levelOf(key)) Utils.lsSet(LS_LEVEL, key); }
    // 旋转要重新编码：不低于默认档质量，免得转一下反而更糊；默认档是「不压缩」就用 ROTATE_Q
    function rotateQuality() { const q = getLevel().quality; return q ? Math.max(q, 0.6) : ROTATE_Q; }

    const toBlob = (canvas, type, q) => new Promise((resolve, reject) => {
        canvas.toBlob((bl) => (bl ? resolve(bl) : reject(new Error('图片处理失败'))), type, q);
    });

    // 1.17.0 起保存为 WebP：实测（tools/compress-bench.html）相同 SSIM 下比浏览器 JPEG 小约 30%–50%，小字肉眼无差别。
    // Safari（iPhone/iPad）能显示 WebP 但 canvas 编不出来（会悄悄返回 PNG），所以先试一次，不支持就退回 JPEG。
    // 已有照片不转换；每张照片的格式随 blob.type 存进 IndexedDB 和 .db（photos.mime），新旧格式混用没问题
    let outType = null;
    async function encodeImage(canvas, q) {
        if (outType === null) {
            const probe = await toBlob(canvas, 'image/webp', q).catch(() => null);
            outType = probe && probe.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
            if (outType === 'image/webp') return probe;
        }
        return toBlob(canvas, outType, q);
    }

    // 读图（按 EXIF 摆正）
    async function decode(file) {
        try {
            return await createImageBitmap(file, { imageOrientation: 'from-image' });
        } catch (e) {
            throw new Error('无法读取这张图片，请换一张试试');
        }
    }

    // 把位图画到 canvas：最长边超过 MAX_SIDE 才缩小，顺时针转 rot×90°
    function drawToCanvas(bitmap, rot = 0) {
        const turned = rot % 2 === 1;
        const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = turned ? h : w;
        canvas.height = turned ? w : h;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';   // 缩小时用高质量重采样，默认的 low 会让小字边缘发虚
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(rot * Math.PI / 2);
        ctx.drawImage(bitmap, -w / 2, -h / 2, w, h);
        return canvas;
    }

    // 旋转用：把一张已有的图转 rot×90° 后重新编码
    async function rotateBlob(blob, rot) {
        const bitmap = await decode(blob);
        try {
            return await encodeImage(drawToCanvas(bitmap, rot), rotateQuality());
        } finally {
            if (bitmap.close) bitmap.close();
        }
    }

    const fmtSize = (n) => (n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(2) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

    // 预览框：逐档对比，确定后返回所选那一档的 Blob；放弃这张返回 null。读不了图片时抛错
    // 预览区支持滚轮 / 双指缩放、左键拖动平移；四周边角直接拖动即裁剪（松手生效，可连续裁），另有左 / 右旋转
    async function chooseLevel(file) {
        const bitmap = await decode(file);
        const info = `${bitmap.width}×${bitmap.height}`;

        const results = new Map();     // key -> { blob, url }
        const put = (key, blob) => results.set(key, { blob, url: URL.createObjectURL(blob) });
        put('raw', file);
        let selected = getLevel().key;
        let closed = false;
        let customQ = getCustomQuality();   // 本次预览框里的自定义质量，可临时改；下次打开恢复主页设置里的值
        const lvOf = (key) => levelOf(key, customQ);
        const idleText = (key) => (AUTO_KEYS.includes(key) ? '计算中…' : '点击计算');
        const sizeEl = (key) => overlay.querySelector(`[data-lv="${key}"] [data-size]`);

        // 编辑状态：rot = 顺时针 90° 的次数；crop = 旋转后整图上保留的区域（0–1 比例）
        let rot = 0;
        let crop = { x: 0, y: 0, w: 1, h: 1 };
        let edited = false;
        let canvas = drawToCanvas(bitmap, 0);
        let gen = 0;                   // 每次编辑 +1，让过期的后台编码作废
        const MIN_CROP = 0.05;

        const overlay = document.createElement('div');
        overlay.className = 'photo-choose-overlay';
        overlay.innerHTML = `
            <div class="photo-choose-box" role="dialog" aria-modal="true">
                <h2>选择压缩档位 <small>原图 ${info} · ${fmtSize(file.size)}</small></h2>
                <div class="photo-choose-view" data-view>
                    <div class="photo-stage" data-stage>
                        <img alt="预览" draggable="false">
                        <div class="pc-box" data-box>
                            ${['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((d) => `<i class="pc-h pc-${d}" data-h="${d}"></i>`).join('')}
                        </div>
                    </div>
                </div>
                <div class="photo-choose-tools">
                    <button type="button" class="btn-secondary" data-rot="-1" title="向左转 90°">↺ 左转</button>
                    <button type="button" class="btn-secondary" data-rot="1" title="向右转 90°">↻ 右转</button>
                    <button type="button" class="btn-secondary" data-reset-edit disabled>还原编辑</button>
                    <span class="hint">拖动图片四周边角即可裁剪；滚轮缩放、左键拖动平移</span>
                </div>
                <div class="photo-choose-info" data-info></div>
                <div class="photo-choose-levels">${levelOptions().map((l) => `<button type="button" class="photo-choose-lv" data-lv="${l.key}"><b>${Utils.escapeHtml(l.label)}</b><span data-size>${l.key === 'raw' ? fmtSize(file.size) : idleText(l.key)}</span></button>`).join('')}</div>
                <div class="photo-choose-custom">自定义质量 <input type="number" min="0.001" max="1" step="0.001" value="${customQ}" data-custom-q> <span class="hint">（0.001–1；只改这一次，默认值在主页「⚙️ 设置」里改）</span></div>
                <div class="hint">点档位对比效果；确定后只保留所选的一份，收到的完整原图会丢弃。数字是 WebP 质量，越大越清楚、文件越大。打开时只先算前几档，其余点到才算。</div>
                <div class="modal-actions">
                    <button type="button" class="btn-secondary" data-zoom>放大到 100%</button>
                    <button type="button" class="btn-secondary" data-skip>放弃这张</button>
                    <button type="button" class="btn-primary" data-ok>确定</button>
                </div>
            </div>`;
        const img = overlay.querySelector('img');
        const okBtn = overlay.querySelector('[data-ok]');
        const view = overlay.querySelector('[data-view]');
        const stage = overlay.querySelector('[data-stage]');
        const box = overlay.querySelector('[data-box]');
        const zoomBtn = overlay.querySelector('[data-zoom]');

        // ---- 缩放 / 平移：stage 是按图片比例铺进预览区的一块，整体 translate + scale ----
        let base = { x: 0, y: 0, w: 1, h: 1 };
        let s = 1, X = 0, Y = 0;
        function applyView() {
            stage.style.transform = `translate(${X}px, ${Y}px) scale(${s})`;
            stage.style.setProperty('--inv', String(1 / s));
            view.classList.toggle('zoomed', s > 1.001);
            zoomBtn.textContent = s > 1.01 ? '适应窗口' : '放大到 100%';
        }
        function layout() {
            const vw = view.clientWidth, vh = view.clientHeight, ar = canvas.width / canvas.height;
            let bw = vw, bh = bw / ar;
            if (bh > vh) { bh = vh; bw = bh * ar; }
            base = { x: (vw - bw) / 2, y: (vh - bh) / 2, w: bw, h: bh };
            stage.style.width = bw + 'px';
            stage.style.height = bh + 'px';
            if (s <= 1.001) { s = 1; X = base.x; Y = base.y; }
            applyView();
        }
        function zoomAt(cx, cy, f) {
            const ns = Math.min(32, Math.max(1, s * f));
            if (ns === s) return;
            X = cx - (cx - X) * ns / s;
            Y = cy - (cy - Y) * ns / s;
            s = ns;
            if (s <= 1.001) { s = 1; X = base.x; Y = base.y; }
            applyView();
        }
        const viewPoint = (e) => { const r = view.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
        view.addEventListener('wheel', (e) => {
            e.preventDefault();
            const p = viewPoint(e);
            zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
        }, { passive: false });
        const pointers = new Map();
        let pinch = null;
        view.addEventListener('pointerdown', (e) => {
            if (e.target.closest('[data-h]')) return;
            view.setPointerCapture(e.pointerId);
            pointers.set(e.pointerId, viewPoint(e));
            if (pointers.size === 2) {
                const [a, b] = [...pointers.values()];
                pinch = Math.hypot(a.x - b.x, a.y - b.y);
            }
        });
        view.addEventListener('pointermove', (e) => {
            if (!pointers.has(e.pointerId)) return;
            const prev = pointers.get(e.pointerId);
            const cur = viewPoint(e);
            pointers.set(e.pointerId, cur);
            if (pointers.size >= 2 && pinch) {
                const [a, b] = [...pointers.values()];
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                if (d > 0) { zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch); pinch = d; }
            } else if (pointers.size === 1 && s > 1) {
                X += cur.x - prev.x;
                Y += cur.y - prev.y;
                applyView();
            }
        });
        const endPointer = (e) => { pointers.delete(e.pointerId); pinch = null; };
        view.addEventListener('pointerup', endPointer);
        view.addEventListener('pointercancel', endPointer);
        view.addEventListener('dblclick', (e) => { if (!e.target.closest('[data-h]')) { s = 1; layout(); } });
        const onResize = () => { s = 1; layout(); };
        window.addEventListener('resize', onResize);

        // ---- 裁剪：四周边角拖动，松手把这次的框并入 crop，框回到图片边缘 ----
        let live = { l: 0, t: 0, r: 1, b: 1 };
        function drawBox() {
            box.style.left = live.l * 100 + '%';
            box.style.top = live.t * 100 + '%';
            box.style.width = (live.r - live.l) * 100 + '%';
            box.style.height = (live.b - live.t) * 100 + '%';
            box.classList.toggle('active', live.l > 0 || live.t > 0 || live.r < 1 || live.b < 1);
        }
        box.addEventListener('pointerdown', (e) => {
            const h = e.target.closest('[data-h]');
            if (!h) return;
            e.preventDefault();
            e.stopPropagation();
            h.setPointerCapture(e.pointerId);
            const dir = h.dataset.h;
            const sx = e.clientX, sy = e.clientY, start = { ...live };
            const move = (ev) => {
                const dx = (ev.clientX - sx) / (base.w * s), dy = (ev.clientY - sy) / (base.h * s);
                const n = { ...start };
                if (dir.includes('w')) n.l = Math.min(Math.max(0, start.l + dx), start.r - MIN_CROP);
                if (dir.includes('e')) n.r = Math.max(Math.min(1, start.r + dx), start.l + MIN_CROP);
                if (dir.includes('n')) n.t = Math.min(Math.max(0, start.t + dy), start.b - MIN_CROP);
                if (dir.includes('s')) n.b = Math.max(Math.min(1, start.b + dy), start.t + MIN_CROP);
                live = n;
                drawBox();
            };
            const up = () => {
                h.removeEventListener('pointermove', move);
                h.removeEventListener('pointerup', up);
                h.removeEventListener('pointercancel', up);
                const f = live;
                live = { l: 0, t: 0, r: 1, b: 1 };
                drawBox();
                if (f.r - f.l > 0.995 && f.b - f.t > 0.995) return;
                crop = { x: crop.x + f.l * crop.w, y: crop.y + f.t * crop.h, w: (f.r - f.l) * crop.w, h: (f.b - f.t) * crop.h };
                applyEdit();
            };
            h.addEventListener('pointermove', move);
            h.addEventListener('pointerup', up);
            h.addEventListener('pointercancel', up);
        });

        function rotate(step) {
            const c = crop;
            crop = step > 0 ? { x: 1 - (c.y + c.h), y: c.x, w: c.h, h: c.w } : { x: c.y, y: 1 - (c.x + c.w), w: c.h, h: c.w };
            rot = (rot + (step > 0 ? 1 : 3)) % 4;
            applyEdit();
        }
        function rebuildCanvas() {
            const full = drawToCanvas(bitmap, rot);
            if (crop.w >= 0.999 && crop.h >= 0.999) { canvas = full; return; }
            const sx = Math.round(crop.x * full.width), sy = Math.round(crop.y * full.height);
            const sw = Math.max(1, Math.min(full.width - sx, Math.round(crop.w * full.width)));
            const sh = Math.max(1, Math.min(full.height - sy, Math.round(crop.h * full.height)));
            canvas = document.createElement('canvas');
            canvas.width = sw;
            canvas.height = sh;
            canvas.getContext('2d').drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
        }
        // 旋转 / 裁剪后：所有档位作废重算；「不压缩」不再是收到的原文件，改按高质量重新编码
        function applyEdit() {
            edited = rot !== 0 || crop.w < 0.999 || crop.h < 0.999;
            rebuildCanvas();
            results.forEach((r) => URL.revokeObjectURL(r.url));
            results.clear();
            if (!edited) put('raw', file);
            overlay.querySelectorAll('[data-lv] [data-size]').forEach((el) => {
                const key = el.closest('[data-lv]').dataset.lv;
                el.textContent = !edited && key === 'raw' ? fmtSize(file.size) : idleText(key);
            });
            overlay.querySelector('[data-reset-edit]').disabled = !edited;
            s = 1;
            layout();
            show();
            encodeAll();
        }

        function show() {
            overlay.querySelectorAll('[data-lv]').forEach((b) => b.classList.toggle('selected', b.dataset.lv === selected));
            const r = results.get(selected);
            okBtn.disabled = !r;
            img.classList.toggle('busy', !r);
            const level = lvOf(selected);
            const infoEl = overlay.querySelector('[data-info]');
            const editNote = edited ? `（已编辑 → ${canvas.width}×${canvas.height}）` : '';
            if (r) {
                img.src = r.url;
                const pct = Math.round(r.blob.size / file.size * 100);
                infoEl.innerHTML = `当前「${Utils.escapeHtml(level.label)}」：<b>${fmtSize(r.blob.size)}</b>` + (level.key === 'raw' && !edited ? '（原图大小）' : `（原图 ${fmtSize(file.size)}，为原图的 ${pct}%）`) + editNote;
            } else {
                infoEl.textContent = `当前「${level.label}」：计算中…` + editNote;
            }
        }

        // 只算一档（已算过 / 正在算的跳过）；全部共用同一张 canvas
        const inflight = new Set();
        async function encodeOne(key, my) {
            if (closed || my !== gen || results.has(key) || inflight.has(key)) return;
            const q = key === 'raw' ? (edited ? ROTATE_Q : null) : lvOf(key).quality;
            if (!q) return;
            inflight.add(key);
            const el = sizeEl(key);
            if (el) el.textContent = '计算中…';
            try {
                const blob = await encodeImage(canvas, q);
                if (closed || my !== gen || (key === 'custom' && lvOf(key).quality !== q)) return;   // 编辑过 / 自定义值又改了：作废
                put(key, blob);
                if (el) el.textContent = fmtSize(blob.size);
                if (key === selected) show();
            } catch (e) {
                if (!closed && my === gen && el) el.textContent = '失败';
            } finally {
                inflight.delete(key);
            }
        }
        // 选中的档位优先算，再按 AUTO_KEYS 从左到右算；其余档位点到才算
        async function encodeAll() {
            const my = ++gen;
            inflight.clear();
            const order = [selected].concat(AUTO_KEYS).concat(edited ? ['raw'] : []);
            for (const key of [...new Set(order)]) {
                if (closed || my !== gen) return;
                await encodeOne(key, my);
            }
        }

        return new Promise((resolve) => {
            const finish = (value) => {
                closed = true;
                overlay.remove();
                document.removeEventListener('keydown', onKey, true);
                window.removeEventListener('resize', onResize);
                if (bitmap.close) bitmap.close();
                results.forEach((r) => { if (!value || r.blob !== value) URL.revokeObjectURL(r.url); });
                resolve(value);
            };
            const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); finish(null); } };
            document.addEventListener('keydown', onKey, true);
            overlay.addEventListener('click', (e) => {
                const lv = e.target.closest('[data-lv]');
                if (lv) { selected = lv.dataset.lv; show(); encodeOne(selected, gen); return; }
                const rt = e.target.closest('[data-rot]');
                if (rt) { rotate(Number(rt.dataset.rot)); return; }
                if (e.target.closest('[data-reset-edit]')) {
                    rot = 0;
                    crop = { x: 0, y: 0, w: 1, h: 1 };
                    applyEdit();
                } else if (e.target.closest('[data-zoom]')) {
                    if (s > 1.01) { s = 1; layout(); }
                    else zoomAt(view.clientWidth / 2, view.clientHeight / 2, canvas.width / base.w);   // 图片 1 像素 = 屏幕 1 像素
                } else if (e.target.closest('[data-skip]')) {
                    finish(null);
                } else if (e.target.closest('[data-ok]')) {
                    const r = results.get(selected);
                    if (r) finish(r.blob);
                }
            });
            overlay.querySelector('[data-custom-q]').addEventListener('change', (e) => {
                customQ = clampQ(e.target.value);
                e.target.value = customQ;
                const old = results.get('custom');
                if (old) { URL.revokeObjectURL(old.url); results.delete('custom'); }
                overlay.querySelector('[data-lv="custom"] b').textContent = lvOf('custom').label;
                sizeEl('custom').textContent = '计算中…';
                inflight.delete('custom');
                selected = 'custom';
                show();
                encodeOne('custom', gen);
            });
            document.body.appendChild(overlay);
            layout();
            show();
            encodeAll();
        });
    }

    // 预览框排队：多张照片（连拍、多选、手机连传）一张一张预览；相机 / 手机接收面板还开着时先等着，不挡住拍照
    const chooseQueue = [];
    let draining = false;
    async function drainChooseQueue() {
        draining = true;
        while (chooseQueue.length) {
            while (document.querySelector('.camera-overlay, .phonelink-overlay')) await new Promise((r) => setTimeout(r, 400));
            const job = chooseQueue.shift();
            try { await job(); } catch (err) { Toast.error(err.message); }
        }
        draining = false;
    }
    function enqueueChoose(job) {
        chooseQueue.push(job);
        if (!draining) drainChooseQueue();
    }

    // ---------- 只读缩略图 ----------

    function viewHtml(ids) {
        if (!ids || !ids.length) return '';
        return `<div class="photo-thumbs">${ids.map((id) => `<span class="photo-thumb"><img data-photo="${Utils.escapeHtml(id)}" alt="照片"></span>`).join('')}</div>`;
    }

    function hydrate(root) {
        root.querySelectorAll('img[data-photo]:not([src])').forEach((img) => {
            urlFor(img.dataset.photo).then((url) => { if (url) img.src = url; else img.alt = '照片已丢失'; });
        });
    }

    new MutationObserver((mutations) => {
        mutations.forEach((m) => m.addedNodes.forEach((n) => {
            if (n.nodeType !== 1) return;
            if (n.matches && n.matches('img[data-photo]:not([src])')) hydrate({ querySelectorAll: () => [n] });
            else if (n.querySelectorAll) hydrate(n);
        }));
    }).observe(document.documentElement, { childList: true, subtree: true });

    // ---------- 点击放大 ----------

    // 旋转是写回照片本身的：旋转后的图立刻存回 IndexedDB（同一个 id），所有缩略图和以后的大图都是这个方向
    const pendingRotators = new WeakMap();   // 登记弹窗里的照片列表元素 -> (index, dir) => Promise<新 url>

    async function rotateSaved(id, dir) {
        const old = await AppState.photoGet(id);
        if (!old) return null;
        const blob = await rotateBlob(old, dir > 0 ? 1 : 3);
        await AppState.photoPut(id, blob);
        const url = URL.createObjectURL(blob);
        const prev = urlCache.get(id);
        urlCache.set(id, url);
        document.querySelectorAll('img[data-photo]').forEach((im) => { if (im.dataset.photo === id) im.src = url; });
        return { url, prev };
    }

    // items: [{ src, rotator }]，start 为当前张；同一条记录里的多张照片可左右切换。
    // rotator(dir) -> Promise<新 url | null>；没有（手机传来的预览等）就不显示旋转按钮
    function openLightbox(items, start) {
        let cur = start;
        const overlay = document.createElement('div');
        overlay.className = 'photo-lightbox';
        overlay.innerHTML = `<img src="${items[cur].src}" alt="照片" draggable="false"><button type="button" class="photo-lightbox-close" title="关闭">✕</button>`
            + (items.length > 1 ? '<button type="button" class="photo-lightbox-nav nav-prev" data-lb="prev" title="上一张（←）">‹</button><button type="button" class="photo-lightbox-nav nav-next" data-lb="next" title="下一张（→）">›</button><div class="photo-lightbox-count" data-count></div>' : '')
            + '<div class="photo-lightbox-bar"><span data-rot-btns></span><button type="button" data-lb="reset" title="还原缩放和位置">复位</button></div>';
        const img = overlay.querySelector('img');
        // 缩放/平移只是查看效果；旋转由 rotator 写回照片，转完图本身已是新方向，所以这里的 rot 恒为 0
        let busy = false;
        let rot = 0, scale = 1, x = 0, y = 0, dragging = false, moved = false, sx = 0, sy = 0;
        const countEl = overlay.querySelector('[data-count]');
        const rotBtns = overlay.querySelector('[data-rot-btns]');
        // 当前这张能旋转才显示旋转按钮
        function refreshBar() {
            rotBtns.innerHTML = items[cur].rotator ? '<button type="button" data-lb="left" title="向左旋转 90°（自动记住）">↺ 左转</button> <button type="button" data-lb="right" title="向右旋转 90°（自动记住）">↻ 右转</button>' : '';
            if (countEl) countEl.textContent = `${cur + 1} / ${items.length}`;
        }
        function go(step) {
            if (items.length < 2 || busy) return;
            cur = (cur + step + items.length) % items.length;
            img.src = items[cur].src;
            scale = 1; x = 0; y = 0; apply();
            refreshBar();
        }
        const apply = () => { img.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg) scale(${scale})`; };
        const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
        const onKey = (e) => {
            if (e.key === 'Escape') { e.stopPropagation(); close(); }
            else if (e.key === 'ArrowLeft') go(-1);
            else if (e.key === 'ArrowRight') go(1);
        };
        overlay.addEventListener('click', (e) => {
            if (moved) { moved = false; return; }
            const b = e.target.closest('button[data-lb]');
            if (b) {
                if (b.dataset.lb === 'reset') { scale = 1; x = 0; y = 0; apply(); return; }
                if (b.dataset.lb === 'prev') { go(-1); return; }
                if (b.dataset.lb === 'next') { go(1); return; }
                const it = items[cur];
                if (busy || !it.rotator) return;
                busy = true;
                it.rotator(b.dataset.lb === 'left' ? -1 : 1).then((res) => {
                    if (!res) return;
                    const url = typeof res === 'string' ? res : res.url;
                    it.src = url;
                    img.src = url;
                    if (res.prev) setTimeout(() => URL.revokeObjectURL(res.prev), 1000);
                }).catch((err) => Toast.error('旋转失败：' + err.message)).finally(() => { busy = false; });
            } else if (e.target !== img) close();
        });
        overlay.addEventListener('wheel', (e) => {
            e.preventDefault();
            scale = Math.min(10, Math.max(0.2, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
            apply();
        }, { passive: false });
        img.addEventListener('pointerdown', (e) => {
            dragging = true; moved = false; sx = e.clientX - x; sy = e.clientY - y;
            img.setPointerCapture(e.pointerId);
        });
        img.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            if (Math.abs(e.clientX - sx - x) + Math.abs(e.clientY - sy - y) > 3) moved = true;
            x = e.clientX - sx; y = e.clientY - sy; apply();
        });
        const endDrag = () => { dragging = false; };
        img.addEventListener('pointerup', endDrag);
        img.addEventListener('pointercancel', endDrag);
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(overlay);
        refreshBar();
    }

    function lightboxItem(img) {
        let rotator = null;
        if (img.dataset.photo) {
            const id = img.dataset.photo;
            rotator = (dir) => rotateSaved(id, dir);
        } else if (img.dataset.pending !== undefined) {
            const fn = pendingRotators.get(img.closest('[data-photo-list]'));
            const i = Number(img.dataset.pending);
            if (fn) rotator = (dir) => fn(i, dir);
        }
        return { src: img.src, rotator };
    }

    document.addEventListener('click', (e) => {
        const img = e.target.closest('.photo-thumb img');
        if (!img || !img.src) return;
        // 同一条记录（同一个缩略图容器）里已加载好的照片可左右切换
        const box = img.closest('.photo-thumbs');
        const imgs = box ? Array.from(box.querySelectorAll('.photo-thumb img')).filter((im) => im.src) : [img];
        openLightbox(imgs.map(lightboxItem), Math.max(0, imgs.indexOf(img)));
    });

    // ---------- 相机 ----------

    // 主输入设备是触摸（手机、平板，含 iPadOS 的桌面版 UA）；带触屏的笔记本主输入是鼠标，仍算电脑
    function isTouchDevice() {
        return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    }

    // getUserMedia 只在 https / localhost 下可用
    function hasLiveCamera() {
        return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.isSecureContext);
    }

    function cameraErrorText(err) {
        if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) return '没有摄像头权限';
        if (err && (err.name === 'NotFoundError' || err.name === 'OverconstrainedError')) return '没有找到摄像头';
        if (err && err.name === 'NotReadableError') return '摄像头被其他程序占用';
        return (err && err.message) || '未知错误';
    }

    // 页面内相机：实时预览，可连续拍多张，每张交给 onShot(blob)；有多个摄像头时可切换前后置。打不开时 reject（调用方退回选文件）
    async function openCamera(onShot) {
        // 先扫描摄像头：没有新的就用主页排序里的默认摄像头，有新的弹框让用户选；取消则不打开
        const picked = await CameraPicker.choose();
        if (picked === undefined) return;
        let deviceId = picked;   // null = 浏览器默认
        let stream = null;
        async function start() {
            if (stream) stream.getTracks().forEach((t) => t.stop());
            // 不写死期望值：先打开，再按摄像头自己报告的最大宽、高重新要求（见下面 applyConstraints），要的就是它实际能给的
            const video = {};
            if (deviceId) video.deviceId = { exact: deviceId };
            try {
                stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
            } catch (err) {
                throw new Error(cameraErrorText(err));
            }
            const t = stream.getVideoTracks()[0];
            const cp = (t && t.getCapabilities && t.getCapabilities()) || {};
            if (cp.width && cp.width.max && cp.height && cp.height.max) {
                await t.applyConstraints({ width: { ideal: cp.width.max }, height: { ideal: cp.height.max } }).catch(() => {});
            }
        }
        await start();

        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        const multi = devices.filter((d) => d.kind === 'videoinput').length > 1;

        const overlay = document.createElement('div');
        overlay.className = 'camera-overlay';
        overlay.innerHTML = `
            <video class="camera-video" autoplay playsinline muted></video>
            <div class="camera-bar">
                <button type="button" class="btn-secondary btn-sm" data-cam-done>完成</button>
                <button type="button" class="camera-shutter" data-cam-shot title="拍照"></button>
                <button type="button" class="btn-secondary btn-sm" data-cam-flip ${multi ? '' : 'hidden'}>🔄 切换</button>
            </div>
            <div class="camera-count" data-cam-count></div>
            <div class="camera-zoom" data-cam-zoom-box hidden>🔍 <input type="range" data-cam-zoom> <span data-cam-zoom-val></span></div>
            <div class="camera-info" data-cam-info></div>`;
        const video = overlay.querySelector('video');
        video.srcObject = stream;
        let shots = 0;

        // 摄像头支持什么就开什么：连续自动对焦、变焦滑块、点画面重新对焦。
        // 电脑上用手机当摄像头（Phone Link / DroidCam 等虚拟摄像头）通常不向浏览器开放这些，没有就不显示，对焦变焦要在手机端的软件里调
        const zoomBox = overlay.querySelector('[data-cam-zoom-box]');
        const zoomInput = overlay.querySelector('[data-cam-zoom]');
        const zoomVal = overlay.querySelector('[data-cam-zoom-val]');
        let caps = {};
        const track = () => (stream && stream.getVideoTracks()[0]) || null;
        const apply = (c) => { const t = track(); return t ? t.applyConstraints({ advanced: [c] }).catch(() => {}) : Promise.resolve(); };
        function setupTrack() {
            const t = track();
            caps = (t && t.getCapabilities && t.getCapabilities()) || {};
            if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) apply({ focusMode: 'continuous' });
            if (caps.zoom && caps.zoom.max > caps.zoom.min) {
                zoomInput.min = caps.zoom.min; zoomInput.max = caps.zoom.max; zoomInput.step = caps.zoom.step || 0.1;
                const cur = (t.getSettings && t.getSettings().zoom) || caps.zoom.min;
                zoomInput.value = cur; zoomVal.textContent = `${Number(cur).toFixed(1)}×`;
                zoomBox.hidden = false;
            } else {
                zoomBox.hidden = true;
            }
        }
        function showInfo() {
            const s = track() && track().getSettings ? track().getSettings() : {};
            overlay.querySelector('[data-cam-info]').textContent = s.width ? `${s.width}×${s.height}` : '';
        }
        zoomInput.addEventListener('input', () => { zoomVal.textContent = `${Number(zoomInput.value).toFixed(1)}×`; apply({ zoom: Number(zoomInput.value) }); });
        video.addEventListener('click', async () => {
            if (!Array.isArray(caps.focusMode) || !caps.focusMode.includes('single-shot')) return;
            await apply({ focusMode: 'single-shot' });
            setTimeout(() => { if (caps.focusMode.includes('continuous')) apply({ focusMode: 'continuous' }); }, 1500);
        });
        video.addEventListener('loadedmetadata', showInfo);
        setupTrack();

        const close = () => {
            if (stream) stream.getTracks().forEach((t) => t.stop());
            overlay.remove();
            document.removeEventListener('keydown', onKey, true);
        };
        const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
        document.addEventListener('keydown', onKey, true);

        overlay.querySelector('[data-cam-done]').addEventListener('click', close);
        // 切换：在当前连接的摄像头之间轮换（只影响这一次，不改默认顺序）
        overlay.querySelector('[data-cam-flip]').addEventListener('click', async () => {
            const cams = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((d) => d.kind === 'videoinput');
            if (cams.length < 2) return;
            const cur = stream && stream.getVideoTracks()[0] && stream.getVideoTracks()[0].getSettings().deviceId;
            const at = cams.findIndex((d) => d.deviceId === cur);
            deviceId = cams[(at + 1) % cams.length].deviceId;
            try { await start(); video.srcObject = stream; setupTrack(); } catch (err) { Toast.error(err.message); }
        });
        overlay.querySelector('[data-cam-shot]').addEventListener('click', () => {
            if (!video.videoWidth) return;
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.getContext('2d').drawImage(video, 0, 0);
            canvas.toBlob((blob) => {
                if (!blob) return;
                shots++;
                overlay.querySelector('[data-cam-count]').textContent = `已拍 ${shots} 张`;
                onShot(blob);
            }, 'image/jpeg', 0.92);
        });
        document.body.appendChild(overlay);
    }

    // ---------- 弹窗里的编辑器 ----------

    function editorHtml() {
        return `
            <div class="photo-editor" data-photo-editor>
                <div class="photo-actions">
                    <button type="button" class="btn-secondary btn-sm" data-photo-camera>📷 拍照</button>
                    ${isTouchDevice() ? '' : '<button type="button" class="btn-secondary btn-sm" data-photo-phone title="用手机自带相机拍，照片传回电脑">📱 手机拍</button>'}
                    <button type="button" class="btn-secondary btn-sm" data-photo-upload>🖼️ 上传照片</button>
                    <input type="file" accept="image/*" capture="environment" hidden data-photo-input="camera">
                    <input type="file" accept="image/*" multiple hidden data-photo-input="upload">
                </div>
                <div class="photo-thumbs" data-photo-list></div>
            </div>`;
    }

    function bindEditor(root, existingIds) {
        const box = root.querySelector('[data-photo-editor]');
        const list = box.querySelector('[data-photo-list]');
        let kept = (existingIds || []).slice();
        const pending = [];   // { blob, url }

        function render() {
            list.innerHTML = kept.map((id) => `<span class="photo-thumb"><img data-photo="${Utils.escapeHtml(id)}" alt="照片"><button type="button" class="photo-rm" data-rm-kept="${Utils.escapeHtml(id)}" title="移除">✕</button></span>`).join('')
                + pending.map((p, i) => `<span class="photo-thumb"><img src="${p.url}" alt="新照片" data-pending="${i}" title="${Math.round(p.blob.size / 1024)} KB"><button type="button" class="photo-rm" data-rm-pending="${i}" title="移除">✕</button></span>`).join('');
        }

        // 返回成功接收的张数（手机回传用它判断要不要告诉手机「电脑读不了这张」）。
        // 读得了的照片排进预览队列，由用户选档位后才加入；这里先试读一次，读不了立刻报错，不让手机白等回执
        async function addFiles(files, { quiet = false } = {}) {
            let added = 0;
            for (const file of Array.from(files)) {
                try {
                    const probe = await decode(file);
                    if (probe.close) probe.close();
                    added++;
                    enqueueChoose(async () => {
                        if (!document.body.contains(box)) return;    // 登记弹窗已经关了
                        const blob = await chooseLevel(file);
                        if (!blob) return;
                        pending.push({ blob, url: URL.createObjectURL(blob) });
                        render();
                    });
                } catch (err) {
                    if (!quiet) Toast.error(err.message);
                }
            }
            return added;
        }

        box.querySelector('[data-photo-camera]').addEventListener('click', async () => {
            const fallback = () => box.querySelector('[data-photo-input="camera"]').click();
            // 手机 / 平板（主输入是触摸）：capture 会直接拉起系统相机，画质和对焦都最好
            // 电脑：capture 无效（只会弹文件选择框），改用 getUserMedia 在页面里打开摄像头
            if (isTouchDevice() || !hasLiveCamera()) { fallback(); return; }
            try {
                await openCamera(async (blob) => { await addFiles([blob]); });   // 用户在选择框里取消时直接返回
            } catch (err) {
                Toast.warning(`无法打开摄像头（${err.message}），请选择图片文件`);
                fallback();
            }
        });
        const phoneBtn = box.querySelector('[data-photo-phone]');
        if (phoneBtn) phoneBtn.addEventListener('click', () => PhoneLink.open(async (blob) => {
            // 读不了就抛错：PhoneLink 会把原因回给手机，手机那张照片显示失败，而不是假装「已发送」
            if (!(await addFiles([blob], { quiet: true }))) throw new Error('电脑读不了这张照片（可能是 HEIC 格式）');
        }));
        box.querySelector('[data-photo-upload]').addEventListener('click', () => box.querySelector('[data-photo-input="upload"]').click());
        box.querySelectorAll('[data-photo-input]').forEach((input) => input.addEventListener('change', async () => {
            await addFiles(input.files);
            input.value = '';
        }));
        // 移除照片：先确认；移除后提示条里可「撤销」（放回原来的位置）。
        // 新拍的照片被移除后先不释放 object URL，撤销还要用；保存时（finalize）统一释放
        const discarded = [];
        list.addEventListener('click', async (e) => {
            const k = e.target.closest('[data-rm-kept]');
            const p = e.target.closest('[data-rm-pending]');
            if (!k && !p) return;
            const ok = await Modal.confirm({ title: '删除照片', text: '确定删除这张照片吗？', confirmText: '删除', danger: true });
            if (!ok) return;
            let undo;
            if (k) {
                const index = kept.indexOf(k.dataset.rmKept);
                if (index < 0) return;
                const [id] = kept.splice(index, 1);
                undo = () => { if (!kept.includes(id)) kept.splice(Math.min(index, kept.length), 0, id); };
            } else {
                const index = Number(p.dataset.rmPending);
                const [gone] = pending.splice(index, 1);
                if (!gone) return;
                discarded.push(gone);
                undo = () => {
                    const at = discarded.indexOf(gone);
                    if (at >= 0) discarded.splice(at, 1);
                    pending.splice(Math.min(index, pending.length), 0, gone);
                };
            }
            render();
            Toast.action('已删除照片', '撤销', () => { undo(); render(); });
        });
        render();

        // 大图里点旋转：还没保存的照片直接转当前这份，结果记在 pending 里，保存时一并存
        pendingRotators.set(list, async (i, dir) => {
            const p = pending[i];
            if (!p) return null;
            const blob = await rotateBlob(p.blob, dir > 0 ? 1 : 3);
            URL.revokeObjectURL(p.url);
            p.blob = blob;
            p.url = URL.createObjectURL(blob);
            render();
            return p.url;
        });

        return {
            // 换一批已保存的照片（切换日期时载入那天已有记录的照片）；新选还没保存的照片不动
            setKept(ids) { kept = (ids || []).slice(); render(); },
            // 把新选的照片写进存储，返回最终要记在记录上的 photoIds（旧的未被移除的 + 新的）
            async finalize() {
                const ids = kept.slice();
                for (const p of pending) {
                    const id = Utils.uid('ph');
                    await AppState.photoPut(id, p.blob);
                    ids.push(id);
                    URL.revokeObjectURL(p.url);
                }
                pending.length = 0;   // 连同 src（原图）一起释放
                discarded.forEach((p) => URL.revokeObjectURL(p.url));
                discarded.length = 0;
                return ids;
            }
        };
    }

    window.Photos = { editorHtml, bindEditor, viewHtml, LEVELS, levelOptions, getLevel, setLevel, getCustomQuality, setCustomQuality };
})();
