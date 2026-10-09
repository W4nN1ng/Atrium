# Atrium（A 素材管家）改动报告

> **交接对象**：接手继续开发的 Agent
> **报告日期**：2026-10-06
> **基线提交**：`fdcd73f`
> **当前提交**：`781c8d7`
> **改动规模**：21 个提交，75 个文件，+12909 / −146 行
> **最终验证**：`740 通过 / 7 跳过`，两个 `tsc` 干净，工作区干净

---

## 0. 一句话总结

甲轨（V4/#40 落库与跨目录误并修正、收件箱持久化）与乙轨 M5-A（Unity 桥接 C#、文件信箱、三路工程探测、顶栏切换器、单包导入、冲突预扫描、撤销导入）**全部落地**。
**M5-A 已在真 Unity + 用户真工程上跑通**（这一步确认了"可以用"）。
过程中挖出并修掉 **12 个真 bug**，其中 **5 个只有真机才能暴露**、**2 个是本次会话自己引入的**。所有修复都配了回归用例，并且**每条用例都验证过"把修复回退掉它真的会红"**。

---

## 1. 提交清单（按时间顺序）

| # | 提交 | 内容 |
|---|---|---|
| 1 | `d482d01` | **甲轨** V4 迁移落库 + 拆开跨目录误并的归并组（真库 8 拆 / 5 留） |
| 2 | `24fb268` | 补「重新分析」只读预览与真库最终状态记录 |
| 3 | `acd0025` | **收件箱持久化** —— 重启后待确认卡片不再凭空消失 |
| 4 | `dff630b` | **M5-A** 文件信箱 + 三路工程探测 + C# 桥接包 |
| 5 | `568e585` | chore：删掉误提交的临时文件 |
| 6 | `e58bf32` | **M5-A** `BridgeManager` —— 命令下发 + busy 退避 + 串行闸门 + 多实例隔离 |
| 7 | `75de06a` | 更新规格笔记进度 |
| 8 | `cb2f075` | **M5-A** 单包导入 + 冲突预扫描 + 撤销导入；顺带修掉 unitypackage 解析器两个真 bug |
| 9 | `04e02fd` | 记录解析器 bug 与「假回归用例」的教训 |
| 10 | `9e6a620` | **M5-A** 桥接安装/卸载 + IPC 接线（替掉 7 个「未实现」占位通道） |
| 11 | `65cc554` | **M5-A** 顶栏工程切换器 + Project 页装上真实桥接操作 |
| 12 | `4de732d` | **M5-A** 双击导入流程 + `docs/BRIDGE.md` |
| 13 | `cfeb8a1` | 交付前自查脚本 |
| 14 | `63022bb` | `bridge/ipc.ts` 真实集成测试（26 项）+ 修三处被它暴露的缺陷 |
| 15 | `55c8cb5` | 自查表与覆盖表补全 |
| 16 | `e660aa5` | **用 Unity 自带 Roslyn 离线编译验证 C#** —— 推翻"只能靠用户点一下" |
| 17 | `f84d798` | **修** C# 从来没写过 `busy`（Play 模式下导入会失败而不是排队） |
| 18 | `525768a` | 规格 94 条硬规则逐条对账 + `docs/BRIDGE.md` 内容检查 |
| 19 | `81552d8` | **修** 三路运行状态探测是死代码（工程页一直显示"未运行"） |
| 20 | `2677075` | **修** WMI 兜底路从来没成功过 + 一批测试不稳定（EPERM 被算成失败） |
| 21 | `781c8d7` | **修** C# Tick 顺序死锁（退出 Play 后命令永远不被处理） |

---

## 2. 甲轨（库清理）

### 2.1 V4 迁移与 #40 落库（`d482d01`）

**已在真库上执行**（`%APPDATA%\A\library.db`）：

- `user_version 3 → 4`
- 新增 `asset_group.dir_key`、`asset.parent_asset_id` / `is_bundle` / `container_kind` / `attachment_kind` / `variant_raw`
- **拆开 8 个跨目录误并的组**（17 行，新增 16 组）
- **保留 5 个"同商品两种形态"的组**（zip + 解压副本，按裁定 #16 必须保持合并）
- 跨目录组：**13/27 → 5/10**

**备份**（两份）：
- `%APPDATA%\A\library.db.bak-before-regroup-20261006-0317`
- `E:\vrc\_db备份\library.db.bak-before-regroup-20261006-0317`
- 原始 SHA256：`2DF5C5B29DE3382B11060E4FF255B0DA69909829E053A14728259ABE86390702`

**撤销**：`journal id=591 op=reparent`（17 处改动），Ctrl+Z 可回滚。

### 2.2 新增模块

| 文件 | 作用 |
|---|---|
| `src/main/library/regroup.ts` | `planRegroup(db)` 只读预览 + `applyRegroup(db, plan)`；`sameProductTwoForms()` 判别器 |
| `src/renderer/components/RegroupPanel.tsx` | 设置 → 维护，同时显示"将拆分"与"刻意保留"两栏 |
| `tests/library/regroup.spec.ts` | 13 项，路径取自真库探针 |
| `tests/real/realdb-regroup.spec.ts` | 环境变量门控：`AVCA_DRYRUN_REGROUP=1` / `AVCA_APPLY_REGROUP=1 AVCA_APPLY_CONFIRM=执行真库` |
| `tests/real/realdb-reanalyze-preview.spec.ts` | `AVCA_PREVIEW_REANALYZE=1` |

**判别器要点**：必须同时看 `library_path` 与 `source_path`。压缩包那一侧的 `library_path` **就是**同名的目录，zip 名只出现在 `source_path`。
规则：恰好一个压缩包扩展名路径，且存在一行其路径等于"压缩包名去掉扩展名"，且**不是**同目录下 `NAME.zip` + `NAME/` 并存。

### 2.3 重新分析（`24fb268`）

真库重跑结果：**只有 1 行变化**（容器 `6447797` 体积差 617 MB），0 改名、0 降级、0 垃圾，`journal id=593 op=reanalyze`，计数不变 134/19/5/156/59。

### 2.4 收件箱持久化（`acd0025`）

`%APPDATA%\A\inbox.json`（version 1，原子写，上限 `INBOX_QUEUE_MAX = 500`，超出丢最旧）。
**只持久化源路径** —— 不持久化 `WorkerResult`（重跑是确定性的），不持久化密码（仅会话内）。

真重启验证：`收件箱恢复：捞回 2 项、跳过 0 项、剔除已不存在 0 项`；幂等（`recovered:0 / skipped:2`）；去重（`accepted:[]`）；dismiss 生效（2→1）；源缺失被剔除（`剔除已不存在 1 项`）。

新增：`src/main/services/inboxQueue.ts`、`src/main/ingest/queuePolicy.ts`、`tests/main/queue-policy.spec.ts`、`tests/services/inboxQueue.spec.ts`。

---

## 3. 乙轨 M5-A

### 3.1 文件信箱与协议（`dff630b`）

```
<Project>/Temp/AVCABridge/
  ├─ bridge.json          Unity 写 → A 读（心跳）
  ├─ inbox/<id>.json      A 写 → Unity 消费后删
  └─ outbox/<id>.json     Unity 写 → A 读后删
```

- `src/main/bridge/mailbox.ts` —— 原子写（tmp+rename）、`readJsonSafe`、心跳读/解析、`isHeartbeatStale`、`sendCommand`（busy 重投**复用同一个 id**）、`readResult`/`consumeResult`/`cancelCommandFile`、`isTerminal`、`isBridgeInstalled`、`listCommandFiles`（跳过 `.tmp`）
- `resources/unity-bridge/com.avca.bridge/` —— 自包含零依赖桥接（`[InitializeOnLoad]`、500ms Tick、2 秒心跳、串行导入队列、双重校验的 `delete_guids`）
- `tests/bridge/fake-unity.ts` —— **真的在监听 `inbox/` 的假对端**，按 §2.4 ack 契约行事

### 3.2 三路工程探测

| 文件 | 作用 |
|---|---|
| `src/main/project/lockfile.ts` | `probeUnityLockfile` 用 `fs.openSync(file, 'r+')`（**读写**，不是 `r`）；`HELD_CODES = {EBUSY, EPERM, EACCES}` |
| `src/main/project/wmi.ts` | PowerShell `Get-CimInstance Win32_Process`，`parseProjectPathFromCommandLine`，永不抛 |
| `src/main/project/running.ts` | `detectRunning()` 三路取并集；`applyDetection()` 只在**真的变了**时写库 |
| `src/main/project/api.ts` | 接线点（见 §5-bug-4） |

### 3.3 `BridgeManager`（`e58bf32`）

- 按 `projectPath` 分开状态（**不是全局单例**）
- per-project promise chain 串行化
- busy 退避：`1s → 2s → 5s → 10s → 30s → 30s…`（最多 60 次）
- chokidar 监听 `outbox/` + 250ms 轮询双保险
- `waitForAny()` 单一 `setTimeout` 源（避免事件循环饥饿）
- `dispose()` → `cancelled`（不是 `error`）

### 3.4 单包导入 / 冲突预扫描 / 撤销（`cb2f075`）

`src/main/import/coordinator.ts`：
`chunk` / `preflight` / `backupOverwritten` / `readBackupManifest` / `pruneBackups(trashFn, keep=20)` / `importUnitypackage` / `rollbackImport` / `findPackages` / `packagesOfAsset`

关键设计：**导入前重新跑一次预扫描**，不信任界面传来的冲突列表（用户可能隔几分钟才点确认）。

### 3.5 安装/卸载与 IPC 接线（`9e6a620`）

`src/main/bridge/installer.ts`：
- 装到 **`Packages/com.avca.bridge`**，**绝不进 `Assets/`**（§1.2：否则会跟着 Avatar 传上 VRChat）
- 卸载**走回收站**（`trashFn` 可注入）
- 装过不重复复制（别把用户手改过的覆盖回去，除非 `force`）
- 写 `journal`（`bridge_install` / `bridge_uninstall`）

`src/main/bridge/ipc.ts`：替掉 `ipc/stubs.ts` 里 7 个抛「未实现」的通道。
**契约改动**：`importAsset(assetIds)` → 拆成 **`preflight` + `importPackage` 两步**（§5.1④ 要求冲突时必须列出具体文件路径，一步到位用户就永远没机会在覆盖前看见要覆盖什么）。

### 3.6 界面

| 文件 | 内容 |
|---|---|
| `src/renderer/components/chrome.tsx` | 顶栏工程切换器（原来显示的是 ULID，tooltip 写"M6 交付"） |
| `src/renderer/pages/Project.tsx` | 真实 `bridgeInstalled`、装/卸桥接按钮、露出运行判定**依据**（`lockfile`/`bridge`/`wmi`）、残留锁文件徽章 |
| `src/renderer/components/ImportFlow.tsx` | **常驻**的导入界面：冲突确认对话框（列具体路径 + 三选一）+ 进行中提示 + 排队提示 + 结果条（带撤销） |
| `src/renderer/stores/ui.ts` | `importFlow` 状态机 |

**为什么 `ImportFlow` 必须常驻**：发起导入的地方有好几个（卡片双击、详情面板、Enter 键），冲突对话框要等用户决定。放在发起方组件里，宿主一卸载（切页/切筛选）对话框就跟着消失，而导入还挂在后台。

### 3.7 文档

- **`docs/BRIDGE.md`** —— 协议完整说明（三个文件格式、ack 与终态契约、九条命令各自的 payload 与结果示例、"busy 不是失败"、Unity 侧 11 条实现约束、`ImportPackage` 异步那个第一大坑、**PowerShell 手动模拟一条命令的片段**、A 侧与 Unity 侧排障入口、测试覆盖表、数据落在哪）
- **已知限制一节**（§8）：A 没运行时感知不到 Unity 启动、`Temp/` 会被清理、管理员权限的 Unity WMI 读不到命令行、Play 模式不能导入、`UnityLockfile` 必须读写模式试开、自动切换集合未做、压缩包成员提取未做

---

## 4. 验证结果

### 4.1 最终状态

```
740 通过 / 7 跳过（747）
两个 tsc 干净
工作区干净
C# 编译通过（用 Unity 2022.3.22f1 自带 Roslyn 对着真实引擎程序集）
```

### 4.2 真机验证（用户在真 Unity + 真工程上操作，确认"可以用"）

| 项 | 结果 |
|---|---|
| 桥接装进 `shinano-Main2` | ✓ `journal id=594 op=bridge_install`（**通过 A 的界面装的**，installer 链路真机通过）|
| `bridge.json` 每 2 秒刷新 | ✓ `heartbeatUtc` 递增，`pid=13188` 与 Unity 编辑器进程一致 |
| `[InitializeOnLoad]` 被调用 | ✓ Console 打出 `[AVCA] 桥接已就绪` |
| A 解析心跳 | ✓ `pid` / `unityVersion` / `bridgeVersion` / `protocolVersion=1` / `activeScene` 全对 |
| 三路探测两路命中 | ✓ `detectedBy: ['bridge','lockfile']` |
| `Assets/` 零污染 | ✓ Unity 自己给桥接包生成了 `.meta`，印证"不手写 .meta"那条规则 |
| Play 模式排队 | ✓ 界面显示「已排队（Unity 正在运行 Play 模式）· 第 N 次重试」|
| 退出 Play 后导入完成 | ✓（死锁修复 + 重编译之后）|

### 4.3 离线验证手段（新增，值得保留）

**`tools/check-bridge-compile.cjs`** —— 用 Unity 自带 Roslyn 离线编译 C# 桥接：

```bash
node tools/check-bridge-compile.cjs
# 或 npm test → tests/bridge/compile-check.spec.ts
```

这一层能抓住最致命的失败（编译不过 = 用户装完 Console 直接报错、桥接完全不工作）。
**它推翻了之前"C# 只能靠用户点一下"的判断** —— Unity 安装目录里带着编译器与全部引用程序集。

### 4.4 真库保护

- 真库：`user_version = 4`，372 行，134/19/5 结构不变
- 素材库：2304 文件，**一个字节没动**
- **8 个 Unity 工程里只有 `shinano-Main2` 装了桥接**（本次会话用户主动装的）；安装/卸载的测试全部跑在临时工程上
- **本会话全程零破坏性操作**

---

## 5. 12 个真 bug（这是本报告最重要的部分）

### 只有真机才能暴露的 5 个

#### bug-1｜C# 从来没写过 `busy`（`f84d798`）

`busy` 只出现在 `IsBusy()` 与心跳的 `busyReason` 里，**从来没被写进 `outbox/`**。后果链条：

1. Unity 忙（Play/编译/刷新）时不消费命令 —— 这部分对了
2. 但**没回写 busy**，A 侧收到的是**沉默**
3. A 等满 ack 超时（10 秒）报「桥接没有回应」，命令**失败**
4. **A 侧那整套 1s→2s→5s→10s→30s 退避在生产里永远不会被触发**
5. 验收 §8-5（Play 模式下点导入 → 排队 → 退出 Play 后自动执行）**过不去**

规格 §2.5 原文「不消费命令，**直接写回 `busy` + `busyReason`**」—— 后半句漏了。
修法：新增 `ReportBusyToPending()`，给 inbox 里每条未消费的命令写 busy 结果，**不删 inbox 文件**。

> 这条是**协议对账测试**发现的（`tests/bridge/protocol-conformance.spec.ts`）——
> 把 C# 源码里的命令名、payload 键名、状态字面量、心跳字段名与 TS 类型逐一对账。
> 字段名/枚举值拼错**不会编译报错、不会类型报错**，在真机上表现为"命令发出去永远没回应"。

#### bug-2｜Tick 顺序死锁（`781c8d7`）—— **本次会话自己引入的**

我加 `ReportBusyToPending()` 时改变了 `Queue` 的状态，而下面的守卫会因此永久提前返回：

```csharp
if (IsBusy()) { ReportBusyToPending(); return; }  // 内部 RefreshQueue → Queue 变 1
if (Queue.Count > 0) return;                      // 从此永远在这里返回
RefreshQueue();                                   // 再也跑不到
```

死锁链条：进 Play → A 发命令 → `ReportBusyToPending()` 把它读进 `Queue`（同时回 busy）
→ 退出 Play → 不再忙，但 `Queue.Count > 0` → **直接 return** → `RefreshQueue()` 永远调不到
→ **那条命令永远不被处理**。

修法：把 `RefreshQueue()` 提到忙判定**之前**（仅次于心跳）。
真机表现：界面正确显示"已排队"，退出 Play 后**什么都没发生**。

#### bug-3｜三路运行状态探测是死代码（`81552d8`）

`src/main/project/running.ts` 写得很完整，**但没有任何地方 import 它**。
`project/api.ts` 的 `refresh()` 直接 `return listProjects(db).map(toProjectInfo)`。

真机表现：用户开着 `shinano-Main2`，工程页显示**"未运行"** ——
而同一页的说明写着"运行状态三路取并集判定"。**文案在说谎。**

修法：`unity:list-projects` / `unity:refresh-projects` 两个 handler 都改成 async 并跑
`detectRunning` → `applyDetection`；状态变化广播 `project:running-changed`；
每 `PROJECT_POLL_MS`（3 秒）轮询兜住"Unity 被关掉"。

顺带修：`register()` 原本硬写 `isRunning: false`，**每轮 refresh 都把探测结果抹掉**；
`toProjectInfo` 的 `detectedBy` 把"工程从哪发现的"（vcc/scan）与"凭什么说它在运行"（bridge/lockfile/wmi）混成一个字段。

#### bug-4｜WMI 兜底路从来没成功过（`2677075`）

旧脚本 `"$($_.ProcessId)|$($_.CommandLine)"` 里那对**双引号**在
`execFile` → `CreateProcess` → PowerShell 之间被吃掉，`|` 变成管道运算符：

```
Expressions are only allowed as the first element of a pipeline.
```

**三路探测的第三路一直是坏的**，而且坏得安静（永不抛、只记 `debug`，被另外两路遮住）。

修法：脚本改用 `@($_.ProcessId, $_.CommandLine) -join '|'`（**不含任何双引号**）
+ `-EncodedCommand`（UTF-16LE + Base64）传输。失败时第一次给 `warn`（之后静默）。

#### bug-5｜`project.bridge_version` 永远是 null

`applyDetection` 只写 `is_running` / `last_seen`，**从没写过 `bridge_version`**。
界面看不出来（返回的 `list` 用活的心跳值覆盖了），但那一列是死数据，
`toProjectInfo` 里"还没探测过时的兜底 `detectedBy`"和任何直接查库的人都被误导。
修成"插值变了才写"（不是每轮都写）。

### 其余 7 个

| # | bug | 说明 |
|---|---|---|
| 6 | **unitypackage 解析器的 `./` 前缀** | 真包的 tar 条目全带 `./` 前缀，`filter(Boolean)` 保留 `'.'` → `parts[0]==='.'` → 所有 pathname 撞车 → **只解析出 1 个条目、GUID 也错**。修 `filter((s) => s && s !== '.')` + `normalizeGuid` |
| 7 | 解析器加早退**挂住 tar** | 加了早 `return` 导致 tar 流不消费，60 秒超时。必须**先 `entry.resume()`** |
| 8 | 心跳陈旧判定**恒为假** | 用"我们读到它的时刻"当 `seenAt` → 永远新鲜。中间版本用 `max(mtime, heartbeatUtc)` **也错**。正确判据是**文件 mtime**，`heartbeatUtc` 只作兜底 |
| 9 | `waitForResult` 事件循环饥饿 | `Promise.race([waiter, ..., sleep(250)])` 饿死定时器（400ms 才 1 tick，应 8 个）。改成单个 `setTimeout` 的 `waitForAny()` |
| 10 | busy 重试读到**陈旧回声** | 重投前没消费旧结果，重试次数凭空多算一次（实测报了 3 而真值是 2）。修 `consumeResult()` |
| 11 | `dispose()` 报 `error` 而非 `cancelled` | `waitForAny` 改成返回判别联合 `{kind: 'value'|'timeout'|'disposed'}` |
| 12 | `journal.appendJournal` 的 `?? null` | 把显式 `null` 变成 `''`。修成 `opts?.batchId === undefined ? null : opts.batchId` |

另外 `paths.ts` 在非 Electron 环境下读 `app.isPackaged` 会抛（测试环境 `app` 是 undefined）——
新增 `isPackaged()` / `appPath()` 安全封装。

---

## 6. 测试基础设施的三处修正（接手的 Agent 会直接受益）

### 6.1 测试之间共享运行时目录

`paths.ts` 未初始化时 `root()` 退回 `%TEMP%/A-uninitialized` —— **进程级共享**。
并行跑的 `tests/bridge/ipc.spec.ts` 与 `tests/import/coordinator.spec.ts`
会互相删对方的备份（`pruneBackups` 只留最近 20 次），于是"撤销能还原"那条
**单跑绿、全量红**。

新增 **`setAppPathsForTest(dir)`**，两个文件各自指到自己的临时目录。

### 6.2 `fs.rmSync` 的 `force` **不管 EPERM**

`force: true` 只忽略 `ENOENT`。`child.kill()` 之后 PowerShell 子进程还短暂持有锁文件句柄，
删除抛 `EPERM` —— 而这个错误发生在 `afterEach` 里，会被算成**用例失败**，
**断言其实全过了**。8 连跑里红 2~4 次。

修法：清理加重试（等句柄释放），实在删不掉留给系统。

### 6.3 轮询定时器可注入

`startProjectWatcher(registrar, { pollMs })`，`pollMs: 0` 关掉定时器（只给测试）。
开着的话它会在用例执行到一半插进来跑一轮探测，把时序搅乱 ——
而 `applyDetection` 的 `previous` 是**模块级状态**，多实例互相干扰。
测试改为显式调新增的 `api.detect()` 推进。

---

## 7. 五条被反复验证的教训（**请务必保留这些习惯**）

### 7.1 "假回归用例"—— 踩了三次

写了回归用例不等于它真的覆盖了那个 bug。**必须把修复回退掉、确认用例真的会红。**

三次实例：
1. `./` 前缀那个 bug 的第一版用例是假的 —— `tar.create(cwd, ['./', ...])` 会让 tar 也输出一套规范化后的非 `./` 条目，有 bug 的代码照样通过。正确写法是 `tar.c(..., { prefix: './' })`
2. `ReportBusyToPending` 那条：第一版只断言源码里含**函数名**，把调用删掉、只留空定义，它照样通过
3. 那条"端到端跑一遍"的死锁用例：把 C# 改回旧顺序它**照样通过**，因为 `FakeUnity` 一看到 inbox 文件就立刻消费，**没有真桥接那套 `Queue` + 守卫结构**。已改名并注明局限

### 7.2 `force: true` 不管 EPERM —— 清理失败会伪装成断言失败

### 7.3 判断"有没有调用某 API"**必须剥掉注释**

C# 文件里大段引用了要禁止的写法（"不要用 `DisplayProgressBar`"），
`not.toContain('DisplayProgressBar')` 会被自己的文档注释绊倒。
判断**代码顺序**同理 —— 注释里引用了那两行代码，`indexOf` 会命中注释里的副本。
`tests/bridge/protocol-conformance.spec.ts` 里有 `stripComments()` 工具函数。

### 7.4 用**真数据**验，不要只看单测绿

12 个 bug 里有 5 个是单测全绿时照样存在的（死代码、引号被吃、从不写 busy、
字段永不落库、Tick 顺序死锁）。**"实现了"不等于"生效了"。**

### 7.5 改源文件**不要用 PowerShell 的 `Get-Content`/`Set-Content`**

会加 BOM（JSON 直接解析失败）、会mangle 中文（`U+FFFD`）。
本次会话因此毁过 `coordinator.ts` 并被迫重写。**用编辑器工具。**

---

## 8. 当前状态与待办

### 8.1 已完成

- **甲轨**：V4/#40 落库与跨目录误并修正、重新分析、收件箱持久化
- **M5-A 全部**：C# 桥接、文件信箱、三路探测、顶栏切换器、单包导入、冲突预扫描、撤销导入、`docs/BRIDGE.md`
- **真机验收**：§8-1（心跳）、§8-2 部分、§8-3（双击导入）、§8-5（Play 排队 + 退出后执行）、§8-6（冲突列路径）、§8-7（撤销）—— 用户确认"可以用"

### 8.2 M5-A 范围内**未做**（不要以为做完了）

| 项 | 说明 |
|---|---|
| **自动切换集合 + 顶部横幅**（规格 §1.7 那 12 条里的 10 条） | 属 M6。顶栏切换器是**手动**选的，不会自动切。`AUTO_SWITCH_COOLDOWN_MS` 常量已就位 |
| **压缩包型容器的成员提取** | 这是 `03` 规格本身的漏洞。交接说明里定了"M5-B 之前必须先出设计文档回答十个问题"的前置条件，**没有擅自开工** |
| 首次安装桥接的自动弹窗（R-10） | 依赖"发现新工程"那条链，属 M6 |
| `bridgeAutoInstall` 的实际生效路径 | 设置项存在、默认 `false`，但没有自动触发点 |

`tests/spec-coverage.spec.ts` 里有完整盘点：**范围内 81 条（行为测试 50 / 静态检查 29 / 仅文档 2），范围外 13 条**。

### 8.3 仍未在真 Unity 里验证的

- §8-4 多选 5 个批量串行导入（M5-B 的批量）
- §8-9/10/11 A 自动置顶、切集合、横幅"以后都这样"（M6）
- §8-12 桥接被手动删除后的"桥接未安装 [立即安装]"提示
- §8-13 两个 Unity 工程同时打开时的多实例顶栏显示
- §8-14 A 在托盘中运行、启动 Unity 后自动弹出
- §8-15 杀掉 A 进程再启动，运行中的 Unity 工程能被重新发现

### 8.4 建议的下一步（按推荐度）

1. **M5-B 设计文档**（纯离线产出）—— 回答"压缩包型容器的成员如何提取"那十个问题。这是 `03` 规格的明确漏洞，且用户早就点名要
2. **M6 自动切换集合 + 横幅**（离线可测，验收 §8-9/10/11 的内容）
3. 补 §8-12/13/15 的验证（都需要真 Unity 配合）

---

## 9. 环境与操作备忘（接手的 Agent 必读）

### 9.1 关键路径

| 项 | 值 |
|---|---|
| 工程根 | `C:\程序\A素材管家` |
| 运行时数据 | `%APPDATA%\A`（**文件夹名是 `A`，不是 Atrium**）|
| 素材库根 | `E:\vrc\A`（25 GB / 2304 文件）|
| Unity 编辑器 | `E:\unity\2022.3.22f1\Editor\Unity.exe` |
| Unity 项目 | `E:\ALCOMprojects\`（8 个真工程 + 2 个 `_backup_*` 被正确排除）|
| 已装桥接的工程 | `E:\ALCOMprojects\shinano-Main2\Packages\com.avca.bridge` |

### 9.2 命令

```bash
npm test                    # 会自己把原生模块切到 Node ABI 137
npm run typecheck           # 两个 tsc
npm run native:node         # 切成 Node ABI（直接跑 vitest 前需要）
npm run native:electron     # 切回 Electron ABI（跑 dev 前需要）
npm run dev                 # 开发（tools/dev.cjs 会清掉 ELECTRON_RUN_AS_NODE）
npm run dev:debug           # 带调试端口 9222
node tools/check-bridge-compile.cjs   # 离线编译 C# 桥接
node tools/selfcheck-m5a.cjs          # 交付项自查
node tools/probe-lib-state.cjs        # 真库只读体检
powershell -File tools/killdev.ps1    # 停掉 dev
node tools/cdp-eval.cjs --file <js>   # 通过 CDP 在真界面上求值
```

### 9.3 本机环境陷阱

1. **`npx` 被 PowerShell 执行策略拦** → 用 `npm.cmd` 或 `node_modules\.bin\vitest.cmd`
2. **`ELECTRON_RUN_AS_NODE=1`** 在 DSH 里被设置，会导致 Electron 报 `Cannot read properties of undefined (reading 'isPackaged')` → `tools/dev.cjs` 会清掉它
3. **A 运行时锁住 `better_sqlite3.node`** → 跑测试前必须停 A（`tools/killdev.ps1`）
4. **`git commit -m` 带 markdown `**`** 会被当 pathspec → 写进文件用 `-F`
5. **PowerShell 里包含引号的 `node -e` 会解析失败** → 写成 `.cjs` 文件
6. 只有 Node **runtime**（7.0 / 10.0），**没有 SDK** → 用 Unity 自带的 Roslyn 编译 C#（见 `tools/check-bridge-compile.cjs`）
7. 读真库时若 A 正开着，`better-sqlite3` 是 Electron ABI → 用 **`node:sqlite`**（Node 24 自带，支持 `readOnly`）

### 9.4 真库上的破坏性操作纪律

- **删除一律走回收站**（00§五-5）。`shell.trashItem`（生产）或注入的 `trashFn`（测试）
- **绝不手写 `.meta`** —— 用 `FileUtil.CopyFileOrDirectory` + `AssetDatabase.Refresh()`
- **`delete_guids` 双重校验**：GUID 必须在该次导入的 `createdGuids` 白名单里，且路径必须以 `Assets/` 开头，任一不满足**整条拒绝**
- **备份清理绝不 `rm -rf`** —— 那目录里是用户工程里被覆盖的原文件，走回收站
- 缓存/暂存/备份**绝不落在 C:**（C: 只剩 ~14 GB 余量）

---

## 10. 给接手 Agent 的三条提醒

1. **`docs/BRIDGE.md` 是协议的唯一权威文档**，改动 C# 或 A 侧协议时必须同步更新。
   `tests/docs.spec.ts` 会检查它的小节完整性、9 条命令是否齐全、`json` 代码块能不能被 `JSON.parse` 解析，以及「已验证」的出现次数不许超过给出的可执行依据次数。

2. **`tests/bridge/protocol-conformance.spec.ts` 是防止"静默失效"的关键防线。**
   它把 C# 与 TS 的字面量逐一对账。改任何一边的名字/枚举值都要跑它。

3. **`tests/spec-coverage.spec.ts` 记录了 94 条硬规则的归属与证据强度。**
   如果新增/推迟了某条规则，要显式改那张表 —— 它会断言"标了 outOfScope 的不许声称有测试"（防虚报覆盖）。

---

## 附：本次会话新增的文件清单

**核心实现**
```
src/main/bridge/{installer,ipc,mailbox,manager}.ts
src/main/import/coordinator.ts
src/main/project/{lockfile,running,wmi}.ts
src/main/library/regroup.ts
src/main/services/inboxQueue.ts
src/main/ingest/queuePolicy.ts
src/renderer/components/{ImportFlow,RegroupPanel}.tsx
resources/unity-bridge/com.avca.bridge/{package.json,Editor/AVCA.Bridge.asmdef,Editor/AVCABridge.cs}
```

**测试（新增 18 个 spec + 1 个假对端 helper）**
```
tests/bridge/{compile-check,fake-unity,installer,ipc,lockfile,mailbox,manager,protocol-conformance,real-template}
tests/import/coordinator
tests/library/regroup
tests/main/queue-policy
tests/project/{apply-detection,running-wiring}
tests/services/inboxQueue
tests/docs
tests/spec-coverage
tests/real/{realdb-regroup,realdb-reanalyze-preview}
```

**工具**
```
tools/check-bridge-compile.cjs    用 Unity 自带 Roslyn 离线编译 C# 桥接
tools/dev.cjs                     dev 启动器（清 ELECTRON_RUN_AS_NODE）
tools/selfcheck-m5a.cjs           交付项逐项自查
tools/probe-*.cjs                 6 个真库只读探针
```

**文档**
```
docs/BRIDGE.md                    协议说明 + 已知限制 + 排障
docs/TRIAGE-A-2026-10-06.md       甲轨交接状态
docs/M5A-SPEC-NOTES.md            （更新）规格蒸馏笔记
```
