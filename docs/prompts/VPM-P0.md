# VPM-P0 执行提示词：基线、开关与回退闸

> **状态：已完成（0.9.0）。** 保留作行为与验收参考，不再重复执行。
> 后续请从 [`tasks/P1-A.md`](tasks/P1-A.md) 开始；任务板：[`../VPM-TASKS.md`](../VPM-TASKS.md) · 架构：[`../VPM-ARCHITECTURE.md`](../VPM-ARCHITECTURE.md)。

> 以下是 P0 的历史执行说明/验收记录，**已不再重复执行**；保留作行为与回退参考。
> P1 起请用 `tasks/` 下的任务卡。
> 必读：`AGENTS.md`、`docs/VPM-MERGE-PLAN.md`、`docs/VPM-CLEANROOM.md`、
> `docs/VPM-PARITY.md`、`docs/VPM-ROLLBACK.md`、
> `docs/VPM-IMPLEMENTATION-GUIDE.md` §0、§11。

---

## 1. 你的任务

给 Atrium 增加一个**默认关闭、可整体回退**的 VPM 子系统外壳：

- 独立的 VPM 设置目录与文件；
- 独立的数据根（非 C）校验；
- 懒加载门面与安全模式；
- 启用前的核心数据库快照；
- 设置页里一个最小的"项目与包管理（实验）"入口；
- 回退文档与 `pre-vpm` 基线标签。

**本阶段不实现**：仓库、网络、包目录、解析器、装包、工程创建、模板、备份。
这些都留给后续阶段。

---

## 2. 开始前的硬前置

1. 当前仓库有一份**未提交的 0.8.0 手势改动**（分支 `codex/interaction-gestures`）。
   **不要 reset、不要 stash 覆盖、不要 rebase 掉它。**
2. P0 必须基于**包含 0.8.0 改动的 `main`**。如果 0.8.0 还没合并：
   - 停下来，在报告里说明"P0 前置未满足：0.8.0 未合并"；
   - 不要从旧的 `f105f3a` 直接开 P0，否则会把 0.8.0 的界面/测试改动丢掉。
3. 从最新 `main` 开分支：

   ```bash
   git fetch origin
   git switch -c codex/vpm-p0-foundation origin/main
   ```

4. 记录基线：
   - `git rev-parse HEAD`
   - `node -e "console.log(require('./package.json').version)"`
   - 全量测试/类型检查/构建的真实结果（见第 9 节）。
5. 在基线提交打 annotated tag `pre-vpm`：

   ```bash
   git tag -a pre-vpm -m "Atrium baseline before VPM merge"
   ```

   记录 tag 指向的 SHA。是否推送标签由你按仓库权限处理；至少本地要有。

---

## 3. 必须遵守的产品规则

- 核心 `library.db` 的 **schema 不动**：`SCHEMA_VERSION` 仍是 11，不加迁移。
- 不引入网络请求；本阶段 `src/main/vpm/` 里不能有 `fetch`/`net.request`/`https.request`。
- 不新建 `vpm.db`；本阶段只读写 `vpm-settings.json`。
- 缓存/VPM 数据根不能是 C 盘；没有合法数据根就不允许启用。
- 主进程不返回中文文案；错误只给 code + 参数。
- 不永久删除用户文件；本阶段也不删除任何用户文件。
- 不改 `src/main/db/schema.ts`。
- 不碰 `E:\vrc\A`、`E:\Atriumdate`、`%APPDATA%\A\library.db` 的真实数据。
- 不做 Release、不发布 0.9.0；只做开发线构建。

---

## 3.5 本阶段实现解剖（ALCOM → Atrium）

**ALCOM 的关键机制（行为观察）**

- 它是一个常驻的 Environment：启动时加载 VCC 设置/仓库缓存/项目列表，命令层直接访问；
  没有"整套功能默认关闭"的开关。
- 长任务通过 Tauri command + progress channel 推进；前端不直接碰文件系统。
- 更新/日志/设置都在同一个应用生命周期里。

**Atrium 的独立实现**

- 核心只认识一个**静态 gate**；重模块（DB/HTTP/仓库/事务）只在启用时**动态 import**。
- VPM 设置/DB/数据根独立；安全模式/停用/彻底移除是启动级/运行级两道闸。
- 启动顺序：读配置（坏文件备份+默认）→ 判断安全模式 → 校验数据根 →
  启用时快照核心库 → 动态加载重模块 → 失败降级、核心继续。
- 设置页只加一个默认关闭的入口；Project 页本阶段完全不动。

**施工顺序**

1. 独立 settings + 原子读写 + 损坏恢复。
2. 数据根纯校验 + main 侧写测试。
3. gate 状态/启用/停用 + 快照。
4. 核心生命周期/安全模式/降级。
5. IPC + 最小设置页。
6. 静态导入护栏 + 测试/截图。

**最容易做错**

- gate 里 import 了 HTTP/DB/事务 → "停用"也把重模块带起来；用静态导入测试钉住。
- 快照放在核心备份轮转目录 → 被清理；放 `vpm/backups`。
- 配置坏了直接崩/覆盖 → 备份 `.corrupt-*`、默认值继续。
- 把 VPM 字段塞进核心 `AppSettings` → 回退不干净。

**详细内容**：`docs/VPM-IMPLEMENTATION-GUIDE.md` §0、§11。

---

## 4. 实现清单

### 4.1 版本线

- `package.json` 版本改为 **0.9.0**（开发线），同步 `package-lock.json`。
- 不建 Release、不改发布说明。
- 关于页/安装包版本自然变成 0.9.0。

### 4.2 VPM 设置（独立）

新建：

```text
src/main/vpm/config.ts
src/main/vpm/gate.ts
src/main/vpm/types.ts
```

- 目录：`P.root()/vpm/`，文件 `settings.json`。
- 类型/默认值：

  ```ts
  interface VpmSettingsFile {
    schemaVersion: 1
    enabled: boolean
    networkEnabled: boolean
    networkConsentAt: string | null
    dataRoot: string | null
    cacheQuotaGb: number
    vaultQuotaGb: number
    allowPrerelease: boolean
    hiddenPackageIds: string[]
    defaultUnityArgs: string
    checkUpdates: boolean
    rollbackSnapshot: { path: string; sha256: string; createdAt: string } | null
  }
  ```

- 默认：`enabled=false`、`networkEnabled=true`、`networkConsentAt=null`、`dataRoot=null`、
  `cacheQuotaGb=20`、`vaultQuotaGb=20`、`allowPrerelease=false`、
  `hiddenPackageIds=[]`、`defaultUnityArgs=''`、`checkUpdates=false`。
- 读取：
  - 文件不存在 → 默认值；
  - JSON 坏/字段非法 → 把原文件改名 `settings.json.corrupt-<时间戳>`（**不删**），
    用默认值继续，并在 status 里给 `configRecovered=true`；
  - 任何字段都做类型/范围校验，不信任磁盘。
- 写入：临时文件 + `fs.rename` 原子替换；失败不留半文件。
- 本阶段不要在 `AppSettings` 里加任何 VPM 字段。

### 4.3 数据根校验

新建纯逻辑（建议 `src/shared/vpm/dataRoot.ts`）：

```ts
validateVpmDataRoot(input, context): { ok: true; normalized: string } | { ok: false; code: VpmErrorCode }
```

`context` 传入：平台、系统盘（`process.env.SystemDrive`）、素材库根、应用安装目录、
已知工程路径、是否存在/可写（由 main 侧补充）。

必须拒绝：

- 空、相对路径、只有盘符根（`E:\`）；
- 系统盘（默认 C:，按 `SystemDrive` 判断，不写死字母）；
- 位于素材库根内；
- 位于任何一个已知 Unity 工程内；
- 位于应用安装目录内；
- 含 `..` 逃逸/非法字符/超长路径；
- 不可创建/不可写（main 侧实测：写一个 `.atrium-write-test` 再删）。

允许但给 warning：

- UNC / 可移动盘 / 非 NTFS（提示速度与可用性）。

`src/shared/vpm/errors.ts` 定义错误码，例如：

```text
vpmDisabled
vpmSafeMode
vpmDataRootRequired
vpmDataRootInvalid
vpmDataRootOnSystemDrive
vpmDataRootInsideLibrary
vpmDataRootInsideProject
vpmDataRootNotWritable
vpmSnapshotFailed
vpmConfigRecovered
vpmInternal
```

每个 code 对应 i18n key（`vpm.errors.*`），主进程只回 code + 参数。

### 4.4 门面与安全模式

新建 `src/main/vpm/gate.ts`（这是**唯一允许被核心静态 import 的 VPM 文件**）：

- `getVpmStatus()`：读设置，返回：

  ```ts
  {
    enabled: boolean
    safeMode: boolean
    degraded: boolean
    dataRoot: string | null
    dataRootValid: boolean
    networkConsentAt: string | null
    configRecovered: boolean
    appVersion: string
  }
  ```

- `isSafeMode()`：
  - `process.argv.includes('--safe-mode')` 或
  - `process.env.ATRIUM_SAFE_MODE === '1'`。
- `enableVpm({ dataRoot })`：
  1. 安全模式 → 拒绝；
  2. 校验数据根（含写测试）；
  3. 创建 `<dataRoot>/{cache,vault,backups,tmp}`（只创建空目录）；
  4. 用现有 `createDatabaseBackup` 给 `library.db` 做快照：
     - 路径：`P.root()/vpm/backups/pre-vpm-<YYYYMMDD-HHmmss>.db`
     （放在 VPM 自己的目录，避免被核心的备份轮转清掉）；
     - 用只读 SQLite 打开并 `PRAGMA integrity_check`；
     - 计算 SHA-256；
  5. 快照失败 → 不启用，返回 `vpmSnapshotFailed`；
  6. 写设置 `enabled=true`、`dataRoot`、`rollbackSnapshot`；
  7. 返回 status。
- `disableVpm()`：
  - 置 `enabled=false`；
  - 不删设置、不删数据根、不删 DB（本阶段没有 DB）；
  - 返回 status。
- `degraded` 本阶段默认为 false；为后续预留字段。
- gate 通过参数拿核心能力，避免反向依赖/循环 import：
  `registerVpmGateIpc({ getDb, getLibraryRoot, getKnownProjectPaths })`；
  快照用 `getDb()`，路径校验用后两个。不要从 gate 里 import 核心的启动入口。

门面**不能**在本阶段 import 任何 HTTP/DB/包/工程模块。

### 4.5 核心生命周期

改 `src/main/index.ts`（或现有启动入口）：

- app ready 后：
  - 判断安全模式；
  - 用 `gate.getVpmStatus()` 读状态（坏配置已由 config 处理）；
  - 若 `enabled && !safeMode`：本阶段不做重活，只把 status 标为已启用；
  - 任何异常：记日志、`degraded=true`、核心继续，不弹崩溃。
- 退出时调用 `gate.dispose()`（本阶段空实现）。
- 不得因为 VPM 设置坏而阻止窗口创建。

### 4.6 IPC

在 `src/shared/ipc.ts` 增加：

```ts
Vpm: {
  Status: 'vpm:status',
  Enable: 'vpm:enable',
  Disable: 'vpm:disable',
  PickDataRoot: 'vpm:pick-data-root'
}
```

- `Enable` 入参 `{ dataRoot: string }`，主进程重新校验，不信任渲染层。
- `PickDataRoot` 用 Electron dialog 选目录；默认路径：
  - 若设置里已有合法数据根，用它；
  - 否则选一个非系统盘的用户目录（不要自动创建/自动启用）。
- 预加载白名单自动从 `IpcInvoke` 生成；确认没有任意 invoke。
- handler 在 `enabled=false` 时只允许 `Status`/`Enable`/`PickDataRoot`；
  `Disable` 幂等。

### 4.7 设置页最小入口

在 `Settings` 增加一个**"项目与包"页签**（或"高级"里的实验卡片，二选一；
推荐页签，后续阶段直接往里加内容）：

- 关闭时：
  - 一段说明：VPM 项目/包管理，默认关闭；会改动 Unity 工程的 `Packages/` 与
    `vpm-manifest.json`；需要非 C 数据根；可随时停用。
  - 一个主按钮"启用项目与包管理"。
- 启用流程（模态，最多两步）：
  1. 选数据根（目录选择器）；显示校验结果；
  2. 勾选"我了解它会改动 Unity 工程，且只在我确认后执行"，点"启用"。
- 已启用时：
  - 显示数据根、快照路径、状态；
  - "停用"（不删数据）；
  - 占位"仓库/模板/Unity 安装将在后续版本出现"。
- 不新增顶级导航；不改 Project 页。
- 所有文案进 zh-CN/en/ja；按钮纪律：一个主按钮。
- 组件可以现在就放在 `src/renderer/pages/Settings.tsx`，但 VPM 逻辑尽量抽到
  `src/renderer/vpm/`，为后续懒加载做准备。

### 4.8 静态导入护栏

加测试（剥掉注释再扫描）：

- 除 `src/main/vpm/gate.ts` 外，`src/main` 不得静态 import `vpm/` 下的模块；
- `src/renderer` 不得静态 import `renderer/vpm/`（P0 若还没懒加载，先允许 Settings 直接引用；
  在测试里写清楚例外，P1 再改成 lazy）；
- `src/main/vpm/gate.ts` 不得 import `http`/`net`/`https`/`vpm/db`/`vpm/cache`。
- 测试要能变红：把 gate 的 import 改成 `vpm/http`，测试应失败。

### 4.9 文档

- 在 `docs/DEVELOPMENT.md` 的目录图/说明里加一句"VPM 子系统（默认关闭，独立数据）"，
  指向本规划。
- 在 `docs/HANDOVER.md` 顶部加一条"2026-10-21 起有 VPM 合并规划，见 docs/VPM-MERGE-PLAN.md；
  P0 后版本线 0.9.0"。
- 不更新发布说明。

---

## 5. 明确不做

- 不建 `vpm.db`，不加任何数据库表。
- 不请求任何 URL。
- 不解析仓库、不解析版本、不做依赖。
- 不列出包、不建工程、不装包、不备份。
- 不动 Project 页的现有布局/导入历史。
- 不写 `.meta`，不动任何 Unity 工程。
- 不发布、不建 Release、不写 release body。

---

## 6. 测试

新增（文件名可调整）：

```text
tests/vpm/config.spec.ts
tests/vpm/data-root.spec.ts
tests/vpm/gate.spec.ts
tests/vpm/static-imports.spec.ts
tests/vpm/errors-i18n.spec.ts
```

必须覆盖：

1. 默认关闭；文件不存在时 status 正常。
2. 坏 JSON/坏字段 → 备份 `.corrupt-*`、默认值、`configRecovered=true`，不崩。
3. 原子写（并发/中断模拟至少一条）。
4. 数据根：C 盘、盘符根、相对路径、素材库内、工程内、安装目录内、不可写 → 各自错误码。
5. 合法非 C 数据根 → 创建子目录、写测试文件、返回 ok。
6. 启用必须成功创建并校验快照；快照失败则 `enabled` 仍为 false。
7. 停用后 `enabled=false`，数据根/设置仍在。
8. 安全模式：`--safe-mode`/环境变量；启用被拒；核心 status 正常。
9. 静态导入护栏；没有 `http`/`net` 被加载。
10. 启用/停用不改变 `library.db` 的 `user_version` / 表结构。
11. i18n：所有新 code 三语齐全；主进程无中文字符串（现有规则）。
12. 核心回归：全量现有测试。

---

## 7. 手工验收（沙盒）

```powershell
$env:AVCA_APP_HOME = "E:\avca-sandbox-p0\AppData\Roaming\A"
$env:AVCA_REQUIRE_SANDBOX_HOME = "1"
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm.cmd run dev
```

> 路径必须是**非 C**、含 `avca`/`sandbox`；不要用真实库。
> 数据根也选沙盒里的非 C 目录（例如 `E:\avca-sandbox-p0\vpm-data`）。

步骤：

1. 启动，确认 Project 页/素材页和原来一样；设置里出现"项目与包"。
2. 直接启用（不选数据根）→ 明确错误，不崩。
3. 选 C 盘目录 → 拒绝并说明原因。
4. 选合法非 C 目录 → 启用成功；确认：
   - `%AVCA_APP_HOME%\vpm\settings.json` 存在；
   - `%AVCA_APP_HOME%\vpm\backups\pre-vpm-*.db` 存在且能只读打开；
   - 数据根下四个空目录存在；
   - `library.db` 的 `user_version` 仍是 11。
5. 重启 → 仍是启用状态；没有网络请求。
6. 停用 → 重启 → 设置入口只显示"启用"；Project 页无变化。
7. 安全模式启动 → VPM 显示已禁用/安全模式；核心正常。
8. 退出，把 `vpm` 目录改名，再启动 → 默认关闭，不崩。
9. 把改名目录还原；确认状态回来。

截图：启用前设置页、数据根错误、启用成功、停用后、安全模式。存 `docs/screenshots/vpm-p0-*`。

---

## 8. 回退验收

- 设置里停用 → 核心行为与 0.8.x 一致。
- 移走 `%AVCA_APP_HOME%\vpm\` → 应用默认关闭，不崩。
- `library.db` 表结构/user_version 不变。
- 全量测试/类型检查/构建通过。
- 在 PR 里贴：`pre-vpm` SHA、`library.db` 的 user_version、快照路径/SHA、截图。

---

## 9. 质量闸门与环境提醒

必须跑：

```powershell
# 全量测试：用重定向拿真实退出码，别用管道
& npm.cmd test *> $env:TEMP\atrium-p0-test.log
$LASTEXITCODE
Get-Content $env:TEMP\atrium-p0-test.log -Tail 40

& npm.cmd run typecheck *> $env:TEMP\atrium-p0-typecheck.log
$LASTEXITCODE

& npm.cmd run build:dir *> $env:TEMP\atrium-p0-build.log
$LASTEXITCODE
```

- `npm run build` 最后会切到 Electron ABI；之后跑测试要 `npm test`（自带 `native:node`）。
- 起应用前清 `ELECTRON_RUN_AS_NODE`。
- PowerShell 的 `Get-Content` 读 UTF-8 中文可能乱码；要读中文用 Node/编辑器，别根据乱码下结论。
- `node -e` 在 PowerShell 里容易被引号/括号搞坏；写成 `.cjs` 再跑；`.cjs` 没有顶层 await。
- 不要用管道接 `npm test` 判断成功；真实退出码必须是 0。
- 通过/跳过数字以实际为准，不硬编码旧基线；判定标准是退出码 0 且总数与基线一致。

---

## 10. 提交、PR 与汇报

- 分支：`codex/vpm-p0-foundation`。
- 提交信息用仓库现有风格（`feat(vpm): ...` / `docs(vpm): ...`）。
- PR 目标 `main`，不要直推 `main`。
- PR 描述必须包含：
  - 改了什么/没改什么；
  - `pre-vpm` SHA；
  - 实际测试数字（通过/跳过/退出码）、typecheck、build；
  - 手工验收步骤与截图路径；
  - 回退验收；
  - 未验证项（明确写"未验证"）；
  - 净室检查表（`VPM-CLEANROOM.md` §7）。
- 满足条件后按 `AGENTS.md` 自行合并；合并后构建并更新本机安装版（VPM 默认关闭），
  用 `node tools/installed-version.cjs --expect=0.9.0` 核实。
- 如果 0.8.0 未合并/工作区冲突/基线不明：**停下来报告**，不要猜。

---

## 11. 完成定义（DoD）

- [ ] `package.json` 0.9.0；无 Release。
- [ ] `pre-vpm` 标签与 SHA 已记录。
- [ ] 独立 VPM 设置/目录/数据根校验/快照/安全模式全部可用。
- [ ] 设置页最小入口；默认关闭；启用/停用可用。
- [ ] 核心 `library.db` schema 未动（11）。
- [ ] 无网络代码、无 `vpm.db`、无包/工程功能。
- [ ] 全量测试/类型检查/构建通过，真实退出码 0。
- [ ] 手工沙盒验收 + 截图 + 回退验收。
- [ ] 净室检查表通过。
- [ ] PR 已合并；本机安装版已更新为 0.9.0（若用户要求暂停，则报告里写明）。
