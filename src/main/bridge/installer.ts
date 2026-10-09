import fs from 'node:fs'
import path from 'node:path'
import log from 'electron-log'
import type { Db } from '../db'
import { appendJournal } from '../db/repos/journal'
import { isBridgeInstalled } from './mailbox'

/**
 * 桥接的安装与卸载（第 3 份 §1）。
 *
 * ## 为什么必须装到 `Packages/` 而不是 `Assets/`（§1.2，不得更改）
 *
 * 原文理由：**VRChat 上传 Avatar 时只处理 `Assets/`**，所以放在 `Packages/` 里的嵌入式
 * UPM 包**绝不会**混进用户的 Avatar 被一起传上去。放 `Assets/` 会污染资源树 ——
 * 这是个"看起来能用、上传时才发现"的问题。
 *
 * ## 安全约束（01§F4，硬性）
 *
 *  - **永不永久删除**：卸载走回收站（`shell.trashItem`），注入 `trashFn` 以便测试
 *  - **所有文件系统操作写 journal**：安装记 `bridge_install`（R-11），
 *    卸载记 `bridge_uninstall`，都带目标路径，供回滚/审计
 *
 * ## 为什么安装时不做"耗时扫描"
 *
 * 装完就结束了。Unity 在后台**不会自动编译**（§1.3 安装 5），所以这里只负责把文件放对，
 * 是否要提示用户切回 Unity 由调用方决定 —— 桥接自身会靠 `[InitializeOnLoad]`
 * 在重编译后自动接上。
 */

/** 桥接包在工程里的目标目录名（`Packages/com.avca.bridge`） */
export const BRIDGE_PACKAGE_NAME = 'com.avca.bridge'

/** 模板里必须有这些文件，否则装过去也是个坏包 */
const REQUIRED_TEMPLATE_FILES = ['package.json', 'Editor/AVCABridge.cs', 'Editor/AVCA.Bridge.asmdef']

export interface BridgeTemplateCheck {
  ok: boolean
  root: string
  missing: string[]
}

/**
 * 检查桥接模板是否齐全。
 *
 * 打包后模板在 `process.resourcesPath/unity-bridge/com.avca.bridge`，
 * dev 时在 `resources/unity-bridge/com.avca.bridge`（`bridgeTemplateRoot()` 已经处理）。
 * **模板缺失时不能假装装成功** —— 那会让用户点了一堆"安装"却什么都没装上。
 */
export function checkBridgeTemplate(root: string): BridgeTemplateCheck {
  const missing = REQUIRED_TEMPLATE_FILES.filter((rel) => !fs.existsSync(path.join(root, ...rel.split('/'))))
  return { ok: missing.length === 0, root, missing }
}

export interface BridgeInstallResult {
  ok: boolean
  projectPath: string
  target: string
  /** 复制过去的文件数 */
  copied: number
  /** 这次之前就已经装着了 */
  alreadyInstalled: boolean
  error: string | null
  /** 模板缺失时列出缺哪些，界面要能指出来 */
  missingTemplateFiles: string[]
}

/**
 * 把一个工程里的桥接目录列出来（用于"从所有工程卸载"与体检）。
 * 只 `stat`，不读内容。
 */
export function installedProjects(projectPaths: string[]): string[] {
  return projectPaths.filter((p) => isBridgeInstalled(p))
}

function bridgeTargetDir(projectPath: string): string {
  return path.join(projectPath, 'Packages', BRIDGE_PACKAGE_NAME)
}

/** 递归复制整个模板目录。返回复制了几个文件 */
function copyTree(from: string, to: string): number {
  fs.mkdirSync(to, { recursive: true })
  let n = 0
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, e.name)
    const dst = path.join(to, e.name)
    if (e.isDirectory()) {
      n += copyTree(src, dst)
      continue
    }
    fs.copyFileSync(src, dst)
    n++
  }
  return n
}

/**
 * 安装桥接到一个工程。
 *
 * **调用方负责"首次安装要弹窗"**（R-10：三按钮 `[安装] [以后都自动安装] [暂不]`）——
 * 这里只做动作，不弹窗。这样自动安装（`bridgeAutoInstall`）与手动安装走的是同一条路。
 *
 * 已装过时**不重复复制**（返回 `alreadyInstalled: true`）：重复复制会把用户可能
 * 自己改过的桥接覆盖回去，而且没必要。
 */
export function installBridge(
  db: Db,
  projectPath: string,
  templateRoot: string,
  opts: { force?: boolean } = {}
): BridgeInstallResult {
  const target = bridgeTargetDir(projectPath)
  const base: BridgeInstallResult = {
    ok: false,
    projectPath,
    target,
    copied: 0,
    alreadyInstalled: false,
    error: null,
    missingTemplateFiles: []
  }

  const tpl = checkBridgeTemplate(templateRoot)
  if (!tpl.ok) {
    return {
      ...base,
      missingTemplateFiles: tpl.missing,
      error: '桥接模板不完整，缺：' + tpl.missing.join('、')
    }
  }

  if (!opts.force && isBridgeInstalled(projectPath)) {
    return { ...base, ok: true, alreadyInstalled: true }
  }

  try {
    fs.mkdirSync(path.join(projectPath, 'Packages'), { recursive: true })
    const copied = copyTree(templateRoot, target)
    if (!isBridgeInstalled(projectPath)) {
      return { ...base, copied, error: '复制完了但目标里没有 package.json，安装没成功' }
    }
    /** R-11：写 journal（op = bridge_install），记录目标路径供卸载/回滚 */
    appendJournal(db, {
      op: 'bridge_install',
      to: target,
      label: `安装桥接 → ${path.basename(projectPath)}/Packages/${BRIDGE_PACKAGE_NAME}`
    })
    log.info(`[bridge] 已安装到 ${target}（${copied} 个文件）`)
    return { ...base, ok: true, copied }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    /**
     * Unity 开着且正好在编译/刷新时，`Packages/` 下的文件可能被占用。
     * 这里给一句人能看懂的话，而不是把 EBUSY 原样甩给用户。
     */
    const hint = /EBUSY|EPERM|EACCES/i.test(msg)
      ? '（Unity 可能正开着并占用这个目录 —— 关掉 Unity 或等它编译完再试）'
      : ''
    return { ...base, error: '安装失败：' + msg + hint }
  }
}

export interface BridgeUninstallResult {
  ok: boolean
  projectPath: string
  target: string
  /** 目标本来就不存在 */
  notInstalled: boolean
  error: string | null
}

/**
 * 从某个工程卸载桥接。**走回收站，不永久删除**（§1.3 卸载 / R-13）。
 *
 * ⚠ 卸载前**不**检查 Unity 是否开着：`Packages/` 下的文件被 Unity 占用时，
 * `trashItem` 自己会失败并返回错误，那时如实报给用户即可。
 * 主动去"先关 Unity"会引入一个额外的状态判断，而它并不比直接尝试更可靠。
 */
export async function uninstallBridge(
  db: Db,
  projectPath: string,
  trashFn: (p: string) => Promise<void>
): Promise<BridgeUninstallResult> {
  const target = bridgeTargetDir(projectPath)
  const base: BridgeUninstallResult = { ok: false, projectPath, target, notInstalled: false, error: null }

  if (!fs.existsSync(target)) {
    return { ...base, ok: true, notInstalled: true }
  }
  try {
    await trashFn(target)
    appendJournal(db, {
      op: 'bridge_uninstall',
      from: target,
      label: `卸载桥接 ← ${path.basename(projectPath)}/Packages/${BRIDGE_PACKAGE_NAME}（已送回收站）`
    })
    log.info(`[bridge] 已卸载 ${target}（送回收站）`)
    return { ...base, ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const hint = /EBUSY|EPERM|EACCES/i.test(msg)
      ? '（Unity 可能正开着并占用这个目录 —— 先关掉 Unity 再试）'
      : ''
    return { ...base, error: '卸载失败：' + msg + hint }
  }
}

export interface UninstallAllResult {
  ok: boolean
  uninstalled: string[]
  failed: Array<{ projectPath: string; error: string }>
  /** 没有装着桥接的工程数 */
  skipped: number
}

/**
 * 「从所有工程卸载桥接」（R-15）。
 *
 * 一个失败不影响其余的：用户的诉求是"把这些都清掉"，
 * 某个工程因为 Unity 开着失败时，其他工程照样该被清掉，
 * 最后把失败清单一起报回去。
 */
export async function uninstallBridgeFromAll(
  db: Db,
  projectPaths: string[],
  trashFn: (p: string) => Promise<void>
): Promise<UninstallAllResult> {
  const uninstalled: string[] = []
  const failed: Array<{ projectPath: string; error: string }> = []
  let skipped = 0
  for (const p of projectPaths) {
    const r = await uninstallBridge(db, p, trashFn)
    if (r.ok && r.notInstalled) skipped++
    else if (r.ok) uninstalled.push(p)
    else failed.push({ projectPath: p, error: r.error ?? '未知错误' })
  }
  return { ok: failed.length === 0, uninstalled, failed, skipped }
}
