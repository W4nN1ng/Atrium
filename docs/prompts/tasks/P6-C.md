# P6-C 复制工程与更换 Unity 版本

> 阶段规格：`../VPM-P6.md`（只读 §7、§8）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P6-B、P5-D
> 覆盖对账项：A15 / A19 / D6 / E9
> 建议上下文：≤ 30k tokens

## 目标

- 复制工程：排除重型目录、目标非空拒绝、进度/取消、错误可解释。
- 更换 Unity 版本：关闭 Unity、备份/确认、写 ProjectVersion、可回滚；降级额外警告。
- 两个操作都不覆盖已有工程、不永久删文件。

## 不做什么

- 不做备份/迁移 UI（P6-D）。
- 不在 Unity 运行时改版本。
- 不复制 `Library` 全量（按计划排除）。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §5、§7
- `docs/prompts/VPM-P6.md` §7、§8
- `backup/collector.ts`、`backup/service.ts`
- `unity/editors.ts`

## 文件所有权

- 新增：`src/main/vpm/backup/copy.ts`、`unity/version.ts`
- 新增：`tests/vpm/backup/copy.spec.ts`、`tests/vpm/unity/version.spec.ts`

## 交付物

- 复制工程：目标校验、排除、进度/取消、失败清理。
- 换版本：Unity 关闭检查、备份、写版本文件、回滚。
- 降级/大版本警告。
- 错误码：占用/权限/目标非空/版本缺失。

## 施工步骤

1. 实现复制并复用收集器。
2. 实现版本文件读写与匹配。
3. 接备份/回滚。
4. 写占用/取消/非空测试。
5. 真 Unity 验证换版本后可打开。

## 契约与不变量

- 不覆盖已有目标。
- Unity 运行中禁止换版本。
- 换版本前必须有可恢复备份。

## 测试与证据

- 复制内容/排除/取消/非空。
- 换版本成功/回滚/Unity 运行拒绝。
- 全量测试/typecheck。

## 完成定义

- 复制/换版本均可独立使用。
- 真 Unity 验证记录在 PR。
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
