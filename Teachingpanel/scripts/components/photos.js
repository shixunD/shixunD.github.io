// photos.js —— 照片：登记弹窗里的「拍照 / 上传」编辑器、记录里的缩略图、点击放大
// 全局命名空间：window.Photos
//
// 记录（作业登记 record / 背诵检查 recCheck / 其他记录 remark）只存 photoIds: string[]，照片本体在 IndexedDB 的 photos 存储（见 state.js）。
//   Photos.editorHtml()                         弹窗里的照片编辑块 HTML
//   Photos.bindEditor(root, existingIds)        绑定，返回 { finalize() }：把新选的照片存起来，返回最终的 photoIds
//   Photos.viewHtml(ids)                        只读缩略图（空数组返回空串）；<img data-photo> 由全局 MutationObserver 自动补 src
// 拍照：手机/平板（pointer: coarse）用 <input capture> 拉起系统相机；电脑 capture 无效，改用 getUserMedia 页内相机（openCamera）。
// 保存前按画质挡位（PRESETS，主页设置里选）缩小并自适应质量（WebP，不支持时 JPEG），保证每张不超过挡位的体积上限，避免手机原图（几 MB）撑爆存储和 .db 导出文件。

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

    // 画质挡位：最长边（像素）+ 每张照片体积上限。体积超限时先降质量，降到底还超再缩小尺寸，保证每张不超过上限
    const PRESETS = [
        { key: 'low',    label: '省空间', side: 1600, maxBytes: 300 * 1024 },
        { key: 'normal', label: '标准',   side: 2000, maxBytes: 600 * 1024 },
        { key: 'high',   label: '清晰',   side: 2400, maxBytes: 1024 * 1024 },
        { key: 'ultra',  label: '超清',   side: 3200, maxBytes: 2 * 1024 * 1024 }
    ];
    const LS_QUALITY = 'teachingPanel.photoQuality';
    const MIN_Q = 0.5, START_Q = 0.9;

    function getPreset() {
        const key = Utils.lsGet(LS_QUALITY, 'high');
        return PRESETS.find((p) => p.key === key) || PRESETS[2];
    }
    function setPreset(key) { if (PRESETS.some((p) => p.key === key)) Utils.lsSet(LS_QUALITY, key); }

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

    // 读图（按 EXIF 摆正）→ 顺时针转 rot×90° → 按画质挡位缩小并压缩到体积上限以内。
    // 旋转总是从原图重新压缩（而不是对压缩过的图再压一次），转几次画质都不会越来越差
    async function compress(file, rot = 0) {
        let bitmap;
        try {
            bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        } catch (e) {
            throw new Error('无法读取这张图片，请换一张试试');
        }
        const preset = getPreset();
        const turned = rot % 2 === 1;
        let scale = Math.min(1, preset.side / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        let blob = null;
        for (let round = 0; round < 6; round++) {
            const w = Math.max(1, Math.round(bitmap.width * scale));
            const h = Math.max(1, Math.round(bitmap.height * scale));
            canvas.width = turned ? h : w;
            canvas.height = turned ? w : h;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate(rot * Math.PI / 2);
            ctx.drawImage(bitmap, -w / 2, -h / 2, w, h);
            blob = await encodeImage(canvas, START_Q);
            if (blob.size <= preset.maxBytes) break;
            // 在 [MIN_Q, START_Q] 里二分找「不超限的最高质量」；全都超限就缩小尺寸再来
            let lo = MIN_Q, hi = START_Q, best = null;
            for (let i = 0; i < 5; i++) {
                const mid = (lo + hi) / 2;
                const b = await encodeImage(canvas, mid);
                if (b.size <= preset.maxBytes) { best = b; lo = mid; } else { hi = mid; }
            }
            if (best) { blob = best; break; }
            scale *= 0.85;
        }
        if (bitmap.close) bitmap.close();
        return blob;
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

    function openLightbox(src) {
        const overlay = document.createElement('div');
        overlay.className = 'photo-lightbox';
        overlay.innerHTML = `<img src="${src}" alt="照片"><button type="button" class="photo-lightbox-close" title="关闭">✕</button>`;
        const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
        const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
        overlay.addEventListener('click', close);
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(overlay);
    }

    document.addEventListener('click', (e) => {
        const img = e.target.closest('.photo-thumb img');
        if (img && img.src) openLightbox(img.src);
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
            const video = { width: { ideal: 3840 }, height: { ideal: 2160 } };   // 尽量要最高分辨率，摄像头支持多少给多少
            if (deviceId) video.deviceId = { exact: deviceId };
            try {
                stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
            } catch (err) {
                throw new Error(cameraErrorText(err));
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
            list.innerHTML = kept.map((id) => `<span class="photo-thumb"><img data-photo="${Utils.escapeHtml(id)}" alt="照片"><button type="button" class="photo-rot" data-rot-kept="${Utils.escapeHtml(id)}" title="顺时针旋转 90°">↻</button><button type="button" class="photo-rm" data-rm-kept="${Utils.escapeHtml(id)}" title="移除">✕</button></span>`).join('')
                + pending.map((p, i) => `<span class="photo-thumb"><img src="${p.url}" alt="新照片" title="${Math.round(p.blob.size / 1024)} KB"><button type="button" class="photo-rot" data-rot-pending="${i}" title="顺时针旋转 90°">↻</button><button type="button" class="photo-rm" data-rm-pending="${i}" title="移除">✕</button></span>`).join('');
        }

        async function addFiles(files) {
            for (const file of Array.from(files)) {
                try {
                    const blob = await compress(file);
                    pending.push({ blob, url: URL.createObjectURL(blob), src: file, rot: 0 });   // src/rot：旋转时从原图重新压缩
                } catch (err) {
                    Toast.error(err.message);
                }
            }
            render();
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
        if (phoneBtn) phoneBtn.addEventListener('click', () => PhoneLink.open((blob) => addFiles([blob])));
        box.querySelector('[data-photo-upload]').addEventListener('click', () => box.querySelector('[data-photo-input="upload"]').click());
        box.querySelectorAll('[data-photo-input]').forEach((input) => input.addEventListener('change', async () => {
            await addFiles(input.files);
            input.value = '';
        }));
        // 移除照片：先确认；移除后提示条里可「撤销」（放回原来的位置）。
        // 新拍的照片被移除后先不释放 object URL，撤销还要用；保存时（finalize）统一释放
        const discarded = [];
        list.addEventListener('click', async (e) => {
            const rk = e.target.closest('[data-rot-kept]');
            const rp = e.target.closest('[data-rot-pending]');
            if (rk || rp) {
                try {
                    if (rp) {
                        const p = pending[Number(rp.dataset.rotPending)];
                        if (!p) return;
                        p.rot = (p.rot + 1) % 4;
                        const blob = await compress(p.src, p.rot);
                        URL.revokeObjectURL(p.url);
                        p.blob = blob;
                        p.url = URL.createObjectURL(blob);
                    } else {
                        // 已保存的照片：转完当作新照片放进待保存列表（以存着的那张为原图），原来的那张在保存记录后由 gcPhotos 清理
                        const id = rk.dataset.rotKept;
                        const index = kept.indexOf(id);
                        const old = await AppState.photoGet(id);
                        if (index < 0 || !old) return;
                        const blob = await compress(old, 1);
                        kept.splice(index, 1);
                        pending.push({ blob, url: URL.createObjectURL(blob), src: old, rot: 1 });
                    }
                    render();
                } catch (err) {
                    Toast.error('旋转失败：' + err.message);
                }
                return;
            }
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

        return {
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

    window.Photos = { editorHtml, bindEditor, viewHtml, PRESETS, getPreset, setPreset };
})();
