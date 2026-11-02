// phone.js —— 手机端拍照页（phone.html）：连上电脑端的「📱 手机拍」面板，把拍的照片一张张传过去
// 配对码来自二维码（URL 的 # 部分），记在 localStorage，下次直接打开本页就自动连上；掉线会自动重连。
// 拍完的照片先进队列，没连上时先攒着，连上后按顺序发送，电脑回执后标记「已发送」。
//
// 连接分三步，每一步失败的提示不同（底部「连接诊断」里能看到细节）：
//   1. 连牵线服务器（0.peerjs.com）            失败 → 手机网络问题
//   2. 牵线服务器找电脑的配对码                 找不到（peer-unavailable）→ 电脑上没开「📱 手机拍」窗口
//   3. 手机和电脑打通直连（WebRTC / ICE）       打不通 → 两边不在同一个网络等，给出换网络的建议
//
// 「显示已连接、照片却没传过去」的几种真实情况（1.17.2 起处理）：
//   - 点「拍照」后系统相机在前台，网页被挂起，回来时直连已经失效但没有触发 close：心跳（ping/pong）+ 回到页面时、
//     每张照片发送前先确认连接还活着，不活就立刻重连；没收到回执的照片自动重发（电脑端按照片编号去重）
//   - 内存紧张时手机在拍照期间把网页关掉重开，刚拍的照片丢了：用 sessionStorage 记下「刚去拍照」，重开后提示改用「从相册选」
//   - HEIC 等电脑浏览器读不了的格式：发送前在手机上转成 JPEG；电脑仍然读不了时把原因回给手机，不再假装「已发送」

(function () {
    'use strict';

    const cfg = window.PhoneLinkConfig;
    const $ = (id) => document.getElementById(id);
    // 1.18.0 起：常见格式、8 MB 以内的原图直接原样发送（电脑端「画质优先」要原分辨率；相机拍的原图一般 3–8 MB，
    // 以前超过 2.5 MB 就在手机上用画布重压，相机和相册走的是两条不同的路）。更大的或 HEIC 等格式才在手机上转成 JPEG
    const SEND_LIMIT_BYTES = 8 * 1024 * 1024;
    const SEND_MAX_SIDE = 4096;
    const CONNECT_TIMEOUT = 20000;   // 直连打通一般几秒；ICE 自己判定失败有时要 30 秒，这里提前放弃并重试
    const RETRY_DELAY = 4000;
    const HEARTBEAT = 4000;          // 连上后每 4 秒 ping 一次
    const PONG_TIMEOUT = 12000;      // 这么久没收到电脑的任何消息（且没有照片在传）就认为连接已失效
    const MAX_AUTO_TRIES = 3;        // 一张照片自动重发几次后改为「点我重发」
    const SS_CAMERA = 'teachingPanel.phone.cameraAt';
    const ackTimeout = (bytes) => 20000 + Math.ceil(bytes / 102400) * 1000;   // 20 秒 + 每 100 KB 1 秒（很慢的网络也够）

    function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
    function lsSet(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* 忽略 */ } }
    function ssGet(k) { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } }
    function ssSet(k, v) { try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch (e) { /* 忽略 */ } }

    let target = (location.hash || '').replace(/^#/, '').trim();
    if (/^tp-[a-z0-9]+$/.test(target)) {
        lsSet(cfg.LS_TARGET, target);
        history.replaceState(null, '', location.pathname);   // 配对码不留在地址栏里
    } else {
        target = lsGet(cfg.LS_TARGET);
    }

    if (cfg.isWeChat()) $('wechat').hidden = false;

    const statusEl = $('status');
    const tipsEl = $('tips');
    let p2pFails = 0;   // 连续几次「找到电脑但直连没打通」；>0 时建议一直显示（重试期间也不收起），连上后清零
    function setStatus(text, cls, showTips) {
        statusEl.textContent = text;
        statusEl.className = 'status' + (cls ? ' ' + cls : '');
        showTips = showTips || (p2pFails > 0 && cls !== 'ok');
        tipsEl.hidden = !showTips;
        if (showTips && !tipsEl.innerHTML) tipsEl.innerHTML = '<b>可以这样试：</b>' + cfg.TIPS_HTML;
    }
    function showNote(text) { $('note').textContent = text; $('note').hidden = !text; }

    // 事件日志（「连接诊断」里显示，可一键复制）：真机上出问题时，靠它看清卡在哪一步
    const events = [];
    function logEv(text) {
        const d = new Date();
        events.push(`${d.toLocaleTimeString()}.${String(d.getMilliseconds()).padStart(3, '0')} ${text}`);
        if (events.length > 60) events.shift();
        const box = $('evlog');
        if (box) box.textContent = events.slice().reverse().join('\n');
    }
    const mb = (n) => (n / 1048576).toFixed(2) + ' MB';

    if (!target) {
        setStatus('还没有配对电脑', 'bad');
        $('nopair').hidden = false;
        return;
    }
    $('main').hidden = false;

    // 上次点了「拍照」却没等到照片、页面就重新打开了 = 拍照期间网页被手机关掉了
    const cameraAt = Number(ssGet(SS_CAMERA));
    ssSet(SS_CAMERA, '');
    logEv(`打开页面（${navigator.userAgent.replace(/^Mozilla\/5\.0 /, '').slice(0, 120)}）`);
    if (cameraAt && Date.now() - cameraAt < 3 * 60 * 1000) {
        logEv(`检测到：${Math.round((Date.now() - cameraAt) / 1000)} 秒前点了「拍照」，页面被重新打开`);
        showNote('刚才拍的照片没有回到这个页面：手机在拍照时把网页关掉重开了（内存紧张时常见）。可以点「🖼️ 从相册选」把刚拍的那张发过去；拍照前关掉其他应用也有帮助。');
    }

    // ---------- 连接诊断 ----------

    const diag = { broker: '连接中…', pc: '未知', ice: null, pong: null };
    function renderDiag() {
        const net = navigator.connection && navigator.connection.type;
        const rows = [
            ['牵线服务器', diag.broker],
            ['电脑', diag.pc],
            ['直连', diag.ice ? cfg.ICE_TEXT[diag.ice.ice] || diag.ice.ice : '还没开始'],
            ['最近一次电脑回应', diag.pong ? new Date(diag.pong).toLocaleTimeString() : '—'],
            ['手机这边的地址', diag.ice ? cfg.candText(diag.ice.local) : '—'],
            ['电脑那边的地址', diag.ice ? cfg.candText(diag.ice.remote) : '—'],
            ['手机网络', net === 'cellular' ? '流量（移动网络）' : net === 'wifi' ? 'WiFi' : '未知'],
            ['浏览器', cfg.isWeChat() ? '微信内置浏览器' : '系统 / 其他浏览器'],
            ['配对码', '…' + target.slice(-4) + '（应与电脑窗口里显示的一致）']
        ];
        $('diag').innerHTML = rows.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('');
    }
    renderDiag();

    // ---------- 连接 ----------

    let peer = null;
    let conn = null;
    let connected = false;
    let retryTimer = null;
    let heartbeat = null;
    let lastPong = 0;                // 最近一次收到电脑任何消息的时间
    const pendingAcks = new Map();   // 照片 id -> { resolve, reject }

    function scheduleRetry(text, cls, showTips) {
        connected = false;
        clearInterval(heartbeat);
        setStatus(text, cls, showTips);
        clearTimeout(retryTimer);
        retryTimer = setTimeout(connect, RETRY_DELAY);
    }

    // 连接已失效（心跳超时、回到页面时检查不通过、照片回执超时）：作废当前连接，立刻重连；没收到回执的照片回到队列
    function reconnectNow(text) {
        logEv('立即重连：' + (text || '连接已失效'));
        const old = conn;
        conn = null;
        connected = false;
        clearInterval(heartbeat);
        pendingAcks.forEach((p) => p.reject(new Error('连接中断')));
        pendingAcks.clear();
        if (old) { try { old.close(); } catch (e) { /* 忽略 */ } }
        setStatus(text || '连接已失效，正在重连…', 'wait');
        connect();
    }

    function startHeartbeat(c) {
        lastPong = Date.now();
        clearInterval(heartbeat);
        heartbeat = setInterval(() => {
            if (!connected || conn !== c) { clearInterval(heartbeat); return; }
            // 有照片在传时 ping 会排在照片后面，回应自然变慢，这时交给回执超时判断
            if (!pendingAcks.size && Date.now() - lastPong > PONG_TIMEOUT) { reconnectNow('电脑很久没有回应，正在重连…'); return; }
            try { c.send({ type: 'ping', t: Date.now() }); } catch (e) { reconnectNow(); }
        }, HEARTBEAT);
    }

    // 确认连接还活着：最近 5 秒内收到过电脑的消息就算活着，否则 ping 一下等 3 秒。不活就重连并返回 false
    async function ensureAlive() {
        if (!connected || !conn) return false;
        const dc = conn.dataChannel;
        const pc = conn.peerConnection;
        if ((dc && dc.readyState !== 'open') || (pc && ['failed', 'closed', 'disconnected'].includes(pc.iceConnectionState))) {
            reconnectNow('连接已失效（可能是刚才拍照时网页被挂起），正在重连…');
            return false;
        }
        if (Date.now() - lastPong < 5000) return true;
        logEv(`确认连接：${Math.round((Date.now() - lastPong) / 1000)} 秒没收到电脑消息，ping 一下`);
        const sentAt = Date.now();
        try { conn.send({ type: 'ping', t: sentAt }); } catch (e) { reconnectNow(); return false; }
        for (let i = 0; i < 30; i++) {
            await new Promise((r) => setTimeout(r, 100));
            if (lastPong >= sentAt) { logEv(`确认连接：电脑 ${Date.now() - sentAt} ms 后回应`); return true; }
            if (!connected) return false;
        }
        reconnectNow('连接已失效（可能是刚才拍照时网页被挂起），正在重连…');
        return false;
    }

    const MSG_OFFLINE = '电脑不在线：请在电脑上打开「📱 手机拍」窗口，打开后这里会自动连上…';
    const msgP2pFail = () => `⚠ 找到电脑了，但手机和电脑之间连不通（已失败 ${p2pFails} 次，正在重试）。多半是两边不在同一个网络。`;

    function connect() {
        clearTimeout(retryTimer);
        if (connected) return;
        if (!peer || peer.destroyed) {
            setStatus('正在连接牵线服务器…', 'wait');
            peer = new window.Peer(undefined, cfg.PEER_OPTIONS);
            const myPeer = peer;
            peer.on('open', (id) => { logEv('牵线服务器已连上（手机编号 …' + String(id).slice(-4) + '）'); diag.broker = '已连上'; renderDiag(); if (!conn && !connected) connect(); });
            // 牵线服务器只在建立连接时需要；已经连上的直连不依赖它，断开时只在后台重连牵线，不动直连
            peer.on('disconnected', () => {
                logEv('牵线服务器断开' + (connected ? '（直连仍在，照常发送）' : ''));
                diag.broker = '断开，重连中…';
                renderDiag();
                setTimeout(() => { if (peer === myPeer && !myPeer.destroyed && myPeer.disconnected) { try { myPeer.reconnect(); } catch (e) { /* 等下一次 */ } } }, connected ? 3000 : 500);
            });
            peer.on('error', (err) => {
                logEv('错误：' + err.type);
                if (err.type === 'peer-unavailable') {
                    // 先把这次的连接作废，免得它随后关闭时把提示改成「电脑没有响应」
                    const old = conn;
                    conn = null;
                    if (old) { try { old.close(); } catch (e) { /* 忽略 */ } }
                    diag.pc = '不在线（没找到这个配对码）';
                    p2pFails = 0;   // 电脑都不在线了，换网络的建议暂时无关
                    renderDiag();
                    scheduleRetry(MSG_OFFLINE, 'wait');
                } else if (err.type === 'unavailable-id' || err.type === 'invalid-id') {
                    // 从后台回来重连牵线时，服务器还占着手机原来的编号：手机不需要固定编号，换一个新的
                    if (connected) return;
                    try { peer.destroy(); } catch (e) { /* 忽略 */ }
                    peer = null;
                    conn = null;
                    scheduleRetry('正在重新连接…', 'wait');
                } else if (['network', 'server-error', 'socket-error', 'socket-closed', 'browser-incompatible'].includes(err.type)) {
                    diag.broker = '连不上（' + err.type + '）';
                    renderDiag();
                    // 直连还活着就不销毁（销毁会连直连一起关掉）；牵线服务器等需要时再重连
                    if (connected && err.type !== 'browser-incompatible') return;
                    try { peer.destroy(); } catch (e) { /* 忽略 */ }
                    peer = null;
                    conn = null;
                    scheduleRetry(err.type === 'browser-incompatible'
                        ? '⚠ 这个浏览器不支持直连，请换手机自带的浏览器（Safari / Chrome）打开'
                        : '⚠ 连不上牵线服务器，请检查手机网络（正在重试）…', 'bad');
                }
                // 其余错误（如 negotiation-failed）属于直连阶段，由下面的连接监听处理
            });
            return;
        }
        if (!peer.open) {
            // 回到前台时牵线连接可能已断开：主动重连，并保底定时再试（重连成功后的 open 事件也会调用 connect）
            if (peer.disconnected) { try { peer.reconnect(); } catch (e) { /* 忽略 */ } }
            retryTimer = setTimeout(connect, RETRY_DELAY);
            return;
        }
        if (conn) { try { conn.close(); } catch (e) { /* 忽略 */ } }
        setStatus('正在找电脑…', 'wait');
        logEv('开始连接电脑');
        conn = peer.connect(target, { reliable: true });
        const c = conn;
        let failed = false;
        const fail = async () => {
            if (failed || conn !== c || connected) return;
            failed = true;
            clearTimeout(timeout);
            if (ice) await ice.collect();
            try { c.close(); } catch (e) { /* 忽略 */ }
            const reached = ice && ice.ice !== 'new';   // 收到了电脑的应答 = 电脑在线，只是直连没打通
            if (reached) { diag.pc = '在线'; p2pFails++; }
            logEv(reached ? '直连没打通（ICE ' + ice.ice + '）' : '电脑没有响应');
            renderDiag();
            if (reached) scheduleRetry(msgP2pFail(), 'bad', true);
            else scheduleRetry('电脑没有响应：请确认电脑上的「📱 手机拍」窗口开着（正在重试）…', 'wait');
        };
        const ice = cfg.watchConnection(c, (info) => {
            diag.ice = info;
            if (info.ice === 'checking' && !connected) {
                diag.pc = '在线';
                setStatus(p2pFails ? `找到电脑了，正在再次尝试打通直连（前 ${p2pFails} 次没打通）…` : '找到电脑了，正在打通直连…', 'wait');
            }
            if (info.ice === 'failed') fail();
            renderDiag();
        });
        diag.ice = ice;
        const timeout = setTimeout(fail, CONNECT_TIMEOUT);
        c.on('open', () => {
            clearTimeout(timeout);
            if (conn !== c) return;
            connected = true;
            p2pFails = 0;
            logEv('✅ 已连接电脑');
            diag.pc = '在线';
            renderDiag();
            setStatus('✅ 已连接电脑，可以拍照了', 'ok');
            startHeartbeat(c);
            flush();
        });
        c.on('data', (msg) => {
            if (conn !== c || !msg) return;
            lastPong = diag.pong = Date.now();
            if (msg.type === 'pong' || msg.type === 'hello') { renderDiag(); return; }
            if (!pendingAcks.has(msg.id)) return;
            const p = pendingAcks.get(msg.id);
            pendingAcks.delete(msg.id);
            if (msg.type === 'ack') p.resolve();
            else { const e = new Error(msg.text || '电脑处理失败'); e.fromPc = true; p.reject(e); }
        });
        const lost = () => {
            clearTimeout(timeout);
            if (conn !== c) return;
            pendingAcks.forEach((p) => p.reject(new Error('连接中断')));
            pendingAcks.clear();
            logEv('直连断开' + (connected ? '' : '（还没连上）'));
            if (connected) scheduleRetry('连接断开（电脑窗口关了或网络变了），正在重连…', 'wait');
            else fail();
        };
        c.on('close', lost);
        c.on('error', lost);
    }

    // 回到页面（从相机返回、切回浏览器）时马上检查连接；几个事件常常一起触发，1 秒内只查一次
    let lastCheck = 0;
    document.addEventListener('visibilitychange', () => logEv(document.visibilityState === 'visible' ? '回到页面' : '页面进入后台'));
    function onBack() {
        if (document.visibilityState !== 'visible' || Date.now() - lastCheck < 1000) return;
        lastCheck = Date.now();
        if (connected) ensureAlive().then((ok) => { if (ok) flush(); });
        else if (!conn) connect();
        // 从相机回来却没有照片（取消了拍照）：清掉「刚去拍照」的标记
        setTimeout(() => { if (ssGet(SS_CAMERA) && Date.now() - Number(ssGet(SS_CAMERA)) > 2500) ssSet(SS_CAMERA, ''); }, 3000);
    }
    document.addEventListener('visibilitychange', onBack);
    window.addEventListener('pageshow', onBack);
    window.addEventListener('focus', onBack);

    // ---------- 拍照 / 队列 ----------

    const queue = [];   // { id, file, el, state, tries }
    let sending = false;
    let seq = 0;

    // 电脑浏览器读不了 HEIC 等格式，大图传得慢：这两种都先在手机上转成 JPEG（手机浏览器一般能读自己相机的格式）。转不了就发原图
    async function prepare(file) {
        const common = /^image\/(jpeg|png|webp)$/.test(file.type);
        if (common && file.size <= SEND_LIMIT_BYTES) { logEv('原样发送'); return file; }
        try {
            const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
            const scale = Math.min(1, SEND_MAX_SIDE / Math.max(bmp.width, bmp.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(bmp.width * scale);
            canvas.height = Math.round(bmp.height * scale);
            canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
            if (bmp.close) bmp.close();
            const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.95));
            logEv(blob ? `在手机上转成 JPEG：${canvas.width}×${canvas.height}，${mb(blob.size)}` : '转 JPEG 失败，发原图');
            return blob || file;
        } catch (e) { logEv('手机读不了这张（' + e.name + '），发原图'); return file; }
    }

    // 返回新加入队列的项（网页相机用它统计「已拍 / 已传」）
    function addFiles(files, from) {
        const added = [];
        Array.from(files).forEach((file) => {
            logEv(`${from}得到照片：${file.name || '(无名)'}，类型 ${file.type || '(空)'}，${mb(file.size)}`);
            const el = document.createElement('div');
            el.className = 'item';
            el.innerHTML = `<img alt=""><span class="tag">等待发送</span>`;
            el.querySelector('img').src = URL.createObjectURL(file);
            el.addEventListener('click', () => {
                const it = queue.find((q) => q.el === el);
                if (it && it.state === 'fail') { it.state = 'wait'; it.tries = 0; mark(it, '等待发送'); flush(); }
            });
            $('list').prepend(el);
            const it = { id: 'p' + Date.now() + '-' + (seq++), file, el, state: 'wait', tries: 0 };
            queue.push(it);
            added.push(it);
        });
        flush();
        return added;
    }

    function mark(it, text, cls) {
        it.el.querySelector('.tag').textContent = text;
        it.el.className = 'item' + (cls ? ' ' + cls : '');
        updateCamCount();
    }

    async function flush() {
        if (sending || !connected) return;
        sending = true;
        try {
            for (const it of queue) {
                if (it.state !== 'wait') continue;
                if (!(await ensureAlive())) break;   // 发之前确认连接还活着（刚从相机回来时最容易失效）
                it.state = 'sending';
                it.tries++;
                const started = Date.now();
                mark(it, '发送中，等电脑确认…');
                const tick = setInterval(() => mark(it, `等电脑确认… ${Math.round((Date.now() - started) / 1000)}s`), 1000);
                try {
                    const blob = await prepare(it.file);
                    const buf = await blob.arrayBuffer();
                    logEv(`开始发送第 ${it.tries} 次：${mb(buf.byteLength)}`);
                    conn.send({ type: 'incoming', id: it.id, size: buf.byteLength });
                    await new Promise((resolve, reject) => {
                        const timer = setTimeout(() => {
                            pendingAcks.delete(it.id);
                            const e = new Error('超时'); e.timeout = true; reject(e);
                        }, ackTimeout(buf.byteLength));
                        pendingAcks.set(it.id, { resolve: () => { clearTimeout(timer); resolve(); }, reject: (e) => { clearTimeout(timer); reject(e); } });
                        conn.send({ type: 'photo', id: it.id, mime: blob.type || 'image/jpeg', buf });
                    });
                    it.state = 'sent';
                    mark(it, '✓ 电脑已收到', 'sent');
                    logEv(`✓ 电脑已收到（用时 ${((Date.now() - started) / 1000).toFixed(1)} 秒）`);
                } catch (err) {
                    logEv('发送失败：' + (err.message || err.name || err));
                    if (err.fromPc) {
                        // 电脑收到了但处理不了（如读不了的格式）：重发也没用
                        it.state = 'fail';
                        mark(it, '电脑读不了', 'fail');
                        showNote(`${err.message}。可以在手机相机设置里把照片格式改成「兼容性最佳」或「JPG」后再拍。`);
                    } else if (it.tries >= MAX_AUTO_TRIES) {
                        it.state = 'fail';
                        mark(it, '没发成功，点我重发', 'fail');
                    } else {
                        it.state = 'wait';   // 连接问题：重连后自动重发（电脑端按编号去重，不会重复添加）
                        mark(it, '没收到确认，等待重发');
                        if (err.timeout && connected) reconnectNow('照片发送超时，正在重连后重发…');
                    }
                } finally {
                    clearInterval(tick);
                }
                if (!connected) break;
            }
        } finally { sending = false; }
        if (connected && queue.some((q) => q.state === 'wait')) flush();
    }

    // ---------- 网页内相机（1.19.0） ----------
    // 「系统相机」要跳到相机 App 再把照片交回网页，这一步由各家浏览器实现，部分浏览器（如狐猴）拍完不回传、或拍照期间把网页关掉。
    // 网页内相机用 getUserMedia 在本页取景，不离开页面，连接也不会断；支持 ImageCapture 的浏览器（Chromium 系）用 takePhoto()
    // 拍全分辨率照片（带自动对焦），否则截取取景画面（请求 4096×3072，实际看摄像头支持多少）。
    const liveSupported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.isSecureContext);
    if (!liveSupported) {
        $('livecam').hidden = true;
        $('syscam').classList.remove('alt');
        logEv('这个浏览器不支持网页内相机，只能用系统相机');
    }
    let camStream = null;
    let camTrack = null;
    let camCaps = {};
    let imageCapture = null;
    let facing = 'environment';
    let shooting = false;
    let camOpen = false;
    const camItems = [];   // 这次打开相机后拍的照片（统计已传几张）

    function updateCamCount() {
        if (!camOpen) return;
        const sent = camItems.filter((it) => it.state === 'sent').length;
        $('camcount').textContent = camItems.length ? `已拍 ${camItems.length} 张 · 已传 ${sent} 张` : '';
    }

    function camErrText(err) {
        const n = err && err.name;
        if (n === 'NotAllowedError' || n === 'SecurityError') return '没有摄像头权限（请在浏览器设置里允许本站使用摄像头）';
        if (n === 'NotFoundError' || n === 'OverconstrainedError') return '没有找到摄像头';
        if (n === 'NotReadableError') return '摄像头被其他应用占用';
        return '打不开摄像头（' + (n || err) + '）';
    }

    function stopCam() {
        if (camStream) camStream.getTracks().forEach((t) => t.stop());
        camStream = camTrack = imageCapture = null;
        $('camvideo').srcObject = null;
    }

    const applyCam = (c) => (camTrack ? camTrack.applyConstraints({ advanced: [c] }).catch(() => {}) : Promise.resolve());

    async function startCam() {
        stopCam();
        camStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: facing } }, audio: false
        });
        camTrack = camStream.getVideoTracks()[0];
        // 不写死期望值：先打开，再按摄像头自己报告的最大宽、高（getCapabilities）重新要求，要的就是它实际能给的
        const cp = (camTrack.getCapabilities && camTrack.getCapabilities()) || {};
        if (cp.width && cp.width.max && cp.height && cp.height.max) {
            await camTrack.applyConstraints({ width: { ideal: cp.width.max }, height: { ideal: cp.height.max } }).catch(() => {});
        }
        $('camvideo').srcObject = camStream;
        camCaps = (camTrack.getCapabilities && camTrack.getCapabilities()) || {};
        if (Array.isArray(camCaps.focusMode) && camCaps.focusMode.includes('continuous')) applyCam({ focusMode: 'continuous' });
        const zbox = $('camzoombox');
        if (camCaps.zoom && camCaps.zoom.max > camCaps.zoom.min) {
            const z = $('camzoom');
            z.min = camCaps.zoom.min; z.max = camCaps.zoom.max; z.step = camCaps.zoom.step || 0.1;
            z.value = (camTrack.getSettings().zoom) || camCaps.zoom.min;
            $('camzoomval').textContent = Number(z.value).toFixed(1) + '×';
            zbox.hidden = false;
        } else {
            zbox.hidden = true;
        }
        imageCapture = ('ImageCapture' in window) ? new window.ImageCapture(camTrack) : null;
        const st = camTrack.getSettings();
        $('camres').textContent = st.width ? `${st.width}×${st.height}` : '';
        logEv(`网页相机已打开：取景 ${st.width}×${st.height}${imageCapture ? '，可拍全分辨率' : '，截取画面'}${zbox.hidden ? '' : '，可变焦'}`);
    }

    async function openCam() {
        logEv('点了「拍照」（网页内相机）');
        showNote('');
        try {
            await startCam();
        } catch (err) {
            logEv('网页相机打不开：' + (err.name || err));
            showNote(camErrText(err) + '。可以改用「📱 用系统相机拍」或「🖼️ 从相册选」。');
            return;
        }
        camItems.length = 0;
        camOpen = true;
        updateCamCount();
        $('camview').hidden = false;
    }

    function closeCam() {
        camOpen = false;
        stopCam();
        $('camview').hidden = true;
        logEv('关闭网页相机');
    }

    async function grabFrame() {
        const v = $('camvideo');
        if (!v.videoWidth) return null;
        const c = document.createElement('canvas');
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        c.getContext('2d').drawImage(v, 0, 0);
        return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
    }

    async function shoot() {
        if (shooting || !camTrack) return;
        shooting = true;
        $('camshot').classList.add('busy');
        const flash = $('camflash');
        flash.classList.add('on');
        setTimeout(() => flash.classList.remove('on'), 60);
        let blob = null;
        let how = '截取画面';
        try {
            if (imageCapture) {
                // 部分手机的 takePhoto 会卡很久不返回：5 秒没结果就当失败，改为截取画面
                const timeout = (ms) => new Promise((_, reject) => setTimeout(() => { const e = new Error('超时'); e.name = 'Timeout'; reject(e); }, ms));
                const caps = await Promise.race([imageCapture.getPhotoCapabilities(), timeout(2000)]).catch(() => null);
                // 宽高都要给最大值：只给宽度时，有的手机按取景（可能是 21:9）的比例出图，会把上下裁掉
                const opts = {};
                if (caps && caps.imageWidth && caps.imageWidth.max) opts.imageWidth = caps.imageWidth.max;
                if (caps && caps.imageHeight && caps.imageHeight.max) opts.imageHeight = caps.imageHeight.max;
                blob = await Promise.race([imageCapture.takePhoto(opts), timeout(5000)]);
                how = '全分辨率';
            }
        } catch (e) {
            logEv('全分辨率拍照失败（' + (e.name || e) + '），这次改为截取画面');
            imageCapture = null;   // 这次打开相机期间不再尝试（每张都先失败一次会拖慢连拍），下次打开再试
            blob = null;
        }
        if (!blob) blob = await grabFrame();
        $('camshot').classList.remove('busy');
        shooting = false;
        if (!blob) { logEv('没拍到画面（摄像头还没准备好）'); return; }
        logEv(`网页相机拍到一张（${how}，${mb(blob.size)}）`);
        createImageBitmap(blob).then((b) => { logEv(`这张的尺寸 ${b.width}×${b.height}`); b.close(); }).catch(() => {});
        const file = new File([blob], `cam_${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' });
        camItems.push(...addFiles([file], '网页相机'));
        updateCamCount();
    }

    $('livecam').addEventListener('click', openCam);
    $('camdone').addEventListener('click', closeCam);
    $('camshot').addEventListener('click', shoot);
    $('camflip').addEventListener('click', async () => {
        facing = facing === 'environment' ? 'user' : 'environment';
        try { await startCam(); } catch (err) { logEv('切换摄像头失败：' + (err.name || err)); showNote(camErrText(err)); }
    });
    $('camzoom').addEventListener('input', (e) => {
        $('camzoomval').textContent = Number(e.target.value).toFixed(1) + '×';
        applyCam({ zoom: Number(e.target.value) });
    });
    // 点画面重新对焦（支持单次对焦的摄像头）
    $('camvideo').addEventListener('click', async () => {
        if (!Array.isArray(camCaps.focusMode) || !camCaps.focusMode.includes('single-shot')) return;
        await applyCam({ focusMode: 'single-shot' });
        setTimeout(() => { if (camCaps.focusMode.includes('continuous')) applyCam({ focusMode: 'continuous' }); }, 1500);
    });
    // 切到别的应用时关掉摄像头（省电，也避免摄像头被占用），回来再打开
    document.addEventListener('visibilitychange', () => {
        if (!camOpen) return;
        if (document.visibilityState === 'hidden') stopCam();
        else startCam().catch((err) => { logEv('回到页面后重开摄像头失败：' + (err.name || err)); closeCam(); showNote(camErrText(err)); });
    });

    // ---------- 系统相机 / 相册 ----------

    $('cam').addEventListener('click', () => { ssSet(SS_CAMERA, String(Date.now())); logEv('点了「用系统相机拍」，打开相机 App'); });
    $('album').addEventListener('click', () => logEv('点了「从相册选」'));
    ['cam', 'album'].forEach((id) => $(id).addEventListener('change', (e) => {
        ssSet(SS_CAMERA, '');
        showNote('');
        if (!e.target.files.length) logEv((id === 'cam' ? '系统相机' : '相册') + '返回了，但没有照片');
        addFiles(e.target.files, id === 'cam' ? '系统相机' : '相册');
        e.target.value = '';
    }));
    $('forget').addEventListener('click', () => {
        if (!confirm('忘记这台电脑后，需要重新扫码才能连上。确定吗？')) return;
        lsSet(cfg.LS_TARGET, '');
        location.reload();
    });

    $('copylog').addEventListener('click', async () => {
        const text = '学情看板 手机拍照日志\n' + events.join('\n') + '\n\n' + $('diag').innerText;
        try { await navigator.clipboard.writeText(text); $('copylog').textContent = '已复制 ✓'; }
        catch (e) { prompt('长按全选后复制：', text); }
        setTimeout(() => { $('copylog').textContent = '复制日志'; }, 2000);
    });

    connect();
})();
