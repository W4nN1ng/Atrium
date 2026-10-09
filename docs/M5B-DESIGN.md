# M5-B 设计 · 压缩包型容器的成员提取

> **只设计，不写实现。** 十个问题逐条给「结论 / 理由 / 对已有代码的影响 / 不这么做的代价」。
> 所有数字都来自本机实测，复现命令写在 §1。凡是没验过的我都标 **未验证**，不写成"应该可以"。
>
> 前置阅读：`docs/BRIDGE.md`（协议）、`docs/M5A-SPEC-NOTES.md` §5/§6/§10、`docs/CHANGE-REPORT-2026-10-06.md` §7。

---

## 0. 十问十答，先看结论

| # | 问题 | 结论一句话 |
|---|---|---|
| 1 | 真解压还是流式读 | **要落盘，但只落"用户勾中要导的那一个成员"**；zip 用现有 yauzl 流式抽单条，rar/7z 用 `7z x -- <成员>` 定点抽；**永不整包解压** |
| 2 | 落到哪 | 库根的**兄弟目录** `E:\vrc\A__extract\`（设置项 `extractRoot`，强制校验不在库根内、不在 C:）；三层清理 |
| 3 | 嵌套上限 | **只钻一层**：容器 → `.unitypackage`，包里的包不管；分支之前必须 `stat().isFile()`（真库有 2 个"名字叫 .zip 的目录"） |
| 4 | 一个容器 87 个包 | 容器内部视图列成员 + **默认只预勾"和当前工程/模型名匹配的那几个"**，单批上限 8，超了要用户显式确认；不做"一键全导" |
| 5 | 临时文件谁删 | A 侧 `finally` 删 + 启动 prune + 24h 兜底；删失败只记 warn，不抛、不影响导入结论 |
| 6 | 撤销粒度 | 一个成员 = 一条 `import_log` = 一次可撤销；批量撤销按倒序逐条；**临时副本不参与撤销** |
| 7 | 失败/加密/分卷 | 五类结果如实分开报（见 §3.7）；密码沿用摄取那套（会话内、不落盘）；实测 23/23 个 rar 本机可读，但这结论**只在带 `7z.exe+7z.dll` 时成立** |
| 8 | `import_log` 怎么记 | N 条 + 一个 `batch_id`；**必须加三列（V5）**，因为"这次导的是容器里第几个包"是历史事实，事后算不出来 |
| 9 | 跨会话撤销的 GUID | 现有 `created_guids_json` 白名单够用；再加一道"撤销前重解析"确认；**真正缺的是反查**，得靠第 8 问那三列 |
| 10 | 要不要改 `packagesOfAsset` 返回结构 | 要，改成判别联合（`loose` / `archive` / `empty`），`FoundPackage` 带来源；影响 4 个测试文件 + 3 个 i18n（清单见 §5） |

**另有三件 P0 前置缺陷**（本次进场发现，§2），不修就直接开 M5-B 会让"抽取"建在错误的地基上。

---

## 1. 事实基线（本机实测，全部只读）

```bash
node tools/probe-m5b-shape.cjs --deep 200    # 77 张压缩包卡逐个列成员
node tools/probe-dig-nesting.cjs             # 证实嵌套成员的定位 bug
node tools/probe-rar-read.cjs                # 真库全部 .rar 试列
node tools/probe-why-fails.cjs               # 列不出来的那两个到底是什么
```

| 事实 | 数字 |
|---|---|
| C 盘剩余（用户可用） | **12.0 GB**（125 GB 总盘）← 交接文档写"约 14 GB"，又少了 |
| E 盘剩余 | **57.1 GB** |
| 素材库 | `E:\vrc\A`，2304 文件 |
| 磁盘上的压缩包 | zip 280 个 / 11797 MB |
| 磁盘上真实的 `.unitypackage` | **159 个 / 6428 MB** |
| 库（`library.db`，只读） | 372 行；顶层非附属 139 张卡 = 压缩包 77 + 目录/其他 31 + 散装包 31 |
| `package_entry` 表 | **0 行**（规格 §5.1③ 说 GUID 从这读 —— 那张表是空的） |
| 77 张压缩包卡的体积 | 中位 7.6 MB、最大 859.5 MB、合计 5287 MB |
| 里面真的含 `.unitypackage` 的 | **68 / 77 张**，合计 68 个内层包（一张一个，没有一张多包） |
| 内层包在包内的路径深度 | 根下 46 个、子目录下 22 个（最深 2 段） |
| 里面还套着别的压缩包的 | 3 张 |
| 磁盘上的 `.rar` | 23 个，`resources/bin/7z.exe` **23/23 能列**（0 加密、0 失败），其中 19 个含 `.unitypackage` |
| 列不出来的 2 张卡 | `Texture_Package.zip`、`Shinano_Guidance.zip` —— **它们是目录**（`stat().isFile()=false`），里面各有一个真包（24.4 / 27.0 MB）+ 一个同名真 `.zip`（83.2 / 27.1 MB） |
| 最大的单个容器 | `插件道具合集-初音的VRC小店`：575 文件、**87 个 `.unitypackage`**、最深 7 段、最挤的一个目录 17 个包 |
| 现有 dig 的上限 | `DIG_LIMIT=5`（从压缩包抽）、`DIG_LIMIT_STAGED=12`（已解压目录）、`DIG_MAX_BYTES=300 MB` |
| `findPackages(dir, depth=4)` 在那个容器能看见多少 | **80 个**，看不见 7 个 ← 交接说明里"80 个包"这个数就是这么来的，真数是 87 |

### 1.1 一句话读法

真库里"压缩包型容器"的主流形状**不是** 87 个包那种怪兽，而是 **68 张卡、每张里正好一个 `.unitypackage`（套在一层同名目录下）**。
所以 M5-B 的主路是"把那一层挖出来"，副路才是"给 87 个包做选择界面"。设计如果照怪兽优化，主路会被做歪；反过来只做主路，那个容器又永远导不动 —— 两条都要，但**验收用例要以主路为主**。

---

## 2. P0 前置缺陷（本次进场发现，都有实测证据）

### P0-1 嵌套成员根本读不到：抽取按完整路径落盘，读取按 basename 找

```
抽取 unzip.ts:141 → safeJoin(destDir, 完整相对路径)   落在 dest/TS_MaterialPack_1/TS_MaterialPack_1.unitypackage
读取 worker.ts:163 → path.join(dest, path.basename)   找的是 dest/TS_MaterialPack_1.unitypackage
```

实测（`node tools/probe-dig-nesting.cjs`，真包 `TS_MaterialPack_1.zip`）：basename 定位 ✗ 找不到，relPath 定位 ✓ 找得到。
受影响面：**68 个内层包里 22 个（32%）**。

现在这个函数叫 `digUnitypackages`，目的是"读内层包的资产清单喂给分类"，找不到就 `continue`，**一条日志都不留** —— 属于"实现了但没生效"那一类。
M5-B 要抽同一个东西，如果沿用这套定位，**导入会直接指向一个不存在的路径**。

**改法**：抽一个共用的 `extractMembers(archive, members[], dest)`，返回 `Array<{relPath, localPath}>`，调用方**只用返回的 localPath**，不再自己拼。`worker.ts` 与 M5-B 的抽取共用同一函数，杜绝再次漂开。
**回归用例**（照 §7 的纪律，必须验过它会红）：造一个"成员在子目录下"的 zip，把 `safeJoin(destDir, name)` 退回 `safeJoin(destDir, basename)` 时用例要红。

### P0-2 `only` 用前缀匹配，会顺手解出兄弟成员

`unzip.ts:152`：`opts.only.some((p) => name.startsWith(p))`。
只要包里有 `A.pack` 和 `A.package.unitypackage` 这样的兄弟名，勾一个抽两个。
**改法**：`name === p || name.startsWith(p + '/')`（目录前缀要带斜杠）。M5-B 的"只抽用户勾的那一个"直接依赖这条。

### P0-3 "名字叫 .zip 的目录"真库里有 2 个实例

`ARCHIVE_RE.test(path)` 为真但 `stat().isFile()` 为假。所有按扩展名分支的地方（`containerInfoOf` 的压缩包支、`primary.ts` 的 archive 判定、M5-B 的抽取入口）都必须**先看磁盘事实，再看名字**。
顺带：这 2 张卡的 `size_bytes` 记的是 174 MB / 56 MB，而目录下那个真 `.zip` 只有 83 MB / 27 MB —— 说明当年登记的体积是"目录内容之和"，与"压缩包本体"不是一回事。**这条不影响 M5-B，但会影响抽取根目录的空间闸门**，所以要用 `stat` 而不是库里的数字算空间。

### P0-4 目录型容器的成员被深度上限截掉

`findPackages(dir, depth = 4)` 在初音小店只看得见 80 / 87。
**改法**：容器内部视图改成 BFS，上限拆两个常量 —— 段数 `MEMBER_DEPTH_MAX = 8`、总数 `MEMBER_SCAN_MAX = 400`，撞到任何一条都要在界面上**明说**"这里还有 N 个没列出，上限是 X"，不许静默少列。

---

## 3. 十问详解

### 3.1 要不要真解压到磁盘？还是流式读？

**结论：要落盘，但只落"用户勾中、要导的那一个成员"。不整包解压，也不"全程内存流"。**

**理由（三个都是硬事实）**

1. Unity 侧要的是**磁盘路径**：`AssetDatabase.ImportPackage(path, interactive)` 收一个文件路径，不接流。桥接命令 `import_unitypackage` 的 payload 就是 `{path}`（`docs/BRIDGE.md` §4）。
2. A 侧自己也要读它：冲突预扫描走 `parseUnitypackage(packagePath)`（`coordinator.ts:177`），而那函数是**按路径**流式解析 tar.gz 的。
3. 所以"流式"这件事的正确落点是：**抽取过程**流式（yauzl 一条一条 `openReadStream` → 写文件，现有实现已经是这样），**而不是**"让 Unity 从内存里导入"。后者做不到。

**为什么不换 `node-stream-zip`**

上一轮我拿到过"必须用 node-stream-zip 流式抽单 entry，不得整包解压"的口径。语义要求（流式、不整包）**现有 yauzl 实现已经满足**，而换库要重踩三个已经有主的东西：cp932/UTF-8 标志位的文件名解码、`only: []` 不等于"解全部"（真库实测过 39 MB 包解出 933 文件）、以及那个 `yauzl.on('open')` 被 promise 消费掉导致永远卡 70% 的坑（CHANGE-REPORT 甲轨记过）。
**建议：不换库，改成在本文里显式钉住"不得整包解压 + 必须单条流式"这两条语义，并各配一条回归用例**（§8-B 组）。如果仍要换库，那是一独立工务，代价是 `tests/unpack/*` 全部重写，不该塞在 M5-B 里做。

**rar/7z 这一条不一样**：纯 JS 没有 RAR 解码，`7za.exe` 也不带。唯一可行的定点抽取是把成员名交给外部 `7z.exe`：

```
7z x <archive> -o<dest> -y -- <memberRelPath>        # 只解这一个成员
```

这**不是**整包解压，落盘的只有目标成员（`probe-dig-nesting.cjs` 跑的就是这个形状，实测目录里只出现那一个文件）。
代价：多进程启动开销（实测每个约 20–40 ms，可忽略）+ 依赖 `resources/bin/7z.exe + 7z.dll` 随包分发（已经在 `extraResources` 里）。

**不这么做的代价**：整包解压 = 一张卡最多 859 MB、77 张合计 5.3 GB 往盘上摊，C 盘只剩 12 GB，用户会在不知情的情况下把系统盘写满；纯内存流则Unity根本收不到。

---

### 3.2 解压到哪？各自的清理时机

**结论**

```
默认 extractRoot = dirname(libraryRoot) + "\A__extract"     # 库在 E:\vrc\A → E:\vrc\A__extract
成员落地            = <extractRoot>\<assetId>\<seq>\[包内相对路径]\<name>.unitypackage
```

**四条理由**

1. **绝不落 C**：C 盘剩 12 GB，单包就有 653 MB 的。同盘还有一层好处 —— 将来若要做"提取后顺手登记副本"，同盘 rename 是原子的。
2. **不放 `%APPDATA%\A\staging`**：那在 C 盘（`P.staging()`），并且它的生命周期属于"摄取"，导入用它会把两条链的清理逻辑搅在一起。
3. **不放工程的 `Temp/`**：Unity 关就清，而重试/撤销/重开窗口都可能晚于那一次 Tick；跨进程共享更说不清。
4. **不放素材旁边**（`library_path` 同级）：**这条最要紧** —— 往用户库里塞临时目录，会被 `findStrays` 当成游离文件报出来，用户点一次"重新登记"就把 87 个临时包全变成素材。这是 CHANGE-REPORT 里"深度闸门"那条安全规则想防的东西，别自己制造现场。

**硬校验（不合规就禁用功能，不是警告）**

```
isInside(libraryRoot, extractRoot)      → 拒绝，报 err.extractInsideLibrary
normalizeDirKey(extractRoot).drive==='c' → 拒绝，报 err.extractOnSystemDrive
磁盘可用 < max(2 × 该成员体积, 2 GB)      → 抽取前拒绝，报 err.extractNoSpace（显示剩多少、要多少）
```

**清理时机，三层**

| 层 | 谁 | 什么时候 |
|---|---|---|
| 1 | `coordinator` 的 `finally` | 该成员**终态**（ok / error / cancelled）之后立即删它的 `<seq>` 目录 |
| 2 | 启动时 | `pruneExtract()` 清整个 `extractRoot`（对齐现有 `pruneStaging()` —— 任务态不跨重启，开机剩下的必是垃圾） |
| 3 | 兜底 | 第 1 层删失败（杀毒占用、只读）→ 记 `warn` 不抛，交给第 2 层；界面上不报错，用户在"设置 → 维护"里能看到"抽取目录占用 N MB [清理]" |

**注意一个反直觉的点**：导入成功之后**不要立刻删**得太急 —— `parseUnitypackage` 的条目、`created_guids_json` 都已经落库，撤销只依赖这些，不需要文件活着（见 §3.6）。所以"终态即删"是安全的，前提是把 §3.8 那三列补齐。

**不这么做的代价**：临时副本留在 C 盘 → 用户系统盘被一个"我只是想导个包"的操作吃掉几百 MB；留在库里 → 污染真库 + 被误登记。

---

### 3.3 嵌套怎么办？深度上限几层

**结论：只钻一层。** 容器（压缩包 / 目录）→ `.unitypackage`，到此为止。抽出来的 `.unitypackage` **不再往里找包**；容器里其它成员的压缩包也不处理。

```ts
const MEMBER_DEPTH_MAX = 8      // 相对容器根的段数上限（目录树，不是压缩包套压缩包）
const NEST_ARCHIVE_MAX = 1      // 压缩包层数：外层 → 内层包。里面还有 zip 就当没看见
const MEMBER_SCAN_MAX = 400     // 单个容器的成员数硬闸
```

**理由**

1. 实测形状：68 张卡 × 恰好 1 个内层包，段数 1 或 2。"zip 里还有 zip 里还有包"在这台机器上是 **3 张卡**（且它们不是嵌套提取的需求，是"包里带备份副本"的常见脏数据）。
2. 每多钻一层，空间闸门、失败归因、撤销粒度都要翻倍，而收益在真库里是 0。
3. 规格里"读内层 unitypackage"（`02` §1.3）说的是**读它的资产清单喂分类**，不是"把它再解一遍"。这是两件事，别混。
4. **P0-3 的教训直接进这里**：判断"是不是压缩包"必须先 `stat().isFile()`。名字像而事实是目录的，走目录分支（递归找），走不通再报错，绝不对目录起 `7z x`（那 2 张卡就是被这么坑的 —— 我第一版探针也中招，`7z` 对目录会返回一堆误导性的 `Cannot open the file as archive`）。

**界面上怎么说**：撞上限时明写"这个容器里还有 N 个包没列出（上限 400）"或"包里还有压缩包，A 只处理一层"，不许静默少列。

**不这么做的代价**：无限递归 → 一个 859 MB 的 rar 里套 zip 里套 7z，抽取根瞬间爆盘；而且"哪个文件是哪个素材"会在撤销时说不清。

---

### 3.4 一个容器 80（真数 87）个包时，界面长什么样

**先量一遍代价**：87 次串行导入 × 每次冲突预扫描（159 个包全解析一遍）——单次导入在 Play 模式下最坏可以排队 28 分钟（`1+2+5+10+30×56=1698 s`，`BRIDGE.md` §3 的算术）。**"一键全导 87 个"是不负责任的按钮。**

**结论：不做"一键全导"，做"预勾 + 分批"。**

```
容器内部视图（05§B6 那套进入式浏览，不新开页面）
├─ 成员列表（虚拟滚动；一行 = 一个 .unitypackage）
│    名字 · 体积 · 在容器里的路径 · 磁盘/压缩包图标 · [冲突数]
├─ 默认勾选：命中"当前工程指纹 / 集合关键词 / targetAvatars"的那几个
│    一个都没命中 → 谁都不勾，界面上写"A 不替你选，请勾"
├─ 顶部：[勾选 N 个 · 合计 X MB]  [只勾 < 100 MB 的]  [清空]  [导入勾选到 Unity]
└─ 单批上限 IMPORT_BATCH_MAX = 8：勾超过 8 个 → 提示"会分 ⌈N/8⌉ 批，一批一批问你要不要继续"
```

**默认不勾"体积最大的"、不勾"最新的"、不勾"名字最短的"** —— 那些都是我替用户猜。唯一允许的猜测是**名字匹配**，且必须把匹配依据写在行上（"因为工程里有 shinano 才勾上"），用户可以一眼看懂并取消。

**冲突处理不能弹 8 次。** 顺序：整批预扫描 → 一张汇总卡片（列出每条包的冲突数和前 3 个具体路径）→ 用户一次决定"继续 / 继续并备份 / 取消某几条"。规格 §5.1④ 的三选一在"每包"层是硬要求，汇总层不违反它（同一次决定覆盖 N 包，用户看得见每一包的名字和冲突）。

**上限 8 的理由**：一屏能看完、一批失败可控、和现有"一次一条 + 等终态"的串行闸门不打架。87 个包就是 11 批 —— 慢是事实，但**装得比它快是更糟的选项**。

**不这么做的代价**：要么用户被 87 个对话框钉住，要么 A 悄悄替他选了 87 个包往工程里灌。

---

### 3.5 导入后那份临时文件谁删、什么时候删、删失败怎么办

**结论**：见 §3.2 三层。责任明确到**发起抽取的那一层**（`coordinator.importMember()` 的 `finally`），不下沉到 mailbox / 桥接 —— 桥接那边连"这是临时文件"都不知道。

**顺序不能反**：**先拿终态结果，再删文件**。删在拿结果之前会让"结果未知"的命令变成"文件已消失"，再也对不上账。

**删失败**：`warn` + 留给启动 prune，**不影响导入结果的状态字**。绝不能因为临时文件删不掉而把一次成功的导入报成失败（CHANGE-REPORT §4 里 `pruneStaging` 的判断口径就是这个意思）。

**取消**：取消一条命令时也要 release 它的临时目录 —— 对齐 `api.ts` 的 `dropStaging`（那边踩过"任务取消/失败/丢弃卡片时删整个暂存目录，且 dismiss 要先 terminate 再删"，同一个坑）。

**永不 `rm -rf` 用户路径**：`extractRoot` 是 A 自己建的目录，但删除仍走注入的 `trashFn`（和 `pruneBackups` 同一口径），别在代码里开第二套删除方式。

---

### 3.6 撤销导入时临时文件要不要一起清？能不能只撤一个包

**结论两条**

1. **临时文件与撤销无关**：撤销只依赖 `import_log.created_guids_json`（白名单）+ `overwritten_json` / `backup_dir`（还原）。所以 §3.5 里"终态即删"是安全的。反过来说 —— 撤销发生时那个文件**多半已经不存在**，任何"撤销时重新读一遍包"的想法都不成立。
2. **能只撤一个包**：一个成员 = 一条 `import_log`（§3.8），撤销按钮挂在**那一条**上。批量撤销 = 按 `batch_id` 倒序逐条执行，中途某条失败就停下、如实报"3/8 已撤销，第 4 条失败：原因"，不许继续闷头发火，也不许因为一条失败就把已成功的标成"已撤销"。

**撤销的 journal**：`op='import_rollback'`（枚举已有），payload **绝不带 `assetIds`** —— `undoLast` 看到 `assetIds` 会去删资产行（TRIAGE-A 坑 4）。这条要在回归用例里钉住（§8-C 组）。

---

### 3.7 解压失败 / 加密包 / 分卷包怎么向用户交代

**五类结果，各一个 i18n key，不许合成一句"抽取失败"**（主进程只回 key + 参数，中文原文只当兜底 —— 项目铁律）：

| 类型 | 触发 | 界面文案要点 | 能不能重试 |
|---|---|---|---|
| `needPassword` | `PasswordNeededError`（`listArchive` 已有判定） | "这个包要密码" + 输入框 | 输对密码后可重试 |
| `corrupt` | `CorruptArchiveError` / 7z 退出码 2 且无可用清单 | "包可能坏了：7z 报 <原文前 200 字>" | 换 7-Zip/WinRAR 后可试 |
| `noBackend` | 只有 RAR 解码缺失时（`resolveBackend` 探不到 `7z.exe`） | "这台机器上没有能读 RAR 的组件" | 装 7-Zip 后可重试 |
| `notAnArchive` | 名字叫 .zip 但 `stat` 是目录 / magic bytes 不认（M2 就有） | "它其实是个文件夹，不是压缩包" | 走目录分支，不是失败 |
| `volumeMissing` | 分卷（`.r00` / `.part2.rar`）缺卷 | "这是分卷包，缺 <卷名>" | 补齐后可重试 |

**密码这条要不要复用到导入路径？要，而且只是"复用同一个内存保管员"**：

- 密码只在会话内存里（`api.ts` 的 `submitPassword` 那套），按 `archivePath` 键缓存，一个容器多个包共用一把。
- **不落 `password_vault`**：`safeStorage` 全项目 0 处使用（交接文档 §9 与我自己 grep 一致），M5-B 不该顺手开这个口 —— 那是 M7 的独立决定。重启后重问一次，符合"更安全"。

**实测口径要标清楚**：本机 23/23 个 `.rar` 能列，是"这台机器 + `resources/bin/7z.exe + 7z.dll`"这个组合的结论，**不是**"rar 一定可读"。`7za.exe`（`7zip-bin` 自带）不含 RAR 解码器，所以后端探测顺序（bundled → 用户装的 7-Zip → WinRAR）一条都不许动。
分卷：真库实测 `.r00/.part1.rar` 计 0 个 —— 这条是**按规格预防，未在真库遇到**。

---

### 3.8 `import_log` 怎么记？现有 schema 够不够？V4 → V5

**结论：一次容器导入 = N 条 `import_log`（一包一条）+ 同一个 `batch_id`；现有 schema 不够，V5 加三列。**

**不够在哪（具体到列）**：现有列只有 `unitypackage_path` 指向"当时那个文件路径"，而那个路径在 §3.5 之后**必然已不存在**，且它长得像 `E:\vrc\A__extract\01ABC\3\...\x.unitypackage` —— 事后谁也无法从它推出"这是哪个素材的哪个成员"。
（顺带一条已核对的事实：库里**确实没有** `child_count` / `unit_count` 这类列，那些是查询时算的。所以"这次导的是容器里第几个包"目前无处可记。）

**V5（只增列，不建新表，不动老行）**

```sql
ALTER TABLE import_log ADD COLUMN container_asset_id TEXT;  -- 用户点的那张卡（容器或素材）
ALTER TABLE import_log ADD COLUMN member_rel_path    TEXT;  -- 容器内的相对路径；散装包为 NULL
ALTER TABLE import_log ADD COLUMN origin_archive     TEXT;  -- 外层压缩包绝对路径；散装包为 NULL
CREATE INDEX IF NOT EXISTS idx_import_log_container ON import_log(container_asset_id)
  WHERE container_asset_id IS NOT NULL;
```

**为什么是这三列而不是"存一个 JSON blob"**：F8 的反查（"这个素材在哪些工程装过"）和"待复核里显示已导入状态"都要**按容器查**，JSON 查不动，只能全表扫。加三列是一次迁移的成本，不加是每次查询扫全表的成本。

**迁移纪律**（照 V4 的教训）：

1. `MIGRATIONS` 里加 `{version:5, sql}`；`migrate()` 已支持 `post?`（V4 引入的），本条**不需要 post** —— 老行三列 NULL 语义就是"散装包直导"，猜不出也不该猜。
2. `SCHEMA_VERSION = 5`；`tests/real/realdb-migration.spec.ts` 里补一支"真库副本上跑 V5"的用例（只在 `%TEMP%` 副本上跑，跑完核对原库字节数 —— 那是现成的模式）。
3. **`user_version` 一旦 5，任何旧版程序都不要再开这个库**：V5 是纯加列，旧代码读不炸，但写会丢那三列，所以 `docs/BRIDGE.md` §10 的"数据落在哪"里要写明。
4. 老库回滚不留后门：删列在 SQLite 里要重建表，**不做**。

**记什么**（一包一条，字段来源明确）

| 列 | 来源 |
|---|---|
| `project_id` / `batch_id` / `asset_id` | 目标工程 / 本次这批 / 用户点的那张卡（容器 id 或素材 id） |
| `unitypackage_path` | **抽取后的本地路径**（历史事实，不承诺存活） |
| `container_asset_id` `member_rel_path` `origin_archive` | V5 新三列 |
| `created_guids_json` `overwritten_json` | 桥接回包（§6.3 的差集） |
| `status` | `queued → running → ok / failed / cancelled / rolledback`（`error → failed` 的口径映射已在 `BRIDGE.md` §2.3） |
| `kind` | `'import'`（桥接安装的 `'bridge_install'` 是另一支，别混） |

---

### 3.9 撤销"从压缩包里导进来的包"时怎么知道删哪些 GUID？跨会话对得上吗

**结论：对得上，靠的就是 `created_guids_json`；但要再加一道确认。**

- M5-A 已经把它落库（`patchImportLog` 在写），C# 侧的算法是"命令开始前对包内 GUID 逐个 `GUIDToAssetPath` 快照，导入后重查，前空后有 = 新建"（`BRIDGE.md` §4）。**这份白名单与"文件从哪来"无关** —— 压缩包成员也好、散装包也好，落进工程后的 GUID 集合是一样的。所以跨会话撤销不依赖临时文件，天然成立。
- **要加的确认（P1）**：撤销前用 `resolve_guids` 把白名单重解析一遍。三种情况分别处理：
  - 全部能解析且都在 `Assets/` 下 → 正常删。
  - 部分解析不出来（用户自己删过）→ 只删解析得出的那些，并**如实报**"6 个里有 2 个已经不在了"。
  - 有 GUID 指向 `Packages/`、`Library/` 或工程外 → **整条拒绝**（C# 侧的双重校验已经在 `R-65` 钉住了"白名单 + `Assets/` 前缀，任一不满足整条拒绝，不做部分删除"，A 侧这道只是提前把话说清楚，别让 Unity 报回来）。
- **反查**（`R-85`，M5-B 顺带能做的事）：有了 §3.8 的 `container_asset_id`，"这个素材在哪些工程装过"才查得出来 —— 现在只能按 `unitypackage_path` 精确匹配路径，对压缩包成员是死的。
  但**F8 的 GUID 增量索引刷新**（`setProjectGuidIndex`）我建议**留在 M5-B 之外**：它需要"导入完成后把新建 GUID 并进索引"的钩子，而那个索引目前的存法（`setting` 表 `projectGuids:<id>`）在 M5A-SPEC-NOTES Q1 里口径还没定，别在抽取这条链上顺手接。

---

### 3.10 要不要改 `packagesOfAsset` 的返回结构？改了影响哪些测试

**结论：要改，而且这是全套改动里唯一"会红一片"的地方，必须一次改到位、不许在分支里加 `if (kind==='archive') 再说`。**

现状（读代码确认，未改动）：

```ts
interface FoundPackage { path: string; sizeBytes: number }
// coordinator.packagesOfAsset():  FileNotFound → []
//                                   isFile + .unitypackage → [它自己]
//                                   isFile + 其它（=压缩包）→ []        ← 压缩包在这里被吞掉
//                                   isDirectory → findPackages(dir)     ← depth=4，见 P0-4
// bridge/ipc.ts:252 另外返回 { kind:'archive', packages:[], note:'…M5-B 交付' }  ← 诚实降级在那儿
```

**问题**：`FoundPackage` 没有"我从哪个容器的哪个成员来"，一旦支持抽取，下游（`importUnitypackage` / `preflight` / `import_log`）就无从填 §3.8 那三列。所以返回结构必须带来源，`kind` 必须成为判别联合而不是散在各处的分支。

**目标结构（设计，不是实现）**

```ts
export interface PackageOrigin {
  containerAssetId: string          // 用户点的那张卡（容器或素材）
  originArchive: string | null      // 外层压缩包绝对路径；散装/目录型为 null
  memberRelPath: string | null      // 容器内相对路径；散装为 null
  extracted: boolean                // true = 这是个临时副本，导入后要清
}
export interface FoundPackage { path: string; sizeBytes: number; origin: PackageOrigin }

export type PackagesOfAssetResult =
  | { kind: 'loose';   packages: FoundPackage[] }                       // 散装包 + 目录里找到的
  | { kind: 'archive'; packages: FoundPackage[]; noteKey: string }      // 已能定位成员（M5-B 之后不再走 note）
  | { kind: 'empty';   reasonKey: 'noPackage' | 'depthLimit' | 'tooDeep' | 'notArchive' }
```

M5-B 落地后 `archive` 这支的语义从"拒绝"变成"已抽出这些成员"，**`noteKey` 保留**给"包里还有压缩包（一层封顶）""撞扫描上限"这类实话。

**影响清单（改了会红的地方）**

| 文件 | 影响 | 处理 |
|---|---|---|
| `tests/import/coordinator.spec.ts`（26 项） | `packagesOfAsset` 的 5–6 条断言形状变（裸 `{path,sizeBytes}` → 带 `origin`） | 改断言 + 补"成员来源"三条 |
| `tests/bridge/ipc.spec.ts`（26 项） | `packagesOfAsset` IPC 的返回结构；那条"压缩包诚实拒绝"的用例语义翻转 | 改 + 新增"archive 抽出成员"一条 |
| `tests/unpack/unzip*.spec.ts` | P0-1 / P0-2 两处修复各要一条新用例 | 新增 2 条，并**验过回退会红** |
| `tests/spec-coverage.spec.ts`（94 条） | 范围条目要显式改：R-84 / R-85 归属不变（仍 outOfScope），但要为 M5-B 新规则**新开一节 R-95…**，或另立 `M5B` 前缀 | 见 §6 |
| `tests/renderer/i18n.spec.ts` | 新 key 全部三语 | 走 `tools/add-i18n-keys.cjs`，不许主进程回中文 |
| `tests/renderer/ipc-channels.spec.ts` | 若新增 IPC 通道（`unity:extract-member` / 扩展 `unity:packages`） | 三处白名单一起改（preload / `shared/ipc.ts` / handler）—— 这个测试就是为抓"忘了登记"而生的 |
| `src/renderer/stores/ui.ts`（双击导入那条链，第 570/595 行附近） | `multiplePackages` 的文案与"先导第一个"的行为要换成"预勾 + 分批" | 改 + 界面用例 |
| `src/main/ingest/worker.ts` | `digUnitypackages` 改调共用的 `extractMembers`（P0-1） | 改 + 回归 |

**不这么做的代价**：`FoundPackage` 缺来源 → §3.8 那三列填不出来 → 反查、撤销、UI 的"从哪个包里抽的"全都没有依据；而 `kind` 不做成判别联合，`archive` 那支就会继续以"吞掉"的形式存在（现在是返回 `[]`，界面上一句诚实提示，其实是被 `packagesOfAsset` 提前吞了一次）。

---

## 4. 落地形态：数据流（一图）

```
用户双击容器卡 → 进入内部视图（已有）
   │
   ├─ 列成员   listMembersForAsset(asset)                ← 新：共用 extractMembers 的"只列不抽"半边
   │     · stat 事实优先（名字叫 .zip 的目录 → 走目录分支）      ← P0-3
   │     · BFS 上限 depth 8 / count 400，撞线要说，不能静默        ← P0-4
   │     · 只钻一层压缩包                                          ← §3.3
   │
   ├─ 勾选     默认勾"匹配当前工程/集合关键词"的，并写明依据        ← §3.4
   │
   └─ [导入勾选到 Unity]  (N ≤ 8 一批)
         │
         ├─ 1 抽取    extractMembers(archive, picked[], extractRoot/…)   ← P0-1/P0-2 的共用函数
         ├─ 2 空间闸  可用 ≥ max(2×体积, 2GB)，否则整批不开始
         ├─ 3 预扫描  逐包 parseUnitypackage + resolve_guids（分批 2000）
         │             → 一张汇总冲突卡片（每包各自列具体路径 + 三选一）    ← §3.4
         ├─ 4 串行导入 每包一条 import_log（同 batch_id）+ 等终态才下一条     ← R-57 不动
         ├─ 5 记录    created_guids / overwritten / 三列新字段               ← §3.8
         ├─ 6 清理    终态即删 <seq>；失败留 prune                            ← §3.5
         └─ 7 撤销    按条撤（白名单 + Assets/ 前缀 + 重解析确认）             ← §3.9
```

---

## 5. 需要新增 / 修改的文件（预估）

**新增（3 个实现 + 4 个测试）**

| 文件 | 作用 | 估 |
|---|---|---|
| `src/main/unpack/members.ts` | `listMembers(archive)` / `extractMembers(archive, rel[], dest)` 共用层；**返回 localPath**；含 `only` 精确匹配 | ~180 行 |
| `src/main/import/extractRoot.ts` | 路径推导 + 三道硬校验（库内 / C 盘 / 空间）+ `pruneExtract()` | ~120 行 |
| `src/main/import/containerPackages.ts` | 容器成员清单：stat 优先、BFS + 两个上限、只钻一层、"撞线"标记 | ~160 行 |
| `tests/unpack/members.spec.ts` | P0-1 / P0-2 的回归（含"回退会红"两条）+ 真包 fixture | ~120 行 |
| `tests/import/extract-root.spec.ts` | 三条硬校验各一条 + prune + 删失败不抛 | ~90 行 |
| `tests/import/container-packages.spec.ts` | 名字叫 .zip 的目录 / depth 撞线 / 一层封顶 / 87 个成员的闸 | ~140 行 |
| `tests/real/realdb-v5.spec.ts` | 真库副本上跑 V5 + 核对原库字节数（env 门控，照现成模式） | ~70 行 |

**修改（8 处）**：`src/main/db/schema.ts`（V5 + `SCHEMA_VERSION=5`）、`src/main/db/repos/journal.ts`（`insertImportLog` 收三列）、`src/main/import/coordinator.ts`（`FoundPackage.origin`、`importMember`、终态清理）、`src/main/bridge/ipc.ts`（判别联合、去掉 `packagesOfAsset` 吞 archive 那支）、`src/main/ingest/worker.ts`（改调 `extractMembers`）、`src/renderer/stores/ui.ts` + `ImportFlow.tsx`（预勾 + 汇总冲突 + 分批进度）、`src/shared/ipc.ts` + `preload/index.ts`（新通道白名单）、三份 i18n。

**文档**：`docs/BRIDGE.md` 加"成员从哪来"一节（协议没变，但临时文件的归属与生命周期得写）；`docs/M5A-SPEC-NOTES.md` §10 里"M5-B 不做"那几行改状态。

---

## 6. 测试清单（哪些离线、哪些必须真机）

| 组 | 用例 | 离线？ | 怎么证明它"会红" |
|---|---|---|---|
| **A｜P0 修复** | 嵌套成员抽取后 localPath 存在、解析得出条目 | ✓ | 把 `safeJoin(destDir, name)` 退回 basename → 红（我已在真包上手工复现过这个差异） |
| | `only:['A.pack']` 不许带出 `A.package.unitypackage` | ✓ | 把 `===` 退回 `startsWith` → 红 |
| **B｜语义闸门** | 抽取只产生目标成员那一个文件（不整包） | ✓ | 用真 fixture 包 `7z l` 比对目录树；把 `-- <member>` 去掉 → 红（会多几十个文件） |
| | `extractRoot` 在库根内 / 在 C: / 空间不足 → 拒绝且不写盘 | ✓ | 注释掉校验 → 红 |
| **C｜记账** | 一个容器 N 个包 → N 条 import_log、同一个 batch_id、三列填对 | ✓（内存库） | 少填任一列 → 红 |
| | 撤销 payload 不含 `assetIds` | ✓ | 加进去 → 红（这条会连带触发资产行被删，测试要断言行还在） |
| | 跨会话撤销：只喂 `created_guids_json`，`FakeUnity` 回 deleted | ✓ | 把白名单来源改成"重新解析包" → 红（文件已不存在） |
| **D｜界面** | 87 个成员的容器：预勾规则、单批 8、撞上限的提示 | 半（DOM 层可测） | 断言"不勾任何一项时按钮禁用" |
| **E｜必须真 Unity** | 从真 zip 抽出的包，`ImportPackage` 真落地；Play 模式下排队；冲突汇总真显示；撤销真删 | ✗ **未验证** | —— 只能你点。我会先给 `shinano-Main2` 造一个"含单个内层包"的沙盒 zip，别拿真库当小白鼠 |

**跑法**：`npm test`（跑之前 `powershell -File tools/killdev.ps1` 停 A）+ `npm run typecheck`。C# 这条链 M5-B **不改**，所以 `node tools/check-bridge-compile.cjs` 只作为"确认没误伤"的哨兵。

**两条纪律我照抄过来，不当耳旁风**：
- 断言"有没有调用某 API / 顺序对不对"之前先 `stripComments()`（`tests/bridge/protocol-conformance.spec.ts` 有现成的）。
- 改源文件一律用编辑器工具，不碰 PowerShell 的 `Get-Content`/`Set-Content`。

---

## 7. 风险点（按"能造成多大破坏"排，不按概率）

| # | 风险 | 为什么会发生 | 挡它的办法 |
|---|---|---|---|
| R1 | **临时文件落进用户 25 GB 真库** | `extractRoot` 配错 / 默认值推导成库根子目录 → 被 `findStrays` 报成游离文件 → 用户点"重新登记"把几百个临时副本登记成素材 | `isInside(libraryRoot, extractRoot)` **硬拒绝**；UI 上常显"抽取目录：E:\vrc\A__extract（不在库内 ✓）"；再给一条真库副本的回归用例 |
| R2 | **半套导入**：8 个包第 5 个失败，前 4 个已进工程 | 串行导入天生如此 | **不自动回滚** —— 自动删用户工程文件比留着更危险（规格里"永不永久删除"的精神）。做法：如实列出"已成功 4 / 失败 1（原因）/ 未执行 3"，每条单独可撤，整批提供"逐条撤销（倒序）" |
| R3 | **整包解压**被"顺手"写出来 | 7z 少写一个 `-- <成员>` 就是整包；`extractZip` 的 `only` 空数组以前等于"解全部"（有过前科） | P0-2 + 用例 B 组；并在 `extractMembers` 的签名上**强制** `members: string[]` 非空类型（空数组直接抛，不解释成"全部"） |
| R4 | **C 盘被写满**（剩 12.0 GB） | 默认路径没管住 | `extractRoot` 盘符校验 + 空间闸门 + 启动 prune |
| R5 | **同名成员互相覆盖** | 真库实测 `PSD.zip` 这类同名成员出现在不同目录 | localPath 一律用 `<extractRoot>\<assetId>\<seq>\` 命名空间隔开；P0-1 的返回结构让"哪个是哪个"不可能含糊 |
| R6 | **rar 这条链在别的机器上直接废** | 只有 A 自带 `7z.exe+7z.dll` 能读 RAR，`7za.exe` 不行 | 探测顺序不动（bundled → 用户 7-Zip → WinRAR）；探不到时报 `noBackend`，不是报"包坏了" |
| R7 | **87 个包那个容器把主线程/事件循环拖死** | 逐个 `parseUnitypackage` 全解析（159 个包 / 6.4 GB） | 成员清单**只列不解**（读 tar 头 + gzip 顺序流，读到一个 `.unitypackage` 条目即可）；冲突预扫描**只对勾中的做**；界面显示"正在读第 i/N 个" |
| R8 | **撤销时 GUID 已指向用户自己的文件** | 导入后用户又手工往同路径放了东西 | §3.9 的重解析确认 + C# 侧白名单/前缀双重校验（已有，别削弱） |
| R9 | **V5 迁移被"半个修复"卡住** | `migrate()` 挂在 `openDatabase()`，任何旧脚本一打开库就静默应用 V5 | `tests/real/realdb-v5.spec.ts` 在副本上跑；`docs/BRIDGE.md` §10 写明"标 5 之后旧版只读不写" |

---

## 8. 我还没想清楚的问题（宁可留白）

1. **"名字叫 .zip 的目录"这 2 张卡该怎么记账**：磁盘事实是目录、库里登记成 `kind='archive'` 的样子、里面**同时**有解压副本和同名真包。算一个素材还是三个？M5-B 的抽取入口该走哪条分支不影响正确性（走目录分支），但**撤销和 UI 的措辞**取决于这个判断，我不敢定。
2. **预勾选依据会不会被用户读成"程序替我决定"**。我给了"写依据"的缓解，但真用起来是不是仍然烦人，得你先用一次才知道。
3. **`IMPORT_BATCH_MAX = 8`** 是我拍的数（一屏能看完 + 一次失败可控），没有任何实测支撑。真机跑一次 5 个和一次 20 个，可能就该改成别的数。
4. **87 个包那种容器，用户真正想要的是不是"别一个个导，给我一个整包合并成 .unitypackage 的功能"**？那是 v2 的非目标（`M5A-SPEC-NOTES` §10.1 明写不做），但如果他的实际诉求是这个，M5-B 做完成员提取也还是不好用 —— **这条应该直接问他**，不该由我猜。
5. **`package_entry` 是空的**，而规格 §5.1③ 把冲突预扫描的 GUID 来源写成"从 `package_entry` 表读"，实现改成了当场解析（`coordinator.ts:177`）。**这是实现与规格的偏离，且未记进开放问题**。M5-B 要不要顺手把这张表填上（填了预扫描就不必每次解析 6.4 GB 的包）？填的话谁负责维护、素材换文件之后怎么失效 —— 我没想清楚，倾向前不填、只做 LRU 缓存解析结果。
6. **M5-B 的"批量"和 M6 的"批量导入队列"边界**：我把"抽取 + 选择 + 串行执行"归 M5-B，"队列浮层 / 多条并发展示 / 取消整批"归 M6。这是照 `00§三` 的口径自己切的，规格里没有 M5-B/M6 的正式定义（同 `M5A-SPEC-NOTES` Q13 那个未裁定问题）。
7. **F8（`R-84`/`R-85`）到底跟不跟 M5-B 一起做**：有了 §3.8 那三列，"这个素材在哪些工程装过"顺手就能查；但"清理未使用素材"要全工程 GUID 索引，那是另一条链。我倾向只做反查、不做清理，但这是范围裁定，该你说。

---

## 9. 一句话交付顺序（以及 M6 什么时候做）

```
① P0 三件（members.ts + only 精确匹配 + stat 优先）      离线全测，半天量级，风险最低
② M5-B 实现（V5 迁移 → 容器成员清单 → 抽取 → 导入记账）  离线能验完，真机只补 §6-E 组
③ M6 自动切换 + 顶部横幅 + 托盘唤醒（R-42…R-52 那 10 条） ← 不依赖 ①②，可以插到 ② 之前或并行
④ 补 §8-12/13/15 的真机验证（要你开 Unity）
⑤ M7：安装包 + 首启向导 + safeStorage 密码 + README 常见问题
```

**M6 的依赖关系值得单独说一句**：那 10 条要的是"三路运行状态探测"（M5-A 已做完）+ `collection.rule_json`（已建模）+ 顶栏/横幅（纯界面）—— **和压缩包抽取没有任何关系**。
所以 M6 排在 M5-B 之后只是"先填规格漏洞、再补体验"的顺序偏好，不是被挡住；如果你想先看到"打开 shinano 工程 A 就自己切过去"，直说，我把它插到 M5-B 前面做。

---

## 10. 落地后的偏离（①–⑥ 实施时改的，实现为准）

写设计时不知道、量完才知道的事都记在这里。**这一节是拿代码对账用的**，不是复述上面的设计。

| 设计里写的 | 落地成了 | 为什么 | 证据 |
|---|---|---|---|
| §3.10 `FoundPackage { path; sizeBytes; origin }` + `origin.extracted: boolean` | `path: string \| null`，**没有** `extracted` 布尔 | 压缩包成员在抽出来之前**没有路径可给**。放一个"看起来像"的路径 + 一个布尔说它是假的，等于给同一件事两个可以互相矛盾的表示；`path === null` 已经说完了 | `src/shared/types.ts` 的 M5-B 契约节 |
| §3.10 `kind: 'loose' \| 'archive' \| 'empty'` | 保持三分支，但 `empty` 带 `reasonKey`（`noRow/noPath/missing/noPackage`）+ `notes` | 老实现把"没找到"和"有包但要先抽"和"路径没了"全塞进一个空数组，界面只能猜 | `tests/import/coordinator.spec.ts` |
| §3.10 影响清单里"`packagesOfAsset` 保持同步" | 改成 **async** | 压缩包清单要起后端进程（`7z l`），同步版只能靠扩展名猜格式 —— 而 P0-3 说的就是"名字不算话" | `src/main/import/coordinator.ts` |
| §5 预估"新增 3 个实现文件" | 实际 4 个：多了 `src/main/unpack/entryMatch.ts` | 成员匹配规则被 `unzip.ts`（`only` 过滤）、`members.ts`（落地回认）、`containerPackages.ts`（清单）三处要用。写三遍一定会漂 —— P0-2 那个前缀匹配 bug 就是漂出来的 | `tools/verify-red-m5b.cjs` B 组 |
| §3.2 硬校验只读真盘 | 增加**磁盘读数注入**（`DiskFacts = { freeBytes, driveOf }`），规则本身不可注入 | 单测的临时目录天生在 C 盘，而 C 盘正是这道闸门要拒的盘 —— 不给注入，"抽→导→清"这条**正向**链在离线用例里根本跑不完（只能跑拒绝那半边） | `tests/import/extract-root.spec.ts` + `member-import.spec.ts` 的闸门组 |
| §3.8 V5 三列 + "一包一条" | 一致；另**新增 `rollbackOrderOfBatch`**：整批撤销的倒序借 `journal.id`（INTEGER 自增） | 原来按 `finished_at` 排 + ULID 兜底：一批连着导两个小包就在同一毫秒，而 `ulid()` 同毫秒后缀是随机的 → **顺序会飘**，实测撤出来是正序。正序撤会把"后一次覆盖的内容"写回去 | `AA` 号回退验证 |
| §3.6 撤销 journal 不带 `assetIds` | 一致（`import` 与 `import_rollback` 都不带），并**另加一条**：把 `'import'` 从 `lastRevertible` 的 op 白名单里摘掉 | 原白名单里有 `import`，而 `undoOne` 碰到它只会抛"将在 M5 交付"并把那行标成 failed 后**整次撤销中止** —— 导一次包就把 Ctrl+Z 钉死一次，批量之后是 N 次 | `Z` 号回退验证 |
| §3.4 `IMPORT_BATCH_MAX = 8` 写在主进程 | 常量搬到 `shared/memberPick.ts`，主进程 re-export | 界面要按同一个数切批。两边各写一个 8，改了另一边就是"界面切 8、链路拒 9" | `AN` 号回退验证 |
| §3.4 界面"预勾 + 写明依据" | 一致，并**加了相反的那一半**：命中面太宽（超过一批 / 过半）也一个都不勾 | 工程名叫 `vrc-main` 时库里 87 个包个个带 vrc —— "替他全选"只是把取消的工作推回去，还多出误点的空间 | `AL` 号回退验证 |
| §3.4 成员列表"虚拟滚动" | 增量渲染（先 60 条 + 再显示 100 条） | 400 条硬上限下够用；引 react-window 是另一件工务，别塞在 M5-B 里 | §10.6 of M5A-SPEC-NOTES |
| §3.7 五类失败各有 key | 一致，另多一类 `err.memberMissing`：清单过期时 `origin.memberRelPath` 与勾中的 `relPath` **不一致就直接拒绝**，不回退猜 | 回退猜的症状是抽出**另一个包**导进工程，用户以为导的是他点的那个。拿错包比导不进去严重 | `S` 号回退验证 |
| §2 P0-3 的 stat 优先 | 一致；实施时又发现一例同类问题并修掉：**单个 `.unitypackage` 文件被 magic bytes 认成 gzip**，于是被当压缩包去列成员（列出来的是 tar 里的 GUID 目录），库里 31 张散装包卡会全报"没有可导的包" | 判"这是不是容器"要连"它本身就是我要找的东西吗"一起判 | `AC` 号回退验证 |
| §7 风险 R1（临时文件落进真库） | 一致，并加了第二道：`releaseMemberDir(dir, **mustBeUnder**)` 第二参数必填，不在抽取根之内就拒删 + warn | 目录型容器的成员不复制、路径**就是库里原件**。调用点传混一次的表现是"导入报成功、素材卡还在、文件没了" —— 这种事故不该靠调用方自觉 | `X` / `X2` 号回退验证 |
| — | **实施中新发现的闸门漏洞**：`\\?\C:\...` 这种 Windows 命名空间写法**真的能写**，而 `driveOf` 只看开头有没有 `X:`，于是"绝不落 C 盘"和"不在库根内"两条都能被绕过去 | 判据先剥命名空间前缀再比。实测过程记在 `tools/probe-drive-forms.cjs` | `AI` 号回退验证 |

**仍然没做的**（不是忘了，是范围）：加密容器的密码输入框（后端与参数已留）、真 Unity 侧的 §6-E 组（要开编辑器点）、F8 反查索引。详见 `docs/M5A-SPEC-NOTES.md` §10.6。

