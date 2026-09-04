# 班级抽奖点名机 — 项目说明文档

> 本文档面向"后续接手这个项目的 AI 或人类"，目标是让你不需要逐行读代码，也能理解每个文件、每个函数/变量的作用，以及整体数据流转逻辑。

## 一、这是什么

纯静态网页应用（HTML + CSS + 原生 JS，无构建工具、无框架），部署在 GitHub Pages：`https://shixund.github.io/LotteryMachine/`。
用途：课堂随机点名/抽奖。老师录入学生名单（含照片、按成绩自动计算的权重），在"抽奖"页面点击转盘随机抽取一名学生回答问题。

三个页面（`index.html` 里通过 `.page` + `.page.active` 切换显隐，不是路由跳转）：
- **抽奖**（`wheel-page`）：转盘
- **录入**（`roster-page`）：学生名单管理
- **设置**（`settings-page`）：通用设置、数据管理

设计风格参考了同目录 `DayX/` 项目（配色变量、卡片圆角、按钮体系），但内容和数据完全独立。

---

## 二、整体架构

```
浏览器加载 index.html
  → 依次加载 styles/*.css（纯样式，无逻辑）
  → 依次加载 scripts/*.js（IIFE 模块，每个文件在 window 上挂一个全局对象，如 window.AppState）
  → scripts/app.js 的 DOMContentLoaded 监听器执行 init()：
      1. 注册 service-worker.js（离线缓存，全部资源 cache-first）
      2. MsalAuth.init()（预加载 OneDrive 登录所需的 MSAL.js，处理登录回调）
      3. AppState.load()（从 IndexedDB 读取学生名单和设置到内存）
      4. Navigation.init()（绑定导航栏点击事件）
      5. 渲染当前激活页面（默认"抽奖"页）
      6. AppState.subscribe(...)：数据变化时自动重新渲染当前页面
      7. Persistence.requestPersistence()（申请持久化存储）
      8. UpdateChecker.check()（检查 version.json 是否有新版本，需要则弹窗）
```

**核心设计**：所有页面渲染都是"整段 innerHTML 重绘 + 重新绑定事件"，不是虚拟 DOM diff。数据唯一真源是 `AppState` 内存中的 `state` 对象，任何修改都通过 `AppState.xxx()` 方法完成并自动持久化到 IndexedDB，然后广播给订阅者（当前激活页面）重新渲染。**不要绕过 `AppState` 直接改 DOM 后又忘记调用 `AppState.updateStudent()` 之类的方法，否则数据不会持久化。**

---

## 三、数据模型（`scripts/state.js`）

### 多班级结构（最外层）
```js
AppState 内存结构 = {
  classes: [
    { id, name, students: Student[], drawnStudentIds: string[] },  // 每个班级独立一份学生名单 + "已抽取"记录
    ...
  ],
  activeClassId: string,   // 当前正在查看/操作的班级 id
  settings: {              // 设置是全局共享的，不分班级
    spinFastMs,            // 转盘旋转动画"匀速阶段"时长（x），默认 400，见 4.1 节"旋转与中奖逻辑"
    spinFastTurns,         // 匀速阶段（x 毫秒内）固定转的圈数，默认 1，可在设置页调整，支持小数（如 0.5）
    spinSlowMs,            // 转盘旋转动画"减速阶段"固定时长（y），默认 2500，不随机（悬念感来自落点随机，见下）
    winnerAutoCloseMs,     // 中奖弹窗自动关闭毫秒数，默认 5000，0=不自动关闭
    equalWeightMode,       // 等权抽取开关，默认 false
    noRepeatMode,          // 不重复抽取开关，默认 false
    spinShortcutKey,       // 抽奖快捷键，支持组合键，标准化字符串见 ShortcutUtil，默认 'PageUp'
    hideDrawHistory        // 隐藏屏幕底部"抽取历史"条，默认 false（即默认显示）
  }
}
```
- **`getStudents()` / `getTotalWeight()` / `addStudent()` / `updateStudent()` / `removeStudent()` / `clearStudents()` / `parseImportText()` / `applyScoreImport()` / `getDrawnIds()` / `markDrawn()` / `resetDrawn()` 这些函数操作的都是"当前激活班级"（`getActiveClass()`）的数据**，不是全局的。抽奖页、录入页永远只看到当前班级的人；"不重复抽取"的已抽名单（`class.drawnStudentIds`）也是随每个班级各自存储的，见下方"不重复抽取"小节。
- 班级管理函数：`getClasses()`（全部班级）、`getActiveClass()` / `getActiveClassId()`、`switchClass(id)`（切换当前班级）、`addClass(name)`（新建并自动切换过去）、`renameClass(id, name)`、`removeClass(id)`（**至少保留一个班级，删除最后一个会被拒绝并返回 `false`**；删除当前激活班级时自动切到列表里第一个剩下的）。
- **旧版本数据迁移**：早期版本没有"班级"概念，数据结构是 `{students, settings}`（没有 `classes` 字段）。`load()` 和 `replaceState()` 里都做了 `migrateLegacy()` 兼容处理——检测到旧格式时，自动包成一个名为"默认班级"的班级。**改数据结构时如果不兼容旧格式，要在这两个函数里都处理**，否则老用户升级后数据"凭空消失"（实际是读取失败被兜底成了空状态）。
- UI 组件：`scripts/components/classSwitcher.js`（`window.ClassSwitcher.renderInto(containerEl)`），挂载在抽奖页和录入页顶部工具栏最左侧，是一个可展开的下拉面板：点班级名切换、✎ 重命名（用 `window.prompt`）、🗑️ 删除（只有 >1 个班级时可点，`Modal.confirm` 二次确认）、"➕ 新建班级"（也是 `window.prompt` 输入名称）。面板打开/关闭状态、点击面板外部自动关闭的逻辑是**模块级只注册一次**的 `document` 点击监听（写在 IIFE 顶层，不在 `renderInto` 里面），避免每次页面重绘都叠加新的全局监听器。

### Student（单个学生）
| 字段 | 类型 | 含义 |
|---|---|---|
| `id` | string (uuid) | 唯一标识 |
| `name` | string | 姓名 |
| `photoDataUrl` | string \| null | 裁剪为 1:1 的 base64 图片（JPEG，`ImageCropper` 生成），无照片则为 `null`，UI 用姓名首字母占位 |
| `score` | number \| null | 最近一次考试成绩，可为空 |
| `weightMode` | `'score'` \| `'manual'` | 权重来源。`'score'` = 权重随成绩自动计算；`'manual'` = 用户手动指定权重，不再随成绩变化 |
| `weight` | number（≥1） | 实际参与抽奖的权重 |

### 权重公式
```js
weight = Math.max(MIN_WEIGHT, evaluate(settings.weightFormula, g=score))   // MIN_WEIGHT = 1
```
即 `scoreToWeight(score)`，实现在 `state.js`。**权重公式现在是可在设置页自定义的字符串**（`settings.weightFormula`，默认 `WEIGHT_BASE-g` = `'160-g'`），不再是写死的常量：
- `g` 代表成绩，公式支持 `+ - * / ( )` 四则运算和括号（如 `(150-g)*2`），由 `state.js` 内置的一个小型递归下降解析器（`tokenizeFormula` → `parseFormulaTokens` → `evalFormulaAst`，统称 `compileWeightFormula`）解析求值，**没有用 `eval()`/`Function()`**（避免把任意 JS 代码执行权限交给用户输入）。
- `AppState.testWeightFormula(formula)` 返回 `{ok:true}` 或 `{ok:false, message}`，供设置页在保存前校验；`AppState.updateWeightFormula(formula)` 校验通过后保存并**立即重新计算所有 `weightMode==='score'` 的学生的权重**（遍历 `state.classes` 逐个 `normalizeStudent`），不需要用户手动刷新才能看到新权重生效。
- `AppState.DEFAULT_WEIGHT_FORMULA` = `'160-g'`，设置页"重置为默认"按钮直接调用 `updateWeightFormula(AppState.DEFAULT_WEIGHT_FORMULA)`。
- 对某个具体成绩求值时结果非有限数（比如公式里出现除以 0）会兜底成 `MIN_WEIGHT`，不会让权重变成 `NaN`/`Infinity`；这和"公式语法本身不合法"是两回事——语法错误在保存前就被 `testWeightFormula` 拦下，不会写入 `settings`。
- `weightMode === 'manual'` 时完全不受这个公式影响，见下一条。
- **如果以后要改默认基准分**，改 `state.js` 顶部的 `WEIGHT_BASE` 常量即可（`DEFAULT_WEIGHT_FORMULA` 由它拼出来）；**如果要改公式语法支持范围**（比如加乘方、加其它变量），改 `tokenizeFormula`/`parseFormulaTokens`/`evalFormulaAst` 这三个函数，三者必须保持语法定义一致。
- `weightMode === 'manual'` 时不调用此公式，直接使用用户输入的 `weight` 值（必须 > 0，否则回退为 `MIN_WEIGHT`）。
- 抽奖概率 = `student.weight / 所有学生 weight 之和`（`AppState.getTotalWeight()`），**有放回**抽取（不会因为抽中过就排除，符合需求里"每次被抽到的概率固定"的描述）。
- **等权抽取**（`settings.equalWeightMode`，默认 `false`）：抽奖页顶部工具栏右侧有个"等权抽取"勾选框，勾选后 `pages/wheel.js` 的 `weightedPick()` 会**完全跳过权重**，直接从候选池里等概率随机选一个（`Math.floor(Math.random() * pool.length)`），不管每个人的 `weight` 是多少。这个开关只影响"选中谁"，不影响 `weight` 字段本身的存储值——取消勾选后立刻恢复按权重抽取。转盘视觉上的扇区一直都是等分的（不随权重变化扇区大小），所以勾选与否不会改变转盘长相，只改变背后的中奖概率。
- **不重复抽取**（`settings.noRepeatMode`，默认 `false`；已抽名单 `class.drawnStudentIds: string[]`，随**每个班级**各自存储在 `class` 对象里，不是全局的）：勾选后 `pages/wheel.js` 的 `getDrawPool(students)` 会先用 `AppState.getDrawnIds()` 过滤掉当前班级已经抽过的学生，剩下的才是这次抽奖的候选池（`weightedPick(pool)` 的入参从"全体学生"变成"候选池"）；`drawWheel()` 也会读同一份 `drawnIds` 把对应扇区涂成灰色（`DRAWN_SECTOR_COLOR`）并降低该扇区头像/文字的 `globalAlpha`，但**扇区的角度/位置不变**，只是变灰，不会从转盘上消失。候选池为空时点"开始抽奖"会被 `spin()` 提前拦下并 toast 提示，不会真的转。中奖者确定后，`spin()` 的 `finish()` 收尾阶段调用 `AppState.markDrawn(winner.id)`（写入当前班级的 `drawnStudentIds` 并持久化+通知刷新，让灰色扇区在弹出中奖弹窗之前就已经生效）。工具栏的"🔄 重置"按钮和"取消勾选不重复抽取"都会调用 `AppState.resetDrawn()` 清空当前班级的 `drawnStudentIds`；**切换班级本身不会调用 `resetDrawn()`**，纯粹是 `getActiveClass()` 指向了另一个自带独立 `drawnStudentIds` 的班级对象，所以天然做到"切班级不重置、已抽数据分班级保留"。

### 存储位置
- **主数据**（`classes` + `activeClassId` + `settings`，完整结构见本节最上方代码块）：存 **IndexedDB**（数据库名 `lottery-machine-db`，object store `app-state`，单条记录 key 为 `'main'`）。选 IndexedDB 而不是 localStorage 是因为学生照片是 base64，多张照片容易超过 localStorage 5MB 上限。
- **更新检测的两个小标记**（`lastSeenVersion` / `skippedVersion`）：存 **localStorage**（见 `updateChecker.js`），因为这两个值只是简单字符串，同步读取更方便。

### `state.js` 导出的主要函数（`window.AppState`）
| 函数 | 作用 |
|---|---|
| `load()` | 启动时从 IndexedDB 读入内存，返回 state |
| `subscribe(fn)` | 注册数据变化监听器，返回取消订阅函数 |
| `getState()` / `getStudents()` / `getTotalWeight()` | 读取当前内存状态 |
| `addStudent(data)` / `updateStudent(id, patch)` / `removeStudent(id)` / `clearStudents()` | 增删改学生，内部都会调用 `normalizeStudent()` 重新计算 weight，然后 `persist()` 写 IndexedDB，再 `notify()` 广播 |
| `scoreToWeight(score)` | 权重公式，供 UI 显示"预计权重"时复用 |
| `parseImportText(text)` | 解析 TXT 批量导入的文本，见第 4.2 节"TXT 批量导入"详细规则。**不直接写入**，成功时返回 `{ok:true, created, updated}` 预览数据，失败（格式冲突/无法解析）时返回 `{ok:false, issues, mixedFormat}`，调用方必须先处理 `ok:false` 的情况 |
| `applyScoreImport(preview)` | 把 `parseImportText` 返回的 `{created, updated}`（`ok:true` 时的那部分）真正写入 state |
| `updateSettings(patch)` | 修改 settings 并持久化 |
| `replaceState(newState)` | 整体替换（本地导入 JSON / OneDrive 恢复备份都调用这个） |
| `exportSnapshot()` | 生成导出用的 JSON 对象（本地导出 / OneDrive 上传都调用这个） |
| `getDrawnIds()` / `markDrawn(id)` / `resetDrawn()` | "不重复抽取"功能用：读取/追加/清空**当前激活班级**的 `drawnStudentIds` |

---

## 四、页面模块

### 4.1 抽奖页 —— `scripts/pages/wheel.js` + `styles/wheel.css`
- `render()`：顶部工具栏（`.wheel-toolbar`，**宽度 100%、贴在 `.container` 真正的左右边缘**，左边是班级切换器 `ClassSwitcher.renderInto()`，右边依次是"等权抽取"按钮、"不重复抽取"按钮、"🔄 重置"按钮）+ 下方居中的转盘舞台，舞台正下方是学生数统计（`#wheel-stats`，跟转盘一起放在 `#wheel-stage-mount` 里，不在顶部工具栏）。
  - **"等权抽取"/"不重复抽取"是普通 `<button>` 而不是 checkbox**：默认 class 是 `btn-secondary`（和"重置"按钮同款外观，三个按钮长得像一组），开启时额外叠加 `.btn-toggle-on` 变成实心主色（跟导航栏 `.nav-btn.active` 的"选中态=主色"视觉语言一致）。点击时用 `e.currentTarget.classList.contains('btn-toggle-on')` 的反值算出"点完之后应该是什么状态"，再调 `AppState.updateSettings()`；`render()` 每次重绘都会用 `classList.toggle('btn-toggle-on', !!settings.xxxMode)` 把按钮外观和 state 同步，不依赖按钮自身记忆状态。**之前是用 `<input type="checkbox">`，用户反馈跟"重置"按钮的风格不统一，改成了现在这样**——以后再加类似的"开关型"操作，优先照这个 `.btn-secondary` + `.btn-toggle-on` 的模式做，不要混用 checkbox。
  - "🔄 重置"按钮只在开启"不重复抽取"时可见，直接跟在"不重复抽取"按钮后面。**这里刻意不用 `hidden` 属性（也不用 `display:none`），而是用一个自定义类 `.wheel-reset-btn-off { visibility:hidden; pointer-events:none; }`**：`hidden`/`display:none` 会把元素整个从布局流里摘掉，`.wheel-toolbar-right` 的总宽度就会跟着重置按钮的出现/消失而变化，进而导致"等权抽取"/"不重复抽取"这两个在它前面的按钮的绝对位置跟着左右挪——这是实测发现过的真问题，用户报告点"不重复抽取"后前两个按钮会跟着移位。改成 `visibility:hidden` 后，重置按钮的盒子**始终占着位置**，只是不可见/不可点击，`.wheel-toolbar-right` 的宽度永远不变，前面两个按钮的坐标就固定死了。**以后这种"某个按钮只在特定条件下才该显示"的场景，只要它前面还有其他重要元素不能跟着挪动，都优先用这个 `visibility` 模式，不要用 `hidden`/`display:none`。**（另外，学生数统计 `#wheel-stats` 也已经从这一排工具栏挪到转盘正下方独立一行了，进一步减少这排按钮的拥挤程度。）
- `drawWheel()`：用 Canvas 2D 把圆等分成 N 个扇区（N=学生数），扇区颜色从 `SECTOR_COLORS` 调色板循环取色，**除非该学生在"不重复抽取"模式下已经被抽过——那种情况扇区涂成灰色 `DRAWN_SECTOR_COLOR` 并把头像/文字的 `ctx.globalAlpha` 调到 0.6**（细节见上面"不重复抽取"小节）；每个扇区里画一个圆形头像缩略图（`loadPhotoImage()` 用 `Map` 缓存 `Image` 对象，避免重复解码 base64；图片异步加载完成后如果当前就在抽奖页会自动重绘）+ 姓名文字（沿半径方向排列，超过 6 个字截断加省略号）。
- `getDrawPool(students)`：抽奖候选池计算，`settings.noRepeatMode` 关闭时直接返回全体学生；开启时过滤掉 `AppState.getDrawnIds()` 里的人。`spin()` 和 `weightedPick()` 都基于这个池子，但 `drawWheel()` 画扇区时用的还是**完整的** `students` 数组（只是把已抽的染灰），两者的下标/顺序必须保持一致，否则中奖扇区会跟指针对不上。
- **旋转与中奖逻辑（`spin()`，这是最容易看错的部分）**：
  1. 先算好候选池 `pool = getDrawPool(students)`；不重复模式下如果 `pool.length === 0`（全部抽完）直接 toast 提示并 `return`，不会真的转。
  2. `weightedPick(pool)`：先检查 `settings.equalWeightMode`——**勾选"等权抽取"时直接跳过权重**，`Math.floor(Math.random() * pool.length)` 从候选池等概率随机选一个；否则走加权随机：生成 `[0, 候选池总权重)` 的随机数，依次减去每个候选人的 weight，减到 ≤0 时的那个学生就是中奖者。**中奖结果在动画开始前就已经确定**，转盘旋转只是视觉效果，不是"转到哪个算哪个"。
  3. `winnerIndex = students.indexOf(winner)` —— 注意这里用的是**完整学生列表**里的下标（不是候选池里的下标），因为扇区位置是按完整列表画的。扇区 0 从正上方（指针位置）开始顺时针排列，第 i 个扇区覆盖角度范围 `[i*seg, (i+1)*seg)`（`seg = 360/学生数`）。
  4. **落点不固定在扇区正中间，而是在扇区内 `[1%, 99%]` 范围均匀随机取一点**——`winnerLandingAngle = winnerIndex*seg + landingOffset`。`landingOffset` 的计算：取一个 `[0,1)` 的随机比例 `rawFraction = Math.random()`，clamp 到 `[SECTOR_LANDING_MARGIN_RATIO, 1-SECTOR_LANDING_MARGIN_RATIO]`（常量 `SECTOR_LANDING_MARGIN_RATIO = 0.01`，两侧各留 1% 的安全边距，只是为了不精确停在分隔线上，不是为了避开边缘）；`landingOffset = clampedFraction * seg`。**曾经在此基础上叠加过一个"往两侧边界拉伸"的变换（`SECTOR_LANDING_STRETCH_FACTOR` 系数），让落点更容易滑到扇区边缘制造悬念，但后来按产品要求去掉了，改回单纯的 `[1%,99%]` 均匀分布**，不再人为偏向两侧。
     - 要让 `winnerLandingAngle` 转到正上方，需要旋转 `desiredFinalAngle = (360 - winnerLandingAngle % 360) % 360` 度（相对于扇区当前 0 点的角度）。**这整套"随机落点"设计是从"永远精确停在扇区正中间"改过来的**：固定停中间虽然实现简单，但观众多看几次会发现"指针每次都精确对齐某条线"，反而显得"像是设计好的、不够真实"；不管落点具体在哪，中奖结果都依然是抽奖开始前就用 `weightedPick()` 按权重精确算好的，**指针最终停在这个学生扇区内的哪个具体位置是随机的，不影响谁中奖、也不会让指针跑出这个学生的扇区**（这一点是权重抽奖机制成立的前提，详见下方"如何调和权重与真随机手感"的说明）。
  5. **旋转动画分两个阶段**（`settings.spinFastMs`=x、`settings.spinFastTurns`（x 毫秒内转几圈，默认 1，**支持小数**如 `0.5`）、`settings.spinSlowMs`=y 均可在设置页调整，默认 x=400/圈数=1/y=2500）——**这是从"单段固定时长缓动"改过来的新设计，动机：固定时长转出去，观众很快能猜到大概停在哪，缺乏紧张感**：
     - **阶段一（匀速）**：固定 `x` 毫秒内转 `fastTurns` 圈（`fastDistance = fastTurns*360`，`fastTurns` 可以是小数，`fastDistance` 因此不一定是 360 的整数倍），角速度 `fastVelocity = fastDistance/x`，**跟中奖者是谁完全无关**，纯粹为了"转起来"的仪式感和"看起来公平"（不管抽到谁，这一段观感一样）。**因为 `fastDistance` 允许不是 360 的整数倍**，代码用模块级变量 `currentRotation`（只增不减，记录 canvas 元素已经转过的总角度）先算出"阶段一结束那一刻"的绝对角度 `currentRotation + fastDistance` 再取 mod 360（`afterFastMod`），然后才据此算出阶段二需要走的 `delta = ((desiredFinalAngle - afterFastMod) % 360 + 360) % 360`——**这里如果偷懒直接用阶段一开始前的 `currentRotation` 算 delta（旧版整数圈时代的写法），圈数一旦允许小数就会算错**，因为阶段一本身会带来一个不是 360 整数倍的 mod-360 偏移，必须把这个偏移也算进去。
     - **阶段二（匀减速）**：`slowMs` 就是设置里的 `y`，**固定值，不随机**，从阶段一结束时的速度开始匀减速到 0，精确停在中奖扇区。**这里曾经让 `slowMs` 每次都在 `[y/2, y]` 内随机取一个值，后来改回固定——真实踩过的坑**：要走的距离（`decelDistance`）基本不变的情况下，如果时长被随机砍到只剩一半，起支速度就要翻倍去追，减速曲线会陡峭得多，视觉上像"急刹车"而不是缓缓停下，用户反馈这种忽快忽慢的感觉不像真实转盘、反而更假；固定 `y` 之后减速节奏稳定可预期，悬念感改由"落点在扇区内随机偏向两侧"（上一条）来提供，不需要靠减速时长的随机性叠加。计算上依然有个小麻烦要解决：要同时满足"精确落在目标角度"和"两阶段衔接处速度尽量连续"这两个条件（对匀减速运动，速度、时长、距离三者中固定任意两个，第三个就确定了，不能三个都自由指定）——解法是**允许"阶段二实际走的角度"里包含若干整圈**（跟旧版固定 `EXTRA_SPINS` 整圈的设计思路一致，只是现在整圈数是动态算出来的）：先算出"如果阶段二起始速度恰好等于阶段一速度、固定的 `slowMs` 理论上应该走多远"（`idealDecelDistance = fastVelocity * slowMs / 2`，梯形/三角形面积公式），再选一个整数 `extraTurns = max(0, round((idealDecelDistance - delta) / 360))`，让"阶段二实际角度" `decelDistance = delta + extraTurns*360` 尽量贴近这个理想值，从而反推出的 `decelStartVelocity = 2*decelDistance/slowMs` 和阶段一末速度 `fastVelocity` 足够接近，两阶段衔接处肉眼看不出明显的速度突变。`nextRotation = currentRotation + fastDistance + decelDistance` 就是这次旋转最终要停到的绝对角度。
  6. **用 `requestAnimationFrame` 逐帧计算旋转角度直接赋值 `canvas.style.transform`**，不再用 CSS `transition`：`elapsed <= fastMs` 时角度 `= fastVelocity * elapsed`（匀速直线运动）；`elapsed > fastMs` 时令 `τ = elapsed - fastMs`，角度 `= fastDistance + decelStartVelocity*τ - (decelStartVelocity/(2*slowMs))*τ²`（匀减速运动的位移公式，`τ=slowMs` 时速度精确降到 0、位移精确等于 `decelDistance`）；`elapsed >= fastMs+slowMs` 时调用 `finish()` 收尾。旧版本用 CSS `transition` + 监听 `transitionend` 事件收尾，需要额外挂一个 `setTimeout` 兜底（因为极端情况下浏览器有时不会派发 `transitionend`）；改用 rAF 后不再依赖 `transitionend` 这个具体 DOM 事件，**但 `setTimeout` 兜底本身并没有删掉，而是换了一个同样真实的理由继续保留**：**实测发现**标签页被切到后台/最小化时，浏览器可能整个暂停 `requestAnimationFrame` 回调（不只是降频，是完全不再触发），如果 `finish()` 只从 rAF 循环内部调用，转盘会在这种情况下永久卡在"旋转中"、`开始抽奖` 再也点不动——这跟旧版 `transitionend` 不触发是同一类"收尾依赖了一个可能不触发的信号"的问题，只是触发条件从"CSS 事件不触发"变成了"rAF 不触发"。`setTimeout` 在后台标签页里会被降频但不会被完全暂停，所以现在是 `frame()` 里 `elapsed>=totalMs` 和 `setTimeout(finish, totalMs+500)` 两条路径都能调用 `finish()`，`finished` 标志保证只有一条真正生效（跟旧版处理 `transitionend`/兜底定时器竞态的写法一致）；这也意味着如果动画期间标签页被切走，用户切回来时可能会看到转盘"瞬间跳到"最终角度而不是重新播放动画——这是有意的降级行为（宁可跳一下，也不要卡死）。收尾时如果开启了"不重复抽取"，先 `AppState.markDrawn(winner.id)`（会触发重绘让扇区立刻变灰），再弹出中奖弹窗（`showWinnerDialog`）。**弹窗自动关闭**：读取 `settings.winnerAutoCloseMs`（设置页可调，默认 5000ms，0 表示禁用自动关闭需手动点"好的"），大于 0 时用 `setTimeout` 定时移除弹窗；用户手动关闭时会 `clearTimeout` 取消这个定时器。**再次发起抽奖时自动关闭上一个还没关的弹窗**：`spin()` 一进来就调用 `closeExistingWinnerDialog()`（`document.querySelectorAll('.winner-overlay').forEach(el => el.remove())`），`showWinnerDialog()` 内部也会先调用一次保险；这是因为中奖弹窗展示期间转盘本身并没有被禁用（`spinning` 在弹窗弹出前就已经复位成 `false`），如果不这么处理，连续快速点"开始抽奖"或触发快捷键会导致多个 `.winner-overlay` 层叠在页面上。
  - **如何调和"权重必须精确"和"动画必须看起来真随机"**：这两者表面上冲突——如果让物理引擎完全自由决定落点（给个初速度、一个摩擦系数，让它自己转到停），那停在哪个扇区就只取决于扇区的角度宽度，跟权重毫无关系（除非扇区大小按权重画，但本项目故意选择"扇区永远等分"，见本节最后一条）。这里的解法是**"预定结果 + 反推轨迹"，不是自由物理**：① 谁中奖，用 `weightedPick()` 在动画开始前按权重精确算好，这一步不能有任何物理随机性；② 减速阶段时长 `slowMs`、③ 扇区内具体落点 `landingOffset`，这两步是**真随机**（`Math.random()` 现算，每次都不同）。有了这三个输入之后，`extraTurns`/`decelStartVelocity` 是**反推**出来的——用真实的匀速/匀减速运动公式，解出"满足①②③这些边界条件的唯一物理轨迹"，而不是让物理自己跑出一个结果。换句话说：位移公式是真的，但边界条件是先给定的，动画只负责让过程看起来随机、不负责决定结果。这跟很多线下抽奖摇珠机的逻辑类似——滚珠翻腾的物理过程随机好看，但真正决定开奖号码的往往是另一套提前定好的机制。
  - 如果以后要改成"转盘扇区大小按权重比例画"而不是"等分"，需要同时改 `drawWheel()` 里的扇区角度计算和 `spin()` 里的 `winnerLandingAngle` 计算逻辑，两处必须保持一致。
  - 如果以后要改两阶段动画的具体曲线（比如加一个"匀速→加速→减速"三段式），改 `spin()` 里 `frame()` 函数内的分段公式即可，`fastDistance`/`decelDistance`/`decelStartVelocity` 这几个量的推导过程不需要跟着变，只要保证 `frame()` 在 `elapsed = fastMs+slowMs` 时刻算出的角度精确等于 `nextRotation - startRotation` 就行。
- **抽奖快捷键（配合翻页笔，支持组合键）**：`WheelPage` 额外导出一个 `triggerShortcutSpin()`（做了个空判断——`#wheel-hub` 都还没渲染出来就不执行，比如学生名单为空的时候），供 `app.js` 的全局按键监听调用。真正的监听逻辑在 `app.js` 的 `bindSpinShortcut()`：`document` 上挂 `keydown`，命中条件是——① `window.__recordingShortcut` 不是 `true`（设置页正在录入新快捷键时跳过，见第 4.3 节）② 当前激活页面是 `#wheel-page` ③ `ShortcutUtil.matches(e, settings.spinShortcutKey)` 为真；命中后 `e.preventDefault()`（防止 `PageUp` 之类的键触发浏览器自身翻页/滚动）再调用 `WheelPage.triggerShortcutSpin()`，内部直接复用 `spin()`，`<2人`、候选池为空、正在旋转中这些保护逻辑全部自动继承，不需要重复判断。默认快捷键是 `PageUp`，因为市面上大多数翻页笔/演示遥控器的"下一页"键发送的就是这个键。**组合键支持见 `scripts/shortcutUtil.js`（`window.ShortcutUtil`）**：`formatFromEvent(e)` 把一次 `KeyboardEvent` 标准化成 `"Ctrl+Shift+T"` / `"PageUp"` 这样的字符串（单独按下 `Control`/`Shift`/`Alt`/`Meta` 时返回 `null`，因为组合键必须以一个非修饰键结束）；`matches(e, combo)` 拿这个标准化结果去和保存的 `settings.spinShortcutKey` 做字符串比较。这个模块被 `app.js`（触发判断）和 `settings.js`（录入时生成 combo）两处共用，**改快捷键匹配逻辑时两边都要看**，且 `index.html` 里 `shortcutUtil.js` 必须排在用到它的脚本之前。
- **抽中后写入底部"抽取历史"条**：`spin()` 的 `finish()` 收尾阶段，弹中奖弹窗之前会调用 `DrawHistory.add(winner, SECTOR_COLORS[winnerIndex % SECTOR_COLORS.length])`，把当时的扇区颜色也传过去，让历史条卡片和转盘视觉对应。详见第十二节。
- **中奖庆祝动效**（`scripts/components/winnerEffects.js` + `styles/winnerEffects.css`）：`showWinnerDialog()` 把 `.winner-overlay` 挂到 `document.body` 之后立即调用 `WinnerEffects.play(overlay)`，往 overlay 里再插入一层 `.winner-fx-layer`（`position:absolute; inset:0; pointer-events:none`，盖满整个遮罩层但不挡点击），跟着弹窗一起淡入、一起在 `close()` 时被 `overlay.remove()` 整体移除，不需要单独清理定时器/动画。
  - **10 种效果**（`EFFECTS` 数组，每次中奖 `Math.floor(Math.random()*10)` 随机选一种）：撒花、冠军奖杯、举手欢呼、烟花、气球、彩带、星光闪烁、鼓掌、派对礼炮、皇冠。**这 10 种不是 10 份互相独立的动画代码**，而是复用 5 种"运动方式"（`motion`：`fall` 从顶部落下、`rise` 从底部弹跳冲上去、`float` 从底部缓缓飘起、`twinkle` 原地反复闪烁、`burst` 从一个起点向外炸开）+ 1 种一次性的 `pop`（大图标在中心弹出，专给"冠军奖杯"用，同时叠加一圈 `burst` 小星星）——不同效果只是给同一套运动方式换 emoji 组合和参数（数量、扩散半径、起点等），这是"确实会重复的动作模式复用"，不是过度抽象。
  - 每种运动方式对应 `styles/winnerEffects.css` 里一组 CSS `@keyframes`（`winnerFxFall`/`winnerFxRise`/`winnerFxFloat`/`winnerFxTwinkle`/`winnerFxBurst`/`winnerFxHeroPop`），JS 只负责给每个粒子（`<span class="winner-fx-particle winner-fx-{motion}">`）算好并写入一组 CSS 自定义属性（如 `--x`/`--drift`/`--rot`/`--tx`/`--ty`/`--delay`/`--duration`），实际动画完全交给 CSS 跑，JS 不逐帧操作 DOM（跟 `wheel.js` 的 `spin()` 用 `requestAnimationFrame` 逐帧算角度是两种不同的实现思路——这里每个粒子的运动轨迹是纯函数式的位移公式，CSS `animation` 天然胜任，没必要自己写 rAF 循环）。
  - `burst` 运动方式支持两种起点（`origin`）：`'center'`（烟花、鼓掌，从弹窗中心向四周炸开）和 `'corners'`（派对礼炮，奇数序号粒子从屏幕左下角往右上方炸、偶数序号从右下角往左上方炸，两侧对称呼应真实礼炮效果）。
  - **如果以后要加新效果**：大概率只需要在 `EFFECTS` 数组里加一条新配方（选一个已有 `motion` + 换 emoji/参数），不需要碰 CSS；只有当确实需要一种全新的运动轨迹时才需要同时加新的 CSS `@keyframes` 和对应的 `else if` 分支（`buildLayer()` 内）。

### 4.2 录入页 —— `scripts/pages/roster.js` + `styles/roster.css`
- `render()`：渲染工具栏（统计信息 + "📄 TXT 批量导入" / "➕ 添加学生" / "☁️ 打开 OneDrive 备份" / "📤 立即上传"**四个按钮，统一用 `.btn-primary`**——早期这四个按钮颜色不一致，用户反馈"格格不入"后统一成同一个颜色）+ 学生卡片网格。
  - "☁️ 打开 OneDrive 备份"直接调用 `OneDriveApi.open()`，和设置页的入口是同一个弹窗组件，命名也保持一致，不要在两处用不同的文案。
  - "📤 立即上传"（`handleQuickSync()`，早期文案是"🔄 立即同步"，用户反馈这个操作只上传不做双向同步，改成了"上传"更准确）是**跳过弹窗的快捷上传**：先 `MsalAuth.getAccount()` 查有没有登录，没登录就 toast 提示 + `OneDriveApi.open()`（引导去弹窗登录，不在这里做登录 UI）；已登录则直接 `OneDriveApi.uploadBackup(`${ImportExport.timestampName()}.json`, AppState.exportSnapshot())` 一步到位上传一份新备份，按钮临时变"上传中..."并禁用，成功/失败都有 toast。这是"打开 OneDrive 备份"弹窗里手动点上传的快捷方式，底层复用的是同一个 `OneDriveApi.uploadBackup`，命名文件的规则（`年-月-日--时-分-秒.json`）也完全一致，`AppState.exportSnapshot()` 本身就包含 `settings`，所以云备份/本地导出天然都含设置，不需要额外处理。
  - "➕ 添加学生"（`handleAdd()`）新建学生默认 `score: 130`（对应 `weight = 160 - 130 = 30`），跟 TXT 批量导入"仅姓名"格式的默认分数（`NAME_ONLY_DEFAULT_SCORE`，见下方）保持一致，避免新加的学生因为成绩空着导致权重掉到 `MIN_WEIGHT=1`、抽中概率远低于其他人。
  - 每张学生卡片包含：照片（点击 ✎ 触发 `handleEditPhoto`）、姓名输入框、成绩输入框、权重输入框（`weightMode==='score'` 时只读）、"手动设置权重"勾选框、删除按钮。
- 所有输入框都是 `change` 事件（失焦或回车才提交），调用对应的 `AppState.updateStudent()`。
- `handleEditPhoto(studentId)`：动态创建一个 `<input type="file">` 触发系统选图，选中后调用 `ImageCropper.open(file)` 弹出裁剪弹窗，裁剪结果（base64 dataURL 或 `null` 表示取消）直接写回 `AppState.updateStudent`。
- **TXT 批量导入流程（`handleTxtFile` → `AppState.parseImportText(text)`）**：支持两种格式，**每次导入只能是其中一种，混用会被当成数据冲突拒绝**：
  - **格式 A（姓名+成绩）**：一行里含真正的 **Tab 字符**（`\t`），按 Tab 切成两段——姓名 + 成绩。**空格不算分隔符**，这是刻意的：早期版本用正则 `\S+\s+数字` 把空格当分隔符，容易把"姓名里带空格"或"误输入多个空格"的情况解析错，新版本严格要求 Tab，规则更可预测。
  - **格式 B（仅姓名）**：一行不含 Tab、也不含任何空白字符，整行就是姓名，成绩固定按 `NAME_ONLY_DEFAULT_SCORE`（=130）计算权重。
  - `parseImportText` 内部先把每一行分类成 `score`（格式 A，合法）/ `name`（格式 B，合法）/ `invalid`（两种都不是，比如 Tab 数量不对、成绩不是数字、或者一行里有空格导致既不能判定成 Tab 格式也不能判定成纯姓名格式）。**只要 `invalid` 不为空，或者 `score` 和 `name` 两类都同时存在（=格式混用），整个导入就判定失败**，返回 `{ok:false, issues, mixedFormat}`，`issues` 里精确列出每一个问题行的行号、原文、原因（`invalid` 行给出具体解析失败原因；混用情况下把 `score` 行和 `name` 行都列出来，各自标注"本行是哪种格式"，方便用户自己判断该统一成哪种）。**失败时不会返回任何 `created`/`updated`，调用方（`roster.js` 的 `showImportIssues()`）只弹一个"知道了"的问题清单弹窗，不允许部分导入**——用户必须把文件改成单一格式后重新选择文件导入。
  - 只有全部行都合法且属于同一种格式时才会继续走原来的"按姓名匹配已有学生"逻辑，返回 `{ok:true, created, updated}`，后续流程（`showImportPreview` 弹窗、`.import-conflict-checkbox` 逐行/批量选择覆盖/跳过、`applyScoreImport`）跟之前完全一样，没有变化。
  - 同一次导入文本中出现的重复姓名只取第一行；姓名如果和当前班级已有学生**完全相同**（`===`）则视为冲突（进 `updated`），否则视为新增（进 `created`）。

### 4.3 设置页 —— `scripts/pages/settings.js` + `styles/settings.css`
六个卡片区块，`render()` 里整体拼 HTML 再统一 `bindEvents()`。**布局是两栏**（`.settings-container` 用 `display:flex`）：
- **左栏**（`.settings-left-column`，`flex:1 1 320px; max-width:380px`，内部纵向堆叠）：① 抽奖设置（`spinFastMs`/`spinFastTurns`/`spinSlowMs` 三个并排输入框 + `winnerAutoCloseMs` 输入框 + 快捷键录入，卡片内部用 `.setting-group-title` + `.setting-divider` 分成"转盘节奏 / 中奖提示 / 操作方式"三个小分组，避免几块内容堆成一大坨看起来乱，见下）② 权重公式（`bindWeightFormula()`，文本输入框 + "重置为默认"按钮，`change` 事件时用 `AppState.testWeightFormula()` 校验，失败则 `Toast.error` 红色提示并把输入框恢复成 `lastSaved`，成功则 `AppState.updateWeightFormula()` 保存并重算权重，见第三节"权重公式"）③ 安装与存储（`bindInstallButton()` 绑定 PWA 安装，见下；`loadStorageStatus()` 显示持久化存储状态）。这几块相对"经常要调"，放左边独立一栏。
- **右栏**（`.settings-right-column`，`display:grid; grid-template-columns: repeat(2, 1fr)`，两列两行）：③ 数据导入导出（`ImportExport.exportToFile()` / `ImportExport.importFromFile()`）④ OneDrive 云备份（`OneDriveApi.open()`）⑤ 版本信息（`loadVersionInfo()` 拉取 `version.json`；"检查更新"按钮手动触发 `UpdateChecker.check()`；"📖 产品说明"是个 `<a href="./Handbook/index.html">`，新标签页打开使用手册，见第十节。**这里故意写成 `index.html` 而不是 `./Handbook/`**：早期用目录路径时，在某些静态托管环境下点击会先经过一个中转页需要二次点击才能真正进入，写死文件名可以绕开对"目录自动补 index.html"这个行为的依赖，更稳。）⑥ 危险区域（`AppState.clearStudents()`，二次确认）。这四块内容量不一，**用 `.settings-section { height:100%; display:flex; flex-direction:column; }` + grid 默认的 `align-items:stretch` 让同一行的两张卡片自动等高**，不需要手动计算高度。
- **抽奖快捷键录入（支持组合键）**（`bindShortcutRecorder()`，"抽奖设置"卡片里，`settings.spinShortcutKey` 默认 `'PageUp'`）：点击"🎹 录入键盘快捷键"后，按钮文字变成"请按下要设置的按键...（Esc 取消）"并禁用，同时把全局标记 `window.__recordingShortcut` 设为 `true`；然后在 `document` 上（`capture: true`）挂一个 `keydown` 监听，每次按键先用 `ShortcutUtil.formatFromEvent(e)` 标准化——**如果只是单独按下了 `Ctrl`/`Alt`/`Shift`/`Meta` 会返回 `null`，此时监听器不摘除，继续等待用户按下组合的最后一个非修饰键**；拿到非空的 combo 字符串后才真正结束录入：`combo === 'Escape'` 时不改动（取消录入，保留原值），否则存进 `settings.spinShortcutKey`、更新 `#setting-shortcut-display` 显示，同时把 `window.__recordingShortcut` 复位为 `false`、按钮恢复原状。**`window.__recordingShortcut` 这个全局标记的作用**：告诉 `app.js` 里真正触发抽奖的那个全局快捷键监听器"现在正在录入新快捷键，这次按键不要当成触发抽奖来处理"，避免录入过程中意外拉动了转盘（虽然实际场景下设置页和抽奖页不会同时激活，理论上不太可能冲突，但留着这层保护更稳妥）。
- **隐藏"抽取历史"条**：同一张"抽奖设置"卡片里还有一个勾选框（`#setting-hide-draw-history`），对应 `settings.hideDrawHistory`（默认 `false`，即默认显示），勾选后调用 `AppState.updateSettings({hideDrawHistory:true})`；具体怎么隐藏见第十二节 `DrawHistory` 的 `applyVisibility()`。
- 响应式：`responsive.css` 在 `max-width:720px` 时把 `.settings-left-column` 的 `max-width` 去掉、`.settings-right-column` 改成单列，两栏各自纵向堆叠成一栏。

---

## 五、通用组件（`scripts/components/`）

| 文件 | 导出 | 说明 |
|---|---|---|
| `toast.js` | `window.Toast.{show,info,success,error,warning}` | 顶部居中的轻提示条，纯 JS 动态创建 DOM，自动淡出销毁 |
| `modal.js` | `window.Modal.{confirm, escapeHtml}` | `confirm({title,text,confirmText,cancelText,danger})` 返回 `Promise<boolean>`，点遮罩/按 Esc 视为取消。`escapeHtml` 在所有把用户输入拼进 `innerHTML` 的地方都要用，防止 XSS（比如学生姓名） |
| `imageCropper.js` | `window.ImageCropper.open(file)` | 纯 Canvas 实现的 1:1 裁剪器，无第三方库。内部：先按"覆盖填满"（`Math.max` 缩放比）画出图片，用户拖拽改 `offsetX/offsetY`、滑动条改 `zoom`，`clampOffset()` 防止拖出边界露白；确认时把 320×320 的预览画布再缩放绘制到 `OUTPUT_SIZE=320` 的输出画布，导出 `image/jpeg` quality 0.88 的 dataURL |
| `drawHistory.js` | `window.DrawHistory.add(student, color)` | 屏幕底部"抽取历史"条，详见第十二节 |
| `winnerEffects.js` | `window.WinnerEffects.play(overlayEl)` | 中奖弹窗的随机庆祝动效，详见第 4.1 节末尾"中奖庆祝动效" |
| `soundEffects.js` | `window.SoundEffects.{playSpin,stopSpin,playWin,SPIN_FILES,WIN_FILES}` | 抽奖音效，详见 4.1 节"旋转与中奖逻辑" |
| `mediaLoader.js` | `window.MediaLoader.run()` | 启动蒙版：阻塞式等音效素材就绪，详见下方"启动蒙版" |

`scripts/shortcutUtil.js`（`window.ShortcutUtil`，不在 `components/` 目录下，因为它不渲染任何 UI，纯粹是键盘事件处理的小工具）：`formatFromEvent(e)` / `matches(e, combo)`，详见第 4.1 节"抽奖快捷键"。

### 五.1 抽奖音效（`soundEffects.js`）

- `SPIN_FILES`/`WIN_FILES` 是两份素材路径清单（`backgroundmusic/spin/`、`backgroundmusic/win/`，各 8 个 `.wav`），`playSpin(durationMs)` 随机选一个 spin 素材，用 `playbackRate` 倍速拉伸/压缩到刚好等于本次转盘旋转总时长；`playWin()` 随机选一个 win 素材原速播完。两个数组一并从 `window.SoundEffects` 导出，是因为 `mediaLoader.js` 需要拿到同一份清单去逐个预加载，不想在两个文件里各维护一份重复列表。
- **`playSpin` 用"必须播完的绝对时刻"（`deadline = performance.now() + durationMs`）而不是固定的 `durationMs` 来算倍速**——**这是真实踩过的坑**：素材体积普遍 700KB～1.6MB，如果每次点"开始抽奖"才现 `new Audio()` 现下载，首次播放某个文件时要等一次网络请求，等待期间转盘已经在转，原来按"旋转总时长"算倍速会导致播放起点晚了、但播放长度没跟着缩短，到 `finish()` 里 `stopSpin()` 强制停止那一刻音效必然还没放完——**"延迟"和"播放不完整"其实是同一个根因**。改成按"距离 deadline 还剩多久"重新算倍速后，不管音效实际几点开始播都能精确播完。
- `warmUp(files)` 在模块加载时（应用一打开）就用 `preload='auto'` 静默过一遍全部素材，记下真实时长到 `durationCacheMs`；引用存进 `preloadedAudioPool` 数组防止被当垃圾提前回收。这一步只是"让浏览器提前知道时长、顺手命中一次缓存"，**不保证素材已经完整下载完**——真正保证"点开始抽奖时素材已经就绪"的是下面的启动蒙版。

### 五.2 启动蒙版（`mediaLoader.js` + `styles/mediaLoader.css`）

- **为什么只靠 `warmUp()` 后台预加载不够**：预加载不阻塞用户操作，如果用户手速快、在素材还没下载完时就点了"开始抽奖"，`playSpin` 的 deadline 修复能保证"不被截断"，但音效可能被压缩到远超 `MAX_RATE`（`=4`）导致听感失真，甚至完全来不及加载。产品需求是"进入应用时看到明确的加载蒙版+进度条，下载完成前不能操作"，于是加了这一层强制蒙版，把"能不能开始用"和"素材是否就绪"绑死。
- **蒙版 DOM 写成 `index.html` 里的静态 HTML，不是等 JS 跑起来再插入**：这样它在其它任何内容渲染之前就已经显示出来，不会有"先看到一瞬间的空白/主界面再被蒙版盖上"的闪烁。`app.js` 的 `init()` 里 `MediaLoader.run()` **不 `await`**——蒙版本身用 `position:fixed` 挡住了全部交互，没必要因为等它而拖慢下面 `AppState.load()`/页面渲染，蒙版消失时应用其实已经在背后渲染好了。
- **进度计算**：对 `SPIN_FILES`+`WIN_FILES` 里每个文件调 `fetch(src)`——`fetch()` 的 Promise 只要响应头到达（含 `Content-Length`）就会 resolve，不需要等整个 body 下载完，可以很快拿到每个文件的总大小并累加成 `knownTotalSum`；再用 `response.body.getReader()` 逐块读取正文，每读到一块累加 `loaded[i]`，`loadedSum/knownTotalSum` 就是当前的总体百分比。这些 `fetch()` 请求会被 `service-worker.js` 的 `fetch` 事件拦截，音效走的是 cache-first 策略（见第十一节），**已经缓存过的文件直接从 Cache Storage 秒读**，所以老用户重新打开时蒙版通常只会一闪而过，不是每次都要等真下载。
- **安全网**：`HARD_TIMEOUT_MS=15000` 强制放行并降级提示（避免网络异常时用户永远卡在蒙版后面进不去，这是真实会发生的客服问题）；`SKIP_LINK_DELAY_MS=4000` 之后才出现"跳过等待"链接，正常几百毫秒内完成的情况下用户根本看不到这个入口，不干扰大多数人。单个文件下载失败（`fetch` 抛错）只会跳过那个文件、不阻塞其它文件继续加载，不会让整个蒙版卡死。
- 蒙版层级 `z-index:10000`，比第七节列出的所有浮层（含 `update.css` 的 `9999`）都高——加载中不应该被任何弹窗（包括更新提示）盖住。

---

## 六、更新检测机制（需求 1）—— `scripts/updateChecker.js` + `/deploy-tag.json` + `version.json`

**部署方式**：这个项目实际是作为子目录挂在 `shixunD.github.io` 这个大仓库里（Cloudflare 控制台直接连了这个 GitHub 仓库，`wrangler.jsonc` 的 `assets.directory` 指向仓库根目录），**push 到 `main` 分支后 Cloudflare 会自动重新构建部署整个仓库，服务器端内容"是否最新"完全不需要人管**（日常开发流程：在这个独立文件夹里改，改完手动复制整个文件夹去覆盖大仓库里的 `LotteryMachine/` 子目录，再由大仓库那边 push）。下面这套机制解决的是另一个问题：**已经打开过页面/已安装 PWA 的用户，怎么知道服务器上其实已经有新内容了**——尤其是现在 `service-worker.js` 已经改成全部资源 cache-first（见十一节），不主动检测的话用户会一直用着本地缓存，感知不到任何更新。

- **判重信号是 `/deploy-tag.json`（大仓库根目录，注意不是 `LotteryMachine/version.json`）**，这个文件不由本项目维护，是大仓库在 Cloudflare 的 Build 命令里每次 push 后自动生成的（commit SHA + 构建时间），**任何一次 push 到大仓库都会让它的内容变化，不需要任何人手动同步任何字段**——这就是为什么"改没改 `version.json`"不再是判重条件：以前维护过一个专门的 `version`（ISO 时间戳）字段给判重用，每次发版都要记得手动改，真实踩过的坑是容易忘记同步改、或者同一天内改两次版本手打的时间戳撞成一样的字符串导致弹窗不触发；现在完全自动化，代价是"任何一次 push 到大仓库"（哪怕改的是 `shixunD.github.io` 里别的子项目，跟 LotteryMachine 无关）都会让 LotteryMachine 的用户看到一次更新提示——目前的开发习惯是"改完 LotteryMachine 就顺手复制过去 push"，这个粒度对现在的工作流来说是可接受的。
- `LotteryMachine/version.json` 现在**只剩两个字段**：`{"semver": "人类可读的语义化版本号，如 1.2.0，展示用", "changelog": [{"semver","date","items":[...]}, ...] }`，**不参与判重，只用来给更新弹窗展示"What's New"**。发新版本时依然要人工维护：
  1. 把 `semver` 按语义化版本规则递增（纯 bug 修复 → patch 如 `1.1.1`；新增向后兼容的功能 → minor 如 `1.2.0`；破坏性变更/大改版 → major 如 `2.0.0`），并在 `UPDATE.md` 顶部加一条对应记录（版本号 + 日期 + 变更点）。**`version.json` 的 `semver` 必须始终等于 `UPDATE.md` 最新一条的版本号**，两处不同步会让人分不清到底哪个是真的当前版本。
  2. 在 `changelog` 数组**最前面**插入一条 `{semver, date, items}`（`items` 和 `UPDATE.md` 这条记录的要点保持一致，措辞可以更精简，面向用户而不是面向开发者）——`changelog` 数组本身不需要裁剪旧记录（弹窗只读前 3 条），但新记录必须插在最前面，顺序错了弹窗展示的"最新版本"就会是错的。
  **这一步跟"用户会不会收到更新弹窗"已经脱钩**——弹不弹窗只看 `deploy-tag.json` 变没变（自动），`semver`/`changelog` 只影响弹窗里展示的文字内容，就算忘了改，弹窗依然会弹，只是 What's New 显示的还是上一条记录（`showDialog` 标题在拿不到 `semver` 时会退化成"You have successfully updated!!!"，不显示版本号，不会报错或显示"undefined"）。
  `service-worker.js` 的 `CACHE_NAME` **不需要**跟着每次发版改——见该文件顶部注释。
- **更新机制是强制型的，没有"跳过"/"取消"选项**（早期版本是软性提示，用户可以点"取消"或勾选"本版本不再提示"，后来改成强制，因为软性提示会导致部分用户长期停留在旧版本、遇到已修复的 bug 还来反馈）。逻辑（`UpdateChecker.check()`，`app.js` 启动时调用一次，设置页"检查更新"按钮也会手动调用）：
  1. `fetch('/deploy-tag.json', {cache:'no-store'})`（绝对路径，因为这个文件在大仓库根目录，LotteryMachine 部署后是子目录，相对路径找不到它；`no-store` 绕过浏览器缓存）拿这次部署的指纹（原始文本，不需要解析）。**本地单独跑 LotteryMachine 调试时这个文件不存在，`fetch` 会 404/失败，`check()` 直接跳过检测，不报错也不影响其它功能**——这是有意的降级行为，不是 bug。
  2. 和 `localStorage['lottery.updateMeta.lastSeenTag']` 比较：
     - 首次访问（`lastSeenTag` 是 `null`）：直接记录，不打扰用户（不是"跳过"，纯粹是新用户不需要看"更新"提示）。
     - 相同：不提示。
     - 不同：额外 `fetch('./version.json')` 拿 `{semver, changelog}`（仅用于展示，失败也不影响弹窗本身弹出），弹出 `update.css` 样式的强制对话框，**没有任何关闭方式**（无遮罩点击关闭、无 Esc 监听、无取消按钮）——"What's New" 展示 `changelog` 前 3 条 + 唯一按钮"Click here to finish update"。
  3. 点击"Click here to finish update"：把 `lastSeenTag` 更新为这次的指纹 → 通知 Service Worker `SKIP_WAITING` + `CLEAR_CACHE` → `location.reload()`，刷新后所有资源 cache miss，重新从网络拉取最新版本。
- **大仓库那边需要配置的 Cloudflare Build 命令**（不在本项目仓库里，是 Cloudflare 控制台的项目设置）：Worker 项目 → Settings → Build，设置 Build command 在每次 push 构建时生成 `deploy-tag.json` 到仓库根目录，用 Cloudflare Workers Builds 自动注入的 `WORKERS_CI_COMMIT_SHA` 环境变量，例如：
  ```
  echo "{\"sha\":\"$WORKERS_CI_COMMIT_SHA\",\"builtAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > deploy-tag.json
  ```
  Deploy command 保持默认的 `npx wrangler deploy` 不用改——`assets.directory` 是仓库根目录，Build 命令生成的这个文件会随着其它静态资源一起被部署上去。

---

## 七、导入导出与 OneDrive 云备份（需求 2）

### 7.1 本地导入导出 —— `scripts/importExport.js`
- `timestampName(date)`：生成 `年-月-日--时-分-秒` 格式字符串（如 `2026-09-02--14-30-05`），本地导出和 OneDrive 上传的默认文件名都用这个函数。
- `exportToFile()`：`AppState.exportSnapshot()` → 序列化成 JSON → 用 `Blob` + 临时 `<a download>` 触发浏览器下载，文件名 `{timestampName()}.json`。
- `importFromFile(file)`：读取文件文本 → `JSON.parse` → `validateSnapshot()` → 调用 `AppState.replaceState()`。设置页在调用前会先弹二次确认（因为会覆盖当前数据）。**`validateSnapshot(obj)` 必须同时接受 `Array.isArray(obj.classes)`（当前多班级格式）和 `Array.isArray(obj.students)`（旧版单班级格式）——曾经这里只判断了 `obj.students`，而 `exportSnapshot()` 早就已经改成多班级的 `{classes, activeClassId, settings}` 结构、顶层根本没有 `students` 字段，导致这个校验对着当前格式的备份文件永远返回 `false`：本地导入和 OneDrive 恢复会 100% 报"备份文件格式无效"而失败，是一个实测存在过的真实 bug，不是假设性风险。**以后如果 `exportSnapshot()` 的顶层结构再变，这个函数要同步更新，且最好靠自动化测试或至少手动跑一次"导出后再导入"覆盖住这条路径，不要只看代码顺眼就当它对。

### 7.2 OneDrive 云备份

**两个独立文件分工**：
- `scripts/onedrive/msalAuth.js`（`window.MsalAuth`）：只管登录态——加载 MSAL.js（CDN，走 `index.html` 里的 `<script>` 标签或本文件的动态加载兜底）、`login()`/`logout()`/`getAccount()`/`getAccessToken()`（静默刷新优先，失败才弹交互式登录）。
- `scripts/onedrive/onedriveApi.js`（`window.OneDriveApi`）：Graph API 调用（上传/分页列表/下载/删除）+ 备份弹窗的完整 UI（`open()`/`close()`/`render()`）。

**Azure 应用注册**（与 DayX 项目完全独立，各自的 Client ID 和 OneDrive 应用文件夹互不影响）：
- Client ID: `77561bbd-07f6-4c50-a498-39b8bafdfcdd`（写死在 `msalAuth.js` 顶部的 `MSAL_CLIENT_ID` 常量）
- Directory (tenant) ID: `a27888d4-ada2-4871-b099-316283e9bdf5`
- Authority 用的是 `https://login.microsoftonline.com/consumers`（个人 Microsoft 账户）
- Scope: `Files.ReadWrite.AppFolder`（只能读写该应用专属的 OneDrive 文件夹，拿不到用户其他文件）
- **重定向 URI 必须在 Azure Portal 里配置成"单页应用程序 (SPA)"平台**，包含：
  - `https://shixund.github.io/LotteryMachine/`（生产）
  - 本地开发时的 `http://localhost:<端口>/`（`msalAuth.js` 的 `buildConfig()` 会在 `hostname === 'localhost'` 时自动用 `window.location.origin + '/'` 作为 redirectUri，本地起服务测试前记得把当时用的端口也加到 Azure 后台）
- 备份文件存放路径：OneDrive 特殊文件夹 `approot`（即该应用的专属文件夹）下的 `LotteryMachine` 子目录，即 Graph API 路径 `/me/drive/special/approot:/LotteryMachine/xxx.json`（见 `onedriveApi.js` 的 `APP_SUBFOLDER` 常量）。

**分页实现**（`onedriveApi.js` 内部状态：`pageCursors` / `currentPageIndex` / `currentPageItems`）：
- 首次列表请求 URL：`.../LotteryMachine:/children?$top=10&$orderby=name desc`（文件名是时间戳格式，倒序即最新在前）。
- `pageCursors` 是一个数组，`pageCursors[i]` = 第 i 页的请求 URL；每次 `loadPage(i)` 成功后，把响应里的 `@odata.nextLink` 存进 `pageCursors[i+1]`，这样"下一页"按钮点第二次时可以直接用缓存的 URL，不用重新从头翻页；"上一页"同理直接用已缓存的 `pageCursors[i-1]`。
- 每页固定 10 条（`PAGE_SIZE`），UI 容器 `.onedrive-history-scroll` 是固定高度可滚动区域。

**UI 状态机**（`OneDriveApi.render()`）：未登录显示登录按钮；已登录显示用户信息 + 退出 + 上传输入框（默认值 `ImportExport.timestampName()`）+ 上传按钮 + 历史列表 + 翻页按钮。每条历史记录有"恢复"（下载 JSON → 校验 → 二次确认 → `AppState.replaceState()`）和"删除"（Graph DELETE，二次确认）两个操作。

**弹窗层级（z-index）**：`.onedrive-overlay` 是 `7000`，"恢复备份"点击后弹出的二次确认走的是通用组件 `Modal.confirm()`（`.modal-overlay`）。**`.modal-overlay` 的 z-index 必须比 `.onedrive-overlay` 更高**（`styles/base.css`，当前是 `7500`）——早期两个都各自设置、没考虑过谁盖谁，`.modal-overlay` 曾经是 `5000`，比 OneDrive 弹窗的 `7000` 还低，导致在 OneDrive 弹窗内点"恢复"时，二次确认框会被挡在 OneDrive 弹窗**下面**，用户点不到确认按钮，是一个实测存在过的真实 bug。以后新增任何"可能叠在其他弹窗之上"的浮层，都要显式对比一下涉及到的 z-index 数值，不要假设"后创建的元素自然显示在上层"（因为它们都是 `position: fixed`，层叠顺序只看 `z-index`，和 DOM 创建先后无关）。当前几个浮层的 z-index 一览（按数值从小到大排列）：`.draw-history-bar` 800（屏幕最下方的常驻条，故意给最低值，不需要盖住任何东西）< `.navbar` 1000 < `.classSwitcher` 下拉面板 2000 < `.winner-overlay` 中奖弹窗 6000 < `.onedrive-overlay` OneDrive 备份弹窗 7000 < `.modal-overlay` 通用确认框 7500（必须比它可能从中被触发的所有弹窗都高，比如 OneDrive 弹窗里点"恢复"弹出的二次确认）< `update.css` 里的新版本提示 9999 < `.media-loader-overlay` 启动蒙版 10000（应用刚打开、素材还没就绪时的最高优先级，见五.2 节，不应该被任何弹窗盖住，所以给了目前最高值）。

---

## 八、导航栏标题与署名角标

仿照 `DayX/index.html` 的写法：导航栏左侧不再只放 `.nav-brand`，而是包一层 `.nav-brand-container`（`styles/navbar.css`），里面并排放 `.nav-brand`（图标+"班级抽奖点名机"，`id="nav-brand-home-btn"`）和 `<span class="nav-homepagedirector" id="site-credit">by Shixun</span>`——紧跟在标题文字后面，不是页面右下角固定角标（早期版本做成了固定在页面右下角，用户反馈要求改成跟 DayX 一样贴在标题旁边，已改正，不要再改回右下角）。`by Shixun` 字体用 Google Fonts 的 Caveat（`index.html` head 里 `<link>` 引入），颜色跟随 `--primary-color` 且 `opacity:0.75`（hover 到 1）。

两者点击行为**现在完全一致**，都在 `app.js` 里绑定，共用同一个 `siteRootUrl()`：
```js
function siteRootUrl() { return `${window.location.origin}/`; }
```
- `.nav-brand`（图标+"班级抽奖点名机"文字）点击 → `bindNavBrandHome()` → `window.open(siteRootUrl(), '_blank', 'noopener')`。
- `#site-credit`（"by Shixun"）点击 → `bindSiteCredit()` → `window.open(siteRootUrl(), '_blank', 'noopener')`。

**`siteRootUrl()` 用 `window.location.origin` 动态拼，而不是写死字符串**（早期两处分别是"站内跳回抽奖页"和硬编码 `https://shixund.github.io`，用户反馈"两个点击行为应该一致，且不该写死作者的域名"后改成现在这样）：这样无论这份代码被部署在 `shixund.github.io` 还是别的域名/别人 fork 之后的站点，点击后都会跳到"当前这次实际部署所在网站"的根路径，而不是永远指向作者本人的站点。**注意这里跳的是"域名根路径"（`origin + '/'`），不是"这个应用自己所在的子目录"**——如果以后这个应用本身就需要部署在某个子路径下（比如 `https://example.com/lottery/`），且这两个链接语义上应该跳回"这个应用的首页"而不是"整个域名的根"，需要重新评估要不要改成基于 `<base>` 标签或者应用自身已知的子路径，而不是简单的 `origin + '/'`。

两者是 `.nav-brand-container` 下的两个平级兄弟节点，不是嵌套关系，点击事件互不冒泡影响，不需要 `stopPropagation`。移动端窄屏（`responsive.css`，`max-width:720px`）会隐藏 `by Shixun`（`.nav-homepagedirector`），优先保证导航按钮不被挤压，但 `.nav-brand` 本身依然可点击跳转。

## 九、PWA 安装与持久化存储（需求 5）

- `manifest.json`：`start_url` / `scope` / `display: standalone`。**图标必须同时提供 192×192 和 512×512 两个尺寸**——早期版本只声明了一个 512×512（`purpose: "any maskable"`）图标，实测浏览器地址栏一直不出现安装图标；补上 `icon-192.png`（用 Pillow 从 `icon.png` 缩放生成，`python -c "from PIL import Image; ..."`，仓库根目录）并把 `icons` 数组拆成三条（192 any / 512 any / 512 maskable，不再用组合写法）后恢复正常。`index.html` 的 `<link rel="icon">` 也分别声明了 192/512 两个尺寸，`apple-touch-icon` 用 512 的。**以后如果要换图标，必须同时更新 `icon.png`、重新生成 `icon-192.png`，并保持 `manifest.json` 里三条 icons 记录都指向存在的文件**，否则安装能力可能又会悄悄失效。
- **PWA 安装图标不出现时的排查顺序**：① `manifest.json` 能否被正常 fetch 到（DevTools → Application → Manifest 面板会直接列出解析出的字段和报错）；② `icons` 里是否有 ≥192px 的"any"用途图标；③ Service Worker 是否已激活且带 `fetch` 事件监听（这是安装资格的硬性要求之一）；④ 是否已经安装过（`PwaInstall.isStandalone()` 为 `true` 时浏览器不会再提示安装）；⑤ 是否在无痕/自动化浏览器环境（这类环境经常直接禁用 `beforeinstallprompt`，属于环境限制，不是网页本身的问题，务必在普通 Chrome/Edge 窗口里复测）。
- `scripts/pwaInstall.js`（`window.PwaInstall`）：监听浏览器的 `beforeinstallprompt` 事件并 `preventDefault()`（阻止浏览器自己弹的迷你条），把事件对象缓存到 `deferredPrompt`；提供 `isAvailable()` / `promptInstall()`（调用缓存事件的 `.prompt()`）/ `onAvailabilityChange(fn)` 回调 / `isStandalone()`（判断当前是否已经是"已安装"状态运行）。设置页的"安装到桌面"按钮由 `settings.js` 的 `bindInstallButton()` 接到这些接口上。
- **明确不支持"开机自启动"**：这是操作系统级能力，纯 Web PWA 无法实现，本项目里没有做假的开关。用户如果想开机自启，可以自行把安装后生成的快捷方式放进 Windows 的"启动"文件夹（`shell:startup`），这是浏览器/系统层面的操作，不属于代码范畴。
- `scripts/persistence.js`（`window.Persistence`）：`requestPersistence()` 调用 `navigator.storage.persist()`（若尚未持久化）并用 `navigator.storage.estimate()` 读取已用空间；`getStatus()` 返回缓存的结果供其他地方读取（当前只有设置页用）。设置页会展示"是否已持久化 / 已用空间 MB"卡片。

---

## 十、产品使用手册（`Handbook/index.html`）

面向**教师终端用户**（不是开发者）的简易产品文档，独立于主应用，纯静态单文件（自带 `<style>`，不依赖 `styles/*.css` 或 `scripts/*.js`，避免和主应用的脚本加载顺序耦合）。特点：
- **全量加载**：所有章节内容一次性都在这一个 HTML 文件里，没有分页/懒加载，`Ctrl+F` 全文搜索都能搜到。
- **左侧目录（TOC）快速跳转**：`<nav class="toc">` 内是一串 `<a href="#锚点">`，纯 CSS 锚点跳转（`html { scroll-behavior: smooth }`）不依赖 JS 也能用；额外加了一小段 JS（文件末尾 `<script>`）用 `scrollY` 计算当前滚动到哪个 section，给对应目录项加 `.active` 高亮，纯锦上添花，去掉也不影响基本可用性。
- 入口：设置页「📦 版本信息」卡片里的"📖 产品说明"按钮（`<a href="./Handbook/" target="_blank">`），新标签页打开 `Handbook/index.html`；页面顶部也有"← 返回应用"链接回到 `../index.html`。
- **内容和 `PROJECT.md` 的定位不同，不要混淆**：`PROJECT.md` 是给"后续维护这份代码的 AI/开发者"看的技术文档（变量、函数、实现细节）；`Handbook/index.html` 是给"用这个工具的老师"看的操作说明（怎么点、这个按钮是干嘛的），语言更口语化，不涉及代码实现。**新增面向用户的功能时，两边都要记得更新**——`PROJECT.md` 里记实现原理，`Handbook` 里记怎么用。

---

## 十一、Service Worker（`service-worker.js`）

- **注册时必须带 `{ updateViaCache: 'none' }`**（`app.js` 的 `registerServiceWorker()`）：`navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' })`。**这是真实踩过的一个大坑，而且比上面几个缓存坑更隐蔽**——不加这个选项，`register()` 拉取 `service-worker.js` 这个文件本身时依然会遵守浏览器自己的 HTTP 磁盘缓存：如果这个 URL 之前被普通方式请求过（哪怕只是浏览器按启发式规则缓存过一次），后续的注册/更新检查可能会一直执行缓存住的旧版 SW 脚本，代码里已经改过的 `install`/`fetch` 逻辑完全不会生效，**且没有任何报错**——表现就是"怎么改 `service-worker.js` 都跟没改一样"，本地开发时用同一个端口反复调试几个小时后非常容易踩到，一开始很容易误判成"缓存清理逻辑写错了"，其实是 SW 脚本自己都没更新。`'none'` 强制每次注册/更新检查都绕过 HTTP 缓存去重新拉取 SW 脚本本身（对它的 `importScripts` 依赖同样生效，虽然本项目没用到）。
- 缓存名 `CACHE_NAME`：**不需要每次发版改**——判重和"要不要拉新资源"完全交给 `updateChecker.js`（比较 `/deploy-tag.json`，见第六节），用户点"完成更新"时会显式发 `CLEAR_CACHE` 消息清空所有缓存桶，不依赖 `CACHE_NAME` 变化来触发清理，固定值即可。
- `install`：**不用 `cache.addAll(URLS_TO_CACHE)` 的便捷写法**，改成自己实现的 `precacheAll()`——逐个 `fetch(url, {cache:'no-store'})` 再手动 `cache.put()`。**这是真实踩过的一个很隐蔽的坑**：`cache.addAll()` 内部发起的请求不会绕过浏览器自身的 HTTP 磁盘缓存——如果某个文件之前被普通方式请求过、还在浏览器 HTTP 缓存的新鲜期内，`addAll()` 会直接把浏览器缓存里的旧内容当成"这次预缓存该存的内容"写进 Cache Storage；预缓存阶段本该拿到这次改动后的最新代码，结果存进去的是改动前的旧版本，之后全部资源又都走 cache-first，就会一直用着这份旧代码——现象和"改了文件但完全没生效"一模一样，排查起来极容易被误判成"SW 没更新"或"改的文件路径不对"，实际上文件内容和路径都是对的，只是预缓存那一刻悄悄拿错了源。**新增/改名文件后要记得把路径加进 `URLS_TO_CACHE` 这个列表**，否则该文件离线时无法访问，在线时不受影响——cache-first 策略下第一次请求会自动 `fetch` 并补进缓存。**`backgroundmusic/` 下的音效文件故意没放进这个列表**——见下方说明，原因和真实复现过的并发下载坑都在那。
- `activate`：删除所有不等于当前 `CACHE_NAME` 的旧缓存，`clients.claim()` 立即接管所有已打开的页面。
- `fetch`：**全部同源 GET 请求统一走 cache-first**，不再区分文件类型/路径——`caches.match()` 命中就直接返回、完全不发网络请求；未命中（新文件/缓存被清过）才 `fetch(url, {cache:'no-store'})` 一次并写入缓存（这里的 `cache:'no-store'` 跟 `install` 阶段是同一个坑，不能省）。**这是从"音效 cache-first + 其它资源 network-first 两套并存"简化过来的**：旧方案下代码/样式/HTML 每次打开页面都要发一次网络请求确认有没有更新，哪怕内容根本没变；现在既然 `updateChecker.js` 已经能通过 `/deploy-tag.json` 主动、可靠地检测到"有没有新部署"（见第六节），就不再需要靠 network-first 兜底"顺便"发现新版本了——检测到变化时会显式 `CLEAR_CACHE` + 刷新，平时没有新部署时全部资源都直接读缓存，比 network-first 更快、更省流量。**`backgroundmusic/` 依然不能出现在 `URLS_TO_CACHE` 里**——`install` 阶段如果也去抓这批文件，会跟 `mediaLoader.js` 页面启动时发起的 fetch 同时各打一遍请求，16 个文件变成 32 个并发下载，抢占有限的并发连接数；**这是真实复现过的问题**：本地单线程调试服务器下会导致启动蒙版长时间卡在 0% 不动，即使在正常并发能力更强的托管环境下也是纯浪费流量。音效最终依然会被缓存——`mediaLoader.js` 发起的 fetch 本身就会经过这条 cache-first 逻辑，缓存未命中时自动写入。
  - **`/deploy-tag.json` 是唯一的例外，必须永远绕过缓存**：`fetch` 事件处理器一进来就单独判断 `url.pathname === '/deploy-tag.json'`，命中就直接 `fetch(event.request.url, {cache:'no-store'})` 返回、完全不查缓存也不写缓存，`return` 掉，不走下面统一的 cache-first 逻辑。**这是真实踩过的一个逻辑坑，不是随手加的特殊情况**：`/deploy-tag.json` 本身就是 `updateChecker.js` 用来判断"有没有新部署"的判重信号，如果也走 cache-first，它会在第一次被请求时就被写进 Cache Storage，之后每次判重请求读到的都是那份"第一次缓存下来"的旧内容——判重逻辑本身用一个会被缓存的信号源来判断"要不要清缓存"，永远检测不到后续的真实变化，整个更新机制会从第二次部署开始彻底失效。以后如果要新增别的"判重用的信号文件"，都要照这个模式单独摘出来强制走网络，不能被卷进统一的 cache-first 分支里。
- `message`：响应 `SKIP_WAITING`（立即激活新 SW）和 `CLEAR_CACHE`（清空所有缓存），由 `updateChecker.js` 在用户点"完成更新"时发送。

---

## 十二、屏幕底部"抽取历史"条 —— `scripts/components/drawHistory.js` + `styles/drawHistory.css`

**只在抽奖页展示的临时性 UI，数据不进 `AppState`、不进 IndexedDB，纯内存变量，刷新/关闭页面即清空**——这是刻意的设计，不是漏做了持久化：这是"这次上课临时看一眼刚才抽过谁"的辅助展示，不是需要长期保留的数据，所以完全独立于 `AppState` 那一套持久化体系，改动它不需要碰 `state.js`。

- **数据结构**：模块级数组 `records`（最新的在最前面，`unshift` 插入，超过 `MAX_RECORDS=50` 条自动裁掉尾部），每条 `{ name, photoDataUrl, time: Date, color }`。`color` 是抽中那一刻转盘上对应扇区的颜色（`wheel.js` 的 `spin()` 收尾阶段算出 `SECTOR_COLORS[winnerIndex % SECTOR_COLORS.length]` 传进来），让历史条卡片的背景色跟当时转盘扇区的颜色对上，不需要在 `drawHistory.js` 里重复维护一份颜色表。
- **写入入口**：`window.DrawHistory.add(student, color)`，唯一调用点在 `wheel.js` 的 `finish()` 里，弹中奖弹窗之前。
- **DOM 挂载点**：`ensureBar()` 首次调用时把 `.draw-history-bar` 直接 `appendChild` 到 `document.body`，**不在任何 `.page` 容器内部**——这是"切换 抽奖/录入/设置 三个页面时这条历史记录本身不丢"的关键：`Navigation.goTo()` 只是切换 `.page` 元素的 `active` class（见 `navigation.js`），不会动 `.page` 容器之外的 DOM，所以只要 `.draw-history-bar` 挂在 `body` 下而不是某个 `.page` 里面，它自然不受页面切换影响。
- **"只在抽奖页显示"是通过 CSS class 控制显示/隐藏，不是销毁重建**：`applyVisibility()` 根据两个条件算出是否该加上 `.draw-history-bar-hidden`（`display:none`）——① `settings.hideDrawHistory`（设置页勾选框，用户主动关闭，默认 `false`）② 当前 `.page.active` 的 `id` 是不是 `wheel-page`（不是抽奖页就隐藏）。**记录数组本身完全不受这两个条件影响**，只是暂时不显示；切回抽奖页 / 取消勾选隐藏后，`applyVisibility()` 重新计算，之前积累的记录原样显示回来。触发时机两处：`AppState.subscribe(applyVisibility)`（响应设置勾选框变化）+ `app.js` 的 `Navigation.onPageChange(() => DrawHistory.refreshVisibility())`（响应页面切换）。**这是一个需要两边配合才能工作的设计，不要只改其中一处**——比如以后如果加了新的触发隐藏/显示的条件，要么塞进 `applyVisibility()` 内部的判断逻辑，要么额外找一个时机调用 `refreshVisibility()`，两种方式选一种，不要在别的地方直接操作 `.draw-history-bar-hidden` 这个 class。
- **布局：横向排不下自动换行，最多给两排高度，第三排开始纵向滚动**（`styles/drawHistory.css`）：`.draw-history-list` 是 `display:flex; flex-wrap:wrap`，`max-height: calc(44px * 2 + 0.5rem)`（卡片高 44px，两排 + 一条行间距，正好卡住）配合 `overflow-y:auto; overflow-x:hidden`。**卡片高度写死 44px（`.draw-history-item { height:44px; box-sizing:border-box; }`）是为了让"两排"这个换算成立**——如果以后要改卡片内边距/字号导致实际高度变化，`max-height` 的计算公式要跟着改，两处必须保持一致，否则要么第二排被裁掉一半，要么留白过多。
- **卡片配色**：背景色用 `color`（内联 `style="background:${bg}"`，`bg` 拿不到时兜底 `var(--bg-color)`），因为背景是运行时才知道的动态色值、没法写进静态 CSS 类。姓名/时间文字统一用白色系（`#fff` / `rgba(255,255,255,0.85)`），因为 `SECTOR_COLORS` 调色板都是中高饱和度颜色，白字对比度稳定；没有照片时的占位头像同理用白字 + 半透明白色背景（`rgba(255,255,255,0.3)`），呼应 `wheel.js` 的 `drawWheel()` 里同款无照片占位逻辑（半透明白底 + 白色首字母）。
- `body:has(.draw-history-bar:not(.draw-history-bar-hidden)) .container { padding-bottom: ... }`：只有历史条**实际可见**时才给页面内容腾出底部空间，隐藏（勾选关闭 / 不在抽奖页）时这条规则天然不生效，不需要额外写一条"隐藏时恢复默认 padding"的规则。
- **脚本加载顺序要求**：`drawHistory.js` 内部在模块顶层直接调用了 `AppState.subscribe(...)`，所以 `index.html` 里必须排在 `state.js` **之后**（当前顺序：`shortcutUtil.js` → `state.js` → `drawHistory.js` → ...）。如果不小心把它挪到 `state.js` 前面，`AppState` 还没定义，脚本会直接报错导致后面所有脚本都不执行——**排查"页面完全空白/所有功能失效"这类问题时，先看控制台是不是这种脚本顺序错误**。

---

## 十三、文件清单速查

```
index.html                       页面骨架 + 三个 <div class="page">容器 + 所有 <script> 引入顺序
manifest.json                    PWA 元数据（icons 需同时有 192/512 两个尺寸，否则装不上）
service-worker.js                离线缓存，全部资源 cache-first（见十一节）
version.json                     更新说明（semver + changelog，只用于展示，不参与判重，见第六节）
icon.png                         用户提供的图标（512×512，favicon + PWA 图标）
icon-192.png                     从 icon.png 用 Pillow 缩放生成的 192×192 版本，PWA 安装要求
Handbook/index.html              面向教师用户的产品使用手册（独立静态页，自带样式，见第十节）
styles/base.css                  CSS 变量、reset、通用按钮/表单/模态框/滚动条
styles/navbar.css                顶部导航栏
styles/wheel.css                 转盘、指针、中奖弹窗
styles/winnerEffects.css         中奖弹窗随机庆祝动效（见 4.1 节末尾）
styles/roster.css                学生卡片网格、裁剪弹窗、TXT 导入预览
styles/settings.css              设置页卡片网格、存储状态卡片
styles/onedrive.css              OneDrive 备份弹窗
styles/update.css                新版本提示弹窗
styles/classSwitcher.css         班级切换器下拉面板
styles/drawHistory.css           屏幕底部"抽取历史"条（见十二节）
styles/responsive.css            移动端断点适配
styles/mediaLoader.css           启动蒙版（见五.2 节）
scripts/shortcutUtil.js          键盘快捷键组合的标准化与匹配（见 4.1 节"抽奖快捷键"）
scripts/state.js                 数据模型（多班级）+ IndexedDB + 权重公式（核心，改需求先看这里）
scripts/navigation.js            三页面切换
scripts/updateChecker.js         version.json 比对 + 升级/取消/跳过弹窗
scripts/persistence.js           navigator.storage.persist() 封装
scripts/importExport.js          本地 JSON 导出/导入 + 文件名生成
scripts/pwaInstall.js            beforeinstallprompt 捕获 + 安装引导
scripts/onedrive/msalAuth.js     OneDrive 登录态（MSAL.js 封装）
scripts/onedrive/onedriveApi.js  OneDrive Graph API（分页/上传/下载/删除）+ 备份弹窗 UI
scripts/components/toast.js      轻提示条
scripts/components/modal.js      通用确认弹窗
scripts/components/imageCropper.js  1:1 头像裁剪（纯 Canvas）
scripts/components/classSwitcher.js 班级切换/新建/重命名/删除组件
scripts/components/drawHistory.js   屏幕底部"抽取历史"条（见十二节，脚本加载顺序必须在 state.js 之后）
scripts/components/winnerEffects.js 中奖弹窗随机庆祝动效（见 4.1 节末尾）
scripts/components/soundEffects.js  抽奖音效：spin 倍速匹配旋转时长 + win 原速播放（见五.1 节）
scripts/components/mediaLoader.js   启动蒙版：阻塞式等音效素材就绪（见五.2 节）
scripts/pages/wheel.js           抽奖页：画转盘 + 加权抽取 + 旋转动画
scripts/pages/roster.js          录入页：学生 CRUD + 照片 + TXT 批量导入
scripts/pages/settings.js        设置页：六个功能卡片
scripts/app.js                   启动入口，把以上模块串起来
```

---

## 十四、已知限制 / 未来可扩展点

- 抽奖默认**有放回**（同一学生可能连续被抽到），如果想要"抽过的人不再参与"，开启「不重复抽取」即可（见第三节"不重复抽取"）——这个已经实现了，**不是**"从转盘上移除"，而是"扇区变灰、候选池排除"，扇区的角度/数量不会因为抽过人而变化，实现上更简单也更不容易出 bug。
- TXT 批量导入的姓名匹配是**精确字符串匹配**，重名学生会被合并成同一人，导入前的预览弹窗是唯一的纠错机会，没有做"重名消歧"UI。
- OneDrive 备份没有做"自动定时备份"，只有手动触发上传；如果要加，可以在 `AppState.subscribe()` 的回调里加防抖计时器，参考 DayX 项目的 `syncReminder.js` 思路（本项目未实现）。
- "开机自启动"明确不支持（见第八节），不要在没有换成 Electron/Tauri 之类桌面壳的情况下试图伪造这个功能。
