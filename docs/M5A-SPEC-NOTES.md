# M5A 规格笔记 · Unity 桥接与工程联动

> **来源**：`C:\Users\<你>\Desktop\A-开发提示词\03-Unity桥接与工程联动.md`（712 行，全文读完之后蒸馏）。
> 跨份约束取自 `00-先读我.md` 第五节、`01-总纲与基础框架.md` §5/§7/F4/§9/§11/§12，
> 以及增量改动单 `04`/`05` 里明确覆盖 03 的那几条。
>
> **引用记法**：`§n` = 第 3 份的章节号；`01§n` / `00§n` / `04§n` / `05§n` = 另外几份。
> 引号内、代码块内的中文短句是**原文照抄**，不是我的转述。规则一律带 `R-nn` 编号，实现时可以逐条勾。
>
> **本文用途**：M5A（桥接 + 单包导入）的实现基线。**不是**代码，不是设计提案。
> 规格里写"必须"的地方，一律照做；规格没写的地方不要自己发明，先看 §11 开放问题。
>
> ---
>
> ## ⚠ 实现进度（2026-10-06 更新，别再照本文的"现状"列判断有没有做过）
>
> 本文表格里的**「现状」列**是 2026-10-05 下午写的，那之后已经动过手。逐条更正：
>
> | 本文原话 | 2026-10-06 的实际情况 |
> |---|---|
> | §0「`src/main/bridge/` 目录**目前不存在**」 | **已存在**：`mailbox.ts`（文件信箱：原子写、心跳、inbox/outbox 生命周期） |
> | §0「C# 侧只有空占位」 | **已不是空占位**：`resources/unity-bridge/com.avca.bridge/` 下有完整 `package.json` + `Editor/AVCA.Bridge.asmdef` + `Editor/AVCABridge.cs` |
> | R-04 落点「`src/main/bridge/` **待建**」 | 已建 |
> | R-20 落点「现状：**未接**」（chokidar 监听 bridge.json） | **已接**：`bridge/manager.ts` 用 chokidar 盯 `outbox/`（结果落盘立刻唤醒等待者）。心跳本身由 `project/running.ts` 每 3~5 秒读，不用 chokidar —— 见该文件注释 |
> | R-37/R-38/R-39/R-40 的落点 | `project/lockfile.ts`、`project/wmi.ts`、`project/running.ts` **都已实现**（三路取并集） |
>
> 已完成并**有测试**的部分（`tests/bridge/`，61 项）：
>
> | 模块 | 覆盖 |
> |---|---|
> | `bridge/mailbox.ts` | 原子写（tmp+rename）/ `.tmp` 跳过 / 终态删除权归读方 / 心跳陈旧判定 / 协议版本校验 / 命令重投复用 id |
> | `project/lockfile.ts` | `UnityLockfile` 独占试开，含**跨进程用 .NET `FileShare.None` 模拟真 Unity 持锁** |
> | `project/wmi.ts` | 命令行解析，含"CommandLine 为 null 就整行跳过"（正是主路径不能靠 WMI 的原因） |
> | `project/running.ts` | 三路取并集；只在状态真变了才 UPDATE |
> | `bridge/manager.ts` | 命令下发 / busy 退避（1-2-5-10-30s）/ 串行闸门 / 多实例隔离 / 事件+轮询双通道 / dispose→cancelled |
> | `import/coordinator.ts` | 预扫描 → 冲突确认 → 备份 → 串行导入 → 记账 → 撤销；26 项单测（假桥接） |
> | `bridge/ipc.ts` | 12 个通道的**真实集成测试** 26 项：接真 `BridgeManager` + `FakeUnity`，从 IPC 边界一路跑到文件信箱 |
>
> ### ✅ C# 桥接**已经离线编译验证过**（2026-10-06，推翻之前的"只能靠用户点一下"）
>
> Unity 安装目录里带着编译器与全部引用程序集，所以"能不能编过"完全可以自己测：
>
> ```bash
> node tools/check-bridge-compile.cjs     # 或 npm test → tests/bridge/compile-check.spec.ts
> ```
>
> 用 **Unity 自带的 Roslyn**（`Editor/Data/DotNetSdkRoslyn/csc.dll`）对着
> **2022.3.22f1 真实的引擎程序集**编译 `AVCABridge.cs` → **编译通过，输出 19.5 KB**。
>
> 这一层能抓住最致命的失败（编译不过 = 用户装完 Console 直接报错、桥接完全不工作）。
>
> ⚠ 踩过的坑：**不要引用 `UnityEngine.dll` / `UnityEditor.dll` 这两个门面程序集**，
> 它们转发到 `*.CoreModule.dll`，两边都引会报
> `CS0433: 类型 InitializeOnLoadAttribute 同时存在于 …CoreModule 和 UnityEditor`。
>
> **仍然只能真 Unity 验的**：`[InitializeOnLoad]` 静态构造真被调用、
> Tick 与 2 秒心跳真在跳、`ImportPackage` 三个回调真按序触发、
> Play 模式下真写回 busy、`FileUtil` + `Refresh()` 真生成 `.meta`。
>
> ### ⚠ unitypackage 解析器有两个**预先存在**的真 bug（已修，2026-10-06）
>
> 拿规格指定的测试包（`E:\vrc\A\lilToon_2.x.x\jp.lilxyzw.liltoon-2.x.x-installer.unitypackage`）
> 跑一次就露馅 —— **它只有 1 个条目，而真实是 3 个**：
>
> 1. **`./` 前缀没滤掉**。真包 **12/12 条**条目名都带 `./`
>    （`./`、`./<guid>/`、`./<guid>/pathname`），而 `rel.split('/').filter(Boolean)`
>    **不会**去掉 `'.'`（它是真值）→ `parts[0]` 恒为 `'.'` → 所有 pathname
>    写进同一个键互相覆盖 → **整个包只解析出 1 条**、guid 全错。
>    后果：`createdGuids` 前后差集算错、`resolve_guids` 冲突扫描失效、封面可能挑错条目。
>    **修法**：`filter((s) => s && s !== '.')` + 把 guid 规范化成 32 位 hex。
>
> 2. **不消费 entry 流会让 tar 解析卡死**。加了"认不出 guid 就跳过"之后必须
>    `entry.resume()` —— tar v6 只在 entry 被消费或 resume 之后才推进下一条，
>    直接 `return` 会让整个解析挂满超时（实测挂到 60 秒）。
>
> 真库核对：`package_entry` 表 **0 行**，没有脏数据要迁移。但这个 bug 是
> M5-A 冲突扫描的地基，不修就会在导入时炸。
>
> #### 那条回归用例第一版是假的（教训值得记）
>
> 我用 `tar.create(cwd, ['./', './<guid>', ...])` 造"带 `./`"的包 ——
> **tar 会同时写一份不带 `./` 的规范化条目名兜底**（实测 9 条里一半是干净的），
> 于是 buggy 代码照样解析正确、用例**假通过**。
> 必须用 `tar.c(..., { prefix: './' })` 才全带前缀（实测 3/3）。
> **验证方法**：把修复临时回退成 buggy 版，看用例是否真的失败 —— 现在它会失败。
> 凡是"回归用例"，都该这样自证一次。
>
> mock 对端在 `tests/bridge/fake-unity.ts`：它**真的监听 `inbox/`**、照 §2.5 的 ack 契约
> 行事（终态才删 inbox、busy 留着让 A 重投、进度按时间推流），不是打桩。
>
> ### 实现过程中被测试抓出来的四个真 bug（都写进代码注释了，别再犯）
>
> 1. **心跳陈旧判定恒为 false**：拿"我们读它的时刻"当依据 → 那个值永远是刚读的。
>    Unity 崩了、桥接脚本被禁了、`bridge.json` 冻结一周，程序都坚称它活着。
>    必须以**文件 mtime**（桥接最后一次写的时刻）为准。中途改成
>    `max(mtime, heartbeatUtc)` **仍然是错的**——`heartbeatUtc` 就是写入那一刻的当下时间，
>    和写入同时发生，取 max 等于没改。
> 2. **事件循环饿死**：`Promise.race([waiter, disposedPromise, sleep(250)])` 里那个
>    getter 每次迭代都参与竞争，且它正常永不 resolve，三者混在一起会让循环退化成
>    微任务空转。实测 execute 期间 400ms 内测试自己的 `setInterval` 只 tick 1 次
>    （正常 8 次），对端永远拿不到 CPU。**只能有一个 setTimeout 当定时源。**
> 3. **busy 重投读到回声**：busy 分支不消费 outbox → 重投后第一次读结果又读到自己
>    刚处理过的旧 busy，`retries` 凭空多一次。发送前显式清 + 读到即消费。
> 4. **dispose 被误报成"桥接没回应"**：`waitForAny` 把超时和被打断都返回 `undefined`。
>    必须返回可区分的信号，dispose → `cancelled`。
>
> ### 测试侧的三处"假失败"（同样值得记）
>
> - 假对端的尝试计数**不能按轮询次数**：真 Unity 读到同一条命令不会重复执行，
>   只有 A 退避重投（覆写同一文件）才算又一次。判断"命令变没变"要用**内容 hash**
>   （`size:mtime` 会撞车：重投的字节长度相同、mtime 还可能落在同一毫秒）。
> - 进度的语义是**按时间推流**。只回一条 `progress` 就沉默的话，A 会正确地判成
>   "导入中断"——那条测试就永远测不到"进度不终止等待"。
> - "busy 时命令还在 inbox"只能在**对端处理之前**断言（busy 之后对端不会删 inbox，
>   所以那一刻之后它就变了）。
>
> 还没做：单包导入编排、冲突预扫描、撤销导入、顶栏切换器、自动切换集合、
> 桥接安装/卸载、`docs/BRIDGE.md`。
>
> ### 实测修正：`UnityLockfile` 判据有一个坑（本文 R-38 没写）
>
> R-38 说「配合"尝试独占打开"来判断」。实测（2026-10-06）**必须用 `r+`（读写）而不是 `r`（只读）**：
> Unity 是持 `_SH_DENYWR`（禁止写）打开锁文件的，只有请求写权限才会被拒。
> 用只读去试，Unity 开着的时候也能打开，这一路就永远判"没在运行"。
>
> 验证方法（能复现，不需要 Unity）：PowerShell 用
> `[System.IO.File]::Open(path,'Open','ReadWrite','None')` 持住文件，
> 此时 Node 的 `openSync(path,'r+')` 抛 **EBUSY**，而 `'r'` 能打开。
> 注意**不能用 Node 自己当持有者**：Node/libuv 的 open 带共享标志，不构成独占，
> 即使跨进程也测不出来（第一版测试就是这么假失败的）。

>
> **优先级裁定（00§一）**：「改动单是「覆盖」不是「替换」……冲突处以改动单为准」，
> 所以 04/05 覆盖过的条款以本文为注的最新版为准（见 §10.5 覆盖表）。

---

## 0. 范围先说清楚（免得做到一半发现越界）

03 自己只写了两个里程碑归属：

- `§0 锚点`：「《Unity 桥接与工程联动》—— 桥接 C# 脚本、导入队列、工程探测、自动切换集合 → **里程碑 M5/M6**」
- `00§三`：第 5 轮 =「`03-Unity桥接与工程联动.md` + 说「实现 M5」」交付「Unity 桥接脚本 + 单包导入」；
  第 6 轮 =「说「继续 M6」」交付「批量导入 + 自动切换分区」。

**本仓库有一个命名坑要先知道**：README 与 `src/main/db/schema.ts` 里的 `M5-1 / M5-2 / M5-3`
指的是**增量改动单 04/05**（三级容器、一键入库、附属资源），和 03 的 `M5` **同号不同物**。
所以本文用 `M5A` 指"03 的第 5 轮那一段"。切分依据见 §10。

`src/main/bridge/` 目录**目前不存在**（`ls` 实测无此路径），C# 侧只有空占位：
`resources/unity-bridge/com.avca.bridge/Editor/`（空）+ `resources/unity-bridge/README.txt`
（原文：「桥接包模板在 M5 交付；这个目录先占位，electron-builder 的 extraResources 需要它存在。」）。

---

## 1. 硬性规则清单（必须 / 不得 / 禁止 / 一定不）

共 **94 条**（R-01 … R-94）。"落点"列 = 实现这条的文件/位置。

### 1.1 全局前提（5 条）

| # | 原文 | 落点 |
|---|---|---|
| R-01 | §0 锚点：「**三份共享的既定前提（不得更改）**」——技术栈 Electron 33+ / TS 严格模式 / React 18 / Tailwind / Radix / better-sqlite3 / Vitest | 已满足（package.json） |
| R-02 | §0 锚点：「Unity 版本固定 **2022.3.22f1**（VRChat 标准版），路径 `E:\unity\2022.3.22f1\Editor\Unity.exe`」 | 设置项 `unityExePath`（默认 `''`） |
| R-03 | §0 锚点：「数据库 schema 以**第 1 份 §5** 为准；本文主要使用 `project` / `import_log` / `package_entry` / `journal` 表」 | `src/main/db/schema.ts` |
| R-04 | §0 锚点：「本文的代码放在 `src/main/bridge/` 和 `src/main/project/`，C# 脚本模板放在 `resources/unity-bridge/`」 | `src/main/bridge/` **待建** |
| R-05 | §0 锚点：「所有"必须"字样都是踩过坑的结论，**不要用你认为更优雅的方式替换**。」 | 全程 |

### 1.2 桥接的安装与卸载（10 条）

| # | 原文 | 落点 |
|---|---|---|
| R-06 | §1 标题：「桥接脚本的安装方式（**必须严格按此实现**）」 | `bridge/installer.ts` |
| R-07 | §0：「用户已在工程里装过 `com.coplaydev.unity-mcp`……但**不要依赖它**，我们的桥接**必须自包含、零第三方依赖**」 | C# 侧 |
| R-08 | §1.2 标题：「为什么**必须用 `Packages/` 而不是 `Assets/`**（**不得更改**）」 | installer 目标路径 |
| R-09 | §1.2 表格：「VRChat 上传 Avatar 时只处理 `Assets/`，桥接脚本**绝不会**混进用户的 Avatar」 | 同上（这是理由，不可改成 Assets/） |
| R-10 | §1.3 安装 1：「首次为某工程安装时**必须弹窗告知**」+ 原文文案 + 三按钮 `[安装] [以后都自动安装] [暂不]` | dialog |
| R-11 | §1.3 安装 3：「写 `journal`（op = `bridge_install`），记录目标路径，供卸载/回滚」 | 现状：`JournalOp` 已含 `bridge_install` |
| R-12 | §1.3 安装 5：「**Unity 在后台时不会自动编译**，可以调用 `Unity.exe -projectPath <path>` 或提示用户切到 Unity 窗口」 | 安装完成提示 |
| R-13 | §1.3 卸载：「删除 `<Project>/Packages/com.avca.bridge/` 整个目录（**走回收站，不永久删除**）」 | `shell.trashItem` |
| R-14 | §1.3 自动安装：「设置项 `自动为新工程安装桥接`（**默认关**）。开启后，发现新工程时自动安装但**在 UI 上明确提示**装了什么、装到哪，并提供一键卸载。」 | `bridgeAutoInstall: false`（现状已对） |
| R-15 | §1.3 卸载：「设置页提供"从所有工程卸载桥接"按钮」 | Settings → Unity |

### 1.3 文件信箱（8 条）

| # | 原文 | 落点 |
|---|---|---|
| R-16 | §2.1 标题：「为什么用 `Temp/`（**不得改用 TCP / HTTP / 命名管道**）」 | 协议层 |
| R-17 | §2.1：「**已知限制（必须在 UI 中说明）**：`Temp/` 是临时目录，Unity 未运行时桥接不存在，因此"检测 Unity 是否运行"**不能只靠桥接**，需要 §4 的多路探测。」 | Settings + 已知限制文档 |
| R-18 | §2.2：「**心跳间隔 2 秒**（由 `EditorApplication.update` 驱动）」 | C# Tick |
| R-19 | §2.2：「A 侧若 **10 秒**未更新心跳 → 判定该实例已退出，清理该实例但**保留 project 记录**」 | `BRIDGE_STALE_MS = 10000`（现状已对） |
| R-20 | §2.2：「A 侧用 chokidar 监听所有已知工程的 `Temp/AVCABridge/bridge.json`」 | 现状：**未接** |
| R-21 | §2.3：「写入方式：**先写 `<id>.json.tmp`，再 `fs.rename` 成 `<id>.json`**（原子，避免 Unity 读到半截文件）」 | `bridge/mailbox.ts` |
| R-22 | §2.4：「文件名固定为 `<id>.json`，Unity **覆写**同一文件来表示进度更新（A 侧 chokidar 监听 `change` 事件；覆写同样用 tmp + rename 保证原子）」 | 两侧 |
| R-23 | §2.4：「终态（`ok`/`error`/`cancelled`）写出后，Unity 删除 `inbox/<id>.json`；A 读到终态后删除 `outbox/<id>.json`」 | 删除权归读方 |

### 1.4 busy 与重试（4 条）

| # | 原文 | 落点 |
|---|---|---|
| R-24 | §2.5：「A 侧收到 `busy` 后**必须排队重试**，退避序列固定为：`1s → 2s → 5s → 10s → 30s → 30s → …`（最多重试 60 次，约 25 分钟）。」 | `BUSY_BACKOFF_MS`（现状已对） |
| R-25 | §2.5：「**绝对不能把 `busy` 当成失败。**」 | 状态机 |
| R-26 | §2.5：「正确行为是排队，等退出 Play 模式后自动执行，并在 UI 上显示"Unity 正在运行/编译，已排队（第 3 位）"。」 | 队列 UI |
| R-27 | §9-4：「**不要在 Unity 忙（编译 / Play / 刷新）时强行导入** —— 写回 `busy` 并排队。」／§9-5：「**不要把 `busy` 当失败重试上限很小** —— 用户可能一整晚开着 Play 模式。」 | C# + A |

### 1.5 命令面（5 条）

| # | 原文 | 落点 |
|---|---|---|
| R-28 | §3 标题：「**必须实现的命令清单**」——9 条 type 全部实现，不做子集 | `BridgeCommandType`（现状已列全 9 个） |
| R-29 | §3：`resolve_guids`「**批量查 GUID 是否已在工程中**，单次 ≤ 2000 个，超出分批」 | `GUID_BATCH_SIZE = 2000` |
| R-30 | §3：`delete_guids`「回滚用。**只删 `Assets/` 下、且是本次导入新建的文件**」 | C# 校验 |
| R-31 | §3 `list_project_assets`：「反射查找（找不到类型时返回空数组，**不能抛异常**）」 | C# |
| R-32 | §3 `list_project_assets`：「`installedPackages`：读 `Packages/manifest.json` 的 `dependencies` 键名 + 已解析的包名」 | C# |

### 1.6 工程探测（9 条）

| # | 原文 | 落点 |
|---|---|---|
| R-33 | §4.1 路径 2：「判定标准：目录下存在 `ProjectSettings/ProjectVersion.txt`」 | `isUnityProject()` 已实现 |
| R-34 | §4.1 路径 2：「扫描深度 ≤ 3，跳过 `Library` / `Temp` / `obj` / `.git` / 以 `_backup` 开头的目录」 | `scanProjectRoots(maxDepth=3)` 已实现 |
| R-35 | §4.1 路径 2：「实测这个目录下还有 `_backup_shinano-Little-2.1_20260926_133646` 这类用户手动备份，以及 `shinano-Little-2.rar`，**必须能识别并跳过**（前者是备份副本，后者是压缩包不是工程）」 | 已满足 |
| R-36 | §4.1 路径 1：「**注意大小写与转义**：JSON 里是双反斜杠，解析后就是普通 Windows 路径。」 | `readVccManifest()` |
| R-37 | §4.2：「⚠️ **必须把方法 3 仅作兜底**：若 Unity 以管理员权限启动，非管理员进程读不到它的 `CommandLine`（返回 null）。这是 Windows 的既定行为，不是 bug。**不得把方法 3 当作主路径**，否则用户会遇到"A 检测不到 Unity"的诡异问题。」 | `project/wmi.ts` |
| R-38 | §4.2 补充：「`Temp/UnityLockfile` 在 Unity 异常退出时可能残留，所以方法 2 需要配合"尝试独占打开"来判断，**不能只看文件是否存在**。」 | `project/lockfile.ts` |
| R-39 | §4.2 轮询频率：「WMI 查询：**每 5 秒**一次（WMI 查询本身较慢，**不要更频繁**）」 | 定时器 |
| R-40 | §4.2：「`UnityLockfile` 检查：每 3 秒一次（很轻量）」／「桥接心跳：由 chokidar 事件驱动，**无需轮询**」 | 定时器 |
| R-41 | §4.2：「三者结果合并，**任一命中即认为工程在运行**」 | 合并器 |

### 1.7 自动切换 + 顶栏 + 横幅（12 条）

| # | 原文 | 落点 |
|---|---|---|
| R-42 | §4.3 步骤 1：「**首帧拿不到时先用项目名匹配，拿到后再刷新一次。**」 | fingerprint |
| R-43 | §4.3 步骤 2：「匹配时对 fingerprint 与 keywords 都做归一化（小写、去符号、假名转罗马字）」 | `shared/normalize.ts` + wanakana |
| R-44 | §4.3 步骤 2：「多个集合命中时取 `priority` 最高者；并列则取关键词最长的（更具体）」 | matcher |
| R-45 | §4.3 步骤 3：「设置页**必须明确说明**："A 需要常驻托盘才能感知 Unity 启动"，并提供 `开机自启（最小化到托盘）` 开关，**默认开启**」 | ⚠️ 现状 `autoLaunch: false`（有意偏离，见 §11-Q14） |
| R-46 | §4.3 步骤 3：「切换到匹配到的集合视图（**只切换左侧选中项和过滤条件，不清空用户当前搜索框**，除非搜索框为空）」 | 见 §11-Q10 |
| R-47 | §4.3 步骤 3：「顶部显示一条横幅（**10 秒后自动淡出，可固定**）」 + 三按钮语义；「`以后都这样` → 把本次的工程路径写进该集合的 `rule_json.projectPaths`（**精确匹配，优先级最高**）」 | `CollectionRule.projectPaths` 已有 |
| R-48 | §4.3 步骤 4：「手动选中的工程作为**导入目标**（**未运行的工程不能导入**，选中时提示"该工程未运行"）」 | topbar |
| R-49 | §4.3 防打扰规则（**硬性**）：「同一工程 **5 分钟内只自动切换一次**」 | `AUTO_SWITCH_COOLDOWN_MS` |
| R-50 | §4.3：「设置项 `自动弹出行为`：`每次 / 仅当匹配到集合 / 从不`（**默认"仅当匹配到集合"**）」 | `autoSwitchBehavior: 'when_matched'`（已对） |
| R-51 | §4.3：「A 处于用户主动操作中（有未保存的编辑、正在拖拽）时**不打断**，只更新顶部横幅」 | 焦点/拖拽态判定 |
| R-52 | §9-14：「**不要在自动切换集合时清空用户的搜索框** —— 用户正在找东西时被打断会非常恼火。」 | 同 R-46 |
| R-53 | §9-13：「**不要忘记多实例** —— 所有状态**必须**按 `projectPath` 区分，**不能用一个全局单例**。」 | BridgeManager |

### 1.8 导入流程 / 队列 / 撤销（14 条）

| # | 原文 | 落点 |
|---|---|---|
| R-54 | §5.1①：「校验目标工程：是否运行中？桥接是否就绪？否 → 提示"请先打开 Unity 工程 xxx"，或"桥接未安装 [立即安装]"」 | coordinator |
| R-55 | §5.1③：「分批（每批 2000）调用 `resolve_guids`」 | preflight |
| R-56 | §5.1④：「有冲突 → 弹窗」列出**具体文件路径** + `[取消] [继续] [继续并备份被覆盖文件]` | dialog |
| R-57 | §5.1⑤：「**逐条**发送 import_unitypackage / import_files；**每条等待终态（ok/error/cancelled）才发下一条**」 | 串行队列 |
| R-58 | §5.1⑤：「写 journal（op = import）／写 import_log（status = queued，记录 created_guids 预期）」 | 先落库再发 |
| R-59 | §5.2：「取消语义：当前项让 Unity 完成（**不要中途打断 ImportPackage，会留下半成品**），剩余项标记为 cancelled」 | cancel-batch |
| R-60 | §5.2：「Unity 忙时整体显示 `⏸ 等待 Unity 退出 Play 模式（已排队 3 项）`」 | 队列 UI |
| R-61 | §5.3 标题：「撤销导入（**必须有**）」 | rollback |
| R-62 | §5.3①：「调用 `delete_guids(created_guids)` ← **只删本次新建的**」 | rollback |
| R-63 | §5.3②③：「若 `backup_dir` 存在 → 把备份文件复制回原位（覆盖）；若 `backup_dir` 不存在但有 `overwritten` → 告知用户"有 12 个文件在导入时被覆盖，未开启备份，无法还原内容"」 | rollback |
| R-64 | §5.3④⑤：「`import_log.status = 'rolledback'`；写 journal（op = `import_rollback`）」 | 现状：枚举都有 |
| R-65 | §5.3 注意：「⚠️ `delete_guids` 的安全性：Unity 侧**必须**校验每个 GUID **在 `Assets/` 下**，且**属于本次导入的 `createdGuids` 白名单**，否则拒绝。**绝不能**提供一个"按 GUID 随便删"的接口。」 | C# |
| R-66 | §5.3：「设置项 `被覆盖文件备份`（**默认开启**）：备份目录为 `%APPDATA%/A/backups/import/<importId>/`，保留最近 **20** 次，超出自动清理（**走回收站**）。」 | `backupOverwritten: true`, `IMPORT_BACKUP_KEEP = 20` |
| R-67 | §5.4：图片「打开预览窗（**不导入**，除非用户在预览里点"导入为贴图"）」；「归档模式下的素材卡片：优先导入其中的 `.unitypackage`；若没有，按文件夹导入」 | double-click |

### 1.9 Unity 侧 C#（16 条）

| # | 原文 | 落点 |
|---|---|---|
| R-68 | §6 引言：「⚠️ 这一节是全文**最容易翻车**的部分。下面每一条都是"写错了就会表现为偶尔成功偶尔失败"的隐性 bug。请**逐条对照实现**。」 | C# |
| R-69 | §6.1：「只做轻量工作：建目录、注册 update、写一次 bridge.json。**不要在这里做 FindAssets / 全工程扫描之类的耗时操作**」／§9-11：「**不要在静态构造函数里做耗时扫描**」 | 静态构造 |
| R-70 | §6.1：「**必须注册 `AssemblyReloadEvents` 或依赖静态构造函数**，保证脚本重编译后桥接能自动恢复。」 | `[InitializeOnLoad]` |
| R-71 | §6.2：「`if (EditorApplication.timeSinceStartup - _lastTick < 0.5) return;  // 500ms 节流`」／「`if (IsBusy()) return;   // 忙时只更新心跳，不消费命令`」／「`if (_queue.Count > 0 \|\| _current != null) return;   // 串行：一次只处理一个`」 | Tick |
| R-72 | §6.3 标题：「导入**必须事件驱动 + 严格串行**（最关键）」 | ImportQueue |
| R-73 | §6.3 注释（❌ 错误做法原文）：「`foreach (var cmd in commands) AssetDatabase.ImportPackage(cmd.path, false);` —— ImportPackage 是异步的，连发会导致导入互相打断、结果不可预测。」／§9-1：「**不要连发 `AssetDatabase.ImportPackage`** —— 它是异步的，**必须靠 `importPackageCompleted` / `Failed` / `Cancelled` 三个回调串行推进队列**。这是第一大坑。」 | 同 |
| R-74 | §6.3：「`createdGuids` 的算法：命令开始前对**该包内 GUID 列表**逐个 `AssetDatabase.GUIDToAssetPath` 快照，导入后重新查一次，**导入前为空、导入后有值**的即为新建。」 | C# |
| R-75 | §6.3：「**必须处理 Unity 自动刷新（Auto Refresh）**：`ImportPackage` 会触发资源导入，期间 `isUpdating` 为 true，这是正常的，**不要误判为卡死**。」 | C# / A |
| R-76 | §6.4：「`GUIDToAssetPath` 对不存在的 GUID 返回空字符串，**不抛异常**」 | C# |
| R-77 | §6.5：「**必须用 Unity 自己的 API 复制，让 Unity 生成 `.meta`**：`FileUtil.CopyFileOrDirectory(...)` + `AssetDatabase.Refresh()`」 | C# |
| R-78 | §6.5：「🚫 **绝对不能手写 `.meta` 文件**。GUID 格式、`fileFormatVersion`、各类型 importer 的默认字段极易写错，写错的 meta 会导致资源导入失败或引用丢失，而且是"看起来能跑、用起来出问题"的那种。」／§9-3：「**不要手写 `.meta` 文件**。」／00§五-8：「绝对不能手写 .meta 文件。」 | C# |
| R-79 | §6.6 标题：「错误处理（**不得静默吞异常**）」；「完整堆栈**必须**回传，A 侧要能展示和上报」（`exception` / `stackTrace` 两个字段） | C# + A |
| R-80 | §6.6：「**所有文件读写都要 try/catch**（`Temp` 目录可能被 Unity 清理、杀毒软件可能锁文件）」「读 `inbox/` 时若遇到 `.tmp` 后缀文件 → **跳过**（说明 A 还没写完）」「删除文件失败**不要抛异常**，下次 Tick 重试」 | C# |
| R-81 | §6.7：「Tick 中的文件操作必须极快（目录枚举 + 少量小文件读写），**不要在 Tick 里做同步 IO 等待**」 | C# |
| R-82 | §6.7：「**不要用 `EditorUtility.DisplayProgressBar`**（会阻塞），让 Unity 自己的进度条工作」／「导入大包（> 1GB）时 Unity 会显示自己的进度条，桥接只需更新 `bridge.json` 的 `queueLength`」 | C# |
| R-83 | §6.7：「**不要在桥接里调用 `EditorApplication.Exit`、`EditorSceneManager.SaveScene` 等改变用户状态的操作**」 | C# |

### 1.10 F8「已导入」感知（2 条）

| # | 原文 | 落点 |
|---|---|---|
| R-84 | §7：「提供"清理未使用素材"建议 —— **只提示，不自动删除**」 | 后期（见 §10） |
| R-85 | §7：「工程 GUID 索引的刷新时机：桥接首次连接时全量拉取／每次导入完成后增量更新（用 `createdGuids`）／用户手动点"重新扫描工程"」 | `setProjectGuidIndex()` 已有 |

### 1.11 交付与自测（5 条）

| # | 原文 | 落点 |
|---|---|---|
| R-86 | §8 标题：「验收测试清单（**必须逐条自测并报告真实结果**）」——15 条，见附录 B | 测试台账 |
| R-87 | §10-2：「C# 脚本**必须自包含、零第三方依赖**、能在 Unity 2022.3.22f1 **直接编译通过**」 | C# |
| R-88 | §10-3：「`npm test` 全绿；并**构造一个 mock 文件信箱**对 `BridgeManager` 做单元测试（模拟 `busy` → 重试 → `ok` 的完整时序）」 | `tests/bridge/` |
| R-89 | §10-4：「附 `docs/BRIDGE.md`：协议完整说明（含所有命令/结果的 JSON 示例）、如何在 Unity 侧调试、如何手动模拟一条命令」 | docs |
| R-90 | §10-5 + §10-6：「附一节"已知限制"文档，至少包含：A 未运行时的感知限制、Temp 目录被清理的影响、管理员权限 Unity 的 WMI 限制、Play 模式下无法导入」／「**诚实报告**：任何未通过的验收项、未测试的场景、你感到不确定的地方，必须明确列出」 | docs |

### 1.12 来自 00 / 01 的跨份硬约束（也约束桥接，4 条）

| # | 原文 | 落点 |
|---|---|---|
| R-91 | 01§7 安全：「**导入 Unity 前，目标路径必须校验在目标工程目录内**」 | `security/paths.isInside()` / `assertInside()` 已可用于此 |
| R-92 | 01§F4 安全约束（**硬性，不可违背**）1：「**永不永久删除用户文件**，删除一律走回收站」；00§五-5：「删除文件一律走回收站，不能永久删除」 | 卸载桥接、备份清理 |
| R-93 | 01§F4 安全约束 2 + 5：「**所有文件系统操作必须写 `journal`**，UI 提供 `撤销上一次操作`（`Ctrl+Z`）和"操作历史"面板」／「批量操作可中断，中断后状态一致（**事务性：先写 journal 再操作，失败则回滚**）」 | coordinator |
| R-94 | 01§7 安全：「除用户显式配置的 LLM 服务外，**不做任何联网请求**」＋ 01§7：「`contextIsolation: true`，`nodeIntegration: false`……所有文件路径在 IPC 边界做校验，防止路径穿越」 | 桥接必须本机文件信箱（与 R-16 一致） |

> 补充（01§11 **非目标**，原文）：「❌ 直接编辑 Unity 工程里的资源」「❌ Unity 里的可视化面板（只做纯编辑器脚本，不做 EditorWindow UI）」。
> 这两条不是"待办"，是"不许做"，见 §10。

---

## 2. 文件信箱协议（§2 全量照抄级提炼）

### 2.1 目录布局（相对 Unity 工程根）

```
<Project>/Temp/AVCABridge/
  ├─ bridge.json        ← Unity 写，A 读（心跳 / 状态）
  ├─ inbox/             ← A 写命令，Unity 消费后删除
  │    <ulid>.json
  └─ outbox/            ← Unity 写结果，A 读后删除
       <ulid>.json
```

- 完整路径实例：`E:\ALCOMprojects\shinano-Main2\Temp\AVCABridge\bridge.json`
- A 侧常量已就位：`src/shared/types.ts:598` → `export const BRIDGE_DIR = ['Temp', 'AVCABridge']`
- **为什么用 `Temp/`（§2.1，不得改用 TCP / HTTP / 命名管道）**，原文五条理由：
  1. 「Unity 不会导入 `Temp/` 下的文件，不会触发无谓的资源刷新」
  2. 「Unity 关闭时 `Temp/` 自动清理，不留垃圾」
  3. 「不涉及端口占用、防火墙、多实例端口冲突」
  4. 「不需要处理连接建立/断开/重连的竞态」
  5. 「文件系统的原子 rename 天然提供了"命令只被消费一次"的语义」

### 2.2 `bridge.json` —— Unity 写 / A 读（§2.2）

| 字段 | 类型 | 说明 |
|---|---|---|
| `protocolVersion` | number | 固定 `1`（`BRIDGE_PROTOCOL_VERSION = 1` 已在 `src/shared/types.ts`） |
| `pid` | number | Unity 进程号 |
| `projectPath` | string | Windows 绝对路径（JSON 内双反斜杠） |
| `projectName` | string | 工程目录名 |
| `unityVersion` | string | 例 `"2022.3.22f1"` |
| `bridgeVersion` | string | 例 `"1.0.0"` |
| `isPlaying` | boolean | `EditorApplication.isPlaying` |
| `isCompiling` | boolean | `EditorApplication.isCompiling` |
| `isUpdating` | boolean | `EditorApplication.isUpdating` |
| `isPlayingOrWillChangePlaymode` | boolean | `EditorApplication.isPlayingOrWillChangePlaymode` |
| `activeScene` | string | 例 `"Assets/Scenes/Main.unity"`（现状类型放宽为 `string \| null`） |
| `busyReason` | string \| null | 忙因，随 `busy` 结果一起回传 |
| `queueLength` | number | Unity 侧待处理命令数；§6.7「导入大包时桥接只需更新 `bridge.json` 的 `queueLength`」 |
| `heartbeatUtc` | number | 毫秒 epoch（示例 `1759500000000`） |

时序与判定：
- 「**心跳间隔 2 秒**（由 `EditorApplication.update` 驱动）」（R-18）
- 「A 侧若 **10 秒**未更新心跳 → 判定该实例已退出，清理该实例但**保留 `project` 记录**」（R-19）
- 「A 侧用 chokidar 监听所有已知工程的 `Temp/AVCABridge/bridge.json`」（R-20，事件驱动，不轮询）

### 2.3 命令信封 —— A 写 / Unity 读（§2.3）

```json
{
  "id": "01J8XYZ...",
  "type": "import_unitypackage",
  "protocolVersion": 1,
  "createdAt": 1759500000000,
  "payload": { }
}
```

- 落地文件：`Temp/AVCABridge/inbox/<id>.json`，`id` 是 ULID（目录布局写作 `<ulid>.json`）
- 写盘纪律（R-21）：「**先写 `<id>.json.tmp`，再 `fs.rename` 成 `<id>.json`**（原子，避免 Unity 读到半截文件）」
- Unity 侧配套（R-80）：「读 `inbox/` 时若遇到 `.tmp` 后缀文件 → **跳过**（说明 A 还没写完）」
- 已建模：`src/shared/types.ts:629` `interface BridgeCommand { id; type; protocolVersion; createdAt; payload }` ✓

### 2.4 结果信封 —— Unity 写 / A 读（§2.4）

```json
{
  "id": "01J8XYZ...",
  "status": "progress",
  "progress": 0.42,
  "message": "正在导入 (3/7)：GoLoco.v.1.8.6u.unitypackage",
  "data": null
}
```

- `status` 枚举：`ok` | `progress` | `busy` | `error` | `cancelled`（§2.4 原文；`BridgeResultStatus` 现状已对）
- 「一个命令可以产生**多条**结果（多条 `progress` + 一条终态）」
- 「文件名固定为 `<id>.json`，Unity **覆写**同一文件来表示进度更新（A 侧 chokidar 监听 `change` 事件；覆写同样用 tmp + rename 保证原子）」（R-22）
- 现状 `BridgeResult` 额外有 `busyReason?: string` —— 由 §2.5「直接写回 `busy` + `busyReason`」推出，合理保留。
- **状态口径映射**（规格两处用词不同，不是我的发明）：桥接结果用 `error`（§2.4），`import_log.status` 用 `failed`
  （01§5：`status TEXT, -- queued|running|ok|failed|cancelled|rolledback`）。落库时 `error → failed`。

### 2.5 确认（ack）与终态契约（§2.4 + §2.5）

| 事件 | 谁做什么 |
|---|---|
| A 下发命令 | 写 `inbox/<id>.json.tmp` → rename `inbox/<id>.json` |
| Unity 取命令 | 500ms 节流 Tick 内枚举 `inbox/`，跳过 `.tmp`；忙则不消费、直接写 `outbox/<id>.json`（`status:"busy"` + `busyReason`） |
| 进行中的每条进度 | Unity **覆写** `outbox/<id>.json`（tmp+rename）；命令文件留在 `inbox/` 不动 |
| 终态（`ok`/`error`/`cancelled`） | ① Unity 写终态 → ② **Unity 删除 `inbox/<id>.json`** → ③ A 读到终态 → ④ **A 删除 `outbox/<id>.json`** |
| A 侧串行闸门 | 「每条等待终态（ok/error/cancelled）**才发下一条**」（§5.1⑤，R-57） |
| busy 之后 | A 按退避序列重发**同一个 `id`** 还是新 `id`？规格未写 → 见 §11-Q6 |

### 2.6 所有周期常量汇总

| 周期 | 值 | 出处 | 现状 |
|---|---|---|---|
| Unity Tick 节流 | 500 ms | §6.2 | — |
| 心跳写入 | 每 2 s | §2.2 | — |
| 心跳超时判定退出 | 10 s | §2.2 | `BRIDGE_STALE_MS = 10000` ✓ |
| UnityLockfile 检查 | 每 3 s | §4.2 | 未做 |
| WMI 查询 | 每 5 s（不得更频繁） | §4.2 | 未做 |
| busy 退避 | 1/2/5/10/30/30… ms，最多 60 次 | §2.5 | `BUSY_BACKOFF_MS` + `BUSY_MAX_RETRIES = 60` ✓ |
| `resolve_guids` 单批 | ≤ 2000 | §3 / §5.1③ | `GUID_BATCH_SIZE = 2000` ✓ |
| 自动切换冷却 | 同一工程 5 min | §4.3 | `AUTO_SWITCH_COOLDOWN_MS` ✓ |
| 横幅停留 | 10 s 后淡出（可固定） | §4.3 | 未做 |
| 备份保留 | 最近 20 次 | §5.3 | `IMPORT_BACKUP_KEEP = 20` ✓ |

---

## 3. 重试退避与"什么算失败"（§2.5 / §9-5）

退避序列（原文，固定不可改）：

```
1s → 2s → 5s → 10s → 30s → 30s → …（最多重试 60 次，约 25 分钟）
```

- 第 5 项起恒为 30s（现状注释：`BUSY_BACKOFF_MS = [1000, 2000, 5000, 10000, 30000, 30000]`「最后一个值重复使用」）✓
- 算术核对：`1+2+5+10+30×56 = 1698 s ≈ 28.3 分钟`，与原文"约 25 分钟"不符 → §11-Q7（哪个是规范值没写）。

**算失败的情况（写 `error`）**：命令抛异常（§6.6 必须回传 `exception` + `stackTrace`）、
`importPackageFailed` 回调（§6.3 `CompleteCurrent(ok: false, error)`）。

**不算失败、必须继续排队的情况**（§2.5，R-24/R-25/R-27）：

- `EditorApplication.isCompiling`
- `EditorApplication.isUpdating`
- `EditorApplication.isPlayingOrWillChangePlaymode`
- 「上一个导入命令尚未完成（队列非空）」

**用户可见文案（原文）**：「Unity 正在运行/编译，已排队（第 3 位）」；队列浮层显示
「⏸ 等待 Unity 退出 Play 模式（已排队 3 项）」（§5.2）。

**60 次退避之后**：规格只写"最多重试 60 次"，没写第 61 次的终态归属（`error`？`cancelled`？留在队列？）→ §11-Q6。

---

## 4. Unity 侧导入执行语义（§3 / §5.1⑤ / §6.1–6.7）

### 4.1 用哪个 API

| 场景 | API（§6.3 / §6.5 原文代码要点） |
|---|---|
| `.unitypackage` | `AssetDatabase.ImportPackage(path, false)`（"立即返回，进度条由 Unity 显示"） |
| 散文件 / 文件夹 | `FileUtil.CopyFileOrDirectory(sourceAbsPath, targetAbsPath)` + `AssetDatabase.Refresh()` |
| importer 预设 | `AssetImporter.GetAtPath(targetAssetPath) as ModelImporter` → 设 `globalScale` / `animationType` → `importer.SaveAndReimport()` |
| `refresh` 命令 | `AssetDatabase.Refresh()` |
| `open_folder` 命令 | `EditorGUIUtility.PingObject` 定位（§3 表格） |

### 4.2 严格串行（第一大坑，R-72/R-73）

禁止写法（§6.3 原文注释）：

```csharp
// ❌ 错误做法（这是最经典的翻车方式）：
//    foreach (var cmd in commands)
//        AssetDatabase.ImportPackage(cmd.path, false);
//    ImportPackage 是异步的，连发会导致导入互相打断、结果不可预测。
```

正确写法：`_current` 单值 + 三个事件回调推进：
`AssetDatabase.importPackageCompleted` / `importPackageFailed` / `importPackageCancelled`（§6.1 注册、§6.3 回调）。
`CompleteCurrent(ok, error)` 的三步（原文注释）：「收集本次新建的 GUID（用导入前的快照做差集）／写 outbox 终态结果／删除 inbox 中的命令文件」，
然后「下一次 Tick 会自动取队列里的下一条」。

Tick 串行闸门（§6.2 原文）：`if (_queue.Count > 0 || _current != null) return;   // 串行：一次只处理一个`。

### 4.3 Play 模式如何被检测 + 排队语义（§2.5 / §6.2 / §8-5）

- 忙判定函数（§6.2 原文）：
  ```csharp
  return EditorApplication.isCompiling
      || EditorApplication.isUpdating
      || EditorApplication.isPlayingOrWillChangePlaymode
      || EditorApplication.isPlaying;
  ```
- 忙时 `Tick()` **只更新心跳、不消费命令**；同时按 §2.5「不消费命令，直接写回 `busy` + `busyReason`」。
- 是否**延迟执行（deferred）**：是。桥接不丢弃命令，也不中断 Play；命令留在 `inbox/`，A 侧退避重投。
  验收标准（§8-5，原文）：「**Unity 处于 Play 模式时点导入** → A 显示"Unity 正在运行，已排队"，退出 Play 模式后**自动执行成功**（不需要用户再点一次）」
- ⚠️ §2.5 的 busy 四条件与 §6.2 的 `IsBusy()` 条件集合不完全一致（后者多 `isPlaying`、少"队列非空"）→ §11-Q8。

### 4.4 完成如何被检测

- **unitypackage**：三个 `AssetDatabase.importPackage*` 回调之一（`Completed` / `Failed(packageName, error)` / `Cancelled`）。
  注意回调参数是 **packageName**，不是命令 id —— 如何映射回 `_current.id` 规格未写 → §11-Q9。
- **`ImportPackage` 期间 `isUpdating` 会变 true**：「这是正常的，不要误判为卡死」（§6.3，R-75）。
- **createdGuids**：导入前后各做一次 `AssetDatabase.GUIDToAssetPath` 快照，「导入前为空、导入后有值」的才算新建（§6.3，R-74）。
- **进度**：`progress` 0..1 + `message`（§2.4 示例 `"正在导入 (3/7)：GoLoco.v.1.8.6u.unitypackage"`）。规格未说明 Unity 侧进度值从哪来 → §11-Q9。
- **取消**：「取消语义：当前项让 Unity 完成（不要中途打断 ImportPackage，会留下半成品），剩余项标记为 cancelled」（§5.2，R-59）。

### 4.5 生命周期与恢复（§6.1）

- `[InitializeOnLoad]` + 静态构造函数：「静态构造函数在每次域重载后都会执行」，只做 `EnsureDirectories()` / `WriteHeartbeat()` / `EditorApplication.update += Tick` / 注册 4 个事件。
- R-70：「**必须注册 `AssemblyReloadEvents` 或依赖静态构造函数**，保证脚本重编译后桥接能自动恢复。」
- R-83：桥接里禁止 `EditorApplication.Exit`、`EditorSceneManager.SaveScene` 等改变用户状态的操作。

---

## 5. 冲突预扫描（§5.1③④ / §3 `resolve_guids` / §6.4）

**何时跑**：`§5.1` 流程第 ③ 步 —— 用户双击/多选按 Enter 之后、**入队之前**（第 ⑤ 步才写 journal/import_log）。

**GUID 解析调用（§6.4 原文实现要点）**：

```csharp
static object ResolveGuids(string[] guids)
{
    var existing = new List<object>();
    var missing  = new List<string>();
    foreach (var g in guids)
    {
        var p = AssetDatabase.GUIDToAssetPath(g);
        if (string.IsNullOrEmpty(p)) missing.Add(g);
        else existing.Add(new { guid = g, assetPath = p });
    }
    return new { existing, missing };
}
```

- 契约（§3）：`resolve_guids` payload `{guids: string[]}` → `data {existing: [{guid, assetPath}], missing: string[]}`
- 分批：**每批 2000**，「单次调用 GUID 数 ≤ 2000（A 侧会分批）」（§6.4）；§5.1③ 原文「分批（每批 2000）调用 resolve_guids」
- `GUIDToAssetPath` 对不存在的 GUID 返回空字符串，不抛异常（R-76）
- GUID 来源（§5.1③）：「从 `package_entry` 表读出该素材所有 unitypackage 的 GUID 集合」——A 侧已有 `guidsOfAsset(db, assetId)`（`src/main/db/repos/unity.ts:148`）

**给用户看什么（§5.1④ 原文文案）**：

```
"此包将覆盖工程中 12 个已有文件，例如：
   Assets/Shinano/Hair/Ponytail.prefab
   Assets/Shinano/Hair/Ponytail.mat
   …（展开查看全部）
 [取消]  [继续]  [继续并备份被覆盖文件]"
```

- 无冲突 → 直接继续；「若设置里 `导入前确认` 关闭且无冲突 → 跳过弹窗直接导入」（§5.1④）
  → **设置关闭 + 有冲突**时是否仍弹窗，规格只定义了"无冲突"这一支 → §11-Q11
- 冲突集 = `resolve_guids` 返回的 `existing`；显示的是 **`assetPath`（工程内具体文件路径）**，不是 GUID。
  验收 §8-6 原文：「导入一个与工程有 GUID 冲突的包 → 提前弹出冲突列表（**列出具体文件路径**），可取消」
- "继续并备份被覆盖文件" → 映射到命令 payload 的 `backupOverwritten: true`（§3）
- ⚠️ §5.1③ 把这步标为「（本地，不需要 Unity 参与）」，但同一步又要求「调用 `resolve_guids`」（那是需要 Unity 在线的桥接命令）→ §11-Q1

---

## 6. 回滚 / 撤销导入（§5.3 / §3 `delete_guids`）

```
撤销一个 import_log：
  ① 调用 delete_guids(created_guids)   ← 只删本次新建的
  ② 若 backup_dir 存在 → 把备份文件复制回原位（覆盖）
  ③ 若 backup_dir 不存在但有 overwritten → 告知用户
     "有 12 个文件在导入时被覆盖，未开启备份，无法还原内容"
  ④ import_log.status = 'rolledback'
  ⑤ 写 journal（op = import_rollback）
```
（§5.3 原文，R-61 … R-64）

**`delete_guids` 语义与白名单（§3 + §5.3 注意，R-30/R-65）**：

| 项 | 规定 |
|---|---|
| payload | `{guids: string[]}` |
| 返回 | `{deleted: string[], failed: [{guid, reason}]}` |
| Unity 侧校验 | 「**必须**校验每个 GUID **在 `Assets/` 下**，且**属于本次导入的 `createdGuids` 白名单**，否则拒绝」 |
| 禁止 | 「**绝不能**提供一个"按 GUID 随便删"的接口。」／§9-8：「**不要提供"按 GUID 随便删"的接口**」 |
| 白名单来源 | `import_log.created_guids_json`（§5.1⑤ 入队时写"预期"，§6.3 导入后写实测差集） |

现状：`import_log.created_guids_json` / `overwritten_json` / `backup_dir` 三列都在
（`src/main/db/schema.ts:160-176`），`patchImportLog()` 允许写这四个字段，`ImportStatus` 含 `rolledback`
（`src/shared/types.ts:51`）；**但没有任何调用方**，`unity:rollback` IPC 现在是抛错的 stub（`src/main/ipc/stubs.ts:35`）。

**备份与还原规则（§5.3 + §6.3）**：

- 设置项 `被覆盖文件备份` **默认开启**（现状 `backupOverwritten: true` ✓）
- 备份目录 `%APPDATA%/A/backups/import/<importId>/`；保留最近 **20** 次，超出自动清理**走回收站**
- 备份动作发生在 Unity 侧（§6.3 `BackupOverwrittenFiles(_current)` // 若开启备份）；
  返回体里 `overwritten: [{guid, assetPath, backupPath?}]`（§3）
- 还原动作发生在 A 侧（§5.3② 复制回原位）
- ⚠️ 谁把 `importId` / 备份目录告诉 Unity、`<importId>` 从哪来 —— 命令 payload 只有 `{path, backupOverwritten}` → §11-Q3
- 卸载桥接也是删除操作：「走回收站，不永久删除」（§1.3，R-13）

---

## 7. 工程发现与运行状态判定（§4.1 / §4.2）

> 任务里把"三路探测"说成一组；03 实际分成**两组三法**：§4.1 是**工程发现**（有哪些工程），
> §4.2 是**运行状态**（某个工程在不在跑）。两组都要做，别混。

### 7.1 工程发现（§4.1，「三路并行，结果取并集」）

| 路径 | 来源 | 细节 |
|---|---|---|
| 1 | **ALCOM / VCC 清单**（「最可靠，零成本」） | `%LOCALAPPDATA%\VRChatCreatorCompanion\settings.json` → `.userProjects`（`string[]`，绝对路径）+ `.defaultProjectPath` |
| 2 | **扫描用户配置的工程根目录** | 默认根 = `settings.json` 的 `defaultProjectPath`（实测 `E:\ALCOMprojects`）；可手动加多个根（设置页）；判定标准 = 存在 `ProjectSettings/ProjectVersion.txt`；深度 ≤ 3；跳过 `Library`/`Temp`/`obj`/`.git`/`_backup*`；必须识别并跳过备份副本与 `.rar` 压缩包 |
| 3 | **桥接上报** | 「运行中的工程必然通过 `bridge.json` 上报自己，即使路径 1、2 都失败也能发现。」 |

`ProjectInfo.detectedBy` 现状已按 `'vcc' | 'scan' | 'bridge' | 'wmi'` 建型（`src/shared/types.ts:672`）。

### 7.2 运行状态判定（§4.2，「按可靠性排序」）

| 优先级 | 方法 | 规格说明（原文要点） |
|---|---|---|
| **1** | **桥接心跳** | 「最可靠，且能拿到 Play/编译状态、队列长度」 |
| **2** | **`<Project>/Temp/UnityLockfile`** | 「Unity 运行时该文件存在且**被独占占用**。尝试以写模式打开，**失败 = 被占用 = Unity 在运行**」；补充：异常退出会残留，所以「需要配合"尝试独占打开"来判断，不能只看文件是否存在」（R-38） |
| **3** | **WMI 查 `Unity.exe` 命令行** | `SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='Unity.exe'`，解析 `-projectPath`；**仅作兜底**（R-37） |

**谁权威（不一致时怎么办）**：
- 规格给的合并规则是 OR：「三者结果合并，**任一命中即认为工程在运行**」（§4.2，R-41）。
  所以"心跳说停、UnityLockfile 说占用"这类分歧 → 判**在运行**。
- 可靠性排序（1 > 2 > 3）决定的是**信息取信优先级与实现主/兜底地位**，不是"覆盖"关系：
  「**不得把方法 3 当作主路径**」（R-37）。
- 心跳独有的字段（`isPlaying` / `isCompiling` / `queueLength` 等）只能来自方法 1 —— 这也是"桥接未装 = 黄点"的根因（§4.3 步骤 4）。
- 工程**存在性**分歧：取并集（§4.1 标题），路径 1 是"最可靠"来源。

**轮询（R-39/R-40）**：WMI 每 5 s；UnityLockfile 每 3 s；心跳 chokidar 事件驱动不轮询。

现状（`src/main/project/api.ts`）：路径 1 ✓ `readVccManifest()`、路径 2 ✓ `scanProjectRoots()`；
路径 3 ✗、方法 2 ✗、方法 3 ✗、任何定时器 ✗、`dispose()` 是空函数；
`startProjectWatcher()` 注释原文：「M1 只做"工程发现 + 落库"。三路运行状态探测（桥接心跳 / UnityLockfile / WMI 兜底）和自动切换集合是 M6 的活，**这里一律标 `running:false`，绝不猜**。」
—— 注意：规格 §4.2 的三法**没有一条被实现**，M5A 只要"能不能导入"的判定，至少要方法 1+2。

---

## 8. 自动切换集合 + 顶栏 + 横幅（§4.3）

### 8.1 触发时机

「**触发时机**：某个工程从"未运行"变为"运行中"」（§4.3 原文）。

### 8.2 步骤 1：工程指纹（原文）

```ts
fingerprint = [
  projectDirName,          // "shinano-Main2"
  ...topFolders,           // ["! ShinanoTouchSpotsbyshiio", "Kiss音ギミック", "NyaPPu__Generated", ...]
  ...installedPackages,    // ["com.coplaydev.unity-mcp", "jp.lilxyzw.liltoon", ...]
  ...avatarDescriptors,    // ["Assets/Shinano/Shinano.prefab"]
].join(' ').toLowerCase()
```

- `topFolders` / `avatarDescriptors` 「来自桥接的 `list_project_assets`」
- 「**首帧拿不到时先用项目名匹配，拿到后再刷新一次。**」（R-42）
- 缓存位置：`project.fingerprint_json`（01§5 原表没有此列，本仓库已加，注释即指向 §4.3）

### 8.3 步骤 2：哪个集合命中哪个工程

- 匹配对象是 **`collection` 表的 `rule_json`**（01§5 与 `src/main/db/repos/meta.ts` 的"集合（虚拟分区）"），
  **不是** `asset_group`（04§2.4 的 `asset_group` 是**产品归并组**，无 `rule_json` 列）。
  任务描述里"集合（asset_group）"这个括号与规格不一致 → 见 §11-Q9b（避免实现者按 `asset_group` 找规则）。
- 规则格式（§4.3 原文）：
  ```json
  { "keywords": ["shinano", "しなの", "シナノ"], "matchMode": "any", "priority": 10 }
  ```
  现状 `CollectionRule` 已含 `keywords? / matchMode?('any'|'all') / priority? / projectPaths? / tagNames? / categories?` ✓
- 归一化：「对 fingerprint 与 keywords 都做归一化（**小写、去符号、假名转罗马字**）」（R-43）
- 初始集合：「用户首次使用时会**自动**为内置模型词典里的每个模型创建一个集合（「Shinano」「Milfy」「Manuka」…），关键词来自第 2 份的 avatar 词表」
- 仲裁：「多个集合命中时取 `priority` 最高者；并列则取**关键词最长的**（更具体）」（R-44）
- `projectPaths`（"以后都这样"写入）：「**精确匹配，优先级最高**」（R-47）

### 8.4 步骤 3："自动置顶 / 切到集合"具体是什么

| 情况 | 具体动作（原文） |
|---|---|
| A **未运行** | 「无法感知，这是物理限制。」设置页必须写明「A 需要常驻托盘才能感知 Unity 启动」，并提供 `开机自启（最小化到托盘）` 开关，**默认开启**（R-45） |
| A 在托盘 | 「**弹出主窗口并置顶**（`win.show()` + `win.focus()` + `setAlwaysOnTop(true)` 短暂闪烁）」 |
| 切集合 | 「切换到匹配到的集合视图（只切换**左侧选中项**和**过滤条件**，**不清空用户当前搜索框**，除非搜索框为空）」（R-46/R-52） |
| 横幅 | 见 8.5 |
| 无匹配集合 | 规格只在验收 §8-11 给了口径：「打开一个名为 `测试工程` 的无关工程 → **A 不自动切换（无匹配集合），只更新顶栏状态**」——不弹窗、不切视图，顶栏照常显示该实例 |

`setAlwaysOnTop(true)` 是"短暂"的：原文写「`setAlwaysOnTop(true)` 短暂闪烁」，未给取消时间 → §11-Q12。

### 8.5 横幅（§4.3 原文版式）

```
已识别为「Shinano」项目 · 自动打开 Shinano 集合
[不是这个集合 ▾]  [以后都这样]  [这次忽略]
```

- 「10 秒后自动淡出，**可固定**」
- `不是这个集合 ▾` → 「下拉列出其他集合 + "创建新集合"，选择后**询问是否更新规则**」
- `以后都这样` → 写进该集合 `rule_json.projectPaths`（精确匹配、优先级最高）
- `这次忽略` → 「关闭横幅，本次不再提示」

### 8.6 顶栏常驻工程切换器（§4.3 步骤 4 原文）

```
[ Unity: shinano-Main2 ● ]  ← 点击展开
  ● shinano-Main2      (运行中 · 已连接)
  ○ Milfy-little        (未运行)
  ○ shinano-basics      (未运行)
  ─────────────────────
  刷新工程列表
  手动指定目标…
```

- 圆点三色（原文）：「**绿色** = 运行中且桥接已连接；**黄色** = 运行中但桥接未安装/未生效；**灰色** = 未运行」
- 「手动选中的工程作为**导入目标**（未运行的工程不能导入，选中时提示"该工程未运行"）」（R-48）
- 现状（**2026-10-06 更正**，本节初稿写的是"只是个按钮、`unity:set-target` 是抛错 stub"，那是 M5-A 之前的状态）：
  `src/renderer/components/chrome.tsx` 已有可展开的工程下拉、三色圆点
  （`unity.running ? (unity.bridgeReady ? ok : warn) : faint`）、"未运行的工程不能导入"的如实提示；
  `unity:set-target` 已实现并在 M5-B ⑦ 的沙盒活体里真点过（顶栏从「导入目标：未选择」变成 `Shinano-LiveTest`）。
  还缺的是 §4.3 的**自动**部分：指纹、匹配、冷却、横幅、托盘唤醒 → **M6 已交付**（2026-10-06，
  设计与裁定见 `docs/M6-DESIGN.md`，落地口径与沙盒活体证据见 `docs/BRIDGE.md` §13；
  "真 Unity 那一支 + 托盘里被唤醒并置顶 1.2 秒"这两条**已在开发计划第 5 轮真跑过**
  （置顶那条是先修掉一条"那段代码从来没执行过"的真缺陷才过的，见 `docs/VERIFY-UNVERIFIED.md` §11）；
  仍未验的是要改 C# 的"新版桥接"那一支。）

### 8.7 防打扰规则（§4.3 标了"硬性"，R-49/R-50/R-51）

1. 同一工程 5 分钟内只自动切换一次
2. `自动弹出行为` = `每次 / 仅当匹配到集合 / 从不`，默认"仅当匹配到集合"
3. 「A 处于用户主动操作中（有未保存的编辑、正在拖拽）时**不打断**，只更新顶部横幅」

---

## 9. 桥接包布局（§1.1 / §1.2 / §1.3 / §6.5）

### 9.1 目标目录（装进 Unity 工程时）

```
<Project>/Packages/com.avca.bridge/
  ├─ package.json
  └─ Editor/
      ├─ AVCABridge.cs
      ├─ AVCABridge.asmdef          # 可选但推荐
      └─ AVCABridgeImportQueue.cs
```

### 9.2 `package.json`（§1.1 原文，字段一个都不能改）

```json
{
  "name": "com.avca.bridge",
  "version": "1.0.0",
  "displayName": "A Asset Bridge",
  "description": "Bridge for the A asset manager. Provides batch import into this Unity project.",
  "unity": "2022.3",
  "dependencies": {}
}
```

- `dependencies` 必须是空对象 —— §0「桥接必须自包含、**零第三方依赖**」+ §10-2 同文（R-07/R-87）
- `src/shared/constants.ts:1` 注释已锁死：「内部标识（appId / com.avca.bridge / .avca.json / %APPDATA%\A）一律不动……改了 Unity 桥接和侧车文件就对不上」

### 9.3 `.asmdef` 内容要求

规格只给了「`AVCABridge.asmdef` # **可选但推荐**」这一句，**没有规定它的 name / references / includePlatforms / editor 限定怎么填**
→ §11-Q5。实现时要么不带 asmdef（规格允许"可选"），要么带并在 `docs/BRIDGE.md` 里把选择写清楚；
**不要**自己发明"必须限定 `Editor` 平台"之类规格没说的话。

### 9.4 A 侧模板目录（01§9 原文）

```
├─ resources/
│  └─ unity-bridge/                  # 桥接包模板，安装时复制（第 3 份）
│     └─ com.avca.bridge/{package.json, Editor/AVCABridge.cs}
```

与 §1.1 的三文件清单不一致（这里少了 `AVCABridgeImportQueue.cs` 和 asmdef）→ §11-Q4。
现状：`resources/unity-bridge/com.avca.bridge/Editor/` 存在但**为空**，`package.json` 未写。

### 9.5 装到哪、怎么装（§1.2 / §1.3）

- **只能装 `Packages/` 嵌入式包，不得装 `Assets/`**（R-08/R-09），四条理由原文：不污染资源树 / 不会被打包上传 / **无需改 `Packages/manifest.json`**（Unity 自动发现）/ 卸载干净「删掉这一个文件夹即可，不留残余」。
  §9-2 原文：「**不要把桥接脚本放进 `Assets/`** —— 必须用 `Packages/com.avca.bridge/` 嵌入式包，否则会污染用户的工程、可能被上传进 Avatar。」
- 安装 = 「复制 `resources/unity-bridge/com.avca.bridge/` **整个目录**到 `<Project>/Packages/`」（§1.3-2）
- 卸载 = 删该目录，**走回收站**（R-13）
- **绝不手写 `.meta`**（R-78）。§6.5 原文理由：「GUID 格式、`fileFormatVersion`、各类型 importer 的默认字段极易写错，写错的 meta 会导致资源导入失败或引用丢失」。
  散文件导入一律靠 `FileUtil.CopyFileOrDirectory` + `AssetDatabase.Refresh()` 让 Unity 自己生成（R-77）。
  规格没写"复制嵌入式包时要不要附带 .meta"——按 R-78 推论是不写；`Packages/` 下是否需要 .meta 请实测确认 → §11-Q4b。

### 9.6 安装后的编译提示（§1.3-5，R-12）

「提示用户"Unity 需要获得焦点并重新编译一次脚本，桥接才会生效" —— **Unity 在后台时不会自动编译**，
可以调用 `Unity.exe -projectPath <path>` 或提示用户切到 Unity 窗口」。

### 9.7 桥接被用户删掉之后（§8-12）

「桥接脚本被用户手动删除 → A 检测到桥接失效，提示"桥接未安装 **[立即安装]**"」。

---

## 10. 现在不做（M5-B / M6 / M7 / v2 / 非目标）

> **状态更新（M5-B ①–⑥ 已交付，2026-10-06）**：本节里凡是写"M5-B 不做 / M5-A 只做单包"的，
> 现在**已经做了**的是：压缩包成员定点抽取、容器成员清单（含两个上限与"只钻一层"）、
> 抽取根与三道硬闸门、一次一批（≤8）的串行导入、一包一条 `import_log` + V5 三列来源、
> 一张汇总冲突卡、整批倒序撤销、成员选择面板。
> **仍然没做**的是：加密容器的密码输入框（后端参数已留，见 §10.6）、
> 导入队列浮层的"多条并发展示"（M6）、F8 的 GUID 增量索引（M6/v2）、打包成 .unitypackage（v2 非目标）。
> 每一处的证据与"哪几项没有自动化测试"见 `node tools/selfcheck-m5b.cjs` 与
> `tests/spec-coverage.spec.ts` 的 M5-B 一节（M5B-19…21 三条显式标了未验证）。

### 10.1 规格自己点名的"以后 / v2"

| 出处 | 原文 |
|---|---|
| §6.5 例外 | 「（例外：若将来要实现"打包成 .unitypackage"功能，只允许打包 png/txt/mat 等简单类型，且必须同时生成正确的 meta —— **这是 v2 的事，v1 不做**。）」 |
| §7 | 「提供反查："这个素材在哪些工程里装过"」／「提供"清理未使用素材"建议 —— 只提示，不自动删除」——F8 整节属于状态感知，**规格没标 M5/M6**，按 `00§三` 的切分（M5 = 桥接脚本 + 单包导入）落在 M6 一侧（R-84/R-85 仍需遵守"只提示不删"） |
| §1.1 注 | 「`AVCABridge.asmdef` # **可选但推荐**」——可选即可以不做 |

### 10.2 按 `00§三` 切到 M6 的部分（本文一律不实现）

- 「批量导入 + 自动切换分区」（第 6 轮）
- §4.3 全节：指纹匹配、集合切换、横幅、防打扰
- §5.1②「展开变体」的多选批量链路（M5A 只做**单包**导入；§8-4 的「多选 5 个 → 串行执行」是 M6）
- §5.2 导入队列浮层的"多条并发展示"形态（M5A 只允许一次一条）
- §4.3 步骤 4 顶栏展开式切换器的"手动指定目标"（现 stub 注释原文即「导入目标切换在 **M6** 交付」）

### 10.3 01§11 非目标（永久不做，v1）

原文摘录：「❌ 直接编辑 Unity 工程里的资源」「❌ Unity 里的可视化面板（只做纯编辑器脚本，不做 EditorWindow UI）」
「❌ 3D 模型实时预览（FBX/预制体渲染）」「❌ macOS / Linux 适配（代码可保持跨平台，但只验收 Windows）」。

### 10.4 M7

打包（`electron-builder`）。现状 README：「❌ 安装包（M7；现在只有免安装目录版）」。
注意 `electron-builder.yml` 的 `extraResources` 已经需要 `resources/unity-bridge/` 存在 —— 目录不能删。

### 10.5 已被 04 / 05 覆盖的 03 条款（别再照 03 原文做）
| 03 原文 | 被覆盖成 | 依据 |
|---|---|---|
| §5.1②「若选中的是聚合卡片……**弹出变体选择：全选 / 只选 SHINANO / 自定义**」／§5.4「聚合卡片（多变体）→ 弹出变体选择窗」 | 05§B6：「双击容器卡（有数字徽章的）→ **进入容器内部**（不是弹窗，是页面切换）」，在内部勾选变体行后 `[导入选中项到 Unity]`；「普通素材卡 → 保持原行为：导入到 Unity」 | 00§一「冲突处以改动单为准」 |
| §5.4 表格里的"归档模式下的素材卡片 / 文件夹散文件" | 04§4：「**合集卡片**上点「导入到 Unity」→ 弹出子项勾选窗……**子项**上点「导入到 Unity」→ 直接导入该子项的全部版本；多版本时弹出选版本（**默认选最新版本**）」；05§A2：「附属资源可单独导入 Unity（详情页里勾选），但**默认不导入**」 | 同上 |
| §5.1③④⑤ / §5.3 / §6 | 04§4 明确「**冲突预扫描、GUID 白名单、串行队列、撤销 —— 全部保持不变**」 | 无变更 |
| §1.3-4「写 `import_log`（type 可复用或新增）」 | 04§2.4 给了列：`ALTER TABLE import_log ADD COLUMN kind TEXT; -- 'import' \| 'bridge_install' \| 'rollback'` | 口径冲突见 §11-Q2 |

### 10.6 M5-B 交付后仍然开着的口（**别当成已完成**）

| 项 | 现状 | 缺什么 |
|---|---|---|
| 加密容器的成员导入 | 后端已能识别（`PasswordNeededError` → `err.needPassword`），`unity:import-plan` 也收 `password` 参数 | **面板上没有输入框**。真库实测 0 个加密 rar / 0 个加密 zip，所以先不做；要做得把摄取那套内存口令保管员接过来（**不落盘**，`safeStorage` 仍属 M7 的独立决定） |
| 成员列表的"虚拟滚动" | 做的是增量渲染（先 60 条、按钮再显示 100 条） | 不是真窗口化。400 条硬上限下够用；要换 react-window 之类得引依赖，单开工务 |
| 只有一块盘的机器 | **整个成员导入功能会被闸门拒绝**（库在 C: → 抽取根推出来也在 C: → `err.extractOnSystemDrive`） | 这是"绝不落 C 盘"这条红线的直接后果，不是 bug。要不要留一个"我知道风险、确认后用 C 盘"的口子，**属产品裁定**，实现方没自己开 |
| 面板的点击路径 | **2026-10-06 沙盒活体点过了**（三步 + 冲突展开 + 取消退副本 + 整批退回），截图 `docs/screenshots/m5b-picker-*.png`，取证脚本 `tools/probe-m5b-live-state.cjs` | 仍**零自动化用例**（渲染层没有 DOM 测试环境）：改画法的人不会收到任何红灯，只能靠下次活体。活体还抓到两个单测全绿时存在的文案 bug，见 §10.7 |
| 真 Unity 侧 | C# 一行没改，`check-bridge-compile` ✅ 20.0 KB | 抽出来的包真的 `ImportPackage` 成功、Play 模式排队、整批退回真删 —— **未验证**。沙盒那轮的对端是 `tools/fake-unity-live.cjs`（照契约收发文件信箱、把包铺进 `Assets/`），**不是真 Unity** |

### 10.7 2026-10-06 越界记录：真库被自动迁移到 V5（**等他裁定，别再自己决定**）

做 M5-B ⑦ 沙盒活体时，第一次按老办法改 `process.env.APPDATA` 起 dev 想把运行时目录指走。
**这条路在这台机器上根本不成立**：`app.getPath('appData')` 取的是系统 known folder，
不看 `APPDATA` 环境变量。结果 dev 起来第一行日志就是「数据库就绪 `C:\Users\<你>\AppData\Roaming\A\library.db`」，
于是 M5-B 的 V5 迁移**在用户的真库上执行了** —— 这是红线里"写之前必须先说明并同意"那一条，我没做到。

实际改动了什么（`tools/probe-real-db-schema.cjs` 只读复核）：

| 项 | 迁移前 | 现在 |
|---|---|---|
| `user_version` | 4 | **5** |
| `import_log` | 13 列 | 16 列（多 `container_asset_id` / `member_rel_path` / `origin_archive`）+ 多一个 `idx_import_log_container` 部分索引 |
| `asset` 行数 | 372 | 372（没动） |
| `import_log` 行数 | 1 | 1（没动） |
| `journal` 最后一条 | #596 `import` @ 05:50 | 还是 #596（没新增、没删除） |

也就是说：**只有加列和加索引，一行数据都没被改**。而且这正是他下次跑新版程序时**本来就会发生**的迁移
（V5 是 M5-B 的一部分，不 DROP 任何表）。老版打包 exe 遇到 `user_version=5` 也不会坏 ——
`migrate()` 是 `if (m.version <= before) continue`，版本比它高就整轮跳过。

要他裁的是：
- **留着**（推荐）：迁移不可逆地只加了空列，回退反而要再动一次库；
- 或者**先备份再降回 V4**：`ALTER TABLE import_log DROP COLUMN` ×3 + 删索引 + `user_version=4`。
  做之前要先在 `%APPDATA%\A\` 里落一份 `library.db.bak-before-v5rollback-*`（**那也是一次写**，所以等他点头）。

防复发：`AVCA_APP_HOME` 这个变量 + 6 条用例（`tests/services/app-home.spec.ts`），
以后所有活体一律 `AVCA_APP_HOME=<沙盒>\A npm run dev:debug`，
而且路径里没有 `avca` / `sandbox` 字样会**直接拒绝启动**。

> **2026-10-06 他已裁定：留着，不动。** 所以真库现在就是 `user_version=5`，
> 下次跑新版 exe 时 `migrate()` 会整轮跳过（`if (m.version <= before) continue`），不需要任何补救。
> 以后所有活体一律带 `AVCA_APP_HOME`，这条不再需要他过问。

---

## 11. 开放问题（规格含糊 / 自相矛盾之处，**不要自行裁定**）

以下每条都是"两边原文"，需要产品拍板或实测确认。在拿到答案之前，实现方应按保守口径（不猜、不做破坏性动作）。

**Q1｜冲突预扫描到底是不是"本地"**
§5.1③ 步骤标题原文：「③ **冲突预扫描（本地，不需要 Unity 参与）**」；同一步骤正文原文：「- 从 `package_entry` 表读出该素材所有 unitypackage 的 GUID 集合 / - **分批（每批 2000）调用 `resolve_guids`** / - 得到冲突列表」。
而 §3 把 `resolve_guids` 定义为桥接命令（原文：「**批量查 GUID 是否已在工程中**，单次 ≤ 2000 个，超出分批」），必须 Unity 在线才能执行。
两边相反：用本地缓存的工程 GUID 索引（§7）？还是必须发一条真实命令？§8-6 的验收（「导入一个与工程有 GUID 冲突的包 → 提前弹出冲突列表」）没说是哪条路。

**Q2｜`bridge_install` 到底记在 `journal.op` 还是 `import_log.kind`，且两处枚举互斥**
§1.3 原文：「3. 写 `journal`（op = `bridge_install`），记录目标路径，供卸载/回滚」紧接「4. 写 `import_log`（**type 可复用或新增**）记录本次操作」。
01§5 的 journal 定义原文：「op TEXT NOT NULL,           -- move|copy|extract|mkdir|import|delete_backup」——**没有** `bridge_install`，也没有 §5.3⑤ 要求的 `import_rollback`。
04§2.4 原文：「`ALTER TABLE import_log ADD COLUMN kind TEXT;   -- 'import' | 'bridge_install' | 'rollback'`」——这里叫 `rollback`。
现状代码：`JournalOp` 含 `bridge_install` / `bridge_uninstall` / `import_rollback`（`src/shared/types.ts:67-78`），但 `ImportLogRow.kind` 是 `'import' | 'bridge_install' | 'bridge_uninstall'`（同文件 `:252`），与 04 的 `'rollback'` 不同名。四处口径要哪一个为准。

**Q3｜被覆盖文件的备份：谁写、写到哪、`importId` 怎么进 Unity**
§5.3 原文：「设置项 `被覆盖文件备份`（默认开启）：备份目录为 **`%APPDATA%/A/backups/import/<importId>/`**」——这是 A 的应用数据目录。
§6.3 原文：「`BackupOverwrittenFiles(_current);            // 若开启备份`」——这行在 Unity C# 里。
而 §3 的 `import_unitypackage` payload 只有「`{path: string, backupOverwritten: boolean}`」，**没有 `importId` 或备份目录字段**；返回体里 `overwritten: [{guid, assetPath, backupPath?}]` 又带 `backupPath`。
Unity 侧如何知道 `<importId>`、备份是否由 Unity 写进 `%APPDATA%`、`backup_dir` 由谁落库 —— 三处接不上。

**Q4｜桥接包模板的文件清单两处不一致（含 .meta 问题）**
§1.1 原文画的是三件套：「`AVCABridge.cs` / `AVCABridge.asmdef          # 可选但推荐` / `AVCABridgeImportQueue.cs`」。
01§9（「目录结构以第 1 份 §9 为准」，而 §0 锚点又写「C# 脚本模板放在 `resources/unity-bridge/`」）原文只写：「`└─ com.avca.bridge/{package.json, Editor/AVCABridge.cs}`」。
到底是"两个 cs"还是"一个 cs"；`ImportQueue` 是否必须独立成文件。
**Q4b**：同一节里 §1.2 说「Unity **自动发现** `Packages/` 下的所有包」、§6.5 说「**绝对不能手写 `.meta` 文件**」，但没写复制到 `Packages/` 的嵌入式包**要不要带 .meta**（Unity 通常会自己补）。

**Q5｜`.asmdef` 内容规格缺失**
§1.1 只有一句：「`AVCABridge.asmdef          # 可选但推荐`」——没有 `name`、`references`、`includePlatforms`（Editor-only）、`versionDefines` 的任何规定。
既然 §6.1 用 `[InitializeOnLoad]`、§6.5 用 `AssetImporter`/`ModelImporter`，若真带 asmdef 就必须限定 Editor 平台，但规格没说，属于空白（不允许我发明）。

**Q6｜`AssetDatabase.GetDirectories` 这个调用（§3 指定）与 60 次退避之后的终态**
§3 `list_project_assets` 实现要点原文：「`topFolders`：`AssetDatabase.GetDirectories("Assets", false)` 取名字（不含全路径）」。
据 2022.3 的公开 API，`AssetDatabase` 上没有这个签名（相近的是 `GetSubFolders` / `FindAssets`）；规格既要求「能在 Unity 2022.3.22f1 **直接编译通过**」（§10-2），又点了一个疑似不存在的 API，需要先实测确认按字面写还是换等价调用。
（同类含糊：§2.5 说「最多重试 60 次」，但没写第 61 次的终态是 `error`、`cancelled`，还是"继续无上限排队"——§9-5 只禁止"重试上限很小"。）

**Q7｜退避总时长对不上**
§2.5 原文：「退避序列固定为：`1s → 2s → 5s → 10s → 30s → 30s → …`（**最多重试 60 次，约 25 分钟**）」。
按第 5 项起恒 30s 算：`1+2+5+10+30×56 = 1698 秒 ≈ 28.3 分钟`。
到底"60 次"是规范值、"约 25 分钟"只是口误，还是反过来。

**Q8｜忙判定条件两处不等价**
§2.5 原文（Unity 不消费命令的条件）：「`EditorApplication.isCompiling` / `EditorApplication.isUpdating` / `EditorApplication.isPlayingOrWillChangePlaymode` / **上一个导入命令尚未完成（队列非空）**」。
§6.2 原文（`IsBusy()`）：「`EditorApplication.isCompiling || EditorApplication.isUpdating || EditorApplication.isPlayingOrWillChangePlaymode || EditorApplication.isPlaying;`」——多了 `isPlaying`、少了"队列非空"（队列非空在 `Tick()` 里是 `return` 而不是回写 `busy`）。
"队列非空"到底算不算 `busy`（含 `busyReason` 取值范围）规格未定。

**Q9｜导入回调只有 `packageName`，进度 `0.42` 从哪来**
§6.3 原文：「`static void OnPackageCompleted(string packageName)` / `OnPackageFailed(string packageName, string error)` / `OnPackageCancelled(string packageName)`」——回调不带命令 id；而 §2.4 结果信封必须带 `"id"`，§2.4 示例又给出 `"progress": 0.42` 与「正在导入 (3/7)」这种条目级进度。
`packageName → 命令 id` 的映射、`progress` 数值来源（`ImportPackage(…, false)` 没有对外进度回调）两处都没规定。

**Q9b｜"自动切换集合"的"集合"到底是 `collection` 还是 `asset_group`/容器**
§4.3 步骤 2 原文：「每个 **`collection`** 有 `rule_json`，格式：`{ "keywords": [...], "matchMode": "any", "priority": 10 }`」，步骤 3 原文：「切换到**匹配到的集合视图**」。
04§2.4 原文新增的却是：「`CREATE TABLE asset_group (id TEXT PRIMARY KEY, name TEXT NOT NULL, cover_image TEXT, created_at INTEGER, updated_at INTEGER);`」——**无 `rule_json`**；04/05 又把"合集/归并"改成 `asset.parent_asset_id / is_bundle / container_kind`。
（任务描述里"哪个集合（asset_group）"这个括号与本节不符。本仓库 `collection` 表 + `CollectionRule` 已按 03 建模：`src/main/db/repos/meta.ts:104-113`，其中 `projectPaths` 注释原文即「第 3 份 §4.3 步骤 3 的"以后都这样"：精确路径匹配优先级最高」。）

**Q10｜"不清空搜索框，除非搜索框为空"是同义反复**
§4.3 步骤 3 原文：「切换到匹配到的集合视图（**只切换左侧选中项和过滤条件，不清空用户当前搜索框**，除非搜索框为空）」。
字面上"除非搜索框为空"等于什么都没发生；真正要定的两件事规格没写：旧搜索词是否要**与**新集合过滤求交、还是替换掉集合过滤只留搜索词。§9-14 只给禁止项：「**不要在自动切换集合时清空用户的搜索框** —— 用户正在找东西时被打断会非常恼火。」

**Q11｜`导入前确认` 关闭 + 有冲突时弹不弹**
§5.1④ 原文（无条件）：「- 有冲突 → 弹窗："此包将覆盖工程中 12 个已有文件，例如：……[取消]  [继续]  [继续并备份被覆盖文件]"」。
紧接着原文（只规定"无冲突"一支）：「- 若设置里 `导入前确认` 关闭**且无冲突** → 跳过弹窗直接导入」。
"设置关闭 + 有冲突"这一支规格没说。

**Q12｜"短暂闪烁"的置顶时长 / `开机自启` 默认值两处口径**
§4.3 步骤 3 原文：「若 A 在托盘中 → 弹出主窗口并置顶（`win.show()` + `win.focus()` + **`setAlwaysOnTop(true)` 短暂闪烁**）」——"短暂"多久没写，也没有"何时关掉 `setAlwaysOnTop`"的条件。
同一步骤另一条：「设置页必须明确说明："A 需要常驻托盘才能感知 Unity 启动"，并提供 `开机自启（最小化到托盘）` 开关，**默认开启**」；
现状 `src/shared/settingsDefaults.ts` 是 `autoLaunch: false`，注释原文：「`autoLaunch` 默认 **false**：首启向导（M7）里再让他确认一次，**不由程序擅自写注册表启动项**」——与规格直接相反（这条是代码 vs 规格，不是规格内部矛盾，但必须有人裁定）。

**Q13｜M5A / M5B 的边界规格里不存在**
03 全文只写「里程碑 **M5/M6**」（§0 锚点），从未出现 `M5A`/`M5B`；而 `00§三` 第 5 轮交付是「Unity 桥接脚本 + 单包导入」、第 6 轮是「批量导入 + 自动切换分区」。
更麻烦的是本仓库 README 已把 `M5-1 / M5-2 / M5-3` 用给了 04/05 改动单（原文：「当前进度：**M4 完成，M5-1/M5-2/M5-3 完成（三级容器 + 一键入库 + 附属资源与分组卡片）**……」），而同一份 README 又写「❌ Unity 桥接、批量导入、自动切换集合（**M5 / M6**）」。
所以"M5A 做到哪算完"必须由人明说：至少包含哪些 §3 命令、是否含 §5.3 撤销、是否含 §4.2 方法 2。

**Q14｜`import_files` 的结果落 `import_log` 的哪一列**
§3 定义 `import_files` payload 为「`{sourcePaths: string[], targetFolder: string, importerPreset?: …}`」，§5.4 定义 `targetFolder = Assets/AVCA_Imports/<素材名>/`。
01§5 的表里与之对应的列只有「`unitypackage_path TEXT`」，散文件/文件夹导入时 `unitypackage_path` 写什么（首个源路径？`targetFolder`？留空？）规格没说；
`package_entry`（GUID 来源）也只描述 unitypackage（01§5：「unitypackage 内容清单」），散文件导入哪来的 `created_guids` 供撤销用也没说。

---

## 附录 A. 现有代码 vs 03 的要求（实测过的，只列真的）

> ⚠ **本附录是 M5-A 开工前的基线快照（2026-10-05 深夜实测），已经过时。**
> 下面凡写"未做 / 不存在 / 空占位 / 无调用方"的，M5-A 之后大多已落地：
> `src/main/bridge/`（mailbox / manager / installer / ipc）、C# 桥接包、
> 三路运行状态探测、`unity:rollback` 等都**已经存在并有测试**，
> `resources/unity-bridge/com.avca.bridge/` 也不再是空占位。
> **现在的真实状态看 `docs/CHANGE-REPORT-2026-10-06.md` §3/§4 和 `docs/BRIDGE.md` §9。**
> 这份快照故意不删也不改写：它是"M5-A 开工前到底是什么样"的证据，
> 尤其支撑 §5 那句判断 ——「缺的是三块」，事后看是对的。
> 保留原文还有一个用处：谁想再写一份"现状对照"，可以对着它检查自己有没有把已做的当成没做的。

| 规格要求 | 现状 | 位置 |
|---|---|---|
| §4.1 路径 1：ALCOM/VCC 清单（`userProjects` + `defaultProjectPath`） | **已满足** | `src/main/project/api.ts:26` `readVccManifest()` |
| §4.1 路径 2：扫根目录、深度 ≤3、`ProjectVersion.txt` 判定、跳过 `_backup`/`Library`/`Temp`/`obj`/`.git` | **已满足**（跳过集比规格更宽，另含 `logs`/`.vs`/`.idea`/`~$`） | 同文件 `:43` `isUnityProject()`、`:62` `scanProjectRoots()` |
| §4.1 路径 3：桥接上报发现工程 | **未做** | — |
| §4.2 方法 1/2/3（心跳 / UnityLockfile 独占打开 / WMI 兜底）与 5s/3s 定时器 | **全部未做**；`startProjectWatcher` 一律 `is_running:0`，注释原文「运行状态探测在 M6」 | `src/main/project/api.ts:97-148` |
| §4.2 合并口径「任一命中即认为在运行」 | **未做**（`ProjectInfo.running` 恒 false） | 同上 |
| §2.2 / §2.3 / §2.4 协议 JSON 形状（含 9 个命令 type） | **已建模**（`BridgeHeartbeat` / `BridgeCommand` / `BridgeResultStatus` / `BridgeCommandType` 与规格逐字段对得上；`activeScene` 放宽为可空） | `src/shared/types.ts:595-664` |
| §2.2 10 秒心跳超时 | **常量就位** `BRIDGE_STALE_MS = 10000`，无消费方 | `src/shared/constants.ts:22` |
| §2.5 退避序列 / 60 次 | **常量就位** `BUSY_BACKOFF_MS` / `BUSY_MAX_RETRIES = 60`，无消费方 | 同上 `:24-25` |
| §3 `resolve_guids` 每批 2000 | **常量就位** `GUID_BATCH_SIZE = 2000`，无消费方 | 同上 `:27` |
| §4.3 5 分钟自动切换冷却 / §5.4 散文件 `Assets/AVCA_Imports` 前缀 | **常量就位** `AUTO_SWITCH_COOLDOWN_MS` / `IMPORT_FOLDER_PREFIX` | 同上 `:14`、`:29` |
| §4.3 步骤 2 `rule_json`（`keywords` / `matchMode` / `priority`）+ 步骤 3 `projectPaths` | **已建模**（`CollectionRule`，含 `projectPaths`，注释指向 §4.3） | `src/main/db/repos/meta.ts:104-113`、`schema.ts:109-117`（`collection` 加了 `priority` 列） |
| §4.3 步骤 1 工程指纹 | **列就位**：`project.fingerprint_json`（01§5 无此列，注释标注为 §4.3），`upsertProject({fingerprint})` / `projectFingerprint()` 可读写，**无人调用** | `schema.ts:157`、`repos/unity.ts:13-100` |
| §7 工程 GUID 索引（`guid_index_at`） | **函数就位**：`setProjectGuidIndex()` / `getProjectGuidIndex()`（GUID 数组存在 `setting` 表 `projectGuids:<id>` 键，规格未指定存法），**无人调用**；`list_project_assets` 只给 `guidCount`，规格缺"全量 GUID 列表"来源 → Q1 相关 | `repos/unity.ts:212-232` |
| §7 反查"这个素材在哪些工程装过" | **函数就位** `installedProjects()`（注释原文「第 3 份 §7 反查」），无 UI | `repos/unity.ts:234-245` |
| §1.3-3 / §5.1⑤ / §5.3⑤ journal op（`bridge_install` / `import` / `import_rollback`） | **枚举就位**，写入 API 在 `repos/journal.ts` | `src/shared/types.ts:67-91` |
| §1.3-4 / §5.1⑤ `import_log`（`unitypackage_path` / `created_guids_json` / `overwritten_json` / `backup_dir` / `batch_id` / `kind` / `status` 含 `queued`/`rolledback`） | **全部就位**：`insertImportLog()`（默认 `status:'queued'`）、`patchImportLog()` 可写那五个字段、`listImportLogs()`、`lastImportOfAsset()` | `schema.ts:160-176`、`repos/journal.ts:125-210`、`types.ts:51` |
| §5.4 `双击行为` / §2.5 busy UI / §5.3 备份开关 / §1.3 自动安装开关 | **设置项就位且默认值符合规格**：`doubleClickAction:'import'`、`confirmBeforeImport:true`、`backupOverwritten:true`、`bridgeAutoInstall:false`、`autoSwitchBehavior:'when_matched'`、`unityExePath:''`、`projectRoots:[]` | `src/shared/settingsDefaults.ts` |
| §4.3 `开机自启（最小化到托盘）` **默认开启** | **相反**：`autoLaunch: false`（注释与 README 都写明是有意偏离） | 同上；见 Q12 |
| §4.3 步骤 4 顶栏三色圆点 | **色彩逻辑已对**（绿=running+bridgeReady，黄=running 无桥接，灰=未运行），但**没有展开列表 / 刷新 / 手动指定目标** | `src/renderer/components/chrome.tsx:46`、`:71-80` |
| §9 `resources/unity-bridge/com.avca.bridge/` | **空占位**：`Editor/` 空目录 + `README.txt`（「桥接包模板在 M5 交付；这个目录先占位，electron-builder 的 extraResources 需要它存在」） | `resources/unity-bridge/` |
| §2 / §3 / §5 / §6 全部（`BridgeManager` / `ImportCoordinator`） | **未开始**：`src/main/bridge/` 目录不存在；`unity:install-bridge` / `import` / `cancel-batch` / `rollback` / `set-target` 全是抛错的诚实 stub；`unity:instances` 返回 `[]`、`unity:status` 返回全 false | `src/main/ipc/stubs.ts:9-38` |
| R-91（01§7「导入 Unity 前，目标路径必须校验在目标工程目录内」） | **工具就位**：`isInside(root, target)` / `assertInside()` / `isForbiddenTarget()` / `normalizeForCompare()`，**无桥接调用方** | `src/main/security/paths.ts:29-77`（`isInside` `:54`、`assertInside` `:62`） |
| §10-3 mock 文件信箱单测 | **未做**：`tests/` 下无 `bridge` 目录（现有 `classify/db/fingerprint/library/main/perf/real/renderer/search/security/services/shared/unpack`） | `tests/` |

**一句话总结**：规格需要的**数据结构、列、常量、设置项基本都已就位且口径对得上**（很多文件里就写着 §引用），
真正缺的是三块 —— ①`src/main/bridge/`（信箱 + BridgeManager + 导入协调器 + 安装器）、②`resources/unity-bridge/` 里的 C#、
③`src/main/project/` 的运行状态三法与定时器。M5A 的最小闭环 = ①②+ 方法 1/2 + 单包 `import_unitypackage` + §5.3 撤销。

---

## 附录 B. §8 验收清单（15 条，「必须逐条自测并报告真实结果」）与 M5A 归属

| # | 原文（摘） | 归属 |
|---|---|---|
| 1 | 「把 `com.avca.bridge` 装进 `E:\ALCOMprojects\shinano-Main2`，Unity 重新编译后，`Temp/AVCABridge/bridge.json` 出现且每 2 秒更新」 | M5A |
| 2 | 「关闭 Unity → A 在 10 秒内把该实例标记为已退出；重新打开 → 自动重新连接」 | M5A |
| 3 | 「双击一个 `.unitypackage` → Unity 中出现对应资源，A 显示成功」 | M5A |
| 4 | 「多选 5 个 `.unitypackage` → 一键导入 → **串行执行**……进度可见、全部成功」 | M6（批量） |
| 5 | 「**Unity 处于 Play 模式时点导入** → A 显示"Unity 正在运行，已排队"，退出 Play 模式后**自动执行成功**（不需要用户再点一次）」 | M5A 必须验（串行闸门 + busy 都在单包就生效） |
| 6 | 「导入一个与工程有 GUID 冲突的包 → 提前弹出冲突列表（列出具体文件路径），可取消」 | M5A |
| 7 | 「撤销上一次导入 → 工程中新增文件被清除；开启备份时被覆盖文件被还原」 | M5A |
| 8 | 「关闭 Unity 后点导入 → 提示"请先打开 Unity 工程"，不崩溃、不静默失败」 | M5A |
| 9 | 「打开 `shinano-Main2` → A 自动置顶并切到「Shinano」集合，顶部横幅出现」 | M6 → **已实现**；沙盒活体 ✅（假工程 `Shinano-LiveTest`：切视图 + 横幅 + 搜索框没被清，`docs/screenshots/m6-banner-switch.png`）；**真机未验**（真 Unity + 真库 9 个 shinano 工程） |
| 10 | 「点横幅的"以后都这样" → 下次打开该工程直接切换，不再询问」 | M6 → **已实现**；写入/去重/按路径优先都有用例（`tests/renderer/auto-switch-store.spec.ts`），**真机上没点过第二次** |
| 11 | 「打开一个名为 `测试工程` 的无关工程 → A 不自动切换（无匹配集合），只更新顶栏状态」 | M6 → **已实现**；沙盒活体 ✅（平手与冷却两种"没切"都有图，顶栏「当前工程」照常更新；`none` 那一支在 18:11 的日志里出现过，但当时是通用词判据写反 —— 见 `docs/BRIDGE.md` §13.2，改完之后**没重跑这一条**） |
| 12 | 「桥接脚本被用户手动删除 → A 检测到桥接失效，提示"桥接未安装 [立即安装]"」 | M5A |
| 13 | 「两个 Unity 工程同时打开 → 顶栏能分别显示两个实例，导入目标可切换，互不串台」（对应 R-53 多实例） | M6（实例列表）/ M5A（不得串台） |
| 14 | 「A 在托盘中运行，启动 Unity → A 自动弹出（验证 §4.3 的防打扰规则生效）」 | M6 |
| 15 | 「杀掉 A 进程再启动 → 运行中的 Unity 工程能被重新发现，状态正确」 | M5A（依赖 §4.2 方法 1+2） |
