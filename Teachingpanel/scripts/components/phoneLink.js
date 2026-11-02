// phoneLink.js —— 电脑端：「📱 手机拍」——弹出二维码，手机扫码后用手机自己的相机拍，照片直连传回电脑
// 全局命名空间：window.PhoneLink
//
//   PhoneLink.open(onPhoto)   打开接收面板；手机每传来一张就调用 onPhoto(blob)（返回 Promise，resolve 后给手机回执）。面板关闭时 resolve
//
// 原理：PeerJS（WebRTC）。电脑端有一个固定配对码（localStorage），手机第一次扫码后也记住它；
// 之后只要电脑上点开本面板，手机打开拍照页（phone.html）就会自动连上，不用再扫码，可以一张接一张连续拍。
// 牵线服务（PeerJS 公共服务）只交换连接信息，照片是手机到电脑的直连；没有可用的中转（TURN），直连打不通时面板给出换网络的建议。
// 面板状态：连牵线服务器 → 等待手机 → 手机找到电脑、正在打通直连 → 已连接 / 直连没打通。底部「连接诊断」显示细节。
// PeerJS 和二维码库在第一次点击时才加载（scripts/vendor/）。

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
                    <p class="hint">用手机自带的相机或浏览器扫上面的二维码（<b>不要用微信扫</b>），打开拍照页后点「📷 拍照」，用手机自带的相机拍，拍完自动传到电脑，可以连续拍。<b>手机和电脑连同一个 WiFi 最稳</b>，不行就让电脑连手机热点。手机第一次扫过后会记住电脑，以后只要电脑上打开这个窗口，手机打开同一个页面就会自动连上。</p>
                    ${isLocal ? '<p class="phonelink-warn">当前是本地调试地址，手机打不开。请在线上网址使用。</p>' : ''}
                    <div class="phonelink-status" data-pl-status>正在连接…</div>
                    <div class="phonelink-tips" data-pl-tips hidden><b>手机找到了这台电脑，但两边之间连不通，可以这样试：</b>${cfg.TIPS_HTML}</div>
                    <div class="phonelink-thumbs" data-pl-thumbs></div>
                    <details class="phonelink-diag"><summary>连接诊断</summary><div class="phonelink-diag-grid" data-pl-diag></div></details>
                    <div class="modal-actions">
                        <button type="button" class="btn-secondary btn-sm" data-pl-reset title="换一个新的配对码，原来扫过的手机需要重新扫码">重新生成二维码</button>
                        <button type="button" class="btn-primary" data-pl-done>完成</button>
                    </div>
                </div>`;
            const statusEl = overlay.querySelector('[data-pl-status]');
            const tipsEl = overlay.querySelector('[data-pl-tips]');
            const diagEl = overlay.querySelector('[data-pl-diag]');
            const thumbs = overlay.querySelector('[data-pl-thumbs]');
            const qrBox = overlay.querySelector('[data-pl-qr]');

            let peer = null;
            let peerId = getPeerId();
            const conns = new Set();
            const urls = [];
            let received = 0;
            let state = 'starting';   // starting | waiting | pairing | connected | p2pfail | error
            let errorText = '';
            let retryTimer = null;
            let idRetries = 0;
            let closed = false;
            let lastIce = null;       // 最近一次手机连接的诊断信息（PhoneLinkConfig.watchConnection）
            let broker = '连接中…';
            let p2pFails = 0;         // 连续几次直连没打通；>0 时手机重试期间建议也一直显示，连上后清零
            const failedConns = new WeakSet();
            const seenIds = new Set();   // 本次面板已收下的照片编号（手机重发时去重）
            const processing = new Map();   // 正在处理的照片编号 -> Promise

            function refreshStatus() {
                const got = received ? `（已收到 ${received} 张）` : '';
                const text = {
                    starting: '正在连接牵线服务器…',
                    waiting: `⏳ 等待手机连接…${got}`,
                    pairing: p2pFails ? `📱 手机正在再次尝试连接（前 ${p2pFails} 次直连没打通）…${got}` : `📱 手机找到了这台电脑，正在打通直连…${got}`,
                    connected: `✅ 手机已连接${received ? ` · 已收到 ${received} 张` : ''}`,
                    p2pfail: `⚠ 手机找到了这台电脑，但直连没打通（已失败 ${p2pFails} 次，手机会自动重试）${got}`,
                    error: '⚠ ' + errorText
                }[state];
                statusEl.textContent = text;
                statusEl.className = 'phonelink-status ' + state;
                tipsEl.hidden = !(state === 'p2pfail' || (p2pFails > 0 && state === 'pairing'));
                renderDiag();
            }
            // 同一条连接可能先后触发 ICE failed、超时、close，只算一次失败
            function markP2pFail(conn) {
                if (closed || conns.has(conn)) return;
                if (!failedConns.has(conn)) { failedConns.add(conn); p2pFails++; }
                setState('p2pfail');
            }
            function setState(s, text) { state = s; errorText = text || ''; refreshStatus(); }

            function renderDiag() {
                const rows = [
                    ['牵线服务器', broker],
                    ['配对码', '…' + peerId.slice(-4) + '（手机页的诊断里应显示同样的 4 位）'],
                    ['已连接的手机', String(conns.size)],
                    ['最近一次直连', lastIce ? cfg.ICE_TEXT[lastIce.ice] || lastIce.ice : '还没有手机来连'],
                    ['电脑这边的地址', lastIce ? cfg.candText(lastIce.local) : '—'],
                    ['手机那边的地址', lastIce ? cfg.candText(lastIce.remote) : '—']
                ];
                diagEl.innerHTML = rows.map(([k, v]) => `<span>${esc(k)}</span><span>${esc(v)}</span>`).join('');
            }

            function drawQr() {
                const url = pairUrl(peerId);
                qrBox.innerHTML = qrSvg(url) + `<div class="phonelink-url">${esc(url.replace(/#.*$/, ''))}</div>`;
            }

            function start() {
                if (closed) return;
                setState('starting');
                peer = new window.Peer(peerId, cfg.PEER_OPTIONS);
                peer.on('open', () => { idRetries = 0; broker = '已连上，配对码已登记'; setState(conns.size ? 'connected' : 'waiting'); });
                peer.on('connection', (conn) => {
                    // 收到手机的连接请求 = 牵线已成功，接下来是打通直连
                    setState('pairing');
                    lastIce = cfg.watchConnection(conn, (info) => {
                        if (info.ice === 'failed') markP2pFail(conn);
                        else renderDiag();
                    });
                    const giveUp = setTimeout(() => { if (state === 'pairing') { lastIce.collect(); markP2pFail(conn); } }, 25000);
                    conn.on('open', () => { clearTimeout(giveUp); conns.add(conn); p2pFails = 0; setState('connected'); conn.send({ type: 'hello' }); });
                    conn.on('data', async (msg) => {
                        if (!msg) return;
                        if (msg.type === 'ping') { conn.send({ type: 'pong', t: msg.t }); return; }   // 手机的心跳：手机靠它发现连接已失效
                        if (msg.type === 'incoming') {   // 手机开始发一张：大照片要传几秒，先让老师知道在收
                            statusEl.textContent = `📥 正在接收照片（${(msg.size / 1048576).toFixed(1)} MB）…`;
                            return;
                        }
                        if (msg.type !== 'photo' || !msg.buf) return;
                        // 手机没收到回执会重发同一张（连接中断、回到前台重连后），按照片编号去重；
                        // 第一份还在处理时第二份就到了，等第一份处理完再回执
                        if (processing.has(msg.id)) await processing.get(msg.id).catch(() => {});
                        if (seenIds.has(msg.id)) { conn.send({ type: 'ack', id: msg.id }); refreshStatus(); return; }
                        const blob = new Blob([msg.buf], { type: msg.mime || 'image/jpeg' });
                        const job = onPhoto(blob);
                        processing.set(msg.id, job);
                        try {
                            await job;
                            seenIds.add(msg.id);
                            received++;
                            const url = URL.createObjectURL(blob);
                            urls.push(url);
                            thumbs.insertAdjacentHTML('beforeend', `<span class="photo-thumb"><img src="${url}" alt="已收到"></span>`);
                            refreshStatus();
                            conn.send({ type: 'ack', id: msg.id });
                        } catch (err) {
                            const text = (err && err.message) || '电脑处理失败';
                            Toast.error(text);
                            refreshStatus();
                            conn.send({ type: 'error', id: msg.id, text });
                        } finally {
                            processing.delete(msg.id);
                        }
                    });
                    const gone = () => {
                        clearTimeout(giveUp);
                        const was = conns.delete(conn);
                        if (closed) return;
                        if (was && !conns.size) setState('waiting');                       // 连上过、后来断开
                        else if (!was && state === 'pairing') markP2pFail(conn);             // 没连上就断了
                    };
                    conn.on('close', gone);
                    conn.on('error', gone);
                });
                peer.on('disconnected', () => {
                    broker = '断开，重连中…';
                    renderDiag();
                    if (!closed && !peer.destroyed) { try { peer.reconnect(); } catch (e) { /* 等下一次 */ } }
                });
                peer.on('error', (err) => {
                    if (closed) return;
                    if (err.type === 'unavailable-id') {
                        // 刷新页面或浏览器意外关闭后，牵线服务上还留着旧的同名连接，实测约 1 分钟才释放：同一个码重试 2 分钟（换码的话手机要重新扫）
                        if (idRetries++ < 30) {
                            retryTimer = setTimeout(restart, 4000);
                            setState('error', '配对码还被上一次的连接占着（刷新页面或浏览器意外关闭后常见，通常 1 分钟内释放），正在重试…');
                        } else {
                            setState('error', '配对码一直被占用（电脑上是否在别的窗口也打开了本面板？），可点「重新生成二维码」');
                        }
                    } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
                        broker = '连不上（' + err.type + '）';
                        setState('error', '连不上牵线服务器（0.peerjs.com），请检查电脑网络；正在重试…');
                        retryTimer = setTimeout(restart, 5000);
                    }
                    // 其余错误属于某一条手机连接（如 negotiation-failed），由上面的连接监听处理
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
