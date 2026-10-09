# M6 设计 · 自动切集合 + 顶部横幅 + 托盘唤醒

> **只设计，不写实现。** 十个问题逐条给「结论 / 理由 / 对已有代码的影响 / 不这么做的代价」。
> 所有数字都来自本机实测或读源码，复现命令写在 §1。凡是没验过的我都标 **未验证**，不写成"应该可以"。
>
> 前置阅读：`docs/M5A-SPEC-NOTES.md` §1.7（R-42…R-53 逐条原文）与 §8.2–§8.7（规格口径整理）、
> `docs/BRIDGE.md` §4（文件信箱与命令）、第 3 份提示词 §4.3 / §8-9/10/11/14/15 / §9-14。
>
> 范围口径沿用 2026-10-05 的编号裁定：**M5-A/M5-B = Unity 桥接与导入**，**M6 = 工程联动体验**
> （自动切集合、横幅、托盘唤醒、防打扰）。03 原文里没有 M5A/M5B/M6 这套名字，只有"M5/M6"。

---

## 0. 十问十答，先看结论

| # | 问题 | 结论一句话 |
|---|---|---|
| 1 | 工程指纹那四项从哪来 | **规格要的四项里现在只有两项拿得到**：`list_project_assets` 的 C# 实现只回 `installedPackages`，`topFolders` / `avatarDescriptors` 根本没回，而 A 侧**从没发过这条命令**（0 处调用）。方案：A 侧读盘补 `topFolders`（只读 Assets 浅一层），`avatarDescriptors` 要么补 C#（推荐，规格原文就是这条路）、要么这一版明确不做 |
| 2 | 匹配算在哪一层 | 纯函数 `src/shared/projectMatch.ts`（指纹 + 集合规则 → 命中与仲裁），主进程只在**"未运行→运行中"这条边沿**上触发一次；渲染进程不自己算（两边各写一遍必漂，M5-B 已验证纯函数这条路值 28 条用例） |
| 3 | 归一化用什么 | 复用 M4 的 `shared/normalize.ts`（小写、去符号、假名转罗马字、汉字转拼音），**两边都归一化**；注意 M4 那个 NFKD 拆浊音的坑已经修在 `fold()` 里，别再自己 `normalize()` |
| 4 | 多个集合同时命中怎么办 | 先 `rule_json.projectPaths` 精确路径（最高优先）→ 再 `priority` → 再"命中关键词最长"。**到最后一层还平手就不自动切**，只更新顶栏 —— 切错集合的代价是"用户在自己的分区里找不到东西"，比不切更糟（规格没写，见 §8-Q1） |
| 5 | 5 分钟冷却存哪 | 存库（V6 给 `project` 加 `last_auto_switch_at`）。不落库的症状：**每次重启 A 都会立刻弹一次横幅**，而重启 A 是常态 |
| 6 | 切换时用户的搜索框 | **保留搜索词，集合过滤叠加**，横幅上写明「仍在搜索「xxx」·已切到 Shinano 集合」。§9-14 只禁止"清空"，叠加是唯一不丢上下文的做法；"只留搜索词"会让"自动打开集合"变成假动作 |
| 7 | "用户正在操作中不打断"怎么判 | 规格说的"有未保存的编辑"在 A 里没有对应物（A 没有编辑器）。替代判据：`win.isFocused()` 且 渲染层有模态框开着 / 正在拖拽 → **只更新横幅文字，不 show()、不 focus()、不切视图**（偏离写明在 §8-Q4） |
| 8 | 托盘唤醒怎么做 | `showMain()` 已有；新增 `wakeForProject()`：`show()` + `focus()` + `setAlwaysOnTop(true)`，**1.2 秒后关掉置顶**（规格只写"短暂闪烁"没给时长）。`minimizeToTray=false` 时不弹（用户明说了不要常驻） |
| 9 | 自动建集合要不要照规格做 | **不照做**。规格要"为内置词典每个模型建一个集合"，实测词典 avatar 维 **90 条**，而他真库出现过的模型去重后 **约 20 个**（`UNIVERSAL×78` 不是模型名）。90 个空集合会把侧栏淹掉 → 改成**命中才建** + 设置页一个"按库里出现过的模型补建"按钮（见 §8-Q2） |
| 10 | 顶栏工程切换器要不要做 | **已经做完了**：`chrome.tsx` 有下拉、三色圆点、"未运行不能导入"的如实提示，`unity:set-target` 也已实现并在 2026-10-06 的沙盒活体里真点过。M6 对顶栏只做**验收**，不做开发（`docs/M5A-SPEC-NOTES.md` §8.6 那句"只是个按钮，没有展开列表"已过期，本轮一并改掉） |

---

## 1. 事实基线（本机实测 / 读源码，全部只读）

| 事实 | 怎么量出来的 |
|---|---|
| C# 的 `list_project_assets` **只回 `installedPackages`**（读 `Packages/manifest.json` 的 dependencies 键名） | `resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs` 的 `ListProjectAssets()` 全文 |
| A 侧**从没发过** `list_project_assets` | `grep -rn "list_project_assets" src/main` → 0 命中 |
| `project.fingerprint_json` 列**已存在**，`repos/unity.ts` 会写，但没人算过指纹 | `src/main/db/schema.ts:168`、`src/main/db/repos/unity.ts:31` |
| `CollectionRule` 已有 `keywords/matchMode/priority/projectPaths/tagNames/categories` | `src/main/db/repos/meta.ts` + `src/shared/types.ts` |
| **`autoSwitchBehavior` 是个死设置**：默认值 `when_matched` 有，全仓库**没有任何一处读它** | `grep -rn "autoSwitchBehavior" src/` → 只有 defaults 与类型两处 |
| 没有任何冷却常量 / 横幅组件 | `grep -rln "cooldown\|Banner" src/main src/renderer` → 只有 `thumbRules.ts`（无关）与 en.json 里一个不相干的词 |
| 词典 avatar 维 **90 个**词条（含中日文别名） | `node -e` 读 `resources/lexicon/lexicon.json`，`dim==='avatar'` 去重 |
| 他真库里真实出现过的模型：**31 个 variant 值**，去掉大小写重复与 `UNIVERSAL×78` 后约 **20 个**（Shinano 14 / Milfy 7 / Lime 5 / Manuka 5 / Milltina 5 / Airi 4 / Moe 4 / Rurune 4 / Selestia 4 …） | `node:sqlite` **readOnly** 打开 `%APPDATA%\A\library.db`，`SELECT variant_value, COUNT(*) FROM variant WHERE variant_kind='avatar' GROUP BY 1` |
| `collection` 表 **0 行** —— 侧栏"集合"区现在是空的 | 同上，`SELECT COUNT(*) FROM collection` |
| 工程运行状态三路判定**在跑且准**：2026-10-06 沙盒活体里，假心跳文件让 A 正确报出「Shinano-LiveTest → 已打开（依据：bridge）」 | `D:\avca-m5b-live` 那轮的主日志 |
| 顶栏工程切换器已实现（下拉 + 三色点 + 未运行提示） | `src/renderer/components/chrome.tsx:46-78`，活体里点过「设为导入目标」 |

**没验过的事**（别当已知）：`AssetDatabase.GetSubFolders("Assets")` 与 `FindAssets("t:AvatarDescriptor")` 在他 8 个真工程上的耗时与返回条数；Chromium 的 `focus()` 在 Windows 焦点保护下能不能真把窗口抢到他面前（M5-B 那轮实测 `SetForegroundWindow` 从外部调是失败的，只有进程自己 `setAlwaysOnTop(true)+show()+focus()` 才作数 —— 这条正好支持 §3.8 的做法）。

---

## 2. 现状盘点：R-42…R-53 每条到底有还是没有

| # | 内容 | 现状 | M6 要做的 |
|---|---|---|---|
| R-42 | 指纹四项 + 首帧退化 | **没有**（列有、算的人没有、命令没发过） | 新增 `project/fingerprint.ts` |
| R-43 | 两边归一化 | `shared/normalize.ts` **已有**，没人拿它做集合匹配 | 纯函数里调用 |
| R-44 | priority / 最长关键词仲裁 | **没有** | 纯函数 |
| R-45 | 设置页说明 + 开机自启默认开 | 说明**没有**；`autoLaunch` 有意为 false | 文案 + 等他裁定（§8-Q3） |
| R-46 | 切视图不清搜索框 | **没有**（也没有切视图这个动作） | store 动作 + 用例 |
| R-47 | 横幅三按钮 + 10 秒淡出 + `projectPaths` | 字段有，UI **没有** | 新组件 |
| R-48 | 未运行不能导入 | **已做**（顶栏如实提示） | 只验收 |
| R-49 | 5 分钟冷却 | **没有** | V6 一列 + 判定 |
| R-50 | `自动弹出行为` 三档 | **死设置**（从没被读） | 接上 + 用例钉"它真的被读了" |
| R-51 | 操作中不打断 | **没有** | 判据 + 只更新横幅 |
| R-52 | 同 R-46 | 同上 | 同上 |
| R-53 | 状态按 `projectPath` 分 | **已做**（BridgeManager 按路径分队列） | 只验收 |

> 这张表本身就是 M6 最容易虚报的地方：**列存在 ≠ 有人用，设置存在 ≠ 设置生效**。
> 所以 §6 的用例清单里，每条"已有"都要有一条断言去证明它真的被接上了（M5-B 的 `initAppPaths` 接线断言是同一个套路）。

---

## 3. 十问详解

### 3.1 指纹怎么凑齐，凑不齐怎么办

规格 §4.3 步骤 1 要的四段：`projectDirName + topFolders + installedPackages + avatarDescriptors`。
实测只有前一半拿得到（§1 第一、二行）。三条路：

1. **补 C#**（推荐）：`ListProjectAssets()` 里加
   `topFolders = AssetDatabase.GetSubFolders("Assets")` 与
   `avatarDescriptors = AssetDatabase.FindAssets("t:AvatarDescriptor")` 的 `AssetDatabase.GUIDToAssetPath`。
   约 15 行，走的是规格原文那条路。**代价**：他每个装了桥接的工程都要重编译一次；
   而且**旧版桥接不认新字段**（不是不认命令，是回了老形状）→ 必须按心跳里的 `bridgeVersion` 降级：
   版本不够就只用 `installedPackages` + A 侧读盘的 `topFolders`，**不许假设所有工程都装了新版**。
2. **A 侧读盘补 `topFolders`**：`readdirSync(<Project>/Assets)` 只取目录名、浅一层、上限 200 条。
   只读，不伸进包、不递归（大工程顶层几十个目录，实测他 `shinano-Main2` 的顶层数量**未验证**）。
3. **`avatarDescriptors` 这一版不做**：文档里明说"规格四项我们只有三项"。

结论：**①+② 都做，③ 由 §8-Q5 裁定**。首帧（Unity 刚开、桥接还没心跳）按 R-42 原文
先用 `projectDirName` 匹配，拿到指纹后**再刷新一次**（刷新只在"还没切过"时生效，不然会出现
"先按名字切到 A 集合、三秒后又跳到 B 集合"的抖动）。

### 3.2 匹配算在哪一层

`src/shared/projectMatch.ts`（纯函数，无 IO）：

```ts
fingerprintOf(project: {dirName, topFolders, installedPackages, avatarDescriptors}): string[]
matchCollections(fp: string[], rules: Array<{id, name, rule: CollectionRule}>): MatchOutcome
// MatchOutcome = {kind:'hit', collectionId, why} | {kind:'ambiguous', candidates} | {kind:'none'}
```

主进程 `src/main/project/autoSwitch.ts` 订阅 `running.ts` 的边沿（false→true），
调纯函数，决定要不要广播 `project:auto-switch`。渲染进程只负责"照吩咐切视图 + 画横幅"。

**为什么不放渲染进程**：集合规则和工程状态都在主进程/库里，放界面就要把它们都传出去再传回来，
两边各算一遍迟早漂（M5-B 的 `cleanDisplayName` 双实现教训）。

### 3.3 归一化

`shared/normalize.ts` 的 `fold()` 已经做了 NFKC→NFD 剥拉丁音标→NFC + 假名→罗马字 + 汉字→拼音。
指纹段和关键词**都过同一个函数**，再按非字母数字切 token 比对。
规格只说"小写、去符号、假名转罗马字"，没说汉字 —— 但 M4 的拼音表已经在库里，
`信奈` ↔ `shinano` 这种命中正是他要的效果（词典里 `信奈` 就是 avatar 维词条）。
**这条算超出规格原文，写进偏离**。

### 3.4 仲裁与"不确定就不切"

优先级从高到低：

1. `rule.projectPaths` 里有**规范化后的相等路径**（`dirKeyOf`，和 #40 归并用同一套路径键）→ 直接命中，不再看别的；
2. `priority` 数值最大者；
3. 命中关键词里**最长那个**（更具体）；
4. 还平手 → `{kind:'ambiguous'}` → **不自动切**，顶栏照常显示，不弹横幅。

再加两道"太宽就不切"的闸（M5-B 的 `tooBroad` 同一味药）：
关键词短于 3 字符不参与匹配；某个关键词在他 8 个工程里命中 ≥3 个，视为通用词（`vrc`、`unity`、`main`），不据此自动切。

### 3.5 触发时机与冷却

- 只在 `running` 边沿触发（`running.ts` 的三路判定已经按 `projectPath` 出结果，M5-A 已接好）；
- 冷却 `AUTO_SWITCH_COOLDOWN_MS = 5 * 60_000` 写进 `shared/constants.ts`（规格"硬性"，不给设置项）；
- 上次触发时间落库（V6：`project.last_auto_switch_at INTEGER`），**不落库的症状 = 每次重启 A 立刻弹一次**；
- `autoSwitchBehavior`：`never` → 什么都不做；`when_matched` → 只有命中集合才弹/切；`always` → 没命中也弹窗置顶（规格三档，一档都不能少，且这一档要真的被读）。

### 3.6 切换动作（R-46/R-52）

`ui.ts` 新增 `applyAutoSwitch(collectionId, projectName)`：
设 `nav='collection'`、`selectedCollection=id`、**搜索框一个字都不动**；
如果搜索框非空，横幅多一行「仍在搜索「{q}」」。
这条动作用假 `window.a` 在 store 层测（M5-B ⑥ 的 `member-picker-store.spec.ts` 那套现成）。

### 3.7 横幅（R-47）

```
已识别为「{project}」项目 · 自动打开 {collection} 集合
[不是这个集合 ▾]  [以后都这样]  [这次忽略]
```

- 10 秒自动淡出；`[固定]` 小图标钉住不消失（规格"可固定"）；
- `不是这个集合 ▾` → 其他集合 + "创建新集合"，选完问「要把它记进 {新集合} 的规则吗」；
- `以后都这样` → 把当前工程路径写进该集合 `rule_json.projectPaths`（精确匹配、最高优先，下次不再问）；
- `这次忽略` → 关掉，本次运行内该工程不再弹（冷却另算，两者独立）。
- 横幅**不进 journal**：它是视图状态，Ctrl+Z 不该改视图。`projectPaths` 是数据变更，但规格没要求可撤销，撤销入口给在集合规则管理里（不做 Ctrl+Z）。

### 3.8 托盘唤醒

`window.ts` 新增 `wakeForProject()`：`show()` → `focus()` → `setAlwaysOnTop(true)` →
**1200ms 后 `setAlwaysOnTop(false)`**。为什么是 1.2 秒：和 `ready-to-show` 兜底同一个数，
够一次窗口动画，又不至于变成"永远压在所有窗口上面"的讨厌窗口。规格没给时长（§8-Q4 让他定）。
`minimizeToTray=false` 时不弹（他没要常驻，就不该抢焦点）。

### 3.9 自动建集合（R-45 步骤 2 那句）

见 §0 第 9 问：改成**命中才建**，并在 设置 → 分类 加「按库里出现过的模型补建集合」
（数据源：`variant(variant_kind='avatar')` 去重，排除 `UNIVERSAL` 这类通用值，大小写归一）。
他真库这一算就是约 20 个，而不是 90 个。

### 3.10 验收那 5 条怎么落地

§8-9 / 10 / 11 / 14 / 15 **全部要真 Unity + 真托盘**，离线只能覆盖到纯函数与状态机：
需要他配合的动作清单写在 §6.2，我不会自己重启他的 A（这条属于"仍要说"的那类动作）。

---

## 4. 数据流（一图）

```
Unity 启动
  └─ Temp/AVCABridge/bridge.json 出现（心跳）
       └─ running.ts 三路取并集 → project.is_running false→true   [边沿]
            └─ autoSwitch.ts
                 ├─ autoSwitchBehavior=never? ── 停
                 ├─ 冷却 5 分钟内切过?  ──────── 停（只更新顶栏）
                 ├─ fingerprint.ts：目录名 + A 侧读盘 topFolders
                 │    └─ 桥接活着且 bridgeVersion 够 → 发 list_project_assets → 存 fingerprint_json
                 ├─ projectMatch（纯函数）→ hit / ambiguous / none
                 │    ├─ none → 不切；behavior=always 才弹窗
                 │    └─ hit  → 广播 project:auto-switch {projectId, collectionId, why}
                 │              ├─ 窗口在托盘 → wakeForProject()
                 │              ├─ 正在操作中 → 只更新横幅文字（不抢焦点、不切视图）
                 │              └─ 否则 → applyAutoSwitch()（搜索词不动）+ 横幅 10 秒
                 └─ 落库 project.last_auto_switch_at
```

---

## 5. 需要新增 / 修改的文件（预估）

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/shared/projectMatch.ts` | 新增 | 指纹 + 仲裁 + 太宽闸门，纯函数 |
| `src/main/project/fingerprint.ts` | 新增 | A 侧读盘 topFolders（浅一层、≤200）+ 发 `list_project_assets` + 存 `fingerprint_json`；按 `bridgeVersion` 降级 |
| `src/main/project/autoSwitch.ts` | 新增 | 边沿触发、冷却、行为开关、广播 |
| `src/shared/constants.ts` | 改 | `AUTO_SWITCH_COOLDOWN_MS`、`WAKE_TOPMOST_MS` |
| `src/shared/types.ts` | 改 | `ProjectFingerprint` / `AutoSwitchEvent` / `MatchOutcome` 契约（IPC 两边共用，别再放 ipc.ts） |
| `src/main/db/schema.ts` | 改 | **V6**：`project.last_auto_switch_at INTEGER`（只加列，不回填） |
| `src/renderer/components/ProjectBanner.tsx` | 新增 | 横幅 + 三按钮 + 固定/淡出 |
| `src/renderer/stores/ui.ts` | 改 | `applyAutoSwitch` / 横幅状态 / `project:auto-switch` 事件接线 |
| `src/main/window.ts` | 改 | `wakeForProject()`（含取消置顶） |
| `src/main/ipc/system.ts` 或 `settings.ts` | 改 | 设置页那句"A 需要常驻托盘才能感知 Unity 启动"的说明项 |
| `resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs` | 改（**要他点头**） | `ListProjectAssets()` 补 `topFolders` / `avatarDescriptors`；`check-bridge-compile` 必须重跑 |
| `src/renderer/i18n/{zh-CN,en,ja}.json` | 改 | 横幅、说明、偏离提示全部走 `add-i18n-keys`；**占位符一律双花括号**（M5-B ⑧ 刚踩过） |
| `tools/verify-red-m6.cjs` | 新增 | 每处修复回退一次，确认用例真的会红（**单独跑，别和别的重活并行**） |

---

## 6. 测试清单

### 6.1 离线（不需要 Unity，CI 里就能红）

- `tests/shared/project-match.spec.ts`：路径精确 > priority > 最长关键词；平手 → `ambiguous`；
  短词/通用词不据此切；`UNIVERSAL` 不算模型名；归一化（`信奈`↔`shinano`、`しなの`↔`shinano`）；
  **首帧只有目录名时也能命中，拿到完整指纹后不重复跳集合**。
- `tests/project/fingerprint.spec.ts`：只读浅一层、上限 200 撞线要记账；
  `bridgeVersion` 不够时**不发**新字段（旧桥接不许被假设）；抛错时退回目录名而不是整个功能挂掉。
- `tests/project/auto-switch.spec.ts`：只在 false→true 边沿触发；5 分钟冷却（含"重启后仍然冷却"，
  因为落库）；三档 `autoSwitchBehavior` **各自都被读到**（这条就是钉死"死设置"的那条）；
  无匹配不弹；`minimizeToTray=false` 不抢焦点。
- `tests/renderer/auto-switch-store.spec.ts`：切集合**不清空搜索框**（R-52 的反面用例）；
  操作中只更新横幅不切视图；横幅 10 秒淡出/固定状态转移；"以后都这样"写进 `projectPaths`。
- `tests/db/migration-v6.spec.ts`：真库副本上 V5→V6，行数与既有列零变化（沿用 `AVCA_CHECK_REAL_DB=1` 那条路）。
- `tests/renderer/ipc-channels.spec.ts`（已有）：新通道必须进 preload 白名单 —— 这条历史上线就抓到三个漏网。
- `tests/spec-coverage.spec.ts`：M6 逐条对账，未验证项清单用断言钉住（想悄悄把没测的算成测过会直接红）。
- `tools/verify-red-m6.cjs`：至少钉住「冷却不生效」「行为开关没被读」「切换时清空了搜索框」
  「旧桥接被当新版发命令」「平手时乱切」这五处。

### 6.2 必须真机（要他配合，我不自己动）

| 验收 | 要他做的 | 我能准备的 |
|---|---|---|
| §8-9 打开 `shinano-Main2` → 自动置顶 + 切集合 + 横幅 | 开 Unity（他会开哪个我不能替他说） | 沙盒假心跳能验"检测/仲裁/切视图"，**验不了真焦点与真置顶** |
| §8-10 「以后都这样」下次直接切 | 第二次开同一工程 | 同上，且 `projectPaths` 写入可离线验 |
| §8-11 无关工程不自动切 | 开一个 `测试工程` | 离线可验仲裁出 `none`；真机验"顶栏照常更新但不弹窗" |
| §8-14 托盘里被唤醒 | 把 A 收进托盘再开 Unity | 焦点保护下 `focus()` 到底抢不抢得过来，**只有真机能答** |
| §8-15 杀 A 重启后重新发现 | 重启他的 A | 离线可验落库的 `last_auto_switch_at` 跨进程生效 |

**明确不算 M6 完成的**：上面 5 条在他真机点过之前，M6 一律标"未验证"。

---

## 7. 风险点（按"能造成多大破坏"排，不按概率）

1. **把用户正在看的东西换掉**。自动切视图是 M6 的全部卖点，也是它最可能惹恼人的地方。
   兜底：冷却 + 操作中不打断 + 搜索词不动 + 「这次忽略」+ 设置里"从不"。
2. **改 C# 桥接 = 动他 8 个工程里的东西**。只动 `Packages/com.avca.bridge/`（红线：绝不进 `Assets/`），
   但重编译要 Unity 在线；**旧版桥接必须能继续用**（按 `bridgeVersion` 降级），
   否则症状是"装了旧桥接的工程指纹全空 → 永远不自动切"，还不报错。
3. **读盘伸进工程目录**。只读 `Assets` 浅一层目录名，不递归、不解包、不写；
   上限 200 条并记账（撞线要说得出来，M5-B 的 `MEMBER_SCAN_MAX` 同一条纪律）。
4. **通用词把集合灌水**。`vrc` / `unity` / `main` 这类词命中所有工程 → 自动切到他没在用的分区。
   兜底：短词不参与、命中 ≥3 个工程视为通用词。
5. **开机自启写注册表**。规格要"默认开启"，代码故意 false（不擅自改他的启动项）。
   这一条**不由实现方裁定**（§8-Q3）。
6. **置顶不取消**。`setAlwaysOnTop(true)` 忘了关 = A 永远压在 Unity 上面，改个窗口都点不到。
   用例钉死"1.2 秒后一定关掉"，且抛错路径也要关（`finally`）。
7. **假绿**：`autoSwitchBehavior` 这种"字段有、没人读"的东西，靠类型和默认值测试是测不出来的。
   §6.1 里那条"三档各自都被读到"必须写成读源码接线 + 行为两种断言各一遍。

---

## 8. 需要他裁定的问题（不自行裁定）

**Q1｜平手时到底切不切？** 规格只写了 priority 和"最长关键词"，没写还能平手。
我的默认：**不切**（宁可不动，也别把他的视图换到错的地方）。要改成"切 priority 高的、再按集合名字母序"也行。

**Q2｜自动建集合照规格做吗？** 规格：为内置词典每个模型建一个（实测 90 个）。
我的默认：**命中才建**（约 20 个），另给一个手动"按库里出现过的模型补建"按钮。

**Q3｜`开机自启` 默认值**（规格要 true，代码故意 false）。
我的默认：**保持 false**，但第一次出现"检测到 Unity 启动"时问一次，由他点。

**Q4｜"操作中不打断"的判据**。规格说"有未保存的编辑、正在拖拽"，A 里没有"未保存的编辑"这种状态。
我的默认：窗口聚焦 + 有模态框开着 + 正在拖拽 三者任一 → 不打断。

**Q5｜允不允许我改 C# 桥接**（`list_project_assets` 补两项）？改了要他那边 Unity 重编译一次才算真验证。
我的默认：**先不改**，用 A 侧读盘 + `installedPackages` 做指纹，实测命中率不够再回来提这个。

**Q6｜置顶时长 1.2 秒**（规格只说"短暂"）。我的默认：1.2 秒。

---

## 9. 一句话交付顺序

```
① shared/projectMatch.ts 纯函数 + 用例（仲裁/太宽/归一化，全部离线）
② fingerprint.ts（A 侧读盘那半边）+ 用例 + 旧桥接降级
③ autoSwitch.ts + V6 迁移（last_auto_switch_at）+ 行为开关接上（钉死"死设置"）
④ 横幅组件 + store 的 applyAutoSwitch（不清搜索词）+ i18n 三语
⑤ wakeForProject() + 设置页那句说明 + 托盘/焦点真机项清单
⑥ 文档（BRIDGE.md 加 §13、M5A-SPEC-NOTES §8.6 过期结论改掉）+ verify-red-m6 + 沙盒活体 + 全量验证
```

①③ 不碰界面、不碰他任何真实数据，可以一口气做完；
④⑤ 会改视图与窗口焦点，做完先给他看截图/录屏再往下；
⑥ 里的真机 5 条必须他配合，我不自己重启他的 A、不自己开他的 Unity。

## 10. 落地记录（2026-10-06，实现之后回填）

上面那份是设计；实际按 `PROMPT-M6-NEXT-ROUND.md` 重排成七步交付，编号与本文的差别如下
（**顺序变了，内容没变**）：

| 实际步骤 | 本文对应 | 落地文件 |
| --- | --- | --- |
| ① 匹配纯函数 | §5 第一行 | `src/shared/projectMatch.ts`（+ `pathkey.ts`、`CollectionRule` 一起搬进 `shared/`） |
| ② 指纹采集 | 同上 | `src/main/project/fingerprint.ts` |
| ③ 边沿触发 + 冷却 + 行为开关 | 同上 | `src/main/project/autoSwitch.ts`、schema **V6**、`src/main/project/api.ts` |
| ④ 补建第一入口（**新增，本文没有**） | — | `src/shared/modelCollections.ts`、`src/shared/backfillState.ts`、`src/main/library/modelCollections.ts`、`ModelBackfillDialog.tsx` |
| ⑤ 横幅 + 不清搜索框 | ④ | `src/shared/bannerState.ts`、`ProjectBanner.tsx`、`stores/ui.ts` |
| ⑥ 托盘唤醒 + 设置页说明 + Q3 一次性提示 | ⑤ | `src/main/window.ts`、`AutoLaunchAsk.tsx`、`Settings.tsx` |
| ⑦ 文档 / 覆盖表 / verify-red / 沙盒活体 / 全量 | ⑥ | `docs/BRIDGE.md` §13、`tests/spec-coverage.spec.ts`、`tools/verify-red-m6.cjs`、`tools/selfcheck-m6.cjs` |

**④ 是裁定之后加进来的**（Q2 + 隐患 A）：真库 `collection` 表 0 行，而"命中才建集合"要集合先存在
才谈得上命中 —— 不补这一手，M6 上线那天就是"永远不切、也说不清为什么不切"。

### 实现之后才确定的三件事

1. **通用词判据被活体推翻过一次**：设计里写的是"一个词命中 ≥3 个工程就算太宽"，
   实际他机器 9 个工程有 7 个带 `shinano`，这条会把 `Shinano` 集合整个废掉。
   现在判据是"命中**全部**已知工程（且 ≥3 个）才算什么都没说"。详见 `docs/BRIDGE.md` §13.2。
2. **横幅/补建的分支判断全抽成返回 render-state 的纯函数**（`bannerState.ts` / `backfillState.ts`），
   组件里不留 `if` —— 本仓库渲染层零 DOM 测试，装 jsdom 换来的是一堆慢用例还是测不到判据。
   代价是"画法"（像素、断字、按钮位置）只能靠截图，侧栏那个入口就是这么发现被挤成断字的。
3. **`verify-red-m6` 第一次跑就抓到两条假绿**：`顺序是"先写库再通知"` 那条用例只看"两件都发生了"
   （现在记 `order` 数组），`BANNER_AUTO_HIDE_MS` 这个 10 秒没人钉数字（补了一条）。
   外加一条本工具自己的期望写错：`SCHEMA_VERSION` 退回 5，"列加没加出来"那条照样绿 ——
   真症状是下次启动二次执行 V6 直接炸库，于是补了 `SCHEMA_VERSION == 最后一篇迁移版本号` 这条不变量。

### 没做的事（和裁定一致）

- **不改 C#**（Q5）：`ListProjectAssets()` 至今只回 `installedPackages`，`BridgeVersion` 还是 `1.0.0`，
  所以 `BRIDGE_WITH_ASSET_LIST='1.1.0'` 是一道将来才会被满足的闸门，真机上人人都记 `bridgeTooOld`。
- **不动系统启动项**（Q3）：`autoLaunch` 默认仍是 `false`，只在应用内问一次。
- 真机 5 条（托盘置顶、以后都这样的第二次命中、§8-11 的真 none、9 个工程的 Assets 顶层数、
  新版桥接那一支）—— 清单在 `node tools/selfcheck-m6.cjs` 末尾，需要他配合，我不自己开他的 Unity。
  **2026-10-08 更新（开发计划第 5 轮）**：中间那三条已在打包版上真跑过（逐条凭据见
  `docs/VERIFY-UNVERIFIED.md` §11），其中托盘置顶那一条是**先抓到一条真缺陷**才过的 ——
  `setAlwaysOnTop` 那段在改之前从来没执行过；剩下两条仍挂着：
  「9 个工程的 Assets 顶层数」要他开真工程，「新版桥接那一支」要改 C#（第 6 轮裁定）。
