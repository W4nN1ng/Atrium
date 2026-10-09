# M7 设计 · 首次启动向导 + 密码保管 + 全新安装的第一次体验

> **第 6 轮只出设计，一行产品代码都没写。** 这份文档的用途是让你逐条批 §8 那十二个裁定；
> 批完我就按 §9 的顺序在第 7 轮实现。所有"事实"都是读源码或本机实测来的，
> 没验证过的地方我明写「未验证」，不糊成「应该可以」。

规格原文只有两句，M7 的全部范围就来自这两句 + 前五轮攒下来的四条体验欠账：

- 01 §8：「首次启动走 3 步向导：① 选库位置 ② 选素材来源目录 ③ 安装 Unity 桥接（**可跳过**）」
- 01 §7 安全：「密码库用 Electron `safeStorage` 加密存储，不明文落盘」

---

## 0. 十问十答，先看结论

1. **向导解决的不是"好看"，是"全新安装第一次根本跑不动"**：`libraryRoot` 默认 `null`，
   此时拖文件进去只会拿到一句「还没设置库根目录（设置 → 库）」（`ingest/api.ts:553`），
   抽取根那边抛 `err.extractNoLibrary`（`import/extractRoot.ts:98`）。今天这些都得自己去设置页翻。
2. **首启判据已经有一个空壳**：`onboardingDone`（`shared/types.ts:884` + `settingsDefaults.ts:49`）
   —— 全仓**零读取、零写入**，只有三个活体夹具在往它写 `true`（`make-m5b-live-tree.cjs:270` 等）。
   也就是说大家都在猜它有用，其实没有。本轮复用这个字段，不再造第二个。
3. **向导画在渲染层，判定必须写在 `src/shared/wizardState.ts`**：本仓渲染层零 DOM 测试，
   凡是有分支的判断都得是纯函数才谈得上回归保护（M6 的 `bannerState.ts` / ⑦ 的 `bridgeAsk.ts` 都是这么做的）。
4. **三步不够，我建议 3 + 1**：规格那三步之外，加一步「收尾」放开机常驻托盘与热键。
   理由见 §3.7 —— 那个「要让 A 开机常驻托盘吗？」模态现在要靠"先检测到 Unity 才问"，
   而全新安装时 Unity 还没开过，第 5 轮的截图里它偏偏和别的判据叠在同一屏。
5. **N 个桥接弹窗收在一屏里问完**：第 2 轮实测到全新安装一次发现 8 个工程 → 连问 8 次
   （`BridgeAskDialog.tsx:22` 只画队头，`askQueue.ts` 按 projectId 去重）。
   方案见 §3.6，**判据与账目形状一行都不改**（每个工程仍一行 `setting`，第 5 轮刚验过"重启后按路径命中同一行"）。
6. **密码这一件我建议只做"记住加密包密码"**，不做密码库管理界面：`safeStorage` 全仓 **0 引用**，
   `password_vault` 表建了没人用（`db/schema.ts:213`）。现在密码是 per-job 内存态、重启即忘
   （`services/inboxQueue.ts:26-27` 明写"不存密码，重启后重新问一次"）。范围见 §3.8。
7. **不硬拦 C 盘**，只如实警告（§3.3 + Q4）。注意代码里已经有一处硬拦：抽取根落在 C: 直接
   `err.extractOnSystemDrive`（`extractRoot.ts:137`）—— 那是空间闸，不是偏好闸，两者口径要一致，见 Q4。
8. **运行时目录（库 DB / 暂存 / 缩略图 / 备份 / 日志 / settings）现在铁定在 C:**：
   全都从 `P.root()` 派生，而 `root()` 只认 `AVCA_APP_HOME` 环境变量，没有设置项能改（`services/paths.ts:83-110`）。
   你机器 C 盘紧张是已知事实，这条我单独摆成 Q5 让你裁，不自己决定。
9. **向导不许变成第七个"设置页"**：每步只问规格那件事，能一屏点完的不分两屏，"任何功能最多两步可达"照旧成立。
10. **本轮不做**：代码签名、`Setup.exe` 覆盖安装行为、GUID 增量索引与 `bridgeVersion ≥ 1.1.0`（要改 C#）、
    LLM 兜底 —— 前两条是第 8 轮，中间那条是 Q12，最后一条本来就在非目标附近。

---

## 1. 事实基线（读源码 / 本机实测，全部只读）

| # | 事实 | 出处 |
|---|---|---|
| 1 | `libraryRoot` 默认 `null`；没设过就摄取 → `throw new Error('还没设置库根目录（设置 → 库）')` | `shared/settingsDefaults.ts:20`、`main/ingest/api.ts:553` |
| 2 | `libraryRootOrThrow()` 定义了（注释写着"不允许摄取/归档"），**全仓 0 处调用** | `main/services/settings.ts:83` |
| 3 | 设置页是 7 个 tab 的数组驱动，加一块=改 `TABS` + 一段 JSX + 三语 i18n | `renderer/pages/Settings.tsx:14-16` |
| 4 | 改库根 = **纯改指向，没有任何迁移**：全仓搜不到 `moveSync/copyLibrary/relocate`，而 `asset` 存的是绝对 `source_path`/`library_path` | `main/db/schema.ts:44,86`；消费点读 `getSettings().libraryRoot` 现取现用 |
| 5 | 监视文件夹键 `watchedFolders: string[]`，chokidar 在 `main/services/watcher.ts`，UI 是 `Settings.tsx:392` 的 `ListEditor` | 同左 |
| 6 | 桥接问答：判据纯函数 `bridgeAskDecision`（`shared/bridgeAsk.ts:67`）→ 队列 `bridgeAsk.ts` 按 projectId 去重、**只画队头**、`waiting>1` 只写一句"还有 N 个在等" | `main/bridge/askQueue.ts:29-43`、`renderer/components/BridgeAskDialog.tsx:22,37` |
| 7 | 答案落 `setting` 表一行 `bridgeAsk:<projectId>`；**没有"这些都不再问"的入口**（只有 per-project） | `main/db/repos/bridgeAsk.ts:13-37` |
| 8 | 开机自启那一问的判据是 `shouldAskAutoLaunch({autoLaunch, alreadyAsked, sawUnityStart})` —— **必须先看见过 Unity 启动**才问 | `shared/bannerState.ts:147-153` |
| 9 | `AutoLaunchAsk` 与 `BridgeAskDialog` 挂在同一层（`App.tsx:161-162`），所以会叠在同一屏 | 第 5 轮截图 `docs/screenshots/r5-none-01-neutral-project.png` 里就是叠着的：底下是"没匹配到集合"那条横幅，上面是「要让 A 开机常驻托盘吗？」 |
| 10 | 启动项真写的是 `app.setLoginItemSettings({openAtLogin})`（HKCU），`autoLaunch` 默认 `false` | `main/ipc/settings.ts:30`、`settingsDefaults.ts:16` |
| 11 | `safeStorage` 全仓 **0 处引用**；`password_vault(hint, password_enc, platform, item_id, author)` 建表没主 | `main/db/schema.ts:213` |
| 12 | 密码现状：内存 per-job（`ingest/api.ts:54,769-777` → worker → `unpack/sevenZip.ts:251`），界面上只有 `Inbox.tsx:51-62` 一个输入框；`MemberPicker` 只写"需要密码"、没有输入框 | 同左 |
| 13 | 7z 是命令行传 `-p<密码>`，**同机任何用户看进程列表都能看到**（这条 README 已经记过） | `unpack/sevenZip.ts:234,251` |
| 14 | 运行时目录（db/staging/thumbs/backups/logs/settings）**只认 `AVCA_APP_HOME`**，默认 `%APPDATA%\A` = C 盘；一旦指过就整份跟着走，是刻意的 | `main/services/paths.ts:47-110` |
| 15 | 抽取根落 C: 是**硬错误** `err.extractOnSystemDrive`；库内也是硬错误；空间闸门要 `max(需要×2, 2GB)` | `main/import/extractRoot.ts:128-150` |
| 16 | 已有"收编一个已经存在的库"这条路，但入口很深：设置 → 维护 → 扫描库 → 重新登记，且文档要他**先关「高置信度自动归档」** | `README.md:198-214` |
| 17 | `onboardingDone` 有字段有默认值、**应用代码零读写**；三个活体夹具都在写 `true` | `grep -rn onboardingDone src/ tools/` |
| 18 | 主进程读不到渲染层 bundle，i18n 三语走 `extraResources`；加 `wizard.` 这个命名空间必须同时改 `tests/renderer/i18n.spec.ts:35` 的 `KEY_LITERAL_RE` | `services/paths.ts:160`、`electron-builder.yml:36-43` |
| 19 | 新增 IPC 通道必须进 preload 白名单，否则 `tests/renderer/ipc-channels.spec.ts` 红 | `shared/ipc.ts`、`preload/index.ts:128` |
| 20 | 未验证：以上 20 条都是**读源码**得到的；本设计**没有做过一次真机首启实验**（今天还没有"全新安装"这条路可跑，见 §6.2） | — |

---

## 2. 现状盘点：规格那几条到底有还是没有

| 规格条目 | 现状 | 缺的是哪一米 |
|---|---|---|
| ① 选库位置 | 有设置项、有目录选择器（`Settings.tsx:181-200`） | 缺"第一次必须有人问"、缺选完之后的**探测与接管**（§3.3）、缺 `libraryRootOrThrow` 真正被用上 |
| ② 选素材来源目录 | 有 `watchedFolders` + chokidar + `ListEditor` | 缺首启时那一次问话；缺"这一步可以先跳过、之后在设置 → 集成里补"的口径 |
| ③ 安装 Unity 桥接（可跳过） | 有单工程三按钮弹窗 + `bridgeAutoInstall` + 心跳/锁文件/WMI 三路 | 缺"一批工程一屏问完"（第 2 轮实测连问 8 次）；缺**跳过之后**的补装入口（现在只能等下次边沿再问） |
| 密码 `safeStorage` | 完全没有 | §3.8 那三档，等你裁 Q7 |
| 「任何功能最多两步可达」 | 基本成立 | 向导别把它做成七步 |

---

## 3. 十问详解

### 3.1 向导为什么值得单独一个里程碑，而不是"设置页置顶提示"

因为 `libraryRoot === null` 的时候**产品是坏的**：拖进去只会报错，而报错文案在指向设置页，
设置页有 7 个 tab。规格要的是"装上就能用"。第二类价值是把 §2 里那三个"第一次"（库位置 / 来源目录 / 桥接）
和攒下来的四条体验欠账一次收完，免得每台新机器都要撞一遍。

### 3.2 门禁怎么实现（不引 router）

不装 react-router、不做路由守卫。`App.tsx` 现在是无条件渲染，改成：

```
const gate = wizardGate({ onboardingDone, onboardingStep, libraryRoot, booted })   // 纯函数，shared
gate === 'wizard' ? <FirstRunWizard/> : <主界面>
```

- `wizardGate` 只认这几个输入，**判据只写一处**（这条是被 verify-red 反复钉过的规矩）。
- "稍后配置"不写 `onboardingDone=true`，写 `onboardingSkippedAt`（新键），下次启动不再拦、
  但侧栏留一条"库还没配好"的入口 —— 关掉向导不能等于"假装配完了"。
- 主进程侧的硬约束跟着补上：把 `libraryRootOrThrow()` 真的接到摄取/归档入口（今天它 0 调用），
  并给这条补一条用例 + 一个变异。向导不是靠 UI 拦，靠的就是这个函数。

### 3.3 第 ① 步：选库位置，以及"选到一个已经有东西的目录"

规格说"选库位置"，没说选到已有库怎么办。你这边恰好是**已经有一个 24.3 GB / 2289 个文件的 `E:\vrc\A`**，
所以这一步的形状必须是：

1. 选目录（`system:pick-directory` 已有）；
2. 只读探测：顶层目录数、受支持扩展名文件数、盘符、剩余空间（`freeBytesOf` 已有）；
3. 探测结果像"已有素材" → 当场二选一：
   - **接管**：只登记不搬盘 —— 走已有的那条路（维护 → 扫描库 → 重新登记），并**在这一屏就把
     「高置信度自动归档」关成 false**（README §收编 第一条就是这个要求，让它成为向导里的显式状态而不是文档里的一句话）；
   - **建空库**：不碰这些文件，之后的新东西按模板往里归档（可能和旧结构混排，界面写清）。
4. 探测结果不像有素材 → 直接建。

红线跟着写：接管**不许**默认搬文件、不许默认解压；删除一律走回收站；这一步只读。
（`E:\vrc\A` 上真搬那一次仍然等你点头，和这个向导无关。）

### 3.4 第 ② 步：素材来源目录

就是 `watchedFolders`，外加一句"也可以先跳过，拖放和右键菜单照常用"。
不在这一步做扫描（扫描是摄取队列的事，慢，会把向导拖成进度条）。

### 3.5 第 ③ 步：桥接安装

发现工程列表（ALCOM 清单 + `projectRoots` 扫盘，都已实现）→ **一屏列出 N 个工程，勾选要装哪些** →
逐工程只写 `Packages/`（`installBridge` 已有，重复安装不覆盖的语义已有）。跳过的那一步给补装入口：
设置 → Unity 里一个「扫描工程并安装桥接」的按钮（今天没有；现在只能等下次"发现/运行"边沿再弹）。

**不改判据**：`bridgeAskDecision` / `bridgeAsk:<id>` / 三路运行状态一行都不动。
向导里答"装"的，落的就是和弹窗答"安装"同一个值；答"以后都自动安装"的落 `"always"`。
第 5 轮刚验过：`"always"` 活得过进程重启，第二次按路径命中、静默装、不再弹窗 —— 那正是这一屏想要的结果。

### 3.6 N 个弹窗怎么收（第 2 轮实测连问 8 次）

三条路，我建议 (甲)+(乙) 并用：

- **甲（向导里一次问完）**：全新安装第一次发现一批工程 → 在向导第 ③ 步一屏多选（§3.5）。
  代价最低，因为它用的是已经验过的写入路径，只是换了个收集答案的地方。
- **乙（运行期给一个"剩下这些都不再问"）**：队列里 `waiting > 1` 时，弹窗底部多一个
  「剩下 N 个都不再问」。它给每个仍在队列里的 projectId 各写一行 `"never"`，
  **判据一行不改**（不引入"全局静音"那种第二个真相来源）。
- 丙（把队列改成一次问全部、逐工程折叠）：改动最大，会碰到第 5 轮才验完的那条边沿/队列时序，**不推荐**。

### 3.7 第 ④ 步（收尾）：常驻托盘 + 热键

把 `shouldAskAutoLaunch` 的"先看见过 Unity 启动"这个前置去掉，改成向导收尾直接问：
「A 要常驻托盘才能在 Unity 启动时自动切集合，允许它开机自启吗？」答否 → `autoLaunch:false` 照旧、
`autoLaunchAsked:true`，设置里随时改。这样第 5 轮那张"模态叠在判据截图上"的屏就不存在了，
`AutoLaunchAsk.tsx` 可以从全局模态降级成"向导里的一步"（保留组件，判据改一行）。

热键这一项今天有默认值 `Ctrl+Alt+A`、有设置页 —— 我建议**只在收尾那一屏展示，不让改**
（改了要重注册，失败面大；想改的在设置里改）。

### 3.8 密码保管：三档，等你裁（Q7）

- **甲（我建议）**：`Inbox.tsx` 那个输入框旁加一个「记住这个密码」勾选 → `safeStorage.encryptString()`
  → 写进已有但没人用的 `password_vault`（按 `item_id` = 包文件哈希或 Booth id 存，`author`/`hint` 现成列）；
  下次遇到同一个加密包不再二次问；设置 → 库 里给一个"已记住 N 个密码"的列表，能逐条删。
  **只在主进程加解密**（渲染进程拿不到密文也拿不到明文）。
- **乙（甲 + 顺手修命令行泄露）**：`sevenZip.ts:251` 现在是 `-p<明文>`，同机任何用户 `wmic process` 就能看见。
  改法是把它换成 7z 的 stdin/参数文件那条路 —— 我没验证过 `7za.exe` 在这台机器上支持哪种免命令行传法，
  **要试出来才知道代价**（未验证）。收益：同机其他进程看不到明文；风险：改的是解压主链路。
- **丙**：M7 不碰密码这件事，向导里也不出现（保持"重启后重新问一次"）。
  代价：规格 §7 那句「密码库用 safeStorage 加密存储，不明文落盘」继续是空白。

我推荐**甲**：它把规格那条硬要求做到、且只加一条新链路；乙 单独立一件（它属于安全加固，不属于首启）。
另有一条必须如实写：Windows 上 `safeStorage` 走 DPAPI，**绑定当前用户/当前机器** ——
换机、换 Windows 用户、重装系统之后读不回来，那不是 bug，是这台机器给的保证的边界；界面要照实说。

### 3.9 向导会不会把"任何功能最多两步可达"变坏

不会：向导只在 `libraryRoot` 为空且没走完/没跳过时出现一次；走完即消失，主界面路径一步没变。
真正要防的是把向导做成"第二个设置页"，所以 §3.2 规定它每步只问一件事、其余一律留在设置页。

### 3.10 明确不做

代码签名（这台机器的硬约束：`signAndEditExecutable:false`）、`Setup.exe` 覆盖安装的实测（第 8 轮）、
运行时目录迁移（见 Q5，等你裁）、GUID 增量索引与 `bridgeVersion 1.1.0`（要改 C#，Q12）、
LLM 兜底 §5.5、F11 那句"重命名库目录以匹配当前语言"的按钮。

---

## 4. 数据流（一图）

```
第一次启动
   │
   ├─ initAppPaths()  → P.root() = %APPDATA%\A（C 盘，见 Q5）    db / staging / thumbs / backups / logs / settings
   ├─ initSettings()  → libraryRoot=null, onboardingDone=false
   │
   └─ wizardGate(…) = 'wizard'
          │
   ①库位置 ─选目录→ 只读探测(顶层数/文件数/盘符/剩余空间) ─→ 已有素材? ──是──→ 二选一：接管(关自动归档, 只登记) / 建空库
          │                                                   └─否→ 直接建
          └─ 写 libraryRoot（**不迁移、不搬盘**）
   ②来源目录 ─→ watchedFolders[]（可跳过）
   ③桥接     ─→ 工程清单(ALCOM+扫盘) ─→ 一屏多选 ─→ 逐工程 installBridge() 只写 Packages/
                    答"装"→ 不写 setting / 答"以后都自动"→ "always" / 答"不"→ "never"   ← 与运行期弹窗同一套值
   ④收尾     ─→ autoLaunch(true|false) + autoLaunchAsked:true + 展示热键
          │
          └─ onboardingDone=true  → 主界面
   （中途「稍后配置」→ onboardingSkippedAt，不写 onboardingDone；侧栏留一条入口）
```

---

## 5. 需要新增 / 修改的文件（预估，第 7 轮照这张表落地）

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/shared/wizardState.ts` | 新增 | 全部判据：`wizardGate` / `stepOf` / `canLeaveStep` / `summaryLines` / `adoptOrFresh`。纯函数，无 electron |
| `src/renderer/components/FirstRunWizard.tsx` | 新增 | 薄壳：把 `wizardState` 的结果画出来，只做映射 |
| `src/renderer/App.tsx` | 改 | 按 `wizardGate` 二选一渲染；`AutoLaunchAsk` 从全局模态移进收尾步 |
| `src/main/services/settings.ts` | 改 | `libraryRootOrThrow()` 接上；写库根时不做迁移（现状保持，注释写明） |
| `src/main/ingest/api.ts` | 改 | 那两处各写一句「还没设置库根」的错误 → 统一走 `libraryRootOrThrow` |
| `src/main/project/api.ts` + `main/bridge/askQueue.ts` | 改 | 乙方案：给队列里剩余项各写一行 `"never"` 的一个批量入口（判据不动） |
| `src/main/ipc/wizard.ts`（或并入 `ipc/settings.ts`） | 新增/改 | `wizard:probe-directory`（只读探测）、`wizard:finish`、`wizard:skip`、`wizard:adopt-scan` |
| `src/shared/types.ts` + `settingsDefaults.ts` | 改 | `onboardingStep:number`、`onboardingSkippedAt:string|null`；**不动 schema**（这些走 electron-store，不是 SQLite） |
| `src/main/services/secrets.ts` | 新增（Q7 选甲/乙时） | `safeStorage` 加解密 + `password_vault` 的读写仓储；渲染层不碰明文 |
| `src/renderer/pages/Inbox.tsx` | 改 | 「记住这个密码」勾选 + 命中已记住时不再问 |
| `src/renderer/i18n/{zh-CN,en,ja}.json` | 改 | 新 `wizard.` 命名空间（三语齐；`tools/add-i18n-keys.cjs` 打补丁） |
| `tests/renderer/i18n.spec.ts` | 改 | `KEY_LITERAL_RE` 加 `wizard` |
| `tests/shared/wizard-state.spec.ts` | 新增 | 门禁/步骤/跳过/接管判据（预计 20+ 条） |
| `tests/services/library-root-guard.spec.ts` | 新增 | 没库根时摄取与归档必须抛，且**只有这一处**抛（钉 `libraryRootOrThrow` 真被调） |
| `tests/services/secrets.spec.ts` + `secrets-wiring.spec.ts` | 实做（Q7 甲） | 设计里原本写的是 `tests/db/password-vault.spec.ts`；实际拆成"服务层判据（含加解密器可注入）+ 接线/日志不泄露明文"两份，DPAPI 不可用时**什么都不写**那条在 12 项里 |
| `tools/verify-red-m7.cjs` | 新增（⑦） | 29 处变异，清单见 §6.1 末与文件头 |
| `tools/live-m7-packaged.cjs` | 新增（⑧） | 设计里原本写的是 `tools/live-m7-first-run.cjs`；实做只起**打包版** exe，四场 `launch`/`password`/`skip`/`asks`，见 §6.2 那张表 |

---

## 6. 测试清单

### 6.1 离线（vitest，node 环境，零 DOM）

判据全在 `shared/wizardState.ts`，至少覆盖：首次/已完成/已跳过三态门禁；`libraryRoot` 为空时**不许**进步骤 ②；
探测目录"像已有库"与"空目录"的分支；`adoptOrFresh` 的默认值必须是**接管=只登记不搬盘**；
收尾步答"否"之后 `autoLaunch:false` 且 `autoLaunchAsked:true`；桥接批量"都不再问"给每个 id 各写一行、
且**不新增任何全局静音标志**；`wizard:finish` 幂等（重复点不重复写）。

`tools/verify-red-m7.cjs` 打算钉的变异（每条写完都要**先回退确认会红**）：
`wizardGate` 只看 `onboardingDone` 不看 `libraryRoot`（配到一半就放人进主界面）、
`adoptOrFresh` 默认改成"自动归档"（第一次就把他 24 GB 的库搬了）、
"都不再问"改成写一个全局标志（判据出现第二个真相来源）、
`libraryRootOrThrow` 又被绕过（错误文案各写各的）、
safeStorage 加密失败时退回明文落盘（**最坏的一条，必须钉**）。

覆盖表：`tests/spec-coverage.spec.ts` 加 `M7_RULES` 一节（沿用 `{id, what, impl[], test[]}`，
文件不存在就红），并把 §8 的每条裁定落成一行。

### 6.2 必须真机（第 7 轮末，打包版，全新安装模拟）

今天**没有任何一次真机首启跑过**（事实基线第 20 条），所以这批一条都不能省：

1. `dist\win-unpacked\Atrium.exe` + 一个**空**的 `AVCA_APP_HOME` 沙盒 → 第一次打开必须落在向导第 ① 步；
2. 第 ① 步指到一棵 `tools/make-reclaim-tree.cjs` 造的"已有素材"树 → 出现接管/建空库二选一，
   选接管之后**磁盘上一个文件都没动**、全部进待确认；
3. 沙盒里放 3 个假工程（`fake-unity-live.cjs` 心跳）→ 第 ③ 步一屏列 3 个、勾 2 个 → 只有那 2 个的
   `Packages/` 多出 3 个文件，第三个不动盘；
4. 走完之后重启进程 → **不再出现向导**；答"稍后配置"再重启 → 不再拦，但侧栏那条入口还在；
5. 加密包：记住密码 → 重启 → 同一个包不再问（选甲/乙时）；把 `password_vault` 那行删掉 → 重新问；
6. 第 2 轮那条"连问 8 次"的复现路径重跑一次 → 全新安装第一批工程**一次问完**。

活体红线照旧：`AVCA_APP_HOME` + `LOCALAPPDATA` 双重定向、路径里没有 `avca`/`sandbox` 就拒绝启动、
**起实例之前先确认他的 Unity 没开着**、真库 `E:\vrc\A` 只读。

---

## 7. 风险点（按"能造成多大破坏"排，不按概率）

1. **第 ① 步把已有库当空库、或自动归档搬盘** —— 后果是他 24.3 GB 的目录结构被重排。
   对策：接管分支默认"只登记不搬盘" + 把自动归档关掉这个动作**在屏幕上写明白**，并由 §6.1 那条变异钉住默认值。
2. **safeStorage 不可用时退回明文落盘** —— 后果比没做更坏（密码躺在明文文件里）。
   对策：加解密失败就**不存**、如实说"这台机器上存不了，下次还会问"，并有变异钉这一条。
3. **桥接那一步是"第一次往他 8 个工程目录里写文件"** —— 只写 `Packages/`（`installBridge` 已是这个语义），
   且必须逐条列出目标路径；不装未勾选的工程。删除走回收站这条同样适用（虽然这一步不删）。
4. **门禁判据写歪**：`libraryRoot` 为空却放人进主界面 = 用户拖文件只会拿到报错，比向导更烦；
   反过来把已配好的老用户挡在向导里 = 升级后打不开自己的库（第 3 轮那个"升级即丢"的同类错误）。
   对策：门禁只认 `wizardGate` 一处；老用户（`libraryRoot` 已存在且非空）直接跳过向导，并写一条用例。
5. **`onboardingDone` 复用带来的语义漂移**：三个活体夹具已经在写它。实现之后这些夹具的
   `onboardingDone:true` 必须继续等于"别再拦我"，否则一堆老活体会第一次撞上向导而变红 —— 那是夹具的错，不是产品的错，
   要一次改齐。
6. **模态叠屏**：第 5 轮实测到 `AutoLaunchAsk` 和别的判据叠同一屏。收尾步之后如果 `sawUnityStart` 那条判据还留着，
   它会再问一次 → 必须让"走完向导"这一件事把两个问题都结掉（一条 `autoLaunchAsked` 就够）。
7. **关窗即丢**：向导开着时点 X 是缩托盘（`minimizeToTray:true`），用户可能以为"配完了"。
   对策：向导期间 X 的行为与文案要明说（是"稍后配置"还是"最小化"），别让一个模态自己决定语义。
8. **i18n 三语与打包**：新命名空间忘改 `KEY_LITERAL_RE` 或忘发 `extraResources` 的坑在第 2 轮真撞过（托盘文案 ENOENT）。
9. **抢前台**（呼应第 5 轮那条口径）：向导第一次弹出来时必须真的能被看见。全新安装是"用户自己在装自己启动"，
   `app.focus()` 在这条路上够用；运行期那一次唤醒**不**抢焦点（Q6）。

---

## 8. 需要他裁定的问题（每条一个推荐，逐条批就行）

> **2026-10-08 已批**：「全都同意，有分支的地方按你自己的想法开发」—— 十二条全按推荐档走，
> 有甲/乙分支的那几条选了哪一档与理由记在 §10 开头。这张表留着当实现依据，别再照它重开讨论。

| # | 问题 | 选项 | 我的推荐 |
|---|---|---|---|
| **Q1** | 首启判据用什么 | 甲 复用 `onboardingDone` + 新增 `onboardingStep`/`onboardingSkippedAt`（都在 electron-store，不动 schema）／乙 建一张 `onboarding` 表 | **甲**。字段已经在、夹具已经在写，SQLite 不该为三个布尔开一列 |
| **Q2** | 老用户升级后会不会被向导拦住 | 甲 `libraryRoot` 非空即视为已配置，直接跳过／乙 仍弹一次"欢迎升级" | **甲**。第 3 轮那条教训：别在升级路径上加东西 |
| **Q3** | 第 ① 步选到"已经有素材的目录" | 甲 当场二选一（接管=只登记不搬盘 / 建空库）／乙 一律只建空库，接管继续走设置页 | **甲**。`E:\vrc\A` 就是这种情况，而且接管那条已经实现、只差入口 |
| **Q4** | C 盘要不要硬拦 | 甲 库根只**警告**不拦（红字 + 剩余空间）／乙 和抽取根一样硬错误／丙 完全不说 | **甲**。抽取根那条硬拦有客观理由（要 2 倍余量、写完 Unity 还要写），库根没这个理由；小白的库就在 C 盘 |
| **Q5** | 运行时目录（db/staging/thumbs/backups/logs）默认在 C 盘，要不要在向导里给他换 | 甲 向导里如实显示位置和占用，**不提供搬迁**（搬迁 = 迁库，风险大）／乙 提供"迁到别的盘"，做法是首启时写好一个 `appHome` 记录并重启一次 ／ 丙 不提 | **乙，但只在首启**。你现在 C 盘紧张是实测事实；只在"还没有任何数据"的那一次搬迁，风险接近 0，走的就是已经验过的 `AVCA_APP_HOME` 那条重定向。第 8 轮之前不能碰"已有数据搬家" |
| **Q6** | 唤醒到底要不要抢焦点（第 5 轮实测：置顶 1185ms 真生效、前台 0/127） | 甲 保持现状，验收口径写"置顶 1.2 秒、不动焦点"／乙 用 `AttachThreadInput` 那一类真抢 | **甲**。R-51 早就裁过"检测到 Unity 就抢焦点是骚扰"；抢回来只是把打断从"看得见"升级成"打字被打断" |
| **Q7** | 密码做到哪一档 | 甲 safeStorage + 「记住这个密码」+ 能删的列表／乙 甲 + 修 `-p` 命令行泄露／丙 本轮不碰 | **甲**。乙 那条我得先在这台机器上试出 7z 支持的免命令行传法（未验证），单独立一件更干净 |
| **Q8** | 步数 | 甲 3 步 + 1 收尾（托盘/热键）／乙 严格 3 步，托盘那一问继续留在运行期／丙 全部塞进步骤（含存储模式、模板、置信度阈值） | **甲**。丙 会变成第二个设置页；乙 会让第 5 轮那张叠屏图继续存在 |
| **Q9** | 第 ③ 步的默认勾选 | 甲 全不勾（用户自己点）／乙 全勾（可逐个取消）／丙 只勾"运行中的" | **乙**。规格要的是"装上就能用"，全勾 + 显式列出目标路径，比让人挨个点省事；风险由 §7.3 那条"逐条列路径"兜 |
| **Q10** | 运行期那个"剩下 N 个都不再问" | 甲 加（每行仍写各自 `bridgeAsk:<id>="never"`）／乙 不加，只在向导里解决 | **甲**。全新安装收进向导之后，"后来新增的第二个工程"仍会一次冒一批（`E:\ALCOMprojects` 真机第一轮就是 8 个） |
| **Q11** | 多批导入只能撤最后那批（#74） | 甲 结果卡列出"本轮 N 批"、每批一个退回按钮／乙 在详情面板反查块里给入口／丙 撤掉 `batch_id` 形状改成"一轮一个 id"／丁 先不做 | **甲**。`batch_id` 一批一条是 M5-B ④ 定的账目形状，第 4 轮刚验过，不该动；缺的只是入口 |
| **Q12** | 桥接 C# 那两条欠账（#75：撤销留空目录 `.meta` + `bridgeVersion 1.1.0`） | 甲 M7 里一起做（改 `AVCABridge.cs` 两处 + 重装桥接）／乙 排在第 8 轮之后单独一轮／丙 不做 | **乙**。它要改 C# + 重装 8 个工程的桥接，和第 6/7 轮的"首启体验"是两件事；混做会让向导的活体验收多出 8 个真工程这个变量 |

> 顺带一句不用裁的：`docs/M6-DESIGN.md` 里 Q3 你拍过「`autoLaunch` 保持 false、不擅自写启动项」——
> 上面 Q8 的收尾步不改这条结论，只是把"问"这件事从运行期挪进向导，默认值仍然是 false。

---

## 9. 一句话交付顺序

第 7 轮按这个顺序做，每个检查点报一次并附截图：

① `shared/wizardState.ts` + 用例（先只有判据，屏幕不动）→ ② `libraryRootOrThrow` 接上摄取/归档 + 那条"只有这一处抛"的用例
→ ③ 向导壳 + 第 ① 步（含只读探测与接管分支）→ ④ 第 ②③ 步（批量桥接安装 + 乙 那条"都不再问"）
→ ⑤ 第 ④ 步收尾（`AutoLaunchAsk` 降级）→ ⑥ 密码（Q7 选甲才做：`secrets.ts` + `password_vault` + 输入框）
→ ⑦ i18n 三语 + 覆盖表 + `verify-red-m7` → ⑧ 真机首启六条（§6.2）→ ⑨ 文档与 README 改写。

---

## 10. 落地记录（第 7 轮回填）

**裁定（2026-10-08 他：「全都同意，有分支的地方按你自己的想法开发」）**：Q1 甲 / Q2 甲 / Q3 甲 / Q4 甲 /
Q5 乙（只在首启那次能搬，本轮还没做）/ Q6 甲 / Q7 甲（乙单独立一件）/ Q8 甲 / Q9 乙 / Q10 甲 / Q11 甲 / Q12 乙。

### ①③ 已落地（2026-10-09）

`shared/wizardState.ts`（判据）+ `tests/shared/wizard-state.spec.ts`（36 条）+
`tests/services/library-root-guard.spec.ts`（7 条）+ `system:probe-directory`（只读探测）+
`FirstRunWizard.tsx` 四步 + `stores/ui.ts` 的 wizard 那一段 + 三语 `wizard.` 命名空间（56 条）。
变异检查：`wizardState` 8 处逐条打回旧写法，每处都有用例红（① 当时用临时脚本跑的，**⑦ 已正式收进
`tools/verify-red-m7.cjs`**：A 组 6 处 + B 组 8 处 = 门禁与第 ① 步那 14 处，全表 29 处）。

### 活体第一次真跑就抓到的两条（都不是"没写"，是"写错了"）

1. **向导在第 ① 步之后自己关掉自己。** 门禁原判的是"当前 `libraryRoot` 空不空"，
   而 `patchSettings({libraryRoot})` 会**再 boot 一次** → 库根一落，判据立刻变成"老用户"，
   用户点完「接管这个库」的同一瞬间直接落到主界面，第 ②③④ 步永远走不到。
   改法：门禁改判 **`startedHere`（本次启动时库根是不是空的）**，且这个值只在第一次 boot 算、
   之后不许改口（`wizardStartedHere: get().wizardStartedHere || startedHereFrom(...)`）。
   这条恰好是 §7 风险 4 写的那个方向的**反面**（我防了"老用户被拦"，没防"新用户被放走"），
   用例 ⭐「第 ① 步刚落库根、向导还没走完 → 必须继续画」钉住。
2. **摘要里"接管"被标成「会动磁盘」。** 卡片上明写"一个文件都不搬、不改名"，摘要再标一次就是自相矛盾 ——
   接管只写设置。`summaryLines` 的 `touchesDisk` 现在只有"装了桥接"那条为真。
   另外热键那行原本照抄 accelerator 原文 `CommandOrControl+Alt+A`，界面上是 `Ctrl+Alt+A`（注册用的契约串不改）。

### §6.2 六条 —— **⑧ 已在打包版上全部跑完**（`dist\win-unpacked\Atrium.exe`，沙盒 `D:\avca-m7-live`）

| 条 | dev 版（③④ 跑的） | **打包版（⑧ `tools/live-m7-packaged.cjs`）** |
|---|---|---|
| 1 第一次打开落在第 ① 步 | ✅ | ✅ `--stage=launch`：空 `AVCA_APP_HOME` 起来就是向导，而且这一刻屏上**找不到主界面**（首屏请求的是 `?view=main`，被门禁压住） |
| 2 指到"已有素材"的树 → 二选一，接管不动盘 | ✅ | ✅ 探测报「顶层目录 4 个 / A 吃得下的文件 4 个 / 剩余 12.2 GB」+ 橙色「不到 20 GB」警告；点接管之后**整棵树 4 个文件 md5 逐一相同**，`libraryMode:"adopt"` + `autoArchive:false` |
| 3 三工程一屏勾 2 个 | ✅ | ✅ 默认全勾三个；取消 Gamma 之后**只有 Alpha/Beta** 长出 `Packages/com.avca.bridge`，Gamma 连 `Packages` 目录都没建；新增 6 个文件**全部**在 `Packages/` 下，原有 `Assets/` md5 逐个相同 |
| 4 走完重启不再出现 / 跳过之后不拦但入口还在 | ✅ | ✅ 两场：`launch` 走完 `onboardingDone:true` → 重启直接进主界面；`skip` 点「稍后配置」→ 写的是 `onboardingSkippedAt`（`onboardingDone` 仍 false）+ 侧栏「库还没配好，点这里继续设置」在，重启之后仍在，点它回到向导并把 skip 痕擦成 null |
| 5 真 `-mhe` 包：记住 → 重启 → 不再问 | 🟡 只有单测 | ✅ `--stage=password` 22 条判据全绿：包先自证（对密码过 / 错密码失败 / 不带密码连文件名都列不出来）→ 界面问密码 → 勾「记住」→ 库里恰好一行、48 字节密文、`platform=win-dpapi`、日志不含明文 → **杀进程再起不再问**（日志 `[vault] 用记住的密码重试「secret-pack.7z」`）→ **删掉那行再起又问** |
| 6 一次冒一批工程，问完为止 | 🟡 3 个的形状 | ✅ `--stage=asks` 25 条判据全绿：**8 个**假工程 → 第一条写「另外还有 7 个工程要问」→ 逐条答两条（名字是 Alpha/Beta/Gamma 三个**不同**工程，证明在轮）→ 第三条点「剩下 5 个都不再问」→ 那行和按钮一起消失、屏幕上这条没被替答 → 库里**恰好 8 行** `bridgeAsk:<id>`（八个不同 id、全是 never、没有任何全局静音键）→ 重启之后一条都不弹 |

四场合计 **91 条判据、0 条红**，截图 `docs/screenshots/m7-pkg-01..07*.png`（八张）。
**仍然没走过的那半条**：`Setup.exe` 真装到系统里 + 覆盖安装的升级行为 —— 第 8 轮（本轮测的是 `win-unpacked` 那份免安装产物）。

### ④ 已落地（2026-10-09）：Q10 那颗按钮 + 批量装桥接，顺带又抓到一条真缺陷

新增 `tools/make-m7-live-tree.cjs`（沙盒夹具：3 个假工程 + 一份只列它们的假 VCC 清单 +
一棵"已经有素材"的 `oldlib`；根目录名里没有 `avca`/`m7` 就拒绝执行，因为它会删目录）。

| 项 | 结果 | 凭据 |
|---|---|---|
| 第 ③ 步一屏列出发现的工程、默认全勾（Q9 乙） | ✅ | 假清单被读到时日志 `工程发现：登记 3 个；运行中 0 个`，屏上三行都带 `2022.3.22f1` |
| 勾掉一个再装 → **只有勾的那两个**长出 `Packages/com.avca.bridge/` | ✅ | 盘上 `Alpha`、`Beta` 有 `Editor/ + package.json`；`Gamma` 目录里只有原来的 `Assets` 与 `ProjectSettings`，**没有 `Packages`**；`Assets/` 一字未动 |
| 逐条报目标路径 | ✅ | 结果行 `Alpha-M7LiveTest · 装了 3 个文件 → D:\avca-m7-live\projects\Alpha-M7LiveTest\Packages\com.avca.bridge` |
| 「剩下 N 个都不再问」（Q10 甲） | ✅ | 屏上按钮写 `剩下 2 个都不再问`；点完之后 `setting` 表里**恰好两行** `bridgeAsk:<Betaid>` / `bridgeAsk:<Gammaid>` = `"never"`，**屏幕上这条 Alpha 没有行**，且库里搜不到任何 `muted/silence` 之类的全局键 |
| 点完之后 | ✅ | 弹窗继续问 Alpha（没被顺手替用户答掉），"还有 N 个"那行和按钮一起消失 |

**又抓到一条真缺陷（已修）**：手动装成桥接**不出队**。队列的出队时机原本只有两个
（用户答了 / 自动装成了），第三条路"用户在向导里或「当前工程」页手动装成"漏了 ——
活体里表现为：向导给两个工程装完桥接、走完，弹窗照旧问「这个工程还没装 A 的桥接」。
修法：`unity:install-bridge` 成功分支里补 `dropBridgeAsk(id)`，渲染层同时补一个
`settleBridgeAsk(projectId)` 摘当前这一屏的本地队列（向导与「当前工程」页两条路都接了）。
复验：点弹窗的「安装」→ Alpha 长出 `Packages/`、弹窗消失，**整页刷新之后也不再回来问**。

### 一条环境坑（本轮撞了两次，写下来）

`npm run dev:debug` 会把 `better-sqlite3` 换成 **Electron ABI(130)**，而 dev 实例**占着那个 .node 文件**：
实例还开着时跑 `npm run native:node` 会**静默失败**（打印一句"若镜像上没有对应 ABI 的预编译包"就返回），
接着 `vitest` 里整份文件报 `NODE_MODULE_VERSION 130 / requires 137` —— 表现是"18 条用例突然全红"，
看着像产品坏了，其实是 ABI 没换回来。**顺序必须是 `tools/killdev.ps1` → `native:node` → 再跑测试。**

### ⑤ 已落地（2026-10-09）：侧栏口子 + 一条环境护栏；⚠ 外加一次我自己闯的祸（如实记）

| 项 | 结果 | 凭据 |
|---|---|---|
| 「稍后配置」之后侧栏那条"库还没配好"入口（§3.2 承诺的一米） | ✅ | 沙盒活体：点「稍后配置」→ 主界面（不再拦人）+ 侧栏底部虚线橙条出现 + 状态栏「库根目录: 未设置」；点它 → **回到向导第 ① 步**，`onboardingSkippedAt` 被擦成 null、`onboardingDone` 仍是 false |
| 弹窗与向导不叠 | ✅ | `App.tsx` 里门禁早退在 `booted` 与 `view=mini` 之后（有接线用例钉顺序），向导期间那三按钮窗根本不挂载 |
| Q10 那颗按钮长什么样 | ✅ | `docs/screenshots/m7-setup-entry.png` 里同屏看得见：「剩下 2 个都不再问」+ 底下三按钮 |
| **偏离设计 §3.7**：`shouldAskAutoLaunch` 的 `sawUnityStart` 前置**没摘** | 故意的 | 走完向导第 ④ 步之后 `autoLaunchAsked` 已经是 true，那条运行期模态自然不会再出现；而**跳过**向导的人值得在"第一次真的看见 Unity 启动"那一刻被问一次（那时这个问题才有意义）。摘掉前置只会让它在没装 Unity 的机器上白问一次 |

**环境护栏（本轮加的，因为本轮真撞了）**：`tools/dev.cjs` 现在见到 `--remote-debugging-port` 而
`AVCA_APP_HOME` 没设（或路径里没有 `avca`/`sandbox`）就**拒绝启动**并说明原因。
`tools/cdp-eval.cjs` / `tools/cdp-shot.cjs` 每次都会把选中的 page target 的 URL 打在 stderr 上，
截图与求值的证据从此自带"这是哪个实例"。

### ⚠ 2026-10-09 12:13 的一次红线违反（用户的真库被一个未重定向的实例打开过）

我在跑"跳过 → 侧栏入口"这一条时，为了绕开**被 `adb.exe` 占用的 9222 端口**，直接敲了
`node tools/dev.cjs --remote-debugging-port=9233`，**漏了 `AVCA_APP_HOME` 与 `LOCALAPPDATA`**。
那个实例于是打开了真库：日志第一行 `数据库就绪 C:\Users\<你>\AppData\Roaming\A\library.db`，
随后 `工程发现：登记 9 个；运行中 0 个`、`[bridge-ask] 第一次发现「Lime」→ ask`。
**这就是 `services/paths.ts` 头部记过的同一类事故**，而且我这次连"起实例前确认重定向"这一步都没做。

事后只读核过实际写入面（`node:sqlite` readOnly + 文件时间戳）：

| 碰了什么 | 结论 |
|---|---|
| `asset` / `variant` / `asset_tag` / `journal` / `import_log` | **没有新增或改动**（372 / 269 / 212 / 596 / 1，且 `staging` 是空的 —— 那几分钟没有任何摄取） |
| `setting` 表 | **0 行** —— 「第一次发现 Lime → ask」只进了内存队列，没被回答，所以什么都没落库 |
| `project` 表 | **有写**：9 行工程被重新登记/刷新，其中 `Lime` 是新增的一行（`E:\ALCOMprojects\Lime` 是他真实的工程目录，之前就在那儿，只是库里还没登记过） |
| `settings.json` | 被重写了一次，内容只多了三个**默认值**新键（`libraryMode:null` / `onboardingStep:1` / `onboardingSkippedAt:null`），原有值一字未变（`libraryRoot:"E:/vrc/A"`、`autoArchive:false`、`unityExePath` 都在） |
| `logs/main.log`、Electron 自己的 Cache/GPUCache | 追加与常规刷新 |
| **他的 8+1 个工程目录** | **一个字节都没写**：运行中 0 个 → 没有心跳可发、没有 `Temp/AVCABridge` 信箱被写、桥接也没被装（`ask` 没被回答） |

当时悬着的只有一件：**库里多出来的那行 `Lime` 要不要留着** —— 他 2026-10-09 回话「**Lime 不用动**」，
那就留着（它本来就是他真实的工程，只是之前没登记过）。素材数据没有受影响。

### ⑥ 已落地（2026-10-09）：Q7 甲档 · `safeStorage` 记住加密包密码

新增 `services/secrets.ts`（加解密器**可注入**，因为最要紧的三条分支恰恰是"加密不可用"和"解不开"，
不注入就永远测不到）+ `db/repos/passwordVault.ts`（复用那张从 V1 就建好、一直没人读写的 `password_vault`，
**不动 schema**）+ `ipc/secrets.ts` 三条通道 + `PasswordVaultPanel`（设置 → 库）。
摄取链两头接上：撞见要密码时先试记住的那条（`vaultTried` 保证只试一次，错密码不会死循环），
用户重新给密码时清掉这个标志；提交时勾了「记住」才存。

**键 = `pwv1:` + sha256(大小 + 头 64KB) 前 32 位**。理由写在文件头：不用密码就能算、不读全文件、
改名不影响；和查重那套（`hashFile`/`hashSampled`）**故意不是一个键**，别混。

三条硬规矩，各有一条用例钉着；⑦ 之后密码那一组在 `verify-red-m7` 里是**正式在册的 E 组 7 处变异**（E1…E7，全部会红）：

| 规矩 | 用例 | 变异 |
|---|---|---|
| **加密不可用 = 什么都不写**，绝不退回明文落盘 | 「加密不可用 → 库里一行都没有，返回 `unavailable`」 | E1 把那道闸改成 `if (false)` → 红 |
| 库里只存密文；日志与 IPC 都不许带明文 | 「存进去的字节不是明文」「密码本身不进日志」（扫所有 `log.*` 行的插值里不许有 password/plain/saved） | E3 把日志改成带 `${password}` → 红 |
| 解不开就说解不开（DPAPI 绑定当前用户/机器） | 「解不开 → 返回 null 但那行留着」「列表里标 `readable:false`」 | E4 把 `readable` 写死成 `false`（"全都解不开"，噪声掩盖真信号）→ 红 |

另外四处钉的是：E2 空密码也存、E5 `INSERT` 参数次序与列次序错位、E6 密码库的 IPC 没注册、
E7 摄取链不再去**用**记住的密码（"记住"变成只写不读的死功能）。

界面上：默认**不勾**「记住这个密码」（把密码交给这台机器的 DPAPI 得他自己决定），
勾了而机器存不了时会 toast 一句「这台机器上存不了密码（系统加密不可用）—— 密码没有被明文保存」；
设置 → 库 那块面板只列文件名 / 路径 / 能不能解开 + 逐条删除，**永远不显示密码本身**。

**本轮被自己的用例抓到的一条**：`INSERT` 的参数次序按 `(hint, enc, platform, author, itemId)` 写，
而列次序是 `(..., item_id, author)` —— 于是 `item_id` 存成了路径、`author` 存成了键，
`WHERE item_id = ?` 永远查不到，"同一个包覆盖"变成"每次插一条新的"。三条用例当场红了才看见。

**没做（乙档，单独立一件）**：`unpack/sevenZip.ts` 还是命令行 `-p<明文>` 传密码，
同机任何用户 `wmic process` 能看到。改成免命令行传法要先在这台机器上试出 7z 支持哪一种（**未验证**）。

### ⑦ 已落地（2026-10-09）：`verify-red-m7` + `M7_RULES` 对账 + 三语核对

| 项 | 结果 | 凭据 |
|---|---|---|
| M7 回退验证器 | ✅ **29 处变异全部钉住**，基线 103 条全绿，exit 0，跑完 `git status` 干净 | `tools/verify-red-m7.cjs`（A 门禁 6 / B 第①步判据 8 / C 库根闸门 3 / D Q10 与出队 5 / E 密码库 7） |
| 覆盖对账表 | ✅ 新增 `M7_RULES` **42 条**：每条写明实现在哪、用例钉在哪，钉不住的显式标未验证 | `tests/spec-coverage.spec.ts` → `M7：42 条，其中 32 条有自动化测试，未验证 10 条：M7-13 M7-15 M7-17 M7-27 M7-35 M7-36 M7-39 M7-40 M7-41 M7-42` |
| 十二条裁定逐条有落点 | ✅ Q1→M7-01、Q2→M7-02、Q3→M7-09、Q4→M7-11、Q5→M7-15、Q6→M7-25、Q7→M7-28（乙那半在 M7-36）、Q8→M7-08、Q9→M7-17、Q10→M7-19、Q11→M7-41、Q12→M7-42 | 同一份用例里硬断言，少一条就红 |
| **判据层每个导出函数都被用例调用过** | ✅ `wizardState.ts` 17 个导出函数全部被点名（新加 1 条用例补 `stepPatch`） | 这条是本轮新写的检查；上一轮"死设置 / 死服务"吃过亏，写一段没人测的分支比写错更难发现 |
| 三语 | ✅ `wizard` 命名空间 **56 条 × 3 语言**，21 个命名空间 key 数一致（每语 787 条） | `tests/renderer/i18n.spec.ts`；动态拼 key 的写法一律改成全字面量 |
| selfcheck 台账 | ✅ 加了 `verify-red-m7` 与"M7 四十二条在册"两行，退出码 0 | `node tools/selfcheck-r4.cjs` |
| 全量 | ✅ **1365 passed / 9 skipped（106 文件，101 份跑了、5 份按开关跳过）**，双 `tsc`（node + web）零报错 | `npm test`、`npm run typecheck` |
| R4 那张表重跑 | ✅ 基线 353 条全绿 → **42 处变异全部钉住**、exit 0；它按预告在 `resources/lexicon/` 留下一份 `categories.user.json`（J4 变异造的垃圾，不是仓库自带的），已删 | `tools/verify-red-r4.cjs` |

**这一轮被这张表自己抓到的一条**（不是产品，是这张表）：B3 原本一处变异同时 expect 两条用例
（"第 ① 步不能跳" + "②③④ 能跳"），跑出来第一条不红 —— 把 `step !== 1` 改成恒 `false` 只伤得到后者。
判据是**两个方向**就得有**两处变异**：现在 B3 拆掉第 ① 步那道闸（红 3 条）、B8 反过来把 ②③④ 锁死（红 1 条）。
它长得像"用例没覆盖"，其实漏的是口径，所以 `verify-red-m7.cjs` 文件头专门记了这一段。

**跑法上又踩了一次自己的坑**（值得记）：第一次后台跑 `verify-red-m7` 还没结束，我又起了第二次。
两轮同时改 `src/` → 第二轮的基线读到被改脏的文件，报"动手之前就有 1 条是红的"、exit 3 拒绝往下跑。
**这次是那道基线闸救了场**（否则 29 条里有几条会在别人的变异上"假红"，或者反过来"假绿"）。
工具头部本来写着"别和别的重活并行"，本轮把它当成真实约束用了一次：确认成立。

### ⑧ 已落地（2026-10-09）：**打包版**真机首启六条，四场 91 条判据 0 红

新驱动 `tools/live-m7-packaged.cjs`（四场：`launch` / `password` / `skip` / `asks`，也可 `--all`）。
它只起 `dist\win-unpacked\Atrium.exe`，起之前**硬查 asar 比 `src/` 里最新的源码新** —— 旧包测出来的绿没有意义。
上面 §6.2 那张表就是这一场的结果（launch 35 / password 22 / skip 9 / asks 25，合计 91 条判据、0 条红）。

**这一场对用户数据的写入面（跑完之后只读复核过）**：

| 位置 | 结论 |
|---|---|
| `%APPDATA%\A\library.db` | **没动**：还是 2,408,448 字节、mtime 2026-10-05T21:54Z；`asset` 372 / `project` 9 / `journal` 596 / `import_log` 1 / **`setting` 0 行** / **`password_vault` 0 行** |
| `%APPDATA%\A` 整个目录 | ⑧ 那四场（本地 13:41–14:07）期间**没有任何文件的 mtime 落在这个窗口里**（最大的是 04:55Z 那个 `-shm`，是我今天早些时候只读打开真库留下的） |
| `E:\vrc\A` | **没动**：2305 个文件 / 24.32 GB，顶层九个目录 mtime 最新的是 2026-10-05 |
| `E:\ALCOMprojects` 那 8+1 个真工程 | **没动**：一个 `Temp/` 都没有（= 没有桥接信箱被写）、只有 `shinano-Main2` 装着桥接（前几轮留下的）；`Lime/Assets` 的 mtime 是今天 10:33，那是他自己用 Hub 开过那个工程，比我的第一场还早三个小时 |
| 写过的地方 | 只有 `D:\avca-m7-live\`（沙盒）与仓库里的截图 |

**这一场被自己的驱动抓到三条（都不是产品，但都会造成误判，所以记下来）**：

1. **`ej()` 已经解过一层 JSON，别再 `String()` + `JSON.parse` 解第二遍** —— 页面返回数组时 `ej` 给回数组，
   `String(arr)` 变成 `"Alpha-M7LiveTest,Beta…"`，再 parse 当场炸（第一跑死在第 ③ 步）。
2. **日志偏移必须在"投递之前"取**。第一版是投完、轮询完才调 `waitLog`，那时 `[vault] 用记住的密码重试`
   那行早就写进去了、偏移已经越过它 → 报"等不到日志"。屏幕上"不再问密码"其实是过的，
   所以这是**假失败**（比假成功好，但同样会把人带去改一个没坏的东西）。
3. **轮询里"条件一成立就 return"会把要采的证据一起跳过**。`asks` 那两条 `seen.size >= 2` 假失败：
   名字只在"还没轮到"的分支里记，轮到那一轮直接 return true 走人。改成**每轮先记名字再判条件**，
   并把断言加严到"三条弹窗是三个不同的工程"。
   ⚠ 同一条里还留了一道反假绿：先断言"弹窗探针找得到 `role=dialog` 那一块"，
   否则后面那句"队列空了"（判的就是 `NODIALOG`）会恒为真。

**沙盒前置改成自带**：`password` 那一场现在自己走一遍向导配成"**接管** oldlib"（不是建空库）——
`autoArchive=false` 那张卡才停在"等你确认"、**源文件留在原地**，"重启再撞同一个包"才有同一个包可撞；
而且每场自带前置，重跑不会被上一场的库状态（比如已经记着密码）假失败。

**仍然没走过**：`Setup.exe` 真装进系统 + 覆盖安装的升级行为（第 8 轮）；本轮测的是免安装的 `win-unpacked`。

### 本轮欠账（以 ⑧ 为准，别照 ④ 时那份旧清单看）

- ✅ ~~「稍后配置」之后**侧栏那条"库还没配好"的入口还没实现**~~ —— **⑤ 已落地**（`chrome.tsx` 画出来，
  `tests/renderer/wizard-wiring.spec.ts` 钉住"入口 + 擦掉 skip 痕"两段）。这条曾写在本节里是 ④ 时的状态，
  **别再照它重做一遍**。
- ✅ ~~运行期弹窗的「剩下 N 个都不再问」（Q10）~~ —— ④ 落地，对账见 `M7-19`。
- ❌ **Q5 乙没做**（`M7-15`）：首启那一次把运行目录搬到别的盘。现在只做到"如实显示位置和占用"。
- ❌ **Q7 乙没做**（`M7-36`）：`unpack/sevenZip.ts` 仍是命令行 `-p<明文>` 传密码，
  改成免命令行传法要先在这台机器上实测 7z 支持哪一种（未验证）。
- ❌ **Q11 甲没做**（`M7-41` / 任务 #74）：结果卡列"本轮 N 批"、每批一个退回按钮。
  它和向导不同一条链，按裁定排在向导之后单独做。
- ❌ **Q12 乙没做**（`M7-42` / 任务 #75）：桥接 C# 那两条欠账（撤销留空目录的 `.meta` + `bridgeVersion 1.1.0`），
  排在第 8 轮之后单独一轮。
- 🟡 **故意偏离设计 §3.7**：`AutoLaunchAsk` 的 `sawUnityStart` 前置**没摘**，理由见上面 ⑤ 那张表最后一行。

