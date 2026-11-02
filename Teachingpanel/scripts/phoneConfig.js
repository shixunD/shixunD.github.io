// phoneConfig.js —— 「手机拍照回传电脑」电脑端（components/phoneLink.js）和手机端（phone.html / phone.js）共用的配置
// 全局命名空间：window.PhoneLinkConfig

(function () {
    'use strict';

    window.PhoneLinkConfig = {
        // 电脑端的固定配对码（手机扫一次后会记住，之后不用再扫）/ 手机端记住的电脑配对码；localStorage 键都带应用前缀
        LS_PEER_ID: 'teachingPanel.phone.peerId',
        LS_TARGET: 'teachingPanel.phone.target',
        // PeerJS 公共牵线服务只负责交换连接信息，照片走手机→电脑的直连（WebRTC，加密）。
        // 自己给 iceServers 会覆盖 PeerJS 默认值，所以 Google STUN 和 PeerJS 自带的 TURN 中转也要写上；
        // 再补两个国内能访问的 STUN（Google 的在国内常常连不上；同一个 WiFi 下本来也不需要 STUN）
        PEER_OPTIONS: {
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun.miwifi.com:3478' },
                    { urls: 'stun:stun.qq.com:3478' },
                    { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' }
                ],
                sdpSemantics: 'unified-plan'
            }
        }
    };
})();
