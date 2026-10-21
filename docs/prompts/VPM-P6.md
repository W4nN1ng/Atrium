# VPM-P6 执行提示词：工程备份、复制、Unity 版本与旧版迁移

> **执行入口（2026-10-21 起）**：本文件是 P6 阶段规格，不是一次执行的任务。
> 请按 [`tasks/P6-*.md`](tasks/) 的任务卡逐个执行；本文件只查阅任务卡列出的章节。
> 任务板：[`../VPM-TASKS.md`](../VPM-TASKS.md) · 共同规则：[`_COMMON.md`](_COMMON.md) · 架构：[`../VPM-ARCHITECTURE.md`](../VPM-ARCHITECTURE.md)。

> 前置：P5 已合并；新建/启动/装包可用。
> 必读：`AGENTS.md`、`docs/VPM-MERGE-PLAN.md`、`docs/VPM-CLEANROOM.md`、
> `docs/VPM-PARITY.md`、`docs/VPM-ROLLBACK.md`、`docs/VPM-IMPLEMENTATION-GUIDE.md` §8、§9。
>
> 本阶段处理"整个工程"：备份、复制、换 Unity 版本、旧式 VPM 迁移。
> 所有破坏性动作先备份、先确认、先入回滚仓。

---

## 1. 开始前

```bash
git fetch origin
git switch -c codex/vpm-p6-project-ops origin/main
```

确认 P4 的事务/回滚测试仍绿；记录基线。

---

## 2. 目标

1. 工程 ZIP 备份：排除重型目录、可选排除 VPM 包、压缩级别、进度/取消、hash/记录。
2. 从备份新建工程（Atrium 额外）：绝不覆盖；可选补装包。
3. 复制工程：排除重型目录，目标必须不存在；进度/取消。
4. 更换 Unity 版本：关闭 Unity、备份/确认、原子改版本文件、可回退。
5. 旧式 VPM/Assets 迁移：检测 → 计划 → 备份 → 装新包 → 移旧文件入回滚仓。
6. 所有操作入 `vpm_operation`/`vpm.db`，可追溯。

---

## 3. 明确不做

- 不覆盖现有工程/备份（除非用户明确选择且二次确认；默认拒绝）。
- 不永久删文件；不手写 `.meta`。
- 不写 VCC；不接深链（P7）。
- 不新增核心 `library.db` schema。
- 不把 Unity 工程设置 YAML 拼出来。

---

## 3.5 本阶段实现解剖（ALCOM → Atrium）

**ALCOM 的关键机制（行为观察）**

- 备份和复制复用同一个**文件树收集器**：根目录排除 `Logs`/`obj`/`Temp`，
  任意层级排除 `.git`；备份模式排除整个 `Library`，但保留
  `Library/LastSceneManagerSetup.txt`；可选按 manifest 的 locked 包名排除 `Packages/<name>`；
  跳过符号链接，遍历用约 100 个并发许可。
- 备份是并行压缩：CPU 线程数 + 可用内存软限制两个信号量；支持 Stored/Deflate；
  压缩结果按原索引排序写入 ZIP，保证稳定；进度是"已处理文件数 + 当前文件"；
  **没有内置恢复**。
- 复制复用收集器但 `backup=false`，所以会**包含 Library**；并行复制后加入项目列表。
- 迁移是"检测 → 装现代包 → 事务清 legacy → 可选让 Unity batchmode 自己升级"：
  2019 VRCSDK3 工程映射到对应 SDK 包；Unity 2022 迁移移除旧 XR UPM 包、
  升级 VPM SDK/resolver，再启动 Unity 2022 让 Unity 改工程，而不是手写版本文件。

**Atrium 的独立实现**

- 收集器：备份/复制都排除 `Logs`/`obj`/`Temp`/`.git`/`.atrium-tx`；
  `Library` 默认排除（复制也不带，换取轻量，差异已写对账）；备份保留
  `LastSceneManagerSetup.txt`；可选排除 manifest 管理的包；symlink/junction 跳过并 warning。
- 备份：流式 ZIP，先确认写入库支持 **ZIP64**（工程可能 >4 GiB）；store/fast/normal；
  写 `.part` → finalize → hash → 用读取器回读验证 → rename；进度/取消；
  失败清 `.part`；记录 `vpm_backup`。额外做"从备份新建"（只解到新目录，绝不覆盖）。
- 复制：同一收集器，临时目录 → rename，目标必须不存在；失败临时目录进回滚/垃圾区，
  不永久删除。
- 迁移：先只读检测/报告，不自动迁移；迁移前强制备份或二次确认；
  旧文件全部进回滚仓；只清包声明且位于 `Assets/` 的 legacy；
  Unity 2022 升级优先走 Unity batchmode，不手写 `ProjectSettings.asset`；
  结果分成功/部分成功/失败并列出保留文件。

**施工顺序**

1. 收集器 + 排除规则测试（含 junction/Library/LastScene）。
2. ZIP 写入（先小文件，再 >4 GiB ZIP64）。
3. 进度/取消/`.part` 清理/回读校验。
4. 复制 + 目标冲突处理。
5. 从备份新建/补装。
6. 迁移检测 → 备份 → 复用 P4 事务 → batchmode → 真机矩阵。

**最容易做错**

- 用不支持 ZIP64 的库硬写 >4 GiB → 备份截断/失败。
- 把 Library 打进备份 → 巨大且无意义；但忘保留 LastSceneManagerSetup 会让用户丢上次场景。
- 取消后留下 `.part` 冒充成功；失败没清理。
- 复制到源工程内部 → 递归/爆炸；跟随符号链接 → 复制到工程外。
- 看到旧 Assets 就删 → 误删用户资源；只能按包声明的 legacy 清单。
- 2022 迁移手写 ProjectVersion 但不让 Unity 升级 → 半升级工程。

**详细内容**：`docs/VPM-IMPLEMENTATION-GUIDE.md` §8、§9。

---

## 4. 依赖

- 新增 ZIP 写入依赖（候选 `yazl`，MIT）；读取继续用 `yauzl`。
- **先验证 ZIP64**：工程备份很容易超过 4 GiB；如果候选库不支持 ZIP64，
  就不要用它硬写（会截断/失败）。改用支持 ZIP64 的宽松许可库，或在 7z 可用时用它，
  并给出清晰的"缺少压缩组件"错误。测试要用 >4 GiB 的虚拟/稀疏文件覆盖，
  不能只测小工程。
- 更新 `THIRD-PARTY-NOTICES`。
- 不引入 ALCOM 的备份实现/压缩器。

---

## 5. 文件收集器

新建 `src/main/vpm/projectFiles.ts`，备份/复制共用：

- 输入：工程根、模式（backup/copy）、是否排除 VPM 包。
- 规则（与 ALCOM 行为对齐，但代码自己写）：
  - 根目录排除 `Logs`、`obj`、`Temp`、`.git`、`.atrium-tx`（大小写不敏感）；
  - 任意层级排除 `.git`；
  - 备份模式排除 `Library` 整棵，但**保留** `Library/LastSceneManagerSetup.txt`
    （`Library*` 多 Library 目录也按前缀处理）；
  - 复制模式同样排除 `Library`（保持轻量）；
  - 跳过符号链接/junction/reparse point（记录 warning，不跟随）；
  - 不跳过隐藏文件（除 `.git`），保留用户配置；
  - 可选排除 VPM 包：只排除 `Packages/<id>` 中**由 `vpm-manifest.json` 管理**的包；
    未知/本地/手动包保留；`com.avca.bridge` 可排除（可重装）；
  - 始终保留 `Packages/manifest.json`、`Packages/vpm-manifest.json`、
    `ProjectSettings/ProjectVersion.txt`。
- 返回：文件树（相对路径/绝对路径/大小/是否目录），统计文件数/字节数。
- 限制：文件数/总大小上限；深度上限；长路径；无权限文件 → 失败或 warning（按模式）。
- 不读取文件内容（除了 zip 写入时流式读）。

---

## 6. 备份

新建 `src/main/vpm/projectBackup.ts`。

### 6.1 流程

1. 预检：工程有效、路径合法、目标目录可写、空间足够（估算 + 10%）；
   Unity 运行中默认要求先关闭；用户坚持时给"可能复制到不一致状态"的二次确认
   （备份是只读动作，但 Unity 可能正在写资源）。
2. 生成默认文件名：`<工程名>-<yyyyMMdd-HHmmss>.zip`（sanitize；冲突加 `-2`）。
3. 目标：
   - 默认 `<dataRoot>/backups/<projectSlug>/`；
   - 允许用户另选；C 盘允许但 warning（备份不是缓存硬禁止），优先非 C。
4. 写临时文件 `<目标>.part`；`yazl` 流式写：
   - 压缩：store / fast / normal；
     （`yazl` 若不支持级别，就用 zlib 参数或换一个宽松许可的压缩库；
     不要只放两个选项却假装支持三个级别）
   - 条目路径用 `/`，相对工程根；
   - 目录条目可选，但保留空的 `Assets/`；
   - 进度：已处理文件/字节（节流）；
   - 取消：Abort，删除 `.part`（应用自己的临时文件），不留假成功。
5. finalize → fsync（可用时）→ rename 到最终 `.zip`。
6. 计算 SHA-256；用 `yauzl` 打开并读 central directory 验证可读；记录
   `vpm_backup`（大小、hash、Unity 版本、包数、选项、状态）。
7. 成功返回路径/记录；失败清理 `.part`，保留日志。

### 6.2 排除 VPM 包

- 设置里默认关闭（包含包，备份最完整）。
- 开启时：
  - 只排除 manifest 管理的包目录；
  - 备份里保留 `vpm-manifest.json`；
  - 恢复时提示"包未包含，需要重新安装"，并提供"按 manifest 补装"。
- 不排除未知/本地包（否则用户丢东西）。

### 6.3 备份记录

`vpm.db` v5：

```sql
CREATE TABLE IF NOT EXISTS vpm_backup (
  id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL,
  project_name TEXT NOT NULL,
  source_path TEXT NOT NULL,
  file_path TEXT NOT NULL,
  size INTEGER,
  sha256 TEXT,
  unity_version TEXT,
  package_count INTEGER,
  options_json TEXT,
  status TEXT NOT NULL,          -- running/ok/failed/cancelled
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  error_code TEXT
);
```

- 列表/打开所在文件夹/删除记录（不删文件）。
- 不自动清理旧备份。

### 6.4 从备份新建（额外）

- 选择 zip → 校验（zip-slip/大小/条目）→ 解压到新的临时目录；
- 必须有 `ProjectSettings/ProjectVersion.txt`；否则不是有效工程；
- 目标目录必须不存在；最终 rename；
- 加入工程列表；
- 如果备份排除了 VPM 包：读 `vpm-manifest.json`，提示并可选补装（走 P4）；
- 绝不覆盖现有工程；失败临时目录入回滚/垃圾区。

---

## 7. 复制工程

新建 `src/main/vpm/projectCopy.ts`：

- 使用同一个文件收集器（排除 `Library`/`Logs`/`obj`/`Temp`/`.git`/`.atrium-tx`/symlink）。
- Unity 运行中默认拒绝复制（文件可能正在写）；先关闭再复制。
- 目标：用户选父目录 + 新名称；最终目录必须不存在；
  父目录不能在源工程内/素材库内/应用安装目录内（避免递归复制）。
- 复制到 `<parent>/.atrium-copy-<op>`（同卷），完成后 rename；
- 进度/取消；空间预检；保留时间戳（可选）；
- 失败：临时目录移入回滚/垃圾区，不删用户文件；
- 成功后 `upsertProject`，扫描 VPM；在列表里出现；
- 不自动启动 Unity；不修改副本内容。
- 符号链接/junction 跳过并 warning；不跟随，避免复制出工程外的东西。

---

## 8. 更换 Unity 版本

新建 `src/main/vpm/unityVersionChange.ts`：

- 前置：
  - 工程未运行（现有三路 + 锁文件）；
  - 目标编辑器已安装（`vpm_unity_install`）；
  - 目标版本格式合法；
  - 建议/要求备份（至少默认勾选"先备份"；用户可取消但二次确认）。
- 流程：
  1. 备份工程（P6）；如果用户拒绝，二次确认风险；
  2. 读旧 `ProjectVersion.txt`，记录 old/new/revision；
  3. 原子写新文件（保留 `m_EditorVersionWithRevision`，若目标 revision 已知）；
  4. 写 operation（kind=unity-version）；
  5. 可选启动新 Unity；Unity 首次打开会升级资源。
- 回退：
  - 提供"恢复旧版本文件"的操作（从备份/记录），但**不自动降级 Unity 资源**；
  - 大版本升级/降级要明确警告（可能不可逆）；
  - 不修改 `Packages/manifest.json`。
- 不自动安装 Unity 编辑器/模块。

---

## 9. 旧式 VPM / Assets 迁移

新建 `src/main/vpm/legacyMigration.ts`。

### 9.1 检测（可读）

- 用 P2 的报告：
  - `Assets/**/package.json`（深度/数量限制）；
  - 已装包的 `legacyFolders`/`legacyFiles`/`legacyPackages`；
  - 旧工程的 `Assets/VRCSDK`、`Assets/Udon` 等常见目录只作为**提示**，
    不写死为唯一判据（避免误删）。
- 输出候选：包名/版本、Assets 路径、匹配方式（package.json/legacy path/GUID/包 ID）、
  是否有对应仓库版本、风险。
- GUID 级：
  - 仅在迁移确认后扫描 `Assets/**/*.meta` 的 `guid:`，匹配包清单里声明的 GUID；
  - 限制扫描数量/时间；不跟随 symlink；
  - 不匹配 → 不删。
- 不做任何写操作。

### 9.2 迁移计划

1. 必须能解析到对应现代包版本；找不到仓库版本但 `Assets` 里的包有合法
   `package.json` 时，可作为 `local` 来源迁移（P4 的 `PreparedPackage.local`）。
   两者都没有 → `legacyNoCandidate`，只报告，不动文件。
2. 先生成备份（强制，除非用户明确承担风险并二次确认）。
3. 安装现代包到 `Packages/`（P4 事务）。
4. 成功后，把旧 Assets 文件/目录（连同 `.meta`）移入回滚仓：
   - 双重校验：允许列表 + 在 `Assets/` 下 + 不是 `Assets` 根；
   - 路径级优先；GUID 级只删匹配项；
   - 不删未匹配/不确定的内容；
   - 失败 → 保留旧文件，warning；不回滚已装好的新包。
5. 写 manifest（P4 已做）；记录迁移 operation（kind=legacy-migration）。
6. 结果：成功/部分成功/失败；列出移到回滚仓的文件数、仍保留的文件数。
7. 提供撤销（如果安全）：把旧文件移回、卸新包（走 P4 事务）。

### 9.3 Unity 2022 迁移（部分）

- 检测 Unity < 2022.3 + VRChat SDK 的旧工程。
- 这是一个**引导流程**，不是无条件一键：
  - 备份；
  - 选择目标 Unity 2022.3.22f1；
  - 解析/安装兼容 SDK 版本；
  - 更新 `ProjectVersion.txt`；
  - 清理旧 Assets；
  - 用真 Unity 打开验证。
- 如果无法覆盖所有 SDK 版本/场景，标记"部分"，在 UI/文档写清；
  不假装所有旧工程都能自动迁移。
- 不复制 ALCOM 的迁移特例/资源；只依据公开包元数据和实际测试。

---

## 10. UI

- 工程详情 → 更多：
  - 备份工程（主操作在备份对话框）
  - 复制工程
  - 更换 Unity 版本
  - 迁移旧式包（仅检测到候选时显示）
- 备份对话框：
  - 目标路径、压缩级别、排除 VPM 包、进度/取消；
  - 成功：路径/大小/hash + "打开所在文件夹"。
- 备份历史：
  - 列表（时间/大小/选项/状态）；"从备份新建"；打开文件夹；移除记录。
- 复制：父目录/新名称/进度/取消；成功后进入新工程。
- 换版本：当前/目标编辑器、备份勾选、警告、确认。
- 迁移向导：
  - 检测结果 → 计划（装什么/移什么/保留什么）→ 备份 → 执行 → 结果（成功/部分/失败）。
  - 主按钮每一步只有一个；危险说明清楚。
- 所有进度有拉取式状态（操作记录），刷新后能恢复。
- 三语文案；截图 100%/125%。

---

## 11. 测试

新增：

```text
tests/vpm/project-files.spec.ts
tests/vpm/backup.spec.ts
tests/vpm/backup-restore.spec.ts
tests/vpm/project-copy.spec.ts
tests/vpm/unity-version-change.spec.ts
tests/vpm/legacy-detect.spec.ts
tests/vpm/legacy-migrate.spec.ts
tests/vpm/db-v5.spec.ts
```

覆盖：

1. 收集器：排除规则、Library 例外、`.git`/`.atrium-tx`、symlink/junction、可选排除 VPM 包、
   未知包保留、长路径、非 UTF-8/无权限、大小统计。
2. 备份：store/fast/normal、内容正确、可解压、hash、取消无假文件、磁盘不足、目标冲突；
   **>4 GiB 的 ZIP64 场景**（虚拟/稀疏文件，避免真写满盘）。
3. 恢复：zip-slip、无效工程、目标已存在、排除包后补装、失败清理。
4. 复制：排除规则、目标不存在、进度、取消、符号链接、失败清理。
5. 换版本：运行中拒绝、目标未安装、备份、原子写、revision、回退。
6. 旧式检测：package.json/legacy path/GUID/包 ID、无候选、超时/截断。
7. 迁移：备份强制、装新包、旧文件入回滚仓、未匹配保留、失败不回滚新包、
   撤销安全条件。
8. 真 Unity：
   - 备份一个沙盒工程 → 从备份新建 → 打开；
   - 复制 → 打开；
   - 换 Unity 版本 → 打开（Unity 升级提示可接受）；
   - 旧式 Assets 测试夹具（用 Unity 生成 meta）→ 迁移 → 打开。
9. 无永久删除：断言回滚仓有副本；`Assets` 旧文件移除前已复制/校验。
10. 核心 schema 不变；DB v4→v5 迁移。

---

## 12. 手工验收（沙盒）

- 备份 3 种压缩级别；解压检查；取消。
- 从备份新建；打开 Unity。
- 复制；打开 Unity；确认目标未覆盖。
- 换版本；打开；回退版本文件。
- 旧式包夹具迁移；检查回滚仓；打开 Unity。
- 大工程/长路径/中文路径/空格路径。
- 截图。

---

## 13. 完成定义

- [ ] 备份/恢复/复制/换版本/旧式迁移可用。
- [ ] 所有删除/移动先入回滚仓；无永久删用户文件。
- [ ] 备份可解压验证；取消/失败不留假成功。
- [ ] 旧式迁移有备份/计划/部分成功说明；Unity 2022 迁移标记部分或完整。
- [ ] 真 Unity 沙盒通过。
- [ ] 全量测试/类型/构建通过；净室检查表；PR 合并；安装版更新。
