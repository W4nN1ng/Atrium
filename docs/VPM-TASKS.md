# VPM 小任务板（v2）

> 从 2026-10-21 起，VPM 的**执行单位是任务卡**，不是 P0–P9 阶段文件。
> 阶段文件保留为规格/验收参考；任务卡在 `docs/prompts/tasks/`。
>
> 为什么要拆：一次让 Agent 读完整阶段（300–500 行 + 实现解剖 + 验收）会吃掉大半上下文，
> 结果不是漏做就是乱改。拆成小任务后，每个任务只读自己需要的章节，做完就能停、能评审、能回退。

---

## 1. 三层文档

| 层 | 文件 | 作用 | 执行时怎么用 |
|---|---|---|---|
| 架构合同 | `docs/VPM-ARCHITECTURE.md` | 分层、模块、数据所有权、测试/评审标准 | 每个任务都读相关章节 |
| 任务板 | 本文件 | 任务顺序、依赖、门禁、状态 | 领任务/更新状态 |
| 任务卡 | `docs/prompts/tasks/P?-?.md` | 一次可执行的范围、文件、步骤、验收 | **只执行当前一张** |
| 阶段规格 | `docs/prompts/VPM-P0.md` … `P9.md` | 行为细节、实现解剖、手工验收 | 只读任务卡指定的章节 |

共同规则：`docs/prompts/_COMMON.md`。开工前必读。

---

## 2. 状态图例

| 状态 | 含义 |
|---|---|
| `todo` | 未开始 |
| `doing` | 已开分支/正在做 |
| `blocked` | 有明确阻塞，写明原因 |
| `review` | PR 已开，等验证/合并 |
| `done` | 已合并，验收证据在 PR/任务卡 |
| `dropped` | 明确不做，写原因（需在 P8 对账里出现） |

**P0 已完成（0.9.0）**，保留作基线，不再拆执行任务。

---

## 3. 任务总表

> 「产物」是主要落点，不是全部文件；任务卡里有精确的文件所有权。
> 「对账」是 `docs/VPM-PARITY.md` 的编号；每个编号至少被一个任务覆盖。

| ID | 任务 | 依赖 | 主要产物 | 对账 | 状态 |
|---|---|---|---|---|---|
| P1-A | 模块边界、依赖方向与架构闸门 | P0 | 模块 README、依赖规则、`architecture.spec.ts`、renderer API 包装 | I4/I6/I7/I8 | done |
| P1-B | `vpm.db` v1、迁移器与仓储 | P1-A | `db/`、`repos/`、v1 表、迁移/备份 | C8/C14/I7 | done |
| P1-C | HTTP、缓存与联网同意 | P1-A | `http/`、`cache/`、同意门、fake 测试 | C8/C9/C10/G2/I6 | done |
| P1-D | 仓库服务、官方/curated 与来源合并 | P1-B/P1-C | `reposService`、`catalog`、种子仓库 | C1/C2/C8/C10/C14/B15 | todo |
| P1-E | 只读包目录 UI、IPC 与三语 | P1-D | 仓库区、包抽屉、同意模态、IPC | B1/B2/B3/B13/B14 | todo |
| P2-A | Unity 编辑器发现与手动添加 | P1-B | `unity/editors`、vpm.db v2、Hub 配置 | D1/D2/D3/D4/F4 | todo |
| P2-B | 工程读取纯逻辑与 legacy 报告 | P1-A | `shared/vpm/domain/project.ts`、manifest 读取、fixtures | A1/A3/B17/A22 | todo |
| P2-C | 工程台账 v2、VCC 工程与核心整合 | P2-A/P2-B | `projects/ledger`、vpm.db v2、只读 VCC 工程 | A1/A2/A3/A18/A23/F1 | todo |
| P2-D | 只读工程页 UI 与 IPC | P2-C | 工程列表/详情、打开文件夹、运行状态 | A1/A2/A3/A14/A18/A20/B17 | todo |
| P3-A | 版本、范围、Unity 兼容纯逻辑 | P1-B | `domain/version|range|unityVersion|packageId` | B10/B12/B16 | todo |
| P3-B | 解析器引擎、锁定与冲突 | P3-A/P1-D | `domain/resolver.ts`、候选/队列/冲突 | B10/B11/B12/B16/B22 | todo |
| P3-C | 变更计划、卸载、升级全部与解释 | P3-B | `domain/plan.ts`、mark-and-sweep、upgradeAll | B5/B7/B8/B9/B11/B27 | todo |
| P3-D | 解析测试矩阵与只读计划 UI/IPC | P3-C/P2-D | 冲突矩阵、计划预览、解释面板 | B9/B11/B27/I9 | todo |
| P4-A | vpm.db v3、journal 与操作状态机 | P3-C | `install/journal`、operations 表、恢复骨架 | B19/I3 | todo |
| P4-B | 缓存、下载、hash 与解压安全 | P1-C | `cache/`、流式下载、zip 安全、原子落盘 | B20/B21/C9 | todo |
| P4-C | 单包安装事务、manifest 最后写与 vault | P4-A/P4-B/P3-D | `install/transaction`、vault、预检/回滚 | B4/B5/B6/B8/B19/B22/B25 | todo |
| P4-D | 失败注入、崩溃恢复与并发 | P4-C | 每步失败用例、recovery、工程锁 | B19/B23/I3 | todo |
| P4-E | 包管理 UI、批量与真 Unity E2E | P4-D/P2-D | 装/升/降/重装/卸、批量条、撤销入口 | B2/B4–B9/B26/B27/I1/I9 | todo |
| P5-A | 模板格式、存储与原创内置模板 | P1-B | `domain/template`、模板库、版本化 | A4/A5/A6/A7/A8/A11 | todo |
| P5-B | 新建工程、校验与最近路径 | P5-A/P4-C | `unity/create`、骨架、vpm.db 最近路径 | A4/A5/A6/A21/A22 | todo |
| P5-C | unitypackage 读取与模板附件 | P5-A | `domain/unitypackage`、附件落盘、meta 原样 | A11/I5 | todo |
| P5-D | 启动 Unity、工程/模板 UI 与真机 | P5-B/P5-C | `unity/launch`、创建对话框、项目详情 | A4–A7/A12/A20/A21/D5/D10 | todo |
| P6-A | 文件收集器、排除规则与取消 | P2-B | `backup/collector`、排除表、进度/取消 | E1/E3/E4 | todo |
| P6-B | ZIP 备份、记录与从备份新建 | P6-A | `backup/service`、备份记录、恢复、打开位置 | A16/A17/E1–E7 | todo |
| P6-C | 复制工程与更换 Unity 版本 | P6-B/P5-D | `backup/copy`、`unity/version`、回滚 | A15/A19/D6/E9 | todo |
| P6-D | 旧式迁移、备份/迁移 UI 与真机 | P2-B/P6-C | `backup/migrate`、迁移向导、UI | B18/E8 | todo |
| P7-A | 仓库治理：编辑/启停/排序/导入导出 | P1-E | 仓库编辑、拖拽排序、lists | C3/C4/C5/C6/C13 | todo |
| P7-B | 请求头、密钥存储与测试连接 | P7-A/P4-B | `SecretStore`、safeStorage、脱敏 | C7/C15 | todo |
| P7-C | 本地用户包目录 | P7-B/P4-C | `localPackages`、信任/扫描、local 源 | C11 | todo |
| P7-D | VCC 只读导入与模板导入导出 | P2-C/P5-A | `interop/vcc`、settings 读取、模板互操作 | C12/F2/F3/F4/F5/F8/A9/A10 | todo |
| P7-E | 深链、单实例与互操作 UI | P7-C/P7-D | `atrium://`、`vcc://` 确认、集成 UI | F7/H4/C3–C7 | todo |
| P8-A | UI 收口、按钮纪律与组件边界 | P4-E/P5-D/P6-D/P7-E | 逐屏检查、组件拆分、文案 | I1/I2/A20/B24 | todo |
| P8-B | 操作记录、诊断导出与配额清理 | P4-A | `log/`、诊断包、缓存/vault/备份用量 | G3/G4/G5/I3 | todo |
| P8-C | 设置补齐、更新检查与已知限制 | P7-B | 设置项、手动更新、限制文档 | G1/G2/G3/G6 | todo |
| P8-D | 逐行功能对账与缺口分诊 | P8-A/B/C | 对账证据、差异、后续任务 | 全部 | todo |
| P8-E | 性能、可访问性与全量回归 | P8-D | 基准、键盘/焦点、回归记录 | I1/I2/I10/A13 | todo |
| P9-A | 安全硬化 | P8-E | 路径/zip/网络/密钥静态检查 | I4/I5/I6/I7 | todo |
| P9-B | 可靠性与并发硬化 | P9-A | 失败注入全集、恢复/锁、长稳 | I3/I9 | todo |
| P9-C | 性能、兼容与长路径 | P9-B | 基准、长路径、版本矩阵 | I10/D10/H1 | todo |
| P9-D | 回退演练与真机回归 | P9-C | L1–L5 演练记录、安装版回归 | G8/G9/I9 | todo |
| P9-E | 0.9.0 发布与安装版更新 | P9-D | Release、安装包、核对 | H5/G8 | todo |

> P0、P1-A、P1-B、P1-C 已完成，下一个执行任务是 **P1-D**（仓库服务、官方/curated 与来源合并）。
> P1-D 开工前先读 §12 的 P1-A/P1-B/P1-C 交接；如果发现与现有代码冲突，先改任务卡，不直接改代码。

---

## 4. 阶段门禁

| 阶段 | 出门条件（全部满足才算完成） |
|---|---|
| P0 | 已完成：默认关闭、可停用、可安全模式、快照可验证、核心 schema 11 |
| P1 | 纯逻辑测试全绿；断网可用缓存；无 C 缓存；只读 UI 不提供安装；包目录有来源/版本/错误 |
| P2 | 工程读取全程只读；不改 `Packages/`/manifest；运行状态不回归；VCC 只读 |
| P3 | 计划不写盘；冲突/缺失/锁定可解释；升级全部与单包同一套语义 |
| P4 | 每步失败注入可回滚；崩溃恢复可解释；真 Unity 2022.3.22f1 沙盒通过 |
| P5 | 新工程能被真 Unity 打开；不手写 `.meta`；模板无第三方资产；启动参数不拼 shell |
| P6 | 备份可解压；复制/换版本可回退；legacy 迁移有备份/事务/真机记录 |
| P7 | 不写 VCC；请求头不出明文；深链必须确认；本地包需显式信任 |
| P8 | 对账表无未解释空白；按钮纪律/可访问性通过；性能有基准 |
| P9 | 安全/可靠性/性能门禁全过；回退演练有记录；发布核对通过 |

**任何阶段门禁未过，不开始下一阶段。**

---

## 5. 依赖与并行

```text
P1-A ─┬─ P1-B ─┬─ P1-D ── P1-E
      │        │
      └─ P1-C ─┘

P1-B ── P2-A ─┐
P1-A ── P2-B ─┴─ P2-C ── P2-D

P3-A ── P3-B ── P3-C ── P3-D
P1-B/P1-D ─────────────┘

P3-C ── P4-A ─┐
P1-C ── P4-B ─┴─ P4-C ── P4-D ── P4-E

P5-A ── P5-B ─┐
P5-A ── P5-C ─┴─ P5-D

P2-B ── P6-A ── P6-B ── P6-C ── P6-D
P5-D ────────────────────┘

P1-E ── P7-A ── P7-B ── P7-C ─┐
P2-C/P5-A ── P7-D ────────────┴─ P7-E

P8-A/B/C ── P8-D ── P8-E
P9-A ── P9-B ── P9-C ── P9-D ── P9-E
```

图中的依赖是**最小技术依赖**，不是跨阶段抢跑的许可：实际执行仍受 §4 的阶段门禁约束，
上一阶段没关门（如 P1-E、P2-D、P4-E）就不开下一阶段。

阶段内可并行（文件不重叠时）：

- P2-A 与 P2-B；
- P4-A 与 P4-B；
- P7-A 与 P7-D；
- P8-A/B/C 三者。

除此之外默认单线，避免同一文件被两个任务改。

---

## 6. 上下文预算与拆分规则

每个任务卡顶部写「建议上下文」。执行时：

1. 只读任务卡列出的章节，不读整份阶段规格；
2. 不读无关模块的实现，除非任务卡明确要求；
3. 一个任务一个分支/PR，目标 **≤ 15 个文件、≤ 500 行非测试代码**；
4. 超过预算/范围：停下，先拆任务卡，更新本表，再继续；
5. 发现要改核心 schema、网络入口、数据所有权：先改架构文档和任务卡；
6. 任务完成后写交接段（见 §8），不要只写"完成了"。
7. 改了任务卡/本表/对账表后跑 `node tools/check-vpm-taskpack.cjs`；
   它检查任务卡与总表一一对应、对账项覆盖、章节引用和相对链接。

---

## 7. 任务卡模板

```markdown
# P?-? 标题

> 阶段规格：`../VPM-P?.md`（只读 §x/y）
> 前置：...
> 覆盖对账项：...
> 建议上下文：≤ ?k tokens

## 目标
## 不做什么
## 必读（只读这些）
## 文件所有权
## 交付物
## 施工步骤
## 契约与不变量
## 测试与证据
## 完成定义
## 交接（写进 PR）
```

任务卡不是"功能愿望"，必须能回答：

- 改哪些文件/模块；
- 新增/改变的公开 API；
- 失败时怎么回滚；
- 哪条测试能证明它；
- 下一任务需要知道什么。

---

## 8. 交接格式（每个 PR 必须有）

```text
Task: P?-?
状态: 完成 / 部分 / 阻塞
公开 API/契约变化: ...
新增/修改模块 README: ...
已验证: ...
未验证: ...
给下一个任务: ...
```

没有交接段的 PR 不算完成；下一个任务先读交接段，不重读整个实现。

---

## 9. 任务状态维护

- 开工：把状态改为 `doing`，在 PR 描述里写任务 ID。
- PR：`review`。
- 合并并验收：`done`；如果产品代码有变化，按 `AGENTS.md` 更新本机安装版。
- 阻塞：`blocked` + 原因 + 已尝试的办法；不要默默换方案。
- 任务卡内容变化：先改卡/本表，再改代码；PR 里说明为什么。

---

## 10. 与阶段规格/实现解剖的关系

- 阶段规格回答"这个功能应该怎样表现、ALCOM 是怎么做到的、我们独立怎么实现"。
- 任务卡回答"这一次只改哪一块、怎么证明"。
- 两者的对应关系：
  - P1 的行为/解剖：`VPM-P1.md` §3.5、§4–§9；
  - P2：§3.5、§4–§8；
  - P3：§3.5、§4–§6；
  - P4：§3.5、§4–§11；
  - P5：§3.5、§4–§9；
  - P6：§3.5、§4–§11；
  - P7：§3.5、§4–§8；
  - P8：§3.5、§4–§10；
  - P9：§1.5、§2–§5。
- 任务卡只能引用这些章节，不复制长段行为规格；避免两份文档漂移。
- 如果任务卡和阶段规格冲突：先改任务卡并说明；涉及产品行为再回头改阶段规格。

---

## 11. 变更管理

- 新增任务：插在合适依赖位置，更新 §3、§5；不要打乱已完成任务编号。
- 删除任务：状态 `dropped` + 原因；P8 对账要能解释。
- 拆分任务：保留原 ID 为父任务（`done`/`dropped`），新任务用 `P?-?a`/`P?-?b`；或改编号并在表里注明。
- 任何"顺手做"的想法：写成新任务，不在当前 PR 里做。

---

## 12. 任务交接记录

### P1-A（2026-10-21，done）

- **公开 API/契约**：`src/renderer/vpm/api.ts` 新增 `vpmApi.status/enable/disable/pickDataRoot`；
  P0 的 IPC 名称、设置格式、gate/config 行为未变。
- **模块 README**：`src/shared/vpm/README.md`、`src/main/vpm/README.md`、`src/renderer/vpm/README.md`；
  子模块 README 由各自任务落地时创建。
- **架构闸门**：`tests/vpm/architecture.spec.ts` 10 条，覆盖三层 import 方向、
  README 合同、网络/SQLite 唯一入口、跨模块只走 index、gate 唯一静态入口、设置页懒加载；
  `tests/renderer/vpm-api.spec.ts` 验证四个包装调用原样转发。
- **已验证**：`npm test` 156 passed / 9 skipped files、2109 passed / 19 skipped tests；
  `npm run typecheck`、`npm run build` 退出码 0；packaged 0.9.0 沙盒下 status/停用/重新启用通过。
- **未验证**：原生“选择文件夹”对话框仍走 P0 的输入框验收路径；没有做跨平台。
- **给 P1-B**：`db/`、`repos/` 落地时必须提供 `index.ts` 公开面；SQLite 只能出现在
  `db/`/`repos/`（gate 的只读快照完整性检查是 P0 例外）；不要改 P0 的 gate/config 行为。
  开工前先跑 `node tools/check-vpm-taskpack.cjs`，确认任务卡/对账表没有漂移。

### P1-B（2026-10-21，done）

- **公开 API/契约**：`src/main/vpm/db/` 导出 `openVpmDb(options?): Promise<VpmDb>`、
  `closeVpmDb(db)`、`VpmDb`、`VPM_SCHEMA_VERSION=1`；`src/main/vpm/repos/` 导出
  `RepoStore` 与仓库/包/目录查询类型。没有新增 IPC/UI。
- **数据/迁移**：库在 `P.vpmDb()`；从旧版本升级前 `quick_check` → `db.backup()` →
  备份只读校验（`integrity_check` + `user_version`）→ 事务迁移 → 全量完整性/必需表检查。
  更高 `user_version` 拒绝；`user_version=0` 但已有 VPM 表拒绝；备份失败不迁移。
- **仓储**：`RepoStore` 的 `listRepos/getRepo/getRepoByUrl/upsertRepo/updateRepoFetchState/
  removeRepo/replaceRepoPackages/queryCatalog`；替换包索引单事务，失败保留旧行；
  `queryCatalog` 支持文本/仓库/启用/隐藏/yanked/分页，返回按版本行（聚合留给 P1-D）。
- **错误码**：新增 `vpmDbOpenFailed/DbVersionTooNew/DbMigrationFailed/DbBackupFailed/
  DbIntegrityFailed/RepoInvalid/RepoConflict/RepoNotFound`，三语齐全。
- **README**：`src/main/vpm/db/README.md`、`src/main/vpm/repos/README.md`；
  `src/main/vpm/README.md` 已补 P1-B 落地位置。
- **已验证**：`npm run typecheck`、`npm run build` 退出码 0；全量测试
  **158 passed / 9 skipped files（167）**、**2127 passed / 20 skipped tests（2147）**。
  其中 1 条 `bridge/lockfile` 的 PowerShell 冷启动用例因机器满载超时被跳过（测试自己打印
  “没验，不算通过”），不是 P1-B 引入；定向 VPM 测试 32 条全绿。
- **未验证**：P1-B 尚未接到门面/组合根，所以应用启用 VPM 时还不会创建 `vpm.db`；
  这条接线在 P1-D。没有真实仓库 JSON/HTTP 参与（P1-C/P1-D）。仅 Windows x64。
- **给 P1-C**：网络唯一入口必须放 `src/main/vpm/http(_)`；未同意时不得建立连接；
  测试用本地 fake，不要打公网；缓存路径只能从已验证的数据根派生，不能落 C。
  新的 HTTP 错误码先登记 `shared/vpm/errors.ts` 和三语 i18n，再写实现。

### P1-C（2026-10-21，done）

- **公开 API/契约**：`http/` 导出 `VpmHttpPort`、`createVpmHttpClient`、
  `createElectronHttpTransport`、`DEFAULT_VPM_HTTP_LIMITS` 和纯 policy 函数；
  `cache/` 导出 `VpmCacheStore`；`config.ts` 新增
  `readNetworkConsent/grantNetworkConsent/revokeNetworkConsent`。没有新增 IPC/UI。
- **同意门**：`createVpmHttpClient` 的 `isNetworkAllowed` 默认 false；未同意直接抛
  `vpmNetworkNotConsented`，不调用 transport、不建连接。P1-D 接
  `() => readNetworkConsent() !== null`。
- **网络策略**：HTTPS-only、拒绝 userinfo、最多 5 跳逐跳校验、跨源自定义头停止、
  JSON 16 MiB / 下载 4 GiB、连接 15s / 空闲 60s / 总 30 分钟、可 Abort；
  UA/条件头/无 Cookie；证书校验开启。Electron 适配器用 `net.request` +
  `credentials:'omit'` + `useSessionCookies:false` + `redirect:'manual'`。
- **下载/缓存**：下载流式写 `.part`、边写边算 SHA-256、失败删临时文件；
  `VpmCacheStore` 校验 tmp/大小/期望 hash 后同卷 rename，路径用 realpath 限制在数据根；
  `verifyFile` 可发现磁盘损坏，`clearTmp/clearPackages` 只清缓存。
- **错误码**：新增 `vpmNetworkNotConsented/Http*/Cache*` 共 12 个，三语齐全。
- **README**：`src/main/vpm/http/README.md`、`src/main/vpm/cache/README.md`；
  `src/main/vpm/README.md` 已补 P1-C 落地位置。
- **已验证**：`npm run typecheck`、`npm run build` 退出码 0；全量测试
  **161 passed / 9 skipped files（170）**、**2156 passed / 20 skipped tests（2176）**；
  定向 VPM/HTTP/cache/config/架构测试 56 条全绿。
  覆盖 200/304/3xx、逐跳降级/跨源/上限、超时/取消、JSON 超限/坏 JSON、
  下载 hash/大小/部分文件清理、缓存路径逃逸/损坏/清理、未同意零请求、无 Cookie。
  其中 1 条既有 `bridge/lockfile` PowerShell 冷启动用例本轮因机器满载超时跳过（测试自报
  “没验，不算通过”），不是 P1-C 引入。
- **未验证**：真实公网/系统代理/TLS 连接没有打（按任务要求用 fake transport + mock
  Electron net）；真实仓库 JSON 与 UI 同意弹窗在 P1-D/P1-E。仅 Windows x64。
- **给 P1-D**：组合根创建 `VpmCacheStore({dataRoot})` 与
  `createVpmHttpClient({ transport: createElectronHttpTransport(),
  isNetworkAllowed: () => readNetworkConsent() !== null, userAgent: 'Atrium/<version>' })`；
  刷新仓库必须走 `getJson` 条件请求，304 保留旧行；下载走 `downloadToFile` + cache commit；
  不要在别处 import `electron.net` 或写 fetch。

---

## 13. 一句话

> 先读架构，再领一张卡；只改卡里的东西，做完写交接。
> 每张卡都能独立回退，整个 VPM 才能安心做完。
