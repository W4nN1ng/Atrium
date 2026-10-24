# P5-D 启动 Unity、工程/模板 UI 与真机

> ⚠️ **UI 部分已被 `../VPM-UX-RESET.md` 取代（2026-10-22）**：本卡只保留服务层要求，
> 界面按 UX-RESET 的 R1–R7 施工；两处冲突时以 UX-RESET 为准。


> 阶段规格：`../VPM-P5.md`（只读 §7、§8）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P5-B、P5-C
> 覆盖对账项：A4–A7 / A12 / A20 / A21 / D5 / D10 / K1
> 建议上下文：≤ 35k tokens

## 目标

- 按工程版本匹配编辑器，detached 启动 Unity；默认参数/选择编辑器/自定义参数。
- 启动前通过核心联动端口绑定该工程为当前导入目标；启动失败/取消清除。
- 完成新建工程对话框、模板列表/收藏/最近、工程详情与启动下拉。
- 真 Unity 打开新工程并确认无包错误；P5-E 再做双击素材真机验收。

## 不做什么

- 不通过 shell 拼接命令。
- 不做备份/复制/迁移（P6）。
- 不安装 Unity/模块。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §5、§11
- `docs/prompts/VPM-P5.md` §7、§8
- `docs/VPM-IMPLEMENTATION-GUIDE.md` §6.2
- `unity/editors.ts`、`unity/create.ts`

## 文件所有权

- 新增：`src/main/vpm/unity/launch.ts`、IPC
- 新增：`src/renderer/vpm/components/projects/create*`、`templates/*`、`launch*`
- 修改：项目页容器
- 新增：`tests/vpm/unity/launch.spec.ts`、E2E 记录

## 交付物

- 启动：版本匹配、缺失编辑器报错、参数数组、detached、不拼 shell。
- UI：新建工程、模板列表/收藏/最近、工程详情、打开 Unity 下拉。
- 真 Unity 新建空白/角色/世界工程验证。
- 截图 + 错误状态。

## 施工步骤

1. 实现编辑器匹配与启动。
2. 做启动下拉与自定义参数。
3. 做新建工程/模板 UI。
4. 接项目详情与最近路径。
5. 真 Unity 验证并留证据。

## 契约与不变量

- 启动失败可见，不静默；失败时清除启动绑定。
- 参数不经过 shell；路径不作为字符串拼接命令。
- 缺失编辑器不自动换版本。
- 启动前先 `bindLaunchTarget(projectId)`；不要在 spawn 成功后才绑定。
- 工程页显示“当前导入目标”；不新增第二份目标状态。

## 测试与证据

- 版本匹配/缺失/自定义参数/失败。
- 启动前绑定/失败清理；已运行也绑定目标；多实例不抢目标（P5-E 真机）。
- UI wiring：创建、模板、启动、目标徽标。
- 真 Unity 打开新工程无包错误。
- 全量测试/typecheck。

## 完成定义

- P5 门禁：新工程真 Unity 可打开。
- UI 无重复主按钮，模板无第三方资产。
- 更新 `docs/VPM-TASKS.md`：该任务标为 done（或按实际状态标 blocked/review）。
- PR 含交接段；未验证项明确写出。

## 交接（写进 PR）

```text
Task: <ID>
状态: 完成 / 部分 / 阻塞
公开 API/契约变化: ...
新增/修改模块 README: ...
已验证: ...
未验证: ...
给下一个任务: ...
```

共同质量闸门、沙盒规则、停止规则见 `../_COMMON.md`。
