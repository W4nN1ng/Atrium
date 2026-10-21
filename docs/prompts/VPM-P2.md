# VPM-P2 执行提示词：Unity 发现、项目台账与只读集成

> **执行入口（2026-10-21 起）**：本文件是 P2 阶段规格，不是一次执行的任务。
> 请按 [`tasks/P2-*.md`](tasks/) 的任务卡逐个执行；本文件只查阅任务卡列出的章节。
> 任务板：[`../VPM-TASKS.md`](../VPM-TASKS.md) · 共同规则：[`_COMMON.md`](_COMMON.md) · 架构：[`../VPM-ARCHITECTURE.md`](../VPM-ARCHITECTURE.md)。

> 前置：P1 已合并。VPM 默认关闭；仓库/目录可用；还没有装包。
> 必读：`AGENTS.md`、`docs/VPM-MERGE-PLAN.md`、`docs/VPM-CLEANROOM.md`、`docs/VPM-PARITY.md`、`docs/VPM-IMPLEMENTATION-GUIDE.md` §5、§6、§10。
>
> 本阶段**只读工程**：发现 Unity、发现/添加工程、读 `vpm-manifest.json` 与
> `Packages/`、报告旧式资源。**不写任何工程文件。**

---

## 1. 开始前

```bash
git fetch origin
git switch -c codex/vpm-p2-unity-projects origin/main
```

确认 P1 的 schema/HTTP 测试仍绿；记录基线。

---

## 2. 目标

1. 发现 Windows 上的 Unity 编辑器：Unity Hub 配置 + 手动添加 + 版本识别。
2. 发现/添加/移除（只移除列表）Unity 工程；复用现有工程发现与运行状态。
3. 读取工程的 `ProjectVersion.txt`、`vpm-manifest.json`、`Packages/*/package.json`。
4. 显示已装包、版本、来源、锁文件、缺失包、旧式 Assets 包报告。
5. 把 VPM 信息接进现有 Project 页（懒加载、只读）。

---

## 3. 明确不做

- 不装/卸/升级包（P4）。
- 不解析候选版本/冲突/删除计划（P3）。
- 不新建工程/模板/启动 Unity（P5）。
- 不备份/复制/迁移（P6）。
- 不写 `vpm-manifest.json`、不写 `Packages/`、不写 `Assets/`、不写 `.meta`。
- 不修改 `library.db` 的 schema；不加 `SCHEMA_VERSION`。
- 不写 VCC 的 settings/LiteDB。
- 不读用户真实库/工程做测试。

---

## 3.5 本阶段实现解剖（ALCOM → Atrium）

**ALCOM 的关键机制（行为/架构观察）**

- 工程加载不是只读一个文件：它同时读 `Packages/vpm-manifest.json`、
  `Packages/manifest.json`、`ProjectSettings/ProjectVersion.txt`、
  `Packages/*/package.json`；用 VPM manifest 的 `locked` 判断哪些目录算"已安装"，
  其余目录是本地/未锁定包。
- Unity 编辑器发现有三路来源：Hub 默认安装根、`secondaryInstallPath.json`
  的自定义根、`editors-v2.json` 的 located editors；目录名/可执行文件/版本都要校验，
  磁盘扫描优先，按"版本 + 架构"去重；架构未知按 x86_64 处理。
- 选择编辑器时按 exact → revision → minor → major 逐级放宽，而不是字符串包含。
- 启动前先判断该工程是否已有 Unity 在跑；参数来自工程自定义设置或默认值，
  用 detached 进程启动，失败要清掉"opening"状态。

**Atrium 的独立实现**

- 只读扫描：`projectKey` = 大小写归一后的绝对路径，`projectSlug` = 安全短名；
  文件系统是唯一真相，`vpm_project`/`vpm_project_package` 只是可重建缓存。
- manifest 读取复用 P1 解析器；坏 JSON 只警告，不阻断包目录展示；
  扫描只进 `Packages/` 直接子目录，**不跟随 symlink/junction**，不写任何工程文件。
- 包状态显式区分：`ok` / `missing` / `unlisted` / `mismatch` / `protected` / `legacy`；
  报告旧 Assets 只读，绝不删除或"顺手修复"。
- Unity 发现合并 Hub 文件 + 磁盘扫描 + 手动 exe；版本无法识别时让用户确认；
  missing 只标记不删记录。启动用 `spawn(exe, argsArray, {detached})`，绝不拼 shell；
  已有实例运行则不重复启动。
- 包操作开始前要求 Unity 关闭；本阶段只读，不产生任何工程写入。

**施工顺序**

1. 读 ProjectVersion + 两个 manifest + `Packages/*/package.json`（fixture 测试）。
2. 包状态对照与旧式报告；测"扫描前后文件 mtime/hash 不变"。
3. Hub 三路来源解析 → 磁盘扫描 → 版本/架构去重 → 手动添加。
4. 工程版本匹配（exact → revision → minor → major）。
5. 接 IPC 与现有 Project 页只读展示；启动 Unity 放最后。

**最容易做错**

- 把 `Packages/` 下所有目录都当 VPM 包 → UPM/本地包被误报。
- 扫描跟随 junction → 扫到工程外甚至死循环。
- 顺手写 manifest"修正格式" → 本阶段只读，写一次就破坏用户工程。
- 不归一大小写 → Windows 上同一个工程出现两条记录。
- 启动 Unity 用 shell 拼字符串 → 路径空格/引号注入。

**详细内容**：`docs/VPM-IMPLEMENTATION-GUIDE.md` §5、§6、§10。

---

## 4. Unity 发现

新建 `src/main/vpm/unityRegistry.ts`。

### 4.1 Hub 配置（Windows）

按顺序读，缺一个就跳过，不因单个坏文件失败：

```text
%APPDATA%\UnityHub\editors-v2.json
%APPDATA%\UnityHub\editors.json          （旧版兼容）
%APPDATA%\UnityHub\secondaryInstallPath.json
%APPDATA%\UnityHub\settings.json
```

- `editors-v2.json` / `editors.json` 里通常是安装记录（数组/对象）；字段名可能随 Hub 版本变化。
  用防御式解析：只取"路径、版本、revision、architecture"等可识别字段，未知字段忽略。
- `secondaryInstallPath.json` 可能指向另一个安装根；扫描其下的编辑器目录。
- 版本识别优先级：
  1. Hub 记录里的版本/revision；
  2. 路径中的 `YYYY.MINOR.PATCH[abfp]N`；
  3. 无法识别 → 标记 `versionUnknown`，让用户手动确认，**不要启动 Unity 只为问版本**。
- 只接受存在的 `Unity.exe`（或 Hub 记录里的可执行路径）；不存在标 `missing`，不删除记录。
- 合并 Hub 发现与手动添加：同一路径去重；手动记录优先保留用户命名/覆盖。
- 不调用 Unity Hub 无头进程；不写 Hub 配置。

### 4.2 手动添加

- 文件选择器选 `Unity.exe`；校验是文件、名字合理、路径可执行（不实际运行）。
- 版本无法确定时让用户输入/选择；输入要校验格式。
- 记录 `source=manual`；Hub 后来也发现同一路径时合并，不重复。

### 4.3 数据

`vpm.db` v2 表：

```sql
CREATE TABLE IF NOT EXISTS vpm_unity_install (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  version TEXT,
  version_with_revision TEXT,
  source TEXT NOT NULL,
  arch TEXT,
  last_seen_at INTEGER,
  missing INTEGER NOT NULL DEFAULT 0
);
```

- 每次启动/手动刷新时合并，不删除用户手动记录；missing 只标记。
- 路径归一（大小写/尾斜杠/realpath 可用时）去重；同一 exe 不要两条记录。
- 提供 `listUnityInstalls()`，按版本排序。

---

## 5. 工程读取

新建 `src/main/vpm/projectFs.ts`。

### 5.1 工程身份

- `projectKey`：解析绝对路径后，Windows 大小写归一（盘符/路径统一小写），
  用于 `vpm.db` 的主键；另存原始 `projectPath` 用于显示/操作。
- `projectSlug`：给文件系统用的安全短名，例如
  `<工程名去掉非法字符>-<projectKey 的 SHA-256 前 8 位>`；
  回滚仓/工程备份/临时归档目录用它，**绝不直接把带 `:`/`\` 的路径当目录名**。
- 避免符号链接造成同一工程两条记录：能 `realpath` 就用 realpath 做 key；失败回退 resolve。
- 可选读取 `ProjectSettings/ProjectSettings.asset` 的 `productGUID`（只读、防御式），
  用于将来工程移动后的重连；本阶段不依赖它。

### 5.2 读取 `ProjectVersion.txt`

- 路径：`ProjectSettings/ProjectVersion.txt`。
- 必须存在；解析 `m_EditorVersion:` 与 `m_EditorVersionWithRevision:`。
- 版本非法/缺失 → `vpmProjectInvalid`，不加入可管理列表（可显示为"无效工程"）。
- 与 Unity 安装匹配：按基础版本（如 `2022.3.22f1`）找；找不到给 warning，不阻止查看。
- 不修改版本文件。

### 5.3 读取 `vpm-manifest.json`

- 用 P1 的 `manifest.ts`；路径 `Packages/vpm-manifest.json`。
- 缺失：视为空 manifest（新工程/非 VPM 工程），给 `hasVpmManifest=false`。
- 坏 JSON：给 `vpmManifestInvalid` + 详情，不影响读取 `Packages` 目录。
- 记录 mtime + hash，供后续外部修改检测（P4 用）。
- 不写回。

### 5.4 扫描 `Packages/`

- 只扫描 `Packages/` 的直接子目录（embedded package 的常规位置）。
- 每个目录读 `package.json`：`name`、`version`、`unity`、`vpmDependencies`。
- 跳过：
  - 没有 `package.json` 的目录（可能是 UPM 的 `file:` 包/用户目录）；
  - `Packages/manifest.json` 等文件；
  - 符号链接/junction（记录 warning，不跟随）。
- 包名/版本非法 → 标记 warning，不崩溃。
- 与 manifest 对照：
  - manifest 有、目录没有 → `missing`；
  - 目录有、manifest 没有 → `unlisted`（可能是本地/手动包）；
  - 版本不一致 → `mismatch`；
  - 受保护包 `com.avca.bridge` → 标记 protected，永远不参与后续管理。
- 读包目录的 `package.json` 只用于展示/缓存，**不修改**。

### 5.5 旧式 Assets 包报告（只读）

- 目的：让用户知道"这个工程有旧式 VPM/Assets 包，可能需要迁移"。
- 扫描 `Assets/` 下深度 ≤4 的 `package.json`（跳过 `Library`、`Temp`、`Logs`、`obj`、`.git`、
  `node_modules`、隐藏目录、符号链接）；解析 name/version。
- 对已装包 manifest 的 `legacyFolders`/`legacyFiles`/`legacyPackages`：
  - 只检查路径是否存在（`Assets/<path>`）；
  - 不做 GUID 扫描（P6 迁移时再做，避免性能开销）；
  - 不删除、不移动。
- 输出报告：候选包、路径、匹配方式（package.json / legacy path / legacy package id）、
  风险提示（"迁移前必须备份"）。
- 限制扫描条目/用时；大工程给"扫描超时/部分结果"。

### 5.6 缓存到 vpm.db v2

```sql
CREATE TABLE IF NOT EXISTS vpm_project (
  project_key TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  name TEXT NOT NULL,
  unity_version TEXT,
  unity_revision TEXT,
  unity_exe_path TEXT,
  unity_args_json TEXT,
  manifest_hash TEXT,
  manifest_mtime INTEGER,
  last_scan_at INTEGER,
  last_op_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vpm_project_package (
  project_key TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT,
  source TEXT,
  is_legacy INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL,
  dependency_json TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_key, name)
);
```

- 这些是缓存：每次扫描可重建；不要拿它覆盖工程。
- 工程被移除/路径失效：保留行并标 missing，等用户处理；不自动删。
- 迁移 v1→v2：加表；备份 `vpm.db`；测试。

---

## 6. 与现有工程发现/运行状态整合

- 复用 `src/main/project/api.ts` 的工程发现、VCC `userProjects` 读取、运行状态三路判别。
- 不复制一套工程列表；现有 `project` 表仍是列表真相。
- VPM 详情通过 `projectPath` 关联 `vpm_project`；路径归一后匹配。
- 新增/移除工程：
  - 添加已有：验证 → `upsertProject`（现有仓储）→ 扫描 VPM → 写 `vpm_project`。
  - 从列表移除：只删现有 `project` 行/隐藏标记（按现有能力），**不删文件**；
    同时把 `vpm_project` 标记为 unlinked 或删除其行（必须二次确认，说明文件仍在）。
  - 如果现有 repo 没有"移除工程行"函数，可以加一个只删 `project` 行、不碰磁盘的函数；
    这是 DML，不是 schema 改动。不要顺手删 import 历史/素材。
  - **先确认删除行不会让导入历史页崩溃**：import_log 没有外键，删 project 行可能让历史
    找不到工程名。若会崩，改成"只从 VPM 面板隐藏 + 明确提示仍在核心列表"，
    不要为了这个功能给核心表加列。
- 运行状态：沿用 `running`/`detectedBy`/`busyReason`；VPM 只展示，不改变。
- Unity 运行中本阶段只读，没有问题；不要启动/关闭 Unity。

### 6.1 当前工程与导入目标（P2-E）

- **唯一真相在核心**：现有 `UnityConnections`/`unity:set-target` 继续拥有当前导入目标；
  VPM 台账只存工程读取缓存，不另存“当前工程”，不生成第二套工程 ID。
- 工程身份用核心 `project.id` + 规范化路径；VCC 导入的工程先映射到核心行，
  VPM 详情用同一 ID 关联；路径大小写/尾斜杠归一。
- 新增“启动绑定”状态：Atrium 启动工程前调用绑定，工程即使还在启动/未连接也立即成为目标；
  显式“设为导入目标”覆盖启动绑定；工程关闭/移除/启动失败清除。
- 绑定是**应用内存状态**，不是工程写入，也不跨重启持久化；没有绑定且只有一个运行工程时，
  沿用现有自动选择；多个运行工程且无显式选择时，仍要求用户选一次。
- P2-E 只做核心目标状态、IPC/测试和工程页徽标；真正“打开 Unity”在 P5-D/P5-E。

---

## 7. IPC

在 `IpcInvoke.Vpm` 增加：

```text
UnityList, UnityAdd, UnityRemove, UnityRescan,
ProjectList, ProjectGet, ProjectAdd, ProjectRemoveFromList, ProjectRescan,
ProjectLegacyReport
```

- 所有 path 参数在主进程 resolve/校验；拒绝不存在/非目录/系统目录。
- `ProjectGet` 返回合并后的 DTO：
  ```ts
  {
    projectKey, path, name, unityVersion, unityRevision, unityExePath,
    running, detectedBy,
    hasVpmManifest, manifestHash,
    packages: [{name, version, source, state, isLegacy, protected}],
    warnings: [{code, params}],
    legacy: {candidates: [...], truncated: boolean}
  }
  ```
- 错误只给 code；不返回中文。
- 所有读取要能在 VPM 停用时返回 `vpmDisabled`，核心不受影响。

---

## 8. UI（只读）

在现有 Project 页加 VPM 区域（懒加载；disabled 时完全为 null）：

- 顶部：项目搜索/添加已有工程/刷新；不新增顶级导航。
- 列表行：工程名、Unity 版本、包数量、运行状态、路径（次要）。
- 点击进详情（抽屉或页面内面板，二选一；优先现有布局能容纳的抽屉）：
  - 概览：路径、Unity 版本/revision、匹配的编辑器、manifest 状态、运行状态；
  - 包：已装包列表（名称/版本/状态：ok/missing/unlisted/mismatch/protected）、来源；
  - 警告：缺失包、版本不一致、旧式 Assets 报告、Unity 未安装；
  - 按钮：打开文件夹、重新扫描、从列表移除；
  - "启动 Unity"和"管理包"先禁用，文案说明后续阶段；不要放空按钮。
- 添加已有工程：目录选择 → 校验 → 成功/错误码。
- 从列表移除：明确"只从 Atrium 列表移除，不删除磁盘文件"。
- 旧式报告：只读列表 + "迁移将在后续阶段提供"；不要提供删除按钮。
- 空状态：一个主按钮"添加已有工程"。
- 按钮纪律：一个主按钮；其余文字/溢出。
- 三语文案；截图（100% 和 125% 缩放）存 `docs/screenshots/vpm-p2-*`。

---

## 9. 测试

新增：

```text
tests/vpm/unity-registry.spec.ts
tests/vpm/project-fs.spec.ts
tests/vpm/project-scan.spec.ts
tests/vpm/db-v2.spec.ts
tests/vpm/project-integration.spec.ts
```

覆盖：

1. Hub 配置：正常/缺文件/坏 JSON/重复路径/旧版 editors.json/secondary path/unknown version。
2. 手动添加：合法/不存在/非 exe/版本未知。
3. ProjectVersion：正常/带 revision/缺失/非法/部分版本。
4. manifest：缺失/空/正常/坏 JSON/BOM/未知字段。
5. Packages 扫描：正常/missing/unlisted/mismatch/protected/符号链接/无 package.json/坏包。
6. 旧式报告：package.json 命中、legacy path 命中、超时/截断、跳过隐藏/大目录。
7. projectKey：大小写、斜杠、realpath、重复工程。
8. DB v1→v2 迁移、重启、缓存重建、higher version 拒绝。
9. 添加/移除工程：移除只删记录，不碰磁盘（用 mtime/目录快照断言）。
10. 只读：扫描前后工程文件 mtime/hash 不变。
11. 现有工程发现/运行状态回归。
12. 核心 schema 不变。

---

## 10. 手工验收（沙盒）

- 用沙盒 `AVCA_APP_HOME`、非 C 数据根。
- 添加一个沙盒 Unity 工程（可以复制一份，不要用真实工程）。
- 验证：Unity 版本、包列表、missing/unlisted、旧式报告。
- 在 Unity 打开/关闭两种状态下看运行状态；VPM 只读不阻止。
- 打开文件夹、移除列表（文件仍在）、重新扫描。
- 没有 Unity 安装时：显示"未找到编辑器"，不崩。
- 如果本机有多个 Unity：验证版本匹配/手动切换（P2 只展示匹配，不写工程）。
- 截图。

---

## 11. 完成定义

- [ ] Unity Hub/手动发现可用；版本识别有兜底。
- [ ] 工程添加/列表/详情/只读包扫描/旧式报告可用。
- [ ] `vpm.db` v2 独立迁移，核心库不动。
- [ ] 没有写工程/写 `.meta`/装包。
- [ ] 现有 Project 页导入历史/目标功能不回归。
- [ ] 全量测试/类型/构建通过；手工截图；净室检查表。
- [ ] PR 合并；本机安装版更新（VPM 默认关闭）。
