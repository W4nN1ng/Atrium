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
import { cleanDisplayName, pickMeaningfulName } from '../../shared/naming'
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
  /** 从主体名字里剥出来的版本号（`Kiss Sound Gimmick 1.0` → `1.0`） */
  version: string | null
}

/**
 * @param res        worker 结果
 * @param fallbacks  取名兜底候选，按优先级往后排：主体所在目录名、容器目录名、原名。
 *                   主体文件名由这里自己从清单里取，调用方不用管。
 */
export function containerInfoOf(res: Pick<WorkerResult, 'looseFiles' | 'entries'>, fallbacks: Array<string | null | undefined>): ContainerInfo {
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

  const name = pickMeaningfulName([primaryBase, split.primaryRoot, ...fallbacks])
  const version = name && primaryBase ? cleanDisplayName(primaryBase).version : null
  return { split, attachments, name, version }
}
