# P2-B 工程读取纯逻辑与 legacy 报告

> 阶段规格：`../VPM-P2.md`（只读 §5、§5.1–§5.5）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P1-A
> 覆盖对账项：A1 / A3 / B17 / A22
> 建议上下文：≤ 25k tokens

## 目标

- 纯函数读取工程身份、`ProjectVersion.txt`、`vpm-manifest.json`、`Packages/` 目录。
- 报告旧式 VPM/Assets 包，不迁移、不写盘。
- 输出稳定快照（版本、包、指纹、legacy 项），供台账/解析/事务使用。

## 不做什么

- 不改工程、不装包、不扫大文件内容。
- 不把读取逻辑放进 UI 或 IPC。
- 不复制 ALCOM 的检测表。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §5、§6.3
- `docs/prompts/VPM-P2.md` §5、§5.1–§5.5
- `src/shared/vpm/domain/project.ts`（本卡新建；含 manifest 解析）
- `docs/VPM-IMPLEMENTATION-GUIDE.md` §5.2

## 文件所有权

- 新增：`src/shared/vpm/domain/project.ts`、`src/shared/vpm/domain/hash.ts`
- 新增：`tests/vpm/domain/project.spec.ts` + fixtures（内存 reader 夹具）
- 新增：`tests/fixtures/vpm/projects/`

## 交付物

- 工程身份/版本/manifest/Packages 快照的类型与解析。
- legacy 报告：路径/包名/来源/置信度，只读。
- 工程指纹（manifest + 关键文件）用于事务前检测外部修改。
- 错误码：非工程、版本文件坏、manifest 坏、包目录不可读。

## 施工步骤

1. 先造 fixture 工程（空/正常/坏 manifest/BOM/legacy）。
2. 实现读取与归一，保持未知字段。
3. 实现指纹与 legacy 报告。
4. 写边界测试：缺失、权限、符号链接、大小写。
5. 在 README 写清楚“只读”。

## 契约与不变量

- 不写任何工程文件。
- manifest 未知字段原样保留。
- 路径比较按 Windows 规则，大小写不敏感。

## 测试与证据

- 正常/空/缺文件/坏 JSON/BOM/CRLF。
- Packages 目录、legacy Assets、符号链接、重复包。
- 指纹对 manifest 改动敏感。
- 全量测试/typecheck。

## 完成定义

- 纯逻辑可在无 Electron/临时目录依赖的情况下跑（fixture 读取除外）。
- legacy 报告有明确“只读，不迁移”提示。
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
