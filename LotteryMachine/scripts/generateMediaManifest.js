// generateMediaManifest.js —— 生成 backgroundmusic/manifest.json（文件名 + 字节数清单）
//
// 用途：service-worker.js 收到 CLEAR_CACHE 消息（用户点"完成更新"）时，不再无脑清空全部缓存——
// 音效素材体积大（几十 KB 到 1MB+ 不等），大部分发版根本没改过音效，逐个重新下载纯属浪费流量。
// SW 改成拿这份 manifest 里记录的"文件名 + 字节数"跟 Cache Storage 里已缓存的文件逐一核对：
// 名字和大小都对得上 → 保留，不重新下载；大小不一样（文件内容换了）→ 删掉强制重新拉；manifest 里
// 已经没有这个文件了（被删除/改名）→ 同样删掉，不留孤儿缓存条目。
//
// 这份 manifest 同时也是 soundEffects.js / mediaLoader.js 的**唯一素材清单**（代码里不再手写文件名
// 数组）：播放时随机选哪些文件、启动蒙版要下载哪些文件、进度条的总字节数，全部以它为准。
//
// **这个脚本不是自动跑的**，跟仓库里 icon-192.png 的生成方式（PROJECT.md 九节）一样，是手动工具：
// 往 backgroundmusic/spin/ 或 backgroundmusic/win/ 增删/替换了任何 .wav 文件之后，本地跑一次
//     node scripts/generateMediaManifest.js
// 重新生成 backgroundmusic/manifest.json，再把这个文件一起提交/复制到大仓库 push。
// **忘了跑这一步不会报错，但新加的文件不会被下载、也不会被播放**（清单里没有它）；替换了同名文件
// 但没更新大小的话，启动蒙版会发现缓存大小和清单不符而多重下一次，然后接受下载到的文件——不会卡死，
// 但要让新素材真正生效，必须跑这个脚本。

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MEDIA_DIRS = ['backgroundmusic/spin', 'backgroundmusic/win'];
const OUTPUT_FILE = path.join(ROOT, 'backgroundmusic', 'manifest.json');

const manifest = {};

for (const dir of MEDIA_DIRS) {
    const absDir = path.join(ROOT, dir);
    if (!fs.existsSync(absDir)) continue;
    for (const name of fs.readdirSync(absDir)) {
        const absFile = path.join(absDir, name);
        const stat = fs.statSync(absFile);
        if (!stat.isFile()) continue;
        // key 用相对仓库根目录的 posix 风格路径（跟 service-worker.js 里从请求 URL 反推出来的
        // key 保持同一种拼法），值是字节数——就靠这两个字段判重，不需要算哈希这么重
        const key = `${dir}/${name}`;
        manifest[key] = stat.size;
    }
}

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`[generateMediaManifest] 已写入 ${OUTPUT_FILE}，共 ${Object.keys(manifest).length} 个文件`);
