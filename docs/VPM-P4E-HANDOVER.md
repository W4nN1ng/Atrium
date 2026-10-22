# P4-E 交接文档（包管理 UI、批量与真 Unity E2E）

> 写于 **2026-10-22 17:05**。读者：接手验收 / 下一个工作站 Agent。
>
> 状态：**代码完成，review**。缺的只有"真 Unity 2022.3.22f1 沙盒验收"——
> 这一条需要开 Unity，本工作站按要求不启动任何 GUI，所以没有做。

---

## 0. 一页结论

| 项 | 状态 |
|---|---|
| IPC（应用/状态/取消/历史/撤销/catalog） | ✅ |
| 包管理 UI（版本下拉、批量条、升级全部、变更单、进度/结果/撤销、历史） | ✅ |
| 受保护包只读展示、Unity 运行中禁用 | ✅ |
| 撤销（仅最后一次且工程未变） | ✅ |
| typecheck / build | ✅ `tsc --noEmit` exit 0；`electron-vite build` 通过 |
| 测试 | ✅ `tests/renderer` + `tests/vpm` = 70 files / 650 tests；新增 22 条 |
| **真 Unity 沙盒验收** | ❌ **没做**（需要 GUI，步骤见 §6） |
| 100% / 125% 缩放目视 | ❌ 没做（需要真实窗口） |

**结论：P4-E 在任务板上是 `review`，不是 `done`。补完 §6 的验收就能转 done。**

---

## 1. 新增/修改文件

### 新增

| 文件 | 作用 |
|---|---|
| `src/shared/vpm/dto/install.ts` | 操作/进度/历史/撤销/catalog 的 DTO |
| `src/shared/vpm/domain/undo.ts` | `reverseRequests()`：从计划推导反向请求（纯函数） |
| `src/main/vpm/undoService.ts` | `UndoService`：`canUndo()` 闸门 + `undo()`（反向计划走同一事务） |
| `src/main/vpm/ipc/install.ts` | 6 个通道 + 3 个事件 + 取消句柄 |
| `src/renderer/vpm/lib/cart.ts` | 版本比较、变更单、筛选、请求组装（纯函数） |
| `src/renderer/vpm/hooks/useVpmOperations.ts` | 应用/取消/撤销 + 进度事件 + 历史 |
| `src/renderer/vpm/components/packages/VpmPackagesPanel.tsx` | 包管理面板主体 |
| `src/renderer/vpm/components/packages/VpmApplyPlanSheet.tsx` | 变更单 + 风险确认 + 应用 |
| `src/renderer/vpm/components/packages/VpmOperationDialog.tsx` | 进度/结果/取消/撤销 |
| `tests/vpm/ipc/install.spec.ts` | IPC 9 条 |
| `tests/vpm/domain/undo.spec.ts` | 反向请求 4 条 |
| `tests/vpm/renderer/cart.spec.ts` | 变更单/筛选 9 条 |

### 修改

| 文件 | 变化 |
|---|---|
| `src/shared/ipc.ts` | +6 invoke、+3 event |
| `src/shared/api.ts` / `src/preload/index.ts` | 对应方法 |
| `src/renderer/vpm/api.ts` | 类型化转发 + 3 个订阅 |
| `src/renderer/vpm/components/projects/VpmProjectsSection.tsx` | 详情里原来的只读包列表 → `VpmPackagesPanel` |
| `src/renderer/vpm/components/plan/VpmPlanSheet.tsx` | 导出 `PlanBody` 供变更单复用 |
| `src/main/vpm/install/transaction.ts` | `ApplyPlanInput` 增加 `onStarted` / `kind` |
| `src/main/vpm/index.ts` | 组合根新增 `undo` |
| `src/shared/vpm/errors.ts` + 三语 i18n | `vpmUndoUnsafe` / `vpmCancelTooLate` + `vpm.packages.*` |
| `tests/renderer/{i18n,ipc-channels}.spec.ts` | 动态前缀白名单；事件扫描也认 `IpcEvent.X` 常量 |
| `tests/vpm/ipc/vpm-ipc.spec.ts` | 通道清单 +6 |

---

## 2. IPC 契约

```text
vpm:plan-apply        { projectKey, planId } → VpmOperationDto
vpm:operation-status  operationId            → VpmOperationDto
vpm:operation-cancel  operationId            → { ok, tooLate }
vpm:operation-history projectKey             → VpmOperationSummaryDto[]
vpm:operation-undo    operationId            → VpmOperationDto
vpm:project-catalog   projectKey             → { packages[], truncated }
```

事件：

```text
vpm:operation-started  { operationId, projectKey }
vpm:operation-progress { operationId, projectKey, step, phase, index, total }
vpm:operation-done     { operationId, projectKey, status, errorCode }
```

要点：

- **只传 planId**。渲染层给不了计划内容，主进程按 planId 重新校验。
- `plan-apply` 是 await 到结束才返回的；进度靠事件，`operation-started` 让界面在返回前就能显示进度/取消。
- 取消：提交点（manifest 写入）之前 abort 有效；之后返回 `{ok:false, tooLate:true}`，操作会跑完。
  进程重启后取消句柄表是空的，也会返回 `tooLate`（诚实，不假装取消）。
- `operation-status` 不依赖事件：事件丢了、面板重开都能恢复。

---

## 3. UI 行为

工程详情 → 包：

- 顶部：已装 N / 可更新 N + 次要按钮"升级全部（最新）"。
- 工具栏：搜索 + 筛选（全部 / 已安装 / 可更新 / 有冲突）。
- 行：勾选、包名、**已安装版本下拉**（选项来自仓库版本 + 当前版本，当前项标"（当前）"）、
  最新版本、状态、重装、移除（红减号 + 二次确认）。
- 勾选才出现底部变更条（不常驻）；"查看更改"打开变更单。
- 变更单：`PlanBody` 展示动作/来源/冲突/缺失/下载 + 风险确认勾选 + "应用更改"（需二次点击确认）。
- 执行：进度对话框（步骤 + 取消）→ 结果（状态/错误码/已装已卸/警告/是否回滚/`needs_attention` 说明）
  → 成功时给"撤销这次操作"。
- 历史：最近 8 条，显示状态/时间/变更数/不能撤销的原因。
- 受保护包（`com.avca.bridge`）：显示"系统包"，没有勾选、版本、移除、重装。
- `detail.running === true`（Unity 在跑）：所有写入口禁用并给说明。

**没有做的事**（任务卡没要求或属于后续卡）：

- 添加包抽屉（P3 的 `CatalogDialog` 仍是只读浏览，没有"加入更改"）。
- 撤销前的预览（现在是确认后直接跑反向计划；结果对话框里能看到装/卸了什么）。
- 缓存/回滚仓用量（P8-B）。

---

## 4. 撤销的安全闸门

`UndoService.canUndo()` 同时要求：

1. 那次操作 `status === 'committed'`；
2. 它是该工程**最新**的一条操作；
3. 当前 `manifest hash === 那次操作的 manifestAfterHash`（之后没人改过工程）；
4. 没有活动操作、Unity 没在运行；
5. `reverseRequests(plan.changes)` 非空。

不满足就抛 `vpmUndoUnsafe`，历史行里直接显示原因（`notLatest` / `projectChanged` / …）。

反向规则：install→remove、remove→install(原版本)、upgrade/downgrade→install(原版本)、
reinstall→reinstall。撤销本身也是操作（`kind='undo'`），所以可以再撤销。

---

## 5. 证据

```
npm run typecheck                     → exit 0
npx electron-vite build               → 通过（VpmProjectsSection chunk 75.97 kB）
npx vitest run tests/renderer tests/vpm → 70 files / 650 tests passed
```

新增用例覆盖：

- 只传 planId（断言 `ApplyPlanInput` 上没有 plan 字段）；
- 输入校验（缺 projectKey/planId、非对象）；
- `started → progress ×2 → done` 的广播顺序与 payload；
- 提交点前取消会 abort signal 并回滚；提交点后返回 `tooLate`；未知 id 抛错；
- 状态映射（move-in/move-out → installed/removed）、历史 `canUndo` 与原因、撤销广播；
- catalog 只返回非受保护包、版本列表与 `truncated` 语义；
- 反向请求：四种动作 + 跳过 keep/无版本 + 去重排序；
- 变更单：默认升级到最新、无更新时重装、受保护包永远进不去、显式版本/移除、排序请求；
- 筛选与计数。

---

## 6. 真 Unity 验收（**缺的就是这一段**）

环境（用户执行，别让 Agent 代跑）：

```powershell
# 数据根必须非 C；AVCA_APP_HOME 必须含 avca/sandbox
$env:AVCA_APP_HOME = 'E:\avca-sandbox\app'
$env:AVCA_REQUIRE_SANDBOX_HOME = '1'

cd C:\程序\A素材管家
npm run dev          # 或安装版
```

清单：

1. 设置 → 项目与包：启用、选非 C 数据根、添加一个**沙盒工程**（Unity 2022.3.22f1）。
2. 工程详情 → 包：确认能看到已装包、最新版本、可更新数量；受保护包显示"系统包"且无操作入口。
3. 装一个真实包（如 `com.vrchat.base` 3.7.0）：
   - 勾选/选版本 → 查看更改 → 勾风险确认 → 应用；
   - 进度对话框走完，结果为"已完成"；
   - `Packages/com.vrchat.base` 存在，`vpm-manifest.json` 的 dependencies/locked 正确。
4. **打开 Unity**（同一个工程）：Console 无包错误、无编译错误。
5. 检查工程根目录的 `.atrium-tx`：Unity 打开后是否还在（是否被忽略）。
6. 关 Unity → 卸载该包 → 包目录消失、回滚仓有副本、manifest 清空。
7. 撤销上一次卸载 → 包回来、manifest 恢复。
8. Unity 运行中再点"应用" → 入口禁用/预检报 `vpmUnityRunning`。
9. 素材导入进行中（双击素材导入）→ 报 `vpmProjectImporting`（P4-F 接上端口后会提前禁用）。
10. 截图：100% 与 125% 缩放各一张（工程详情包列表 + 变更单 + 结果对话框）。

把结果补进本文档 §5 和任务板，P4-E 就可以从 `review` 转 `done`。

---

## 7. 已知限制

- **添加包抽屉没做**：现在只能对"已装包"升级/降级/重装/卸载；装新包仍走 P3 的只读浏览。
  这是本卡最大的一处缺口（任务卡 §交付物写的是"版本下拉、批量、升级全部"，没写抽屉，
  但 P4 规格 §10.1 有）。如果要补，建议单独一张小卡。
- **撤销没有预览**：确认后直接执行；结果对话框能看到装/卸清单。
- **进度粒度是"步骤"**（9 步），不是每文件；符合"进度节流 ≥100ms、不要每文件一条 IPC"。
- **`needs_attention` 没有"继续/回滚"按钮**：结果里只说明需要人工确认。
  `OperationRecover` 通道没做（P4 规格 §9 列了，但 P4-E 卡没要求）；恢复入口属于后续卡。
- 受保护包判断来自工程快照的 `state === 'protected'`，不是硬编码包名（`com.avca.bridge` 在
  `shared/vpm/domain/project.ts` 里判定）。

---

## 8. 给下一个任务

- **P4-F（工程活动闸门）**：把真实 `ProjectActivityPort` 注入 `initVpm({ projectActivity })`，
  预检与撤销闸门已经用它；界面侧可以再补 `importing` 的提前禁用。
- **补 P4-E 的验收**：按 §6 跑一遍，把证据写回来。
- **添加包抽屉**（如果要做）：复用 `CatalogDialog` 的搜索/版本选择，加"加入更改"，
  把选中的包塞进 `cart`（`kind:'install'` + `version`），后面完全复用现有变更单/事务。

---

## 9. 环境与坑

| 坑 | 说明 |
|---|---|
| `better-sqlite3` ABI | 构建过 Electron 后跑测试要先 `npm run native:node` |
| 全量测试约 3.3 分钟 | `tests/perf/scale.spec.ts` 占 160s |
| 项目路径含中文 | `C:\程序\A素材管家` |
| 不弹窗 | 开发期间不要启动 Electron/Unity/浏览器预览；需要目视的验收由用户执行 |
