/**
 * 把 worker 交回来的清单翻译成「主体 + 附属资源 + 该叫什么名字」。
 *
 * 单独抽一个模块是因为这三件事必须**同一份清单算一次**：
 * splitContainer 判出的主体既决定附属资源怎么分（主体内部的图不算附属），
 * 又决定 §A3 的取名优先级（主体文件名 → 主体所在目录 → 容器名 → 原名兜底）。
 * 分开算就会出现"名字用了 A 的主体、附属挂到了 B 上"这种对不上的状态。
 *
 * 纯函数，不碰 fs —— worker 的清单可能是目录遍历来的（反斜杠），
 * 也可能是压缩包内层读来的（正斜杠），splitContainer 两种都认。
 */
import type { FileEntry } from '../../shared/types'
import type { WorkerResult } from './worker'
import { splitContainer, type ContainerSplit } from '../fingerprint/primary'
import { cleanDisplayName, nameIsGarbage, pickMeaningfulName } from '../../shared/naming'
import type { AttachmentInput } from '../library/commit'

/** worker 两种清单（解压后的散文件 / 包内条目）统一成 FileEntry[] */
export function entriesOfResult(res: Pick<WorkerResult, 'looseFiles' | 'entries'>): FileEntry[] {
  if (res.looseFiles?.length) {
    return res.looseFiles.map((f) => ({ relPath: f.relPath, size: f.size, ext: f.ext, isDir: f.isDir }))
  }
  return (res.entries ?? []).map((e) => ({
    relPath: e.path,
    size: e.size,
    ext: (e.path.match(/(\.[A-Za-z0-9]+)$/) ?? ['', ''])[1].toLowerCase(),
    isDir: !!e.isDir
  }))
}

export interface ContainerInfo {
  split: ContainerSplit
  attachments: AttachmentInput[]
  /** §A3 取名优先级算出来的名字；一个候选都不合格时为 null（调用方回退到原来的名字） */
  name: string | null
  /**
   * 第 10 轮 D：被主名**压下去**的那个候选（主名用磁盘名时，它就是包内主体名，反之亦然）。
   * 不许丢 —— 调用方要把它塞进 tags，否则 `修女` 改成主名之后，
   * 以后按卖家叫法 `Holy Spice Kaguya` 就搜不到了。
   */
  altName: string | null
  /** 从主体名字里剥出来的版本号（`Kiss Sound Gimmick 1.0` → `1.0`） */
  version: string | null
}

/**
 * @param res          worker 结果
 * @param fallbacks    取名兜底候选，按优先级往后排：主体所在目录名、容器目录名、原名。
 *                     主体文件名由这里自己从清单里取，调用方不用管。
 * @param droppedName  **他拖进来的那个文件/目录名**（第 10 轮 D）。它不垃圾时就是主名 ——
 *                     用户是按这个名字在资源管理器里找东西的，包内那个卖家起的英文名顶掉它，
 *                     界面上就成了「我拖的是『修女』，怎么出来一张 Holy Spice Kaguya」。
 */
export function containerInfoOf(
  res: Pick<WorkerResult, 'looseFiles' | 'entries'>,
  fallbacks: Array<string | null | undefined>,
  droppedName?: string | null
): ContainerInfo {
  const split = splitContainer(entriesOfResult(res))

  /**
   * **没有主体时不生成附属行**（§A5）。
   * 全是图片/文档的容器整体就是 1 个「参考资料」素材 —— 那些图是它本身，不是它的附属；
   * 给它们各建一行子记录，等于把"1 张卡"又变回"N 张卡"，只是藏到了下一层。
   * 只有 1 个文件且是图片的那种更是如此：那行子记录会和主体指向同一个文件。
   */
  const attachments: AttachmentInput[] = split.primary
    ? split.attachments.map((a) => ({ relPath: a.relPath, kind: a.kind, sizeBytes: a.size }))
    : []

  /** §A3 ①：主体的文件名（去扩展名）。unitypackage 优先，因为它才是"这件东西叫什么" */
  const primaryBase = ((): string | null => {
    const list = split.primary ?? []
    if (!list.length) return null
    const pick =
      list.find((e) => /\.unitypackage$/i.test(e.relPath)) ??
      list.reduce((a, b) => (a.relPath.split(/[\\/]/).length <= b.relPath.split(/[\\/]/).length ? a : b))
    const base = pick.relPath.split(/[\\/]/).filter(Boolean).pop() ?? null
    return base ? base.replace(/\.[A-Za-z0-9]+$/, '') : null
  })()

  /**
   * 第 10 轮 D：**他拖进来的那个名字优先**。
   *
   * 老写法是 `pickMeaningfulName([primaryBase, split.primaryRoot, ...fallbacks])` ——
   * 包内主体名无条件排第一，于是 `修女/` 变成一张叫 `Holy Spice Kaguya` 的卡、
   * `4533350巧克力/` 变成 `Valentines Choco`（真库里三行全这样，2026-10-10 只读查出来的）。
   * 现在只在磁盘名**垃圾**（UUID / 长 hex / 还挂着扩展名 / 纯数字 / 太短）时才让主体名赢 ——
   * 那正是 §A3 当初要治的病（拿 `d6b99874-… base resized.jpg` 当素材名），不能修过头放回来。
   */
  const dropped = (droppedName ?? '').trim()
  const droppedClean = dropped ? cleanDisplayName(dropped).name || dropped : ''
  const droppedWins = !!droppedClean && !nameIsGarbage(droppedClean)
  const fromInside = pickMeaningfulName([primaryBase, split.primaryRoot])
  const name = droppedWins ? droppedClean : fromInside ?? pickMeaningfulName(fallbacks)
  /** 被压下去的那一个：谁当主名，另一个就得留档（调用方塞进 tags，搜得到才算没丢） */
  const altName = name && fromInside && fromInside !== name ? fromInside : null
  const version = name && primaryBase ? cleanDisplayName(primaryBase).version : null
  return { split, attachments, name, altName, version }
}
