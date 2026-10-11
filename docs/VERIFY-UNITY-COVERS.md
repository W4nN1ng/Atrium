# Unity 物品封面验证（2026-10-11）

验证基线：`d7c8243`，功能分支 `codex/asset-preview-covers`。使用隔离 Atrium 数据目录及独立 Unity 测试工程；未修改 Milfy 源工程，未提交第三方模型或贴图。

## 自动检查

| 检查 | 结果 |
| --- | --- |
| `npm test -- --maxWorkers=2 --minWorkers=1` | 124 个测试文件通过、10 个文件跳过；1653 项通过、31 项条件跳过；127 秒，无失败 |
| `npm run typecheck` | Node 与 renderer 类型检查通过 |
| `npm run native:electron` + `npx electron-vite build` | 主进程、preload、renderer 构建通过 |
| `node tools/check-worker-deps.cjs` | 两个 worker 产物自包含，无外部依赖 |
| `node tools/check-bridge-compile.cjs <Unity 2022.3.22f1 根目录>` | Unity 自带 Roslyn、10 个引用程序集，所有桥接 Editor C# 编译通过 |
| 独立代码复核 | 重要发现全部修复，复核批准 |

跳过项需要特定真实数据、外部工具路径或人工验证条件，未计入通过数。默认编译测试未找到其预设 Unity 路径而跳过；另用本机实际 Unity 路径执行上方独立编译检查。构建中的 wanakana 默认导出提示为既有提示，产物检查通过。

在本机，临时目录的 `UserX` 别名与真实路径不同。数据库备份测试夹具改用 `realpathSync`，生产备份逻辑未因此改动。完整测试限制为两个 worker，避免与 Unity 同时运行时的内存压力；桥接退避的实际时序断言保留。

## Unity 实际渲染

`tools/verify-unity-preview.cs` 在 Unity 2022.3.22f1 / Built-in 中运行。测试对象包括红色立方体、带骨骼及材质属性块的 SkinnedMesh、无网格对象，以及合法资源副本中的巧克力预制体与 lilToon 2.3.4。

- 输出 PNG 为 640×480；像素检查确认深浅背景、红色模型与绿色属性块模型确实渲染。
- 巧克力正面、背面、侧面、上方、下方及自动方向均有实际输出；查看图片确认下方能拍到该平放预制体的盒面和蝴蝶结。
- 连续渲染后，源材质序列化内容、源选择、场景 dirty 状态、场景数量及临时 Mesh 数量与基线一致。
- 无网格对象返回失败，未生成成功结果。测试不运行脚本、Animator 或 MA/NDMF，也不证明 VRChat 游戏内效果。

## 实际应用操作

`tools/verify-cover-ui.cjs` 使用构建后的 Atrium 主进程和 preload，以及真实 Unity 文件信箱。覆盖构建后的 renderer 和 Vite 开发 renderer（React StrictMode）。只替换操作系统图片选择器的返回文件；渲染、IPC、SQLite、Electron 图片解码和封面状态转换均走实际代码。

验证：从 Unity 读取选择、搜索巧克力预制体及 FBX（多个候选时没有默认目标，明确选择前不能生成）、生成预览、确认前卡片不变化、确认保存、恢复原封面、取消预览、本地图片按钮、两张卡片批量更新（一张成功、一张手动图片跳过）、卡片和已打开详情的图片地址刷新及图片加载、重启后图片和关联仍存在。新缓存的实际解码尺寸为最长边 320 像素。构建后的界面用 offscreen 测试窗口取图，避免隐藏窗口合成器返回旧帧。

旧桥接、越界路径、目录链接、重复请求、预览过期、活动/排队取消、晚到结果、运行期间手动修改和原图保存失败分别有后端回归用例。原图保存失败时不提交新封面，原图记录保持不变。多候选选择、错误展开、批量素材名称和 StrictMode 生命周期经过代码复核。

## 范围边界

此次验证覆盖已导入资源的静态 Built-in 封面功能。未验证或实现未导入 ZIP 的自动依赖安装、URP/HDRP、交互动画、自动穿衣、任意自定义 shader、VRChat 上传与游戏内效果。v0.4.1 的既有发布资产未更新；新功能由 main 源码提供。
