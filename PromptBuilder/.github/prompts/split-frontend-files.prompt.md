### First Wrning!!！（important）
！！！每次修改后，请将更新内容，添加到本文档内(split-frontend-files.prompt.md)（不需要写更新内容，直接修改已有架构就可以）



### 产品手册

###### 14.1 `js/01-core.js`
- 常量与对象
	- `DB_NAME`（6）
	- `DB_VERSION`（7）
	- `STORE_C`（8）
	- `STORE_B`（9）
	- `BLOCK_COLOR_OPTIONS`（11）
	- `DEFAULT_BLOCK_COLOR`（18）
	- `BLOCK_COLOR_MAP`（19）
	- `DB`（24）
	- `S`（103）
	- `Theme`（161）
	- `Toast`（184）
	- `ResultFont`（195）
	- `EditorSizePref`（234）
- 函数
	- `uid`（114）
	- `plainText`（120）
	- `clamp`（126）
	- `normalizeBlockName`（130）
	- `blockColorValue`（135）
	- `applyBlockColor`（139）
	- `setBlockNameUI`（146）
	- `bringToFront`（156）
	- `buildFormatToolbar`（267）

###### 14.2 `js/02-blocks.js`
- 函数
	- `autoPos`（10）
	- `blockInPipeline`（15）
	- `makeBlockEl`（20）
	- `renderBlock`（173）
	- `renderAllBlocks`（186）
	- `updateCanvasHint`（195）
	- `normalizeActiveBlocksMeta`（201）
- 对象
	- `BlockDrag`（224）
	- `BlockEdit`（281）

###### 14.3 `js/03-pipeline.js`
- 对象
	- `PipelineMgr`（6）
	- `PipelineDnD`（97）
- 函数
	- `updateResult`（141）

###### 14.4 `js/04-render-menus.js`
- 对象
	- `Render`（6）
	- `CanvasCtxMenu`（94）
	- `BlockCtxMenu`（104）
- 函数
	- `esc`（86）
	- `posCtxMenu`（122）
	- `hideAllColorMenus`（130）
	- `hideAllMenus`（134）
	- `showDialog`（146）
	- `hideDialog`（156）
	- `showSendDialog`（160）
	- `hideSendDialog`（188）

###### 14.5 `js/05-actions-init.js`
- 对象
	- `Actions`（6）
	- `LayoutResize`（243）
- 函数
	- `buildOneDriveDialogDefaultName`（304）
	- `normalizeOneDriveUploadName`（311）
	- `formatOneDriveHistoryTime`（318）
	- `formatFileSize`（326）
	- `openOneDriveBackupDialog`（1275）
	- `uploadOneDriveBackupFromDialog`（1360）
	- `refreshOneDriveHistory`（1291）
	- `downloadOneDriveHistoryItem`（1312）
	- `logoutOneDriveAccount`（1300）
	- `initPipelineDropZone`（219）
	- `bindEvents`（341）
	- `init`（449）

##### 15. 全事件监听索引（addEventListener，按模块）

###### 15.1 `js/01-core.js`
- 结果字号
	- `result-font-slider input`（208） -> `ResultFont.apply`
- 富文本工具栏（动态创建）
	- `toolbar-btn mousedown`（292） -> `execCommand(bold/underline/italic/strikeThrough)`
	- `highlight swatch mousedown`（305） -> `execCommand(hiliteColor/backColor)`
	- `text color swatch mousedown`（318） -> `execCommand(foreColor)`
	- `clear format button mousedown`（329） -> `execCommand(removeFormat)`

###### 15.2 `js/02-blocks.js`
- 块颜色与菜单
	- `colorBtn click`（72） -> 切换颜色菜单
	- `colorMenu click`（80） -> 选色、保存 block、刷新 pipeline
- 块行为
	- `cb-header mousedown`（94） -> `BlockDrag.start`
	- `add-btn click`（102） -> `PipelineMgr.add/removeByBlockId`
	- `more-btn click`（117） -> `BlockCtxMenu.show`
	- `canvas-block contextmenu`（124） -> `BlockCtxMenu.show`
	- `cb-name dblclick`（132） -> `BlockEdit.expand`
- 块编辑器
	- `cb-editor keydown`（143） -> `Ctrl+Enter 保存`、`Escape 取消`
	- `cb-name-input keydown`（149） -> `Enter 保存`、`Escape 取消`
	- `save-edit mousedown`（157） -> `BlockEdit.save`
	- `cancel-edit mousedown`（160） -> `BlockEdit.collapse(false)`
	- `editorWrap mousedown`（165） -> 阻止冒泡（防止误触拖拽）
	- `canvas-block mousedown`（168） -> `bringToFront`
- 全局拖拽（拖动期间动态绑定）
	- `document mousemove`（245） -> `BlockDrag._move`
	- `document mouseup`（246） -> `BlockDrag._up`

###### 15.3 `js/04-render-menus.js`
- 侧栏 Canvas 列表项
	- `canvas-item click`（19） -> `Actions.selectCanvas`
- 流水线项
	- `pipeline-item dragstart`（74） -> `PipelineDnD.start`
	- `pipeline-item dragover`（75） -> `PipelineDnD.over`
	- `pipeline-item dragleave`（76） -> `PipelineDnD.leave`
	- `pipeline-item drop`（77） -> `PipelineDnD.drop`
	- `pipeline-item dragend`（78） -> `PipelineDnD.end`
	- `pi-del click`（79） -> `PipelineMgr.removeItem`

###### 15.4 `js/05-actions-init.js`
- Drop Zone
	- `pipeline-drop-zone dragover`（225）
	- `pipeline-drop-zone dragleave`（229）
	- `pipeline-drop-zone drop`（232） -> `PipelineMgr.addBlockToPipelineByDrop`
- 三栏布局
	- `resizer-left mousedown`（259） -> `LayoutResize.start('left')`
	- `resizer-right mousedown`（260） -> `LayoutResize.start('right')`
	- `window resize`（262） -> `LayoutResize.apply`
	- `work-area dblclick`（263） -> 重置宽度
	- `document mousemove`（323） / `mouseup`（324） -> resize 过程
- 核心 UI 绑定
	- `theme-toggle click`（343）
	- `btn-new-canvas click`（347）
	- `btn-rename-canvas click`（350）
	- `btn-duplicate-canvas click`（351）
	- `btn-delete-canvas click`（352）
	- `btn-add-block click`（353）
	- `btn-clear-pipeline click`（356）
	- `btn-copy-rich click`（359）
	- `btn-copy-plain click`（360）
	- `btn-dlg-ok click`（363）
	- `btn-dlg-cancel click`（364）
	- `dialog-overlay click`（365）
	- `dlg-name keydown`（368）
	- `dlg-desc keydown`（372）
	- `btn-send-ok click`（378）
	- `btn-send-cancel click`（379）
	- `send-overlay click`（380）
	- `send-target-canvas keydown`（383）
	- `btn-od-close click` -> `Actions.closeOneDriveBackupDialog`
	- `btn-od-upload click` -> `Actions.uploadOneDriveBackupFromDialog`
	- `btn-od-refresh click` -> `Actions.refreshOneDriveHistory`
	- `btn-od-logout click` -> `Actions.logoutOneDriveAccount`
	- `btn-od-prev click` -> `Actions.prevOneDriveHistoryPage`
	- `btn-od-next click` -> `Actions.nextOneDriveHistoryPage`
	- `od-backup-name keydown` -> `Enter 上传`、`Escape 关闭`
	- `onedrive-overlay click` -> 点击遮罩关闭 OneDrive 备份窗口
	- `canvas-panel contextmenu`（389）
	- `canvas-ctx-menu click`（404）
	- `block-ctx-menu click`（411）
	- `document click`（428） -> 隐藏菜单
	- `document mousedown`（433） -> 块外点击自动保存编辑
	- `DOMContentLoaded`（474） -> `init`

##### 16. 全按钮 -> 处理函数 -> 副作用矩阵

###### 16.1 页面固定按钮
- `#theme-toggle`
	- 入口：`bindEvents`
	- 处理：`Theme.toggle -> Theme.apply`
	- 副作用：切换 body.dark、切换按钮图标、写入 `pb-theme`

- `#btn-new-canvas`
	- 入口：`bindEvents`
	- 处理：`Actions.newCanvas`
	- 副作用：显示新建对话框

- `#btn-rename-canvas`
	- 处理：`Actions.renameCanvas`
	- 副作用：显示重命名对话框

- `#btn-duplicate-canvas`
	- 处理：`Actions.duplicateCanvas`
	- 副作用：复制 canvas+blocks+pipeline 映射，刷新侧栏并切换

- `#btn-delete-canvas`
	- 处理：`Actions.deleteCanvas`
	- 副作用：confirm、删库、切换或空态渲染

- `#btn-add-block`
	- 处理：`Actions.addBlock`
	- 副作用：新增 block、落库、渲染、自动展开编辑器

- `#btn-clear-pipeline`
	- 处理：`PipelineMgr.clear`
	- 副作用：pipeline 清空、块卡状态复位、结果重算

- `#btn-copy-rich`
	- 处理：`Actions.copyResult('rich')`
	- 副作用：clipboard 写 html/plain；失败 fallback；toast

- `#btn-copy-plain`
	- 处理：`Actions.copyResult('plain')`
	- 副作用：clipboard 写纯文本；失败 fallback；toast

- `Data 菜单: export-data`
	- 处理：`Actions.exportData`
	- 副作用：导出 `blocks` 同时包含 `htmlContent` 与 `textContent`（纯文本快照）

- `Data 菜单: import-data`
	- 处理：`Actions.openImportDialog`
	- 副作用：选择 JSON 文件后覆盖导入全部数据

- `Data 菜单: backup-onedrive`
	- 处理：`Actions.backupToOneDrive -> Actions.openOneDriveBackupDialog`
	- 副作用：打开 OneDrive 备份页面（上传 + 历史分页下载 + 退出登录）

###### 16.2 对话框按钮
- `#btn-dlg-ok` -> `Actions.confirmDialog`
- `#btn-dlg-cancel` -> `hideDialog`
- `#btn-send-ok` -> `Actions.confirmSendToCanvas`
- `#btn-send-cancel` -> `hideSendDialog`
- `#btn-od-upload` -> `Actions.uploadOneDriveBackupFromDialog`
- `#btn-od-refresh` -> `Actions.refreshOneDriveHistory`
- `#btn-od-logout` -> `Actions.logoutOneDriveAccount`
- `#btn-od-prev` -> `Actions.prevOneDriveHistoryPage`
- `#btn-od-next` -> `Actions.nextOneDriveHistoryPage`
- `#btn-od-close` -> `Actions.closeOneDriveBackupDialog`

###### 16.3 块内部按钮
- `.color-btn` -> 打开/关闭颜色菜单
- `.cb-color-dot` -> 设置 `pipelineColor` + `DB.saveBlock` + `Render.pipeline`
- `.add-btn` -> `PipelineMgr.add/removeByBlockId`
- `.more-btn` -> 打开块右键菜单
- `save-edit` -> `BlockEdit.save`
- `cancel-edit` -> `BlockEdit.collapse(false)`

##### 17. 键盘与快捷操作矩阵
- 块编辑器 `cb-editor`
	- `Ctrl+Enter`：保存块
	- `Escape`：取消编辑
- 块名称输入 `cb-name-input`
	- `Enter`：保存块
	- `Escape`：取消编辑
- Canvas 对话框 `dlg-name` / `dlg-desc`
	- `Enter`：确认
	- `Escape`：关闭
- 发送对话框 `send-target-canvas`
	- `Enter`：确认发送
	- `Escape`：关闭
- OneDrive 备份文件名输入 `od-backup-name`
	- `Enter`：上传当前数据到 OneDrive
	- `Escape`：关闭 OneDrive 备份窗口

##### 18. 状态变更 -> UI 重绘触发矩阵
- `Actions.selectCanvas`
	- 触发：`Render.sidebar`、`Render.header`、`renderAllBlocks`、`Render.pipeline`、`updateResult`
- `PipelineMgr.add/remove/reorder/clear`
	- 触发：`DB.saveCanvas` + `Render.pipeline` + `updateResult`
- `BlockEdit.save`
	- 触发：`DB.saveBlock` + `setBlockNameUI` + `updateResult` + `Render.pipeline`
- 块颜色改动
	- 触发：`DB.saveBlock` + `applyBlockColor` + `Render.pipeline`
- 删除块
	- 触发：`PipelineMgr.removeByBlockId` + `DB.deleteBlock` + DOM 删除 + `updateCanvasHint`

##### 19. 容错与回退策略矩阵
- IndexedDB 打开失败
	- 处理：顶部固定红色条提示“无法持久化”
- 复制失败
	- 处理：fallback 到隐藏 textarea + `document.execCommand('copy')`
- 校验失败（名称/内容为空）
	- 处理：toast 提示并保持当前编辑态
- 无目标 canvas 可发送
	- 处理：toast“没有可发送的目标 Canvas”
- 无 active canvas 执行新增块
	- 处理：toast“请先选择或新建一个 Canvas”
- 导入块缺失 `htmlContent`（仅有 `textContent/content`）
	- 处理：自动转义并回填为 `htmlContent`（保留换行）
- OneDrive OAuth SDK 加载失败
	- 处理：MSAL SDK 改为 `jsdelivr` 主源，失败自动回退 `unpkg`，仍失败则提示检查网络并可本地下载备份
- OneDrive 上传返回 Tenant 无 SPO 许可证
	- 处理：识别并转为中文可读提示；支持弹窗切换 Microsoft 账号后自动重试；重试失败继续本地下载兜底
- OneDrive 历史列表读取失败
	- 处理：历史区显示失败提示并 toast 报错，可点击“刷新历史”重试
- OneDrive 普通上传失败（网络/权限等）
	- 处理：弹出“是否改为本地下载备份文件”确认，保证数据可落地
- OneDrive 退出登录失败
	- 处理：toast 显示退出失败原因，保留当前控制页面可继续操作
- 高级 OAuth 配置入口移除
	- 处理：Data 菜单仅保留导出、导入、OneDrive 备份，默认使用内置 OAuth 配置

##### 20. 后续 AI 维护准则（文档同步要求）
- 任意新增按钮：必须同步更新“按钮矩阵 + 事件索引 + 状态触发矩阵”。
- 任意新增快捷键：必须同步更新“键盘与快捷操作矩阵”。
- 任意调整 pipeline/block 数据结构：必须同步更新“核心数据模型 + 存储逻辑 + 容错矩阵”。
- 任意重构文件：必须在“更新内容”追加“文件清单 + 迁移说明 + 行为兼容结论”。




### Last Wrning!!！（important）
！！！每次修改后，请将更新内容，添加到本文档内(split-frontend-files.prompt.md)（不需要写更新内容，直接修改已有架构就可以）
