# VPM 实现解剖与施工指南

> 这份文件回答的是：**ALCOM 每个功能内部大概是怎么运转的、我们怎样用自己的代码做出来。**
>
> 它和另外几份文档的分工：
>
> - `VPM-MERGE-PLAN.md`：为什么做、分几个阶段、验收边界。
> - `VPM-CLEANROOM.md`：哪些能看、哪些不能抄。
> - `VPM-PARITY.md`：功能对账。
> - `VPM-ARCHITECTURE.md`：模块边界、依赖方向、数据所有权、可维护性标准。
> - `VPM-TASKS.md` + `prompts/tasks/`：一次执行一张的小任务卡。
> - **本文件**：实现机制、数据流、施工顺序、容易做错的地方。
>
> 所有"ALCOM 怎么做"都是**行为/架构观察**，不是代码转写。实现时必须关掉 ALCOM 源码，
> 按本文件的行为规格和公开协议自己写。发现自己在"翻译"，回到 `VPM-CLEANROOM.md` §4。
>
> 各节末尾的“对应提示词”指阶段规格章节；实际一次执行看 `docs/prompts/tasks/` 的任务卡。

---

## 0. 先看一张总图

ALCOM 的实质是三层：

```text
React UI（项目页/包页/模板页/设置）
        │  Tauri command（JSON 参数、进度 channel、错误）
        ▼
Environment（设置、VCC DB、仓库缓存、包集合、安装器）
        │
        ▼
vrc-get-vpm（版本/范围、vpm-manifest、UnityProject、解析器、事务）
```

Atrium 对应关系：

```text
React UI（懒加载的 renderer/vpm）
        │  IPC {ok,data|error} + 进度事件 + 拉取式状态
        ▼
main/vpm（仓库、HTTP、缓存、工程、事务、模板、VCC 导入）
        │
        ▼
shared/vpm（版本/范围/Unity 版本/manifest/解析器/计划）
        │
        ▼
vpm.db + 非 C 数据根 + Unity 工程文件
```

关键区别：

| 主题 | ALCOM | Atrium |
|---|---|---|
| 工程/仓库真相 | 文件 + VCC LiteDB + `Repos/*.json` | 文件 + 自己的 `vpm.db`；VCC 只读 |
| 包缓存 | `Repos/<包名>/vrc-get-<名>-<版本>.zip` + `.sha256` | 非 C 数据根，按 SHA-256 内容寻址 |
| 事务临时 | 工程 `Temp/vrc-get/<uuid>` | 工程根 `.atrium-tx/<op>`（避免 Unity 清 Temp） |
| 旧文件 | 事务里临时移走，成功后删除 | 回滚仓保留副本，不永久删 |
| 解析 | 确定性贪心 + 局部修复 | 同目标，独立实现；冲突必须解释 |
| VCC | 读写 `settings.json` + `vcc.liteDb` | 只读 `settings.json`；不写 LiteDB |
| 更新 | Tauri 签名更新器 | 手动检查 + SHA-256 + 用户点安装 |
| 平台 | Win/mac/Linux | 首发 Windows |

---

## 1. 仓库与包集合

### 1.1 ALCOM 的机制

- 预置两个仓库：official 和 curated；用户仓库来自 VCC `settings.json` 的 `userRepos`，
  也支持本地路径（local repo）。
- 缓存在环境目录的 `Repos/` 下，一个仓库一个 JSON 文件；启动时**先读缓存**，
  有网络再按 ETag 更新。更新是并行的；304 或失败时保留旧缓存。
- 每个仓库有 URL、id、name、headers；仓库 JSON 的包版本对象带显示名、描述、Unity 最低版本、
  `zipSHA256`、`vpmDependencies`、legacy 路径、yanked 等字段。
- 包集合把**所有远程仓库 + 本地用户包**合并成一个可查询集合：
  - 查单包时按版本选最高；
  - curated 包通过仓库 id 识别；
  - 用户包是本地目录里的 `package.json`；
  - 同版本多来源不做严格优先级（最终取最高版本）。
- 包下载缓存按"包名/版本"命名，旁边写 `.sha256`；下次使用先校验缓存 hash。

### 1.2 Atrium 怎么独立实现

- `vpm_repo` + `vpm_repo_package` 两张表：
  - 仓库表存 URL/名称/启用/排序/ETag/上次成功/错误/加密头；
  - 包版本表存每个版本的 manifest JSON（**剥掉 headers 明文**）、hash、URL、Unity 下限、
    yanked/hidden 标记。
- 刷新一个仓库 = 拉 JSON → 校验 → **事务替换**该仓库的包行 → 更新 ETag；
  失败绝不清空旧行。
- 包集合查询 = SQL + 内存排序：
  - 包名/显示名/关键词/别名搜索；
  - 每个包取满足条件的最高版本；
  - 同版本多仓库时，记录来源；hash 不同直接标冲突，不静默选。
- 缓存独立用内容寻址：`<dataRoot>/cache/packages/<ab>/<sha256>.zip`；
  仓库缓存只用于元数据，包本体不放 C。
- 仓库级/包级 headers 都加密；P1 先剥掉包级头，P7 再补加密存储。

### 1.3 施工顺序

1. 先写纯解析器（仓库 JSON/包版本字段），用假 JSON 测。
2. 再写 DB 表和事务替换，测"刷新失败保留旧数据"。
3. 再写 HTTP（ETag/304/大小/超时/重定向）和手动刷新。
4. 最后做 UI；先只读目录，不接装包。

### 1.4 容易做错

- 失败时先清空再插入 → 用户断网后目录变空。必须"先解析成功，再事务替换"。
- 把 `zipSHA256` 当可选 → 安装阶段无法保证完整性。没有 hash 的版本只能展示，不能装。
- 把 headers 写进 `manifest_json` → token 明文落库。解析后立即剥离。
- 同版本多来源直接取最后一个 → 来源/hash 不可解释。必须记录并冲突提示。

### 1.5 对应提示词

P1 的"仓库/HTTP/vpm.db v1"；P7 的"仓库治理/头/导入导出"。

---

## 2. 版本、范围与 manifest

### 2.1 ALCOM 的机制

- `Version` 是 SemVer（含 prerelease/build）；`DependencyRange` 区分"单个版本"和"范围"；
  `VersionRange` 支持比较、交集、预发布判断。
- `PartialUnityVersion` 表示 Unity 最低版本（如 `2022.3`），和完整编辑器版本分开。
- `VersionSelector` 是"在候选里挑哪个"：
  - latest/range 会过滤 yanked、Unity 不兼容；
  - 预发布按策略允许/拒绝；
  - specific（精确版本）是直接等值判断。
- `vpm-manifest.json` 形状：
  - `dependencies`: 包名 → `{ version: <范围> }`（用户/根请求）；
  - `locked`: 包名 → `{ version: <精确>, dependencies?: { 包名: <范围> } }`
    （实际安装快照）；
  - 未知字段 ALCOM 的结构会丢弃；Atrium 必须保留。
- 安装后：根请求写回 `dependencies`；所有实际安装包写 `locked`；
  传递依赖通常只进 `locked`，不强行改根 `dependencies`。

### 2.2 Atrium 怎么独立实现

- 用 `semver` 做语法/比较底座，自己写 VPM 适配层：
  - 单版本 = 精确；
  - 支持 `^ ~ >= <= > < x * || -`；
  - 预发布、build、部分版本、Unity 变体单独测。
- Unity 版本独立解析：`YYYY.MINOR.PATCH[abfp]N`，允许部分版本；`c1` 保留显示，
  兼容比较按基础版本。
- manifest 解析：
  - 接受对象值；兼容裸字符串但写回对象；
  - 保留未知顶层/条目字段；
  - 接受 BOM；坏 JSON 给 code；
  - 序列化稳定、2 空格、LF、末尾换行。
- manifest 写入只在 P4 事务里做，最后一步、原子替换。

### 2.3 施工顺序

1. 版本/范围纯函数 + 表驱动测试。
2. Unity 版本解析/比较。
3. manifest 解析/序列化/未知字段保留。
4. 再让解析器和事务使用它。

### 2.4 容易做错

- 把 `dependencies` 当裸字符串写回 → VPM 读不了。值是对象。
- 把未知字段丢掉 → 用户/其他工具的数据被破坏。
- 把范围当精确版本 → 升级/锁定行为全错。
- 把 yanked 精确版本当成永远可选 → 与"新安装不选 yanked"冲突；必须写清策略。

### 2.5 对应提示词

P1 的"纯逻辑核心"；P3 的"候选选择"；P4 的"manifest 最后写"。

---

## 3. 依赖解析器

### 3.1 ALCOM 的机制（行为/架构观察）

- 解析上下文维护每个包的：
  - 当前选中的包（using）和版本（current）；
  - 所有来源对它的要求（requirements，根来源用空字符串）；
  - 它自己依赖的包集合；
  - 是否 legacy、是否预发布、是否被本次请求触及。
- 待处理包用队列：
  - 本次显式请求/根包有"强制"优先级；
  - 后续依赖进 pending 队列；同名包去重，后加入的替换先加入的。
- 解析从"根依赖 + 锁定包 + 未锁定包信息"开始；
  处理一个包时，把它自己的依赖要求写进其他包的 requirements，再决定要不要装。
- 决定"要不要装"：
  - legacy 包、用户显式解锁的包跳过；
  - 队列里已有满足范围的版本 → 不重装；
  - 已安装版本满足范围 → 不重装；
  - 否则找一个满足范围/Unity/预发布策略的最高版本。
- 候选查找会根据当前包是否预发布、是否允许预发布，按"稳定优先/允许预发布"多轮 fallback。
- 最后汇总：
  - 选中版本无法满足某些 requirements → 冲突（附来源）；
  - 找不到候选 → 缺失；
  - 还找出 legacy 包列表。
- **它不做全局回溯**：早期选择导致后面冲突时，报告冲突，而不是换一套组合。
- 删除/不再需要的依赖靠"从根可达性"做 mark-and-sweep（在 pending changes 里）。

### 3.2 Atrium 怎么独立实现

我们采用"约束表 + 工作队列 + 局部修复"：

```text
constraints: package -> [{source, range}]
selected:    package -> version
queue:       受影响的包
while queue not empty and rounds < limit:
  pkg = queue.pop()
  candidate = highest version satisfying constraints[pkg],
              not yanked (unless already selected),
              unity-compatible, prerelease policy,
              not protected/legacy-conflict,
              repo order/hash rules
  if none: record conflict/missing; continue
  if candidate != selected[pkg]:
     remove old candidate's dependency constraints
     selected[pkg] = candidate
     add new candidate's dependency constraints
     enqueue affected packages
```

收敛后：
- 根包/被选包的依赖都必须有选择；
- 任何冲突/缺失 → `blocked=true`，但计划仍展示原因；
- 从根可达集合计算"不再需要"的包；
- 不移除 unlisted（Packages 里存在但 manifest 没有）和受保护包。

锁定版本是**偏好**：满足当前约束且没有升级请求就保留；约束变化/显式升级时重新选最高。

### 3.3 施工顺序

1. 先用合成包对象写纯解析器，不接 DB/工程。
2. 写计划类型/排序/解释字段。
3. 接工程 manifest + repo 目录，做只读预览。
4. 用真工程对比锁定/升级行为；确认差异写进观察日志。
5. 最后才让 P4 执行计划。

### 3.4 容易做错

- 把"最高版本"直接当"最高兼容版本" → 忽略 Unity/预发布/冲突。
- 不记录 requirements 来源 → 冲突时只能报"无解"，用户不知道为什么。
- 遇到冲突就自动降级/换包 → 用户无法预测；ALCOM 也不这样做。
- 删除所有不可达包 → 误删用户手动包。必须排除 unlisted/protected。

### 3.5 对应提示词

P3 全篇；P4 只执行 P3 的 Plan。

---

## 4. 安装事务

### 4.1 ALCOM 的机制（行为观察）

1. 根据请求生成 `PendingProjectChanges`：要装/要卸/要删 legacy 的计划。
2. 在工程 `Temp/vrc-get/<uuid>/` 下建临时目录。
3. 先把要装的包解压到临时目录：
   - 远程包从缓存/下载 zip；
   - 本地包直接递归复制；
   - 解压前清目标临时目录。
4. 把要卸载/替换的旧包目录移到临时目录。
5. 把新包目录移入 `Packages/<id>`。
6. 更新内存里的 `vpm-manifest`（dependencies/locked），最后保存 manifest。
7. 任何一步失败：反向移回旧包、移走新包；manifest 还没写就不用恢复；
   回滚失败时保留临时目录并报详细错误（现场可人工恢复）。
8. 成功后：清理临时目录；按计划移除旧 Assets 资源（legacy 路径/文件）。
9. 包缓存：
   - `Repos/<包名>/vrc-get-<包名>-<版本>.zip` + `.sha256`；
   - 命中时校验文件 hash；远程 hash 不匹配就删缓存并拒绝；
   - 下载时仓库头 + 包头合并（包头覆盖同名仓库头）。
10. 旧 Assets 清理：
    - 只处理包清单声明的 legacy 路径/文件；
    - 路径必须在 `Assets/` 或 `Packages/` 下、组件合法、不是绝对路径；
    - 先按路径查，路径不匹配再用 GUID 查 `.meta`；
    - UdonSharp 目录额外校验 GUID。

### 4.2 Atrium 怎么独立实现（更保守）

我们保留同样的"解压 → 移旧 → 移新 → manifest 最后写"顺序，但增加：

- 事务目录：`<project>/.atrium-tx/<op>/{install,trash}`（同卷，原子 rename；
  不用 `Temp`，避免 Unity 打开时清掉现场）。
- 操作记录：`vpm_operation` + `vpm_operation_file` + journal；
  每步先写 journal；崩溃后按提交点恢复。
- 回滚仓：成功后把 `trash` 复制到 `<dataRoot>/vault/<projectSlug>/<op>/`，
  逐文件校验，才清临时副本；失败保留，可重试。
- 只清理 `Assets/` 下的 legacy（用户硬约束）；`Packages/` 下的只报告，不自动删。
- Unity 运行中拒绝写；manifest 外部改动拒绝；磁盘空间预检；受保护包过滤。
- 支持 zip 和 local 两种来源（P4 抽象，P7 接本地包）。
- 撤销：只允许最后一次、工程未变、回滚仓完整；反向计划再走一次事务。

### 4.3 施工顺序

1. 缓存/下载/hash（先不碰工程）。
2. 解压安全（zip-slip/大小/符号链接/保留名）。
3. 纯事务：在临时工程里移目录/写 manifest，失败注入。
4. journal/恢复。
5. 回滚仓/撤销。
6. UI 购物车/变更单/进度。
7. 真 Unity 沙盒。

### 4.4 必须的失败注入点

下载中断、hash 不匹配、解压失败、移旧失败、移新失败、manifest 写失败、
legacy 清理失败、vault 归档失败、进程崩溃在每一步之后。
每个点都要能回答：工程是否可用、旧包在哪、manifest 是什么、用户看到什么。

### 4.5 对应提示词

P4 全篇；P6 的迁移也复用同一事务。

---

## 5. 工程读取（只读）

### 5.1 ALCOM 的机制

- `UnityProject::load` 同时读：
  - `Packages/vpm-manifest.json`（VPM 账）；
  - `Packages/manifest.json`（UPM 账，保留）；
  - `ProjectSettings/ProjectVersion.txt`（Unity 版本 + revision）；
  - `Packages/*/package.json`：目录名、包名、版本。
- 通过 manifest 的 `locked` 判断哪些目录是"已安装"；其余是 unlocked/本地包。
- 旧工程/旧 vrc-get 的范围写法有一个兼容修正；Atrium 不需要复制这个特例，
  但读 manifest 要容忍常见历史写法。
- 旧 Assets 检测：包清单的 legacy 路径/文件 + GUID 反查。

### 5.2 Atrium 怎么独立实现

- 只读读取，绝不写工程。
- `projectKey` = 归一化路径；`projectSlug` = 安全短名；VPM DB 用 key。
- 读 manifest 用 P1 的解析器；坏 JSON 只警告，不影响包目录展示。
- 扫描 `Packages/` 直接子目录，读 `package.json`；跳过 symlink/junction。
- 状态：ok/missing/unlisted/mismatch/protected/legacy。
- 缓存到 `vpm_project`/`vpm_project_package`，可随时重建；文件仍是真相。
- 旧 Assets 报告只读，不删；路径/深度/时间限制。

### 5.3 施工顺序

1. 读 ProjectVersion + manifest + Packages。
2. 包状态对照。
3. 旧式报告。
4. 接现有 Project 页（只读）。
5. 测"扫描前后工程文件 mtime/hash 不变"。

### 5.4 容易做错

- 把 `Packages/` 里所有目录都当 VPM 包 → UPM/本地包被误报；用 manifest 区分。
- 扫描时跟随 junction → 扫到工程外/死循环。
- 写 manifest 修正格式 → 本阶段是只读，不能写。
- 用路径当唯一身份但不归一大小写 → Windows 上重复工程。

### 5.5 对应提示词

P2 全篇。

---

## 6. Unity 发现与启动

### 6.1 ALCOM 的机制

- Unity Hub 安装发现（行为观察）：
  - 扫描系统级 Hub 编辑器目录；
  - 读 `secondaryInstallPath.json` 的自定义安装位置；
  - 读 `editors-v2.json` 的 located editors（location 可能是字符串或数组，version/architecture）；
  - 目录名按 `版本+abfp+c` 规则筛选，检查编辑器可执行文件存在；
  - 从编辑器可执行文件读版本/架构；
  - 磁盘扫描结果优先于 `editors-v2.json`；按"版本+架构"去重；
  - 架构未知按 x86_64 处理，和 Hub 的去重行为一致。
- VCC LiteDB 的 `unityVersions` 还存手动添加的编辑器；
  选择"最合适版本"时按 exact → revision → minor → major 逐级放宽。
- 启动 Unity：
  - 先判断是否已在运行，运行中不重复启动；
  - Linux/macOS 检查 noexec（Windows 无此项）；
  - 读工程自定义参数；没有就用默认参数；
  - 标记 opening，再 spawn `Unity -projectPath <path> ...`，detached；
  - 失败清理 opening 状态；
  - 可选把已打开的 Unity 窗口顶到前台（1.1.9 新功能，不在 1.1.8 目标）。
- 版本迁移：2019 工程走 VPM 迁移/2022 迁移，再用 Unity 2022 batchmode
  `-quit -batchmode -ignorecompilererrors -logFile - -projectPath` 让 Unity 自己升级工程。

### 6.2 Atrium 怎么独立实现

- Windows 首发：
  - 读 Hub 的 `editors-v2.json`、`secondaryInstallPath.json`、`settings.json`；
  - 扫描默认/自定义安装根，目录名/版本/架构校验；
  - 手动添加 exe，版本无法识别时让用户确认；
  - 合并去重，missing 只标记。
- 按工程版本匹配编辑器：exact → revision → minor → major（与 ALCOM 思路一致，
  但实现独立、结果可解释）。
- 启动用 `spawn(exe, argsArray, {detached, stdio:'ignore'})`，绝不拼 shell；
  已在运行不重复启动。
- 包操作要求 Unity 关闭；启动本身是只读动作。
- **启动前绑定导入目标**：通过核心联动端口把该工程设为当前目标，再 spawn；
  启动失败清除。目标绑定不是工程写入，但决定双击素材进哪个工程。
- 多 Unity 实例：启动绑定优先，用户显式选择覆盖；关闭/移除清除。
- 不实现 Linux noexec、macOS 窗口前台（P8 可选）。

### 6.3 施工顺序

1. Hub 文件 fixture + 解析。
2. 目录扫描/版本/架构。
3. 手动添加 + 去重。
4. 工程版本匹配。
5. 启动（spawn/参数/错误）。
6. 真机多版本验证。

### 6.4 容易做错

- 只读 `editors-v2.json`，不扫描磁盘 → 手动安装/旧 Hub 找不到。
- 版本/架构不去重 → 同一编辑器两条。
- 启动 Unity 用 shell 拼字符串 → 路径空格/引号注入。
- 运行中重复启动 → 两个 Unity 抢工程锁。
- 启动成功但没绑定导入目标 → 双击素材弹选择器/投到旧工程；这才是“合并了但没联动”。

### 6.5 对应提示词

P2 的 Unity 发现；P5 的启动/版本匹配；P6 的版本迁移。

---

## 7. 工程创建与模板

### 7.1 ALCOM 的机制（行为观察）

- 内置模板按 Unity 版本打包成 tar.gz（角色/世界），里面有完整工程骨架/设置/资源；
  空白模板只建 `Assets`、`ProjectSettings`、`Packages` 和 `ProjectVersion.txt`。
- 自定义模板：
  - VCC 模板是 `Templates/<name>` 文件夹，递归复制；
  - `.alcomtemplate` 带 `base`（继承）、`vpmDependencies`、`unityPackages`；
    解析时递归 base，依赖范围取交集，附件追加。
- 建工程顺序：
  1. 目标目录必须不存在；创建；
  2. 解包 base（内置 tar.gz / 自定义文件夹 / 空白骨架）；
  3. 导入 unitypackage 附件；
  4. 更新工程名/项目 GUID（ProjectSettings.asset）；
  5. 加入依赖到初始 manifest；
  6. 解析并安装依赖；
  7. 把工程加入 VCC 项目列表。
- unitypackage 导入：
  - 解到 `Library/.temp-dir.<uuid>/<guid>/`；
  - 读每个 GUID 目录的 `pathname`、`asset`、`asset.meta`；
  - 复制 asset 和 meta 到 `pathname` 指定的位置；
  - 忽略 preview；
  - 清理临时目录。
- 模板继承的依赖合并是"范围交集"（不是简单覆盖）；附件是追加。

### 7.2 Atrium 怎么独立实现

- 不复制 ALCOM 的内置模板/资产/ProjectSettings。
- 自有 `.atriumtemplate`（ZIP + `template.json` + `files/`）：
  - base 继承、依赖合并、附件追加、循环/深度检测；
  - 内置三个原创模板：空白/角色/世界（只含依赖元数据，不含美术资源）。
- 建工程：
  - 在父目录隐藏临时目录 `.atrium-create-<op>` 中完成骨架/附件；
  - 写 `ProjectVersion.txt`；不写 `ProjectSettings.asset` YAML；
  - 附件用我们自己的 unitypackage 读取器，只搬包内 `.meta`；
  - 初始 `vpm-manifest` 写依赖；
  - 临时目录 rename 成最终目录（目标必须不存在）；
  - 入列表后，复用 P4 事务安装依赖；
  - 失败保留工程/临时目录，不永久删；给重试/回滚。
- 工程名由文件夹名决定；不手写 Unity YAML。角色/世界模板的推荐设置差异标"部分"。

### 7.3 施工顺序

1. 模板格式/校验/继承纯逻辑。
2. unitypackage 读取器（自造 tar.gz 夹具）。
3. 工程骨架/临时目录/rename。
4. 初始 manifest + P4 装依赖。
5. 启动 Unity/真机打开。
6. 模板 UI/编辑器。

### 7.4 容易做错

- 手写 `.meta` → Unity 不认 GUID，资源看似铺了但引用全断。
- 在最终目录里直接建再失败 → 留下半工程；用临时目录。
- 依赖范围简单覆盖 → base 的约束丢失；应该取交集/合并。
- 把 unitypackage 的 preview 当资源导入 → 垃圾文件。
- 复制 ALCOM 的模板资产 → 版权问题；只做依赖预设。

### 7.5 对应提示词

P5 全篇；P7 的外部模板导入。

---

## 8. 备份与复制

### 8.1 ALCOM 的机制（行为观察）

- 文件树收集器：
  - 根目录排除 `Logs`、`obj`、`Temp`；任意层级排除 `.git`；
  - 备份模式排除整个 `Library`，但保留 `Library/LastSceneManagerSetup.txt`
    （多 Library 目录按前缀处理）；
  - 可选排除 VPM 包：用 manifest 的 locked 包名排除 `Packages/<name>`；
  - 跳过符号链接；目录遍历用约 100 个并发许可。
- 备份：
  - 文件树收集后统计文件数；
  - 并行压缩：CPU 线程数 + 可用内存软限制（约 80% 空闲内存）两个信号量；
  - 支持 Stored 和 Deflate（deflate 级别）；
  - 压缩结果按原索引排序写入 ZIP，保证稳定；
  - 进度是"已处理文件数 + 当前文件"；
  - 没有内置恢复。
- 复制：
  - 复用同一个收集器，但 `backup=false`，所以**包含 Library**；
  - 并行复制（CPU×2 并发）；
  - 新目录由调用方创建，复制完加入项目列表。

### 8.2 Atrium 怎么独立实现

- 收集器：
  - 备份/复制都排除 `Logs`/`obj`/`Temp`/`.git`/`.atrium-tx`；
  - `Library` 默认排除（复制也不带，换取轻量；与 ALCOM 有差异，已写对账）；
  - 备份保留 `Library/LastSceneManagerSetup.txt`；
  - 可选排除 manifest 管理的 VPM 包；
  - symlink/junction 跳过并 warning。
- 备份：
  - 流式 ZIP；先验证写入库支持 ZIP64（工程可能 >4 GiB）；
  - store/fast/normal（库不支持就如实减少选项，不假装）；
  - 写 `.part` → finalize → hash → 用读取器验证 → rename；
  - 进度/取消；失败清 `.part`；记录 `vpm_backup`。
- 复制：
  - 同收集器，临时目录 → rename；目标不存在；进度/取消；
  - 失败临时目录入回滚/垃圾区。
- 额外：从备份新建工程（只解到新目录，绝不覆盖）；可选补装包。

### 8.3 施工顺序

1. 收集器 + 排除规则测试。
2. ZIP 写入（先小文件，再 ZIP64）。
3. 进度/取消/失败清理。
4. 复制。
5. 恢复/补装。
6. 真 Unity 打开。

### 8.4 容易做错

- 用不支持 ZIP64 的库硬写 >4 GiB → 备份截断/失败。
- 把 Library 打进备份 → 巨大且无意义；但忘保留 LastSceneManagerSetup 会让用户丢上次场景。
- 取消后留下 `.part` 冒充成功。
- 复制到源工程内部 → 递归/爆炸。
- 符号链接跟随 → 复制到工程外。

### 8.5 对应提示词

P6 全篇。

---

## 9. 迁移

### 9.1 ALCOM 的机制（行为观察）

**旧式 VPM/Assets 迁移**

- 只处理 2019 的 legacy VRCSDK3 角色/世界工程；其他类型拒绝。
- 安装最新的 `com.vrchat.avatars` 或 `com.vrchat.worlds`。
- 对 curated 包：先尝试把候选包加入请求，检查它声明的 legacy 资产是否真的存在；
  只迁移"确实有旧资产"的包。
- 通过正常事务安装新包，旧 Assets 资源由事务的 legacy 清理步骤移除。
- 迁移后把 `ProjectSettings.asset` 的输入系统设置改成推荐值
  （新输入系统后端开启、旧输入管理器关闭）。
- 只支持特定旧工程形态；不是所有旧工程都能一键迁移。

**Unity 2022 迁移**

- 只处理 Unity 2019 工程；如果没检测到 VPM VRCSDK 只警告。
- 从 UPM manifest 移除旧的 XR 包（Oculus/OpenVR standalone）。
- 升级已锁定的 `com.vrchat.base/avatars/worlds/core.vpm-resolver` 到 2022 兼容版本。
- 通过事务装包。
- 然后用 Unity 2022 batchmode 启动工程，让 Unity 自己升级资源/版本文件
  （`-quit -batchmode -ignorecompilererrors -logFile - -projectPath`）。
- UI 支持先复制工程再迁移，降低风险。

### 9.2 Atrium 怎么独立实现

- 先检测/报告，不自动迁移。
- 迁移前强制备份（或明确二次确认），所有旧文件进回滚仓。
- VPM legacy：
  - 识别 2019 VRCSDK3 形态；映射到现代包；
  - 用 P4 事务安装；旧 Assets 只清允许列表/Assets 下，GUID 级只在迁移时扫描；
  - 结果分"成功/部分成功/失败"，列出仍保留的文件。
- Unity 2022：
  - 只对 2019 工程提供；备份；
  - 移除旧 XR UPM 依赖、升级 VPM SDK/resolver；
  - 写入/启动目标 Unity 2022.3.22f1；优先用 Unity batchmode 升级，而不是手写版本文件；
  - 真 Unity 验证；覆盖不了的场景标"部分"。
- 不复制 ALCOM 的迁移特例/文案；只按公开包元数据和实际测试实现。

### 9.3 施工顺序

1. 检测报告（只读）。
2. 备份/计划/确认。
3. 复用 P4 事务装包/清旧文件。
4. Unity batchmode 升级。
5. 真机矩阵。
6. 失败/部分成功的可读报告。

### 9.4 容易做错

- 看到旧 Assets 就删 → 误删用户资源。只按包声明的 legacy 清单。
- 在 2022 迁移里手写 ProjectVersion 但不让 Unity 升级 → 工程可能半升级。
- 没有备份就迁移 → 不可逆。
- 宣称支持所有旧工程 → 只支持验证过的形态。

### 9.5 对应提示词

P6 的旧式迁移/Unity 版本；P9 的真机矩阵。

---

## 10. VCC 互操作

### 10.1 ALCOM 的机制（行为观察）

- 共享目录：`%LOCALAPPDATA%\VRChatCreatorCompanion`（Windows）。
- `settings.json` 里有：
  - `userProjects`（项目列表）；
  - `userRepos`（URL/本地路径/名称/ID/headers）；
  - `userPackageFolders`；
  - `unityEditors` / `preferredUnityEditors`；
  - `defaultProjectPath`、`project_backup_path`；
  - `showPrereleasePackages` 等。
- `vcc.liteDb` 里有 `projects`、`unityVersions` 等集合；
  ALCOM 通过 LiteDB 读写项目/Unity 安装，并用基于路径 hash 的全局命名 mutex 防止并发写。
- ALCOM 还会在 VCC 的 settings 里写自己的扩展字段（`vrc-get` 子对象），
  以及模板在 `Templates/`。
- 官方/curated 仓库是预置的；用户仓库来自 VCC 设置。

### 10.2 Atrium 怎么独立实现

- 只读 `settings.json`：项目/仓库/用户包目录/Unity 提示/预发布。
- **绝不写 VCC 的 settings/LiteDB**；Atrium 用独立设置/DB。
- 导入是"预览 → 勾选 → 去重 → 加密头 → 写导入日志"，不是静默全量。
- LiteDB：当前先不做；如果未来 VCC 只把数据放 LiteDB，再做只读解析。
  写库永远不做。
- `vcc://` 默认不抢；`atrium://` 自己注册；外部模板只做文件导入。

### 10.3 施工顺序

1. 读 settings.json（fields/坏 JSON/缺字段）。
2. 预览/选择/去重。
3. headers 加密。
4. 本地包目录扫描。
5. 深链/单实例。
6. LiteDB 只读（可选）。

### 10.4 容易做错

- 直接写 VCC 的 LiteDB → 破坏官方客户端。
- 导入时把 headers 明文复制到日志/设置 → token 泄漏。
- 静默全量导入 → 用户不知道改了哪些项目/仓库。
- 默认抢 `vcc://` → 其他工具失效。

### 10.5 对应提示词

P7 全篇；P2 的 VCC 项目读取。

---

## 11. UI、命令、更新与日志

### 11.1 ALCOM 的机制（行为观察）

- Tauri command 是 UI 与后端唯一通道；长任务用 channel 发进度，
  也有返回结果/错误的结构。
- 前端用 React Query 缓存项目/包/仓库数据，操作后失效/刷新。
- 项目页/包页/模板页/设置页分块；包管理有选择/批量操作/变更确认。
- 项目页直接给出"升级所有软件包（最新）"、筛选、搜索、每行已安装版本下拉，
  不必进二级页面才能做常规升级/降级。
- 更新器：Tauri updater 读签名更新清单，下载并校验，再安装；
  支持 stable/prerelease；可构建时关闭 self-updater。
- 日志：GUI 日志、Unity 输出转发、错误本地化。

### 11.2 Atrium 怎么独立实现

- IPC 信封 `{ok,data|error}`；长任务返回 opId + 进度事件 + 拉取式状态。
- UI 懒加载；一个屏幕一个主按钮；抽屉 + 变更单；不新增顶级导航。
- "升级全部（最新）"由主进程 `preset:'upgradeAll'` 处理：根包按升级、仅传递依赖加
  "尽量最新"偏好（不提升为根依赖）；仍走同一解析/计划/事务；不静默升级，
  冲突时阻断；无更新时按钮禁用。
- 更新：手动检查 GitHub Release → 下载 Setup → 从发布正文解析 SHA-256 →
  校验 → 用户点安装；不静默。
- 日志：opId、脱敏、诊断导出；错误 code + i18n。
- 不做 DOM 测试基础设施的假承诺；用纯 reducer/wiring 测试 + 真机截图。

### 11.3 施工顺序

1. IPC 契约/状态拉取。
2. 只读页面。
3. 购物车/变更单。
4. 操作记录/诊断。
5. 更新检查。
6. 截图/键盘/性能收口。

### 11.4 容易做错

- 只发事件、不做拉取状态 → 刷新/漏事件后 UI 永远转圈。
- 主进程回中文/原始 HTTP 正文 → i18n/安全都坏。
- 静默自动更新 → 用户失去控制。
- 把 VPM 状态塞进核心 store → 停用 VPM 后核心行为改变。

### 11.5 对应提示词

P8 全篇；P4 的进度/操作记录；P0 的开关/安全模式。

---

## 12. 一个合格阶段提示词应该长什么样

你之前问"提示词有没有包含 ALCOM 怎么实现"。合格的结构应该是：

```text
1. 角色/阶段/前置/分支
2. 本阶段要交付的用户能力（行为）
3. ALCOM 的实现解剖（本文件对应章节的摘要）
4. 我们自己的架构/数据流/文件位置
5. 数据形状/接口/错误码
6. 施工顺序（先做什么、后做什么、每步怎么验）
7. 安全/边界/失败注入
8. 自动化测试 + 真机验收
9. 回退/停用验收
10. 明确不做 + 净室检查 + 报告格式
```

当前十份提示词已经包含 1/2/4/5/6/7/8/9/10；第 3 层以每份提示词的
`§X.5 本阶段实现解剖（ALCOM → Atrium）` 落地，并在开头"必读"里指向本文件的对应章节。
执行 Agent 必须先读对应章节，再按提示词施工；只读提示词里的摘要不够时，回到本文件看完整机制。

### 12.1 阶段 ↔ 本文件章节

| 阶段 | 必读章节 |
|---|---|
| P0 | 0、11（开关/安全模式/命令边界） |
| P1 | 1、2、11（仓库/版本/manifest/HTTP） |
| P2 | 5、6、10（工程读取/Unity/VCC 项目） |
| P3 | 2、3（版本/范围/解析器） |
| P4 | 4、5（事务/工程/缓存） |
| P5 | 7（模板/建工程/unitypackage） |
| P6 | 8、9（备份/复制/迁移） |
| P7 | 1、10、11（仓库治理/VCC/深链） |
| P8 | 11（UI/更新/日志） |
| P9 | 全部（硬化/发布） |

### 12.2 每份提示词新增的小节格式

```markdown
## X. 本阶段实现解剖（ALCOM → Atrium）

- ALCOM 的关键机制：...
- 我们的独立实现：...
- 施工顺序：1... 2... 3...
- 最容易做错：...
- 详细内容：`docs/VPM-IMPLEMENTATION-GUIDE.md` §...
```

这不是把 ALCOM 代码贴进提示词，而是让执行 Agent 在动手前知道：
**这个功能的输入输出、状态机、失败点、先做哪一步。**

---

## 13. 需要特别记住的差异（避免"照着 ALCOM 做错"）

| 主题 | ALCOM 行为 | Atrium 的选择 | 原因 |
|---|---|---|---|
| VCC 数据库 | 读写 LiteDB | 只读 settings，绝不写 LiteDB | 不破坏官方客户端 |
| 旧 Assets 路径 | 允许 Assets/Packages | 只自动清 Assets；Packages 只报告 | 用户硬约束 |
| 旧文件 | 成功后删除 | 进回滚仓 | 永不永久删 |
| 事务临时 | `Temp/vrc-get` | `.atrium-tx` | Unity 可能清 Temp |
| 复制工程 | 包含 Library | 排除 Library | 轻量；Unity 可重建 |
| 备份恢复 | 没有 | 新增"从备份新建" | 安全增强 |
| 解析 | 贪心，不回溯 | 确定性贪心，不回溯 | 可解释、可测试 |
| yanked 精确版本 | specific 选择可绕过过滤 | 新安装不选 yanked；已锁定保留+警告 | 明确/安全 |
| parser 未知字段 | 结构可能丢弃 | 保留 | 不破坏用户数据 |
| 更新 | 签名自动更新 | 手动 + hash + 用户点安装 | 可控 |
| 平台 | 三平台 | Windows 首发 | 现有产品边界 |
| 模板 | 官方内置 tar.gz/资产 | 自有最小骨架 + 包依赖 | 版权与轻量 |

---

## 14. 一句话

> ALCOM 的实现可以概括为：**"环境/仓库/包集合"在外围，"版本/manifest/解析/事务"在内核，
> UI 只是命令和进度。**
>
> Atrium 要在同样的位置上放自己的模块：外围换成 `vpm.db` + 非 C 数据根，
> 内核换成纯逻辑 + 可回滚事务，UI 换成懒加载 + 拉少按钮。
> 结构对齐，代码不抄；行为对齐，资产不搬。
