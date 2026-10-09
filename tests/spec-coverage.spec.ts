import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * **M5-A 对规格 94 条硬性规则（`docs/M5A-SPEC-NOTES.md` §1）的逐条对账。**
 *
 * ## 为什么要有这个文件
 *
 * 规格把「必须 / 不得 / 禁止」逐条编了号（R-01…R-94），并明确写着
 * 「跑不到的必须标'未验证'，不得写成已验证」。散着看容易漏掉整节 ——
 * 比如「1.7 自动切换 + 顶栏 + 横幅」那 12 条一条都没做，
 * 如果没人逐节对账，很容易在汇报里被含糊成"顶栏做了"。
 *
 * 所以这里**显式记录每条规则的归属与证据**，并且：
 *  - `impl` 列的文件必须真的存在（防止"文档里说做了、代码里没有"）
 *  - `test` 列的文件必须真的存在，且**至少有一条用例**（防止空测试文件充数）
 *  - 明确标出 `outOfScope` 的条目，以及**为什么**不在 M5-A 范围
 *
 * ⚠ 这个文件**不替代**真正的行为测试 —— 它保证的是"没有整块被静默漏掉"。
 * 每条规则的行为验证在 `test` 列指向的文件里。
 */

interface Rule {
  id: string
  /** 一句话：这条要求什么 */
  what: string
  /** 实现落地在哪些文件（相对仓库根） */
  impl: string[]
  /** 行为测试在哪些文件 */
  test: string[]
  /** 不属于 M5-A 范围时写原因；属于范围就省略 */
  outOfScope?: string
}

/**
 * 证据强度是**推导**出来的，不是逐条手填字段。
 *
 * 理由：94 条逐条手填 strength 既啰嗦又容易填错（而且很容易全都填 `behavior`
 * 糊过去，那就等于没分类）。改成两张显式清单 + 一条推导规则：
 *
 * - `STATIC_RULES`：测试是**静态检查**（扫源码字面量、断言文件存在）。
 *   能防"被改错"，但验不了运行时行为。
 * - `DOC_ONLY_RULES`：**只有文档承载，没有测试**。这类必须明说，
 *   不许算成"已验证"（它们同时会被断言 `test` 列为空 —— 见下面的用例）。
 * - 其余在范围内、且有测试的 → `behavior`（测试真的驱动被测代码）。
 */
const STATIC_RULES = new Set([
  'R-05', // 对账：C# 与 TS 的字面量一致性（静态扫源码）
  'R-07', // 零第三方依赖：靠编译通过 + 静态禁令证明
  'R-12', // "切回 Unity" 是提示文案，静态查模板
  'R-18', // 心跳 2 秒：两边的常量对账
  'R-25', // 退避序列：常量对账 + manager 行为测试
  'R-26', // busyReason 字段存在性对账
  'R-27', // "忙时不消费" 靠源码结构断言
  'R-28', // 9 条命令名对账
  'R-30', // GUIDToAssetPath 不抛：编译期类型检查
  'R-32', // 结果信封字段名对账
  'R-39', // 三个周期常量对账
  'R-44', // 托盘唤醒：`window.ts` 顶层读 `app.isPackaged`，node 环境加载不了 → 只能读源码钉接线
  'R-59', // createdGuids 差集：靠源码结构断言
  'R-68', // §6 逐条对照：静态禁令集合
  'R-69', // 静态构造轻量：源码结构断言
  'R-70', // InitializeOnLoad 存在性
  'R-71', // Tick 三道闸门顺序：源码结构断言
  'R-72', // 事件驱动：回调存在性
  'R-73', // 不连发 ImportPackage：静态禁令
  'R-74', // 差集算法：源码结构
  'R-75', // isUpdating 属忙判定：源码结构
  'R-76', // 同上（R-30 的 C# 侧）
  'R-77', // FileUtil 存在性
  'R-78', // 🚫 不手写 .meta：静态禁令
  'R-81', // Tick 里同步 IO：源码结构断言
  'R-82', // 不用 DisplayProgressBar：静态禁令
  'R-83', // 不调 Exit/SaveScene：静态禁令
  'R-87', // C# 能编过：真编译，但仍是"编译期"证据而非运行时
  'R-90', // 已知限制一节存在性
  'R-91' // 路径校验：源码结构断言
])

const DOC_ONLY_RULES = new Set([
  'R-89', // docs/BRIDGE.md 本身是交付物，没有测试能"验"一份文档
  'R-86' // §8 验收逐条自测：本质是交付动作，证据是文档里的记录
])

function strengthOf(id: string): 'behavior' | 'static' | 'doc' {
  if (DOC_ONLY_RULES.has(id)) return 'doc'
  if (STATIC_RULES.has(id)) return 'static'
  return 'behavior'
}

/**
 * ⚠ 本文件在 `tests/` **根**下（不在 `tests/bridge/` 那种子目录里），
 * 所以仓库根是 `__dirname/..` 而不是 `../..`。
 * 第一版我照抄了子目录里的写法，结果所有路径都指到仓库外，"每个文件都不存在" ——
 * 于是这个对账测试**对着自己的路径 bug 红了一片**。路径算错时它会报得很难看，
 * 但至少不会静默通过。
 */
const REPO = path.resolve(__dirname, '..')

/** `docs/M5A-SPEC-NOTES.md` §1 的 94 条。分组与编号与原文一致 */
const RULES: Rule[] = [
  // ------------------------------------------------ 1.1 全局前提（5 条）
  { id: 'R-01', what: '技术栈不变（Electron33+/TS 严格/React18/Tailwind/Radix/better-sqlite3/Vitest）', impl: ['package.json'], test: ['tests/renderer/i18n.spec.ts'] },
  { id: 'R-02', what: 'Unity 版本固定 2022.3.22f1，路径走设置项 unityExePath', impl: ['src/shared/settingsDefaults.ts'], test: ['tests/import/coordinator.spec.ts'] },
  { id: 'R-03', what: 'schema 以第 1 份 §5 为准；用 project/import_log/package_entry/journal', impl: ['src/main/db/schema.ts'], test: ['tests/db/schema.spec.ts'] },
  { id: 'R-04', what: '代码放 src/main/bridge 与 src/main/project，C# 模板放 resources/unity-bridge', impl: ['src/main/bridge/mailbox.ts', 'src/main/project/running.ts', 'resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs'], test: ['tests/bridge/mailbox.spec.ts'] },
  { id: 'R-05', what: '「必须」字样一律照做，不换成"更优雅"的写法', impl: ['docs/BRIDGE.md'], test: ['tests/bridge/protocol-conformance.spec.ts'] },

  // ------------------------------------------------ 1.2 桥接安装与卸载（10 条）
  { id: 'R-06', what: '安装方式严格按 §1 实现', impl: ['src/main/bridge/installer.ts'], test: ['tests/bridge/installer.spec.ts'] },
  { id: 'R-07', what: '桥接自包含、零第三方依赖，不依赖 unity-mcp', impl: ['resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs'], test: ['tests/bridge/compile-check.spec.ts'] },
  { id: 'R-08', what: '必须用 Packages/ 而不是 Assets/（不得更改）', impl: ['src/main/bridge/installer.ts'], test: ['tests/bridge/installer.spec.ts', 'tests/bridge/real-template.spec.ts'] },
  { id: 'R-09', what: '放 Packages/ 才不会混进上传的 Avatar', impl: ['src/main/bridge/installer.ts'], test: ['tests/bridge/installer.spec.ts'] },
  { id: 'R-10', what: '首次安装必须弹窗告知（三按钮）', impl: ['src/shared/bridgeAsk.ts', 'src/main/project/api.ts', 'src/main/bridge/askQueue.ts', 'src/main/db/repos/bridgeAsk.ts', 'src/renderer/components/BridgeAskDialog.tsx'], test: ['tests/shared/bridge-ask.spec.ts', 'tests/db/bridge-ask.spec.ts', 'tests/project/bridge-ask-wiring.spec.ts'] },
  { id: 'R-11', what: '安装写 journal（op = bridge_install）', impl: ['src/main/bridge/installer.ts'], test: ['tests/bridge/installer.spec.ts'] },
  { id: 'R-12', what: 'Unity 在后台不自动编译；提示用户切回 Unity', impl: ['docs/BRIDGE.md'], test: ['tests/bridge/real-template.spec.ts'] },
  { id: 'R-13', what: '卸载删整个 Packages/com.avca.bridge，**走回收站**', impl: ['src/main/bridge/installer.ts'], test: ['tests/bridge/installer.spec.ts'] },
  { id: 'R-14', what: '设置项 bridgeAutoInstall 默认关；开启后自动装但要在 UI 说明', impl: ['src/shared/settingsDefaults.ts', 'src/shared/bridgeAsk.ts', 'src/main/project/api.ts', 'src/renderer/stores/ui.ts'], test: ['tests/bridge/installer.spec.ts', 'tests/shared/bridge-ask.spec.ts', 'tests/project/bridge-ask-wiring.spec.ts'] },
  { id: 'R-15', what: '设置页提供"从所有工程卸载桥接"', impl: ['src/main/bridge/installer.ts', 'src/main/bridge/ipc.ts'], test: ['tests/bridge/installer.spec.ts', 'tests/bridge/ipc.spec.ts'] },

  // ------------------------------------------------ 1.3 文件信箱（8 条）
  { id: 'R-16', what: '用 Temp/ 文件信箱，不得改 TCP/HTTP/命名管道', impl: ['src/main/bridge/mailbox.ts'], test: ['tests/bridge/mailbox.spec.ts'] },
  { id: 'R-17', what: '已知限制：Temp 是临时目录，检测运行不能只靠桥接（须在 UI 说明）', impl: ['docs/BRIDGE.md'], test: ['tests/bridge/lockfile.spec.ts'] },
  { id: 'R-18', what: '心跳间隔 2 秒（EditorApplication.update 驱动）', impl: ['resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs'], test: ['tests/bridge/protocol-conformance.spec.ts'] },
  { id: 'R-19', what: 'A 侧 10 秒无心跳 → 判定退出，清理实例但保留 project 记录', impl: ['src/main/bridge/mailbox.ts', 'src/main/project/running.ts'], test: ['tests/bridge/mailbox.spec.ts'] },
  { id: 'R-20', what: 'A 侧用 chokidar 监听 outbox（事件驱动）', impl: ['src/main/bridge/manager.ts'], test: ['tests/bridge/manager.spec.ts'] },
  { id: 'R-21', what: '写盘先 .tmp 再 rename（原子）', impl: ['src/main/bridge/mailbox.ts'], test: ['tests/bridge/mailbox.spec.ts'] },
  { id: 'R-22', what: '结果文件名固定 <id>.json，进度是覆写', impl: ['src/main/bridge/mailbox.ts'], test: ['tests/bridge/mailbox.spec.ts'] },
  { id: 'R-23', what: '终态后 Unity 删 inbox、A 删 outbox（删除权归读方）', impl: ['src/main/bridge/mailbox.ts', 'resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs'], test: ['tests/bridge/mailbox.spec.ts', 'tests/bridge/manager.spec.ts'] },

  // ------------------------------------------------ 1.4 busy 与重试（4 条）
  { id: 'R-24', what: 'busy 不算失败，必须排队重试', impl: ['src/main/bridge/manager.ts'], test: ['tests/bridge/manager.spec.ts'] },
  { id: 'R-25', what: '退避序列固定 1/2/5/10/30/30…，最多 60 次', impl: ['src/main/bridge/manager.ts', 'src/shared/constants.ts'], test: ['tests/bridge/manager.spec.ts', 'tests/bridge/protocol-conformance.spec.ts'] },
  { id: 'R-26', what: 'busy 结果带 busyReason，界面显示"Unity 正在运行/编译，已排队"', impl: ['resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs', 'src/renderer/components/ImportFlow.tsx'], test: ['tests/bridge/protocol-conformance.spec.ts'] },
  { id: 'R-27', what: '写回 busy 时**不消费**命令（命令留在 inbox 供重投）', impl: ['resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs'], test: ['tests/bridge/protocol-conformance.spec.ts'] },

  // ------------------------------------------------ 1.5 命令面（5 条）
  { id: 'R-28', what: '命令表 9 条全实现，不做子集', impl: ['resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs'], test: ['tests/bridge/protocol-conformance.spec.ts'] },
  { id: 'R-29', what: 'resolve_guids 单批 ≤ 2000，超出分批', impl: ['src/main/import/coordinator.ts', 'src/shared/constants.ts'], test: ['tests/import/coordinator.spec.ts'] },
  { id: 'R-30', what: 'GUIDToAssetPath 对不存在的 GUID 返回空串，不抛', impl: ['resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs'], test: ['tests/bridge/compile-check.spec.ts'] },
  { id: 'R-31', what: '命令信封字段：id/type/protocolVersion/createdAt/payload', impl: ['src/main/bridge/mailbox.ts', 'src/shared/types.ts'], test: ['tests/bridge/mailbox.spec.ts', 'tests/bridge/protocol-conformance.spec.ts'] },
  { id: 'R-32', what: '结果信封字段：id/status/progress/message/data', impl: ['src/shared/types.ts', 'resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs'], test: ['tests/bridge/protocol-conformance.spec.ts'] },

  // ------------------------------------------------ 1.6 工程探测（9 条）
  { id: 'R-33', what: '路径 1：ALCOM/VCC 清单', impl: ['src/main/project/api.ts'], test: ['tests/bridge/ipc.spec.ts'] },
  { id: 'R-34', what: '路径 2：扫盘（深度限制、跳过备份/缓存）', impl: ['src/main/project/api.ts'], test: ['tests/bridge/ipc.spec.ts'] },
  { id: 'R-35', what: '路径 3：WMI 进程命令行', impl: ['src/main/project/wmi.ts'], test: ['tests/bridge/lockfile.spec.ts'] },
  { id: 'R-36', what: '路径 4：桥接心跳', impl: ['src/main/bridge/mailbox.ts'], test: ['tests/bridge/mailbox.spec.ts'] },
  { id: 'R-37', what: '三路取并集，任一命中即认为在运行', impl: ['src/main/project/running.ts'], test: ['tests/bridge/ipc.spec.ts'] },
  { id: 'R-38', what: 'UnityLockfile 必须**尝试独占打开**，不能只看文件存在', impl: ['src/main/project/lockfile.ts'], test: ['tests/bridge/lockfile.spec.ts'] },
  { id: 'R-39', what: '三个周期：锁文件 3s / WMI 5s（不得更频繁）/ 心跳 2s', impl: ['src/main/project/running.ts'], test: ['tests/bridge/protocol-conformance.spec.ts'] },
  { id: 'R-40', what: '管理员权限的 Unity：WMI 读不到命令行，所以 WMI 只兜底', impl: ['src/main/project/wmi.ts'], test: ['tests/bridge/lockfile.spec.ts'] },
  { id: 'R-41', what: '自动切换的冷却：同一工程 5 分钟一次', impl: ['src/shared/constants.ts', 'src/main/project/autoSwitch.ts'], test: ['tests/project/auto-switch.spec.ts'] },

  // ------------------------------------------------ 1.7 自动切换 + 顶栏 + 横幅（12 条 · M6 已交付）
  { id: 'R-42', what: '工程指纹匹配集合', impl: ['src/shared/projectMatch.ts', 'src/main/project/fingerprint.ts'], test: ['tests/shared/project-match.spec.ts', 'tests/project/fingerprint.spec.ts'] },
  { id: 'R-43', what: '匹配到就切换集合视图', impl: ['src/main/project/api.ts', 'src/renderer/stores/ui.ts'], test: ['tests/project/auto-switch.spec.ts', 'tests/renderer/auto-switch-store.spec.ts'] },
  { id: 'R-44', what: 'A 在托盘时弹出主窗口并短暂置顶', impl: ['src/main/window.ts'], test: ['tests/renderer/auto-switch-store.spec.ts'] },
  { id: 'R-45', what: '设置页说明"A 必须常驻托盘才能感知 Unity 启动"', impl: ['src/renderer/i18n/zh-CN.json', 'src/renderer/components/AutoLaunchAsk.tsx'], test: ['tests/shared/banner-state.spec.ts', 'tests/renderer/i18n.spec.ts'] },
  { id: 'R-46', what: '切换集合只换左侧选中项与过滤，**不清空搜索框**', impl: ['src/renderer/stores/ui.ts'], test: ['tests/renderer/auto-switch-store.spec.ts'] },
  { id: 'R-47', what: '顶部横幅（10 秒淡出可固定）+ 三按钮语义；"以后都这样"写 rule_json.projectPaths', impl: ['src/shared/bannerState.ts', 'src/renderer/components/ProjectBanner.tsx', 'src/renderer/stores/ui.ts'], test: ['tests/shared/banner-state.spec.ts', 'tests/renderer/auto-switch-store.spec.ts'] },
  { id: 'R-48', what: '顶栏显示运行中的实例', impl: ['src/renderer/components/chrome.tsx'], test: ['tests/bridge/ipc.spec.ts'] },
  { id: 'R-49', what: '同一工程 5 分钟内只自动切换一次', impl: ['src/main/project/autoSwitch.ts', 'src/main/db/repos/unity.ts'], test: ['tests/project/auto-switch.spec.ts', 'tests/db/migration-v6.spec.ts'] },
  { id: 'R-50', what: '多个实例时按 projectPath 区分，不串台', impl: ['src/main/bridge/manager.ts'], test: ['tests/bridge/manager.spec.ts'] },
  { id: 'R-51', what: '用户正在操作（拖拽/编辑）时不打断，只更新横幅', impl: ['src/renderer/stores/ui.ts', 'src/shared/bannerState.ts'], test: ['tests/renderer/auto-switch-store.spec.ts', 'tests/shared/banner-state.spec.ts'] },
  { id: 'R-52', what: '不要在自动切换时清空搜索框', impl: ['src/renderer/stores/ui.ts'], test: ['tests/renderer/auto-switch-store.spec.ts'] },

  // ------------------------------------------------ 1.8 导入流程 / 队列 / 撤销（14 条）
  { id: 'R-53', what: '导入目标可切换（顶栏切换器）', impl: ['src/main/bridge/ipc.ts', 'src/renderer/components/chrome.tsx'], test: ['tests/bridge/ipc.spec.ts'] },
  { id: 'R-54', what: '校验目标：运行中？桥接就绪？否则提示"请先打开 Unity"/"桥接未安装 [立即安装]"', impl: ['src/main/import/coordinator.ts'], test: ['tests/bridge/ipc.spec.ts'] },
  { id: 'R-55', what: '导入前落库（先写 import_log 再发命令）', impl: ['src/main/import/coordinator.ts'], test: ['tests/import/coordinator.spec.ts'] },
  { id: 'R-56', what: '有冲突 → 弹窗列出**具体文件路径** + [取消][继续][继续并备份]', impl: ['src/renderer/components/ImportFlow.tsx'], test: ['tests/import/coordinator.spec.ts', 'tests/bridge/ipc.spec.ts'] },
  { id: 'R-57', what: '逐条等待终态才发下一条（串行）', impl: ['src/main/bridge/manager.ts'], test: ['tests/bridge/manager.spec.ts'] },
  { id: 'R-58', what: '事务性：先写 journal 再操作', impl: ['src/main/import/coordinator.ts'], test: ['tests/import/coordinator.spec.ts'] },
  { id: 'R-59', what: 'createdGuids 用导入前后快照差集算', impl: ['resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs'], test: ['tests/bridge/protocol-conformance.spec.ts'] },
  { id: 'R-60', what: 'Play 模式下显示"已排队 N 项"', impl: ['src/renderer/components/chrome.tsx', 'src/renderer/components/ImportFlow.tsx'], test: ['tests/bridge/manager.spec.ts'] },
  { id: 'R-61', what: '撤销导入必须有', impl: ['src/main/import/coordinator.ts'], test: ['tests/import/coordinator.spec.ts'] },
  { id: 'R-62', what: '撤销只删本次新建的（delete_guids 白名单）', impl: ['src/main/import/coordinator.ts', 'resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs'], test: ['tests/import/coordinator.spec.ts', 'tests/bridge/ipc.spec.ts'] },
  { id: 'R-63', what: '有 backup_dir 就还原；没有但 overwritten 就如实告知无法还原', impl: ['src/main/import/coordinator.ts'], test: ['tests/import/coordinator.spec.ts'] },
  { id: 'R-64', what: '撤销写 import_log.status=rolledback + journal（op=import_rollback）', impl: ['src/main/import/coordinator.ts'], test: ['tests/import/coordinator.spec.ts'] },
  { id: 'R-65', what: '⚠ delete_guids 必须校验白名单 + Assets/ 前缀，绝不提供"按 GUID 随便删"', impl: ['resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs'], test: ['tests/bridge/protocol-conformance.spec.ts', 'tests/bridge/ipc.spec.ts'] },
  { id: 'R-66', what: '被覆盖文件备份默认开，保留最近 20 次，超出走回收站', impl: ['src/main/import/coordinator.ts', 'src/shared/constants.ts'], test: ['tests/import/coordinator.spec.ts'] },
  { id: 'R-67', what: '双击：图片打开预览；归档素材优先导入其中的 .unitypackage', impl: ['src/renderer/components/AssetGrid.tsx', 'src/main/bridge/ipc.ts'], test: ['tests/bridge/ipc.spec.ts'] },

  // ------------------------------------------------ 1.9 Unity 侧 C#（16 条）
  { id: 'R-68', what: '§6 是最容易翻车的部分，逐条对照实现', impl: ['docs/BRIDGE.md'], test: ['tests/bridge/real-template.spec.ts'] },
  { id: 'R-69', what: '静态构造只做轻量工作，不做 FindAssets/全工程扫描', impl: ['resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs'], test: ['tests/bridge/real-template.spec.ts'] },
  { id: 'R-70', what: '必须注册 InitializeOnLoad，重编译后自动恢复', impl: ['resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs'], test: ['tests/bridge/real-template.spec.ts'] },
  { id: 'R-71', what: 'Tick 500ms 节流 / 忙时不消费 / 串行一次一条', impl: ['resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs'], test: ['tests/bridge/protocol-conformance.spec.ts'] },
  { id: 'R-72', what: '导入必须事件驱动 + 严格串行（最关键）', impl: ['resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs'], test: ['tests/bridge/real-template.spec.ts'] },
  { id: 'R-73', what: '不得连发 ImportPackage；靠三个回调串行推进', impl: ['resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs'], test: ['tests/bridge/real-template.spec.ts'] },
  { id: 'R-74', what: 'createdGuids 算法：导入前快照、导入后重查、差集', impl: ['resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs'], test: ['tests/bridge/protocol-conformance.spec.ts'] },
  { id: 'R-75', what: '必须处理 Unity 自动刷新；isUpdating 为 true 是正常的，不算卡死', impl: ['resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs'], test: ['tests/bridge/protocol-conformance.spec.ts'] },
  { id: 'R-76', what: 'GUIDToAssetPath 对不存在的 GUID 不抛异常', impl: ['resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs'], test: ['tests/bridge/compile-check.spec.ts'] },
  { id: 'R-77', what: '必须用 FileUtil.CopyFileOrDirectory + Refresh，让 Unity 生成 .meta', impl: ['resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs'], test: ['tests/bridge/real-template.spec.ts'] },
  { id: 'R-78', what: '🚫 绝对不能手写 .meta', impl: ['resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs'], test: ['tests/bridge/real-template.spec.ts'] },
  { id: 'R-79', what: '不得静默吞异常；完整堆栈回传（exception + stackTrace）', impl: ['resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs'], test: ['tests/bridge/manager.spec.ts', 'tests/bridge/protocol-conformance.spec.ts'] },
  { id: 'R-80', what: '所有文件读写 try/catch；读 inbox 跳过 .tmp；删除失败不抛，下次 Tick 重试', impl: ['resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs'], test: ['tests/bridge/mailbox.spec.ts', 'tests/bridge/protocol-conformance.spec.ts'] },
  { id: 'R-81', what: 'Tick 里不做同步 IO 等待', impl: ['resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs'], test: ['tests/bridge/protocol-conformance.spec.ts'] },
  { id: 'R-82', what: '不用 EditorUtility.DisplayProgressBar（会阻塞）', impl: ['resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs'], test: ['tests/bridge/real-template.spec.ts'] },
  { id: 'R-83', what: '不调用 EditorApplication.Exit / SaveScene 等改变用户状态的操作', impl: ['resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs'], test: ['tests/bridge/real-template.spec.ts'] },

  // ------------------------------------------------ 1.10 F8「已导入」感知（2 条）
  { id: 'R-84', what: '"清理未使用素材"只提示不自动删除', impl: [], test: [], outOfScope: 'M5-B：依赖分析接入后才谈得上' },
  { id: 'R-85', what: '工程 GUID 索引刷新时机（首次连接全量 / 导入后增量 / 手动重扫）', impl: ['src/main/bridge/ipc.ts'], test: [], outOfScope: 'M5-B：索引落库（setProjectGuidIndex）在 M4 已就位，桥接侧的"导入后增量刷新"属 M5-B；现在只做了 import_log 直查' },

  // ------------------------------------------------ 1.11 交付与自测（5 条）
  { id: 'R-86', what: '§8 验收清单必须逐条自测并报告真实结果', impl: ['docs/BRIDGE.md'], test: [] },
  { id: 'R-87', what: 'C# 自包含零依赖，能在 2022.3.22f1 直接编译通过', impl: ['resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs'], test: ['tests/bridge/compile-check.spec.ts'] },
  { id: 'R-88', what: 'npm test 全绿 + 构造 mock 文件信箱对 BridgeManager 做单测（busy→重试→ok）', impl: ['tests/bridge/fake-unity.ts'], test: ['tests/bridge/manager.spec.ts'] },
  { id: 'R-89', what: '附 docs/BRIDGE.md：协议完整说明（命令/结果 JSON 示例）+ 调试方法 + 手模拟命令', impl: ['docs/BRIDGE.md'], test: [] },
  { id: 'R-90', what: '附"已知限制"一节 + 诚实报告未通过的验收/未测场景', impl: ['docs/BRIDGE.md'], test: ['tests/docs.spec.ts'] },

  // ------------------------------------------------ 1.12 跨份硬约束（4 条）
  { id: 'R-91', what: '导入 Unity 前，目标路径必须校验在目标工程目录内', impl: ['resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs'], test: ['tests/bridge/protocol-conformance.spec.ts'] },
  { id: 'R-92', what: '永不永久删除用户文件，删除一律走回收站', impl: ['src/main/bridge/installer.ts', 'src/main/import/coordinator.ts'], test: ['tests/bridge/installer.spec.ts', 'tests/import/coordinator.spec.ts'] },
  { id: 'R-93', what: '所有文件系统操作写 journal；可撤销；批量可中断且状态一致', impl: ['src/main/import/coordinator.ts'], test: ['tests/import/coordinator.spec.ts'] },
  { id: 'R-94', what: '不做联网请求；IPC 边界校验路径防穿越', impl: ['resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs', 'src/main/security/paths.ts'], test: ['tests/security/paths.spec.ts'] }
]

function exists(rel: string): boolean {
  return fs.existsSync(path.join(REPO, rel))
}

/** 数一个 spec 文件里的用例数（`it(` 与 `it.skip(` 都算） */
function countCases(rel: string): number {
  const p = path.join(REPO, rel)
  if (!fs.existsSync(p)) return -1
  const src = fs.readFileSync(p, 'utf8')
  return (src.match(/\bit(?:\.\w+)?\s*\(/g) || []).length
}

describe('规格 §1 的 94 条硬性规则：逐条对账', () => {
  it('规则编号完整覆盖 R-01…R-94，一条不漏', () => {
    const ids = RULES.map((r) => r.id)
    expect(new Set(ids).size, '有重复的规则编号').toBe(ids.length)
    const missing: string[] = []
    for (let i = 1; i <= 94; i++) {
      const id = `R-${String(i).padStart(2, '0')}`
      if (!ids.includes(id)) missing.push(id)
    }
    expect(missing, `对账表里缺这些规则：${missing.join(', ')}`).toEqual([])
    expect(RULES).toHaveLength(94)
  })

  it('每条 **实现落地** 的文件都真的存在（防止"文档说做了、代码里没有"）', () => {
    const broken: string[] = []
    for (const r of RULES) {
      for (const f of r.impl) {
        if (!exists(f)) broken.push(`${r.id} → ${f}`)
      }
    }
    expect(broken, `这些规则声称的实现在哪都找不到：\n${broken.join('\n')}`).toEqual([])
  })

  it('每条 **行为测试** 的文件都真的存在，且不是空壳（至少 1 条用例）', () => {
    const broken: string[] = []
    for (const r of RULES) {
      for (const f of r.test) {
        const n = countCases(f)
        if (n < 0) broken.push(`${r.id} → ${f}（文件不存在）`)
        else if (n === 0) broken.push(`${r.id} → ${f}（0 条用例，等于没测）`)
      }
    }
    expect(broken, `这些规则的测试文件有问题：\n${broken.join('\n')}`).toEqual([])
  })

  it('标了 outOfScope 的必须写明原因；没标的必须**至少有一处证据**', () => {
    const bad: string[] = []
    for (const r of RULES) {
      if (r.outOfScope) {
        if (r.outOfScope.length < 8) bad.push(`${r.id} 的 outOfScope 没写清原因`)
        /**
         * 范围外的条目**不该声称有行为测试** —— 声称了就是在虚报覆盖。
         * （`impl` 允许有：比如 R-45 的文案已经就位，只是流程属 M6。）
         */
        if (r.test.length > 0) bad.push(`${r.id} 标了 outOfScope 却声称有测试，属于虚报`)
        continue
      }
      if (r.impl.length === 0 && r.test.length === 0) {
        bad.push(`${r.id} 既没标 outOfScope，也没有实现或测试证据`)
      }
      if (r.impl.length > 0 && r.test.length === 0 && strengthOf(r.id) !== 'doc') {
        bad.push(`${r.id} 有实现但没有任何测试，却没被列进 DOC_ONLY_RULES`)
      }
    }
    expect(bad, `对账表这些条目站不住：\n${bad.join('\n')}`).toEqual([])
  })

  it('**只有文档承载的规则必须明说**，不许混进"已验证"里', () => {
    const docOnly = RULES.filter((r) => strengthOf(r.id) === 'doc' && !r.outOfScope)
    /**
     * 这份清单是给用户看的诚实交代：这些条目**没有测试**，
     * 只有文档/交付记录。数量变了就要显式改这里，不能悄悄涨。
     */
    expect(
      docOnly.map((r) => r.id).sort(),
      '只有文档承载的规则集合变了；如确实新增，请显式更新这条断言'
    ).toEqual(['R-86', 'R-89'])
  })

  it('强度分布打出来（便于汇报时如实说明哪部分是静态检查）', () => {
    const inScope = RULES.filter((r) => !r.outOfScope)
    const byStrength = { behavior: 0, static: 0, doc: 0 }
    const staticIds: string[] = []
    const docIds: string[] = []
    for (const r of inScope) {
      const s = strengthOf(r.id)
      byStrength[s]++
      if (s === 'static') staticIds.push(r.id)
      if (s === 'doc') docIds.push(r.id)
    }
    console.log(
      `范围内 ${inScope.length} 条：行为测试 ${byStrength.behavior} / 静态检查 ${byStrength.static} / 仅文档 ${byStrength.doc}`
    )
    console.log(`  静态检查：${staticIds.join(' ')}`)
    console.log(`  仅文档：${docIds.join(' ')}`)
    console.log(`范围外（M6/M5-B）：${RULES.filter((r) => r.outOfScope).map((r) => r.id).join(' ')}`)
    expect(byStrength.behavior).toBeGreaterThan(40)
    /** 静态检查不该占多数 —— 占多数说明真正驱动代码的测试太少 */
    expect(byStrength.static).toBeLessThan(byStrength.behavior)
  })

  it('**不在当前范围的条目**要显式列出来（防止整块被静默漏掉）', () => {
    const outOfScope = RULES.filter((r) => r.outOfScope).map((r) => r.id)
    /**
     * §1.7「自动切换 + 顶栏 + 横幅」那 12 条在 **M6 全部落地**（R-41…R-52 一条不落），
     * R-10「首次安装必须弹窗告知（三按钮）」在 **R4 ⑦ 落地**。
     * 这条断言现在反过来钉两件事：
     *  1. 这些条目**不许再被标成范围外**（谁把它们退回 outOfScope，这里就红）；
     *  2. 剩下的范围外条目只有两条，且都写明了为什么 —— 新增必须显式改这里。
     */
    for (const id of ['R-10', 'R-42', 'R-43', 'R-44', 'R-45', 'R-46', 'R-47', 'R-49', 'R-51', 'R-52']) {
      expect(outOfScope, `${id} 已在 M6/R4 交付，不许标成范围外`).not.toContain(id)
    }
    expect(outOfScope.sort()).toEqual(['R-84', 'R-85'])
  })

  it('M5-A 的核心规则（安装/信箱/busy/探测/导入/撤销/C# 禁令）都有实现且有测试', () => {
    const core = [
      'R-08', // Packages 不用 Assets
      'R-13', // 卸载走回收站
      'R-21', // 原子写
      'R-23', // 终态删除权归读方
      'R-24', // busy 不算失败
      'R-27', // 忙时不消费命令
      'R-37', // 三路取并集
      'R-38', // 锁文件独占试开
      'R-56', // 冲突列出具体路径
      'R-57', // 串行
      'R-62', // 撤销只删白名单
      'R-65', // delete_guids 双重校验
      'R-73', // 不连发 ImportPackage
      'R-78', // 不手写 .meta
      'R-87', // C# 能编译通过
      'R-92' // 永不永久删除
    ]
    const weak: string[] = []
    for (const id of core) {
      const r = RULES.find((x) => x.id === id)
      if (!r) {
        weak.push(`${id}（对账表里没有）`)
        continue
      }
      if (r.impl.length === 0) weak.push(`${id} 没有实现文件`)
      if (r.test.length === 0) weak.push(`${id} 没有测试`)
    }
    expect(weak, `M5-A 核心规则证据不足：${weak.join('; ')}`).toEqual([])
  })
})

// ================================================================ M5-B：压缩包成员提取

/**
 * M5-B 的自定规矩（编号 `M5B-xx`，**不混进上面那张 94 条的表** ——
 * 那张表有"R-01…R-94 一条不漏、总数正好 94"的断言，那是跟规格文档对账用的，
 * 加条目等于篡改规格）。
 *
 * 加这一节的理由和上面一样：**没有对账表就会整块漏掉**。
 * M5-B 最容易被糊过去的三类：
 *  1. "抽出来了"但其实抽的是整包（一次 859 MB 落在临时目录）；
 *  2. "有闸门"但闸门在写盘之后才跑；
 *  3. "有界面"但那条路一行测试都没有（本仓库渲染层零 DOM 测试）。
 * 第 3 类在这里**明写成 untested**，不假装有证据。
 */
interface M5bRule {
  id: string
  what: string
  impl: string[]
  test: string[]
  /** 没有行为测试时，为什么没有 + 那部分靠什么兜 */
  untested?: string
}

const M5B_STATIC = new Set(['M5B-16', 'M5B-17'])

const M5B_RULES: M5bRule[] = [
  {
    id: 'M5B-01',
    what: '**永不整包解压**：只把用户点名的那一个成员落到磁盘（`wanted` 空数组直接抛）',
    impl: ['src/main/unpack/members.ts', 'src/main/unpack/unzip.ts', 'src/main/unpack/sevenZip.ts'],
    test: ['tests/unpack/members.spec.ts']
  },
  {
    id: 'M5B-02',
    what: '抽取返回 **localPath**，调用方不许自己拼落点（P0-1：拼错就静默读不到）',
    impl: ['src/main/unpack/members.ts', 'src/main/ingest/worker.ts'],
    test: ['tests/unpack/members.spec.ts']
  },
  {
    id: 'M5B-03',
    what: '`only` 是整段匹配，不是前缀匹配（P0-2：勾一个抽两个）',
    impl: ['src/main/unpack/entryMatch.ts', 'src/main/unpack/unzip.ts'],
    test: ['tests/unpack/members.spec.ts']
  },
  {
    id: 'M5B-04',
    what: '**先看磁盘事实再看扩展名**（真库有 2 个"名字叫 .zip 的目录"，P0-3）',
    impl: ['src/main/unpack/members.ts', 'src/main/import/containerPackages.ts'],
    test: ['tests/unpack/members.spec.ts', 'tests/import/container-packages.spec.ts']
  },
  {
    id: 'M5B-05',
    what: '容器成员清单：段数/条数两个上限，**撞线必须记账**（P0-4：不许静默少列 7 个）',
    impl: ['src/main/import/containerPackages.ts'],
    test: ['tests/import/container-packages.spec.ts']
  },
  {
    id: 'M5B-06',
    what: '压缩包只钻一层；里面还有压缩包就记一笔 nestedArchive，不起第二层后端',
    impl: ['src/main/import/containerPackages.ts'],
    test: ['tests/import/container-packages.spec.ts']
  },
  {
    id: 'M5B-07',
    what: '抽取根默认落**库根的兄弟目录**（同盘），设置留空就用推导值',
    impl: ['src/main/import/extractRoot.ts', 'src/shared/settingsDefaults.ts'],
    test: ['tests/import/extract-root.spec.ts']
  },
  {
    id: 'M5B-08',
    what: '三道硬闸门（不在库根内 / 不在 C 盘 / 剩余 ≥ max(2×体积,2GB)）**在任何一个字节落盘之前**',
    impl: ['src/main/import/extractRoot.ts', 'src/main/import/memberImport.ts'],
    test: ['tests/import/extract-root.spec.ts', 'tests/import/member-import.spec.ts']
  },
  {
    id: 'M5B-09',
    what: 'Windows 命名空间写法（`\\\\?\\C:\\`）不许绕过 C 盘闸门，也不许绕过"不在库内"',
    impl: ['src/main/import/extractRoot.ts'],
    test: ['tests/import/extract-root.spec.ts', 'tests/import/member-import.spec.ts']
  },
  {
    id: 'M5B-10',
    what: '删除只许删抽取根之内（`releaseMemberDir(dir, mustBeUnder)` 的闸门），目录型成员指向库里原件时**不许**被删',
    impl: ['src/main/import/extractRoot.ts', 'src/main/import/memberImport.ts'],
    test: ['tests/import/extract-root.spec.ts', 'tests/import/member-import.spec.ts']
  },
  {
    id: 'M5B-11',
    what: '临时副本三层清理：终态即删 / 启动 prune / 手动清理；**删失败只记 warn，不许把成功的导入报成失败**',
    impl: ['src/main/import/memberImport.ts', 'src/main/ingest/api.ts', 'src/main/bridge/ipc.ts'],
    test: ['tests/import/member-import.spec.ts', 'tests/import/extract-root.spec.ts', 'tests/bridge/ipc.spec.ts']
  },
  {
    id: 'M5B-12',
    what: '一包一条 `import_log`、同一个 batch_id，V5 三列（容器/成员/外层包）填对；散装直导三列留 NULL',
    impl: ['src/main/db/schema.ts', 'src/main/db/repos/journal.ts', 'src/main/import/coordinator.ts'],
    test: ['tests/db/migration-v5.spec.ts', 'tests/import/member-import.spec.ts', 'tests/bridge/ipc.spec.ts']
  },
  {
    id: 'M5B-13',
    what: '确认时**重新预扫描**（备份要用当下的冲突表，用旧表就会漏备份）',
    impl: ['src/main/import/memberImport.ts'],
    test: ['tests/import/member-import.spec.ts']
  },
  {
    id: 'M5B-14',
    what: '串行导入：Unity 退回失败就**停手**，剩下的记为"未执行"；**不自动回滚**已进工程的东西',
    impl: ['src/main/import/memberImport.ts'],
    test: ['tests/import/member-import.spec.ts']
  },
  {
    id: 'M5B-15',
    what: '失败归因一类一个 key（要密码 / 坏了 / 没后端 / 不是压缩包 / 缺分卷 / 成员没了 / 解析不了），不许合成一句"抽取失败"',
    impl: ['src/main/import/memberImport.ts'],
    test: ['tests/import/member-import.spec.ts']
  },
  {
    id: 'M5B-16',
    what: '撤销：只碰 status=ok 的行、按**真实插入顺序倒序**；journal 的 import/import_rollback 不带 assetIds；Ctrl+Z 的白名单不含 import',
    impl: ['src/main/db/repos/journal.ts', 'src/main/import/memberImport.ts', 'src/main/import/coordinator.ts'],
    test: ['tests/import/member-import.spec.ts']
  },
  {
    id: 'M5B-17',
    what: '预勾只允许"名字匹配"这一种猜测，且要写明依据；一个都没命中或命中面太宽都**一个都不勾**',
    impl: ['src/shared/memberPick.ts'],
    test: ['tests/shared/member-pick.spec.ts']
  },
  {
    id: 'M5B-18',
    what: '一次一批（上限与主进程同一个常量）+ **一张**汇总冲突卡，一次决定覆盖这批全部包',
    impl: ['src/shared/memberPick.ts', 'src/main/import/memberImport.ts'],
    test: ['tests/shared/member-pick.spec.ts', 'tests/import/member-import.spec.ts']
  },
  {
    id: 'M5B-19',
    what: '面板的**状态转移**：关面板/点取消要退回副本、一次只规划一批、picked 按点击顺序、闸门拒绝要把 reasonKey 传到界面',
    impl: ['src/renderer/stores/ui.ts'],
    test: ['tests/renderer/member-picker-store.spec.ts']
  },
  {
    id: 'M5B-19b',
    what: '面板的**画法**（列表渲染、勾选框、汇总/结果两张卡、增量显示）',
    impl: ['src/renderer/components/MemberPicker.tsx', 'src/renderer/App.tsx'],
    test: [],
    untested:
      '本仓库渲染层**零 DOM 测试**（vitest environment:node，没装 jsdom），画法只能靠沙盒活体截图。' +
      '2026-10-06 已用 `tools/fake-unity-live.cjs` 在沙盒点过一遍（三步 + 冲突展开 + 取消退副本 + 整批退回），' +
      '截图见 docs/screenshots/m5b-picker-*.png、取证见 tools/probe-m5b-live-state.cjs。' +
      '**但截图不是自动化用例**：改坏了不会红，下次还得靠人点'
  },
  {
    id: 'M5B-20',
    what: '加密容器在导入这条链上的密码输入框（摄取那条有，导入这条**只做了后端与参数**）',
    impl: ['src/main/import/memberImport.ts', 'src/main/bridge/ipc.ts'],
    test: [],
    untested:
      '`unity:import-plan` 收 password、主进程侧 PasswordNeededError 归成 err.needPassword 有单测，' +
      '但面板上还没有输入框（真库实测 0 个加密 rar / 0 个加密 zip，属预防项）。' +
      '算**未交付**，不算已验证'
  },
  {
    id: 'M5B-21',
    what: '真 Unity 落地：从真 zip 抽出的包 ImportPackage 真的成功、Play 模式排队、撤销真删',
    impl: ['src/main/import/memberImport.ts', 'resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs'],
    test: [],
    untested:
      '要他开编辑器点一次。C# 那侧 M5-B 一行没改（`node tools/check-bridge-compile.cjs` ✅ 20.0 KB 只作误伤哨兵）；' +
      '离线侧全部走 FakeUnity / 假桥接。写进 docs/BRIDGE.md §8 的未验证清单'
  },
  {
    id: 'M5B-22',
    what: '闸门话术里的插值占位符必须是 `{{name}}`（写成 `{name}` 界面会原样吐大括号）',
    impl: ['src/renderer/i18n/zh-CN.json', 'src/renderer/i18n/en.json', 'src/renderer/i18n/ja.json'],
    test: ['tests/renderer/i18n.spec.ts']
  },
  {
    id: 'M5B-23',
    what: '活体验收的运行时目录重定向（`AVCA_APP_HOME`）真的被 `initAppPaths()` 用，且不像沙盒的路径要拒绝启动',
    impl: ['src/main/services/paths.ts'],
    test: ['tests/services/app-home.spec.ts']
  }
]

describe('M5-B 压缩包成员提取：逐条对账', () => {
  it('M5-B 每条规矩都有实现文件，且文件真的存在', () => {
    const broken: string[] = []
    for (const r of M5B_RULES) {
      if (!r.impl.length) broken.push(`${r.id} 没写实现在哪`)
      for (const f of r.impl) if (!exists(f)) broken.push(`${r.id} → ${f} 不存在`)
    }
    expect(broken, `M5-B 对账表站不住：\n${broken.join('\n')}`).toEqual([])
  })

  it('声称有测试的必须真的有测试；没测试的必须写明**为什么没有**（不许假绿）', () => {
    const bad: string[] = []
    for (const r of M5B_RULES) {
      if (!r.test.length) {
        if (!r.untested || r.untested.length < 20) bad.push(`${r.id} 没有测试，也没写清为什么`)
        continue
      }
      for (const f of r.test) {
        const n = countCases(f)
        if (n < 0) bad.push(`${r.id} → ${f} 文件不存在`)
        else if (n === 0) bad.push(`${r.id} → ${f} 0 条用例`)
      }
      /** 有测试的条目不该同时带 untested 说明 —— 那是在两头报好消息 */
      if (r.untested) bad.push(`${r.id} 既有测试又写了 untested，口径要挑一个`)
    }
    expect(bad, `M5-B 覆盖对账有假：\n${bad.join('\n')}`).toEqual([])
  })

  it('未验证的条数要**看得见**（这一节的存在意义就是别让它悄悄变少）', () => {
    const untested = M5B_RULES.filter((r) => !r.test.length)
    console.log(
      `M5-B：${M5B_RULES.length} 条，其中 ${M5B_RULES.length - untested.length} 条有自动化测试，` +
        `未验证 ${untested.map((r) => r.id).join(' ')}`
    )
    expect(untested.map((r) => r.id)).toEqual(['M5B-19b', 'M5B-20', 'M5B-21'])
  })

  it('静态检查不许比行为测试多（否则就是"扫源码字面量"冒充了真验证）', () => {
    expect(M5B_STATIC.size).toBeLessThan(M5B_RULES.length - M5B_STATIC.size)
  })
})

// ================================================================ M6：自动切集合 / 顶部横幅 / 托盘唤醒

/**
 * M6 的自定规矩（编号 `M6-xx`，结构与 M5-B 那张表一样，所以复用 `M5bRule` 这个形状）。
 *
 * 加这一节的理由同样是"没有对账表就会整块漏掉"。M6 最容易糊过去的三类：
 *  1. "有冷却"但 skip 也写时间戳（隐患 B —— 一次没切把后面 5 分钟内的真命中全吞掉）；
 *  2. "有设置项"但全仓库没人读它（`autoSwitchBehavior` 从 M1 起就是死字段，M6 才接上）；
 *  3. "有界面"但渲染层零 DOM 测试 —— 这类在下面**明写成 untested**，不假装有证据。
 *
 * 六条裁定（Q1–Q6）与两个隐患（A/B）逐条都在表里：它们全是"当时看着像、其实会错"的东西。
 */
const M6_STATIC = new Set(['M6-04', 'M6-22', 'M6-23'])

const M6_RULES: M5bRule[] = [
  {
    id: 'M6-01',
    what: 'Q1：仲裁平手**绝不硬选**，而且必须留痕（日志一行 + 横幅写出候选名单）',
    impl: ['src/shared/projectMatch.ts', 'src/main/project/autoSwitch.ts', 'src/shared/bannerState.ts'],
    test: ['tests/shared/project-match.spec.ts', 'tests/project/auto-switch.spec.ts', 'tests/shared/banner-state.spec.ts']
  },
  {
    id: 'M6-02',
    what: '⚠隐患 B：`last_auto_switch_at` **只在真的切换时写**；一次 skip 之后紧接着的真实命中仍要能切',
    impl: ['src/main/project/autoSwitch.ts'],
    test: ['tests/project/auto-switch.spec.ts']
  },
  {
    id: 'M6-03',
    what: '冷却落库不落内存（schema V6 那一列）；NULL = 从没切过，不受冷却影响',
    impl: ['src/main/db/schema.ts', 'src/main/db/repos/unity.ts'],
    test: ['tests/db/migration-v6.spec.ts', 'tests/project/auto-switch.spec.ts']
  },
  {
    id: 'M6-04',
    what: '只在"未运行 → 运行中"这条**边沿**上决策（关闭时也跑一遍 = 每 3 秒白干一次）',
    impl: ['src/main/project/api.ts'],
    test: ['tests/project/auto-switch.spec.ts']
  },
  {
    id: 'M6-05',
    what: '三档 `autoSwitchBehavior` 真的被读，而且**每轮重读**（不许启动时快照一次）',
    impl: ['src/main/project/api.ts', 'src/main/project/autoSwitch.ts'],
    test: ['tests/project/auto-switch.spec.ts']
  },
  {
    id: 'M6-06',
    what: '`never` 这一档零副作用：连盘都不读、也不去问桥接',
    impl: ['src/main/project/autoSwitch.ts'],
    test: ['tests/project/auto-switch.spec.ts']
  },
  {
    id: 'M6-07',
    what: '工程指纹四段（目录名 / Assets 顶层 / 装了哪些包 / AvatarDescriptor），**有上限并记账**',
    impl: ['src/main/project/fingerprint.ts'],
    test: ['tests/project/fingerprint.spec.ts']
  },
  {
    id: 'M6-08',
    what: 'Q5：桥接那半边**按 bridgeVersion 降级**，不许假设所有工程都装了新版；"没回"和"没有"分开记',
    impl: ['src/main/project/fingerprint.ts'],
    test: ['tests/project/fingerprint.spec.ts']
  },
  {
    id: 'M6-09',
    what: '采指纹与决策**永不抛错**（这条链挂在每 3 秒的轮询上，抛一次会污染整条工程发现）',
    impl: ['src/main/project/fingerprint.ts', 'src/main/project/autoSwitch.ts'],
    test: ['tests/project/fingerprint.spec.ts', 'tests/project/auto-switch.spec.ts']
  },
  {
    id: 'M6-10',
    what: '通用词判据：命中**全部**已知工程才算"什么都没说"（2026-10-06 活体改的，老判据让 §8-9 结构上不可能通过）',
    impl: ['src/shared/projectMatch.ts'],
    test: ['tests/shared/project-match.spec.ts']
  },
  {
    id: 'M6-11',
    what: '匹配与搜索用**同一把尺子**（`fold` + `searchForms`，罗马字/拼音/假名互通），不另写一份归一化',
    impl: ['src/shared/normalize.ts', 'src/shared/projectMatch.ts'],
    test: ['tests/shared/project-match.spec.ts']
  },
  {
    id: 'M6-12',
    what: '⚠隐患 A：补建是**第一入口**，必须排在横幅之前就能用（空库时"命中才建"是循环依赖）',
    impl: ['src/renderer/components/chrome.tsx', 'src/renderer/components/ModelBackfillDialog.tsx', 'src/renderer/stores/ui.ts'],
    test: [],
    untested:
      '渲染层零 DOM 测试（vitest 是 environment:node，没装 jsdom），侧栏那个入口画没画对测不了。' +
      '兜底证据：沙盒活体截图 docs/screenshots/m6-backfill-preview.png（空集合时它是主 CTA + 一句为什么）' +
      '+ tools/live-m6-banner-shot.cjs。判据本身在 M6-13/M6-14 有真用例。'
  },
  {
    id: 'M6-13',
    what: '补建必须**先预览、确认之后才写库**；预览那一步是只读的（一个字节都不写）',
    impl: ['src/main/library/modelCollections.ts', 'src/shared/backfillState.ts'],
    test: ['tests/library/model-backfill.spec.ts', 'tests/shared/backfill-state.spec.ts']
  },
  {
    id: 'M6-14',
    what: '`apply` 只认刚才那份预览里的名字（重新算 plan 取交集）—— 否则这条通道就是任意造数据的后门',
    impl: ['src/main/library/modelCollections.ts'],
    test: ['tests/library/model-backfill.spec.ts']
  },
  {
    id: 'M6-15',
    what: '一次补建留一条 `journal(op=collection_backfill)`，Ctrl+Z 找得到、能整批退回',
    impl: ['src/main/db/repos/journal.ts', 'src/main/library/modelCollections.ts'],
    test: ['tests/library/model-backfill.spec.ts']
  },
  {
    id: 'M6-16',
    what: '撤销**只按 payload 里那份 id 清单删**：不删用户自己建的，也不删已经挂了素材的',
    impl: ['src/main/library/undo.ts'],
    test: ['tests/library/model-backfill.spec.ts']
  },
  {
    id: 'M6-17',
    what: 'UNIVERSAL / 共通 / 汎用 这类通用值不建集合，但要在预览里留痕（不说用户会以为漏了自己的素材）',
    impl: ['src/shared/modelCollections.ts'],
    test: ['tests/shared/model-collections.spec.ts', 'tests/shared/backfill-state.spec.ts']
  },
  {
    id: 'M6-18',
    what: '显示名平票时不取全大写那种（否则名字取决于 SQL 返回顺序，同一份库两次能建出两个名）',
    impl: ['src/shared/modelCollections.ts'],
    test: ['tests/shared/model-collections.spec.ts']
  },
  {
    id: 'M6-19',
    what: 'R-52：自动切集合只换左侧选中项与过滤，**搜索框一个字都不清**；横幅还要多一句「仍在搜索…」',
    impl: ['src/renderer/stores/ui.ts', 'src/shared/bannerState.ts'],
    test: ['tests/renderer/auto-switch-store.spec.ts', 'tests/shared/banner-state.spec.ts']
  },
  {
    id: 'M6-20',
    what: 'Q3：开机自启保持 false，**只在应用内问一次**，绝不动系统启动项；措辞不把"开机自启"和"托盘常驻"混成一句',
    impl: ['src/shared/bannerState.ts', 'src/renderer/components/AutoLaunchAsk.tsx', 'src/shared/settingsDefaults.ts'],
    test: ['tests/shared/banner-state.spec.ts', 'tests/renderer/auto-switch-store.spec.ts']
  },
  {
    id: 'M6-21',
    what: 'Q4：「操作中不打断」的判据 = 有模态框 / 正在拖拽 / 导入在跑 —— **偏离规格原文**，理由写进代码注释',
    impl: ['src/renderer/stores/ui.ts', 'src/shared/bannerState.ts'],
    test: ['tests/renderer/auto-switch-store.spec.ts', 'tests/shared/banner-state.spec.ts']
  },
  {
    id: 'M6-22',
    what: 'Q6：托盘唤醒置顶 1.2 秒，**取消置顶走 finally**（漏掉就永远压在 Unity 上面）；判据必须读在 createMainWindow() **之前**（第 5 轮实测：写反了整段置顶一次都没执行过）',
    impl: ['src/main/window.ts', 'src/shared/constants.ts'],
    test: ['tests/renderer/auto-switch-store.spec.ts', 'tests/project/wake-order.spec.ts']
  },
  {
    id: 'M6-23',
    what: '沙盒活体一律带 `AVCA_APP_HOME`，路径里没有 avca/sandbox 字样就**拒绝启动**（真库红线）',
    impl: ['src/main/services/paths.ts', 'tools/live-m6-banner-shot.cjs'],
    test: ['tests/services/app-home.spec.ts']
  },
  {
    id: 'M6-24',
    what: '横幅"该不该出现、出现成什么样"全在纯函数里，组件只做薄壳映射（不引 DOM 依赖也要有回归保护）',
    impl: ['src/shared/bannerState.ts', 'src/renderer/components/ProjectBanner.tsx'],
    test: ['tests/shared/banner-state.spec.ts']
  }
]

describe('M6 自动切集合 / 顶部横幅 / 托盘唤醒：逐条对账', () => {
  it('M6 每条规矩都有实现文件，且文件真的存在', () => {
    const broken: string[] = []
    for (const r of M6_RULES) {
      if (!r.impl.length) broken.push(`${r.id} 没写实现在哪`)
      for (const f of r.impl) if (!exists(f)) broken.push(`${r.id} → ${f} 不存在`)
    }
    expect(broken, `M6 对账表站不住：\n${broken.join('\n')}`).toEqual([])
  })

  it('声称有测试的必须真的有测试；没测试的必须写明**为什么没有**（不许假绿）', () => {
    const bad: string[] = []
    for (const r of M6_RULES) {
      if (!r.test.length) {
        if (!r.untested || r.untested.length < 20) bad.push(`${r.id} 没有测试，也没写清为什么`)
        continue
      }
      for (const f of r.test) {
        const n = countCases(f)
        if (n < 0) bad.push(`${r.id} → ${f} 文件不存在`)
        else if (n === 0) bad.push(`${r.id} → ${f} 0 条用例`)
      }
      if (r.untested) bad.push(`${r.id} 既有测试又写了 untested，口径要挑一个`)
    }
    expect(bad, `M6 覆盖对账有假：\n${bad.join('\n')}`).toEqual([])
  })

  it('未验证的条数要**看得见**', () => {
    const untested = M6_RULES.filter((r) => !r.test.length)
    console.log(
      `M6：${M6_RULES.length} 条，其中 ${M6_RULES.length - untested.length} 条有自动化测试，未验证 ${
        untested.map((r) => r.id).join(' ') || '（无）'
      }`
    )
    expect(untested.map((r) => r.id)).toEqual(['M6-12'])
  })

  it('静态检查不许比行为测试多，且静态清单里的编号都还在表里', () => {
    expect(M6_STATIC.size).toBeLessThan(M6_RULES.length - M6_STATIC.size)
    const ids = M6_RULES.map((r) => r.id)
    for (const id of M6_STATIC) if (!ids.includes(id)) throw new Error(`M6 静态清单里的 ${id} 不在表里`)
  })

  it('六条裁定 + 两个隐患**每条都有落点**（少一条就是有人改了口径没回来对账）', () => {
    const ids = M6_RULES.map((r) => r.id)
    /** Q1→M6-01，Q2→M6-12/13，Q3→M6-20，Q4→M6-21，Q5→M6-08，Q6→M6-22，隐患 A→M6-12，隐患 B→M6-02 */
    for (const id of ['M6-01', 'M6-02', 'M6-08', 'M6-12', 'M6-13', 'M6-20', 'M6-21', 'M6-22']) {
      expect(ids, `${id}（Q1–Q6 / 隐患 A、B 之一）不在对账表里`).toContain(id)
    }
  })
})

// ================================================================ R4：批量导入 / 搬文件 / 口语 / 分列 / 反查 / 首次弹窗

/**
 * R4 轮的自定规矩（编号 `R4-xx`，结构同上两张表，复用 `M5bRule` 那个形状）。
 *
 * 这一轮的对账重点和 M5-B/M6 不一样：R4 的七件里有几件是**"后端早就通了，只差最后一米"**
 * （反查、队列事件、dims、installedProjects、bridgeAutoInstall），
 * 而"只差最后一米"这种东西最容易**在汇报里被写成已完成**。所以每条都要求写出
 * 实现落在哪、用例钉在哪，钉不住的**显式标 untested**（渲染层零 DOM 测试，画法一类只能靠活体）。
 *
 * 另有两条是这一轮新犯的老毛病，专门留下：
 *  - **广播是发后即忘的**（R4-29）：主进程第一轮工程发现跑在窗口就绪之前，
 *    边沿事件会掉在地上 —— ⑦ 恰恰在全新安装那一次不生效；
 *  - **"有设置项但没人读"**（R4-31）：`autoSwitchBehavior` 之后第二个死设置。
 */
const R4_STATIC = new Set(['R4-14', 'R4-17'])

const R4_RULES: M5bRule[] = [
  // ---------------------------------------------------------------- ① 进度与队列
  {
    id: 'R4-01',
    what: 'Q1：队列并发（①）排在多选批量（②）之前做，浮层只改一次',
    impl: ['src/shared/importQueue.ts', 'src/main/import/coordinator.ts', 'src/renderer/components/ImportFlow.tsx'],
    test: ['tests/shared/import-queue.spec.ts', 'tests/renderer/batch-import-store.spec.ts']
  },
  {
    id: 'R4-02',
    what: '逐条进度事件**真的发出来并被订阅**（`unity:import-progress` 从 M5-B 起一直在广播，全仓无人 on）',
    impl: ['src/main/import/coordinator.ts', 'src/renderer/stores/ui.ts'],
    test: ['tests/shared/import-queue.spec.ts', 'tests/renderer/batch-import-store.spec.ts']
  },
  {
    id: 'R4-03',
    what: '队列收尾以 `BatchOutcome` 为准：事件是直播、可以丢，台账一定完整',
    impl: ['src/shared/importQueue.ts'],
    test: ['tests/shared/import-queue.spec.ts']
  },
  {
    id: 'R4-04',
    what: '**未执行 ≠ 失败**（串行失败即停手，后面根本没发命令，说它"失败"是撒谎）',
    impl: ['src/shared/importQueue.ts', 'src/shared/memberPick.ts'],
    test: ['tests/shared/import-queue.spec.ts', 'tests/shared/member-pick.spec.ts']
  },
  {
    id: 'R4-05',
    what: '任何时刻最多一条 running，且**只有成功才把下一条顶上来**（无条件顶会让界面在没发出去的包上显示"进行中"）',
    impl: ['src/shared/importQueue.ts'],
    test: ['tests/shared/import-queue.spec.ts']
  },
  {
    id: 'R4-06',
    what: '§5.2 导入队列浮层的"多条并发展示"形态',
    impl: ['src/renderer/components/ImportFlow.tsx'],
    test: [],
    untested:
      '渲染层零 DOM 测试：判据（谁 running / 谁 not-run / tone / single）全在 R4-02…R4-05 的用例里，' +
      '但**画法**没有回归保护，改样式只能靠下次活体。沙盒活体已真点过（§8-4 进度可见）。'
  },
  // ---------------------------------------------------------------- ② 多选卡批量导入
  {
    id: 'R4-07',
    what: 'Q2：批量上限**复用** `IMPORT_BATCH_MAX = 8`，主进程与界面不许各写一个数（M5-B 为这件事专门补过用例）',
    impl: ['src/shared/constants.ts', 'src/main/import/memberImport.ts', 'src/renderer/stores/ui.ts'],
    test: ['tests/import/member-import.spec.ts', 'tests/shared/member-pick.spec.ts']
  },
  {
    id: 'R4-08',
    what: 'Q3：一批一次覆盖决定；汇总那句把"几个包 / 几个有冲突 / 几个文件会被覆盖 / 全新几个"四个数分开',
    impl: ['src/shared/memberPick.ts', 'src/main/import/memberImport.ts'],
    test: ['tests/shared/member-pick.spec.ts', 'tests/shared/import-notes.spec.ts']
  },
  {
    id: 'R4-09',
    what: '一张卡能不能直导的判据**只写一处**（`cardImportChoice`），单卡与多选共用；不替他挑成员',
    impl: ['src/shared/memberPick.ts', 'src/renderer/stores/ui.ts'],
    test: ['tests/shared/member-pick.spec.ts', 'tests/renderer/batch-import-store.spec.ts']
  },
  {
    id: 'R4-10',
    what: '结果卡标题的包数不许读**已被清空**的 plan（活体抓到"批量导入 · 0 个包"）',
    impl: ['src/renderer/stores/ui.ts'],
    test: ['tests/renderer/batch-import-store.spec.ts']
  },
  {
    id: 'R4-11',
    what: '整批倒序退回要**抢权**：连点两次「整批退回」只撤一次，第二次不许写出"删除 0 个"那种二次账',
    impl: ['src/main/import/coordinator.ts'],
    test: ['tests/import/rollback-claim.spec.ts']
  },
  // ---------------------------------------------------------------- ③ 改分类搬文件
  {
    id: 'R4-12',
    what: 'Q4：搬之前给**只读预览**（N 个文件 / 目标目录 / 会覆盖谁），确认才动盘；键盘默认项恒为取消',
    impl: ['src/main/library/rearchive.ts', 'src/shared/rearchiveDialog.ts', 'src/renderer/components/RearchiveDialog.tsx'],
    test: ['tests/shared/rearchive-dialog.spec.ts', 'tests/library/rearchive.spec.ts', 'tests/renderer/rearchive-store.spec.ts']
  },
  {
    id: 'R4-13',
    what: '子项 / 附属跟着父级一起搬，同一个 batchId 整批可撤；附属在父目录里只改路径字符串',
    impl: ['src/main/library/rearchive.ts'],
    test: ['tests/library/rearchive.spec.ts']
  },
  {
    id: 'R4-14',
    what: '改完分类**索引真的重建**（`assets:reclassify` 原来不重建，而 docs/SEARCH.md 声称会）',
    impl: ['src/main/ipc/assets.ts'],
    test: ['tests/library/rearchive.spec.ts']
  },
  {
    id: 'R4-15',
    what: 'Ctrl+Z 撤 rearchive **不许删素材记录**（`undoLast` 末尾那句清 assetIds 只对入库批次成立）',
    impl: ['src/main/library/undo.ts'],
    test: ['tests/library/rearchive.spec.ts', 'tests/library/commit-undo.spec.ts']
  },
  {
    id: 'R4-16',
    what: '路径比较一律走 `isInside` —— `normalizeForCompare()` 把分隔符统一成反斜杠，任何 startsWith(parent + 正斜杠) 恒 false',
    impl: ['src/main/library/rearchive.ts', 'src/main/security/paths.ts'],
    test: ['tests/security/paths.spec.ts', 'tests/library/rearchive.spec.ts']
  },
  // ---------------------------------------------------------------- ④ 类别口语
  {
    id: 'R4-17',
    what: 'Q5：汉字→日语读音**不引词典**（维持 SEARCH.md 的收口），并把提示做进改分类/改备注那块文案',
    impl: ['docs/SEARCH.md', 'src/renderer/i18n/zh-CN.json'],
    test: ['tests/renderer/i18n.spec.ts']
  },
  {
    id: 'R4-18',
    what: '口语走**查询侧展开**，一条都不塞进每条素材的别名（5 万实测别名 118.6 万→206.4 万、增量 0.378→0.584 ms/条）',
    impl: ['src/shared/categoryExpand.ts', 'src/main/search/index.ts'],
    test: ['tests/search/synonyms.spec.ts', 'tests/perf/scale.spec.ts']
  },
  {
    id: 'R4-19',
    what: '二级口语只映射二级标签（搜「礼服」不该把整个服装类拖出来）',
    impl: ['src/shared/categoryExpand.ts'],
    test: ['tests/search/synonyms.spec.ts']
  },
  {
    id: 'R4-20',
    what: 'fuzzy 兜底趟**不吃汉字输入的拼音**（「冰箱」→ xiang → 容错成 xing → 捞出发型卡）',
    impl: ['src/main/search/index.ts'],
    test: ['tests/search/synonyms.spec.ts']
  },
  {
    id: 'R4-21',
    what: '面板加词**不重启就生效**；单字当场拒（存进去也不会进索引 = 白加），上限与主进程 validate 同一个数',
    impl: ['src/shared/synonymEdit.ts', 'src/main/services/categories.ts', 'src/renderer/components/SynonymEditor.tsx'],
    test: ['tests/shared/synonym-edit.spec.ts', 'tests/services/category-synonyms.spec.ts']
  },
  // ---------------------------------------------------------------- ⑤ 变体分列
  {
    id: 'R4-22',
    what: 'dims 编解码 + 三条画法判据：单值维度不列 / 容器卡不重复数版本 / >3 折成 +N（不许悄悄截断）',
    impl: ['src/shared/variantDims.ts', 'src/renderer/components/AssetGrid.tsx'],
    test: ['tests/shared/variant-dims.spec.ts']
  },
  {
    id: 'R4-23',
    what: '模型名的**大小写双胞胎**要去重 —— 否则"只有一个模型才算变体"那道闸门过不去，avatar 变体整个被吞掉',
    impl: ['src/main/classify/engine.ts', 'src/main/library/regroup.ts'],
    test: ['tests/classify/grouping.spec.ts', 'tests/library/regroup.spec.ts']
  },
  {
    id: 'R4-24',
    what: '⑤ 的代价**量过并钉住**（500 卡 +13%，闸 1500ms），不是"应该不慢"',
    impl: ['src/main/db/repos/asset.ts'],
    test: ['tests/perf/cards-dims.spec.ts']
  },
  // ---------------------------------------------------------------- ⑥ 跨工程反查
  {
    id: 'R4-25',
    what: 'Q6：反查只读 `import_log`，**限制口径必须上界面**（"你在 Unity 里手动导入的查不到"，不许写成含糊的"仅供参考"）',
    impl: ['src/shared/installedWhere.ts', 'src/renderer/components/DetailPanel.tsx'],
    test: ['tests/shared/installed-where.spec.ts']
  },
  {
    id: 'R4-26',
    what: '反查取数四条：同组兄弟行一起算 / 工程被删过留 known=false 不许空名字 / 只有退回记录不算"装过"但行要留着 / 装桥接不算装过',
    impl: ['src/main/db/repos/unity.ts'],
    test: ['tests/db/installed-where.spec.ts']
  },
  // ---------------------------------------------------------------- ⑦ 首次发现工程弹桥接安装窗
  {
    id: 'R4-27',
    what: 'R-10 三按钮 `[安装] [以后都自动安装] [暂不]`，判据（六输入四出口）全在纯函数里，组件只做薄壳',
    impl: ['src/shared/bridgeAsk.ts', 'src/renderer/components/BridgeAskDialog.tsx'],
    test: ['tests/shared/bridge-ask.spec.ts']
  },
  {
    id: 'R4-28',
    what: '两个边沿都要接：第一次发现（可问 / 可装）+ 开始运行（**只装不问**）。只挂第一次发现的话，「以后都自动安装」这个答案永远不会被执行',
    impl: ['src/main/project/api.ts'],
    test: ['tests/project/bridge-ask-wiring.spec.ts', 'tests/shared/bridge-ask.spec.ts']
  },
  {
    id: 'R4-29',
    what: '`broadcast` 是**发后即忘**的，而第一轮工程发现是同步跑完的 → 边沿事件必须攒进队列、界面起来时取回；队列**取看不清空**（整页刷新不许把没答的问题吞掉）',
    impl: ['src/main/bridge/askQueue.ts', 'src/main/bridge/ipc.ts', 'src/renderer/stores/ui.ts'],
    test: ['tests/project/bridge-ask-wiring.spec.ts']
  },
  {
    id: 'R4-30',
    what: 'Q7：答案存 `setting` 键 `bridgeAsk:<projectId>`，**不为这一件事动 schema**；脏值当"没答过"、null 真删行',
    impl: ['src/main/db/repos/bridgeAsk.ts'],
    test: ['tests/db/bridge-ask.spec.ts']
  },
  {
    id: 'R4-31',
    what: '`bridgeAutoInstall` 真被主进程读到（从 M1 起是第二个死设置）—— 行为用例 + 读源码钉接线**两条都要**',
    impl: ['src/main/project/api.ts', 'src/shared/bridgeAsk.ts'],
    test: ['tests/project/bridge-ask-wiring.spec.ts', 'tests/shared/bridge-ask.spec.ts']
  },
  {
    id: 'R4-32',
    what: 'Esc / 点遮罩关掉弹窗**不算回答**（什么都不写，下次启动还会再问）；答「暂不」才写 never',
    impl: ['src/renderer/stores/ui.ts', 'src/renderer/components/BridgeAskDialog.tsx'],
    test: [],
    untested:
      '渲染层零 DOM 测试：`dismissBridgeAsk` 只清本地队列、不调 `unity:answer-bridge-ask` 这件事没有用例保护。' +
      '沙盒活体 stage 5 验过等价形状（未答就整页刷新 → 同一个工程还在问），改这块要重跑 `tools/live-r4-bridge-ask.cjs`。'
  },
  // ---------------------------------------------------------------- 真机那两条缺陷的修复
  {
    id: 'R4-33',
    what: '§8-2：只剩 WMI 一路撑着"运行中"（桥接无心跳 + 锁文件无人持有）要过宽限期即判停；宽限期常量本身单独钉',
    impl: ['src/main/project/running.ts', 'src/shared/constants.ts'],
    test: ['tests/project/wmi-only-grace.spec.ts', 'tests/project/wmi-real-output.spec.ts']
  },
  {
    id: 'R4-34',
    what: '"被覆盖的文件已备份"只在**真存下东西**时才说；撤销有资源没删掉要如实写"有 N 个没能删掉"',
    impl: ['src/shared/importNotes.ts', 'src/main/import/coordinator.ts'],
    test: ['tests/shared/import-notes.spec.ts', 'tests/import/rollback-claim.spec.ts']
  }
]

describe('R4 批量导入 / 搬文件 / 口语 / 分列 / 反查 / 首次弹窗：逐条对账', () => {
  it('R4 每条规矩都有实现文件，且文件真的存在', () => {
    const broken: string[] = []
    for (const r of R4_RULES) {
      if (!r.impl.length) broken.push(`${r.id} 没写实现在哪`)
      for (const f of r.impl) if (!exists(f)) broken.push(`${r.id} → ${f} 不存在`)
    }
    expect(broken, `R4 对账表站不住：\n${broken.join('\n')}`).toEqual([])
  })

  it('声称有测试的必须真的有测试；没测试的必须写明**为什么没有**（不许假绿）', () => {
    const bad: string[] = []
    for (const r of R4_RULES) {
      if (!r.test.length) {
        if (!r.untested || r.untested.length < 20) bad.push(`${r.id} 没有测试，也没写清为什么`)
        continue
      }
      for (const f of r.test) {
        const n = countCases(f)
        if (n < 0) bad.push(`${r.id} → ${f} 文件不存在`)
        else if (n === 0) bad.push(`${r.id} → ${f} 0 条用例`)
      }
      if (r.untested) bad.push(`${r.id} 既有测试又写了 untested，口径要挑一个`)
    }
    expect(bad, `R4 覆盖对账有假：\n${bad.join('\n')}`).toEqual([])
  })

  it('未验证的条数要**看得见**', () => {
    const untested = R4_RULES.filter((r) => !r.test.length)
    console.log(
      `R4：${R4_RULES.length} 条，其中 ${R4_RULES.length - untested.length} 条有自动化测试，未验证 ${
        untested.map((r) => r.id).join(' ') || '（无）'
      }`
    )
    /** 只有"画法"和"Esc 不算回答"两条钉不住 —— 多一条就是有人悄悄把新改动放过了 */
    expect(untested.map((r) => r.id)).toEqual(['R4-06', 'R4-32'])
  })

  it('静态检查不许比行为测试多，且静态清单里的编号都还在表里', () => {
    expect(R4_STATIC.size).toBeLessThan(R4_RULES.length - R4_STATIC.size)
    const ids = R4_RULES.map((r) => r.id)
    for (const id of R4_STATIC) if (!ids.includes(id)) throw new Error(`R4 静态清单里的 ${id} 不在表里`)
  })

  it('七条裁定 Q1–Q7 **每条都有落点**（少一条就是有人改了口径没回来对账）', () => {
    const ids = R4_RULES.map((r) => r.id)
    /** Q1→R4-01，Q2→R4-07，Q3→R4-08，Q4→R4-12，Q5→R4-17，Q6→R4-25，Q7→R4-30 */
    const span: Array<[string, string]> = [
      ['Q1', 'R4-01'],
      ['Q2', 'R4-07'],
      ['Q3', 'R4-08'],
      ['Q4', 'R4-12'],
      ['Q5', 'R4-17'],
      ['Q6', 'R4-25'],
      ['Q7', 'R4-30']
    ]
    for (const [q, id] of span) expect(ids, `${q} 的落点 ${id} 不在对账表里`).toContain(id)
  })

  it('R4 七件**每件都有一项以上**在册（防止"代码合了但对账表整块漏了"）', () => {
    const ids = R4_RULES.map((r) => r.id)
    const groups: Array<[string, string[]]> = [
      ['① 进度与队列', ['R4-01', 'R4-02', 'R4-03', 'R4-04', 'R4-05', 'R4-06']],
      ['② 多选批量', ['R4-07', 'R4-08', 'R4-09', 'R4-10', 'R4-11']],
      ['③ 改分类搬文件', ['R4-12', 'R4-13', 'R4-14', 'R4-15', 'R4-16']],
      ['④ 类别口语', ['R4-17', 'R4-18', 'R4-19', 'R4-20', 'R4-21']],
      ['⑤ 变体分列', ['R4-22', 'R4-23', 'R4-24']],
      ['⑥ 跨工程反查', ['R4-25', 'R4-26']],
      ['⑦ 首次弹桥接窗', ['R4-27', 'R4-28', 'R4-29', 'R4-30', 'R4-31', 'R4-32']]
    ]
    for (const [what, list] of groups) {
      for (const id of list) expect(ids, `${what} 的 ${id} 不在表里`).toContain(id)
    }
    expect(R4_RULES.length).toBe(34)
  })
})

/**
 * 第 7 轮（M7 首启向导）的自定规矩，编号 `M7-xx`，结构同前三张表（复用 `M5bRule` 那个形状）。
 *
 * 这一轮最值得钉的三类，全是本轮**实际犯过或实际抓到**的：
 *  1. **"自己关自己"**（M7-03）：门禁原判的是"当前库根空不空"，而第 ① 步落库根就是不空 ——
 *     用户点完「接管这个库」的同一瞬间向导消失，第 ②③④ 步永远走不到。
 *     这类只有"sticky 那半边不许掉"一条能钉，判据写在组件里就永远钉不住（零 DOM 测试）。
 *  2. **"安全的那一步退化成危险的那一步"**（M7-28、M7-32）：加密不可用时退回明文落盘比不做更坏；
 *     日志里带一次密码，等于把用户交出来的秘密抄进一个谁都读得到的文件。
 *  3. **"写好了没人接"**（M7-14、M7-23、M7-33、M7-34）：这仓库的老毛病 —— 死设置、死服务、
 *     发后即忘的广播。所以有几条专门撤调用点、撤注册、撤出队那一句。
 *
 * 钉不住的（画法、工具脚本）一律 `test: []` + 写明靠什么兜；**按裁定本轮不做的四条也留在表里**，
 * 这样"下一轮欠了什么"是一张表而不是几句口头承诺。
 */
const M7_STATIC = new Set(['M7-14', 'M7-23', 'M7-34', 'M7-37'])

const M7_RULES: M5bRule[] = [
  // ---------------------------------------------------------------- 门禁三态（Q1 / Q2 / Q8）
  {
    id: 'M7-01',
    what: 'Q1 甲：向导的三个键全在 electron-store（`onboardingDone` / `onboardingStep` / `onboardingSkippedAt`），**不为三个布尔开 SQLite 列**，schema 一行没动',
    impl: ['src/shared/settingsDefaults.ts', 'src/shared/wizardState.ts', 'src/main/services/settings.ts'],
    test: ['tests/shared/wizard-state.spec.ts', 'tests/db/migration-v6.spec.ts']
  },
  {
    id: 'M7-02',
    what: 'Q2 甲：老用户升级**不拦** —— 唯一判据是 `startedHere`（**本次启动时**库根为空），不是"当前库根空不空"',
    impl: ['src/shared/wizardState.ts', 'src/renderer/stores/ui.ts'],
    test: ['tests/shared/wizard-state.spec.ts', 'tests/renderer/wizard-wiring.spec.ts']
  },
  {
    id: 'M7-03',
    what: '⭐ `startedHere` 是 **sticky** 的：第 ① 步刚落库根、向导还没走完 → 必须继续画（活体第一次真点撞到的那条）',
    impl: ['src/renderer/stores/ui.ts', 'src/shared/wizardState.ts'],
    test: ['tests/shared/wizard-state.spec.ts', 'tests/renderer/wizard-wiring.spec.ts']
  },
  {
    id: 'M7-04',
    what: '设置还没读回来那一拍不许画向导（否则每次启动闪一下）；脏状态（`done=true` 但库根空）走主界面，**不把向导再弹一遍**',
    impl: ['src/shared/wizardState.ts', 'src/renderer/App.tsx'],
    test: ['tests/shared/wizard-state.spec.ts', 'tests/renderer/wizard-wiring.spec.ts']
  },
  {
    id: 'M7-05',
    what: '「稍后配置」**绝不写** `onboardingDone=true`：它写 `onboardingSkippedAt`。写成 done 用户就拿到一个"看着配好了、拖什么都报错"的软件',
    impl: ['src/shared/wizardState.ts'],
    test: ['tests/shared/wizard-state.spec.ts']
  },
  {
    id: 'M7-06',
    what: '拦不拦和提不提是**两件事**：跳过之后不再拦人，但库根还空着 → 侧栏那条"库还没配好"必须一直在，且点它能把 skip 痕擦掉回到向导',
    impl: ['src/renderer/components/chrome.tsx', 'src/shared/wizardState.ts'],
    test: ['tests/renderer/wizard-wiring.spec.ts', 'tests/shared/wizard-state.spec.ts']
  },
  {
    id: 'M7-07',
    what: '断点续填：`clampStep` 把脏步数（手改过 settings.json / 老版本没这个键 / NaN）收回第 ① 步，`stepPatch` 只存步数不碰 done/skip',
    impl: ['src/shared/wizardState.ts'],
    test: ['tests/shared/wizard-state.spec.ts']
  },
  {
    id: 'M7-08',
    what: 'Q8 甲：3 步 + 1 收尾，**只有第 ① 步是硬闸门**（没库根产品是坏的），第 ②③④ 步都能整步跳过',
    impl: ['src/shared/wizardState.ts', 'src/renderer/components/FirstRunWizard.tsx'],
    test: ['tests/shared/wizard-state.spec.ts']
  },
  // ---------------------------------------------------------------- 第 ① 步：库位置（Q3 / Q4 / Q5）
  {
    id: 'M7-09',
    what: 'Q3 甲：选到"已经有素材的目录"**当场二选一**；判据宁松不紧 —— 数不到（-1）也问，只有明确是空的才直接建库',
    impl: ['src/shared/wizardState.ts', 'src/main/ipc/system.ts'],
    test: ['tests/shared/wizard-state.spec.ts']
  },
  {
    id: 'M7-10',
    what: '接管那条**只登记不搬盘**，并且顺手把 `autoArchive` 关成 false（README §收编 第一条，以前只写在文档里靠人自觉）',
    impl: ['src/shared/wizardState.ts', 'src/renderer/components/FirstRunWizard.tsx'],
    test: ['tests/shared/wizard-state.spec.ts']
  },
  {
    id: 'M7-11',
    what: 'Q4 甲：库根在 C 盘 / 剩余空间低于 20 GB **只警告不拦**（没照搬抽取根那条硬错误）；空间量不到（-1）不警告',
    impl: ['src/shared/wizardState.ts'],
    test: ['tests/shared/wizard-state.spec.ts']
  },
  {
    id: 'M7-12',
    what: '目录根本不存在（刚拔掉的盘）要**拦在第 ① 步**，不许带着一个不存在的库根往下走',
    impl: ['src/shared/wizardState.ts', 'src/renderer/components/FirstRunWizard.tsx'],
    test: ['tests/shared/wizard-state.spec.ts']
  },
  {
    id: 'M7-13',
    what: '第 ① 步的"看这个目录"是**只读**探测：不建目录、不写文件、跳过 `node_modules`/`.git`、数到封顶写"500+"不谎报精确值',
    impl: ['src/main/ipc/system.ts', 'src/shared/wizardState.ts'],
    test: [],
    untested:
      '探测本体（`system:probe-directory`）没有 IPC 层用例：判据侧（-1 / 封顶怎么影响分支）由 M7-09 的用例钉，' +
      '"真的只读"靠沙盒活体 —— 点完接管之后那三个文件 md5 逐一相同（§10 第 2 条凭据）。改这块要重跑活体。'
  },
  {
    id: 'M7-14',
    what: '"没库根不许往库里写"这句口径**只有一处**（`libraryRootOrThrow()`）：摄取与归并两条写路径都走它，文案不许在调用点上重写第二遍',
    impl: ['src/main/services/settings.ts', 'src/main/ingest/api.ts', 'src/main/ipc/assets.ts'],
    test: ['tests/services/library-root-guard.spec.ts']
  },
  {
    id: 'M7-15',
    what: 'Q5 乙（**只在首启那一次**能把运行目录搬到别的盘）：本轮按 §10 只做到"如实显示位置和占用"，搬迁没做',
    impl: ['src/main/services/paths.ts', 'src/renderer/components/FirstRunWizard.tsx'],
    test: [],
    untested:
      '本轮未实现，所以没有用例。已有的只是 `resolveAppHome` 那条重定向（活体一直在用，由 M7-38 的用例钉）。' +
      '搬迁要做成"还没有任何数据的那一次"才允许，风险接近 0；**已有数据搬家一律不许出现在这两轮里**。'
  },
  // ---------------------------------------------------------------- 第 ②③ 步：来源目录与批量装桥接
  {
    id: 'M7-16',
    what: '第 ② 步加的监视目录立刻生效、可以整步跳过；`stepDone` 只认**盘上真有的东西**（跳过的步不算满足，否则装了 0 个也打勾）',
    impl: ['src/renderer/components/FirstRunWizard.tsx', 'src/main/services/watcher.ts', 'src/shared/wizardState.ts'],
    test: ['tests/shared/wizard-state.spec.ts']
  },
  {
    id: 'M7-17',
    what: 'Q9 乙：第 ③ 步一屏列出发现的工程、**默认全勾**、逐条把目标路径写出来（风险由"显式列路径"兜，不由"少勾"兜）',
    impl: ['src/renderer/components/FirstRunWizard.tsx'],
    test: [],
    untested:
      '渲染层零 DOM 测试。④ 的沙盒活体真跑过：三行都带 `2022.3.22f1`，逐条结果行写着完整目标路径（§10 那张表）。' +
      '判据（谁该被列出、装了几个算满足）在 M7-16/M7-18 的用例里；**画法**没有回归保护。'
  },
  {
    id: 'M7-18',
    what: '向导这条路**复用** `installer`，不新开一套安装：只写 `Packages/com.avca.bridge/`，`Assets/` 一字不动',
    impl: ['src/main/bridge/installer.ts', 'src/renderer/components/FirstRunWizard.tsx'],
    test: ['tests/bridge/installer.spec.ts']
  },
  {
    id: 'M7-19',
    what: 'Q10 甲：「剩下 N 个都不再问」= 其余**每条各写** `bridgeAsk:<id>="never"` 并出队，**屏幕上那条不许替用户答**（三按钮白给）',
    impl: ['src/main/bridge/askQueue.ts', 'src/main/db/repos/bridgeAsk.ts'],
    test: ['tests/bridge/ask-queue.spec.ts', 'tests/project/bridge-ask-wiring.spec.ts']
  },
  {
    id: 'M7-20',
    what: '没有"从此都不问"那种全局标志：之后新发现的工程照样进队、照样要问（一次静音不能变成永久静音）',
    impl: ['src/main/bridge/askQueue.ts', 'src/shared/bridgeAsk.ts'],
    test: ['tests/bridge/ask-queue.spec.ts']
  },
  {
    id: 'M7-21',
    what: '写失败的那条**不许悄悄出队**：用户看到报错、问题却消失了 = 假答过，比不答更坏',
    impl: ['src/main/bridge/askQueue.ts'],
    test: ['tests/bridge/ask-queue.spec.ts']
  },
  {
    id: 'M7-22',
    what: '只剩正在答的这一条时那颗按钮**不出现**（"剩下"是零，按钮是废话）；N 不含屏幕上这条',
    impl: ['src/shared/bridgeAsk.ts'],
    test: ['tests/shared/bridge-ask.spec.ts']
  },
  {
    id: 'M7-23',
    what: '⭐ **手动**装成桥接也要让那条待答出队（④ 活体撞到：装完了还在问）。三处都得接：主进程成功分支 / 「当前工程」页 / 渲染层队列',
    impl: ['src/main/bridge/ipc.ts', 'src/renderer/pages/Project.tsx', 'src/renderer/stores/ui.ts'],
    test: ['tests/project/bridge-ask-wiring.spec.ts']
  },
  // ---------------------------------------------------------------- 第 ④ 步：收尾（Q6 / Q8）
  {
    id: 'M7-24',
    what: '常驻托盘那一问从**运行期模态**挪进向导收尾：答"是"答"否"都算答过，之后不再骚扰；`autoLaunch` 默认仍是 false（M6 Q3 那条结论不改）',
    impl: ['src/shared/wizardState.ts', 'src/renderer/components/AutoLaunchAsk.tsx', 'src/shared/settingsDefaults.ts'],
    test: ['tests/shared/wizard-state.spec.ts']
  },
  {
    id: 'M7-25',
    what: 'Q6 甲：唤醒保持"**置顶 1.2 秒、不动焦点**"（第 5 轮实测：置顶真生效、前台 0/127）。时长用常量，一处能改',
    impl: ['src/main/window.ts', 'src/shared/constants.ts'],
    test: ['tests/project/wake-order.spec.ts']
  },
  {
    id: 'M7-26',
    what: '第 ④ 步摘要的 `touchesDisk` **只有"装了桥接"那条为真**（接管不算动盘 —— 卡片上刚写完"一个文件都不搬"）；热键界面显示 `Ctrl+Alt+A`，注册用的契约串仍是 `CommandOrControl`',
    impl: ['src/shared/wizardState.ts', 'src/renderer/components/FirstRunWizard.tsx'],
    test: ['tests/shared/wizard-state.spec.ts']
  },
  {
    id: 'M7-27',
    what: '向导顶栏可拖，且步骤圆点给窗口控制键让位（`pr-[140px]`）—— 这条是我**看自己截图**发现的：圆点压在关闭键底下',
    impl: ['src/renderer/components/FirstRunWizard.tsx'],
    test: [],
    untested:
      '纯画法，零 DOM 测试钉不住。凭据是 `docs/screenshots/m7-step1-ask.png` / `m7-setup-entry.png` 重拍后的样子。' +
      '改窗口布局那一类只能下次活体看，动过就要重拍截图。'
  },
  // ---------------------------------------------------------------- 密码（Q7 甲）
  {
    id: 'M7-28',
    what: '⭐ `safeStorage` 不可用 → **库里一行都不写**，返回 `unavailable`。绝不退回明文落盘（那比不做更坏）',
    impl: ['src/main/services/secrets.ts'],
    test: ['tests/services/secrets.spec.ts']
  },
  {
    id: 'M7-29',
    what: '保管键 = 文件名 + 大小 + 头 64KB 摘要（改名不影响，内容或大小变了就是另一个键）；文件读不到返回 null，**不抛**',
    impl: ['src/main/services/secrets.ts'],
    test: ['tests/services/secrets.spec.ts']
  },
  {
    id: 'M7-30',
    what: '同一个包再存一次是**覆盖**不是插两条；`INSERT` 的参数次序必须和列次序一致（第一版错位，`item_id` 存成了路径，被自己的用例抓到）',
    impl: ['src/main/db/repos/passwordVault.ts', 'src/main/db/schema.ts'],
    test: ['tests/services/secrets.spec.ts', 'tests/db/schema.spec.ts']
  },
  {
    id: 'M7-31',
    what: '列表**不含明文也不含密文**，只说能不能解开；解不开（换机器 / 换了 Windows 用户）那行**留着**并标 `readable:false`，不偷偷删',
    impl: ['src/main/services/secrets.ts', 'src/renderer/components/PasswordVaultPanel.tsx'],
    test: ['tests/services/secrets.spec.ts']
  },
  {
    id: 'M7-32',
    what: '⭐ 密码本身**绝不进日志、绝不进 IPC 返回值**（只报"存了几十字节密文"）',
    impl: ['src/main/services/secrets.ts', 'src/main/ipc/secrets.ts'],
    test: ['tests/services/secrets-wiring.spec.ts']
  },
  {
    id: 'M7-33',
    what: '⭐ 摄取链真的会**用**记住的密码（不然是又一个死服务）：`vaultTried` 保证一个作业只试一次，不在重试循环里反复解密',
    impl: ['src/main/ingest/api.ts', 'src/main/services/secrets.ts'],
    test: ['tests/services/secrets-wiring.spec.ts']
  },
  {
    id: 'M7-34',
    what: 'IPC 常量 / handler / 注册 / preload / 界面**五段一段不能少**（少一段就是"写好了没人接"）',
    impl: ['src/shared/ipc.ts', 'src/main/ipc/secrets.ts', 'src/main/index.ts', 'src/preload/index.ts', 'src/renderer/pages/Inbox.tsx'],
    test: ['tests/services/secrets-wiring.spec.ts']
  },
  {
    id: 'M7-35',
    what: '密码框那个「记住这个密码」**默认不勾**；按 `vault` 三态分别提示，`unavailable` 要明说"密码没有被保存"',
    impl: ['src/renderer/pages/Inbox.tsx'],
    test: [],
    untested:
      '渲染层零 DOM 测试。三态的**来源**（stored / unavailable / failed）由 M7-28、M7-33 的用例钉，' +
      '这里没钉住的是"默认不勾"和三种提示各说各的话 —— 靠 ⑥ 的沙盒活体看。'
  },
  {
    id: 'M7-36',
    what: 'Q7 乙（`-p` 传密码会泄露在命令行里）**本轮不做**，单独立一件：先在这台机器上试出 7z 支持的免命令行传法（未验证）',
    impl: ['src/main/unpack/sevenZip.ts'],
    test: [],
    untested:
      '本轮未实现，没有用例。按 §8 裁定乙"单独立一件更干净"。现状是密码走命令行，这条泄露风险在 README 的已知限制里；' +
      '做之前要先实测 7-Zip 的 stdin / @file 传法，别拿推断当验证。'
  },
  // ---------------------------------------------------------------- 三语与活体安全
  {
    id: 'M7-37',
    what: '三语齐全：新增 `wizard` 命名空间 **56 条 × 3**，key 数一致、不许谁多一条少一条；**动态拼 key 一律禁**（`t` 前缀扫描不剥注释，注释里也别写）',
    impl: ['src/renderer/i18n/zh-CN.json', 'src/renderer/i18n/en.json', 'src/renderer/i18n/ja.json'],
    test: ['tests/renderer/i18n.spec.ts']
  },
  {
    id: 'M7-38',
    what: '⭐ 活体一律 `AVCA_APP_HOME` + `LOCALAPPDATA` **双重定向**；`tools/dev.cjs` 加了硬护栏（带调试端口而 APP_HOME 不含 `avca`/`sandbox` 就 exit 2）；沙盒夹具的根目录名不含 `avca`/`m7` 拒绝执行',
    impl: ['tools/dev.cjs', 'src/main/services/paths.ts', 'tools/make-m7-live-tree.cjs'],
    test: ['tests/services/app-home.spec.ts']
  },
  // ---------------------------------------------------------------- ⑧ 真机跑过但没有自动化 / 第 8 轮之后的
  {
    id: 'M7-39',
    what: '⭐ 真加密 7z（`-mhe`）走"记住 → 杀进程重启 → 不再问密码"，**⑧ 已在打包版真跑过**（还加了一条反证：删掉那行必须重新问）',
    impl: ['src/main/ingest/api.ts', 'src/main/services/secrets.ts', 'tools/live-m7-packaged.cjs'],
    test: [],
    untested:
      '没有自动化，凭据是 ⑧ 的活体（`tools/live-m7-packaged.cjs --stage=password`，22 条判据全绿）：' +
      '包先自证"对密码过 / 错密码失败 / 不带密码连文件名都列不出来"，之后库里恰好一行（48 字节密文，platform=win-dpapi）、' +
      '日志不含明文、重启后同一包不再问、删掉那行又问了。单测（M7-28…M7-33）钉的是判据，这一条钉的是**跨进程的那次真跑**。'
  },
  {
    id: 'M7-40',
    what: '打包版首启六条（§6.2）**⑧ 全部在 `dist\\win-unpacked\\Atrium.exe` 上跑过**：四场 91 条判据 0 红',
    impl: ['tools/live-m7-packaged.cjs', 'tools/make-m7-live-tree.cjs', 'src/renderer/components/FirstRunWizard.tsx'],
    test: [],
    untested:
      '第 2、3 轮的老账就在这条上：dev 全绿不等于打包版能用（ABI、worker 依赖、asar 路径、i18n 走 extraResources 都不一样）。' +
      '⑧ 用 `tools/live-m7-packaged.cjs`（launch / password / skip / asks 四场）真点过，驱动起实例前硬查 asar 比源码新、' +
      '沙盒路径名含 avca/m7、真 Unity 没开着（进程 + `Temp/UnityLockFile` 两道）。截图在 `docs/screenshots/m7-pkg-*.png`。' +
      '**Setup.exe 覆盖安装**仍然没走过 —— 那是第 8 轮。'
  },
  {
    id: 'M7-41',
    what: 'Q11 甲（#74）：结果卡列出"本轮 N 批"、每批一个退回按钮 —— **本轮不做**，缺的只是入口，`batch_id` 一批一条的账目形状不动',
    impl: ['src/renderer/components/ImportFlow.tsx', 'src/shared/importQueue.ts'],
    test: [],
    untested:
      '本轮未实现。队列与台账的判据本身有测试（R4-03、R4-11 那两条），欠的是"每批都能撤"这个入口。' +
      '按 §8 裁定排在向导之后单独做，别塞进第 8 轮的发布收尾。'
  },
  {
    id: 'M7-42',
    what: 'Q12 乙（#75）：桥接 C# 那两条欠账（撤销留空目录的 `.meta` + `bridgeVersion` 1.1.0）—— **排在第 8 轮之后单独一轮**',
    impl: ['resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs'],
    test: [],
    untested:
      '本轮未改 C#。它要改两处代码 + 重装 8 个真工程的桥接，和"首启体验"是两件事；' +
      '混做会让向导的活体验收多出 8 个真工程这个变量（§8 裁定乙的理由）。'
  }
]

describe('M7 首启向导 / 库根闸门 / 批量装桥接 / 密码保管：逐条对账', () => {
  it('M7 每条规矩都有实现文件，且文件真的存在', () => {
    const broken: string[] = []
    for (const r of M7_RULES) {
      if (!r.impl.length) broken.push(`${r.id} 没写实现在哪`)
      for (const f of r.impl) if (!exists(f)) broken.push(`${r.id} → ${f} 不存在`)
    }
    expect(broken, `M7 对账表站不住：\n${broken.join('\n')}`).toEqual([])
  })

  it('声称有测试的必须真的有测试；没测试的必须写明**为什么没有**（不许假绿）', () => {
    const bad: string[] = []
    for (const r of M7_RULES) {
      if (!r.test.length) {
        if (!r.untested || r.untested.length < 20) bad.push(`${r.id} 没有测试，也没写清为什么`)
        continue
      }
      for (const f of r.test) {
        const n = countCases(f)
        if (n < 0) bad.push(`${r.id} → ${f} 文件不存在`)
        else if (n === 0) bad.push(`${r.id} → ${f} 0 条用例`)
      }
      if (r.untested) bad.push(`${r.id} 既有测试又写了 untested，口径要挑一个`)
    }
    expect(bad, `M7 覆盖对账有假：\n${bad.join('\n')}`).toEqual([])
  })

  /**
   * 本轮的判据层是新建的（`wizardState.ts`），最容易出的事不是"写错"而是"写了一段没人测的分支"。
   * 这条把"导出的每个函数都被用例点过名"变成硬要求 —— 上一轮死设置、死服务吃过的亏。
   */
  it('判据层**每个导出函数都被用例调用过**（写了没人测 = 第二个死设置）', () => {
    const src = fs.readFileSync(path.join(REPO, 'src/shared/wizardState.ts'), 'utf8')
    const names = Array.from(src.matchAll(/export function (\w+)/g)).map((m) => m[1])
    const joined = ['tests/shared/wizard-state.spec.ts', 'tests/renderer/wizard-wiring.spec.ts', 'tests/services/library-root-guard.spec.ts']
      .map((f) => fs.readFileSync(path.join(REPO, f), 'utf8'))
      .join('\n')
    const untested = names.filter((n) => !joined.includes(n))
    expect(names.length, '判据函数一个都不许是类型别名，必须是函数').toBeGreaterThan(10)
    expect(untested, `这些判据没有任何用例调用过：${untested.join(', ')}`).toEqual([])
  })

  it('未验证的条数要**看得见**，而且**是谁**要念出来', () => {
    const untested = M7_RULES.filter((r) => !r.test.length)
    console.log(
      `M7：${M7_RULES.length} 条，其中 ${M7_RULES.length - untested.length} 条有自动化测试，未验证 ${untested.length} 条：${
        untested.map((r) => r.id).join(' ') || '（无）'
      }`
    )
    /**
     * 这十条是这一轮的**全部**欠账，分三堆：
     *  - 画法/工具钉不住（零 DOM 测试）：M7-13、M7-17、M7-27、M7-35
     *  - 按裁定本轮不做：M7-15、M7-36、M7-41、M7-42
     *  - 等 ⑧ 真机：M7-39、M7-40
     * 多一条就是有人悄悄把新改动放过了，少一条就是有人把欠的划掉了没还。
     */
    expect(untested.map((r) => r.id)).toEqual([
      'M7-13',
      'M7-15',
      'M7-17',
      'M7-27',
      'M7-35',
      'M7-36',
      'M7-39',
      'M7-40',
      'M7-41',
      'M7-42'
    ])
  })

  it('静态检查不许比行为测试多，且静态清单里的编号都还在表里', () => {
    expect(M7_STATIC.size).toBeLessThan(M7_RULES.length - M7_STATIC.size)
    const ids = M7_RULES.map((r) => r.id)
    for (const id of M7_STATIC) if (!ids.includes(id)) throw new Error(`M7 静态清单里的 ${id} 不在表里`)
  })

  it('十二条裁定 Q1–Q12 **每条都有落点**（含那四条"本轮不做"的，也要在册）', () => {
    const ids = M7_RULES.map((r) => r.id)
    /** Q1→01，Q2→02，Q3→09，Q4→11，Q5→15（未做），Q6→25，Q7→28（乙那半在 36），Q8→08，Q9→17，Q10→19，Q11→41（未做），Q12→42（未做） */
    const span: Array<[string, string]> = [
      ['Q1', 'M7-01'],
      ['Q2', 'M7-02'],
      ['Q3', 'M7-09'],
      ['Q4', 'M7-11'],
      ['Q5', 'M7-15'],
      ['Q6', 'M7-25'],
      ['Q7', 'M7-28'],
      ['Q7乙', 'M7-36'],
      ['Q8', 'M7-08'],
      ['Q9', 'M7-17'],
      ['Q10', 'M7-19'],
      ['Q11', 'M7-41'],
      ['Q12', 'M7-42']
    ]
    for (const [q, id] of span) expect(ids, `${q} 的落点 ${id} 不在对账表里`).toContain(id)
  })

  it('四步 + 密码 + 安全**每块都有一项以上**在册（防止"代码合了但对账表整块漏了"）', () => {
    const ids = M7_RULES.map((r) => r.id)
    const groups: Array<[string, string[]]> = [
      ['门禁三态', ['M7-01', 'M7-02', 'M7-03', 'M7-04', 'M7-05', 'M7-06', 'M7-07', 'M7-08']],
      ['第①步 库位置', ['M7-09', 'M7-10', 'M7-11', 'M7-12', 'M7-13', 'M7-14', 'M7-15']],
      ['第②③步 来源与桥接', ['M7-16', 'M7-17', 'M7-18', 'M7-19', 'M7-20', 'M7-21', 'M7-22', 'M7-23']],
      ['第④步 收尾', ['M7-24', 'M7-25', 'M7-26', 'M7-27']],
      ['密码保管', ['M7-28', 'M7-29', 'M7-30', 'M7-31', 'M7-32', 'M7-33', 'M7-34', 'M7-35', 'M7-36']],
      ['三语与活体安全', ['M7-37', 'M7-38']],
      ['欠到 ⑧ 之后', ['M7-39', 'M7-40', 'M7-41', 'M7-42']]
    ]
    for (const [what, list] of groups) {
      for (const id of list) expect(ids, `${what} 的 ${id} 不在表里`).toContain(id)
    }
    expect(M7_RULES.length).toBe(42)
  })

  /** 规格 §1 里那几条跨份硬约束，向导这条路必须**复用**而不是另起一套 */
  it('向导没有绕开 §1 的硬约束（回收站 / 路径校验 / 不联网 / 桥接只装 Packages）', () => {
    const ids = ['R-91', 'R-92', 'R-93', 'R-94']
    for (const id of ids) {
      const r = RULES.find((x) => x.id === id)
      expect(r, `${id} 不在 §1 表里了？`).toBeDefined()
      expect(r?.outOfScope, `${id} 被标成了范围外 —— 向导不许把硬约束划出范围`).toBeFalsy()
    }
  })
})
