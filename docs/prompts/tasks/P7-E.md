# P7-E 深链、单实例与互操作 UI

> 阶段规格：`../VPM-P7.md`（只读 §7、§8）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P7-C、P7-D
> 覆盖对账项：F7 / H4 / C3–C7
> 建议上下文：≤ 30k tokens

## 目标

- 注册/处理 `atrium://`；第二实例把 argv 交给第一实例。
- `vcc://` 只在用户显式接管后处理；添加仓库前确认，不接受 headers/token。
- 补齐仓库治理/本地包/VCC 导入/模板互操作 UI 与测试。

## 不做什么

- 不默认抢占 `vcc://`。
- 不注册 `.alcomtemplate` 全局关联。
- 不从深链接收凭据。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §5、§11
- `docs/prompts/VPM-P7.md` §7、§8
- `src/main/index.ts` 单实例、`interop/`

## 文件所有权

- 新增：`src/main/vpm/interop/deeplink.ts`、IPC/UI
- 修改：`src/main/index.ts` 只加协议/argv 转发（最小）
- 新增：`tests/vpm/interop/deeplink.spec.ts`

## 交付物

- `atrium://` 协议注册/解析/确认。
- `vcc://vpm/addRepo` 解析 + 显式确认；拒绝 headers/token。
- 单实例 argv 转发与窗口唤醒。
- 治理/本地包/VCC/模板 UI 收口。

## 施工步骤

1. 先写 URL 解析/拒绝测试。
2. 实现 atrium 深链与单实例。
3. 实现 vcc 显式接管与确认。
4. 接 UI 与错误。
5. 真机验证第二实例/深链。

## 契约与不变量

- 深链不能绕过用户确认直接加仓库/装包。
- 不注册/不抢占未同意的协议。
- 凭据不通过 URL 传递。

## 测试与证据

- 合法/非法/钓鱼 URL。
- 单实例转发/窗口唤醒。
- vcc 未接管/拒绝 headers。
- 真机 + 全量测试/typecheck。

## 完成定义

- P7 门禁全过：不写 VCC、深链需确认。
- 互操作 UI 可用。
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
