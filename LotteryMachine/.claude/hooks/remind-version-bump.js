// PostToolUse hook (Edit|Write|NotebookEdit): after editing LotteryMachine source files,
// remind Claude to bump version.json's changelog and sync Handbook/index.html.
// Excludes version.json and Handbook/index.html themselves so the hook doesn't fire on its own follow-up edits.
let raw = '';
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
    let input;
    try {
        input = JSON.parse(raw || '{}');
    } catch {
        return;
    }

    const filePath = (input.tool_input && input.tool_input.file_path)
        || (input.tool_response && input.tool_response.filePath)
        || '';
    const norm = filePath.replace(/\\/g, '/');

    const isExcluded = /\/(version\.json|Handbook\/index\.html)$/i.test(norm);
    const isSource = /\/(index\.html|manifest\.json|service-worker\.js)$/i.test(norm)
        || /\/scripts\//i.test(norm)
        || /\/styles\//i.test(norm);

    if (!isSource || isExcluded) return;

    console.log(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            additionalContext:
                `提醒：刚修改了 LotteryMachine 源码文件 ${filePath}。这次改动完成后别忘了：` +
                `1) 在 version.json 里 bump semver 并追加一条描述本次改动的 changelog 条目；` +
                `2) 同步更新 Handbook/index.html 里受影响的说明章节，让文档和实际功能保持一致。`,
        },
    }));
});
