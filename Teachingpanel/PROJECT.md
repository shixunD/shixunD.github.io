# 学情看板 TeachingPanel — 项目说明文档

> 面向后续接手这个项目的 AI 或开发者：不逐行读代码也能理解每个文件的职责、数据模型和"为什么这么做"。
> 工程规范沿用 webapp-dev-guide（LotteryMachine 项目的实战规范）。

## 一、这是什么

纯静态网页应用（HTML + CSS + 原生 JS，无框架、无构建工具），部署在 Cloudflare Workers 静态资源。
老师用来登记、追踪学生的**作业完成情况、背诵过关情况、考试成绩**。数据全部保存在浏览器 IndexedDB，
导入导出（以及 OneDrive 单向快照备份）用 **SQLite 数据库文件（.db）**，全量、按表存放。

五个主页面（`index.html` 里 `.page` + `.active` 切换显隐，不是路由）：

| 页面 | 容器 id | 模块 | 子视图 |
|---|---|---|---|
| 主页 | `home-page` | `SettingsPage` + `RosterSection` | 今日概览、学生名单、comment 快捷词、数据、设置、应用信息 |
| 作业 | `homework-page` | `HomeworkPage` | 登记 / 总览矩阵 / 欠交清单 / 学生趋势 |
| 背诵 | `recitation-page` | `RecitationPage` | 检查 / 计划背诵 / 时间看板 / 总览 / 学生趋势 |
| 考试 | `exams-page` | `ExamsPage` | 考试（列表+详情） / 学生趋势 |
| 其它 | `trend-page` | `TrendPage` | 默认就是「其他情况」（学情记录，可增改删，可带照片）；顶部作业/背诵/考试趋势按钮跳到对应页的学生趋势标签，四类共用一个学生选择器 |

另有跨页面的**学生趋势跳转**（`StudentTrend`）：任何带 `data-profile-id` 的元素（学生姓名）被点击，都会跳到该生的「学生趋势」（当前在作业/背诵/考试页就留在该页的学生趋势标签，其他地方沿用上次看的那类，`localStorage` 记 kind；kind 为 `other` 时去导航页「🗂️ 其它」）。
三类趋势页顶部共用 `StudentTrend.pickerHtml()`：作业/背诵/考试趋势快速切换 + 全班「学号 姓名」小块选择器，选中的学生在三类之间共享。

## 二、整体架构

```
index.html
  → styles/*.css
  → scripts/*.js（IIFE 模块，每个文件挂一个 window.Xxx；<script> 顺序 = 依赖顺序）
  → app.js 的 DOMContentLoaded → init()：
      1. 注册 service-worker.js（{scope:'./', updateViaCache:'none'}）
      2. AppState.load()（IndexedDB → 内存；首次运行建"默认班级"+语数英三科）
      3. Navigation.init()，渲染班级切换器，恢复上次打开的页面
      4. AppState.subscribe：数据变化 → 重绘当前页 + 班级切换器 + 背诵提醒角标
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
  schemaVersion: 5,
  classes:   [{ id, name }],
  activeClassId,
  students:  [{ id, classId, name, studentNo, note }],    // 姓名在同一班级内唯一（addStudent/updateStudent/bulkAdd 校验）
  homework:  [{ id, classId, date, title, note, createdAt,
                records: { [studentId]: { status, comment, madeUpAt? } } }],
  recRounds: [{ id, classId, title, content, createdAt, archived }],
  recChecks: [{ id, roundId, studentId, date, result, note, createdAt }],   // v4 起不带复查日期
  recPlans:  [{ id, roundId, studentId, date, createdAt }],   // 计划某天背诵（v3 新增）
  exams:     [{ id, classId, name, date, fullScore, createdAt, scores: { [studentId]: number } }],
  remarks:   [{ id, studentId, date, text, createdAt }],   // 「学生趋势 → 其他情况」的学情记录（v5 新增；photoIds? 见 3.5）
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
  （计划 `createdAt` = 原检查记录的 `createdAt`，同一学生同一轮同一天不重复）并删除 `nextDates`；v5（1.13.0）新增 `remarks`（无需转换，`normalize()` 补空数组）。删除学生/轮次/班级都会级联删除计划。
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
  result：`excel` 深绿（超额完成，1.10.0 新增）/ `pass` 绿 / `cond` 浅绿（有条件过关=勉强过，1.12.0 新增，同样算过关）/ `retry` 黄（需重新过关）/ `fail` 红（未过关）。
  超额完成 = 过关里做得好的，凡是"算不算过关"的地方（过关率、过关数、连续过关、把未过关的加入计划）都用 `RecitationModel.isPassed()` 判断，
  `roundSummary()` 另给 `passed = excel + pass + cond`。计划背诵标识色 1.12.0 起改为浅天蓝（`PLAN`）。
  作业侧栏同理：`HomeworkModel.sideList()` / `moveHomework()`，可选字段 `order`；`list()` 保持按日期（趋势统计依赖时间顺序），拖动逻辑共用 `UI.bindSideDrag`。
  轮次顺序：`rounds()` 无 `order` 的排最前（按创建时间新→旧），有 `order`（侧栏拖动后写入，`moveRound()`）的按升序跟在后面；`order` 是可选字段，无需迁移。新增结果值不需要迁移（result 本来就是自由文本字段）。
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
- 总览矩阵（`overview.js`）：每格是一条按数量分段的色块——该生在该轮所有检查记录中 超额完成 / 过关 / 需重新过关 / 未过关 的次数，
  按深绿、绿、黄、红从左到右、宽度按数量比例（`flex: n`）；中间数字 = 检查次数；没检查过 = 灰色空格；最右"过关"列按当前状态统计。

### 3.4 其他情况：学情记录（`models/remarks.js`）

- `remarks` 一条 = 对某学生的一次记录：`date`（记录日期，可改，界面用 `Utils.formatDate`）+ `text`（纯文本，显示时 `white-space: pre-wrap` 保留换行）。关联用 `studentId`，没有 classId（班级由学生决定）。
- `RemarkModel.listFor(studentId)` 日期新→旧；`add/update/remove`；内容不能为空。删除学生、删除班级会级联删除记录。
- 视图 `OtherRecords`（导航页「🗂️ 其它」的全部内容）：选中学生由 `StudentTrend` 共享；新增表单是页内 `<form>`，提交后整页重绘（输入内容随之清空），编辑走 `Modal.open`。内容和照片至少要有一样。

### 3.5 照片（`components/photos.js`）

- 作业登记（`records[studentId].photoIds`）、背诵检查（`recChecks[].photoIds`，含编辑检查）、学情记录（`remarks[].photoIds`）都可带照片；记录里只存 id 数组（可选字段，无需升 schema）。
- 照片本体在 IndexedDB 的 `photos` 存储（`state.js`，key = 照片 id，value = `{blob, createdAt}`），**不进 state 整份存储**，否则每次提交都要重写所有照片。保存前 canvas 压缩：按画质挡位 `Photos.PRESETS`（省空间 1600px/0.3MB、标准 2000px/0.6MB、清晰 2400px/1MB 默认、超清 3200px/2MB；localStorage `teachingPanel.photoQuality`，主页「⚙️ 设置 → 照片画质」选），先缩到挡位尺寸，质量从 0.9 起，超过体积上限就在 0.5–0.9 里二分找最高可用质量，降到底仍超再把尺寸 ×0.85 重试，保证每张不超过上限（简单的图本来就小，不会补大）。页内相机请求最高分辨率（ideal 3840×2160），按 `track.getCapabilities()` 提供：连续自动对焦、变焦滑块、点画面单次对焦，右上角显示实际分辨率；虚拟摄像头（Phone Link / DroidCam 等）通常不开放这些，没有就不显示。
- 「📷 拍照」按设备分两条路：主输入是触摸（`matchMedia('(pointer: coarse)')`，手机/平板）用 `<input capture=environment>` 拉起系统相机；电脑上 `capture` 无效（只会弹文件选择框），改用 `getUserMedia` 在页面里开摄像头预览（`openCamera`，z-index 8000，可连拍、切换前后置）。`getUserMedia` 要 https / localhost；无摄像头、被拒绝或非安全上下文时 Toast 提示并退回选文件。
- **手机拍照回传**（`components/phoneLink.js` 电脑端 + `phone.html` / `scripts/phone.js` 手机端 + `scripts/phoneConfig.js` 共用配置）：编辑块里「📱 手机拍」（仅电脑，`isTouchDevice()` 为假时显示）→ `PhoneLink.open(onPhoto)` 弹出二维码面板（z-index 8000），手机扫码打开 `phone.html#<配对码>`，用 `<input capture>` 调系统相机（对焦/变焦/画质全是系统相机的），照片经 PeerJS（WebRTC）直连传回电脑，每张走 `addFiles` → 画质挡位压缩。**配对码固定**：电脑端 localStorage `teachingPanel.phone.peerId`（`tp-` + 随机串），手机端 `teachingPanel.phone.target` 记住，之后电脑打开面板、手机打开页面即自动连，掉线自动重连，连续拍不用再扫码。PeerJS 公共牵线服务（0.peerjs.com）只交换连接信息，照片是点对点加密直连；`PEER_OPTIONS.iceServers` 里除 Google STUN / PeerJS TURN 外补了 miwifi、qq 两个国内 STUN（自己传 iceServers 会覆盖 PeerJS 默认值，所以默认的也要写）。PeerJS、二维码库按需加载，在 `scripts/vendor/`（`peerjs.min.js` 1.5.4 MIT、`qrcode.js` qrcode-generator 1.4.4 MIT）。手机端 >2.5MB 的原图先缩到最长边 3600px/JPEG 0.92 再传。本地调试（localhost）手机打不开二维码里的地址，需在线上使用。
- **照片格式（1.17.0 起 WebP）**：`encodeImage()` 优先 `image/webp`，第一次编码时探测——Safari（iPhone/iPad）的 canvas 编不出 WebP 会悄悄返回 PNG，此时整个页面改用 `image/jpeg`。依据是 `tools/compress-bench.html` 的实测：相同 SSIM 下 WebP 比浏览器 JPEG 小约 28%–51%，小字放大看无差别；MozJPEG（jSquash）相同 SSIM 下体积 −7%～+13% 且慢 10–40 倍，没采用。已有照片不转换，格式随 `blob.type` 存（IndexedDB / .db 的 `photos.mime`），新旧混用、导出导入都不受影响。
- **照片旋转**：编辑块缩略图左上角「↻」顺时针转 90°。待保存照片在 `pending` 里保留原图 `src` 和旋转次数 `rot`，每次旋转都是 `compress(src, rot)` 从原图重新压缩，转几次画质都不会变差；已保存的照片转完变成待保存的新照片（以存着的那张为原图，`rot = 1`，旧的由 `gcPhotos` 清理）。
- **摄像头选择**（`components/cameraPicker.js`，`CameraPicker`）：`openCamera` 开流前调 `CameraPicker.choose()`——`enumerateDevices` 扫描（名称 label 为空时先临时 `getUserMedia` 取权限再扫），与 localStorage `teachingPanel.cameras`（按**名称**记的有序名单，不进 .db，因为摄像头是每台电脑各自的）对比：没有新名称 → 用名单里排最前且已连接的；有新名称且共多于 1 个 → 弹选择框（z-index 8000，不用 `Modal.open`，否则会关掉下面的登记弹窗；勾选「设为默认」把所选移到名单最前），取消则不开相机。相机里的「切换」只在当前连接的摄像头间轮换，不改名单。主页「📷 默认摄像头」卡片：扫描、拖动排序（第一项 = 默认）、移除。同名摄像头只记一条。
- 弹窗用 `Photos.editorHtml()` + `Photos.bindEditor(body, 已有ids)`；保存时先 `await editor.finalize()` 拿到最终 `photoIds` 再提交记录。展示用 `Photos.viewHtml(ids)`（`<img data-photo>` 由全局 MutationObserver 补 src，点击放大）。
- 无人引用的照片由 `AppState.gcPhotos()` 在每次 `_commit` 后清理（存了不满 1 分钟的不动）。导入 .db = 整体替换，照片也以导入文件为准。

### 3.3 考试（`models/exams.js`）

- TXT 格式：每行 `姓名 成绩`；分隔符兼容半角/全角空格、Tab、逗号；姓名可含空格以外字符，成绩取最后一段。
- `parseTxt` 只做预览：matched / unknown（名单里没有）/ invalid（无法识别的行）/ duplicates（以最后一行为准）。确认后才 `setScores`。
- 读取 TXT 文件时 UTF-8 解码出现替换字符则回退 GB18030（兼容 Windows 记事本 ANSI）。
- 导出：按学号顺序，无成绩的学生不输出。文件名 `日期_考试名.txt`。
- 统计只算当前在册学生；名次并列同分同名次（1,2,2,4）；及格线 = 满分 × `settings.passPercent`%。
- 学生趋势默认用**得分率**作图（不同满分的考试可比），可切原始分。

## 四、模块与文件清单

```
index.html                         页面骨架 + 四个页面容器 + <script> 依赖顺序
manifest.json                      PWA 元数据（固定 id "teaching-panel"；192/512 any + 512 maskable 三条 icons）
service-worker.js                  全部资源 cache-first；/deploy-tag.json 永远走网络
version.json                       semver + changelog（只用于更新弹窗展示，不参与判重）
wrangler.jsonc / .assetsignore     Cloudflare Workers 静态资源部署配置
Handbook/index.html                终端用户使用说明（独立单文件，自带样式）
tools/sync-to-site.js              同步到个人站点仓库 + 路径大小写体检（不部署，已在 .assetsignore 排除）
tools/compress-bench.html          照片压缩方案对比（浏览器 JPEG / MozJPEG / WebP：相同 SSIM 下的体积、耗时、1:1 局部图；可拖入真实照片；不部署）
.claude/settings.json + hooks/     PostToolUse 提醒 hook（改源码后提醒 bump 版本、同步 Handbook）

styles/base.css                    CSS 变量（主色 #ff8a3d）、按钮/表单/弹窗/toast、z-index 层叠表注释
styles/navbar.css                  导航栏、班级切换器、提醒角标
styles/layout.css                  页头/二级标签、左右分栏、工具栏、表格、统计块
styles/board.css                   学生色块卡片、状态按钮、分段条、矩阵表、欠交清单、成绩录入/导入预览
styles/settings.css                主页布局
styles/recitation.css              计划日期 chips、计划背诵子标签、时间看板
styles/charts.css                  SVG 图表
styles/trend.css                   学生趋势选择器（类型切换 + 学生小块）、其他情况记录列表
styles/quickPhrases.css            快捷词按钮条与编辑卡片
styles/photos.css                  照片编辑块、缩略图、放大
styles/dayPicker.css               日期块选择器
styles/onedrive.css / update.css   云备份面板 / 更新弹窗
styles/responsive.css              所有断点（1000px 单栏、720px 移动端）

scripts/utils.js                   Utils：escapeHtml、uid、日期工具、学号排序、下载、localStorage 兜底
scripts/state.js                   AppState：持久化/订阅/迁移/校验 + 班级/学生/设置/快捷词
scripts/models/homework.js         HomeworkModel
scripts/models/recitation.js       RecitationModel
scripts/models/exams.js            ExamModel
scripts/models/remarks.js          RemarkModel（学生趋势「其他情况」的学情记录）
scripts/components/photos.js       Photos：拍照/上传编辑块、缩略图、点击放大
scripts/components/phoneLink.js    PhoneLink：电脑端「📱 手机拍」二维码面板 + PeerJS 接收
scripts/phoneConfig.js             手机拍照回传的共用配置（配对码键、ICE 服务器）
scripts/phone.js + phone.html      手机端拍照页（自动连电脑、队列发送）
scripts/components/cameraPicker.js CameraPicker：摄像头扫描/新设备选择框/默认顺序 + 主页卡片
scripts/components/toast.js        Toast（含 Toast.action：带「撤销」等按钮的提示）
scripts/components/modal.js        Modal.confirm / Modal.open（表单弹窗）/ Modal.prompt
scripts/components/ui.js           UI：二级标签栏、学生链接、图例、统计块
scripts/components/quickPhrases.js QuickPhrases：弹窗内快捷词按钮条（点击追加到 comment）+ 主页编辑卡片
scripts/components/dayPicker.js    DayPicker：本周/下周日期块（单选/多选）+ 日历框兜底
scripts/components/svgChart.js     SvgChart.line / bars（手写 SVG）
scripts/components/classSwitcher.js 班级切换器（导航栏常驻）
scripts/components/studentTrend.js  学生趋势共享：选中学生、小块选择器、类型切换（全局 data-profile-id 委托）
scripts/navigation.js              页面切换
scripts/reminders.js               背诵计划角标 / 每日一次提醒 / 系统通知
scripts/updateChecker.js           部署指纹判重 + 更新弹窗
scripts/dbFile.js                  DbFile：state ↔ .db（SQLite）互转，表结构映射 TABLES；按需加载 sql.js
scripts/importExport.js            本地导入导出 .db（下载 / 读取文件 → AppState.replaceState）
scripts/vendor/peerjs.min.js, qrcode.js  PeerJS 1.5.4 / qrcode-generator 1.4.4（均 MIT），手机拍照回传按需加载
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
scripts/pages/trend/*.js           trendPage（导航页「🗂️ 其它」外壳）/ otherRecords（其他情况）
scripts/app.js                     启动入口（最后加载）
```


## 五、UI 约定

- 主色 `--primary-color: #ff8a3d` / `--primary-dark: #e06a1f`，同步在 `<meta name="theme-color">` 与 manifest。
- 开关型按钮统一 `.btn-toggle` + `.btn-toggle-on`（刷子模式、筛选、提醒开关）。
- 所有拼进 innerHTML 的用户文本必须 `Utils.escapeHtml`。
- 全局 document 监听只在模块顶层注册一次（班级切换器外部点击、学生趋势跳转委托）。
- `Modal.open` 同时只保留一个表单弹窗；`Modal.confirm` 的 Esc 用 capture 阶段，只关确认框本身。
- **z-index 表**（见 `styles/base.css` 顶部注释）：导航 1000 < 下拉 2000 < 表单弹窗 6000 < 云备份 7000 < 确认框 7500 < toast 9500 < 更新弹窗 9999。
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
- manifest `start_url` 为 `./`（打开的是目录地址 `/Teachingpanel/`，不带 `index.html` 尾缀；SW 预缓存里有 `./`，离线也能打开）。
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
   **已注册**：Client ID `de868c53-0d3c-4da7-b422-cdbc5f205cbc`（1.14.1 起填入）。
   重定向 URI 必须和 `buildConfig()` 算出的值逐字一致：localhost 上是 `origin + '/'`（本地调试即 `http://localhost:8791/`），
   线上是页面所在目录（结尾带 `/`，如 `https://shixund.github.io/Teachingpanel/`，小写 p，Azure 比对路径区分大小写）。换部署域名/子路径时要回 Azure 补加，否则登录报 `AADSTS50011`。

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
  remarks(id, student_id, date, text, created_at, extra)   1.13.0 新增；旧 .db 没有这张表，导入时视为空
  photos(id, mime, data BLOB, created_at)                  1.14.0 新增；照片本体（记录的 photoIds 指向这里），旧 .db 没有则视为无照片
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
