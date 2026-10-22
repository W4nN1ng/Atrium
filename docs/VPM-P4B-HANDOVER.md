# P4-B 交接文档（缓存、下载、hash 与解压安全）

> 写于 **2026-10-22 14:45**。读者：接手 P4-B 收尾 / 直接转 P4-C 的下一个工作站 Agent。
>
> 上一站（Qoder 工作站）因额度耗尽中断。**代码已写完且全绿，但没有提交。**

---

## 0. 一页结论（先读这段）

**P4-B 的代码实现已经完成，全量测试与类型检查都通过，唯一没做的是"提交 + 收尾"。**

| 项 | 状态 |
|---|---|
| 代码实现 | ✅ 完成（7 个新文件 + 8 个改动文件） |
| 全量测试 | ✅ `2378 passed \| 20 skipped (2398)` |
| 类型检查 | ✅ `tsc --noEmit` 两个 project 都干净 |
| 三语文案 | ✅ zh-CN / en / ja 各 +9 键 |
| 组合根接线 | ✅ `vpm/index.ts` 已注入 `CacheEntryStore` + `PackageCacheService` |
| 模块 README | ⚠️ `cache/README.md` 未更新到 P4-B 新 API；`install/README.md` 需补 `archive` |
| 任务板状态 | ❌ `docs/VPM-TASKS.md` 里 P4-B 仍是 `todo` |
| **git 提交** | ❌ **全部改动未提交，散在 `main` 工作区** |
| PR / 分支 | ❌ 不存在。按规划本应是 `codex/vpm-p4b-...` 分支 |

**所以下一个工作站的第一件事不是写代码，是"先固化再收尾"。**

---

## 1. 现场精确状态

### 1.1 Git

```
分支：main
HEAD：e8c3dcb  Merge pull request #38 from W4nN1ng/codex/vpm-p4a-journal-state
上一张卡：P4-A（journal 与状态机）已合并
```

**已跟踪但未提交（14 个文件，+307 / -4）：**

| 文件 | 变化 |
|---|---|
| `src/main/vpm/cache/index.ts` | 导出 `CacheEntryStore` / `PackageCacheService` |
| `src/main/vpm/cache/store.ts` | +117 行：`quarantine` / `quarantinePackage` / `listPackages` / `cacheRoot` |
| `src/main/vpm/cache/types.ts` | +54 行：缓存服务与条目类型 |
| `src/main/vpm/http/client.ts` | +9 行：`downloadToFile` 能力 |
| `src/main/vpm/http/types.ts` | +8 行：`VpmHttpPort.downloadToFile` |
| `src/main/vpm/index.ts` | +16 行：组合根注入 |
| `src/main/vpm/install/index.ts` | +7 行：re-export `archive` |
| `src/renderer/i18n/{zh-CN,en,ja}.json` | 各 +9 个错误文案键 |
| `src/shared/vpm/errors.ts` | +9 个错误码 |
| `tests/vpm/cache/store.spec.ts` | +31 行 |
| `tests/vpm/http/client.spec.ts` | +15 行 |
| `tests/vpm/runtime.spec.ts` | +2 行 |

**未跟踪（6 个新文件，约 53 KB）：**

| 文件 | 大小 | 作用 |
|---|---|---|
| `src/main/vpm/cache/entries.ts` | 4.4 KB | `vpm_cache_entry` 表的仓储（LRU/用量/损坏行清理） |
| `src/main/vpm/cache/service.ts` | 12.8 KB | 下载 + 内容寻址缓存编排（配额/重试/并发去重/隔离） |
| `src/main/vpm/install/archive.ts` | 16.6 KB | ZIP 安全解压适配器 + 包根校验 |
| `tests/vpm/cache/download.spec.ts` | 12.9 KB | 12 个下载/缓存用例 |
| `tests/vpm/install/archive.spec.ts` | 10.4 KB | 8 个解压安全用例 |
| `tests/vpm/install/zip-fixture.ts` | 3.2 KB | 恶意 zip 夹具生成器 |

> ⚠️ `zip-fixture.ts` 是测试辅助，不是 `*.spec.ts`，**不会被误当成测试跑**，但必须一起提交，否则 `archive.spec.ts` 会红。

### 1.2 证据（本站已经实际跑过，可复现）

```
npm run typecheck                     → 干净，无输出
npx vitest run tests/vpm/cache tests/vpm/install
                                      → 4 files / 44 tests passed
npx vitest run（全量）                → 185 passed | 9 skipped (194 files)
                                        2378 passed | 20 skipped (2398 tests)
                                        耗时约 179s
```

> 全量跑完 PowerShell 会报 `exit code 1`，那是 Vite 的 CJS 弃用警告走了 stderr，
> 被 PowerShell 当成 NativeCommandError。**不是测试失败**，看 `Test Files` 行判定。

---

## 2. P4-B 到底做了什么（对照任务卡）

任务卡 `docs/prompts/tasks/P4-B.md` 的交付物逐条核对：

| 任务卡要求 | 状态 | 落在哪 |
|---|---|---|
| 缓存路径/配额边界 | ✅ | `store.ts`（词法 + realpath 双检，cacheRoot 必须是 dataRoot 严格子目录） |
| 临时文件 → hash → rename | ✅ | `store.commitDownload` + `service.prepare` |
| 损坏可重下 | ✅ | `quarantine` / `quarantinePackage` + `entries.remove` |
| ZIP 解压到同卷临时目录 | ✅ | `archive.extractPackageZip` |
| 逐条目校验路径/类型/大小 | ✅ | `archive.ts` 的 `DEFAULT_ARCHIVE_LIMITS` |
| 安全错误码 | ✅ | 9 个新码：`vpmCacheHashMissing/QuotaExceeded/NoSpace`、`vpmArchive*` ×6 |
| 解压后包根/`package.json` 校验 | ✅ | 唯一 wrapper 目录识别 + name/version/deps 校验 |
| 不把整包读进内存 | ✅ | 流式：HTTP 边写边算 SHA-256 |
| 不接受无 hash 的包 | ✅ | `normalizeSha` 抛 `vpmCacheHashMissing` |
| 不写工程 | ✅ | `cache/` 与 `archive` 只碰 dataRoot 与目标临时目录 |
| README | ⚠️ 部分 | `cache/README.md` 还是 P1 版本，缺 `service`/`entries` |
| 任务板标 done | ❌ | 仍是 `todo` |
| PR 交接段 | ❌ | 没有 PR |

### 2.1 已覆盖的安全用例（实测全绿）

**解压（`archive.spec.ts`，8 例）**
- zip-slip、绝对路径、盘符、UNC、Windows 保留名（CON/NUL/COM1…）、ADS（`:`）、结尾点、重复路径
- 符号链接条目（在创建任何外部文件之前就拒绝）
- zip bomb：压缩比、条目数、解压总量、单条目大小 四个维度
- 损坏压缩包、目标已存在、非法 limit 值
- 失败时**保留**已解出的文件和目标目录供诊断（不静默清理现场）
- 正常包：保留 `.meta` 字节、空目录、识别包根

**下载/缓存（`download.spec.ts`，12 例）**
- 命中缓存仍完整重算 hash；行可重建
- 损坏缓存 → 隔离 → 重下
- hash 不匹配 → **不重试**、保留坏字节、不留 entry
- 大小不匹配、无 SHA-256 → 不触网就拒绝
- 重试策略：只重试网络/超时/5xx，最多 2 次；4xx 不重试
- abort 清理 `.part`
- 配额 LRU 淘汰并保护当前包
- 超过配额的包在下载前就拒绝
- 未知大小且淘汰后仍放不下 → 拒绝
- 磁盘无空间 → 下载前失败
- 同 hash 并发只下载一次 + 进度节流（100ms）
- 文件被外部删除 → 重下

**缓存存储（`store.spec.ts`，11 例）**
- 临时文件与包必须留在 cache root 内；拒绝相对路径、cacheRoot 逃逸、cacheRoot == dataRoot
- 原子 rename 提交；期望 hash / 大小不匹配则删临时文件
- tmp 外的临时文件**拒绝且不删**（不误伤）
- 损坏检测、`clearTmp`/`clearPackages` 各自只清自己
- 隔离到 `cache/corrupt` 且保留字节
- 只列出 `packages/<两位前缀>/` 下的合法包文件

---

## 3. 未验证项（**必须照实写进 PR，不许说成"已完成"**）

> 规划 §12.2 的硬规则：未验证的写"未验证"。

1. **真机下载**：所有下载用例用的是假 HTTP 端口。**没有对真实 VRChat 官方仓库做过一次真下载。**
2. **真机解压**：没有用真实 `.zip` 包（来自真实仓库的包）跑过解压。
3. **`statfsSync` 真机行为**：空间检查在真盘上的表现未验证（夹具注入了 `availableBytes`）。
4. **长路径 / >260 字符**：测试覆盖了路径语义，但**没有在真实 NTFS 长路径上验证**。
5. **与 P4-C 事务的衔接**：`PackageCacheService` 还没被事务消费过，
   "事务只消费 hash/路径"这条契约是**设计意图，不是已验证事实**。
6. **`.atrium-tx` 是否被 Unity 忽略**：P4-C 真机项，本站没碰。
7. **配额与 `vpm_cache_entry` 的一致性**：并发淘汰与 DB 行的一致性未做压力测试。
8. **`install/README.md` 未补 `archive` 一节**。

---

## 4. 下一个工作站：从哪开始

### 4.1 第一步：固化现场（**先做这个，别先写代码**）

工作区里的东西是"能跑但没主"的状态。万一有人 `git checkout .` 或切分支，两小时的工作就没了。

```powershell
cd C:\程序\A素材管家

# 1) 先确认现场没变（应看到 14 个 M + 6 个 ??）
git status --short

# 2) 从当前 main 开 P4-B 分支
git checkout -b codex/vpm-p4b-cache-archive

# 3) 全量验证（必须绿）
npm run typecheck
npx vitest run

# 4) 提交（建议拆两个 commit，便于回滚定位）
git add src/main/vpm/cache src/main/vpm/http src/shared/vpm/errors.ts src/main/vpm/index.ts tests/vpm/cache tests/vpm/http
git commit -m "feat(vpm): 接入 P4-B 下载与内容寻址缓存"

git add src/main/vpm/install tests/vpm/install src/renderer/i18n
git commit -m "feat(vpm): 接入 P4-B ZIP 安全解压与包根校验"
```

> ⚠️ 别用 `npm test`（会先跑 `native:node` 切 ABI）；直接用 `npx vitest run` 更快。
> 若要跑 `npm`，在这个 shell 里必须用 `npm.cmd`（`npm.ps1` 被执行策略挡了）。

### 4.2 第二步：收尾 P4-B（约 30 分钟）

1. **更新 `src/main/vpm/cache/README.md`**：补 `CacheEntryStore`、`PackageCacheService`
   的公开 API、配额/淘汰/隔离/重试策略、失败码（新增 3 个 cache 码）。
2. **更新 `src/main/vpm/install/README.md`**：补 `archive.ts` 一节——
   安全边界、limits 默认值、包根识别规则、6 个 archive 错误码、
   "失败保留现场"的取舍。
3. **更新 `docs/VPM-TASKS.md`**：
   - P4-B 行 `todo` → `done`（或 `review`，取决于你是否先提 PR）；
   - 在文件末尾的交接段追加一条 `### P4-B（2026-10-22，done）`，写清：
     已验证 / 未验证 / 给 P4-C 的话。
   - **给 P4-C 的关键叮嘱**：缓存写入唯一者是 `PackageCacheService`；
     事务**只消费** `{ sha256, size, path }`，不要自己写 `cache/`；
     `vpm_cache_entry` 表已存在（P4-A 建的 v3），**不要再加迁移抢这张表**。
4. **提 PR**，正文含任务卡 §"交接（写进 PR）"的五段式。
5. **可选**：跑一次真机下载 smoke（拿一个真实小包，走 `ensurePackage`），
   把结果补进"已验证"，把上面 §3 的第 1、2 条划掉。

### 4.3 第三步：转 P4-C

P4-C = **单包安装事务、manifest 最后写与 vault**，是 P4 的核心 go/no-go。

- 卡：`docs/prompts/tasks/P4-C.md`
- 前置：P4-A ✅ + **P4-B（本卡，需先固化）** + P3-D ✅
- 必读：`docs/prompts/VPM-P4.md` §7、§8；`docs/VPM-ARCHITECTURE.md` §5、§6.1；
  `docs/VPM-IMPLEMENTATION-GUIDE.md` 对应节
- 覆盖对账项：`B4/B5/B6/B8/B19/B22/B25/B29/K4/K5`
- 你会直接用到的现成件：
  - `OperationStore`（P4-A，状态机 + journal）
  - `PackageCacheService.ensurePackage()`（P4-B，拿包到本地）
  - `extractPackageZip()`（P4-B，安全解压到 `.atrium-tx/<op>/install/<pkg>`）
  - `plan` 产物（P3-C/D，planId + manifestHashBefore）

**P4-C 绝不能做的事**（规划 §8.1 + 硬约束）：
- manifest 必须是**最后一步**原子写；写成功前任何失败都要能回到旧状态。
- 旧包目录 → `.atrium-tx/<op>/trash/` 用**同卷 rename**（不用 `Temp`，避免 Unity 清理现场）。
- Unity 运行中 → **拒绝改包**（比 ALCOM 保守，刻意的）。
- `com.avca.bridge` 是受保护包：不升级/不卸载/不覆盖。
- 不手写 `.meta`。
- 不信任渲染层传的 Plan 内容，只接受 `planId + manifestHashBefore` 重新校验。

---

## 5. 环境与坑（省得下个工作站重新踩）

| 坑 | 说明 |
|---|---|
| `npm.ps1` 被执行策略禁止 | 在 PowerShell 里用 `npm.cmd` / `npx.cmd` |
| 全量测试 PowerShell 报 `exit code 1` | Vite CJS 警告走 stderr，**不是失败**，看 `Test Files` 行 |
| 全量测试约 3 分钟 | 别以为卡死了 |
| `native:node` / `native:electron` 切 ABI | 跑 `npm test` 会切到 Node ABI；之后再 `npm run dev` 会重新切回 |
| 项目路径含中文 | `C:\程序\A素材管家`，shell 里注意引号 |
| 真机沙盒规则 | `AVCA_APP_HOME` 必须含 `avca`/`sandbox` 且带 `AVCA_REQUIRE_SANDBOX_HOME=1`；**绝不用 `E:\vrc\A`、`E:\Atriumdate`、`%APPDATA%\A\library.db` 做试验**（规划 §12.4） |
| Unity 版本 | 真机一律 **2022.3.22f1**；不要 `taskkill /F /IM Unity.exe`（会误杀 Hub），按 PID 杀 |
| 数据根 | 必须**非 C**；没有合法数据根就不启用 VPM，**不提供"临时放 C"后门** |

---

## 6. 版本与阶段位置

- `package.json` = **0.9.0**（开发线，P9 才发正式 Release）
- 已完成：P0、P1（A–E）、P2（A–E）、P3（A–D）、**P4-A**
- 进行中：**P4-B**（代码完成 / 待固化收尾）
- 下一张：P4-C
- VPM 目前**默认关闭**，核心行为不变；每个合并阶段构建并更新本机安装版

---

## 7. 如果只能记三件事

1. **先 `git checkout -b` + commit，别先改代码** —— 工作区有 6 个未跟踪新文件，丢了就没了。
2. **P4-B 代码是好的，别重写** —— 44 个 P4-B 用例 + 全量 2378 用例全绿，typecheck 干净。
   你只需要补 README、改任务板、提 PR。
3. **P4-C 的底线是"manifest 最后写"** —— 这一条决定整个 P4 是不是 go。
