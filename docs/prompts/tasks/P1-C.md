# P1-C HTTP、缓存与联网开关

> 阶段规格：`../VPM-P1.md`（只读 §6、§7）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P1-A
> 覆盖对账项：C8 / C9 / C10 / G2 / I6
> 建议上下文：≤ 25k tokens
>
> **2026-10-21 用户裁定**：VPM 默认联网；原先的联网门保留为**可关闭的联网开关**，
> 默认 `networkEnabled=true`，不再弹首次同意模态。关闭开关后仍 fail closed。

## 目标

- 建立 VPM 唯一网络入口：只允许 HTTPS、限制重定向/大小/时间、流式下载、SHA-256。
- 支持条件请求（ETag/Last-Modified/304），失败保留旧缓存。
- 把联网开关做成硬门：默认开启；关闭后任何 HTTP 调用直接失败，不建立连接。
- 缓存落非 C 数据根，原子落盘，可校验/可重下。

## 不做什么

- 不实现仓库服务/目录 UI。
- 不做自定义请求头/密钥（P7-B）、不做本地包。
- 不为测试在生产允许明文 HTTP。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §5、§6.1、§9
- `docs/prompts/VPM-P1.md` §6、§7
- `src/main/vpm/config.ts`（networkConsentAt）
- `src/main/services/paths.ts`

## 文件所有权

- 新增：`src/main/vpm/http/`（policy、Electron 适配器、fake 端口）
- 新增：`src/main/vpm/cache/`（路径、原子写、hash、清理边界）
- 修改：`config.ts` 只加联网开关的读写函数
- 新增：`tests/vpm/http/*.spec.ts`、`tests/vpm/cache/*.spec.ts`

## 交付物

- `VpmHttpPort` 与生产适配器；测试用本地 fake server。
- HTTPS-only、重定向逐跳校验、无 cookie、大小/时间上限、User-Agent。
- `downloadToFile` 流式写临时文件→hash→rename；失败清理临时文件。
- 缓存目录只能在已校验的数据根下；联网关闭时返回 `vpmNetworkNotConsented`。

## 施工步骤

1. 先写纯 policy（URL/重定向/限额/头）和测试。
2. 实现 Electron `net.request` 适配器；测试注入 fake。
3. 实现缓存原子落盘与 hash 校验。
4. 接入联网开关，写“关闭时绝不 fetch”的测试。
5. 在 README 写清楚唯一入口与失败码。

## 契约与不变量

- 联网关闭时不得建立 TCP/TLS 连接。
- 不发送/持久化 cookie；不忽略证书错误。
- 缓存不落 C；不把包整个读进内存。

## 测试与证据

- 本地 fake：200/304/302 降级/超时/超大/断连。
- hash 不匹配、缓存损坏、下载中断。
- 联网关闭时 fake 端口零请求。
- 全量测试/typecheck。

## 完成定义

- 所有网络调用都经过 `http/`；其他模块没有 fetch/net。
- 缓存路径拒绝非数据根。
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
