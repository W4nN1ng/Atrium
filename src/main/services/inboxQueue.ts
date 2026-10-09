import fs from 'node:fs'
import path from 'node:path'

/**
 * 收件箱（摄取队列）的持久化。
 *
 * ## 为什么需要它
 *
 * `startIngest()` 里的 `jobs` 是一个**内存态 Map**，进程一退全丢。于是在真机上会出现这种事：
 * 拖进 20 个包、指纹跑完 12 个正等你确认分类，这时重启程序 —— 那 12 张卡**凭空消失**，
 * 得重新拖一遍。用户裁定过这件事：「收件箱是内存态 —— 待确认项重启程序就没了。
 * `asset.status` 字段本来就支持 `pending_confirm`，应该落库」。
 *
 * ## 为什么持久化"源路径"而不是"worker 结果"
 *
 * 这里刻意**不**存 `WorkerResult`（哈希 / 分类结果 / 条目清单）。理由三条：
 *
 *  1. **worker 结果是纯函数产物**：`(sourcePath, 设置, 词典, 已学规则) → WorkerResult`。
 *     磁盘上那份文件没动过，所以启动后重跑一遍得到的是同一份结果（确定性）。
 *  2. **staging 目录本来就不跨重启**。`pruneStaging()` 在启动时会把整个 `staging/` 清空
 *     （它的注释写着「只对内存里正在跑的任务有意义」）。所以 `res.stagingPath` 存了也没用，
 *     解压产物必须重做。
 *  3. **改动最小**：不新增表、不动 schema、不碰真库。`WorkerResult` 里带着整包条目清单，
 *     序列化它既大又脆，而"重新入队"这条路**白捡**了"用户点重试"已有的全部正确性。
 *
 * 同理**不存密码**：重启之后靠的是「记住这个密码」那条路（第 7 轮 ⑥ 的 `password_vault`，
 * 由 `api.ts` 在撞见要密码时自己去试），而不是把密码塞进这个清单文件里。
 * ⚠ 这一条以前写的是"`api.ts` 里压根没有 password_vault 的调用"—— 那是 ⑥ 之前的事实，
 * 注释留着不改就是撒谎，所以改成了现在这样（**代码注释里的断言也算断言**）。
 *
 * ## 文件格式
 *
 * ```json
 * { "version": 1, "items": [{ "path": "E:\\vrc\\A\\x.zip", "at": 1759700000000 }] }
 * ```
 *
 * 写入走 `tmp + rename`（和第 3 份 §2.3 的文件信箱同一个理由：别让进程被杀时留下半截 JSON）。
 */

export const INBOX_QUEUE_VERSION = 1
/** 上限保护：写坏一次也别让这个文件无限长 */
export const INBOX_QUEUE_MAX = 500

export interface InboxQueueItem {
  /** Windows 归一化后的绝对路径 */
  path: string
  /** 入队时间（ms） */
  at: number
}

interface File {
  version: number
  items: InboxQueueItem[]
}

/** 路径归一化：Windows 大小写不敏感，比较前必须统一，否则同一个文件会进两条 */
export function normalizeQueuePath(p: string): string {
  const norm = p.trim().replace(/\//g, '\\').replace(/\\+/g, '\\').replace(/\\$/, '')
  return norm.toLowerCase()
}

function emptyFile(): File {
  return { version: INBOX_QUEUE_VERSION, items: [] }
}

/** 只读。文件不存在 / 读坏 / 版本不对 → 当作空队列，绝不抛（读取失败不该挡住程序启动） */
export function readInboxQueue(file: string): InboxQueueItem[] {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as Partial<File>
    if (!parsed || parsed.version !== INBOX_QUEUE_VERSION || !Array.isArray(parsed.items)) return []
    const out: InboxQueueItem[] = []
    const seen = new Set<string>()
    for (const it of parsed.items) {
      if (!it || typeof it.path !== 'string' || !it.path.trim()) continue
      const key = normalizeQueuePath(it.path)
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ path: it.path, at: typeof it.at === 'number' && it.at > 0 ? it.at : 0 })
    }
    return out.slice(0, INBOX_QUEUE_MAX)
  } catch {
    return []
  }
}

/** 原子写入：先写 `.tmp` 再 rename。目录不存在就建 */
export function writeInboxQueue(file: string, items: InboxQueueItem[]): void {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const payload: File = { version: INBOX_QUEUE_VERSION, items: items.slice(0, INBOX_QUEUE_MAX) }
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

/**
 * 加入一条（幂等：同一条路径已存在就只更新时间戳，不重复追加）。
 * 满了就丢**最旧**的：用户最近拖进来的更值得保住。
 */
export function addToInboxQueue(file: string, sourcePath: string, at = Date.now()): InboxQueueItem[] {
  const key = normalizeQueuePath(sourcePath)
  if (!key) return readInboxQueue(file)
  const items = readInboxQueue(file).filter((it) => normalizeQueuePath(it.path) !== key)
  items.push({ path: sourcePath, at })
  /** 超限丢最旧：按 at 升序排，保留尾部 */
  const trimmed = items.length > INBOX_QUEUE_MAX
    ? items.sort((a, b) => a.at - b.at).slice(items.length - INBOX_QUEUE_MAX)
    : items
  writeInboxQueue(file, trimmed)
  return trimmed
}

/** 移除一条（任务进入终态、或用户丢弃卡片时调用）。返回移除后的剩余项 */
export function removeFromInboxQueue(file: string, sourcePath: string): InboxQueueItem[] {
  const key = normalizeQueuePath(sourcePath)
  const items = readInboxQueue(file).filter((it) => normalizeQueuePath(it.path) !== key)
  writeInboxQueue(file, items)
  return items
}

/** 清空（用户在维护页手动清，或恢复流程里发现全都不存在了） */
export function clearInboxQueue(file: string): void {
  writeInboxQueue(file, [])
}

/** 路径是否曾经属于收件箱（用于判断"这个任务是不是恢复回来的"） */
export function isInInboxQueue(file: string, sourcePath: string): boolean {
  const key = normalizeQueuePath(sourcePath)
  return readInboxQueue(file).some((it) => normalizeQueuePath(it.path) === key)
}

/** 只读体检：给"启动恢复"报告用 */
export function describeInboxQueue(file: string): { total: number; missing: number; paths: string[] } {
  const items = readInboxQueue(file)
  let missing = 0
  for (const it of items) {
    try {
      if (!fs.statSync(it.path)) missing++
    } catch {
      missing++
    }
  }
  return { total: items.length, missing, paths: items.map((it) => it.path) }
}

export { emptyFile }
