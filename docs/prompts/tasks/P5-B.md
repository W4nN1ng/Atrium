# P5-B 新建工程、校验与最近路径

> 阶段规格：`../VPM-P5.md`（只读 §5）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P5-A、P4-C
> 覆盖对账项：A4 / A5 / A6 / A21 / A22
> 建议上下文：≤ 30k tokens

## 目标

- 实现工程创建：名称/路径校验、最小骨架、ProjectVersion、模板依赖安装。
- 不覆盖非空目录、不手写 `.meta`、失败回滚。
- 最近路径存 vpm.db（不污染核心设置）。

## 不做什么

- 不做模板 UI/创建对话框（P5-D）。
- 不复制第三方模板资产。
- 不自动安装 Unity。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §5、§6.4
- `docs/prompts/VPM-P5.md` §5
- `docs/VPM-IMPLEMENTATION-GUIDE.md` §7.2
- `templates/`、`install/transaction.ts`

## 文件所有权

- 新增：`src/main/vpm/unity/create.ts`、`projects/recent.ts`
- 新增：vpm.db recent paths（如无表则加迁移）
- 新增：`tests/vpm/unity/create.spec.ts`

## 交付物

- 名称/路径校验（Windows 规则、已存在、权限、长路径）。
- 创建 `Assets/Packages/ProjectSettings` + `ProjectVersion.txt`；其余交给 Unity。
- 通过 P4 事务安装模板依赖；失败回滚工程目录（不删用户已有目录）。
- 最近 8 个路径持久化/读取。

## 施工步骤

1. 先写路径/名称拒绝矩阵。
2. 实现骨架创建与版本文件。
3. 接模板依赖安装事务。
4. 实现失败回滚与最近路径。
5. 用真 Unity 打开验证（P5-D 前先手动验证）。

## 契约与不变量

- 不覆盖非空目录；不手写 `.meta`。
- 创建失败不留下半套工程（可回滚）。
- 不修改核心设置。

## 测试与证据

- 非法名称/已存在/无权限/长路径。
- 空目录创建成功；非空拒绝。
- 依赖安装失败→清理新目录。
- 全量测试/typecheck。

## 完成定义

- 新建工程可被真 Unity 打开（至少空白）。
- 最近路径持久化，不污染核心设置。
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
