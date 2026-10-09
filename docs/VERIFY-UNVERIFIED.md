# 把"未验证"清单过一遍（2026-10-07 起，按轮次追加到 10-09）

规矩没变：**没验证过的写"未验证"**，不许含糊成"应该可以"。这一份是那一轮点名重做的结果 ——
每一条都写清"结论 / 证据在哪 / 怎么自己复现"，红的一律标红。

跑法与红线：真 Unity 用的是 **2022.3.22f1 打开沙盒工程**
`D:\avca-r4-live\projects\Shinano-R4LiveTest`，A 一律 `AVCA_APP_HOME` 重定向到沙盒；
他的 8 个真工程与 `E:\vrc\A` 一个字节都没动（真库只读体检跑在 `%TEMP%` 的副本上，
跑完核对原库字节数没变）。

---

## 1. 结论一览

| # | 项 | 结论 | 证据 |
|---|---|---|---|
| §8-1 | 桥接装进工程后 `bridge.json` 每 2 秒刷新 | ✅ **过了**（真 Unity） | `tools/live-s8-real-unity.cjs --stage=1`，6 条断言全绿：`heartbeatUtc` 两次间隔 4369ms、文件 mtime 距今 <1.5s、`bridgeVersion:1.0.0`、`pid` 对得上 |
| §8-2 | 关 Unity → 10 秒内标退出；重开 → 自动重连 | ⚠ **半过，缺陷已修**（见 §2） | 新实例上进程真消失 → 12 秒内 `→ 已关闭（依据：三路都没命中）`；但另一种情况下 wmi 会**卡在一个已经不存在的 pid 上**，A 永远报"运行中" |
| §8-3 | 双击/点导入 → 资源真进工程 | ✅ **过了**（真 Unity） | `--stage=2`：`created_guids` 1 条 32 位十六进制、`Assets/` 真长出文件、**目录的 `.meta` 是 Unity 自己生成的**（172 字节，不是包里抄的）；协议原文抓在 `outbox-capture/`（`resolve→{guid:null}`、`import→createdGuids:[…]`） |
| §8-4 | 多选 5 个 → 串行导入、进度可见、全部成功 | ✅ **过了**（撤销的账见 §3，已修） | `--stage=5`：5 张卡选中 → 按钮写「导入 Unity（5）」→ 汇总卡 → 逐条「成功（新 2 · 覆盖 0）」→ 5 行同一个 `batch_id` |
| §8-5 | Play 模式下点导入 → 排队 → 退出后自动执行 | ✅ **第 4 轮过了**（真编辑器 + 假对端各一遍） | 沙盒 `D:\avca-m5b-live`：写 `play.txt` → `AvcaSandboxPlayTrigger.cs` 真把编辑器推进 Play → 心跳 `isPlaying:true / busyReason:"Unity 正在运行 Play 模式"`；A 收到的是 **busy 不是 error**，界面出「已排队（…）· 第 N 次重试」，期间库里 0 新增，删开关退 Play 后**不用用户再点**自己跑完。逐条见 §10 |
| M5-B | 真 zip 抽出来的成员导入 | ✅ **第 4 轮过了**（真 Unity） | 19 个条目逐条核过：文件在 `Assets/`、`.meta` 的 GUID 就是包里那条；新建目录的 `.meta` 是 `folderAsset: yes` + GUID 不在包里 = **Unity 自己生成的**。冲突那枚先改掉内容再导，撤销后逐字节等于**改过的那份**（见 §10） |
| M5-B | >8 成员多批流转 | ✅ **第 4 轮过了** | `IMPORT_BATCH_MAX=8`、10 个成员 → 抽取根一次只有 8 个 → 库里 10 行 / 2 个 `batch_id` / 形状 [8,2]；「就导到这儿」之后剩下 2 个既没抽也没导（见 §10） |
| §8-6 | 冲突预扫描列出将覆盖的文件 | ✅ **过了**（真 Unity） | `--stage=3`：对话框原文「这个包会覆盖工程里 2 个已有文件 / 包内共 2 项，其中 0 项是新建的」+ 两条 `Assets/...` 路径 + 「取消 / 继续（不备份）/ 继续并备份被覆盖文件」三个按钮；备份目录里 2 个文件 + `manifest.json` |
| §8-7 | 撤销：新建的清掉、被覆盖的还原 | ✅ **单包路径过了** / ❌ **批量路径没过** | 干净的一建一撤：`delete_guids` 回 `{deleted:["Assets/Liltoon/R4/lilToon.shader"],failed:[]}`、A 记「删除 1 个新建资源」、文件与 `.meta` 都没了。覆盖一撤：先改掉工程里那两份内容 → 再导入 → 撤销后**逐字节等于被改过的那份**（不是包里那份） |
| M6 | 桥接 ≥1.1.0 那一支（`topFolders`/`avatarDescriptors`） | ⛔ **仍未验证**（C# 侧没改） | 仓库 `AVCABridge.cs` 的 `BridgeVersion` 还是 `1.0.0`，真机人人记 `bridgeTooOld`（本轮 `[fingerprint] … bridgeTooOld` 又抓到一次） |
| M6 | 托盘唤醒置顶 1.2 秒 | ✅ **第 5 轮过了**（10/10），但**先修了一条真缺陷** | 打包版真跑：最小化到托盘 → 制造 Unity 边沿 → 逐 100ms 采 `WS_EX_TOPMOST`，**11 个样本为真、约 1185 ms**，之后自己取消；已可见那一次 82 个样本 0 次为真。缺陷：置顶那 1.2 秒**从来没执行过**（判据写在 `createMainWindow()` 之后，被副作用盖住），见 §11 |
| M6 | 「以后都这样」之后第二次打开同一工程按路径命中 | ✅ **第 5 轮过了**（8/8，含**重启进程之后**） | 答 always → 重启 A 的整个进程 → 再开同一工程：直接静默装好、`ask` 队列 0 条、日志有 `自动安装` 而无弹窗；同一沙盒里另一工程照旧问。逐条见 §11 |
| M6 | §8-11 真 none（无关工程只更新顶栏不切集合） | ✅ **第 5 轮过了**（8/8） | 集合非退化（先种一枚 `Shinano`）+ 打开一个与集合无关的工程：顶栏跟着显示这个工程，`collection_id` 一次没变、横幅 0 次、`last_auto_switch_at` 空。见 §11 |
| R4 ③ | 改分类搬文件在**真库**上 | ✅ **只读预览过了**、⛔ 真搬仍未做 | `AVCA_CHECK_REAL_DB=1 npx vitest run tests/real/realdb-r4-preview.spec.ts`：8 张归档卡全部给出成立预览（含 1.57 GB / 128 文件、1.45 GB / 204 文件两张），落点都在库根下、`fromDir ≠ toDir`、文件数与字节数 >0；整棵 `E:\vrc\A` 快照 + 真库文件字节数前后一致 |
| R4 ⑤ | 存量 5 张"单模型却没写出 avatar 变体" | ❌ **重新归并补不上** | 同一份脚本：`planRegroup → applyRegroup` 在副本上拆 0 组、动 0 行 → 那 5 张一行都没补上。它只重建**被拆开的那些组**，要补得另开一条"重建变体"的路 |
| R4 ⑦ | 第一次发现工程弹三按钮 / 答过之后自动装 / 没答就刷新还在问 | ✅ **过了**（沙盒，假心跳当对端） | `tools/live-r4-bridge-ask.cjs` 五步全绿，图 `D:\avca-ask-live\ask-*.png`；**真 Unity 开着工程时的那一次自动装仍未验**（见 §7） |
| R4 ④ | 用户加的口语**存在哪**（第 2 轮那条"升级即丢"的缺陷） | ✅ **第 3 轮修完并在打包版真跑过** | 内置表哈希 `18b6f7be47b6` 保存前后不变；增量在 `AVCA_APP_HOME\categories.user.json`（154 字节，不是整份 34.5 kB 拷贝）；把安装目录那份换成"v2"再重启 → 合并表 = 新内置 ∪ 用户加减（`categories:list` 直接读出来核对）；ASCII 词加完 1 张 / 删完 0 张。逐条见 §9 |
| — | 渲染层"画法" | ⛔ **结构性未验证** | 本仓库渲染层零 DOM 测试。本轮只能用 CDP 的 DOM 断言 + 截图逼近（`docs/screenshots/s8-*.png`），这不算 DOM 测试 |

---

## 2. §8-2：WMI 会卡在一个已经不存在的进程上（已修）

**先纠正一句**：这一节最早写的是"§8-2 判不通过"，那是在一个跑了五小时、中间被我换过两次
`.node` ABI 的老实例上测的，属于**没控制变量的观测**。重开一个干净实例复测，
进程真消失后 12 秒就打了 `工程运行状态变化：Shinano-R4LiveTest → 已关闭（依据：三路都没命中）`。
所以"关 → 标退出"这条路本身是通的。

但**另一种情况是真的**，而且抓到了完整证据链：

1. 编辑器（pid 31956，命令行带 `-projectPath`）被关掉，`Get-Process -Id 31956` 查不到这个进程了。
2. A 每 60 秒重复打：`[running] 只有 wmi 认「Shinano-R4LiveTest」还在运行（桥接心跳与锁文件都没命中）`
   —— 这条 warn 和 `[wmi] 这一轮认出 1 个带 -projectPath 的 Unity 进程：31956=…`
   都是这轮新加的观测（以前 wmi 命中了什么**没有任何地方看得见**，只能猜）。
   命中集合的指纹没变过 → 说明 A 每轮重查都还拿到那个**已经不存在的 pid**。
3. 同一条 PowerShell 脚本在外部复算：`进程行数=0`。

也就是说：三路取并集这件事本身没错，错在**间接证据（WMI）可以单独无限期撑着"在运行"**。
用户会撞上的是：顶栏说"运行中"→ 点导入往没人接电话的文件信箱发命令 → 等到超时才报错；
自动切换/横幅也按"工程开着"来判断。

**修法**：只剩 WMI 撑着时给 `WMI_ONLY_GRACE_MS`（15 秒，= 5 轮重查）的宽限期，
超了就不认并留 warn。不能一上来就不信它 —— Unity 刚打开、锁文件还没建、桥接还没装的那段窗口里
**只有 WMI 认得出这个工程**。回归用例：`tests/project/wmi-only-grace.spec.ts`（6 条，
含"更强证据回来过要把计时清零"，以及常量数字单独钉一条）；
把撤票那段改成 `if (false)` 后两条会红，验过。

---

## 3. §8-4/§8-7 的批量退回：撤销被发了两次（已修）

`--stage=5` 跑出来的事实（沙盒 + 真 Unity）：5 行 `import_log` 同一个 `batch_id`、
逐条结果卡片、串行、进度可见 —— 这些都对。**错的是撤销的账**：

- 抓到的桥接原始响应（`tools/live-s8-capture-outbox.cjs` 抄下来的）是两条 `delete_guids`：
  第一条 `{deleted:["Assets/Liltoon/R4/lilToon.shader"],failed:[]}`，
  半秒后第二条 `{deleted:[],failed:["Assets/Liltoon/R4/lilToon.shader"]}` —— **同一批资源被删了两遍**。
- 于是后跑的那次把那一行的 message 覆盖成「撤销：删除 0 个新建资源」。
  数字看着像"本来就没建东西"，用户以为撤销没生效。

**根因**：撤销一次导入要 `await` 桥接回话，而**从"读到 status='ok'"到"写回 rolledback"之间没有任何占位**。
两次撤销（连点两下、脚本双击、界面重进后再点）都会读到同一个 `ok`，于是都去做删除。
我这轮的活体脚本正是那个双击 —— 修好脚本之后阶段 5 全绿，但**产品侧的洞是真的**，
人手快双击一样会撞。

**修法**（三条，都有用例）：

1. **原子抢权**：`UPDATE import_log SET status='running' WHERE id=? AND status='ok'`，
   改不动就停手（"这条导入正在撤销，或者已经撤过了"）。撤销整个失败时把状态放回 `ok`，
   不许卡在 `running`（和 M5-B 记的"撤销失败不许写 undone=1"是同一条纪律）。
   用例：`tests/import/rollback-claim.spec.ts` —— 把第一次的删除卡在桥接里、在窗口期里发第二次，
   断言桥接**只被叫一次**、message 仍是「删除 2 个新建资源」。
2. **`failed` 不许丢**：桥接回 `failed:[路径…]` = "这个资源我没能删掉"，以前被直接扔掉。
   现在带在 `failedToDelete` 里，message 与 toast 都会说"有 N 个没能删掉，工程里可能还留着"。
3. **"已备份"要真存下了东西才说**：`ImportResult.backupSaved` 新增，
   横幅改走 `shared/importNotes.ts` 的判据（0 个 → "没东西可备份：冲突框说会盖掉的文件其实不在盘上"）。
   真机上那条连锁反应是：上一次撤销把文件删了但 Unity 还记着 GUID →
   下次导入判成"覆盖 2 个" → 备份实际存了 0 个 → 横幅照样写「被覆盖的文件已备份」。
   用例：`tests/shared/import-notes.spec.ts`（5 条，含三语 key 齐备与 `{{count}}` 双花括号）。

**假对端为什么永远测不出这两条**：它自己按包里的 `.meta` 铺文件、自己算 `deleted`，
既不经过 Unity 的资源库，也不会因为"文件已经没了"而回 `failed`。

---

## 4. 顺手挖出来的两条环境教训

1. **沙盒包里的 `.meta` 必须带 `guid:`。** 原来 `tools/make-r4-live-tree.cjs` 只写
   `fileFormatVersion: 2`，真 Unity 直接回
   `The .meta file … does not have a valid GUID and its corresponding Asset file will be ignored`
   —— 文件铺进去了、`createdGuids` 却是空的，看起来像 A 的记账坏了。假对端照抄 `.meta`，所以永远不报。
   现在生成器写 `fileFormatVersion: 2\nguid: <目录名>`，并且条目一律换成 Unity 收得下的
   文本型资源（`.txt/.json/.csv/.shader`）—— §8 要验的是 A 这条链，不是 Unity 的导入器。
2. **`--packages-only`**：默认那一支会 `rmMine(ROOT)` 把整个沙盒抹掉。已经跑过活体、
   库里有素材行的时候用它，等于把上一轮现场一起删了。

---

## 5. 复现命令

```bash
# 真 Unity（沙盒工程，先确认他的编辑器没开着）
"E:\unity\2022.3.22f1\Editor\Unity.exe" -projectPath "D:\avca-r4-live\projects\Shinano-R4LiveTest" -logFile "D:\avca-r4-live\unity-s8.log"
node tools/setup-native.cjs electron
AVCA_APP_HOME=<沙盒根>\AppData\Roaming\A  LOCALAPPDATA=<沙盒根>\AppData\Local  \
node tools/live-s8-capture-outbox.cjs          # 可选：抓桥接原始响应
node tools/live-s8-real-unity.cjs --stage=1    # §8-1
node tools/live-s8-real-unity.cjs --stage=2    # §8-3（AVCA_S8_CARD="卡名" 换卡）
node tools/live-s8-real-unity.cjs --stage=3    # §8-6
node tools/live-s8-real-unity.cjs --stage=4    # §8-7
node tools/live-s8-real-unity.cjs --stage=5    # §8-4
node tools/live-s8-real-unity.cjs --stage=7    # §8-2（关 → 重开）
node tools/live-s8-close-watch.cjs          # §8-2 受控版：同时记"进程还在不在"和"A 怎么说"
node tools/live-s8-double-rollback.cjs      # 连点两次「整批退回」：第二次必须被抢权挡住

# 真库只读体检（副本，Node ABI）
AVCA_CHECK_REAL_DB=1 npx vitest run tests/real/realdb-r4-preview.spec.ts
node tools/probe-avatar-variants.cjs           # ⑤ 存量口径，只 SELECT
```

重跑前清沙盒：`node tools/live-s8-reset.cjs`（清 5 张 `.unitypackage` 卡，`import_log` 留着）、
`node tools/live-r4-dims-reset.cjs`（清 Grimoir 那一对）。

---

## 6. 这一轮之后仍然挂着"未验证"的

§8-5 Play 模式排队、真 zip 成员导入、>8 成员多批流转、桥接 1.1.0 的 C# 侧、
托盘置顶 1.2 秒、「以后都这样」第二次命中、真 none 那一支、打包版真跑、
渲染层画法（零 DOM 测试，只能截图逼近）、③ 在真库上真搬一次（等你点头）。

> 更新（第 4 轮，2026-10-07 深夜）：上面前三条**已经清掉了** —— 逐条凭据在 §10。
> 桥接 1.1.0 / 托盘置顶 / 「以后都这样」第二次 / 真 none 仍在（分属第 5 轮与 M6 的 C# 侧）。

> 补一句（同一天下午，修完之后）：§8-2 与批量退回那两条**已经修了**（见 §2、§3 与
> `tests/project/wmi-only-grace.spec.ts`、`tests/import/rollback-claim.spec.ts`、
> `tests/shared/import-notes.spec.ts`，全量 1218 通过 / typecheck 干净）。
> 活体复测也跑了（真 Unity，沙盒）：
> - `--stage=5` 单点一次：那一行 message 是 **「撤销：删除 1 个新建资源、还原 0 个被覆盖文件」**
>   （修之前是"删除 0 个"）；
> - `live-s8-double-rollback.cjs` 连点两次：5 行**各自只被撤一次**、没有一行被改写成
>   "删除 0 个"，并且新口径那句真的出现在库里 ——
>   「另有 1 个被覆盖文件内容找不回来（当时没开备份或还原失败）」；
> - 干净实例上关掉编辑器 → 12 秒内 `→ 已关闭（依据：三路都没命中）`；
>   新加的 `[wmi]` / `[running]` 两条观测都真的在打（`[wmi] 这一轮认出 1 个带 -projectPath 的 Unity 进程：20136=…`）。
>
> 仍然没定位的是**为什么** A 进程内的 WMI 会持续返回一个已经不存在的 pid
> （外部复算同一条脚本返回 0 行）。现在它被宽限期兜住了，观测日志也留了，
> 下次再出现能直接看出是哪一轮、哪个 pid。
>
> 更新（第 5 轮，2026-10-08）：上面剩下的 M6 三条 —— **托盘置顶 1.2 秒 / 「以后都这样」
> 第二次命中 / 真 none** —— 全过了（凭据见 §11），而且置顶那条是**先抓到真缺陷再改过才过**的：
> 那 1.2 秒的置顶在改之前一次都没执行过。现在仍挂着的只有
> 桥接 `bridgeVersion ≥ 1.1.0`（要改 C#，第 6 轮裁定）、渲染层画法（零 DOM 测试）、
> ③ 在真库 `E:\vrc\A` 上真搬一次（等你点头）、Setup.exe 覆盖安装（第 8 轮）。


---

## 7. R4 ⑦ 那一轮新学到的两条时序（以及第 2 轮该跑什么）

⑦ 的活体把一件一直存在、但从没被看见的事抓了出来：**主进程的广播是发后即忘的，
而第一轮工程发现跑在窗口就绪之前**。日志与判据都写进 `docs/BRIDGE.md` §14.2 了，
这里只记结论：以后凡是"第一次 / 边沿"类的通知，都必须配一条**拉取式**的补送通道，
否则它恰恰在"程序第一次装好"那一次不生效 —— 而那通常正是它唯一存在的场景。

第二条：**待答队列不能"取走即清"**。第一版那么写，活体里改一句 i18n 文案触发整页刷新，
第二个工程的弹窗就永远没了（边沿早消耗完）。现在只有"用户答了"和"自动装成了"两个出队时机。

### 这一轮（第 1 轮 · R4 ⑧ 收尾）改了什么

- `tests/spec-coverage.spec.ts`：R-10 从"范围外"改成有实现有测试；范围外只剩 R-84 / R-85；
  新增 R4 三十四条逐条对账（七件 + 七条裁定 + 真机两条修复），未验证只有 2 条，都是画法。
- `tools/selfcheck-r4.cjs`：交付表 + 真机待验清单（只读，缺证据文件就报错）。
- `tools/verify-red-r4.cjs`：33 条变异，把 R4 每处修复临时改回旧写法，确认对应用例真的会红。
  **第一次跑抓到 10 条"撤掉修复也不红"**，分五类（细节写在工具头部注释里）：
  ① **变异打错调用点** —— `reindexAsset` 在 `assets.ts` 里有四处、我撤的不是用例扫的那处；
  fuzzy 那道闸真正生效的是 `fuzzyFor()` 而不是 MiniSearch 的 options 字面量；
  大小写去重有两处（入库 / 重建变体），必须各钉各的；
  ② **两道闸返回同一句文案** —— 二次撤销只撤一道会被另一道兜住，得两道一起撤才看得见事故形状；
  ③ **用例只查词典与源码、不查判据** —— 把反查的 `noteKeys` 清空全仓不红，
  等于"判据不再给口径、屏幕上什么都不说而测试全绿"（已补两条）；
  ④ **不变量根本没人查** —— "任何时刻最多一条 running"撤掉守卫一条都不红（已补一条）；
  ⑤ **那个变异根本不是回归** —— `parseBridgeAskAnswer` 故意容错大小写，大写化存进去照样读得回来，
  换成"不走 `JSON.stringify`、裸串进 `value_json`"才红。
  **还剩一个洞没补**：`rearchive` 里"附属在不在旧父目录里"那一支撤掉不红、用例查不到，
  位置记在 CASES 表里，补夹具属第 3 轮 —— **不许因为它不红就把它删掉**。（第 3 轮已补成 C3/C3b/C3c，见 §9）
- README 的进度行与"明确没有的东西"整段重核：把已交付的六条划掉，
  剩下的每条写清"没做到哪一步"（"后端通了、界面没接"和"整块没做"不是一回事）。
- `docs/BRIDGE.md` 新增 §14（⑦ 的判据、两个边沿、发后即忘的广播与队列时序、五步活体、仍未证明的事）。
- 角标 `MILESTONE` 从 `M6` 改成 `R4`。

**这一轮最后的实测数字**：`node tools/verify-red-r4.cjs` 基线 306 条全绿、**33 处变异全部钉住**、
跑完 `git status` 只剩本轮有意改的文件（工具第一版在这里留过一个 `if (false)`，已修）；
`npm test` **1263 通过 / 9 跳过**，两个 tsc 配置干净；`node tools/selfcheck-r4.cjs` 退出码 0。

### 第 2 轮该跑什么（按开发计划的轮数）

**打包版真跑 R4 全链** —— 这是"能不能给他天天用"的分水岭：①–⑦ 的活体全是在
`npm run dev` 上做的，而 dev 与打包版的资源路径、worker 依赖、i18n 加载方式都不一样
（M3 为这个踩过一次"分类静默变 null"，因为那条链上有 try/catch 兜着）。

```
npm run build                                   # 出 dist\Atrium-Setup-0.1.0.exe + win-unpacked
# 带双沙盒起打包版（AVCA_APP_HOME 只管我们自己的目录，LOCALAPPDATA 要另指）
AVCA_APP_HOME=<沙盒根>\AppData\Roaming\A  LOCALAPPDATA=<沙盒根>\AppData\Local  \
  "dist/win-unpacked/Atrium.exe" --remote-debugging-port=9226
node tools/live-r4-bridge-ask.cjs --stage=1     # ⑦ 那五步原样重跑
node tools/live-r4-batch.cjs                    # ② 批量导入
node tools/live-r4-move.cjs                     # ③ 搬文件
node tools/live-r4-dims-where.cjs               # ⑤⑥ 分列与反查
```

翻出来的问题按严重度排进第 3 轮；第 4–5 轮清 §6 那批真 Unity 欠账；第 6–7 轮 M7 首启向导；
第 8 轮发布。**仍然等他点头的**：③ 在真库（README 第一行那个 `A` 目录）上真搬一次。


---

## 8. 第 2 轮 · 打包版真跑 R4 全链（2026-10-07 晚）

跑的是 `dist\win-unpacked\Atrium.exe`（`npm run build` 现出，EXIT=0：build 里那道
`npm test` 1263 通过、`check-worker-deps` 说 worker.js 自包含），一律带
`AVCA_APP_HOME` + **`LOCALAPPDATA` 双重定向**，CDP 端口 9227。

| 项 | 结果 | 凭据 |
|---|---|---|
| 起来 / 渲染层 / i18n | ✅ | 日志 `启动 Atrium 0.1.0 / Electron 33.4.11`、页面 target 是 `file:///…app.asar/out/renderer/index.html`；界面上所有按钮文字都是 i18n 出来的（打包版走 `extraResources` 那份词典） |
| 窗口显示 | ✅（兜底救了一次） | `窗口仍不可见，兜底 show()` 比 `ready-to-show` 早 32ms —— M2 那条兜底在打包版上又实测有用，**别删** |
| ① 进度队列多条 | ✅ | ② 那一轮里结果卡 `rows:10`、汇总「成功 5 个、失败 0 个、没执行 0 个」 |
| ② 多选卡批量导入 | ✅ | 5 张卡 → 「导入 Unity（5）」→ 串行 → 5 行同一个 `batch_id` → 整批退回后 5 行 `rolledback` + 5 个备份目录 |
| ③ 改分类搬文件 | ✅ | 预览卡 → 搬 → 新位置有文件、旧位置没了、库里三列改、一条 `op=rearchive` journal → 搜「模型」命中 → 撤销后文件回原位、路径回原值、**素材记录还在** |
| ③ 的"只登记不搬"那句原因 | ✅（第二次才抓到） | 「已保存（文件没动）：这件是「只登记不搬」，文件本来就不在库里」 |
| ④ 类别口语 | ✅ | 搜「饰品」3 张、`shipin` 1 张、面板加词**不重启就搜到**、单字被当场拒、测试词收尾删干净 |
| ⑤ 变体分列 | ✅ | 卡片「2 变体 · 适配模型 ×2 · 版本 ×2」，库里 dims = `avatar=Manuka\|avatar=Shinano\|version=1.0\|version=1.1` |
| ⑥ 跨工程反查 | ✅ | 反查块「在哪些工程装过（1）… 当前目标 … 退回 5 次」+ 口径那句；真导一次之后变成「2 个包 · 新建 1 · 覆盖 1 · 18:31」 |
| ⑦ 首次发现弹桥接窗 | ✅ 五步全过 | `--stage=5/1/2/3/4`：弹窗、答 always → 真装进 `Packages/`、答 never → 不动盘、未答就刷新 → 还在问、开始运行时静默重装 |

**产品缺陷：0 条。** 但翻出三条别的，都不是"代码写错了"那一类：

1. **打包版把用户改的分类口语写进安装目录**（实测：跑完 ④ 之后
   `dist\win-unpacked\resources\lexicon\categories.json` 的 mtime 变成刚才，
   而运行时目录 `%APPDATA%\A\` 里没有第二份）。装到 per-user 目录（`perMachine=false`）
   所以写得到，也就能生效 —— 但**升级 / 重装会把它覆盖掉**，用户自己加的口语词全丢。
   修法：口语词的落点搬到 `P.root()` 下（和 `lexicon.user.json` 一个路子），加载时合并。
   → **第 3 轮已改**（存 `{add, remove}` 增量而不是整份拷贝），见 §9。
   ⚠ 但"升级之后还在不在"这条**要打包版真跑一遍才算数**，单测只证明逻辑 —— §9 里补了升级模拟。
2. **全新安装第一次会发现一批工程，⑦ 就会连着弹 N 个窗**（设计如此：队列一次一条）。
   他真机第一轮是 8 个工程 → 连问 8 次才能开始用。要不要在 M7 首启向导里一次问完
   （"以后所有新工程都自动装？"），或者允许"剩下 N 个都不再问"。→ 第 6 轮的裁定项。
3. **活体脚本自己的三个坑**（都已修，记下来免得又以为是产品坏了）：
   ① toast 探针排在截图与读库之后 —— toast 4.2 秒淡出，抓到的是"（没找到）"这种假故障；
   ② 冲突框按钮实际写着「继续（不备份）」/「继续并备份被覆盖文件」，脚本只试了
   "继续导入"和精确匹配的"继续"，两个都没点到，于是报"等不到导入结果"；
   ③ 我自己把 ④ 的驱动指到了另一个沙盒实例（那个库里确实没有配饰卡，0 命中是对的），
   以及临时探针把过滤字段写成 `q`（真名 `search`），结果所有查询都返回全量 ——
   **看着像检索坏了，其实是探针没传进去**。三次都是"先怀疑产品、后发现自己"。

**复现**：

```
npm run build
node tools/live-r4-packaged-prep.cjs                       # ② 的沙盒：清掉误登记的真工程 + 写沙盒 VCC 清单
AVCA_APP_HOME=<沙盒>\AppData\Roaming\A LOCALAPPDATA=<沙盒>\AppData\Local \
  dist\win-unpacked\Atrium.exe --remote-debugging-port=9227
node tools/fake-unity-live.cjs <沙盒工程>                  # ② 要对端
AVCA_CDP_PORT=9227 node tools/live-r4-batch.cjs            # ②（含①）
AVCA_CDP_PORT=9227 node tools/live-r4-dims-where.cjs       # ⑤⑥
AVCA_CDP_PORT=9227 node tools/live-r4-move.cjs             # ③（切到 move 沙盒的 APP_HOME 后跑）
AVCA_CDP_PORT=9227 node tools/live-r4-synonyms.cjs         # ④（同上）
AVCA_CDP_PORT=9227 node tools/live-r4-bridge-ask.cjs --stage=5|1|2|3|4   # ⑦（ask 沙盒）
```

⚠ 一个沙盒实例只服务一个沙盒：`live-r4-move` / `live-r4-synonyms` 的用例数据在
`D:\avca-r4-move`，`live-r4-batch` / `live-r4-dims-where` 在 `D:\avca-r4-live` ——
指错了不会报错，只会给你一串"命中 0 张"的假故障（本轮就踩了一次）。


---

## 9. 第 3 轮 · 修第 2 轮翻出来的那条落点问题（2026-10-07 晚）

两件都是"改代码 + 让它能被机器查住"，不是新能力。

### ① 用户改的分类口语不再写进安装目录

改法不是"把整份表挪个地方存"，而是**存增量**：

- `src/main/services/paths.ts` 多一条 `categoriesUser: () => path.join(root(), 'categories.user.json')`。
- `src/main/services/categories.ts` 拆开三层：`builtinCategories()`（**只读**，可能在
  `resources\lexicon\` = 安装目录里）、`readDelta()` / `writeDelta()`（`{schema, updatedAt, synonyms:{节点: {add, remove}}}`），
  `loadCategories()` 每次把增量叠在内置表上；`saveCategories()` 先 `structuralDrift()` 比结构，
  **改了标签或加了二级分类就当场报错**（只允许改「口语」），过了才写增量。
- 为什么存增量而不是整份：存整份的话，**以后内置表新增的分类和口语永远进不来**
  （用户那份是旧副本、盖在上面）。用例里直接模拟了一次升级：内置表多加「ウェア」和一个新二级 →
  用户加的 `猫猫头` 照样在，新加的也照样看得见。
- 一条改动都没有时**删掉**增量文件（留个空文件会让人以为"我改过什么"）。
- 测试新增 `tests/services/categories-delta.spec.ts`（14 项）。里面有个新接缝：
  `setBuiltinCategoriesFileForTest()` —— 不把它指到临时文件，"升级之后还在不在"这条就没法测，
  而测它就得改仓库里那份真内置表。这条用例自己钉住"仓库那份没被写过"（比 mtime 和内容）。
- 回退验证：`tools/verify-red-r4.cjs` 新增 **J1–J4** 四条变异（写回整份表 / 读时不叠增量 /
  结构闸关掉 / 落点回安装目录），四条**都红**。全量跑：**基线 322 条全绿、40 处变异全部钉住**（第 1 轮是 33 处）。
  ⚠ J4 那条变异会在 `resources/lexicon/` 留一份 `categories.user.json` 垃圾，跑完删掉（已写进工具头部注释）。

### ② 补上 C3 那个洞：`rearchive` 里"附属在不在旧父目录里"那一支

第 1 轮记的是"撤掉判断全仓不红"。根因不是断言写错，是**夹具喂的东西不全**：
原来那个"散着的子项"只有 `library_path`，`source_path` / `cover_image` 两列是 NULL，
那个循环体一次都没进过。补法（`tests/library/rearchive.spec.ts` +2 条，共 19 项）：

- 预览层：散着的子项同时给三列 —— 目录里的 `source_path` 要跟着进新位置、
  库外的 `cover_image` **一个字都不改**、同一列不许被改两次、
  盘上已经不存在的子项目录**不记 move**（记了会在 `applyRearchive` 那里 ENOENT，整次改分类判失败）。
- 执行层：真在临时目录里建两棵、真搬（`moved=2`，子项落在**新父目录里面**不是旁边）、
  journal 一条 `op=rearchive` 里带着两条 moves，Ctrl+Z 一次把两棵都搬回原位。
- 变异 C3 / C3b / C3c 三条**都红**（原来那条一个都不红）。

### 打包版真跑（2026-10-07 深夜，`dist\win-unpacked\Atrium.exe` + `D:\avca-r4-move` 沙盒）

`npm run build` EXIT=0（**1279 通过 / 9 跳过**，比第 2 轮多 16 条 = 本轮新增的 14 + 2），
起包带 `AVCA_APP_HOME` + `LOCALAPPDATA` 双定向，CDP 9227。跑的是 `tools/live-r4-synonyms.cjs`
（本轮改成三段：`--stage=add` → `--stage=make-v2` + 重启 → `--stage=upgrade`，外加 `--stage=ascii` / `cleanup`）。

| 步骤 | 实测 |
|---|---|
| 加词之前记下安装目录那份内置表的哈希 | `18b6f7be47b6` |
| 面板加「猫猫头测试词」→ 保存 | 保存**之后**哈希还是 `18b6f7be47b6` —— 内置表一个字节没被写（第 2 轮那条缺陷的正面反证） |
| 增量落在哪 | `D:\avca-r4-move\AppData\Roaming\A\categories.user.json`，**154 字节**（内置表那份 34,550 字节）→ 存的是增量不是整份拷贝：`{"schema":1,"synonyms":{"accessory":{"add":["猫猫头测试词"],"remove":[]}}}` |
| 不重启就搜得到 | ✅ |
| ⭐ 模拟升级：把 `win-unpacked\resources\lexicon\categories.json` 换成"v2"（删掉口语「饰品」、加进「升级模拟新增词」）→ 重启 | 合并结果（直接问主进程 `categories:list`）= `["首饰","配件","小物","挂件","アクセ","アクセサリー","升级模拟新增词","猫猫头测试词"]` —— **旧表那份被换掉了、新表加的在、用户加的也在**，三件事同时成立 |
| 纯 ASCII 词双向验证（`--stage=ascii`，加 `avkxqword` → 搜 → 删 → 再搜） | 基线 0 张 → 加完 **1 张**（`MatCap Vol.3/accessory`）→ 删完 **0 张**，合并表里也没了 → 加词与删词都不必重启就生效 |
| 收尾 | 删词之后增量文件被**删掉**（不是留一个空文件）；`resources/lexicon/` 与 `win-unpacked` 都还原成 pristine；沙盒实例已关 |

### 这一轮活体自己抓到的一条假绿（记下来）

第一版 `--stage=upgrade` 拿"「饰品」的命中数变少"当判据，而它要比的 `state.dropSynBefore`
是**上一版脚本写的状态文件里没有的字段** → `undefined` → 比较式恒假 → 打印 ✅。
改成直接读合并出来的那张表之后才第一次真的判得动。

顺带把一条口径钉死（写进脚本头部）：**汉字查询的命中数不能当"这条口语在不在表里"的判据**。
实测「猫猫头不存在词」（乱造的）和「猫猫头测试词」（真加过的）返回**同样两张卡** ——
`src/main/search/index.ts:213` 那趟是 `prefix: true`，而汉字查询会被切成逐字拼音
（`mao / tou / ce / shi`），单音节前缀能把「头饰」「饰品」的拼音别名都带出来。
要验口语生效就用**纯 ASCII** 的词（整体一个 token，加/删双向都干净），
要验表里有没有就读 `categories:list`。

### 仍然没做完的

- ⛔ 渲染层"画法"仍然是结构性未验证（零 DOM 测试），本轮 14 项全在主进程侧 + CDP 逼近。
- ⛔ 真升级（装 Setup.exe 覆盖安装）没走过 —— 上面的"升级"是**手工把内置表换成另一份内容**模拟的，
  它证的是"用户改动不寄存在内置表里"这一半；安装包自己的覆盖行为要到第 8 轮真装才算。


---

## 10. 第 4 轮 · 真 Unity 那批欠账（2026-10-07 深夜）

三件都在 `tools/live-r4-members.cjs` 里，沙盒 `D:\avca-m5b-live`
（库根 / 假工程 `Shinano-LiveTest` / 抽取根 / APPDATA 全在沙盒里，他 8 个真工程与 `E:\vrc\A` 一字节未动）。
容器是一个真 zip，里面装 **10 个** `.unitypackage`（`AVCA_M5B_MEMBERS=10`）。

| 项 | 结论 | 凭据 |
|---|---|---|
| >8 成员自动切两批、一次只抽一批 | ✅ 过了（假对端） | 面板「找到 10 个」→「已勾 10 个 · 分 2 批」→ 第一批抽取根里**只有 8 个**副本 → 计划页「这批 8 个包」→「成功 8 · 失败 0 · 没执行 0」→「继续下一批（还剩 1 批）」→「这批 2 个包」→ 成功 2。库里 `import_log` **10 行 / 2 个 batch_id / 形状 [8,2]** |
| 「就导到这儿」把剩下的退回 | ✅ 过了（假对端） | 第一批导完点停 → 账上**只有 8 行**，`Shinano_Face` / `Manuka_Dress` 两个成员从没被抽也没被导（抽取根同步印证） |
| 真 zip 抽出来的成员导入真 Unity | ✅ **过了**（真 2022.3.22f1） | 心跳 `bridgeVersion 1.0.0` / `unityVersion 2022.3.22f1` / pid 10752 确实是活着的 `Unity.exe`；19 个条目**逐条**核过：文件在 `Assets/`、`.meta` 的 `guid:` 就是包里那条；新建目录 `Pose.meta` 是 `folderAsset: yes` + GUID `040028df…` **不在包里** = Unity 自己生成的 |
| 真 Unity 下的冲突与撤销 | ✅ 过了 | 预置那枚同路径同 GUID 的资源被列进 `overwritten` 并备份到 `AppData\Roaming\A\backups\rollback\01M4B8NSW…`；**先把工程里那份内容改掉再导**，撤销后逐字节等于**改过的那份**（不是包里那份） |
| §8-5 Play 模式排队 | ✅ **A 侧过了**（假对端装忙 + 真编辑器都跑了） | 界面「已排队（Unity 正在运行 Play 模式）· 第 N 次重试 · X 秒后再试」；排队期间库里 **0 新增**；忙解除后**不需要用户再点一次**自己跑完 |
| §8-5 里"真 Play 会不会让桥接报忙" | ✅ 过了（真编辑器） | 沙盒里放了 `Assets/Editor/AvcaSandboxPlayTrigger.cs`（`play.txt` 在就 `isPlaying = true`，删了就退）—— 心跳真的翻成 `isPlaying:true / busyReason:"Unity 正在运行 Play 模式" / bridgeVersion:1.0.0`，A 收到的是 **busy 不是 error** |
| 修完之后重出的包再验一遍 | ✅ 过了 | `npm run build` EXIT=0（94 个测试文件全绿）之后同一个真 Play 场景：界面写「第 1 次重试 · **1 秒**后再试」，A 日志本次四行 `[1000, 2000, 5000, 10000]` —— 序列和 §2.5 定死的那条对上；活体驱动自己也把这条变成硬断言 |

**图**（第 5 轮补存进仓库的，原来只在沙盒 `D:\avca-m5b-live` 里 —— 那个沙盒会被后续驱动复用，证据不该寄存在里面）：
`docs/screenshots/r4-members-01-picked.png`（面板「已勾 10 个 · 分 2 批」）、
`r4-members-02-plan.png` / `r4-members-02-result.png`（第一批 8 个包的计划页与结果页）、
`r4-members-03-plan.png` / `r4-members-03-result.png`（第二批 2 个包）、
`r4-real-01-queued-in-play.png`（真 Play 期间那行「已排队 · 第 1 次重试 · 1 秒后再试」）。

### 这一轮翻出来的三条

1. **真缺陷（已修）**：busy 的**第一次退避是 2000ms，序列里那档 1000ms 永远取不到** ——
   `BUSY_BACKOFF_MS[Math.min(retries, …)]` 里 `retries` 在取下标之前就已经自增了。
   规格 §2.5 写的是"退避 1s→2s→5s→10s→30s，固定不可改"。
   为什么 1279 条用例全绿还留着它：老断言只有 `nextDelayMs > 0`，另一条写着
   "退避 1s + 2s"的注释、实际却是 `elapsed >= 1000+2000-150` —— 7 秒也照样过。
   **注释写着它以为的行为，比没注释更坏**（读代码的人会以为这条查过了）。
   现在逐字对上 `BUSY_BACKOFF_MS[0]` / `[1]` 并给总时长加上界；
   `node tools/verify-red-r4.cjs 41`（K1）**红 2 条**，改回来 23 条全绿；
   活体 `--stage=play-real` 也直接把"本次退避序列"打出来对表。
2. **UX 欠账（没修，等第 6 轮裁定）**：一次导完两批之后，界面**只能退回最后那一批** ——
   `rollbackBatch(o.batchId)` 的 batchId 来自当前结果卡，第一批再没有入口
   （上面那条表格里我就是靠 IPC 后门把第一批撤掉的，那**不是用户路径**）。
   一批一条 `batch_id` 是 M5-B ④ 定的账目形状，不该改；要改的是界面：
   要么结果卡上列"这一轮的 N 批"一起退，要么在详情面板的反查块里给个入口。
3. **残留（没修，先记着）**：真 Unity 撤销之后，这次新建的**资源**删干净了，
   但导入时建的**空目录和它们的 `.meta`** 留在工程里（`Manuka.meta` / `Shinano/Pose.meta` …）。
   Unity 下次刷新会自己忽略掉，不影响功能，可是工程树里看得见。
   要修得先让 A 知道"哪些目录是这次导入建的"（`list_project_assets` 现在只回包名，答不了）。

### 夹具与判据的四条教训

- **合成包里的 `asset.meta` 必须带 `guid:`**：M5-B 那套生成器只写 `fileFormatVersion: 2`，
  假对端按 tar 的目录名取 GUID 所以一直看不出来；**真 Unity 会整条忽略**
  （`does not have a valid GUID`）→ `createdGuids` 空，像 A 的账坏了。
  同理条目内容要用 Unity 收得下的文本型（本轮加了 `AVCA_M5B_TEXT_ENTRIES=1`：
  `.anim/.prefab/.fbx` 换成 `_anim.json` 这种），拿假 YAML 测出来的是 Unity 的导入器。
- **`import_log` 是累积的**：断言必须打在"本轮新增的行"上。第一版数全表，
  复跑时报了个"第二批被偷偷导了"的假故障（18 行里 10 行是上一轮的）。
- 还有一条老坑又踩一次：判"文件在不在清单里"要先把两边都 `split('/').join(path.sep)`，
  正斜杠比反斜杠 → 报了个"撤销后还剩 1 个文件"，其实就是那枚预置的撞车资源。
- **收尾不验终态 = 这一条没验**：`--stage=play-real` 的 P4 点了「整批退回」之后只 `sleep(8000)` 就打印收尾，
  而真 Unity 删 3 个成员要等资产库刷新、实测超过 8 秒，紧接着我又关了 A ——
  沙盒里因此留下 3 行 `ok` 和 6 个文件（这是我这个 stage 的收尾没等，不是产品撤不掉：
  同一批真 Unity 撤销在 `--stage=real` 的 R5 里核过 —— 撤完之后工程里只剩预置那枚撞车资源、
  被覆盖那份逐字节等于改过的那份，我另外又单独查了一次盘确认）。
  ⚠ 同一条 R5 里"10 行全变 rolledback"第一版也只是**打印**了计数 —— 已经补成硬断言
  （轮询到没有 `ok` 行为止，撤不干净就失败）；"看起来核过"和"断言过"是两件事，
  这一轮在这两处各犯了一次（P4 的 sleep 与 R5 的计数）。
  驱动已改成轮询到"没有 ok 行"为止（最多 120 秒），到点不就就报失败。

### 复现

```
AVCA_M5B_MEMBERS=10 AVCA_M5B_TEXT_ENTRIES=1 AVCA_M5B_PLAY_TRIGGER=1 \
  node tools/make-m5b-live-tree.cjs                       # 10 成员的真 zip + 沙盒工程 + Play 开关脚本
# VCC 清单只列沙盒工程：D:\avca-m5b-live\AppData\Local\VRChatCreatorCompanion\settings.json
"E:\unity\2022.3.22f1\Editor\Unity.exe" -projectPath "D:\avca-m5b-live\projects\Shinano-LiveTest" \
  -logFile "D:\avca-m5b-live\unity-r4.log"                # 真编辑器（play-real 那一档要用它）
AVCA_APP_HOME=D:\avca-m5b-live\AppData\Roaming\A LOCALAPPDATA=D:\avca-m5b-live\AppData\Local \
  dist\win-unpacked\Atrium.exe --remote-debugging-port=9226
node tools/fake-unity-live.cjs D:\avca-m5b-live\projects\Shinano-LiveTest   # batch/stop/play 三档用它
AVCA_CDP_PORT=9226 node tools/live-r4-members.cjs --stage=batch             # /stop /play /real /play-real
```

⚠ 假对端和真编辑器**不许同时开着同一个工程**（两边都写 `Temp/AVCABridge/bridge.json`，
心跳会互相盖掉，看着像"忙判定失灵"）。
⚠ `taskkill /F /IM Unity.exe` 会顺手杀掉 Unity Hub 的 `unity.exe serve`，按 PID 杀。

### 这一轮最后的实测数字

`node tools/verify-red-r4.cjs` 全量跑完：**基线 345 条全绿、41 处变异每一处撤掉都有用例变红、退出码 0**
（第 1 轮 33 处 → 第 3 轮 40 处 → 本轮 +K1 = 41）；跑完 `git status` 只剩本轮有意改的文件 ——
J4 那条变异照例在 `resources/lexicon/` 留一份 `categories.user.json` 垃圾，删掉即可（工具头部注释里写着）。
`npm run build` EXIT=0（**94 个测试文件全绿，1279 通过 / 9 跳过**），两个 tsc 配置干净，
`node tools/selfcheck-r4.cjs` 退出码 0。

### 第 4 轮之后仍然挂着"未验证"的

§8-11 真 none（无关工程只更新顶栏不切集合）、「以后都这样」之后第二次命中、
托盘唤醒置顶 1.2 秒、桥接 `bridgeVersion ≥ 1.1.0` 那一支（要改 C#）、
渲染层画法（零 DOM 测试）、③ 在真库 `E:\vrc\A` 上真搬一次（等他点头）、
Setup.exe 覆盖安装的真实升级行为（第 8 轮）—— 逐条对应第 5 / 6–7 / 8 轮。


---

## 11. 第 5 轮 · M6 那四条"只有真机能答"的欠账（2026-10-08）

工具 `tools/live-r5-m6-debts.cjs`（三个 case：`none / always / wake`），沙盒还是 `D:\avca-m5b-live`；
窗口状态用 `tools/topmost.ps1` 直接问 Win32（`WS_EX_TOPMOST` / `IsWindowVisible` / `GetForegroundWindow`），
不靠肉眼。全程不需要他的真 Unity —— 运行边沿用假对端的心跳造，托盘与置顶量的是真的窗口状态。

| 项 | 结论 | 凭据 |
|---|---|---|
| §8-11 真 none（有集合但都不沾 → 只更新顶栏、不切视图） | ✅ **过了**（8/8） | 先塞一个 `Shinano` 集合（**不然"谁都匹配不上"是集合表空的退化 none**），再开 `Nothing-LiveTest`：日志两行 `工程运行状态变化 → 已打开（依据：bridge）` + `[auto-switch] … 未自动切换 —— none`；`unity:list-projects` 里它 `running:true`；「当前工程」页屏幕上写得出工程名并标着「运行中」；侧栏 Shinano 集合**在**但没被选中；屏上那条横幅是「检测到 [Nothing-LiveTest] · 没匹配到集合，视图没动」这一支，**没有**「已识别为…」那条切换横幅 |
| 「以后都自动安装」之后**第二次打开同一工程** | ✅ **过了**（8/8） | 第一次：`[bridge-ask] 第一次发现…→ ask` → 弹窗 → 点「以后都自动安装（只这个工程）」→ `setting` 里 `bridgeAsk:<id>` = `"always"` + 真复制 3 个文件进 `Packages/`。**然后把 A 整个关掉再起来**（新主进程）→ 重启后还是**同一行**（按路径命中，不是每次新发一个 id）→ 心跳重新出现 → `[bridge-ask] … 开始运行 → auto` → `已安装到 …（3 个文件）` → **没有再弹窗** |
| 托盘唤醒 + 置顶 1.2 秒（§8-14） | ✅ **过了**（10/10），但**修了一条真缺陷**才过 | 见下面那一节 |
| 已可见时不闪置顶（别骚扰） | ✅ 过了 | 窗口开着的时候再制造一次边沿：82 个样本里 `WS_EX_TOPMOST` **0 次为真** |

**图**（同样补存进仓库，别只留在沙盒里）：
`docs/screenshots/r5-none-01-neutral-project.png` —— 「当前工程」页里 `Nothing-LiveTest` 绿点标「运行中 · bridge」，
侧栏 Shinano 集合**在而没被选中**，横幅写的是「检测到 [Nothing-LiveTest] · 没匹配到集合，视图没动」
（**不是**「已识别为…」那条切换横幅 —— 这一支要证的正是"不切"），
而这张屏上还叠着 M6 的「要让 A 开机常驻托盘吗？」模态（见下面那条）；
`r5-always-01-first-ask.png`（第一次那个三按钮弹窗）、
`r5-always-02-after-restart.png`（**进程重启之后**再开同一工程：没有弹窗，右下角那条 toast
「已自动为「AskSecond-LiveTest」装好桥接：3 个文件 → …\Packages\com.avca.bridge」就是静默装成的凭据）、
`r5-wake-01-after-woken.png`（从托盘被唤醒之后的那一屏，窗口已经画出来了，横幅同上一条是"没匹配到集合"那种）。

### 抓出来的真缺陷：置顶那 1.2 秒**从来没执行过**

`wakeForProject()` 第一行是 `const win = createMainWindow()`，而 `createMainWindow()` 在窗口已存在时
会顺手 `show() + focus()`（那是"第二实例启动"那条路要的语义）。紧接着再读 `win.isVisible()` 判
"是不是藏着的" —— **拿回来的永远是"本来就开着"**，于是 `wasHidden` 恒为 false、
`setAlwaysOnTop(true)` 与那句 `[window] 检测到 Unity 工程启动，已从托盘唤醒主窗口` 一次都没跑到。
窗口从托盘弹出来是那个副作用的巧合，**恰好把整条没生效的事实盖住了**。

改法：先 `getMainWindow()` 把状态读掉，再调 `createMainWindow()`。修完实测（重出的打包版）：
127 个 100ms 样本里 `topmost=true` 连续 11 个 ≈ **1185ms**（Q6 裁的 1200ms），
最后一个样本 `topmost=false`（置顶自己取消了，不会永远压着 Unity），日志那句也真的落了下来。

为什么那时 1279 条用例全绿还留着它：接线那半早有静态扫描钉着
（`auto-switch-store.spec.ts:231` 要求 `if (action === 'switch' || 'wake-only') void opts.wake?.()`），
**但没有任何一条看被调进去之后干了什么** —— `window.ts` 顶层读 `app.isPackaged`，node 环境里 import 就炸，
所以这文件一直没被测过。补了 `tests/project/wake-order.spec.ts`（4 项，静态查顺序：判据必须在
`createMainWindow()` 之前、读的是预读到的 `existing` 而不是返回值、取消置顶在 `finally` 里、
时长用常量不许写死），并进了回退验证器 **L1**（把预读换成那个有副作用的调用 → 红 1 条）。

### 一条要他裁的实测口径：置顶成功了，**抢前台没成功**

唤醒期间 **0/127** 个样本里 A 是前台窗口，前台始终是 `Program Manager`。
也就是说 Windows 的焦点保护下 `win.focus()` 没把键盘焦点拿过来，实际观感是
"窗口浮到最上面 1.2 秒、但焦点还在你原来那个程序里"。
规格 §4.3 那句是"弹出主窗口并置顶"——按字面**已经满足**；而"抢焦点"这件事本来也不该硬抢
（M6 的 R-51 就是"凭一条检测到 Unity 去抢焦点是骚扰"）。所以这不是缺陷，是**口径**：
要不要在 §8-14 里把"焦点也跟过来"当成验收项？要的话得用 `AttachThreadInput` 那一类手段，
而它正是"用户正在别的窗口里打字时被打断"的来源。→ **第 6 轮裁定表 `docs/M7-DESIGN.md` §8 Q6**（推荐：不抢，验收口径写"置顶 1.2 秒、不动焦点"）。

`docs/screenshots/r5-none-01-neutral-project.png` 那张屏上还叠着 M6 的**「要让 A 开机常驻托盘吗？」模态**（第一次检测到 Unity 时问一次）。
它和 §8-11 无关，但同一屏上确实有模态 —— 与"全新安装连弹 N 个桥接窗"是同一族问题，
一起进第 6 轮的首启向导裁定（`docs/M7-DESIGN.md` §3.6 / §3.7 与 §8 Q8–Q10）。
本轮之后驱动默认把 `autoLaunchAsked` 预置成 true，免得它盖在别的判据的截图上。
（**记一句自己的错**：这一段初稿把那个模态记成了 `r5-wake-01` 那张，逐张把图看过才对上号 ——
图注和断言一样得核，不能凭印象写"这张里有"。）

### 探针自己的三条坑（写下来免得下次以为产品坏了）

1. **主窗口的原生标题是空的**，而那个 159×27 的 `titleBarOverlay` 小窗标题才叫 `Atrium` ——
   按标题找窗口会量到那块小条（`visible=true` 一直为真，托盘判据当场失真）。
   现在按**尺寸**认主窗口（≥400×300 里最大的那个），并把 rect 一起打出来。
2. `GetWindowTextW` 的 P/Invoke 必须写 `CharSet = CharSet.Unicode`：默认 `Auto` 会把 `StringBuilder`
   按 ANSI 编组，标题取回来是空的/乱码 —— 于是"标题匹配"静默失效，看起来像"窗口不见了"。
3. 还有第 4 轮那条在这里又应验一次：**读自家日志要按行内时间戳筛**。我第一版比的是
   `l.slice(0,20) >= since`，而 `since` 忘了带行首那个 `[` —— `'['`(0x5B) 比 `'2'`(0x32) 大，
   比较对每一行都成立，于是上一轮的日志被当成这一轮的，**两条判据抄旧账"过了"**。
   修完之后真实结果才浮出来（也就是上面那条缺陷）。

### 复现

```
# 沙盒：D:\avca-m5b-live（库根 / projects / AppData 都在里面）
node tools/live-r5-m6-debts.cjs --case=none      # §8-11 真 none（自己起 A、自己关）
node tools/live-r5-m6-debts.cjs --case=always    # 第一次答 always → 重启进程 → 第二次按路径命中
node tools/live-r5-m6-debts.cjs --case=wake      # 托盘 → 唤醒 → 逐 100ms 量 WS_EX_TOPMOST
powershell -File tools/topmost.ps1 -Action list  # 看这个进程到底有哪些窗口（诊断用）
```

### 第 5 轮最后的实测数字

`npm run build` EXIT=0：**1283 通过 / 9 跳过**（比第 4 轮多 4 条 = 新增的 `wake-order.spec.ts`），
两个 tsc 配置干净；`node tools/verify-red-r4.cjs 42`（L1）**红 1 条**，改回来 4 条全绿；
三个 case 的判据分别是 8/8、8/8、10/10；`node tools/selfcheck-r4.cjs` 退出码 0。
**全量 42 处变异回扫本轮补跑了**（2026-10-08 20:30，独立跑、不与别的重活并行）：
基线 **349 条全绿**，42 处每一处撤掉都有用例变红（最少的 L1 红 1 条、最多的 J1 红 8 条），
**退出码 0**；跑完删掉 J4 那条变异在 `resources/lexicon/` 留下的 `categories.user.json` 垃圾，
`git status` 只剩本轮有意改的文件。

### 第 5 轮之后仍然挂着"未验证"的

- 桥接 `bridgeVersion ≥ 1.1.0` 那一支（`topFolders` / `avatarDescriptors` / 哪些目录是这次导入建的）—— **要改 C#**，→ 第 6 轮裁定（任务 #75）
- **唤醒时要不要真的抢焦点**：置顶已实测生效，前台 0/127 —— 口径问题，→ 第 6 轮一起裁（§8-14）
- **全新安装连弹 N 个桥接窗** 与 **「要让 A 开机常驻托盘吗？」模态** 叠在同一屏 —— 都属首启向导，→ 第 6 轮（M7）
- **一次导完 N 批之后界面只能退最后那批** —— 第 4 轮实测，→ 第 6 轮裁定（任务 #74）
- 渲染层画法（本仓库零 DOM 测试，只能 CDP 断言 + 截图逼近）
- R4 ③ 在真库 `E:\vrc\A` 上真搬一次（**等他点头**，只读预览早过了）
- Setup.exe 覆盖安装的真实升级行为、代码签名 —— 第 8 轮

---

## 12. 第 6 / 7 轮 · M7 首启向导（2026-10-08 → 10-09）

第 6 轮只出设计（`docs/M7-DESIGN.md`，十二条裁定他一次全批、分支按推荐），第 7 轮 ①–⑧ 落地并真跑。
逐条记录都在 `docs/M7-DESIGN.md` §10，这里只留"哪些是实测过的、哪些仍然挂着"。

### 打包版真机首启六条（§6.2）—— 全部过了

`tools/live-m7-packaged.cjs`，只起 `dist\win-unpacked\Atrium.exe`，四场 **91 条判据 / 0 条红**：

| 场 | 判据 | 关键凭据 |
|---|---|---|
| `launch` | 35 | 首屏请求的是 `?view=main` 而画的是向导；接管之后 `oldlib` 整棵树 **md5 逐一不变** + `autoArchive=false`；第③步默认全勾、取消 Gamma 之后**只有 Alpha/Beta** 长出 `Packages/`（新增 6 个文件全在 `Packages/` 下，原有 `Assets/` md5 逐个相同），Gamma 连 `Packages` 目录都没建；走完 `onboardingDone:true` → **重启不再出现向导** |
| `password` | 22 | 真 `-mhe` 包先自证（对密码过 / 错密码失败 / 不带密码连文件名都列不出来）→ 界面问密码 → 勾「记住」→ 库里恰好一行 **48 字节密文**、`platform=win-dpapi`、日志不含明文 → **杀进程再起不再问**（`[vault] 用记住的密码重试`）→ **删掉那行再起又问** |
| `skip` | 9 | 「稍后配置」写 `onboardingSkippedAt` 而 `onboardingDone` 仍 false；重启不拦人但侧栏「库还没配好，点这里继续设置」还在；点它回向导并把 skip 痕擦成 null |
| `asks` | 25 | 8 个假工程一次冒出来：第一条写「另外还有 7 个工程要问」→ 逐条答两条（屏幕上依次是 Alpha/Beta/Gamma **三个不同工程**）→ 第三条点「剩下 5 个都不再问」→ 那行和按钮一起消失、屏幕上这条没被替答 → 库里**恰好 8 行** `bridgeAsk:<id>`（八个不同 id、全是 never、没有任何全局静音键）→ 重启之后一条都不弹 |

截图八张：`docs/screenshots/m7-pkg-01..07*.png`。
**写入面复核（只读）**：`%APPDATA%\A\library.db` 仍是 2,408,448 字节 / mtime 2026-10-05，
`setting` 0 行、`password_vault` 0 行、`asset` 372 / `project` 9 / `journal` 596 / `import_log` 1 一字未动；
四场跑的那半小时里 `%APPDATA%\A` 下**没有任何文件 mtime 落在窗口内**；
`E:\vrc\A` 2305 文件 / 24.32 GB，顶层目录 mtime 最新还是 10-05；
`E:\ALCOMprojects` 九个工程**一个 `Temp/` 都没有**（= 没写过桥接信箱），只有 `shinano-Main2` 装着桥接（前几轮留的）。
本轮写过的只有沙盒 `D:\avca-m7-live` 与仓库里那八张图。

### 这一轮被"回退验证 / 活体驱动"抓到的，一半是我自己写的表与工具

- `verify-red-m7`（29 处变异）第一条抓到的是**这张表自己**：一处变异同时 expect 两条用例，
  而"第①步不能跳"和"②③④ 能跳"是两个方向，必须两处变异（拆成 B3 / B8）。
- 打包版驱动自己犯了三次同一类错：`ej()` 已经解过一层 JSON 又解第二遍（炸在第③步）；
  **日志偏移在投递之后才取**（那一行早就写进去了 → 假失败）；
  **轮询里"条件一成立就 return"把要采的工程名一起跳过**（`seen.size >= 2` 假失败）。
  三条都是"看着像产品坏了，其实是量法错了"，所以每条都在文件头留了字。
- 反假绿一条：`asks` 里先断言"弹窗探针找得到 `role=dialog` 那一块"，
  否则后面那句"队列空了"（判的就是 `NODIALOG`）会**恒为真**。
- ⚠ 本轮还有一次**红线违反**（未重定向的 dev 实例打开了他的真库，`project` 表多一行 `Lime`）：
  全过程、只读复核与护栏都记在 `docs/M7-DESIGN.md` §10 那一节，他裁定「Lime 不用动」。

### 第 7 轮之后仍然挂着"未验证 / 没做"的

- ❌ **Setup.exe 真装进系统 + 覆盖安装的升级行为**（本轮测的是免安装 `win-unpacked`）→ 第 8 轮
- ❌ **Q5 乙**：首启那一次把运行目录搬到别的盘（现在只如实显示位置和占用）
- ❌ **Q7 乙**：`unpack/sevenZip.ts` 仍是命令行 `-p<明文>`，改法要先实测 7z 支持哪种免命令行传法
- ❌ **Q11 甲（#74）**：结果卡列"本轮 N 批"、每批一个退回按钮
- ❌ **Q12 乙（#75）**：桥接 C# 两条（撤销留空目录的 `.meta` + `bridgeVersion 1.1.0`）→ 第 8 轮之后单独一轮
- 🟡 渲染层画法仍然只有截图（零 DOM 测试）：`M7-13`/`M7-17`/`M7-27`/`M7-35` 四条在 `M7_RULES` 里明写未验证
-  R4 ③ 在真库 `E:\vrc\A` 上真搬一次 —— **仍然等他点头**




