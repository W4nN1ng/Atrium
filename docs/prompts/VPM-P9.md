# VPM-P9 执行提示词：硬化、回退演练与 0.9.0 发布

> 前置：P0–P8 已合并；对账表填满；功能默认关闭但可启用。
> 必读：`AGENTS.md`、`docs/VPM-MERGE-PLAN.md`、`docs/VPM-CLEANROOM.md`、
> `docs/VPM-PARITY.md`、`docs/VPM-ROLLBACK.md`、`docs/HANDOVER.md`、`docs/VPM-IMPLEMENTATION-GUIDE.md` 全部（重点 §0、§4、§12、§13）。
>
> 本阶段只做：硬化、真机复测、回退演练、发布 0.9.0、更新本机安装版。
> **不再加新功能。** 发现缺口 → 修或降级写清楚，不做"顺手加一个"。

---

## 1. 开始前

```bash
git fetch origin
git switch -c codex/vpm-p9-release origin/main
```

- 确认 `main` 是最新、P8 已合并、对账表无空白。
- 记录 `pre-vpm` 标签 SHA、0.8.0 安装包位置、P8 基线测试数字。
- 准备一份"发布检查清单"放在 PR 描述里。

---

## 1.5 本阶段实现解剖（ALCOM → Atrium）

**ALCOM 的关键机制（行为观察）**

- 它把仓库/包集合/解析/事务/Unity/模板/备份/VCC/更新放在同一个常驻环境里；
  功能之间共享状态，发布时只需要验证"这一套环境"。
- 更新器读签名清单、校验、安装；没有"整套 VPM 关闭/移除"的产品级回退路径。
- 版本迁移、旧 Assets 清理、更新等高风险动作，最终都落在同一套事务/文件操作上。

**Atrium 的独立实现（发布验收视角）**

- 我们多了 ALCOM 没有的三件事，P9 必须逐项证明：
  1. **默认关闭**：全新安装不联网、不建 `vpm.db`、Project 页行为与 0.8.0 一致；
  2. **可停用/降级**：坏配置、坏 DB、Unsupported schema、数据根失联时核心照常；
  3. **可回退**：L1 停用 → L2 safe mode → L3 移除 → L4 重装 0.8.0 → L5 代码回退；
     工程侧变更另有 vault/撤销，应用回退不等于工程回退。
- 发布前按模块复核实现解剖：P0 gate（guide §0/§11）、P1 仓库（§1/§2）、
  P2 工程/Unity（§5/§6/§10）、P3 解析（§2/§3）、P4 事务（§4/§5）、
  P5 模板（§7）、P6 备份/迁移（§8/§9）、P7 VCC/深链（§1/§10/§11）、P8 UI（§11）。
- 只按 `VPM-PARITY.md` 的真实状态发布；部分/不做的行必须保留，不用"几乎 100%"
  掩盖差异。所有测试走沙盒（`AVCA_APP_HOME` 含 avca/sandbox），绝不碰真实库/工程。
- 本机安装版必须在发布后更新，并用 `tools/installed-version.cjs --expect=0.9.0` 核实
  注册表 `DisplayVersion`；只发 Release 不算完成。

**施工顺序**

1. 冻结功能，跑全量测试/类型检查/构建/worker 检查，记录基线。
2. 按模块过一遍上面的"实现解剖"清单，找实现与文档不一致处。
3. 失败注入矩阵 + 真 Unity 沙盒 + 真机复测。
4. 回退演练（L1–L5）并留证据。
5. 发布 0.9.0 → 更新本机安装版 → 核实版本。
6. 最终报告：已验证/未验证/部分/已知差异分开写。

**最容易做错**

- 把"能启动/能打开页面"当成"功能完成"；不跑真实安装/回滚。
- 用真实库或真实工程做测试 → 不可接受的破坏风险。
- 只验证启用路径，不验证停用/安全模式/卸载残留。
- 回退演练只做代码回退，不验证 `vpm.db`/设置/工程残留。
- 发布后不更新本机安装版，用户看到的还是旧行为。

**详细内容**：`docs/VPM-IMPLEMENTATION-GUIDE.md` 全部章节（重点 §0、§4、§12、§13）。

---

## 2. 硬化清单

### 2.1 安全

- [ ] 所有 VPM 网络只走 `http.ts`；无其他 `fetch`/`net.request`/`https`.
- [ ] HTTPS/重定向/超时/大小/证书校验；无忽略证书开关。
- [ ] 请求头/token 加密、脱敏；日志/诊断/错误无泄漏。
- [ ] ZIP：slip/绝对路径/盘符/UNC/符号链接/保留名/ADS/大小写/zip bomb。
- [ ] 路径：数据根/工程/Assets 双闸；长路径；UNC；只读。
- [ ] 受保护包（至少 `com.avca.bridge`）不可装/升/降/卸。
- [ ] Unity 运行中拒绝写包；恢复时不写。
- [ ] 无永久删除用户文件；回滚仓校验；清理走回收站。
- [ ] 无手写 `.meta`（静态扫描 + 真机）。
- [ ] 缓存不在 C；没有 C 回退。
- [ ] 未同意无出站；安全模式零 VPM 加载。

### 2.2 可靠性

- [ ] 失败注入全阶段（P4）仍绿。
- [ ] 崩溃恢复各阶段仍绿；恢复幂等。
- [ ] 并发：同工程串行；不同工程并行；双击不重复。
- [ ] 磁盘不足/只读/被占用/manifest 外部修改。
- [ ] vpm.db 损坏/高版本/迁移失败 → 核心可用。
- [ ] 数据根丢失/不可写 → 核心可用。
- [ ] 更新器坏 hash/断网/GitHub 错误 → 安全失败。

### 2.3 性能

- [ ] 5,000 版本目录搜索 <200ms；列表不卡。
- [ ] 解析器 200 包 <200ms。
- [ ] 10k 文件工程扫描不阻塞 UI。
- [ ] 备份/下载内存不随文件大小线性增长（流式）。
- [ ] 启动：VPM 关闭时无可感知延迟；启用时懒加载。

### 2.4 兼容

- [ ] Windows 10/11 各一次（至少 Win11 真机 + 一个 Win10 虚拟机/记录未验证）。
- [ ] 100%/125% 缩放；中文/英文/日文主流程。
- [ ] 路径：中文/空格/长路径/UNC/可移动盘。
- [ ] Unity 2022.3.22f1 真机矩阵（P4/P5/P6）；其他版本记录未验证。
- [ ] VCC 只读导入真实（复制/脱敏）一次；不写 VCC。

---

## 3. 真机复测（必须做，不接受假绿）

用沙盒：

```powershell
$env:AVCA_APP_HOME = "E:\avca-sandbox-p9\AppData\Roaming\A"
$env:AVCA_REQUIRE_SANDBOX_HOME = "1"
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
```

场景：

1. 启用 VPM（非 C 数据根）→ 同意联网 → 官方/curated 刷新。
2. 新建角色工程 → 装官方 SDK 包 → 打开 Unity → 无编译/包错误。
3. 装/升/降/重装/卸一个包 → 打开 Unity；检查 manifest/包目录。
4. 旧式 Assets 夹具 → 迁移 → 打开 Unity；回滚仓有副本。
5. 备份 → 从备份新建 → 打开；复制 → 打开；换版本 → 打开。
6. 崩溃：事务中杀进程 → 重启恢复 → 工程可用。
7. 撤销一次装包 → 工程回到装前。
8. 停用 → 重启 → 核心原样；安全模式 → 能启动。
9. 更新检查：真实网络一次（如果可用）；坏 hash 模拟一次。
10. 导出诊断 → 检查无 token/头。

记录：

- 每个场景的命令/截图/日志/结果；
- 未验证的写"未验证"；
- 真 Unity 版本/项目路径；不要记录用户真实隐私。

---

## 4. 回退演练（按 `VPM-ROLLBACK.md`）

必须完整走一遍沙盒：

1. 记录 `library.db` 的 `user_version`（应始终 11）、素材数、工程 manifest hash。
2. L1 停用 → 重启 → 核心原样。
3. L2 安全模式 → 能启动。
4. L3 移走 `vpm\` → 核心原样。
5. 恢复 `vpm.db` 备份 → 重新启用 → 仓库/工程回来。
6. L4 装回 0.8.0（沙盒/开发版）→ 核心原样。
7. 撤销测试装包 → 工程恢复；回滚仓副本存在。
8. 产出 `docs/VERIFY-2026-XX-XX-VPM-ROLLBACK.md`：
   - 步骤、命令、截图、结果、未验证项；
   - 明确"回退应用不自动还原 Unity 工程"的边界。

验收：

- 核心 schema 11；素材数不变；
- 工程撤销后 manifest 语义一致；
- 无永久删除；
- 停用/安全模式无 VPM 网络；
- 安装版可回退。

---

## 5. 发布 0.9.0

### 5.1 准备

1. `package.json` 版本 = **0.9.0**；确认 `package-lock.json` 一致。
2. 写 `docs/release-body-0.9.0.md`，照 `docs/release-body-0.5.0.md` 的格式：
   - 没有 H1；开头两行引入语；下载链接；一行 `> 本页说明…`；
   - `## 本次更新` → `###` 主题 + `- **加粗要点：** 说明`；
   - `## 下载与升级`（表格 + 升级说明 + SmartScreen）；
   - `<details>` SHA-256；`## 主要功能`（3 个 `###`）；`## 快速开始`；
   - `## 使用说明与已知限制`（表格）；`## 数据位置`（表格）；`## 反馈与开发`。
3. 术语红线：正文不出现 `schema`/`IPC`/`pHash`/`DPAPI`/`GUID`/`asar`/`变异`/`单元测试`/`代号`。
   用脚本/搜索核对 0 命中。
4. 面向玩家：说人话；VPM 功能写成"项目与包管理（可选，默认关闭）"；
   明确"会联网、会改 Unity 工程、缓存必须在非 C 盘"。
5. README/已知限制更新：
   - 核心离线；VPM 可选联网；
   - 主目标 Windows 10/11 + Unity 2022.3.22f1；
   - 未验证：其他 Unity 版本、URP/HDRP、mac/Linux、VCC LiteDB、部分迁移；
   - 数据位置（核心/ VPM 数据根/回滚仓）。
6. 更新 `docs/HANDOVER.md` 的版本/测试/已知限制（不要改历史账）。

### 5.2 构建

```powershell
& npm.cmd test *> $env:TEMP\atrium-p9-test.log; $LASTEXITCODE
& npm.cmd run typecheck *> $env:TEMP\atrium-p9-typecheck.log; $LASTEXITCODE
& npm.cmd run build *> $env:TEMP\atrium-p9-build.log; $LASTEXITCODE
node tools/pkg-version.cjs
```

- 产物：`dist\Atrium-Setup-0.9.0.exe`、`dist\Atrium-portable-0.9.0.exe`。
- 记录大小/SHA-256。
- `pkg-version.cjs` 核对 asar 版本/许可/依赖；不通过不发。

### 5.3 GitHub Release

- 这台机器没有 `gh` CLI；用 REST + token：
  - token 来源 `GH_TOKEN` 或 `git credential fill`；
  - 不打印 token。
- 先检查：

```powershell
node tools/gh-release.cjs --check
```

- 建 Release + 资产：

```powershell
node tools/gh-release.cjs --create
```

- 如果已存在/只改正文：

```powershell
node tools/gh-release.cjs --body-only
node tools/gh-release.cjs --replace-assets
```

- 发布后核对：

```powershell
node tools/verify-release-page.cjs
```

  - **必须真的报出 2 个 SHA-256 且都匹配**；
  - 报 0 串就是工具又坏了，停下来修；
  - 核对：`latest`、资产数 2、正文与本地 md 逐字一致、远端 digest 与本地一致。

### 5.4 更新本机安装版

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process dist\Atrium-Setup-0.9.0.exe -ArgumentList '/S' -Wait
node tools/installed-version.cjs --expect=0.9.0
```

- Git Bash 下 `/S` 前加 `MSYS_NO_PATHCONV=1`，否则会被当成路径 `S:/` 弹 UI。
- 安装后启动一次（VPM 默认关闭）；确认核心正常。
- 保留 0.8.0 安装包与 `pre-vpm` 标签。

---

### 5.5 网络/工具坑

- `git push` 可能间歇性超时；重试，不要马上判定"发布失败"。
- `api.github.com` 在 `github.com` 不通时往往仍可用；发布走 API。
- 没有 `gh` CLI；不要写 `gh release ...`。
- 资产上传的三个历史坑：URI 模板、User-Agent、`fetch failed` 可能其实已落库；
  上传后先 `--check` 再决定是否重传。
- PowerShell 读 UTF-8 中文可能乱码；用 Node/编辑器读发布说明。
- `node -e` 在 PowerShell 里容易被引号/括号搞坏；写成 `.cjs`。
- `.cjs` 没有顶层 await；包进 `async function main()`。

---

## 6. 发布后

- 核对 Release 页面/资产/正文/hash（真报 2 个）。
- 在仓库里更新 `docs/HANDOVER.md` 的"当前状态快照"：
  - 版本 0.9.0、HEAD、测试数字、VPM 模式、回退方式。
- 记录未验证项：
  - macOS/Linux、其他 Unity 版本、URP/HDRP、VCC LiteDB、部分旧工程迁移、
    真实官方包（如果网络未通）等。
- 不删除沙盒/回退备份，保留至少一个发布周期。
- 如果发布失败：
  - 不反复重建同名 Release；先 `--check` 看状态；
  - 资产可能已上传（fetch failed 也可能已落库）；不要盲目重传；
  - 报告实际状态，不假装成功。

---

## 7. 最终报告格式

```text
版本/PR：
基线 pre-vpm：
改动范围：
测试：通过/跳过/退出码（真实数字）；typecheck；build；pkg-version
真机：Unity 版本/场景/结果；未验证项
回退演练：步骤/结果/证据路径
发布：Release URL/资产数/2 个 hash 核对结果
本机安装：DisplayVersion
已知限制：
净室：观察日志/复核结论
```

- 不要把"可启动"说成"功能完成"。
- 不要把条件跳过的测试说成通过。
- 不确定就写"未验证"。

---

## 8. 完成定义

- [ ] 硬化清单全部有结论（通过/未验证/已降级说明）。
- [ ] 真机矩阵走完；未验证项写明。
- [ ] 回退演练完成并有证据文档。
- [ ] 0.9.0 Release 发布，2 个资产，2 个 hash 核对通过。
- [ ] 本机安装版 0.9.0，VPM 默认关闭，核心正常。
- [ ] README/DEVELOPMENT/HANDOVER/对账表更新。
- [ ] 净室检查表通过。
- [ ] 没有任何"未说明的空白"。
