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
| P1-C | HTTP、缓存与联网开关 | P1-A | `http/`、`cache/`、联网开关、fake 测试 | C8/C9/C10/G2/I6 | done |
| P1-D | 仓库服务、官方/curated 与来源合并 | P1-B/P1-C | `reposService`、`catalog`、种子仓库 | C1/C2/C8/C10/C14/B15 | done |
| P1-E | 只读包目录 UI、IPC 与三语 | P1-D | 仓库区、包抽屉、联网开关、IPC | B1/B2/B3/B13/B14 | done |
| P2-A | Unity 编辑器发现与手动添加 | P1-B | `unity/editors`、vpm.db v2、Hub 配置 | D1/D2/D3/D4/F4 | done |
| P2-B | 工程读取纯逻辑与 legacy 报告 | P1-A | `shared/vpm/domain/project.ts`、manifest 读取、fixtures | A1/A3/B17/A22 | done |
| P2-C | 工程台账 v2、VCC 工程与核心整合 | P2-A/P2-B | `projects/ledger`、vpm.db v2、只读 VCC 工程 | A1/A2/A3/A18/A23/B28/F1 | done |
| P2-D | 只读工程页 UI 与 IPC | P2-C | 工程列表/详情、打开文件夹、运行状态 | A1/A2/A3/A14/A18/A20/B17/B28 | done |
| P2-E | 当前工程与导入目标联动（核心） | P2-D | 目标绑定/优先级、工程页目标徽标、测试 | K1/K3/K6 | done |
| P3-A | 版本、范围、Unity 兼容纯逻辑 | P1-B | `domain/version|range|unityVersion|packageId` | B10/B12/B16 | done |
| P3-B | 解析器引擎、锁定与冲突 | P3-A/P1-D | `domain/resolver.ts`、候选/队列/冲突 | B10/B11/B12/B16/B22/K5 | done |
| P3-C | 变更计划、卸载、升级全部与解释 | P3-B | `domain/plan.ts`、mark-and-sweep、upgradeAll | B5/B7/B8/B9/B11/B27 | done |
| P3-D | 解析测试矩阵与只读计划 UI/IPC | P3-C/P2-D | 冲突矩阵、计划预览、解释面板 | B9/B11/B27/I9 | done |
| P4-A | vpm.db v3、journal 与操作状态机 | P3-C | `install/journal`、operations 表、恢复骨架 | B19/I3 | done |
| P4-B | 缓存、下载、hash 与解压安全 | P1-C | `cache/`、流式下载、zip 安全、原子落盘 | B20/B21/C9 | done |
| P4-C | 单包安装事务、manifest 最后写与 vault | P4-A/P4-B/P3-D | `install/transaction`、vault、预检/回滚 | B4/B5/B6/B8/B19/B22/B25/B29/K4/K5 | done |
| P4-D | 失败注入、崩溃恢复与并发 | P4-C | 每步失败用例、recovery、工程锁 | B19/B23/B29/I3/K4 | done |
| P4-E | 包管理 UI、批量与真 Unity E2E | P4-D/P2-D | 装/升/降/重装/卸、批量条、撤销入口 | B2/B4–B9/B26/B27/B28/I1/I9/K5 | todo |
| P4-F | 工程活动闸门与素材/包冲突防护 | P4-D/P2-E | 核心 activity 端口、包事务/清理保护、冲突测试 | K4/K5 | todo |
| P5-A | 模板格式、存储与原创内置模板 | P1-B | `domain/template`、模板库、版本化 | A4/A5/A6/A7/A8/A11 | todo |
| P5-B | 新建工程、校验与最近路径 | P5-A/P4-C | `unity/create`、骨架、vpm.db 最近路径 | A4/A5/A6/A21/A22 | todo |
| P5-C | unitypackage 读取与模板附件 | P5-A | `domain/unitypackage`、附件落盘、meta 原样 | A11/I5 | todo |
| P5-D | 启动 Unity、工程/模板 UI 与真机 | P5-B/P5-C | `unity/launch`、创建对话框、项目详情 | A4–A7/A12/A20/A21/D5/D10/K1 | todo |
| P5-E | 启动即绑定目标与双击素材真机验收 | P5-D/P4-F/P2-E | 启动绑定、双击导入真机、多实例回归 | K1/K2/K3/K6 | todo |
| P6-A | 文件收集器、排除规则与取消 | P2-B | `backup/collector`、排除表、进度/取消 | E1/E3/E4 | todo |
| P6-B | ZIP 备份、记录与从备份新建 | P6-A | `backup/service`、备份记录、恢复、打开位置 | A16/A17/E1–E7 | todo |
| P6-C | 复制工程与更换 Unity 版本 | P6-B/P5-D | `backup/copy`、`unity/version`、回滚 | A15/A19/D6/E9 | todo |
| P6-D | 旧式迁移、备份/迁移 UI 与真机 | P2-B/P6-C | `backup/migrate`、迁移向导、UI | B18/E8/K4/K5 | todo |
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
| P9-D | 回退演练与真机回归 | P9-C | L1–L5 演练记录、安装版回归 | G8/G9/I9/K1/K2/K4/K5 | todo |
| P9-E | 0.9.0 发布与安装版更新 | P9-D | Release、安装包、核对 | H5/G8 | todo |

> P0、P1-A…P1-E、P2-A…P2-E、P3-A…P3-D、P4-A、P4-B、P4-C、P4-D 已完成，
> 下一个执行任务是 **P4-E**（包管理 UI、批量与真 Unity E2E）；P4-C/P4-D 已经把
> “预检 → 暂存 → 换入 → manifest 最后写 → 旧 Assets → vault → 崩溃恢复”跑通并做了全步骤失败注入，
> 但**还没有在真 Unity 沙盒里装过包**（P4-E 的出门条件）。
> 开工前先读 §12 的 P1-A…P4-D 交接；如果发现与现有代码冲突，先改任务卡，不直接改代码。
> **素材联动是跨阶段硬需求**：P2-E 先做目标绑定核心，P4-F 做工程活动闸门，
> P5-E 用真 Unity 验“启动工程 → 设为导入目标 → 双击素材导入”。

---

## 4. 阶段门禁

| 阶段 | 出门条件（全部满足才算完成） |
|---|---|
| P0 | 已完成：默认关闭、可停用、可安全模式、快照可验证、核心 schema 11 |
| P1 | 纯逻辑测试全绿；断网可用缓存；无 C 缓存；只读 UI 不提供安装；包目录有来源/版本/错误 |
| P2 | 工程读取全程只读；不改 `Packages/`/manifest；运行状态不回归；VCC 只读；目标绑定只改应用状态 |
| P3 | 计划不写盘；冲突/缺失/锁定可解释；升级全部与单包同一套语义；受保护包不可选 |
| P4 | 每步失败注入可回滚；崩溃恢复可解释；工程活动闸门挡住导入/包事务并发；真 Unity 2022.3.22f1 沙盒通过 |
| P5 | 新工程能被真 Unity 打开；不手写 `.meta`；模板无第三方资产；启动参数不拼 shell；启动即绑定导入目标，双击素材真机导入成功 |
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
P1-A ── P2-B ─┴─ P2-C ── P2-D ── P2-E

P3-A ── P3-B ── P3-C ── P3-D
P1-B/P1-D ─────────────┘

P3-C ── P4-A ─┐
P1-C ── P4-B ─┴─ P4-C ── P4-D ── P4-E
                              └── P4-F

P5-A ── P5-B ─┐
P5-A ── P5-C ─┴─ P5-D ── P5-E
P2-E/P4-F ───────────────┘

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
- P4-E 与 P4-F（文件不重叠时）；
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
- **给 P1-C**：网络唯一入口必须放 `src/main/vpm/http(_)`；联网关闭时不得建立连接；
  测试用本地 fake，不要打公网；缓存路径只能从已验证的数据根派生，不能落 C。
  新的 HTTP 错误码先登记 `shared/vpm/errors.ts` 和三语 i18n，再写实现。

### P1-C（2026-10-21，done）

- **公开 API/契约**：`http/` 导出 `VpmHttpPort`、`createVpmHttpClient`、
  `createElectronHttpTransport`、`DEFAULT_VPM_HTTP_LIMITS` 和纯 policy 函数；
  `cache/` 导出 `VpmCacheStore`；`config.ts` 新增
  `readNetworkConsent/grantNetworkConsent/revokeNetworkConsent`；P1-E 追加 `isNetworkEnabled/setNetworkEnabled`。没有新增 IPC/UI。
- **联网门（P1-E 后语义）**：`createVpmHttpClient` 的 `isNetworkAllowed` 默认 false；
  回调为 false 时直接抛 `vpmNetworkNotConsented`，不调用 transport、不建连接。
  P1-D 接的是 `() => readNetworkConsent() !== null`；P1-E 改为
  `() => isNetworkEnabled()`，设置默认开启，由仓库区开关关闭。
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
  下载 hash/大小/部分文件清理、缓存路径逃逸/损坏/清理、联网关闭零请求、无 Cookie。
  其中 1 条既有 `bridge/lockfile` PowerShell 冷启动用例本轮因机器满载超时跳过（测试自报
  “没验，不算通过”），不是 P1-C 引入。
- **未验证**：真实公网/系统代理/TLS 连接没有打（按任务要求用 fake transport + mock
  Electron net）；真实仓库 JSON 与仓库/目录 UI 在 P1-D/P1-E。仅 Windows x64。
- **给 P1-D**：组合根创建 `VpmCacheStore({dataRoot})` 与
  `createVpmHttpClient({ transport: createElectronHttpTransport(),
  isNetworkAllowed: () => isNetworkEnabled(), userAgent: 'Atrium/<version>' })`；
  刷新仓库必须走 `getJson` 条件请求，304 保留旧行；下载走 `downloadToFile` + cache commit；
  不要在别处 import `electron.net` 或写 fetch。

### P1-D（2026-10-21，done）

- **公开 API/契约**：
  - `src/main/vpm/index.ts`：`initVpm(options)` / `VpmRuntime`，组装 DB/http/cache/store/repos/catalog，不注册 IPC。
  - `reposService.ts`：`ReposService` 的 `listRepos/addRepo/removeRepo/refreshRepo/refreshAll/seedIfEmpty/dispose`、
    `RepoDto/RepoRefreshResult`、`normalizeRepoUrl`、official/curated URL 常量。
  - `catalog/`：`CatalogService.query/getPackage` 与目录/版本/冲突 DTO。
  - `shared/vpm/domain/repo.ts`：仓库 JSON 纯解析；`domain/version.ts`：最小 SemVer 比较。
  - gate：新增 `startVpmRuntime()`、`VpmGateDeps.enableRuntime`、`VpmStatus.degradedCode`；
    app ready/enable 时动态加载 runtime，失败只降级。
- **数据/行为**：仓库 URL 归一/去重；刷新条件请求，304 保留包行；失败保留旧包行并记错误；
  official/curated 仅在联网可用且仓库表为空时种子（排序 0/1，不自动刷新）；同名包跨仓库合并，
  同版本不同 hash 标冲突。
- **已验证**：`npm run typecheck`、`npm run build` 退出码 0；全量测试
  **166 passed / 9 skipped files（175）**、**2188 passed / 19 skipped tests（2207）**；
  定向 VPM/仓库/目录/运行时/架构测试 59 条全绿。
- **沙盒实测**：packaged 0.9.0 在启用 VPM 的沙盒启动，日志出现“VPM 运行时已加载”；
  创建 `vpm.db`（user_version=1，两张表）；当时联网仍为关闭，因此仓库 0 个；手动打开后重启，
  种子 official/curated 两个仓库，`last_fetch_at` 仍为空，证明没有自动联网。
  （P1-E 起默认联网 + 首次打开自动刷新，见下。）
- **未验证**：没有对真实 VCC/官方仓库执行刷新（网络在本轮仍只经过 fake/mock）；
  IPC/UI 在 P1-E；仅 Windows x64。
- **给 P1-E**：runtime 目前由 gate 私有持有。P1-E 应在 `src/main/vpm/index.ts` 里加
  IPC 注册函数（由 gate 初始化成功后调用），不要把 runtime 服务暴露给核心其他文件；
  同意后要调用 `runtime.repos.seedIfEmpty()` 再刷新；UI 只通过 `renderer/vpm/api.ts`；
  `VpmStatus.degradedCode` 已可显示具体原因。

### P1-E（2026-10-21，done）

- **产品裁定**：2026-10-21 用户要求 **默认联网**；不再弹首次联网同意模态。
  仓库区提供默认开启的“联网”开关，关闭后 HTTP fail closed、只读缓存。
- **公开 API/契约**：新增 10 个 IPC 通道与 `shared/vpm/dto`：
  ReposList/RepoAdd/RepoRemove/RepoRefresh/RepoRefreshAll/NetworkConsent/NetworkStatus/
  CatalogQuery/PackageDetail/PackageVersions；`registerVpmIpc` 由 gate 注册一次，
  通过 `getRuntime()` 取当前 runtime，未就绪返回 `vpmRuntimeNotReady`。
  刷新返回 `operationId`，事件 `vpm:repo-progress`/`vpm:repo-done` 节流 ≥100ms。
- **设置**：`VpmSettingsFile.networkEnabled` 默认 true；旧文件缺字段按 true 读。
  `NetworkConsent` 语义改为“切换联网开关”；开启时补首次联网时间并 `seedIfEmpty`。
  `reposService.README`/IPC/HTTP 文档同步；P1-C 的联网门保留为关闭时 fail closed。
- **UI**：`VpmWorkspace` + `ReposPanel` + `CatalogDialog` + `useVpmRepos`；设置页仍一个入口。
  - 仓库区：名称/host/包数/上次成功/错误、联网开关、添加/刷新/移除、刷新全部；
  - 首次打开时若仓库从未成功刷新，自动刷新一次（本次沙盒 294+93 个包）；
  - 包目录：搜索、全部筛选（已安装/可更新禁用并说明）、详情、来源、版本/yanked/hidden/
    conflict、changelog/docs 外链确认；无安装按钮；
  - 关闭联网/离线时显示“仅缓存模式”，目录仍可读缓存。
- **截图**：`docs/screenshots/vpm-p1e-default-online.png`、`vpm-p1e-catalog-real.png`、
  `vpm-p1e-package-detail.png`、`vpm-p1e-network-off.png`、`vpm-p1e-add-repo.png`、
  `vpm-p1e-repo-error.png`。
- **已验证**：`npm run typecheck`、`npm run build` 退出码 0；全量测试
  **168 passed / 9 skipped files（177）**、**2203 passed / 19 skipped tests（2222）**；
  定向 IPC/API/UI 架构/i18n/config 测试 53 条全绿。
  沙盒 fresh profile：启用 VPM 后无联网询问、开关默认开、自动种子并刷新
  official/curated（294/93 个包）；打开包目录/详情正常；开关关闭后显示仅缓存、
  再开启恢复；官方仓库真实 HTTPS 刷新已验证。
- **未验证**：其他平台；键盘/焦点细节在 P8 收口；包安装/解析仍在 P3/P4。
- **给 P2-A**：runtime/IPC 的注册方式可复用；P2 只读工程，不要改 `Packages/`；
  需要展示包时继续用 `CatalogService` 的 DTO，不要把仓库 JSON/DB 行带给 UI。
- **给 P2-E/P5-E**：素材联动是硬需求；P2-E 做核心启动绑定/优先级，P5-E 真机验
  “打开工程 → 双击素材进该工程”，不要等 P8 再补。

### P2-A（2026-10-22，done）

- **公开 API/契约**：`src/main/vpm/unity/` 导出 `discoverUnityEditors(options?)`、
  `UnityInstallStore`、`UnityEditorService`、`listUnityInstalls(db)`、
  `parseHubEditorRecords/parseInstallRoots/parseUnityVersion/parseUnityArch` 与类型；
  `VpmRuntime.unity` 可在不启动 Unity 的情况下 discovery/refresh/addManual。
- **发现**：只读 `%APPDATA%\UnityHub\editors-v2.json`/`editors.json`、
  `secondaryInstallPath.json`/`settings.json` 的绝对安装根，再扫描
  `%ProgramFiles%\Unity\Hub\Editor`、`%ProgramFiles(x86)%\...`、`%LOCALAPPDATA%\...`。
  路径 realpath + 大小写不敏感去重；同一路径只留一条，不删除旧记录，只标 missing。
- **版本/架构**：优先 Hub 版本/revision，其次路径 `YYYY.MINOR.PATCH[abfp]N[cN]`；
  未知版本 `versionUnknown`，手动添加默认拒绝并给 `vpmUnityVersionUnknown`；
  未知架构按 x86_64 显示但 `archInferred=true`，DB 存 null；不启动 Unity 询问。
- **数据**：`vpm.db` v2 建 `vpm_unity_install` + `vpm_project`/`vpm_project_package`
  （后两张供 P2-C 使用，避免两卡抢同一迁移版本）；v1→v2 迁移前备份、必需表/完整性检查。
- **错误码**：新增 `vpmUnityNotFound/Invalid/AccessDenied/VersionUnknown`，三语齐全。
- **已验证**：`npm run typecheck`、`npm run build` 退出码 0；全量测试
  **169 passed / 9 skipped files（178）**、**2211 passed / 19 skipped tests（2230）**；
  定向 editors/db/runtime/errors/gate 38 条全绿。
  真实只读发现本机 `E:\unity\2022.3.22f1\Editor\Unity.exe`（source=scan，2022.3.22f1）。
- **未验证**：编辑器选择 UI/IPC（P2-D/P5-D）；启动 Unity；其他 Unity 版本真机；
  无权限/损坏 PE 的真机错误路径（单测用 fake 文件）。
- **给 P2-B/P2-C**：工程表 v2 已建好，P2-C 不要再加迁移；工程读取继续只读。
- **给 P5-D**：版本匹配用 `UnityInstall.version`/`versionWithRevision`；
  `source`/`missing`/`archInferred` 仅供展示/筛选，不要启动 Unity 去校验。

### P2-B（2026-10-22，done）

- **公开 API/契约**：`shared/vpm/domain/project.ts` 导出 `ProjectReaderPort`、
  `readProjectSnapshot(port, path, options?)`、`normalizeProjectPath/projectKeyOf/projectSlugOf`、
  `parseProjectVersion`、`parseVpmManifest`、`parseProjectPackageJson`、快照/legacy 类型；
  `domain/hash.ts` 是纯 TS SHA-256（不 import `node:crypto`）。
- **行为**：ProjectVersion 必须存在且合法；vpm-manifest 缺失视为空、坏 JSON 只给
  `vpmManifestInvalid` 并继续读 Packages；未知字段保存在 `manifest.data`。
  Packages 直接子目录读 `package.json`，状态覆盖 installed/missing/unlisted/mismatch/protected；
  legacy 扫描 Assets 深度 ≤4，忽略 Library/Temp/Logs/obj/.git/node_modules/隐藏目录和符号链接，
  只报告不迁移。指纹覆盖版本、manifest、productGUID、包 `package.json`。
- **边界**：领域层不 import `node:fs`/`node:crypto`/Electron；fs 读取由 P2-C 的 adapter 实现
  `ProjectReaderPort`。路径比较按 Windows 大小写不敏感，projectSlug 稳定。
- **错误/警告码**：新增 `vpmProjectInvalid/ManifestInvalid/ProjectPackagesUnreadable/
  ProjectAccessDenied` 与 4 个工程警告码，三语齐全。
- **已验证**：`npm run typecheck`、`npm run build` 退出码 0；全量测试
  **170 passed / 9 skipped files（179）**、**2224 passed / 19 skipped tests（2243）**；
  定向 project/errors/architecture 26 条全绿。
- **未验证**：真实 fs adapter/工程目录（P2-C）；真 Unity 工程；GUID 级 legacy 扫描（P6）；
  大工程耗时（纯逻辑有条目/深度上限，但未做真机计时）。
- **给 P2-C**：实现 `ProjectReaderPort` 时用 realpath + 只读；直接调用 `readProjectSnapshot`，
  不要把 fs/DB 行传到渲染层；`manifest.data` 只用于事务保留未知字段。

### P2-C（2026-10-22，done）

- **公开 API/契约**：`src/main/vpm/projects/` 导出 `ProjectFsReader`、`ProjectLedgerStore`、
  `ProjectsService`、`ProjectCorePort`/`VccProjectSource` 与工程台账类型；
  `VpmRuntime.projects`；gate 增加 `getCoreProjects/registerCoreProject/readVccProjects` 只读端口。
- **台账**：`upsertSnapshot/get/list/getByPath/remove` 写 `vpm_project*`；核心路径/运行状态
  仍是列表真相，台账只做快照缓存；`list()` 返回核心有/台账无、台账有/核心无（`linked=false`）
  两种状态；`remove()` 只删台账，不删盘/核心工程/导入历史。
- **VCC**：通过注入的 `VccProjectSource` 只读 `userProjects`；路径去重、坏路径记错误、
  不中断其他工程；没有写 VCC 的路径。
- **fs reader**：realpath 根、根内路径校验、拒绝符号链接/绝对路径逃逸；8 MiB 读取上限。
- **已验证**：`npm run typecheck`、`npm run build` 退出码 0；全量测试
  **172 passed / 9 skipped files（181）**、**2233 passed / 19 skipped tests（2252）**；
  定向 projects/runtime/architecture 24 条全绿。
  覆盖添加/刷新/移除、核心/台账合并、running/detectedBy、VCC 去重/坏路径/只读、
  ledger 字段保留、路径逃逸、缺失工程保留台账。
- **未验证**：真实 VCC userProjects 导入（只读测试用注入 source）；真实工程/真 Unity；
  P2-D 的 IPC/UI；超大工程扫描耗时。
- **给 P2-D**：只映射 `ProjectsService.list()` 为 DTO，不要在渲染层另存台账；
  移除按钮只删 VPM 台账；当前导入目标仍由核心 `UnityConnections` 管（P2-E）。

### P2-D（2026-10-22，done）

- **公开 API/契约**：`IpcInvoke.Vpm` 新增 ProjectsList/ProjectDetail/ProjectAdd/
  ProjectRemove/ProjectRescan/ProjectOpenFolder；`shared/vpm/dto/project` 定义 summary/detail/
  package/warning/legacy DTO；`renderer/vpm/api.ts` 增加同名包装和目录选择。
- **主进程**：`ipc/projects.ts` 只接受台账 `projectKey`（打开文件夹不接受任意路径）；
  `ProjectDetail` 现场只读扫描，`ProjectRescan` 才更新缓存；`ProjectAdd` 走 P2-C
  `addExisting`（含核心 `upsertProject`）；`ProjectRemove` 只删 VPM 台账。
- **UI**：现有 Project 页懒加载 `VpmProjectsSection`；搜索、添加已有工程、列表
  （运行状态/Unity 版本/包数/legacy 数/unlinked）、详情（概览/包状态/warnings/legacy）；
  打开文件夹、重新扫描、从台账移除；无安装/升级/卸载入口。
- **警告**：主进程把 missing/mismatch 包补成 `vpmProjectMissingPackage/
  vpmProjectVersionMismatch`；三语补齐。
- **已验证**：`npm run typecheck`、`npm run build` 退出码 0；全量测试
  **173 passed / 9 skipped files（182）**、**2238 passed / 19 skipped tests（2257）**；
  定向 IPC/渲染/i18n/架构 41 条全绿。
  沙盒 packaged 0.9.0 实机：Project 页出现“项目与包”；添加 `DemoProject` 后写入台账，
  列表显示 5 包/4 legacy；详情显示 protected/missing/unlisted/mismatch、两条包警告、
  legacy 候选；100%/125% 截图正常。
- **未验证**：移除确认/打开文件夹未在沙盒真点（IPC/服务有测试）；真 Unity 工程；
  编辑器匹配 UI（P5-D）；超大工程/长列表性能。
- **截图**：`docs/screenshots/vpm-p2d-projects.png`、`vpm-p2d-detail.png`、
  `vpm-p2d-add.png`、`vpm-p2d-projects-125.png`。
- **给 P2-E**：目标状态只看核心 `UnityConnections`；VPM 台账不保存当前目标；
  工程页可显示目标徽标，但不要复制一份当前工程。

### P2-E（2026-10-22，done）

- **公开 API/契约**：`UnityConnections` 新增 `bindLaunchTarget/clearLaunchTarget`；
  `UnityConnectionSnapshot.targetMode` 增加 `launch`，新增 `targetPending`；
  `shared/vpm/linkage.ts` 定义 `ProjectLinkagePort` 目标三方法；
  `VpmRuntime.linkage` + gate `projectLinkage` 由 main 注入。
- **优先级/清理**：显式 `select` > 启动绑定 > 单工程自动；启动绑定允许 closed；
  显式选择清除启动绑定；工程移除、启动后关闭、启动绑定被调用方取消时清除；
  选择 `null` 同时清启动绑定。绑定不跨重启持久化。
- **导入等待**：`prepare()` 对“启动绑定但还没运行”的工程不立即报 closed，
  按 180s/取消规则等待；resolveTarget 返回该工程，不会弹目标选择器/改投别的工程。
- **UI**：核心工程页显示当前目标徽标；启动等待时显示“等待 Unity 启动”；
  VPM 项目区通过同一快照显示目标徽标（不新增第二份目标状态）。
- **已验证**：`npm run typecheck`、`npm run build` 退出码 0；全量测试
  **173 passed / 9 skipped files（182）**、**2242 passed / 20 skipped tests（2262）**；
  定向 connections/renderer/architecture/i18n 105 条全绿。
- **未验证**：真正从 Atrium 启动 Unity 并触发绑定（P5-D/P5-E）；真 Unity 双击等待；
  VPM 行目标徽标的真机视觉（只有 props wiring 测试）。
- **给 P5-D/P5-E**：spawn 前调用 `runtime.linkage?.bindLaunchTarget(projectId)`；
  失败/取消调用 `clearLaunchTarget`；P5-E 真机验双击等待，不要另建目标状态。

### P3-A（2026-10-22，done）

- **公开 API/契约**：`domain/version.ts` 的 `parseVpmVersion/parseVpmVersionOrThrow/
  compareParsedVersions/compareVpmVersions/formatVpmVersion/isPrereleaseVersion`；
  `domain/range.ts` 的 `parseVpmRange/tryParseVpmRange/satisfiesVpmRange/exactVpmRangeVersion`；
  `domain/unityVersion.ts` 的 `parseUnityVersion/compareUnityVersions/
  isUnityVersionCompatible/unityVersionBase`；`domain/packageId.ts` 的
  `normalizePackageId/isValidPackageId/assertPackageId/packageIdSegments`。
- **SemVer**：严格 2.0（预发布 < 正式、build 不参与、非法前导零拒绝）；目录排序保留
  对 `1.0`/`v1.2.3` 的宽容降级，不让历史坏值炸目录。
- **范围**：精确、`^ ~ >= <= > <`、部分版本/`x/*`、空格 AND、`||`、连字符；
  `>= 1.2.3` 的空格写法也接受；`~>`/`!=`/逗号/括号/空 OR 明确拒绝；
  预发布默认按 SemVer 规则，显式 `includePrerelease` 可放宽。
- **Unity**：`YYYY.MINOR.PATCH[abfp]N[cN]`，允许部分版本；stage 缺省低于 a，
  c 后缀保留显示但兼容按基础版本；非法/超长给 `vpmUnityVersionInvalid`。
- **包名**：trim+小写，反斜杠/斜杠/控制字符/`..`/尾点/Windows 保留名拒绝，上限 214。
- **错误码**：新增 `vpmVersionInvalid/vpmRangeInvalid/vpmUnityVersionInvalid/
  vpmPackageIdInvalid`，三语齐全。
- **已验证**：`npm run typecheck`、`npm run build` 退出码 0；全量测试
  **176 passed / 9 skipped files（185）**、**2293 passed / 19 skipped tests（2312）**；
  定向 version/range/unity/package/repo/catalog 78 条全绿。
- **未验证**：P3-B 解析器/计划尚未接入；Unity 版本矩阵未真机矩阵化。
  真实仓库语料已从沙盒 `vpm.db` 抽取 **182 个版本、115 个依赖范围**跑解析，
  0 个非法（范围含 `3.10.0-beta.1`、`3.1.x` 等）。
- **给 P3-B**：候选选择用 strict `parseVpmVersion`/`satisfiesVpmRange`；预发布策略
  通过 `includePrerelease` 显式控制，不要退回宽容比较。

### P3-B（2026-10-22，done）

- **公开 API/契约**：`shared/vpm/domain/resolver.ts` 导出 `resolveVpmDependencies`、
  `ResolverInput/ResolveResult` 及请求/候选/冲突/警告类型。
- **语义**：约束表 + 工作队列 + 局部修复；根约束来源 `''`，依赖来源为包名；
  - locked 是偏好，无显式升级/降级且满足约束时保留；
  - 候选过滤：范围 → Unity → yanked/预发布 → 仓库优先级/同版本 hash；
  - 同版本不同 hash → `hashConflict`；受保护包/legacy → 永不选中；
  - 冲突/缺失保留 requirements；不回溯、不装一半；unused 只列已安装且不再可达，
    unlisted 单独列出且永不自动移除。
- **已验证**：`npm run typecheck`、`npm run build` 退出码 0；全量测试
  **177 passed / 9 skipped files（186）**、**2309 passed / 19 skipped tests（2328）**；
  定向 resolver 16 条全绿。另用沙盒真实仓库目录（387 个包版本）解析
  `com.vrchat.avatars ^3.0.0`：选中 3.10.5 + 3.10.5 base，blocked=false。
- **未验证**：P3-C 计划/升级全部/卸载 UI 尚未接入；真实工程 locked 快照对比未做；
  maxUpdates/深层环只用合成矩阵。
- **给 P3-C**：解析器输出 selected/requirements/conflicts/missing/unused；计划层负责
  action/reason/downloads/disk/planId，不要把解析规则复制到 UI。

### P3-C（2026-10-22，done）

- **公开 API/契约**：`domain/plan.ts` 导出 `buildChangePlan`、`ChangePlanInput/ChangePlan`、
  动作/原因/冲突/下载/磁盘类型。
- **行为**：
  - 从 resolver selected/installed 计算 install/upgrade/downgrade/reinstall/remove/keep；
  - `from/to/isMajor/reason/requested/requiredBy/repoId/risk` 可解释；
  - 移除只来自 resolver.unused，排除 protected/legacy/unlisted 和冲突/缺失包；
  - upgradeAll 只发 upgrade 请求，根包升级、传递依赖尽力最新但不提升为根；
  - 远端动作缺 URL/hash → blocked 且不产生 download；reinstall 无源 → missingSource；
  - `downloads/disk`、`requiresUnityClosed`、稳定 `planHash`（canonical JSON）。
- **已验证**：`npm run typecheck`、`npm run build` 退出码 0；全量测试
  **178 passed / 9 skipped files（187）**、**2319 passed / 19 skipped tests（2338）**；
  定向 plan/resolver 26 条全绿。覆盖安装/保持/升级/重装/移除/降级、独占/共享依赖、
  冲突/缺失、missingHash/missingSource、protected/legacy、upgradeAll、空升级、
  输入不变性和 catalog 顺序无关的稳定 hash。
- **未验证**：P3-D IPC/UI 和主进程 planId 缓存尚未接；真实工程 locked/manifest 生成
  计划未做；性能基准在 P3-D/P8。
- **给 P3-D**：直接消费 `ChangePlan`，只读展示 changes/conflicts/missing/downloads/disk；
  应用按钮不可用；不要重新解析或复制语义。

### P3-D（2026-10-22，done）

- **公开 API/契约**：新增 `PlanResolve/PlanExplain` IPC 与 `VpmPlanResolveInput/VpmPlanDto/
  VpmPlanExplainDto`；`PlanService` 从工程快照 + `CatalogService.resolverCatalog()` 组装计划，
  内存缓存 10 分钟；`VpmRuntime.plans`。
- **UI**：工程详情新增“查看变更”；`VpmPlanSheet` 支持升级全部、按包名/范围预览安装、
  允许预发布；展示动作分组/from→to/原因/requiredBy/冲突/缺失/警告/下载/磁盘；
  “应用更改”始终禁用并说明后续阶段；无任何写盘/下载。
- **矩阵**：新增 resolver-matrix/plan-matrix 表驱动用例；冲突必须有来源/版本解释。
- **已验证**：`npm run typecheck`、`npm run build` 退出码 0；全量测试
  **182 passed / 9 skipped files（191）**、**2342 passed / 19 skipped tests（2361）**；
  定向 plan-service/plan-matrix/resolver-matrix/IPC/renderer/i18n 56 条全绿。
  沙盒 packaged 0.9.0 实机打开 DemoProject 计划：显示升级 base 3.6.1→3.7.0、keep avatars、
  缺失 com.missing.pkg、unlisted 警告；plan 被阻断，应用按钮禁用；截图
  `docs/screenshots/vpm-p3d-plan.png`。
- **未验证**：应用计划/事务/planId 重新校验（P4）；UI 移除/安装执行；120%/深链路滚动；
  真实 locked 快照长期对比。
- **给 P4-A**：只接受 planId + manifestHashBefore 重新校验，不信任渲染层 Plan 内容；
  计划缓存过期/工程变化必须拒绝。

### P4-A（2026-10-22，done）

- **公开 API/契约**：vpm.db v3 新增 `vpm_operation`、`vpm_operation_step`、`vpm_operation_file`、
  `vpm_cache_entry`；`vpm_operation` 额外存 `project_path`/`plan_hash`，同工程
  `planned/preflight/applying` 部分唯一索引最多一条。
  `src/main/vpm/install` 导出 `OperationStore`/`OperationJournalStore`/`RecoveryService`；
  `VpmRuntime.operations/recovery` 可用，初始化时先 `recovery.scanAndApply()`。
- **状态机**：`planned → preflight → applying → committed`；预检失败 `failed`；可回滚失败
  `rolled_back`；无法判定 `needs_attention`。`needs_attention` 只能推进到
  committed/failed/rolled_back，不能回 applying；有未恢复操作的工程拒绝新操作
  （`vpmRecoveryRequired`），活动操作冲突 `vpmProjectBusy`。
- **提交点**：journal 的 `manifest_written`。未写 manifest 不能 `committed`；写入后不能
  `failed/rolled_back`。`markCommitPoint` 要求 `manifestAfterHash` 已存在。
- **journal**：`<project>/.atrium-tx/<opId>/journal.json`，原子写（临时文件 + fsync + rename），
  只认常规文件、拒绝 symlink/超限/结构不符；`events` 用幂等键只追加，不删历史；
  存 opId/projectKey/kind/phase/commitPoint/planHash/fingerprint/manifest hashes/
  steps/moves/legacyPaths/vaultPending；不存 token、请求头、文件内容。
- **步骤**：每步开始时写 journal + `vpm_operation_step`，结束时更新；同一操作同时最多一个
  running 步骤，seq 严格递增，重复 begin/finish 幂等；`vpm_operation_file` 只记路径/动作/
  hash/大小/状态（`move-out/move-in/legacy/vault`）。
- **恢复骨架**：只扫描 active 操作；工程不存在/缺 journal/journal 损坏/工程键不符 →
  `needs_attention`；未到提交点 → `rollback` 判定，P4-A 先落 `needs_attention`，不碰文件；
  已过提交点 → `complete` 并落 `committed`；Unity/导入活动 → `wait`，保持原状态。
  不用猜测补 journal，不删现场。
- **已记录错误码**：`vpmProjectBusy`、`vpmOperationNotFound`、`vpmOperationInvalid`、
  `vpmJournalInvalid`、`vpmJournalWriteFailed`、`vpmRecoveryRequired`（三语齐全）。
- **已验证**：`npm run typecheck`、`npm run build` 退出码 0；全量测试
  **183 passed / 9 skipped files（192）**、**2356 passed / 19 skipped tests（2375）**；
  定向 install/migrate/runtime/i18n 34 条全绿。新增 journal 状态/幂等/崩溃模拟/恢复判定矩阵。
  沙盒 packaged 0.9.0 启动时真实迁移 vpm.db **v2→v3**，生成并校验
  `vpm.db.bak-v2-20261022-080401`（user_version=2、integrity=ok），新库 user_version=3、
  9 张 vpm 表、0 个操作；本机安装 0.9.0 启动正常，真实 `library.db` 仍为 user_version=11，
  真实 `%APPDATA%\A\vpm` 未创建。
- **未验证**：真实下载/解压/移目录/manifest 写入/回滚（P4-B/P4-C/P4-D）；manifest rename
  与 journal 标记之间崩溃的恢复演练；真 Unity 下 `.atrium-tx` 是否被忽略（P4-C真机）；
  操作历史/恢复 UI（P4-E）；长路径/占用/只读失败注入。
- **给 P4-B**：直接使用已建好的 `vpm_cache_entry`，不要再加一个 v3 之后的迁移来抢缓存表；
  缓存写入仍走 `cache/` 的唯一写入者，事务只消费 hash/路径。**给 P4-C**：从 P3 planId
  缓存取计划、重新校验 manifestHashBefore；插入操作用 `OperationStore.create`，然后
  `transition(preflight/applying)`；每步 `beginStep/finishStep`，文件用 `upsertFile`；
  manifest rename 成功后 `markCommitPoint` 再 `committed`；失败在提交点前走 `failed/
  rolled_back`，提交点后只能 `needs_attention`/补完。不要信任渲染层 Plan 内容。

### P4-B（2026-10-22，done）

- **公开 API/契约**：`src/main/vpm/cache` 导出 `VpmCacheStore`（原有）、
  **`CacheEntryStore`**（`vpm_cache_entry` 表的唯一 SQL 入口）、
  **`PackageCacheService`**（下载 + 缓存编排）。`VpmRuntime` 新增
  `cacheEntries` / `packageCache`；`InitVpmOptions` 新增 `cacheQuotaBytes`（默认 20 GiB）。
  `src/main/vpm/install` 新增导出 **`extractPackageZip`**、`DEFAULT_ARCHIVE_LIMITS`
  及类型 `ArchiveLimits`/`ExtractPackageZipInput`/`ExtractedPackage`/`PreparedPackage`。
  `VpmHttpPort.downloadToFile` 新增 `onProgress`（调用方负责节流）。
- **缓存不变量**：包路径只由 64 位 hex SHA-256 派生；`cacheRoot` 必须是 dataRoot 的
  **严格子目录**（词法 + realpath 双检）；临时文件必须在 `tmp/` 内，`tmp/` 外的临时文件
  **拒绝且不删**；提交用同卷 `rename`；清理只动 `cache/packages`，
  绝不碰 `vault/`/`backups/`/工程文件。
- **下载流程**：无 SHA-256 → `vpmCacheHashMissing`（不触网）；同 hash 并发**共享一个下载**；
  命中缓存仍**完整重算 hash**，损坏则隔离到 `cache/corrupt`（保留字节）+ 删行后重下；
  下载边写边算 SHA-256；**只重试** `vpmHttpNetwork`/`vpmHttpTimeout`/5xx（最多 2 次），
  4xx 与 hash 不匹配**不重试**；落盘后**再完整校验一次**；进度节流 ≥100ms，
  回调抛异常不中断下载。
- **配额**：默认 20 GiB；下载前按 LRU 淘汰到配额内，淘汰时保护当前 hash；
  单包超过配额 → `vpmCacheQuotaExceeded`；磁盘可用 < size + 64 MiB → `vpmCacheNoSpace`。
- **解压安全**：逐条目拒绝 `..`/绝对路径/盘符/UNC/Windows 保留名/非法字符 `<>:"|?*`/
  控制字符/尾点空格/NFC+小写归一后的重复路径/文件-目录冲突/超长路径；
  符号链接条目 → `vpmArchiveSymlink`；压缩炸弹按**条目数/单条目/展开总量/压缩比/
  zip 文件大小**五维判定；写入用 `flags:'wx'` + `mode:0o600`，每步 `realpathSync` 复核
  仍在目标根内；流式计量器实时核对实际字节不超过声明值。
- **包根识别**：根有 `package.json` 则为根；否则**恰好一个**直接子目录含 `package.json`
  则为包根（兼容单层 wrapper）；0 个或多个 → `vpmArchivePackageInvalid`。
  校验 `name`/`version`/`vpmDependencies`；提供 `expected` 时精确匹配 name 与 `version.raw`。
- **失败取舍**：解压失败**保留目标目录与已解出的前缀文件**，不删除、不回滚工程文件——
  现场是诊断证据，清理由 P4-C 按 journal 决定。
- **已记录错误码**（三语齐全）：`vpmCacheHashMissing`、`vpmCacheQuotaExceeded`、
  `vpmCacheNoSpace`、`vpmArchiveInvalid`、`vpmArchiveUnsafePath`、`vpmArchiveSymlink`、
  `vpmArchiveBomb`、`vpmArchivePackageInvalid`、`vpmArchiveWriteFailed`（共 9 个）。
- **已验证**：`npm run typecheck` 干净；全量测试
  **185 passed / 9 skipped files（194）**、**2378 passed / 20 skipped tests（2398）**；
  定向 `tests/vpm/cache` + `tests/vpm/install` **44 条全绿**
  （store 11 / download 12 / archive 8 / journal 13）。覆盖 zip-slip、绝对/盘符/UNC/
  保留名/ADS/尾点/重复路径、symlink、炸弹四维、损坏包、已存在目标、失败保留现场；
  下载侧覆盖命中/损坏重下、无 hash 与大小不符、重试策略（4xx 不重试）、abort 清理、
  LRU 淘汰保护当前包、超配额拒绝、磁盘满、并发去重与进度节流。
- **未验证**：**真实仓库下载与真实包解压**（所有用例走假 HTTP 端口与夹具 zip）；
  真机 `statfsSync` 行为；真实 NTFS 长路径（>260）；与 P4-C 事务的实际衔接
  （"事务只消费 hash/路径"目前是设计意图）；`vpm_cache_entry` 与并发淘汰的一致性压测；
  真 Unity 下 `.atrium-tx` 是否被忽略（P4-C 真机项）。
- **给 P4-C**：用 `packageCache.ensurePackage({ url, sha256, size })` 拿包，
  用 `extractPackageZip({ zipPath, targetDir, expected })` 解到
  `<project>/.atrium-tx/<op>/install/<pkg>`；**缓存写入的唯一写入者是 `PackageCacheService`**，
  事务只消费 `{ sha256, size, path }`，不要自己写 `cache/` 或 `vpm_cache_entry`；
  `vpm_cache_entry` 表已在 P4-A 的 v3 建好，**不要再加迁移抢这张表**；
  `extractPackageZip` 失败会把现场留在目标目录，事务按 journal 决定清理或保留；
  `PreparedPackage` 已预留 `local` 分支（P7 接入），**不要写死 zip**。
- **备查**：本站的详细交接见 `docs/VPM-P4B-HANDOVER.md`，
  可直接复制的下站提示词见 `docs/PROMPT-P4B-HANDOVER.md`。

### P4-C（2026-10-22，done）

- **公开 API/契约**：`src/main/vpm/install` 新增导出 `InstallTransactionService`、
  `evaluatePreflight`/`collectPreflightFacts`/`requiredBytesFor`、
  `cleanupLegacyAssets`、`transactionLayout`/`ensureTransactionLayout`，
  以及类型 `ApplyPlanInput`/`ApplyPlanResult`/`TransactionProgress`/`TransactionWarning`/
  `ProjectActivityPort`/`LegacyGuardPort`/`PreflightFacts`。
  新增 `src/main/vpm/vault`（`VaultStore`）；新增 `src/shared/vpm/domain/manifest.ts`
  （`buildManifest` 纯函数）。`VpmRuntime` 新增 `vault`/`transactions`；
  `InitVpmOptions` 新增 `projectActivity`/`legacyGuard`（P4-F 注入真实实现）。
  `PlanService` 新增 `get(planId)`（事务唯一取计划的入口，过期/不存在都拒绝）。
  **没有新增 vpm.db 迁移**：P4-C 只用 P4-A 的 v3 表。
- **事务顺序**：`prepare → download → extract → move-out → move-in → manifest（提交点）→
  legacy → vault → cleanup`。`.atrium-tx/<op>/{install,trash/packages,trash/legacy,rolledback}`
  与 `manifest.original.json`/`vpm-manifest.new.json` 同卷。
- **提交点**：manifest 先在事务区写完 + fsync + 校验 hash，再 `rename` 覆盖
  `Packages/vpm-manifest.json`，然后 `markCommitPoint`（3 次重试）。
  rename 之前任何失败都反向恢复（新包进 `rolledback/`、旧包从 trash 移回、manifest 未动）；
  rename 之后（含 `markCommitPoint` 失败）一律 `needs_attention`，**不假装回滚**。
  回滚本身失败 → `needs_attention` + `vpmRollbackFailed`，现场不删。
- **预检拒绝矩阵**：计划 hash/工程键不符、计划 blocked/冲突/缺依赖、manifest 缺失或不可解析、
  manifest hash 被外部改、Unity 运行中、素材导入中、受保护包、缺 URL/缺 SHA-256、
  工程卷/数据根空间不足、回滚仓不可写、`.atrium-tx` 不可用、`Packages/<id>` 是文件/符号链接、
  “计划说新装但目录已存在”。移除目标不存在只给警告 `vpmProjectMissingPackage`。
- **manifest 规则**：未知顶层字段保留；`dependencies = plan.roots`；`locked` = 最终包精确版本 +
  依赖范围；**不在最终集合且未被显式移除的旧 locked 条目保留**（受保护/旧式/unlisted 包靠这条不被抹掉）；
  提交前再读一次原 manifest 算 hash 比对。
- **旧 Assets 清理**：只处理 `legacyFolders`/`legacyFiles` 声明且 `packageId` 属于本次移除的包；
  必须在 `Assets/` 下、不是 `Assets` 本身；遇到符号链接/受保护资产整条（目录则整目录）跳过；
  文件与目录都连同同名 `.meta` 一起移到 `trash/legacy/Assets/...`，不生成/不改写 `.meta`；
  失败只记 warning（`vpmLegacyCleanupFailed`），不回滚已提交的包。
  `LegacyGuardPort` 目前默认不保护任何路径，**`import_log` 已知资产要等 P4-F 注入**。
- **回滚仓**：`<dataRoot>/vault/<projectSlug>/<opId>/`；复制 + 逐文件 hash/大小校验，
  全部成功后才删事务区副本；目录用树摘要（`rel\0size\0fileHash` 排序后 SHA-256）；
  失败保留源目录；`vault_pending` 在归档前置 1、成功后置 0，失败保留 1 并给 warning。
- **已记录错误码**（三语齐全）：`vpmPlanBlocked`、`vpmProjectChanged`、`vpmUnityRunning`、
  `vpmProjectImporting`、`vpmProtectedPackage`、`vpmProjectNoSpace`、`vpmProjectPathUnsafe`、
  `vpmTransactionFailed`、`vpmRollbackFailed`、`vpmVaultUnavailable`、`vpmVaultArchiveFailed`；
  警告 `vpmLegacyCleanupSkipped`、`vpmLegacyCleanupFailed`、`vpmVaultPending`。
- **已验证**：`npm run typecheck` exit 0；定向 `tests/vpm/install` + `tests/vpm/vault` +
  `tests/vpm/domain/manifest.spec.ts` **5 files / 63 tests 全绿**
  （transaction 29 / journal 13 / archive 8 / vault 7 / manifest 6）；全量
  **187 passed / 1 failed / 9 skipped files（197）**、
  **2420 passed / 1 failed / 19 skipped tests（2440）**，唯一红的是
  `tests/classify/unitypackage.spec.ts` 的性能阈值（5005ms vs 5000ms，单独重跑 21 passed，
  与 P4-C 代码路径零重叠，属并行 perf 噪声）。
  覆盖：安装/升级/降级/重装/卸载成功路径、未知字段与 locked 保留、vault 归档内容、
  预检矩阵、下载/解压/移入失败注入、回滚成功、`needs_attention` 两条路径、
  vault 失败保留 `vault_pending`、legacy 路径级清理与三种保护。
- **未验证**：**没有在真 Unity 沙盒里装过包**（全部用临时工程 + 夹具 zip + 假包源）；
  没有对真实 VRChat 官方仓库跑过完整“下载→解压→换入”；
  真实 NTFS 上 rename 被占用（EBUSY/EPERM）的退避重试未实测；
  `markCommitPoint` 与 rename 之间崩溃的恢复（需要 P4-D 用 `afterHash` 对账）；
  并发/多工程并行未压测；长路径 >260 未实测。
- **给 P4-D**：`RecoveryService` 现在对“未过提交点”只判 `rollback` 并落 `needs_attention`，
  P4-D 要用 journal 的 `moves` + `manifest.afterHash` 做真实反向恢复；
  **建议先补一条判据**：磁盘 manifest hash == `manifest.afterHash` 时，即使 journal 还写
  `before`，也应判 `complete`（rename 与 markCommitPoint 之间的崩溃窗口）。
  `transactionLayout()` 已经给出 `rolledback/`、`manifest.original.json` 的位置，直接复用。
  失败注入可以直接注入 `extract`/`packages`/`operations`（测试里已有三种写法）。
- **已知偏差**：`evaluatePreflight` 的 `expectedPlanHash` 目前由 `plan.planHash` 传入，
  它防的是“缓存里的计划对象被替换/改坏”，不构成对渲染层的信任边界（渲染层只能给 planId）；
  P4-E 接 IPC 时如需更强校验，可在 DTO 里带 `planHash` 再比对。
  另外 P3 的解析器在 `vpm-manifest.json` 的 `dependencies` 里出现 `com.avca.bridge` 时会产出
  `protectedPackage` 冲突并阻断计划（P4-C 未改 P3，记录给 P3 复查；核心桥接安装器不写
  `vpm-manifest.json`，所以正常工程不会踩到）。
- **备查**：本站的详细交接见 `docs/VPM-P4C-HANDOVER.md`。

### P4-D（2026-10-22，done）

- **公开 API/契约变化**：
  - `RecoveryService.apply()` / `scanAndApply()` 改为 **async**（现在真的动文件）；
    `scan()` 仍是同步只读判定。`initVpm()` 里 `await recovery.scanAndApply()`。
  - `RecoveryServiceOptions` 新增 `vault`（补完归档）与 `renameRetries`。
  - `RecoveryReason` 新增 `project_changed`。
  - `InstallTransactionOptions` 新增 **测试专用** `hooks`；新增
    `TRANSACTION_HOOK_POINTS`（24 个点）与类型 `TransactionHookPoint`/`TransactionHookContext`/
    `TransactionHooks`。`crashOnError: true` 时 hook 抛错模拟进程死亡（不写状态、不 finishStep、不回滚）。
  - `InstallTransactionService` 增加进程内工程锁（`activeProjects`），同工程第二个 `apply()`
    直接 `vpmProjectBusy`。
  - `fsUtil` 新增 `renameSyncWithRetry`（启动恢复用，同步、不睡眠）。
- **恢复判定**（`scan`）：工程不存在/journal 缺失/损坏/键不符 → `needs_attention`；
  Unity/导入活动中 → `wait`；`commitPoint=manifest_written` → `complete`；
  **journal 还写 `before` 但磁盘 manifest hash == `afterHash` → `complete`**（P4-C 交接里那条
  rename↔markCommitPoint 崩溃窗口）；磁盘 manifest 既非 before 也非 after → `needs_attention`
  （`project_changed`）；其余 → `rollback`。
- **恢复执行**（`apply`）：`complete` 关掉遗留 running 步骤 → 缺提交点先补 `markCommitPoint`
  → `committed` → 补完 vault 归档；`rollback` 撤销 move-in（新包进 `rolledback/`）、恢复
  move-out（trash → `Packages/`）、恢复 legacy、用 `manifest.original.json` 还原 manifest，
  移动过文件 → `rolled_back`，一步没动 → `failed`；回滚失败 → `needs_attention` +
  `vpmRollbackFailed`。每步先看磁盘现状，**幂等**；已终态操作 `apply` 返回 `applied:false`。
  恢复**不重跑** legacy 清理（前进操作，不是回滚）。
- **失败矩阵**：`TRANSACTION_HOOK_POINTS` 24 个点逐个注入，结果表在
  `src/main/vpm/install/README.md` 的「失败矩阵（P4-D）」；提交点前失败时整棵工程树
  与操作前**逐字节一致**（按内容 hash 比较），提交点后失败只 `needs_attention` 不回滚。
- **并发**：同工程并发 → 一个 committed、一个 `vpmProjectBusy`（进程内锁先拦，DB 唯一索引兜底）；
  不同工程可并行；正常/崩溃恢复后锁都会释放；活动闸门抛错按 `vpmUnityRunning` 拒绝（fail closed）；
  同一 `planId` 第二次应用 → `vpmProjectChanged`（不重复安装）。
- **已验证**：`npm run typecheck` exit 0；定向 `tests/vpm/install` **6 files / 103 tests 全绿**
  （archive 8 / journal 13 / transaction 29 / failure-injection 29 / recovery 15 / concurrency 9）；
  全量 **189 passed / 1 failed / 9 skipped files（199）**、
  **2442 passed / 1 failed / 19 skipped tests（2462）**。唯一红的是
  `tests/classify/unitypackage.spec.ts` 的内存/耗时阈值（这次是 heap 增长越界，单独重跑
  21 passed），与 P4-D 代码路径零重叠，属并行 perf 噪声（P4-B/P4-C 交接已记录同一现象）。
- **未验证**：**仍然没有在真 Unity 沙盒里装过包**；真实 NTFS 上 rename 被占用（EBUSY/EPERM）
  的恢复路径未实测（恢复用的是同步立即重试）；跨进程并发（两个 Atrium 实例）未实测，
  只有 DB 唯一索引兜底；恢复期间的断电/再次崩溃只做了"重复执行"幂等验证，没有做真断电；
  长路径 >260 未实测。
- **给 P4-E**：`runtime.transactions.apply({ projectKey, planId, onProgress })` 可以直接接 IPC；
  `TransactionProgress` 已经给到 `step/phase/index/total`；失败结果里的 `warnings` 要原样透传
  （`vpmLegacyCleanupSkipped`/`vpmVaultArchiveFailed` 的 detail 是诊断明细）。
  `runtime.recovery.scan()` 给恢复 UI 用，`apply(decisions)` 是 async。
  **不要**在渲染层判断"是否需要恢复"——判定在 `scan()`，UI 只展示和确认。
- **已知偏差**：`RecoveryService` 的 `apply` 从同步变 async 是 P4-D 的公开 API 变更，
  `tests/vpm/install/journal.spec.ts` 与 `tests/vpm/runtime.spec.ts` 已同步改为新语义
  （未提交前失败 → 恢复为 `failed`/`rolled_back`，不再一律 `needs_attention`）。
- **备查**：详细交接见 `docs/VPM-P4D-HANDOVER.md`。

### P4 未验证项验证（2026-10-22，done）

- 报告：`docs/VPM-P4-VERIFICATION.md`（全部无头执行，不启动 Unity/Electron）。
- 已验证：真实仓库下载（官方 `com.vrchat.base@3.7.0`，13.82 MiB，SHA-256 一致）、真实 zip 解压
  （936 条目 / 32.09 MiB / 519 个 `.meta`）、`statfsSync` 真盘、长路径（248/374 字符可操作、
  ≥260 按策略拒绝）、真实 EPERM（只读 manifest）与 EBUSY（目录被占用）、跨进程并发、
  进程被杀后恢复、缓存配额与 `vpm_cache_entry` 一致性。
- 顺带修了两个 bug：`SQLITE_BUSY` 泄漏成裸错误码（→ 重试一次并映射 `vpmProjectBusy`）、
  并发淘汰在 `verifyFile` 异步窗口里留下"有行没文件"的孤儿缓存行。
- 仍未验证：真 Unity 装包、`.atrium-tx` 是否被 Unity 忽略、Electron `net` 传输、真断电
  （步骤写在验证报告 §10）。

---

## 13. 一句话

> 先读架构，再领一张卡；只改卡里的东西，做完写交接。
> 每张卡都能独立回退，整个 VPM 才能安心做完。
