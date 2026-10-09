import type { ContainerNotes, FoundPackage, PlanView } from './types'

/**
 * 成员选择的**纯逻辑**（M5-B ⑥）。
 *
 * 为什么单独放在 shared：界面那层（`components/MemberPicker.tsx`）没有 DOM 测试环境
 * （本仓库 `vitest` 是 `environment:'node'`，没装 jsdom），所以"哪些该默认勾上、
 * 一批几个、撞上限了要说什么"这些**会替用户做决定**的判断必须写成能单测的纯函数，
 * 而不是散在 JSX 里 —— 散在 JSX 里就等于没测。
 *
 * 三条口径：
 *  1. **唯一允许的猜测是"名字匹配"**，而且必须把依据摊在行上（设计 §3.4）。
 *     不勾"体积最大的"、不勾"最新的"、不勾"名字最短的" —— 那些是程序替用户猜。
 *  2. 一个都没命中就**谁都不勾**，界面上写"A 不替你选，请勾"。
 *  3. 分批上限由主进程那条链兜（`IMPORT_BATCH_MAX`），这里只负责**怎么切**。
 */

/** 预勾的依据。`matched` 是命中它的那个词，界面原样显示 */
export interface PickReason {
  /** i18n key（三语都得有） */
  reasonKey: 'pickByProject' | 'pickByCollection'
  matched: string
}

/**
 * 分批上限（**默认值**）。
 *
 * ⚠ 真正的闸门在主进程那条链上（`src/main/import/memberImport.ts` 的 `IMPORT_BATCH_MAX`）——
 * 界面这边只负责"按几个一批切开给用户看"，两边都得用同一个数，所以常量放 shared。
 * 而**运行时权威值取自主进程返回的 `PlanView.batchMax`**：万一以后改了，界面跟着返回的走，
 * 不各自记一份（同一个数字写两遍一定会漂 —— 这仓库为这件事付过三次学费）。
 */
export const IMPORT_BATCH_MAX = 8

/** 工程名里哪些词**不算**指纹。'Main2' / '2022.3' / 'Pro' 这种谁都带，勾上去等于全选 */
const PROJECT_STOPWORDS = new Set([
  'main',
  'pro',
  'proj',
  'project',
  'test',
  'new',
  'final',
  'v2',
  'v3',
  'x64',
  'win64',
  'assets',
  'unity'
])

/**
 * 工程名 → 指纹词。
 *
 * `shinano-Main2` → `['shinano']`；`Milfy-Main` → `['milfy']`。
 * 只留 **≥3 个字符、去掉尾部数字之后仍然 ≥3、且不是停用词** 的片段。
 *
 * 为什么这么挑：真库里模型名（shinano / milfy / grimoire…）就是靠工程名区分的，
 * 而 'Main2' 这种每个工程都有，用它当词等于"看到什么勾什么"。
 *
 * ⚠ 这里**不许**再顺手剥 'ion' / 'test' 之类的词尾：'Orion' 会被剥成 'or' 而整个信号消失。
 *   曾经就这么写过，表现是"某些工程永远预勾不上，界面上还写着 A 不替你选"。
 */
export function projectFingerprintTokens(projectName: string | null | undefined): string[] {
  const raw = (projectName ?? '').toLowerCase()
  if (!raw) return []
  const out: string[] = []
  for (const p of raw.split(/[^a-z0-9]+/).filter(Boolean)) {
    if (/^\d+$/.test(p)) continue
    const noDigits = p.replace(/\d+$/, '')
    if (noDigits.length < 3) continue
    if (PROJECT_STOPWORDS.has(noDigits) || PROJECT_STOPWORDS.has(p)) continue
    if (!out.includes(noDigits)) out.push(noDigits)
  }
  return out
}

/** 集合规则里的关键词 + 集合名本身，都算"用户在忙这批东西"的信号 */
export function collectionTokens(collectionName: string | null | undefined, keywords: string[] | null | undefined): string[] {
  const out: string[] = []
  for (const k of keywords ?? []) {
    const t = String(k ?? '').trim().toLowerCase()
    if (t.length >= 2 && !out.includes(t)) out.push(t)
  }
  const n = (collectionName ?? '').trim().toLowerCase()
  if (n.length >= 2 && !out.includes(n)) out.push(n)
  return out
}

/** 匹配只看名字这一段：剥掉目录与前缀标签，避免"路径里有个 s 就命中" */
function nameOf(relPath: string): string {
  const base = relPath.split('/').pop() ?? relPath
  return base.replace(/\.unitypackage$/i, '').toLowerCase()
}

/**
 * 这个词命中了成员名吗？**要求是一个完整的词段**，不是子串。
 *
 * 允许的形状只有两种：
 *  - 整段相等：`shinano` ↔ `Shinano_Morph`（下划线、空格、连字符、点都是段边界）
 *  - 整段后面只跟**数字/版本**：`shinano` ↔ `shinano2`、`shinano_v2`
 * 不算命中的是"子串"：`av` 不许命中 `avatar`、`pack` 不许命中 `package` ——
 * 界面写着"因为 shinano 才勾上"却勾进来一堆不相干的东西，比不替他选更糟
 * （他还得一个个取消）。这条真踩过：早期版本写的就是 `startsWith`，
 * 'vrc' 一个词就把 87 个包全勾上了。
 *
 * 中文段没法再切词，所以整段**包含**就算（'雾雨' 命中 '雾雨改'）。
 */
function tokenHits(token: string, relPath: string): boolean {
  const name = nameOf(relPath)
  if (!token || !name) return false
  const parts = name.split(/[^a-z0-9\u4e00-\u9fff]+/).filter(Boolean)
  const cjkOnly = !/[^\u4e00-\u9fff]/.test(token)
  return parts.some((p) => {
    if (cjkOnly) return p.includes(token)
    if (p === token) return true
    if (!p.startsWith(token)) return false
    const rest = p.slice(token.length)
    /** 尾巴上只剩数字和点才认（'2' / '.v3'），还有字母就说明是另一个词 */
    return /^[\d.]+$/.test(rest)
  })
}

/** 预勾结果。`tooBroad` 是"故意什么都不勾"那个分支 */
export interface PreselectResult {
  reasons: Record<string, PickReason>
  /**
   * 命中面太宽 —— 这个词把大半容器都勾上了，说明它根本不是"用户在忙什么"的信号，
   * 只是"这些东西都是 VRChat 的"。这时候勾上一片等于让用户一个个取消，比不勾更糟，
   * 所以整批不勾、并把原因显示出来。
   *
   * 真会踩到：工程名叫 `vrc-main`，而库里 87 个包的名字个个带 vrc。
   */
  tooBroad: { matched: string; hits: number; total: number } | null
}

/**
 * 给每个成员算预勾依据。
 *
 * 判"太宽"的两条线（任一命中就一个都不勾）：
 *  - 命中数**超过一批的上限**（8 个）：那已经不是帮他选，是替他灌；
 *  - 命中数**占总数一半以上**（且总数 ≥4）：说明这个词没有区分度。
 *
 * 设计 §3.4 的原话是"一个都没命中 → 谁都不勾"。这条是它的对称面：
 * "全都命中"和"全都不命中"对用户是同一件事 —— 他都得自己勾，那就别假装替他选。
 */
export function preselectMembers(
  members: Array<{ relPath: string }>,
  tokens: Array<{ token: string; reasonKey: PickReason['reasonKey'] }>,
  opts: { batchMax?: number; maxShare?: number } = {}
): PreselectResult {
  const batchMax = opts.batchMax ?? 8
  const maxShare = opts.maxShare ?? 0.5
  const reasons: Record<string, PickReason> = {}
  for (const m of members) {
    for (const { token, reasonKey } of tokens) {
      if (tokenHits(token, m.relPath)) {
        reasons[m.relPath] = { reasonKey, matched: token }
        break
      }
    }
  }
  const hits = Object.keys(reasons).length
  const total = members.length
  if (!hits || !total) return { reasons: {}, tooBroad: null }
  if (hits > batchMax || (total >= 4 && hits / total >= maxShare)) {
    /** 说得出"为什么我不替你选"：拿命中最多的那个词 */
    const tally = new Map<string, number>()
    for (const r of Object.values(reasons)) tally.set(r.matched, (tally.get(r.matched) ?? 0) + 1)
    const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]
    return { reasons: {}, tooBroad: { matched: top ? top[0] : '', hits, total } }
  }
  return { reasons, tooBroad: null }
}

/**
 * 分批：主进程一批最多 `max` 个（`IMPORT_BATCH_MAX`），界面按这个数切，
 * 一批跑完问一句要不要继续（设计 §3.4）。
 *
 * ⚠ 顺序**保持用户勾的顺序**，不重排 —— 重排会让"我以为先导的是第一个"落空。
 */
/**
 * 按上限切批。
 *
 * R4 ② 起它不只切"一个容器里的成员路径"，也切"跨卡的导入条目"，
 * 所以改成泛型 —— 但**只有一个实现**：界面切的批数必须和链路拒的批数是同一把尺子，
 * 两边各写一个 8 就是"界面切 8、链路拒 9"那种错乱（M5-B 为这件事专门留了用例）。
 */
export function batchesOf<T>(list: T[], max: number): T[][] {
  const size = Math.max(1, Math.floor(max))
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/**
 * 一张卡该直接导、还是要用户先选成员。**单选导入与多选批量导入共用这一条判据**。
 *
 * 为什么必须收成一处：这条规则以前只写在 `stores/ui.ts` 的 `importAsset` 里
 * （"多个成员的容器**不替用户挑**"）。多选批量如果再抄一遍，两边一定会漂 ——
 * 漂的结果是"双击一张卡让我选成员，框选同样的卡却偷偷导了第一个包"，
 * 而后者是拿用户工程当试验田。
 *
 * 判据（与 `importAsset` 原样等价，别"顺手改严"）：
 *  - `empty` 这张卡没有可导入的包；
 *  - `needs-choice` 有**要抽出来才有路径**的成员，且这张卡不止那一个候选
 *    （好几个成员、或者"一个成员 + 一个直导包"混着 —— 两种都是真有两件事要选）；
 *  - `single` 只有一个候选 → 直接导，`indexes[0]` 就是它。
 */
export function cardImportChoice(packages: Array<{ path: string | null }>): {
  kind: 'empty' | 'single' | 'needs-choice'
  /** `single` 时是那个候选的下标；其余为空数组 */
  indexes: number[]
} {
  if (!packages.length) return { kind: 'empty', indexes: [] }
  const needExtract = packages.map((p, i) => (p.path === null ? i : -1)).filter((i) => i >= 0)
  if (needExtract.length && packages.length > 1) return { kind: 'needs-choice', indexes: [] }
  if (needExtract.length === 1) return { kind: 'single', indexes: [needExtract[0]] }
  return { kind: 'single', indexes: [0] }
}

/** [只勾 < N MB 的] 那个快捷动作。阈值由界面给，不在这里写死第二套 */
export function underSize(packages: FoundPackage[], maxBytes: number): string[] {
  return packages.filter((p) => p.sizeBytes > 0 && p.sizeBytes <= maxBytes).map((p) => p.relPath)
}

/**
 * 合计体积。
 *
 * `sizeBytes` 为 0 的那些（清单读不出来）不计入，但**不能当 0 骗用户"总共才 0 B"** ——
 * 所以 `unknown` 单独报出去，界面上写"合计 X MB（还有 N 个不知道多大）"。
 */
export function totalBytesOf(packages: FoundPackage[]): { bytes: number; unknown: number } {
  let bytes = 0
  let unknown = 0
  for (const p of packages) {
    if (p.sizeBytes > 0) bytes += p.sizeBytes
    else unknown++
  }
  return { bytes, unknown }
}

/**
 * 这份清单**没列全**的实话，按优先级取一条给界面。
 * 设计 §3.3：撞上限必须明说，不许静默少列。
 *
 * ⚠ key 一律用 `library.` 命名空间：i18n 守卫（`tests/renderer/i18n.spec.ts`）
 * 是按命名空间白名单扫源码里的字面量的，新造一个 `import.` 前缀它扫不到，
 * 于是"缺翻译"不会红，界面上直接显示 `import.noteCappedCount` 这种鬼东西。
 */
export function capNoteKeys(notes: ContainerNotes | null): string[] {
  if (!notes) return []
  const out: string[] = []
  if (notes.needsPassword) out.push('library.noteNeedsPassword')
  if (notes.cappedCount > 0) out.push('library.noteCappedCount')
  if (notes.cappedDepth > 0) out.push('library.noteCappedDepth')
  if (notes.blocked.some((b) => b.key === 'nestedArchive')) out.push('library.noteNestedArchive')
  if (notes.blocked.some((b) => b.key === 'listFailed')) out.push('library.noteListFailed')
  return out
}

/** 汇总卡片顶部那行数：几个包有冲突、共几个文件会被覆盖、全新几个 */
export function planSummary(plan: PlanView): { packages: number; withConflicts: number; conflictEntries: number; fresh: number } {
  return {
    packages: plan.items.length,
    withConflicts: plan.conflictPackages,
    conflictEntries: plan.conflictEntries,
    fresh: plan.items.reduce((a, i) => a + i.fresh, 0)
  }
}

/**
 * 结果那行字要说的三件事：**成功几条 / 失败几条 / 没执行几条**。
 * 没执行的那些压根没碰过工程，把它们算进"失败"是撒谎（设计 §7-R2）。
 */
export function outcomeCounts(o: { imported: number; failed: number; notRun: number; blocked: unknown[]; cleanupFailed: number }): string {
  const bits = [`ok:${o.imported}`, `bad:${o.failed}`, `skip:${o.notRun}`]
  if (o.blocked.length) bits.push(`blocked:${o.blocked.length}`)
  if (o.cleanupFailed) bits.push(`dirty:${o.cleanupFailed}`)
  return bits.join(' ')
}
