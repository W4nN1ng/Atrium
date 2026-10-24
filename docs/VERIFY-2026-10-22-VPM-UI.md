# VERIFY · 2026-10-22 · VPM UI 与真机能力抽查

> 对应：P7-A / P7-B 的 UI 与 safeStorage、HTTP 客户端的真实环境验证。
> 截图：`docs/verify/vpm-ui-2026-10-22.png`（1400×980 离屏渲染，深色主题，zh-CN）

---

## 1. 界面（已看，发现并修掉 3 个问题）

用 `tools/preview/` 的离屏预览页渲染真实组件（mock 数据、真实 i18n、真实 Tailwind 产物），
截图后逐项看。

| 发现 | 处理 |
|---|---|
| 备份失败行显示成 `备份失败（{reason}），临时文件已清理。` —— 把**翻译后的整句**塞进了表格 | 改成显示原始错误码 `vpmBackupFailed`（表格里要的是码，不是句子） |
| 仓库卡片上的 ↑/↓ 是细线箭头，13px 下几乎看不见 | 换成实心 ▲/▼ + `aria-label` |
| 同一屏有两个实心主按钮（"添加仓库" + "浏览包"） | "浏览包"降为文字按钮，一屏只留一个实心 |

最终界面（截图）确认：

- 仓库卡片：名称 + 包数徽标、host、上次成功/上次错误；右侧 启用开关 / ▲▼ / 编辑 / 请求头 /
  测试连接 / 刷新 / 移除，一行放得下（980px 宽）。
- 包目录卡片：说明 + 次要"浏览包"。
- 备份与维护：可用备份计数、立即备份 / 复制工程 / 更换 Unity 版本 / 迁移旧资源（2），
  下面是备份记录（状态徽标 + 时间 + 大小 + 打开位置），失败行给原始错误码。

---

## 2. 真实 Electron `safeStorage`（已通过）

用真实 Electron 33.4.11 跑 `createSafeStorageSecretStore`（esbuild 打包后加载）：

```json
{
  "available": true,
  "wroteFile": true,
  "containsPlaintext": false,
  "names": [{ "scope": "repo:verify", "names": ["authorization", "x-api-key"] }],
  "roundtrip": { "authorization": "Bearer REAL-TOKEN-123", "x-api-key": "k-456" },
  "afterClear": null
}
```

结论：这台机器上 DPAPI 可用；落盘文件里**没有明文**（`containsPlaintext: false`）；
读回一致；清除后为 `null`。

---

## 3. 真实联网（部分通过）

用真实 `createVpmHttpClient` + 经系统代理的 CONNECT 隧道跑：

| 步骤 | 结果 |
|---|---|
| `https://registry.npmjs.org/yazl` | **200**，JSON 解析成功，ETag `"d117e45` |
| 同上 + 自定义头 `x-atrium-verify` | **200**（自定义头被接受并发送） |
| `https://registry.npmjs.org/-/definitely-not-here-xyz` | `vpmHttpStatus`（非 200 正确映射为错误） |
| `https://packages.vrchat.com/official?download` | `vpmHttpNetwork` |

**`packages.vrchat.com` 的失败不是代码问题**：同一代理下 `curl` 也是
`schannel: failed to receive handshake`，这个工作环境对 VRChat 域名做了网络策略拦截。

→ 需要你在自己机器上点一次"刷新全部"，才算真正验证了官方仓库。

---

## 4. 还需要你做的（清 review）

| 卡 | 你需要做什么 | 预计 |
|---|---|---|
| P5-D | 新建空白工程 → 点"打开 Unity" → 看工程能否打开、Console 无包错误 | 10 分钟 |
| P5-E | 双击素材导入到刚打开的工程；再开第二个工程验证目标优先级 | 10 分钟 |
| P6-D | 对某个工程点"立即备份"→"打开位置"看 zip；换一次 Unity 版本再打开 | 10 分钟 |
| P7-A / P7-B | 设置 → 项目与包 → 仓库：改个名字、拖一次排序、点"测试连接"、填一个请求头再点测试 | 5 分钟 |

做完把结果告诉我（或直接说"都通过了"），我把这几张卡的 `review` 改成 `done`，
并把这份记录补成完整证据。
