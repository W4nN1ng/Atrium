# P6-A 文件收集器、排除规则与取消

> 阶段规格：`../VPM-P6.md`（只读 §5）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P2-B
> 覆盖对账项：E1 / E3 / E4
> 建议上下文：≤ 25k tokens

## 目标

- 实现可复用的文件树收集器：排除规则、符号链接、进度、取消。
- 排除 Logs/obj/Temp/.git；Library 整体排除但保留 LastSceneManagerSetup.txt。
- 输出稳定有序的文件清单，供备份/复制使用。

## 不做什么

- 不压缩、不复制、不写工程。
- 不永久删任何文件。
- 不做 UI（P6-D）。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §5、§10.3
- `docs/prompts/VPM-P6.md` §5
- `docs/VPM-IMPLEMENTATION-GUIDE.md` §6.3
- `docs/prompts/VPM-P6.md` §6.2

## 文件所有权

- 新增：`src/main/vpm/backup/collector.ts`
- 新增：`tests/vpm/backup/collector.spec.ts` + fixtures

## 交付物

- 收集器 API：root、排除项、include 例外、progress、AbortSignal。
- 排除表与“保留最后场景配置”的例外。
- 符号链接/junction 跳过/标记；错误可解释。
- 稳定排序与相对路径。

## 施工步骤

1. 先写排除/例外 fixture。
2. 实现遍历与取消/进度。
3. 处理符号链接/权限/长路径。
4. 写稳定排序与重复项测试。
5. 写 README：排除规则与可配置项。

## 契约与不变量

- 不跟随符号链接到工程外。
- 取消后不再继续遍历。
- 不修改源文件。

## 测试与证据

- 排除/例外/符号链接/权限/取消。
- 清单稳定排序。
- 全量测试/typecheck。

## 完成定义

- 收集器可被备份/复制复用。
- 排除规则有测试和文档。
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
