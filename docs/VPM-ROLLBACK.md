# VPM 合并的回退手册（后门）

> 这份手册写给"发现 VPM 做不下去/做坏了/不想用了"的那一刻。
> 原则：**先停、再备份、最后才动文件；永远不拿用户的素材库和 Unity 工程做试验。**
>
> 适用：Atrium 0.9.x 的 VPM 模块（P0–P9）。核心素材管线不依赖 VPM。

---

## 0. 先记住四件事

1. **核心 `library.db` 没有为 VPM 改过 schema。** 回退不需要恢复它；
   盲目恢复反而会丢掉 VPM 期间新增的素材/分类/封面。
2. **VPM 状态在 `%APPDATA%\A\vpm\`。** 关掉/移走这个目录，核心就当它不存在。
3. **VPM 缓存/回滚仓/工程备份在你自己选的非 C 数据根。** 它们不是核心库的一部分。
4. **Unity 工程里的包是用户工程的一部分。** 回退 Atrium 应用不会自动还原工程；
   工程改动要靠"操作撤销/回滚仓"或用户自己的工程备份。

---

## 1. 回退的三个层级

| 层级 | 做什么 | 数据影响 | 适用 |
|---|---|---|---|
| **L1 停用** | 设置里关掉 VPM | 不删任何东西；VPM 文件休眠；核心恢复原样 | 日常、临时排查、不想用了 |
| **L2 安全模式** | `--safe-mode` 启动 | 不读 VPM 设置、不加载模块、不联网 | VPM 设置/DB 坏了，应用还要能用 |
| **L3 彻底移除** | 备份并移走 `vpm\`；界面回到"未启用" | 不碰核心库/素材/工程；VPM 缓存/回滚仓单独处理 | 确认不再使用 VPM |
| **L4 版本回退** | 装回 0.8.0 安装包 | 核心库兼容（schema 11）；VPM 目录被旧版忽略 | 整个 0.9.x 不想要了 |
| **L5 代码回退** | revert VPM PR / 回到 `pre-vpm` 标签 | 只影响代码；数据按 L1–L4 处理 | 开发线放弃 |

> L1/L2 是**无损**的；L3 之后 VPM 的索引/缓存会离开原位（但仍在备份/回收站里）；
> L4/L5 是应用层回退，不会自动还原 Unity 工程。

---

## 2. 位置清单（先确认，不要猜）

| 东西 | 默认位置 | 说明 |
|---|---|---|
| 核心库 | `%APPDATA%\A\library.db` | **不要动**；VPM 没有改它的 schema |
| 核心备份 | `%APPDATA%\A\backups\` | 现有系统的备份 |
| VPM 设置 | `%APPDATA%\A\vpm\settings.json` | 独立设置；坏文件会改名保留 |
| VPM 数据库 | `%APPDATA%\A\vpm\vpm.db` | 仓库/工程/操作索引；可由工程+仓库重建 |
| VPM DB 备份 | `%APPDATA%\A\vpm\backups\` | 迁移前快照；也放启用 VPM 前的核心库快照（`pre-vpm-*.db`，避免被核心备份轮转清掉） |
| VPM 数据根 | **`vpm\settings.json` 里的 `dataRoot`** | 缓存/回滚仓/工程备份；R19 的默认值是 `%APPDATA%\Atrium`，本机实测是 `E://ALCOMprojects`（用户当年自己选的） |
| 缓存 | `<数据根>\cache\` | 可清理；应用自己的 |
| 回滚仓 | `<数据根>\vault\` | **用户文件副本**；清理走回收站 |
| 工程备份 | `<数据根>\backups\` | 用户工程 zip |
| 用户模板 | `<数据根>\templates\` | 含 unitypackage 附件；不是缓存 |
| 安装版 | `%LOCALAPPDATA%\Programs\Atrium`（以实际安装为准） | 卸载/覆盖安装 |
| 旧安装包 | 你保留的 `Atrium-Setup-0.8.0.exe` | L4 用 |

> 如果数据根在移动硬盘/UNC，先确认盘还在；盘不在时 VPM 应处于 degraded，
> 核心仍可用。不要把数据根"改回 C 盘"来绕过。

---

## 3. L1：停用（R20 之后**已经没有这层了**）

> **2026-10-23 实测（P9-D）**：这一节原来写的是"设置 → 项目与包 → 停用"，
> R20 已经把这个按钮删掉（用户裁定：项目与包不允许关闭，一开始就是开的）。
> 而且就算在代码里调 `disableVpm()`，**下次启动 `ensureAutoEnabled()` 会立刻把它改回来**。
> 证据：`tests/rollback/drill.spec.ts` 的「停用当场生效，但下次启动会被自动启用改回来」。

所以现在的真实情况：

| 你想做什么 | 现在怎么做 | 代价 |
|---|---|---|
| 临时不用 VPM（本次运行） | 没有界面入口 | — |
| 临时不用 VPM（跨重启） | **L2 安全模式** | 每次都要带 `--safe-mode` 或设环境变量 |
| 彻底不用 VPM | **L4 装回 0.8.0** | 回到没有 VPM 的版本 |
| 想清掉 VPM 的索引 | 关掉应用 → 移走 `%APPDATA%\A\vpm\` | **下次启动会重新建一个空库**（自动启用），见 §5 |

**"停用"还能验证的只剩两件事**（都已实测，见 `docs/VPM-ROLLBACK-EVIDENCE.md`）：

1. `disableVpm()` 当场生效：状态变 `enabled=false`，数据根/设置/快照**都不删**；
2. 停用后核心功能不受影响（VPM 运行时释放，不联网）。

> 结论：**回退的第一道门现在是 L2，不是 L1。** 如果你需要一个"长期关掉但不降级"的开关，
> 那是一条新需求（R20 明确拒绝过），不在 P9 范围里。

---

## 4. L2：安全模式（VPM 坏了但应用要开）

### 4.1 用命令行

PowerShell（注意用 `npm.cmd` 的同类思路：直接起 exe 时不要带 `ELECTRON_RUN_AS_NODE`）：

```powershell
# 先清掉可能让 Electron 退化成 Node 的变量
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

# 开发版
npm run dev -- --safe-mode

# 已安装版（路径以实际为准）
& "$env:LOCALAPPDATA\Programs\Atrium\Atrium.exe" --safe-mode
```

### 4.2 用环境变量

```powershell
$env:ATRIUM_SAFE_MODE = "1"
& "$env:LOCALAPPDATA\Programs\Atrium\Atrium.exe"
Remove-Item Env:ATRIUM_SAFE_MODE
```

安全模式下：

- 不读 `vpm/settings.json`（除了显示"已禁用"的状态）；
- 不打开 `vpm.db`；
- 不注册 VPM 网络；
- 不挂载 VPM UI；
- 核心功能照常。

### 4.3 如果安全模式也打不开

那说明问题不在 VPM。按现有 Atrium 的排障走：

- 看 `%APPDATA%\A\logs\` 最新日志；
- 确认没有 `ELECTRON_RUN_AS_NODE=1`；
- 确认 native ABI 与启动方式匹配（`npm run native:electron` / `npm run native:node`）；
- 不要先删 `library.db`。

---

## 5. L3：彻底移除 VPM（确认不再用）

> **先做 L2（安全模式）再按下面做。** R20 之后没有 L1 了，而且 `ensureAutoEnabled()`
> 会在下次**正常启动**时把 `%APPDATA%\A\vpm\` 重新建出来（空库）——
> 所以要"彻底不用"，必须同时满足：移走目录 **并且** 之后用安全模式启动，或者直接走 L4。
> **不要直接 `rm -rf`，不要删素材库/工程。**

### 5.1 备份

1. 关闭 Atrium。
2. 把 `%APPDATA%\A\vpm\` 整个复制到安全位置（例如 `D:\Atrium-rollback-<日期>\vpm\`）。
3. 记录数据根路径；把 `<数据根>\vault\` 和 `<数据根>\backups\` 复制/保留。
4. 导出 VPM 操作记录（如果 UI 还能开：设置 → 项目与包 → 高级 → 导出诊断）。
5. 确认 `library.db` 的 `user_version` 仍是 **11**（可选，只读检查）。

### 5.2 移走 VPM 状态

关闭 Atrium 后，把：

```text
%APPDATA%\A\vpm\settings.json
%APPDATA%\A\vpm\vpm.db
%APPDATA%\A\vpm\backups\
```

移到你的回退备份目录。**不要动** `%APPDATA%\A\library.db`、`backups\`（核心）、
`staging\`、`thumbs\`、`logs\`。

### 5.3 处理数据根

- 缓存 `<数据根>\cache\`：可以直接清理（应用自己的）；想保险就移到回退目录。
- 回滚仓 `<数据根>\vault\`：**里面是用户文件的副本**。不要直接删；
  先确认工程里当前状态，再决定是否走回收站。
- 工程备份 `<数据根>\backups\`：保留；这是用户的工程备份。
- 如果整个数据根只给 VPM 用，可以把整个目录移到回退盘；不要格式化磁盘。

### 5.4 入口回到"未启用"

- 如果代码还在（只是数据移走），L1 的 `enabled=false` 已经够；设置页仍会显示
  "项目与包"的启用卡片，这是**未启用状态**，不是还在后台运行。
- 要连这个入口也没有，用 L4 装回 0.8.0 或 L5 回退代码；旧版不认识 `vpm\` 目录，会忽略。

### 5.5 不要做

- 不要恢复 `library.db` 的旧备份（除非你确认核心数据真的坏了；那和 VPM 回退是两件事）。
- 不要删除用户的 Unity 工程。
- 不要删除 `<数据根>\vault\` 来"清空间"；先看里面是什么。
- 不要为了"干净"去删 `%APPDATA%\A` 整个目录。

---

## 6. L4：装回 0.8.0

1. 确认你保留了 `Atrium-Setup-0.8.0.exe`（或从 GitHub Release v0.7.0/0.8.0 重新下载）。
2. 关闭 Atrium（确认托盘也退出）。
3. 运行安装包，覆盖安装。
4. 启动后核对：
   - 关于页/注册表 `DisplayVersion` 是 0.8.0；
   - 项目页没有 VPM 区域；
   - 素材库/收件箱/合集正常；
   - `%APPDATA%\A\library.db` 仍能打开，`user_version=11`。
5. 旧版会忽略 `%APPDATA%\A\vpm\`；不要因为"看着多余"就删它，先留着。

> 注意：0.8.0 的核心库和 0.9.0 相同（VPM 没改 schema），所以素材数据不会丢。
> 但 0.9.0 期间新建的 VPM 工程仍在你磁盘上；旧版只是不管理它们。

---

## 7. L5：代码回退

### 7.1 标签/分支

- P0 在基线提交打 **`pre-vpm`** 标签（annotated），并记录 SHA 到本文。
- 每个阶段一个 `codex/vpm-pN-*` 分支/PR；PR 号记在阶段报告里。
- 不要直接在 `main` 上回退/强推。

### 7.2 回退某个阶段

优先用 `git revert <merge-commit>` 开一个新 PR，而不是 `reset --hard`：

```bash
git switch -c codex/revert-vpm-pN origin/main
git revert -m 1 <merge-commit>
# 跑全量测试/类型检查/构建
git push -u origin codex/revert-vpm-pN
```

- 如果只是关功能：改 `vpm-settings.json` 的 `enabled=false`，不需要改代码。
- 如果某个阶段有数据迁移：先备份 `vpm.db`；回退代码后旧版 VPM 可能拒绝更高版本 DB
  （这是设计好的保护），核心不受影响。

### 7.3 回退到 `pre-vpm`

```bash
git switch -c codex/rollback-pre-vpm pre-vpm
# 或从标签新建分支后，按正常 PR 合并；不要 force push main
```

- 这会移除 VPM 入口/代码；`library.db` 不动。
- VPM 数据目录仍在；需要 L3 处理。
- 合并前跑全量测试；确认没有核心文件残留 VPM 静态导入。

### 7.4 代码回退的验收

- `package.json` 版本按回退目标；
- `SCHEMA_VERSION` 仍是 11；
- 现有 158 个 spec 全绿（数字以当时基线为准）；
- 类型检查/构建通过；
- 启动后项目页/设置页没有 VPM 入口；
- 无 VPM 网络代码被加载。

---

## 8. 恢复 `vpm.db`

只在 VPM 自己的索引坏了、但你还想用 VPM 时做：

1. 关闭 Atrium。
2. 把当前 `vpm.db` 改名 `vpm.db.corrupt-<时间戳>`（不要删）。
3. 从 `%APPDATA%\A\vpm\backups\` 找最近一个能打开的 `vpm.db.bak-*`。
4. 复制回 `vpm.db`。
5. 启动，设置 → 项目与包 → 状态应显示正常；如果仍失败，VPM 进 degraded，核心可用。
6. 最坏情况：让 VPM 重建空库（仓库重新添加、工程重新扫描）；**工程文件不受影响**。

> `vpm.db` 不是工程真相。工程真相永远是 `vpm-manifest.json` + `Packages/`。
> 所以"DB 重建"是可接受的，不要为了救 DB 去动工程。

---

## 9. 撤销一次装包/迁移

1. 打开项目详情 → 操作记录。
2. 找到最后一次操作；只有"之后工程未被外部改动"才允许撤销。
3. 撤销本身会再走一次计划/确认/事务；从回滚仓取回文件。
4. 如果工程已经在 Unity 里改过/装过别的包，撤销会拒绝；此时：
   - 用工程备份恢复到一个**新目录**（绝不覆盖现有工程）；
   - 或按回滚仓的记录手工恢复（先复制，再验证）。
5. 如果回滚仓归档尚未完成（`vaultPending`），先等归档/重试，不要手工删 Temp。

> 应用回退（L1–L5）**不会**自动撤销已经写进 Unity 工程的文件。
> 这是必须对用户说清楚的边界。

---

## 10. 回退演练（P9 必做）

在沙盒里做，不在真库/真工程：

1. 启用 VPM，添加一个测试仓库，装一个测试包。
2. 记录：`library.db` 的 `user_version`、素材数、工程 manifest hash、VPM 操作 ID。
3. L1 停用 → 重启 → 确认核心原样、VPM 不加载。
4. L2 安全模式 → 确认能启动。
5. L3 移走 `vpm\` → 确认核心原样；VPM 入口不显示。
6. L4 装回 0.8.0（沙盒安装或开发版）→ 确认核心原样。
7. 恢复 `vpm.db` 备份 → 重新启用 → 确认工程/仓库还在。
8. 撤销测试装包 → 确认工程回到装前状态、回滚仓有副本。
9. 把每一步的截图/命令输出写进 `docs/VERIFY-<日期>-VPM-ROLLBACK.md`。

验收：

- 核心 `library.db` 的 `user_version` 始终 11；
- 素材数不变；
- 工程 manifest 在撤销后与装前一致（允许格式差异，但语义一致）；
- 没有任何用户文件被永久删除；
- 安全模式/停用后无 VPM 网络请求。

---

## 11. 紧急情况速查

| 症状 | 先做什么 |
|---|---|
| 打开就崩/白屏 | `--safe-mode` 启动；看日志；不要删库 |
| VPM 设置坏了 | 把 `vpm/settings.json` 改名 `.corrupt-*`；重启；核心可用 |
| `vpm.db` 打不开 | 改名 `.corrupt-*`；从 `vpm/backups` 恢复；或重建空库 |
| 数据根不在/不可写 | VPM 应 degraded；核心可用；接回磁盘或重新选根 |
| 装包后 Unity 报错 | 关 Unity；看操作记录；撤销该次操作；必要时从工程备份新建 |
| 缓存塞满盘 | 设置 → 缓存 → 清理未使用缓存；**不要清回滚仓** |
| 想彻底不用 | L1 → L3 → L4；保留回退备份 |
| 怀疑代码侵权 | 停止合并；按 `VPM-CLEANROOM.md` §4.4 处理；通知用户 |

---

## 12. 回退证据要保存什么

- 每一步的日期/时间、应用版本、操作人。
- `library.db` 的 `user_version`（只读查询）。
- 素材数量/库根（只读）。
- 工程的 `vpm-manifest.json` 前后 hash。
- VPM 操作 ID / 回滚仓路径。
- 截图：项目页/设置页在停用前后的样子。
- 测试命令与真实退出码（不要用管道吞掉退出码）。
- 任何未验证项，明确写"未验证"。

---

## 13. 一句话

> **回退不是删东西，是把 VPM 关进一个独立的盒子。**
> 盒子外面（素材库、工程、核心库）从来没有被 VPM 的 schema 绑住；
> 所以最坏情况下，你只需要停用/移走盒子，Atrium 还是原来的 Atrium。
