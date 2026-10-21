# src/main/vpm/ipc

## 职责

P1 的只读仓库/目录 IPC：参数校验、DTO 映射、刷新操作/事件、联网开关读写。
它把 `VpmRuntime` 的服务暴露给 preload/renderer，但**不把数据库行、ETag、请求头或绝对缓存路径**带出去。

## 注册方式

- `registerVpmGateIpc()` 在应用启动时注册一次（P0 四个通道 + 本模块十个通道）。
- `registerVpmIpc({ ipc, broadcast, getRuntime })` 用 `getRuntime()` 取当前 runtime；
  runtime 未加载/已停用时返回 `vpmRuntimeNotReady`，不会静态导入重模块。
- `disableVpm` 只释放 runtime，不注销 IPC；重新启用后同一组 handler 自动指向新 runtime。
- `disposeVpm`（退出）会 dispose 操作计时器。

## 通道

- `vpm:repos-list`
- `vpm:repo-add` `{url, name?}`
- `vpm:repo-remove` `id`
- `vpm:repo-refresh` `id` → `{operationId, repoIds}`
- `vpm:repo-refresh-all` → `{operationId, repoIds}`
- `vpm:network-status`
- `vpm:network-consent` `{allow}`
- `vpm:catalog-query` `VpmCatalogQuery`
- `vpm:package-detail` `name` → detail | null
- `vpm:package-versions` `name` → versions[]

事件：

- `vpm:repo-progress`：`{operationId, phase:'start'|'repo', repoId?, repoIds?, result?}`；
  按 ≥100ms 节流，`start/done` 立即发。
- `vpm:repo-done`：`{operationId, results[]}`；UI 收到后重新拉 `repos-list`。

刷新操作返回 `operationId` 后异步执行；单仓库并发去重，`refresh-all` 同时只跑一个。
事件可能早于 invoke 返回，UI 以 `operationId` 去重；拉取式 `repos-list` 是最终事实。

## 校验/边界

- `repo-add` 只接受对象/string URL/可选 string name；HTTPS/去重由 `ReposService` 再做一次。
- `repo-refresh` 先确认仓库存在；不存在 → `vpmRepoNotFound`。
- `catalog-query` 必须是对象；具体字段由 `CatalogService/RepoStore` 校验。
- `network-consent` 只接受 boolean `allow`，表示切换联网开关（默认 true）；开启时补同意时间并 `seedIfEmpty`（无自动刷新）。
- 所有响应由 IPC 注册器包成 `{ok,data|error}`；renderer 的 `vpmApi` 只返回 data/抛 Error。

## 测试入口

- `tests/vpm/ipc/vpm-ipc.spec.ts`
- `tests/renderer/ipc-channels.spec.ts`（通道/事件死名单）
- `tests/renderer/vpm-api.spec.ts`（wrapper/事件订阅）

## 谁依赖我 / 我依赖谁

- 被 gate 注册、被 preload/renderer 调用。
- 依赖 `VpmRuntime`（类型）、`ReposService`/`CatalogService` 的公开 DTO、`config`、`ulid`、`VpmError`。
- 不直接读 DB/发网络；不 import `renderer/**`。
