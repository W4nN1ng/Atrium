# P4 未验证项验证报告

> 写于 **2026-10-22 16:45**。对应 P4-B / P4-C / P4-D 三份交接文档里的"未验证"清单。
>
> 全部验证都是**无头**的：`vite-node` 脚本 + vitest，不启动 Electron、不开 Unity、不弹任何窗口。
> 需要 GUI 的项在 §10 单列，给出可直接执行的步骤，由用户自己跑。

---

## 0. 一页结论

| 原未验证项 | 现在 | 证据 |
|---|---|---|
| 真实仓库下载 | ✅ 已验证 | 官方 `com.vrchat.base@3.7.0`，13.82 MiB，SHA-256 与仓库一致（§2） |
| 真实包解压 | ✅ 已验证 | 936 条目 / 32.09 MiB / 519 个 `.meta`（§3） |
| `statfsSync` 真机行为 | ✅ 已验证 | C/D/E 三块真实盘都返回可用字节（§4） |
| 长路径 >260 | ✅ 已验证 | 248/374 字符可操作；≥260 被策略拒绝（§5） |
| rename 被占用（EBUSY/EPERM） | ✅ 已验证 | 只读文件 → EPERM；目录是别的进程 CWD → EBUSY（§6） |
| 跨进程并发 | ✅ 已验证，**并修了一个 bug** | 两个真实进程只有一个能建操作（§7） |
| 进程崩溃后恢复 | ✅ 已验证 | 子进程 `exit(37)` 后新进程恢复成功（§8） |
| 配额与 `vpm_cache_entry` 一致性 | ✅ 已验证，**并修了一个 bug** | 24 包并发 + 小配额，孤儿行 0（§9） |
| manifest rename 与 journal 标记之间崩溃 | ✅ 已验证 | 磁盘 hash 对账 + 真实进程死亡两条路径（§8） |
| 真 Unity 沙盒装包 | ❌ 需要 GUI | 见 §10 的现成步骤 |
| `.atrium-tx` 是否被 Unity 忽略 | ❌ 需要 GUI | 同上 |
| Electron `net` 传输 | ❌ 需要 Electron 进程 | 按"不弹窗"要求不启动；§10 有说明 |
| 真断电 | ❌ 不可测 | 只验证了进程被杀（§8） |
| 真实包走完整事务 | ⚠️ 脚本就绪、网络被限流 | `tools/verify-p4/real-transaction.ts`（§10.3） |

**结论：能无头验证的都验证了；剩下 3 项必须开 Unity/Electron，1 项物理不可测。**

---

## 1. 环境与方法

```
OS      Windows_NT 10.0.26200 x64，16 核 / 15.2 GB
Node    v22.22.2
网络    经本机 HTTPS 代理（HTTPS_PROXY），非直连
数据根  系统临时目录（验证用，不是真实数据根）
```

- 所有脚本在 `tools/verify-p4/`，用 `npx vite-node <脚本>` 运行。
- 所有用例都用**真实字节**：真实 zip、真实 NTFS、真实多进程；只有"包源"在压力测试里用假端口。
- 没有启动 Electron、Unity、浏览器或任何窗口。

---

## 2. 真实仓库下载 + hash + 缓存

`npx vite-node tools/verify-p4/real-package.ts`

```
✓ 索引返回 200 且能找到包 — com.vrchat.base@3.7.0
✓ 下载完成且 SHA-256 与仓库一致 — 93a5686b5351660e63f4ea6bfedd68e98aeb4c17cfaf84be89e29af47c9af857
✓ 落盘大小 > 0 — 13.82 MiB / 2.7s（另一次 8.6s）
✓ 缓存路径是 <cache>/packages/<前两位>/<sha>.zip
✓ 首次是下载而不是复用
✓ 第二次标记为 reused
✓ vpm_cache_entry 有一行 — size 14490321, sourceHost release-assets.githubusercontent.com
```

覆盖：真实 HTTPS（含 302 重定向到 release-assets）、边写边算 SHA-256、与仓库 `zipSHA256` 比对、
内容寻址落盘、命中缓存后**完整重算**、`vpm_cache_entry` 记账。

> 说明：验证用的是 Node `https` + CONNECT 隧道实现的 `VpmHttpTransport`（与 Electron 适配器同一契约），
> 不是 Electron `net` 本身——见 §10.2。

---

## 3. 真实包解压

同一脚本的第 4、5 步，输入是官方仓库的真实 zip：

```
✓ 识别到包根
✓ name/version 与期望一致 — com.vrchat.base@3.7.0
✓ 条目数与字节数 > 0 — 936 entries / 32.09 MiB
✓ package.json 的 name/version 与目录一致
✓ package.json 带依赖声明 — dependencies: com.unity.burst, com.unity.collections, ...
✓ package.json 带 unity 版本约束 — 2022.3
✓ 保留了 .meta 文件 — 519 个 .meta
✓ package.json.meta 存在且非空
```

覆盖：真实包的单层/多层目录、`package.json` 身份校验、`.meta` 原样保留、936 个条目的路径语义。
另外确认了官方包用的是 `dependencies`（Unity 包）而不是 `vpmDependencies`，解析器不会把它们当 VPM 依赖拉。

---

## 4. `statfsSync` 真机行为

`npx vite-node tools/verify-p4/environment.ts`

```
C:\          free 12.5 GiB / total 125.0 GiB
D:\          free 41.1 GiB / total 351.6 GiB
E:\          free 18.4 GiB / total 476.9 GiB
os.tmpdir()  free 12.5 GiB
```

结论：预检的空间判断有真实数据来源；`bavail × bsize` 与资源管理器口径一致。
（P4-B 之前只用夹具注入 `availableBytes`，现在确认真盘上也能拿到值。）

---

## 5. 长路径（>260）

| 场景 | 结果 |
|---|---|
| 248 字符目录：`mkdir` / 写文件 / `rename` | ✅ 全部成功 |
| 374 字符目录：`mkdir` / 写文件 | ✅ 成功（本机已启用 LongPathsEnabled） |
| 解压目标绝对路径 ≥ `maxPathLength(260)` | ✅ 干净拒绝 `vpmArchiveUnsafePath` |

结论：

- **260 是我们的产品策略，不是 Windows 限制**。本机允许 374 字符，说明未来可以按需放宽；
  但 Unity 自身在 260 附近仍有兼容问题，所以 P4 保持保守拒绝是刻意的。
- 超长路径是"拒绝"而不是"写一半"，符合"宁可不动，不可半成品"。

---

## 6. rename 被占用（真实 EBUSY / EPERM）

| 场景 | 真实结果 | 事务行为 |
|---|---|---|
| 目标文件只读（`chmod 444`） | `rename` → **EPERM** | 重试后失败 → 回滚，manifest 逐字节不变，旧包回原位（`failure-injection.spec.ts`） |
| 目标目录是另一个进程的 CWD | `rename` → **EBUSY** | 重试后失败 → `failed`，工程未改动（`failure-injection.spec.ts`） |

两条用例都是真实文件系统错误，不是注入的假异常。它们证明退避重试与"失败就回滚、绝不强删"的路径在真机上会触发。

---

## 7. 跨进程并发（**发现并修复一个 bug**）

`tests/vpm/install/process.spec.ts` 用 `vite-node` 起两个**真实 Node 进程**，同时给同一工程建操作。

**修复前**：输的一方拿到裸的 `SQLITE_BUSY`——因为两个连接都先读后写（deferred → write upgrade），
SQLite 为避免死锁会立刻返回 BUSY，`busy_timeout` 不生效。

**修复**（`install/state.ts`）：

- 新增 `isBusy()` 识别 `SQLITE_BUSY` / `SQLITE_LOCKED`；
- `create` 的写事务遇到 busy 立即重试一次；
- 仍失败则映射成 `vpmProjectBusy`，调用方不需要认识 SQLite 错误码。

**修复后**：

```
✓ 两个进程中恰好一个 ok:true，另一个 vpmProjectBusy
✓ 父进程能看到子进程写下的那一行
```

---

## 8. 真实进程死亡 + 恢复

`tests/vpm/install/process.spec.ts` 的子进程跑到 `move-in:item:after` 直接 `process.exit(37)`：
不关数据库、不清事务区、不写收尾状态。

```
✓ 子进程退出码 37
✓ 操作停在 applying（新包已就位、旧包在事务区）
✓ 新进程 scan() 判定 rollback / before_commit
✓ 恢复后 rolled_back，包回到 1.0.0，manifest 与操作前逐字节一致
```

另外在 vitest 里覆盖了 **rename 与 markCommitPoint 之间的崩溃窗口**：
journal 还写 `before`、磁盘 manifest 已是 `afterHash` 时，恢复判定 `complete` 并补写提交点
（`recovery.spec.ts` 的 "detects the rename-without-commit-point window"）。

---

## 9. 缓存一致性压力（**发现并修复一个 bug**）

`npx vite-node tools/verify-p4/cache-stress.ts`：24 个包、并发 8、配额只有 4 个包大小。

**修复前**：

```
行数 17，磁盘文件 3，孤儿行 14
```

原因：`commitDownload` 落盘后要 `await verifyFile()`（异步、要读完整个文件），
在这个窗口里另一条下载链路的 `evictTo` 可能把文件删掉；随后本链路仍然 `entries.upsert`，
于是留下"有行没文件"的孤儿记录。

**修复**（`cache/service.ts`）：

1. `entries.upsert` 提到 `evictTo` 之前（行与文件在同一 tick 内成对变更）；
2. upsert 前再确认文件还在：不在就删行并抛 `vpmCacheQuotaExceeded`，绝不为不存在的文件写行。

**修复后**：

```
成功 10，拒绝 14（全部是 vpmCacheQuotaExceeded）
行数 3，磁盘文件 3，孤儿行 0，无行文件 0，残留 .part 0
配额 33 KiB，实际占用 25 KiB
✓ 被淘汰的包可以重新下载并校验通过
```

**已知取舍**：并发下载数 × 包大小 > 配额时，部分下载会被拒绝（`vpmCacheQuotaExceeded`）。
这是可解释的错误，不是数据损坏；真实配额 20 GiB、事务内串行下载，不会触发。
（修复前这些下载"成功"了，但返回的是已被删掉的路径——更糟。）

---

## 10. 仍然无法验证的

### 10.1 需要真 Unity（P4-E 的出门条件）

三件事只能在 Unity 里看：

1. 装包后 Unity 能否正常打开、无编译/包错误；
2. `.atrium-tx` 目录是否被 Unity 忽略（会不会被清理掉）；
3. 旧 Assets 清理后 Unity 是否报丢失引用。

现成步骤（用户自己执行，我不代跑）：

```powershell
# 1) 准备沙盒（数据根必须非 C，AVCA_APP_HOME 必须含 avca/sandbox）
$env:AVCA_APP_HOME = 'E:\avca-sandbox\app'
$env:AVCA_REQUIRE_SANDBOX_HOME = '1'

# 2) 用打包版打开沙盒工程（Unity 2022.3.22f1），关掉 Unity
# 3) 在"项目与包"里预览并应用一个真实包（如 com.vrchat.base 3.7.0）
# 4) 打开 Unity，确认 Console 无包错误、Packages/com.vrchat.base 存在
# 5) 关 Unity → 卸载 → 确认包目录消失、回滚仓有副本
# 6) 检查工程根目录下的 .atrium-tx 是否还在（Unity 是否忽略它）
```

### 10.2 Electron `net` 传输

生产用的是 Electron `net.request`（走系统代理）。按"不弹窗"的要求，我没有启动 Electron 进程。
真实下载验证用的是同一 `VpmHttpTransport` 契约下的 Node 实现（§2），
覆盖了重定向、超时、流式写盘与 hash，但**没有覆盖 Electron 的代理/证书行为**。
要补这一项，需要在 Electron 里跑一次 `runtime.packageCache.ensurePackage(...)`（会有窗口，用户自行决定）。

### 10.3 真实包走完整事务

`tools/verify-p4/real-transaction.ts` 已经写好：真实包 → 装 → 卸 → 重装，并校验
`Packages/`、manifest、journal、回滚仓文件数。这次跑到第 2 步时，下载被本机代理限流
（`vpmHttpNetwork`，之前连续下了 3 次 14 MB），脚本本身没问题。

复现（网络恢复后）：

```powershell
npx vite-node tools/verify-p4/real-transaction.ts
# 网络仍不稳时，可先用 curl 下好 zip，再喂给脚本：
$env:VERIFY_ZIP = 'D:\tmp\com.vrchat.base-3.7.0.zip'
npx vite-node tools/verify-p4/real-transaction.ts
```

### 10.4 真断电

只验证了"进程被杀"（§8）。断电涉及磁盘缓存/WAL 的持久化语义，本机无法安全模拟，
需要真实断电或虚拟机强制断电才能测。

---

## 11. 复现命令

```powershell
# 全部无头，不会弹窗
npx vite-node tools/verify-p4/environment.ts     # statfs / 长路径 / 只读 rename
npx vite-node tools/verify-p4/real-package.ts    # 真实下载 + 真实解压（需要网络）
npx vite-node tools/verify-p4/cache-stress.ts    # 并发 + 配额 + 一致性（离线）
npx vite-node tools/verify-p4/real-transaction.ts # 真实包走完整事务（需要网络）

npx vitest run tests/vpm/install/process.spec.ts        # 跨进程锁 + 真实进程死亡
npx vitest run tests/vpm/install/failure-injection.spec.ts # 含真实 EPERM/EBUSY
```

---

## 12. 本次验证带来的代码改动

| 文件 | 改动 | 原因 |
|---|---|---|
| `src/main/vpm/install/state.ts` | `isBusy()` + `runWrite()`：SQLITE_BUSY 重试一次并映射 `vpmProjectBusy` | 跨进程并发时裸 SQLITE_BUSY 泄漏给调用方 |
| `src/main/vpm/cache/service.ts` | upsert 提前 + 文件存在性复查 | 并发淘汰产生"有行没文件"的孤儿记录 |
| `tests/vpm/install/process.spec.ts` | 新增 | 真实跨进程锁 + 真实进程死亡恢复 |
| `tests/vpm/install/fixtures/*.ts` | 新增 | 上面两个用例的子进程脚本 |
| `tests/vpm/install/failure-injection.spec.ts` | +2 例 | 真实 EPERM（只读 manifest）与真实 EBUSY（目录被占用） |
| `tests/vpm/install/harness.ts` | 暴露 `dbFile` | 子进程需要同一个库文件 |
| `tools/verify-p4/*` | 新增 | 可复现的验证脚本 |

全量回归见提交信息；`npm run typecheck` exit 0。
