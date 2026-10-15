# 未导入素材包封面验收

基线为 `745eee6`，功能分支为 `codex/package-cover-preview`。验收使用 Windows、Unity 2022.3.22f1 Built-in、lilToon 2.3.4 和 Electron 33.4.11。所有验收数据、合法第三方样例和生成图片均位于忽略的 `tmp` 目录，不随仓库提交。

## 功能与数据

从巧克力、百奇原 ZIP 读取 unitypackage，保留资源路径、GUID、材质、贴图及导入 metadata，放入新建的独立 Unity 工程。目标模型没有预先导入该工程；依赖工程只提供 lilToon 渲染资源。供应方代码、SDK 和构建插件不进入预览工程。

实际渲染得到巧克力盒与百奇棒，640×480 PNG 经 Electron 原生解码保存为最长边 320 像素图片。候选通过 GUID 对应原包物品；仅在界面明确选择并保存后写入封面。

数据库升级到 schema 8，保留旧封面、原图和关联。素材包记录使用 `source=package`、稳定的 `package:<guid>` 和可选依赖工程 ID；临时 Unity 对象 ID、工程目录和进程不作为持久关联。

## 回归覆盖

- 原始资源与 metadata 字节、合集成员归属、脚本排除、路径/链接拒绝、GUID 和内容冲突、文件数量/大小/深度限制。
- 重复 shader GUID 在启动前拒绝；依赖 metadata 有界读取、类型校验和变化检测。
- 进程启动、失败、取消、闲置关闭、持有子进程关闭及内部工程发现过滤。
- 缓存退出清理和跨会话清理，心跳及首次心跳前的进程租约保护。
- 64 个小资源的顺序读取、取消监听上限、完整输出和取消清理。截断 gzip 后及时报读取失败，关闭未结束的条目流，保留原错误。
- 来源变化、图片验证、明确保存、手动图片竞争保护、恢复原始封面、批量更新和旧记录迁移。

## 实际界面

`tools/verify-package-cover-integration.cjs` 运行构建后的主进程、preload、React、SQLite、原生图片解码与真实独立 Unity。验证两份原 ZIP 的候选图片、调整方向、明确保存、卡片刷新、恢复后重新设置、取消保护、本地图片、批量更新一项并保留一项手动图片，以及应用重启后的来源、依赖、GUID、角度和图片保留。

验收数据库没有导入记录和预存资源清单，工程列表仅有测试依赖工程，导入目标为空；原 ZIP、依赖 shader 资源及参考 metadata 的 SHA256 前后一致。每个阶段退出后确认自有 Unity 进程为零。

`tools/verify-package-cover-ui.cjs` 使用受控外部响应验证缺少编辑器、文件选择、进度、分页、模式/依赖/角度切换、晚到结果、保存锁定和手动图片保护。该检查不代替真实 GPU 验收。

原有 `tools/verify-cover-ui.cjs` 的实际工程流程亦通过：选择与搜索物品、多结果不默认选择、角度、生成及保存、恢复、取消、本地图片、批量保护、卡片及详情刷新、重启。候选及保存竞争的受控回归通过。

## 交付检查

最终检查于 2026-10-15 执行：

| 检查 | 结果 |
| --- | --- |
| `npm test -- --maxWorkers=2 --minWorkers=1` | 130 个测试文件通过、10 个条件跳过；1788 项通过、31 项条件跳过，无失败，157 秒 |
| `npm run typecheck` | Node 和 renderer 通过 |
| `npm run native:electron`、`npx electron-vite build` | Electron 33.4.11 / ABI 130，主进程、preload、renderer 构建通过 |
| `node tools/check-worker-deps.cjs` | 两个 worker 产物自包含 |
| `node tools/check-bridge-compile.cjs <Unity 安装目录>` | 实际 Unity Roslyn、10 个引用程序集，桥接 C# 编译通过 |

条件跳过项未计入通过数；桥接编译另以本机实际安装路径执行。初次高并发全套运行触发既有搜索性能阈值，降低到两个测试 worker 后完整重跑通过，未放宽断言。独立复核发现的缓存、GUID 冲突、首次心跳前清理和损坏包读取问题均以回归用例修复并复核。损坏包复现经复核在 34 ms 报错、清空临时资源且移除调用方监听。

最终构建的原包 Electron 验收于同日再次通过 first / restart 两阶段：两份原 ZIP 的实际渲染、候选选择与保存、恢复、取消、手动图片保护、批量和重启全部通过，退出后自有 Unity 进程均为零。原文件校验保持一致，完整运行不再出现 `MaxListenersExceededWarning`。最终受控 React / IPC 包预览回归亦通过。

尚不覆盖 URP/HDRP、任意 shader 的依赖安装、交互动画、自动穿衣、SDK 构建、VRChat 上传或游戏内效果。此功能属于 main 后续代码，既有 v0.4.1 发布安装包不因此变化。
