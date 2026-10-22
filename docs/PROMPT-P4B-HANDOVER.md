# 交接提示词：P4-B → P4-C

> **用法**：把下面 `===` 之间的内容**整段复制**，作为下一个工作站 Agent 的第一条消息。

---

=====================================================================

## 任务：接管 Atrium × VPM 合并项目，开始 P4-C

项目路径：`C:\程序\A素材管家`

你接手的是一个**中途换站**的开发任务。上一个工作站（Qoder）因额度耗尽中断，
留下未提交的 P4-B 代码；这些代码**已经完成收尾并提交**，现在轮到你做 P4-C。

**P4-B 已完全落地，不要重做，也不要重新验证它。** 直接从 P4-C 开始。

### 第一步：读这几份文件（按顺序，不要跳）

1. `docs/VPM-P4B-HANDOVER.md` —— **上一站的交接文档，先读它**。含提交记录、
   已验证/未验证项、perf 噪声说明、环境坑。
2. `AGENTS.md`
3. `docs/VPM-ARCHITECTURE.md`
4. `docs/VPM-TASKS.md`（重点看 P4 段落和 §12 末尾的 P4-B 交接记录）
5. `docs/prompts/_COMMON.md`
6. `docs/prompts/tasks/P4-C.md`（你的任务卡）

**不要**整份读 `VPM-MERGE-PLAN.md` 或 `VPM-IMPLEMENTATION-GUIDE.md`，
按任务卡指定章节去查即可，控制上下文。

### 第二步：确认起点，然后开 P4-C 分支

```powershell
cd C:\程序\A素材管家

# 确认干净 + 确认起点
git status --short          # 应无输出
git log --oneline -4        # HEAD 应为 7a832c0（docs: P4-B 交接记录与任务板状态）

# 开 P4-C 分支
git checkout -b codex/vpm-p4c-transaction
```

**已完成，不需要再做**（上一站收尾时做完的）：
- P4-B 代码提交（3 个 commit：`01a55ab` / `1c6f991` / `7a832c0`）
- `cache/README.md`、`install/README.md` 补全
- `docs/VPM-TASKS.md`：P4-B 标 `done`，§12 有交接记录

**唯一遗留的流程项**：上述 3 个 commit 落在 `main` 上，按规划本应走 PR。
若 `main` **尚未 push**，可以这样挪到分支上（否则不要动历史）：

```powershell
git branch codex/vpm-p4b-cache-archive
git reset --hard e8c3dcb
git checkout codex/vpm-p4b-cache-archive
```

不确定就先别做，直接开 P4-C 即可，这不阻塞开发。

### 第三步：做 P4-C

P4-C = **单包安装事务、manifest 最后写与 vault**，是 P4 阶段的核心 go/no-go。

- 卡：`docs/prompts/tasks/P4-C.md`（一次只做这一张）
- 前置：P4-A ✅、P4-B ✅、P3-D ✅
- 必读：`docs/prompts/VPM-P4.md` §7、§8；`docs/VPM-ARCHITECTURE.md` §5、§6.1
- 覆盖对账项：`B4/B5/B6/B8/B19/B22/B25/B29/K4/K5`

**可以直接复用的现成件**：
- `OperationStore`（P4-A）：状态机 + `.atrium-tx/<op>/journal.json` 原子证据
- `PackageCacheService.ensurePackage({ url, sha256, size })`（P4-B）：把包安全拿到本地
- `extractPackageZip({ zipPath, targetDir, expected })`（P4-B）：安全解压
- P3-C/D 的 `planId + manifestHashBefore`

**P4-B 给你定下的契约**（别绕开）：
- **缓存写入的唯一写入者是 `PackageCacheService`**。事务只消费 `{ sha256, size, path }`，
  **不要自己写 `cache/` 或 `vpm_cache_entry`**。
- `vpm_cache_entry` 表已在 P4-A 的 v3 建好，**不要再加迁移抢这张表**。
- `extractPackageZip` 失败会把现场留在目标目录（不自动清理），
  由你按 journal 决定清理还是保留。
- `PreparedPackage` 已预留 `local` 分支（P7 接入），**不要写死 zip**。

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
- 全量测试跑完 PowerShell **常报 `exit code 1`**：Vite 的 CJS 弃用警告走 stderr
  会被当成 NativeCommandError。**一律以 `Test Files` / `Tests` 行判定，不看退出码。**
- 全量测试约 3.5 分钟，别以为卡死。
- `npm test` 会先跑 `native:node` 切 ABI；只想跑测试就直接 `npx.cmd vitest run`。
- **`tests/perf/scale.spec.ts` 有一条已知 flaky**（"增量 upsert 一条不拖慢"）：
  它取三次最小值滤 CPU 噪声，但全量并发时仍可能三次都被拖慢。
  单独跑实测 0.458ms/条、余量 31%（阈值 0.6）。
  **看到它红先单独重跑确认，不要去放宽阈值**（测试注释明确论证过放宽会丢信号）。
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

现在开始：先读 `docs/VPM-P4B-HANDOVER.md`，然后确认起点并开 P4-C 分支。

=====================================================================

---

## 附：两个可选变体

**A. 想先补 PR 流程**：在"第二步"末尾加上
"先把 P4-B 的 3 个 commit 挪到 `codex/vpm-p4b-cache-archive` 分支并提 PR，
正文用 `docs/VPM-P4B-HANDOVER.md` §3 的未验证项 + `VPM-TASKS.md` §12 的 P4-B 记录；
PR 开好后再开 P4-C 分支。"

**B. 额度紧张，只想拿到 P4-C 的第一版骨架**：把"第三步：做 P4-C"里的
"覆盖对账项"之后的内容精简为只保留"绝对底线"六条，
末尾改成"先给出 P4-C 的施工计划（文件清单 + 步骤 + 失败注入点），等我确认后再写代码"。
