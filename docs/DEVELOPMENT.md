# Atrium 开发说明（开发者视角的账本）

> **普通用户不用读这份** —— [README](../README.md) 那一份就够了。
> 2026-10-09 从 README 整段搬过来：README 是写给改模玩家看的，不该出现 schema / IPC / pHash /
> 变异回扫表 / 里程碑编号这些词。内容一字没删，只是换了地方。

> 逐轮验收凭据在 [VERIFY-UNVERIFIED.md](VERIFY-UNVERIFIED.md)，首启向导的设计与裁定在 [M7-DESIGN.md](M7-DESIGN.md)。

> **⚠ 2026-10-15：`待复核` 功能已整体移除**（用户要求，理由是它臃肿、拖慢工作流）。
> 下面第 9 轮 ①（「待复核的出口」）以及各处提到的 `needs_review` / 59 条那类测量数字，
> 都是**当时的记录**，保留不改（改历史等于让账本说谎）；但**现在代码里已经没有这个功能了**：
> `asset.needs_review` 列与 `idx_asset_review` 索引由 schema V9 删除，侧栏入口、单卡按钮、
> 合集批量出口、`assets:set-review` 通道、`assets:learned-hint` 通道全部拆掉。
> 低置信度的素材现在照常入库、不再打任何标记；分类随时可以在库里改。
> 想找现在的口径，看 [README](../README.md) 和 `src/main/db/schema.ts` 末尾的 V9 迁移注释。

> **⚠ 2026-10-21：导入手势已简化（源码 0.8.0，本机验证中，未发 Release）**
> 用户 10 条裁定见 [PROMPT-INTERACTION-SIMPLIFY.md](PROMPT-INTERACTION-SIMPLIFY.md)。现行口径：
> 网格/列表里**双击素材卡 = 导入**；**双击合集卡 = 成员面板 + 全部预勾**；**长按合集卡（列表整行）1 秒 = 打开合集**；
> `Enter` 仍导入，`Shift+Enter` 打开选中的合集；容器内双击一行也是导入，Enter 仍是选包。
> `doubleClickAction` 设置、详情面板/合集页/多选工具栏/设置页里所有常驻「导入到 Unity」按钮已删除。
> 下面第 10 轮那张表里“行内『导入』不再 disabled / 双击吃设置”是**当时**的修法，已被本轮取代，保留作为历史记录。
> 现行判据在 `src/shared/cardGesture.ts`、`src/renderer/lib/useLongPress.ts`，接线用例见
> `tests/renderer/gesture-wiring.spec.ts`，变异组 I1–I6 在 `tools/verify-red-r10.cjs`。

> **⚠ 2026-10-21：VPM 合并启动（P0）**
> 新增独立的 `src/main/vpm/` 外壳：VPM 设置/快照放在 `%APPDATA%\A\vpm\`，默认关闭，
> 核心 `library.db` schema 仍是 11；只有 `src/main/vpm/gate.ts` 会被核心静态 import，
> 设置页的 VPM 面板是懒加载。P0 只做开关、数据根校验、启用前快照、安全模式与最小入口；
> 仓库/包/事务从 P1 起才接入。P0 已完成并装到本机（0.9.0）；**P1 起按小任务卡开发**：
> 架构见 [VPM-ARCHITECTURE.md](VPM-ARCHITECTURE.md)，任务板见 [VPM-TASKS.md](VPM-TASKS.md)，
> 任务卡在 [prompts/tasks/](prompts/tasks/)，回退见 [VPM-ROLLBACK.md](VPM-ROLLBACK.md)。

## 图标

`python tools/make_icon.py`（默认出 **v4「斜顶」**）→ `build/icon.png` + `build/icon.ico`（16/24/32/48/64/128/256 七档）
+ `build/icon-invert.png`（白底黑字，浅色背景上用）。**纯几何画的，不依赖任何字体文件。**
`python tools/make_icon.py --preview` 出一张四方案对照图（`docs/screenshots/preview-icon-variants.png`），
每个尺寸都贴浅灰底 / 中灰底 / 白底三遍 —— 任务栏深浅都可能，只看大图会挑错。

黑底白字，A 按 X（推特那个）那套语言画：字形占满、笔画粗、末端平切或 45° 斜切、左右不完全对称。
四个方案与选它的理由：

| | 手势 | 24 / 16 像素上的表现 |
|---|---|---|
| v1 正切 | 顶口平切 | 最清楚，但像"一个粗体字母" |
| v2 模板 | 顶口斜切 + 横杠左端断口 | **断口糊成"横杠画坏了"** |
| v3 斜压 | 左腿更粗 + 横杠抬成平行四边形 | 斜横杠读起来像没对齐，左脚还顶到圆角 |
| **v4 斜顶（定稿）** | 只留顶口一刀 45° 斜切 | 小尺寸仍是干净的 A，大图有辨识度 |

选 v4 的理由：**托盘和任务栏才是它天天被看见的地方**，第二处细节在那儿都是减分。
斜口拉得比第一版狠（左肩 0.168 / 右肩 0.082），内腔也放大（`y0 0.285`、脚口内沿 `0.20`），
否则缩到 32 像素斜口就消失、字会糊成一块。

⚠ 图标改动**等于改产物**：`build/icon.ico` 变了就要重打包，两个 exe 的 SHA-256 会跟着变。
另外 `win.signAndEditExecutable: false` 决定了 **exe 文件本身嵌的还是 Electron 默认图标**，
所以快捷方式必须显式指 `resources\icon.ico` —— 这条目前只能靠 `tools/set-installed-icon.cjs` 事后改，
`build/installer.nsh` 里那份"安装时就改对"的方案因为安装器报错（退出码 2）还没接上，见 §13。

---

---

## 当前进度：**已发布 `v0.7.0`**；源码 `v0.8.0` 的「双击导入 / 长按 1 秒开合集 / 删常驻导入按钮」已实现，本机验证中，**未发 Release**（用户要先自己用、点头后才发）。

> 下面是 0.4.1 那会儿的原账，保留不改（改历史等于让账本说谎）：
> 已发布 `v0.4.1`（2026-10-11）—— 开发计划第 1–10 轮全部关闭 + 他朋友两条 PR（可靠性与首启，12 条修复）已在 main 上。
> 0.4.1 相对 0.4.0 **只有那 12 条修复**：那一轮我没有改产品代码，做的事是「把合进来的东西验一遍、出包、发出去、装回他机器」。
> 版本号 bump 是我提的（他没 bump，`package.json` 在他合并完仍是 0.4.0）；证据见 `docs/VERIFY-UNVERIFIED.md` §19 和下面的 v0.4.1 那一节。

> ⚠ **一条流程例外要记账**：他朋友 2026-10-11 写进 `AGENTS.md` 的约定是「所有改动走 `codex/` 分支 + PR，不要直接推 main」，
> 而这次发布提交 `e30f5ba` 和 tag `v0.4.1` 是**直推 main** 的 —— 因为用户本人（仓库所有者）在他给了 PR 方案之后
> 明确改口：「就要合进main，直接推到main上，然后上传release到新版本0.4.1」。这不是我绕的，是他覆盖的。
> **下次默认仍然按 `AGENTS.md` 走 PR**，除非他再明说一次；`main` 上没有分支保护，所以这条全靠人记。

> 第 10 轮当时那行进度原文留着，免得"当前进度"变成一份只有最新一页的日历：
> **开发计划第 1–9 轮关闭 + 第 10 轮六件全部落地（源码 0.4.0，含 ⑥）**。⚠ 当时已发布的 `v0.3.0`
> **不含 ⑥、也不含本轮六件**；按他批的 Q9 甲：出 0.4.0 + 覆盖安装本机，GitHub Release 等他说发再发
> —— 他 2026-10-10 深夜点了头，于是有了下面那节 v0.4.0。

> 第 8 轮当时那行进度原文留着，免得"当前进度"变成一份只有最新一页的日历：
> M1–M6 + R1/R2/R3 + R4 全部完成；开发计划第 1–7 轮全部走完（第 7 轮：M7 首启向导四步 + 库根只有一处闸门
> + 一屏批量装桥接 + Q10「剩下 N 个都不再问」+ `safeStorage` 密码保管 + 29 处变异回扫全钉住 + 对账表 42 条在册
> + 打包版真机首启六条四场 91 条判据 0 红）；第 8 轮发布收尾做到 ⑤ —— 版本号进 `0.2.0`、徽章去掉内部代号只写 `v0.2.0`、
> README「常见问题」新写一节 +「已知限制」整节重核（三条早已修好的旧说法删掉）、MIT 许可落地、
> 仓库推到 `github.com/W4nN1ng/Atrium`（一个干净的初始提交，开发史留本地）、1369 项测试全绿、
> 两张变异回扫表（R4 42 处 + M7 29 处）都 exit 0、产物重出过一次、`Setup.exe` 真装 + 覆盖安装跑完红 0 条。

## ✅ 已发布：https://github.com/W4nN1ng/Atrium/releases/tag/v0.2.0

2026-10-09 20:5x 上线。发之前把 tag `v0.2.0` 从 `d0f7023`（那里还没 `LICENSE`、`license` 仍写 `UNLICENSED`）
`git tag -f -a` 挪到含 MIT 的 `45555e5` 再强推，然后建 Release、传 `Atrium-Setup-0.2.0.exe`（83.0 MB）与
`Atrium-portable-0.2.0.exe`（82.8 MB）。发完逐条核过：远端字节数 = 本地、**GitHub 自己算的 `digest` 与正文里那两串
SHA-256 逐位相同**、直链 `curl -r 0-15` 回 206 且头两字节 `MZ`、正文与 `docs/release-body-0.2.0.md` 逐字一致。
过程里踩的两个坑（`upload_url` 的 URI 模板、以及"分块解码把中文烧成 U+FFFD 造成假差异"）记在
`docs/VERIFY-UNVERIFIED.md` §13 与 `tools/gh-release.cjs` 文件头。**第 8 轮到此关闭。**

**第 9 轮 ①⑤ 已落地并发布 `v0.3.0`（2026-10-10）：① 待复核的出口、② B4 存量重并（设置·维护那栏）、
⑤ 收尾（版本号 / README 那句虚承诺改准 / 两个包重出并发出去）。
③ B2 经实测取消（目标人群 0 行，见下面 ② 那节）；剩下的只有「真库那一次重并」——等他点头（#97）。**

## ✅ 已发布：https://github.com/W4nN1ng/Atrium/releases/tag/v0.3.0

2026-10-10 12:3x 上线，tag `v0.3.0` → `90d060b`。传 `Atrium-Setup-0.3.0.exe`（87,031,669 字节）与
`Atrium-portable-0.3.0.exe`（86,797,584 字节）。发完逐条核过：正文与 `docs/release-body-0.3.0.md` 逐字一致、
**GitHub 自己算的 `digest` 与正文里那两串 SHA-256 逐位相同**、直链跟一次 302 之后回 206 且头两字节 `MZ`、
远端总字节数 = 本地、`tools/pkg-version.cjs` 报版本号/license/依赖闭包三项与源码一致。
**这台机器上装着的还是 0.2.0**（他选了"先不装，只出包"）。

> 0.2.0 那页仍然挂着，而且它的 **Portable 资产是旧构建**（19:25 那批，图标与 ①② 都没有）。
> `/releases/latest` 现在指向 0.3.0，所以正常用户不会拿到它；要不要把那条旧资产删掉，等他决定。

## ✅ 已发布：https://github.com/W4nN1ng/Atrium/releases/tag/v0.4.0

2026-10-11 00:1x 上线（他 10-10 深夜一句「现在把最新版发到 GitHub 上」）。tag `v0.4.0` → 提交 `2a762d1`
（第 9 轮 ⑥ + 第 10 轮六件一并进来 —— ⑥ 从来没单独提交过，拆开要在同一份文件里逐块分暂存，
为了一个好看的历史把风险留给下一步不值）。传 `Atrium-Setup-0.4.0.exe`（87,033,645 字节）与
`Atrium-portable-0.4.0.exe`（86,799,537 字节）。

发完逐条核过（`node tools/verify-release-page.cjs` + 直链探测）：正文与 `docs/release-body-0.4.0.md` 逐字一致、
正文里没有术语残留、**GitHub 自己算的 `digest` 与正文两串 SHA-256 逐位相同**
（`41574c4b…7257a7` / `c0e31d1d…a8e834`）、远端资产 `size` = 本地两个字节数、`state=uploaded`、
直链跟一次重定向后回 **206 且头两字节 `MZ`**。

> ⚠ 第一次跑 `--create` 是**直接停住**的：工具要 tag 先在远端（`git push origin main --follow-tags`），
> 而我只推了分支。表现是一句人话报错、什么都没建 —— 这条闸门是对的，别嫌它烦。
> 本机也是 0.4.0：`node tools/installed-version.cjs --expect=0.4.0` 读注册表核过（不看 exe 文件属性）。


## ✅ 已发布：https://github.com/W4nN1ng/Atrium/releases/tag/v0.4.1

2026-10-11 03:24 上线（GitHub `published_at` = `2026-10-10T19:24:37Z`；他一句「就要合进main，直接推到main上，然后上传release到新版本0.4.1」）。
tag `v0.4.1` → 提交 `e30f5ba`（`chore(release): 0.4.1`：`package.json` 0.4.0→0.4.1、`docs/release-body-0.4.1.md`、
本轮活体在 0.4.1 产物上重跑出来的四张截图）。传 `Atrium-Setup-0.4.1.exe`（**87,038,119** 字节）与
`Atrium-portable-0.4.1.exe`（**86,804,019** 字节）。

**这一版的内容 = 他朋友的两条 PR**（`c9969a4` 可靠性/归档/快捷键 + `e5062a4` 协作约定），
`v0.4.0..HEAD` 一共 39 个文件、+836/−305。我在这之上的活只有"验 + 发"，产品代码一行没改 ——
所以正文那十二条全是他的修复，用大白话重写了一遍（无术语、无里程碑编号，`verify-release-page.cjs` 顺手查残留）。

发之前过的四道闸（全在合并后的 main 上跑，不是在他分支上）：

| 闸 | 结果 |
| --- | --- |
| 全量测试 | ✅ `npx vitest run` **1564 passed / 19 skipped / 0 失败**（TEMP/TMP 指 `E:\avca-tmp`；C 盘只剩 8 GB，别拿 C 盘当临时目录，会红成"数据库磁盘已满"） |
| 双 `tsc` | ✅ main+renderer 两份 typecheck 都干净 |
| 两张变异回扫表 | ✅ `verify-red-r10` 47 处、`verify-red-r9` 50 处**全部钉住**（改了源码就该红，改回来才绿）→ 他动 `classify/engine.ts`、`ingest/api.ts`、`App.tsx`、`stores/ui.ts` 这些本轮重灾区，没把我的不变量弄坏 |
| 产物闸 | ✅ `node tools/pkg-version.cjs`：asar 里 `a-asset-manager 0.4.1`、license MIT、87 个顶层包 = dependencies 闭包 91 个、asar 不比源码旧 |
| 打包版活体 | ✅ `node tools/live-r10.cjs` 在 `dist/win-unpacked`（0.4.1）上 **34 项全绿 / EXIT=0**，六段都跑：E 拖放、C+D 筐摊平与卡名、D 后半程按包内名搜、A+B 容器滚动与真按钮、F 日志按钮、#112 换库刹车。**C 那几条是重点** —— 上一轮就是在这儿抓出"实现了 ≠ 生效了" |

发完逐条核过：正文与 `docs/release-body-0.4.1.md` **逐字一致**、术语残留 0 条、
正文两串 SHA-256 = **GitHub 自己算的 `digest`**（`9a4d3332…f0c231a` / `7adf682b…9bb017d`）、
远端 `size` = 本地两个字节数、`draft=false`、`prerelease=false`、`/releases/latest` 指到 v0.4.1、
直链 `curl -r 0-15` 回 **206 且头两字节 `MZ`**。

**本机也升到 0.4.1 了**（他那条"每轮结束把我本地的 Atrium 更新好"的规矩）：
`--stage=snapshot`（装前指纹，23 张素材卡）→ `AVCA_REAL_INSTALL=1 --stage=overwrite` → **红 0 条**：
覆盖安装后没被当成全新安装（不弹向导）、徽章 `v0.4.1`、15 张表逐行一字不差，
只有两条按列允许变：`asset.cover_image` 刷了 22 行（原来那 22 格是空的）、`project.last_seen` 9 行（起过一次当然会刷）；
`settings.json` 九个关键字段一字不变，`categories.user.json` 本来就没有 → 还是本来就没有。
注册表核过：`DisplayVersion = 0.4.1`（`node tools/installed-version.cjs --expect=0.4.1`）。
装之前 `waitNoAtrium()` 轮询到 0 个进程、备份三份到 `D:\avca-m7-live\real-backup\pre-overwrite-2026101019265`，
全程没碰他的素材本体。

> 顺手量到一条他的现状：`settings.libraryRoot` 现在是 **`E:\Atriumdate`**（不再是 `E:\vrc\A`）。
> ⑥ 那道刹车按库记，换过根目录的库会被当成"还没收拾过"再走一次 —— 这次起过一次没弹告知条，
> 说明这套库里没有可并的旧账（顶层人口对得上）。

---


> "改分类搬文件 / 多选卡批量导入 / 变体分列 / 类别口语 / 首次弹桥接安装窗"还列在 ❌ 里。
> 过期清单比没清单更坏，所以本轮按 `tools/selfcheck-r4.cjs` 与
> `tests/spec-coverage.spec.ts` 的 R4 一节逐条重核过再改写。
> 想知道"哪一件是哪一轮做的、证据在哪个文件"，看那两处，别看提交信息。

---

## 2026-10-21 交互简化（源码 0.8.0 · 本机验证中，未发 Release）

批准文档是 [PROMPT-INTERACTION-SIMPLIFY.md](PROMPT-INTERACTION-SIMPLIFY.md)（Q1–Q10 全按推荐）。这一轮只改交互入口，不改 schema、不动导入安全链路：

| 裁定 | 落地 |
| --- | --- |
| Q1 删常驻导入按钮 | 详情面板、容器行/顶部/底部、多选工具栏、设置页全删；成员面板/冲突框/结果条的确认与撤回保留 |
| Q2 双击合集 | `importWhole()`：开成员面板 → 清单回来后 `pickAllMembers()`，绝不静默导 |
| Q3 多选双击 | 双击已选普通卡 → 还原双击前快照并 `importSelected()`；双击合集卡永远走自己的面板 |
| Q4 长按 | 只对合集卡/列表合集行生效；`shared/cardGesture.ts` 判据 + `useLongPress` 生命周期；封面进度条 1 秒 |
| Q5 列表同步 | 列表行双击导入、长按开合集，合集行加可见 `合集` 徽章 |
| Q6 删设置 | `doubleClickAction` 从类型/默认值/设置页删除；旧 JSON 键不读、不迁移、不报错 |
| Q7 提示 | 状态栏按页给手势文案；详情面板灰色提示；合集卡 title；多选旁 `双击其中一张一起导入`；进度条尊重 reduced-motion |
| Q8 键盘 | `Enter` 单选合集走 `importWhole`；新增 `Shift+Enter` 打开合集；容器内部 `Enter` 仍开面板（App 不抢） |
| Q9 判据 | `cardImportChoice` 只要候选 >1 就 `needs-choice`，批量跳过并如实报数 |
| Q10 版本 | `0.8.0`，只在本机构建/安装，GitHub Release 等用户用过后再发 |

回扫：`tools/verify-red-r10.cjs` 的 I1–I8 八处变异全红；活体脚本 `tools/live-r10.cjs` 加了 I 段（长按 300ms 取消 / 1.15 秒进入、双击普通卡/合集卡/行、无按钮、多选快照）。
实际跑出来的证据（全量测试数、活体 I 段、截图、本机 0.8.0 安装对账、未验证项）见 [VERIFY-2026-10-21-GESTURES.md](VERIFY-2026-10-21-GESTURES.md)。

## 开发计划第 10 轮（已落地 · 源码 0.4.0）· 2026-10-10

**为什么开这一轮**：他下午一段连报 —— 五件事 + 两段录屏 + 四张截图，加一条新规矩。方案、裁定、冲突检查在
[`PROMPT-R10-BUGFIX.md`](PROMPT-R10-BUGFIX.md)（Q1–Q11 他一次批完：Q2 甲**并加了一条反向硬约束**、Q4 甲、Q9 甲批准）。
他的新规矩（写成本轮收尾的硬闸，见那份文档 §6）：**每轮结束必须把他本机那份 Atrium 更新到最新才算做完**。

| 他报的 | 落地成 | 判据在哪 |
| --- | --- | --- |
| 容器页面滚不动、20 多行看不到最下面 | 组件根那一层补 `min-h-0`（列向 flex 里 `flex-1` 配 `min-height:auto` ⇒ 子元素的 `overflow-y-auto` 永远拿不到有下界的盒子） | `BundleDetail.tsx` + 一条 class 计数用例 |
| 容器里双击道具提示"Unity 导入在 M5 交付" | 四颗假按钮全接真动作：行内「导入」不再 `disabled`、双击吃设置里的「双击行为」（和外面那张网格同一套）、顶部「整包」= 开面板 + 全部预勾、Enter = 开面板 | `tests/renderer/r10-container-and-copy.spec.ts` |
| `道具22件` 被并成一张合集卡、还判成插件类 | 目录名自己是"筐"（计数词/随手建的归类词）时不再做成容器卡，里面各件自成一张卡；**同一件衣服的多个素体适配照旧并成一张卡**（那条走 `groupKey`，和名字无关） | `bundle.ts:isBasketOnlyName` + `engine.ts` 那道闸 + `shared/flattenUnits.ts` |
| 合集名被认成 `yurayura obake`（他拖的是 `修女`） | 磁盘名不垃圾就用磁盘名，被压下去的包内名降级成别名进 tags（照样搜得到） | `container.ts:containerInfoOf` + `shared/naming.ts:nameIsGarbage/tagsWithAltName` |
| 有时文件夹拖进来一点反应也没有 | 高亮改由 `dragover` 点亮 + 400ms 静默熄灭（不再靠 enter/leave 配对记账）；拿到 0 个本地路径**必须说一句**（两种病根两句不同的话）；控制台留一行 `[drag]` 计数 | `DropOverlay.tsx` + `shared/dropDiagnostics.ts` |
| 「把所有旧文案删了，不要再出现"unity导入在M5交付"类似的内容」 | 三条闸（见下面那节） | `tests/renderer/i18n-hygiene.spec.ts` |

### ⭐ 本轮最值钱的一条：活体抓出了"实现了 ≠ 生效了"

`classify()` 把筐摊成 22 个单元 —— 单测绿。**真入库那场活体第一次跑，库里只有 1 行，还叫 `道具22件`。**
根因在 `ingest/api.ts` 的 `commit()`：它只读 `res.classification.units[0]`，多单元又没有合集树时其余 21 件直接蒸发，
而 D 那条"磁盘名优先"又把仅存那一行的名字盖成筐名。也就是说 **C 只做了一半**，界面上和没修一模一样。
补的是：登记那一步认"没有树却多个单元"这一形状，逐件落库、每件带自己的源路径与体积、一律索引不搬盘、
筐那份容器清单不许套到每件上；用户没主动改分类时不许拿第一件的分类拽走其余 21 件。
判据抽到 `src/shared/flattenUnits.ts`（`isFlattenedBasket` / `unitSourcePath` / `unitRawName`），
`AssetUnit` 多带一列 `sourceRelPath`。回扫表 H1–H7 七处变异钉着这条链。

### 文案的三条闸（他会再撞上，所以不是一次性清理）

界面只许说两种话：现在能做什么、现在不能做什么以及为什么。于是：

1. 语言文件里不许出现 `M\d`（`library.bundleImportSoon` 那批 8 条死文案整条删掉）；
2. 也不许出现「将在 / 対応予定 / Coming in」这类**预告** —— 这条是补的：
   `common.notImplemented` 的原文是「该功能将在 {{milestone}} 交付」，编号在**参数**里，按字面量找 `M\d` 抓不到它。
   设置·维护页那颗「导出日志」就是靠这句骗人的，本轮换成真动作「打开日志位置」（`system.reveal(paths.logs)`）；
3. **源码里硬编码的字符串也扫** —— 第一版只扫语言文件，于是 `ingest/api.ts` 里那句 `'M2 手工分类（未走自动分类）'`
   活到本轮审计才被抓住（它会显示在详情面板「为什么这么判」那一行）。

内部代号那条还顺手抓出一个**假绿**：`internalNameHits` 里写的是 `loc === 'zh'`，而语言文件叫 `zh-CN` ——
中文那份文案一直在跑**英文**规则，那条闸其实是瞎的。改成按前缀判，并补了喂 `zh-CN` 的正向对照。

### #112 · 那道刹车改成按库判

⑥ 的"只跑一次"原来记的是**这台机器**跑过没有，可它要防的是"同一批卡被并两遍"。
他把素材库整包换到另一块盘之后，新库里那份旧账会永远撞在旧时间戳上。
新增 `settings.autoRemergeRunRoot`，判据 `remergeAlreadyRun({runAt, runRoot}, currentRoot)`：
比归一化后的目录键（`E:\vrc\A` 与 `e:/vrc/a` 算同一套）；老数据（有时刻、没库根）维持"已跑过" ——
这条判据的用途是刹车，把它当"没跑过"等于给旧用户多写一次库。

### 证据

`npx vitest run` **1540 passed / 12 skipped**（本轮起点 1448）；新增/改写用例
`tests/shared/drop-diagnostics.spec.ts` 6、`tests/shared/flatten-units.spec.ts` 11、
`tests/renderer/r10-drop.spec.ts` 11、`tests/renderer/r10-container-and-copy.spec.ts` 11、
`tests/classify/r10-basket-and-naming.spec.ts` 19、`i18n-hygiene` 6、⑥ 那四份 64（含本轮新加的 G 系列 2 条）。
变异回扫 **`tools/verify-red-r10.cjs` 47 处全被接住**、`tools/verify-red-r9.cjs` 50 处重跑全绿
（D15 那条锚因为 #112 加了 `autoRemergeRunRoot` 变成两处命中，改成带上一行的 CRLF 锚）。
活体 **`tools/live-r10.cjs` 25 条判据 0 红**（沙盒 `D:\avca-m7-live\r10-*`，真库 `E:\vrc\A` 与 `%APPDATA%\A` 全程没碰）：
真滚轮（`tools/cdp-wheel.cjs` 走 `Input.dispatchMouseEvent`，不是页面里合成 WheelEvent）把容器视图从 0 滚到 1183px、
最后一行落在视口内；筐真摊成 6 张顶层卡（顶层一共 7 张 = 6 件 + `修女`）、合集那张仍是容器卡；
搜 `Holy Spice` 出得来那张 `修女`；拖放 0 路径两句不同的话真弹出来，控制台留了 `[drag]` 计数。
截图 `docs/screenshots/r10-1..4*.png`。

**仍未验证 / 已知未做**：① 真实资源管理器拖拽（OS 层）那条 —— 命令行发起不了一次 Explorer 拖拽，
只能靠他下次撞上时看 `[drag]` 那行分辨"事件没进来"还是"进来没路径"；② Q10（那 22 件各自判成什么类）本轮只量不改，
清单在 `VERIFY-UNVERIFIED.md` 那节；③ Q11（包内日文名 EUC-JP 被当成 GBK + `.url`/说明图被子项化）登记未做（#105）。

### 收尾 · 0.4.0 出包 + 覆盖安装本机（他新定的那道闸）

`npm run build` **EXIT=0**（内部那趟全量测试一起过）→ `dist\Atrium-Setup-0.4.0.exe` 87,033,645 字节 +
`dist\Atrium-portable-0.4.0.exe` 86,799,537 字节；`tools/pkg-version.cjs` 三条（版本 / license / 依赖闭包）都过。

**本机已经是 0.4.0**：`node tools/installed-version.cjs --expect=0.4.0`（新工具）读注册表
`HKCU\…\Uninstall\0e0e4f8f-…\DisplayVersion` = **0.4.0** —— **不看 exe 文件属性**（那是 Electron 的 33.4.11，这条踩过）。
装之前 `waitNoAtrium()` 轮询到进程全退（#93 关掉，Electron 子进程比主进程晚死几秒，那一刻装就是"弹一脸报错"的来源）。

装完起过一次，逐表逐列核过（拿装之前那份库副本比）：`asset` 53 行里 50 行变的**只有 `cover_image`**（日志
`缩略图补齐：查了 50 条，新出 32 张封面`），名字/分类/路径/父子/`needs_review` 一格没动；`search_alias` 937 行**集合一字不差**
（启动重建索引改了行序）；`journal` 仍 800 行 → **⑥ 在他这套库里一行都没动**（装之前只读量过：顶层人口 0 张 → 并 0 处）；
`settings.json` 多出来的是 ⑥ 那两个戳（`autoRemergeRunAt` + `autoRemergeRunRoot`）。

**两条顺手学到的（都写进工具注释了）**：① `reg.exe` 被重定向时输出 **UTF-16LE**，而 `reg query` 打出来的是
`HKEY_CURRENT_USER` 而不是父键的 `HKCU` —— 这两条任意一条写错，表现都是"注册表里找不到 Atrium"，而它明明装着；
② 覆盖安装对账的白名单原来只有 `project`，于是"补封面 + 重建索引改行序"报成两条红 ——
**口径哭狼来了比没口径更坏**，已改成按列钉：`asset` 只许 `cover_image` 变、`search_alias` 比集合不比行序，
其余任何一格动一样照样红。

**公开发布也跟着做了**（他 10-10 深夜点头）：`v0.4.0` tag → `2a762d1`，Release 与两个包上线，
逐条核过（正文逐字一致 / GitHub 自算 digest = 正文两串 / 远端字节数 = 本地 / 直链 206 + `MZ`），
凭据与那条"tag 没推就先别建 Release"的闸门见上面 `## ✅ 已发布：…/v0.4.0` 那一节。

---

## 开发计划第 9 轮（进行中）· 2026-10-10

**为什么开这一轮**：他 2026-10-09 两句原话 ——「这里待复核，但是我怎么找不到如何让他们变成已复核」
+「同一件衣服，比如 Libero 还是没用自动分成一个合集」。方案与裁定在
[`PROMPT-R9-REVIEW-MERGE.md`](PROMPT-R9-REVIEW-MERGE.md)（Q1 乙 / Q2 甲 / Q3 乙 / Q4 甲 / Q5 甲 / Q6 乙 / Q7 甲 / Q8 乙）。
② 做完他又推回来一次：「为什么不自动合并还要自己手动，这样步骤长根本不适于普通人高效率的使用工具」
—— ⑥ 就是这一句的产物，见下面那节。

### ① 待复核的出口（A1+A2，已落地）

`needs_review` 是 R2d 加的，但清掉它那颗按钮一直长在 `BundleDetail.tsx:437`（合集详情的成员列表里）——
对单卡来说"待复核"是个**进得去、出不来**的状态，而 README 和 Release 正文里写着"等你看一眼"。
判据落在 `src/shared/reviewState.ts`（本仓零 DOM 测试，判据留在组件里等于没测）：
单卡给主按钮「标记已复核」、干净卡给次要链接「重新排进待复核」（Q3 乙：反悔的方式就是再点一次，
不进 journal）、合集卡与附属一律不出（同一个意图不留两个入口）；工具栏两颗批量按钮**绑视图不绑选中数**，
二次确认里的条数只来自"真的会变的行数"（Q2 甲）。

**顺手挖出来的第二个死账**（不在计划里，同一类病）：`BundleDetail` 那颗老按钮 ① 只清成员行、
不清容器行，而容器行的 `needs_review` 入库时是 `items.some(...)`（`commit.ts:540`）——
成员全清完它还是 1，于是这张合集卡永远留在待复核，而单卡那颗对 `isBundle` 又一律不出；
② 它直接摸 IPC、不刷 `refreshMeta()`，点完侧栏那个数不动。两处一起改了。

**证据**：`tests/shared/review-state.spec.ts` 20 条 + `tests/renderer/review-wiring.spec.ts` 13 条
（接线单独一份，因为本轮修的缺陷本身就是"通道全通、没人调用"）；
`tools/verify-red-r9.cjs` 15 处变异**全部被接住**，其中两处是回扫时才发现的**假绿**
（`n: reviewConfirmCount(` 能同时匹配两颗按钮 → 拆成两条；"一个都没选"喂的是 `targets:0` → 改喂 3）；
活体 `tools/live-r9-review.cjs` 在打包版上红 0 条，截图 `docs/screenshots/r9-01..09*.png`，
七行夹具的 `library_path` 全程没动、沙盒库根还是 7 个文件。全量 `npm test`：**1402 passed / 9 skipped**。

**没验的**：真库那 59 条一条没动（沙盒的 `needs_review` 是手写的，"怎么被写上"由 `tests/library/commit*.spec.ts` 管）；
英文/日文界面没截图核过；附属"不给出口"只钉在判据与接线两层，活体没走到合集二级列表里那条附属的详情。

**这一轮的工具账**（三条都是"看着像产品缺陷、其实是验收工具自己坏了"）：
`taskkill /IM Atrium.exe /F` 会连带杀掉他正在用的那个真实例 → 改成按 `ExecutablePath` 认人；
PowerShell 控制台默认 cp936，中文路径回来是乱码 → 比较前先 `[Console]::OutputEncoding=UTF8`；
注入页面的表达式写成 `(()=> 声明; 声明)`（箭头函数没花括号时函数体只能是一个表达式）→ SyntaxError 被
`waitUntil` 的 try/catch 吞掉，表现成"界面没起来" → 补了 `tools/check-live-exprs.cjs`，不启动应用 1 秒验完。

### ② B4 存量重并（已落地；§一 的根因写错了，这里更正）

他报的第二句「Libero 还是没自动分成一个合集」，量完发现**判据早就对了**：
20 个文件名喂给现在的 `deriveGroupKey` 全塌成一个键，全库 `variantUnknown` **0 行**，
存量违反"键与变体一致"的组 **0 组** —— 那 12 张散卡的变体值写的是 `UNIVERSAL`（通用适配），不是模型名。
库里那 13 个老键是 §B2 之前写的，而 `reanalyze.ts` 的 `recompute()` 刻意不动 `group_key`，
所以"再点一次重新分析"治不了它。**症状 100% 在存量**，真实作用面积 = **1 处合并、少 12 张卡**。
⇒ 由此 **B2 不做**（目标人群 0 行），**B1/B3 不重写**（`bracket-variant.spec.ts` 已经钉住），
② 这一格经他点头改成 B4。可复跑的探针：`AVCA_KEY_RESCAN=1 npx vitest run tests/real/realdb-key-rescan.spec.ts`。

新模块 `src/main/library/remerge.ts`：`planRemerge` 只读预览 / `applyRemerge` 落地，
分组**直接复用 `planGroups()`**（歧义闸门与 #40 的"必须同目录"都在里面），不另造模糊匹配。
新 journal op `remerge`（四步倒序撤销：删新变体 → 塞回旧组与它的变体行 → 改回组键 → 改回成员归属），
一个事务一个 batch_id。四段链路：两条通道 → `main/ipc/assets.ts`（**落地时重扫，不信前端那份预览**）
→ preload → `RemergePanel`（设置 · 维护，紧跟 #40 那栏 —— 两栏是反方向的同一件事，都得在）。

**证据**：`tests/library/remerge.spec.ts` 17 条 + `tests/renderer/remerge-wiring.spec.ts` 6 条；
`tools/verify-red-r9.cjs` 扩到 **25 处变异全部被接住**；全量 `npm test` 1425 passed / 10 skipped；
活体 `tools/live-r9-remerge.cjs` 在打包版上 14 条判据 0 红
（截图 `docs/screenshots/r9b-01-preview.png` / `r9b-02-after-merge.png` / `r9b-03-after-undo.png`）。

**这一格里被抓出来的四个我自己的错**（都进了代码注释，因为它们各自都是一类坑）：
① `dir` 喂成文件路径（`shelf()` 不取 dirname）→ 一簇都报不出来，表现成"无事可做"，
补了**正向对照**用例才钉得住；② 变体写了归并键内部那份大写值（`ICHIGO`），真库存原样词形；
③ 用了 `planGroups` 的 `p.variants`，而多体型的包按 `commit.ts` 的不变量**不该**写变体；
④ 预览徽章 `moved + droppedGroups` 在 20 张卡上写成 24，且面板只列前 8 行、
排在前面的恰好是"已经不动的那批" —— 活体第一眼就看出不对。

**还没证的**：真库那一次没跑（Q6 乙，清单可生成，等他点头）；英文/日文界面没截图核过；
`tests/perf/scale.spec.ts > 增量 upsert` 在全量并行下偶发红（0.657 vs 阈值 0.6；单独跑 0.317），
本轮没碰索引热路径，判它负载敏感 → 任务 #100。

### ⑥ 存量重并改成「自动并完 + 事后告知」（已落地）

他那句 **「为什么不自动合并还要自己手动，这样步骤长根本不适于普通人高效率的使用工具」** 是把 ② 的设计推翻的话。
我原来的辩护站不住：我把"安全"寄托在**让他多点一次确认**上，可这个操作真正的安全垫从来不是那一下点击 ——
它**一个文件都不搬、不改用户手调过的分类、不动置信度，而且一次撤销整批退回**。
有这三条，"先看看再决定"的净收益只是心理安慰，净成本是每个普通用户都得先学会"归并组"是什么。

他 2026-10-10 拍的口径：**历史遗留 → 自动并完 + 事后告知**；**新入库 → 保持现状**（入库那一刻就按现行规则归组，不弹任何东西）。

**判据落在 `src/shared/autoRemerge.ts`**（本仓库零 DOM 测试，不该跑的判断必须能在 `shared/` 里钉住）：

| 判据 | 内容 |
|---|---|
| `shouldProbeAutoRemerge()` | 该不该去问主进程。**`alreadyRun` 排第一 = 整个设计的刹车**；再看 boot 完没、库根配没配、向导开着没、是不是拖放小窗 |
| `shouldApplyAutoRemerge(clusters)` | 问回来了要不要动库。**1 簇也要动** —— 真库实测就 1 处，写成 `>= 2` 等于本轮白做 |
| `noticeText(clusters, moved)` | 有没有得说。`moved` 用**执行结果**"改挂了几张"，不是预览里的总卡数（20 说成 12 的那种谎）；`moved === 0` 返回 null —— **只修了归并键、界面上看不出变化，就不弹** |
| `noticeLines(items)` | 展开那几行：能看见的排前面、只修键的沉底、超过 6 处折成一句，`more` 是**没列出的条数** |
| `NOTICE_AUTO_DISMISS_MS = 12000` | 不是 5 秒：这条里有"我动了你什么"和一个撤销入口，5 秒不够一个人读完再想一下。**展开明细时计时器停**（正在读的东西不该被程序收走） |

**刹车为什么必须有**：`autoRemergeRunAt` 一旦落过就再也不自动跑。少了它，用户撤完之后下次开机
程序会把同一批卡又并一遍 —— 那才是真的"程序跟用户抢方向盘"，比原来那四步确认糟得多。
落的时间点也讲究：**查成功就落**（不然每次开机都为"确认没事"全库跑一遍归并键），
**查失败不落**（一个偶发错误不该把这件事永久跳过）。

**告知条 `RemergeNotice.tsx` 挂在 App 这一层**（`<ProjectBanner />` 旁边）：和横幅同一个理由 ——
它产生的那一刻用户可能停在任何页面上。三个动作：「看看改了什么」「撤销」「知道了」，
不悬浮、不遮控件、不抢焦点（活体去读 `getComputedStyle(...).position` 拿 `static` 当证据）。

**「撤销」撤的是这一次，不是"当时最新的那一步"** —— 这是 ⑥ 真正的工程量所在：

- `applyRemerge` 回报 `batchId`（② 时它内部生成了却没往外给）；
- `journal:undo-last` 多接一个可选 `onlyBatchId`，preload / `shared/api.ts` 一起改；
- `undoLast()` 开头加一道闸：**最新那一批不是它 → 一行都不动**，回 `toast.undoStale`。
  刻意不做"想办法撤到旧批次"：旧批次之上可能已经踩着别的操作，抽掉会留下半截状态；
- 键盘 Ctrl+Z 的语义一个字没动（不传就是"撤最新"）；
- ② 那个设置页面板也顺手带上靶子（`lastBatch`），并改成走 `messageKey` ——
  原先它直接 toast 主进程那句中文，切英文/日文界面照样冒中文。

**被抓出来的第二个自己的错（撤销那句人话）**：`undoOne` 的 `remerge` 分支原本 `count: 0`，
于是撤销成功之后界面拼出来是「已撤销 1 步：搬回 **0** 项、清掉 0 个空目录、移除 0 条记录」——
12 张卡真的退回去了，程序却说什么都没发生。改法：单独数 `cards`（改回原位的成员数），
整批都是 `remerge` 时走新的 `toast.undoRemerged`：「已撤销这次合并：{{cards}} 张卡回到自己原来的位置，文件一个都没动」。

**证据**：`tests/shared/auto-remerge.spec.ts` 17 条 + `tests/renderer/auto-remerge-wiring.spec.ts` 18 条，
`tests/library/remerge.spec.ts` 涨到 23 条（新增 `onlyBatchId` 五步 + 那句文案），
`tests/renderer/remerge-wiring.spec.ts` 6 条里"面板三步"那条按新形状重写。
全量 `npx vitest run`：**1447 passed / 1 failed**（红的就是 #100 那条负载敏感的性能用例；
同一次跑里 `tests/unpack/members.spec.ts` 还整文件红过一次，单独跑 17/17 绿 —— 同一族，不是本轮改坏的）。
`tools/verify-red-r9.cjs` 从 25 处扩到 **50 处变异，全部被接住**（D 系列 25 处是本轮的；
其中 D23/D24 就是为了证明"撤成功了却报 0 项"这个错**下次会当场红**，不是靠我记得）。
活体 `tools/live-r9-autoremerge.cjs`（沙盒 `r9c`、端口 9245、打包版真窗口）**25 条判据 0 红**，分七段：
A 没配库时不跑也不落时间戳 → B **一次都不点**，告知条自己出现、库里自己并好 → C 展开明细 + 等满 15 秒不收 →
D0 拿一个假批次走同一条 IPC，**拒了、而且一行没动** → D 条子上那颗「撤销」→ E 重启后**还是散的**（刹车） →
F **对照**：只把那个时间戳抹掉，别的什么都不改，它就又自己并了。
E/F 只差一行设置，才能证明拦住 E 的确实是那道闸，而不是"恰好没跑起来"。
截图：`docs/screenshots/r9c-01-auto-notice-expanded.png` / `r9c-03-after-undo.png` / `r9c-04-after-autocollapse.png`。

**顺手补的一个工具，因为它差点让我误判**：`tools/asar-grep.cjs` —— 只读进内存，
按 asar 头部把**单个文件**切出来查串。起因是我拿"整包按字节 `includes`"查 ⑥ 那道闸的
`toast.undoStale`，报"不在"，当场看着像"打包版不含本轮改动、活体白跑一场"。
真实原因两条，都记在那工具的注释里：① `out/main/index.js` 被 electron-builder 标了
`unpacked: true`，**它根本不在 .asar 里**，在 `app.asar.unpacked/` 下的真文件里；
② 我拿来对比的"文件大小"是 `readFileSync(...).length`（**字符数**，一个中文 3 字节），
和头部的字节数天然差一截。改用头部解析 + 按 `unpacked` 分流之后：`toast.undoStale`、`onlyBatchId`
都在 `out/main/index.js` 里 —— 活体验的确实是这份代码。
（另一条老规矩仍然有效：别用 `npx asar extract-file`，它会把文件解到当前目录。）

**还没证的**：① 真库那一次仍然没跑（#97 等点头）—— 而且 ⑥ 之后它的形态变了：
**他装上含 ⑥ 的版本、第一次打开，程序就会自己动他真库的账**（不搬文件、可撤，但那确实是他的真数据），
所以"先给证据再点头"这条比 ② 时更要紧；② 英文 / 日文界面的告知条没截图核过；
③ 0.3.0 已发布，本轮改动让它落后 —— 重出包与发版要他点头（#99 那条"覆盖安装到他的机器上"也还没做）；
④ 告知条收起之后**没有**第二个入口找回那三颗按钮（撤销要靠 Ctrl+Z 或设置里那一栏）——
这是"不挡路"换来的代价，按字面实现成这样是有意为之，但它算不算对，得他装了真用几天再说。

**顺带从截图里看见的一条**（不属 ⑥，单独记）：界面文案里还留着内部代号「A」
（`settings.autoLaunchHint`、`collections.backfillEmptyHint`、`wizard.step*`、`err.selfIngest` 等，
zh 二十来条、en 八条、ja 十几条），第 8 轮改名只改了 README 和发布页。→ 任务 #102。

M1 交付的是骨架：窗口能开、三栏界面、三语 i18n、托盘 + 单实例 + 全局热键、SQLite 全表建好、外置分类表读通、工程发现落库。
M2 交付的是"拖进去 → 认格式 → 手工分类 → 归档落库 → Ctrl+Z 真撤销"这条最小可用链路。
M3 把它换成**自动**：读内容（含内层 unitypackage）→ 打分分类 → 归并 / 拆分 → 高置信直接归档，低置信进待确认，你改过的它记住。算法与调试见 `docs/CLASSIFY.md`。
M4 前半交付的是"找得到 + 认得出"：拼音 / 假名 / 罗马字 / 驼峰 / 版本号都能互搜的内存索引，以及卡片封面（含从 `.unitypackage` 里抠卖家自己的 preview）。实现与已知边界见 `docs/SEARCH.md`。

**已经"真的能用"的部分**

| 能力 | 状态 |
|---|---|
| 主窗口 / 侧栏 / 状态栏 / 详情面板骨架 | ✅ 已截图核对 |
| 简体中文 / English / 日本語 切换 | ✅ 已截图核对（含分类表的日文名） |
| 深色 / 浅色主题（CSS 变量，一套语义色） | ✅ |
| 数据库 17 张表建表 + 增量迁移框架 | ✅ 真库已生成并读回验证 |
| 分类表外置 JSON（15 个一级 / 94 个二级，三语） | ✅ 不硬编码 |
| Unity 工程发现（ALCOM 清单 + 扫盘，取并集） | ✅ 真机识别 8 个，正确跳过 `_backup_*` 与 `.rar` |
| 拖放 / 命令行 / 右键菜单 / 监视文件夹四种入口 → 路径校验 → 摄取队列 | ✅ worker_threads 里跑，主线程不卡 |
| magic bytes 认格式（不信扩展名）+ 分卷识别 | ✅ `.rar.rar` 认成 RAR5 |
| 包内文件名 cp932 / GBK 解码（打分选优，不靠 try-catch） | ✅ 用真件核对，`FREE無料-…` 不乱码 |
| 展示名清洗（数字 id、双层扩展名、版本号、括号备注） | ✅ 验收件 → `Shinano FaceAnimation` |
| 加密包：停下来问密码，输对再列清单 | ✅ 真 7z `-mhe` 包走通 |
| 查重（xxh64 全文件 / 抽样指纹）→ 三选一 | ✅ |
| 归档落库（模板目录 + 侧车 `.avca.json`）| ✅ 沙盒实测 4 件 |
| `Ctrl+Z` 整批撤销，文件搬回原位、库记录删干净 | ✅ 沙盒实测撤销后 inbox 复原，网格跟着刷新 |
| 监视文件夹（chokidar + 3 秒合并 + 半成品过滤 + 去重） | ✅ 真丢文件实测自动排队，5 项单测 |
| 资源管理器右键"发送到 Atrium"（HKCU，可一键移除） | ✅ 登记/读取/移除全程实测，注册表已还原 |
| 打包版跑通（worker 依赖、托盘文案、日志目录三处只在打包才暴露的坑） | ✅ 见下面"硬约束 8/9/10" |
| 内容指纹：元数据抽取（URL/Booth id/版本/作者/封面）+ 语料加权 + §1.1 硬规则 | ✅ 见 `docs/CLASSIFY.md` |
| `.unitypackage` 流式深度解析（只读 pathname，主体跳过） | ✅ 真件 + 现场造的包，12 项 |
| 内层包按需单读（不解压也能读 readme / .url / unitypackage） | ✅ Grimoir 从 `other/0%` → `服装/套装 82%` |
| 自动分类六步 + 置信度分档 + 人话理由（i18n 结构化） | ✅ §7 十条验收特例逐条过 |
| 资产归并（11 个 Grimoir → 1 组 11 avatar 变体） | ✅ 并查集 + 不许误并的四条单测 |
| 合集拆分（初音的VRC小店 → N 个独立资产） | ✅ 含"一件商品的多个分包不拆"反向保护 |
| 学习机制（改一次就记住，≥3 次提示） | ✅ 含"版本号/泛词不学"的防污染单测 |
| 归档复用他自建目录（库里有 `衣服` 就不再建 `服装`） | ✅ 沙盒实测落 `衣服/套装/…` |
| 种子词典 854 条（构建时校验分类 key，写错即 fail） | ✅ `npm run lexicon` |
| 集合的创建 / 改名 / 关键词规则存储 | ✅ |
| 跨脚本检索：拼音 / 假名 / 罗马字 / 驼峰后半截 / 版本号 / 拉丁容错 | ✅ MiniSearch 内存索引 + 别名表，活体 14 组查询核对 |
| 检索索引增量更新（改名 / 改分类 / 入库 / 撤销 / 删除都跟着走） | ✅ 不留"搜得到点不开"的幽灵卡片 |
| 卡片封面（散图 → 包内 `preview.png` 两级兜底，`athumb://` 自定义协议） | ✅ 真界面截图核对，见 `docs/screenshots/m4-covers.png` |
| "N 变体"徽章数的是组内素材份数，多体型算兼容性标签 | ✅ 修掉一张卡标"12 变体"的谎报 |
| F9 库健康检查：僵尸 / 完全重复 / 封面相似(dHash) / 游离文件 / 大文件排行 / 孤儿变体 | ✅ 扫描只读，17 项单测 |
| 僵尸条目**只标记不删**、重复项**只列不删**、游离项一键送回摄取队列 | ✅ 设置 → 维护，真界面截图核对 |
| 从 `.avca.json` 侧车补回丢掉的库记录 + 重建检索索引 + 清游离缩略图 | ✅ 沙盒实测（补 0 条 / 索引 4 条 / 缓存 3 张） |
| 单实例锁、关窗缩托盘、托盘菜单、`Ctrl+Alt+A` | ✅ |

**明确没有的东西**（UI 里都写了"在 Mx 交付"，不假装成功）

先说清一件更容易害人的事：**下面每一条都注明了"没做到哪一步"**，因为"❌ 没做"和"❌ 后端通了但界面没接"是两件完全不同的事——前者会让人重做，后者会让人以为产品还缺整块。

- 🟡 **M7 三件（第 7 轮 ①–⑧ 全部落地）**：① **首次启动的 3 步向导已落地并在打包版真跑过**（规格 01§8；实做 3 步 + 1 收尾：库位置含"接管已有库 / 建空库"二选一、素材来源目录、一屏批量装桥接、常驻托盘收尾），判据全在 `src/shared/wizardState.ts`（**38 条用例 + 29 处变异回扫全钉住**，`tools/verify-red-m7.cjs`；对账表 `M7_RULES` 42 条在册）；**⑧ 用 `tools/live-m7-packaged.cjs` 在 `dist\win-unpacked\Atrium.exe` 上把 §6.2 那六条全跑完**（四场 91 条判据 0 红，截图 `docs/screenshots/m7-pkg-*.png`）：接管之后整棵树 md5 一字不变、没勾的工程连 `Packages/` 都不建、重启不再出现向导、跳过之后侧栏入口还在、8 个工程一次冒出来问完为止；② 密码用 `safeStorage` 加密保管（规格 01§安全）——**⑥ 落地 + ⑧ 真机验过**：勾「记住这个密码」→ DPAPI 加密进 `password_vault`（那张表从 V1 就建好、一直没人读写），下次撞见同一个包自己就试；**真 `-mhe` 加密包上跑通了"记住 → 杀进程重启 → 不再问"，还加了一条反证（删掉库里那行必须重新问）**；解不开 / 存不了都照实说，**加密不可用时什么都不写、绝不退回明文**；命令行 `-p<明文>` 那处泄露是乙档，单独立一件；③ 代码签名——`signAndEditExecutable: false` 是这台机器的硬约束，装的时候 Windows 会提示"未知发布者"
- ❌ **一次导完两批之后，界面只能退回最后那一批**（第 4 轮活体实测）：「整批退回」用的 batchId 来自当前结果卡，第一批再没有入口 —— 活体里是把第一批撤了 8 行没错，但**撤它用的是 IPC 后门，不是用户路径**。一批一条 `batch_id` 是 M5-B ④ 定的账目形状，不该改；要改的是界面（结果卡上列出"这一轮 N 批"一起退）。**第 6 轮裁定 Q11 = 甲，第 7 轮按裁定没做**（它和向导不是同一条链，硬塞进首启这一轮会让验收多出一堆变量）→ 任务 #74，对账 `M7-41`
- ❌ **真 Unity 撤销之后，导入时新建的空目录和它们的 `.meta` 留在工程里**（第 4 轮实测：`Manuka.meta`、`Shinano/Pose.meta`…）：这次新建的**资源**删干净了，Unity 下次刷新会自己忽略这些孤儿 `.meta`，不影响功能但工程树里看得见。要修得先让 A 分得清"哪些目录是这次导入建的"，而 `list_project_assets` 只回包名 —— 和下面 `bridgeVersion 1.1.0` 那条是同一处
- ✅ ~~用户改的分类口语存在安装目录里（升级即丢）~~ —— **第 3 轮改完并在打包版真跑过**：内置表现在**只读**，用户的加减存成增量落在 `AVCA_APP_HOME\categories.user.json`（154 字节 vs 内置表 34.5 kB），读的时候叠在内置表上；界面上改到标签或加二级分类会**当场报错**而不是悄悄丢。打包版实测：保存前后内置表哈希不变、把安装目录那份换成"v2"再重启之后合并结果 = 新表 ∪ 用户加减。细节与那条假绿的教训见 `docs/VERIFY-UNVERIFIED.md` §9
- ✅ ~~全新安装第一次会连着弹 N 个"要不要装桥接"~~ —— **第 7 轮 ③ 收掉了**（Q9 乙 + Q10 甲）：向导第 ③ 步把发现的工程**一屏列出来、默认全勾**，只给勾上的装（实测 3 个假工程勾 2 个 → 只有那两个长出 `Packages/com.avca.bridge/`，`Assets/` 一字未动）；运行期弹窗另外补了一颗 **「剩下 N 个都不再问」**，点它给队列里其余每个工程**各写一行 `never`**（库里恰好两行、屏幕上那条没有行、也没有任何"全局静音"键 —— 判据仍然只有一个真相来源）。顺带修了一条手动装桥接**不出队**的缺陷（活体撞见：向导装完，弹窗照旧问"这个工程还没装桥接"）。逐条见 `docs/M7-DESIGN.md` §10
- ✅ ~~打包版从没跑过 R4 全链~~ —— **第 2 轮（2026-10-07 晚）跑完了，①–⑦ 在 `dist\win-unpacked\Atrium.exe` 上全部重跑通过，产品缺陷 0 条**。翻出来的是三条非代码问题（上面两条 + 活体脚本自己的时序坑），逐条见 `docs/VERIFY-UNVERIFIED.md` §8
- ❌ LLM 兜底（§5.5，默认关闭，完全未做）
- ❌ 依赖分析结果的上文展示（"此素材依赖 3 个外部资源，2 个在你的库中"）
- ❌ 库健康检查的**重复项自动清理**（现在只列不删，删哪份由你决定；规格 R-84 本来就要求"只提示不删"）；pHash 只比封面图，不比非图片素材
- ❌ 内置那 854 条词典词条**只读**：界面上能加自己的词条、能删已学规则，但不能改内置表
- ❌ 汉字→日语读音的检索（`sokubaku` 搜不到 `束縛`）——**这是裁定，不是漏做**（R4 Q5）：要 Kanji 读音词典、几 MB 体积、多音字照样错，收益不值。收口写进 `docs/SEARCH.md` §4，并把"把原名写进备注"这句提示做进了改分类/改备注的文案里
- ❌ 工程指纹里 `topFolders` / `avatarDescriptors` 那两段：**当前拿不到**，不是没写。M6 裁定这一轮不改 C#，而仓库里的 `ListProjectAssets()` 只回 `installedPackages`、`BridgeVersion` 还是 `1.0.0`，所以 `bridgeVersion ≥ 1.1.0` 那道闸门永远判旧 → 真机上人人都记 `bridgeTooOld`。要点亮它：改 C# 两处 + 重装桥接，TS 一行不用动（见 `docs/BRIDGE.md` §13.3）
- ❌ F8 的 **GUID 增量索引**（R-85）：`project.guid_index_at` 那一列至今无人写，桥接侧的"导入后增量刷新"没做。所以反查只能回答"A 导过哪几次"，答不了"工程里现在有哪些 GUID" —— 要答得改 C#（`list_project_assets` 只回包名、`resolve_guids` 不枚举），与上面那条 `bridgeVersion 1.1.0` 是同一处
- ❌ 真库那 5 张"单模型却没 avatar 变体"的存量卡补不上：R4 ⑤ 修的是**新入库**的大小写双胞胎，而「重新归并」只重建被拆开的组，不补这种"组没拆、变体行缺失"的存量。要补得另开一条"重建变体"的路（未验证）
- ✅ ~~改分类不搬文件 / 类别口语不进索引 / 变体分列 / 多选卡批量导入 / 首次发现工程不弹桥接窗 / 跨工程反查~~ —— **R4 ①–⑦ 全部交付**（2026-10-07），每件都有沙盒活体与图：批量导入串行+进度+整批退回（§8-4）、改分类预览→搬→Ctrl+Z 整批回（含"新词当场搜得到"）、`yifu`/`ウェア` 搜到「服装」、一张多体型卡按维度分列、详情面板「在哪些工程装过」、首次发现工程弹三按钮 `[安装] [以后都自动安装] [暂不]`
- ✅ ~~Unity 桥接、批量导入、自动切换集合（M5 / M6）~~ —— M5-A（桥接 + 单包导入 + 三路运行状态）、M5-B（压缩包成员提取 + 串行导入 + 整批倒序撤销）、M6（自动切集合 + 顶部横幅 + 托盘唤醒）已交付；设计与验收见 `docs/M5B-DESIGN.md`、`docs/M6-DESIGN.md`、`docs/BRIDGE.md` §12–§14
- ✅ ~~M6 那三条"只有真机能答"的欠账：托盘唤醒置顶 1.2 秒 / 「以后都自动安装」第二次命中 / §8-11 真 none~~ —— **第 5 轮三条全过（8/8、8/8、10/10），而且置顶那条是先抓到一条真缺陷才过的**：`wakeForProject()` 把"窗口是不是藏着的"读在 `createMainWindow()` **之后**，而那个函数在窗口已存在时会顺手 `show()+focus()`，于是判据恒为 false → `setAlwaysOnTop(true)` 和那句唤醒日志**一次都没执行过**；窗口能从托盘弹出来纯属那个副作用的巧合，恰好把"没生效"盖住了。改完实测 127 个 100ms 样本里置顶连续 11 个为真 ≈ **1185ms**（Q6 裁的 1200ms）后自动取消；窗口本来就开着时 82 个样本 0 次置顶（不骚扰）。「以后都自动安装」是**把 A 整个进程关掉再起来**之后命中同一行设置、静默装好、不再弹窗。为什么那时 1279 条用例全绿还留了这么久：`window.ts` 顶层读 `app.isPackaged`，node 环境 import 就炸 → 补了 `tests/project/wake-order.spec.ts`（静态查顺序 4 项）并进回退验证器 **L1**。逐条见 `docs/VERIFY-UNVERIFIED.md` §11
- 🟡 **唤醒只把窗口顶到最上面，焦点没跟过来**（第 5 轮实测：唤醒期间 **0/127** 个样本 A 是前台窗口）：规格 §4.3 那句"弹出主窗口并置顶"按字面已满足，而 M6 的 R-51 本来就裁定"凭一条检测到 Unity 去抢焦点是骚扰"。**第 6 轮 Q6 已裁：甲 —— 保持不抢焦点**，验收口径就写成"置顶约 1.2 秒、不动焦点"（`M7-25` 在册，时长用常量一处能改）。要改成"抢回来"得走 `AttachThreadInput` 那一类，本轮不做
- ✅ ~~「要让 A 开机常驻托盘吗？」那个模态会和别的判据叠在同一屏~~ —— **第 7 轮 ⑤ 收掉了**（Q8 甲）：这一问从运行期模态降级成**向导的第 ④ 步（收尾）**，答"是"或"否"都算答过、之后不再骚扰，`autoLaunch` 默认仍是 false（M6 Q3 那条结论没改）。**故意偏离设计 §3.7 的一处**：`AutoLaunchAsk` 的 `sawUnityStart` 前置**没摘** —— 走完第 ④ 步的人 `autoLaunchAsked` 已为 true，那条模态自然不再出现；而**跳过**向导的人值得在"第一次真的看见 Unity 启动"那一刻被问一次（那时问题才有意义），摘掉前置只会让它在没装 Unity 的机器上白问一次。理由记在 `docs/M7-DESIGN.md` §10 的 ⑤ 那张表

---

## 怎么跑

```bash
cd C:\程序\A素材管家
npm install              # .npmrc 已锁 npmmirror，且 ignore-scripts
npm run setup            # 下载 Electron 本体 + 两个 ABI 的 better-sqlite3 预编译包
node tools/fetch-7z.cjs  # 拉 7-Zip 到 resources/bin（含 RAR 解码器；许可不允许二次分发，所以仓库里没有）
npm test                 # 全量单测（自动切到 Node 版 .node）
npm run dev              # 起开发窗口（自动切到 Electron 版 .node）
npm run dev:debug        # 同上，多开一个 CDP 端口 9222，验收脚本要用
```

⚠ **第三步不能省**：`resources/bin/7z.exe|7z.dll` 不在仓库里（7-Zip 的 LZMA 部分是 LGPL，但里面的
Rar 解码器是 unRAR freeware 许可，不允许二次分发）。没拉的话 `tests/unpack/*` 与
`tests/import/container-packages.spec.ts` 里几份要真 7z 的用例会报「没找到 7z：…（跑 node tools/fetch-7z.cjs 拉一下）」——
那是环境缺件，不是产品坏了；`tests/unpack/real-archive.spec.ts` 那条已经改成缺件时**跳过并打一行响的**。

`npm test` 和 `npm run dev` 会互相覆盖 `node_modules/better-sqlite3/build/Release/better_sqlite3.node`，这是有意的：Node 24 是 ABI 137，Electron 33 是 ABI 130，一个文件只能放一个版本。两个都缓存在 `vendor/prebuilds/`，切换是本地拷贝，不重下。

**验收用的两个脚本**（`npm run dev:debug` 起好之后）：

```bash
node tools/cdp-eval.cjs "document.title"          # 在真界面里执行 JS：点按钮、填输入框、读 DOM
node tools/cdp-eval.cjs --targets                 # 看有哪些页面
powershell -File tools/shot.ps1 -ProcName electron -Nudge -Out out.png   # 截图
```

---

## 这台机器上的硬约束（换机器时重点检查）

1. **GitHub 的 release 下载不通**（实测 `TIMEOUT`）。Electron 本体和 better-sqlite3 预编译包默认都从 GitHub 拿 → 一律改走 npmmirror，见 `tools/setup-native.cjs`。
2. **`registry.npmjs.org` 取整份 packument 会超时**（实测 136 秒 / ETIMEDOUT）。项目内 `.npmrc` 固定 `registry=https://registry.npmmirror.com`。
3. **本机有 VS2022 的 MSVC 但没有 Windows SDK** → 原生模块源码编译这条路走不通，只能用预编译包。
4. **`7zip-bin` 自带的 `7za.exe` 不含 RAR 解码器**，而库里有 23 个 rar（含验收件 `6117553 Shinano_FaceAnimation.rar.rar`）。M2 的做法：随包带完整 `7z.exe + 7z.dll`（LGPL），并在运行时探测用户已装的 7-Zip / WinRAR 兜底。
5. **`p-queue@6` 的 CJS 产物是 `exports.default = PQueue` 且不带 `__esModule`** → 打包后 `new PQueue()` 直接炸。已换成自研的 `src/main/lib/queue.ts`（只用得到并发闸门）。
6. **外部解压进程必须关掉 stdin**：头部加密的 7z 会打印 `Enter password (will not be echoed):` 然后从 stdin 读密码，`execFile` 默认的常开管道会让它永远挂着（实测孤儿 `7z.exe` + 摄取卡死）。
7. **窗口被别的程序挡住时 Chromium 不绘制**：`PrintWindow` 会返回上一帧旧画面，`SetForegroundWindow` 又被系统焦点保护拒绝。截图一律加 `-Nudge`（最小化→还原，逼它出新帧），别信没加 `-Nudge` 的截图。CDP `Page.captureScreenshot` 在窗口不可见时**直接挂住**（`fromSurface:false` 也没救）。
8. **`worker_threads` 的依赖必须内联**：worker 脚本读不了 asar，只能从 `app.asar.unpacked/out/main/worker.js` 起，于是它的 `require('hash-wasm')` 再也回不到 asar 里的 `node_modules` → 打包版一摄取就 `Cannot find module`。dev 永远撞不到（都在磁盘上）。修法见 `electron.vite.config.ts` 里 `externalizeDepsPlugin({ exclude: [...] })`。
9. **主进程读不到渲染进程 bundle 里的 JSON**：托盘文案以前按 `resourcesPath/src/renderer/i18n` 找，而 `files` 只打了 `out/**` → 打包版每次刷托盘记一条 ENOENT 再退回硬编码中文。现在这三份语言文件走 `extraResources` 到 `resources/i18n/`，由 `P.i18nFile()` 统一找。
10. **electron-log 默认按应用名开目录**：打包后写去 `%APPDATA%\Atrium\logs`，而说好的日志位置是 `%APPDATA%\A\logs`。已用 `resolvePathFn` 钉死，并把 `initAppPaths()` 提到 `setupLogging()` 前面。

> 8/9/10 全是**只有跑打包 exe 才暴露**的问题 —— 所以每个里程碑收尾都要用 `dist\win-unpacked\Atrium.exe` 真跑一遍，不能只看 dev。

另外几个反复咬人的：

- **正在运行的 Electron 会锁住 `better_sqlite3.node`**，此时切 ABI 会 EBUSY。脚本会明确提示先跑 `tools/killdev.ps1`（它现在也顺手清掉卡住的 `7z.exe`）。
- **`ready-to-show` 偶发不触发 → 窗口建好了但一直不可见**（实测撞上一次：日志显示渲染进程已加载、React 已挂载，但 `IsWindowVisible=false`）。现在除了 `ready-to-show` 还在 `did-finish-load` 后 1.2 秒兜底 `show()`，并把窗口状态写进日志。别把这个兜底删了。
- **`.ps1` 里不许写中文注释**：Windows PowerShell 5.1 按 ANSI(cp936) 读脚本，UTF-8 中文的字节会把后面的引号吃掉，表现为 `})` 处语法错误（实测咬过 `killdev.ps1`）。
- **`Intl` 的字节单位是 `byte` 不是 `bytes`**：写错时小于 1KB 的文件一进界面就抛 `RangeError`，React 整棵树卸载 → 全白窗口。现在 `main.tsx` 外面套了 `ErrorBoundary`，一个组件写错不再让程序消失。
- **在 bash 里内联写带反斜杠的 Windows 路径必翻车**（`\v` 会被吃成控制字符）。要改用 `tools/set-settings.cjs`。

占盘实测：`node_modules` 584 MB + `vendor` 116 MB（缓存着 Electron 发行包和两个 ABI 的 `.node`，删掉 `vendor/cache` 可以回收约 100 MB，下次 setup 会重下）≈ **700 MB**，都在 C 盘。

---

## 目录结构

```
src/
  main/         主进程：db / ipc / ingest / library / security / services / project / unpack / lib
    vpm/        VPM 外壳（默认关闭，独立设置/数据根；P0 只有 gate/config）
  preload/      contextBridge 白名单，window.a 是唯一入口
  renderer/     React：pages / components / stores / i18n / lib
    vpm/        VPM 设置面板（懒加载）
  shared/       主进程与渲染进程共享的类型、IPC 通道名、设置默认值、ULID、展示名清洗(naming.ts)
    vpm/        VPM 纯逻辑：错误码、数据根校验、设置/状态类型
resources/
  lexicon/categories.json   外置分类表（15 一级 / 94 二级，三语）
  bin/                      解压后端二进制（7z.exe + 7z.dll，带 RAR）
  unity-bridge/             桥接包模板（M5 写入）
tools/
  setup-native.cjs  下载并摆放 Electron + 两个 ABI 的 .node
  fetch-7z.cjs      从 7-zip.org 的安装包里抽 7z.exe/7z.dll 并自检 RAR 支持
  make_icon.py      生成 build/icon.{png,ico}（几何画的 A，不依赖字体）
  make-shortcut.cjs 建桌面 .lnk（图标显式指到 icon.ico）
  shot.ps1          PrintWindow 抓真窗口截图（-Nudge 才会逼 Chromium 出新帧）
  cdp-eval.cjs      在跑起来的界面里执行 JS：真点按钮、真填输入框
  cdp-shot.cjs      CDP 截图（窗口在前台时才出帧，一般还是用 shot.ps1 -Nudge）
  killdev.ps1       杀本项目的 electron.exe / Atrium.exe + 卡住的 7z.exe
  add-i18n-keys.cjs 往三份语言文件合并 key（只补不删，防三语漂移）
  set-settings.cjs  改 %APPDATA%/A/settings.json
  probe*.cjs        网络可达性探针
tests/            Vitest，256 项
```

---

## 快捷键

`Ctrl+K` 搜索 · `Ctrl+Alt+A` 迷你投放窗 · `Enter` 导入选中 · `Ctrl+Z` 撤销上一步 · `Ctrl+A` 全选 · `Delete` 移入回收站 · `Ctrl+1..9` 切到第 N 个集合 · `Esc` 清空选择

---

## 怎么收编一个已经存在的库（`E:\vrc\A` 这种）

流程本身已经能用了，但**先照这个顺序来**，别一上来就对着真库按：

1. **先复制一份**。收编会搬文件，`E:\vrc\A` 实测 2289 个文件 / 24.3 GB，复制一份再动（文档 00 §六 也是这么写的）。
2. **设置 → 库 → 把「高置信度自动归档」关掉**。这样收编进来的东西**全部进待确认**，一张卡一张卡看过、点确认才搬。实测关掉之后收编 10 件，磁盘上 50 个文件**一个都没动**。
3. **设置 → 维护 → 扫描库 → 重新登记**。它扫的是"库根下面没登记过的目录"，喂进取物队列后走的还是**解压 → 分类 → 归并**那套，不是把现状原样锁进库。
4. 想反悔就 `Ctrl+Z`。**注意一次只回一批**：实测 7 件自动归档要按 7 次才全撤干净。

沙盒实测（`node tools/make-reclaim-tree.cjs` 造了一棵照真库层级抄的树：50 文件 / 97 MB，含同产品 3 个体型、rar 套 rar、已解压成 42 个散文件的插件目录、按 Booth id 命名的混装件）：

| 环节 | 结果 |
|---|---|
| 扫描粒度 | 报出 10 个单元，正好是"件"的层级；`插件道具合集-初音的VRC小店`（顶层）和 `插件17件`（二级）**没有**被当成一坨报上来 |
| 分类 | 3 个 Grimoir 目录 → `服装/套装` 1.00 并归并成一组；42 个散文件的目录 → 认出 `com.avca.advsettings` 判 `插件/编辑器类` 0.95；混装件里的 2 件 → 0.30 进待确认 |
| 查重 | 内容重复的那件标成"重复"，没另立一张卡 |
| 撤销 | 按 7 次 Ctrl+Z 后，50 个文件**全部回到原路径、大小一致**，没丢、没多、没留空壳目录 |

过程中修掉两个真会咬人的 bug：

- **「重新登记」以前一条都进不去。** 路径校验对"库根下面的一切"一刀切拒绝（防自摄），而游离文件按定义就在库根下面 —— 于是永远 `accepted=0`，界面还照弹"已丢进取物队列：10"。现在改成拿已登记清单判断：已登记素材本身/其内部要拒，会整吞已登记素材的父目录要拒（`err.containsRegistered`），库根下没登记过的放行；提示语也改成如实报 accepted / rejected。
- **撤销会卡在解压内容上。** `extract` 那条 journal 的"原位置"是暂存目录，撤销时它通常还在，于是抛"原位置已被占用"、整条撤销链停住（实测撤到第 8 批就动不了）。现在 `extract` 撤销按"送进 hold"处理，不再试图搬回暂存。

还**没做**的（任务 #25 剩余）：收编后清掉旧结构留下的空壳目录。
（「一次撤销整批」和「先预览再排队」已经在 R2 里做掉了，见下面。）

### R2：三级合集模型 + 一键入库（增量改动单，2026-10-05 下午）

改动单覆盖了原规格的第 2 份 §4（合集拆分）全部内容和"低置信度必须人工确认才能入库"这条阻塞行为。
现在库是**三级**：`合集 Bundle ─ 子项 Item ─ 版本 Variant`，全部落在 `asset` 一张表里靠 `parent_asset_id` 自引用
（改动单 §7.2 明确不许有平行表，老的 `bundle` 表和 `asset.bundle_id` 就此废弃、只留着不删）。

| 改动单 §6 验收 | 实测结果 |
|---|---|
| 1 一键入库 10 秒内完成 | **151 项 1.0 秒**（沙盒 17 项 0.665 秒），收件箱清空、59 项标待复核、0 失败 |
| 2 自动归档开着时必须二次确认，默认按钮是"只登记" | 三选弹窗，焦点就在「仅登记分类，不移动磁盘」上（`autoFocus`） |
| 3 初音的VRC小店 = 1 张卡 | 收件箱一张卡「识别为合集 · 含 135 项」+ 内联 5 行「还有 130 项…」；库里也是一张卡 |
| 4 StoZeroCustomEX = 1 子项 / 3 版本 | 合集详情里 `StoZeroCustomEX → 3 个版本 [1.10, 1.01, 无]` |
| 5 武器合集穿透 ID 目录 | 子项名是 `INVICTA` / `M4A1` / `MP5` / `AK12`，`4952737` 只当疑似来源 |
| 6 Grimoir 11 体型 = 1 子项 / 11 avatar 变体 | 「重新整理合集」把 `衣服/27` 的 13 条并成 1 合集 3 子项，Grimoir 那条带 11 个版本 |
| 7 ABT 左手用 / 右手用 = 2 个子项 | 3 个分包 → 3 个子项，没被并成版本（左右手不在变体词表里） |
| 8 `v1.10` 排在 `v1.9` 前面 | `shared/version.ts` 按数字段比，`listVersions()` 用它排序 |
| 9 「重新整理合集」能吸回已拆开的 | 预览「13 个素材 → 3 个子项」→ 执行 → 撤销，全程磁盘零改动 |
| 10 撤销一次全部入库，全部回收件箱 | 151 步一次撤完，365 行库记录删除，**收件箱 151 张卡全部回到"等你确认"** |

**一键入库干的事**：按引擎给的第一选择登记，低置信度**不再阻塞**，改成 `asset.needs_review=1`；
侧栏「待确认」改名「**待复核**」并按这个计数（只数顶层，一个合集不许被数 135 次）；
「全部入库」的范围可选（当前筛选结果 / 仅置信度 ≥0.75 / 全部），N 跟着搜索框走。
**默认一个文件都不搬** —— 只有二次确认里点「移动并入库」才会动盘。

### R2 里逼出来的五条修正（都不是小修）

- **合集判定不能再"拆成顶层素材"**：`classify/bundle.ts` 整个重写成产出树。新增判据③"目录名是容器名"
  （`道具22件` / `プラグイン17件` / `更新` / `重要！`），新增 **Booth 数字 ID 目录穿透**
  （`4952737/INVICTA/…` → 子项叫 INVICTA，ID 只当疑似来源）。版本归并**只在同一层做** ——
  跨层归并会把 `ERP用12件/DPS.zip` 和 `道具16件/DPS.zip` 并成一项，名字对了路径丢一半。
- **`looksLikeOneProduct` 不再用来否决合集**（旧版靠它挡 ABT 被拆）。因为新版"合集"只是一张卡、
  不动磁盘，代价几乎为零，而改动单 §6.7 反过来要求左手用/右手用是 2 个 Item。
  它现在只用来标 `oneProduct`（一件商品的几个部分 → 合集那行置信度打 0.9 折）。
  取而代之的护栏是 **Unity 结构目录表**（`Mesh` / `Textures` / `Prefabs`…）：
  不排掉的话一件衣服的目录会被判成"含三个素材的合集"。
- **游离扫描的粒度**：`{分类}/{二级}` 是结构不是素材，所以只报 depth≥3；但顶层的
  `插件道具合集-初音的VRC小店` 因此会被一路钻碎。改成"名字写着合集/容器词的，二层也算一个单元"，
  真库报出来的单元从 **228 降到 151**（两个顶层合集各从几十个碎片变成 1 个单元）。
  只有一个孩子的容器例外 —— 继续往下钻，否则 `道具22件/6159895…/` 会把真正的商品埋掉。
- **索引模式（只登记）以前不写 journal**，于是 Ctrl+Z 无事可撤。新增 `op='register'` 并进 `lastRevertible` 白名单，
  不然"全部入库 151 项"根本撤不回来。撤销时按 `payload.assetIds` 删记录、摄取层监听 `EV_UNDONE` 把卡片退回收件箱。
- **撤销失败不许冒充成功**：`markUndone` 以前失败也写 `undone=1`，于是库里效果还在、账本说撤过了，
  整条链从那儿断死（实测把沙盒的 38 条记录钉成了清不掉的残留）。现在失败只记 `status='failed'` + 原因，`undone` 保持 0。
  顺带修了撤销"解散合集"时的外键顺序：必须**先把被删的合集行塞回去**，再把子项的 `parent_asset_id` 指回去。
- 另外修掉一个 M2 就存在的名字 bug：`佳兔工具箱v2.7.0版本` 被洗成 **`佳兔工具箱.0版本`** ——
  版本号正则的 lookahead 只认"结尾或分隔符"，遇到紧跟的汉字就回溯把 `2.7.0` 砍成 `2.7`。
  现在边界认中日韩字，孤儿"版本"两字也跟着版本号一起走 → `佳兔工具箱` / `v=2.7.0`。

新增自检：**`tests/renderer/ipc-channels.spec.ts`** 扫真实源码，要求每个 `ipc.handle('x:y')` 都在
`IpcInvoke` 白名单里、每个 `broadcast` 都在 `IpcEvent` 里、且白名单里没有主进程没实现的死通道。
这条一上线就抓到三个：`assets:bundle` 等两个新通道忘了登记（一点就报"通道不在白名单"，
而 tsc 和所有单测全绿 —— 因为它们不经过 preload），以及 `ingest:pause` / `ingest:resume` 两个从没实现的死通道（已删）。


### 真库收编实录（2026-10-05）

`E:\vrc\A` 已经按上面的顺序在跑，不是沙盒：

| 批次 | 内容 | 结果 |
|---|---|---|
| 贴图 | 364 个游离文件 | 8 项确认入库（3 项垃圾图忽略），落点 `贴图/` 下按分类建目录 |
| 其余全部 | 228 项（151 文件 + 77 目录） | **228/228 全部登记成功、0 拒绝**，走完解压→读内容→分类，停在待确认；`autoArchive` 关着所以**磁盘上 2297 个文件一个字节都没动**（前后快照按"名字+大小"多重集比对，差异为空） |

228 项分出来 343 个单元（23 项被识别为合集拆开了）：`插件` 149、`服装` 98、`道具` 31、`着色器` 17、`贴图` 14、`参考资料` 11、`材质` 6、其余零散。置信度 ≥0.75 的 126 个（开了自动归档就会直接搬），0.5–0.75 的 94 个，<0.5 的 123 个 —— 也就是说**真库首次收编确实必须人工过一遍**，一半以上引擎没把握。47 项含内层 `.unitypackage`，靠递归解析才分对。

这一轮又挖出两个 bug，都是"看着像卡死"那一类：

- **zip 里只要有 `Readme.txt` / `.url`，那个任务就永远不动。** 228 项里 226 项 30 秒完事，剩下两个停了十分钟，主进程 CPU 采样 0%（不是死循环，是在等一个永不 settle 的 promise）。根因：`readZipEntryText` 等的是 yauzl 的 `'open'` 事件，而 `open()` 已经把那个事件当成 promise 的 resolve 用掉了 —— 监听器挂上去时事件早发完，`readEntry()` 没人叫，既不报错也不返回。**这条路径从 M3 起对 zip 就是静默失效的，而且一条测试都没有**（`extractMetadata` 的单测走的是目录读取器，绕过了它）。修法照 `listZip`：挂好监听直接 `readEntry()`，外加 15 秒看门狗（元数据只是加分项，永远不该把摄取挂死）。补了 `tests/unpack/zip-single-read.spec.ts` 6 条。顺带的收获：以前读不到的 readme 现在读得到了，`AdvancedSettings-5.8.11.zip` 从 `插件/编辑器 0.95` 变成更准的 `工具软件 0.95`（它其实是 Qt 工具，readme 里 19 个 URL 说得很清楚）。
- **暂存目录只长不消，而它在系统盘上。** 读内层 `.unitypackage` 会先抽到 `%APPDATA%\A\staging/<id>/_dig`，以前**没人删**：实测 5 个任务留了 182 MB，一次收编几百项会把 C 盘写满。现在三处收口：dig 解析完立刻删、任务取消/失败/丢弃卡片时删整个暂存目录、启动时清扫（任务表是内存态，重启后剩下的必是垃圾）。另外 `extractZip(file, dir, { only: [] })` 以前等于"没过滤条件"→ 整包解压（实测 39 MB 的包解出 933 个文件 / 75 MB），现在空清单就是什么都不解。

界面文案也跟着改实话：一次收编 228 项时顶部写"进行中 228"（其实在等人看）、横幅还挂着开发代号"M3："、空列表提示写"松手即自动解压、分类、归档"（而这两个开关默认都是关的）。现在分成"进行中"和"等你确认"两个数，文案不再承诺没开的事。


---

### R3：附属资源识别 + 分组卡片化浏览（增量改动单 2，2026-10-05 傍晚）

**这一节改的是"库里到底该有几张卡"。** 上一版把介绍图、演示视频、`.cs` 脚本、`.DS_Store`
都当成独立素材扫进了库，一屏里 4 张卡有 3 张是垃圾；同一件衣服的 20 个模型适配版
也只并上了词表认识的 8+2 个，剩下 10 个零散着。

规则层（`src/shared/junk.ts`、`src/main/fingerprint/primary.ts`、`src/shared/naming.ts`、
`src/main/classify/groupKey.ts`）：

- **垃圾过滤进了三处**，少一处都会从别的门灌进来：游离扫描 `findStrays`、
  目录遍历 `listTree`（顺带管住解压后的暂存目录）、压缩包内层清单（worker 读完就过）。
  默认设置是不解压，所以第三条是唯一能拦住 `__MACOSX/` 碎片的口子。
- **主体 / 附属**（§A2）：unitypackage > 完整 Unity 工程 > UPM 包 > 含 prefab·mat·shader·fbx
  的目录 > 压缩包。附属资源落成 `parent=主体 + attachment_kind` 的子行：
  不进库的第一层、不计入素材总数、不参与合集判定，但详情页列得出来、导入能单独勾选。
  不是"隐藏卡片"—— 统计口径和列表 SQL 都把它挡在外面。
- **结构层收口**（§A5）：`{分类}/{二级}` 那种库结构目录，如果里面**平铺**着
  全是脚本（或全是图/文档），整棵报一条，不再散成 N 张卡。
  `flat` 那道闸不能省：`贴图/lime/Custom skin/a.png` 必须照旧报到 `Custom skin` 那一层。
- **取名与版本**（§A3/§A4）：UUID 和长 hex **在提版本号之前**就剥掉。
  原先只在 `cleanDisplayName` 里剥了，`deriveGroupKey` 没剥，于是真库那张
  `d6b99874-… base resized.jpg` 的名字修好了、版本号还是从 UUID 里咬出来的
  `99874-3687-4746-8e`。同一个规则两份实现必然漂走，现在收成了
  `shared/naming.stripIdLike()` 一处，两边共用。
- **方括号变体槽位**（§B2）：`Libero[Shinano_ATTITUDE The Royal Bunny]_1.0` 里
  方括号就是变体位，整段不参与 groupKey；括号里的 `<模型>_<系列>` 结构
  第一段当模型位摘掉，系列名参与 groupKey（不同系列不许被误并）。
  词表认不认识**只决定徽章上写什么，不决定并不并** —— 这是验收 6 能在真库上成立的原因。
- **复合模型名**（§B3）：`Chiffon&Chocolat` 按 `& ＆ + ＋ 、 , ，` 拆；
  真库里还有一个把 `&` 写丢了的 `KipfelMame`，所以补了驼峰拆，
  且**只有每一段都命中词表才拆**（否则 `FaceAnimation` 会被劈成两半、groupKey 再也拼不回去）。

界面层：容器进入式浏览（面包屑可点、Esc 返回、Ctrl+A 全选、Enter 导入、
容器内独立搜索 + 按模型/按版本分组 + 模型徽章 + 附属资源分区）、
§B5 同前缀建议合并横幅（**只建议不自动并**，三个按钮：合并并进入 / 查看这 N 个 / 不再提示）、
§B4「从库中学习模型名」面板。

#### 我对改动单 2 做的三处偏离（都是被真数据逼的，等裁）

1. **§B2 的"括号内容不超过全名 70%"改成只在单位段时生效。** 按原文无条件套用的话，
   §B0 那 20 个文件名里就有 4 个过不去（`Libero[Chiffon&Chocolat_ATTITUDE The Royal Bunny]_1.01`
   是 40/53 = 75%）—— 用他自己给的例子验他自己的规则，验收 6 直接不成立。
   括号里有 `_` 分成 `<模型>_<系列>` 两段这件事本身就证明它是变体位，所以多段只过"括号外 ≥2 字"那道闸。
2. **系列名只取头一个词进 groupKey。** 真库 19 个写的是 `_ATTITUDE The Royal Bunny]`，
   但 `Libero[KipfelMame_ATTITUDE]_1.00` 那个被截短成 `ATTITUDE`；整串留着的话这一个就并不上去。
   系列名几乎总是在第一个词上就分得开，截到头词既不丢"不同系列不许误并"的保护又能容错。
3. **§B4「出现频次 ≥3」在真库上一条都捞不到**（实测），因为 20 个 Libero 是 20 个不同模型
   各出现 1 次。改成两条判据：单名 ≥3 次 **或** 同一系列下候选名 ≥3 个。
   真库靠的是第二条，扫出来 24 个名字（`tools/scan-avatar-tokens.cjs` 留了输出）。

**另外一处规则冲突，我按改动单 1 的旧裁定走了：** §B5 说 `TwinkleSpica` 那 6 个"不自动合并"，
但 §B4 又要求把 `Eku / Ramune` 补进 avatar 词表；补进去之后按改动单 1 §2.3
「只有差异 token 命中已知词表时才算变体」它们就该并。两条对同一批文件给了相反答案。
我按 §2.3 走（Grimoir 那 11 个的既有裁定就是这个口径），§B5 担心的"配色被当成模型"
靠词表区分 —— 真库 `衣服TwinkleSpica` 19 个里 15 个模型名并成一组，
`Mint / Plum / Milk / Karin` 四个词表不认的各自独立。**要不要反过来，等你裁。**

#### 顺手修掉的一个真 bug：容器体积被算成 869 GB

真库那条 `插件道具合集-初音的VRC小店` 存的是 **869.84 GB**，而整个库才 24.3 GB（实测）。
根因在入库：`unitFromModel` 给每个子项兜底用了 `res.sizeBytes` = **整个容器的体积**，
于是 17 个子项各背一遍整包大小，容器那一行再把它们加起来 —— 17 倍，嵌套就是 17²。
改成传子项自己的版本之和；`重新分析` 里也加了体积重算，但**只量目录、文件一律不动**：
压缩包型合集的成员行，`library_path` 指的是那个 `.rar` 自己，按文件量会把每个成员
都改成整包 300 MB（库里存的 4.1 MB 才是对的）。这条是写的时候发现的，不修更错。

#### 重新分析（§交付 4）：按下之前先看到影响条数

`设置 → 维护 → 重新分析已入库的数据`。第一个按钮只跑预览，报
"扫描 N 条 → 会影响 M 条（改名 K）+ 垃圾记录 J 条 + 前 50 条明细"，点了第二个才写库。
只 UPDATE 列，**一个文件都不移动**；写 `reanalyze` 那条 journal，Ctrl+Z 整批退回旧值
（存的是旧值，不是"撤销时再算一遍"）。

真库实测（2026-10-05，跑在 `%APPDATA%\A\library.db` 的**副本**上）：

```
真库副本：asset 373 行 / 素材 154 / 容器 5 / 子项 156 / 附属 0 / 待复核 59
重新分析预览：扫描 373 条 → 会影响 174 条（改名 82，体积重算 39）；
             名字里还挂着 UUID 4 条；垃圾记录 1 条（.DS_Store）
```

**改名这条有闸门**：只在当前名字确实是垃圾（UUID / 长 hex / 还挂着扩展名 /
`.0版本` 那种残骸）时才提议。不加这道闸，`FREE無料-PoseAnimationShinano` 会被
换成从 raw_name 直译出来的 `Shinano100Type ❥ Face&Pose Animations ⌖ ݁˚` ——
那是引擎（或用户手改）挑过的名字，一次"重新分析"就冲掉了。加上闸门之后
"改名"从 219 条降到 82 条，且剩下的全是真垃圾。

**分类（category/subcategory）不在重算范围内**，一个都不碰。要重跑分类请走
「重新整理合集」+ 收件箱重新登记。

**附属资源识别已经在重新分析里补上了**（`planDemotions`）：按"同一目录 + 恰好只有一个主体"
判，把 README / 介绍图 / 演示视频 / `.url` 降级成附属行，不再要求你清库重扫。
闸门故意收紧：`codeOnly` 的目录（比如 `Editor\` 里只有 `.cs` + `.cs.meta`）**不降级** ——
三个不同用途的裸 `.cs` 并成一组是错的（真库实测逼出来的，见下面甲轨那节）。

## 甲轨（真库数据修复）① ② ③，2026-10-05 晚

编号说明见下一节。这三步都跑在**真库**上（① 是你批准的，③ 是修代码 + 在副本上验）。

### ① 真库执行「重新分析」

`%APPDATA%\A\library.db`，执行前备份 `library.db.bak-before-reanalyze-20261005-2055`。

```
[只读预览] 扫描 373 行，耗时 56ms
[影响分布] 重算类 174 行：仅改名 63、仅版本 38、改名+版本 19、其他（variant_raw 等）32、体积重算 22
[影响分布] 附属降级 19 行、垃圾记录 1 行
[附属降级按类型] link 4、doc 7、image 7、video 1
[垃圾] .DS Store @ E:\vrc\A\插件\ABT 1.3.0【汉化 闲鱼@月见汐音】\.DS_Store
[写库] 193 行，耗时 8ms，batchId=01M463ZJX8S75YNTY1C4GD0QKC
[前后对比] 素材 154→135、附属 0→19、容器 5→5、子项 156→156、待复核 59→59、收件箱 0→0
[撤销凭据] journal id=589/590 op=reanalyze 条目数=193
[磁盘核对] 文件数 2297 → 2297，路径与字节数逐项一致（一个文件都没动）
```

执行后口径：**素材 134 / 附属 19 / 容器 5 / 子项 156 / 待复核 59**。
隔一小时再点一次预览，只剩 1 条（`6447797` 的体积）—— 说明这套重算是收敛的，不会反复改。

### ② 待复核 59 条是什么

清单在 **`docs/REVIEW-59.md`**（只读调查，没改产品代码）。一句话结论：
**59 条里 43 条置信度 ≥60%，"待复核"这个名单是 0.75 那条自动归档线切出来的，不是引擎觉得可疑**；
其中 33 条是同一个病 —— avatar 词典缺 5 个名字（shuan / karin / milk / mint / plum），
把 `Holy Spice` 和 `TwinkleSpica` 两个系列炸成一堆单卡。剩下 13 条指向收编粒度
（材质目录 / PSD 目录 / codeOnly 的 `Editor\` / ID 命名的商品被当成独立素材），5 条真需要你看一眼。
复现脚本 `node tools/probe-review59.cjs`。

### ③ 归并的目录前提（#40）

你的裁定：**归并的前提是同一父容器（同目录），跨目录的 groupKey 相同不构成归并理由。**
事故形状在真库里量到了：`贴图/脸部/4900077` 和 `贴图/lime/4900077` 是两个不相干的商品，
名字都是 Booth id、归并键一样，于是并成了一张写"2 变体"的卡。

- `asset_group.dir_key`（**schema V4**）= 这一组所在目录；老库那条 `UNIQUE(group_key, category)`
  索引改成 `UNIQUE(group_key, category, dir_key)`，否则第二个同 key 不同目录的组插不进去。
- `ensureGroup` 只在同目录的组里复用；迁移回填时**只在全组成员目录一致时写值**，
  不一致的留 NULL = "历史误并组，不再吸附新成员"（要拆交给健康检查，迁移不动数据）。
- `planGroups`（①④ 两条判据）同样按目录切桶；**但 ②source_url / ③source_item_id 不加这道闸**：
  同一件商品在他库里存两份是真实存在的（实测 6 组），ID 相同就该认。
- 真库副本实测：122 组 → 103 组拿到 dir_key，19 组留 NULL（13 个跨目录误并 + 6 个成员没有可判路径），
  `asset` 行数与全部统计口径一条不变，往历史组 `4900077` 的目录里再入库一件 → 另立新组，没有吸附。

测试：`tests/library/group-dir-scope.spec.ts`（6 条）+ `tests/classify/grouping.spec.ts` 新增 5 条
+ `tests/real/realdb-migration.spec.ts` 的 V4 那一支（`AVCA_CHECK_REAL_DB=1` 才跑，且只跑副本）。

## 编号约定（2026-10-05 起）

`M5` 只留给 **Unity 桥接与导入**，拆成 **M5-A**（桥接 + 单包导入，不依赖库干净）
和 **M5-B**（压缩包成员提取 / 依赖分析 / 批量），中间不许再插别的编号。
原来叫 `M5-1 / M5-2 / M5-3` 的三份增量改动单改成 **R1 / R2 / R3**（R = 库与浏览的规则修订）：

| 旧 | 新 | 内容 |
|---|---|---|
| M5-1 | **R1** | 收编现有库向导（清单预览 + 默认不自动归档 + 整批撤销） |
| M5-2 | **R2** | 三级合集模型 Bundle─Item─Variant + 一键全部入库 |
| M5-3 | **R3** | 附属资源识别 + 主体/垃圾过滤 + 分组卡片化浏览 + 重新分析 |

## 数据放在哪

- 设置：`%APPDATA%\A\settings.json`
- 索引库：`%APPDATA%\A\library.db`（WAL）
- 暂存 / 缩略图 / 备份 / 日志：`%APPDATA%\A\{staging,thumbs,backups,logs}`

刻意固定在 `%APPDATA%\A`，不跟随中文产品名，省掉一类兼容问题。

---

## 安全设计（已落地的部分）

- `contextIsolation: true`、`nodeIntegration: false`，渲染进程只拿得到 `window.a` 白名单
- IPC 全部走 `{ok,data|error}` 信封，错误如实冒泡到界面，不静默吞
- 所有跨 IPC 的路径都过 `src/main/security/paths.ts`：绝对性、系统目录、盘符根、zip-slip（`../`、绝对路径、非法字符、控制字符）、自摄检测
- CSP 保持 `script-src 'self'`（实测不需要 `'unsafe-inline'`）
- 删除一律 `shell.trashItem` 走回收站
- 不做任何联网请求（LLM 兜底默认关，且要到 M3 才存在）

### i18n 约定（M1.1 补的规矩）

**主进程不许回传中文文案。** 所有会进界面的文字，主进程只给 `messageKey` / `textKey` / `code` + 参数，渲染进程用 i18next 出文案，中文原文只作为 key 缺失时的兜底留在日志里。`tests/renderer/i18n.spec.ts` 会扫 `src/main` 里用到的 key，断言三份语言文件都齐全 —— 漏翻译在运行时只会显示 key 名，肉眼很容易放过，所以用测试兜住。

同理，设置页里"点一下就生效"的控件（下拉、开关）必须直接读 store 的 settings，不能读本地 draft 副本：DOM 的 `value` 没变时 `onChange` 根本不触发，语言就会卡在英文切不回去（M1 实测踩过）。

---

## 已知限制

> 这一节只列**仍然成立**的限制（第 8 轮整节重核过一遍：原来那七条里有三条早就修好了还挂着，
> 比如"journal 的 label 是中文入库""撤销之后那行还挂着已归档""密码不落盘要重输"—— 三条都已经是过去式）。
> 开发视角逐条带凭据的清单在上面「明确没有的东西」那一节，这里不重复。

- **没做代码签名**：第一次运行 Windows 会提示"未知发布者"，SmartScreen 要点「更多信息 → 仍要运行」。
  这台机器打不了签名包（winCodeSign 里带 macOS 符号链接），是硬约束不是偷懒。
- **A 没在运行时无法感知 Unity 启动** → 需要它常驻托盘。开机自启默认关，由首启向导问你一次，
  程序不擅自写注册表启动项（以后在「设置 → 常规」随时改）。
- **运行目录（数据库 / 缩略图 / 暂存 / 日志 / 备份）固定在 `%APPDATA%\A`**，向导里会如实显示位置和占用，
  但"首启那一次顺手搬到别的盘"还没做（裁定 Q5 乙，排在后面）。素材库根在 C 盘只**警告**不拦。
- **输密码那一次是命令行传给 7z 的**（`-p<明文>`），同一台机器上别的用户理论上能从进程列表看到；
  勾了「记住这个密码」之后存的那份是 DPAPI 密文，与这条无关。要改成免命令行传法得先实测 7z 支持哪一种（未验证）→ 单独立一件。
- **一次导完好几批时，界面只能退回最后那一批**（`batch_id` 一批一条是对的，缺的是入口）→ 任务 #74。
- **桥接还是 1.0.0**：所以 `topFolders` / `avatarDescriptors` 拿不到、真 Unity 撤销后工程里会留下
  这次新建的空目录和它们的 `.meta`（不影响功能，工程树里看得见）；F8 的 GUID 增量索引同理 ——
  反查只能回答"A 导过哪几次"，答不了"工程里现在装了哪些 GUID"。三件都在改 C# 那一支 → 任务 #75。
- 依赖分析结论没做上文展示（"此素材依赖 3 个外部资源，2 个在你的库中"）；
  库健康检查的重复项**只列不删**（删哪份由你决定）；pHash 只比封面图，不比非图片素材。
- 内置那 854 条词典**只读**：能加自己的口语叫法、能删已学规则，但不能改内置表；
  汉字→日语读音的检索不支持（`sokubaku` 搜不到 `束縛`）—— 这是**裁定**不是漏做，理由与收口见 `docs/SEARCH.md` §4。
- LLM 兜底（规格 §5.5，默认关闭）**完全未做**。
- 收件箱的**待确认清单会跨重启**（存源路径，启动后重新入队），但解压产物与 worker 结果不跨重启 ——
  所以重启后要重跑一遍分析，这是刻意的（`staging/` 启动时清空，存结果既大又脆）。
- 渲染层零 DOM 测试：布局与"画法"只能靠截图与真机活体逼近，改样式没有回归保护。

**项目与包（VPM）**

- **更新检查只有手动**（P8-C）：`checkUpdates` 只控制"打开更新页时自动查一次"，
  没有开机自检、没有后台下载、没有增量更新。下载后必须命中发布正文里的 SHA-256 才允许点安装；
  正文里没有 hash 时按钮直接禁用（`hashFromNotes` 取不到就返回 null，**不允许无 hash 安装**）。
- **预发布/隐藏包是用户偏好，不是仓库语义**：`allowPrerelease=false` 只过滤浏览列表
  （`CatalogService.query`），包详情与 `resolverCatalog()` 不过滤 —— 否则已装的预发布包会变成
  "查无此包"、依赖也解析不出来。隐藏包同理：列表/详情隐藏，解析照旧。
- **本地包不进远端目录**：`vpm_local_root` 里的包只能"安装到工程"，不参与解析，
  所以"本地包 + 依赖它的远端包"这种组合解析不出来。
- **VCC 模板读取是只读的尽力解析**：LiteDB 里加密/特殊压缩的模板会明确报错，不会静默跳过。
- **删除工程依赖回收站**：`shell.trashItem` 在没有回收站的盘上会失败，退化为移到
  `<数据根>\trash`（真机上 E: 盘就是这种情况），旧目录不会自动清理。
- **VPM 真机验证只覆盖 Windows 11 + Unity 2022.3.22f1**：启动绑定、双击导入、旧工程迁移三项
  没在其它 Unity 版本 / 中文路径 / 多显示器上逐一验证（见 `docs/VERIFY-UNVERIFIED.md`）。

---

## 许可

MIT（见 `LICENSE`）。两点说明：

- **仓库里不含 7-Zip 二进制**。`resources/bin/7z.exe|7z.dll` 由 `node tools/fetch-7z.cjs` 在构建前现拉 ——
  7-Zip 的 LZMA 部分是 LGPL，但里面的 Rar 解码器是 unRAR freeware 许可，不允许二次分发。
  装好之后 rar 能解；没拉的话 rar 相关功能会明确报"解压组件不支持"，不会假装成功。
- Unity 桥接包 `resources/unity-bridge/com.avca.bridge/` 是本项目自己写的一小段编辑器脚本，随仓库一起 MIT。
