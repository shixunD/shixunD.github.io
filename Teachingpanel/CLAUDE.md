# CLAUDE.md

学情看板：纯 HTML+CSS+原生 JS 的静态网页应用（无框架/无构建），登记学生作业、背诵、考试情况，部署在 Cloudflare Workers 静态资源。

- **改动前先读 `PROJECT.md`**：架构、数据模型、文件清单、各种"为什么这么做"都在里面。
- 终端用户说明在 `Handbook/index.html`（用户可见功能变化时必须同步更新）。
- 业务数据只能通过 `AppState` / `scripts/models/*.js` 修改（`AppState._commit`），不要直接改 DOM 当数据。
- 数据结构变化：递增 `SCHEMA_VERSION`，在 `state.js` 的 `migrate()` 做迁移，同步 `validateSnapshot()`，并实测"导出 → 导入"。
- 新增/改名文件：同步 `index.html` 的 `<script>/<link>`（注意依赖顺序）、`service-worker.js` 的 `URLS_TO_CACHE`、`PROJECT.md` 文件清单。
- 每次发版：bump `version.json`（semver + changelog 最前面插入）并在 `UPDATE.md` 顶部加同版本记录。`.claude/settings.json` 里的 PostToolUse hook 会在改源码后提醒。
- 部署：Workers Builds 的 Build command 生成 `deploy-tag.json`（命令见 `wrangler.jsonc`），更新检测靠它判重，不靠 version.json。
- 本地调试：`python3 -m http.server 8765` 后打开 `http://localhost:8765/`（本地没有 deploy-tag.json，更新检测会静默跳过，属正常）。
