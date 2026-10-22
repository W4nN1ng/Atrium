# 交接提示词：P4-B 收尾 → P4-C

> **用法**：把下面 `===` 之间的内容**整段复制**，作为下一个工作站 Agent 的第一条消息。
> 记得把 `[粘贴项目路径]` 换成 `C:\程序\A素材管家`（如果不是这个路径）。

---

=====================================================================

## 任务：接管 Atrium × VPM 合并项目，完成 P4-B 收尾，然后开始 P4-C

项目路径：`C:\程序\A素材管家`

你接手的是一个**中途换站**的开发任务。上一个工作站（Qoder）因额度耗尽中断在 P4-B。
**代码已经写完并且全部测试通过，但一个字都没提交。** 你的第一件事不是写代码，是固化现场。

### 第一步：读这几份文件（按顺序，不要跳）

1. `docs/VPM-P4B-HANDOVER.md` —— **本站的交接文档，先读它**。里面有精确的 git 状态、
   文件清单、已验证/未验证项、环境坑。
2. `AGENTS.md`
3. `docs/VPM-ARCHITECTURE.md`
4. `docs/VPM-TASKS.md`（重点看 P4 段落和末尾的交接记录）
5. `docs/prompts/_COMMON.md`
6. `docs/prompts/tasks/P4-B.md`（当前卡）和 `docs/prompts/tasks/P4-C.md`（下一张卡）

**不要**整份读 `VPM-MERGE-PLAN.md` 或 `VPM-IMPLEMENTATION-GUIDE.md`，
按任务卡指定章节去查即可，控制上下文。

### 第二步：立刻固化现场（**做这个之前不要改任何代码**）

当前状态：`main` 分支，HEAD = `e8c3dcb`，工作区有 **14 个已修改文件 + 6 个未跟踪新文件**，
全部是 P4-B 的成果。**未跟踪的文件一旦丢失无法恢复。**

```powershell
cd C:\程序\A素材管家

# 确认现场（应看到 14 个 M + 6 个 ??）
git status --short
git log --oneline -3

# 开 P4-B 分支
git checkout -b codex/vpm-p4b-cache-archive

# 验证（必须全绿再提交）
npm.cmd run typecheck
npx.cmd vitest run

# 分两个 commit 提交
git add src/main/vpm/cache src/main/vpm/http src/shared/vpm/errors.ts src/main/vpm/index.ts tests/vpm/cache tests/vpm/http
git commit -m "feat(vpm): 接入 P4-B 下载与内容寻址缓存"

git add src/main/vpm/install tests/vpm/install src/renderer/i18n
git commit -m "feat(vpm): 接入 P4-B ZIP 安全解压与包根校验"
```

**预期基线**（我已实测）：
- `typecheck` 干净无输出
- 全量测试 `2378 passed | 20 skipped (2398)`
- P4-B 定向测试 `44 passed`

### 第三步：收尾 P4-B

代码是好的，**不要重写**。只做这四件事：

1. **更新 `src/main/vpm/cache/README.md`** —— 补 `CacheEntryStore` 与 `PackageCacheService`
   的公开 API、配额/LRU 淘汰、隔离（quarantine）、重试策略、新增的 3 个错误码。
2. **更新 `src/main/vpm/install/README.md`** —— 补 `archive.ts` 一节：
   ZIP 安全边界、`DEFAULT_ARCHIVE_LIMITS` 默认值、包根识别规则、6 个 `vpmArchive*` 错误码、
   "失败时保留现场供诊断"的取舍。
3. **更新 `docs/VPM-TASKS.md`** —— P4-B 行从 `todo` 改为 `done`；
   在末尾交接区追加 `### P4-B（<日期>，done）`，照实写"已验证 / 未验证"。
4. **提 PR**，正文包含任务卡要求的五段式交接（状态 / 公开 API 变化 / README /
   已验证 / 未验证 / 给下一个任务）。

**未验证项必须照实写，不许说成"已完成"**（规划 §12.2 硬规则）。至少包括：
真机下载、真机解压、真机 `statfs`、真实 NTFS 长路径、与 P4-C 事务的实际衔接。

### 第四步：开始 P4-C

P4-C = **单包安装事务、manifest 最后写与 vault**，是 P4 阶段的核心 go/no-go。

- 卡：`docs/prompts/tasks/P4-C.md`
- 前置：P4-A ✅、**P4-B（你刚收尾的）**、P3-D ✅
- 必读：`docs/prompts/VPM-P4.md` §7、§8；`docs/VPM-ARCHITECTURE.md` §5、§6.1
- 覆盖对账项：`B4/B5/B6/B8/B19/B22/B25/B29/K4/K5`

**可以直接复用的现成件**：
- `OperationStore`（P4-A）：状态机 + `.atrium-tx/<op>/journal.json` 原子证据
- `PackageCacheService.ensurePackage()`（P4-B）：把包安全拿到本地
- `extractPackageZip()`（P4-B）：安全解压
- P3-C/D 的 `planId + manifestHashBefore`

**P4-C 的绝对底线**：
- **manifest 必须最后一步原子写**；写成功前任何失败都要能回到旧状态。
- 旧包 → `.atrium-tx/<op>/trash/`，用**同卷 rename**（不要用 `Temp`，会被 Unity 清理现场）。
- **Unity 运行中拒绝改包**（这是刻意比 ALCOM 保守）。
- `com.avca.bridge` 是**受保护包**：不升级、不卸载、不覆盖。
- **绝不手写 `.meta`**。
- **不信任渲染层传的 Plan**，只接受 `planId + manifestHashBefore` 重新校验。
- **不碰 `library.db` 的 schema**（永远停在 v11）；VPM 状态只进 `vpm.db`。
- 缓存**绝不落 C 盘**；没有合法非 C 数据根就不启用 VPM，不提供"临时放 C"后门。

### 硬性工作纪律

- **一次只做一张任务卡**；前置没合并/没验收，不开下一张。
- 一张卡 = 一个分支/PR，目标 ≤ 15 个文件、≤ 500 行非测试代码；超了就拆卡。
- 每个任务都要做"关掉 VPM 仍然原样"的回归。
- 净室规则：**可以看 ALCOM 的行为，不可以抄它的代码/文案/图标/测试**；
  不引入 `vrc-get` 依赖，不反编译。
- 发现规划与代码冲突 → **以代码为准**，先改任务卡/架构文档再实现，不要默默绕过。
- 未验证的写"未验证"。

### 环境坑（省得重新踩）

- `npm.ps1` 被执行策略禁止 → 在 PowerShell 里**必须用 `npm.cmd` / `npx.cmd`**。
- 全量测试跑完 PowerShell 会报 `exit code 1`，那是 Vite 的 CJS 弃用警告走 stderr，
  **不是测试失败**；看 `Test Files` 那一行判定。
- 全量测试约 3 分钟，别以为卡死。
- `npm test` 会先跑 `native:node` 切 ABI；只想跑测试就直接 `npx.cmd vitest run`。
- 真机沙盒：`AVCA_APP_HOME` 必须含 `avca`/`sandbox` 且带 `AVCA_REQUIRE_SANDBOX_HOME=1`；
  **绝不用 `E:\vrc\A`、`E:\Atriumdate`、`%APPDATA%\A\library.db` 做试验**。
- 真机 Unity 一律 **2022.3.22f1**；不要 `taskkill /F /IM Unity.exe`（会误杀 Hub），按 PID 杀。
- 项目路径含中文，shell 里注意引号。

### 汇报要求

每个任务完成后，用中文汇报，包含：
1. 实际跑出来的测试数字（不是估计）；
2. 已提交的 commit SHA / PR 链接；
3. 明确列出**未验证项**；
4. 下一步要做什么，以及是否满足开下一张卡的前置。

现在开始：先读 `docs/VPM-P4B-HANDOVER.md`，然后固化现场。

=====================================================================

---

## 附：如果你只想让 Agent 干最短的活

把上面整段里的"第四步：开始 P4-C"及之后删掉，只保留第一到第三步，
末尾改成"做完 P4-B 收尾就停下来向我汇报"。这样上下文占用最小，
适合额度紧张、只想把当前这张卡落地的情况。
