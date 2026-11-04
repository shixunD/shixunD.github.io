# 更新记录

**每次发版本必须在这里加一条新记录**（最新的在最上面），格式：`## {semver} — {日期}`。
`version.json` 的 `semver` 必须始终等于本文件最新一条记录的版本号，并在其 `changelog` 数组最前面插入同版本条目。

## 1.27.3 — 2026-11-04

- 变更：分组夹 UI 重做（`ui.js` 里用内联 SVG 取代 📁 / ▸▾ / ✎ / ✕ 文本图标；`layout.css` 的 `.side-group*`：分组夹透明无边框，内容区缩进 + 浅橙色左竖线（`.side-group-body`）区分内外，标题行（数量胶囊在编辑 / 删除按钮右边），操作按钮悬停才显示）

## 1.27.2 — 2026-11-04

- 变更：1.27.1 把统计去掉 `margin-left: auto` 后不再靠右。现在图例项包进 `.seg-items`，`.seg-legend` 用 `justify-content: space-between`：一行放得下时统计在最右，放不下换行后它独占一行、靠左（作业页和背诵页都改）

## 1.27.1 — 2026-11-04

- 变更：`.seg-legend` 加 `margin-bottom: 1rem`（原来靠刷子栏的上边距隔开，删刷子栏后和学生卡片贴太近）；`.seg-rate` 去掉 `margin-left: auto` 改 `white-space: nowrap`，跟在图例后面，一行放不下时整体换行并靠左（删除 responsive.css 里对应的 `margin-left: 0`）

## 1.27.0 — 2026-11-04

- 新增：作业 / 背诵侧栏分组夹。新文件 `scripts/models/sideGroups.js`（`SideGroups`：layout / flatten / move / createGroup / updateGroup / removeGroup）；数据 `state.sideGroups` + 条目可选 `groupId` / `order`，`SCHEMA_VERSION` 5 → 6（`normalize()` 补空数组，删除班级级联删除分组夹）；`.db` 新增可选表 `side_groups`
- 变更：`UI.bindSideDrag` 换成 `UI.sideTreeHtml` + `UI.bindSideTree`（拖动排序、进出分组夹、折叠、重命名、删除）；`HomeworkModel.moveHomework` / `RecitationModel.moveRound` 换成 `moveSide` + `removeGroup`，新增 `sideLayout()` / `roundLayout()`；`rounds()` / `sideList()` 按侧栏显示顺序拍平
- 变更：背诵侧栏卡片第一行改为「任务名 + 过关统计」（`.side-item-row`，放不下时统计才换行）
- 实测：模型层移动 / 进出分组 / 删除分组、DOM 拖放事件、导出 → 导入 .db 后分组和折叠状态都保留

## 1.26.9 — 2026-11-04

- 变更：`homeworkPage.js` 统计行把按时完成率 / 补改完成率合并为一个 `.seg-rate` 并排显示，文案去掉「率」；删除 `board.css` 的 `.seg-rate-fixed`；删除登记页刷子栏（`BRUSHES` / `ui.brush` / `data-brush` 逻辑），点击学生卡片统一 `HomeworkDialogs.openStatus`；作业 / 背诵侧栏卡片的统计（`.side-item-sub`）挪进第一行 `.side-item-top` 日期右侧，`.side-item-date` / `.side-item-sub` 字号调小；背诵侧栏卡片的统计改回标题 / 进度条下面同一行（`.side-item-sub`），并移除背诵「归档」功能：去掉列表勾选框、详情页归档按钮、总览「包含已归档轮次」，`RecitationModel.rounds()` 不再按 `archived` 过滤（字段保留以兼容旧数据，旧的已归档轮次一律正常显示）

## 1.26.5 — 2026-11-04

- 变更：设置页「使用说明」链接 `./Handbook/index.html` → `./Handbook/`；`service-worker.js` 预缓存去掉 `./index.html`，`./Handbook/index.html` 改 `./Handbook/`，且 `response.redirected` 的响应不写入缓存（Cloudflare 会把 `/x/index.html` 301 到 `/x/`，缓存重定向响应回应导航会打不开）

## 1.26.4 — 2026-11-04

- 变更：`openCheck` 的 `checkDate` 初值改为今天，`result` 初值 null，挂载后 `loadCheckFor(checkDate)`：今天有记录就载入结果 / 备注 / 照片（取代 1.26.3「没检查过才留空」的判断）

## 1.26.3 — 2026-11-04

- 变更：`openCheck` 的 `result` 初值：状态为 `none`（没检查过）的学生为 null，其余仍默认 `pass`

## 1.26.2 — 2026-11-04

- 变更：`openCheck` 的检查日期块（`data-date-row`）不再随结果取消而隐藏；备注块仍只在选了结果时显示

## 1.26.1 — 2026-11-04

- 变更：`checkDialog.js` 三个备注 textarea（`data-note` / `data-plan-note` / `data-edit-note`）`rows` 2→5

## 1.26.0 — 2026-11-04

- 变更：`checkDialog.js` `openCheck` 重写：去掉 `data-plan-toggle` 和 `planOn`，计划日期选择器常驻；新增计划备注框（`planNotes` / `focusDate`），点检查日期自动载入当天已有的结果 / 备注 / 照片
- 新增：`recPlans[].note` 可选字段（`RecitationModel.addPlans` 第 4 个参数 notes、`setPlanNote`）；`Photos.bindEditor` 返回的对象加 `setKept(ids)`
- 变更：`student.js` 检查历史加入计划条目；时间轴块 `data-check-round` → `data-jump-round`，点击跳转并 `.flash-locate` 闪两次（`recitation.css`）

## 1.25.0 — 2026-11-04

- 变更：`phone.js` `RETRY_DELAY` 4000→1000ms；`phoneLink.js` 牵线服务重连、配对码被占用重试都改为 1 秒（占用重试次数 30→120，总时长仍约 2 分钟）
- 新增：`photos.js` 档位加 `q0.1`（0.001）、`q0.5`（0.005）和 `custom` 自定义档；自定义值存 localStorage `teachingPanel.photoCustomQuality`（默认 0.2），主页设置可改；预览框内输入框只改本次
- 变更：压缩预览框只自动算 `AUTO_KEYS`（custom、0.001、0.005、0.01、0.1、0.5），其余档位点击时才算（`encodeOne`）
- 新增：`homeworkPage.js` 登记页统计行加「补改完成率」= (按时 + 已补交 + 已补改) / 全班

## 1.24.5 — 2026-11-03

- 变更：`homeworkPage.js` 侧栏每个作业的统计行，「未按要求」前单独加一个粉红（`#f48fb1`）圆点，「未交」仍为红色圆点

## 1.24.4 — 2026-11-02

- 变更：`ExamStudent.summaryHtml` 的折线图和成绩表包进 `.exam-trend-split`（`charts.css`，两列 grid，≤720px 堆叠）；工具栏按钮顺序改为原始分在前；统计块「最近一次名次」改为「平均名次」（有名次的考试名次均值，保留 1 位小数）

## 1.24.3 — 2026-11-02

- 变更：`checkDialog.js` 的 `openCheck` 里删除检查记录（`data-rm-check`）/ 计划（`data-rm-plan`）后不再 `close()`，而是 `refreshLists()` 重绘 `[data-lists]` 和「当前状态」并重新绑定；删计划时同步更新 `existingDates` / `planDates` / 日期选择。已在 Chromium 实测删记录、删计划

## 1.24.2 — 2026-11-02

- 变更：`RecitationStudent.summaryHtml` 的「各轮次情况」表格换成 `.count-chips` 状态计数 + `.strip` 时间轴（旧 → 新，每轮次一格，`studentOverview` 本身就是旧→新）；原来表里的下一次安排 / 首次过关 / 用时移到悬停提示；原「检查」按钮改为点格子（`.strip-btn`，`data-check-round`）。删掉 `arrangementText`

## 1.24.1 — 2026-11-02

- 修复：`.modal-overlay`（`Modal.confirm`）z-index 7500 → 9000。`.phonelink-overlay` / `.camera-overlay` / `.photo-lightbox` 都是 8000，原来的确认框会被它们盖住（手机配对窗口「重新生成二维码」的确认框看不见）。同步 base.css 层叠表、PROJECT.md、modal.js 注释

## 1.24.0 — 2026-11-02

- 变更：学生趋势改为流模式单页。`TrendPage` 渲染固定的 `.trend-picker`（sticky，`min-height` 7.5rem）+ 四个 `.trend-sec`（作业 / 背诵 / 考试 / 其他情况），按钮 `scrollIntoView` 定位 + 滚动高亮；`HomeworkStudent` / `RecitationStudent` / `ExamStudent` / `OtherRecords` 的 `render(view)` 不再自带选择器；`StudentTrend.open(id, kind)` 改为跳导航页并定位。三个页面删掉「📈 学生趋势」子标签（已存的 `student` 标签值会回落到默认标签）；导航按钮「🗂️ 其它」改名「📈 学生趋势」
- 已在 Chromium 实测：固定、按钮定位、高亮、选学生；未测：手机窄屏下选择栏占高

## 1.23.4 — 2026-11-02

- 新增：`AppState.updateQuickPhrase(kind, index, text)`（空值 / 重复会拒绝）；`quickPhrases.js` 卡片每行加 `data-qp-edit` 按钮，行就地变输入框，取消时把原节点放回；删除改走 `Modal.confirm({danger:true})`。已在 Chromium 实测编辑 / 取消 / 保存 / 删除确认

## 1.23.3 — 2026-11-02

- 变更：`studentCard` 的 `.stu-card-status` 小云朵在有 comment **或** 有照片（`rec.photoIds.length`）时都显示；卡片 title 补充照片张数

## 1.23.2 — 2026-11-02

- 变更：`homeworkPage.js` 左侧列表 `.side-item-sub` 由「未补 · 已补」改为「`c.missing` 未交 · `c.poor` 未按要求」，不再统计已补的

## 1.23.1 — 2026-11-02

- 新增：`Photos.LEVELS` 增加 q1 / q3 / q5 / q8（WebP 质量 0.01 / 0.03 / 0.05 / 0.08，标签保留两位小数）。key 是新增的，已存的默认档设置不受影响

## 1.23.0 — 2026-11-02

- 修复：`.photo-lightbox-close` 加 `z-index: 2`，高于全高的左右切换区 `.photo-lightbox-nav`（z-index 1）
- 新增：`chooseLevel` 预览框支持旋转 / 拖边角裁剪（`rot` + `crop` 状态，`applyEdit()` 重算各档）和滚轮 / 拖动 / 双指缩放平移（`.photo-stage` transform）；编辑后「不压缩」档改按 0.92 重新编码。已在 Chromium 里实测裁剪、旋转、缩放、还原；触屏双指未实测

## 1.22.6 — 2026-11-02

- 修复：手机网页相机 `shoot()` 对 `takePhoto` 的结果校验比例——和 `camTrack.getSettings()` 的取景比例相差超过 3% 就弃用并改 `grabFrame()`（用户实测取景 3024×4032，电脑收到的却是 1840×3984，说明该手机 `takePhoto` 出的是被裁过的图）。日志记录两者尺寸。未实测，需要真机

## 1.22.5 — 2026-11-02

- 修复：`.photo-choose-view` 的 `flex: 1` + `max-height: 100%` 在父容器只有 max-height 时百分比高度不生效，竖图按宽度缩放后撑出预览区只露一段。改为预览区固定 `height: calc(96vh - 270px)`、`flex: none`，图片 `width/height: 100%` + `object-fit: contain`。实测（Chromium 1280×800，3024×4032 竖图）整张完整可见
- 附：用户的手机日志显示 1.22.4 的取景已是 3024×4032，`takePhoto` 出图 2.35 MB / 1.93 MB，拍摄尺寸本身正常；之前「很小的图片」是预览框显示问题

## 1.22.4 — 2026-11-02

- 变更：`photos.js` 的 `openCamera` 与 `phone.js` 的 `startCam` 先无分辨率约束打开摄像头，再读 `track.getCapabilities()` 的 `width.max` / `height.max` 用 `applyConstraints` 重新要求（取代 4096×3072 和 `aspectRatio` 4:3 的写死值）。`takePhoto` 仍同时传最大宽高。未实测

## 1.22.3 — 2026-11-02

- 修复：手机网页内相机（`phone.js` 的 `startCam` / `shoot`）出图过扁。`getUserMedia` 加 `aspectRatio: { ideal: 4/3 }`（不指定时有的手机选 21:9 的高分辨率取景模式）；`takePhoto` 同时传 `imageWidth` 和 `imageHeight` 最大值（原来只传宽度，出图比例跟随取景）。拍完在事件日志里记录这张的实际尺寸，方便排查
- 未实测：需要真机

## 1.22.2 — 2026-11-02

- 新增：大图 `openLightbox(items, start)` 支持同一缩略图容器（`.photo-thumbs`）内左右切换：边缘感应区 `.photo-lightbox-nav` 鼠标靠近才显示，触屏常显；键盘 ← →；每张各自带 rotator；切换时复位缩放
- 变更：页内相机只请求 `width: ideal 4096`，不再指定高度/比例（1.21.1 的 4096×3072 也可能让摄像头强制裁成 4:3）

## 1.22.1 — 2026-11-02

- 新增：压缩预览框图片下方的 `[data-info]` 行，显示当前档位压缩后的大小和占原图的百分比

## 1.22.0 — 2026-11-02

- 新增：收到照片后的压缩档位预览框（`photos.js` 的 `chooseLevel` / `chooseQueue`，样式 `.photo-choose-*`）：质量 0.1–1.0 每 0.1 一档 + 不压缩，各档大小实时显示，可 100% 放大，确定后只存所选那份、丢弃完整原图；连拍 / 多选 / 手机连传排队逐张预览，相机或手机接收面板开着时等关闭后再弹
- 变更：`PRESETS` / `getPreset` / `setPreset` 删除，换成 `LEVELS` / `getLevel` / `setLevel`；设置项改为「默认预览档位」（localStorage `teachingPanel.photoPreviewLevel`，默认 0.6；旧键 `teachingPanel.photoQuality` 不再使用）；不再按体积上限缩尺寸
- 变更：待保存照片的大图旋转改为直接转当前那份（原图已丢弃），旋转重新编码质量取 max(默认档, 0.6)，默认档不压缩时 0.92
- 未实测：浏览器内真实拍照 / 上传流程，仅做了语法检查

## 1.21.1 — 2026-11-02

- 修复：页内相机（`photos.js` 的 `openCamera`）`getUserMedia` 原请求 3840×2160（16:9），传感器是 4:3 的摄像头会被裁掉上下，横拍变扁（用户实测系统相机 3024×4032，浏览器相机传到电脑成 3200×1478）。改为请求 4096×3072（4:3）；同时 1478 说明取景帧本身已偏扁，若仍裁剪属摄像头/虚拟摄像头驱动只开放宽屏模式，右上角显示的实际分辨率可用来判断

## 1.21.0 — 2026-11-02

- 新增：`Modal.open` 关闭确认——内容快照（控件值 + HTML）有变化时，✕ / 遮罩 / Esc / 取消按钮先弹确认「继续编辑 / 放弃修改」；保存路径不受影响
- 变更：移除缩略图 `.photo-rot` 按钮；大图旋转直接写回照片（已保存：同 id `photoPut` 覆盖并刷新缓存与页面 `<img>`；新拍：`pendingRotators`），无数据结构变化。手机回传预览无旋转
- 修复：缩略图 `object-fit: cover` 裁掉非方形照片的边缘（浏览器相机拍的是完整画面，只是缩略图被裁），改为 `contain`

## 1.20.0 — 2026-11-02

- 新增：照片放大预览（`photos.js` 的 `openLightbox`）加「↺ 左转 / ↻ 右转 / 还原」按钮、滚轮缩放（0.2–10 倍）、按住左键拖动平移。仅是查看效果，不改动已保存的照片；点背景或按 Esc 关闭，拖动后不会误关

## 1.19.0 — 2026-11-02

- 新增：手机拍照页网页内相机（`phone.js` 的「网页内相机」一节，`phone.html` 的 `#camview`）：`getUserMedia` 全屏取景、连拍、「已拍 / 已传」计数；`ImageCapture.takePhoto` 全分辨率（2s / 5s 超时，失败后本次改截取画面）；连续对焦、变焦、点按单次对焦、前后切换；切后台关摄像头。主按钮「📷 拍照」改为它，不支持 getUserMedia 时隐藏并以系统相机为主按钮
- 修复：用户在狐猴浏览器上「选系统相机 → 拍完 → 什么都没发生」（照片没有交回网页）。系统相机改为备选「📱 用系统相机拍」；file 控件由 `hidden` 改为视觉隐藏 `.vh`
- 变更：照片标签文案以电脑回执为准：「发送中，等电脑确认… / 等电脑确认… Ns / ✓ 电脑已收到 / 没收到确认，等待重发 / 没发成功，点我重发」（回执与超时重发机制自 1.17.2 已有，此次只是说清楚）；标签字号缩小可换行
- 实测（本地，画布流模拟摄像头）：连拍 3 张均送达、计数正确；takePhoto 不可用 / 卡住时 5 秒内改截取画面；无摄像头权限时提示改用系统相机或相册；手机尺寸排版正常。真机未测

## 1.18.1 — 2026-11-02

- 修复：手机拍照页（`phone.html` / `/phone`、`scripts/phone.js`、`scripts/phoneConfig.js`、`scripts/vendor/peerjs.min.js`）改为网络优先（`service-worker.js` 的 `NETWORK_FIRST`），断网才用缓存。原先全部缓存优先，而拍照页不经过主页的更新检测、`service-worker.js` 多个版本未变不会重装，手机上一直运行第一次缓存的旧 `phone.js`，1.17.x / 1.18.0 的连接修复都没生效（用户反馈「拍照后显示重新连接、照片没传上去」）
- 变更：`CACHE_NAME` `teaching-panel-cache-v1` → `v2`，所有设备重装 SW 并清掉旧缓存
- 附：站点仓库提交 972f760 曾把 `Teachingpanel/scripts` 等目录记成删除导致线上 404，已由 32d930c 补回（站点仓库操作，与本仓库代码无关）
- 未能本地实测：内置浏览器窗口不支持注册 Service Worker，只做了语法检查与路由规则核对

## 1.18.0 — 2026-11-02

- 新增：照片画质挡位「画质优先」`best`（默认，`DEFAULT_PRESET`）：最长边 4096 以内不缩、WebP 质量 0.65（用户指定）、上限 4 MB。`PRESETS` 增加 `quality`（起始质量，无则 0.9）和 `desc`（设置下拉显示）；已手动选过挡位的浏览器保持原选择。实测模拟手机照片 4032×3024：干净 799 KB → 172 KB，带噪点 2554 KB → 266 KB（旧「清晰」2400×1800 分别为 203 / 408 KB），1:1 局部对比小字无差别
- 变更：`compress()` 每轮设置 `ctx.imageSmoothingQuality = 'high'`
- 修复：手机相机拍照传不上、相册可以——手机端牵线服务器断开（从相机回来时常见）不再 `peer.destroy()`（会连直连一起关掉），只后台重连牵线；`unavailable-id` 换新手机编号
- 变更：手机端常见格式 8 MB 以内原样发送（原 2.5 MB），超出或 HEIC 转 4096px JPEG 0.95（原 3600px / 0.92）
- 新增：手机页事件日志（`logEv`，最多 60 条）+「复制日志」；Handbook / PROJECT.md 同步
- 参考：分析了 rimage_gui（rimage.exe `-q 85 -f jpg --quantization 50`，MozJPEG、不缩分辨率），观感好的关键是不缩分辨率；颜色量化对照片易出色带，未采用

## 1.17.2 — 2026-11-02

- 修复：手机拍照回传「显示已连接、照片没传过去」。根因：点「拍照」后系统相机在前台，网页被挂起，回来时直连已失效但不触发 close，照片发进失效的连接、一直等回执。手机端新增心跳（4s ping / 12s 无消息重连）、回到页面与每张发送前 `ensureAlive()`、按大小计算的回执超时（20s + 1s/100KB），超时重连并自动重发（最多 3 次）；`reconnectNow()` 立即重连
- 新增：电脑端回 pong、`incoming` 时显示「正在接收照片（x MB）」、按照片编号去重（`seenIds` + `processing`）；`addFiles` 返回成功张数，读不了时抛错并回给手机（手机标「电脑读不了」+ 改相机格式提示）
- 新增：手机端 HEIC 等非常见格式先转 JPEG；sessionStorage 记录「刚去拍照」，拍照期间网页被关掉重开时提示用「从相册选」；发送中显示秒数
- 变更：电脑端 `unavailable-id` 重试由约 18 秒延长到 2 分钟并说明原因（实测意外关闭后旧连接约 1 分钟才释放）
- 实测（本地两页）：2.1 MB / 6.2 MB 照片正常；电脑无响应 15 秒时手机 3 秒内识别、恢复后自动重连发送；回执超时重发不重复；HEIC 回报原因；拍照期间页面重开提示

## 1.17.1 — 2026-11-02

- 修复：手机端原先在「电脑没开窗口」和「找到电脑但直连没打通」两种情况下都提示「电脑上还没打开」，误导排查。现在分三步提示：连不上牵线服务器 / 电脑不在线（`peer-unavailable`）/ 直连没打通（ICE failed 或超时，`CONNECT_TIMEOUT` 10s→20s）；电脑端面板对应新增「手机找到了这台电脑，正在打通直连」「直连没打通」状态
- 新增：`PhoneLinkConfig.watchConnection()`（ICE 状态 + 两边地址类型）、`TIPS_HTML`（换网络建议）、`isWeChat()`；两端「连接诊断」折叠区（含配对码末 4 位）；直连失败过后建议在重试期间常显并显示失败次数，连上才收起；手机端微信内置浏览器提示
- 变更：`iceServers` 去掉已解析不到的 PeerJS TURN（eu-0 / us-0.turn.peerjs.com），STUN 改为国内优先
- 实测（本地两页 + 改写 ICE 地址模拟打不通）：正常连接、电脑不在线、直连失败、恢复后自动连上四种情况的提示均符合预期

## 1.17.0 — 2026-11-02

- 变更：照片保存格式改为 WebP。`photos.js` 新增 `encodeImage()`：首次编码探测 `canvas.toBlob('image/webp')` 的实际 `type`，不是 WebP（Safari）就整页改用 JPEG；体积上限二分逻辑不变。依据 `tools/compress-bench.html` 实测：相同 SSIM 下 WebP 比浏览器 JPEG 小 28%–51%，MozJPEG（jSquash）−7%～+13% 且慢 10–40 倍，不采用
- 变更：旋转改为从原图重压缩：`pending` 项保存 `src`（原图）与 `rot`，`compress(file, rot)` 一次完成摆正、旋转、缩放、压缩；删除 `rotateCw`。已保存照片旋转以存着的 blob 为原图
- 新增：`tools/compress-bench.html`（压缩方案对比工具，不部署），PROJECT.md 文件清单同步
- 已有照片不转换；格式随 `blob.type` 存入 IndexedDB 和 .db `photos.mime`，导出导入实测正常

## 1.16.0 — 2026-11-02

- 新增：手机拍照回传。`components/phoneLink.js`（电脑端二维码面板）、`phone.html` + `scripts/phone.js`（手机端）、`scripts/phoneConfig.js`（共用配置），PeerJS 1.5.4 + qrcode-generator 1.4.4 放 `scripts/vendor/`，按需加载；固定配对码存 localStorage，手机记住后自动重连、连续拍；iceServers 补国内 STUN。`index.html` / `service-worker.js` / PROJECT.md / Handbook 同步
- 新增：缩略图「↻」顺时针旋转 90°（`rotateCw`，新拍照片直接替换，已保存照片转后作为新照片待保存）

## 1.15.2 — 2026-11-02

- 新增：照片画质挡位 `Photos.PRESETS/getPreset/setPreset`（localStorage `teachingPanel.photoQuality`，默认「清晰」），主页「⚙️ 设置」新增「照片画质」下拉
- 变更：`compress()` 由固定 2400px/0.85 改为自适应：缩到挡位最长边 → JPEG 0.9 → 超体积上限则在 0.5–0.9 二分找最高质量 → 仍超则尺寸 ×0.85 重试（最多 6 轮）。新拍照片缩略图 title 显示实际 KB

## 1.15.1 — 2026-11-02

- 变更：页内相机（`Photos.openCamera`）请求分辨率由 1920×1440 改为 ideal 3840×2160；按 `track.getCapabilities()` 启用 `focusMode: continuous`、`zoom` 滑块（右侧）、点画面 `single-shot` 对焦，右上角显示实际分辨率；不支持的能力不显示。虚拟摄像头（手机当摄像头）通常不开放这些
- 变更：照片压缩 `MAX_SIDE` 1600→2400，JPEG 质量 0.8→0.85（作业小字更清楚，.db 体积会相应变大）；`styles/photos.css` 追加变焦/分辨率样式

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
