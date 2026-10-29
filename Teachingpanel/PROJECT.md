# 学情看板 TeachingPanel — 项目说明文档

> 面向后续接手这个项目的 AI 或开发者：不逐行读代码也能理解每个文件的职责、数据模型和"为什么这么做"。
> 工程规范沿用 webapp-dev-guide（LotteryMachine 项目的实战规范）。

## 一、这是什么

纯静态网页应用（HTML + CSS + 原生 JS，无框架、无构建工具），部署在 Cloudflare Workers 静态资源。
老师用来登记、追踪学生的**作业完成情况、背诵过关情况、考试成绩**。数据全部保存在浏览器 IndexedDB，
导入导出（以及 OneDrive 单向快照备份）用 **SQLite 数据库文件（.db）**，全量、按表存放。

四个主页面（`index.html` 里 `.page` + `.active` 切换显隐，不是路由）：

| 页面 | 容器 id | 模块 | 子视图 |
|---|---|---|---|
| 主页 | `home-page` | `SettingsPage` + `RosterSection` | 今日概览、学生名单、comment 快捷词、数据、设置、应用信息 |
| 作业 | `homework-page` | `HomeworkPage` | 登记 / 总览矩阵 / 欠交清单 / 学生趋势 |
| 背诵 | `recitation-page` | `RecitationPage` | 检查 / 时间看板 / 总览 / 学生趋势 |
| 考试 | `exams-page` | `ExamsPage` | 考试（列表+详情） / 学生看板 |

另有跨页面的**学生档案**（`StudentProfile`）：任何带 `data-profile-id` 的元素被点击都会打开右侧抽屉，汇总该生三类数据。
默认标签跟随当前页面（`Navigation.getCurrent()`：作业/背诵/考试页 → 对应标签；主页 → 沿用上次）。

## 二、整体架构

```
index.html
  → styles/*.css
  → scripts/*.js（IIFE 模块，每个文件挂一个 window.Xxx；<script> 顺序 = 依赖顺序）
  → app.js 的 DOMContentLoaded → init()：
      1. 注册 service-worker.js（{scope:'./', updateViaCache:'none'}）
      2. AppState.load()（IndexedDB → 内存；首次运行建"默认班级"+语数英三科）
      3. Navigation.init()，渲染班级切换器，恢复上次打开的页面
      4. AppState.subscribe：数据变化 → 重绘当前页 + 班级切换器 + 背诵提醒角标 + 打开中的学生档案
      5. Reminders.init()（角标 + 每天一次的到期提醒）
      6. SettingsPage.init()（读取版本号、监听 PWA 可安装状态）
      7. Persistence.requestPersistence()、UpdateChecker.check()
```

**单一数据源 + 整段重绘**：所有页面渲染都是整段 `innerHTML` 重绘 + 重新绑定事件。业务数据只能通过
`AppState` 方法或业务模型（`scripts/models/*.js`，内部调用 `AppState._commit(mutator)`）修改，
`_commit` 负责持久化 + 广播。**页面级界面状态**（当前子标签、选中的作业/轮次、筛选条件、刷子模式）
放在各页面模块的 `ui` 对象里，不进 AppState；子标签和当前页面另外记到 localStorage（仅界面偏好，读写都 try/catch）。

**输入焦点问题的处理**：整页重绘会让正在输入的 `<input>` 丢焦点，所以凡是"连续输入多个值"的场景
（成绩录入、批量添加、comment）都放进弹窗里，点"保存"才一次性 commit。不要改成"每个输入框 change 就 commit"。

## 三、数据模型（`scripts/state.js`）

```js
state = {
  schemaVersion: 3,
  classes:   [{ id, name }],
  activeClassId,
  students:  [{ id, classId, name, studentNo, note }],    // 姓名在同一班级内唯一（addStudent/updateStudent/bulkAdd 校验）
  homework:  [{ id, classId, date, title, note, createdAt,
                records: { [studentId]: { status, comment, madeUpAt? } } }],
  recRounds: [{ id, classId, title, content, createdAt, archived }],
  recChecks: [{ id, roundId, studentId, date, result, note, createdAt }],   // v4 起不带复查日期
  recPlans:  [{ id, roundId, studentId, date, createdAt }],   // 计划某天背诵（v3 新增）
  exams:     [{ id, classId, name, date, fullScore, createdAt, scores: { [studentId]: number } }],
  settings:  { reminderNotify: false, passPercent: 60,
               quickPhrases: { homework: [], recitation: ['复习体系混乱', '复习体系有条理', '书写有一定问题', '格式需要改善'] } }
}
```

- 关联一律用内部 `id`（改名不丢历史）；"姓名唯一"是业务约束，TXT 成绩导入按姓名匹配。
- 日期统一是本地时区 `YYYY-MM-DD` 字符串（`Utils.today()`），**不要用 `toISOString()`**——那是 UTC，北京时间早上 8 点前会变成昨天。
- **界面显示日期一律 `Utils.formatDate()` → `10-29(星期四)`**（用户明确要求所有日期后面括号标注星期几），不要自己拼 `MM-DD`。
- 学号排序：`Utils.compareStudentNo`，数字按数值、混合字符串用 numeric collation，没学号的排最后。
- 删除学生/班级/作业/轮次/考试都会**级联删除**相关记录。
- **没有"科目"概念**（v1.1.0 起取消）：作业/背诵/考试都不分科目，也不预设科目。
- `settings.quickPhrases`：comment 快捷词，作业/背诵两套独立。`normalize()` 对它做深合并——缺哪一组补默认值、过滤空串/重复项，所以旧数据和旧备份导入后也一定有这个字段（因此加它不需要升 schema）。
- **schema 历史**：v1（1.0.0）带 `subjects` 列表和各记录的 `subjectId`；v2（1.1.0）`migrate()` 把它们删掉；
  v3（1.2.0）新增 `recPlans`（无需转换，`normalize()` 补空数组）；v4（1.9.0）把检查记录上的 `nextDates` 转成 `recPlans`
  （计划 `createdAt` = 原检查记录的 `createdAt`，同一学生同一轮同一天不重复）并删除 `nextDates`。删除学生/轮次/班级都会级联删除计划。
- **迁移**：`load()` 和 `replaceState()`（本地导入、云端恢复共用）都走 `normalize()` → `migrate()`。
  以后改结构：递增 `SCHEMA_VERSION`，在 `migrate()` 里按版本逐级升级，并同步改 `validateSnapshot()`，
  然后**实际跑一遍"导出 → 导入"**确认旧备份仍能导入。

### 3.1 作业（`models/homework.js`）

| status | 含义 | 颜色 |
|---|---|---|
| `done` | 完全完成（默认） | 深绿 `#1e8e3e` |
| `missing` | 未完成 | 红 `#d93025` |
| `poor` | 未按要求完成 | 粉红 `#f48fb1` |
| `missing_fixed` | 已补交（未完成后补上） | 深蓝 `#1a4fa3` |
| `poor_fixed` | 已补改（未按要求后补上） | 浅蓝 `#7fb8f0` |

- **records 里没有某学生 = done**。新开作业不用给全班写记录；改回 done 且没 comment 时删除记录。
- `markFixed`：missing→missing_fixed、poor→poor_fixed，记录 `madeUpAt`。
- 按时完成率 = done / 总数；最终完成率 = (done + 两种已补上) / 总数；"欠交" = missing + poor（未补）。
- **欠交清单按作业分组**（`outstanding()` 返回 `[{hw, items:[{student, rec}]}]`，作业日期倒序、组内学号序）。
- "已补上"统一走 `HomeworkDialogs.markFixed(hwId, sid, {confirm})`：欠交清单里 `confirm:true` 先二次确认；
  执行前用 `snapshotRecord` 存下原记录，执行后弹 `Toast.action` 的「撤销」（8 秒），撤销调 `restoreRecord` 原样恢复（含 comment）。
  登记页卡片上的「补」和刷子「已补上」不确认（追求快），但同样提供撤销。
- 状态颜色是固定语义色，与主题主色无关，不要跟着换肤改。

### 3.2 背诵（`models/recitation.js`）

- **轮次（round）不绑定日期**，每天抽查一部分人，每次检查新增一条 `recCheck`（历史全保留，可删单条）。
- 学生在某轮次的**当前状态 = 最新一条检查记录的 result**（`progressOf()/statusOf()`；按 date，再按 createdAt 排序）；没记录 = 未检查。
  result：`pass` 绿 / `retry` 黄（需重新过关）/ `fail` 红（未过关）。
  **1.9.0 起"需重新过关 / 未过关"只是状态，不带日期**（用户要求与复查日期脱离关系）；"哪天再背"统一用背诵计划表示。
  原先 1.4.0 的"设了 N 个复查日期就要过关 N 次"规则随之取消。`progressOf()` 还给出 `passedOn`（这一段连续过关的第一次过关日期）
  与 `attemptsToPass`，供学生趋势"首次过关 / 用时 / 平均几次过关"使用。
- 检查记录可编辑（`RecitationModel.updateCheck`，检查弹窗历史里的「编辑」→ `RecitationDialogs.openEditCheck`：结果 / 日期 / 备注）。
  子标签图标：✅ 检查、🗓️ 计划背诵、⏰ 时间看板、🧩 总览、📈 学生趋势。
- 检查弹窗：选「需重新过关 / 未过关」时自动打开「🗓️ 计划背诵」日期块，可顺便选哪天再背（多选），**不选也能保存**（只登记状态）；
  只加计划（不登记结果）时必须选日期。
- **背诵计划（recPlans）**："计划某天让这个学生背"，**与检查状态互不影响、可同时存在**（1.5.0 起，用户要求"改了状态不要删计划"）。
  一个学生可以有多个计划日期（每个日期一条记录）。入口：检查弹窗的「🗓️ 计划背诵」开关（独立于检查结果，
  一次保存可同时登记结果 + 加计划；结果按钮再点一次可取消）、背诵页的「🗓️ 计划背诵」子标签（`planView.js`：选轮次 → 点日期 → 点学生即加入/取消这天的计划，自动保存；
  选中那天要检查的学生标绿，日期块下方显示这天已计划几人；下方按日期列出本轮全部计划）。检查页轮次右上角的「🗓️ 计划背诵」按钮会跳到该子标签并带上轮次。
  1.6.0 起时间看板里不再有计划入口，原批量计划弹窗已删除。
  - **登记检查从不删除计划**。`isPlanDone(plan)`：安排计划之后（`createdAt`）登记的、日期 ≥ 计划日期的检查 → 计划"已完成"，
    保留在记录里（检查弹窗显示"✓ 已检查"），但不进 `pendingPlans()`/时间看板/提醒/粉框/浅绿底色。只有手动"取消计划/删除"才会删除。
- **背诵里所有日期都用 `DayPicker` 日期块**（`components/dayPicker.js`）：本周/下周日期块 + 「其他」日历框兜底。
  检查日期：单选、7 天、默认今天、`max=今天`；
  计划日期：多选、7 天（1.6.1 起与其他背诵日期一致，本周+下周共 14 天）、`min=今天`；
  计划背诵子标签的学生块上始终列出该生本轮全部计划日期（选中的那天加粗）；作业日期（新建/编辑作业）：单选、7 天、不限范围、默认今天。1.3.0 删除了"⚡ 点击即过关"（用户要求），检查一律走弹窗。
- 卡片样式（`recitationPage.js` 的 `studentCard()`）：有未完成计划 → 整块浅绿（`RecitationModel.PLAN`），状态行前加状态色圆点，
  状态和计划分两行同时显示（「🗓️ 计划 日期 +N」）；`dueToday()`（今天有未完成的计划）→ 粉色边框 `.due-today`。
  卡片上的日期用 `nextArrangement()`（只算这一对，避免整班渲染时 O(n²)）。
- 时间看板 = `schedule()`：所有未完成的背诵计划（每条附该生当前状态和最近一次检查备注）。已逾期置顶，之后按日期分组。
  **默认显示全部未来安排**，可切 7/14/30 天。提醒角标/首页概览统计的也是计划。
- 总览矩阵（`overview.js`）：每格是一条按数量分段的色块——该生在该轮所有检查记录中 过关 / 需重新过关 / 未过关 的次数，
  按绿、黄、红从左到右、宽度按数量比例（`flex: n`）；中间数字 = 检查次数；没检查过 = 灰色空格；最右"过关"列按当前状态统计。

### 3.3 考试（`models/exams.js`）

- TXT 格式：每行 `姓名 成绩`；分隔符兼容半角/全角空格、Tab、逗号；姓名可含空格以外字符，成绩取最后一段。
- `parseTxt` 只做预览：matched / unknown（名单里没有）/ invalid（无法识别的行）/ duplicates（以最后一行为准）。确认后才 `setScores`。
- 读取 TXT 文件时 UTF-8 解码出现替换字符则回退 GB18030（兼容 Windows 记事本 ANSI）。
- 导出：按学号顺序，无成绩的学生不输出。文件名 `日期_考试名.txt`。
- 统计只算当前在册学生；名次并列同分同名次（1,2,2,4）；及格线 = 满分 × `settings.passPercent`%。
- 学生看板默认用**得分率**作图（不同满分的考试可比），可切原始分。

## 四、模块与文件清单

```
index.html                         页面骨架 + 四个页面容器 + <script> 依赖顺序
manifest.json                      PWA 元数据（固定 id "teaching-panel"；192/512 any + 512 maskable 三条 icons）
service-worker.js                  全部资源 cache-first；/deploy-tag.json 永远走网络
version.json                       semver + changelog（只用于更新弹窗展示，不参与判重）
wrangler.jsonc / .assetsignore     Cloudflare Workers 静态资源部署配置
Handbook/index.html                终端用户使用说明（独立单文件，自带样式）
.claude/settings.json + hooks/     PostToolUse 提醒 hook（改源码后提醒 bump 版本、同步 Handbook）

styles/base.css                    CSS 变量（主色 #ff8a3d）、按钮/表单/弹窗/toast、z-index 层叠表注释
styles/navbar.css                  导航栏、班级切换器、提醒角标
styles/layout.css                  页头/二级标签、左右分栏、工具栏、表格、统计块
styles/board.css                   学生色块卡片、状态按钮、分段条、矩阵表、欠交清单、成绩录入/导入预览
styles/settings.css                主页布局
styles/recitation.css              计划日期 chips、计划背诵子标签、时间看板
styles/charts.css                  SVG 图表
styles/profile.css                 学生档案抽屉
styles/quickPhrases.css            快捷词按钮条与编辑卡片
styles/dayPicker.css               日期块选择器
styles/onedrive.css / update.css   云备份面板 / 更新弹窗
styles/responsive.css              所有断点（1000px 单栏、720px 移动端）

scripts/utils.js                   Utils：escapeHtml、uid、日期工具、学号排序、下载、localStorage 兜底
scripts/state.js                   AppState：持久化/订阅/迁移/校验 + 班级/学生/设置/快捷词
scripts/models/homework.js         HomeworkModel
scripts/models/recitation.js       RecitationModel
scripts/models/exams.js            ExamModel
scripts/components/toast.js        Toast（含 Toast.action：带「撤销」等按钮的提示）
scripts/components/modal.js        Modal.confirm / Modal.open（表单弹窗）/ Modal.prompt
scripts/components/ui.js           UI：二级标签栏、学生链接、图例、统计块
scripts/components/quickPhrases.js QuickPhrases：弹窗内快捷词按钮条（点击追加到 comment）+ 主页编辑卡片
scripts/components/dayPicker.js    DayPicker：本周/下周日期块（单选/多选）+ 日历框兜底
scripts/components/svgChart.js     SvgChart.line / bars（手写 SVG）
scripts/components/classSwitcher.js 班级切换器（导航栏常驻）
scripts/components/studentProfile.js 学生档案抽屉（全局 data-profile-id 委托）
scripts/navigation.js              页面切换
scripts/reminders.js               背诵计划角标 / 每日一次提醒 / 系统通知
scripts/updateChecker.js           部署指纹判重 + 更新弹窗
scripts/dbFile.js                  DbFile：state ↔ .db（SQLite）互转，表结构映射 TABLES；按需加载 sql.js
scripts/importExport.js            本地导入导出 .db（下载 / 读取文件 → AppState.replaceState）
scripts/vendor/sql-wasm.{js,wasm}  sql.js 1.10.3（SQLite 的 WebAssembly 版，MIT，见 sql.js-LICENSE）；离线可用，SW 预缓存
scripts/persistence.js             navigator.storage.persist
scripts/pwaInstall.js              安装到桌面
scripts/onedrive/msalAuth.js       OneDrive 登录态（Client ID 在此配置）
scripts/onedrive/onedriveApi.js    Graph API + 备份面板 + quickUpload
scripts/pages/settings.js          主页
scripts/pages/roster.js            学生名单卡片
scripts/pages/homework/*.js        statusPicker（状态弹窗/作业表单/markFixed）/ homeworkPage（外壳+登记）/ matrix（总览+欠交）/ student
scripts/pages/recitation/*.js      checkDialog（检查弹窗/轮次表单）/ recitationPage（外壳+检查）/ planView（计划背诵子标签）/ overview（时间看板+总览）/ student
scripts/pages/exams/*.js           examDialogs / examsPage / examStudent
scripts/app.js                     启动入口（最后加载）
```

各学生趋势模块的 `summaryHtml()` 同时被学生档案复用——改其中 HTML 时注意档案面板里也会显示。

## 五、UI 约定

- 主色 `--primary-color: #ff8a3d` / `--primary-dark: #e06a1f`，同步在 `<meta name="theme-color">` 与 manifest。
- 开关型按钮统一 `.btn-toggle` + `.btn-toggle-on`（刷子模式、筛选、提醒开关）。
- 所有拼进 innerHTML 的用户文本必须 `Utils.escapeHtml`。
- 全局 document 监听只在模块顶层注册一次（班级切换器外部点击、学生档案委托）。
- `Modal.open` 同时只保留一个表单弹窗；`Modal.confirm` 的 Esc 用 capture 阶段，只关确认框本身。
- **z-index 表**（见 `styles/base.css` 顶部注释）：导航 1000 < 下拉 2000 < 表单弹窗 6000 < 学生档案 6500 < 云备份 7000 < 确认框 7500 < toast 9500 < 更新弹窗 9999。
- 表单字段取值用 `form.elements.xxx`，**不要用 `form.title`/`form.name`**——会命中 `<form>` 自身的同名属性。

## 六、更新检测（部署指纹）

- Cloudflare Workers Builds 的 Build command 生成 `/deploy-tag.json`（见 `wrangler.jsonc` 注释）。
- `UpdateChecker.check()`：拿不到指纹（本地开发/离线）直接跳过；首次访问只记录；指纹变化弹窗。
  弹窗三个出口：完成更新（记录+清缓存+刷新）/ 稍后再说（不记录，下次再问）/ 跳过此版本（记录不刷新）。
- `/deploy-tag.json` 用绝对路径是**故意的**（应用可能挂在子路径，指纹在宿主根目录）。
- 设置页"检查更新"传 `{force:true}`，拿不到指纹时 Toast 报错，不会静默无反应。
- SW 预缓存和兜底请求都 `cache:'no-store'`；注册带 `updateViaCache:'none'`。

### PWA 独立性（不和同域名下的其他应用冲突）

浏览器按**源**（协议+主机+端口）隔离存储和 Service Worker，同一个源里再按 manifest `id` 区分应用。
本应用可能和别的 PWA 部署在同一个域名下（挂子路径），本地调试时也可能和别的项目共用 `localhost:端口`，所以：

- manifest `id` 固定为 `"teaching-panel"`（不再用 `./index.html`：别的应用如果也写 `./index.html` 并部署在同一路径，浏览器会当成同一个应用，安装时互相覆盖）。
  **不要再改 `id`**，改了之后已安装的用户会被当成另一个应用，需要卸载重装。
- SW 注册显式 `scope:'./'`，只接管本应用目录。
- 缓存名统一 `teaching-panel-` 前缀（`service-worker.js` 与 `updateChecker.js` 各有一份 `CACHE_PREFIX`，要同步）。
  SW activate、`CLEAR_CACHE`、更新弹窗的清缓存**只删这个前缀的缓存**，不能 `caches.keys()` 全删，否则会清掉别的应用的离线缓存。
- localStorage 键统一 `teachingPanel.` 前缀，IndexedDB 库名 `teaching-panel-db`，新增存储键也要带前缀。
- 本地调试用专用端口 8791。如果某个端口以前跑过别的 PWA，它的 SW 会一直接管这个端口，表现为打开的是别的应用或旧文件。
  这时在 DevTools → Application → Storage 里点 Clear site data，或者换个端口。

## 七、OneDrive 云备份（单向快照）

1. 在 Azure Portal → 应用注册 → 新注册，账户类型选"个人 Microsoft 帐户"。
2. 平台选 **单页应用程序 (SPA)**，重定向 URI 填生产域名（如 `https://xxx.workers.dev/`）以及本地调试用的 `http://localhost:<端口>/`。
3. API 权限添加 Microsoft Graph 委托权限 `Files.ReadWrite.AppFolder`。
4. 把"应用程序(客户端) ID"填进 `scripts/onedrive/msalAuth.js` 的 `MSAL_CLIENT_ID`。

未填写时 `MsalAuth.isConfigured()` 为 false：不加载 MSAL，备份面板显示配置提示。
备份路径：`/me/drive/special/approot:/TeachingPanel/<时间戳>.db`（与本地导出同一种 .db，历史列表只显示 .db）。
只"上传新快照 / 选一份覆盖本地"，不做双向同步。

## 七-B、导入导出：SQLite 数据库文件（.db）

1.8.0 起导入导出从 JSON 改为 .db（用户要求"导入导出都是数据库直接来"）。**浏览器内部存储不变**：IndexedDB 里仍是整份 state 一条记录；
只有导出 / 导入 / OneDrive 备份恢复走 .db。

- `DbFile.exportBytes(AppState.exportSnapshot())` → `Uint8Array`；`DbFile.importBytes(bytes)` → 与 exportSnapshot 同结构的对象 → `AppState.replaceState()`
  （所以旧版本迁移 `normalize/migrate` 照常生效）。sql.js 首次使用时才加载（`DbFile.load()`），约 700 KB。
- 表结构（日期 TEXT `YYYY-MM-DD`，时间戳 INTEGER 毫秒）：
  ```
  meta(key, value)                 app / schemaVersion / exportedAt / activeClassId / quickPhraseKinds / extra:<未知顶层字段>（value 为 JSON）
  settings(key, value)             reminderNotify、passPercent 等（value 为 JSON）
  quick_phrases(kind, position, text)
  classes(id, name, extra)
  students(id, class_id, student_no, name, note, extra)
  homework(id, class_id, date, title, note, created_at, extra)
  homework_records(homework_id, student_id, status, comment, made_up_at, extra)
  rec_rounds(id, class_id, title, content, archived, created_at, extra)
  rec_checks(id, round_id, student_id, date, result, note, created_at, extra)
  rec_check_dates(check_id, position, date)      旧版本（schema ≤ 3）的复查日期；新导出为空表，导入旧 .db 时会迁移成计划
  rec_plans(id, round_id, student_id, date, created_at, extra)
  exams(id, class_id, name, date, full_score, created_at, extra)
  exam_scores(exam_id, student_id, score)
  ```
- **全量保证**：固定列之外的字段一律写进该行 `extra`（JSON），未知顶层字段写进 `meta` 的 `extra:*`，所以以后加字段不需要改表结构也不会丢；
  `undefined` 字段存 NULL 读回时省略，`null` 值记进 extra 读回还原。快捷词分组名单独记在 meta（删空的分组导入后仍为空）。
  **加新集合时**：在 `TABLES` 里加一项（或接受它先落进 meta extra），并在 PROJECT.md 这里补表结构。
- 导入校验：SQLite 文件头 → 有 `meta` 表且 `app = TeachingPanel` → 必需表齐全 → `schemaVersion` 不高于当前（更高则提示先更新页面）。
  任一不通过都抛出中文错误、当前数据不变。旧的 .json 备份不再能通过界面导入。

## 八、已知限制 / 可扩展点

- **提醒只在应用打开时触发**：纯静态站点没有推送服务器，无法在应用关闭时推送。若要做，需要后端 + Web Push。
- 数据只在单个浏览器；多设备需靠导出导入或 OneDrive 恢复（覆盖式，不合并）。
- 删除学生是硬删除（连带记录）；如需"转班/休学但保留记录"，可加 `archived` 字段并在 `getStudents()` 过滤。
- 作业目前没有"截止日期/请假免做"状态；若加"请假"建议新增一个不计入完成率的状态，而不是复用 done。
- 无撤销功能；破坏性操作都有二次确认。
