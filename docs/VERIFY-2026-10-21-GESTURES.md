# 2026-10-21 交互简化：验收到哪一步

> 基线：`f105f3a`（0.7.0，SCHEMA 11）。本轮源码 `0.8.0`，**没有**发 GitHub Release。
> 批准文档：[PROMPT-INTERACTION-SIMPLIFY.md](PROMPT-INTERACTION-SIMPLIFY.md)（Q1–Q10 全按推荐）。
> 这一页只写**实际跑过什么、看到什么**；没有跑到的单独列在最后，不拿“应该没问题”充数。

## 1. 自动验证

| 项目 | 结果 |
| --- | --- |
| `npm run typecheck` | 干净（node + web 两套 tsconfig） |
| `npm test`（构建前置） | **149 个文件通过 / 9 跳过；2049 条通过 / 19 跳过（共 2068）** |
| `npm run build` | exit 0；`Atrium-Setup-0.8.0.exe` 87,131,831 B，`Atrium-portable-0.8.0.exe` 86,897,742 B |
| `node tools/pkg-version.cjs` | asar 0.8.0 / MIT / 依赖闭包 91 个，与源码一致，asar 不比源码旧 |
| `node tools/verify-red-r10.cjs` I 组 | 基线 **589 条全绿**；I1–I8 八处变异每处都至少红 1 条（I6 红 2 条） |

I 组变异（`tools/verify-red-r10.cjs`）：

1. 双击普通卡退回“进入合集”
2. 长按对所有卡生效
3. 长按常量改回 900ms
4. 双击前多选快照被清空
5. 双击合集只开面板不预勾
6. 详情面板把「导入到 Unity」加回来
7. App 又抢容器内部的 Enter
8. 合集卡 title 不再提双击导入

另外新增/改写的用例在：

- `tests/shared/card-gesture.spec.ts`（5 条：1000ms、8px 边界、修饰键）
- `tests/renderer/gesture-wiring.spec.ts`（13 条：网格/列表接线、双击分流、快照、取消、title、禁用 key、设置删除、Enter 容器闸）
- `tests/renderer/r10-container-and-copy.spec.ts`（容器内不再有导入按钮、行双击、复选框 stopPropagation、`importWhole` 顺序）
- `tests/shared/member-pick.spec.ts`（多个直导包 → `needs-choice`）
- `tests/renderer/batch-import-store.spec.ts`（Enter 单选合集走 `importWhole`）

## 2. 打包版活体（最终一场全绿）

环境：`AVCA_APP_HOME=D:\avca-m7-live\r10-home`、`LOCALAPPDATA` 同根、`AVCA_REQUIRE_SANDBOX_HOME=1`；
素材库 `D:\avca-m7-live\r10-lib`；夹具全是 D 盘临时目录里的假包。跑之前检查
`E:\ALCOMprojects\*\Temp\UnityLockFile`，**Unity 关闭**才起沙盒；真实库 `E:/Atriumdate` 与真工程一个字没碰。
起界面后还断言了沙盒里 `listProjects()` 为 **0 个工程**。

| 判据 | 实测 |
| --- | --- |
| 状态栏（网格） | 显示 `双击导入 · 长按 1 秒打开合集` |
| 双击合集卡 | **不再**进容器；走导入链路，无工程时提示先开 Unity |
| 双击普通卡 | 走导入链路（无工程时提示先开 Unity），不再只是打开详情 |
| 常驻导入按钮 | 网格/详情/容器行/容器顶部/容器底部 **0 颗**（探针里有提示条按钮，已排除） |
| 多选双击 | 框 3 张 → 普通 click 把选区收敛 → 双击后还原成 **已选 3 项**，走批量链路 |
| 长按进度条 | 按住 150ms 时出现，内联 `animation-duration: 1000ms` |
| 长按取消 | 按住 300ms 松手，等过 1 秒仍在列表；移动 40px 后条消失，等过 1 秒仍不进 |
| 长按成功 | 真按住 1.15 秒 → 进入合集容器 |
| 容器行双击 | 行 DOM 收到 dblclick，走导入链路（无工程 → 提示先开 Unity），仍在容器 |
| 容器滚动 | 24 行滚到底（`scrollTop=863 / scrollHeight=1565 / clientHeight=702`），最后一行在视口内 |
| 旧文案 | 容器与设置页没有 `M\d` / “交付” / 过期占位 |

截图（`docs/screenshots/`）：

- `gesture-grid-hint.png`：网格、详情面板手势提示、底部状态栏、合集卡
- `gesture-batch-hint.png`：多选 3 张后的批量提示与还原选区
- `gesture-container-no-import.png`：容器内没有任何导入按钮
- `gesture-row-import.png`：容器行双击后的“先开 Unity”提示
- `r10-1` / `r10-2` / `r10-3` / `r10-4`：本轮之前已有的筐摊平、别名搜索、滚动到底、设置页

### 活体里先抓到的两条“假红”（产品没坏，是探针坏了）

1. 提示条本身是 `<button>`，文案里有 `Unity…导入`，被“导入到 Unity 按钮计数”误算成常驻按钮。
   现在查询会排除提示条容器（`.fixed.bottom-8`）。
2. `find('div','测试道具24').slice(-1)[0]` 取到的是**详情面板**里的同名行，不是容器行；
   上一版因此双击了没有 handler 的 DOM，却差点怪产品。现在容器行的判据是“直接子元素里有 checkbox”。

## 3. 没有验到的（别当成已验）

| 项 | 为什么 | 现有兜底 |
| --- | --- | --- |
| 真实工程里的“成员面板 + 全预勾” | 沙盒刻意 0 个工程，双击只能停“先开 Unity” | `importWhole` 顺序用例 + member-pick 单测 |
| 多选批量的真实导入结果 | 同上，只到“解析目标”这步 | `batch-import-store.spec.ts` 34 条 + 既有导入链路用例 |
| 真实 Unity 的冲突/备份/撤回 | 本轮没改导入安全链路 | 前几轮真机记录与现有用例 |
| 从资源管理器真拖文件 | 脚本只能合成 DragEvent | 前几轮 [!drag] 日志与人工验证；本轮未重测 |
| 长按 930/980ms 的临界点 | 临界采样会让 CDP 往返把检查推到计时器之后（实测偶发假红） | 常量 1000ms 由单测钉，进度条内联时长与 1.15 秒成功路径由活体钉 |
| 列表视图的鼠标手势 | 本轮活体只走网格 + 容器；列表接线由源码用例钉 | `gesture-wiring.spec.ts` 的 AssetRowView 断言 |

## 4. 本机安装（已装）

安装前先把本机正在跑的 Atrium 0.7.0 关闭（5 个进程，主窗口关闭请求后残留子进程已退干净），
然后 `MSYS_NO_PATHCONV=1 dist\Atrium-Setup-0.8.0.exe /S` 覆盖安装：

- 注册表 `DisplayVersion = 0.8.0`；`node tools/installed-version.cjs --expect=0.8.0` ✅
- 安装目录 `%LOCALAPPDATA%\Programs\Atrium\resources\app.asar` 构建于 2026-10-21 04:10（与 dist 一致）
- `node tools/pkg-version.cjs "$LOCALAPPDATA\Programs\Atrium"`：版本 / MIT / 依赖闭包三项都过

⚠ 第一次用 Git Bash 直接带 `/S` 会被 MSYS 改写成 `S:/`，安装器会弹 UI 停住 —— 必须加
`MSYS_NO_PATHCONV=1`（或写 `//S`）。这次装的时候踩了一次，记在这里。

GitHub Release **等用户实际用过并点头**再发；本轮没有 commit/push/release。
