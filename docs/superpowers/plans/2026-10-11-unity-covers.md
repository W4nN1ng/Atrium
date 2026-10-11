# Unity 物品封面 Implementation Plan

> For agentic workers: use superpowers:executing-plans to implement inline. Do not create a PR until all feature tasks and verification are complete.

**Goal:** Unity 物品自动生成可保存、可恢复、可批量更新的 Atrium 素材封面。
**Architecture:** Unity preview scene 复制可见网格与材质，文件信箱返回图片；Atrium 校验和缓存，SQLite 记录卡片覆盖与来源。独立组件承载封面 UI。
**Tech Stack:** Unity Editor C# 2022.3 / Electron 33 / TypeScript / React / SQLite / Vitest。
**Spec:** ../specs/2026-10-11-unity-covers-design.md

## Global Constraints

- 在 codex/asset-preview-covers 开发；功能完成并验证后才创建 PR。
- 不修改 milfy 源工程；Unity 验证使用独立工程和资源副本。
- Unity 2022.3、Built-in；不运行道具脚本、Animator 或 MA/NDMF 构建。
- 640×480、4:3；源场景/选择/材质不变；预览确认前不替换正式封面。
- 本地文件信箱是唯一通道；保持旧命令协议兼容。
- 界面新增文案中/英/日；失败不得返回成功。

## Review Focus

- 取消或晚到的预览响应不覆盖其他卡片或已关闭的弹窗。
- 保存或重建缓存时不覆盖另一张内容哈希相同的卡片。
- 恢复或删除覆盖后，原始自动封面与素材文件保持完整。
- 文件相对路径、符号链接、体积和图像解码失败不能跨出缓存范围。
- 批量预览不因顶栏工程切换改变目标，不覆写手动上传的图片。

## Task 1: 封面记录、覆盖保护与缓存生命周期

Files: src/main/db/schema.ts; src/main/db/repos/covers.ts; src/main/library/thumbs.ts; tests/library/covers.spec.ts.
Consumes: Db、asset.cover_image；Produces: getCover/saveCover/restoreCover、受保护缓存引用。
- [x] 用真实 SQLite 编写并运行失败测试：同哈希卡片独立覆盖、恢复原图、自动补图保护、清理保留被引用图。
- [x] 实现增量迁移和封面存储、修正相关清理入口；运行针对测试。

## Task 2: Unity 渲染与真实样例验证

Files: resources/unity-bridge/com.avca.bridge/Editor/AVCAPreview.cs; AVCABridge.cs; package.json; tools/check-bridge-compile.cjs; tools/verify-unity-preview.cs.
Consumes: 请求 ID、目标、方向、背景；Produces: targets 和请求 PNG 元数据；心跳 capability。
- [x] 建立隔离 Unity 行为验证：对象选择、无网格错误、有效预览尺寸、源状态不变；先观察功能缺失失败。
- [x] 实现只复制网格/材质的渲染器，finally 清理 preview scene、RenderTexture、Texture2D、Mesh 和 Material。
- [x] 用 Unity 自带编译器检查所有桥接文件，在隔离工程真实 GPU 渲染巧克力及合成测试物体，查看图片。

## Task 3: 取图服务、预览暂存与批量队列

Files: src/shared/covers.ts; src/main/covers/service.ts; src/main/covers/ipc.ts; src/shared/api.ts; src/shared/ipc.ts; src/preload/index.ts; src/main/index.ts; tests/covers/service.spec.ts.
Consumes: Db、BridgeManager、源工程；Produces: status/targets/preview/save/upload/restore/batch/cancel API。
- [x] 编写并观察路径拒绝、旧桥接、失败保留原图、重复请求、批量顺序与取消测试失败。
- [x] 实现请求验证、能力检查、图像解码写缓存、确认保存、批量任务及进度，运行测试。

## Task 4: 封面交互与多语言

Files: src/renderer/components/CoverEditor.tsx; CoverBatch.tsx; DetailPanel.tsx; BundleDetail.tsx; AssetGrid.tsx; src/renderer/i18n/{zh-CN,en,ja}.json.
Consumes: covers API；Produces: 清晰的预览确认、上传、恢复、批量操作入口。
- [x] 检查已有组件行为和图像错误状态；用实际 Electron UI 验证缺失入口。
- [x] 实现物品选择/搜索、角度/背景、预览/保存/取消；阻止晚到响应改变另一个素材；支持关联批量和手动图保护。
- [x] 隔离数据目录实际操作验证：首次封面、重新生成、更换素材、取消、失败、上传、恢复、重启。

## Task 5: 完整验证、文档与整分支审查

Files: README.md; docs/BRIDGE.md; docs/UNITY-COVERS.md; verification report.
- [x] 完整 npm test、typecheck、Vite build、worker 依赖检查、C# 编译、Unity live GPU 验证。
- [x] 记录范围、真实结果与未验证行为；修复重要审查发现并跑覆盖测试。

Git 交付：以上功能与检查完成后，提交本分支、创建 PR，并按既有授权合并。
