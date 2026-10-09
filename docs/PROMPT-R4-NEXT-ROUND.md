# R4 这一轮：结构 + 提示词（**给我审的，还没动手**）

> 范围就是你点名的五件：多选卡批量导入、R0 三件（改分类搬文件 / 类别同义词 / 变体分列）、
> 跨工程反查、首次自动弹桥接安装窗、导入队列浮层多条并发。
> 本文分两半：**上半是结构（现状 + 方案 + 要你拍的 7 条）**，**下半是提示词**（审完直接回贴给我就行）。
> 现状全部带 `文件:行号`，是这一轮用三个只读探查跑出来的，不是我凭印象写的；没证据的地方明写"未找到"。

---

# 一、结构

## 0. 一句话结论：五件里有三件的"后端已经做完了"

| 那件 | 后端现状 | 真正缺的 |
| --- | --- | --- |
| 跨工程反查 | `installedProjects(db, assetId)` 已存在（`src/main/db/repos/unity.ts:266`，已按 `status='ok'` 过滤）；IPC `unity:import-logs` 已存在（`src/main/bridge/ipc.ts:300`）；`import_log` 的列早就为这件事设计过（V5 注释原文） | **渲染层一次都没调用过**（`window.a.unity.importLogs` 在 `src/shared/api.ts:315`、`preload:119` 有声明，全仓零调用者）+ 详情面板没有那块 UI |
| 导入队列多条并发 | 主进程**已经在逐条广播** `unity:import-progress`（`src/main/index.ts:127`）；`commitMemberImport` 的 `onItem` 回调参数存在（`memberImport.ts:375`） | `ipc.ts:435` 调 `commitMemberImport` 时**没把 `onItem` 传进去** → 事件其实一直是空的；渲染层**没有订阅者**（只订了 `unity:command-busy`，`ui.ts:429`）；`ImportFlowState` 是单对象不是数组（`ui.ts:37-85`） |
| 变体分列 | `dims:[{kind,values}]` 已算出来（`product.ts:210`），类型、IPC、preload、渲染侧类型**四层都通**（`assets:groups` → `api.ts:130`） | 渲染层没有调用者；卡片徽章只读 `variantCount`（`AssetGrid.tsx:140/213`） |

这三件合起来其实是**同一类病**：链路建到 IPC 就停了，没人接最后一米。
所以它们的成本主要在 UI 与验收，不在设计。

另外两件（批量导入、改分类搬文件）是真要写主进程逻辑的。

## 1. 交付顺序（对你给的顺序提一处改动，要你拍）

你写的顺序是：批量导入 → R0 三件 → 反查 → 首次弹窗 → 队列并发。
我建议把**队列并发（含进度事件）挪到批量导入之前**，理由：批量导入的验收原文就是
「多选 5 个 → 串行执行 → **进度可见** → 全部成功」，而"进度可见"要的那套东西
（`onItem` 传进去 + 渲染层订阅 + 状态从单对象改成数组）正是队列并发那一件。
先做它，批量导入就是"往一个已经会显示多条的浮层里灌多条"；反过来做就是浮层改两次、测两次。

```
① 进度与队列（onItem 接上 + 订阅 unity:import-progress + ImportFlowState 队列化 + 多条浮层）
② 多选卡批量导入（跨卡 plan/commit + 一个 batchId 串整批 + 整批倒序撤销 + 复用闸门）
③ 改分类搬文件（含顺手修"改完分类不重建索引"这个 bug）
④ 类别同义词（+ 汉字→日语读音那条要不要做，见 Q5）
⑤ 变体分列
⑥ 跨工程反查
⑦ 首次自动弹桥接安装窗（+ 把 bridgeAutoInstall 这个死设置接上）
⑧ 文档 / 覆盖表 / verify-red-r4 / 沙盒活体 / 全量验证 / 打包
```

每完成一段可验证工作就提交一次，并跑 `npm test` + `npm run typecheck`。

## 2. 逐步：要动哪里、复用什么、坑在哪

### ① 进度与队列

- **接上断掉的那根线**：`ipc.ts:435` 调 `commitMemberImport` 时传 `onItem`，
  在回调里 `registrar.broadcast('unity:import-progress', …)`；渲染层 `bindEvents` 里订阅它。
- **状态队列化**：`ImportFlowState`（`ui.ts:37-85`）从"当前一个"改成
  `items: ImportItemView[]` + `activeIndex`，**保留现有单条字段作为"当前项"的兼容读法**，
  免得 `ImportFlow.tsx` / `chrome.tsx:130` 那个 `queueLength` 数字一起翻车。
- **判据抽成纯函数**：`src/shared/importQueue.ts`（新建）负责"一批里第几条在跑 / 第几条未执行 /
  失败要不要停"这类状态转移，组件只做薄壳映射 —— 这是 M6 那套"零 DOM 测试也要有回归保护"的路子。
- ⚠ 坑：进度事件是**主进程→渲染**的广播，不在 invoke 白名单里；`tests/renderer/ipc-channels.spec.ts`
  会要求它登记在 `IpcEvent` 白名单（这条测试一上线就抓到过三个漏登记的通道）。

### ② 多选卡批量导入

现状：`unity:import-plan` 的入参是 `{assetId, members[], projectId?, password?}` —— **单个 assetId + 它自己容器内的成员**；
`MemberPlan`（`memberImport.ts:107-121`）把 `containerAssetId / containerPath / extractDir` 当**全批共享**的一个值。
散装单包走另一条 `unity:import-package`（`ipc.ts:480`），单包、**没有 batchId**（journal 的 batchId 回退成 importId，`coordinator.ts:478`）。

要做成"跨卡批量"，四件事必须一起处理，否则会出现"记账记错形状"：

1. **入参换成条目数组**：`items: [{assetId, packagePath?, memberRelPath?}]`，每条自带来源；
   `MemberPlan` 的容器三兄弟改成 per-item（否则 V5 那三列会把散装卡写成"某容器的成员" ——
   `memberImport.ts:467` 的注释就是防这个的，M5-B 有专门用例）。
2. **抽取目录按 assetId 分组**：现在 `allocMemberDir(root, containerAssetId, i)`（`:275`）按单一容器分层；
   多卡不分组的话 `extract-clean` 的 busy 判定（`ipc.ts:556`）会认错人、副本收不回。
3. **一个 batchId 串整批**：撤销靠 `rollbackOrderOfBatch`（`journal.ts:263`，`ORDER BY j.id DESC`，只取 `status='ok'`）
   —— 排序机制现成、不用改；但散装直导那条以前不传 batchId，批量时必须显式传同一个，否则"整批退回"捞不到条目。
4. **待确认计划的暂存上限**：`MAX_STAGED_PLANS = 4`（`ipc.ts:200`）是"最多同时留着 4 批未确认的计划，挤掉就删副本"。
   批量 + 多批待确认时这个数与淘汰策略要重新定（见 Q2/Q3）。

复用不动的：三道抽取根闸门 `assertExtractRootUsable`、`PROJECT_LEVEL_REASONS` 整批中止、
串行 + 等终态、失败停手不自动回滚、备份落 `backups/rollback/<importId>/`。
Ctrl+Z 白名单**继续排除** `import` / `import_rollback`（`journal.ts:98-107` 的原文理由成立：
一次容器导入会留 N 条共用 batch_id 的行，混进 Ctrl+Z 会把撤销链钉死）——
但 `undo.ts:244` 那句 `case 'import': throw '…将在 M5 交付'` 是**死分支**，要改成明确文案或删掉。

### ③ 改分类搬文件

现状（`src/main/ipc/assets.ts:185-216`）：校验分类表之后只 `patchAsset(...)` + `recordCorrection`，
**不碰磁盘、不写 journal、也不调 `reindexAsset`**。

- **顺手抓到一条 bug**：`docs/SEARCH.md:42` 写着"改分类会增量重建索引"，实现里没有这一行 ——
  也就是说现在改完分类，**用新分类的词去搜还搜不到**，得等下次全量重建。这条要一起修并加用例。
- 归档逻辑是现成的：`commit.ts:317-346`（`renderSegments` 模板 → `uniquePath` → `mkdir` journal）
  → `:352` 写 `op:'move'` journal 再 `moveFile` → `:395` 落行；模板在 `template.ts:61-80`；
  目录别名 `dirAliases.ts:17-33`（`衣服` vs `服装` 那条就在那）。
  所以"改分类搬文件"= 把这套按**新分类**重放一遍，改 `library_path / source_path / cover_image`，
  同一个 `batchId` 让 Ctrl+Z 整批撤（`op:'move'` 本来就在白名单里）。
- `storageMode==='indexed'`（只登记不搬，`commit.ts:268-311`）或 `libraryRoot` 为空时**一律不搬**，
  只改记录 —— 这条判断必须显式写，不能靠"模板拼不出来"隐式失败。
- ⚠ 未定：合集子项 / 附属资源的路径是拼出来的（`commit.ts:163-215`），改父级分类时要不要连带搬（见 Q4）。
- ⚠ **这一件会动 `E:\vrc\A` 磁盘**，是这一轮唯一直接碰你真实素材的。沙盒验完 + 你要点头 + 先备份，我才执行。

### ④ 类别同义词

现状：`resources/lexicon/categories.json`（987 行）**没有任何 synonyms/alias 字段**，
类型 `types.ts:402-419` 也只有 `topicTags?`；索引侧 token 拼装只有一处
`search/aliases.ts:77-87 buildAliases` + `labelTriple :125-137`（吃三语 label）。
所以补法就是 `docs/SEARCH.md` §4 自己写的那条：**给分类表加 `synonyms`，而不是在检索层硬编码词表**。

- 要动：`categories.json` 每个 category/subcategory 加 `synonyms`（三语各一份还是只中文，见 Q5）
  → `types.ts` 两个接口 → `services/categories.ts:11-26 validate`（现在不剥未知字段，加了要校验）
  → `buildAliases` 并入 catWords → 设置页能看到/能改（`TaxonomyPanel`）。
- 查询侧不用改：`index.ts:175-217` 已经走 `expandQuery`。
- **汉字→日语读音**（`sokubaku` 搜不到 `束縛`）：`normalize.ts:138-176` 现在汉字段只丢 `pinyin-pro`（出中文拼音）、
  假名段丢 `wanakana`。要支持就得挂几 MB 的 Kanji 读音词典，而 `docs/SEARCH.md:48-53` 当时的结论是
  "多音字照样错，建议把原名写进备注"。**这条要不要翻案，见 Q5**（它决定这一轮多不多一个依赖）。

### ⑤ 变体分列

数据四层都通（见 §0 表），只差渲染。要动：列表加载处取 `assets:groups()`（或让卡片 SQL 直接带出 dims）
→ `AssetGrid.tsx:140/213` 按 `dims` 分列 → 三语加 `kind` 文案键（现在只有 `variants` 一个键）。
⚠ 未找到：`dims.kind` 与 `VariantKind` 枚举在前端的对齐处；聚合卡与容器型 `unitCount/childCount` 谁优先。
⚠ 性能：`summarizeGroups` 是全表展开 + 每组成员 N+1 查询（`product.ts:184-215`），
卡片页要不要按需取子集，做的时候实测一下 5 万条那档（`tests/perf/scale.spec.ts` 有现成规模）。

### ⑥ 跨工程反查

后端齐了（`installedProjects` + `unity:import-logs`），要动的是：
详情面板（`DetailPanel.tsx`，现在只有当前工程的 `importState` 和单条 `lastImport`）加一块
"在哪些工程装过（N）"列表 → 走 `installedProjects`，**并明确写清口径**：
它查的是 `import_log`，所以"用户自己在 Unity 里手动 Import 过的"**查不到**（桥接不认识那次），
这条限制必须写在界面上，不能让它看起来像完整答案。
⚠ 真正的 GUID 级索引（`project.guid_index_at` 那一列）**是死的**：只有 `setProjectGuidIndex`（`unity.ts:244`）
会写，全仓无调用方，GUID 实际存在 `setting` 表键 `projectGuids:<id>`；而 C# 那边
`list_project_assets` 只回 `installedPackages`、`resolve_guids` 只查传入的 GUID **不枚举** ——
所以"工程里现在到底有哪些 GUID"这件事**当前桥接答不了**，要答就得改 C#（本轮不做，见 Q6）。

### ⑦ 首次自动弹桥接安装窗

现状：`installBridge`（`installer.ts:105`）前置校验齐（模板在否 `checkBridgeTemplate:49`、
目标恒在 `Packages/` `bridgeTargetDir:75`、写 `op=bridge_install` journal `:141`）；
`isBridgeInstalled`（`mailbox.ts:275`）判 `Packages/com.avca.bridge/package.json` 存在；
`installer.ts:99` 明写"弹窗由调用方负责"。Project 页那个按钮（`Project.tsx:154`）只 toast，**没有三按钮弹窗**。

规格 R-10 的三按钮原文（`docs/M5A-SPEC-NOTES.md:178`）：**`[安装] [以后都自动安装] [暂不]`**。

要新增三样：
1. **"首次发现这个工程"的边沿**：`project/api.ts` 的 `register()`（:209）/ `upsertProject` 插入支（:44-71）
   现在**没有**"新工程"广播（只有 `project:running-changed` 与 `unity:auto-switch`）→ 加一条边沿判定 + 广播。
2. **三按钮 dialog**：判据抽成纯函数（`shared/bridgeAsk.ts`：这个工程该不该问 → `never/ask/quiet`），
   组件薄壳。措辞要按 M6 Q3 那条教训写清"以后都自动安装"是**这个工程以后自动装**，不是开机自启。
3. **"问过/不再问"的持久化**：**未找到任何现有位置**（`project` 无该列、`setting` 无该键）。
   两条路：`setting` 表键 `bridgeAsk:<projectId>`（和 `projectGuids:<id>` 一个路子，不动 schema）
   vs schema **V7** 加列。我倾向 setting 键（见 Q7）。
4. **顺手**：`bridgeAutoInstall` 这个设置项（`types.ts:706` / `defaults:42` / 设置页 `Settings.tsx:357`）
   **主进程无一处读取** —— 它是第二个"死设置"，和 M6 刚接活的 `autoSwitchBehavior` 同一类。
   "以后都自动安装"按下去之后必须真被读，并加一条"读源码钉接线"的用例。

## 3. 要你拍的 7 条（我给了推荐，你不回我就按推荐做）

| # | 问题 | 我的推荐 |
| --- | --- | --- |
| **Q1** | 队列并发挪到批量导入**之前**做（浮层只改一次）？ | **是**，按 §1 的顺序 |
| **Q2** | 跨卡批量的上限：复用 `IMPORT_BATCH_MAX = 8`，还是新常量？ | **复用 8**，超过就自动切批、一批一次确认；绝不允许主进程和界面各写一个数（M5-B 为这件事专门补过用例） |
| **Q3** | 批量导入遇到 GUID 冲突：一批一次覆盖决定（沿用 M5-B 的"这一次决定覆盖上面这批全部"），还是逐包问？ | **一批一次**，汇总卡写清"几个新文件 / 几个包有冲突"（单位分开的教训也沿用） |
| **Q4** | 改分类搬文件：合集子项 / 附属资源跟着父级一起搬吗？ | **跟着搬**，同一个 batchId 整批可撤；且**搬之前给预览**（N 个文件、目标目录、会覆盖谁），确认才动盘 |
| **Q5** | 汉字→日语读音（`sokubaku`→`束縛`）：翻案引几 MB 词典，还是维持 `SEARCH.md` 的收口（不做，界面提示"把原名写进备注"）？ | **维持不做**，但把提示做进"改分类/改备注"那块的文案里。引词典的准确率收益我判断不值那个体积，且多音字照样错 |
| **Q6** | 反查的口径：只读 `import_log`（=只查得到经 A 导过的），够不够？ | **够**，本轮不改 C#；界面上明写"你在 Unity 里手动导入的查不到"。GUID 级枚举留给以后改桥接 |
| **Q7** | "问过/不再问"存哪：`setting` 键（不动 schema）还是 V7 加列？ | **setting 键**，和 `projectGuids:<id>` 一致；加列要为这一件事动迁移，不值 |

## 4. 红线（一条都不许松，全部沿用）

1. 真库在 `%APPDATA%\A\library.db`、素材库在 `E:\vrc\A`、8 个工程在 `E:\ALCOMprojects`。
   **对这三样任何一项的写操作，先说明、先拿到同意。** ③ 改分类搬文件是唯一直接动素材磁盘的。
2. 删除一律走回收站（`shell.trashItem`），永不永久删除。
3. 缓存 / 暂存 / 备份 / 抽取根**绝不落在 C:**。
4. 桥接只装 `Packages/`，不装 `Assets/`；`delete_guids` 必须双重校验（白名单 + `Assets/` 前缀），
   绝不提供按 GUID 随便删的接口；**剪贴板式"手写 .meta"绝对禁止**。
5. `AssetDatabase.ImportPackage` 是异步的，三个回调串行推进，**绝不连发**；
   busy 不是失败，退避序列 `1s→2s→5s→10s→30s→30s…` 固定不可改；
   通信只用 `Temp/` 下的文件信箱，不许改成 TCP/HTTP/命名管道。
6. **活体一律带 `AVCA_APP_HOME`**；**起实例之前先确认你的 Unity 没开着** ——
   沙盒实例照样会发现真工程并对运行中的真工程发只读命令（本轮 19:06 已越界一次，见 `docs/BRIDGE.md` §13.4）。
7. 写完回归用例必须**回退确认会红**；断言 API 存在/顺序之前先 `stripComments()`；
   绝不用 PowerShell `Get-Content`/`Set-Content` 改源码；`verify-red-r4` **单独跑**，不跟别的重活并行。
8. 跑测试前 `powershell -File tools/killdev.ps1`；A 在跑时用 `node:sqlite` readOnly 读真库。
9. "实现了"不等于"生效了"；没验证过的写"未验证"，不许含糊成"应该可以"。

## 5. 验收（做到什么程度算完）

- §8-4 真机/沙盒活体：多选 5 个 `.unitypackage` → 一键导入 → 串行执行 → 进度可见（多条）→ 全部成功 → 整批倒序退回。
- 反查：一张卡能看到"在 shinano-Main2 装过（时间、ok）"，且限制文案在屏幕上。
- 改分类：改完文件真到新目录、`library_path` 跟着改、Ctrl+Z 整批搬回原目录且字节一致、**新分类的词立刻搜得到**。
- 同义词：`yifu` 搜到 `服装`（真库数据上验，不是合成数据）。
- 变体分列：一张多体型卡在列表/卡片上按维度分列，数据来自 `dims` 而不是重新数一遍。
- 首次弹窗：新工程第一次被发现时弹一次三按钮，点"暂不"之后同一工程不再弹；
  点"以后都自动安装"之后 `bridgeAutoInstall` **真被主进程读到**（读源码 + 行为两条都钉）。
- 全量：`npm run typecheck` 干净、`npm test` 全绿、`verify-red-r4` 每处修复都会红、`npm run build` 出包 + 打包版真跑一遍。

---

# 二、提示词（审完把这段回贴给我就行）

```
阅读 docs/PROMPT-R4-NEXT-ROUND.md，按里面的顺序开工。

七条裁定我拍了：Q1=___ Q2=___ Q3=___ Q4=___ Q5=___ Q6=___ Q7=___
（没填的按你文档里的推荐做，但要在第一次汇报里写明"这条我按推荐做了"。）

要求：
1. 这一轮要的是能跑的代码，不要再出设计文档；结构就在附件里，照它做。
2. 顺序按 §1 的 ①→⑧，每完成一段可验证工作就提交，并跑 npm test + npm run typecheck。
3. 做完 ① ② 先报一次（我要看批量导入那条链真的能串行、进度真的看得见）。
4. ③ 会动 E:\vrc\A 磁盘：沙盒验完先停下来给我看证据，拿到我点头才在真库上跑。
5. 每段该给截图的就给截图（浮层多条、详情面板反查、变体分列、三按钮弹窗），
   截图存 docs/screenshots/r4-*.png。
6. ⑧ 里必须包含：verify-red-r4（至少覆盖：批量入参的来源三列不许混填、一个 batchId 串整批、
   改分类之后索引真的重建、synonyms 真的进索引、bridgeAutoInstall 真的被读、
   首次弹窗只问一次）+ spec-coverage 的 R4 对账表 + selfcheck-r4 + 沙盒活体 + 全量验证 + 打包。
7. 起沙盒实例之前先确认我 Unity 没开着，或者先问我一句。
8. 没验证过的写"未验证"，别含糊。
```
