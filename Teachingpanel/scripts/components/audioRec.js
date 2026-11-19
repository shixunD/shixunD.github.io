// audioRec.js —— 录音：登记弹窗里的「🎙️ 录音」圆按钮、压缩档位对比、记录里的播放条、主页设置里的试录
// 全局命名空间：window.AudioRec
//
// 记录（作业登记 / 背诵检查 / 其他记录 / 笔记）只存 audioIds: string[]，录音本体和照片放在同一个 IndexedDB photos 存储里
//   （key = 'au_…'，value = { blob, createdAt }，blob.type 是 audio/webm 等），所以 .db 导出 / 导入、OneDrive 备份、清理都和照片一起走。
//   AudioRec.buttonHtml() / listHtml()    录音按钮 / 录音列表（Photos.editorHtml() 已经带上，放在照片按钮那一行）
//   AudioRec.bindEditor(root, ids)        绑定，返回 { finalize(), setKept(ids), fingerprint() }，用法同 Photos.bindEditor
//   AudioRec.viewHtml(ids)                只读播放条；<span data-audio> 由全局 MutationObserver 自动换成 <audio controls>
//   AudioRec.bindInserter(root, opts)     笔记编辑器用：录好 → 选档位 → 存好 → opts.onAudio(id)
//
// 流程：先用 MediaRecorder 录一份高质量的原始录音（128 kbps），停止后弹出对比框：
//   解码成 PCM（顺便按设置的采样率重采样、混成单声道、去掉首尾静音）→ 用 WebCodecs AudioEncoder 逐档编码成 Opus（语音模式、可变码率），
//   自己封装成 WebM（muxWebm）。确定后只存所选那一份，原始录音丢弃。
// 浏览器没有 AudioEncoder（旧版 Safari / Firefox 安卓版等）：直接按默认码率录（MediaRecorder 的 audioBitsPerSecond），
//   对比框只给这一份试听，采样率 / 去静音不起作用。

(function () {
    'use strict';

    const esc = (s) => Utils.escapeHtml(s);

    // ---------- 设置（每台设备各自记，和照片压缩一样放 localStorage） ----------
    const LS = {
        level: 'teachingPanel.audioLevel',
        custom: 'teachingPanel.audioCustomKbps',
        rate: 'teachingPanel.audioSampleRate',
        stereo: 'teachingPanel.audioStereo',
        trim: 'teachingPanel.audioTrim',
        clean: 'teachingPanel.audioClean'
    };
    // 默认值都取「够清楚里最省的」（Auson 1.39.0 定的 16 kbps）：16 kHz 宽带、单声道、去掉首尾静音、浏览器降噪
    const DEFAULTS = { level: 'k16', custom: 20, rate: 16000, stereo: false, trim: true, clean: true };
    const PRESET_KBPS = [6, 10, 16, 24, 32];
    const RATES = [
        { v: 8000, label: '8 kHz（窄带，电话音质，最省）' },
        { v: 12000, label: '12 kHz（中带）' },
        { v: 16000, label: '16 kHz（宽带，说话清楚，推荐）' },
        { v: 24000, label: '24 kHz（超宽带）' },
        { v: 48000, label: '48 kHz（全频带，最清楚）' }
    ];
    const RAW_KBPS = 128;          // 原始录音的码率：够高，基本听不出损失，留给后面逐档压缩
    const clampKbps = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(128, Math.max(6, n)) : DEFAULTS.custom; };
    const bool = (v, d) => (v === 'true' ? true : v === 'false' ? false : d);

    function settings() {
        const rate = Number(Utils.lsGet(LS.rate, DEFAULTS.rate));
        return {
            level: Utils.lsGet(LS.level, DEFAULTS.level),
            custom: clampKbps(Utils.lsGet(LS.custom, DEFAULTS.custom)),
            rate: RATES.some((r) => r.v === rate) ? rate : DEFAULTS.rate,
            stereo: bool(Utils.lsGet(LS.stereo, null), DEFAULTS.stereo),
            trim: bool(Utils.lsGet(LS.trim, null), DEFAULTS.trim),
            clean: bool(Utils.lsGet(LS.clean, null), DEFAULTS.clean)
        };
    }
    function save(patch) {
        if (patch.level != null && levelOf(patch.level)) Utils.lsSet(LS.level, patch.level);
        if (patch.custom != null) Utils.lsSet(LS.custom, String(clampKbps(patch.custom)));
        if (patch.rate != null && RATES.some((r) => r.v === Number(patch.rate))) Utils.lsSet(LS.rate, String(Number(patch.rate)));
        ['stereo', 'trim', 'clean'].forEach((k) => { if (patch[k] != null) Utils.lsSet(LS[k], String(!!patch[k])); });
    }

    // 档位：自定义 + 6/10/16/24/32 kbps + 原始录音（不压缩）
    function levelOptions(customKbps = settings().custom) {
        return [{ key: 'custom', kbps: customKbps, label: '自定义 ' + customKbps, desc: `自定义（${customKbps} kbps）` }]
            .concat(PRESET_KBPS.map((k) => ({ key: 'k' + k, kbps: k, label: k + ' kbps', desc: k + ' kbps' + (k === 16 ? '（推荐）' : '') })))
            .concat([{ key: 'raw', kbps: null, label: '不压缩', desc: '不压缩（保留原始录音）' }]);
    }
    function levelOf(key, customKbps) { return levelOptions(customKbps).find((l) => l.key === key) || null; }
    function getLevel() { return levelOf(settings().level) || levelOf(DEFAULTS.level); }
    // 没法逐档压缩时直接按这个码率录
    function directKbps() { const l = getLevel(); return l.kbps || 32; }

    const fmtSize = (n) => (n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(2) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
    const fmtDur = (sec) => { const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

    // ---------- 能力检测 ----------
    function hasMic() {
        return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.isSecureContext && window.MediaRecorder);
    }
    function micErrorText(err) {
        if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) return '没有麦克风权限';
        if (err && (err.name === 'NotFoundError' || err.name === 'OverconstrainedError')) return '没有找到麦克风';
        if (err && err.name === 'NotReadableError') return '麦克风被其他程序占用';
        return (err && err.message) || '未知错误';
    }
    function encoderConfig(rate, channels, kbps, full = true) {
        const cfg = { codec: 'opus', sampleRate: rate, numberOfChannels: channels, bitrate: kbps * 1000 };
        if (full) {
            cfg.bitrateMode = 'variable';
            cfg.opus = { application: 'voip', signal: 'voice', complexity: 10, frameDuration: 20000 };
        }
        return cfg;
    }
    // 浏览器给不给某组参数编码：先试完整的（语音模式 + 可变码率），不行再退到最基本的
    const cfgCache = new Map();
    function supportedConfig(rate, channels, kbps) {
        const key = [rate, channels, kbps].join('|');
        if (!cfgCache.has(key)) {
            cfgCache.set(key, (async () => {
                if (!window.AudioEncoder || !AudioEncoder.isConfigSupported) return null;
                for (const full of [true, false]) {
                    const cfg = encoderConfig(rate, channels, kbps, full);
                    try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) return cfg; } catch (e) { /* 试下一个 */ }
                }
                return null;
            })());
        }
        return cfgCache.get(key);
    }
    let reencodeCheck = null;
    // 能不能「录一份原始的，再逐档压缩」：要有 AudioEncoder（Opus）和 OfflineAudioContext（解码 + 重采样）
    function canReencode() {
        if (!reencodeCheck) {
            reencodeCheck = (async () => {
                if (!(window.OfflineAudioContext || window.webkitOfflineAudioContext)) return false;
                return !!(await supportedConfig(48000, 1, 16));
            })().catch(() => false);
        }
        return reencodeCheck;
    }
    function pickMime() {
        const list = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=opus', 'audio/webm', 'audio/mp4'];
        if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
        return list.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch (e) { return false; } }) || '';
    }

    // ---------- 录音窗口 ----------
    // 打开麦克风录一段；停止返回 { blob, direct }（direct = 已按默认码率直接录，不能再逐档压缩），取消返回 null，打不开麦克风抛错
    async function recordClip(opts = {}) {
        const st = settings();
        const reencode = await canReencode();
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: { ideal: st.stereo ? 2 : 1 },
                    // 立体声时关掉回声消除（开着浏览器会强制单声道）
                    echoCancellation: st.clean && !st.stereo,
                    noiseSuppression: st.clean,
                    autoGainControl: st.clean
                },
                video: false
            });
        } catch (err) {
            throw new Error(micErrorText(err));
        }
        const mime = pickMime();
        const recOpts = { audioBitsPerSecond: (reencode ? RAW_KBPS : directKbps()) * 1000 };
        if (mime) recOpts.mimeType = mime;
        let rec;
        try { rec = new MediaRecorder(stream, recOpts); } catch (e) { rec = new MediaRecorder(stream); }
        const chunks = [];
        rec.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) chunks.push(e.data); });

        const overlay = document.createElement('div');
        overlay.className = 'audio-rec-overlay';
        overlay.innerHTML = `
            <div class="audio-rec-box" role="dialog" aria-modal="true">
                <div class="audio-rec-title">${esc(opts.title || '录音')}</div>
                <div class="audio-rec-state"><span class="audio-rec-dot"></span><span data-state>正在录音</span></div>
                <div class="audio-rec-time" data-time>0:00</div>
                <div class="audio-rec-meter"><i data-meter></i></div>
                <div class="hint">${reencode ? '停止后可以逐档试听、选压缩档位' : `这个浏览器不支持在页面里重新压缩，按默认档（${directKbps()} kbps）直接录`}</div>
                <div class="audio-rec-bar">
                    <button type="button" class="btn-secondary" data-rec-cancel>取消</button>
                    <button type="button" class="btn-secondary" data-rec-pause>⏸ 暂停</button>
                    <button type="button" class="btn-primary" data-rec-stop>■ 停止</button>
                </div>
            </div>`;
        const timeEl = overlay.querySelector('[data-time]');
        const meter = overlay.querySelector('[data-meter]');
        const pauseBtn = overlay.querySelector('[data-rec-pause]');
        if (typeof rec.pause !== 'function') pauseBtn.hidden = true;

        // 音量条：只是给人看「麦克风有声音」，不参与录音
        let actx = null, analyser = null, raf = 0;
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            actx = new AC();
            analyser = actx.createAnalyser();
            analyser.fftSize = 1024;
            actx.createMediaStreamSource(stream).connect(analyser);
        } catch (e) { analyser = null; }
        const buf = analyser ? new Float32Array(analyser.fftSize) : null;
        let elapsed = 0, since = performance.now(), paused = false;
        function tick() {
            const now = performance.now();
            const total = elapsed + (paused ? 0 : now - since);
            timeEl.textContent = fmtDur(total / 1000);
            if (analyser) {
                analyser.getFloatTimeDomainData(buf);
                let sum = 0;
                for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
                const db = 20 * Math.log10(Math.sqrt(sum / buf.length) + 1e-9);
                meter.style.width = (paused ? 0 : Math.max(0, Math.min(100, (db + 60) / 60 * 100))) + '%';
            }
            raf = requestAnimationFrame(tick);
        }

        return new Promise((resolve) => {
            let done = false;
            function cleanup() {
                cancelAnimationFrame(raf);
                stream.getTracks().forEach((t) => t.stop());
                if (actx && actx.close) actx.close().catch(() => {});
                overlay.remove();
                document.removeEventListener('keydown', onKey, true);
            }
            function finish(keep) {
                if (done) return;
                done = true;
                if (!keep) {
                    rec.onstop = null;
                    try { if (rec.state !== 'inactive') rec.stop(); } catch (e) { /* 忽略 */ }
                    cleanup();
                    resolve(null);
                    return;
                }
                rec.addEventListener('stop', () => {
                    cleanup();
                    const blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' });
                    resolve(blob.size ? { blob, direct: !reencode } : null);
                    if (!blob.size) Toast.error('没有录到声音');
                }, { once: true });
                try { rec.stop(); } catch (e) { cleanup(); resolve(null); }
            }
            const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); finish(false); } };
            document.addEventListener('keydown', onKey, true);
            overlay.querySelector('[data-rec-cancel]').addEventListener('click', () => finish(false));
            overlay.querySelector('[data-rec-stop]').addEventListener('click', () => finish(true));
            pauseBtn.addEventListener('click', () => {
                if (!paused) {
                    rec.pause(); paused = true; elapsed += performance.now() - since;
                    pauseBtn.textContent = '▶ 继续';
                    overlay.querySelector('[data-state]').textContent = '已暂停';
                    overlay.classList.add('paused');
                } else {
                    rec.resume(); paused = false; since = performance.now();
                    pauseBtn.textContent = '⏸ 暂停';
                    overlay.querySelector('[data-state]').textContent = '正在录音';
                    overlay.classList.remove('paused');
                }
            });
            document.body.appendChild(overlay);
            rec.start(1000);
            tick();
        });
    }

    // ---------- 解码 / 处理 / 编码 ----------
    // 解码并重采样到 rate（decodeAudioData 会转成 context 的采样率）
    function decodeAt(bytes, rate) {
        const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const ctx = new Ctx(1, 1, rate);
        return new Promise((resolve, reject) => {
            const p = ctx.decodeAudioData(bytes.slice(0), resolve, reject);
            if (p && p.then) p.then(resolve, reject);
        });
    }
    // AudioBuffer -> 每个声道一条 Float32Array；单声道 = 各声道平均
    function toPlanes(buffer, stereo) {
        const n = buffer.numberOfChannels;
        if (stereo && n >= 2) return [buffer.getChannelData(0), buffer.getChannelData(1)];
        if (n === 1) return [buffer.getChannelData(0)];
        const out = new Float32Array(buffer.length);
        for (let c = 0; c < n; c++) {
            const d = buffer.getChannelData(c);
            for (let i = 0; i < out.length; i++) out[i] += d[i] / n;
        }
        return [out];
    }
    // 首尾静音：按 20 ms 一帧算音量，比最响的一帧低 35 dB（且低于 -50 dBFS 的一律算静音）的帧算静音；
    // 只去掉开头和结尾的，各留 0.3 秒，中间的停顿不动。整段都很小声就不裁。返回 [开始, 结束) 的采样位置
    function trimRange(planes, rate) {
        const len = planes[0].length;
        const frame = Math.max(1, Math.round(rate * 0.02));
        const count = Math.ceil(len / frame);
        const rms = new Float32Array(count);
        let peak = 0;
        for (let f = 0; f < count; f++) {
            let sum = 0, n = 0;
            for (let i = f * frame; i < Math.min(len, (f + 1) * frame); i++) {
                let v = 0;
                for (let c = 0; c < planes.length; c++) v += planes[c][i];
                v /= planes.length;
                sum += v * v; n++;
            }
            rms[f] = Math.sqrt(sum / Math.max(1, n));
            if (rms[f] > peak) peak = rms[f];
        }
        const floor = Math.pow(10, -50 / 20);
        if (peak < floor) return [0, len];
        const th = Math.max(peak * Math.pow(10, -35 / 20), floor);
        let first = 0, last = count - 1;
        while (first < count && rms[first] < th) first++;
        while (last > first && rms[last] < th) last--;
        const pad = Math.round(rate * 0.3);
        const start = Math.max(0, first * frame - pad);
        const end = Math.min(len, (last + 1) * frame + pad);
        // 去掉的不到 0.1 秒就不折腾
        return (start + (len - end) < rate * 0.1) ? [0, len] : [start, end];
    }

    const toU8 = (x) => (x instanceof ArrayBuffer ? new Uint8Array(x) : new Uint8Array(x.buffer, x.byteOffset, x.byteLength));
    // Opus 的 OpusHead（RFC 7845）：编码器给了就用它的，没给就按 libopus 的默认 pre-skip 312 自己拼
    function opusHead(desc, channels, rate) {
        if (desc) {
            const d = toU8(desc);
            if (d.length >= 19 && String.fromCharCode.apply(null, d.subarray(0, 8)) === 'OpusHead') return new Uint8Array(d);
        }
        const h = new Uint8Array(19);
        h.set([79, 112, 117, 115, 72, 101, 97, 100]);   // 'OpusHead'
        const dv = new DataView(h.buffer);
        h[8] = 1; h[9] = channels;
        dv.setUint16(10, 312, true);
        dv.setUint32(12, rate, true);
        dv.setInt16(16, 0, true);
        h[18] = 0;
        return h;
    }

    // planes 编码成 Opus，封装成 WebM Blob
    async function encodeOpus(planes, rate, kbps) {
        const channels = planes.length;
        const cfg = await supportedConfig(rate, channels, kbps);
        if (!cfg) throw new Error(`浏览器不支持 ${rate / 1000} kHz · ${kbps} kbps 的 Opus 编码`);
        const packets = [];
        let desc = null, failed = null;
        const enc = new AudioEncoder({
            output(chunk, meta) {
                const data = new Uint8Array(chunk.byteLength);
                chunk.copyTo(data);
                packets.push({ ts: chunk.timestamp, data });
                if (meta && meta.decoderConfig && meta.decoderConfig.description) desc = meta.decoderConfig.description;
            },
            error(e) { failed = e; }
        });
        enc.configure(cfg);
        const frames = planes[0].length;
        for (let off = 0; off < frames; off += rate) {
            const n = Math.min(rate, frames - off);
            const data = new Float32Array(n * channels);
            for (let c = 0; c < channels; c++) data.set(planes[c].subarray(off, off + n), c * n);
            const ad = new AudioData({ format: 'f32-planar', sampleRate: rate, numberOfFrames: n, numberOfChannels: channels, timestamp: Math.round(off * 1e6 / rate), data });
            enc.encode(ad);
            ad.close();
        }
        await enc.flush();
        enc.close();
        if (failed) throw failed;
        return muxWebm(packets, { channels, head: opusHead(desc, channels, rate), durationMs: frames / rate * 1000 });
    }

    // ---------- WebM 封装（Matroska 子集，够浏览器播放和拖动进度） ----------
    function concat(parts) {
        let len = 0;
        parts.forEach((p) => { len += p.length; });
        const out = new Uint8Array(len);
        let o = 0;
        parts.forEach((p) => { out.set(p, o); o += p.length; });
        return out;
    }
    function idBytes(id) { const out = []; let v = id; while (v > 0) { out.unshift(v % 256); v = Math.floor(v / 256); } return Uint8Array.from(out); }
    function sizeBytes(n) {
        let len = 1;
        while (len < 8 && n >= Math.pow(2, 7 * len) - 1) len++;
        const out = new Uint8Array(len);
        let v = n;
        for (let i = len - 1; i >= 0; i--) { out[i] = v % 256; v = Math.floor(v / 256); }
        out[0] |= 0x80 >> (len - 1);
        return out;
    }
    function uintBytes(v, fixed) {
        let len = fixed || 1;
        if (!fixed) while (len < 8 && v >= Math.pow(256, len)) len++;
        const b = new Uint8Array(len);
        let x = v;
        for (let i = len - 1; i >= 0; i--) { b[i] = x % 256; x = Math.floor(x / 256); }
        return b;
    }
    const el = (id, body) => concat([idBytes(id), sizeBytes(body.length), body]);
    const elU = (id, v, fixed) => el(id, uintBytes(v, fixed));
    const elS = (id, s) => el(id, new TextEncoder().encode(s));
    const elF = (id, v) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v); return el(id, b); };

    // packets: [{ ts: 微秒, data: Uint8Array }]；o: { channels, head: OpusHead, durationMs }
    function muxWebm(packets, o) {
        const ebml = el(0x1A45DFA3, concat([elU(0x4286, 1), elU(0x42F7, 1), elU(0x42F2, 4), elU(0x42F3, 8), elS(0x4282, 'webm'), elU(0x4287, 4), elU(0x4285, 2)]));
        const info = el(0x1549A966, concat([elU(0x2AD7B1, 1000000), elS(0x4D80, 'TeachingPanel'), elS(0x5741, 'TeachingPanel'), elF(0x4489, o.durationMs)]));
        const preSkip = o.head[10] | (o.head[11] << 8);
        const tracks = el(0x1654AE6B, el(0xAE, concat([
            elU(0xD7, 1), elU(0x73C5, 1), elU(0x83, 2), elU(0x9C, 0), elS(0x86, 'A_OPUS'), el(0x63A2, o.head),
            elU(0x56AA, Math.round(preSkip * 1e9 / 48000)), elU(0x56BB, 80000000),
            el(0xE1, concat([elF(0xB5, 48000), elU(0x9F, o.channels)]))
        ])));
        // 每 5 秒一个 Cluster（块内时间是 16 位有符号毫秒，不能超过 32 秒）
        const t0 = packets.length ? packets[0].ts : 0;
        const clusters = [];
        let cur = null;
        packets.forEach((p) => {
            const ms = Math.max(0, Math.round((p.ts - t0) / 1000));
            if (!cur || ms - cur.tc > 5000) { cur = { tc: ms, blocks: [] }; clusters.push(cur); }
            const rel = ms - cur.tc;
            cur.blocks.push(el(0xA3, concat([Uint8Array.from([0x81, (rel >> 8) & 0xff, rel & 0xff, 0x80]), p.data])));
        });
        const clusterBytes = clusters.map((c) => el(0x1F43B675, concat([elU(0xE7, c.tc)].concat(c.blocks))));
        // SeekHead 放最前，位置用固定 8 字节，长度不随位置变
        const seekHead = (pos) => el(0x114D9B74, concat([[0x1549A966, pos.info], [0x1654AE6B, pos.tracks], [0x1C53BB6B, pos.cues]]
            .map(([id, at]) => el(0x4DBB, concat([el(0x53AB, idBytes(id)), elU(0x53AC, at, 8)])))));
        const shLen = seekHead({ info: 0, tracks: 0, cues: 0 }).length;
        const posTracks = shLen + info.length;
        let off = posTracks + tracks.length;
        const cuePoints = [];
        clusterBytes.forEach((cb, i) => { cuePoints.push([clusters[i].tc, off]); off += cb.length; });
        const cues = el(0x1C53BB6B, concat(cuePoints.map(([t, at]) => el(0xBB, concat([elU(0xB3, t), el(0xB7, concat([elU(0xF7, 1), elU(0xF1, at)]))])))));
        const segment = el(0x18538067, concat([seekHead({ info: shLen, tracks: posTracks, cues: off }), info, tracks].concat(clusterBytes, [cues])));
        return new Blob([ebml, segment], { type: 'audio/webm;codecs=opus' });
    }

    // ---------- 压缩档位对比框 ----------
    // source: 原始录音 Blob；opts.direct：已按默认码率直接录（不能再压缩，只能试听）；
    // opts.test：主页设置里的试录（不保存，多一个「设为默认」按钮），opts.onDefaults() 设好后回调
    // 返回所选那一份 Blob；放弃返回 null
    async function chooseLevel(source, opts = {}) {
        const st = settings();
        let reencode = !opts.direct && await canReencode();
        let bytes = null;
        if (reencode) {
            try {
                bytes = await source.arrayBuffer();
                await decodeAt(bytes, 48000);   // 先试解一次：解不了（格式不认识）就只能原样保存
            } catch (e) {
                reencode = false;
                Toast.warning('这段录音没法在页面里重新压缩，只能原样保存');
            }
        }

        let customKbps = st.custom;
        let rate = st.rate;
        let stereo = st.stereo;
        let trim = st.trim;
        let selected = reencode ? getLevel().key : 'raw';
        if (reencode && !levelOf(selected)) selected = DEFAULTS.level;
        let gen = 0;
        let pcm = null;               // { planes, rate, seconds, trimmed }，参数变了重新算
        const results = new Map();    // key -> { blob, url }
        const rawUrl = URL.createObjectURL(source);
        results.set('raw', { blob: source, url: rawUrl });
        let srcChannels = 1, srcSeconds = 0;

        const overlay = document.createElement('div');
        overlay.className = 'audio-choose-overlay';
        overlay.innerHTML = `
            <div class="audio-choose-box" role="dialog" aria-modal="true">
                <h2>${opts.test ? '试听录音压缩效果' : '选择录音压缩档位'} <small data-src-info>原始录音 ${fmtSize(source.size)}</small></h2>
                <audio controls preload="auto" data-player></audio>
                <div class="photo-choose-info" data-info></div>
                ${reencode ? `
                <div class="photo-choose-levels">${levelOptions(customKbps).map((l) => `<button type="button" class="photo-choose-lv" data-lv="${l.key}"><b data-lv-label>${esc(l.label)}</b><span data-size>${l.key === 'raw' ? fmtSize(source.size) : '计算中…'}</span></button>`).join('')}</div>
                <div class="audio-choose-opts">
                    <label>自定义码率 <input type="number" min="6" max="128" step="1" value="${customKbps}" data-kbps> kbps</label>
                    <label>采样率 <select data-rate>${RATES.map((r) => `<option value="${r.v}" ${r.v === rate ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select></label>
                    <label class="check-label"><input type="checkbox" data-trim ${trim ? 'checked' : ''}> 去掉开头结尾的静音</label>
                    <label class="check-label" data-stereo-wrap><input type="checkbox" data-stereo ${stereo ? 'checked' : ''}> 立体声</label>
                </div>
                <div class="hint">${opts.test ? '在这里改参数、逐档试听；满意了点「把这些设为默认」，以后录音就按这个来' : '这里改的只对这一段有效；默认值在主页「⚙️ 设置」里改，也可以在那里试录'}。切换档位时播放位置不变，方便对比</div>`
        : `<div class="hint">${opts.direct ? `这个浏览器不支持在页面里重新压缩，这段已按默认档（${directKbps()} kbps）直接录好，采样率 / 去静音不起作用` : '这段录音只能原样保存'}</div>`}
                <div class="modal-actions">
                    ${opts.test
        ? `${reencode ? '<button type="button" class="btn-secondary" data-set-default>把这些设为默认</button>' : ''}<button type="button" class="btn-primary" data-skip>关闭</button>`
        : '<button type="button" class="btn-secondary" data-skip>放弃这段</button><button type="button" class="btn-primary" data-ok>确定</button>'}
                </div>
            </div>`;
        const player = overlay.querySelector('[data-player]');
        const infoEl = overlay.querySelector('[data-info]');
        const okBtn = overlay.querySelector('[data-ok]');
        const sizeEl = (key) => overlay.querySelector(`[data-lv="${key}"] [data-size]`);
        const lvOf = (key) => levelOf(key, customKbps);

        // 换档位时接着刚才的位置播（正在播就继续播）
        function play(url) {
            if (!url) { player.removeAttribute('src'); player.load(); return; }
            if (player.src === url) return;
            const t = player.currentTime || 0;
            const wasPlaying = !player.paused && !player.ended;
            player.src = url;
            player.addEventListener('loadedmetadata', () => {
                try { if (t && Number.isFinite(player.duration)) player.currentTime = Math.min(t, player.duration); } catch (e) { /* 忽略 */ }
                if (wasPlaying) player.play().catch(() => {});
            }, { once: true });
        }
        function paramText() {
            return `${RATES.find((r) => r.v === rate).label.split('（')[0]} · ${stereo && srcChannels >= 2 ? '立体声' : '单声道'}`;
        }
        function show() {
            overlay.querySelectorAll('[data-lv]').forEach((b) => b.classList.toggle('selected', b.dataset.lv === selected));
            const r = results.get(selected);
            play(r && r.url);
            if (okBtn) okBtn.disabled = !r;
            const lv = lvOf(selected);
            if (!reencode) {
                infoEl.innerHTML = `这一份：<b>${fmtSize(source.size)}</b>${srcSeconds ? ` · 时长 ${fmtDur(srcSeconds)}` : ''}`;
                return;
            }
            const trimmed = pcm && pcm.trimmed > 0.05 ? `（去掉了首尾静音 ${pcm.trimmed.toFixed(1)} 秒）` : '';
            infoEl.innerHTML = lv.key === 'raw'
                ? `已选：<b>不压缩</b> · 原始录音 ${fmtSize(source.size)} · 时长 ${fmtDur(srcSeconds)}（不压缩时不裁静音、不改采样率）`
                : `已选：<b>${lv.kbps} kbps</b> · ${paramText()} · ${r ? `<b>${fmtSize(r.blob.size)}</b>` : '计算中…'} · 时长 ${pcm ? fmtDur(pcm.seconds) : '…'}${trimmed}`;
        }
        async function prepare(myGen) {
            const buffer = await decodeAt(bytes, rate);
            if (myGen !== gen) return null;
            srcChannels = buffer.numberOfChannels;
            srcSeconds = buffer.duration;
            let planes = toPlanes(buffer, stereo);
            const [a, b] = trim ? trimRange(planes, rate) : [0, planes[0].length];
            planes = planes.map((p) => p.subarray(a, b));
            pcm = { planes, rate, seconds: (b - a) / rate, trimmed: (buffer.length - (b - a)) / rate };
            const sw = overlay.querySelector('[data-stereo-wrap]');
            if (sw) { sw.hidden = srcChannels < 2; }
            overlay.querySelector('[data-src-info]').textContent = `原始录音 ${fmtSize(source.size)} · ${fmtDur(srcSeconds)}${srcChannels >= 2 ? ' · 双声道' : ''}`;
            return pcm;
        }
        // 先算选中的那档，其余依次算（参数一变 gen+1，旧的作废）
        async function encodeAll() {
            const myGen = ++gen;
            results.forEach((r, k) => { if (k !== 'raw') { URL.revokeObjectURL(r.url); results.delete(k); } });
            overlay.querySelectorAll('[data-lv]').forEach((b) => { if (b.dataset.lv !== 'raw') sizeEl(b.dataset.lv).textContent = '计算中…'; });
            pcm = null;
            show();
            try {
                if (!(await prepare(myGen))) return;
            } catch (e) {
                if (myGen === gen) Toast.error('录音解码失败：' + e.message);
                return;
            }
            const keys = levelOptions(customKbps).map((l) => l.key).filter((k) => k !== 'raw');
            keys.sort((x, y) => (x === selected ? -1 : y === selected ? 1 : 0));
            for (const key of keys) {
                if (myGen !== gen || closed) return;
                try {
                    const blob = await encodeOpus(pcm.planes, rate, lvOf(key).kbps);
                    if (myGen !== gen || closed) return;
                    results.set(key, { blob, url: URL.createObjectURL(blob) });
                    sizeEl(key).textContent = fmtSize(blob.size);
                } catch (e) {
                    if (myGen === gen) sizeEl(key).textContent = '不支持';
                }
                if (key === selected) show();
            }
            show();
        }

        let closed = false;
        return new Promise((resolve) => {
            const finish = (value) => {
                if (closed) return;
                closed = true;
                gen++;
                player.pause();
                overlay.remove();
                document.removeEventListener('keydown', onKey, true);
                results.forEach((r) => URL.revokeObjectURL(r.url));   // 调用方会给选中的那份另建 URL
                resolve(value);
            };
            const onKey = (e) => {
                if (e.key === 'Escape') { e.stopPropagation(); finish(null); return; }
                const tag = (e.target && e.target.tagName) || '';
                if (e.key === 'Enter' && okBtn && !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(tag)) {
                    e.preventDefault(); e.stopPropagation();
                    const r = results.get(selected);
                    if (r) finish(r.blob);
                }
            };
            document.addEventListener('keydown', onKey, true);
            overlay.addEventListener('click', (e) => {
                const lv = e.target.closest('[data-lv]');
                if (lv) { selected = lv.dataset.lv; show(); return; }
                if (e.target.closest('[data-skip]')) { finish(null); return; }
                if (e.target.closest('[data-ok]')) { const r = results.get(selected); if (r) finish(r.blob); return; }
                if (e.target.closest('[data-set-default]')) {
                    save({ level: selected, custom: customKbps, rate, stereo, trim });
                    Toast.success('已设为默认：以后录音都按这些参数');
                    if (opts.onDefaults) opts.onDefaults();
                }
            });
            const kbpsInput = overlay.querySelector('[data-kbps]');
            if (kbpsInput) {
                kbpsInput.addEventListener('change', () => {
                    customKbps = clampKbps(kbpsInput.value);
                    kbpsInput.value = customKbps;
                    const b = overlay.querySelector('[data-lv="custom"] [data-lv-label]');
                    if (b) b.textContent = '自定义 ' + customKbps;
                    selected = 'custom';
                    encodeAll();
                });
                overlay.querySelector('[data-rate]').addEventListener('change', (e) => { rate = Number(e.target.value); encodeAll(); });
                overlay.querySelector('[data-trim]').addEventListener('change', (e) => { trim = e.target.checked; encodeAll(); });
                overlay.querySelector('[data-stereo]').addEventListener('change', (e) => { stereo = e.target.checked; encodeAll(); });
            }
            player.addEventListener('loadedmetadata', () => { if (!reencode && Number.isFinite(player.duration)) { srcSeconds = player.duration; show(); } });
            document.body.appendChild(overlay);
            if (reencode) encodeAll(); else show();
        });
    }

    // 录一段 → 选档位；返回要保存的 Blob 或 null。没有麦克风接口（非 https 等）时由调用方退回选文件
    async function recordAndChoose() {
        const got = await recordClip();
        if (!got) return null;
        return chooseLevel(got.blob, { direct: got.direct });
    }

    // ---------- 存储 / 播放 ----------
    const urlCache = new Map();   // 录音 id -> object URL
    function urlFor(id) {
        if (urlCache.has(id)) return Promise.resolve(urlCache.get(id));
        return AppState.audioGet(id).then((blob) => {
            if (!blob) return null;
            const url = URL.createObjectURL(blob);
            urlCache.set(id, url);
            return url;
        });
    }
    function viewHtml(ids) {
        if (!ids || !ids.length) return '';
        return `<div class="audio-clips">${ids.map((id) => `<span class="audio-clip" data-audio="${esc(id)}"></span>`).join('')}</div>`;
    }
    function hydrateOne(holder) {
        if (holder.querySelector('audio') || holder.dataset.audioLoading) return;
        holder.dataset.audioLoading = '1';
        urlFor(holder.dataset.audio).then((url) => {
            delete holder.dataset.audioLoading;
            if (holder.querySelector('audio')) return;
            if (!url) { holder.textContent = '🎙️ 录音已丢失'; return; }
            const a = document.createElement('audio');
            a.controls = true;
            a.preload = 'metadata';
            a.src = url;
            holder.appendChild(a);
        }).catch(() => { delete holder.dataset.audioLoading; });
    }
    function hydrate(root) {
        if (root.matches && root.matches('[data-audio]')) hydrateOne(root);
        if (root.querySelectorAll) root.querySelectorAll('[data-audio]').forEach(hydrateOne);
    }
    new MutationObserver((mutations) => {
        mutations.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) hydrate(n); }));
    }).observe(document.documentElement, { childList: true, subtree: true });
    // 同一时间只放一段：开始播一段时把别的停掉
    document.addEventListener('play', (e) => {
        if (!(e.target instanceof HTMLMediaElement)) return;
        document.querySelectorAll('audio').forEach((a) => { if (a !== e.target && !a.paused) a.pause(); });
    }, true);

    // ---------- 弹窗里的编辑器 ----------
    function buttonHtml() {
        return `<button type="button" class="audio-rec-btn" data-audio-rec title="录音（录完可以逐档试听、选压缩档位）" aria-label="录音"><span class="audio-rec-icon"></span></button>
            <input type="file" accept="audio/*" capture hidden data-audio-input>`;
    }
    function listHtml() { return '<div class="audio-clips" data-audio-list></div>'; }

    // 录一段（或没有麦克风接口时选一个录音文件）→ 选档位 → onBlob(blob)
    function bindRecordButton(btn, input, onBlob, alive) {
        let busy = false;
        btn.addEventListener('click', async () => {
            if (busy) return;
            if (!hasMic()) { input.click(); return; }
            busy = true;
            btn.classList.add('busy');
            try {
                const blob = await recordAndChoose();
                if (blob && alive()) await onBlob(blob);
            } catch (err) {
                Toast.warning(`无法录音（${err.message}）`);
            } finally {
                busy = false;
                btn.classList.remove('busy');
            }
        });
        input.addEventListener('change', async () => {
            const file = input.files && input.files[0];
            input.value = '';
            if (!file) return;
            try {
                const blob = await chooseLevel(file, {});
                if (blob && alive()) await onBlob(blob);
            } catch (err) {
                Toast.error(err.message);
            }
        });
    }

    function bindEditor(root, existingIds) {
        const btn = root.querySelector('[data-audio-rec]');
        const input = root.querySelector('[data-audio-input]');
        const list = root.querySelector('[data-audio-list]');
        let kept = (existingIds || []).slice();
        const pending = [];      // { blob, url }
        const discarded = [];
        function render() {
            if (!list) return;
            list.innerHTML = kept.map((id) => `<span class="audio-clip"><span data-audio="${esc(id)}"></span><button type="button" class="audio-rm" data-rm-kept-audio="${esc(id)}" title="删除这段录音">✕</button></span>`).join('')
                + pending.map((p, i) => `<span class="audio-clip audio-clip-new"><audio controls preload="metadata" src="${p.url}"></audio><small>${fmtSize(p.blob.size)}</small><button type="button" class="audio-rm" data-rm-pending-audio="${i}" title="删除这段录音">✕</button></span>`).join('');
        }
        if (btn && input) bindRecordButton(btn, input, (blob) => { pending.push({ blob, url: URL.createObjectURL(blob) }); render(); }, () => document.body.contains(root));
        if (list) list.addEventListener('click', async (e) => {
            const k = e.target.closest('[data-rm-kept-audio]');
            const p = e.target.closest('[data-rm-pending-audio]');
            if (!k && !p) return;
            const ok = await Modal.confirm({ title: '删除录音', text: '确定删除这段录音吗？', confirmText: '删除', danger: true });
            if (!ok) return;
            let undo;
            if (k) {
                const index = kept.indexOf(k.dataset.rmKeptAudio);
                if (index < 0) return;
                const [id] = kept.splice(index, 1);
                undo = () => { if (!kept.includes(id)) kept.splice(Math.min(index, kept.length), 0, id); };
            } else {
                const index = Number(p.dataset.rmPendingAudio);
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
            Toast.action('已删除录音', '撤销', () => { undo(); render(); });
        });
        render();
        return {
            setKept(ids) { kept = (ids || []).slice(); render(); },
            fingerprint() { return kept.join(',') + '|' + pending.length; },
            count() { return kept.length + pending.length; },
            async finalize() {
                const ids = kept.slice();
                for (const p of pending) {
                    const id = Utils.uid('au');
                    await AppState.audioPut(id, p.blob);
                    ids.push(id);
                    URL.revokeObjectURL(p.url);
                }
                pending.length = 0;
                discarded.forEach((p) => URL.revokeObjectURL(p.url));
                discarded.length = 0;
                render();
                return ids;
            }
        };
    }

    // 笔记编辑器用：root 里有 [data-ins-audio] 按钮和 [data-ins-audio-input]；录好存进库后 opts.onAudio(id)
    function bindInserter(root, opts) {
        const btn = root.querySelector('[data-ins-audio]');
        const input = root.querySelector('[data-ins-audio-input]');
        if (!btn || !input) return;
        const alive = opts.alive || (() => true);
        bindRecordButton(btn, input, async (blob) => {
            const id = Utils.uid('au');
            await AppState.audioPut(id, blob);
            if (alive()) opts.onAudio(id);
        }, alive);
    }

    // ---------- 主页设置里的试录 ----------
    let lastTest = null;   // 上一次试录的原始录音（只在这次打开页面期间保留）
    async function testRecord(onDefaults) {
        if (!hasMic()) { Toast.error('这里打不开麦克风（需要 https，且浏览器支持录音）'); return; }
        try {
            const got = await recordClip({ title: '试录一段（不会保存）' });
            if (!got) return;
            lastTest = got;
            await chooseLevel(got.blob, { direct: got.direct, test: true, onDefaults });
        } catch (err) {
            Toast.warning(`无法录音（${err.message}）`);
        }
    }
    async function replayTest(onDefaults) {
        if (!lastTest) { Toast.info('还没有试录过'); return; }
        await chooseLevel(lastTest.blob, { direct: lastTest.direct, test: true, onDefaults });
    }

    window.AudioRec = {
        buttonHtml, listHtml, bindEditor, bindInserter, viewHtml,
        settings, save, levelOptions, getLevel, RATES, DEFAULTS, hasMic, canReencode,
        testRecord, replayTest, hasTest: () => !!lastTest,
        _internal: { muxWebm, trimRange, opusHead, toPlanes, resetSupport() { reencodeCheck = null; cfgCache.clear(); } }   // 测试用
    };
})();
