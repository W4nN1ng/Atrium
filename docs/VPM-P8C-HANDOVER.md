# P8-C 交接档案（设置补齐 / 手动更新 / 已知限制）

> 写于 **2026-10-23 12:40**。读者：**换一台工作站继续开发的人**。
>
> 仓库：`https://github.com/W4nN1ng/Atrium`（仓库本身就是这个项目）
> 分支：`codex/vpm-p4d-failure-recovery` · HEAD：`689d8e2`（P8-B）
> 版本：`package.json` → **0.9.0**（未发布）
>
> ⚠️ **最重要的一条：P8-C 的全部改动还没提交**（31 个改动文件 + 7 个新文件）。
> 换机前先 `git add -A && git commit`，或者把这批改动打包带走，否则这份档案描述的东西不存在。

---

## 0. 三十秒速览

| 项 | 值 |
|---|---|
| 产品 | Atrium（VRChat 改模玩家的本地素材管家 + VPM 包管理子系统） |
| 技术栈 | Electron 33.4.11 + electron-vite + React 18 + TS(strict) + better-sqlite3 12.4.1 + Vitest 2.1.9 |
| 本地检出（本机） | `C:\程序\A素材管家`（**路径含中文**，shell 里要加引号） |
| VPM 数据根 | `%APPDATA%\Atrium`（`defaultVpmDataRoot()`；R19 起启动时自动启用） |
| 测试基线 | **219 文件 / 2688 passed / 19 skipped / 0 failed**；`typecheck` 干净；`electron-vite build` 过 |
| 当前阶段 | P8（收口对账）—— **P8-C 已完成**，下一张是 **P8-D 逐行功能对账** |
| 未验证 | 真 Unity 启动/导入（P5-D、P5-E、P6-D）、GitHub 联网更新检查、安装包执行 |

---

## 1. 新工作站怎么把环境跑起来

```bash
git clone https://github.com/W4nN1ng/Atrium.git
cd Atrium
npm install                 # 或 npm ci
npm run native:node         # 必须先做：把 better-sqlite3 切成 Node ABI
npm test                    # 等价于 npm run native:node && vitest run
npm run typecheck
```

跑 UI / 打包时再切成 Electron ABI：

```bash
npm run native:electron     # 然后 npm run dev  /  npm run build
```

### 必踩的坑（都踩过了，别再踩）

1. **`npm` 在 PowerShell 里被策略拦住**（`PSSecurityException` on `npm.ps1`）。
   用 `npm.cmd` / `npx.cmd`，或者切到 Git Bash 用 `npm`。
2. **原生模块双 ABI**：`dev` / `build` 用 Electron ABI（`NODE_MODULE_VERSION 130`），
   Vitest 用 Node ABI（`127`）。跑测试报 `ERR_DLOPEN_FAILED` 就是 ABI 没切，
   `npm run native:node` 即可。**`dev` 在跑时会锁住 `.node` 文件**，切 ABI 前先关掉 dev。
3. **路径含中文**（`C:\程序\A素材管家`）：所有 shell 命令里的路径都要加引号。
4. **GUI 子进程必须 `windowsHide: false`**：`windowsHide: true` 会把 Unity 的
   **第一个顶层窗口**一起藏掉（实测 `MainWindowHandle=0`，用户看到"没反应"）。
   同理，更新用的安装器也必须是 `windowsHide: false`。
5. **Atrium 自己不能以管理员身份运行**：Unity 会继承权限，许可证校验会失败。
   代码里有 `isElevated()`（`whoami /groups` 查 `S-1-16-12288`）只做告警。
6. **E 盘没有回收站**：`shell.trashItem` 会失败，删除工程退化成移到
   `<数据根>/trash/<时间戳>-<名>`，需要用户自己清理。
7. **测试偶发 `EPERM`（Temp\ssr\...）**：来自沙盒的 fs shim，不是项目代码问题，
   `Test Files` 全绿时忽略它。

---

## 2. 当前进度（任务板 `docs/VPM-TASKS.md`）

| 卡 | 状态 | 备注 |
|---|---|---|
| P0 … P4-D | done | P4-E **review**（缺真 Unity 沙盒） |
| P5-D | **review** | 代码完成，缺真机启动验收 |
| P5-E / P6-D | todo / review | 都需要真 Unity |
| P6-A / P6-B / P6-C | done | |
| P7-A … P7-E | done | P7-A/P7-B 的 UI 已补齐 |
| P8-A / P8-B / P8-C | done | |
| **P8-D 逐行功能对账** | **todo ← 下一张** | 填 `docs/VPM-PARITY.md`，覆盖 A–K 全组 |
| P8-E 性能/可访问性/回归 | todo | |
| P9-A … P9-E | todo | 安全硬化 → 可靠性 → 性能 → 回退演练 → 发布 |

**P8-C 这一卡交付了什么**：设置项（预发布 / 隐藏包 / 两个配额 / 默认 Unity 参数 /
更新检查开关）、手动更新检查 → 下载 → 校验 → 用户点安装、已知限制写进 README 与 DEVELOPMENT。

---

## 3. P8-C 契约变化（给对账用）

### 新 IPC 通道（`shared/ipc.ts` → `IpcInvoke.Vpm`）

```text
vpm:settings-get     → VpmPreferencesDto
vpm:settings-patch   VpmPreferencesPatch → VpmPreferencesDto   // 逐字段校验，坏值整次拒绝
vpm:update-check     { force? } → VpmUpdateCheckDto           // 1 小时缓存
vpm:update-download  → VpmUpdateDownloadDto                   // 下载 + 校验 hash
vpm:update-install   { path } → { ok, errorCode }             // 只认 <数据根>/updates/Atrium-Setup-*.exe
```

### 新错误码（三语文案已补）

`vpmUpdateCheckFailed` / `vpmUpdateHashMismatch` / `vpmUpdateInstallFailed`

### 新文件

| 文件 | 作用 |
|---|---|
| `src/main/vpm/updater.ts` | 手动更新：check / download / runInstaller |
| `src/main/vpm/ipc/settings.ts` | 设置 + 更新 5 条 IPC |
| `src/shared/vpm/dto/settings.ts` | `VpmPreferencesDto` / `VpmUpdateCheckDto` 等 |
| `src/renderer/vpm/components/settings/` | 偏好设置面板 + 更新面板 |
| `tests/vpm/settings.spec.ts` | 17 条 |
| `tests/vpm/updater.spec.ts` | 19 条 |

### 行为语义（**改动前先读这段，容易踩**）

- **预发布开关只过滤浏览列表**（`CatalogService.query`）。
  包详情（`getPackage`）和解析目录（`resolverCatalog`）**不过滤** ——
  否则已装的预发布包会变成"查无此包"，依赖也解析不出来（规格原文：已装包不受影响）。
- 预发布偏好的另一条出口是 `PlanService.deps.defaultAllowPrerelease()`：
  解析请求没显式传 `allowPrerelease` 时，跟随设置。
- **隐藏包同理**：列表/详情隐藏，解析照旧。隐藏存在 VPM 设置里（用户偏好），
  不是仓库里的 `hidden` 标记。
- **默认 Unity 参数**在 `ipc/unity.ts` 的 `effectiveArgs()`：工程显式给了就用工程的，
  否则用设置里的（空格分隔，单条 ≤512 字符、最多 32 条）。

---

## 4. 顺手修掉的三个既有 bug（重要，会重复踩）

| # | 症状 | 根因 | 修法 |
|---|---|---|---|
| 1 | 缺表的 v6 数据库也能打开 | `VPM_REQUIRED_TABLES` 把 `vpm_local_root` 塞进了 `5:` 的数组，`[6]` 是 `undefined`，`assertSchema` 直接 `return` | 拆出独立的 `6:` 清单 |
| 2 | "支持的最高版本"落后三版 | `VPM_SCHEMA_VERSION` 硬编码 `3`，迁移表已到 6 | 改成从 `VPM_MIGRATIONS` 末项推导，并加漂移守卫测试 |
| 3 | 两条架构闸门是红的 | `main/index.ts` 静态引 `vpm/interop/deeplink`；`App.tsx` 静态引 `vpm/components/DeepLinkHost` | 深链改走 `vpm/gate` 再导出；渲染层改 `lazy(() => import(...))`；新增 `vpm/interop/index.ts` 作为文件夹公共入口 |

**`hashFromNotes` 的坑**（写测试时才暴露）：
不能用 `资产名 + [^0-9a-f] + 64位hex` 这种正则 —— `SHA-256：` 里的 `A` 是十六进制字符，
`[^0-9a-f]` 在那里断掉，`Atrium-Setup-0.9.1.exe\nSHA-256：<hash>` 解析成 `null`。
现在实现是"定位资产名 → 前后 160 字符窗口里找独立的 64 位十六进制串"。

---

## 5. 验证状态

**已验证（命令可复现）**

```bash
npm run typecheck                                  # 0
npx vitest run                                     # 219 文件 2688 passed / 19 skipped
npx electron-vite build                            # 过（DeepLinkHost 已单独成 chunk）
```

定向用例：`tests/vpm/settings.spec.ts`(17) · `tests/vpm/updater.spec.ts`(19) ·
`tests/vpm/db/migrate.spec.ts`(12) · `tests/vpm/runtime.spec.ts`(8) ·
`tests/renderer/vpm-ui.spec.ts`(6) · `tests/vpm/ipc/vpm-ipc.spec.ts`(9)

**未验证（接手人请补）**

1. **GitHub 联网更新检查**：本机代理把 `packages.vrchat.com` 都挡了，没真打过
   `api.github.com`。`updater.ts` 的 URL/解析逻辑只有假 http 的测试覆盖。
2. **安装包执行**：`runInstaller` 只做了路径白名单校验，没真跑过 `.exe`。
3. **真 Unity 启动 / 打开工程 / 双击素材导入**（P5-D、P5-E、P6-D 三张 review 卡）：
   只有 `Temp/UnityLockfile` + 窗口标题的实机证据，没有回归脚本。
4. **`shell.trashItem` 真机**：只在失败的盘上验过退化路径。
5. **UI 截图**：本轮没出新截图（偏好设置 / 更新两个面板是新增的，建议补）。

---

## 6. 下一步（按依赖顺序）

**P8-D 逐行功能对账**（下一张，前置 P8-A/B/C 全 done）

- 逐行填 `docs/VPM-PARITY.md`：实际状态、证据（测试文件/用例/PR/截图）、差异、去向。
- 覆盖 A–K 全部分组；**K（素材/桥接联动）是硬需求**，不能因为"不是 ALCOM 原功能"跳过。
- 目标=完整的行必须实际=完整且有证据；否则改成"部分"并写原因。
- A5/A6（角色/世界模板）如果仍缺 VRChat 推荐工程设置，保持"部分"并写进已知限制。

**P8-E 性能 / 可访问性 / 全量回归**：基准、键盘/焦点、回归记录。

**P9-A 安全硬化**：路径 / zip / 网络 / 密钥静态检查。

### 开工前必读（顺序别乱）

1. `docs/VPM-ARCHITECTURE.md` §9、§11（架构合同）
2. `docs/prompts/VPM-P8.md` §7、§8（本轮规格）
3. `docs/prompts/tasks/P8-D.md` + `docs/prompts/_COMMON.md`（任务卡与共同规则）
4. `docs/VPM-TASKS.md` §12 的 P1-A…P8-C 交接段
5. `src/main/vpm/README.md` + `src/main/vpm/ipc/README.md`（模块地图）

---

## 7. 架构红线（改了会被闸门当场抓）

这些都有测试守着，不是风格建议：

| 红线 | 守门测试 |
|---|---|
| 核心只允许静态引 `vpm/gate`（+ `shared/vpm/{linkage,errors}` 契约） | `tests/vpm/static-imports.spec.ts` |
| 渲染层 `vpm/*` 只能 `lazy(() => import(...))` | 同上 |
| 文件夹模块对外只暴露 `index.ts` | `tests/vpm/architecture.spec.ts` |
| 网络只允许在 `main/vpm/http/` | 两个架构测试都查 |
| SQLite 只允许在 `main/vpm/db|repos`（gate 快照是 P0 例外） | 同上 |
| 每个 `ipc.handle` 的通道必须在 `IpcInvoke` 里，且不能有死通道 | `tests/renderer/ipc-channels.spec.ts` |
| 三份语言文件 key 集合完全一致；新增错误码必须补三语文案 | `tests/renderer/i18n.spec.ts`、`tests/vpm/errors-i18n.spec.ts` |
| VPM 组件不直接碰 `window.a`；一屏只有一个实心主按钮 | `tests/renderer/vpm-ui.spec.ts` |

**新增 IPC 通道的三步**：`shared/ipc.ts` 登记 → 主进程 `ipc.handle` →
`src/preload/index.ts` + `src/shared/api.ts` + `src/renderer/vpm/api.ts` 三层包起来，
再把通道名加进 `tests/vpm/ipc/vpm-ipc.spec.ts` 的清单断言。

---

## 8. 数据与回退

- VPM 设置：`%APPDATA%\Atrium\vpm-settings.json`（原子写，坏文件改名 `.corrupt-*`）
- VPM 数据库：`%APPDATA%\Atrium\vpm.db`（schema v6，只前进迁移，升级前自动 `.bak`）
- 回退演练见 `docs/VPM-ROLLBACK.md`；本地包信任表是 v6 的 `vpm_local_root`
- 删除工程 → 回收站优先，失败退化到 `<数据根>/trash/`

---

## 9. 一句话给下一个 agent

先 `git add -A && git commit` 把 P8-C 这批改动落成一个 commit（commit message 参照
`git log` 里 P8-A/P8-B 的格式），然后开 **P8-D**：逐行对账 `docs/VPM-PARITY.md`，
把没证据的"完整"降级成"部分"并写清原因。
