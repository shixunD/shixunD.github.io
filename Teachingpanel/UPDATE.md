# 更新记录

**每次发版本必须在这里加一条新记录**（最新的在最上面），格式：`## {semver} — {日期}`。
`version.json` 的 `semver` 必须始终等于本文件最新一条记录的版本号，并在其 `changelog` 数组最前面插入同版本条目。

## 1.15.0 — 2026-11-02

- 新增：摄像头选择。`components/cameraPicker.js`（`CameraPicker`）：`Photos.openCamera` 开流前先 `CameraPicker.choose()` 扫描摄像头并与 localStorage `teachingPanel.cameras`（按名称记的有序名单）对比，无新摄像头用名单里最靠前且已连接的，有新的弹选择框（可勾选设为默认，取消则不开相机）；相机内「切换」改为在已连接摄像头间轮换（原 facingMode 前后置切换去掉）
- 新增：主页「📷 默认摄像头」卡片——扫描、拖动排序、移除；`styles/photos.css` 追加样式；`index.html` / `service-worker.js` / PROJECT.md / Handbook 同步

## 1.14.1 — 2026-11-01

- 配置：OneDrive 云备份启用。`msalAuth.js` 的 `MSAL_CLIENT_ID` 填入已注册的 Azure 应用 `de868c53-0d3c-4da7-b422-cdbc5f205cbc`（个人账户 / SPA / `Files.ReadWrite.AppFolder`），`isConfigured()` 变为 true，备份面板不再显示「尚未配置」；PROJECT.md 第七节补充重定向 URI 规则，Handbook 数据备份说明同步

## 1.14.0 — 2026-11-01

- 变更：导航第五项由「其他」改为「🗂️ 其它」（`#trend-page`，`TrendPage`，`pages/trend/trendPage.js`），页面内容就是「🗂️ 其他情况」（`OtherRecords`，原 1.13.0 的学情记录，`pages/trend/otherRecords.js`）。作业/背诵/考试页下原有的「📈 学生趋势」子标签保留；`StudentTrend.KINDS` 增加 `other`（导航页），点作业/背诵/考试趋势按钮仍走各页的 `openTab('student')`，点「其他情况」走 `Navigation.goTo('trend')`；`styles/other.css` 并入 `trend.css`
- 新增：照片。`Photos` 组件（`components/photos.js`，`styles/photos.css`）：弹窗内「📷 拍照 / 🖼️ 上传」编辑块（`capture=environment` + 普通文件选择，canvas 压缩到最长边 1600px、JPEG 0.8）、记录里的缩略图（全局 `MutationObserver` 自动补 `<img data-photo>` 的 src）、点击放大（`.photo-lightbox`，z-index 8000）
- 新增：记录字段 `photoIds?: string[]`，用在作业 `records[studentId]`、`recChecks`、`remarks`；照片本体在 IndexedDB 新的 `photos` 存储（`DB_VERSION` 1→2，`AppState.photoPut/photoGet/photoList/gcPhotos`）。可选字段，`SCHEMA_VERSION` 不变。作业记录改回「完全完成」时只有无 comment 且无照片才删除记录
- 新增：`AppState.gcPhotos()` 在每次 `_commit` 之后清理无人引用的照片（不满 1 分钟的不动，避免「先存照片、后提交记录」之间误删）
- 新增：.db 导出新增 `photos(id, mime, data BLOB, created_at)` 表；导入时没有这张表（旧备份）视为无照片，`replaceState` 整体替换照片（`data._photos`）。`exportBytes` 内部自己读取照片
- 变更：「其他情况」分成左右两栏（`.other-split`）：左边新增记录（表单），右边「以前的记录」（`.other-right` 自带滚动，该生全部记录，可编辑/删除），写新记录时可对照；窄屏变单栏
- 新增：作业页侧栏的作业可拖动排序（`HomeworkModel.sideList()/moveHomework()`，`homework` 新增可选字段 `order`，无需迁移；无 order 的新作业排最前按日期新→旧，拖过之后全部重新编号）。`list()` 仍按日期，趋势统计不受影响；拖动逻辑抽成 `UI.bindSideDrag`，背诵轮次侧栏同用
- 变更：所有 `<input type="date">`（记录日期、考试日期、日历框等）点击输入框任意位置即弹出日历（`ui.js` 里全局 click 委托调用 `showPicker()`，不支持时静默忽略）
- 变更：其他情况记录卡片的「编辑 / 删除」改成右上角小号半透明灰色方角按钮（`.remark-btn`，圆角 3px），鼠标移到该条记录上才出现；触屏（`hover: none`）和键盘聚焦时常显
- 变更：照片编辑块里点缩略图右上角「✕」先 `Modal.confirm` 确认，确认后弹 `Toast.action`「撤销」（放回原位）；新拍照片被移除后暂不释放 object URL，保存时统一释放
- 修复：「📷 拍照」在电脑上只弹文件选择框。现在手机/平板（`pointer: coarse`）仍用 `capture` 调系统相机，电脑改用 `getUserMedia` 页内相机（`Photos` 的 `openCamera`，连拍 + 切换摄像头，失败退回选文件）
- 变更：考试页「📈 学生看板」标签改名「📈 学生趋势」，与作业、背诵页一致
- 变更：其他情况的记录内容和照片至少要有一样；背诵检查弹窗的照片块随「备注」一起，选了检查结果才显示

## 1.13.0 — 2026-11-01

- 变更：「其他」页左侧名单改为三列（`.other-stu-grid` 三等分，侧栏 330px），小块收紧到能宽松放下四字姓名
- 新增：第五个主页面「其他」（`#other-page`，`OtherPage`，`scripts/pages/other/otherPage.js`，样式 `styles/other.css`）：左侧 `.other-stu-grid` 两列学号+姓名名单（带记录条数角标），右侧选中学生的记录：新增表单（日期默认今天 + 内容）、列表（日期倒序）、编辑弹窗（日期 + 内容）、删除确认
- 新增：数据集合 `remarks[] { id, studentId, date, text, createdAt }`，业务模型 `RemarkModel`（`scripts/models/remarks.js`）；`SCHEMA_VERSION` 4 → 5（`migrate()` 无需转换，`normalize()` 补空数组）；删除学生 / 删除班级级联删除其记录
- 新增：`dbFile.js` 的 `TABLES` 加 `remarks` 表；该表列入 `OPTIONAL_TABLES`，旧版本导出的 .db 没有它也能导入（视为空）
- 变更：`Navigation.PAGES` 加 `other`；`app.js` 的 `renderCurrentPage`、`index.html`、`service-worker.js` 的 `URLS_TO_CACHE` 同步；PROJECT.md、Handbook 已更新

## 1.12.1 — 2026-10-31

- 变更：作业登记页学生卡片的 `.stu-card-fix`（「补」）点击时调用 `HomeworkDialogs.markFixed(..., { confirm: true })`，先 `Modal.confirm` 再执行（与矩阵页「已补上」一致）；"补上"画笔模式仍不确认

## 1.12.0 — 2026-10-31

- 新增：背诵检查结果 `cond`「有条件过关」（`#b9e8b0` 浅绿，排在 `pass` 后），`isPassed()` 与 `roundSummary().passed` 均计入；筛选、总览分段/图例、趋势统计同步
- 变更：`RecitationModel.PLAN`（已计划）颜色改为浅天蓝 `#bfe3f7`，计划视图选中态/计划人员胶囊同步；Handbook、PROJECT.md 已更新
- 新增：轮次侧栏拖动排序（HTML5 DnD，`RecitationModel.moveRound`）。`recRounds` 新增可选字段 `order`，无 order 的新轮次排最前（按创建时间），拖过之后全部重新编号；可选字段无需迁移，SCHEMA_VERSION 不变
- 变更：`studentCard` 每个未完成计划日期各占一行（去掉 `+N`），逾期的单行标红；卡片靠 grid 默认拉伸，同行等高
- 变更：`studentCard` 计划行文案缩短为 `🗓️ MM-DD(星期X)`（只去掉「计划」，星期保持全称，不缩写成「周X」），避免窄卡片放不下
- 变更：`openCheck` 默认 `result='pass'`、`planOn=true`（取代上一条"选了结果才出现日期"的初始隐藏，显隐逻辑本身不变）
- 变更：`openCheck` 的 `planDates` 初始 = `pendingPlans()` 的日期（`existingDates`）；保存时按差集处理：新选的 `addPlans`，取消的从 `recPlans` 删除，仅在「计划背诵」打开时生效
- 变更：`DayPicker` 新增 `textColor` 选项和 `setColor(color, text)` 方法（CSS 变量 `--dp-text`）；计划日期选择器用 `PLAN` 颜色（原来是写死的绿 `#2e9e48`），检查日期选择器在选结果时跟随 `RESULT_MAP[result]` 颜色
- 变更：`openCheck` 的 `[data-date-row]` / `[data-note-wrap]` 仅在已选检查结果时显示（原来只在"只选计划"时隐藏）
- 变更：`DayPicker` 新增 `dimFuture`；检查日期选择器（`check` / `editCheck`）由 `max: today` 改为 `dimFuture: true`
- 变更：检查登记弹窗的计划日期选择器（`checkDialog.js`）也由 `min: today` 改为 `dimPast: true`
- 变更：`studentCard` 逾期计划去掉 `⚠ ` 前缀，改用 `.stu-card-plan.overdue`（红色）；`.stu-card-plan` 加 `overflow:hidden; text-overflow:ellipsis` 防止超出卡片
- 变更：`studentCard` 重做——底色取 `progressOf().status` 的颜色；若最晚的未完成计划日期晚于最新检查日期（或没有检查）则用 `PLAN` 天蓝（已过关的也一样）；删除 `.stu-card-status` 行；日期每行一个（检查：`.stu-dot` 结果色圆点 + 💬；计划：🗓️，逾期红），按日期升序
- 变更：`openCheck` 的 `checkDate` 默认 `null`（不再是今天），`DayPicker.bind` 新增 `allowClear`（单选再点取消）；只有「选了结果且选了日期」才 `addCheck`，否则只处理计划；保存按钮/提示相应调整
- 变更：`.dp-day.is-today` 统一 `2px solid #8a8f98` 灰色粗边框（含选中、悬停时），不再用 `--dp-color`
- 变更：卡片日期行的圆点 / 🗓️ 统一放进 `.dl-mark`（固定 1.4em 宽，圆点放大到 0.95em），日期文字左对齐
- 规则：`addCheck` 同一学生/轮次/日期已有检查时改写原记录（不新增，`createdAt` 刷新）；`updateCheck` 改到已有记录的日期时替换掉那条；不迁移已有数据（历史里已存在的同日多条保持原样）；检查弹窗加 `[data-replace-hint]` 提示
- 修复：`isPlanDone()` 对已过去的计划日期，那天本身（`c.date === plan.date`）有检查就算完成，不再要求检查晚于计划创建（否则补录历史计划会被误判逾期）；今天/未来的计划规则不变
- 变更：计划视图名字卡左侧色条 `<i>`：有未完成计划且未过关（`!isPassed`）时用 `PLAN.accent`（`#5bb8ec` 天蓝），否则状态色；去掉 `.has-plan` 及整卡填色、光晕；`.selected` 只保留蓝边+粗体；日期列表 `.d-today` 加粗、`.d-overdue`（过去且未完成）标红，不再按选中日加粗
- 变更：`DayPicker` 新增 `dimPast` 选项（过去日期变灰但可点）；计划视图不再用 `min: today` 禁用过去日期，已完成计划的名字卡/列表也可点击或 ✕ 取消

## 1.11.3 — 2026-10-30

- 变更：`DayPicker` 日期块第二行只显示 `MM-DD`，去掉 `(星期X)` 和 `.dp-wd` 样式，字号 0.62rem → 0.7rem

## 1.11.2 — 2026-10-30

- 新增：作业登记弹窗（`openStatus`）标题姓名可点击跳转学生趋势；背诵检查弹窗同逻辑抽成 `StudentTrend.linkDialogTitle()`

## 1.11.1 — 2026-10-30

- 新增：背诵检查弹窗（`openCheck`）标题姓名改为 `.student-link`，点击关闭弹窗并 `StudentTrend.open(id)`

## 1.11.0 — 2026-10-30

- 变更：删除学生档案抽屉（`studentProfile.js`、`profile.css`）；`data-profile-id` 点击改为跳到该生「学生趋势」页（新 `StudentTrend`，`studentTrend.js` / `trend.css`）
- 新增：三类学生趋势页顶部 `StudentTrend.pickerHtml()`：作业/背诵/考试趋势快速切换 + 全班「学号 姓名」小块，选中学生三类共享；`UI.studentOptions` 删除
- 变更：背诵学生趋势检查历史改为时间线 `.check-timeline`，评语 `.check-comment` 色条气泡

## 1.10.0 — 2026-10-29

- 新增：背诵结果「超额完成」`excel`（深绿 #0b5c2a），算作过关；新增 `RecitationModel.isPassed()`，`roundSummary()` 增加 `excel` / `passed`
- 变更：检查弹窗结果按钮 5 列，编辑记录弹窗 4 列；筛选、图例、总览色块、过关率/过关数都纳入超额完成

## 1.9.3 — 2026-10-29

- 变更：manifest `start_url` 由 `./index.html` 改为 `./`；Handbook「返回应用」链接同样去掉 `index.html`

## 1.9.2 — 2026-10-29

- 变更：计划背诵子标签的学生卡片，状态色圆点改为卡片最左侧 4px 竖线（`.plan-stu i` 绝对定位）

## 1.9.1 — 2026-10-29

- 修复：PWA 和同域名下其他应用冲突。manifest `id` 改为固定的 `teaching-panel`（之前安装过的需卸载重装一次）
- 修复：SW activate / `CLEAR_CACHE` / 更新弹窗只清 `teaching-panel-` 前缀的缓存，不再清掉同源其他应用的缓存
- 变更：SW 注册显式 `scope:'./'`；本地调试端口改为 8791

## 1.9.0 — 2026-10-29

- 变更：背诵「需重新过关 / 未过关」与复查日期脱钩，只是状态；状态 = 最新检查结果（取消 1.4.0 的 N 次过关规则）
- 迁移：schema v3 → v4，检查记录上的 `nextDates` 转成 `recPlans`（旧 .db 的 `rec_check_dates` 导入时同样迁移）
- 变更：检查弹窗选需重新过关/未过关时自动展开计划背诵（日期可选）；时间看板/提醒/粉框只看计划
- 新增：背诵总览格子按 过关/需重新过关/未过关 次数比例分段（绿黄红）
- 变更：时间看板图标 📅 → ⏰

## 1.8.0 — 2026-10-29

- 变更：导入导出与 OneDrive 备份从 JSON 改为 SQLite .db 文件（`scripts/dbFile.js` + vendored sql.js 1.10.3），按表存放，含 `extra` 列保证全量
- 新增：导入校验（文件头 / app / 必需表 / schemaVersion 不高于当前），失败不改动数据；离线可用（SW 预缓存 sql.js）
- 注意：界面不再接受旧的 .json 备份

## 1.7.1 — 2026-10-29

- 变更：学生档案默认标签跟随来源页面（作业/背诵/考试），主页进入沿用上次

## 1.7.0 — 2026-10-29

- 新增：背诵检查记录编辑（`RecitationModel.updateCheck` + `RecitationDialogs.openEditCheck`）
- 变更：背诵子标签「所有轮次」改名「总览」；计划背诵相关图标 📅 → 🗓️（📅 只用于时间看板）

## 1.6.1 — 2026-10-29

- 变更：背诵计划日期选择改为 7 天 × 2 周（计划子标签 + 检查弹窗），计划子标签默认选中今天
- 变更：计划子标签的学生块始终列出该生本轮全部计划日期（`plan-stu-dates`）

## 1.6.0 — 2026-10-29

- 新增：背诵「📅 计划背诵」子标签（`pages/recitation/planView.js`）；选中日期后当天要检查的学生标绿，点学生即增删计划；本轮计划按日期列表
- 新增：`DayPicker` 的 `marked` 选项（日期块下方小字，如"2人"）
- 移除：批量计划弹窗（`RecitationDialogs.openPlan`）和时间看板里的计划按钮

## 1.5.0 — 2026-10-29

- 变更：背诵计划与检查状态解耦——`addCheck` 不再删除计划；新增 `isPlanDone/pendingPlans`（安排后登记的、日期 ≥ 计划日的检查使计划完成，保留记录）
- 新增：计划背诵多选日期（检查弹窗 + 批量弹窗）；检查弹窗「📅 计划背诵」改为独立开关，可与检查结果一起保存；结果按钮可再点取消
- 变更：学生卡片同时显示状态（圆点）和计划日期（+N）
- 新增：新建/编辑作业日期使用 `DayPicker`（本周/下周 14 天）
- 变更：作业状态 `missing_fixed`/`poor_fixed` 显示名改为「已补交」「已补改」

## 1.4.0 — 2026-10-29

- 变更：背诵状态改由 `RecitationModel.progressOf()` 计算——N 个复查日期需累计 N 个过关日才算过关（同日优先抵扣，否则抵最早未完成的；同一天只算一次）
- 新增：卡片「复查 已过x/N」、检查弹窗进度提示、过关后提示还需几次；时间看板/提醒/粉框只看未完成的复查日期

## 1.3.0 — 2026-10-29

- 新增：`DayPicker` 日期块组件（本周/下周日期块 + 日历框兜底）
- 变更：背诵检查日期改为日期块（单选，默认今天，不能选未来）；复查日期改为日期块多选（替换原「明天/后天/3 天后…」按钮）；计划日期改用同一组件
- 移除：背诵「⚡ 点击即过关」

## 1.2.0 — 2026-10-29

- 新增：背诵计划（`recPlans`，schema v3）——检查弹窗第 4 个选项「📅 计划背诵」、轮次/时间看板的批量计划弹窗；日期快捷选择本周/下周 周一～五（标注具体日期）
- 新增：有计划的学生卡片浅绿色 + 计划日期；今天需要检查（计划或复查日期为今天）的卡片粉色边框
- 变更：时间看板默认显示全部未来安排，包含计划条目，可取消计划；提醒/概览统计包含计划
- 变更：所有日期统一显示为 `10-29(星期四)`（`Utils.formatDate`）

## 1.1.0 — 2026-10-29

- 移除：科目功能（作业/背诵/考试的科目选择、筛选、标签，主页科目卡片）；schema v1→v2 迁移删除 `subjects`/`subjectId`
- 新增：comment 快捷词（作业、背诵两套，主页卡片编辑；背诵预设 4 个），弹窗内点击追加
- 变更：欠交清单按作业分组；「已补上」二次确认 + 撤销（`Toast.action`）；登记页「补」也可撤销

## 1.0.0 — 2026-10-29

- 首个版本：多班级学生名单（学号排序、批量添加、姓名唯一）、科目管理
- 作业：5 种状态登记 + comment、刷子快速标记、一键补交、总览矩阵、欠交清单、学生趋势
- 背诵：轮次检查（过关/需重新过关/未过关）、多个复查日期、到期/逾期提醒、时间看板、轮次总览、学生趋势
- 考试：成绩录入、TXT 导入（预览校验）/导出、分数段分布、排名、学生成绩趋势
- 学生档案、JSON 全量导入导出、OneDrive 单向快照备份（需配置 Client ID）、PWA 安装、部署指纹更新检测
