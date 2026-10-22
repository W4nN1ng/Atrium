# P5-D 交接文档（启动 Unity、工程/模板 UI 与真机）

> 写于 **2026-10-22 19:05**。读者：P5-E（双击素材真机验收）的接手人。
>
> 状态：**review**。代码完成，缺"真 Unity 启动 + 打开新建工程"的验收（需要 GUI）。

---

## 0. 一页结论

| 项 | 状态 |
|---|---|
| 编辑器解析（指定 / 台账 / 按版本，精确优先） | ✅ |
| 启动（数组参数、detached、不拼 shell、失败清绑定） | ✅ |
| 先 `bindLaunchTarget` 再 spawn；已运行不重复启动但仍绑定 | ✅ |
| 新建工程对话框（模板卡片 / 名称 / 位置 / Unity 版本） | ✅ |
| 工程详情"打开 Unity"（编辑器下拉 + 自动） | ✅ |
| 模板列表 + 收藏 + 最近位置 | ✅ |
| typecheck / 定向测试 | ✅ 10 条新用例 |
| **真 Unity 启动 / 打开新工程** | ❌ 需要 GUI |
| 自定义参数编辑 UI、模板编辑器（新建/编辑/复制） | ❌ 本卡未做（见 §5） |

---

## 1. 契约变化

| 变化 | 说明 |
|---|---|
| `main/vpm/unity/launch.ts` | **新增** `UnityLaunchService` / `sanitizeArgs` |
| `main/vpm/ipc/unity.ts` | **新增** 7 个通道（见下） |
| `shared/vpm/dto/unity.ts` | **新增** 编辑器/启动/创建/模板/最近位置 DTO |
| `VpmRuntime.launch` | **新增** |
| 新错误码 | `vpmUnityLaunchFailed`（三语） |

```text
vpm:unity-installs       → VpmUnityInstallDto[]
vpm:project-launch       { projectKey, editorPath?, extraArgs? } → VpmLaunchResultDto
vpm:project-launch-args  { projectKey, extraArgs? } → string[]     // 参数预览
vpm:project-create       VpmCreateProjectInput → VpmCreateProjectResultDto
vpm:template-list        → VpmTemplateDto[]
vpm:template-favorite    { id, favorite } → VpmTemplateDto
vpm:template-recent      → VpmRecentLocationDto[]
```

---

## 2. 启动规则（`UnityLaunchService`）

编辑器解析顺序：

1. 本次显式指定（`editorPath`）——**只影响这一次**，不写版本文件；
2. 工程台账的 `unity_exe_path`（存在且是文件）；
3. 按 `ProjectVersion.txt` 的 **base 版本**（`2022.3.22f1` → `2022.3`）匹配已发现编辑器，
   精确版本优先、其次路径排序（保证同输入同结果）；
4. 找不到 → `vpmUnityNotFound`，**不自动换版本**。

参数：

- 只作为数组传 `spawn(exe, ['-projectPath', path, ...extra])`，`shell: false`；
- 拒绝空字节、`\r`/`\n`、空串、非字符串、超过 64 个或单个超过 4096 字符。

进程：

- `detached: true`、`stdio: 'ignore'`、`windowsHide: true`、`unref()`，不等退出；
- **先 `bindLaunchTarget` 再 spawn**（绑定立即生效，双击素材能等它起来）；
- spawn 抛错或异步 `error` 事件 → `clearLaunchTarget` + `vpmUnityLaunchFailed`；
- 已在运行 → 不重复启动，返回 `alreadyRunning`，**仍然绑定目标**。

---

## 3. UI

- **工程页**：主按钮从"添加工程"换成"新建工程"（实心），添加已有降为次要。
- **新建对话框**（一屏两步）：
  - 模板卡片：名称、内置/收藏徽标、依赖数/附件数、Unity 范围、描述；用户模板可收藏/取消收藏；
  - 名称（Windows 规则提示）、位置（输入 + 目录选择 + 最近位置快捷 chips）、Unity 版本
    （只列已发现编辑器）；
  - "创建"：依赖没装完时不关窗，给 `dependenciesFailed` 警告并仍然把工程选中。
- **工程详情**：底部"打开 Unity" + 编辑器下拉（默认"自动（按工程版本）"）；
  已运行显示"Unity 已在运行，已设为导入目标"。
- **导入目标徽标**：沿用核心 `isTarget`（P2-E 已有），本卡没有第二份目标状态。

---

## 4. 证据

```
npm run typecheck                                → exit 0
npx vitest run tests/vpm/unity/launch.spec.ts    → 10 passed
npx vitest run tests/vpm                         → 48 files / 486 tests
npx vitest run（全量）                            → 2536 passed / 1 failed / 19 skipped (2556)
```

唯一红的是 `tests/classify/unitypackage.spec.ts` 的 perf 断言（并行争抢，单独跑必过）。

启动测试覆盖：按 base 版本匹配 + 精确优先、台账路径优先、显式路径不改版本文件、
找不到报错不换版本、参数拒绝矩阵、`bind` 在 `spawn` 之前、detached/shell:false/stdio 选项、
已运行不重复启动但绑定、spawn 抛错清绑定、缺 `ProjectVersion.txt` 拒绝。

---

## 5. 未验证 / 未做

1. **真 Unity 启动与打开新工程**：没有启动过 Unity，也没有截图。这是本卡 review 的唯一原因。
2. **自定义参数编辑 UI**：`project-launch-args` 通道与校验都在，但没有输入界面
   （工程设置里的 `unityArgs` 编辑留给 P5-E/后续）。
3. **设置页的模板编辑器**：新建/编辑/复制模板的 UI 没做；本卡只做了创建对话框里的
   模板列表与收藏。P5-A 的服务层（create/update/duplicate）都已就绪。
4. **多实例目标抢占**：`bindLaunchTarget` 的语义由核心连接层保证，本卡只调用；
   真机多实例场景留给 P5-E。

---

## 6. 真机验收步骤（用户执行）

```powershell
$env:AVCA_APP_HOME = 'E:\avca-sandbox\app'
$env:AVCA_REQUIRE_SANDBOX_HOME = '1'
cd C:\程序\A素材管家
npm run dev
```

1. 工程页 → 新建工程 → 选"空白工程" → 名称 `P5D-Blank`、位置 `E:\avca-sandbox\projects`、
   Unity 选 2022.3.22f1 → 创建。
2. 详情里点"打开 Unity"：Unity 应启动并打开该工程（Console 无包错误）。
3. 再建一个"角色工程"，创建后确认依赖装上（`Packages/com.vrchat.avatars` 存在），
   再打开 Unity 确认无包错误。
4. 工程已运行时再点"打开 Unity" → 提示"已在运行，已设为导入目标"，不会开第二个实例。
5. 把编辑器下拉切到另一个版本 → 只影响本次启动，`ProjectVersion.txt` 不变。
6. 删掉一个编辑器（或选一个不存在的路径）→ 报 `vpmUnityNotFound`，不会偷偷换版本。
7. 截图：新建对话框、打开 Unity 成功、已运行提示。

---

## 7. 给 P5-E

- 双击素材导入依赖：P4-F 活动闸门（导入中拒绝装包）+ 本卡的 `bindLaunchTarget`。
- 真机重点：
  1. 启动后徽标从"启动中/连接中"变成"当前导入目标"；
  2. 已运行也绑定（`alreadyRunning` 分支）；
  3. 启动失败后徽标不能停在旧工程上（`clearLaunchTarget` 生效）。

---

## 8. 环境与坑

| 坑 | 说明 |
|---|---|
| `better-sqlite3` ABI | 构建过 Electron 后跑测试要先 `npm run native:node` |
| 通道清单测试 | 新增 IPC 要同步 `tests/vpm/ipc/vpm-ipc.spec.ts` 的期望列表 |
| 全量测试约 3.7 分钟 | `tests/perf/scale.spec.ts` 占大头；`classify/unitypackage` 的 perf 用例偶发红 |
