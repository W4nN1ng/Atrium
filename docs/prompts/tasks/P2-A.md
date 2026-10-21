# P2-A Unity 编辑器发现与手动添加

> 阶段规格：`../VPM-P2.md`（只读 §4、§4.3）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P1-B
> 覆盖对账项：D1 / D2 / D3 / D4 / F4
> 建议上下文：≤ 25k tokens

## 目标

- 发现 Unity Hub 安装与自定义安装根，读出编辑器版本/路径/架构。
- 支持手动添加编辑器路径，校验可执行文件并识别版本；重复/缺失有明确状态。
- 把编辑器清单持久化到 vpm.db v2，并为工程覆盖编辑器留出字段。

## 不做什么

- 不启动 Unity、不安装 Unity、不调用 Hub 无头进程。
- 不碰工程文件。
- 不写死只支持 2022.3。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §5、§6、§9
- `docs/prompts/VPM-P2.md` §4、§4.3
- `src/main/vpm/db/`（迁移器）
- `docs/VPM-IMPLEMENTATION-GUIDE.md` §6.2

## 文件所有权

- 新增：`src/main/vpm/unity/editors.ts`、`unity/README.md`
- 新增：vpm.db v2 迁移（编辑器表）
- 新增：`tests/vpm/unity/editors.spec.ts` + fixtures

## 交付物

- Hub 默认根/`secondaryInstallPath.json`/`editors-v2.json` 的只读发现。
- 手动添加、去重、缺失标记、版本与架构识别。
- vpm.db v2 编辑器仓储；不删除旧数据。
- 失败码：找不到、无权限、不是 Unity、版本不明。

## 施工步骤

1. 先做 Hub 配置读取的 fixture 测试。
2. 实现扫描与版本/架构归一。
3. 加手动添加与去重。
4. 迁移 v2 并接仓储。
5. 写 README：发现来源、优先级、未知架构策略。

## 契约与不变量

- 只读 Hub 配置；不改 Hub/Unity 安装。
- 未知架构按 x86_64 处理但标记为推断。
- 不启动 Unity 来问版本。

## 测试与证据

- 标准 Hub、多个根、缺失路径、重复版本、手动添加、未知架构。
- v2 迁移幂等；旧 v1 数据保留。
- 全量测试/typecheck。

## 完成定义

- 编辑器清单可在不启动 Unity 的情况下建立。
- 缺失/重复/未知都有可解释状态。
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
