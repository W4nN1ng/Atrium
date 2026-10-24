# Atrium 交接档案（换工作站继续开发）

> 这份文件写给**下一个接手 Atrium 的工作站/人**。目标：读完这一份，就能在这台新机器上
> 把环境跑起来、把代码接下去写、把版本发出去，并且**不重复踩已经踩过的坑**。
>
> 写于 **2026-10-17**，对应仓库状态 `main` = `15115be`，版本 **v0.7.0**（已发布）。
> 文中每一条"事实"都是读源码或本机实测来的；**没验证过的地方明确写「未验证」**，
> 不糊成"应该可以"。凡与代码冲突，**以代码为准**，并请回来改掉这份文档。

> **2026-10-21：VPM 合并已启动。** 规划见 [VPM-MERGE-PLAN.md](VPM-MERGE-PLAN.md)，
> 架构见 [VPM-ARCHITECTURE.md](VPM-ARCHITECTURE.md)，任务板见 [VPM-TASKS.md](VPM-TASKS.md)，
> 实现解剖见 [VPM-IMPLEMENTATION-GUIDE.md](VPM-IMPLEMENTATION-GUIDE.md)，
> 回退见 [VPM-ROLLBACK.md](VPM-ROLLBACK.md)。P0 之后版本线进入 **0.9.0**；
> VPM 默认关闭，独立使用 `%APPDATA%\A\vpm\`，核心 `library.db` schema 仍是 11。
> 下面“当前版本 / 主线 HEAD”那段是 2026-10-17 的旧账，以 `package.json` 和 `git log` 为准。
>
> **2026-10-23：换工作站接手 VPM，先读 [VPM-P8C-HANDOVER.md](VPM-P8C-HANDOVER.md)。**
> 那份带新机起步命令、当前进度（P8-A/B/C done，下一张 P8-D 逐行对账）、
> 未验证清单和已踩过的坑；本文档其余部分（素材管家本体）仍然有效。
>
> **2026-10-23 晚更新：P8-D/P8-E/P8-F/P9-A 已完成。** 当前 VPM 进度：P0–P8-F、P9-A done，
> P8 门禁**未签字**（`docs/VPM-PARITY.md` 124 行里 35 行目标完整但实际部分，
> 真 Unity/VCC/更新器/安装器仍是 review）。性能/可访问性见 [VPM-PERF.md](VPM-PERF.md)，
> 安全报告见 [VPM-SECURITY.md](VPM-SECURITY.md)，缺口与 P9 范围见 [VPM-GAPS.md](VPM-GAPS.md)。
> 当前全量基线 **230 files / 2790 passed / 22 skipped**；typecheck/build/worker/taskpack 0。
> 分支 `codex/vpm-p4d-failure-recovery` 仍**只在本地**，`origin/main` 停在 P4-A。
> 下面“当前版本 / 主线 HEAD”那段是 2026-10-17 的旧账，以 `package.json` 和 `git log` 为准。
>
> **2026-10-24 最新交接（0.9.1 热修复未发布）：** 先读
> [HANDOVER-2026-10-24.md](HANDOVER-2026-10-24.md)。当前分支 `codex/vpm-package-display-names`
> 领先 `origin/main` 4 个未推送提交，版本 0.9.1；v0.9.1 tag/Release 尚未创建。
> 本文档下面关于 0.9.0 的段落保留作历史账，别把“已发布 0.9.0”误读成“0.9.1 已发布”。
>
> **2026-10-24：P9-C 完成、P9-D 无界面四层已验、P9-E 发布完成。** 当前版本 **0.9.0**；
> 已合并到 `main`（PR #39，合并提交 `b433240`），tag `v0.9.0` 与
> [GitHub Release](https://github.com/W4nN1ng/Atrium/releases/tag/v0.9.0) 已创建并核对
> （2 个资产、正文与哈希一致）。P9-C/P9-E done；**P9-D 仍是 review**：
> L4 装回 0.8.0、真 Unity、真机撤销需要人工，见 [VPM-ROLLBACK-EVIDENCE.md](VPM-ROLLBACK-EVIDENCE.md) §5。
> 本机安装版已是 0.9.0（正式安装器更新，注册表与 `app.asar` 都核对过）。
> **安装器静默安装需要 `/S /currentuser`**：只带 `/S` 会停在安装模式页，文件不会落盘
> （2026-10-24 实测）。全量 **240 files / 2851 passed / 26 skipped（2877）**；
> 第一次全量唯一失败是 `tests/bridge/lockfile.spec.ts` 的 WMI 命令在并行负载下超时/失败，
> 单跑 17/17，第二次全量全绿；这是已知环境型 flake，不要把它当产品回归。

---

## 1. 三十秒速览

| 项 | 值 |
|---|---|
| 产品名 / 内部名 | **Atrium**（显示名）/ `avca`（运行时数据目录是 `%APPDATA%\A`） |
| 仓库 | `https://github.com/W4nN1ng/Atrium`（**仓库本身就是这个项目**，不是上游 fork） |
| 本地检出 | `C:\程序\A素材管家`（新工作站换成你自己的路径） |
| 当前版本 | `package.json` → **0.9.0**；`SCHEMA_VERSION` → **11** |
| 主线 HEAD | `origin/main` → `b433240`（PR #39 合并后）；旧分支 `codex/vpm-p4d-failure-recovery` 也已推送 |
| 已发布 Release | **v0.9.0**（`latest`，2 个资产）；历史 v0.2.0 / 0.3.0 / 0.4.0 / 0.4.1 / 0.5.0 / 0.7.0 |
| 技术栈 | Electron 33.4.11 + TypeScript（strict）+ React 18 + better-sqlite3 + Vitest |
| 测试基线 | **240 files / 2851 passed / 26 skipped（2877）**，0 failed；`typecheck` 干净 |
| 形态 | Windows 桌面应用；素材分析本地完成，项目与包/更新相关功能会按用户操作联网 |

一句话定位：给 VRChat 改模玩家用的**本地素材管家** —— 把下载来的压缩包/模型/服装/贴图收进来、
自动分类、打封面、一键导入 Unity 工程。**内容驱动**（读 `.unitypackage` 内部路径），
**不是** Booth 元数据驱动。

---

## 2. 先把环境跑起来（新机器第一步）

### 2.1 依赖与安装

```powershell
git clone https://github.com/W4nN1ng/Atrium.git
cd Atrium
npm install
node tools/fetch-7z.cjs        # 可选：拉 7z.exe / 7z.dll，rar 支持要用
```

> ⚠ **仓库里不含 7-Zip 二进制**。`resources/bin/7z.exe|7z.dll` 必须靠 `tools/fetch-7z.cjs` 现拉。
> 原因是 7-Zip 里的 **Rar 解码器是 unRAR freeware 许可，不允许二次分发**。没拉的话
> rar 相关功能会**明确报"解压组件不支持"**，不会假装成功 —— 这是刻意设计，别"顺手"把二进制提交进仓库。

### 2.2 ⚠ 三个必读环境陷阱（每一个都真的浪费过时间）

#### 陷阱 1：native ABI 要来回切，`npm test` 和 `npm run dev` 需要的**不是同一份** `.node`

`better-sqlite3` 是原生模块，Electron 用的 ABI 和本机 Node 用的 ABI 不同：

| 你要做的事 | 需要的 ABI | 命令 |
|---|---|---|
| `npm run dev` / 起打包版 | Electron **ABI 130** | `npm run native:electron` |
| `npm test` / `vitest` / 裸 `node` 读库 | Node **ABI 137** | `npm run native:node` |

- `npm run build` 的**最后一步**就是 `native:electron`，所以 **build 完直接跑 vitest 会炸**。
- 直接跑 `npx vitest` 而不先切 ABI，会报：
  `ERR_DLOPEN_FAILED … NODE_MODULE_VERSION 130 vs 137` —— 这不是代码坏了，是 ABI 没切。
- 正确姿势：**`npm run build` 之后要测就 `npm test`**（`test` 脚本自带 `native:node` 前置），
  测完要跑应用再 `npm run native:electron`。

#### 陷阱 2：`ELECTRON_RUN_AS_NODE=1` 会让装好的程序"启动即退出"

有些 agent / harness 环境（**包括之前那台机器**）会设 `ELECTRON_RUN_AS_NODE=1`。
带上它去起 `Atrium.exe`，Electron **退化成 Node**，进程直接就结束了 ——
**看起来像"程序崩了"，其实什么事都没有**，错误信息是 `bad option: --enable-flags` 这种。

- 起装好的程序前**必须清掉这个变量**（新开一个干净的 PowerShell 窗口通常就没了）。
- `tools/dev.cjs` 里已经有**同样的护栏**（它会自己删掉这个变量），所以 `npm run dev` 一般不受影响。
- `AGENTS.md` 里也写了这条警告。

#### 陷阱 3：`npm.ps1` 被执行策略拦住

新机器上可能直接报：

```
无法加载文件 C:\Program Files\nodejs\npm.ps1，因为在此系统上禁止运行脚本。
```

**用 `npm.cmd` 代替 `npm`**（或调执行策略）。这不是项目问题，是 PowerShell 的默认策略。

### 2.3 还有两条"只在特定操作上咬人"的

- **`docs/screenshots/*.png` 与沙盒脚本要真 Unity**：跑真机活体需要
  Unity **2022.3.22f1**（之前那台在 `E:\unity\2022.3.22f1\Editor\Unity.exe`）。
  沙盒工程、库根、`AVCA_APP_HOME` 一律**重定向到沙盒**，绝不动用户的真库。
- **`--depth=1` 克隆会留下 `.git/shallow`**，之后 `git merge` 会报
  `refusing to merge unrelated histories`。修法：`git fetch origin --unshallow --tags`。
  **新机器请直接完整克隆**，别用 `--depth=1`。

---

## 3. 常用命令（照抄即可）

```powershell
# 开发
npm run dev                 # 起开发版（内部先切 electron ABI）
npm run dev:debug           # 带 --remote-debugging-port=9222，活体脚本要用

# 质量闸门（三件都过才算数）
npm test                    # 全量测试（自带 native:node 前置）
npm run typecheck           # 两个 tsconfig 都要干净
npm run build               # test + native:electron + electron-vite build
                            #   + check-worker-deps + electron-builder --win
npm run build:dir           # 同上但不打包成 exe（快速验证用）

# 只构建不测试
npx electron-vite build && node tools/check-worker-deps.cjs
```

### 发布相关工具

```powershell
node tools/pkg-version.cjs              # 核对 asar 里的版本/许可/依赖与源码是否一致
node tools/gh-release.cjs --check       # 看远端 Release 状态（不改动）
node tools/gh-release.cjs --create      # 建 Release 并传资产
node tools/gh-release.cjs --body-only   # 只更新正文
node tools/gh-release.cjs --replace-assets
node tools/verify-release-page.cjs      # 核对发布页正文与本地文件、指纹
node tools/installed-version.cjs        # 读注册表里装好的版本
node tools/installed-version.cjs --expect=0.7.0
```

- 版本号**只有一个来源**：`package.json` 的 `version`。`tools/gh-release.cjs` 从那里读。
- Token 来源：环境变量 `GH_TOKEN`，否则 `git credential fill`（Windows 凭据管理器里
  存的是 `git:https://github.com`，用户 `W4nN1ng`，`gho_` 前缀，scopes 含 `gist/repo/workflow`，有 admin+push）。
- **这台机器没有 `gh` CLI**，所有 GitHub 操作走 **REST + token**，别去写 `gh release ...`。

---

## 4. 代码地图（`src/`）

```
src/
├── main/                 主进程（Node 侧，一切有副作用的事都在这）
│   ├── db/               SQLite：schema.ts（迁移表）/ index.ts（migrate 运行器）/ repos/*
│   ├── ingest/           摄取：读 .unitypackage 内部路径、抽单元、入库（api.ts 是核心）
│   ├── import/           导入 Unity 工程：冲突预扫描、导入、备份、撤销
│   ├── bridge/           ⇄ Unity 桥接协议（A 侧）
│   ├── covers/           封面：生成任务、缩略图、assetRoot 解析
│   ├── classify/         本地分类（词典 + 规则）
│   ├── search/           MiniSearch 索引、拼音/假名/别名
│   ├── library/          库操作：commit / sidecar / mergeSuggest / rebundle / reanalyze / health
│   ├── project/          Unity 工程发现、运行状态判别（三路取并集）
│   ├── security/         路径安全（绝对性、系统目录、zip-slip、自摄检测）
│   ├── ipc/              IPC handler（全部走 {ok,data|error} 信封）
│   ├── services/         paths / settings / categories 等基础设施
│   └── unpack/           解压（zip / rar / 7z / 嵌套压缩包）
├── preload/              只暴露 window.a 白名单
├── renderer/             React 界面
│   ├── pages/ components/ stores/(zustand) lib/ i18n/
└── shared/               主/渲染共享的纯逻辑（api.ts 类型契约、ipc.ts 频道名、各种 *State.ts）
```

**分层纪律**：`shared/` 必须是**纯逻辑**（能直接单测）；有副作用的事一律在 `main/`；
渲染层只通过 `window.a` 说话。

---

## 5. 数据库与迁移（最容易出人命的地方）

### 5.1 机制

- 迁移表：`src/main/db/schema.ts` 里的 `MIGRATIONS: Migration[]`，
  每个元素是 `{ version, sql, post? }`。
- 运行器：`src/main/db/index.ts` 的 `migrate(db)` —— 在一个事务里，把所有
  `version > user_version` 的迁移按序重放，成功后写 `user_version`。
- **加迁移必须同步 `SCHEMA_VERSION`**（现在是 **11**）。

### 5.2 🔴 五条硬规矩

1. **已发布的迁移号永远不许改、不许复用。** 曾经踩过：团队那边先占了 V9
   （`cover_task_backup` 表），我这边也写了 V9（删 `needs_review`）→ 合并时号冲突。
   最后**保留团队的 V9，把自己的改成 V10**。
   **新工作站如果要从别的分支开写，务必基于 `15115be` 或更晚，避免又一次撞号。**
2. **"只增不改不删"这条规矩已经被破过一次，就一次**，在 **V10**（删 `needs_review` 列），
   schema.ts 头部有注释记着。**别把它当成先例随便破。**
3. **纯 SQL 的列删除会炸重放。** `ALTER TABLE asset DROP COLUMN needs_review` 写成纯 `sql`
   时，一旦有测试手工把 `user_version` 设回 7 再重放，就会
   `no such column: needs_review` → **整个迁移事务回滚**。
   修法：把 drop 挪进**带 `PRAGMA table_info` 守卫的 `post`**。
4. **迁移里注释不许出现反引号**：V9 的 SQL 注释里带了反引号，直接把解析搞崩，
   报 12 条 `TS1005 ',' expected`。
5. **列被删掉之后，行对象上的多余键是安全的**：`upsertAsset` 用的是固定
   `ASSET_COLUMNS` 列表（`ASSET_COLUMNS.map(c => row[c])`），
   row 上多出来的键（比如旧 journal 里的 `restore.row`）**会被忽略**。
   这就是当初删列敢下手的原因 —— 但**别把它当万能**，新增列仍然要进 `ASSET_COLUMNS`。

### 5.3 迁移历史（当前）

| 版本 | 内容 |
|---|---|
| … | 略（见 schema.ts） |
| **V9** | `cover_task_backup` 表（**团队的功能**：「一键全库更新封面」的后备账） |
| **V10** | 移除「待复核」：`DROP INDEX IF EXISTS idx_asset_review;` + 守卫式 drop column |
| **V11** | `post: repairInheritedHashes` —— 修「封面全变成同一张」的数据修复 |

**V11 到底做了什么**（力气管住别误解）：清掉**被 ≥2 行共用**的 `hash_xxh64`，
以及指向该 hash 的 `cover_image = 'athumb://<hash>.jpg'`。
**绝不碰用户自己选的封面**（`cover-<ulid>` 这种 key）。
**已知局限**：单行继承来的 hash 和正常 hash **无法区分**，所以那部分不动 —— 这是刻意的，不是漏做。

---

## 6. 产品硬约束（🔴 永远不许违反）

这几条是**这个产品的底线**，任何"顺手优化"都不许碰：

1. **永不永久删除。** 删文件一律走回收站（`shell.trashItem`），
   **绝不用 `fs.unlink` / `rm` 真删用户的素材**。
2. **绝不手写 `.meta` 文件。** `.meta` 必须由 Unity 自己生成。
   （曾经在沙盒夹具里手写过只带 `fileFormatVersion` 的 `.meta`，真 Unity 直接
   `does not have a valid GUID` 整条忽略 → 文件铺进去了但 `createdGuids` 是空的，
   看着像 A 的账坏了。后来生成器改成写 `fileFormatVersion: 2\nguid: <目录名>`。）
3. **`delete_guids` 双重校验**：既过**允许列表**，又必须位于 `Assets/` 之下。两道闸都要有。
4. **桥接只装到 `Packages/com.avca.bridge`**，**绝不往 `Assets/` 里塞**。
5. **缓存绝不许落在 C 盘**（素材库根在 C 盘时只**警告**不拦，但缓存是硬禁止）。
6. **主进程不许回传中文文案**：只给 `messageKey` / `textKey` / `code` + 参数，
   渲染层用 i18next 出文案。`tests/renderer/i18n.spec.ts` 会扫 `src/main` 用到的 key
   并断言三份语言文件齐全（漏翻译运行时只显示 key 名，肉眼极易放过，所以用测试兜住）。
7. **不做任何联网请求。** LLM 兜底默认关闭（且**完全未实现**）。

---

## 7. 用户环境与真实数据（⚠ 别动）

这台机器上用户的真实数据：

| 项 | 位置 / 值 |
|---|---|
| 素材库根 | `E:\vrc\A`（2303 个文件 / 26,180,208,437 B） |
| 数据库 | `%APPDATA%\A\library.db`（`user_version = 11`，**23 个 asset**） |
| 其它运行目录 | `%APPDATA%\A\{staging,thumbs,backups,logs}` |
| `settings.json` | `libraryRoot = E:\Atriumdate`（几乎是空的）、`onboardingDone: false`（**这是既有状态，不是 bug**） |
| 救援留档 | `D:\avca-rescue-20261015\`（`library.db.asof-2241` + 取证脚本） |

两点重要背景，**别再去"修"**：

- 用户库里早先那批文件删除，**是用户自己做的**，他明确说了不用管。
- 素材表从 462 掉到 23，**也是用户自己的操作**。

**任何测试、任何活体脚本都必须把 `AVCA_APP_HOME` 重定向到沙盒**，
不许拿 `E:\vrc\A` 或真库当试验场。

---

## 8. Unity 集成（这一块最容易"看着通了其实没通"）

### 8.1 桥接协议

- **规格出处**：`docs/BRIDGE.md`（1040 行，**"实际实现成什么样"，以代码为准**）。
- A 侧实现在 `src/main/bridge/`，Unity 侧在 `resources/unity-bridge/com.avca.bridge/`。
- **桥接版本号还是 `1.0.0`**（`AVCABridge.cs` 里的 `BridgeVersion`）。
  所以这几件**仍未支持**，都要改 C#：
  - `topFolders` / `avatarDescriptors` 拿不到；
  - **真 Unity 撤销后，工程里会留下这次新建的空目录和它们的 `.meta`**
    （不影响功能，但工程树里看得见 —— 要修得先让 A 知道"哪些目录是这次导入建的"）；
  - GUID 增量索引同理：反查只能答"A 导过哪几次"，**答不了"工程里现在装了哪些 GUID"**。

### 8.2 运行状态判别：三路取并集

A 靠**三条路**判断 Unity 工程是否在运行：桥接心跳、锁文件、WMI。
设计上有两条已经修过的坑，**别再踩回去**：

- **WMI 可以单独无限期撑着"在运行"**：编辑器被关掉、pid 都不存在了，WMI 每轮重查
  仍然返回那个死 pid → A 永远报"运行中"。修法是只剩 WMI 撑着时给
  `WMI_ONLY_GRACE_MS`（15 秒 = 5 轮）宽限期，超了就不认并留 warn。
  **不能一上来就不信它** —— Unity 刚打开、锁文件还没建、桥接还没装的那段窗口里，
  **只有 WMI 认得出**这个工程。回归用例 `tests/project/wmi-only-grace.spec.ts`（6 条）。
- **广播是发后即忘的**，而第一轮工程发现跑在窗口就绪之前。
  所以凡是"第一次/边沿"类的通知，都必须配一条**拉取式**补送通道，
  否则它恰恰在"程序第一次装好"那一次不生效 —— 而那通常正是它唯一存在的场景。
- **待答队列不能"取走即清"**：第一版那么写，改一句 i18n 文案触发整页刷新，
  第二个工程的弹窗就永远没了。现在只有"用户答了"和"自动装成了"两个出队时机。

### 8.3 导入与撤销

- **撤销要原子抢权**：`UPDATE import_log SET status='running' WHERE id=? AND status='ok'`，
  改不动就停手。否则双击会**同一批资源被删两遍**，第二遍把 message 覆盖成
  「撤销：删除 0 个新建资源」，用户以为撤销没生效。
  用例 `tests/import/rollback-claim.spec.ts`。
- **撤销失败不许写 `undone=1`**，也不许卡在 `running`（失败要把状态放回 `ok`）。
- **桥接回的 `failed:[路径…]` 不许丢**：那是"这个资源我没能删掉"，
  要带在 `failedToDelete` 里，message 与 toast 都要说"有 N 个没能删掉，工程里可能还留着"。
- **"已备份"要真存下了东西才说**：`ImportResult.backupSaved` 新增，
  横幅走 `shared/importNotes.ts` 的判据。
  真机上那条连锁反应：上次撤销删了文件但 Unity 还记着 GUID → 下次导入判成"覆盖 2 个"
  → 备份实际存了 0 个 → 横幅照样写「被覆盖的文件已备份」。
- **批量导入账目形状**：`IMPORT_BATCH_MAX=8`，一批一条 `batch_id`（这是定死的账目形状，不该改）。
  **已知 UX 欠账**：一次导完好几批时**界面只能退回最后那一批**（缺的是入口，不是账目）。

### 8.4 假对端（`tools/fake-unity-live.cjs`）的局限 —— 很重要

假对端**永远测不出**上面那几条真机事故：它自己按包里的 `.meta` 铺文件、自己算 `deleted`，
**既不经过 Unity 的资源库，也不会因为"文件已经没了"而回 `failed`**。
所以：**假对端绿 ≠ 真 Unity 绿**。涉及导入/撤销/冲突的改动，条件允许就要真 Unity 复测。

⚠ 假对端和真编辑器**不许同时开着同一个工程**（两边都写 `Temp/AVCABridge/bridge.json`，
心跳会互相盖掉，看着像"忙判定失灵"）。

---

## 9. 发布流程（照这个顺序，别跳步）

### 9.1 准备

1. 确认 `main` 上是要发的代码，`package.json` 版本号改好。
2. 写发布说明：`docs/release-body-<版本>.md`（**模板照抄 `docs/release-body-0.5.0.md`**）。

### 9.2 发布说明的格式（跟 0.4.1 / 0.5.0 / 0.7.0 一致）

- **没有 H1**；开头两行引入语；下载链接；然后一行 `> 本页说明…`。
- `## 本次更新` → 主题化的 `###` + `- **加粗要点：** 说明`。
- `## 下载与升级`（表格 + 升级说明 + SmartScreen 说明）。
- `<details>` 里放 SHA-256；`## 主要功能`（3 个 `###`）；`## 快速开始`；
  `## 使用说明与已知限制`（表格）；`## 数据位置`（表格）；`## 反馈与开发`。
- 🔴 **术语红线**：正文里**不许出现** `schema` / `IPC` / `pHash` / `DPAPI` / `GUID` / `asar` /
  `变异` / `单元测试` / `代号` 这些词（面向玩家，不是面向开发者）。
  0.7.0 那份实测 **0 命中**，保持住。

### 9.3 构建与发布

```powershell
npm run build                                   # 产出 dist\Atrium-Setup-0.7.0.exe + dist\Atrium-portable-0.7.0.exe
node tools/pkg-version.cjs                      # 核对 asar / 版本 / 许可 / 依赖
node tools/gh-release.cjs --check               # 先看远端
node tools/gh-release.cjs --create              # 建 Release + 传资产
node tools/verify-release-page.cjs              # 🔴 核对发布页：正文、链接、SHA-256
```

- **资产命名约定**：`dist/Atrium-Setup-<ver>.exe` + `dist/Atrium-portable-<ver>.exe`。
- **发布正文来源**：`docs/release-body-<version>.md`。
- `verify-release-page.cjs` 曾经因为**正则只认破折号一种分隔符**，
  从 v0.4.1 起一直报"0 串指纹"——**"静悄悄什么也没验"**，是个假绿工具。
  已修（现在接受 `：`/`—`/`–`/`:`）。**每次发布都要看它真的报出 2 个 hash 且都 ✅**，
  报 0 就是又坏了。
- 发布后核对：`release` 标记为 `latest`、资产数 = 2、正文与本地 md **逐字一致**、
  远端 digest 与本地一致。

### 9.4 🔴 最后一步：**更新用户本机装的 Atrium**

这条是 `AGENTS.md` 里的硬规矩，**只改源码、只发 Release 都不算做完** ——
用户是在**装好的那个程序**里用功能的，源码修好了而他机器上还是旧行为，**对他等于没修**。

```powershell
npm run build
Start-Process dist\Atrium-Setup-<版本>.exe -ArgumentList '/S' -Wait   # 静默覆盖安装
node tools/installed-version.cjs --expect=<版本>                       # 核实注册表 DisplayVersion 真变了
```

⚠ 起装好的程序时**必须清掉 `ELECTRON_RUN_AS_NODE`**（见 2.2 陷阱 2）。

---

## 10. 协作规矩（`AGENTS.md` 原文要点，已生效）

1. `main` **只接收已验证、可以构建和运行的代码**。
2. **所有改动都从最新 `main` 开独立分支**（默认 `codex/` 前缀），**通过 PR 合并**。
   **不要直接在 `main` 开发或推送。**
3. 生产代码改动合并前要跑：完整测试（`npm test`）+ 类型检查（`npm run typecheck`）+
   Electron Vite 构建 + worker 依赖检查；**涉及界面或 IPC 时，要在隔离数据目录验证实际操作**。
   纯文档改动检查内容和差异即可。
4. 合并前确认 PR 最新提交已验证、**没有冲突**、远端必需检查通过。
   目标分支有新改动时，**先验证整合后的代码**。
5. 满足上述条件后，**AI 协作者自行合并 PR**，不用再问用户。
   走正常 PR 流程，不绕分支保护，**不强制推送 `main`**。
6. **报告实际测试结果和仍未验证的行为**：不要把条件跳过的测试说成已通过，
   也不要把"可启动"等同于"所有功能都完成"。
7. **每次修复/更新都要同时更新用户本机安装的 Atrium**（见 9.4）。

### 写测试的两条血泪纪律

- **每条回归测试都要能回答："我把这个修复改回去，哪条测试会变红？"**
  有过一次：布线断言只查 `defaultPath\s*:` 存在 → 把值改成 `undefined` 照样绿。
  收紧成必须匹配 `defaultPath:\s*root\b` 才有意义。
- **对源码做文本断言前，先剥掉注释**：修复说明的注释里往往**正好写着**你搜的那串字，
  不剥注释的断言等于永远绿。
- 还有一条：`tools/verify-red-*.cjs` 这类**变异验证器**是干这个的（把修复临时改回旧写法，
  确认对应用例真的变红）。**第一版曾经抓到 10 条"撤掉修复也不红"** —— 别信"测试很多所以没问题"。

---

## 11. 文档地图（哪些是最新的，哪些是历史）

### ✅ 权威/当前（先读这些）

| 文件 | 作用 |
|---|---|
| `README.md` | 面向**普通用户**。功能范围、下载、升级说明 |
| `AGENTS.md` | 🔴 **协作规矩，权威**（11 行，短，读完） |
| `docs/DEVELOPMENT.md` | 开发者视角的账本（881 行）。**已知限制**那一节是当前口径 |
| `docs/VERIFY-UNVERIFIED.md` | 逐条"未验证"清单 + 凭据 + 复现命令。**别把这里标红的说成做完了** |
| `docs/UNITY-COVERS.md` | Unity 物品封面 |
| `docs/ALL-COVER-UPDATE.md` | 一键更新全部封面（团队的功能，v0.7.0） |
| `docs/UNITY-AUTO-CONNECT.md` | Unity 自动连接（团队的功能，v0.7.0） |
| `docs/BRIDGE.md` | 桥接协议**实际实现**（以代码为准） |
| `docs/FIXES-2026-10-11-IMPORT-RECOVERY.md` | 分类/导入历史/数据库备份的后续修复 |
| `docs/M7-DESIGN.md` | 首启向导设计 + **§8 十二个裁定**（有的还没批） |

### 📜 历史（留档，别当现状读）

- `docs/release-body-*.md` —— 各版本发布说明（历史快照）。
- `docs/PROMPT-*.md` —— 历次交接提示词。**`PROMPT-FOR-NEXT-AGENT.md` 头部自己标了"已经过时"**
  （它点名的 M5-B / M6 / R4 都已交付）。现在的进度标准是**开发计划的轮数**。
- `docs/REVIEW-59.md`、`docs/PROMPT-R9-REVIEW-MERGE.md` —— 待复核时代的记录。
  **「待复核」功能已于 2026-10-15 整体移除**，`docs/DEVELOPMENT.md` 里有 blockquote 说明；
  历史轮次记录**原样保留**（不篡改历史账）。
- `docs/DEVELOPMENT.md` 里的**测量记录**（各轮实测数字）也是历史，保留不改。

---

## 12. 仍然"未验证"的东西（🔴 不许说成已完成）

| 项 | 状态 |
|---|---|
| **渲染层"画法"** | ⛔ **结构性未验证**。仓库**零 DOM 测试**，布局只能靠截图 + CDP 逼近，改样式没有回归保护 |
| 界面真实观感 | ⛔ 从未做**截图级**复核（只能靠 `docs/screenshots/` 里的历史截图与活体脚本） |
| 英文 / 日文界面 | ⛔ 从未截图核对过（只有 key 齐备的自动化断言） |
| 真 Unity 手工卸载 | ⛔ 未测 |
| 封面生成 | 只在 **Unity 2022.3.22f1 + Built-in** 验证过 |
| URP / HDRP、粒子、动画、自动下载依赖 | ⛔ 未覆盖 |
| 桥接 ≥ 1.1.0 的那一支 | ⛔ **要改 C#**，未做（见 8.1） |
| 在真库 `E:\vrc\A` 上真搬一次文件 | ⛔ **等用户点头**才能做 |
| LLM 兜底 | ⛔ **完全未做**（规格 §5.5，默认关闭） |

另外两条**已知局限**（刻意如此，不是 bug）：

- **V11 只清"被 ≥2 行共用"的 hash**；单行继承来的 hash 和正常 hash 无法区分，**不动**。
- **筐里的子项现在没有内容指纹**（这是修"封面全变成同一张"的代价），
  所以**它们不参与重复检测**。

---

## 13. 已经修掉但容易复发的坑（速查）

| 症状 | 真因 | 修法 |
|---|---|---|
| `NODE_MODULE_VERSION 130 vs 137` | ABI 没切 | `npm run native:node` / `native:electron` |
| 装好的程序"启动即退出" | `ELECTRON_RUN_AS_NODE=1` | 清掉该变量 |
| `npm` 报执行策略错误 | PowerShell 拦 `npm.ps1` | 用 `npm.cmd` |
| `refusing to merge unrelated histories` | `--depth=1` 留下 `.git/shallow` | `git fetch origin --unshallow --tags` |
| 迁移重放报 `no such column` | 纯 SQL 的 drop column | 挪进带守卫的 `post` |
| 迁移号冲突 | 双方都占同一个版本号 | **保留已发布的号，自己的往上加** |
| 12 条 `TS1005 ',' expected` | SQL 注释里有反引号 | 注释里别用反引号 |
| 封面全变成同一张 | 子项继承了整筐的内容指纹 | V11 修复 + 子项 `hash: null`（`ingest/api.ts` 两处） |
| 发布页"0 串指纹" | 核对工具正则只认一种分隔符 | 已修；**每次发布看它真报 2 个 hash** |
| 撤销后显示"删除 0 个新建资源" | 双击导致同一批删两遍 | 原子抢权 `status='ok' → 'running'` |
| A 永远报 Unity"运行中" | WMI 撑着死 pid | `WMI_ONLY_GRACE_MS` 15 秒宽限 |
| 第二个工程的弹窗消失 | 待答队列"取走即清" | 只在"答了/装成了"出队 |
| 打包版把用户改的口语写进**安装目录** | 落点错 | 存**增量**到 `P.root()`，加载时合并 |
| 测试撤掉修复也不红 | 断言太松 / 没剥注释 / 变异打错调用点 | 用 `tools/verify-red-*.cjs` 逐条变异验证 |

### 工具自身的坑（免得又以为产品坏了）

- **`git push` 经常超时**：`Failed to connect to github.com:443 after 21s` 是**间歇性**的，
  重试通常能成（历史上有过要 6–15 次的情况）。
  **`api.github.com` 在 `github.com` 不通时往往仍然可用** —— 发布走 API 基本不受影响。
- **PowerShell 的 `Get-Content` 会把 UTF-8 中文弄成乱码**（mojibake）。
  要读中文文件用**别的工具**，或者用 Node 读。**别根据乱码下结论。**
- **`node -e "..."` 在 PowerShell 里会被引号/`*`/括号搞坏**
  （比如 `COUNT(DISTINCT …)`、`'RealKissSystem'`）。**写成 `.cjs` 文件再跑。**
- **`.cjs` 里没有顶层 `await`** —— 包进 `async function main()`。
- **读自家日志要按行内时间戳筛**：曾经忘了带行首的 `[`，而 `'['`(0x5B) > `'2'`(0x32)，
  比较对每一行都成立 → **上一轮的日志被当成这一轮的，两条判据抄旧账"过了"**。
- **`taskkill /F /IM Unity.exe` 会顺手杀掉 Unity Hub 的 `unity.exe serve`** —— **按 PID 杀**。
- **在 PowerShell 里用管道接 `npm test` 会丢掉真实退出码**：`& npm.cmd test | Select-Object -Last 25`
  看着正常却报 `[exit code: 1]`，**那 1 是管道的，不是测试的**。要判定成功与否，
  必须用重定向拿真退出码：`& npm.cmd test *> $env:TEMP\t.log; $LASTEXITCODE`（本仓库实测为 **0**）。
  **别把管道吞掉的退出码当成"测试挂了"。**
- **通过/跳过的条数会在 2028+20 与 2029+19 之间摆动**（合计恒为 **2048**）：perf 套件按环境条件跳过，
  两种情况都正常。**判断标准是"退出码 0 且合计 2048"。**
- **一个沙盒实例只服务一个沙盒**：指错了不报错，只会给你一串"命中 0 张"的假故障。
- **`--packages-only`**：某些沙盒脚本默认那一支会 `rmMine(ROOT)` 把整个沙盒抹掉，
  已经跑过活体、库里有素材行时用它等于把上一轮现场一起删了。

---

## 14. 团队协作背景（重要）

- 这个项目**有两个工作站/开发者在推进**。团队那边已经交付两个功能并合进 0.7.0：
  - **Unity 自动连接 + 导入目标解析**（PR #12，`6114b6a`）
  - **一键更新全库封面**（PR #13，`e068f5b`，背后是 `cover_task_backup` 表）
- 之前发生过一次**迁移号撞车**（见 5.2 第 1 条）。
  **新工作站如果开分支，务必基于 `15115be` 或更晚。**
- 版本号有一段跳变：**v0.5.0 之后直接发的 v0.7.0**，0.6.0 和 0.7.0 没有分别单独发布过
  （v0.7.0 的发布说明里解释了这次跳跃）。

---

## 15. 当前状态快照（2026-10-17）

```
分支 main · HEAD 15115be · 工作区干净 · 本地 == origin/main
package.json 0.7.0 · SCHEMA_VERSION 11
标签 v0.2.0 v0.3.0 v0.4.0 v0.4.1 v0.5.0 v0.7.0

最近提交：
  15115be  Merge PR #17 codex/fix-release-verify-regex
  d04d3f1  fix(tools): 发布页核对工具的正则过期
  0821d85  Merge PR #16 codex/release-0.7.0
  c0420e3  docs(release): 0.7.0 发布说明 + README 版本口径
  1606d62  Merge PR #15 codex/fix-inherited-hash-covers
  b1ad353  fix(ingest): 子项不再继承整个筐的内容指纹
  4722760  Merge PR #14 codex/remove-review-feature
  508bcdb  Merge PR #13 codex/all-cover-update
  e61c1e6  Merge PR #12 codex/unity-auto-connect

GitHub Release v0.7.0（latest，2 个资产）：
  Atrium-Setup-0.7.0.exe      87,131,848 B
  Atrium-portable-0.7.0.exe   86,897,744 B
  SHA-256（Setup）   3c77409a2e1ad8459bc4bd6dc5dbbdd347f5310432bf581980d3f8639b4d6e77
  SHA-256（portable）502dbf453a9a138a3c77ce968103f633954a284001894f1521568438a0b48624

本机安装：DisplayVersion 0.7.0（注册表 HKCU\...\Uninstall\0e0e4f8f-…）
本机数据库：%APPDATA%\A\library.db · user_version 11 · 23 个 asset
测试基线：2028–2029 通过 / 19–20 跳过（156 文件，退出码 0）· typecheck 干净 · i18n 1097×3 零漂移
  ⚠ 通过/跳过的数字在 2028+20 与 2029+19 之间摆动（合计恒为 2048）—— perf 套件按环境条件跳过，
    两条都算正常。**判断标准是"退出码 0 且合计 2048"**，不是记住某一个具体数字。
```

---

## 16. 建议的下一步（按优先级）

1. **先把环境跑通**：`npm install` → `npm test`（应看到 2029 通过 / 19 跳过）→ `npm run typecheck`。
   两个数字都对上，说明你的机器接得住。
2. **完整读 `AGENTS.md` + 本文件的 §6（硬约束）和 §12（未验证）** —— 这决定你哪些话不能说。
3. **真跑一次应用**（`npm run dev` 或 `npm run build` + 装上），确认界面在你机器上正常。
4. 挑活时优先看 `docs/VERIFY-UNVERIFIED.md` 里**标红的**和 `docs/M7-DESIGN.md` §8
   **还没批的裁定** —— 那些是真正欠着的账，比新功能更值钱。
5. **要动 Unity 桥接（C#）的活**（`bridgeVersion ≥ 1.1.0` 那一族）是个独立的、边界清楚的任务，
   适合作为接手后的第一件大活。
6. 🔴 **无论做什么，收尾都要更新用户本机装的版本**（§9.4）。

---

## 17. 一句话交接

> 代码是干净的（`main` = `15115be`，全绿）；**坑都在环境（ABI / `ELECTRON_RUN_AS_NODE` /
> 网络）、迁移编号、以及"真假绿"的判断上**。产品底线是"永不永久删除、绝不手写 `.meta`、
> 桥接只进 `Packages/`、缓存不落 C 盘"。**没验证过的就说没验证** —— 这个仓库最看重的
> 不是"看起来做完了"，而是**账目可信**。
