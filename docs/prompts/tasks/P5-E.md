# P5-E 启动即绑定目标与双击素材真机验收

> 阶段规格：`../VPM-P5.md`（只读 §7、§8、§10）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P5-D、P4-F、P2-E
> 覆盖对账项：K1 / K2 / K3 / K6
> 建议上下文：≤ 30k tokens

## 目标

- 把“打开 Unity 工程”接成完整链路：**绑定当前导入目标 → spawn Unity → 启动中/连接中保持目标 →
  双击素材导入这个工程**。
- 启动失败、用户取消、工程关闭/移除时清除绑定，不把素材投到另一个运行工程。
- 用真 Unity 2022.3.22f1 在沙盒里验收，留截图和导入日志。

## 不做什么

- 不改 P5-D 的编辑器发现/版本匹配规则。
- 不改素材导入冲突/备份/撤销算法。
- 不做包安装；本卡只验证素材导入链路。
- 不做跨重启目标持久化。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §5、§6.4.1、§7.3
- `docs/prompts/VPM-P5.md` §7、§8、§10
- `src/main/project/connections.ts`、`src/main/bridge/ipc.ts`、`src/renderer/stores/ui.ts`
- `src/main/vpm/unity/launch.ts`（P5-D）、`src/main/vpm/linkage.ts` 或 gate 注入端口

## 文件所有权

- 修改：`src/main/vpm/unity/launch.ts`、`src/main/vpm/index.ts`、`src/main/vpm/gate.ts`
- 修改：`src/renderer/vpm/components/projects/*`（启动按钮/目标徽标）、项目页容器
- 修改：`src/renderer/stores/ui.ts`（仅目标等待/错误展示，不改导入规则）
- 新增：`tests/vpm/unity/launch-target.spec.ts`、`tests/renderer/vpm-launch-target.spec.ts`
- 新增：`docs/VERIFY-2026-10-22-VPM-MATERIAL-LINK.md`（真机记录/截图索引）

## 交付物

- 启动前调用 `bindLaunchTarget`；spawn 失败/取消/工程关闭/移除调用 `clearLaunchTarget`。
- 工程页显示“当前导入目标/启动中”；启动成功后徽标不跳变。
- 双击素材：目标启动中则等待（180s/可取消），就绪后走现有冲突确认/备份/导入；
  不会弹另一个目标选择器、不会改投其他工程。
- 多实例真机：A 已开、Atrium 启动 B → 双击素材进 B；显式选 A → 进 A；关闭 B → 清除。
- 真机证据：B 的 `Assets/` 出现导入资源、`import_log` 记录 B、A 无新增文件。

## 施工步骤

1. 接 launch 的绑定/清理；先在 fake 工程/spec 里测启动失败、取消、已运行。
2. 工程页徽标与启动中状态；不新增顶级导航。
3. 沙盒真 Unity：新建/打开 B，确认目标；双击素材；截图/记录。
4. 多实例：A+B 同开，验证优先级与显式覆盖；关闭 B 后不再指向 B。
5. 回归现有双击导入/冲突/撤销；跑全量测试/typecheck。

## 契约与不变量

- 启动绑定发生在 spawn 之前；失败/取消必须清理。
- 目标优先级固定：显式选择 > 启动绑定 > 单工程自动；不猜“上次那个”。
- 导入计划固定 projectId；中途切换目标/再开工程不影响已开始的任务。
- 启动本身不写工程/不装包；双击导入才写 `Assets/`。
- 导入进行中不做包事务/备份/迁移/换版本（P4-F 闸门）。
- 工程关闭/移除后不能留下可点击的陈旧目标。

## 测试与证据

- 单元：launch 失败清理、取消清理、已运行不重复启动、多实例优先级、关闭清理。
- 渲染 wiring：启动按钮 → 目标徽标；启动中双击等待；显式选择覆盖。
- 真 Unity 2022.3.22f1：新建/打开 B → 双击素材 → B 的 Assets 落地；A 不变。
- 真机多实例 + 截图 + main.log/import_log 片段。
- 全量测试/typecheck。

## 完成定义

- “Atrium 打开 Unity 工程 → 自动成为导入目标 → 双击素材导入”在真 Unity 上成立。
- 不出现导入到错误工程/陈旧目标；失败路径有提示。
- 更新 `docs/VPM-TASKS.md`：该任务标为 done（或按实际状态标 blocked/review）。
- PR 含交接段；未验证项明确写出。

## 交接（写进 PR）

```text
Task: P5-E
状态: 完成 / 部分 / 阻塞
公开 API/契约变化: launch 绑定/清理；目标徽标状态
新增/修改模块 README: unity/README、项目页 README、VERIFY 记录
已验证: 真 Unity 双击导入/多实例/失败清理
未验证: 其他 Unity 版本；跨重启目标（刻意不做）
给下一个任务: P6-D 备份/迁移接 P4-F 闸门；P8-D 对账 K 组必须有证据
```

共同质量闸门、沙盒规则、停止规则见 `../_COMMON.md`。
