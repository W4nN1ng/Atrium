# Unity 物品封面设计

用户目标：素材卡片能展示 Unity 中真实物品的样子。已批准开始开发；整个功能完成并验证后才能创建 PR。开发在 `codex/asset-preview-covers`，不直接修改 main。

## 支持范围

- Unity 2022.3、Built-in 渲染管线；已经导入且能正常显示的 MeshRenderer / SkinnedMeshRenderer。静态封面冻结当前骨骼和 BlendShape 姿态，不运行道具脚本、Animator 或 MA/NDMF 构建。
- 从 Unity 当前选择读取候选；也能搜索已导入的 Prefab / FBX。用户明确选择来源，记住卡片与工程、对象的关联。多个变体不自动猜选。
- 物品网格、材质副本进入独立 preview scene，自动居中、适配 4:3、可选方向和浅/深背景。输出 640×480 PNG，Atrium 缓存封面；源场景、选择、材质、对象状态均不修改。
- 单个素材可预览后保存、重新生成、上传图片、恢复自动封面。已经关联的素材可批量生成，串行执行、可取消，有逐项结果；未关联项明确跳过。
- 不实现未导入 ZIP 的自动依赖安装、自动穿衣、互动动画演示或 VRChat 运行效果。

## 通信与状态

沿用 Temp/AVCABridge 本地文件信箱。新增 get_preview_targets / render_preview 命令，桥接心跳声明物品预览能力；旧桥接显示升级操作。每次请求绑定明确的 projectId，不能因为顶栏后来切工程而串台。

候选使用 GlobalObjectId；没有持久标识时使用会话 instanceId 并标记不能批量复用。scene_view 方向读取当前 SceneView；另外提供 front/back/left/right 的明确预设。

render_preview 只写桥接 previews 子目录的请求编号 PNG，结果给相对路径、尺寸、网格数量。主进程检查目录边界、真实路径、文件类型和体积，再解码至自有缓存。预览尚未确认时只在隔离暂存缓存，保存才更新卡片。

封面覆盖记录 asset_cover：关联到卡片 ID，记来源、原封面及渲染选项。与按内容哈希共享的自动封面分离；每次新图独立 URL，避免 Chromium 缓存导致旧图。自动补图、清理和删除入口都尊重覆盖记录。恢复操作撤销覆盖，不删原始素材。

## UI

详情及合集详情增加“设置封面”。弹窗引导：选择工程 → 在 Unity 选物品并读取 / 搜索 Prefab → 调整角度、背景 → 生成预览 → 保存。图像失败允许重试；取消后原封面保留。批量入口显示已关联与跳过项，并保护上传的手动图片。

新增文案提供中、英、日翻译。技术错误码映射到清晰文案，附错误详情便于诊断。没有工程、编译/Play 忙碌、无网格、缺 shader、目标失效等均如实显示。

## 验证

第一轮用巧克力资源副本及 lilToon 2.3.4 创建隔离 Unity 测试工程。验证实际 GPU 出图、颜色/构图、Mesh 与 SkinnedMesh、重复生成资源释放、场景状态前后不变。买来的模型与贴图不提交到仓库。

Node 测试覆盖关联保存/恢复、手动封面保护、清理、图片路径越界、桥接旧版本、失败与取消、批量串行与工程绑定。完整 npm test、typecheck、Electron Vite build、worker 检查、桥接 Unity API 编译及隔离 Electron UI 操作通过后，进行整分支审查；功能未完成不创建 PR。
