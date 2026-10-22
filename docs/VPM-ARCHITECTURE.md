# VPM 目标架构与可维护性约束

> 这份文档是 VPM 子系统的**架构合同**，不是功能清单。
> 功能怎么做看阶段规格（`docs/prompts/VPM-PN.md`）和任务卡（`docs/prompts/tasks/`）；
> **模块放哪、谁能写什么、依赖往哪个方向走、什么算做完**，以本文为准。
>
> 起草：2026-10-21。适用：P1 起的所有任务；P0 已完成，保持现状。

---

## 1. 这份文档要解决什么

P0 已经证明"默认关闭 + 独立设置 + 可回退"能工作。后面的 P1–P9 会引入仓库、HTTP、
SQLite、版本解析、文件事务、Unity 工程写入、备份、VCC 互操作和 UI，代码量会明显变大。

如果只按功能堆文件，最后会出现四类问题：

1. 网络、数据库、文件写入散落在各处，出错时无法定位，也无法写失败注入测试；
2. 主进程、渲染进程、共享类型互相 import，改一处崩三处；
3. 业务规则（版本、范围、解析、事务顺序）和 IO 混在一起，只能靠真机碰运气；
4. 后来的人看不出"为什么这样写"，只能读完整份实现，越改越不敢改。

所以本文定义一套**足够严格、但不追求框架化**的架构：

- 纯业务逻辑集中在 `src/shared/vpm/`，不碰 Electron/数据库/网络；
- 主进程按"应用服务 → 端口/适配器"分层，组合根只有一个；
- 每类数据只有一个写入者，工程文件只有事务服务能改；
- 每个复杂模块有公开入口、README、失败模式和测试入口；
- 用静态架构测试把边界钉住，而不是靠口头约定。

目标是：**换一个人来，读一个模块的 README + 公开 API + 测试，就能安全地改它。**

---

## 2. "可维护"的验收标准

不是"代码看起来整齐"，而是下面这些能被检查：

| # | 标准 | 检查方式 |
|---|---|---|
| M1 | 业务规则可以脱离 Electron/SQLite/网络单测 | `shared/vpm` 纯函数测试；不 import `electron`/`node:fs` |
| M2 | 每个模块只有一个公开入口 | 跨模块 import 只指向模块 `index.ts`；架构测试扫描 |
| M3 | 依赖方向固定，没有环 | 架构测试 + PR 审查 |
| M4 | 每类数据只有一个写入者 | 数据所有权表（§5）+ 代码审查 |
| M5 | 每个失败点可注入、可回滚 | 事务失败注入用例；操作日志 |
| M6 | 新人能按文档跑起来 | 模块 README + 任务卡 + 根 README 的启动步骤 |
| M7 | 改动有测试能变红 | PR 必须回答"改回去哪条测试会红" |
| M8 | 没有跨层泄漏 | IPC DTO 不包含数据库行/文件句柄/密钥 |
| M9 | 任务可独立评审、可停 | 一个任务一个 PR；目标 ≤ 15 个文件 / ≤ 500 行非测试代码 |
| M10 | 文档与代码同步 | 任务卡完成时更新模块 README 和任务板 |

> M9 是硬约束：超过就拆任务，不要把"一个大 PR"伪装成"一个阶段"。

---

## 3. 分层与依赖方向

```text
┌────────────────────────────────────────────────────────────┐
│ renderer/vpm（React，只通过 window.a.vpm 拿数据）           │
└───────────────────────────┬────────────────────────────────┘
                            │ preload 白名单 + shared DTO
┌───────────────────────────▼────────────────────────────────┐
│ main/vpm/ipc（参数校验、错误映射、注册 handler）            │
└───────────────────────────┬────────────────────────────────┘
                            │ 调用应用服务
┌───────────────────────────▼────────────────────────────────┐
│ main/vpm 应用服务（repos / projects / resolver / install …）│
│  - 编排用例、事务、取消、状态机                              │
│  - 只依赖端口接口，不直接依赖 Electron 窗口                  │
└───────────────┬───────────────────────────┬────────────────┘
                │                           │
┌───────────────▼─────────────┐ ┌───────────▼────────────────┐
│ shared/vpm 纯领域            │ │ main/vpm 适配器             │
│ 版本/范围/manifest/解析/计划 │ │ db / http / fs / electron   │
│ 不碰 IO                      │ │ 实现端口，处理平台细节       │
└─────────────────────────────┘ └────────────────────────────┘
```

### 3.1 必须遵守的 import 规则

| 从 | 可以 import | 禁止 import |
|---|---|---|
| `src/shared/vpm/**` | 标准库的纯函数、同目录纯模块 | `electron`、`node:fs`、`better-sqlite3`、`main/**`、`renderer/**` |
| `src/main/vpm/domain/**`（若建） | `shared/vpm` | 适配器、IPC、Electron |
| `src/main/vpm/` 应用服务 | `shared/vpm`、端口接口、同模块内部 | `renderer/**`；其他模块的 internal 文件 |
| `src/main/vpm/` 适配器 | `shared/vpm`、端口接口、Node/Electron | 应用服务的具体实现（只实现端口） |
| `src/main/vpm/ipc/**` | 应用服务的公开入口、DTO、错误映射 | 直接读 DB、直接写文件、直接发 HTTP |
| `src/renderer/vpm/**` | `shared/vpm` 的 DTO/错误码、`renderer` 公共组件 | `src/main/**`、`node:*`、`electron` |
| 核心 `src/main/index.ts` | **只**静态 import `vpm/gate` | 其他 `vpm/**` 静态 import |

补充：

- `shared/vpm/dataRoot.ts` 是 P0 遗留的路径校验器，允许 `node:path`，但**不得**被渲染进程
  静态引用；渲染进程只用 `shared/vpm/types.ts` 和 `errors.ts`。
- `gate.ts` 动态 import `vpm/index.ts`（组合根）；只有启用且非安全模式才加载。
- 任何"为了省事"的跨层直接调用，都必须在任务卡里明确写出原因；没有原因就是违规。

### 3.2 组合根

`src/main/vpm/index.ts` 是 VPM 的唯一组合根：

- 打开/迁移 `vpm.db`；
- 构造 HTTP、缓存、仓库、工程、解析、事务、Unity、备份、VCC 服务；
- 注入依赖（构造函数参数），不把服务做成模块级单例；
- 注册 IPC；
- 失败时返回 `degraded` 原因，核心继续；
- `dispose()` 关闭 DB、取消任务、释放监听。

除此之外，**任何文件都不许自己 new 一个跨模块服务**。测试可以手动组装。

---

## 4. 模块地图

目录名可以随任务微调，但边界和职责不变。复杂模块必须自带 `README.md`。

```text
src/shared/vpm/
  types.ts              P0：VPM 设置/状态/DTO 的基础类型
  errors.ts             P0：错误码 + i18n key
  dataRoot.ts           P0：数据根纯校验（主进程用）
  domain/               新增：纯领域（不碰 IO）
    version.ts          VPM 版本解析/比较
    range.ts            范围解析/判断
    unityVersion.ts     Unity 版本解析/比较
    packageId.ts        包名校验/归一
    manifest.ts         vpm-manifest 读写（保留未知字段）
    repo.ts             仓库 JSON 解析/校验/归一
    project.ts          工程快照的纯派生逻辑
    template.ts         模板格式/继承/校验
    plan.ts             变更计划/差异/解释
    resolver.ts         确定性解析器
    unitypackage.ts     unitypackage 读取（纯解析，落盘在适配器）
  dto/                  IPC 请求/响应 DTO（不含数据库行）

src/main/vpm/
  gate.ts               唯一允许被核心静态 import 的门面
  index.ts              组合根（P1 起动态加载）
  config.ts             P0：独立设置读写
  ipc/                  VPM IPC 注册与参数校验
  db/                   vpm.db 连接、迁移、仓储
  repos/                仓库/包索引的持久化查询
  http/                 唯一网络入口 + 缓存适配
  catalog/              包目录查询/搜索/来源合并
  projects/             Unity 工程读取、台账、运行状态整合
  resolver/             解析服务（调用纯 resolver + 目录）
  install/              预检、事务、journal、崩溃恢复
  cache/                包缓存、下载落盘、校验
  vault/                回滚仓（被替换/移除文件的副本）
  unity/                Unity 编辑器发现、启动、建工程、版本
  backup/               工程备份、复制、迁移
  interop/              VCC 只读导入、深链、模板导入导出
  log/                  操作记录、脱敏、诊断导出

src/renderer/vpm/
  api.ts                唯一的 window.a.vpm 包装 + DTO 类型
  hooks/                查询/变更 hooks
  components/           展示组件（不直接调 IPC）
  pages/                集成到现有项目页/设置页的容器
  README.md             组件边界与状态约定
```

核心联动（**不属于 VPM**，VPM 只能通过 gate 注入的端口访问）：

```text
src/main/project/      当前导入目标、工程活动状态（core 持有唯一真相）
src/main/bridge/       素材导入的唯一执行者；写入 Assets 只经过 Unity 桥接
src/renderer/stores/ui.ts  双击素材 → 解析/准备目标 → 现有导入流程
```

- 当前工程/导入目标不是 VPM 台账的字段，也不在 `vpm.db` 里另存一份。
- VPM 的工程页可以**展示**目标，但只能调用 gate 注入的回调请求绑定，不能直接改核心状态。

### 4.1 模块公开面

- 文件夹模块必须有 `index.ts`，只导出公开类型和函数。
- 跨模块只能 import `../other/index`，不能 import `../other/internal/...`。
- 单文件模块（如 `http.ts`）的公开面就是该文件导出的接口；不要让调用方依赖内部辅助函数。
- 公开面一旦被其他模块使用，改动必须在 PR 里列出影响范围。

### 4.2 模块 README 模板

每个复杂模块（db、http、catalog、projects、resolver、install、cache、vault、unity、backup、interop）
至少包含：

```text
# <模块名>
## 职责（一句话）
## 不负责什么
## 公开 API（仅列 index.ts 导出的）
## 拥有的数据/路径
## 状态机/并发模型
## 失败模式与错误码
## 测试入口（文件与运行命令）
## 谁依赖我 / 我依赖谁
```

P1-A 先建空骨架和模板；后续任务在自己模块落地时补全。

---

## 5. 数据与写入所有权

| 数据/路径 | 唯一写入者 | 允许的读取者 | 规则 |
|---|---|---|---|
| 核心 `library.db` | 核心代码 | VPM 只读（如需要工程列表） | VPM **不得**迁移/改 schema/写表；`SCHEMA_VERSION=11` |
| `vpm.db` | `main/vpm/db` 仓储 | 应用服务（通过仓储） | 迁移只在启用时；迁移前备份；版本更高则拒绝 |
| `%APPDATA%\A\vpm\settings.json` | `config.ts` | gate/设置服务 | 原子写；坏文件改名保留；不塞核心设置 |
| `%APPDATA%\A\vpm\backups\` | `db`/`config` 的备份逻辑 | 诊断 | 不自动清理；不永久删 |
| 数据根 `cache/` | `cache` | 安装/目录 | 非 C；配额；原子落盘；失败可重下 |
| 数据根 `vault/` | `vault` | 事务/撤销 | 只增不永久删；按操作归档 |
| 数据根 `backups/` | `backup` | 备份 UI/恢复 | 不自动删；可打开位置 |
| 数据根 `tmp/` | 各服务 | 各服务 | 仅临时；启动/结束时清理自己的残留 |
| 工程 `Packages/` | `install` 事务 | 工程读取 | 只有事务服务能改；Unity 运行时拒绝 |
| 工程 `Packages/vpm-manifest.json` | `install` 事务 | 工程读取 | **最后写**；保留未知字段；写前校验工程未变 |
| 工程 `Packages/com.avca.bridge/` | **核心桥接安装器**（唯一例外） | VPM 只读/忽略 | VPM 不装/不升/不降/不卸/不覆盖；解析器和清理都跳过 |
| 工程 `Assets/` 素材 | 现有桥接导入协调器 + Unity | VPM 只读 legacy 报告/GUID 匹配 | VPM 不直接写 Assets；清理只按包声明的白名单 |
| 工程 `ProjectSettings/ProjectVersion.txt` | `unity/version` | 工程读取 | 改前必须备份 + 关闭 Unity；可回滚 |
| 工程其他文件 | `backup`/`unity/create` 的明确用例 | 工程读取 | 不手写 `.meta`；不覆盖非空目录 |
| 当前导入目标 | 核心 `project` 目标服务 | VPM 通过 gate 端口读取/请求绑定 | 单一真相；启动绑定、显式选择优先、关闭/移除清除 |
| 工程活动状态（导入/维护） | 核心工程活动闸门 | VPM 通过 gate 端口申请/查询 | 互斥；包事务只在 Unity 关闭时；导入中拒绝维护写 |
| VCC `settings.json` / `vcc.liteDb` | **无人**（只读） | `interop/vcc` | 绝不写回 VCC；LiteDB 只读且可选 |
| 深链注册 | `interop/deeplink` | 主进程 | 只注册 `atrium://`；`vcc://` 需显式确认 |

### 5.1 写入纪律

1. **写前备份**：项目文件、设置、数据库迁移都必须能回到上一步。
2. **先临时后原子**：同卷临时文件/目录 → 校验 → rename；不要直接覆盖目标。
3. **manifest 最后写**：包目录就位且校验通过后再写 manifest；manifest 写入失败要回滚包目录。
4. **不永久删用户文件**：旧包/旧资源进 vault；缓存/临时文件例外，但要有边界和清理策略。
5. **一个工程同一时间只允许一个变更**：素材导入、包事务、备份/复制/迁移/换版本共用工程活动闸门；
   进程内互斥 + `vpm.db` 操作记录；跨进程靠工程锁/文件指纹。
6. **外部变更检测**：事务开始和提交前比较 manifest 指纹；用户/Unity/ALCOM 改过就中止，不硬覆盖。
7. **打开即绑定**：Atrium 启动工程时先绑定导入目标，再 spawn Unity；不到"桥接就绪"才选目标。
   绑定失败/启动失败必须清除，不把素材投给别的工程。
8. **桥接与素材优先保护**：`Packages/com.avca.bridge` 永远不在 VPM 变更/清理集合里；
   `Assets/` 清理只按包清单的 GUID/路径白名单，未知/导入资产保留并报告。
9. **当前目标不跨重启猜**：目标状态是应用内存态；重启后按现有规则重新解析
   （单工程自动、多工程显式选择），避免持久化出一个已经关闭/移动的工程。

---

## 6. 关键端口与契约

端口是**应用服务依赖的接口**，不是给 UI 用的。适配器实现端口；测试用 fake。
具体签名随任务卡落地，下面只规定形状和边界。

### 6.1 HTTP

```ts
export interface VpmHttpPort {
  getJson(url: string, opts: VpmJsonRequest): Promise<VpmJsonResponse> // 200/304，ETag/Last-Modified
  downloadToFile(url: string, dest: string, opts: VpmDownloadRequest): Promise<VpmDownloadResult>
}
```

- 只有 `main/vpm/http/` 能发网络；其他模块只能注入这个端口。
- 只允许 HTTPS；重定向逐跳校验；自定义头跨源重定向必须停止。
- JSON 响应有大小上限；下载流式写盘并计算 SHA-256；不把整包读进内存。
- 生产用 Electron `net.request`（系统代理）；测试用本地 fake server。
- 网络开关关闭时，端口实现直接返回 `vpmNetworkNotConsented`，不建立连接；默认开启。

### 6.2 仓储

```ts
export interface RepoStore {
  listRepos(): RepoRow[]
  upsertRepo(input: RepoInput): RepoRow
  replaceRepoPackages(repoId: string, packages: PackageVersionRow[]): void
  queryCatalog(query: CatalogQuery): CatalogPage
}
```

- 只有 `db/` 和 `repos/` 能执行 SQL。
- 应用服务拿到的不是 `better-sqlite3` 的 statement，而是仓储方法。
- 刷新仓库用单事务替换该仓库的包行；失败保留旧数据。

### 6.3 解析器

```ts
export interface ResolverInput {
  roots: RootRequest[]
  installed: InstalledSnapshot
  catalog: CatalogSnapshot
  options: ResolveOptions
}
export interface ResolveResult {
  plan: ChangePlan
  conflicts: Conflict[]
  warnings: ResolveWarning[]
}
```

- `resolver` 是纯函数：无 DB、无 HTTP、无时钟、无随机。
- 候选顺序、同版本多源、预发布、Unity 兼容、yanked、locked 都必须由输入显式决定。
- 冲突要能解释"谁要求的、要求什么、可选什么"，不能只返回"解析失败"。

### 6.4 事务

```ts
export interface InstallOperation {
  id: string
  projectPath: string
  planHash: string
  state: 'planned' | 'preflight' | 'applying' | 'committed' | 'failed' | 'rolled_back' | 'needs_attention'
  steps: OperationStep[]
}
```

- 每个步骤执行前写 journal；步骤必须可重复检查（幂等）。
- 失败的默认策略是**尽量自动回滚**；无法安全回滚时进入 `needs_attention`，绝不假装成功。
- 崩溃恢复在 VPM 初始化时扫描未完成操作；只处理能证明安全的操作。
- 事务服务是唯一能改 `Packages/` 和 manifest 的模块。
- 例外：`Packages/com.avca.bridge` 由核心桥接安装器写入；它必须出现在事务/清理的受保护集合里。
- P4-A 落实：`vpm_operation`/`vpm_operation_step`/`vpm_operation_file` + 工程内
  `.atrium-tx/<op>/journal.json`。同一工程 `planned/preflight/applying` 最多一条；
  `needs_attention` 未恢复前拒绝新操作。提交点是 journal 的 `manifest_written`：
  未写 manifest 不能 `committed`，写了之后不能 `failed/rolled_back`。

### 6.4.1 工程联动端口（core 提供，gate 注入）

VPM 不 import 核心 `project`/`bridge`/`import` 模块。`main/index.ts` 把下面这个窄端口注入
`VpmGateDeps`，VPM 的启动/工程页/维护服务只能通过它：

```ts
export interface ProjectLinkagePort {
  /** 当前目标；可能尚未启动完成（phase=launching/connecting/closed） */
  currentTarget(): { projectId: string; path: string; phase: string } | null
  /** Atrium 启动工程前调用；立即生效，不要求 Unity 已就绪 */
  bindLaunchTarget(projectId: string): void
  /** 启动失败/用户取消/工程关闭后清理；只清自己绑的那一个 */
  clearLaunchTarget(projectId: string): void
  /** 只读活动状态；UI 和目标选择用 */
  activity(projectId: string): {
    unityRunning: boolean
    importing: boolean
    maintenance: 'install' | 'backup' | 'copy' | 'migrate' | 'version' | null
  }
  /** 维护动作的独占租约；拿不到返回可解释错误，不排队到用户不知道 */
  acquireMaintenance(
    projectId: string,
    kind: 'install' | 'backup' | 'copy' | 'migrate' | 'version'
  ): { release(): void }
}
```

P2-E 先落地目标三方法（`currentTarget/bindLaunchTarget/clearLaunchTarget`）；
`activity/acquireMaintenance` 由 P4-F 追加，属于同一个端口。

规则：

- `bindLaunchTarget` 是**应用状态**，不是工程文件写入；不需要 Unity 已运行。
- 目标优先级固定为：**用户显式选择 > Atrium 启动绑定 > 仅一个运行工程时自动**。
- 用户显式选另一个目标时，清除旧的启动绑定；工程移除、启动失败、启动后关闭，都要清除。
- `acquireMaintenance` 与素材导入互斥；包事务还要求 `unityRunning=false`。
- 端口失败只返回错误码/状态，不向渲染层抛异常或数据库行。

### 6.5 IPC / DTO

- 请求/响应类型放 `shared/vpm/dto/`；不直接复用数据库行。
- 主进程对每个参数重新校验，不信任渲染进程。
- 错误只返回 `code + params`（或 `i18n:vpm.errors.<code>` 的既有形式），不返回绝对路径以外的敏感信息、请求头、token、SQL。
- 长任务返回 `operationId`，进度用节流事件；同时保留拉取式状态，断线可恢复。
- 渲染进程只在 `renderer/vpm/api.ts` 里调用 `window.a.vpm`。

### 6.6 一条用例怎么穿过各层

以"用户在工程页把某个包升级到最新"为例：

```text
renderer 组件
  → renderer/vpm/hooks（选中/loading）
  → renderer/vpm/api.ts
  → IPC vpm:plan-resolve（只读）
  → main/vpm/ipc/plan.ts（参数校验/错误映射）
  → resolver 应用服务（取工程快照 + 目录）
  → shared/vpm/domain/resolver.ts（纯计算）
  → 返回 ChangePlan

用户确认
  → IPC vpm:install-apply（operationId）
  → install 应用服务（工程锁/预检）
  → transaction（journal、vault、cache、fs）
      ├─ cache/http（下载/校验）
      ├─ vault（旧文件）
      └─ fs（Packages，manifest 最后）
  → 状态事件/拉取式 status
  → renderer 重新拉工程详情
```

边界检查：

- 渲染层不读 DB、不拼解析规则、不看文件系统；
- resolver 不下载、不写盘、不知道 Electron；
- transaction 不直接构造 HTTP 请求，也不把数据库行传给 UI；
- IPC 不做业务判断，只做校验/映射；
- 出错时错误码沿原路返回，原始异常只进日志。

---

## 7. 状态机与并发

### 7.1 安装操作

```text
planned → preflight → applying → committed
                │           │
                │           ├─ 可回滚失败 → rolled_back
                │           └─ 不可判定   → needs_attention
                └─ 预检失败 → failed（无写入）
```

规则：

- `preflight` 只读：Unity 是否运行、工程指纹、磁盘空间、hash/缓存、受保护包、冲突。
- `applying` 每一步都写 journal；提交前再验一次工程指纹。
- `manifest` 最后写；写成功后才是 `committed`。
- `needs_attention` 必须能在 UI 看到，并提供"打开操作记录/恢复"的入口。
- 同一工程同一时间只允许一个 `applying` 操作；服务层互斥 + DB 记录双保险。

### 7.2 仓库刷新

```text
idle → fetching → ready
         │  ├─ 304 → ready（保留旧包）
         │  └─ 失败 → error（保留旧包 + 错误码）
```

- 每仓库独立状态；一个仓库失败不影响其他。
- 并发上限 2；可取消；关闭 VPM/退出时取消。
- 不自动高频刷新；打开目录且缓存过期时最多触发一次。

### 7.3 工程锁与素材导入

- 写操作（装/卸/迁移/换版本/建工程）需要工程锁。
- 锁的粒度是工程路径；记录在 `vpm.db`，并检查核心工程活动闸门的进程内互斥。
- 素材写入（导入/撤销/删除 GUID/成员导入）**不是** VPM 写操作：它由现有桥接在 Unity 内执行，
  拿的是“写入活动”而不是 VPM 工程锁；但两者的活动状态互相可见。
- 只读操作（浏览/解析/备份读取）不拿写锁；备份仍要检查导入活动，避免复制半成品。
- 包事务：`unityRunning=false` 且 `importing=false` 且拿到维护租约才能开始。
- 备份/复制/迁移/换版本：拿维护租约；`importing=true` 时拒绝；换版本/迁移还要求 Unity 关闭。
- 素材写入：目标必须等于当前绑定工程；导入计划固定 `projectId`，中途切换目标不转投。
- 拿不到锁时返回可解释错误，不排队到用户不知道。

---

## 8. 错误、日志与诊断

### 8.1 错误

- 统一 `VpmError`：`code`、`params`、`recoverable`、`cause`（cause 只进日志）。
- 错误码按域前缀：`vpmHttp*`、`vpmRepo*`、`vpmProject*`、`vpmResolve*`、`vpmTx*`、
  `vpmUnity*`、`vpmBackup*`、`vpmVcc*`、`vpmInternal`。
- 用户可见文案只走 i18n；主进程不拼中文/英文句子。
- 未知异常在 IPC 边界转成 `vpmInternal`，原始堆栈只写日志。

### 8.2 日志

- 结构化字段：`operationId`、`project`（路径可脱敏）、`repoId`、`step`、`code`。
- 不记录：token、请求头、cookie、完整 manifest、用户文件内容。
- 操作日志与调试日志分开：操作日志给用户看/导出；调试日志给维护者。
- 诊断导出包含：版本、平台、VPM 状态、最近操作、错误码、用量；不含密钥。

### 8.3 可观测的"为什么"

每个失败至少能回答：

1. 哪个操作、哪个工程、哪一步；
2. 哪个错误码；
3. 已经写了什么、回滚了什么；
4. 用户下一步能做什么（重试/关闭 Unity/换目录/看诊断）。

---

## 9. 迁移与兼容

- `vpm.db` 迁移**只前进**；每个版本一个函数，事务内执行，失败回滚。
- 迁移前备份到 `%APPDATA%\A\vpm\backups\vpm.db.bak-v<from>-<ts>`，并做完整性检查。
- `user_version > 当前`：拒绝启用 VPM，状态 `degraded` + 错误码；核心继续。
- 设置文件坏：改名 `.corrupt-*`，默认值 + `configRecovered`；不删原文件。
- 持久化 JSON（模板、仓库导入）都要有 `schemaVersion`；未知字段尽量保留。
- 不允许为了新功能改核心 `library.db` schema；需要核心数据时只读或新增 VPM 侧索引。

---

## 10. 测试与架构闸门

### 10.1 分层测试

| 层 | 位置 | 规则 |
|---|---|---|
| 纯领域 | `tests/vpm/domain/` | 无 Electron/DB/网络/临时目录；golden vectors |
| 应用服务 | `tests/vpm/services/` | 临时目录 + fake 端口；可注入时钟/ID |
| 事务 | `tests/vpm/transactions/` | 每一步失败注入；崩溃恢复；回滚证据 |
| IPC/渲染 | `tests/vpm/ipc/`、`tests/renderer/` | 通道覆盖、DTO、错误码、i18n、wiring |
| 架构 | `tests/vpm/architecture.spec.ts` | import 方向、唯一写入者、唯一网络入口 |
| 真机 | `tests/vpm/e2e/` 或 tools | 沙盒 + 真 Unity 2022.3.22f1 |

### 10.2 架构测试要钉住的规则

1. 只有 `src/main/index.ts` 静态 import `vpm/gate`；
2. `shared/vpm/domain` 不 import `electron`、`node:fs`、`better-sqlite3`、`main/**`、`renderer/**`；
3. `main/vpm` 不 import `renderer/**`；
4. 网络调用只在 `main/vpm/http/`（测试除外）；
5. SQL 只在 `main/vpm/db/`、`main/vpm/repos/`、`main/vpm/install/state.ts`
   （P4-A 例外：操作状态机必须和 journal 双写在同一个事务里）；
6. 渲染进程静态 import `renderer/vpm/**` 只允许 `Settings.tsx` / `Project.tsx` 的 `lazy(() => import(...))`；
7. `renderer/vpm` 的 `window.a` 只在 `api.ts`；
8. 事务/备份/版本服务之外不得写工程文件（用路径/函数白名单检查，允许误报白名单但要有注释）；
9. VPM 不得直接 import 核心 `project`/`bridge`/`import` 模块；只能通过 gate 注入的联动端口；
10. `com.avca.bridge` 不得出现在解析计划、变更集合、旧 Assets 清理白名单或备份排除的“可删”一侧。

规则可以随任务增加，但不能减少；减少必须在架构文档的决策记录里写原因。

### 10.3 失败注入

- 事务每一步都要有"在这里抛错"的用例；断言：无半成品、manifest 未被错误改写、可回滚。
- 崩溃恢复用"杀在步骤之间"的模拟（journal 状态 + 临时目录），不是只看函数返回。
- 网络失败用本地 fake：超时、断连、304、302 降级、超大响应、hash 不匹配。
- 文件失败用只读目录、占用文件、磁盘配额、超长路径、符号链接/junction。

### 10.4 真 Unity

- 只在任务卡明确要求的任务里跑；默认 Unity 2022.3.22f1。
- 沙盒 `AVCA_APP_HOME` 必须含 `avca`/`sandbox` 且 `AVCA_REQUIRE_SANDBOX_HOME=1`。
- 不碰真实库/工程；不 `taskkill /F /IM Unity.exe`。
- 真 Unity 结果写进 PR；没跑就写"未验证"，不能写"应该可以"。

---

## 11. UI 架构

- 不新增顶级导航。VPM 的入口继续挂在：
  - 设置 → 项目与包（配置/仓库/模板/维护）；
  - 现有"项目"页（工程列表/详情/包管理）。
- 组件分三层：
  - `api.ts`：唯一 IPC 包装；
  - `hooks/`：查询、变更、loading/error、取消；
  - `components/`：纯展示，不直接 `window.a`。
- 列表虚拟化/分页在数据量大时再加；P1 包目录先按需分页，不一次渲染上万行。
- 项目页/工程详情始终显示“当前导入目标”；打开 Unity 后立即显示该工程，
  即使还在启动/连接也可见。多 Unity 实例时显示为什么选它，并给显式切换入口。
- 按钮纪律：一屏一个主操作；批量操作选中后才出现；危险操作二次确认；失败有可执行的下一步。
- 文案三语；错误码到文案的映射集中在 i18n；主进程不返回 UI 句子。
- 可访问性：键盘可达、焦点可见、Esc/Enter 正常、不能只靠颜色表达状态。

---

## 12. 文档与交接

### 12.1 每个任务必须更新

- 自己模块的 `README.md`（职责/API/数据/失败模式/测试）；
- `docs/VPM-TASKS.md` 的状态；
- 如果有架构决策变化，更新本文 §14 的决策记录。

### 12.2 PR 交接段（固定格式）

```text
Task: P4-C
状态: 完成 / 部分 / 阻塞
公开 API/契约变化: ...
新增/修改模块 README: ...
已验证: 测试名/命令/真机步骤
未验证: ...
给下一个任务: 坑、临时决定、需要先做的事
```

### 12.3 架构决策记录（ADR）

| # | 决策 | 理由 | 日期 |
|---|---|---|---|
| ADR-01 | VPM 使用独立 `vpm.db` | 不动核心 schema，回退干净 | 2026-10-21 |
| ADR-02 | 解析器确定性贪心、不回溯 | 可预测、可测试；冲突明确解释 | 2026-10-21 |
| ADR-03 | manifest 最后写、旧文件进 vault | 失败可回滚，不永久删用户文件 | 2026-10-21 |
| ADR-04 | 缓存/回滚仓/备份强制非 C | 产品硬约束；避免撑爆系统盘 | 2026-10-21 |
| ADR-05 | VCC 只读，不写 settings/LiteDB | 避免破坏官方客户端 | 2026-10-21 |
| ADR-06 | 网络唯一入口 + 默认联网、可关闭 | 开箱即用；关闭后仍可离线 | 2026-10-21 |
| ADR-07 | 一个任务一个 PR，≤15 文件/≤500 行 | 控制评审和上下文；便于回退 | 2026-10-21 |
| ADR-08 | 复杂模块必须有 README + 公开入口 | 后来的人能独立改模块 | 2026-10-21 |
| ADR-09 | 不新增顶级导航，挂现有项目/设置页 | 轻量化；不把 VPM 做成第二个产品 | 2026-10-21 |
| ADR-10 | 事务默认自动回滚，无法判定进 `needs_attention` | 不假装成功；给用户/维护者可操作状态 | 2026-10-21 |
| ADR-11 | 打开工程即绑定导入目标；目标只有核心一份状态 | 包管理与素材导入共用同一工程；VPM 不另存当前工程 | 2026-10-22 |
| ADR-12 | 素材导入/包事务/维护动作共用工程活动闸门；桥接包受保护 | 防止错工程导入、半写、误清理用户资产 | 2026-10-22 |

新增决策时追加，不覆盖历史。

---

## 13. 任务执行与上下文预算

1. 一次只做一个任务卡；不要一次读完整阶段规格，只读任务卡列出的章节。
2. 任务卡 + 共同规则 + 指定章节，目标 ≤ 25k tokens；超过就拆任务。
3. 一个任务一个分支/PR；目标 ≤ 15 个文件、≤ 500 行非测试代码。
4. 发现需要跨 3 个以上模块或改核心 schema：停下，先改任务卡/架构，再实现。
5. 每个任务结束写交接段；下一个任务先读交接段，不重读整个实现。
6. 任务卡与代码冲突：以代码/架构文档为准，先改卡再写码；不要默默绕过。

### 13.1 新增一个能力时怎么落

1. 先在 `VPM-PARITY.md` 找到/新增一行，写清目标（完整/部分/不做）和验收证据；
2. 在阶段规格里补行为、错误、边界、实现解剖（若阶段规格还没有）；
3. 判断它属于哪个模块、是否新增写入者/端口；更新本文的模块地图/数据所有权；
4. 拆成一张任务卡：目标、非目标、文件所有权、契约、测试、门禁；
5. 任务卡与总表 ID 对齐，跑 `node tools/check-vpm-taskpack.cjs`；
6. 实现时不要顺手改别的模块；完成后更新模块 README、任务板、交接段；
7. P8-D 对账时用任务卡/测试/真机证据反查。

---

## 14. 评审清单（每个 PR 复制）

```text
[ ] 只改任务卡允许的文件；没有顺手重构/新功能
[ ] 依赖方向符合 §3；跨模块只走 index.ts
[ ] 数据写入符合 §5；没有第二个写入者
[ ] 没有绕过联动端口/工程活动闸门；桥接包与导入资产受保护
[ ] 打开工程 → 目标绑定 → 双击导入这条链有测试（涉及启动/导入时）
[ ] 新增/修改模块 README，公开 API 已列
[ ] 纯逻辑与 IO 分离；失败可注入
[ ] 错误码 + 三语文案；主进程无 UI 句子
[ ] 测试能证明"改回去会红"；未验证项已写明
[ ] 没有复制 ALCOM 代码/文案/测试/资产（净室清单）
[ ] 任务板状态 + 交接段已更新
```

---

## 15. 不做什么（防止过度设计）

- 不引入 DI 框架、事件总线、CQRS、微服务、GraphQL；用构造函数和显式调用。
- 不为"未来跨平台"抽象 FS/路径；Windows 优先，平台差异集中在适配器。
- 不把所有东西都做成接口；只有跨模块/需要 fake 的边界才建端口。
- 不为了"架构好看"拆出大量一层转发文件；模块公开面要能一句话说清。
- 不追求 100% 覆盖率；追求关键失败路径和业务规则有证据。
