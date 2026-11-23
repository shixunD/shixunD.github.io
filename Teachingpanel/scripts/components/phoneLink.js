// phoneLink.js —— 电脑端：「📱 手机拍」——弹出二维码，手机扫码后用手机自己的相机拍，照片直连传回电脑
// 全局命名空间：window.PhoneLink
//
//   PhoneLink.open(onPhoto)   打开接收面板；手机每传来一张就调用 onPhoto(blob, inboxId)（返回 Promise，resolve 后给手机回执）。面板关闭时 resolve
//   PhoneLink.settle(inboxId) 这张已经存进记录（或被放弃）：删掉电脑上暂存的那份（见下面「电脑端暂存」）
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

    // 关窗后保持连接的分钟数（主页设置里改，0 = 关窗即断开）。存 localStorage，不进业务数据
    const LS_KEEP = 'teachingPanel.phoneKeepMinutes';
    const DEFAULT_KEEP = 2;
    const clampKeep = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.min(60, Math.max(0, Math.round(n * 10) / 10)) : DEFAULT_KEEP; };
    function getKeepMinutes() { return clampKeep(Utils.lsGet(LS_KEEP, DEFAULT_KEEP)); }
    function setKeepMinutes(v) { Utils.lsSet(LS_KEEP, clampKeep(v)); }

    // 收过的照片编号（1.40.0）：手机把照片暂存在本地，刷新后会重发还没收到回执的照片；回执丢了的那几张电脑其实已经收下了，
    // 按编号去重。以前只记在面板的内存里，关掉面板再打开就会重复添加，现在记 7 天（最多 500 个），换块、关窗重开都认得
    const LS_SEEN = 'teachingPanel.phone.seenIds';
    const SEEN_DAYS = 7;
    function loadSeen() {
        try {
            const cut = Date.now() - SEEN_DAYS * 86400000;
            const arr = JSON.parse(Utils.lsGet(LS_SEEN, '[]'));
            return new Map((Array.isArray(arr) ? arr : []).filter((a) => Array.isArray(a) && typeof a[0] === 'string' && a[1] > cut));
        } catch (e) { return new Map(); }
    }
    function rememberSeen(id) {
        const m = loadSeen();
        m.set(id, Date.now());
        Utils.lsSet(LS_SEEN, JSON.stringify(Array.from(m).slice(-500)));
    }

    // 手机每 2 秒发一次心跳。这么久没收到某台手机的任何消息，就不再显示「已连接」，改为「手机暂时没有回应」
    // （手机在用系统相机、锁屏或刷新了页面）；再久就断开这条连接，手机回来后会自己重连
    const QUIET_MS = 6000;
    const DROP_MS = 60000;
    const PAIR_GIVE_UP = 15000;   // 手机找到电脑后这么久还没打通直连，算这次失败（手机那边 12 秒放弃）

    // ---------- 电脑端暂存（1.40.0） ----------
    // 手机传来的照片要等老师在预览框选好档位、登记弹窗保存后才进照片库；这之间电脑页面一刷新，照片就丢了（手机那边收到回执已经删了）。
    // 所以收到后、回执之前先存进 IndexedDB teaching-panel-phone-inbox（编号 = 手机上的照片编号），
    // Photos 在保存 / 放弃 / 关掉弹窗时调 settle() 删掉。刷新后还留着的，打开「📱 手机拍」时可以「加到这里」或「不要了」
    const INBOX_DB = 'teaching-panel-phone-inbox';
    const inbox = (() => {
        let dbp = null;
        function open() {
            if (!dbp) {
                dbp = new Promise((resolve, reject) => {
                    if (!window.indexedDB) { reject(new Error('no indexedDB')); return; }
                    const req = indexedDB.open(INBOX_DB, 1);
                    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('photos')) req.result.createObjectStore('photos', { keyPath: 'id' }); };
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                    req.onblocked = () => reject(new Error('blocked'));
                });
            }
            return dbp;
        }
        function run(mode, fn) {
            return open().then((db) => new Promise((resolve, reject) => {
                const tx = db.transaction('photos', mode);
                const req = fn(tx.objectStore('photos'));
                tx.oncomplete = () => resolve(req && req.result);
                tx.onerror = tx.onabort = () => reject(tx.error);
            }));
        }
        return {
            put: (rec) => run('readwrite', (st) => st.put(rec)),
            del: (id) => run('readwrite', (st) => st.delete(id)),
            all: () => run('readonly', (st) => st.getAll())
        };
    })();
    const handled = new Set();   // 本次页面已经交给某个登记块的暂存编号（不算「上次留下的」）
    // 打开页面时库里已有的 = 上次页面关掉 / 刷新前没处理完的
    const leftAtLoad = inbox.all().then((recs) => (recs || []).filter((r) => r && r.id && r.buf)).catch(() => []);
    function settle(id) {
        if (!id) return;
        handled.delete(id);
        inbox.del(id).catch(() => {});
    }
    async function leftovers() {
        const ids = new Set((await leftAtLoad).map((r) => r.id));
        const now = await inbox.all().catch(() => []);
        return (now || []).filter((r) => r && ids.has(r.id) && !handled.has(r.id)).sort((a, b) => a.at - b.at);
    }
    // 打开页面时提醒一次（找回要在登记弹窗里点「📱 手机拍」，照片才知道放到哪一块）
    setTimeout(async () => {
        const left = await leftovers();
        if (left.length && window.Toast) Toast.info(`上次手机拍传来的 ${left.length} 张照片还没保存（电脑页面刷新或关掉了），在登记弹窗里点「📱 手机拍」可以找回`, 10000);
    }, 2500);

    let lingering = null;
    let showOrphansRef = () => {};   // 面板复用（attach）时刷新「上次留下的照片」提示条   // 面板已关、但连接还留着（等下一块再点「手机拍」时直接复用）：{ attach, destroy }

    async function open(onPhoto) {
        if (active) return;
        if (lingering) return lingering.attach(onPhoto);
        try {
            await Promise.all([loadScript('./scripts/vendor/peerjs.min.js'), loadScript('./scripts/vendor/qrcode.js')]);
        } catch (err) {
            Toast.error('无法加载手机连接组件，请检查网络后重试');
            return;
        }
        active = true;

        return new Promise((resolve) => {
            let onPhotoCur = onPhoto;      // 当前由哪个块接收照片；面板收起（连接保留）期间为 null
            let resolveCur = resolve;
            let keepTimer = null;
            const isLocal = /^(localhost|127\.|\[::1\])/.test(location.hostname);
            const overlay = document.createElement('div');
            overlay.className = 'phonelink-overlay';
            overlay.innerHTML = `
                <div class="phonelink-box" role="dialog" aria-modal="true">
                    <h2>📱 用手机拍</h2>
                    <div class="phonelink-qr" data-pl-qr></div>
                    <p class="hint">用手机自带的相机或浏览器扫上面的二维码（<b>不要用微信扫</b>），打开拍照页后点「📷 拍照」，用手机自带的相机拍，拍完自动传到电脑，可以连续拍。<b>手机和电脑连同一个 WiFi 最稳</b>，不行就让电脑连手机热点。手机第一次扫过后会记住电脑，以后只要电脑上打开这个窗口，手机打开同一个页面就会自动连上。手机连上后关掉本窗口，连接还会保持 ${getKeepMinutes()} 分钟（主页「⚙️ 设置」里改），期间换一块再点「手机拍」不用重新连接。</p>
                    ${isLocal ? '<p class="phonelink-warn">当前是本地调试地址，手机打不开。请在线上网址使用。</p>' : ''}
                    <div class="phonelink-status" data-pl-status>正在连接…</div>
                    <div class="phonelink-orphans" data-pl-orphans hidden><span data-pl-orphans-text></span><button type="button" class="btn-primary btn-sm" data-pl-orphans-add>加到这里</button><button type="button" class="btn-secondary btn-sm" data-pl-orphans-drop>不要了</button></div>
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
            // 面板里的缩略图（1.44.0）：照片交给的那一块返回了操作句柄（{ alive, blob, edit, remove }）时，
            // 面板里就能删除、点开编辑框（和登记弹窗里那张是同一张）；没有句柄的（笔记里插图）点开是大图
            const shown = [];   // { el, handle, blob, url }
            let received = 0;
            let state = 'starting';   // starting | waiting | pairing | connected | quiet | p2pfail | error
            const lastSeen = new WeakMap();   // 连接 -> 最近一次收到它消息的时间
            const deviceOf = new WeakMap();   // 连接 -> 手机标识（1.45.3：同一台手机重新连上时，旧连接马上作废）
            const expectUntil = new WeakMap();   // 连接 -> 正在传的照片最晚什么时候该到（传大照片时心跳排在后面，不能当成没回应）
            let quietTimer = null;
            let errorText = '';
            let retryTimer = null;
            let idRetries = 0;
            let closed = false;
            let lastIce = null;       // 最近一次手机连接的诊断信息（PhoneLinkConfig.watchConnection）
            let broker = '连接中…';
            let p2pFails = 0;         // 连续几次直连没打通；>0 时手机重试期间建议也一直显示，连上后清零
            const failedConns = new WeakSet();
            const seenIds = loadSeen();  // 已收下的照片编号（手机重发时去重），见 LS_SEEN
            const processing = new Map();   // 正在处理的照片编号 -> Promise

            function refreshStatus() {
                const got = received ? `（已收到 ${received} 张）` : '';
                const text = {
                    starting: '正在连接牵线服务器…',
                    waiting: `⏳ 等待手机连接…${got}`,
                    pairing: p2pFails ? `📱 手机正在再次尝试连接（前 ${p2pFails} 次直连没打通）…${got}` : `📱 手机找到了这台电脑，正在打通直连…${got}`,
                    connected: `✅ 手机已连接${received ? ` · 已收到 ${received} 张` : ''}`,
                    quiet: `📱 手机 ${quietSecs()} 秒没有回应（可能在用系统相机、锁屏或刷新了页面），回来后会自动重连${got}`,
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

            // 最近一次收到任何一台手机消息到现在的秒数
            function quietSecs() {
                let last = 0;
                conns.forEach((c) => { last = Math.max(last, lastSeen.get(c) || 0); });
                return last ? Math.round((Date.now() - last) / 1000) : 0;
            }
            // 每 3 秒看一次各台手机是否还有心跳：都没有就显示「暂时没有回应」，太久的直接断开（以前手机刷新或关掉页面后，
            // 直连要等浏览器自己发现失效，电脑这边会一直显示「手机已连接」）
            function checkQuiet() {
                if (closed) return;
                const now = Date.now();
                let fresh = 0;
                Array.from(conns).forEach((c) => {
                    const idle = now - (lastSeen.get(c) || now);
                    if (now < (expectUntil.get(c) || 0)) { fresh++; return; }
                    if (idle > DROP_MS) { conns.delete(c); try { c.close(); } catch (e) { /* 忽略 */ } return; }
                    if (idle <= QUIET_MS) fresh++;
                });
                if (state === 'connected' || state === 'quiet') {
                    if (!conns.size) setState('waiting');
                    else setState(fresh ? 'connected' : 'quiet');
                }
            }

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
                    const giveUp = setTimeout(() => { if (state === 'pairing') { lastIce.collect(); markP2pFail(conn); } }, PAIR_GIVE_UP);
                    conn.on('open', () => {
                        clearTimeout(giveUp);
                        conns.add(conn);
                        lastSeen.set(conn, Date.now());
                        p2pFails = 0;
                        setState('connected');
                        conn.send({ type: 'hello', ready: !!onPhotoCur });   // ready：窗口开着、能收照片
                    });
                    conn.on('data', async (msg) => {
                        if (!msg) return;
                        lastSeen.set(conn, Date.now());
                        if (state === 'quiet' && conns.has(conn)) setState('connected');
                        if (msg.type === 'ping') { conn.send({ type: 'pong', t: msg.t }); return; }   // 手机的心跳：手机靠它发现连接已失效
                        // 手机报上自己的标识：同一台手机误关网页后重新打开、旧连接还没超时断开时，用新连接顶替旧的，
                        // 不用等 1 分钟心跳超时，电脑这边也不会把一台手机算成两台
                        if (msg.type === 'device') {
                            if (typeof msg.id !== 'string' || !/^d-[a-z0-9]{6,40}$/.test(msg.id)) return;
                            deviceOf.set(conn, msg.id);
                            Array.from(conns).forEach((c) => {
                                if (c === conn || deviceOf.get(c) !== msg.id) return;
                                conns.delete(c);
                                try { c.close(); } catch (e) { /* 忽略 */ }
                            });
                            if (conns.has(conn)) setState('connected');
                            return;
                        }
                        if (msg.type === 'bye') {   // 手机离开拍照页（刷新、关掉）：马上断开，不再显示「已连接」
                            try { conn.close(); } catch (e) { /* 忽略 */ }
                            gone();
                            return;
                        }
                        if (msg.type === 'incoming') {   // 手机开始发一张：大照片要传几秒，先让老师知道在收
                            expectUntil.set(conn, Date.now() + 20000 + Math.ceil((msg.size || 0) / 102400) * 1000);   // 和手机端等回执的时间一致
                            statusEl.textContent = `📥 正在接收照片（${(msg.size / 1048576).toFixed(1)} MB）…`;
                            return;
                        }
                        if (msg.type !== 'photo' || !msg.buf) return;
                        expectUntil.delete(conn);
                        // 手机没收到回执会重发同一张（连接中断、回到前台重连后），按照片编号去重；
                        // 第一份还在处理时第二份就到了，等第一份处理完再回执
                        if (processing.has(msg.id)) await processing.get(msg.id).catch(() => {});
                        if (seenIds.has(msg.id)) { conn.send({ type: 'ack', id: msg.id }); refreshStatus(); return; }
                        if (!onPhotoCur) { conn.send({ type: 'error', id: msg.id, code: 'closed', text: '电脑上的「手机拍」窗口关着，在电脑上点「📱 手机拍」打开后会自动发过去' }); return; }
                        const blob = new Blob([msg.buf], { type: msg.mime || 'image/jpeg' });
                        // 先存进电脑再回执：存不进去（空间不足等）也照常接收，只是刷新会丢
                        const cb = onPhotoCur;
                        const job = inbox.put({ id: msg.id, buf: msg.buf, type: blob.type, at: Date.now() }).catch(() => {})
                            .then(() => { handled.add(msg.id); return cb(blob, msg.id); })
                            .catch((err) => { settle(msg.id); throw err; });
                        processing.set(msg.id, job);
                        try {
                            const handle = await job;   // 那一块返回的操作句柄（可能没有）
                            seenIds.set(msg.id, Date.now());
                            rememberSeen(msg.id);
                            received++;
                            addThumb(blob, handle);
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
                        if (idRetries++ < 120) {
                            retryTimer = setTimeout(restart, 1000);
                            setState('error', '配对码还被上一次的连接占着（刷新页面或浏览器意外关闭后常见，通常 1 分钟内释放），正在重试…');
                        } else {
                            setState('error', '配对码一直被占用（电脑上是否在别的窗口也打开了本面板？），可点「重新生成二维码」');
                        }
                    } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
                        broker = '连不上（' + err.type + '）';
                        setState('error', '连不上牵线服务器（0.peerjs.com），请检查电脑网络；正在重试…');
                        retryTimer = setTimeout(restart, 1000);
                    }
                    // 其余错误属于某一条手机连接（如 negotiation-failed），由上面的连接监听处理
                });
            }
            quietTimer = setInterval(() => { checkQuiet(); syncThumbs(); }, 1000);

            // 上次留下的照片：显示提示条，「加到这里」逐张交给当前块（和刚收到的一样走预览框），「不要了」删掉
            const orphansEl = overlay.querySelector('[data-pl-orphans]');
            async function showOrphans() {
                const left = await leftovers();
                orphansEl.hidden = !left.length;
                if (left.length) overlay.querySelector('[data-pl-orphans-text]').textContent = `上次电脑页面刷新前，手机传来的 ${left.length} 张照片还没保存`;
                return left;
            }
            overlay.querySelector('[data-pl-orphans-add]').addEventListener('click', async () => {
                const left = await showOrphans();
                orphansEl.hidden = true;
                let ok = 0;
                for (const r of left) {
                    if (!onPhotoCur) break;
                    handled.add(r.id);
                    try {
                        const blob = new Blob([r.buf], { type: r.type || 'image/jpeg' });
                        addThumb(blob, await onPhotoCur(blob, r.id));
                        ok++;
                        received++;
                    } catch (err) { settle(r.id); }
                }
                refreshStatus();
                if (ok) Toast.success(`已找回 ${ok} 张`);
            });
            overlay.querySelector('[data-pl-orphans-drop]').addEventListener('click', async () => {
                const left = await leftovers();
                const ok = await Modal.confirm({ title: '删除没保存的照片', text: `这 ${left.length} 张照片删掉后找不回来。确定吗？`, confirmText: '删除', danger: true });
                if (!ok) return;
                left.forEach((r) => settle(r.id));
                orphansEl.hidden = true;
            });
            showOrphans();

            function addThumb(blob, handle) {
                const h = handle && typeof handle.edit === 'function' ? handle : null;
                const url = URL.createObjectURL(blob);
                urls.push(url);
                const el = document.createElement('span');
                el.className = 'photo-thumb';
                el.innerHTML = `<img src="${url}" alt="已收到"${h ? ' title="点开可重新压缩 / 裁剪 / 旋转"' : ''}>` + (h && h.remove ? '<button type="button" class="photo-rm" title="删除">✕</button>' : '');
                thumbs.appendChild(el);
                shown.push({ el, handle: h, blob, url });
                syncThumbs();
            }
            // 和那一块里的照片对齐：在别处删掉（或撤销删除）的跟着隐藏 / 显示，重新压缩过的换成新图
            function syncThumbs() {
                shown.forEach((t) => {
                    if (!t.handle) return;
                    const alive = t.handle.alive();
                    t.el.hidden = !alive;
                    const b = alive && t.handle.blob();
                    if (b && b !== t.blob) {
                        t.blob = b;
                        t.url = URL.createObjectURL(b);
                        urls.push(t.url);
                        t.el.querySelector('img').src = t.url;
                    }
                });
            }
            thumbs.addEventListener('click', async (e) => {
                const t = shown.find((x) => x.el.contains(e.target));
                if (!t || !t.handle) return;   // 没有句柄：交给照片组件的通用点击（打开大图）
                e.stopPropagation();
                try {
                    if (!t.handle.alive()) return;
                    if (e.target.closest('.photo-rm')) { if (t.handle.remove) await t.handle.remove(); }
                    else if (e.target.closest('img')) await t.handle.edit();
                } catch (err) {
                    Toast.error(err.message);
                } finally {
                    syncThumbs();
                }
            });

            function restart() {
                if (closed) return;
                if (peer) { try { peer.destroy(); } catch (e) { /* 忽略 */ } }
                conns.clear();
                start();
            }

            // 彻底断开：销毁 peer、释放缩略图
            function destroy() {
                if (closed) return;
                closed = true;
                clearTimeout(retryTimer);
                clearTimeout(keepTimer);
                clearInterval(quietTimer);
                if (peer) { try { peer.destroy(); } catch (e) { /* 忽略 */ } }
                urls.forEach((u) => URL.revokeObjectURL(u));
                overlay.remove();
                document.removeEventListener('keydown', onKey, true);
                active = false;
                if (lingering === api) lingering = null;
            }
            // 关闭面板：手机已连着且设置了保持时间 → 只收起面板，连接保留，到时间再断；否则直接断开
            function finish() {
                if (closed || !onPhotoCur) return;
                const got = received;
                const res = resolveCur;
                onPhotoCur = null;
                resolveCur = null;
                const keepMs = getKeepMinutes() * 60000;
                if (keepMs > 0 && conns.size && peer && !peer.destroyed) {
                    overlay.remove();
                    document.removeEventListener('keydown', onKey, true);
                    active = false;
                    lingering = api;
                    keepTimer = setTimeout(destroy, keepMs);
                } else {
                    destroy();
                }
                res(got);
            }
            // 下一块再点「手机拍」：复用还连着的手机，面板重新显示，照片改交给新的块
            function attach(newOnPhoto) {
                clearTimeout(keepTimer);
                lingering = null;
                onPhotoCur = newOnPhoto;
                received = 0;
                urls.forEach((u) => URL.revokeObjectURL(u));
                urls.length = 0;
                shown.length = 0;
                thumbs.innerHTML = '';
                active = true;
                document.addEventListener('keydown', onKey, true);
                document.body.appendChild(overlay);
                refreshStatus();
                showOrphansRef();
                // 告诉还连着的手机：窗口又开了，之前因为「窗口关着」没收的照片可以重发了
                conns.forEach((c) => { try { c.send({ type: 'hello', ready: true }); } catch (e) { /* 忽略 */ } });
                return new Promise((res) => { resolveCur = res; });
            }
            const api = { attach, destroy };
            showOrphansRef = showOrphans;
            // 面板上面还开着编辑框 / 确认框 / 大图时，Esc 只关上面那个（它们自己处理），不关面板
            const onKey = (e) => {
                if (e.key !== 'Escape' || document.querySelector('.photo-choose-overlay, .modal-overlay, .photo-lightbox')) return;
                e.stopPropagation();
                finish();
            };

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

    window.PhoneLink = { open, settle, getKeepMinutes, setKeepMinutes };
})();
