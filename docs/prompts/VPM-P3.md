# VPM-P3 执行提示词：依赖解析器与变更计划（只读）

> **执行入口（2026-10-21 起）**：本文件是 P3 阶段规格，不是一次执行的任务。
> 请按 [`tasks/P3-*.md`](tasks/) 的任务卡逐个执行；本文件只查阅任务卡列出的章节。
> 任务板：[`../VPM-TASKS.md`](../VPM-TASKS.md) · 共同规则：[`_COMMON.md`](_COMMON.md) · 架构：[`../VPM-ARCHITECTURE.md`](../VPM-ARCHITECTURE.md)。

> 前置：P2 已合并。工程可读、仓库可查、包目录可浏览。
> 必读：`AGENTS.md`、`docs/VPM-MERGE-PLAN.md`、`docs/VPM-CLEANROOM.md`、`docs/VPM-PARITY.md`、`docs/VPM-IMPLEMENTATION-GUIDE.md` §2、§3。
>
> 本阶段只算"要做什么"，**不下载、不解压、不写工程、不装包**。
> 解析器是纯函数；计划是数据；UI 只读预览。

---

## 1. 开始前

```bash
git fetch origin
git switch -c codex/vpm-p3-resolver origin/main
```

先读 P2 的工程读取 DTO 与 P1 的 repo/version/manifest 类型；不要另造一套。

---

## 2. 目标

1. 实现确定性的 VPM 依赖解析：最高兼容版本、锁定、预发布、Unity 兼容、yanked、
   受保护包、旧式包、缺失/冲突。
2. 输出可解释的 `Plan`：装/升/降/卸/保留、原因、来源、下载清单、磁盘估算、警告。
3. 只读计划预览 UI；为 P4 的事务提供唯一输入。
4. 不写盘；不产生副作用。

---

## 3. 明确不做

- 不下载/校验/解压包（P4）。
- 不写 `vpm-manifest.json`/`Packages/`/`Assets/`（P4）。
- 不做 UI 购物车/批量选择/应用（P4）；只做只读预览。
- 不建工程/模板（P5）、不备份/迁移（P6）。
- 不写 `vpm.db`/核心 `library.db`（计划只在内存里）；不改 `SCHEMA_VERSION`。
- 不引入 ALCOM 的解析器代码/测试；按下面的语义自己实现。

---

## 3.5 本阶段实现解剖（ALCOM → Atrium）

**ALCOM 的关键机制（行为/架构观察）**

- 解析器维护一张包上下文表：每个包记录当前选中版本、**所有来源对它的范围要求**
  （根来源、别的包、锁定快照）、它自己的依赖集合、是否 legacy/预发布/被本次触及。
- 用队列推进：显式请求的包先被"强制"处理，后续依赖进 pending 队列；
  同名包去重，后加入的替换先加入的。处理一个包时，把它的依赖要求写进其他包的
  requirements，再判断"要不要装/换版本"。
- 候选选择：过滤 legacy、已满足范围、Unity 不兼容；预发布按策略做"稳定优先/
  允许预发布"的 fallback；选满足范围与 Unity 的最高版本。
- **没有全局回溯**：早期选择导致后面无解时，产出带来源的冲突/缺失，而不是换一套组合。
- 删除靠"从根可达性"做 mark-and-sweep；legacy 包跳过，不参与重装。

**Atrium 的独立实现**

- 用"约束表 + 工作队列 + 局部修复"重写同样的行为，不复制其类型/结构：
  `constraints: package -> [{source, range}]`、`selected: package -> version`；
  每轮取受影响的包，选"满足全部约束、未 yanked（已选除外）、Unity 兼容、
  符合预发布策略、来源规则"的最高版本；版本变化时撤掉旧依赖约束、加新约束、
  把受影响的包重新入队。有轮数上限，防 pathological 数据死循环。
- 锁定版本是**偏好**：满足当前约束且没有升级请求就保留；显式升级/约束变化才重选。
- 收敛后：根/被选包依赖必须有选择；冲突/缺失 → `blocked=true`，
  但计划仍展示原因和来源；不可达包只标记为"可移除"，**排除 unlisted/protected**。
- 输出是只读 `PlanPreview`，由主进程生成并存 `planId`；渲染进程不能自己拼计划。

**施工顺序**

1. 纯函数解析器 + 合成包对象，不接 DB/工程；先写表驱动测试。
2. 定义计划类型/排序/解释字段/冲突结构。
3. 接 P1 目录 + P2 工程 manifest，做只读预览。
4. 用真实工程对照锁定/升级行为，差异记入观察日志。
5. P4 才允许执行计划；本阶段不写任何文件。

**最容易做错**

- 把"最高版本"当"最高兼容版本" → 忽略 Unity/预发布/约束。
- 不记录 requirement 来源 → 冲突只能报"无解"，用户无法判断。
- 遇到冲突自动降级/换一套组合 → 行为不可预测，也偏离 ALCOM 的确定性。
- mark-and-sweep 把用户手动包/unlisted 包删掉 → 只标记，不自动删。

**详细内容**：`docs/VPM-IMPLEMENTATION-GUIDE.md` §2、§3。

---

## 4. 解析语义（必须按这个实现）

### 4.1 输入

```ts
interface ResolveInput {
  projectKey: string
  unityVersion: string | null
  manifest: VpmManifest                 // dependencies(范围) + locked(精确)
  installed: InstalledPackage[]         // Packages/ 里读到的
  catalog: RepoPackage[]                // 多仓库；有 repoId/priority
  requests: ChangeRequest[]             // add/upgrade/downgrade/remove/reinstall
  preset?: 'upgradeAll'                 // 与 requests 二选一；主进程展开
  options: {
    allowPrerelease: boolean
    protectedPackages: string[]         // 至少 com.avca.bridge
    legacyPackages?: string[]           // Assets 里识别到的旧式包
  }
}
```

`ChangeRequest`：

```ts
{ kind: 'install', name, versionRange? }   // 不填=满足当前约束的最高稳定版
{ kind: 'upgrade', name, version? }        // 不填=最高兼容
{ kind: 'downgrade', name, version }       // 必须指定
{ kind: 'reinstall', name }                // 版本不变，强制重下/重解压
{ kind: 'remove', name }
```

`preset: 'upgradeAll'` 的展开规则（主进程做，渲染层不自己拼）：

- 收集 `manifest.dependencies` 的根包 + `manifest.locked` 的已装包，
  排除受保护包、legacy 冲突包、unlisted/未知包；
- **根包**：按"升级"处理（保留/更新根范围，选最高兼容版本）；
- **仅传递依赖**：设置 `preferLatest` 偏好，让解析器在满足父约束时选最高兼容版本，
  **不得把它们提升为根依赖**；父约束不允许时保持原版本并给 `keep` 原因；
- 仍然走同一套约束/Unity/预发布/yanked 规则；不能为了"全升"绕过任何过滤；
- 冲突/缺失照常阻断，计划里逐项给来源；不自动 remove 任何包；
- 如果某包已是最新或没有更高兼容版本，计划中显示 `keep`，不报错；
- 输出仍是一个 `planId`，P4 只能按这个 id 应用。

### 4.2 根依赖与锁定

- `manifest.dependencies` 是用户/工程声明的根范围（对象 `{version}`）。
- `manifest.locked` 是当前精确版本 + 依赖快照，用作**偏好**，不是永远不可动的硬钉。
- 请求会修改根依赖：
  - install：写入根依赖范围；
  - upgrade/downgrade：如果包已在根依赖里，替换根范围；如果它只是传递依赖，
    只改本次选中的锁定版本，**不把它提升为根依赖**；
  - remove：删除根依赖；传递依赖不能单独 remove（会被父依赖重新拉回），给明确提示；
  - reinstall：不改版本。
- 不是根依赖、但被依赖的包：由解析器选择，写入锁定的候选。
- **已安装/已锁定版本也是候选**：即使仓库里已经没有这个版本，只要 `package.json` 可读，
  就可以继续保留（source=installed，不需要下载）；但升级/重装需要仓库或缓存。
  这样离线/仓库下架时不会把能用的工程判成"缺包"。
- **受保护包**：永不选择/升级/降级/卸载；如果某个依赖要求它，直接 `protectedPackage`。
- **旧式包**：如果 Assets 里已有同名包，不要静默装新包；给 `legacyPackageConflict`，
  建议先走迁移（P6）。只读报告，不改。

### 4.3 候选选择

对每个包，候选版本必须满足：

1. 满足所有来源的范围（根 + 已选包的依赖）；
2. 不是 yanked（已锁定的 yanked 版本可保留，但给 warning）；
3. 如果工程有 Unity 版本：满足包的最小 Unity 版本；
4. 预发布规则：
   - 全局/包级不允许预发布 → 只选稳定版；
   - 允许 → 稳定版优先；只有范围必须预发布或没有稳定候选时才选预发布；
5. 受保护包排除；
6. 旧式包冲突时排除并报告；
7. 同版本多仓库：按仓库顺序（小 sort_order 优先）；同版本不同 hash → `repoHashConflict`，
   不静默选。

选择偏好：

- 如果当前锁定版本满足所有约束，且没有请求要求升级/降级 → **保留锁定版本**（避免无谓升级）。
- 如果请求是 upgrade/最高兼容，或新约束让锁定版本不满足 → 选满足约束的最高版本（按上面的偏好）。
- 如果请求是 downgrade/exact → 只接受指定版本；不满足则冲突。
- 稳定版优先于预发布版，即使预发布版号更高。

### 4.4 迭代与冲突

采用**确定性局部修复**，不做全局回溯：

1. 建约束表：`package -> [{source, range}]`；`source=''` 表示根。
2. 把根包加入工作队列。
3. 取出一个包：
   - 计算满足所有约束的最佳候选；
   - 如果没有 → 记录 `missing`/`conflict`，继续处理其他包（最终计划被阻断）；
   - 如果候选变化 → 更新选择，移除旧版本带来的依赖约束，加入新版本的依赖约束，
     把受影响的包重新入队；
   - 如果没变化 → 继续。
4. 最多 N 轮（例如 1000 次包更新 / 50 轮），超过则 `resolutionCycle`。
5. 收敛后：
   - 所有根包必须有选择；
   - 所有被选包的依赖必须有选择；
   - 任何缺失/冲突 → `blocked=true`，但计划仍要展示"能做到哪一步/为什么不行"。
6. **不回溯**：如果某个早期选择导致后面冲突，报告冲突和来源，不悄悄换一套组合。
   这是刻意的：与 ALCOM 的确定性行为接近，且用户能理解。

### 4.5 卸载与 mark-and-sweep

- 计算从根依赖可达的包集合（沿所选版本的依赖）。
- 不可达的包：
  - 不是根依赖、不是受保护、不是旧式/未知 → 标记 `remove`，原因 `unused`；
  - 根依赖被用户 remove → 它和它的独占依赖可移除；
  - 仍被其他根依赖需要 → 保留；
  - `Packages/` 里存在但 manifest 没有（unlisted）→ **不自动移除**，只 warning。
- 移除顺序：先依赖者后被依赖者；计划里给出顺序。
- 默认不删用户手动装/未知包。
- 如果移除一个仍被其他保留包依赖的包：不要自动把依赖者也删掉；
  给 conflict/missing + 依赖者列表，让用户明确选择"连同依赖者一起移除"或取消。

### 4.6 计划输出

```ts
interface VpmPlan {
  planId: string                    // 主进程生成的一次性 id；不在渲染层伪造
  projectKey: string
  unityVersion: string | null
  manifestHashBefore: string        // 生成计划时的 manifest hash
  blocked: boolean
  changes: Array<{
    name: string
    action: 'install' | 'upgrade' | 'downgrade' | 'remove' | 'reinstall' | 'keep'
    from?: string
    to?: string
    isMajor?: boolean                // 仅 UI 提示，不改变解析
    reason: 'root' | 'dependency' | 'unused' | 'locked' | 'reinstall'
    requiredBy: Array<{ name: string; range: string }>
  }>
  finalPackages: Array<{ name: string; version: string; repoId?: string }>
  conflicts: Array<{
    name: string
    selected?: string
    requirements: Array<{ source: string; range: string }>
    reason: 'noCandidate' | 'rangeConflict' | 'unityIncompatible' | 'hashConflict' | 'cycle'
  }>
  missing: Array<{ name: string; requirements: Array<{ source: string; range: string }> }>
  warnings: Array<{ code: VpmErrorCode; params?: Record<string, string|number> }>
  downloads: Array<{
    name; version
    source: 'repo' | 'local'
    repoId?: string
    url?: string
    sha256?: string
    localPath?: string
    fingerprint?: string
    size?: number
  }>
  disk: { downloadBytes: number; installBytes: number; freeBytes?: number }
  requiresUnityClosed: true
}
```

要求：

- 顺序稳定（包名/动作排序）；同一输入多次运行结果完全一致。
- 每个变更都能回答"为什么"：根请求、哪个包要求、锁定、还是不再需要。
- 计划里不包含任何写操作。
- 远端包没有 SHA-256 → 不进入 `downloads`，给 `missingHash`；计划 blocked。
  本地包（P7）用目录指纹，不用远端 hash。
- 保护包不出现在 changes 里（除非 warning）。
- 计划 UI 可以只展示变化，但数据里要保留 keep 以便解释。

---

## 5. 代码位置

```text
src/shared/vpm/resolve.ts        纯解析器
src/shared/vpm/plan.ts           Plan 类型/排序/解释辅助
src/main/vpm/resolverService.ts  组装 manifest/installed/catalog/options
src/main/vpm/ipc.ts               PlanPreview
src/renderer/vpm/PlanSheet.tsx   只读预览（P4 复用）
```

- `resolve.ts` 不得 import Electron/DB/fs。
- `resolverService` 只读 DB/工程；不写。
- 为测试提供 `buildSyntheticCatalog` 之类的 helper，但不要放进生产包。

---

## 6. IPC 与 UI

### 6.1 IPC

`IpcInvoke.Vpm` 增加：

```text
PlanPreview   // { projectKey, requests, options? } 或
              // { projectKey, preset: 'upgradeAll', options? } -> VpmPlan (含 planId)
```

- 主进程重新读取工程/manifest/catalog，不信任渲染层的"当前状态"。
- **计划缓存**：主进程用内存 Map 保存 `planId -> { plan, inputHash, manifestHashBefore, expiresAt }`，
  有效期 10 分钟；应用时（P4）只接受 `planId`，重新读取工程状态并验证
  `manifestHashBefore` 仍然一致，**不信任渲染层回传的 Plan 内容**。
- 如果工程在 Unity 中运行：计划仍可生成，但 `requiresUnityClosed=true`；
  UI 在应用时（P4）才阻断。
- 错误码：`vpmProjectInvalid`、`vpmManifestInvalid`、`vpmNoCatalog`、
  `vpmResolutionFailed`、`vpmPlanBlocked`、`vpmPlanExpired`、`vpmPlanChanged` 等。
- 计划不持久化到磁盘；应用重启后重新预览。不需要新表。

### 6.2 UI（只读）

- 在包详情/工程详情加一个"预览安装"或"查看更改"入口（不要做完整购物车）。
- 选择：包 + 版本（默认最高兼容），可加多个请求；生成计划。
- "升级全部（最新）"走 `preset:'upgradeAll'`，生成同一个 PlanSheet；
  没有可升级项时按钮禁用并显示"已是最新"。
- PlanSheet 展示：
  - 新增/升级/降级/移除分组；
  - 每个变更的原因/要求来源；
  - 冲突/缺失（阻断时主按钮禁用）；
  - 下载大小/磁盘需求；
  - "Unity 必须关闭"提示；
  - 主按钮"应用更改"在 P3 禁用，文案"下一阶段提供"或隐藏。
- 不写盘、不下载；关闭即丢弃。
- 三语文案；截图。

---

## 7. 测试（重点）

新增：

```text
tests/vpm/resolve-basic.spec.ts
tests/vpm/resolve-locked.spec.ts
tests/vpm/resolve-conflicts.spec.ts
tests/vpm/resolve-prerelease.spec.ts
tests/vpm/resolve-unity.spec.ts
tests/vpm/resolve-removal.spec.ts
tests/vpm/resolve-upgrade-all.spec.ts
tests/vpm/resolve-protected.spec.ts
tests/vpm/resolve-determinism.spec.ts
tests/vpm/plan-sheet.spec.ts
```

场景至少覆盖：

1. 空工程装一个无依赖包。
2. 装一个带依赖的包；依赖自动加入；锁定快照正确。
3. 已锁定的包保持不变；根请求升级 → 升级；依赖要求更高 → 升级。
4. 根请求降级/精确版本；不满足 → 冲突。
5. 两个包要求不兼容范围 → 冲突，来源正确，不静默选一个。
6. 缺失依赖 → missing，blocked。
7. 预发布：不允许时跳过；允许时稳定优先；只有预发布满足时才选。
8. Unity 最低版本不满足 → 该版本跳过；全部不满足 → 冲突/缺失。
9. yanked 版本不选；已锁定 yanked → 保留 + warning。
10. 受保护包被依赖/请求 → 错误，不出现在 changes。
11. 旧式 Assets 包同名 → `legacyPackageConflict`，不静默安装。
12. remove 根包 → 独占依赖标记 unused；共享依赖保留；unlisted 不删。
13. 循环依赖 → 不死循环；给 cycle 或正常收敛（按语义）。
14. 同版本多仓库/hash 冲突。
15. 已安装但仓库下架的版本：保留可行；升级/重装无源时给明确错误。
16. 确定性：同一输入跑 100 次结果一致；包顺序打乱不改变结果。
17. 性能：5,000 个版本 / 200 个包 < 200ms（本机基线，记录实际）。
18. 计划不写盘：前后工程 mtime/hash 不变。
19. UI reducer：展示分组/阻断/原因；不出现"应用"可点击。
20. `upgradeAll`：根包按升级处理；仅传递依赖只加"尽量最新"偏好、不被提升为根依赖；
    受保护/unlisted/legacy 排除；无可升级项时全为 keep；任一冲突则 blocked 且仍列出原因。

测试数据全部自己造；不要复制 ALCOM 的用例/包。

---

## 8. 行为确认（不抄代码）

在沙盒里用 ALCOM（如果可用）或公开文档确认以下行为，把结论写进
`docs/VPM-CLEANROOM.md` 的观察日志：

- 锁定包在根请求变化时的升级/保留；
- 冲突时是否阻断、展示哪些来源；
- 不再需要的依赖是否自动移除；
- 预发布的选择偏好；
- Unity 不兼容时的表现；
- yanked 已安装版本的处理。

只记录"行为结论"，不贴源码/文案。若无法确认，按本提示词语义实现，并在报告里写"未验证"。

---

## 9. 完成定义

- [ ] `resolve.ts` 纯函数、确定性、无副作用。
- [ ] 计划包含变更/原因/冲突/缺失/下载/磁盘/警告。
- [ ] 锁定、预发布、Unity、yanked、受保护、旧式、卸载语义有测试。
- [ ] PlanSheet 只读预览可用；应用按钮不可用。
- [ ] 没有下载/写工程/新表；核心库不动。
- [ ] 全量测试/类型/构建通过；性能数字记录；净室日志更新。
- [ ] PR 合并；本机安装版更新（VPM 默认关闭）。
