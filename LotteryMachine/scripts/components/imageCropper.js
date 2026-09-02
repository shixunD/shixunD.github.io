// imageCropper.js —— 纯 canvas 实现的 1:1 头像裁剪（拖动定位 + 缩放），无外部依赖
// 全局命名空间：window.ImageCropper
// 用法：ImageCropper.open(file).then(dataUrl => ...) dataUrl 为 null 表示用户取消

(function () {
    'use strict';

    const OUTPUT_SIZE = 320; // 输出的正方形头像边长（像素）

    function open(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => buildDialog(reader.result, resolve);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
        });
    }

    function buildDialog(srcDataUrl, resolve) {
        const img = new Image();
        img.onload = () => showCropperUI(img, resolve);
        img.onerror = () => resolve(null);
        img.src = srcDataUrl;
    }

    function showCropperUI(img, resolve) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay cropper-modal';
        overlay.innerHTML = `
            <div class="modal-box">
                <h2>裁剪头像 (1:1)</h2>
                <div class="cropper-canvas-wrap">
                    <canvas id="cropper-canvas"></canvas>
                </div>
                <div class="cropper-zoom-row">
                    <span style="font-size:0.8rem;color:var(--text-secondary);">缩放</span>
                    <input type="range" id="cropper-zoom" min="1" max="4" step="0.01" value="1">
                </div>
                <div class="modal-actions">
                    <button type="button" class="btn-secondary" data-action="cancel">取消</button>
                    <button type="button" class="btn-primary" data-action="confirm">确认裁剪</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const canvas = overlay.querySelector('#cropper-canvas');
        const zoomInput = overlay.querySelector('#cropper-zoom');
        const ctx = canvas.getContext('2d');

        // 逻辑画布大小固定为正方形，CSS 会拉伸铺满容器
        const SIZE = 320;
        canvas.width = SIZE;
        canvas.height = SIZE;

        const baseScale = Math.max(SIZE / img.width, SIZE / img.height);
        let zoom = 1;
        let offsetX = 0; // 图片中心相对画布中心的偏移（画布坐标系）
        let offsetY = 0;

        function draw() {
            const scale = baseScale * zoom;
            const drawW = img.width * scale;
            const drawH = img.height * scale;
            ctx.clearRect(0, 0, SIZE, SIZE);
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, SIZE, SIZE);
            ctx.clip();
            const cx = SIZE / 2 + offsetX;
            const cy = SIZE / 2 + offsetY;
            ctx.drawImage(img, cx - drawW / 2, cy - drawH / 2, drawW, drawH);
            ctx.restore();

            // 圆形辅助线，提示最终会按圆形头像展示
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.7)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 2, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        function clampOffset() {
            const scale = baseScale * zoom;
            const drawW = img.width * scale;
            const drawH = img.height * scale;
            const maxX = Math.max(0, (drawW - SIZE) / 2);
            const maxY = Math.max(0, (drawH - SIZE) / 2);
            offsetX = Math.min(maxX, Math.max(-maxX, offsetX));
            offsetY = Math.min(maxY, Math.max(-maxY, offsetY));
        }

        draw();

        let dragging = false;
        let lastX = 0;
        let lastY = 0;

        function toCanvasCoord(clientX, clientY) {
            const rect = canvas.getBoundingClientRect();
            return {
                x: (clientX - rect.left) * (SIZE / rect.width),
                y: (clientY - rect.top) * (SIZE / rect.height)
            };
        }

        function pointerDown(e) {
            dragging = true;
            const p = toCanvasCoord(e.clientX, e.clientY);
            lastX = p.x;
            lastY = p.y;
        }
        function pointerMove(e) {
            if (!dragging) return;
            const p = toCanvasCoord(e.clientX, e.clientY);
            offsetX += p.x - lastX;
            offsetY += p.y - lastY;
            lastX = p.x;
            lastY = p.y;
            clampOffset();
            draw();
        }
        function pointerUp() { dragging = false; }

        canvas.addEventListener('pointerdown', pointerDown);
        window.addEventListener('pointermove', pointerMove);
        window.addEventListener('pointerup', pointerUp);

        zoomInput.addEventListener('input', () => {
            zoom = Number(zoomInput.value);
            clampOffset();
            draw();
        });

        function cleanup() {
            window.removeEventListener('pointermove', pointerMove);
            window.removeEventListener('pointerup', pointerUp);
            overlay.remove();
        }

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                cleanup();
                resolve(null);
            }
            const action = e.target.closest('[data-action]');
            if (!action) return;

            if (action.dataset.action === 'cancel') {
                cleanup();
                resolve(null);
                return;
            }

            if (action.dataset.action === 'confirm') {
                const out = document.createElement('canvas');
                out.width = OUTPUT_SIZE;
                out.height = OUTPUT_SIZE;
                out.getContext('2d').drawImage(canvas, 0, 0, SIZE, SIZE, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
                const dataUrl = out.toDataURL('image/jpeg', 0.88);
                cleanup();
                resolve(dataUrl);
            }
        });
    }

    window.ImageCropper = { open };
})();
