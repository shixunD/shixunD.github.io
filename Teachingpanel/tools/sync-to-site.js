// tools/sync-to-site.js —— 把本项目同步到个人站点仓库（shixunD.github.io）的 Teachingpanel/ 目录，并做大小写体检
// 用法：
//   node tools/sync-to-site.js --check                 只体检本项目（路径只差大小写 / 引用路径大小写写错）
//   node tools/sync-to-site.js <站点仓库路径>            体检 + 同步（只复制文件，不 commit / push）
//
// 为什么要有它：Windows 文件系统不区分大小写，但 git / GitHub / Cloudflare 区分。
// 站点仓库曾同时存在 Teachingpanel/ 和 TeachingPanel/ 两个目录，新文件进了后者，线上 /Teachingpanel/ 下就 404。
// 所以这里在 Windows 上也要强制检查：目标目录名必须与 SITE_DIR 逐字符一致，且 git 里不能出现只差大小写的同名路径。
// 无依赖，仅需 node + git。

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SITE_DIR = 'Teachingpanel';             // 线上网址是 /Teachingpanel/，大小写以它为准
const SKIP_PREFIXES = ['tools/'];             // 开发辅助文件，不部署
const root = path.resolve(__dirname, '..');

const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.quotepath=false', ...args], { cwd, encoding: 'utf8' });
const lines = (s) => s.split(/\r?\n/).filter(Boolean);
const problems = [];

// 1) 只差大小写的重复路径（在给定文件清单里）
function findCaseDuplicates(files, label) {
    const seen = new Map();
    files.forEach((f) => {
        const k = f.toLowerCase();
        if (seen.has(k) && seen.get(k) !== f) problems.push(`${label}: 路径只差大小写 -> "${seen.get(k)}" 与 "${f}"`);
        else seen.set(k, f);
    });
}

// 2) index.html / service-worker.js 里引用的文件，必须与 git 里的大小写完全一致（本地 Windows 打得开不代表线上能）
function checkReferences(tracked) {
    const exact = new Set(tracked);
    const lower = new Map(tracked.map((f) => [f.toLowerCase(), f]));
    const refs = [];
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    for (const m of html.matchAll(/(?:src|href)="\.\/([^"#?]+)"/g)) refs.push(['index.html', m[1]]);
    const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
    for (const m of sw.matchAll(/'\.\/([^']+)'/g)) refs.push(['service-worker.js', m[1]]);
    refs.forEach(([from, ref]) => {
        if (ref.endsWith('/')) return;
        if (exact.has(ref)) return;
        const hit = lower.get(ref.toLowerCase());
        problems.push(hit ? `${from}: 引用 "${ref}" 大小写与实际文件 "${hit}" 不一致` : `${from}: 引用 "${ref}" 找不到对应的 git 跟踪文件（漏 git add？）`);
    });
}

const tracked = lines(git(root, 'ls-files'));
const untracked = lines(git(root, 'ls-files', '--others', '--exclude-standard'));
findCaseDuplicates(tracked, '本项目');
checkReferences(tracked);
untracked.filter((f) => /\.(js|css|html|json|png|wasm)$/.test(f) && !SKIP_PREFIXES.some((p) => f.startsWith(p)))
    .forEach((f) => problems.push(`本项目: 文件 "${f}" 还没 git add，不会被同步`));

const arg = process.argv[2];
if (!arg) { console.error('用法: node tools/sync-to-site.js --check | <站点仓库路径>'); process.exit(2); }

let site = null;
if (arg !== '--check') {
    site = path.resolve(arg);
    // 站点仓库的 git 里只允许 SITE_DIR 这一种写法
    const siteTree = lines(git(site, 'ls-tree', '-r', '--name-only', 'HEAD')).concat(lines(git(site, 'ls-files')));
    const variants = new Set(siteTree.filter((f) => f.toLowerCase().startsWith(SITE_DIR.toLowerCase() + '/')).map((f) => f.split('/')[0]));
    variants.forEach((v) => { if (v !== SITE_DIR) problems.push(`站点仓库: git 里存在写法 "${v}/"（应只有 "${SITE_DIR}/"），请先合并`); });
    // 磁盘上的目录名也必须一致，否则 git add 会把新文件登记成磁盘上的大小写
    const onDisk = fs.readdirSync(site).filter((n) => n.toLowerCase() === SITE_DIR.toLowerCase());
    if (onDisk.length && onDisk[0] !== SITE_DIR) problems.push(`站点仓库: 磁盘目录名是 "${onDisk[0]}"，请先改成 "${SITE_DIR}"（先改成临时名再改回来）`);
}

if (problems.length) {
    console.error('发现问题，已停止（未复制任何文件）：\n - ' + problems.join('\n - '));
    process.exit(1);
}
if (!site) { console.log('体检通过：路径大小写一致、引用都能对上。'); process.exit(0); }

// 3) 同步：目标目录 = 本项目 git 跟踪的文件（跳过 tools/），多余的旧文件删掉
const want = tracked.filter((f) => !SKIP_PREFIXES.some((p) => f.startsWith(p)));
const dest = path.join(site, SITE_DIR);
let copied = 0, removed = 0;
want.forEach((f) => {
    const to = path.join(dest, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const src = fs.readFileSync(path.join(root, f));
    if (!fs.existsSync(to) || !fs.readFileSync(to).equals(src)) { fs.writeFileSync(to, src); copied++; }
});
const wantSet = new Set(want);
(function prune(dir, rel) {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
        const r = rel ? rel + '/' + e.name : e.name;
        if (e.isDirectory()) prune(path.join(dir, e.name), r);
        else if (!wantSet.has(r)) { fs.unlinkSync(path.join(dir, e.name)); removed++; }
    });
})(dest, '');

console.log(`同步完成：更新/新增 ${copied} 个，删除 ${removed} 个。接下来在站点仓库里：`);
console.log('  git add -A && git status        # 路径应全部是 Teachingpanel/ 开头');
console.log('  git commit && git push');
