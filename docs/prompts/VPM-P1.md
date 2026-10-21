# VPM-P1 执行提示词：纯逻辑核心、仓库与只读包目录

> **执行入口（2026-10-21 起）**：本文件是 P1 阶段规格，不是一次执行的任务。
> 请按 [`tasks/P1-*.md`](tasks/) 的任务卡逐个执行；本文件只查阅任务卡列出的章节。
> 任务板：[`../VPM-TASKS.md`](../VPM-TASKS.md) · 共同规则：[`_COMMON.md`](_COMMON.md) · 架构：[`../VPM-ARCHITECTURE.md`](../VPM-ARCHITECTURE.md)。

> 前置：P0 已合并，`pre-vpm` 标签存在，VPM 默认关闭且可停用。
> 必读：`AGENTS.md`、`docs/VPM-MERGE-PLAN.md`、`docs/VPM-CLEANROOM.md`、
> `docs/VPM-PARITY.md`、`docs/VPM-IMPLEMENTATION-GUIDE.md` §1、§2、§11。
>
> 本阶段只做"读"：版本/范围/manifest/仓库解析 + 仓库管理 + 包目录浏览。
> **不写任何 Unity 工程，不安装包，不建工程。**

---

## 1. 开始前

```bash
git fetch origin
git switch -c codex/vpm-p1-core-repos origin/main
```

记录 P0 的 `pre-vpm` SHA、当前 HEAD、全量测试基线。

---

## 2. 本阶段目标

1. 建立 VPM 的**纯逻辑核心**：版本、范围、Unity 版本、包名、`vpm-manifest.json`、仓库 JSON。
2. 建立**独立的 `vpm.db` v1**：仓库与包版本索引。
3. 建立唯一的 **HTTP 客户端**：HTTPS、重定向、超时、大小、ETag、请求头。
4. 建立**仓库管理**：官方/curated、添加、刷新、错误隔离、离线旧数据。
5. 建立**只读包目录**：搜索、筛选、包详情、版本、来源、Unity 兼容、yanked。
6. 首次联网同意；无同意不请求。

---

## 3. 明确不做

- 不安装/卸载/升级包；不写 `Packages/`、不写 `vpm-manifest.json` 到工程。
- 不做依赖解析/变更计划（P3）。
- 不做工程创建/模板/备份（P5/P6）。
- 不读 Unity 工程（P2）。
- 不写 VCC；不接深链（P7）。
- 不建 `library.db` 表；不动 `SCHEMA_VERSION`。
- 不把仓库 JSON、包、图标提交进仓库。

---

## 3.5 本阶段实现解剖（ALCOM → Atrium）

**ALCOM 的关键机制（行为/架构观察）**

- 环境里维护一个**仓库持有器**：预置 official/curated，用户仓库来自 VCC 设置；
  每个仓库缓存成 `Repos/<id>.json`，启动先读缓存，联网后按 ETag 并行刷新；
  304/失败保留旧缓存，绝不因为一次刷新失败把目录清空。
- 所有远程仓库 + 本地包目录合并成一个**包集合**（package collection）：
  查包时在同名版本里选最高；curated 靠仓库 id 识别；同版本多来源不做严格优先级。
- 包的版本信息不是一个扁平字符串，而是一个**版本对象**：显示名、描述、Unity 下限、
  `zipSHA256`、`vpmDependencies`、legacy 路径、yanked 等。下载缓存按包名/版本存放，
  并在旁边记录 hash。
- 范围/版本/Unity 版本各有独立的解析类型；`dependencies` 的值是
  `{ version: <范围> }` 对象，`locked` 才是精确安装快照。

**Atrium 的独立实现**

- 用 `vpm_repo` + `vpm_repo_package` 两张表代替"目录里一堆 JSON 文件 + 内存集合"：
  仓库表存 URL/启用/排序/ETag/错误/加密头；包表一行一个版本，存规范化后的 manifest。
- **刷新事务**：HTTP 成功 → 完整解析校验 → 在事务里 `DELETE` 该仓库旧包行、
  批量插入新行、更新 ETag；任何一步失败回滚，旧行原样保留。
- 包目录查询由 SQL 完成过滤/搜索，内存里做版本选择；同版本多来源要保留来源与 hash，
  hash 不一致标冲突，不静默取最后一个。
- 纯逻辑放 `src/shared/vpm/`，不 import Electron/Node：`semver` 只当语法/比较底座，
  VPM 的"单版本=精确、预发布策略、yanked 过滤"由我们自己的适配层决定。
- `headers` 在解析后立刻从 manifest 剥掉，绝不写进 `manifest_json`；仓库级头先留空列，
  P7 再做加密存储。
- 包本体不进仓库缓存：P4 才落到内容寻址的 `<dataRoot>/cache/packages/<ab>/<sha>.zip`。

**施工顺序**

1. 纯解析器：版本/范围/Unity 版本/包名/manifest/仓库 JSON + 表驱动测试。
2. `vpm.db` v1 建表/迁移/事务替换，先测"刷新失败旧数据还在"。
3. HTTP 客户端：HTTPS、重定向、超时、大小上限、ETag/304、错误码。
4. 仓库服务：刷新、错误隔离、离线状态；再接只读目录 UI。
5. 最后接 IPC/设置页入口；此时仍不允许任何安装/写工程路径。

**最容易做错**

- 先删后插且不在事务里 → 断网刷新一次，用户目录全空。
- 把 `zipSHA256` 当可选 → 安装阶段无法验完整性；没 hash 的版本只能展示。
- 把包级 `headers` 原样塞进 `manifest_json` → token 明文落库。
- 把 `dependencies` 的裸字符串直接写回 → VPM 读不了；写回必须是对象。
- 刷新所有仓库共用一个失败状态 → 一个坏仓库让其他仓库也显示失败；错误必须按仓库隔离。

**详细内容**：`docs/VPM-IMPLEMENTATION-GUIDE.md` §1、§2、§11。

---

## 4. 依赖与文件

### 4.1 新增依赖

- `semver`（ISC）+ `@types/semver`（dev）：只用于语法解析/比较；
  **VPM 的候选选择、预发布偏好、锁定策略由我们自己实现。**
- 不引入 `vrc-get`/ALCOM 的任何包。
- 更新 `THIRD-PARTY-NOTICES`（没有就创建），写清许可证/版本/用途。

### 4.2 纯逻辑（`src/shared/vpm/`）

```text
version.ts        解析/比较 VPM 版本；预发布/build 元数据
range.ts          解析/判断范围；单版本=精确；支持 ^ ~ >= <= > < x * || 连字符
unityVersion.ts   解析/比较 Unity 版本；部分版本（2022.3）；f/p/c 变体
packageId.ts      包名校验/归一；拒绝路径分隔符、..、控制字符、保留名
manifest.ts       vpm-manifest 读取/写出（保留未知字段）
repo.ts           仓库 JSON 解析/校验/归一
errors.ts         VpmErrorCode + i18n key 映射
```

要求：

- 全部是纯函数，不 import Electron/Node 文件系统；可在 Vitest 直接跑。
- 所有入口对输入做防御；错误返回 code，不抛中文。
- 版本号比较遵循 SemVer 2.0；预发布 < 正式；build 不参与比较。
- VPM 范围：单版本视为精确匹配；范围支持常见写法；**不明确/不支持的写法给
  `vpmRangeInvalid`，不猜**。范围字符串长度设上限（例如 256），避免 pathological 输入。
- Unity 版本：`YYYY.MINOR.PATCH[abfp]N`，允许部分版本；中国版 `c1` 后缀保留显示，
  兼容比较按基础版本处理；`f` 为正式，`p` 为补丁高于 `f`。
- 包名：小写字母/数字/点/连字符/下划线；不能以点开头、不能含 `..`；
  与 Windows 保留名/尾点/尾空格冲突的拒绝。
- `manifest.ts`：
  - 形状：

    ```json
    {
      "dependencies": { "com.example.pkg": { "version": "1.2.3" } },
      "locked": { "com.example.pkg": { "version": "1.2.3", "dependencies": { "com.other": ">=1.0.0" } } }
    }
    ```
  - `dependencies` 的值是对象，不是裸字符串；兼容读取裸字符串但写回对象。
  - 未知顶层字段、未知条目字段**保留**（不要因为序列化丢用户数据）。
  - 接受 UTF-8 BOM；拒绝非法 JSON/非对象/版本非法；错误码明确。
  - 序列化稳定：2 空格缩进、LF、末尾换行；新增条目按名称排序；已有顺序尽量保留。
- `repo.ts`：
  - 结构：`{ name?, id?, url?, packages: { [name]: { versions: { [version]: versionObj } } } }`。
  - 版本对象关键字段：`displayName`、`description`、`unity`、`url`、`zipSHA256`、
    `vpmDependencies`（兼容别名 `dependencies`）、`legacyFolders`、`legacyFiles`、
    `legacyPackages`、`changelogUrl`、`documentationUrl`、`keywords`、`headers`、
    `vrc-get`（yanked/aliases 等）。
  - yanked 可能是 `true`/`false`/字符串（原因）；解析成 `{yanked, reason}`。
  - hidden/deprecated 可能在顶层或 `vrc-get` 子对象；两处都兼容，值不合法就忽略并 warning。
  - 单个坏版本不要炸整仓：跳过并计数/给 warning；仓库级坏 JSON 才整体失败。
  - 限制：仓库 JSON ≤16 MiB；包数 ≤20,000；单包版本 ≤500；字符串长度上限。
  - 包名/版本/URL/hash 校验；`zipSHA256` 归一为小写；不合法 → 该版本标记不可安装，但可显示。
  - 不做"猜测 URL"：没有 zip URL 或 hash 的版本，安装阶段会拒绝；目录可显示。
  - 仓库/包级 `headers` 可能含 token：P1 **解析后立即从 `manifest_json` 里剥离**，
    不把明文落库；仓库级先留 `headers_enc` 空列，P7 再接加密存储。
    P4 下载时按仓库 + 包级合并（P7 后才支持包级头）；值不写日志。

---

## 5. vpm.db v1

新建 `src/main/vpm/db.ts`：

- 位置：`P.root()/vpm/vpm.db`（不是数据根，不是 `library.db`）。
- 连接：`better-sqlite3`；`journal_mode=WAL`；`foreign_keys=ON`；busy_timeout。
- 独立 `VPM_SCHEMA_VERSION = 1`；用 `PRAGMA user_version`。
- 迁移只在 VPM 启用时执行；迁移前若已有数据，备份到
  `P.root()/vpm/backups/vpm.db.bak-v<from>-<ts>` 并校验。
- 若 `user_version > VPM_SCHEMA_VERSION`：拒绝 VPM，status `degraded` + code，
  核心照常；**不降级/不重建**。
- 表（v1）：

```sql
CREATE TABLE IF NOT EXISTS vpm_repo (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'remote',
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  headers_enc BLOB,
  etag TEXT,
  last_modified TEXT,
  last_fetch_at INTEGER,
  last_success_at INTEGER,
  last_error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vpm_repo_package (
  repo_id TEXT NOT NULL REFERENCES vpm_repo(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  display_name TEXT,
  description TEXT,
  author_json TEXT,
  keywords_json TEXT,
  aliases_json TEXT,
  unity_min TEXT,
  zip_url TEXT,
  zip_sha256 TEXT,
  zip_size INTEGER,
  yanked INTEGER NOT NULL DEFAULT 0,
  yanked_reason TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  deprecated INTEGER NOT NULL DEFAULT 0,
  manifest_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (repo_id, name, version)
);

CREATE INDEX IF NOT EXISTS idx_vpm_pkg_name ON vpm_repo_package(name);
CREATE INDEX IF NOT EXISTS idx_vpm_pkg_version ON vpm_repo_package(version);
```

- 刷新仓库时用事务替换该仓库的包行；失败保留旧数据（不要先删后插）。
- 删除仓库时删索引；缓存/工程不动。
- 仓储函数放 `src/main/vpm/repos/`；测试用临时目录。

### 5.1 启动接线

- 新建 `src/main/vpm/index.ts`（重模块）：
  - `initVpm()`：打开/迁移 `vpm.db`，加载仓库服务，注册 P1 的 IPC；
  - `disposeVpm()`：关闭 DB、取消任务、移除事件；
  - 任一步失败 → 返回 degraded 原因，**核心继续**。
- `gate.ts` 在 `enabled && !safeMode` 时**动态 import** `./index` 并调用 `initVpm()`；
  disabled/safe mode 不加载 `index`、不打开 DB、不注册网络。
- P0 的 gate IPC 保留 `Status/Enable/Disable/PickDataRoot`；P1 的 handler 在 init 成功后
  注册/替换，不要把同一个 channel 注册两次（必要时 `ipcMain.removeHandler`）。
- 应用退出调用 `disposeVpm()`；初始化失败要能被 `Status` 看到（degraded + code）。
- 测试：disabled 时 `index` 未被 import；enabled 时 DB 建好；init 抛错时核心仍能启动。



---

## 6. HTTP 客户端

新建 `src/main/vpm/http.ts`，**所有 VPM 网络唯一入口**：

```ts
interface VpmHttpClient {
  getJson(url, opts): Promise<{ status: 200|304; body?: unknown; etag?; lastModified?; finalUrl }>
  // 必须流式写文件，不把整个包读进内存
  downloadToFile(url, destPath, opts): Promise<{ size; sha256; contentType?; finalUrl }>
}
```

- 生产实现用 Electron `net.request`（系统代理）；测试注入 fake。
- 规则：
  - 只允许 `https:`；绝对 URL；拒绝 userinfo、`file:`、`data:`、`javascript:`。
  - 最多 5 次重定向；每一跳重新校验 HTTPS；拒绝降级；
    带自定义头的请求如果跨源重定向，**停止并报错**（防 token 泄漏）；
    公开请求可跟随，但要记录最终 host。
  - 连接 15s / 空闲 60s / 总 30 分钟；可 Abort。
  - 仓库 JSON ≤16 MiB；包 ≤4 GiB；流式计数，超限中止。
  - `User-Agent: Atrium/<version>`；`Accept: application/json`（JSON 请求）。
  - 条件请求：`If-None-Match`/`If-Modified-Since`；304 不清空旧数据。
  - 自定义头只从加密存储/调用方传入；不写日志、不回渲染层。
  - URL 里不放凭据；UI 提示"私有仓库请用请求头，不要把 token 写进 URL"。
  - 不发送 Cookie；不持久化服务端 Cookie。
  - 证书校验始终开启；不提供忽略证书错误。
- 错误码：`vpmHttpBlocked`、`vpmHttpTimeout`、`vpmHttpTooLarge`、`vpmHttpStatus`、
  `vpmHttpRedirect`、`vpmHttpNetwork`、`vpmHttpInvalidJson`。
- 测试用本地 fake，不依赖公网；不要为了测试在生产允许 HTTP。

---

## 7. 联网同意

- 在 `vpm-settings.json` 的 `networkConsentAt`（P0 已留字段）记录同意时间。
- 第一次需要网络时弹一次模态：
  - 会访问：VRChat 官方/curated 仓库 + 你添加的仓库；
  - 无遥测、无崩溃上报、无后台扫描；
  - 缓存/回滚仓/备份在非 C 数据根；
  - 可以拒绝；拒绝后只能看缓存/本地。
- 同意后才：
  - 种子官方/curated（如果仓库表为空）；
  - 允许刷新/下载；
  - 不做"每次启动自动刷新"；最多在打开包目录且数据过期时后台刷新一次。
- 没有同意时，任何 `getJson/download` 调用都返回 `vpmNetworkNotConsented`；
  加测试证明不会出站。

---

## 8. 仓库服务

新建 `src/main/vpm/reposService.ts`：

- `listRepos()`：名称、URL host、启用、排序、包数、上次成功/错误。
- `addRepo({url,name?})`：
  - 归一 URL（去 fragment；保留 query）；
  - 去重（同 URL 大小写/尾斜杠归一后）；
  - 插入后尝试刷新；失败保留条目 + 错误码；
  - 不自动启用未同意网络。
- `refreshRepo(id)` / `refreshAll()`：
  - 条件请求；解析；事务替换包行；更新 etag/last_modified/last_success；
  - 304 只更新时间，不动包；
  - 失败保留旧数据，记录错误；
  - 并发 ≤2；每仓库独立错误。
- `removeRepo(id)`：二次确认；删索引；不动缓存/工程。
- 官方/curated：
  - URL：`https://packages.vrchat.com/official?download`、
    `https://packages.vrchat.com/curated?download`；
  - 首次同意且仓库表为空时加入；名称可由 JSON 覆盖；
  - 顺序：official 0、curated 1；用户仓库往后。
- 同名包/版本多源：
  - 目录显示来源；
  - 解析阶段（P3）按仓库顺序优先；P1 只做展示与去重提示；
  - 同版本不同 hash 要标记冲突，不能静默选一个。
- 搜索/别名：
  - 支持包名、显示名、关键词、`vrc-get.aliases`（如果仓库提供）；
  - 别名只用于搜索，不改变包身份；
  - 不复制 ALCOM 的别名表；只读仓库元数据。

---

## 9. IPC 与 UI（只读）

### 9.1 IPC

在 `IpcInvoke.Vpm` 增加：

```text
ReposList, RepoAdd, RepoRemove, RepoRefresh, RepoRefreshAll,
NetworkConsent, NetworkStatus,
CatalogQuery, PackageDetail, PackageVersions
```

- 所有参数主进程再校验；URL 只接受 HTTPS。
- 长任务（refresh）返回 `{started:true}` 或 operationId；事件
  `vpm:repo-progress`、`vpm:repo-done`；同时提供 `ReposList` 拉取式状态。
- 进度节流 ≥100ms；不要每个包发一条 IPC。

### 9.2 UI

在设置 → 项目与包：

- 仓库区：
  - 列表：名称、host、包数、上次成功、错误、启用开关；
  - 主按钮"添加仓库"；每行溢出：刷新/移除；
  - "刷新全部"是文字按钮，不是第二个实心按钮；
  - 排序/编辑名称/请求头/导入导出在 P7，本阶段不提前做。
- 浏览区：
  - 主按钮"浏览包"打开抽屉；
  - 搜索框 + 筛选（已安装/可更新/全部；P1 还没有工程，禁用"已安装"并说明 P2）；
  - 列表：显示名、包名、最新版本、来源、Unity 最低版本、yanked/隐藏标记；
  - 详情侧栏：描述、版本列表、changelog/docs 链接（点击前确认外链）、来源；
    外部描述按纯文本渲染（不执行 HTML/Markdown 脚本），清洗控制字符；
  - 不提供安装按钮（P1 明确显示"安装将在下一阶段"或隐藏）。
- 联网同意模态；拒绝后看到"仅缓存模式"。
- 首次空状态：一个主按钮"添加仓库"或"使用官方仓库"（需同意）。
- 所有文案三语；主进程只给 code。
- 不新增顶级导航；设置页签保持轻量。

---

## 10. 测试

新增：

```text
tests/vpm/version.spec.ts
tests/vpm/range.spec.ts
tests/vpm/unity-version.spec.ts
tests/vpm/package-id.spec.ts
tests/vpm/manifest.spec.ts
tests/vpm/repo.spec.ts
tests/vpm/db-v1.spec.ts
tests/vpm/http-policy.spec.ts
tests/vpm/repos-service.spec.ts
tests/vpm/network-consent.spec.ts
tests/vpm/catalog.spec.ts
tests/vpm/static-imports.spec.ts
```

覆盖：

1. 版本/范围：精确、^、~、比较、x/*、||、连字符、预发布、build、非法输入。
2. Unity 版本：2022.3、2022.3.22f1、f/p/c、部分版本、非法。
3. 包名：合法/非法/保留名/长名。
4. manifest：对象值、裸字符串兼容、未知字段保留、BOM、坏 JSON、稳定序列化。
5. 仓库：正常/缺字段/坏版本跳过/yanked 字符串/超大/重复/包名非法。
6. DB：建库、迁移、重启、reopen；user_version 高于代码 → 拒绝；刷新失败保留旧行。
7. HTTP：HTTP 拒绝、重定向降级、超时、大小、304、自定义头不泄漏、无同意拒绝。
8. 仓库：添加/刷新/删除/多源/hash 冲突/一个坏仓库不影响另一个。
9. 目录：搜索/筛选/版本详情/来源/隐藏/yanked。
10. 核心 `library.db` 不变；无 C 缓存；无未同意网络。
11. 静态导入：核心不加载 `vpm/http`、`vpm/db`。

安全用例：

- URL 带 userinfo、`javascript:`、`file:`、超长、非 HTTPS；
- 重定向到 HTTP；
- JSON 里 `__proto__`/原型污染（解析后只取自有字段）；
- 超深嵌套（限制深度）；
- 包名/版本里的控制字符；
- 超大字符串/包数。

---

## 11. 手工验收（沙盒）

- 用沙盒 `AVCA_APP_HOME` 和非 C 数据根。
- 启用 VPM，拒绝联网 → 目录为空/仅缓存，确认无请求。
- 同意联网 → 官方/curated 出现；刷新；看包列表/详情。
- 断网/改错 URL → 旧数据仍在，错误可见。
- 添加一个非法 URL/HTTP URL → 拒绝。
- 重启 → 仓库/缓存数据还在；没有自动刷新风暴。
- 网络请求用系统代理时能工作（如你的环境可用）。
- 如果公网不可达：记录"真实网络未验证"，用 fake HTTP 测试覆盖；不要伪造成功。

---

## 12. 质量闸门

同 P0：

```powershell
& npm.cmd test *> $env:TEMP\atrium-p1-test.log; $LASTEXITCODE
& npm.cmd run typecheck *> $env:TEMP\atrium-p1-typecheck.log; $LASTEXITCODE
& npm.cmd run build:dir *> $env:TEMP\atrium-p1-build.log; $LASTEXITCODE
```

- 真实退出码 0；数字与基线一致（新增用例会增加总数，记录实际）。
- 手工验收截图；净室检查表。
- 不发布 Release；合并后更新本机安装版（VPM 默认关闭）。

---

## 13. 完成定义

- [ ] 纯逻辑核心齐全，测试覆盖边界。
- [ ] `vpm.db` v1 独立、可迁移、可拒绝高版本。
- [ ] HTTP 唯一入口，策略测试可红。
- [ ] 仓库管理 + 只读包目录可用。
- [ ] 联网同意生效，无同意零请求。
- [ ] 官方/curated 可添加；离线旧数据可用。
- [ ] `library.db` schema 未动。
- [ ] 全量测试/类型/构建通过；截图/净室/回退证据齐全。
- [ ] PR 合并；本机安装版更新（或用户明确暂停）。
