// photos.js —— 照片：登记弹窗里的「拍照 / 上传」编辑器、记录里的缩略图、点击放大
// 全局命名空间：window.Photos
//
// 记录（作业登记 record / 背诵检查 recCheck / 其他记录 remark）只存 photoIds: string[]，照片本体在 IndexedDB 的 photos 存储（见 state.js）。
//   Photos.editorHtml()                         弹窗里的照片编辑块 HTML
//   Photos.bindEditor(root, existingIds)        绑定，返回 { finalize() }：把新选的照片存起来，返回最终的 photoIds
//   Photos.viewHtml(ids)                        只读缩略图（空数组返回空串）；<img data-photo> 由全局 MutationObserver 自动补 src
// 拍照：手机/平板（pointer: coarse）用 <input capture> 拉起系统相机；电脑 capture 无效，改用 getUserMedia 页内相机（openCamera）。
// 保存前会用 canvas 缩到最长边 1600px、JPEG 0.8，避免手机原图（几 MB）撑爆存储和 .db 导出文件。

(function () {
    'use strict';

    const MAX_SIDE = 1600;
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

    async function compress(file) {
        let bitmap;
        try {
            bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        } catch (e) {
            throw new Error('无法读取这张图片，请换一张试试');
        }
        const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        if (bitmap.close) bitmap.close();
        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('图片处理失败'))), 'image/jpeg', 0.8);
        });
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
            const video = { width: { ideal: 1920 }, height: { ideal: 1440 } };
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
            <div class="camera-count" data-cam-count></div>`;
        const video = overlay.querySelector('video');
        video.srcObject = stream;
        let shots = 0;

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
            try { await start(); video.srcObject = stream; } catch (err) { Toast.error(err.message); }
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
                + pending.map((p, i) => `<span class="photo-thumb"><img src="${p.url}" alt="新照片"><button type="button" class="photo-rm" data-rm-pending="${i}" title="移除">✕</button></span>`).join('');
        }

        async function addFiles(files) {
            for (const file of Array.from(files)) {
                try {
                    const blob = await compress(file);
                    pending.push({ blob, url: URL.createObjectURL(blob) });
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
                pending.length = 0;
                discarded.forEach((p) => URL.revokeObjectURL(p.url));
                discarded.length = 0;
                return ids;
            }
        };
    }

    window.Photos = { editorHtml, bindEditor, viewHtml };
})();
