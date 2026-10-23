# VPM 回退演练证据（P9-D）

> 2026-10-23。范围：`docs/prompts/tasks/P9-D.md`（G8/G9/I9/K1/K2/K4/K5）。
> 机器：Windows 11 build 26200 / Node v22.22.2 / Electron 33.4.11。
>
> **状态：部分完成。** 能在无界面环境里做的四层都做了并留下可复现证据；
> 安装版点按钮、L4 真装回 0.8.0、真 Unity 回归（K1/K2/K4/K5）需要人在键盘前，
> 见 §5「未验证 + 给用户的操作单」。

---

## 1. 结论（先说最要紧的）

1. **回退的第一道门变了**：R20 删掉"停用"按钮之后，L1 名存实亡；
   而且 `ensureAutoEnabled()` 会在下次启动把任何停用改回启用。
   **现在真正的软出口是 L2 安全模式**，硬出口是 L4 装回 0.8.0。
2. **核心库是干净的**：`library.db` 的 schema 从 `pre-vpm` 到现在**一行没改**
   （`git diff pre-vpm HEAD -- src/main/db/schema.ts` 输出为空），里面**没有任何 `vpm_*` 表**。
   这是"回退不会毁掉素材库"的根证据。
3. **移走 VPM 目录不会动核心**：`user_version=11`、表清单、行数、样例行前后完全一致。
4. **VPM 坏掉不影响核心启动**：设置文件坏成 `{ not json`、设置写不进去（被目录占位），
   核心库都照常打开。
5. **L3 不再是"一次性"动作**：移走 `%APPDATA%\A\vpm\` 之后，下次正常启动会自动重建空库。
   要彻底不用，必须「移走 + 之后只用安全模式」或「装回 0.8.0」。

---

## 2. 可自动化部分（已跑，可复现）

```bash
npm run native:node
npx vitest run tests/rollback
```

`tests/rollback/drill.spec.ts` —— **9 条，全绿**（2026-10-23）。

| 层 | 断言 | 结果 |
|---|---|---|
| L1 | 启动后自动启用 → `disableVpm()` 当场 `enabled=false`，不删数据根/设置 | 过 |
| L1 | 再走一次启动流程（模拟重启）→ **又被自动启用** | 过（这就是要记录的事实） |
| L2 | `--safe-mode` 与 `ATRIUM_SAFE_MODE=1` 两种写法都认 | 过 |
| L2 | 安全模式启动：`initVpm` **一次都没被调用**，`status.safeMode=true`、`enabled=false` | 过 |
| L2 | 安全模式下调 `enableVpm()` → 抛 `vpmSafeMode`，不会偷偷拉起模块 | 过 |
| L3 | 造一条核心素材 → 快照 → 移走 `vpm/` → 重开核心库：`user_version`、表清单、行数、样例行全部一致 | 过 |
| L4 | `library.db` 里 `vpm_*` 表数量 = 0；`user_version=11`；`vpm.db` 是另一个文件 | 过 |
| L4 | `src/main/db/schema.ts` 里没有任何 `vpm` 字样 | 过 |
| L4 | VPM 设置坏成 `{ not json` → 隔离成 `.corrupt-*`，核心库照常 | 过 |
| L4 | `vpm/settings.json` 被同名目录占位（写入必失败）→ 抛错但核心库照常 | 过 |

### 2.1 代码回退面（L5 的静态部分）

```text
$ git rev-parse --verify pre-vpm
0ee954a40cfa505f1c67200768ee13188b7dee5a

$ git diff pre-vpm HEAD -- src/main/db/schema.ts | wc -l
0

$ git diff --stat pre-vpm HEAD -- src/main/db/
 src/main/db/repos/unity.ts | 5 +++++
 1 file changed, 5 insertions(+)
```

- 核心 schema 文件：**零改动**。
- `src/main/db/` 里唯一的改动是 `deleteProject()`（R17 删除工程时清核心表的一行 DML），
  没有表结构变化。
- `pre-vpm..HEAD` 共 129 个提交，全部在 VPM 子系统和文档里；`src/main/db` 之外的
  核心改动见 `docs/VPM-ARCHITECTURE.md` §5。

---

## 2.2 顺带删掉的死代码

`src/renderer/vpm/VpmSettings.tsx` 里原来有两个 `Modal`（启用/停用），
`enableOpen` / `disableOpen` 一直渲染着，但**没有任何按钮能把它们打开** ——
`openEnable()` 定义了没人调，`setDisableOpen(true)` 全文件没有。

这正是"手册以为界面上能停用"的来源。已删掉这两个弹窗和它们的 state/handler，
组件顶部写明"这里没有启用/停用按钮（R20）"。
`vpmApi.enable/disable` 与 IPC 保留（`tests/vpm/gate.spec.ts` 仍然覆盖），只是没有界面入口。

## 2.3 发现：全量测试会**随机漏收一个文件**（发布门禁要注意）

连跑三次全量，文件数在 250±1 之间漂，每次少的还是**不同**的文件：

| 次 | 文件数 | 用例数 | 少了谁 |
|---|---:|---:|---|
| 1 | 251 | 2873 | — |
| 2 | 250 | 2850 | `tests/library/remerge.spec.ts`（23 条） |
| 3 | 250 | 2844 | `tests/vpm/install/transaction.spec.ts`（29 条） |

三次都是 **0 failed**，漏掉的文件也**不报错、不标记 skipped**，只是"没被跑"。
单独跑必过（remerge 23/23、transaction 29/29）。

- 怀疑与那条 `Unhandled Error: EPERM ... node-brokered-fs-shim` 有关：
  收集阶段某个 fork 的 `fetch` 被打断，文件就被静默丢弃。
- **影响**：`npm test` 单次全绿**不能**当成"所有文件都跑过了"。
- **缓解**：发布前跑两次，取文件并集；或对 `git diff --name-only` 涉及的文件单跑一遍。
- **顺带更正**：P9-B 复核时我按"Node 版本差异"解释过交接里 237 files / 2842 tests
  与本机 246 / 2829 的差异 —— 更可能是这个漏收，不是 Node。

---

## 3. 与手册不一致、已就地改掉的地方

| 手册原写法 | 实测 | 处理 |
|---|---|---|
| §2「VPM 数据根 = 你启用时选的非 C 目录」 | 实际是 `vpm\settings.json` 里的 `dataRoot`；R19 默认 `%APPDATA%\Atrium`，本机是 `E:\ALCOMprojects` | 已改表 |
| §3「L1：设置里停用（首选）」 | R20 删了按钮；`disableVpm()` 会被 `ensureAutoEnabled()` 改回来 | 整节重写，明确"第一道门是 L2" |
| §5「先做 L1，再按下面做」 | 没有 L1 了；移走目录后下次启动会重建空库 | 改成"先做 L2"，并写明重建行为 |

> 这三条都是**文档与代码不一致**，不是代码坏了。按 `_COMMON.md` 的规矩：以代码为准，改文档。

---

## 4. 关键路径的代码级证据（不是真机）

真机回归没做（见 §5），但这些路径的**逻辑**有测试兜着，出问题时可以先看这里：

| 路径 | 证据 |
|---|---|
| 装包/升/降/重装/卸 | `tests/vpm/install/failure-injection.spec.ts`（24 个注入点逐点）、`tests/vpm/install/*` |
| 撤销一次装包 | `tests/vpm/undo/*`、`tests/vpm/install/recovery.spec.ts` |
| 崩溃后恢复 | `tests/vpm/reliability/*`（真实子进程 `exit(37)`、租约、40 次长稳） |
| 备份 / 从备份新建 / 复制 / 换版本 | `tests/vpm/backup/*` |
| 旧式迁移 | `tests/vpm/backup/migrate.spec.ts` |
| 安全模式与门禁 | `tests/vpm/gate.spec.ts`、`tests/rollback/drill.spec.ts` |

---

## 5. 未验证 + 给用户的操作单

以下五项**必须有人坐在机器前**，我不代跑（弹窗/GUI/真 Unity 都不在自动化范围里）。
按顺序做，每步都留一句结果即可：

### 5.1 安装版关键路径（约 5 分钟）

```powershell
# 1) 装 0.9.0（如果还没装）
& "C:\程序\A素材管家\dist\Atrium-Setup-0.9.0.exe"

# 2) 正常启动，确认：项目页有"项目与包"、设置页有偏好设置/更新面板
& "$env:LOCALAPPDATA\Programs\Atrium\Atrium.exe"
```

验收：项目列表能出来、包管理面板能打开、没有报错弹窗。

### 5.2 安全模式（约 2 分钟）

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
& "$env:LOCALAPPDATA\Programs\Atrium\Atrium.exe" --safe-mode
```

验收：应用能开；项目页**没有**"项目与包"；日志里没有 VPM 运行时加载那一行
（`%APPDATA%\A\logs\`）。

### 5.3 L4 装回 0.8.0（约 10 分钟，**会覆盖安装**）

```powershell
& "C:\程序\A素材管家\dist\Atrium-Setup-0.8.0.exe"
```

验收：
1. 0.8.0 能启动，素材库/收件箱/合集都在（核心库没被降级）；
2. 项目页**没有** VPM 区域；
3. `%APPDATA%\A\vpm\` 还在但没人读它；
4. 再装回 0.9.0，仓库/工程列表回来（说明 vpm.db 没被 0.8.0 破坏）。

### 5.4 真 Unity 回归（K1/K2/K4/K5，约 20 分钟）

用**沙盒工程**（不要拿真实工程）：

1. 新建角色工程 → 装官方 SDK 包 → 打开 Unity → Console 无编译错误；
2. 装/升/降/卸一个包 → 打开 Unity，检查 `Packages/vpm-manifest.json`；
3. 旧式 Assets 夹具 → 迁移 → 打开 Unity，回滚仓有副本；
4. 备份 → 从备份新建 → 打开；复制 → 打开；换版本 → 打开；
5. 事务进行中杀进程 → 重启 → 恢复 → 工程可用；
6. 撤销一次装包 → 工程回到装前。

### 5.5 撤销一次真实装包（约 5 分钟）

在沙盒工程里装一个包，然后点"撤销"，确认工程目录回到装前（`git status` 或文件对比）。

---

## 6. 结论与去向

- **G8/G9（回退/发布门禁）**：可自动化部分通过；L4 真装与安装版回归未做 → **P9-D 保持 review**。
- **I9（真 Unity）**：仍未验，与 P5-D/P5-E/P6-D 一起归 P9-D 的 §5.4。
- **K1/K2/K4/K5（素材联动真机）**：同上。
- 给 P9-E：发布前必须先把 §5.1/5.3 跑完；`Atrium-Setup-0.8.0.exe` 已在 `dist/`，
  但 `dist/` 不进仓库，换机器要重新构建或用备份。
