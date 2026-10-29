// PostToolUse hook：编辑了项目源码后，提醒 bump version.json/UPDATE.md 并同步 Handbook
let raw = '';
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
    let input;
    try { input = JSON.parse(raw || '{}'); } catch { return; }

    const filePath = (input.tool_input && input.tool_input.file_path)
        || (input.tool_response && input.tool_response.filePath) || '';
    const norm = filePath.replace(/\\/g, '/');

    // 排除提醒目标自身，避免改完它们又收到一条无意义的提醒
    const isExcluded = /\/(version\.json|UPDATE\.md|Handbook\/index\.html)$/i.test(norm);
    const isSource = /\/(index\.html|manifest\.json|service-worker\.js)$/i.test(norm)
        || /\/scripts\//i.test(norm) || /\/styles\//i.test(norm);

    if (!isSource || isExcluded) return;

    console.log(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            additionalContext:
                `提醒：刚修改了源码文件 ${filePath}。这次改动完成后别忘了：` +
                `1) 在 version.json 里 bump semver 并在 changelog 最前面插入本次改动条目，同时在 UPDATE.md 顶部加一条同版本号记录；` +
                `2) 同步更新 Handbook/index.html 里受影响的说明章节；` +
                `3) 新增/改名文件时同步 service-worker.js 的 URLS_TO_CACHE 和 PROJECT.md 文件清单。`,
        },
    }));
});
