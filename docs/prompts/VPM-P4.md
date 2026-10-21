# VPM-P4 执行提示词：安装事务、回滚仓与包管理 UI

> 前置：P0–P3 已合并。解析器能产出只读计划；工程可读；仓库可查。
> 必读：`AGENTS.md`、`docs/VPM-MERGE-PLAN.md`、`docs/VPM-CLEANROOM.md`、
> `docs/VPM-PARITY.md`、`docs/VPM-ROLLBACK.md`、`docs/VPM-IMPLEMENTATION-GUIDE.md` §4、§5。
>
> 这是整个项目的 **go/no-go 阶段**：第一次真正改 Unity 工程。
> 事务做不扎实，就不进入 P5。
>
> 工作量允许时可以在同一阶段拆两个 PR：**P4a 事务（无 UI）** 和 **P4b 包管理 UI**；
> 两个都合并、真机都过，才算 P4 完成。不要把它们拆成两个"可以跳过事务"的阶段。

---

## 1. 开始前

```bash
git fetch origin
git switch -c codex/vpm-p4-transaction origin/main
```

记录基线；确认 P3 的计划数据形状。不要重写解析器；P4 只执行 P3 的 Plan。

---

## 2. 目标

1. 包缓存：非 C、内容寻址、SHA-256、配额、原子落盘。
2. 安全解压：zip-slip/大小/符号链接/保留名/大小写冲突全防。
3. 事务：预检 → 下载/校验 → 解压 → 旧包入 Temp → 新包入 `Packages/` →
   **manifest 最后原子写** → 旧 Assets 清理 → 成功/失败回滚 → 回滚仓归档。
4. 崩溃恢复：启动扫描，已提交/未提交分别处理；不自动删现场。
5. 操作记录/撤销：同一工程串行；双击只执行一次；可撤销最后一次安全操作。
6. 包管理 UI：添加包抽屉、版本切换、升级全部、筛选、变更单、进度、错误、历史、撤销。
7. 受保护包 `com.avca.bridge` 永远不参与装/升/降/卸。

---

## 3. 明确不做

- 不建工程/模板/启动 Unity（P5）。
- 不做工程备份/复制/换版本/旧式迁移（P6）。
- 不写 VCC；不接深链（P7）。
- 不新增核心 `library.db` schema；VPM 表继续在 `vpm.db`。
- 不永久删除用户文件；不写 `.meta`；不在 C 盘放缓存。

---

## 3.5 本阶段实现解剖（ALCOM → Atrium）

**ALCOM 的关键机制（行为观察）**

- 先由解析结果生成"待变更集"：装哪些、卸哪些、删哪些 legacy；
  真正的写盘是一个**目录移动事务**，不是逐文件覆盖。
- 在工程 `Temp/vrc-get/<uuid>/` 下准备：包先解压/复制到临时目录；
  然后把旧包目录移到临时目录，再把新包目录移进 `Packages/<id>`；
  **manifest 最后写**，manifest 没写成功就还没提交。
- 任何一步失败就反向移回旧包、移走新包；回滚失败时保留临时目录并报详细路径，
  让人能手工恢复。成功后清临时目录，再按计划清理旧 Assets。
- 包缓存是"包名/版本 zip + 同名 `.sha256`"；命中先校验 hash，
  远程 hash 不匹配就删缓存并拒绝。下载时仓库头 + 包头合并，包头覆盖同名仓库头。
- legacy 清理只认包清单声明的路径/文件；路径必须合法、不是绝对路径，
  先按路径查、再用 GUID 查 `.meta`，UdonSharp 还有额外校验。

**Atrium 的独立实现（更保守）**

- 保留同样的提交顺序，但事务目录放 `<project>/.atrium-tx/<op>/{install,trash}`：
  与 `Packages/` 同卷，保证 rename 原子；**不用 `Temp`**，因为 Unity 打开时可能清掉。
- 每一步先写 journal（`vpm_operation` + `vpm_operation_file`），崩溃后按提交点恢复：
  未提交 → 反向移回；已提交 → 只补 manifest/清理。
- 成功后把 `trash` 复制到 `<dataRoot>/vault/<projectSlug>/<op>/`，逐文件校验后才清临时副本；
  归档失败保留现场，可重试。任何用户文件都不永久删除。
- 只自动清 `Assets/` 下的 legacy；`Packages/` 下的只报告——这是用户的硬约束。
- 写前检查：Unity 未运行、manifest 外部 hash 未变、磁盘空间足够、受保护包不在变更里；
  manifest 采用同目录临时文件 + 原子替换（临时文件也放 `.atrium-tx`）。
- 缓存内容寻址：`<dataRoot>/cache/packages/<ab>/<sha256>.zip`，先验 hash 再解压；
  解压必须防 zip-slip、符号链接、大小炸弹、Windows 保留名。
- 撤销只允许最后一次、工程未变、vault 完整；用反向计划再走一次同一事务。
- "升级全部（最新）"不另写安装器：P3 用 `preset:'upgradeAll'` 生成一个计划，
  P4 只负责预览/应用/撤销；根包升级、传递依赖只加"尽量最新"偏好，不提升为根依赖。

**施工顺序**

1. 缓存/下载/hash 校验（先不碰工程）。
2. 解压安全（zip-slip/大小/符号链接/保留名）。
3. 纯事务：临时工程里移目录/写 manifest，做失败注入。
4. journal/崩溃恢复。
5. vault 归档/撤销。
6. UI 变更单/进度；最后真 Unity 沙盒。

**最容易做错**

- 先写 manifest 再移目录 → 中途失败后 manifest 与磁盘不一致，VPM 认为已安装。
- 事务目录放 `Temp` → Unity 打开工程时清掉现场，无法恢复。
- 回滚时先删新包 → 旧包还没移回，工程直接变空；顺序必须可逆且每步有记录。
- 直接把压缩包解压进 `Packages/` → 半成品目录被 Unity 读到，且 zip-slip 可写出工程。
- 用 `fs.unlink` 清理旧包 → 永久删除；必须进 vault/回收站。

**详细内容**：`docs/VPM-IMPLEMENTATION-GUIDE.md` §4、§5。

---

## 4. vpm.db v3

在 P2 的 vpm.db 上加：

```sql
CREATE TABLE IF NOT EXISTS vpm_operation (
  id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL,
  kind TEXT NOT NULL,              -- install/remove/upgrade/undo
  status TEXT NOT NULL,            -- planned/running/ok/failed/interrupted/cancelled
  plan_json TEXT NOT NULL,
  manifest_before_hash TEXT,
  manifest_after_hash TEXT,
  summary_json TEXT,
  error_code TEXT,
  error_detail TEXT,
  vault_pending INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vpm_op_running
  ON vpm_operation(project_key)
  WHERE status IN ('planned', 'running');

CREATE TABLE IF NOT EXISTS vpm_operation_file (
  op_id TEXT NOT NULL REFERENCES vpm_operation(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  action TEXT NOT NULL,            -- move-out/move-in/legacy/vault
  vault_path TEXT,
  sha256 TEXT,
  size INTEGER,
  state TEXT NOT NULL,             -- pending/done/failed/archived
  PRIMARY KEY (op_id, path, action)
);

CREATE TABLE IF NOT EXISTS vpm_cache_entry (
  sha256 TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  path TEXT NOT NULL,
  source_host TEXT,
  last_used_at INTEGER NOT NULL
);
```

- 迁移 v2→v3：先备份 `vpm.db`；测试。
- 操作状态以 DB + 磁盘 journal 双写；DB 坏时 journal 还能说明现场。
- `vpm_operation_file` 只记路径/动作/校验，不记文件内容。

---

## 5. 缓存（非 C）

新建 `src/main/vpm/cache.ts`：

- 根：`<dataRoot>/cache/packages/<sha256 前两位>/<sha256>.zip`。
- 写入：
  1. 下载到 `<dataRoot>/tmp/<op>-<n>.part`；
  2. 边写边算 SHA-256 + 计数大小；
  3. 校验与计划一致；不匹配 → 移到 `<dataRoot>/cache/corrupt/`（保留，不删）；
  4. `fs.rename` 到最终路径；已存在则校验后复用。
- 读取：安装前**完整重算 SHA-256**；大小不符/算错 → 视为损坏，重新下载。
- 并发：同一 hash 只允许一个下载；用内存 Promise map + 文件锁（可选）。
- 配额：默认 20 GB；超了按 `last_used_at` 清理最久未用缓存 zip；
  **永不清理回滚仓/工程备份/用户文件**。清理前给用量/将释放空间。
- `vpm_cache_entry` 记录 hash/size/path/last_used；缓存文件丢了可重建行。
- 下载进度事件节流 ≥100ms；支持 Abort。

新增 `src/main/vpm/download.ts`（或并入 cache）：用 P1 的 HTTP 客户端；
重试仅限网络/5xx（最多 2 次），4xx/校验失败不重试。

### 5.4 包来源抽象（给 P7 本地包留口）

事务的解压/准备阶段不要写死"zip 文件"。定义一个内部接口：

```ts
type PreparedPackage =
  | { kind: 'zip'; zipPath: string; sha256: string }
  | { kind: 'local'; sourceDir: string; fingerprint: string }
```

- P4 只实现 `zip`；`local` 在 P7 接入。
- `local` 的"准备" = 校验源目录（在允许根内、无 symlink 逃逸、package.json 合法）→
  复制到 `tx/install/<pkg>`；指纹 = 相对路径 + 大小 + 内容 hash 的稳定摘要。
- 事务的 move/rollback/manifest 逻辑对两种来源完全一致。
- 测试里用 `local` 走一遍 happy path/失败注入，证明抽象没漏。

---

## 6. 解压

新建 `src/main/vpm/extract.ts`：

- 输入：缓存 zip、目标目录（工程 `.atrium-tx/<op>/install/<pkg>`）。
- 用 `yauzl` 流式读取；不一次性读入内存。
- 拒绝：
  - 绝对路径、盘符、UNC、`..`、NUL/控制字符；
  - 反斜杠先归一为 `/` 再校验；
  - 符号链接/硬链接（external attributes）；
  - Windows 保留名（CON/NUL/COM1…）、结尾点/空格、ADS（`:`）；
  - 大小写归一后的重复路径；
  - 超长路径（Windows >260）无法安全创建 → 拒绝/给明确错误，不静默截断；
  - 条目数 >100,000；解压总量 >8 GiB；压缩比异常（zip bomb）；
  - 目标路径不在临时目录内（realpath 二次校验）。
- 目录条目创建；空目录保留；文件权限不依赖。
- **`.meta` 原样解压**，不生成/不修改。
- 解压后校验：
  - 根或唯一包装目录下有 `package.json`；
  - `name`/`version` 与计划一致；`vpmDependencies` 可解析；
  - 包名合法；不允许根目录逃逸。
- 失败：保留临时目录供诊断，标记失败，不进入提交；临时目录由回滚/清理策略处理。

> 事务目录放在**工程根下的隐藏目录 `.atrium-tx`**（同卷，才能原子 rename）。
> 不用 `Temp` 的原因：Unity 打开工程时可能清理 `Temp`，崩溃后现场就没了；`.atrium-tx`
> 不在 Assets/Packages 里，Unity 的资产扫描不应读取它。**真机必须验证 Unity 忽略它**；
> 如果实测会干扰，再换一个同卷隐藏位置并写进报告，不能默默假设。
> 事务临时不是缓存；缓存仍在非 C 数据根。

---

## 7. 事务

新建 `src/main/vpm/transaction.ts`、`journal.ts`、`vault.ts`。

### 7.1 操作状态与串行

- `PlanApply({ projectKey, planId })`：
  1. 从主进程的 plan 缓存取出 Plan（P3）；**不接受渲染层回传的计划内容**；
  2. 重新读取 manifest/工程状态，校验 `manifestHashBefore`、plan 未过期、计划完整；
  3. 插入 `vpm_operation(status='planned')`；部分唯一索引保证同工程只有一个；
  4. 立刻原子抢权：`UPDATE ... SET status='running', started_at=? WHERE id=? AND status='planned'`；
     改不动 → `vpmProjectBusy`；
  5. 返回 opId，后台执行。
- 同一工程同一时间只允许一个写操作；不同工程可并行（下载全局限流）。
- 双击/重试：已有 running/planned → 返回已有 opId 或 `vpmProjectBusy`，不重复执行。

### 7.2 预检

- 工程路径有效；`ProjectVersion.txt` 可读；
- manifest hash 与 Plan 的 before 一致；外部改动 → `vpmProjectChanged`；
- Unity 未运行（复用现有三路状态；有 `Temp/UnityLockFile` 等证据也要考虑）；
- 数据根合法、可写；工程卷/数据根剩余空间 ≥ 预计需求 ×1.2 + 512 MiB；
- 所有下载有 URL + SHA-256；受保护包不在 changes；
- 目标 `Packages/<id>` 路径合法；计划里的 remove 目标存在或明确可忽略；
- 旧包目录不能是符号链接/junction（否则移动可能影响工程外目标）；发现就拒绝并报告；
- 计划 blocked/冲突/缺失 → 拒绝。
- 对升级/降级/重装/卸载，明确提示"旧包目录会先移到回滚仓"；
  如果用户可能在包目录里改过文件，这是唯一的安全网。
- 预检失败：operation `failed`，不动工程。

### 7.3 执行顺序

1. 创建 `<project>/.atrium-tx/<op>/{install,trash}`（同卷，隐藏目录）。
2. 下载/校验所有包（缓存）。
3. 解压到 `tx/install/<name>`；校验 package.json。
4. 备份原 manifest 到 `tx/manifest.original.json`。
5. 对每个 remove/replace：
   - `Packages/<id>` → `tx/trash/<id>`（同卷 rename）；
   - 记录 `vpm_operation_file`（move-out）；
   - 目标不存在且计划要求移除 → 失败/警告（按计划）。
6. 对每个 install：
   - `tx/install/<id>` → `Packages/<id>`（同卷 rename）；
   - 如果目标已存在 → 失败，回滚；
   - 记录 move-in。

> Windows 上 `rename` 可能被杀毒/索引/Unity 残留占用（EBUSY/EPERM）：
> 第 5/6 步都要有限次退避重试；仍失败就回滚并给明确错误，不要强删/强移。

7. 生成新 manifest：
   - 保留未知字段；
   - `dependencies`：保留仍在的原有范围；用户显式 install/upgrade/downgrade 的包写入目标版本/范围；
     移除被删包；传递依赖不强行写入 dependencies（与 VPM 常见形状一致）；
   - `locked`：所有最终包，精确版本 + 依赖范围；
   - 原子写：先在 `.atrium-tx/<op>/vpm-manifest.new.json` 写完并 fsync，
     再 rename 到 `Packages/vpm-manifest.json`（同卷；不在 Packages 留临时文件）；
   - 写失败：回滚 5/6，恢复原 manifest。
8. `manifest_after_hash` 记录；**提交点 = manifest rename 成功**。
9. 旧 Assets 清理（仅路径级，GUID 级留给 P6）：
   - 只处理计划里的 legacyFolders/legacyFiles/legacyPackages；
   - 双重校验：在允许列表 + `Assets/` 之下；
   - 文件/目录连同 `.meta` 一起移到 `tx/trash/legacy/...`；
   - **不生成/不改写 `.meta`**；不删整个 `Assets/`；
   - 失败 → 不撤销已提交的包，只记录 warning/`legacyCleanupFailed`，UI 说明"旧文件还在"。
10. 成功：
    - operation `ok`；
    - `vault_pending=1`；
    - 归档 `tx/trash` → `<dataRoot>/vault/<projectSlug>/<op>/`；
    - 逐文件复制 + SHA-256 校验；成功后才清理 `tx/trash`（应用自己的临时副本）；
    - 归档失败 → 保留 `tx/trash`，`vault_pending=1`，可重试；工程已可用。
11. 失败（提交点之前）：
    - 反向：新包移回 `tx/rolledback`，旧包从 trash 移回 `Packages/`，
      manifest 恢复原文件；
    - operation `failed`/`rolledback`；记录失败步骤/错误码；
    - 回滚失败 → `interrupted`，保留全部现场，UI 给"查看/恢复"；
    - **不自动删现场**。
12. 清理：仅在成功且归档完成后清理 `tx/install` 空目录；崩溃恢复后再清。

### 7.4 Journal

- 每步先写 journal（`.atrium-tx/<op>/journal.json`，原子写），再执行；
  完成后更新状态。
- Journal 包含：opId、phase、moves、manifest paths/hashes、legacy paths、timestamps。
- 启动恢复：
  - 扫描 `vpm_operation` 中 `planned/running`；
  - 无 journal → 标记 interrupted，提供人工入口；
  - **事务目录不能被 Unity 清掉**：用 `<project>/.atrium-tx`，真机确认 Unity 忽略它；
    崩溃后 UI 仍要提示"先让 Atrium 恢复，再打开 Unity"，并覆盖"直接打开 Unity"的最坏情况；
  - 有 journal 且未到提交点 → 按反向步骤恢复（幂等）；
  - 已过提交点 → 标记 ok/完成归档；
  - Unity 正在运行 → 不自动改文件，标记 `needsRecovery`，等关闭后重试。
- 恢复本身也是操作，记录日志；不删除 journal，直到用户确认/归档完成。

### 7.5 撤销

- 只允许：
  - 该工程最后一次成功操作；
  - 当前 manifest hash == 该操作 after hash；
  - 工程未在 Unity 中运行；
  - 回滚仓/trash 文件完整。
- 撤销 = 生成反向 Plan，再走同一事务（kind='undo'），不是直接复制。
- 如果工程之后有外部改动/新操作 → 拒绝，给 `vpmUndoUnsafe`；提供只读回滚仓入口。
- 撤销也写操作记录，可再次撤销（如果安全）。

---

## 8. 旧式 Assets 清理的硬规则

- 只按包清单声明的 legacy 路径/包名，不扫描整个 Assets 乱删。
- 路径必须：
  - 在允许列表里；
  - resolve 后仍在 `<project>/Assets/` 下；
  - 不是 `Assets` 根本身；
  - 不跟随符号链接/junction。
- 文件连同同名 `.meta` 一起移动；目录连同目录 `.meta` 一起移动。
- 先移到 `.atrium-tx/<op>/trash/legacy/`，再归档到回滚仓。
- 任何不确定 → 不做，给 warning；宁可留旧文件，不可误删。
- GUID 级清理/P6 迁移单独做；P4 不实现。

---

## 9. IPC

在 `IpcInvoke.Vpm` 增加：

```text
PlanApply        // { projectKey, planId } -> { opId }；不接受渲染层传 Plan 内容
OperationStatus  // opId -> { status, phase, progress, errorCode, warnings }
OperationCancel  // opId -> ok/tooLate
OperationHistory // projectKey -> 最近 N 条
OperationUndo    // opId -> newOpId
OperationRecover // opId -> 继续/回滚（需确认）
CacheStatus      // 用量/配额/可清理
CacheClean       // 清理未使用缓存（确认）
VaultStatus      // 用量/条目
VaultArchiveRetry// 归档失败重试
```

事件：

```text
vpm:operation-progress
vpm:operation-done
```

- 每个事件都只是加速；`OperationStatus` 必须能恢复。
- 进度节流 ≥100ms；不要每个文件一条 IPC。
- 取消：
  - 下载/解压/预检阶段可取消；
  - 提交点之后不可取消，返回 `vpmCancelTooLate`；
  - 取消也要走清理/记录。
- 所有错误 code + 参数；详情不含请求头/token。

---

## 10. UI（轻量化）

### 10.1 包管理

- 工程详情 → 包：
  - 顶部：已安装数量/可更新数量 + 一个主按钮"添加包"；
    "升级全部（最新）"是次要按钮/文字动作，不抢主按钮；无更新时禁用；
  - 工具栏：搜索 + "筛选软件包"（全部/已安装/可更新/有冲突；可选来源筛选）；
  - 列表列：包名/显示名、**已安装版本下拉**、最新版本、来源、状态、更新标记；
    版本下拉直接选目标版本（升级/降级），选中后进变更单，不立即写盘；
  - 行内：移除（红减号，二次确认）、溢出菜单（重装/详情/changelog/docs）；
  - 勾选后才出现底部变更条（"查看更改"），不常驻。
- 升级全部：
  - 只调用 P3 `PlanPreview({preset:'upgradeAll'})`，不自己拼请求；
  - PlanSheet 里逐包显示 `cur → new`、来源、是否 major 升级、冲突/缺失；
  - 受保护包、legacy 冲突、unlisted 不参与；
  - 没有可升级项时给"已是最新"，不生成空计划。
- 添加包抽屉：
  - 搜索/筛选；版本下拉；"加入更改"；
  - 底部显示 N 项变更 + 主按钮"查看更改"。
- 变更单（复用 P3 PlanSheet）：
  - 变更/原因/冲突/缺失/磁盘/Unity 必须关闭；
  - 主按钮"应用更改"；冲突时禁用；
  - 勾选"我已了解会修改工程"（首次操作时；之后可记住本次会话）。
- 执行：
  - 进度：下载/校验/解压/提交/清理；可取消（提交前）；
  - 成功：摘要 + "撤销这次操作"（受 7.5 限制）；
  - 失败：错误码 + 已回滚/未回滚 + 详情 + 重试；
  - 旧资源清理失败：明确"包已装好，但 N 个旧文件没清掉"。
- 历史：最近操作、时间、结果、可撤销标记；不要做成第二套日志系统。

### 10.2 按钮纪律

- 一个屏幕一个实心主按钮；"刷新/取消/关闭"是文字/次要。
- 不常驻批量条；不嵌套弹窗。
- 危险动作二次确认，说明"移到回滚仓，不永久删除"。
- 进度不阻塞整个窗口；同工程写操作禁用并解释。
- 三语文案；截图 100%/125%。

---

## 11. 测试（必须够狠）

新增：

```text
tests/vpm/cache.spec.ts
tests/vpm/extract-safety.spec.ts
tests/vpm/transaction-happy.spec.ts
tests/vpm/transaction-failures.spec.ts
tests/vpm/transaction-recovery.spec.ts
tests/vpm/transaction-concurrency.spec.ts
tests/vpm/manifest-write.spec.ts
tests/vpm/legacy-cleanup.spec.ts
tests/vpm/undo.spec.ts
tests/vpm/operation-ipc.spec.ts
tests/vpm/package-ui.spec.ts
tests/vpm/upgrade-all-ui.spec.ts
```

### 11.1 失败注入

在事务里留**测试专用**的依赖注入 hook（不要生产环境变量开关），在以下点各注入一次失败：

- 下载中断/超时/校验不匹配；
- 解压中/解压后 package.json 不匹配；
- 移旧包前/中/后；
- 移新包前/中/后；
- manifest 写前/中/后；
- legacy 清理前/中；
- vault 归档前/中。

每个用例断言：

- 提交点前失败 → 工程目录/manifest 与操作前**逐字节/语义一致**；
- 提交点后失败 → 工程可用，warning 正确，回滚仓有副本；
- 不留下"半装"包；
- 现场不被自动删除。

### 11.2 崩溃恢复

- 在 journal 各阶段模拟进程重启；
- 恢复后：
  - 未提交 → 回滚完成；
  - 已提交 → ok + 完成归档；
  - Unity 运行中 → needsRecovery，不写文件；
- 恢复幂等（跑两次结果一致）。

### 11.3 安全

- zip-slip/绝对路径/盘符/UNC/`..`/符号链接/硬链接/junction；
- Windows 保留名/尾点/尾空格/ADS/大小写冲突/长路径；
- zip bomb（条目数/总大小/压缩比）；
- hash 不匹配/缓存损坏/缓存被替换；
- 磁盘不足（mock statfs）；
- manifest 只读/被占用/外部改动；
- 受保护包被计划包含 → 拒绝；
- legacy 路径 `Assets/../`、`Assets` 根、symlink → 拒绝/警告；
- 并发 apply 同一工程 → 一个成功/一个 busy；
- 双击 apply → 不重复。

### 11.4 真 Unity（沙盒）

- 用 **Unity 2022.3.22f1**、沙盒工程、沙盒 `AVCA_APP_HOME`、非 C 数据根。
- 准备一个**我们自己造的**测试包（package.json + 一个简单文件；需要 `.meta` 时用 Unity 生成后再打包，
  不要手写）。
- 验证：
  1. 安装 → `Packages/<id>` 存在、manifest 正确、Unity 打开无编译/包错误；
  2. 升级/降级/重装；再测一次"升级全部（最新）"：只生成一个计划、逐包预览、应用后可撤销；
  3. 卸载 → 包目录消失、旧版本在回滚仓、manifest 正确；
  4. 旧式 Assets 文件（用 Unity 生成 meta）→ 安装后移到回滚仓，工程不丢文件；
  5. 撤销 → 工程回到操作前；
  6. 关闭 Unity 才能操作；运行中给明确错误。
- 如果有网络，再用官方包（如 `com.vrchat.base`）装一次；没有就记录"未验证官方包"。
- 不用用户真实工程。

---

## 12. 手工验收

- 沙盒里完整走一遍：添加包 → 变更单 → 应用 → 看进度 → 用现有/手动方式打开 Unity → 卸载 → 撤销。
- 再走一遍：筛选"可更新" → 升级全部（最新）→ 预览逐项 → 应用 → 撤销；
  验证版本下拉能选指定旧版本、受保护包不出现、"已是最新"时按钮禁用。
- 断网/缓存命中/缓存损坏。
- 磁盘不足（可用小盘/填文件模拟；不要在真盘写满）。
- 崩溃：在事务中杀进程（沙盒），重启看恢复。
- 双击应用、同一工程并发。
- 截图：包列表、变更单、进度、失败、历史、撤销。

---

## 13. 质量闸门

```powershell
& npm.cmd test *> $env:TEMP\atrium-p4-test.log; $LASTEXITCODE
& npm.cmd run typecheck *> $env:TEMP\atrium-p4-typecheck.log; $LASTEXITCODE
& npm.cmd run build:dir *> $env:TEMP\atrium-p4-build.log; $LASTEXITCODE
```

- 不允许"测试很多所以没问题"；关键修复要做变异验证（把修复改回去，测试必须红）。
- 记录真实通过/跳过数字；未验证项明说。
- 净室检查表；不发布 Release；合并后更新本机安装版（VPM 默认关闭）。

---

## 14. 完成定义

- [ ] 缓存/解压/事务/回滚仓/崩溃恢复/撤销全部可用。
- [ ] manifest 最后写；提交点前失败可逐字节恢复。
- [ ] 受保护包、Unity 运行中、磁盘不足、hash 不符均被正确处理。
- [ ] 包管理 UI 轻量可用；添加/版本切换/筛选/升级全部/进度/错误/历史清晰。
- [ ] 真 Unity 沙盒通过；官方包验证或明确未验证。
- [ ] 没有永久删用户文件/写 `.meta`/C 盘缓存。
- [ ] 全量测试/类型/构建通过；净室/回退证据；PR 合并；安装版更新。
