# VPM 性能与可访问性报告（P8-E）

> 2026-10-23。环境：Windows 11，16 GB，Node v24.21.0（测试）/ Electron 33.4.11（构建），
> 仓库 `C:\程序\A素材管家`，VPM 数据根 `%APPDATA%\Atrium`（R19，用户已接受）。
>
> 复现：
>
> ```bash
> npm run native:node
> VPM_PERF_ISOLATED=1 NODE_OPTIONS=--expose-gc npx vitest run tests/perf/vpm-perf.spec.ts
> npx vitest run tests/renderer/vpm-a11y.spec.ts tests/renderer/vpm-contrast.spec.ts
> npx esbuild tools/preview/verify.tsx --bundle --format=iife --platform=browser --jsx=automatic \
>   --loader:.json=json --define:process.env.NODE_ENV='"production"' --outfile=tools/preview/verify.js
> cp "$(ls -t out/renderer/assets/index-*.css | head -1)" tools/preview/app.css
> env -u ELECTRON_RUN_AS_NODE npx electron tools/preview/a11y.cjs
> ```

## 1. 结论

- 5,000 个包版本的目录查询 **p95 145.25ms**（预算 200ms）；单包精确查询 p95 14.09ms；
  单包详情 p95 0.59ms。
- 200 个根包在 5,000 行目录上解析 **p95 25.26ms**（预算 200ms）；生成计划 p95 30.89ms；
  200 条变更预检 p95 0.48ms。
- 10,000 个工程文件收集 **597ms / 10002 文件**，堆增长 2.4 MB（预算 15s / 256MB）。
- 可访问性：菜单焦点/方向键/End/Esc 回锚点、弹窗焦点陷阱 Tab/Shift+Tab/Esc、100%/125%
  无横向溢出，14 项离屏检查全过；对比度全部 ≥4.5:1。
- 没有改事务语义；性能/可访问性改动只在渲染层与测试。

**注意**：全量 Vitest 并行跑 50k 素材基准时，同一目录查询的 p95 会从 ~145ms 漂到
~300ms。所以这份严格计时组默认 `skip`，用上面的 `VPM_PERF_ISOLATED=1` 显式跑；
全量测试仍跑结构/数量断言（该组 3 条显示 skipped，不是失败）。

## 2. 性能基线

### 2.1 目录（`tests/perf/vpm-perf.spec.ts`）

数据：2,500 个包 × 2 个版本 = **5,000 行**，1 个仓库；查询前 warmup 2 次，取 12 次。
内存数字在 `--expose-gc` 下先 GC 再采样。

| 场景 | p50 | p95 | 预算 | 结果 |
|---|---:|---:|---:|---|
| `catalog.query({text:'perf',limit:100})`（2.5k 包全命中） | 139.14ms | **145.25ms** | <200ms | 过 |
| `catalog.query({text:单包名})` | 11.93ms | 14.09ms | <100ms | 过 |
| `catalog.getPackage(单包详情)` | 0.35ms | 0.59ms | <50ms | 过 |
| `catalog.resolverCatalog()`（5,000 行） | 77.05ms | 84.40ms | <300ms | 过 |
| 查询期间堆增量 | — | 0.2 MB | <128MB | 过 |

### 2.2 解析 / 计划 / 预检

数据：200 个根包，目录 5,000 行；无依赖；Unity 2022.3.22f1。

| 场景 | p50 | p95 | 预算 | 结果 |
|---|---:|---:|---:|---|
| `resolveVpmDependencies`（200 根） | 20.42ms | **25.26ms** | <200ms | 过 |
| `buildChangePlan`（200 根） | 23.28ms | 30.89ms | <500ms | 过 |
| `evaluatePreflight`（200 changes） | 0.22ms | 0.48ms | <20ms | 过 |

### 2.3 工程收集（备份/复制共用）

数据：10,000 个空文件，100 个 `Assets/Perf/dNNN` 目录，外加 manifest/ProjectVersion。

| 场景 | 实测 | 预算 | 结果 |
|---|---:|---:|---|
| `collectProjectFiles({mode:'backup'})` | **597ms / 10002 文件** | <15s | 过 |
| 收集期间堆增量（GC 后） | 2.4 MB | <256MB | 过 |

### 2.4 瓶颈与判断

- 目录查询 145ms 主要花在 SQL `LIKE` + 5,000 行分组/排序；离 200ms 只剩 ~55ms 余量。
  5,000 个包版本是规格上限附近，10,000 行会接近/超过预算 → 记入 **P9-C**，
  需要时加分页/预聚合索引，不在 P8-E 改事务/目录语义。
- 收集 10k 文件 597ms，远低于 15s；瓶颈是文件系统 stat，不是内存。
- 解析 200 包 25ms，计划/预检都在毫秒级；P3 的确定性贪心没有性能问题。

## 3. 可访问性

### 3.1 代码修复

- `MenuButton`（`src/renderer/components/ui.tsx`）：
  - 触发按钮 `aria-haspopup="menu"` / `aria-expanded` / `aria-label`；
  - 面板 `role="menu"`，条目 `role="menuitem"` + 原生 `button`；
  - 打开时焦点进第一项；`ArrowUp/ArrowDown/Home/End` 移动；`Escape` 关闭并回触发按钮。
- `Switch` 支持 `ariaLabel`；VPM 的联网、仓库启用、预发布、更新检查开关已补名称。
- 工程创建对话框的模板卡：去掉 `<button>` 内嵌 `role="button"` 的非法结构，
  收藏改成同级原生按钮（`aria-pressed`）。
- 包操作/变更单/计划/目录/创建/维护/日志的错误框加 `role="alert"`；
  操作进度加 `role="status" aria-live="polite"`。
- 对比度：深/浅两套主题的 `--faint` 提亮/加深；浅色 `--ok`、`--warn` 加深；
  新增 `--accent-strong` 专供白字主按钮（`--accent` 仍作文本色）。

### 3.2 对比度（WCAG AA 4.5:1）

| 主题 | text/bg | muted/panel | faint/panel | accent/panel | 白字/accent-strong | bad/panel | warn/panel | ok/panel |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 深色 | 15.56 | 6.07 | **4.67** | 4.58 | **4.87** | 4.97 | 7.89 | 6.83 |
| 浅色 | 17.12 | 6.59 | **5.18** | 6.14 | 6.14 | 5.24 | 5.05 | 5.32 |

守卫：`tests/renderer/vpm-contrast.spec.ts` 对两套主题的 text/muted/faint/bad/warn/ok/accent
在 panel 与 bg 上都断言 ≥4.5；白字主按钮走 `accent-strong`。

### 3.3 离屏键盘/焦点探针（`tools/preview/a11y.cjs`）

14 项全过：

| 检查 | 结果 |
|---|---|
| 菜单 `role=menu` / 打开后焦点在第一项 | 过 |
| `ArrowDown` 移动、`End` 聚焦最后一项 | 过 |
| `Escape` 关菜单并把焦点还给 `⋯` | 过 |
| 菜单项是原生 `button`（Enter/Space 由浏览器语义保证） | 过 |
| 删除弹窗打开后焦点在 `[role=dialog]` 内 | 过 |
| `Tab` / `Shift+Tab` 不逃出弹窗 | 过 |
| `Escape` 关闭弹窗 | 过 |
| 100% / 125% 无横向溢出 | 过（0px） |

截图：`docs/screenshots/vpm-p8e-100.png`、`vpm-p8e-125.png`
（Electron offscreen，不是真实 DPI；见 §5）。

静态守卫：`tests/renderer/vpm-a11y.spec.ts` 5 条（每个 Modal 有 title、每个 Switch 有
名称、VPM 无伪 button role、共享菜单语义、关键错误框 alert）。

## 4. 全量回归

| 闸门 | 结果 |
|---|---|
| `npm run typecheck` | 0 |
| `npm test` | **224 files passed / 10 skipped（234）**；**2760 passed / 22 skipped（2782）** |
| `npx electron-vite build` | 0 |
| `node tools/check-worker-deps.cjs` | 0（worker 图 2 个文件自包含） |
| `node tools/check-vpm-taskpack.cjs` | 0（45 张卡 / 117 对账项） |
| `tests/renderer/vpm-a11y.spec.ts` | 5/5 |
| `tests/renderer/vpm-contrast.spec.ts` | 2/2 |
| `VPM_PERF_ISOLATED=1 … vpm-perf.spec.ts` | 3/3（本报告数字） |
| 本机安装版启动 | 0.9.0（P8-E 构建）正常启动，VPM enabled，dataRoot `%APPDATA%\Atrium`；未操作工程 |

全量里的 22 个 skip = 原有 19 + 环境性 skip + 性能组 3 条（默认 opt-in）。
不是失败。

## 5. 未验证 / 已知限制

- **真实屏幕阅读器**（NVDA/讲述人）没有跑；只做了 DOM/焦点/ARIA 与离屏探针。
- **真实 100%/125% DPI** 没有在物理显示器上目视；截图是 Electron offscreen + zoomFactor。
- **真实窗口的键盘走查**没有做：安装版 0.9.0 已启动过（VPM enabled），但键盘/焦点证据来自
  离屏 `verify.html`；真窗口 Tab/Esc/Enter 归 P9-D。
- **合成 Enter**：离屏 `sendInputEvent` 对原生 button 默认 click 的模拟不稳定，未把合成
  Enter 算通过；菜单项是原生 `button`，Enter/Space 由浏览器语义保证，静态测试守住这一点。
- **A13**（Unity 已运行→窗口顶到前台）未实现，保持部分；P8-E 标为可选，不阻塞本卡。
- **真 Unity/VCC/GitHub 更新/安装器**仍归 P9-D/P9-E；本报告不把它们算作已验证。
- 目录查询的 145ms 余量偏小；P9-C 需要时再做索引/分页，本卡不改语义。

## 6. 下一步

- P8-F：模板编辑 UI（A8）。
- P9-C：目录 10k 行/长稳/版本矩阵；P9-D 真 Unity + 回退演练；P9-E 更新/安装器/发布。
