# src/main/vpm/http

## 职责

VPM 的唯一网络入口：JSON 条件请求、流式下载、HTTPS/重定向/大小/超时策略、联网开关门。
所有网络调用都必须经过 `VpmHttpPort`；其他模块不得直接 `fetch`/`net.request`。

## 不负责什么

- 不解析仓库 JSON（P1-D）、不决定包版本/来源。
- 不实现缓存落盘/重命名（`cache/` 负责）。
- 默认联网；P1-E 提供可关闭的联网开关，这里只拒绝关闭时的请求。
- 不做自定义请求头的加密存储（P7-B）；只做安全校验。

## 公开 API

从 `index.ts` 导出：

- `VpmHttpPort`：`getJson(url, opts)` / `downloadToFile(url, destPath, opts)`。
- `createVpmHttpClient({ transport, isNetworkAllowed, userAgent, limits? })`：
  - `isNetworkAllowed` 默认 `false`（fail closed）；返回 false 时抛 `vpmNetworkNotConsented`，
    **不调用 transport、不建立连接**。
- `createElectronHttpTransport()`：生产 transport，走 Electron `net.request` + 系统代理。
- `assertHttpsUrl`、`sameOrigin`、`buildRequestHeaders`、`headerValue`：纯策略函数。
- `DEFAULT_VPM_HTTP_LIMITS`。

测试注入 fake `VpmHttpTransport`，不依赖公网；生产只有 Electron transport 会真正发请求。

## 策略/不变量

- 只允许 `https:` 绝对 URL；拒绝 userinfo、`file:`/`data:`/`javascript:`、控制字符、超长 URL。
- 重定向最多 5 跳；每跳重新校验 HTTPS；降级/非法 → `vpmHttpRedirect`。
  有自定义头时跨源重定向停止（防 token 泄漏）；无自定义头的公开请求可跟随。
- JSON ≤ 16 MiB；下载 ≤ 4 GiB；超限 `vpmHttpTooLarge`。
- 连接 15s / 空闲 60s / 总 30 分钟；外部 `AbortSignal` → `vpmHttpAborted`。
- UA `Atrium/<version>`；JSON `Accept: application/json`；不发送/持久化 Cookie。
- 证书校验始终开启；不提供忽略证书错误的选项。
- `getJson` 支持 `If-None-Match`/`If-Modified-Since`，304 返回空 body 和 ETag。
- `downloadToFile` 以 `wx` 打开目标文件、流式写、边写边算 SHA-256；失败删除目标临时文件。
  调用方（cache）负责把临时文件 rename 到最终位置。

## 失败码

`vpmNetworkNotConsented`、`vpmHttpBlocked`、`vpmHttpTimeout`、`vpmHttpTooLarge`、
`vpmHttpStatus`、`vpmHttpRedirect`、`vpmHttpNetwork`、`vpmHttpInvalidJson`、`vpmHttpAborted`。

## 测试入口

- `tests/vpm/http/client.spec.ts`（fake transport：重定向/304/大小/超时/取消/联网开关）
- `tests/vpm/http/electron.spec.ts`（mock net：无 Cookie、manual redirect、followRedirect）
- 运行：`npm test`

## 谁依赖我 / 我依赖谁

- 被 P1-D 的 `reposService` 和 P4 的下载使用；不被渲染层直接引用。
- 依赖：Electron `net`（仅 `electron.ts`）、Node `crypto/fs/path/stream`、`VpmError`。
- 不依赖 `repos/`、`cache/`、`renderer/**`。
