// phoneConfig.js —— 「手机拍照回传电脑」电脑端（components/phoneLink.js）和手机端（phone.html / phone.js）共用的配置与连接诊断
// 全局命名空间：window.PhoneLinkConfig

(function () {
    'use strict';

    // 跟踪一条 PeerJS 连接的打通过程：直连状态（ICE）+ 两边各找到了哪几类地址。onChange(info) 在有变化时调用。
    //   info.ice    'new' | 'checking' | 'connected' | 'completed' | 'disconnected' | 'failed' | 'closed'
    //   info.local / info.remote   Set：'host'（局域网）、'srflx' / 'prflx'（公网，靠 STUN 查到）、'relay'（中转）
    // 本机地址从 icecandidate 事件收集；对方地址只能事后从 getStats() 里读，所以在关键时刻调用 collect()
    function watchConnection(conn, onChange) {
        const info = { ice: 'new', local: new Set(), remote: new Set(), collect };
        let pc = null;
        let tries = 0;
        (function attach() {
            pc = conn.peerConnection;
            if (!pc) { if (tries++ < 60) setTimeout(attach, 50); return; }
            pc.addEventListener('icecandidate', (e) => {
                if (e.candidate && e.candidate.type) { info.local.add(e.candidate.type); onChange(info); }
            });
        })();
        async function collect() {
            if (!pc || pc.connectionState === 'closed') return;
            try {
                (await pc.getStats()).forEach((r) => {
                    if (r.type === 'local-candidate' && r.candidateType) info.local.add(r.candidateType);
                    if (r.type === 'remote-candidate' && r.candidateType) info.remote.add(r.candidateType);
                });
                onChange(info);
            } catch (e) { /* 连接已关闭：保留已收集到的 */ }
        }
        conn.on('iceStateChanged', (s) => {
            info.ice = s;
            if (s === 'checking') setTimeout(collect, 3000);
            if (s === 'connected' || s === 'completed' || s === 'failed' || s === 'disconnected') collect();
            onChange(info);
        });
        return info;
    }

    const ICE_TEXT = {
        new: '还没开始', checking: '正在尝试…', connected: '已打通', completed: '已打通',
        disconnected: '暂时断开', failed: '没打通', closed: '已关闭'
    };
    function candText(set) {
        if (!set || !set.size) return '没有';
        const names = [];
        if (set.has('host')) names.push('局域网');
        if (set.has('srflx') || set.has('prflx')) names.push('公网');
        if (set.has('relay')) names.push('中转');
        return names.join(' + ') || Array.from(set).join(' + ');
    }
    function isWeChat() { return /MicroMessenger/i.test(navigator.userAgent); }

    // 「找到了对方但直连没打通」时给出的建议（两端共用）
    const TIPS_HTML = `
        <ul>
            <li><b>最有效：让电脑连手机热点</b>（手机开热点，电脑连上），两边就在同一个网络里了。</li>
            <li>或者让手机和电脑连<b>同一个 WiFi</b>，不要一边用流量、一边用 WiFi。</li>
            <li>学校、单位的 WiFi 和「访客网络」常常不允许设备之间互连，换一个网络试试。</li>
            <li>不要在微信里打开，用手机自带的浏览器（Safari / Chrome 等）打开拍照页。</li>
        </ul>`;

    window.PhoneLinkConfig = {
        // 电脑端的固定配对码（手机扫一次后会记住，之后不用再扫）/ 手机端记住的电脑配对码；localStorage 键都带应用前缀
        LS_PEER_ID: 'teachingPanel.phone.peerId',
        LS_TARGET: 'teachingPanel.phone.target',
        // PeerJS 公共牵线服务（0.peerjs.com）只负责交换连接信息，照片走手机→电脑的直连（WebRTC，加密）。
        // 自己给 iceServers 会覆盖 PeerJS 默认值。PeerJS 默认里的 TURN 中转（eu-0 / us-0.turn.peerjs.com）已经解析不到了（2026-11 实测），
        // 所以这里只配 STUN：Google 的在国内常常连不上，补两个国内能访问的。没有中转 = 直连打不通就连不上，这时界面会给出换网络的建议
        PEER_OPTIONS: {
            config: {
                iceServers: [
                    { urls: 'stun:stun.miwifi.com:3478' },
                    { urls: 'stun:stun.qq.com:3478' },
                    { urls: 'stun:stun.l.google.com:19302' }
                ],
                sdpSemantics: 'unified-plan'
            }
        },
        watchConnection, ICE_TEXT, candText, isWeChat, TIPS_HTML
    };
})();
