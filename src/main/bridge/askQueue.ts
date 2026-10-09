/**
 * R4 ⑦ · 主进程里"还没送到界面"的桥接决定队列。
 *
 * ## 为什么必须有它（这不是过度设计，是真会丢事件）
 *
 * `registrar.broadcast` 是**发后即忘**的（`ipc/util.ts:33`：只对当时的
 * `BrowserWindow.getAllWindows()` 调 `webContents.send`）。而工程发现这条链
 * **在主进程注册模块时就跑起来了**（`project/api.ts` 末尾那个 `void refresh()`），
 * 里面 `register(manifest.projects, 'vcc')` 是**同步**的盘扫 + 落库 ——
 * 全新安装时"第一次发现这些工程"这个边沿，早在窗口和渲染层监听器装好之前就亮了。
 *
 * 于是没有队列的话：⑦ 恰恰在**它唯一存在的场景**（第一次装 A、一批新工程被发现）下不生效。
 * 所以主进程把结论攒下来，界面起来时自己取走。
 *
 * ## 口径
 *  - 按 `projectId` 去重（同一工程只留最新一条）。
 *  - **`quiet` 不入队**（`maybeAskAboutBridge` 那边已经拦掉了）。
 *  - **取看不清空**：队列的语义是"还没有着落的问题"。渲染层重载（Ctrl+R、崩溃恢复、
 *    甚至只是 dev 里改了被 import 的 json 触发整页刷新）之后还得能再问一遍 ——
 *    上一版写成"取走即清"，实测就在活体里踩过：改 i18n 文案 → 页面刷新 →
 *    第二个工程的弹窗**直接没了**，而"第一次发现"的边沿早就消耗掉了，等于永远不再问。
 *    真正的出队时机只有两个：用户**答了**（`unity:answer-bridge-ask`），
 *    或自动装**装成了**（`unity:bridge-ask-done`）。
 */
import type { BridgeFirstSeenEvent } from '../../shared/types'

const pending = new Map<string, BridgeFirstSeenEvent>()

export function pushBridgeAsk(event: BridgeFirstSeenEvent): void {
  pending.set(event.projectId, event)
}

/** 界面起来时看一眼队里还有什么没着落（**不清空**，出队只在"答了/装成了"时发生） */
export function pendingBridgeAsks(): BridgeFirstSeenEvent[] {
  return Array.from(pending.values())
}

/** 用户答过了 / 自动装过了 → 从队列里摘掉，免得渲染层重载时又拿同一条出来弹一遍 */
export function dropBridgeAsk(projectId: string): void {
  pending.delete(projectId)
}

/**
 * M7 Q10 · 「剩下这些都不再问」：把队列里除 `exceptProjectId`（屏幕上正在答的那条）之外
 * 每一条都交给 `write`（调用方写 `never`）并出队，返回处理了哪几个 id。
 *
 * 为什么抽到这里而不是写在 IPC handler 里：这个仓库的规矩是**判据与副作用次序要能单测**
 * （handler 在闭包里拿不到，测它就得把整个桥接注册起来）。
 * `write` 由调用方给，所以这里**不 import 数据库仓储**，也就没法偷偷写别的东西 ——
 * 尤其写不进"全局静音"那种标志。
 */
export function silenceRestBridgeAsks(exceptProjectId: string, write: (projectId: string) => void): string[] {
  const rest = Array.from(pending.keys()).filter((id) => id !== exceptProjectId)
  for (const id of rest) {
    write(id)
    pending.delete(id)
  }
  return rest
}

export function __resetBridgeAsk(): void {
  pending.clear()
}
