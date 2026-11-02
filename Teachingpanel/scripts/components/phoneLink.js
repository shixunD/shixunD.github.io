// phoneLink.js —— 电脑端：「📱 手机拍」——弹出二维码，手机扫码后用手机自己的相机拍，照片直连传回电脑
// 全局命名空间：window.PhoneLink
//
//   PhoneLink.open(onPhoto)   打开接收面板；手机每传来一张就调用 onPhoto(blob)（返回 Promise，resolve 后给手机回执）。面板关闭时 resolve
//
// 原理：PeerJS（WebRTC）。电脑端有一个固定配对码（localStorage），手机第一次扫码后也记住它；
// 之后只要电脑上点开本面板，手机打开拍照页（phone.html）就会自动连上，不用再扫码，可以一张接一张连续拍。
// 牵线服务（PeerJS 公共服务）只交换连接信息，照片是手机到电脑的直连。PeerJS 和二维码库在第一次点击时才加载（scripts/vendor/）。

(function () {
    'use strict';

    const cfg = window.PhoneLinkConfig;
    const esc = (s) => Utils.escapeHtml(s);
    const loaded = {};
    let active = false;

    function loadScript(src) {
        if (!loaded[src]) {
            loaded[src] = new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = src;
                s.onload = resolve;
                s.onerror = () => { delete loaded[src]; reject(new Error('加载失败：' + src)); };
                document.head.appendChild(s);
            });
        }
        return loaded[src];
    }

    function newPeerId() {
        const bytes = new Uint8Array(12);
        crypto.getRandomValues(bytes);
        return 'tp-' + Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
    }
    function getPeerId() {
        let id = Utils.lsGet(cfg.LS_PEER_ID, '');
        if (!/^tp-[a-z0-9]{10,}$/.test(id)) { id = newPeerId(); Utils.lsSet(cfg.LS_PEER_ID, id); }
        return id;
    }

    function pairUrl(peerId) {
        // 配对码放在 # 后面：不会随请求发给服务器
        return new URL('phone.html', location.href).href + '#' + peerId;
    }

    function qrSvg(text) {
        const qr = window.qrcode(0, 'M');
        qr.addData(text);
        qr.make();
        return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    }

    async function open(onPhoto) {
        if (active) return;
        try {
            await Promise.all([loadScript('./scripts/vendor/peerjs.min.js'), loadScript('./scripts/vendor/qrcode.js')]);
        } catch (err) {
            Toast.error('无法加载手机连接组件，请检查网络后重试');
            return;
        }
        active = true;

        return new Promise((resolve) => {
            const isLocal = /^(localhost|127\.|\[::1\])/.test(location.hostname);
            const overlay = document.createElement('div');
            overlay.className = 'phonelink-overlay';
            overlay.innerHTML = `
                <div class="phonelink-box" role="dialog" aria-modal="true">
                    <h2>📱 用手机拍</h2>
                    <div class="phonelink-qr" data-pl-qr></div>
                    <p class="hint">用手机扫上面的二维码，打开拍照页后点「📷 拍照」，用手机自带的相机拍（对焦、变焦、画质都和平时拍照一样），拍完自动传到电脑，可以连续拍。<b>手机第一次扫过后会记住电脑</b>，以后只要电脑上打开这个窗口，手机打开同一个页面就会自动连上。</p>
                    ${isLocal ? '<p class="phonelink-warn">当前是本地调试地址，手机打不开。请在线上网址使用。</p>' : ''}
                    <div class="phonelink-status" data-pl-status>正在连接…</div>
                    <div class="phonelink-thumbs" data-pl-thumbs></div>
                    <div class="modal-actions">
                        <button type="button" class="btn-secondary btn-sm" data-pl-reset title="换一个新的配对码，原来扫过的手机需要重新扫码">重新生成二维码</button>
                        <button type="button" class="btn-primary" data-pl-done>完成</button>
                    </div>
                </div>`;
            const statusEl = overlay.querySelector('[data-pl-status]');
            const thumbs = overlay.querySelector('[data-pl-thumbs]');
            const qrBox = overlay.querySelector('[data-pl-qr]');

            let peer = null;
            let peerId = getPeerId();
            const conns = new Set();
            const urls = [];
            let received = 0;
            let state = 'starting';   // starting | waiting | connected | error
            let errorText = '';
            let retryTimer = null;
            let idRetries = 0;
            let closed = false;

            function refreshStatus() {
                if (state === 'connected') statusEl.textContent = `✅ 手机已连接${received ? ` · 已收到 ${received} 张` : ''}`;
                else if (state === 'waiting') statusEl.textContent = `⏳ 等待手机连接…${received ? `（已收到 ${received} 张）` : ''}`;
                else if (state === 'error') statusEl.textContent = '⚠ ' + errorText;
                else statusEl.textContent = '正在连接牵线服务…';
                statusEl.className = 'phonelink-status ' + state;
            }
            function setState(s, text) { state = s; errorText = text || ''; refreshStatus(); }

            function drawQr() {
                const url = pairUrl(peerId);
                qrBox.innerHTML = qrSvg(url) + `<div class="phonelink-url">${esc(url.replace(/#.*$/, ''))}</div>`;
            }

            function start() {
                if (closed) return;
                setState('starting');
                peer = new window.Peer(peerId, cfg.PEER_OPTIONS);
                peer.on('open', () => { idRetries = 0; setState(conns.size ? 'connected' : 'waiting'); });
                peer.on('connection', (conn) => {
                    conn.on('open', () => { conns.add(conn); setState('connected'); conn.send({ type: 'hello' }); });
                    conn.on('data', async (msg) => {
                        if (!msg || msg.type !== 'photo' || !msg.buf) return;
                        const blob = new Blob([msg.buf], { type: msg.mime || 'image/jpeg' });
                        try {
                            await onPhoto(blob);
                            received++;
                            const url = URL.createObjectURL(blob);
                            urls.push(url);
                            thumbs.insertAdjacentHTML('beforeend', `<span class="photo-thumb"><img src="${url}" alt="已收到"></span>`);
                            refreshStatus();
                            conn.send({ type: 'ack', id: msg.id });
                        } catch (err) {
                            conn.send({ type: 'error', id: msg.id, text: (err && err.message) || '电脑处理失败' });
                        }
                    });
                    const gone = () => { conns.delete(conn); if (!closed && state === 'connected' && !conns.size) setState('waiting'); };
                    conn.on('close', gone);
                    conn.on('error', gone);
                });
                peer.on('disconnected', () => { if (!closed && !peer.destroyed) { try { peer.reconnect(); } catch (e) { /* 等下一次 */ } } });
                peer.on('error', (err) => {
                    if (closed) return;
                    if (err.type === 'unavailable-id') {
                        // 刚刷新页面时，牵线服务上还留着旧的同名连接，几秒后会过期：同一个码重试几次
                        if (idRetries++ < 6) { retryTimer = setTimeout(restart, 3000); setState('starting'); }
                        else setState('error', '配对码被占用（电脑上是否在别的窗口也打开了本面板？），可点「重新生成二维码」');
                    } else if (err.type === 'peer-unavailable') {
                        /* 手机侧的错误，这里不会出现 */
                    } else {
                        setState('error', '连接牵线服务失败，请检查网络；正在重试…');
                        retryTimer = setTimeout(restart, 5000);
                    }
                });
            }
            function restart() {
                if (closed) return;
                if (peer) { try { peer.destroy(); } catch (e) { /* 忽略 */ } }
                conns.clear();
                start();
            }

            function finish() {
                if (closed) return;
                closed = true;
                clearTimeout(retryTimer);
                if (peer) { try { peer.destroy(); } catch (e) { /* 忽略 */ } }
                urls.forEach((u) => URL.revokeObjectURL(u));
                overlay.remove();
                document.removeEventListener('keydown', onKey, true);
                active = false;
                resolve(received);
            }
            const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); finish(); } };

            overlay.querySelector('[data-pl-done]').addEventListener('click', finish);
            overlay.querySelector('[data-pl-reset]').addEventListener('click', async () => {
                const ok = await Modal.confirm({ title: '重新生成二维码', text: '之前扫过码的手机需要重新扫一次。确定吗？', confirmText: '重新生成' });
                if (!ok) return;
                peerId = newPeerId();
                Utils.lsSet(cfg.LS_PEER_ID, peerId);
                idRetries = 0;
                drawQr();
                restart();
            });
            document.addEventListener('keydown', onKey, true);
            document.body.appendChild(overlay);
            drawQr();
            start();
        });
    }

    window.PhoneLink = { open };
})();
