# P7-B 请求头、密钥存储与测试连接

> 阶段规格：`../VPM-P7.md`（只读 §4.3、§4.3b）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P7-A、P4-B
> 覆盖对账项：C7 / C15
> 建议上下文：≤ 25k tokens

## 目标

- 用 Electron safeStorage 存每仓库/包级请求头；不可用则拒存，不落明文。
- 请求头只进 HTTP 适配器，不返回渲染层/不进日志；跨源重定向停止。
- 提供“测试连接”与脱敏错误。

## 不做什么

- 不把 token 写进 URL/仓库 JSON/普通设置。
- 不实现跨设备同步。
- 不做包级头 UI 以外的仓库治理。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §5、§6.1、§8
- `docs/prompts/VPM-P7.md` §4.3、§4.3b
- `src/main/vpm/http/`、`reposService.ts`

## 文件所有权

- 新增：`src/main/vpm/secrets/`（safeStorage 适配器/接口）
- 修改：`http/`、`reposService.ts`、IPC/UI
- 新增：`tests/vpm/secrets/*.spec.ts`

## 交付物

- SecretStore 接口 + safeStorage 实现 + 测试 fake。
- 每仓库/包级头设置/清除；列表只显示“已设置”。
- 测试连接；错误脱敏；日志无头。
- safeStorage 不可用→明确错误码，不降级明文。

## 施工步骤

1. 先写 SecretStore 接口与 fake。
2. 实现 safeStorage 适配器。
3. 接 HTTP 合并头与重定向保护。
4. 做设置/清除/测试连接 UI。
5. 写脱敏/不可用测试。

## 契约与不变量

- 任何日志/错误/IPC 不含明文头。
- safeStorage 不可用时不存。
- 跨源重定向带自定义头必须停止。

## 测试与证据

- 存取/清除/不可用/脱敏。
- 跨源重定向拒绝。
- 全量测试/typecheck。

## 完成定义

- 请求头不出主进程。
- 错误/日志有脱敏测试。
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
