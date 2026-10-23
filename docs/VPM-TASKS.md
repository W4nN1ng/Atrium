# VPM 小任务板（v2）

> 从 2026-10-21 起，VPM 的**执行单位是任务卡**，不是 P0–P9 阶段文件。
> 阶段文件保留为规格/验收参考；任务卡在 `docs/prompts/tasks/`。
>
> 为什么要拆：一次让 Agent 读完整阶段（300–500 行 + 实现解剖 + 验收）会吃掉大半上下文，
> 结果不是漏做就是乱改。拆成小任务后，每个任务只读自己需要的章节，做完就能停、能评审、能回退。

---

## 0. 当前队列：UX-RESET（2026-10-22 起，优先于下面所有 UI 卡）

用户实测反馈：界面臃肿、字小、废话多；新建工程打不开 Unity；备份没反馈；
拖放/选择文件退化。完整规格见 **`prompts/VPM-UX-RESET.md`**。

| 顺序 | 任务 | 状态 |
|---|---|---|
| R1 | Unity 启动带 Hub 许可参数 + 启动验证 + 失败给出口 | **done（用户已确认能打开）** |
| R2 | 备份进度与结果卡 + 打开所在位置 | **review（代码完成，待用户确认）** |
| R3 | 项目列表 ALCOM 化（大行、三动作、⋯） | **review（代码完成）** |
| R4 | 导航：项目置顶、默认落地页 | **review（置顶 + 默认落地页都做了）** |
| R5 | 删除"未匹配到集合"及连带逻辑 | **review（代码完成）** |
| R6 | 拖放文件夹/压缩包 + 多选 + 选文件夹 | **review（代码完成）** |
| R7 | 全量清理废话小字 | **done（两批共 10 处）** |
| R8 | 工程详情重排（大框 / 两按钮 footer / 高级折叠） | **review（代码完成）** |
| R9 | 字号与宽度再放大（列表 17px / 详情 1080px） | **review（代码完成）** |
| R10 | 详情标题去重 | **review（代码完成）** |
| R11 | 「当前工程」页换成纯「项目」页，删核心 Unity 工程面板 | **review（代码完成）** |
| R12 | 单工程启动拒绝 | **作废（R21 取代：允许多开）** |
| R13 | `⋯` 菜单 portal 浮层 | **review（代码完成）** |
| R14 | 新建工程：选到工程目录自动上移一级 | **review（代码完成）** |
| R15 | 添加已有工程：选根目录批量扫描 | **review（代码完成）** |
| R16 | 删除工程：弹窗置顶 + 回收站选项 | **review（代码完成，R17 会简化）** |
| R17 | 删除项目：只有「删除项目」，默认进回收站，无勾选 | **review（代码完成）** |
| R18 | 项目列表显示全部工程（核心 ∪ 台账） | **review（代码完成）** |
| R19 | 数据库固定 `%APPDATA%\Atrium`，不再问数据根 | **review（代码完成）** |
| R20 | 「项目与包」常开，去掉启用/停用 | **review（代码完成）** |
| R21 | 允许多开；2 个以上显示「设为导入目标」 | **review（代码完成）** |

P5-D / P6-D / P7-A / P7-B 的 UI 部分以 UX-RESET 为准；服务层已完成，不重做。

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
| P4-E | 包管理 UI、批量与真 Unity E2E | P4-D/P2-D | 装/升/降/重装/卸、批量条、撤销入口 | B2/B4–B9/B26/B27/B28/I1/I9/K5 | review |
| P4-F | 工程活动闸门与素材/包冲突防护 | P4-D/P2-E | 核心 activity 端口、包事务/清理保护、冲突测试 | K4/K5 | done |
| P5-A | 模板格式、存储与原创内置模板 | P1-B | `domain/template`、模板库、版本化 | A4/A5/A6/A7/A8/A11 | done |
| P5-B | 新建工程、校验与最近路径 | P5-A/P4-C | `unity/create`、骨架、vpm.db 最近路径 | A4/A5/A6/A21/A22 | todo |
| P5-C | unitypackage 读取与模板附件 | P5-A | `domain/unitypackage`、附件落盘、meta 原样 | A11/I5 | done |
| P5-D | 启动 Unity、工程/模板 UI 与真机 | P5-B/P5-C | `unity/launch`、创建对话框、项目详情 | A4–A7/A12/A20/A21/D5/D10/K1 | review |
| P5-E | 启动即绑定目标与双击素材真机验收 | P5-D/P4-F/P2-E | 启动绑定、双击导入真机、多实例回归 | K1/K2/K3/K6 | todo |
| P6-A | 文件收集器、排除规则与取消 | P2-B | `backup/collector`、排除表、进度/取消 | E1/E3/E4 | todo |
| P6-B | ZIP 备份、记录与从备份新建 | P6-A | `backup/service`、备份记录、恢复、打开位置 | A16/A17/E1–E7 | todo |
| P6-C | 复制工程与更换 Unity 版本 | P6-B/P5-D | `backup/copy`、`unity/version`、回滚 | A15/A19/D6/E9 | todo |
| P6-D | 旧式迁移、备份/迁移 UI 与真机 | P2-B/P6-C | `backup/migrate`、迁移向导、UI | B18/E8/K4/K5 | todo |
| P7-A | 仓库治理：编辑/启停/排序/导入导出 | P1-E | 仓库编辑、拖拽排序、lists | C3/C4/C5/C6/C13 | todo |
| P7-B | 请求头、密钥存储与测试连接 | P7-A/P4-B | `SecretStore`、safeStorage、脱敏 | C7/C15 | todo |
| P7-C | 本地用户包目录 | P7-B/P4-C | `catalog/local`、信任表 v6、面板、本地安装 | C11 | done |
| P7-D | VCC 只读导入与模板导入导出 | P2-C/P5-A | `interop/vcc`、settings 读取、模板互操作 | C12/F2/F3/F4/F5/F8/A9/A10 | todo |
| P7-E | 深链、单实例与互操作 UI | P7-C/P7-D | `interop/deeplink`、协议注册、确认弹窗 | F7/H4/C3–C7 | done |
| P8-A | UI 收口、按钮纪律与组件边界 | P4-E/P5-D/P6-D/P7-E | 逐屏检查、边界测试、文案 | I1/I2/A20/B24 | done |
| P8-B | 操作记录、诊断导出与配额清理 | P4-A | `log/`、诊断包、缓存/vault/备份用量 | G3/G4/G5/I3 | todo |
| P8-C | 设置补齐、更新检查与已知限制 | P7-B | 设置项、手动更新、限制文档 | G1/G2/G3/G6 | todo |
| P8-D | 逐行功能对账与缺口分诊 | P8-A/B/C | 对账证据、差异、后续任务 | 全部 | todo |
| P8-E | 性能、可访问性与全量回归 | P8-D | 基准、键盘/焦点、回归记录 | I1/I2/I10/A13 | todo |
| P9-A | 安全硬化 | P8-E | 路径/zip/网络/密钥静态检查 | I4/I5/I6/I7 | todo |
| P9-B | 可靠性与并发硬化 | P9-A | 失败注入全集、恢复/锁、长稳 | I3/I9 | todo |
| P9-C | 性能、兼容与长路径 | P9-B | 基准、长路径、版本矩阵 | I10/D10/H1 | todo |
| P9-D | 回退演练与真机回归 | P9-C | L1–L5 演练记录、安装版回归 | G8/G9/I9/K1/K2/K4/K5 | todo |
| P9-E | 0.9.0 发布与安装版更新 | P9-D | Release、安装包、核对 | H5/G8 | todo |

> P0、P1-A…P1-E、P2-A…P2-E、P3-A…P3-D、P4-A、P4-B、P4-C、P4-D 已完成；**P4-E 代码完成、状态 review**
> （缺真 Unity 2022.3.22f1 沙盒验收，需要开 Unity 才能补）。
> P6-D 服务层完成、状态 review（迁移服务 + 拒绝矩阵已做；**维护 UI 与真机未做**）。
> P7-A / P7-B 的 UI 已补齐（仓库编辑/启停/排序/导入导出、请求头、测试连接）；
> 下一个可执行的卡是 **P7-C**（本地包与 VCC 导入）。
> P4-C/P4-D 已经把“预检 → 暂存 → 换入 → manifest 最后写 → 旧 Assets → vault → 崩溃恢复”跑通并做了全步骤失败注入。
> 开工前先读 §12 的 P1-A…P4-E 交接；如果发现与现有代码冲突，先改任务卡，不直接改代码。
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

### P4-E（2026-10-22，review：代码完成，缺真 Unity 验收）

- **公开 API/契约变化**：
  - `IpcInvoke.Vpm` 新增 `PlanApply` / `OperationStatus` / `OperationCancel` /
    `OperationHistory` / `OperationUndo` / `ProjectCatalog`；
    `IpcEvent` 新增 `VpmOperationStarted` / `VpmOperationProgress` / `VpmOperationDone`。
  - `shared/vpm/dto/install.ts`：`VpmOperationDto` / `VpmOperationSummaryDto` /
    `VpmOperationProgressEvent` / `VpmProjectCatalogDto` 等。
  - `ApplyPlanInput` 新增 `onStarted` 与 `kind`（撤销时 `kind='undo'`）。
  - 新增 `src/main/vpm/undoService.ts`（`UndoService.canUndo/undo`）与
    `shared/vpm/domain/undo.ts`（`reverseRequests`，纯函数）。
  - `VpmRuntime` 新增 `undo`。
- **UI**：工程详情里的包管理面板 —— 已装数量/可更新数量、搜索 + 筛选（全部/已安装/可更新/有冲突）、
  每行版本下拉（含当前标记）、最新版本、状态、移除（二次确认，说明"移到回滚仓不永久删除"）、
  重装、勾选后底部变更条（不常驻）、"升级全部（最新）"走 `preset:'upgradeAll'`、
  变更单复用 `PlanBody` 并带风险确认、进度/取消/结果/`needs_attention` 说明、撤销入口、最近操作。
  受保护包显示"系统包"且没有勾选/版本/移除入口；Unity 运行中禁用并说明。
- **撤销**：只允许"该工程最后一次 + 已提交 + manifest hash == 那次 afterHash + Unity 未运行"，
  反向请求由 `reverseRequests` 推导，再走同一事务（`kind='undo'`）；不安全的撤销抛
  `vpmUndoUnsafe` 并在历史里显示原因。
- **已验证**：`npm run typecheck` exit 0；`npx electron-vite build` 通过
  （`VpmProjectsSection` chunk 75.97 kB）；`tests/renderer` + `tests/vpm`
  **70 files / 650 tests 全绿**；新增
  `tests/vpm/ipc/install.spec.ts`（9）/ `tests/vpm/domain/undo.spec.ts`（4）/
  `tests/vpm/renderer/cart.spec.ts`（9）。
  覆盖：只传 planId、进度/开始/完成事件、提交点前取消会 abort 且提交点后返回 `tooLate`、
  状态/历史映射与 `canUndo`、catalog 过滤受保护包、反向请求推导、变更单/筛选/受保护包不入单。
- **未验证（本卡不能算 done 的原因）**：**没有在真 Unity 2022.3.22f1 沙盒里装过包**，
  因此"装/升/卸后工程能打开""`.atrium-tx` 被 Unity 忽略""旧 Assets 清理后不丢引用"三条都没有证据，
  也没有沙盒截图。步骤写在 `docs/VPM-P4E-HANDOVER.md` §5，需要开 Unity 由用户执行。
  另外没有做 100%/125% 缩放的目视检查（需要真实窗口）。
- **给 P4-F**：`ProjectActivityPort` 已经贯穿预检与撤销闸门；把真实实现注入
  `initVpm({ projectActivity })` 即可，UI 侧 `detail.running` 已经能禁用入口。
  包事务的 `importing=true` 目前只能靠预检报 `vpmProjectImporting`，P4-F 接上端口后界面可提前禁用。

### P4-F（2026-10-22，done）

- **公开 API/契约变化**：
  - `shared/vpm/linkage.ts` 新增 `MaintenanceKind` / `ProjectActivitySnapshot` /
    `MaintenanceLease` / `ProjectActivityPort` / `LegacyGuardPort`（从 `install` 迁过来，
    `install` 仍 re-export，老引用不受影响）。
  - `ProjectActivityPort.acquireMaintenance(path, kind)` 是**必需**方法；`LegacyGuardPort`
    改为 `isProtected(projectPath, relativePath)` 并新增可选 `prime(projectPath)`。
  - `import/coordinator.ts` 新增 `setImportActivityHook()`；`importUnitypackage` /
    `rollbackImport` 用 try/finally 包住原实现（不改算法）。
  - 新错误码沿用 `vpmProjectBusy` / `vpmProjectImporting` / `vpmUnityRunning`（带 `kind` 参数）。
- **实现**：`src/main/project/activity.ts` 的 `ProjectActivityRegistry`（纯状态机，无 IO）+
  `createProjectActivityPort` + `createLegacyGuard`；组合根注入 gate → `initVpm`。
  身份是**归一化工程路径**（不是 project id），理由与细节写进 `VPM-ARCHITECTURE.md` §7.3.1。
- **互斥规则**：一个工程同时最多一个维护租约；导入计数 >0 或 Unity 在跑时拿不到租约；
  包事务在**预检通过后立刻**拿租约、`finally` 释放；释放幂等、只删自己那一个。
- **保护规则**：`com.avca.bridge` 的 legacy 声明即使进了移除集合也跳过（`protectedPackage`）；
  旧 Assets 清理按 `.meta` guid 与 `import_log` 的 created/overwritten 比对，命中即保留。
- **已验证**：`npm run typecheck` exit 0；`tests/project/activity.spec.ts` **14 条**、
  `tests/vpm/install/activity-gate.spec.ts` **6 条**全绿。覆盖：租约获取/重入/幂等释放/
  异常释放、导入计数与嵌套、Unity 运行（含探针抛错 fail closed）、不同工程并行、
  导入中拒绝安装（不写盘）、他人持租约时 `vpmProjectBusy`、成功/失败后租约都释放、
  预检失败不残留租约、`import_log` guid 保护（created/overwritten/无 meta/prime 刷新）、
  真实 `importUnitypackage`/`rollbackImport` 期间的 importing 上报与释放。
- **未验证**：**真 Unity 并发**（导入进行中点安装、安装进行中双击素材）没有真机证据；
  P6 的备份/复制/迁移还没接租约（那是 P6-D 的活）；跨进程（两个 Atrium 实例）不覆盖。
- **给 P5-A / P6-D**：所有维护动作先 `acquireMaintenance(path, kind)`，`finally` 释放；
  备份/复制在 `importing=true` 时必须拒绝（现在闸门已经会抛 `vpmProjectImporting`）。

### P5-A（2026-10-22，done）

- **公开 API/契约变化**：
  - 新增 `src/shared/vpm/domain/template.ts`（纯逻辑）：`parseTemplateManifest` /
    `serializeTemplateManifest` / `resolveTemplate` / `mergeTemplate` /
    `intersectUnityRange` / `rangesOverlap` / `normalizeAttachmentPath` / `isValidTemplateId`，
    常量 `TEMPLATE_SCHEMA_VERSION=1`、`TEMPLATE_MAX_DEPTH=8`、`TEMPLATE_MAX_ATTACHMENTS=32`。
  - 新增 `src/main/vpm/templates/`：`TemplateService`（list/get/raw/create/update/duplicate/
    setFavorite/removeReference/restore/markUsed/recentLocations/recordLocation）、
    `TemplateStore`、`BUILTIN_TEMPLATES`。`VpmRuntime` 新增 `templates`。
  - **vpm.db v4**：`vpm_template`、`vpm_recent_location` 两张表（`VPM_REQUIRED_TABLES[4]` 已更新）。
  - 新错误码：`vpmTemplateNotFound` / `vpmTemplateInvalid` / `vpmTemplateReadOnly` /
    `vpmTemplateWriteFailed`（三语文案齐全）。
- **模板格式**：`template.json`（schemaVersion=1），`base` 继承（Unity 范围取交集、依赖同名覆盖、
  附件追加、settings 浅合并、深度 ≤8、检测循环），未知顶层字段原样保留。
  附件路径必须是 `files/` 下的相对路径（拒绝绝对路径/`..`/反斜杠/重复）。
- **存储**：用户模板 `<dataRoot>/templates/<id>/template.json`（原子写）+ 可选 `files/`；
  内置模板代码生成、不落盘不入库；删模板 = `visible=0`，**不动用户文件**。
- **内置模板**：`builtin.blank`（无依赖）/ `builtin.avatars`（`com.vrchat.avatars >=3.0.0 <4.0.0`）/
  `builtin.worlds`（`com.vrchat.worlds >=3.0.0 <4.0.0`），推荐 Unity 2022.3.22f1，无任何附件。
- **已验证**：`npm run typecheck` exit 0；`tests/vpm/domain/template.spec.ts` 14 条 +
  `tests/vpm/templates/service.spec.ts` 16 条全绿；`tests/vpm` 44 files / 439 tests 全绿
  （含把 db 迁移测试整体升到 v4）。
- **未验证**：`.atriumtemplate` ZIP 的打包/解包没做（P7-D）；模板被建工程真正消费要等 P5-B；
  没有 UI 目视。
- **给 P5-B**：用 `runtime.templates.get(id)` 拿合并后的清单（`dependencies`/`unitypackages`），
  附件从 `filesDir(id)` 读；建完工程后用 `markUsed(id)` + `recordLocation(父目录)`。

### P5-B（2026-10-22，done）

- **公开 API/契约变化**：
  - 新增 `src/main/vpm/unity/create.ts`：`ProjectCreateService`（`validate` / `create`）、
    `TemplateAttachmentPort`（P5-C 注入）、`CreateIssueCode` 拒绝矩阵。
  - 新增 `src/main/vpm/projects/recent.ts`：`RecentLocationStore`（`vpm_recent_location`
    的唯一 SQL 入口，最近 8 条）；`TemplateService.recentLocations/recordLocation` 改为委托它。
  - `VpmRuntime` 新增 `create`。
  - 新错误码 `vpmCreateRejected` / `vpmCreateFailed`（三语）。
- **校验矩阵**：父目录存在/是目录/非链接/可写、不在已有 Unity 工程内、不在禁用根内；
  名称非法字符/保留名（CON、COM1…）/结尾点或空格/≤80/`.`/`..`/不逃逸；
  目标必须不存在（**空目录也算存在**）；路径 <260；空间 ≥ 估算×1.2+512 MiB；
  Unity 版本必须在已安装列表（没探测到编辑器时只给"未验证"警告）。
- **创建流程**：隐藏临时目录 `.atrium-create-<op>` → 骨架（`Assets/`、`Packages/`、
  `ProjectSettings/ProjectVersion.txt`、初始 `vpm-manifest.json`）→ 同卷 rename →
  `projects.addExisting` → 装模板依赖（P3/P4 事务）→ `markUsed` + `recordLocation`。
  **不写 `ProjectSettings.asset`、不写任何 `.meta`。**
- **失败策略**：rename 之前失败 → 临时目录移到回滚仓 `create-failed/`（回滚仓不可用时
  退到父目录旁的 `.atrium-create-failed-<op>`），**不永久删**；依赖安装失败 → **保留工程**，
  `dependencyStatus='failed'` 并给错误码，可重试。
- **已验证**：`npm run typecheck` exit 0；`tests/vpm/unity/create.spec.ts` **18 条**全绿
  （校验矩阵、骨架内容、无 `.meta`、依赖安装成功/失败、失败现场归档、附件端口、
  最近路径有界）。
- **未验证**：**没有用真 Unity 打开过新建的工程**（本工作站不启动 GUI，这是本卡唯一缺口）；
  模板附件解包（P5-C）；`kind=create` 的操作记录没做（`vpm_operation.kind` 有 CHECK 约束，
  要改就得重建表，收益不大；依赖安装本身有 `install` 操作记录）。
- **给 P5-C**：实现 `TemplateAttachmentPort` 后传给 `ProjectCreateService`，
  带附件的模板就能直接建；解包目标就是临时工程的 `Assets/`。

### P5-C（2026-10-22，done）

- **公开 API/契约变化**：
  - 新增 `src/shared/vpm/domain/unitypackage.ts`（纯逻辑）：`normalizeUnityPathname` /
    `planUnityPackage` / `isValidGuid`，常量 `UNITYPACKAGE_MAX_ENTRIES=100000`、
    `UNITYPACKAGE_MAX_BYTES=2 GiB`、`UNITYPACKAGE_MAX_PATH=260`。
  - 新增 `src/main/vpm/unity/unitypackage.ts`：`extractUnityPackage`、
    `createTemplateAttachmentPort`（P5-B 的 `TemplateAttachmentPort` 实现）。
  - 新错误码：`vpmUnityPackageInvalid` / `Unsafe` / `Conflict` / `TooLarge` / `Failed`（三语）。
  - `initVpm` 现在把附件端口注入 `ProjectCreateService`——带附件的模板可以直接建工程了。
- **规则**：只接受 `<32位guid>/<pathname|asset|asset.meta|preview.png>`；`pathname` 必须在
  `Assets/` 下（拒绝绝对路径/盘符/`..`/反斜杠/控制字符/保留名/结尾点空格/≥260）；
  同一目标大小写不敏感去重；**只搬 asset 与 asset.meta，绝不生成/补写 `.meta`**；
  缺 meta 只给 `missingMeta` 警告。
- **安全**：两段式（临时目录 → 校验 → 搬入），冲突/逃逸/超限时工程一个字节都没动；
  中途 IO 失败回滚已搬文件与本次建的空目录；条目/字节限额超了不写盘。
- **已验证**：`npm run typecheck` exit 0；`tests/vpm/domain/unitypackage.spec.ts` 7 条 +
  `tests/vpm/unity/unitypackage.spec.ts` 10 条全绿。覆盖：路径归一拒绝矩阵、
  计划去重/缺 meta/无效 guid、真实 tar.gz 的字节级 meta 保真、preview 忽略、
  冲突整体拒绝与 skip、路径逃逸、坏包、条目限额、"不写 meta" 源码守卫、附件端口。
- **未验证**：**没有在真 Unity 里看过导入结果**（P5-D 验证）；符号链接条目只在过滤层拒绝，
  没有构造真实符号链接包（Windows 建链接要权限）；没有用超大真实包压过。
- **给 P5-D**：`extractUnityPackage` 可直接用于"把 unitypackage 导进已有工程"；
  真机要确认 Unity 能识别搬进去的 `.meta`（字节原样，理论上是同一份）。

### P5-D（2026-10-22，review：代码完成，缺真机验收）

- **公开 API/契约变化**：
  - 新增 `src/main/vpm/unity/launch.ts`：`UnityLaunchService`（`resolveEditor` / `buildArgs` /
    `launch`）、`sanitizeArgs`；`VpmRuntime.launch`。
  - 新增 `src/main/vpm/ipc/unity.ts` + 7 个通道：`UnityInstalls` / `ProjectLaunch` /
    `ProjectLaunchArgs` / `ProjectCreate` / `TemplateList` / `TemplateFavorite` / `TemplateRecent`。
  - 新增 `shared/vpm/dto/unity.ts`：编辑器/启动/创建/模板/最近位置 DTO。
  - 新错误码 `vpmUnityLaunchFailed`（三语）。
- **启动规则**：编辑器解析顺序 = 本次指定 → 工程台账 `unity_exe_path` → 按
  `ProjectVersion.txt` 的 base 版本匹配（精确版本优先）；找不到报 `vpmUnityNotFound`，
  **不自动换版本**。参数只作为数组传 `spawn`，拒绝空字节/换行/超长，`shell: false`、
  `detached + stdio:'ignore' + unref()`、`windowsHide`。**先 `bindLaunchTarget` 再 spawn**，
  spawn 失败/异步 error 都 `clearLaunchTarget`；已在运行不重复启动但仍绑定目标。
- **UI**：工程页主按钮改为"新建工程"（添加已有降为次要）；新建对话框 = 模板卡片
  （内置/收藏/依赖数/附件数/Unity 范围）+ 名称/位置（最近位置快捷）/Unity 版本 + 创建；
  工程详情底部新增"打开 Unity"（编辑器下拉 + 自动按版本）；启动/已运行都有提示。
  当前导入目标徽标沿用核心 `isTarget`（P2-E 已有）。
- **已验证**：`npm run typecheck` exit 0；`tests/vpm/unity/launch.spec.ts` **10 条**全绿
  （版本匹配/精确优先/显式路径/工程台账/找不到/参数拒绝/绑定先于 spawn/detached 选项/
  已运行不重复启动/spawn 失败清绑定/缺版本文件拒绝）；`tests/vpm` 48 files / 486 tests。
- **未验证（本卡不能算 done 的原因）**：**没有真的启动 Unity、也没有用 Unity 打开过新建工程**；
  没有截图；`ProjectLaunchArgs` 的自定义参数编辑 UI 没做（只有 IPC 与参数校验）；
  设置页的模板编辑器（新建/编辑/复制模板）没做——本卡只做了创建对话框里的模板列表/收藏。
- **给 P5-E**：双击素材导入要依赖 P4-F 的活动闸门 + 本卡的启动绑定；
  真机验收时重点看"启动中/连接中"的徽标与"已运行也绑定目标"。

### P5-E（2026-10-22，review：代码完成，缺真机验收）

- **改动**：
  - `renderer/vpm/lib/target.ts`：目标徽标纯逻辑 `targetBadge()`（非目标 → null、
    启动/连接中 → `targetWaiting` warn、就绪 → `isTarget` accent）；
    `VpmProjectsSection` 改用它，不再内联两个 `&&`。
  - `docs/VERIFY-2026-10-22-VPM-MATERIAL-LINK.md`：14 步真机验收脚本
    （单工程链路 / 多实例优先级 / 失败路径 / 回归），带结果列。
- **不需要真机就能确认的不变量**（都有测试）：
  - 先 `bindLaunchTarget` 再 `spawn`；spawn 失败/异步 error 都 `clearLaunchTarget`；
  - 已运行不重复启动但仍绑定目标；没有 coreId 时不假装绑定；
  - 目标优先级 `manualId ?? launchId` 由核心 `connections` 固定；
  - 工程关闭/消失后 `pruneLaunchBinding()` 清绑定（核心已有）。
- **已验证**：`npm run typecheck` exit 0；`tests/vpm/unity/launch-target.spec.ts` 5 条 +
  `tests/renderer/vpm-launch-target.spec.ts` 3 条。
- **未验证（本卡不能算 done）**：真 Unity 2022.3.22f1 下"打开 Unity → 自动成为导入目标 →
  双击素材导入"的完整链路；多实例真机优先级；启动中双击等待的体验。**没有截图、没有
  `import_log` 证据**。
- **给 P6-A**：本卡没改导入/冲突/撤销算法，也没做跨重启目标持久化（刻意不做）。

### P6-A（2026-10-22，done）

- **公开 API/契约变化**：
  - 新增 `src/main/vpm/backup/collector.ts`：`collectProjectFiles(options)`、
    `isExcluded(relativePath, depth, managedPackages)`（纯函数）、`readManagedPackages(root)`。
  - `CollectOptions`：`root` / `mode`（backup|copy）/ `excludeVpmPackages` / `maxFiles` /
    `maxBytes` / `maxDepth` / `signal` / `onProgress`。
  - `CollectResult`：`files`（相对+绝对路径+大小）、`directories`、`fileCount`、`byteCount`、
    `warnings`、`truncated`、`elapsedMs`。
  - 新错误码 `vpmCollectCancelled`（三语）。
- **排除表**：根级 `Logs`/`obj`/`Temp`/`.git`/`.atrium-tx`（大小写不敏感，只在根）；
  任意层级 `.git`；`Library*` 整棵排除但**保留** `Library/LastSceneManagerSetup.txt`；
  可选排除 `vpm-manifest.json` 受管的 `Packages/<id>`（未知/本地包保留）；
  三个必须保留的文件任何规则都不能排除；隐藏文件保留。
- **安全**：不跟随符号链接/junction（记 `symlink` warning）；取消立刻抛
  `vpmCollectCancelled`；文件数 200k / 64 GiB / 深度 32 / 路径 260 命中即 `truncated`；
  权限不足记 warning 继续；只读、不改源文件。
- **稳定性**：`files` / `directories` 按相对路径排序，同输入同输出（压缩包可复现）。
- **已验证**：`npm run typecheck` exit 0；`tests/vpm/backup/collector.spec.ts` **14 条**全绿
  （排除表 5 组、真实目录收集、受管包排除、坏 manifest、junction 不跟随、取消、稳定排序、
  截断、进度、缺根拒绝）。
- **未验证**：没有在超大真实工程（>10 万文件）上压过；长路径只做了字符串策略，没有真造
  260+ 的路径；junction 用 `fs.symlinkSync(..., 'junction')` 造的，没覆盖其他 reparse point。
- **给 P6-B**：压缩直接用 `CollectResult.files` 的顺序写 zip，别再自己遍历；
  `truncated=true` 必须当失败处理，不能压一个残缺包。

### P6-B（2026-10-22，done）

- **公开 API/契约变化**：
  - 新增 `src/main/vpm/backup/zip.ts`：`writeZip`（`.part` 原子写 + 真三档压缩）、
    `readZipEntries`（写完读回校验）、`extractZip`（解压，拒绝逃逸/符号链接）、`safeZipPath`。
  - 新增 `src/main/vpm/backup/service.ts`：`ProjectBackupService`（`create` / `list` / `get` /
    `reveal` / `restore`）、`sanitizeFileStem`。
  - **vpm.db v5**：`vpm_backup` 表（状态 running/ok/failed/cancelled + error_code）。
  - `VpmRuntime.backup`；`initVpm` 新增 `revealPath`（gate 注入 `shell.showItemInFolder`）。
  - 新错误码 `vpmBackupCancelled/Failed/Invalid/Unsafe/TooLarge/Conflict`（三语）。
  - 新依赖：`yazl`（+ `@types/yazl`）——因为它支持 `compressionLevel`，三档才是真的。
- **备份**：先拿 P4-F 维护租约（导入/装包中拒绝）→ 收集 → `.part` 写 zip → rename →
  sha256 → yauzl 读回校验 → 写记录；取消/失败删 `.part` 并留 `cancelled`/`failed` 记录。
  Unity 运行中默认拒绝（`allowUnityRunning` 可覆盖）。
- **从备份新建**：目标必须不存在（`vpmBackupConflict`）；解压拒绝路径逃逸/符号链接；
  可选 `installPackages` 走同一条计划 + 事务补装。
- **已验证**：`npm run typecheck` exit 0；`tests/vpm/backup/service.spec.ts` **10 条** +
  collector 14 条；`tests/vpm/backup` + `tests/vpm/db` 20 条全绿。覆盖：zip 可读/内容正确/
  排除生效、store 与 normal 体积差异（真压缩）、取消留 cancelled 且无 `.part`、失败留 failed、
  未知工程/Unity 运行拒绝、从备份新建、非空目标拒绝、未知备份拒绝、installer 回调、路径安全。
- **未验证**：**没有用标准解压工具（7-Zip/资源管理器）真的解过**；没有在真机大工程（GB 级）
  上跑过；`revealPath` 没有在 Electron 里点过；从备份新建后的"补装依赖"没有真机跑过。
- **给 P6-C**：复制可以直接复用 `collectProjectFiles` + `copyTreeWithDigest`；
  换版本前记得先 `backup.create` 再动工程（P6-D 的 UI 会要求）。

### P6-C（2026-10-22，done）

- **新增**：`backup/copy.ts`（`ProjectCopyService.copy`）、`unity/version.ts`
  （`UnityVersionService.change`、`readProjectVersionFile`、`renderProjectVersionFile`）。
  `VpmRuntime` 新增 `copy` / `version`。
- **复制**：目标必须不存在、不能在源工程内、Unity 运行中拒绝；拿 `copy` 租约；
  复用收集器；先复制到 `.atrium-copy-<op>` 再 rename；失败改名保留现场；取消不留目标。
- **换版本**：Unity 运行中拒绝；目标编辑器必须已安装（不自动装）；默认先 `backup.create`；
  原子写 `ProjectVersion.txt`；写失败恢复旧内容并抛 `vpmUnityVersionChangeFailed`；
  返回 `downgrade` 与 `backupSkipped` 供 UI 警告。
- **新错误码**：`vpmCopyConflict` / `vpmCopyFailed` / `vpmUnityVersionChangeFailed`（三语）。
- **已验证**：typecheck exit 0；`tests/vpm/backup/copy.spec.ts` 9 条（复制内容/排除/非空/
  源内/运行中/取消、版本文件读写、备份调用、跳过备份、运行中/未安装/非法版本拒绝、
  写失败恢复）。
- **未验证**：真 Unity 换版本后能否打开（需要 GUI）；复制 GB 级工程；时间戳保留（没做）。

### P6-D（2026-10-22，review：迁移服务完成，UI 与真机未做）

- **新增** `backup/migrate.ts`：`ProjectMigrateService.migrate`。
  - 拒绝矩阵：Unity 运行中 / 未识别包 id / 低置信度 / 已在台账 / 仓库解析不到；
  - 每个包：默认先备份 → P3 计划 → P4 事务（旧 Assets 由 legacy 步骤进 vault）；
  - 逐条返回 `installed` / `skipped(reason)` / `failed(errorCode)`，一个失败不影响其余；
  - 拿 `migrate` 维护租约。
  - `VpmRuntime.migrate`。
- **已验证**：typecheck exit 0；`tests/vpm/backup/migrate.spec.ts` 5 条（备份调用、
  只装受信候选、低置信度/未识别/已装/仓库缺失跳过、逐条失败、运行中拒绝、跳过备份）。
- **UI（2026-10-22 补齐）**：工程详情新增"备份与维护"面板 —— 立即备份 + 最近 5 条记录
  （状态/时间/大小/打开位置）、复制工程（父目录 + 名称）、更换 Unity 版本（选编辑器 +
  自动备份 + 降级提示）、旧式迁移（勾选候选 → 迁移所选）。
  IPC：`backup-create/list/reveal`、`project-copy`、`project-version-change`、`project-migrate`。
- **未做/未验证**：**真 Unity 迁移验证没做**；Unity 2022 特例检测只靠现有 legacy 报告，
  没有单独的"未验证"标注；没有目视（不开窗口）。

### P7-A（2026-10-22，review：服务层 + IPC 完成，UI 未做）

- **公开 API/契约变化**：
  - `ReposService.updateRepo(id, {name?, url?, enabled?})`：URL 变更清抓取状态并重抓，
    **旧包行保留到抓取成功**；URL 冲突报 `vpmRepoConflict`。
  - `ReposService.reorderRepos(ids)`：按给定顺序重写 `sort_order`，未列出的追加在后面。
  - `ReposService.importRepos(text)` / `exportRepos()` / `parseRepoImport(text)`：
    支持纯 URL（一行一个、`#` 注释）与我们自己的 JSON（`atrium.repos` v1）；
    重复跳过、坏 URL 单独返回，一条坏的不影响整批。
  - `RepoStore.setSortOrders()`；IPC 新增 `repo-update` / `repo-reorder` /
    `repo-import` / `repo-export`；preload 与渲染层 API 同步。
- **已验证**：typecheck exit 0；`tests/vpm/repos/governance.spec.ts` **7 条**
  （改名/启停、URL 变更清状态但保留旧包、URL 冲突、排序落库、导出再导入去重、
  纯文本导入跳过坏行与重复、两种格式解析）。
- **UI（2026-10-22 补齐）**：仓库卡片上有启用开关、↑/↓ 排序、编辑（名称/URL）、请求头、
  测试连接、刷新；工具条上有导入/导出对话框。全部是次要按钮，没有新增实心主按钮。
- **目视（2026-10-22）**：已用离屏预览截图检查（`docs/verify/vpm-ui-2026-10-22.png`），
  修掉 3 个问题：失败行显示成半句话、↑/↓ 太细看不清、同屏两个实心主按钮。
- **未验证**：排序对"同版本多源优先级"只依赖既有 `queryCatalog` 排序，没有专门断言；
  URL 变更后的真实重抓（联网）没跑（本工作环境拦截了 `packages.vrchat.com`）。

### P7-B（2026-10-22，review：SecretStore + HTTP 接线完成，IPC/UI/测试连接未做）

- **新增** `src/main/vpm/secrets/index.ts`：
  - `SecretStore` 接口 + `MemorySecretStore`（测试用）+ `createSafeStorageSecretStore`（Electron
    safeStorage 加密后落盘，文件里只有密文）；
  - `validateSecretHeaders`（头名白名单：拒绝 cookie/host/content-length 等、长度/控制字符）；
  - `redactHeaders`（日志只留头名）；`repoScope` / `packageScope`。
  - 不可用时 `available()=false`、`set()` 抛 `vpmSecretUnavailable`，**不写明文**；
    解密失败当"没设"，不打断刷新。
- **接线**：`ReposServiceOptions.secrets`；`refreshRepo` 只在这里取仓库级头并传给
  `http.getJson({ headers })`——头不进 DTO、不进日志、不回渲染层。
  HTTP 层原有的"自定义头跨源重定向停止"保持不变。
- **已验证**：typecheck exit 0；`tests/vpm/secrets/store.spec.ts` **8 条**
  （头校验/脱敏、内存存储、密文落盘不含明文、不可用拒绝存储、坏密文当缺失、列表只给头名、
  package scope 归一）。
- **IPC/UI（2026-10-22 补齐）**：`repo-headers` / `repo-headers-set` / `repo-headers-clear` /
  `repo-test`；仓库卡片上的"请求头"对话框（只回显头名、值必须重填）与"测试连接"按钮。
  `initVpm` 新增 `secretStorage`，gate 注入 Electron `safeStorage`。
- **真机抽查（2026-10-22）**：真实 Electron `safeStorage` 通过（`available:true`、
  落盘无明文、读回一致、清除生效）；真实 HTTP 客户端经代理跑到 `200` + 自定义头 + 404 映射；
  `packages.vrchat.com` 被本工作环境网络策略拦截（curl 同样握手失败），需用户本机验证。
  详见 `docs/VERIFY-2026-10-22-VPM-UI.md`。

### P7-C（2026-10-23，done）

- **公开 API/契约变化**：
  - `catalog/local.ts`：`readLocalPackage` / `scanLocalPackages` / `diffLocalPackages` /
    `LocalPackageStore`（`list/get/add/remove/scanAll`）。
  - `catalog/localInstall.ts`：`LocalInstallService.install/plan`。
  - **vpm.db v6**：`vpm_local_root(id, path UNIQUE, label, created_at, last_scan_at, package_count)`。
  - IPC：`local-roots / local-add / local-remove / local-scan / local-install`。
  - 新错误码 `vpmLocalRootInvalid`（三语）。
- **扫描规则**：目录本身有 `package.json` 当单包，否则扫**下一层**（不递归）；
  校验包名（`com.foo.bar`）与版本；`unity` 写错只丢字段不拒包；变化按 `package.json` 的 sha256。
- **信任**：只有用户显式添加的目录才扫；拒绝不存在/符号链接/无包/重复路径；
  移除只取消信任、**不动文件**。
- **安装**：独立于 zip 事务（事务假设"下载 zip + sha256"，本地包两者都没有）——
  校验 → 取最高版本 → 目标不能存在 → 维护租约 → 拷到 `.atrium-local-<id>` → rename
  → 最后写 `vpm-manifest.json`（提交点），写失败撤销拷贝。Unity 运行中拒绝。
- **UI**：设置页「本地包目录」面板（添加/移除/包数/包列表）；包面板「从本地装包」弹窗。
- **刻意没做**：**不把本地包注入远程目录/解析器**。那会让它们进入 zip 下载管线
  （`url`/`sha256` 为 null），把两条失败路径搅在一起；本地包的安装入口就是
  「从本地装包」。包浏览里看不到本地包，这是已知取舍。
- **已验证**：typecheck 0；build 过；`local.spec` 7 条 + `local-store.spec` 4 条 +
  `local-install.spec` 5 条；通道清单 18 条。
- **未验证**：真机装一个本地包进真实工程（需要 Unity 关闭 + 真实包目录）。

### P7-D（2026-10-23，done）

- **公开 API/契约变化**：
  - `interop/vcc.ts`：`readVccSettings/parseVccSettings`（只读；HTTPS 校验；按值去重；
    坏条目进 `skipped`；坏 JSON 只标 `parseError`；文件不存在 `exists:false`）。
  - `interop/templateIO.ts`：`parseTemplateFile/exportTemplate`
    （认 Atrium 格式与外部形状；缺 name 用文件名兜底；非对象 `vpmTemplateInvalid`）。
  - IPC：`interop-vcc-peek / interop-vcc-apply / template-import / template-export`。
  - 新错误码 `vpmInteropNotFound`（三语）。
- **UI**：设置 → 项目与包 新增「互操作」区：从 VCC/ALCOM 导入（先列仓库数/目录数/跳过数，
  勾选后才写）、导入模板文件、导出模板（每个用户模板一行「导出」）。
- **安全边界**：**只读**对方设置、绝不写回；VCC 里的路径只是"读出来"，
  加进本地信任表要用户勾；模板导出不注册全局文件关联、不复制附件。
- **刻意没做**：VCC 的 LiteDB 模板只读适配（卡片标"可选"）。读它要额外依赖，
  而我们自己的模板导入已覆盖需求。
- **已验证**：typecheck 0；build 过；`interop/vcc.spec.ts` 7 条 + 通道清单 22 条 +
  renderer 29 files / 202 tests 全绿。
- **未验证**：真机有 VCC/ALCOM 安装时的导入（这台机器的设置路径可能不同）。

### P7-E（2026-10-23，done）

- **公开 API/契约变化**：
  - `interop/deeplink.ts`：`parseDeepLink` / `deepLinksInArgv`；
    意图只有 `open-project` 与 `add-repo`，其余返回 `unknown`。
  - `main/index.ts`：注册 `atrium://`（开发态带 execPath）；第二实例的 argv 里的深链
    转发给第一实例；冷启动的深链先攒着，窗口建好 1.5s 后补发（走 `broadcast`）。
  - 新事件 `vpm:deeplink`。
  - 渲染层 `DeepLinkHost`（挂在 App）：`open-project` 直接切项目页并加入列表；
    `add-repo` **必须确认**才写入。
- **安全边界**：任何带 `headers/token/authorization/password/secret/cookie` 的链接
  **整条拒绝**（不是忽略参数）；非 https 的仓库 URL 拒绝；`vcc://` 只解析、不落库。
- **单实例**：第二实例只做"唤醒窗口 + 转发路径/深链"，不重复初始化。
- **已验证**：typecheck 0；build 过；`deeplink.spec.ts` 7 条 + ipc 通道 22 条 +
  renderer 33 files / 253 tests 全绿。
- **未验证**：真机点一个 `atrium://` 链接（需要装包后由系统唤起；开发态注册的是 electron.exe）。

### P8-A（2026-10-23，done）

- **逐屏检查表**：`docs/VPM-P8A-UI-AUDIT.md`（9 屏：入口/主按钮/批量/危险操作/空错状态）。
- **改了 2 处**：
  - 项目页空状态的「添加项目」从实心降为文字（和头部「新建项目」同屏会双主按钮）；
  - `DeepLinkHost` / `VpmMaintenancePanel` 不再直接 `window.a.on(...)`，
    改走 `vpmApi.onDeepLink()` / `vpmApi.onBackupProgress()`。
- **新增边界测试** `tests/renderer/vpm-ui.spec.ts`（4 条）：
  组件不许出现 `window.a`、渲染层不许 import electron、
  项目页主屏（第一个 `<Modal` 之前）只能有一个 `variant="accent"`、危险操作必须有 Modal。
- **按钮纪律结论**：一屏一个实心；模态是独立一屏；行内最多三个按钮；危险操作 Modal + 一句后果，不弹两层。
- **证据**：typecheck 0；build 过；renderer 30 files / 225 tests 全绿；
  截图 `docs/screenshots/vpm-p8-projects.png`、`vpm-p8-delete-confirm.png`。
- **已知限制**：包图标只有首字母回退（不新增图标管线）；模板编辑 UI 仍缺（属新功能）；
  深链未真机点过。

---

## 13. 一句话

> 先读架构，再领一张卡；只改卡里的东西，做完写交接。
> 每张卡都能独立回退，整个 VPM 才能安心做完。
