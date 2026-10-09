# Atrium ⇄ Unity 桥接协议

> 面向接手的人与想手动调试的人。规格出处：`03-Unity桥接与工程联动.md`，
> 蒸馏版在 `docs/M5A-SPEC-NOTES.md`。**本文写的是"实际实现成什么样"**，以代码为准。
>
> 实现位置：A 侧 `src/main/bridge/`，Unity 侧 `resources/unity-bridge/com.avca.bridge/`。

---

## 1. 它是什么

A 与 Unity 之间**唯一的**通信方式是一个**文件信箱**，落在工程自己的 `Temp/` 下：

```
<Project>/Temp/AVCABridge/
  ├─ bridge.json          Unity 写 → A 读    心跳与状态
  ├─ inbox/<id>.json      A 写   → Unity 消费后删
  └─ outbox/<id>.json     Unity 写 → A 读后删
```

完整路径实例：`E:\ALCOMprojects\shinano-Main2\Temp\AVCABridge\bridge.json`

### 为什么是文件，不是 TCP / HTTP / 命名管道（规格 §2.1，**不得改**）

原文五条理由，逐条都对应一个真实麻烦：

1. Unity 不会导入 `Temp/` 下的文件，不会触发无谓的资源刷新
2. Unity 关闭时 `Temp/` 自动清理，不留垃圾
3. 不涉及端口占用、防火墙、多实例端口冲突 —— 用户同时开三个工程时，
   端口方案要自己发明一套多实例协议
4. 不需要处理连接建立/断开/重连的竞态
5. 文件系统的**原子 rename** 天然提供了"命令只被消费一次"的语义

第 5 条是整个协议的基石，见下面「写盘纪律」。

### 桥接为什么装在 `Packages/` 而不是 `Assets/`（规格 §1.2，**不得改**）

VRChat 上传 Avatar 时**只处理 `Assets/`**。放在 `Packages/com.avca.bridge/` 里的
嵌入式 UPM 包**绝不会**混进用户的 Avatar 被一起传上去。放 `Assets/` 是
"看起来能用、上传时才发现"的那类问题。

`tests/bridge/real-template.spec.ts` 里有一条用例专门断言安装后 `Assets/` 下没被建东西。

---

## 2. 三个文件格式

### 2.1 `bridge.json` —— Unity 写，A 读

```json
{
  "protocolVersion": 1,
  "pid": 12345,
  "projectPath": "E:\\ALCOMprojects\\shinano-Main2",
  "projectName": "shinano-Main2",
  "unityVersion": "2022.3.22f1",
  "bridgeVersion": "1.0.0",
  "isPlaying": false,
  "isCompiling": false,
  "isUpdating": false,
  "isPlayingOrWillChangePlaymode": false,
  "activeScene": "Assets/Scenes/Main.unity",
  "busyReason": null,
  "queueLength": 0,
  "heartbeatUtc": 1759500000000
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `protocolVersion` | number | 固定 `1`。对不上时 A 判定桥接不可用并给出"协议版本不匹配" |
| `pid` | number | Unity 进程号（多实例时用来区分） |
| `projectPath` | string | 工程绝对路径 |
| `projectName` | string | 工程目录名 |
| `unityVersion` | string | 例 `"2022.3.22f1"` |
| `bridgeVersion` | string | 桥接自身版本 |
| `isPlaying` / `isCompiling` / `isUpdating` / `isPlayingOrWillChangePlaymode` | boolean | 忙判定用 |
| `activeScene` | string \| null | 当前场景 |
| `busyReason` | string \| null | 忙因，随 `busy` 结果一起回传 |
| `queueLength` | number | Unity 侧待处理命令数 |
| `heartbeatUtc` | number | 毫秒 epoch |

**心跳间隔 2 秒**（由 `EditorApplication.update` 驱动，节流到 2 秒写一次）。

#### A 侧怎么判定"Unity 还活着" —— 一个踩过的坑

判据是**文件的 `mtime`**，不是 `heartbeatUtc`，也**不是"A 读到它的时刻"**。

- 用"A 读它的时刻"是**恒真的**：那个值永远是刚读的。后果是 Unity 崩了、
  桥接脚本被禁用了、`bridge.json` 冻结一周，A 都坚称它活着，界面上会一直列一个
  早就关掉的僵尸工程。这是实现过程中被测试抓出来的第一个真 bug。
- `heartbeatUtc` 也不行：它是**写文件那一刻的当下时间**，和写入同时发生，
  所以文件冻结之后它看起来仍然"很正常"（停在最后写入时刻）。
  取 `max(mtime, heartbeatUtc)` 同样错 —— 那等于没判。

**超时 10 秒**（`BRIDGE_STALE_MS`）→ 判定该实例已退出。
注意规格明确要求：**清理该实例，但保留 `project` 记录**。

### 2.2 命令信封 —— A 写，Unity 读

```json
{
  "id": "01J8XYZK7Q9M2N4P6R8S0T2V4W",
  "type": "import_unitypackage",
  "protocolVersion": 1,
  "createdAt": 1759500000000,
  "payload": { "path": "E:\\vrc\\A\\lilToon_2.x.x\\installer.unitypackage" }
}
```

`id` 是 ULID。落地文件：`inbox/<id>.json`。

#### 写盘纪律（**必须**）

先写 `<id>.json.tmp`，再 `fs.rename` 成 `<id>.json`。
Unity 侧枚举 `inbox/` 时**跳过任何 `.tmp`**（说明 A 还没写完）。

#### busy 退避重投为什么复用同一个 id

Unity 忙的时候**不消费命令**，只写一条 `busy` 结果，命令文件还留在 `inbox/` 里。
所以"重投"就是覆写同一个文件，天然幂等。
如果每次重试换新 id，`inbox/` 里会堆出一串没人认领的副本。

### 2.3 结果信封 —— Unity 写，A 读

```json
{
  "id": "01J8XYZK7Q9M2N4P6R8S0T2V4W",
  "status": "progress",
  "progress": 0.42,
  "message": "正在导入 (3/7)：GoLoco.v.1.8.6u.unitypackage",
  "data": null
}
```

`status` 枚举：`ok` | `progress` | `busy` | `error` | `cancelled`

**一个命令能产生多条结果**：多条 `progress` + 一条终态。
文件名**固定为 `<id>.json`**，进度更新是**覆写**同一个文件（同样 tmp+rename 原子写）。
A 侧 chokidar 监听 `change` 事件。

`error` 时 `data` 里带完整异常：

```json
{
  "id": "01J8...",
  "status": "error",
  "data": {
    "exception": "目标已存在，拒绝覆盖：…",
    "stackTrace": "at AVCA.Bridge.AVCABridge.DoImportFiles(...)\n  at ..."
  }
}
```

规格 §6.6 明确「**不得静默吞异常**，完整堆栈必须回传」——A 侧要能展示和上报。

> 口径映射：桥接结果用 `error`，`import_log.status` 用 `failed`。落库时 `error → failed`。

### 2.4 ack 与终态契约

| 事件 | 谁做什么 |
|---|---|
| A 下发命令 | 写 `inbox/<id>.json.tmp` → rename 成 `inbox/<id>.json` |
| Unity 取命令 | 500ms 节流 Tick 内枚举 `inbox/`，跳过 `.tmp` |
| Unity 忙 | **不消费**，直接写 `outbox/<id>.json`（`status: "busy"` + `busyReason`） |
| 进行中的进度 | Unity **覆写** `outbox/<id>.json`；命令文件留在 `inbox/` 不动 |
| 终态（ok/error/cancelled） | ① Unity 写终态 → ② **Unity 删 `inbox/<id>.json`** → ③ A 读到终态 → ④ **A 删 `outbox/<id>.json`** |
| A 侧串行闸门 | 每条命令**等终态**才发下一条 |

**删除权归读方**。这条不对称是有意的：谁"读完"谁负责清，不然两边都可能以为自己该删
或都以为对方会删。

⚠ 但 `busy` 是个例外：**A 读到 `busy` 也要立刻消费掉那个文件**。
不消费的话，退避重投之后 A 会立刻又读到自己刚处理过的**同一条旧 busy** ——
重试次数凭空多算一次，而且可能在真结果到达前就提前收工。
这是实现过程中抓出来的第三个真 bug。

---

## 3. `busy` 不是失败（规格 §2.5，**最容易被写错的一条**）

**忙的四个条件**（缺一不可，少一个就会误判"Unity 空闲"）：

```csharp
EditorApplication.isCompiling
  || EditorApplication.isUpdating
  || EditorApplication.isPlayingOrWillChangePlaymode
  || EditorApplication.isPlaying
```

⚠ `isUpdating` 在 `ImportPackage` 期间为 true 是**正常的**，不是卡死。

**A 侧的退避序列固定不可改**：

```
1s → 2s → 5s → 10s → 30s → 30s → …（最多 60 次）
```

第 5 项起恒为 30s。用户可能一整晚开着 Play 模式，所以规格明确禁止
「把重试上限设得很小」，也明确写着「**绝对不能把 `busy` 当成失败**」。

### ⚠ 一个被"协议对账测试"抓出来的真 bug（2026-10-06 已修）

修之前，C# 侧 `busy` **只被读、从来没被写过** —— 它只出现在 `IsBusy()` 与心跳的
`busyReason` 里，`outbox/` 里**从来不会出现 `status: "busy"`**。

后果链条很清楚：

1. Unity 忙（Play / 编译 / 刷新）时不消费命令 —— 这部分规格要求做到了
2. 但它也**没有回写 busy**，所以 A 侧收到的是**沉默**
3. A 等到 ack 超时（10 秒），报「桥接没有回应」，命令**失败**
4. **A 侧那整套 1s→2s→5s→10s→30s 退避在生产里永远不会被触发**
5. 验收 §8-5（Play 模式下点导入 → 排队 → 退出 Play 后自动执行）**过不去**

规格 §2.5 原文：「不消费命令，**直接写回 `busy` + `busyReason`**」—— 后半句漏了。

修法（`Tick()` 里的顺序很关键）：

```csharp
if (_current != null) return;          // 正在导入：什么都别做
if (IsBusy()) { ReportBusyToPending(); return; }   // 没法接新活：如实回 busy
if (Queue.Count > 0) return;           // 串行：一次只处理一个
```

**「正在处理一条命令」与「忙」必须分开**：前者写 busy 会让 A 把一条正常进行的导入
当成"被拒了"而去重投（同一份包被重复提交）；后者不写 busy 就是上面那五步。
`tests/bridge/protocol-conformance.spec.ts` 里有四条用例钉住这个区别，
包括「忙时不许删 inbox 里的命令」和「调用必须真的存在」（不只是函数定义在）。

> 这条 bug 是**协议对账测试**发现的：那个文件把 C# 源码里的命令名、payload 键名、
> 状态字面量、心跳字段名和 TS 侧的类型逐一对账。字段名/枚举值拼错**不会编译报错、
> 不会类型报错**，在真机上的表现是"命令发出去永远没回应"—— 最难查的一类。
> 写这个测试时还犯过一次错：我第一版只断言源码里含 `ReportBusyToPending` 这个**函数名**，
> 结果把调用删掉、只留空定义它照样通过 —— 等于没测。改成查**调用行**后才真的能抓。


> 算术核对：`1+2+5+10+30×56 = 1698s ≈ 28.3 分钟`，与规格原文"约 25 分钟"不完全一致。
> 实现取**序列本身**为准（序列是硬性的，那个"约 25 分钟"是描述）。
> 这个歧义记在 `docs/M5A-SPEC-NOTES.md` §11-Q7。

**验收口径**（规格 §8-5）：
「Unity 处于 Play 模式时点导入 → A 显示"Unity 正在运行，已排队"，
退出 Play 模式后**自动执行成功**（不需要用户再点一次）」。

---

## 4. 命令清单

九条全部实现，不做子集。

### `ping`
```json
{"type":"ping","payload":null}
```
结果 `data`：`{"pong":true}`

### `get_status`
结果 `data`：
```json
{"isPlaying":false,"isCompiling":false,"isUpdating":false,"isBusy":false,
 "unityVersion":"2022.3.22f1","queueLength":0}
```

### `resolve_guids`
```json
{"type":"resolve_guids","payload":{"guids":["4b344df74d4849e3b2c978b959abd31b"]}}
```
结果 `data`：
```json
{"resolved":{"4b344df74d4849e3b2c978b959abd31b":"Assets/com.anatawa12.vpm-package-auto-installer/config.json"}}
```
不存在时值为 `null`。

**单次 ≤ 2000 个**（`GUID_BATCH_SIZE`），超出由 A 侧分批。
`AssetDatabase.GUIDToAssetPath` 对不存在的 GUID 返回**空字符串，不抛异常**（规格 §6.4）。

### `import_unitypackage`
```json
{"type":"import_unitypackage","payload":{
  "path":"E:\\vrc\\A\\lilToon_2.x.x\\installer.unitypackage",
  "guids":["4b344df7…"],
  "backupOverwritten":true
}}
```
结果 `data`：
```json
{"createdGuids":["93e23fe9…"],"overwrittenGuids":["4b344df7…"],
 "package":"E:\\vrc\\A\\…\\installer.unitypackage"}
```

`createdGuids` 的算法（规格 §6.3）：**命令开始前**对包内 GUID 列表逐个
`GUIDToAssetPath` 快照，导入后重新查一次，**导入前为空、导入后有值的即为新建**；
导入前后都存在的进 `overwrittenGuids`。

⚠ **这一条的串行性是整个桥接里最容易翻车的地方**，见 §6。

### `import_files`
```json
{"type":"import_files","payload":{
  "sources":["E:\\外部\\贴图.png"],
  "destFolder":"Assets/AVCA_Imports"
}}
```
结果 `data`：`{"created":["Assets/AVCA_Imports/贴图.png"]}`

**绝不手写 `.meta`**（规格 §9-3 / 00§五-8）：走
`FileUtil.CopyFileOrDirectory` + `AssetDatabase.Refresh()`，让 Unity 自己生成。
手写 meta 的 GUID 格式、`fileFormatVersion`、各类 importer 默认字段极易写错，
而且写错的表现是"看起来能跑、用起来出问题"。

目标已存在时**拒绝覆盖**并报错，不静默盖掉用户的东西。

### `delete_guids`
```json
{"type":"delete_guids","payload":{
  "guids":["93e23fe9…"],
  "allow":["93e23fe9…"]
}}
```

⚠ **这是最危险的一条，所以是双重校验**：

1. 每个 GUID 必须在 `allow` 白名单里（调用方传本次导入新建的 `createdGuids`）
2. 解析出来的路径必须以 `Assets/` 开头

**任一不满足就整条命令拒绝**，不做部分删除 —— 部分删除会留下更难解释的半成品。

**绝不提供"按 GUID 随便删"的接口。** 这是规格 §5.3 用 ⚠ 标出来的硬要求。

### `list_project_assets`
结果 `data`：`{"installedPackages":["com.anatawa12.vpm-package-auto-installer"]}`

只做**一定能成功**的两部分：`Packages/manifest.json` 的 `dependencies` 键名。
规格提到「反射查找（找不到类型时返回空数组，**不能抛异常**）」——
去反射凑 VRChat SDK 的内部列表是 M5-B（依赖分析）的活，
现在硬凑反而会引入"某个 SDK 版本下就抛异常"的脆弱点。

### `refresh`
调 `AssetDatabase.Refresh()`。撤销导入还原文件之后会用它。

### `open_folder`
`payload: {"assetPath":"Assets/…"}` → `EditorGUIUtility.PingObject` 定位。
找不到就静默返回，不抛。

---

## 5. Unity 侧的实现约束（规格 §6，写错就"偶尔成功偶尔失败"）

| # | 约束 | 为什么 |
|---|---|---|
| 1 | **导入必须事件驱动 + 严格串行** | 见 §6 |
| 2 | **不手写 `.meta`** | 见 `import_files` |
| 3 | 静态构造里**只做轻量工作** | 不建目录以外的耗时扫描；`[InitializeOnLoad]` 保证重编译后自动恢复 |
| 4 | Tick 里**不做同步 IO 等待** | Tick 每 500ms 一次，卡住会拖慢编辑器 |
| 5 | **不用 `EditorUtility.DisplayProgressBar`** | 它会阻塞；让 Unity 自己的进度条工作 |
| 6 | **不调用改变用户状态的操作** | 不 `EditorApplication.Exit`、不 `EditorSceneManager.SaveScene` |
| 7 | **不静默吞异常** | 完整堆栈回传（`exception` + `stackTrace`） |
| 8 | 读 `inbox/` **跳过 `.tmp`** | 说明 A 还没写完 |
| 9 | 删除失败**不要抛** | 下次 Tick 重试即可（Temp 可能被清理、杀毒软件可能锁文件） |
| 10 | **不做任何联网请求** | 本机文件信箱是唯一通道 |
| 11 | **零第三方依赖** | 自带极简 JSON 读写，不引 Newtonsoft —— 能在 2022.3.22f1 直接编译通过 |

### Tick 的三道闸门（顺序不能变）

```csharp
if (EditorApplication.timeSinceStartup - _lastTick < 0.5) return;  // 500ms 节流
if (IsBusy()) return;                 // 忙时只更新心跳，不消费命令
if (_queue.Count > 0 || _current != null) return;  // 串行：一次只处理一个
```

---

## 6. 第一大坑：`ImportPackage` 是异步的

**错误写法**（规格 §6.3 原文注释就是这个例子）：

```csharp
// ❌ 连发会导致导入互相打断、结果不可预测
foreach (var cmd in commands)
    AssetDatabase.ImportPackage(cmd.path, false);
```

**正确做法**：单值 `_current` + 三个回调推进

```csharp
AssetDatabase.importPackageCompleted += OnImportCompleted;
AssetDatabase.importPackageFailed    += OnImportFailed;
AssetDatabase.importPackageCancelled += OnImportCancelled;
```

收尾三步：① 用导入前的快照做差集收集 `createdGuids`
→ ② 写 `outbox` 终态结果 → ③ 删掉 `inbox` 里的命令文件。
然后**下一次 Tick 会自动取队列里的下一条**。

`tests/bridge/real-template.spec.ts` 里有一条**静态检查**：断言这三个回调都在
C# 源码里、断言走了 `FileUtil`、断言没有 `EditorApplication.Exit` /
`EditorSceneManager.SaveScene` / `DisplayProgressBar`。
（写那条断言时踩过一次：`not.toContain('DisplayProgressBar')` 被文件里
"**不要**用 DisplayProgressBar"的**文档注释**绊倒了 —— 判"有没有调用某 API"
必须剥掉注释再判。）

---

## 7. 怎么调试

### 7.1 看桥接有没有起来

```powershell
# 心跳文件（工程目录名按需替换）
Get-Content 'E:\ALCOMprojects\shinano-Main2\Temp\AVCABridge\bridge.json' -Encoding UTF8
```

每 2 秒 `heartbeatUtc` 应当往前走。文件**不更新**就是桥接没在跑
（Unity 没开 / 脚本编译失败 / `Packages/com.avca.bridge` 被删了）。

### 7.2 手动模拟一条命令（不通过 A）

这是排障时最有用的手法：直接往 `inbox/` 放一个文件，看 Unity 怎么答。

```powershell
$proj = 'E:\ALCOMprojects\shinano-Main2'
$id   = '01J8TEST000000000000000000'
$json = @"
{
  "id": "$id",
  "type": "ping",
  "protocolVersion": 1,
  "createdAt": $(Get-Date -UFormat %s)000,
  "payload": null
}
"@
# 纪律：先写 .tmp 再改名（目录项必须是 .json 才会被消费）
Set-Content "$proj\Temp\AVCABridge\inbox\$id.json.tmp" $json -Encoding UTF8
Move-Item "$proj\Temp\AVCABridge\inbox\$id.json.tmp" "$proj\Temp\AVCABridge\inbox\$id.json"

Start-Sleep -Seconds 2
Get-Content "$proj\Temp\AVCABridge\outbox\$id.json" -Encoding UTF8
```

应当看到 `{"id":"01J8TEST…","status":"ok","data":{"pong":true}}`，
并且 `inbox\$id.json` **已经消失**（Unity 消费完删掉了）。

想看 `busy` 长什么样：**进 Play 模式**再发同一条命令。

### 7.3 直接在 Unity 里看日志

桥接会往 Console 打：
- `[AVCA] 桥接已就绪：<临时目录路径>` —— 静态构造跑通了
- `[AVCA] 写心跳失败：…` / `[AVCA] 读命令失败 …` —— 文件被锁或被清理
- `[AVCA] 建桥接目录失败：…` —— `Temp` 不可写

如果**完全没有** `[AVCA]` 开头的日志，说明桥接没被编译进去：
确认 `Packages/com.avca.bridge/Editor/AVCABridge.cs` 存在，并且 Console 里没有编译错误。

### 7.4 A 侧怎么看

A 的日志在 `%APPDATA%\A\logs\main.log`，搜 `[bridge]`：

```
[bridge] 已安装到 E:\ALCOMprojects\shinano-Main2\Packages\com.avca.bridge（4 个文件）
[bridge] ping 排队中（Unity 忙：Unity 正在运行 Play 模式），第 1 次重试，等 1000ms
[bridge] 命令失败（error）：Unity 已经关闭（心跳停了），这条命令没有执行
```

### 7.5 单测（不需要 Unity）

```bash
npm test -- tests/bridge
```

`tests/bridge/fake-unity.ts` 是一个**真的在监听 `inbox/`** 的假对端，
照 §2.4 的 ack 契约行事。`tests/bridge/manager.spec.ts` 用它把
`busy → 退避 → ok` 的完整时序跑通（规格 §10-3 点名要求的）。

---

## 8. 已知限制（**诚实清单**）

规格 §10-5 / §10-6 要求把这些明确列出来。

### 8.1 A 没运行时感知不到 Unity 启动（物理限制）

桥接往 `Temp/` 写心跳，而**只有 A 在跑的时候才有人去读**。
A 没运行的时候，Unity 什么时候开的 A 根本不知道。

**缓解**：开机自启 + 托盘常驻。设置页必须向用户说明这一点
（规格 §4.3 步骤 3 明确要求）。

### 8.2 `Temp/` 会被清理

`Temp/` 是临时目录，Unity 关闭时会自动清理（这既是优点也是限制）：
- 桥接的目录在 Unity 没运行时**不存在**，所以"A 侧检测 Unity 是否运行"
  **不能只靠桥接**，需要三路取并集（ALCOM 清单 / `UnityLockfile` / 心跳，WMI 仅兜底）
- `Temp/UnityLockfile` 在 Unity **异常退出**时可能残留，
  所以判据是"**独占试开**"而不是"文件存在"

### 8.3 管理员权限的 Unity：WMI 读不到命令行

Unity 以管理员权限启动时，非管理员进程读不到它的 `CommandLine`（返回 null）。
这是 **Windows 的既定行为，不是 bug**。

所以 WMI 只是**兜底**：主路径是 `UnityLockfile` 独占试开与桥接心跳。
只靠 WMI 会变成"偶尔检测不到 Unity"，而且只在用户用管理员身份跑 Unity 时复现 ——
极难自己发现。规格 §4.2 把这条单独标了 ⚠。

### 8.4 Play 模式下无法导入

`ImportPackage` 在 Play 模式下被 Unity 阻止。桥接的处理是**排队**（写 `busy`），
A 侧退避重投，退出 Play 后自动执行成功。**不打断 Play**。

### 8.5 `UnityLockfile` 判据必须用读写模式试开

Unity 持 `_SH_DENYWR`（禁止写）打开锁文件，所以只有**请求写权限**的打开会被拒。
用只读（`r`）去试会在 Unity 正开着的时候也成功 —— 这一路就永远判"没在运行"。

实测方法（不需要 Unity，可复现）：PowerShell 用
`[System.IO.File]::Open(path,'Open','ReadWrite','None')` 持住文件，
此时 Node 的 `openSync(path,'r+')` 抛 `EBUSY`，而 `'r'` 能打开。

⚠ **不能用 Node 自己当持有者**：Node/libuv 的 open 带共享标志、不构成独占，
即使跨进程也测不出来。写那条测试时第一版就是这么假失败的。

### 8.6 A 侧尚未完成的部分（M5-A 范围内）

| 项 | 状态 |
|---|---|
| 自动切换集合 + 顶部横幅（规格 §4.3 步骤 3） | ❌ 未做 |
| 压缩包型容器的成员提取（`03` 规格的漏洞） | ❌ 未做，设计文档在交接说明 §M5-B |
| 导入状态反查（"这个素材在哪个工程装过"） | ⚠ 只做了 `import_log` 直查，GUID 反查是 M5-B |
| 依赖分析接入 | ❌ M5-B |

### 8.7 C# 桥接的验证边界（**已做编译检查，运行时仍需 Unity**）

**"能不能编过"这件事已经离线验证了**，不需要用户点：

```bash
node tools/check-bridge-compile.cjs          # 或 npm test 里的 compile-check
```

它用 **Unity 自带的 Roslyn**（`Editor/Data/DotNetSdkRoslyn/csc.dll`）对着
**Unity 2022.3.22f1 真实的引擎程序集**编译 `AVCABridge.cs`。
本机实测：**编译通过，输出 19.5 KB**。
（环境没有 Unity 时那条用例会 skip 并说明，不把整仓测试搞红；
路径可用 `AVCA_UNITY_ROOT` 覆盖。）

这一层能抓住最致命的失败：**编译不过** —— 那种情况下用户装完桥接，
Unity Console 直接报错、桥接完全不工作。

> 写这个检查时踩的坑：第一版引用了 `UnityEngine.dll` / `UnityEditor.dll`
> 这两个**门面**程序集，结果编译器报
> `CS0433: 类型 InitializeOnLoadAttribute 同时存在于 UnityEditor.CoreModule 和 UnityEditor`。
> 门面只是转发到 `*.CoreModule.dll`，**只引模块程序集才对**。

**它验不到的**（必须真 Unity）：

- `[InitializeOnLoad]` 静态构造真的被调用、`[AVCA] 桥接已就绪` 真的打出来
- `EditorApplication.update` 驱动的 Tick 与 2 秒心跳真的在跳
- `AssetDatabase.ImportPackage` 的三个回调真的按序触发、`createdGuids` 差集算对
- Play 模式下真的写回 `busy`、退出 Play 后真的自动执行
- `FileUtil.CopyFileOrDirectory` + `Refresh()` 真的让 Unity 生成 `.meta`

### 8.8 需要 Unity 前台配合、尚未验证的验收项

规格 §8 的 15 条验收里，以下几条**必须在装了桥接的真 Unity 工程里操作**，
截至本文写作时**未验证**（标记会随真实结果更新）：

- §8-1 桥接装进 `shinano-Main2` 后 `bridge.json` 每 2 秒刷新
- §8-2 关 Unity → 10 秒内标记退出；重开 → 自动重连
- §8-3 双击散装 `.unitypackage` → Unity 中出现资源
- §8-4 多选 5 个 → 串行导入、进度可见、全部成功（**M5-B ⑥ 已实现链路，仍未在真 Unity 里点过**）
- §8-5 Play 模式下点导入 → 排队 → 退出 Play 后自动执行
- §8-6 GUID 冲突预扫描能列出将覆盖的文件路径
- §8-7 撤销导入 → 新建文件被清除、被覆盖文件从备份还原
- **M5-B 新增**：从真 zip / 真 rar 抽出的成员 `ImportPackage` 真落地；整批退回真删

**离线能验的都已验**：见 §9 的测试表 + `node tools/check-bridge-compile.cjs`
+ `node tools/verify-red-m5b.cjs`（回退验证：把每处修复撤掉，确认用例**真的会红**）。
**渲染层那部分没验到**：本仓库渲染层零 DOM 测试，成员选择面板的点击路径靠沙盒活体
（见 §11 与 `docs/screenshots/`），不算"已验证"。

---

## 9. 测试覆盖（不需要 Unity 的部分）

| 文件 | 项数 | 覆盖 |
|---|---|---|
| `tests/bridge/mailbox.spec.ts` | 26 | 原子写 / `.tmp` 跳过 / 心跳新鲜度（含 mtime 判据与时钟偏差）/ 协议版本 / 命令重投复用 id / 终态删除权 |
| `tests/bridge/lockfile.spec.ts` | 14 | 独占试开（含**跨进程用 .NET `FileShare.None` 模拟真 Unity 持锁**）/ 残留锁文件 / WMI 命令行解析 |
| `tests/bridge/manager.spec.ts` | 21 | busy 退避完整时序 / 串行闸门 / 多实例隔离 / 结果消费 / dispose |
| `tests/bridge/installer.spec.ts` | 17 | 装到 `Packages/` 不进 `Assets/` / 卸载走回收站 / 模板自检 / 从所有工程卸载 |
| `tests/bridge/real-template.spec.ts` | 5 | **用仓库里的真模板**跑安装/卸载 + C# 静态禁令检查 |
| `tests/bridge/ipc.spec.ts` | 35 | **IPC 边界到文件信箱的整条链**：接真 `BridgeManager` + `FakeUnity`，跑预扫描 → 导入 → 撤销；含"撤销只删白名单"的实参断言；**M5-B：列成员 → 抽 → 汇总 → 导入 → 记账三列 → 副本清零 → 取消 → 整批退回** |
| `tests/bridge/compile-check.spec.ts` | 2 | **用 Unity 自带的 Roslyn 真编译桥接 C#**（环境没有 Unity 时 skip） |
| `tests/import/coordinator.spec.ts` | 26 | 冲突扫描 / 备份与还原 / 白名单参数 / 只有 ok 能撤销 / 保留 20 次 / **packagesOfAsset 判别联合** |
| `tests/import/extract-root.spec.ts` | 21 | 抽取根三道闸门（含 `\\?\C:\` 写法）/ seq 目录隔离 / `releaseMemberDir` 只删根内 / prune 跳过在途批次 |
| `tests/import/container-packages.spec.ts` | 12 | 只列不抽 / 两个上限记账 / 名字叫 .zip 的目录 / 一层封顶 / 垃圾条目 |
| `tests/unpack/members.spec.ts` | 17 | 定点抽取（嵌套成员 localPath / 整段匹配 / 空 wanted 抛 / 后端过旧不谎报） |
| `tests/import/member-import.spec.ts` | 28 | **M5-B 主链路**：闸门在落盘前 / 失败停下不自动回滚 / 一包一条 + batch_id / 倒序撤销 / 库里原件不动 |
| `tests/shared/member-pick.spec.ts` | 28 | 预勾只按名字匹配（词段不子串）/ 命中太宽就不勾 / 分批上限 / 撞线文案 |
| `tests/db/migration-v5.spec.ts` | 5 | V4→V5 迁移、幂等、部分索引、`patchImportLog` 不覆盖三列 |

跑法：

```bash
npm test -- tests/bridge tests/import tests/shared tests/unpack
node tools/check-bridge-compile.cjs    # 单独跑 C# 编译检查（会打印编译器原始输出）
node tools/verify-red-m5b.cjs          # 回退验证：撤掉每处修复，确认用例真的会红（45 条）
node tools/selfcheck-m5b.cjs           # M5-B 交付项与证据一览（只读）
```

---

## 10. 数据落在哪

| 数据 | 位置 | 生命周期 |
|---|---|---|
| 心跳 / 命令 / 结果 | `<工程>/Temp/AVCABridge/` | Unity 关闭时被清理 |
| 导入记录 | 库的 `import_log` 表 | 永久，`status` 走 `queued→running→ok/failed/cancelled/rolledback` |
| 容器成员来源（V5 三列） | `import_log.container_asset_id / member_rel_path / origin_archive` | 永久。**散装直导留 NULL**，不猜 |
| 被覆盖文件的备份 | `%APPDATA%/A/backups/rollback/<importId>/` | 保留最近 **20** 次（`IMPORT_BACKUP_KEEP`），超出**走回收站** |
| 撤销 / 安装的记账 | 库的 `journal` 表 | 永久，`op` 为 `import` / `import_rollback` / `bridge_install` / `bridge_uninstall` |
| 抽出来的临时副本 | `<库根同盘>\A__extract\<assetId>\<seq>\`（设置项 `extractRoot` 可改） | **导入到终态即删**，见 §11 |

⚠ **`user_version` 一旦升到 5，旧版程序就只读别再写**：V5 是纯加列，
旧代码读不炸，但它写 `import_log` 时不会填那三列 —— 于是"这张卡在哪些工程装过"的反查
会缺一块，而且缺得很安静（有记录、没来源）。

⚠ **备份清理绝不 `rm -rf`**：那个目录里是**用户工程里被覆盖的原文件**，
直接删掉等于把唯一的退路销毁了。清理走 `shell.trashItem`，与 00§五-5
「删除一律走回收站」一致。

---

## 11. 压缩包成员是从哪儿来的（M5-B）

**协议本身没改**：C# 侧收到的还是 `import_unitypackage { path }`，它不知道也不需要知道
那个文件是散装还是刚从 rar 里抽出来的。改的是**A 这一侧怎么把 `path` 变出来**，
所以这一节要写清楚 —— 临时文件的归属和生命周期一旦说不清，就会出现
"我只是想导个包，盘上多了一地别人看得见的副本"。

### 11.1 一条成员导入的完整路径

```
容器卡（压缩包 or 目录）
  └ unity:packages-of-asset   → 只**列**成员，不抽（listContainerMembers：stat 优先、两个上限、只钻一层）
  └ unity:import-plan         → 闸门 + 抽取 + 逐包预扫描，返回 batchId（**只读，不动工程**）
        ├ assertExtractRootUsable  不在库根内 / 不在 C 盘 / 剩余 ≥ max(2×体积, 2GB)
        ├ allocMemberDir           <extractRoot>\<assetId>\<seq>\    ← 每个成员一格，同名不互盖
        └ extractMembers           只抽点名的那一个成员，永不整包解压
  └ unity:import-commit       → **重新预扫描**后串行导入，一包一条 import_log（同一 batch_id）
                                每条到终态就 releaseMemberDir
```

### 11.2 谁负责删、什么时候删

| 层 | 谁 | 什么时候 | 删不掉怎么办 |
|---|---|---|---|
| 1 | `commitMemberImport` 的每条循环 | 拿到该包**终态**之后立即删 `<seq>` 目录 | 记 `cleanupFailed`，**不许**把成功的导入报成失败 |
| 2 | 启动时 `pruneExtractAtStartup()` | 清整个抽取根 | 留着下次 |
| 3 | 设置 → 维护 `unity:extract-clean` | 手动，跳过还在等确认的批次 | 留着下次 |

顺序不能反：**先拿结果再删文件**。反过来会把"结果未知"的命令变成"文件已消失"，再也对不上账。
撤销**不依赖**这些副本 —— 撤销只看 `import_log.created_guids_json`（白名单）与 `backup_dir`。

### 11.3 三条不许商量的位置规矩

1. **不许落在库根之内**。往 `E:\vrc\A` 里塞临时副本，游离扫描会把它报成"没登记的素材"，
   用户点一次「重新登记」就灌进库 —— 这是会真造成损失的那种事故。
2. **不许落在 C 盘**（本机 C 盘实测剩 12.0 GB，而单个内层包就有 653 MB）。
   `\\?\C:\...` 这种 Windows 命名空间写法也**一样拒**：那个写法**真的能写**，
   不剥前缀等于给这条红线留后门（实测见 `tools/probe-drive-forms.cjs`）。
3. **`releaseMemberDir(dir, mustBeUnder)` 只删抽取根之内**。它的调用点旁边就是
   用户素材的真实路径（目录型容器的成员不复制、直接指向库里原件），
   传混一次的症状是"导入报成功、素材卡还在、文件没了"。

### 11.4 Ctrl+Z 与"撤销导入"是两条链

`import` **不在** `lastRevertible` 的 op 白名单里：Ctrl+Z 撤的是文件操作，
Unity 里的导入走 `unity:rollback-import`（单条）/ `unity:rollback-batch`（整批倒序），
两边都需要 Unity 在线。而且 `import` / `import_rollback` 的 journal payload **不带 `assetIds`** ——
`undoLast` 会把同批每行的 `assetIds` 攒起来整批删资产行，一次 Ctrl+Z 绝不该把用户点的那张卡删掉。

## 12. 沙盒活体（2026-10-06，M5-B ⑦）

渲染层零 DOM 测试，所以"面板画没画对"只能靠真程序点一遍。这一轮**全程在沙盒**：

| 位置 | 沙盒路径 | 对应红线 |
| --- | --- | --- |
| 库根 | `D:\avca-m5b-live\library` | 不碰 `E:\vrc\A` |
| 运行时目录（含 library.db / staging / 备份 / 日志） | `D:\avca-m5b-live\AppData\Roaming\A` | **不碰 `%APPDATA%\A\library.db`（真库）** |
| 导入目标工程 | `D:\avca-m5b-live\projects\Shinano-LiveTest` | 不碰 `E:\ALCOMprojects` |
| 抽取根 | `D:\avca-m5b-live\_extracted` | 不在库内、不在 C 盘 |

造沙盒：`node tools/make-m5b-live-tree.cjs`（3 个真形状 .unitypackage 装进一个 zip + 一个假工程 + 预置一份同 GUID 的资源用来撞冲突）。
对端：`node tools/fake-unity-live.cjs <工程>` —— **假 Unity，不是真 Unity**：它照 §2.5 的契约
收发文件信箱、从 `.meta` 读 GUID 回答 `resolve_guids`、把包里的 `pathname` 铺进 `Assets/`。
所以这一轮证明的是 **A 这一侧的整条链 + 界面画法**，真 Unity 的导入结果仍算未验证。

### 12.1 看到的东西（截图在 `docs/screenshots/`）

| 截图 | 验到的事 |
| --- | --- |
| `m5b-picker-pick.png` | 三步面板第一步：3 个成员、逐个体积（zip 中央目录的 stat，不是解出来的）、`在压缩包里` 徽章、预勾两行各写「因为工程里有「shinano」」、第三行**没被替他勾** |
| `m5b-picker-plan.png` | 第二步汇总卡：`这批 2 个包：新文件 2 个；1 个包有冲突，共 1 个文件会被覆盖`；点开冲突行看到 `Assets/… ← Assets/…` 具体路径；三选按钮 + 「这一次决定覆盖上面这批全部 2 个包」 |
| `m5b-picker-result.png` | 第三步结果卡：`成功 2 个、失败 0 个、没执行 0 个` + 逐条 `ok` + 「整批退回」 |
| `m5b-gate-cdrive.png` | 把抽取根改成 C 盘 → **一条都没抽**，红字写明是哪个目录、让他去 设置 → 库 改 |

盘上/库上取证（`node tools/probe-m5b-live-state.cjs`）：
`import_log` 两行同一个 `batch_id`、V5 三列全有值（容器 id / 成员相对路径 / 容器绝对路径）；
`created_guids` 与 `overwritten` 分得开（撞车那个 GUID 进 overwritten）；
被覆盖的原件先落到 `backups/rollback/<importId>/` 并带 manifest；
`_extracted` 里只剩 `<assetId>` 空壳（`0/`、`1/` 都收掉了）；
假 Unity 侧命令顺序 = `resolve_guids → import_unitypackage → resolve_guids → import_unitypackage`（**串行、不连发**）；
「整批退回」发出的是 `delete_guids(Face) → delete_guids(Hair) → refresh` —— **倒序**，
且删除清单只含本次新建的 GUID，`Ponytail.prefab` 没被删、而是从备份还原回 22 字节的原内容。
「取消」那一步同样实测：面板退回勾选步，抽取根里没有残留副本。

### 12.2 这一轮抓到的两个真 bug（单测全绿时都在）

1. **闸门文案的占位符写成单花括号**：`err.extract*` 四条 × 三语 = 12 处 `{extractRoot}`，
   i18next 只认 `{{name}}`，于是界面上原样显示大括号 —— 而主进程参数**是发到了的**
   （CDP 直接调 `unity:importPlan` 能看到 `reasonParams`，store 里也存着）。
   最需要让用户看懂"改哪里"的那几句恰好是这几条。已修 + 加了扫描用例
   （`tests/renderer/i18n.spec.ts` 的「插值占位符写法」）和 `tools/probe-i18n-braces.cjs`。
2. **汇总那句混了单位**：`这批 2 个包：全新 2 个；1 个有冲突` —— `fresh` 数的是**文件**，
   前半句数的是**包**，两个 2 撞在一起就成了"2 个包全新"和"1 个包有冲突"自相矛盾。
   三语都改成写明「新文件 N 个 / N 个包有冲突」。

### 12.3 活体之前必须先设 `AVCA_APP_HOME`（这条别忘）

`app.getPath('appData')` 在 Windows 上取系统 known folder，**改 `%APPDATA%` 环境变量没用**。
本轮第一次起 dev 就是按老办法改 `APPDATA`，结果主日志照样写「数据库就绪 C:\Users\…\A\library.db」，
于是 **V5 迁移动到了用户的真库**（只加了三列 + 一个索引，`asset` 372 行 / `import_log` 1 行 /
journal 最后一条仍是 05:50 的记录，行数据一行没动）。正确做法：

```
AVCA_APP_HOME=D:\avca-m5b-live\AppData\Roaming\A   npm run dev:debug
```

判据收在 `resolveAppHome()`（纯函数、有 6 条用例），路径里没有 `avca` / `sandbox` 字样就**拒绝启动** ——
手滑把真库位置当沙盒，比没有这个变量更糟。


## 13. M6：桥接在"读工程指纹"这件事上的用法与降级

自动切集合要知道一个工程里有什么（目录名 / `Assets` 顶层 / 装了哪些包 / 有哪些
AvatarDescriptor）。前两项读盘就够，后两项只有桥接能答 —— 但**不能假设他机器上每个工程
都装了新版桥接**（Q5 的裁定），所以这一路是"能读多少算多少 + 把没读到的说出来"。

| 事实来源 | 什么时候用 | 拿不到时 |
| --- | --- | --- |
| 工程目录名 | 永远有（首帧就靠它） | — |
| `Assets/` 浅一层目录名 | 读盘，上限 200 个 | 撞线记 `topFoldersCapped` |
| `Packages/manifest.json` 的 `dependencies` 键名 | 读盘 | 没有该文件 = 空数组 |
| 桥接 `list_project_assets` | **心跳新鲜 + 桥接装了 + `bridgeVersion ≥ 1.1.0`** | 记 `bridgeSkipped` / `bridgeThrew` / `bridgeFailed` / `bridgeTooOld` |

三条口径值得单独记：

1. **降级看版本号，不看"字段有没有回来"**。只认字段的话，旧版桥接哪天回一个同名字段但语义不同，
   就会被当成新版用 —— 那比拿不到更糟。所以判据是心跳里的 `bridgeVersion`（`BRIDGE_WITH_ASSET_LIST = '1.1.0'`）。
2. **"没回"和"没有"是两件事**：桥接回了空清单时**不覆盖**磁盘那份；`avatarDescriptors` 真的缺才记 `noAvatarDescriptors`。
3. **问桥接之前先看心跳**（`bridgeWorthAsking`）：心跳停了还去问 = 每 3 秒白等 5 秒，工程页会整体卡住。

### 13.1 沙盒活体（2026-10-06，M6 ⑦）

沿用 §12 那套沙盒（`AVCA_APP_HOME=D:\avca-m5b-live\AppData\Roaming\A`、假工程
`D:\avca-m5b-live\projects\Shinano-LiveTest`、`tools/fake-unity-live.cjs` 写心跳），
这一轮把 ④→⑥ 整条链走通：侧栏补建入口 → 预览 → 确认建集合 → 假 Unity 起来 →
边沿触发 → 指纹采集 → 匹配 → 切视图 + 横幅。

| 截图 | 验到的事 |
| --- | --- |
| `m6-backfill-preview.png` | 补建预览：`将建 2 个集合，覆盖 4 条素材`、逐行 `Shinano 3 条素材 / 2 个关键词`、`跳过了 1 个通用值（如 UNIVERSAL / 共通）—— 它们不是模型名，建成集合会咬住所有工程`、`建这 2 个 / 全选 / 清空`、`不满意可以按 Ctrl+Z 整批退回来`；侧栏这时还是**主 CTA + 一句为什么**（还没有集合，打开 Unity 时 A 没地方可切） |
| `m6-collections-made.png` | 确认之后集合真的建出来（`is_auto` + `rule_json.keywords`），侧栏出现两行、补建入口降成小字 |
| `m6-banner-switch.png` | 唯一命中的横幅：`已识别为「Shinano-LiveTest」项目 · 自动打开 Shinano 集合` + 「仍在搜索「liltoon」」+ 四个按钮；**搜索框一个字没被清** |
| `m6-banner-cooldown.png` | 5 分钟内第二次打开同一个工程：页面上**没有横幅**（防打扰），侧栏「当前工程」照常更新 |
| `m6-banner-ambiguous.png` | 两个集合同关键词：`「Shinano-LiveTest」同时命中 2 个集合（…、Shinano），没有自动切换` —— Q1 要的留痕，候选名单写在文案里 |

主进程日志（`<沙盒>/AppData/Roaming/A/logs/main.log`）里的对应三行：

```
[auto-switch] Shinano-LiveTest → 切到「Shinano」（关键词 Shinano，命中 1 项）
[auto-switch] Shinano-LiveTest 未自动切换 —— cooldown（5 分钟内已切过一次）
[auto-switch] Shinano-LiveTest 未自动切换 —— ambiguous：同时命中 M6-live-平手用例（临时）、Shinano
```

顺带把**隐患 B** 也在真程序上钉了一次：18:11 那行 `未自动切换 —— none`（当时是通用词判据写反，
见 §13.2）之后，18:19 同一个工程的真实命中**照样切了** —— skip 没把冷却写脏。

复现命令（`--case=switch|cooldown|ambiguous`，平手那条会临时插一行集合、截完删掉）：

```
node tools/live-m6-banner-shot.cjs D:\avca-m5b-live\m6.png --case=ambiguous
```

⚠ 两个坑：横幅 10 秒就淡，而一次 CDP 往返 1–2 秒，**人肉"触发→截图"每次都踩在窗口外面**
（实测连错两次，一度误判成横幅没画）—— 所以脚本是"轮询 DOM 直到文字出现才拍"。
另外 `cdp-eval/cdp-shot` 默认端口 9222，沙盒起在 9224，忘了带 `AVCA_CDP_PORT` 会拿 40 秒去撞 `fetch failed`。

### 13.2 这一轮抓到的两个真 bug（单测全绿时都在）

1. **通用词判据写反了**：第一版是"关键词命中 ≥3 个已知工程就判通用词"。他机器上 9 个工程
   有 7 个名字带 `shinano`，于是 `Shinano` 集合的关键词被自己的闸门废掉 ——
   规格 §8-9 那条验收（打开 `shinano-Main2` 自动切到 Shinano 集合）**结构上不可能通过**。
   多个工程指向同一个分区本来就是自动切换的目的，不是它的反例。
   现在的判据：**命中全部**已知工程（且工程数 ≥3）才叫"什么都没说"。
2. **侧栏「补建」塞在标题行里被挤成断字**：224px 放不下三个中文按钮。
   改成空集合时是一条主 CTA，有集合之后降成下面单独一行。

### 13.3 仍未验证 → （2026-10-08 更新：下面四条里只有第一条还挂着）

- **真 Unity 的"新版桥接"那一支现在根本走不到**：Q5 明说这一轮**不改 C#**，而仓库里
  `AVCABridge.cs` 的 `ListProjectAssets()` 只回 `installedPackages`（`topFolders` /
  `avatarDescriptors` 一个都没写），`BridgeVersion` 也还是 `1.0.0`。
  所以 `BRIDGE_WITH_ASSET_LIST = '1.1.0'` 是一道**将来才会被满足**的闸门 ——
  真机上所有工程都会记 `bridgeTooOld`，这不是 bug，是这一轮的裁定。
  哪天要让它生效，改的是 C# 那两处（`ListProjectAssets` 补两段 + `BridgeVersion` 升到 1.1.0），
  TS 这边一行都不用动。
- **托盘唤醒置顶 1.2 秒**（Q6 当时明说这条只算"写完了"）→ ✅ **第 5 轮（2026-10-08）过了，而且是先抓到一条真缺陷才过的**：
  `wakeForProject()` 把"窗口是不是藏着的"读在 `createMainWindow()` **之后**，而那个函数在窗口已存在时会顺手
  `show()+focus()`（那是"第二实例启动"要的语义），于是 `wasHidden` 恒为 false、
  `setAlwaysOnTop(true)` 与那句唤醒日志**一次都没执行过** —— 窗口能从托盘弹出来纯属那个副作用的巧合。
  改完在重出的打包版上逐 100ms 采 `WS_EX_TOPMOST`：127 个样本里连续 11 个为真 ≈ **1185ms**，最后一个样本已取消置顶；
  窗口本来就开着时 82 个样本 **0 次**为真（不骚扰）。判据顺序由 `tests/project/wake-order.spec.ts` + 回退验证器 **L1** 钉住。
  细节与"置顶成功但焦点没跟过来（0/127）"那条口径，见 `docs/VERIFY-UNVERIFIED.md` §11。
- **「以后都这样」写进规则之后** → ✅ **第 5 轮过了**：单测原本就覆盖 `rule_json.projectPaths` 的写入与去重；
  活体这次是第一次答 always（设置落 `"always"` + 真复制 3 个文件进 `Packages/`），
  **然后把 A 的整个进程关掉再起来**（新主进程、新库连接），重启后仍是同一行设置（按路径命中而不是每次发新 id）→
  心跳重新出现 → `[bridge-ask] … 开始运行 → auto` → 「已安装到 …（3 个文件）」→ **没有再弹窗**。
- **§8-11（无关工程只更新顶栏、不切集合）** → ✅ **第 5 轮过了**（8/8）：先种一枚 `Shinano` 集合
  （**不然"谁都匹配不上"只是集合表空的退化 none**），再开一个与集合无关的工程：顶栏跟着走、
  `collection_id` 一次没变、横幅 0 次、`last_auto_switch_at` 空。见 `docs/VERIFY-UNVERIFIED.md` §11。
  （这一支最早在 18:11 的日志里出现过，但那次是通用词判据写反（§13.2）导致的**假 none**。）

### 13.4 一次预期外的真实工程接触（记下来，别学）

19:06 起沙盒实例（`AVCA_APP_HOME` 指到 `D:\avca-m5b-live`，库/日志/备份都在沙盒）准备补测 §8-11，
但沙盒实例**照样会发现真工程** —— 真工程清单来自 VCC manifest 与 `projectRoots`，那是只读探测。
他当时开着 `E:\ALCOMprojects\shinano-Main2`（Unity 2022.3.22f1，桥接 1.0.0 活着），于是：

```
工程运行状态变化：shinano-Main2 → 已打开（依据：bridge+lockfile）
[fingerprint] shinano-Main2：取自 name/topFolders:disk/packages:disk/packages:bridge · bridgeTooOld
[auto-switch] shinano-Main2 → 切到「Shinano」（关键词 Shinano，命中 1 项）
```

**实际影响**：往 `shinano-Main2\Temp\AVCABridge\inbox` 写了一条 `list_project_assets` 请求，
真桥接消费并回在 outbox，A 读走终态后删除 —— 事后检查 `inbox/`、`outbox/` **都是空的，零残留**；
`Assets/`、`Packages/`、库文件、`Temp/AVCABridge/bridge.json`（那是 Unity 自己每 2 秒写的心跳）
一个字节都没动；切换只写进**沙盒那份库**，真库 `%APPDATA%\A\library.db` 没被碰。
顺带这也算一次真桥接的降级实证：`packages:bridge` 拿到了、`topFolders` / `avatarDescriptors` 被闸门挡下。

**下次别再这样**：跑沙盒活体之前先确认他的 Unity 没开着（或者临时把沙盒 `settings.json` 的
`projectRoots` 之外的事先想清楚）。A 对"运行中的工程"发只读命令是设计行为，
但**在活体测试里让它碰到真工程**，就越过了"沙盒"这个词给人的预期。


---

## 14. R4 ⑦：第一次发现工程时弹那个三按钮窗（2026-10-07）

规格 R-10 要的是三按钮 `[安装] [以后都自动安装] [暂不]`。M5-A 到 M6 期间它只存在一半：
Project 页有个手动「立即安装」按钮，而"发现新工程"这条链上没人问，
`bridgeAutoInstall` 这条设置**从 M1 起全仓无一处读取**（第二个死设置，第一个是 `autoSwitchBehavior`）。

### 14.1 判据与两个边沿

判据抽成纯函数 `src/shared/bridgeAsk.ts`（六个输入 → `ask | auto | quiet`），
组件只做薄壳映射 —— 本仓库渲染层零 DOM 测试，判据写在组件里就等于没测。

边沿有**两个**，都在 `src/main/project/api.ts` 的 `maybeAskAboutBridge()`：

| 时机 | 从哪来 | 允许出声的方式 |
|---|---|---|
| 第一次发现这个工程 | `register()` 里 `!existing`（这一轮真的插了一条新 `project` 行） | 问（三按钮）或直接装 |
| 发现它开始运行 | `runDetection()` 的 `changed` 里 `running === true` | **只直接装，不问** |

第二个时机不是锦上添花。真实顺序是：工程多半从 ALCOM 清单或盘扫被发现，那一刻 Unity 常常还没开；
用户答了「以后都自动安装」之后这个工程的行已经在库里，"第一次发现"这个边沿再也亮不起来 ——
**只挂第一个时机的话，那个答案永远不会被执行**。反过来，"开始运行"绝不能弹窗：
三路探测每 3 秒一轮，那样等于他每开一次 Unity 就被打断一次。

### 14.2 为什么必须有主进程队列（这一节是本轮最值钱的一条）

`registrar.broadcast` 是**发后即忘**的（`src/main/ipc/util.ts`：只对当时的
`BrowserWindow.getAllWindows()` 调 `webContents.send`，没有窗口就没有接收方）。
而工程发现这条链在主进程注册模块时就跑起来了（`project/api.ts` 末尾那个 `void refresh()`），
里面 `register(manifest.projects, 'vcc')` 是**同步**的读清单 + 落库 + 判定。

沙盒活体的日志把这条时序钉死了（`D:\avca-ask-live`，全新空库）：

```
16:06:08.278  [bridge-ask] 第一次发现「R4-AskA」（来源 vcc） → ask
16:06:08.285  [bridge-ask] 第一次发现「R4-AskB」（来源 vcc） → ask
16:06:09.090  [renderer] [vite] connecting...
16:06:10.588  ready-to-show 触发
```

**边沿亮了 0.8 秒之后渲染层才开始连 Vite。** 没有队列的话 ⑦ 恰恰在它唯一存在的场景
（第一次装 A、一批新工程被发现）下不生效 —— 而单测、typecheck、`npm test` 全绿，什么都不会报。

所以有了 `src/main/bridge/askQueue.ts`：主进程把结论攒下来，界面 `boot()` 里
`unity:bridge-ask-pending` 取回，同时照常广播（界面早就开着的人不必等下次启动）。

队列的语义是**"还没有着落的问题"，取看不清空**。第一版写成 drain，活体里就着改一句
i18n 文案 → Vite 整页刷新 → **第二个工程的弹窗直接没了**，而边沿早消耗完 = 永远不再问。
现在只有两个出队时机：用户**答了**（`unity:answer-bridge-ask` → `dropBridgeAsk`）、
或自动装**装成了**（`unity:bridge-ask-done`）。Esc / 点遮罩关掉弹窗**不算回答**，什么都不写。

### 14.3 存哪、怎么措辞

答案存 `setting` 表键 `bridgeAsk:<projectId>`（裁定 Q7：不为这一件事动 schema，和
`projectGuids:<id>` 一个路子）。读回来一律过 `parseBridgeAskAnswer`，脏值当"没答过"，不许抛。

措辞按 M6 Q3 那条教训写长了：`autoLaunch`（开机自启）、`minimizeToTray`（常驻托盘）、
`bridgeAutoInstall`（对所有新工程自动装）是三件事，混在一句话里会让人以为勾了就会开机启动。
所以中间那个按钮写着「以后都自动安装（只这个工程）」，正文下面补一句指出另外两个开关分别在哪。
**这句里的位置是核对过的**：开机自启在「设置 → 常规」，全工程自动装在「设置 → Unity」。

R-14 要求自动安装"在 UI 上明确提示装了什么、装到哪" —— 那句 toast 现在带落点：
`已自动为「R4-AskA」装好桥接：3 个文件 → D:\…\Packages\com.avca.bridge`。

### 14.4 沙盒活体（五步，`tools/live-r4-bridge-ask.cjs`）

```
node tools/live-r4-bridge-ask.cjs --prep
AVCA_APP_HOME=D:\avca-ask-live\AppData\Roaming\A LOCALAPPDATA=D:\avca-ask-live\AppData\Local \
  node tools/dev.cjs --remote-debugging-port=9226
node tools/live-r4-bridge-ask.cjs --stage=5   # 没答就整页刷新 → 还在问
node tools/live-r4-bridge-ask.cjs --stage=1   # 弹窗 → 点「以后都自动安装」
node tools/live-r4-bridge-ask.cjs --stage=2   # 第二条接着问 → 点「暂不」
node tools/live-r4-bridge-ask.cjs --stage=3   # 删桥接 + 假心跳 → 静默重装、无弹窗
node tools/live-r4-bridge-ask.cjs --stage=4   # 答过暂不的：开着也不装、也不再问
```

五步全绿的凭据：`Packages/com.avca.bridge/package.json` 真的出现（`Assets/` 保持空目录）、
`setting` 里 `bridgeAsk:<id>` 分别是 `always` / `never`、日志有
`[bridge-ask] 「R4-AskA」开始运行 → auto`、截图 `D:\avca-ask-live\ask-*.png`。

**`--prep` 同时重定向 `LOCALAPPDATA`**，这一条是本轮新加的护栏。
`vccSettingsPath()` 优先读 `LOCALAPPDATA`，以前几轮活体只重定向 `AVCA_APP_HOME`，
于是沙盒实例顺手把他 8 个真工程也登记进了沙盒库（§13.4 那次越界就是这条链）。
这一轮日志是干净的「工程发现：登记 2 个」。

### 14.5 这一节仍未证明的事

- **真 Unity 开着工程时的自动装没验过**：stage 3/4 用的是桥接心跳假象（`Temp/AVCABridge/bridge.json`
  写一个新戳），走的是同一条判定链，但真编辑器还会持锁、会消费 inbox —— 少一路证据不等于等价。
- 弹窗与 toast 的**画法**零回归保护（渲染层没有 DOM 测试环境），改样式只能靠下次活体。
- 全新安装一次发现一批工程时"答完一条接着问下一条"的顺序，只在 2 个工程上验过；
  他真机第一轮是 8 个，队列会连问 8 次 —— 这是设计意图，但没人这么点过。


---

## 15. 第 4 轮：真 Unity 底下把 §8-5 与成员导入跑穿（2026-10-07 深夜）

工具 `tools/live-r4-members.cjs`（五个 stage）、沙盒 `D:\avca-m5b-live`
（`make-m5b-live-tree.cjs` 三个开关：`AVCA_M5B_MEMBERS=10` / `AVCA_M5B_TEXT_ENTRIES=1` / `AVCA_M5B_PLAY_TRIGGER=1`）。
对端两副：**假对端**（`fake-unity-live.cjs`）证 A 侧，**真编辑器 2022.3.22f1** 证契约另一侧。逐条结果在
`docs/VERIFY-UNVERIFIED.md` §10，这一节只写桥接侧要记住的三件事。

### 15.1 `IsBusy()` 是真的会翻，而且 A 收到的是 busy 不是 error

真编辑器进 Play 之后：心跳 `isPlaying:true / isPlayingOrWillChangePlaymode:true /
busyReason:"Unity 正在运行 Play 模式" / bridgeVersion:1.0.0`，A 那边界面出
「已排队（Unity 正在运行 Play 模式）· 第 1 次重试 · 1 秒后再试」，
**排队期间库里 0 新增**，退出 Play 后**不用用户再点一次**自己跑完（3 个成员 → 成功 3）。
命令是 `resolve_guids`（预扫描那一步）在排队 —— 也就是说 Play 挡住的是**整条链的最前面**，
不是只有 `ImportPackage`。这条以前只有离线单测。

怎么把 Play 变成可自动化的：沙盒工程里 `Assets/Editor/AvcaSandboxPlayTrigger.cs`，
`Temp/AVCABridge/play.txt` 存在就 `EditorApplication.isPlaying = true`、删掉就退。
**它只进沙盒工程，不属于桥接包**，也不许出现在任何真工程里（跑完随沙盒删）。

### 15.2 那套退避序列在实现里走的是第二步开头（已修）

`BUSY_BACKOFF_MS = [1000,2000,5000,10000,30000,30000]`，§2.5 写的是"1s→2s→5s→10s→30s，固定不可改"，
而实现是 `BUSY_BACKOFF_MS[Math.min(retries, …)]` —— `retries` 在取下标**之前**就自增了，
它是"第几次重试"（从 1 起）。结果第一次等 2000ms、**1000 那一档永远取不到**。
第 4 轮是在界面上看见「第 1 次重试 · 2 秒后再试」才发现的。修在 `manager.ts`（`retries - 1`）。

为什么 1279 条用例全绿还留着它：`tests/bridge/manager.spec.ts` 那条只写
`nextDelayMs > 0`，另一条注释写着"退避 1s + 2s"、断言却是 `elapsed >= 1000+2000-150`，
7 秒照样过。**注释写着它以为的行为，比没注释更坏。**
现在逐字对上 `BUSY_BACKOFF_MS[0]/[1]` + 总时长加上界，并进了 `tools/verify-red-r4.cjs` 的 K1
（把下标改回去 → 红 2 条）。活体 `--stage=play-real` 也直接打"本次退避序列"对表 ——
按**每行时间戳**筛本次的日志，别按行号切（第一版按行号切，捞到上一轮那三行，
把已经修好的这一步又判成失败）。

### 15.3 合成包在真 Unity 底下的两条硬要求（夹具的，不是产品的）

1. `asset.meta` **必须带 `guid:`**：只写 `fileFormatVersion: 2` 的话 Unity 报
   `does not have a valid GUID`、整条忽略 → `createdGuids` 空，看着像 A 记账坏了。
   假对端按 tar 的目录名取 GUID，所以 M5-B 那整套活体从来没暴露过这一点。
2. 条目内容要用 Unity 收得下的**文本型**（`.txt/.json/.csv`）：往 `.prefab/.anim/.fbx` 里塞
   随手写的 YAML，测出来的是 Unity 的导入器不是 A 的链路。本轮那 19 个条目全改成
   `Ponytail_prefab.json` 这种（名字带原扩展名，避免 `Pose01.anim` 与 `Pose01.controller` 撞名）。

真 Unity 下的正面凭据：19 个条目逐个核过 `.meta` 的 `guid:` 就是包里那条；
新建目录的 `.meta` 是 `folderAsset: yes` + GUID 不在包里 = **Unity 自己生成的**
（这正是"剪贴板式手写 .meta 绝对禁止"那条禁令的反证）；
冲突那枚先改掉内容再导、撤销后逐字节等于改过的那份。

### 15.4 桥接现在仍答不了的两件事

- **"这次导入建了哪些目录"**：撤销只删资源，空目录与它们的 `.meta` 留在工程里（第 4 轮实测）。
  `list_project_assets` 只回包名，答不了"哪些是这次新建的"。
- **`topFolders` / `avatarDescriptors`**：`BridgeVersion` 还是 `1.0.0`，A 侧 `≥1.1.0` 那道闸永远判旧
  （本轮 `[fingerprint] … bridgeTooOld` 又抓到一次）。

两条都指向同一处：改 C# 两处 + 重装桥接，TS 一行不用动。要不要在这一版做，等第 6 轮一起裁。
