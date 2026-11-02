// phone.js —— 手机端拍照页（phone.html）：连上电脑端的「📱 手机拍」面板，把拍的照片一张张传过去
// 配对码来自二维码（URL 的 # 部分），记在 localStorage，下次直接打开本页就自动连上；掉线会自动重连。
// 拍完的照片先进队列，没连上时先攒着，连上后按顺序发送，电脑回执后标记「已发送」。

(function () {
    'use strict';

    const cfg = window.PhoneLinkConfig;
    const $ = (id) => document.getElementById(id);
    const SEND_LIMIT_BYTES = 2.5 * 1024 * 1024;   // 超过这个大小的原图先缩一下再传（传输更快），电脑端还会按画质挡位再压一次
    const SEND_MAX_SIDE = 3600;
    const ACK_TIMEOUT = 90000;

    function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
    function lsSet(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* 忽略 */ } }

    let target = (location.hash || '').replace(/^#/, '').trim();
    if (/^tp-[a-z0-9]+$/.test(target)) {
        lsSet(cfg.LS_TARGET, target);
        history.replaceState(null, '', location.pathname);   // 配对码不留在地址栏里
    } else {
        target = lsGet(cfg.LS_TARGET);
    }

    const statusEl = $('status');
    function setStatus(text, cls) { statusEl.textContent = text; statusEl.className = 'status' + (cls ? ' ' + cls : ''); }

    if (!target) {
        setStatus('还没有配对电脑', 'bad');
        $('nopair').hidden = false;
        return;
    }
    $('main').hidden = false;

    // ---------- 连接 ----------

    let peer = null;
    let conn = null;
    let connected = false;
    let retryTimer = null;
    const pendingAcks = new Map();   // 照片 id -> { resolve, reject }

    function scheduleRetry(text) {
        connected = false;
        setStatus(text || '正在连接电脑…', '');
        clearTimeout(retryTimer);
        retryTimer = setTimeout(connect, 3000);
    }

    function connect() {
        clearTimeout(retryTimer);
        if (!peer || peer.destroyed) {
            peer = new window.Peer(undefined, cfg.PEER_OPTIONS);
            peer.on('open', connect);
            peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* 等下一次重试 */ } });
            peer.on('error', (err) => {
                if (err.type === 'peer-unavailable') scheduleRetry('电脑上还没打开「📱 手机拍」窗口（打开后会自动连上）…');
                else if (err.type === 'unavailable-id' || err.type === 'invalid-id') scheduleRetry('正在重新连接…');
                else { try { peer.destroy(); } catch (e) { /* 忽略 */ } peer = null; scheduleRetry('网络不通，正在重试…'); }
            });
            return;
        }
        if (!peer.open) return;
        if (conn) { try { conn.close(); } catch (e) { /* 忽略 */ } }
        conn = peer.connect(target, { reliable: true });
        const c = conn;
        const timeout = setTimeout(() => { if (conn === c && !connected) { try { c.close(); } catch (e) { /* 忽略 */ } scheduleRetry('电脑上还没打开「📱 手机拍」窗口（打开后会自动连上）…'); } }, 10000);
        c.on('open', () => { clearTimeout(timeout); connected = true; setStatus('✅ 已连接电脑，可以拍照了', 'ok'); flush(); });
        c.on('data', (msg) => {
            if (!msg || !pendingAcks.has(msg.id)) return;
            const p = pendingAcks.get(msg.id);
            pendingAcks.delete(msg.id);
            if (msg.type === 'ack') p.resolve(); else p.reject(new Error(msg.text || '电脑处理失败'));
        });
        const lost = () => { clearTimeout(timeout); if (conn === c) { pendingAcks.forEach((p) => p.reject(new Error('连接中断'))); pendingAcks.clear(); scheduleRetry('连接断开，正在重连…'); } };
        c.on('close', lost);
        c.on('error', lost);
    }

    // ---------- 拍照 / 队列 ----------

    const queue = [];   // { id, file, el, state }
    let sending = false;
    let seq = 0;

    async function shrink(file) {
        if (file.size <= SEND_LIMIT_BYTES) return file;
        try {
            const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
            const scale = Math.min(1, SEND_MAX_SIDE / Math.max(bmp.width, bmp.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(bmp.width * scale);
            canvas.height = Math.round(bmp.height * scale);
            canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
            if (bmp.close) bmp.close();
            const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
            return blob || file;
        } catch (e) { return file; }
    }

    function addFiles(files) {
        Array.from(files).forEach((file) => {
            const el = document.createElement('div');
            el.className = 'item';
            el.innerHTML = `<img alt=""><span class="tag">等待发送</span>`;
            el.querySelector('img').src = URL.createObjectURL(file);
            el.addEventListener('click', () => { const it = queue.find((q) => q.el === el); if (it && it.state === 'fail') { it.state = 'wait'; mark(it, '等待发送'); flush(); } });
            $('list').prepend(el);
            queue.push({ id: 'p' + Date.now() + '-' + (seq++), file, el, state: 'wait' });
        });
        flush();
    }

    function mark(it, text, cls) {
        it.el.querySelector('.tag').textContent = text;
        it.el.className = 'item' + (cls ? ' ' + cls : '');
    }

    async function flush() {
        if (sending || !connected) return;
        sending = true;
        try {
            for (const it of queue) {
                if (it.state !== 'wait') continue;
                if (!connected) break;
                it.state = 'sending';
                mark(it, '发送中…');
                try {
                    const blob = await shrink(it.file);
                    const buf = await blob.arrayBuffer();
                    await new Promise((resolve, reject) => {
                        const timer = setTimeout(() => { pendingAcks.delete(it.id); reject(new Error('超时')); }, ACK_TIMEOUT);
                        pendingAcks.set(it.id, { resolve: () => { clearTimeout(timer); resolve(); }, reject: (e) => { clearTimeout(timer); reject(e); } });
                        conn.send({ type: 'photo', id: it.id, mime: blob.type || 'image/jpeg', buf });
                    });
                    it.state = 'sent';
                    mark(it, '✓ 已发送', 'sent');
                } catch (err) {
                    it.state = connected ? 'fail' : 'wait';
                    mark(it, connected ? '失败，点我重发' : '等待发送', connected ? 'fail' : '');
                }
            }
        } finally { sending = false; }
    }

    ['cam', 'album'].forEach((id) => $(id).addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; }));
    $('forget').addEventListener('click', () => {
        if (!confirm('忘记这台电脑后，需要重新扫码才能连上。确定吗？')) return;
        lsSet(cfg.LS_TARGET, '');
        location.reload();
    });

    connect();
})();
