# Atrium × VPM 合并开发规划

> 写于 **2026-10-21**。这份文件只做**规划和提示词**，不包含任何产品代码改动。
>
> 目标读者：接手的执行 Agent、以及做最终拍板的你。
>
> 参考对象：ALCOM 稳定版 **1.1.8**（2026-07-11）的 GUI 功能面；源码观察于
> `vrc-get` master（2026-10-19，版本线 1.1.9-beta.0）。**只学习行为与架构，不抄代码。**
>
> **2026-10-21 v2：执行单位已改为小任务卡。** 本文件保留总规划/架构决策；
> 一次只执行 [`VPM-TASKS.md`](VPM-TASKS.md) 里的一张卡，架构约束见
> [`VPM-ARCHITECTURE.md`](VPM-ARCHITECTURE.md)。阶段提示词只作规格参考。

---

## 0. 一页结论

Atrium 现在是一个**素材管家**：收压缩包、读 `.unitypackage`、分类、封面、导入 Unity 工程。
ALCOM 是**VPM 项目与包管理器**。两者不是同一类软件，所以"合并 ALCOM"不是把 ALCOM 的界面
搬过来，而是给 Atrium 增加一整个**项目生命周期 + 包生命周期**子系统。

本规划的核心判断：

1. **VPM 子系统必须与素材管线隔离。** 素材库、分类、封面、搜索、导入历史保持原样；
   新功能走独立模块、独立数据库、独立设置、独立缓存根。
2. **不碰 `library.db` 的 schema。** VPM 使用自己的 `vpm.db`（以及自己的迁移版本号）。
   这是"无损回退"最强的一道闸：核心库连一列都不改，回退时不需要恢复数据库。
3. **网络只在 VPM 模块里出现，默认关闭，首次使用必须明确同意。**
   核心的"纯本地、不联网"承诺继续成立；README 要改成"核心离线，VPM 可选联网"。
4. **删除仍然不永久删除。** VPM 卸包、替换包、清理旧版 Assets 资源时，先把文件移进
   **回滚仓（vault）**，并记账；缓存/临时文件是例外，但也要可解释、可清理。
5. **轻量化不是少做功能，而是少做常驻按钮。** 项目页只保留一个主操作；
   包管理是"抽屉 + 变更单 + 一次应用"；仓库/模板/Unity 安装都收进设置里的一个页签。
6. **分十个板块（P0–P9）推进。** 每个板块都能独立合并、独立验收、独立关掉；
   在 P9 之前不发布正式 Release，VPM 默认关闭。

一句话：**先把"能安全回退的空壳"做好，再做解析器和只读浏览，最后才动 Unity 工程里的文件。**

---

## 1. 事实基线

### 1.1 Atrium 的真实状态（不是 HANDOVER 里写的旧数字）

| 项 | 事实 |
|---|---|
| 版本 | `package.json` = **0.8.0**（0.7.0 是最后一个已发布 Release） |
| 当前 HEAD | `f105f3a`（PR #18 合并后） |
| 当前工作区 | 分支 `codex/interaction-gestures`，有**未提交的 0.8.0 手势改动** |
| 技术栈 | Electron 33.4.11 + TypeScript strict + React 18 + better-sqlite3 + Vitest |
| 核心库 | `%APPDATA%\A\library.db`，`SCHEMA_VERSION = 11` |
| 已有 Unity 能力 | 工程发现、运行状态三路判别、桥接 1.2.0、导入/撤销/日志 |
| 已有 VCC 能力 | 读 `%LOCALAPPDATA%\VRChatCreatorCompanion\settings.json` 的 `userProjects` / `defaultProjectPath` |
| 测试 | 158 个 `*.spec.ts`；全量数字以实际跑出来为准，不硬编码旧基线 |

> HANDOVER 里"v0.7.0 / bridge 1.0.0 / 2028–2029 通过"是**历史快照**。
> 以代码和实际测试为准。P0 的第一件事就是记录真实基线。

### 1.2 ALCOM 到底是什么

- 它是 `vrc-get` 项目的 GUI 前端（Tauri 2 + Rust + React），不是 VRChat 官方产品。
- 它管理的是 **VPM 项目**：读 `ProjectSettings/ProjectVersion.txt`、
  `Packages/manifest.json`（UPM，保留但不接管）、`Packages/vpm-manifest.json`（VPM 自己的账）。
- 包安装到 `Packages/<包名>/`，成为 Unity 的 embedded package；旧式包可能还在 `Assets/`。
- 它**不是改模工具**，不做模型编辑、不做贴图烘焙、不做 Booth 元数据抓取。
- 它的核心价值是：仓库聚合、依赖解析、事务式装包、模板建项目、Unity 发现、
  项目备份/复制、VCC 互操作。

### 1.3 本规划的目标版本

**功能对标的冻结目标：ALCOM 1.1.8 的 Windows GUI 功能面。**

不追随 1.1.9-beta 的新功能（例如"Unity 打开中把窗口顶到前台"），
这些放进 P8 的"可选增强"，不阻塞 1.0。

---

## 2. 目标与非目标

### 2.1 目标（做完这些才算"几乎 100%"）

1. 项目：发现/添加/新建/复制/备份/从列表移除/启动 Unity/换 Unity 版本。
2. 包：浏览仓库、搜索、看详情与版本、安装/升级/降级/重装/卸载、批量变更、冲突与缺失依赖解释。
3. 仓库：官方 + curated + 用户仓库、增删改、排序、启用/停用、刷新、ETag 缓存、每仓库请求头。
4. 模板：空白/角色/世界模板、模板管理、收藏/最近使用、VPM 依赖、unitypackage 附件、导入/导出自己的模板。
5. Unity：Hub 安装发现、手动添加、按工程版本匹配、启动参数、运行状态。
6. 备份/复制：排除重型目录、进度/取消、可选排除 VPM 包；Atrium 额外提供"从备份新建工程"。
7. 迁移：VCC 项目/仓库/用户包目录的只读导入；旧式 VPM（Assets 里的包）识别与引导迁移；
   Unity 版本升级。
8. 设置/日志/更新：VPM 数据根、缓存/回滚仓用量、预发布开关、隐藏包、日志导出、更新检查。
9. 轻量化界面：不新增顶级导航；项目页 + 一个设置页签装下全部。

### 2.2 非目标（明确不做，避免"看起来差一点"）

| 项 | 原因 |
|---|---|
| 把 ALCOM 的界面/图标/文案/模板资产搬过来 | 版权与商标风险；Atrium 要有自己的设计 |
| 依赖 `vrc-get` 的 Rust crate 或二进制 | 会把 MPL/第三方代码带进产品，违背"版权完全归你" |
| 跨平台（macOS/Linux）首发 | Atrium 现有安装、路径、桥接、DPAPI 都是 Windows；先把 Windows 做扎实 |
| CLI / CI 的 `vrc-get` 对等物 | ALCOM 的 GUI 本身不带 CLI；那是另一个产品 |
| 写 VCC 的 `vcc.liteDb` | 高风险耦合；Atrium 只读 VCC 的 JSON 设置，绝不改 VCC 的数据 |
| 全自动 SAT 回溯求解 | ALCOM 本身是确定性贪心；我们做同样可解释的语义，不制造"看起来更聪明但结果不同" |
| 无确认的静默自更新 | 安全与可控性；Atrium 提供"检查 → 下载 → 校验 → 你点安装" |
| 手写 `.meta` / 直接生成 Unity 资源 | 产品硬约束；只搬运包内已有的 `.meta`，或让 Unity 自己生成 |
| 在 C 盘放 VPM 缓存 | 产品硬约束；没有非 C 数据根就不启用 VPM |

### 2.3 "几乎 100%"怎么判定

不是"感觉功能都有了"，而是：

- `docs/VPM-PARITY.md` 的每一行都有状态、阶段、证据；
- 所有"完整"行有自动化测试或真机验收记录；
- 所有"部分"行写清差在哪、为什么、什么时候补；
- 不把"能启动"说成"功能完成"；
- 不以像素/按钮位置与 ALCOM 一致为目标，只以**用户能完成同一件事**为目标。

---

## 3. 版权与净室（必须整份读）

完整规则在 **`docs/VPM-CLEANROOM.md`**。这里只放三条底线：

1. **可以看、可以学行为，不可以抄表达。**
   代码、注释、标识符、测试、UI 文案、图标、模板、语言文件、构建配置、夹具，
   一样都不搬；不引入 `vrc-get` 依赖，不反编译，不照着源码逐行翻译。
2. **实现时只看"行为规格"和公开协议。**
   观察 ALCOM 源码得到的结论，用自己的话记进 `VPM-CLEANROOM.md` 的观察日志；
   写代码时不要开着 ALCOM 源码对照。若发现某段代码像"翻译"，停下来重写。
3. **Atrium 自身代码的著作权归你；第三方依赖按各自许可证使用。**
   Electron/React/SQLite 等本来就存在；新增依赖只选 MIT/ISC/Apache-2.0/BSD 这类宽松许可，
   并在 `THIRD-PARTY-NOTICES` 里列清楚。VRChat SDK 包不打包进安装器，运行时从官方仓库获取，
   用户需接受 VRChat 自己的条款；仓库元数据也不随安装包分发。

---

## 4. 产品硬约束与本次修订

| 原约束 | VPM 下怎么继续成立 |
|---|---|
| **永不永久删除用户素材** | 卸包/替换包/清旧 Assets，先把文件移到**回滚仓**并校验副本，再移除工程内的原件；回滚仓清理必须用户明确点、走回收站。缓存与临时文件是应用自己的，可正常清理，但要可解释。 |
| **绝不手写 `.meta`** | VPM 包里的 `.meta` 原样解压；模板里的 unitypackage 只提取包内自带 `.meta`；新建工程让 Unity 生成 `.meta`。Atrium 不生成、不改写、不补写任何 `.meta`。 |
| **`delete_guids` 双重校验** | VPM 的旧资源清理同样要"允许列表 + 必须位于 `Assets/` 下"两道闸；只清包清单声明的 legacy 路径/GUID，清理前入回滚仓。 |
| **桥接只装到 `Packages/com.avca.bridge`** | VPM 把 `com.avca.bridge` 列为**受保护包**：解析器不选它、不升级、不卸载、不覆盖；仓库里出现同名包也拒绝安装。 |
| **缓存绝不落 C 盘** | VPM 数据根必须是**非系统盘的可写绝对路径**；不合法就拒绝启用。包缓存、下载临时、回滚仓、工程备份都放这里。**事务解压临时**在工程根隐藏目录 `.atrium-tx`（同卷才能原子 rename；不用 `Temp`，避免 Unity 清理现场），它不是缓存，成功后清理。`vpm.db`/设置是小状态，留在 `%APPDATA%\A\vpm`，不算缓存。 |
| **主进程不回传中文文案** | 所有错误走 `VpmErrorCode` + 参数；渲染层 i18next 出文案。包名/包描述是外部数据，原样显示但要清洗控制字符。 |
| **不做任何联网请求** | 修订为：**Atrium 核心不联网；VPM 模块可选联网，默认关闭，首次明确同意。** 只有 VPM 的 HTTP 客户端能发请求；无遥测、无崩溃上报、无后台扫描。 |
| **不在 `main` 直接开发** | 每个阶段独立分支、PR、全量测试/类型检查/构建；AI 可在验证后自行合并，但不强推 `main`。 |
| **更新本机安装版** | 每个合并后的阶段构建并安装新版本（VPM 默认关闭）；P9 发布正式版。若用户明确要求暂停安装，以用户指令为准并在报告里写明。 |

---

## 5. 架构

### 5.1 总原则

- **核心不知道 VPM 的存在。** 核心只认识一个懒加载入口和一组 IPC 通道。
- **VPM 不知道素材管线的细节。** 它只通过 `project` 仓储/项目路径与核心交换最少信息。
- **文件是真相，数据库是索引。** `vpm-manifest.json` 和 `Packages/` 才是工程状态；
  `vpm.db` 坏了可以从工程和仓库重建，不能反过来拿 DB 覆盖工程。
- **所有写操作先计划、后确认、再事务。** 没有"点一下就直接改工程"的路径。
- **所有长任务有拉取式状态。** 事件只是加速，刷新/重启后能靠 `Status` 恢复。

### 5.2 目录（建议）

```text
src/shared/vpm/                 纯逻辑，可在 Node 里直接单测
  version.ts                    VPM 版本解析/比较
  range.ts                      版本范围解析/匹配/展示
  unityVersion.ts               Unity 版本解析/比较/兼容
  packageId.ts                  包名与路径合法性
  manifest.ts                   vpm-manifest 读写（保留未知字段）
  repo.ts                       仓库 JSON 解析/校验
  plan.ts                       变更计划的数据形状与文案 key
  resolve.ts                    确定性依赖解析（纯函数）
  template.ts                   自有模板格式 + 导入适配
  errors.ts                     VpmErrorCode 与 i18n key 映射
  guards.ts                     路径/URL/大小的纯校验

src/main/vpm/
  index.ts                      唯一的懒加载门面；核心只 import 它
  config.ts                     vpm-settings.json（独立设置）
  db.ts                         vpm.db 连接 + 独立迁移运行器
  repos/                        vpm.db 的仓储（repo/project/op/template/backup）
  http.ts                       Electron net.request 封装：HTTPS/重定向/超时/大小
  cache.ts                      非 C 缓存、内容寻址、配额、原子落盘
  reposService.ts               仓库增删改/刷新/ETag/合并
  catalog.ts                    包目录查询/搜索/版本选择
  unityRegistry.ts              Unity Hub/手动安装发现
  projectFs.ts                  读写 manifest、扫描包目录、legacy 资源识别
  resolverService.ts            把 repo 数据 + 工程状态喂给 shared/resolve
  transaction.ts                计划执行、.atrium-tx 事务区、回滚仓、崩溃恢复
  vault.ts                      回滚仓归档/校验/清理
  projectService.ts             添加/移除/复制/备份/换 Unity 版本
  templateService.ts            模板 CRUD/导入/导出/建工程
  vccImport.ts                  只读 VCC settings.json 导入
  updater.ts                    更新检查/下载/校验（P8）
  logger.ts                     脱敏日志
  ipc.ts                        IPC handler
  types.ts                      main 内部类型

src/renderer/vpm/               懒加载的 UI 块
  index.tsx                     VpmRoot / 动态挂载
  ProjectPanel.tsx              项目页里的 VPM 区域
  ProjectDetail.tsx
  PackageDrawer.tsx
  PlanSheet.tsx
  OperationBar.tsx
  RepoSettings.tsx
  TemplateSettings.tsx
  UnitySettings.tsx
  VpmSettings.tsx
  hooks/                        纯 reducer/selector 可测
```

### 5.3 核心触点（必须控制在少数文件）

| 文件 | 改动 |
|---|---|
| `src/main/index.ts` | app ready 后调用 `initVpmIfEnabled()`；异常降级；退出时 dispose；安全模式判定 |
| `src/main/ipc/index.ts` | 注册 VPM handler（模块内部自己注册也可以，核心只调用一次） |
| `src/shared/ipc.ts` | 增加 `IpcInvoke.Vpm` / `IpcEvent.Vpm` 通道名 |
| `src/preload/index.ts` | 白名单自动包含新通道（不要写任意 invoke） |
| `src/renderer/App.tsx` | 懒加载 VPM 根组件；只在 status.enabled 时挂载 |
| `src/renderer/pages/Project.tsx` | 插入 VPM 项目区域（懒加载、disabled 时为 null） |
| `src/renderer/pages/Settings.tsx` | 插入 VPM 设置页签（懒加载） |
| `src/renderer/i18n/{zh-CN,en,ja}.json` | 新增文案 |
| `src/shared/types.ts` | 只加 VPM 的对外 DTO 类型，不改现有类型 |
| `src/main/db/repos/unity.ts` | 只允许加 **DML** 辅助（如"从列表移除工程行"），**不加表/列/迁移**；不改现有查询语义 |

**静态导入禁令**：除上表外，核心源码不得 `import` `vpm` 模块（`import type` 可以）。
加一条测试：剥掉注释后扫描 `src/main`/`src/renderer`，只允许白名单文件出现 `vpm` 静态导入。
这是"关掉 VPM 即回到原样"的机械保证，不靠自觉。

### 5.4 生命周期

```text
app ready
  → 判断安全模式（--safe-mode / ATRIUM_SAFE_MODE=1）
  → 读 vpm-settings.json（坏文件 → 备份 + 默认值 + 降级状态）
  → enabled=false：不加载 vpm 模块、不注册网络、不建 vpm.db、UI 不显示
  → enabled=true：动态 import(main/vpm)
       → 校验数据根（非 C、可写、不在素材库/工程里）
       → 打开 vpm.db，检查 schema（高于本版本 → 拒绝运行 VPM，核心照常）
       → 注册 IPC，启动恢复扫描（未完成事务）
       → 任意一步失败：记日志、置 degraded、核心继续运行
  → 窗口就绪
  → 渲染层拉 status；只有 enabled && !degraded 才挂载 VPM UI
```

### 5.5 安装数据流

```text
仓库 JSON ──解析/校验──> vpm.db 的 repo/package 索引
                              │
工程 vpm-manifest + Packages ──┼──> 解析器（纯函数）──> 变更计划（可解释）
                              │                              │
用户确认 ─────────────────────┘                              ▼
                                                    下载到非 C 缓存（SHA-256）
                                                              │
                                         解压到 <工程>/.atrium-tx/<op>
                                                              │
                                   旧包 → <工程>/.atrium-tx/<op>/trash
                                   新包 → Packages/<id>
                                   manifest 最后原子写
                                                              │
                                   成功：trash 归档到回滚仓；失败：整体回滚
```

### 5.6 可维护性架构（v2 增补）

完整合同在 [`VPM-ARCHITECTURE.md`](VPM-ARCHITECTURE.md)，这里只列对施工方式影响最大的几条：

- **分层**：渲染层 → IPC/DTO → 应用服务 → 纯领域/端口 → 适配器。
  `shared/vpm/domain` 不碰 Electron/DB/网络；`main/vpm` 不 import 渲染层。
- **模块**：catalog / workspace / install / interop / platform 五个边界；
  复杂模块有 `index.ts` 公开面和 README，跨模块只走公开面。
- **写入者唯一**：`library.db` 核心、`vpm.db` 仓储、`settings.json` 配置、
  `Packages/`/manifest 事务、`ProjectVersion.txt` 版本服务、VCC 只读。
- **状态机**：安装操作 `planned → preflight → applying → committed | failed | rolled_back
  | needs_attention`；每步写 journal；无法安全回滚不许假装成功。
- **证据**：纯领域单测、适配器 fake、每步失败注入、真 Unity 沙盒、架构静态闸门。
- **施工单位**：一个任务卡一个分支/PR，目标 ≤ 15 文件、≤ 500 行非测试代码；
  超过就拆，避免"大阶段 PR"吃掉上下文和评审质量。

---

## 6. 数据与迁移

### 6.1 为什么用独立的 `vpm.db`

这是本规划最重要的架构决定。

- 核心 `library.db` 继续停在 **schema 11**，不新增表、不改列、不改索引。
- VPM 所有状态放 `%APPDATA%\A\vpm\vpm.db`，有自己的 `PRAGMA user_version`
  和 `VPM_SCHEMA_VERSION`，从 1 开始。
- 好处：
  - 不会和团队已发布的迁移号撞车（HANDOVER §5.2 的 V9 事故）；
  - 关掉 VPM 不需要恢复核心库；
  - 回退到 0.8.x 时，旧程序看到一个不认识的目录，完全忽略；
  - 核心库的备份/恢复工具不用改。
- 代价：
  - 两套迁移运行器；用同一套写法，测试覆盖；
  - 跨库不能 JOIN：VPM 用**工程路径**做键，不拿 `library.db` 的外键；
  - VPM DB 自己备份，迁移前自动快照。
- **明确允许的 DML**：VPM 在用户新建工程时，可以调用现有 `upsertProject` 让工程立刻出现在
  项目列表里；这是现有功能的数据写入，不是 schema 改动。不静默删除核心工程行。

### 6.2 `vpm-settings.json`

位置：`%APPDATA%\A\vpm\settings.json`。**不进 `AppSettings`**，避免污染现有设置与测试。

```json
{
  "schemaVersion": 1,
  "enabled": false,
  "networkConsentAt": null,
  "dataRoot": null,
  "cacheQuotaGb": 20,
  "vaultQuotaGb": 20,
  "allowPrerelease": false,
  "hiddenPackageIds": [],
  "defaultUnityArgs": "",
  "checkUpdates": false,
  "lastSafeModeReason": null
}
```

- 读写都要原子（临时文件 + rename）。
- 坏文件：改名 `settings.json.corrupt-<时间戳>`，用默认值继续；**不删**。
- 安全模式不依赖这个文件；环境变量/命令行优先。
- 密钥（仓库请求头）不放这里，放 `vpm.db` 的 `headers_enc`，用现有
  `src/main/services/secrets.ts` 的 safeStorage 路径。

### 6.3 VPM 数据根（非 C）

`dataRoot` 目录结构：

```text
<dataRoot>/
  cache/packages/<ab>/<sha256>.zip     内容寻址的包缓存
  cache/icons/...                       可选，包图标
  vault/<projectSlug>/<opId>/...        回滚仓（用户文件副本）
  backups/<projectSlug>/...             工程备份 zip
  templates/<id>/...                    用户模板（含附件）
  tmp/...                               下载临时、导入导出临时
```

硬规则：

- 必须是绝对路径、已存在或可创建、可写；**不能在系统盘（默认 C:）**。
- 不能在素材库根里（避免被 Atrium 自己扫描成素材）。
- 不能在任何 Unity 工程里（避免污染工程/被 Unity 导入）。
- 不能在应用安装目录里。
- UNC/可移动盘允许，但 UI 要提示"速度/可用性由该盘决定"。
- 没有合法数据根 = VPM 不可启用；不是"先放 C 盘再说"。

### 6.4 vpm.db 表（按阶段递增）

> 这是建议形状，执行 Agent 可以在自己阶段内调整列名，但**不得把表建到 `library.db`**。
> 每阶段只加自己需要的表；迁移只增不改不删；迁移前自动备份 `vpm.db`。

**v1（P1）**

- `vpm_repo`：`id`、`url`、`name`、`kind`（remote/local）、`enabled`、`sort_order`、
  `headers_enc`、`etag`、`last_modified`、`last_fetch_at`、`last_success_at`、
  `last_error_code`、`created_at`、`updated_at`。
- `vpm_repo_package`：`repo_id`、`name`、`version`、`display_name`、`description`、
  `author_json`、`keywords_json`、`unity_min`、`zip_url`、`zip_sha256`、`zip_size`、
  `yanked`、`yanked_reason`、`hidden`、`deprecated`、`manifest_json`、`fetched_at`；
  主键 `(repo_id, name, version)`；索引 `(name)`、`(version)`。
- 搜索用 SQL `LIKE` + 内存排序即可，不引入全文索引。

**v2（P2）**

- `vpm_project`：`project_key`（Windows 大小写归一后的路径）、`project_path`、`name`、
  `unity_version`、`unity_revision`、`unity_exe_path`、`unity_args_json`、
  `manifest_hash`、`manifest_mtime`、`last_scan_at`、`last_op_id`、`created_at`、`updated_at`。
- `vpm_project_package`：`project_key`、`name`、`version`、`source`、`is_legacy`、
  `dependency_json`、`updated_at`；主键 `(project_key, name)`。**只是缓存，可随时重建。**
- `vpm_unity_install`：`id`、`path`、`version`、`version_with_revision`、`source`
  （hub/manual）、`arch`、`last_seen_at`、`missing`。

**v3（P4）**

- `vpm_operation`：`id`、`project_key`、`kind`、`status`、`plan_json`、`summary_json`、
  `error_code`、`error_detail`、`created_at`、`started_at`、`finished_at`；
  部分唯一索引保证同一工程同时只有一个 `planning/running`。
- `vpm_operation_file`：`op_id`、`path`、`action`、`vault_path`、`sha256`、`size`、`state`。
- `vpm_cache_entry`：`sha256`、`size`、`path`、`last_used_at`、`source_host`。

**v4（P5）**

- `vpm_template`：`id`、`name`、`description`、`source`（builtin/imported/user）、
  `format`（atrium/vcc/alcom）、`unity_range`、`dependencies_json`、`unitypackages_json`、
  `settings_json`、`favorite`、`visible`、`last_used_at`、`created_at`、`updated_at`。
- `vpm_recent_location`：`path`、`last_used_at`。
- 内置模板可以在代码里生成，不强制入库；入库时也只存元数据。

**v5（P6）**

- `vpm_backup`：`id`、`project_key`、`project_name`、`source_path`、`file_path`、`size`、
  `sha256`、`unity_version`、`package_count`、`options_json`、`status`、`created_at`、
  `finished_at`、`error_code`。
- 旧式 VPM/Unity 迁移复用 `vpm_operation`（kind=`legacy-migration` / `unity-version`），
  不额外建一张迁移表；检测报告是即时计算，不入库。

**v6（P7，按需）**

- `vpm_repo_package.headers_enc`：包级下载头的密文（只增列；P1 不存明文）。
- `vpm_import_log`：VCC 导入的来源、时间、结果（不含请求头明文）。
- 本地用户包优先复用 `vpm_repo` 的 `kind=local`，不另起一套。

### 6.5 vpm.db 迁移规则

1. 每个阶段只加自己的表/列；**已合并的迁移不许改**。
2. `PRAGMA user_version` 高于当前代码支持 → VPM 拒绝运行，核心照常，提示"请升级 Atrium"。
3. 迁移前用同一套 SQLite backup 逻辑写 `vpm.db.bak-v<from>-<时间戳>`，校验可打开。
4. 迁移失败 → 保留原库 + 回滚事务；VPM 进入 degraded，不自动重建。
5. 迁移不许出现反引号注释（HANDOVER 的 `TS1005` 教训）。
6. 不把 `vpm.db` 放进 `library.db` 的备份文件名空间；两者各自管理。

---

## 7. 网络、缓存、密钥

### 7.1 同意与开关

- `enabled` 与 `networkConsentAt` 分离：
  - 启用 VPM（本地功能）只要求数据根；
  - 第一次刷新仓库/下载包时，弹一次"联网说明"，明确：官方 + curated 域名、
    你添加的仓库、无遥测、缓存位置、随时可关。
- 拒绝联网 → 仍可用已有缓存/本地包/已有工程，只是不能刷新/下载。
- 任何后台任务都不能在未同意时发请求；启动时不做"静默检查更新"。

### 7.2 HTTP 客户端（只有一个入口）

`src/main/vpm/http.ts`，所有 VPM 网络必须走它：

- 只允许 `https:`；用户仓库的 URL 必须是绝对 HTTPS。
- 拒绝 URL 里的用户名/密码；拒绝 `file:`、`javascript:`、`data:`。
- 重定向最多 5 次，每一跳重新校验 HTTPS；跨域重定向允许，但不能降级。
- 连接超时 15s，空闲超时 60s，总下载上限 30 分钟（可取消）。
- 仓库 JSON 上限 16 MiB；包上限 4 GiB；图标 2 MiB。
- 不发送 Cookie；`credentials: omit` 等价行为；不持久化服务端 Cookie。
- 每个仓库可带自定义头（如私有仓库 token）；头只从加密存储取，日志脱敏。
- URL 里不允许放凭据（userinfo 直接拒绝）；**不要引导用户把 token 放 query**，
  私有仓库用 headers。`vpm.db` 为了恢复下载必须保存 URL；UI 要提示这一点，
  日志/诊断对 query 的敏感键打码。
- 证书校验永远开启；不提供"忽略证书错误"的开关。
- 代理交给 Electron 系统代理；不自己做不安全代理。
- 下载边写边算 SHA-256；校验不过 → 文件移入 `cache/corrupt`，不安装。

### 7.3 缓存与清理

- 包缓存按 SHA-256 内容寻址，跨仓库/版本去重。
- 缓存未命中才下载；命中也要在安装前校验 hash。
- 配额默认 20 GB；超了只清理**最久未用的缓存 zip**，不碰回滚仓，不碰用户文件。
- 缓存/临时文件是应用自己的，可以正常删除；**回滚仓里的是用户文件副本，清理必须走回收站并二次确认**。
- 包图标可选；没有就显示包名首字母，保持轻量。

### 7.4 密钥

- 复用 `src/main/services/secrets.ts`；Windows 上走 DPAPI（safeStorage）。
- 加密不可用 → 拒绝保存请求头，仓库仍可用（公开仓库不需要头）。
- 列表接口只返回"有没有头/头数量"，**绝不返回明文**。
- 错误信息、日志、诊断包都不得包含请求头值；URL query 里的敏感键要打码。

---

## 8. 事务、日志与回滚

### 8.1 安装事务（每一步都可失败注入）

1. **计划**：解析器产出 `Plan`（安装/升级/降级/移除/保留、依赖链、冲突、缺失、磁盘需求）。
2. **预检**：工程未在 Unity 中运行；manifest 未被外部改过；磁盘空间足够；数据根合法；
   所有包都有 SHA-256；受保护包不参与；目标路径合法。
3. **下载/校验**：缓存命中或下载；SHA-256 必须匹配；失败的包不进入事务。
4. **解压**：解到 `<project>/.atrium-tx/<op>/install/<pkg>`；zip-slip/大小/条目数/符号链接校验；
   `package.json` 的 name/version 必须与计划一致。
5. **提交**：
   - 旧包目录 `Packages/<id>` → `<project>/.atrium-tx/<op>/trash/`（同卷 rename，原子）；
   - 新包目录 → `Packages/<id>`（同卷 rename）；
   - 写 `vpm-manifest.json`（临时文件 + rename，**最后一步**）；
   - 旧 manifest 也先在 trash 里留一份。
6. **清理旧 Assets**：只按包清单的 legacy 路径/GUID，双闸校验，先移 trash，再考虑回滚仓。
7. **成功**：操作记录 `ok`；trash 归档到回滚仓（可后台，失败可重试）；
   工程可打开 Unity。
8. **失败**：把新包移走、旧包移回、manifest 恢复；记录 `failed`；不留下半装状态。
9. **崩溃**：启动时扫描 `running` 操作和 `.atrium-tx` 事务区；按 journal 选择"继续回滚"或"完成归档"；
   **不自动删除现场**，给用户"查看/恢复"入口。

关键点：

- manifest 是提交点；manifest 写成功之前，任何失败都必须能回到旧状态。
- manifest 写成功之后，包目录必须已经就位；之后的 vault 归档失败不影响工程可用性。
- 同一工程同时只允许一个写操作；不同工程可以并行（但下载队列全局限流）。
- Unity 正在运行 → 拒绝改包（只读浏览/备份可以）。这是刻意比 ALCOM 更保守：
  文件被 Unity 占用时，半失败代价太高。

### 8.2 回滚仓（vault）

- 位置：`<dataRoot>/vault/<projectSlug>/<opId>/`（`projectSlug` 是安全短名，
  不是带盘符/反斜杠的路径）。
- 记录：`vpm_operation_file` 里有原路径、vault 路径、hash、大小、动作。
- 归档：从工程 `.atrium-tx/<op>/trash` 复制到 vault，逐文件校验 hash/size，成功后才清理临时副本。
- 撤销：只允许"最后一次操作且之后工程未被改动"；撤销本身也是一次计划/确认/事务，
  不是直接复制回去。若工程已变化，拒绝自动撤销，给"从回滚仓手动恢复"的只读入口。
- 清理：用户明确选择，走 `shell.trashItem`；显示占用空间和操作 ID；默认保留。
- 回滚仓不是备份的替代品：它只保存被替换/移除的文件，不保存完整工程。

### 8.3 三道回退闸（"后门"）

**闸 1：运行时停用（默认、无损）**

- 设置里"停用项目与包管理"：置 `enabled=false`，停任务、关网络、隐藏 UI。
- 不删 `vpm.db`、不删缓存、不碰工程、不碰 `library.db`。
- 核心恢复为原行为；重启后也不加载 VPM。

**闸 2：安全模式（启动级）**

- `--safe-mode` 或 `ATRIUM_SAFE_MODE=1`：不读 VPM 设置、不加载模块、不注册网络。
- VPM 初始化任何异常 → 记日志、降级、核心继续；不因 VPM 崩溃而打不开 Atrium。
- 设置坏文件/DB 坏/数据根丢失都走"降级"而不是"启动失败"。

**闸 3：彻底移除（需明确确认）**

- 停止任务 → 导出操作审计 → 备份 `vpm.db`/`vpm-settings.json` → 把两者移到回滚目录
  （或回收站）→ 隐藏 UI。
- **不恢复 `library.db`**：核心库从没被 VPM 改过 schema，恢复它只会丢核心数据。
- **不碰任何 Unity 工程**：工程里的包是用户工程的一部分；要撤，走操作撤销/回滚仓，
  或用户自己的工程备份。
- 回滚仓/缓存/备份目录的处理单独确认；默认保留，不删。
- 详细步骤见 **`docs/VPM-ROLLBACK.md`**。

### 8.4 日志

- 每次操作一个 `opId`；日志按 `opId` 串起来。
- 记录：计划摘要、下载 URL 的 host（query 敏感值打码）、hash、耗时、失败步骤、错误码。
- 不记录：请求头值、token、完整私有 URL、用户文件内容。
- 设置里"导出诊断"：版本、schema、数据根、最近 20 次操作、错误码、缓存用量；
  不含密钥、不含工程文件。

---

## 9. 轻量化 UI

### 9.1 信息架构（不增加顶级导航）

```text
Inbox / Library / Collections / Project / Settings     ← 仍然是 5 个

Project
  ├─ 项目列表（搜索 + 新建项目 + 溢出菜单：添加已有/从 VCC 导入）
  └─ 项目详情
       ├─ 概览（Unity 版本、路径、包数量、告警）
       ├─ 包（已安装 / 可更新 / 添加包抽屉 / 变更单）
       └─ 备份与操作记录

Settings
  ├─ 常规 / 素材库 / 分类 / Unity / 集成 / 维护（现有）
  └─ 项目与包（VPM）
        ├─ 总开关 + 数据根 + 联网同意
        ├─ 仓库
        ├─ 模板
        ├─ Unity 安装
        ├─ 缓存/回滚仓
        └─ 高级（导入 VCC、导出诊断、停用、回退）
```

### 9.2 关键页面

**项目列表**

- 顶部：搜索框 + 一个主按钮"新建项目"。
- 行：名称、Unity 版本、包数量、运行状态点、路径（次要）。
- 行点击进详情；溢出菜单：启动 Unity / 打开文件夹 / 备份 / 复制 / 更换 Unity 版本 /
  从列表移除。危险动作不在主界面平铺。

**项目详情 → 包**

- 顶部：已安装数量 + 可更新数量 + 一个主按钮"添加包"；
  "升级全部（最新）"是次要动作（无更新时禁用）。
- 列表：包名、已安装版本下拉、最新版本、来源、更新标记；点击开详情侧栏。
- 筛选：搜索 + "筛选软件包"（全部/已安装/可更新/有冲突）。
- 批量：勾选后才出现底部变更条（"已选 N 项 / 查看更改"），不常驻。
- 添加包抽屉：搜索、筛选（已安装/可更新/全部）、版本下拉；选中后进入"变更单"。
- 升级全部：主进程按 `preset:'upgradeAll'` 处理，根包升级、传递依赖只加"尽量最新"
  偏好（不提升为根依赖）；和单包升级走同一解析/事务；不静默升级，冲突时阻断。
- 变更单：新增/升级/降级/移除、依赖来源、冲突、缺失、磁盘需求、Unity 必须关闭；
  主按钮"应用更改"，冲突时禁用并给"查看原因"。
- 执行：进度（下载/校验/解压/提交）→ 成功后可"撤销这次操作"（受 8.2 限制）。

**设置 → 项目与包**

- 总开关旁一句话说明影响；数据根显示可用空间，非 C 校验失败时直接说原因。
- 仓库列表：名称、URL host、包数量、上次刷新、错误；添加/编辑/刷新/排序/停用/移除。
- 模板：卡片列表，收藏、最近使用、导入、导出、编辑。
- Unity：自动发现列表 + 手动添加；显示版本、路径、是否可用。
- 高级折叠：导入 VCC、导出诊断、停用、彻底移除。

### 9.3 按钮纪律

1. 一个屏幕/状态只有一个**实心主按钮**；其余是文字按钮或溢出菜单。
2. 只有选中项 > 0 时才出现批量条；取消选择立即消失。
3. 破坏性动作不在主路径：至少一次确认，且说明"会移动到哪里、怎么恢复"。
4. 不用嵌套弹窗；抽屉一层、确认单一层；Esc 可退。
5. 空状态只给一个动作。
6. 所有状态有文字，不只靠颜色/图标。
7. 进度条不阻塞整个窗口；可以继续浏览，但同一工程的写操作会排队/禁用。
8. 界面文案全部走 i18n；主进程只给 key/code。

---

## 10. 阶段路线

### 10.1 阶段表

| 阶段 | 主题 | 任务卡 | 门禁 |
|---|---|---|---|
| **P0** | 基线、开关、回退闸 | 已完成（0.9.0） | 现有流程零变化；全量测试/类型/构建通过 |
| **P1** | 纯逻辑核心 + 仓库 + 只读目录 | A 骨架/闸门、B vpm.db v1、C HTTP/缓存/同意、D 仓库服务、E 只读目录 UI | 纯逻辑测试全绿；断网可用缓存；无 C 缓存 |
| **P2** | Unity 发现 + 项目只读集成 | A 编辑器发现、B 工程读取、C 台账/VCC/核心整合、D 只读工程页 | 只读；不改工程；运行状态不回归 |
| **P3** | 解析器 + 变更计划 | A 版本/范围、B 解析器、C 计划/卸载/升级全部、D 矩阵/只读预览 | 计划不写盘；用例覆盖冲突与锁定 |
| **P4** | 安装事务 + 包管理 UI | A journal/状态机、B 缓存/解压、C 单包事务、D 失败注入/恢复、E 包 UI/真 Unity | 失败注入全回滚；真 Unity 沙盒通过 |
| **P5** | 项目创建 + 模板 + 启动 Unity | A 模板格式/内置、B 建工程、C unitypackage、D 启动/UI/真机 | 新工程能被真 Unity 打开；不手写 .meta |
| **P6** | 备份/复制/版本升级/旧版迁移 | A 收集器、B 备份/恢复、C 复制/换版本、D 迁移/UI/真机 | 备份可解压；迁移有备份/回滚；真机验证 |
| **P7** | 仓库治理 + 本地包 + VCC 导入 + 深链 | A 治理、B 请求头/密钥、C 本地包、D VCC/模板、E 深链/单实例/UI | 不写 VCC 数据；深链需确认 |
| **P8** | 轻量化收口 + 日志 + 更新 + 对账 | A UI 收口、B 日志/诊断/配额、C 设置/更新/限制、D 对账、E 性能/可访问性 | 矩阵无未解释空白；按钮纪律通过 |
| **P9** | 硬化 + 回退演练 + 发布 | A 安全、B 可靠性、C 性能/兼容、D 回退演练、E 发布 | 全部门禁；回退演练记录；发布核对 |

完整任务表、依赖图、状态与拆分规则见 [`VPM-TASKS.md`](VPM-TASKS.md)。

每个阶段的提示词都带 `§X.5 本阶段实现解剖（ALCOM → Atrium）`：
先讲 ALCOM 的行为/架构机制，再讲 Atrium 的独立实现与施工顺序、失败点；
详细版在 `docs/VPM-IMPLEMENTATION-GUIDE.md`，对应章节见 `docs/prompts/README.md`。
**提示词缺少这一层就视为不合格，执行 Agent 应停下来要求补齐。**

### 10.2 依赖与并行

任务级依赖图、可并行项和状态见 [`VPM-TASKS.md`](VPM-TASKS.md) §5。

- 大方向仍是 `P0 → P1 → … → P9`，但每个阶段内部按任务卡推进；
  P4 拆成 A journal、B 缓存/解压、C 事务、D 失败注入、E UI/真 Unity。
- P2-A/B、P4-A/B、P5-A/P6-A、P7-A/D、P8-A/B/C 在文件不重叠时可并行；
  其余默认单线。
- P8 的对账必须等 P5–P7 都合并；P9 必须等 P8 的矩阵签字。
- 任何阶段发现"必须改核心 schema/核心网络" → 停下来重新设计，不走捷径。

### 10.3 版本与发布

- P0 把 `package.json` 提到 **0.9.0**（开发线），但**不建 Release、不发版**。
- P0–P8 每个合并阶段构建并更新本机安装版；VPM 默认关闭，核心行为不变。
- P8 结束可选打 `0.9.0-beta.1` 做内部预发布（默认不单独发布）；P9 发 **0.9.0** 正式 Release。
- 发布说明按 `docs/release-body-0.5.0.md` 的格式；术语红线（schema/IPC/pHash/DPAPI/GUID/asar/
  变异/单元测试/代号）继续遵守。
- 回退版本：0.8.0 安装包、`pre-vpm` 标签、0.9.0 发布前的 `vpm.db` 快照都要保留。

### 10.4 小任务执行（v2）

- 一次只执行 `docs/prompts/tasks/` 里的一张卡；不整阶段发包。
- 只读任务卡列出的阶段规格章节；目标上下文 ≤ 25k tokens。
- 一个任务 = 一个分支/PR；目标 ≤ 15 个文件、≤ 500 行非测试代码。
- 每个任务必须更新模块 README、任务板状态、PR 交接段。
- 任务卡与阶段规格冲突：先改卡并说明；涉及产品行为再回头改阶段规格。
- 具体模板、交接格式、停止规则见 `docs/VPM-TASKS.md` 与 `docs/prompts/_COMMON.md`。

---

## 11. 功能对账

完整矩阵在 **`docs/VPM-PARITY.md`**。原则：

- 以 ALCOM 1.1.8 的 **Windows GUI** 为范围；
- macOS/Linux、CLI、写 VCC LiteDB 等列为"不适用/明确不做"，并写原因；
- 每一行必须有阶段与证据；
- P8 逐行签字，P9 只修不减。

---

## 12. 测试与验收

### 12.1 分层

| 层 | 内容 | 工具 |
|---|---|---|
| 纯逻辑 | 版本/范围/Unity 版本/manifest/仓库/解析/计划/模板/路径守卫 | Vitest，无 Electron |
| 主进程集成 | vpm.db 迁移、缓存、HTTP（假服务器）、事务、崩溃恢复、VCC 读取 | Vitest + 临时目录 |
| 渲染逻辑 | reducer/selector/wiring，不依赖 DOM | Vitest |
| 真机沙盒 | 真 Unity 2022.3.22f1、沙盒工程、沙盒 `AVCA_APP_HOME` | 活体脚本 + 截图 |
| 回归 | 当前全量 spec（不硬编码旧数字） | `npm test` + `typecheck` |

### 12.2 每个阶段必须回答

- "把这个修复改回去，哪条测试会变红？" 没有答案的测试不算。
- 文本断言先剥注释；否则注释里正好写着要搜的字，测试永远绿。
- 失败注入：事务每一步都要有"在这里失败"的用例。
- 手工验收走用户真实路径：真屏幕、真滚动、真首次触发；不能只看函数返回。
- 未验证的写"未验证"，不写成"已完成"。

### 12.3 安全用例清单（每个阶段相关项）

- zip-slip、绝对路径、盘符、UNC、`..`、符号链接、硬链接、junction；
- Windows 保留名（CON/NUL/COM1…）、结尾点/空格、ADS（`:`）、大小写冲突、长路径 >260；
- zip bomb（条目数、解压总量、压缩比）；
- hash 不匹配、缓存损坏、下载中断、重定向降级、超大响应；
- 数据根在 C/素材库/工程/安装目录、不可写、空间不足；
- manifest 外部修改、只读文件、被 Unity 占用；
- 同一工程并发操作、崩溃在提交前后、回滚仓归档失败；
- 受保护包（`com.avca.bridge`）被依赖/升级/卸载；
- 网络未同意时绝不出站；
- 主进程错误不含中文、不含请求头。

### 12.4 真机沙盒规则

- `AVCA_APP_HOME` 必须含 `avca`/`sandbox`，并带 `AVCA_REQUIRE_SANDBOX_HOME=1`。
- 数据根放沙盒盘（非 C），工程放沙盒目录；**绝不用 `E:\vrc\A`、`E:\Atriumdate`、
  `%APPDATA%\A\library.db` 做试验**。
- Unity 用 **2022.3.22f1**；关闭 Unity 后再跑装包；不要 `taskkill /F /IM Unity.exe`（会误杀 Hub），按 PID。
- 假对端/假仓库可以测协议，但**不能替代真 Unity**；涉及工程文件必须真 Unity 复测。

---

## 13. 风险与停止规则

| 风险 | 影响 | 缓解 |
|---|---|---|
| 解析器语义与 ALCOM 不一致 | 装错版本/冲突误报 | P3 用公开协议 + 行为用例；默认贪心不回溯；冲突必须解释；真工程对比 |
| 事务写坏工程 | 用户工程损坏 | manifest 最后写；Temp 同卷 rename；失败注入；回滚仓；Unity 关闭才写 |
| 包缓存占满 C | 违背硬约束 | 数据根强校验；配额；UI 显示用量；无 C 回退 |
| 网络/代理在中国不可用 | 无法刷新官方仓库 | 系统代理；明确错误；离线缓存；允许用户仓库；不内置镜像 |
| 版权污染 | 法律风险 | 净室流程；不引入 vrc-get；观察日志；相似度复核 |
| VCC LiteDB | 功能缺口 | 先读 settings.json；LiteDB 只读列为可选；不写 |
| 模板/工程设置差异 | 新工程不如 ALCOM 完整 | 空白骨架 + 官方包依赖；不复制模板资产；真 Unity 验证；差异写清 |
| UI 变重 | 违背轻量化 | 按钮纪律；设置页签收纳；P8 专门收口；截图复核 |
| 阶段拖长 | 无法交付 | 每阶段独立可停；P4 是核心 go/no-go；P8 可砍非核心增强 |
| 0.8.0 未合并 | 基线错 | P0 等 0.8.0 合并；不 reset 未提交改动；基线 SHA 写进回退文档 |

**停止规则：**

1. P3 解析器无法解释冲突/锁定 → 不进入 P4。
2. P4 失败注入不能全回滚 → 不进入 P5；先修事务。
3. 真 Unity 打开装包后的工程出现编译/包错误且无法定位 → 停下，不扩大功能。
4. 发现任何 ALCOM 代码/文案/资产被搬入 → 立即停止、替换、记录。
5. 数据根无法满足非 C → 不提供"临时放 C"的后门。
6. 核心 `library.db` schema 被迫改动 → 重新设计，不走捷径。

---

## 14. 开工前需要你拍板的决策

> 下面是规划采用的默认值。你不需要现在逐条回答；如果不同意，直接改这一节，
> 执行 Agent 以改后的为准。

| # | 决策 | 推荐 | 理由 |
|---|---|---|---|
| 1 | 首发平台 | **Windows 10/11** | 现有安装/桥接/DPAPI 都是 Windows；跨平台会拖长一倍 |
| 2 | 版本线 | **0.9.0 开发线，P9 才发 Release** | 与 0.8.0 区分；VPM 默认关闭，安装版可回退 |
| 3 | 独立 `vpm.db` | **是** | 不动核心 schema，回退最干净，避开迁移号冲突 |
| 4 | 网络 | **默认关闭，首次明确同意；无遥测** | 保留核心离线承诺；合规 |
| 5 | 缓存/回滚仓位置 | **必须非 C；没有就不启用** | 硬约束；避免 C 盘被包缓存撑爆 |
| 6 | 解析策略 | **确定性贪心，不回溯；冲突明确解释** | 与 ALCOM 行为接近；可预测、可测试 |
| 7 | Unity 运行时改包 | **拒绝，要求先关闭 Unity** | 避免文件占用导致半失败；比 ALCOM 保守 |
| 8 | 模板 | **自有最小骨架 + 官方包依赖；不搬 ALCOM 模板资产** | 版权干净；空白工程行为与 ALCOM Blank 一致 |
| 9 | VCC 互操作 | **只读 settings.json（项目/仓库/用户包/Unity 提示）；不写 LiteDB** | 当前 VCC 仍以 settings.json 为项目真相；写库风险高 |
| 10 | 深链/文件关联 | **只注册 `atrium://`；`vcc://` 需用户显式接管；`.alcomtemplate` 只做导入** | 不抢 VCC 的协议；降低钓鱼与误关联 |
| 11 | 更新 | **手动检查 + 下载 + 校验 + 用户点安装；不静默自更新** | 可控；避免供应链风险 |
| 12 | 卸载/替换的旧文件 | **进回滚仓，不永久删** | 产品底线；可撤销 |
| 13 | 语言 | **继续 zh-CN/en/ja 三语** | 不把工期花在翻译；功能优先 |
| 14 | 完全回退的含义 | **Atrium 应用与数据无损；Unity 工程改动需操作撤销/工程备份** | 诚实；应用回退不能魔法还原工程 |
| 15 | 内置官方/curated 仓库 | **同意联网后默认加入，但不自动频繁刷新** | 开箱可用；减少无谓请求 |

---

## 15. 给执行 Agent 的用法

1. 先读：`AGENTS.md` → `VPM-ARCHITECTURE.md` → `VPM-TASKS.md` → `docs/prompts/_COMMON.md`。
2. 只领**一张**任务卡（`docs/prompts/tasks/P?-?.md`）；读卡里列出的阶段规格章节，
   不要整份读完 P0–P9。`§X.5` 的完整解剖按卡片指向去 `VPM-IMPLEMENTATION-GUIDE.md` 查。
3. **一次只做一个任务**；前置未合并/未验收，不开下一张卡。
4. 每个任务从最新 `main` 开 `codex/vpm-<task>-...` 分支；PR 里贴测试数字、未验证项、截图、交接段。
5. 每个任务都做"关掉 VPM 仍然原样"的相关回归；阶段门禁在 `VPM-TASKS.md`。
6. 发现规划与代码冲突：以代码为准，先改任务卡/架构文档，再实现；不要默默绕过。
7. 不确定是否算"抄"：按净室规则停下来，写观察日志，重写实现。

**任务卡 + 阶段规格必须回答的四层**（缺任何一层都不要开工）：

1. **行为**：用户看到什么、明确不做什么、完成定义。
2. **ALCOM 实现解剖**：它用什么数据结构/顺序/队列/事务实现这个行为
   （只观察行为与架构，不贴代码）。
3. **我们的独立实现**：模块位置、数据形状、状态机、失败点、先做哪一步。
4. **证据**：自动化测试、失败注入、真 Unity 沙盒、回退验收、对账表。

阶段与 guide 的对应关系见 `docs/VPM-IMPLEMENTATION-GUIDE.md` 各节的"对应提示词"。
如果任务卡/阶段规格缺少第 2/3 层，执行 Agent 应停下来要求补齐，而不是自行猜测 ALCOM 的实现。

---

## 附录 A：术语

| 词 | 含义 |
|---|---|
| VPM | VRChat Package Manager，VRChat 在 UPM 之上的一套包/项目约定 |
| VCC | VRChat Creator Companion，官方客户端；Atrium 只读它的设置 |
| UPM | Unity Package Manager；`Packages/manifest.json` 归它，Atrium 不接管 |
| 数据根 | VPM 的非 C 数据目录：缓存、回滚仓、工程备份 |
| 回滚仓 / vault | 被替换/移除文件的副本，用来撤销/恢复，不是完整备份 |
| 事务区 / .atrium-tx | 工程根隐藏目录，提交前的同卷临时目录（不用 Temp，避免 Unity 清理） |
| 变更单 / Plan | 解析器算出的"要装什么/升什么/删什么"的只读计划 |
| 受保护包 | 至少包括 `com.avca.bridge`，VPM 不得升级/卸载/覆盖 |
| 降级 / degraded | VPM 自身出错但核心继续运行的状态 |

## 附录 B：参考来源（仅行为与公开协议）

- ALCOM 稳定版 1.1.8 的公开更新日志与用户文档。
- `vrc-get` 源码（master 2026-10-19）用于**观察行为**：仓库格式、manifest 形状、
  安装事务顺序、VCC 设置字段、Unity Hub 配置读取。**未复制代码/注释/文案/资产。**
- VPM/VCC 的公开文件格式：`vpm-manifest.json`、仓库 JSON、`package.json`、
  `ProjectVersion.txt`、Unity Hub 的编辑器配置。
- VRChat 官方仓库：
  - `https://packages.vrchat.com/official?download`
  - `https://packages.vrchat.com/curated?download`
- 本仓库：`docs/HANDOVER.md`、`AGENTS.md`、`docs/DEVELOPMENT.md`、`docs/BRIDGE.md`。

---

## 16. 一句话交接

> 这不是"给 Atrium 加几个按钮"，而是给它加一个**独立的 VPM 生态**。
> 先把独立的库、设置、开关、回滚仓和安全模式做出来；再用纯逻辑把版本、仓库、解析器做对；
> 最后才允许碰 Unity 工程里的文件。任何阶段都能关掉 VPM 回到原来的 Atrium ——
> 这就是这次合并的"后门"，也是整个计划的安全带。
