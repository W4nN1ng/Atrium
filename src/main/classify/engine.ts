/**
 * 分类引擎（第 2 份 §5.3 六步）
 *
 *   Step1 硬规则命中 → 直接给一级，confidence 0.95，二级仍走词典
 *   Step2 词典加权打分：baseWeight × positionWeight × (1+ln(1+hits)) × learningWeight
 *   Step3 冲突：top2 ≥ top1×0.8 判歧义 → confidence×0.6，reason 里写清"同时匹配 X 和 Y"
 *   Step4 归一化：top1/(top1+top2+ε)
 *   Step5 分档：≥0.75 自动归档 / 0.40~0.75 归档但标黄 / <0.40 进待确认
 *   Step6 标签：目标模型 / 主题 / 风格
 *
 * 规格里 classify 的签名是 classify(ingest)，但词典和分类表必须在运行时可换
 * （用户能改），所以这里显式收一个 deps —— 不藏全局，worker 里也好传参。
 */
import type {
  AssetUnit,
  BundleItemResult,
  CategoryConfig,
  ClassificationResult,
  ContentType,
  IngestResult,
  ReasonPart
} from '../../shared/types'
import { buildCorpus, type Corpus, type CorpusToken } from '../fingerprint/corpus'
import { applyHardRules } from '../fingerprint/hardRules'
import { deriveGroupKey } from './groupKey'
import type { LexEntry, Lexicon } from './lexicon'
import { isBasketOnlyName, planBundle } from './bundle'
import { cleanDisplayName } from '../../shared/naming'

export interface LearningRow {
  token: string
  category: string
  subcategory: string | null
  weight: number
  hits: number
}

export interface ClassifyDeps {
  lex: Lexicon
  categories: CategoryConfig
  /** learning 表按 token 建好索引传进来，别让引擎每次查库 */
  learning?: Map<string, LearningRow[]>
  /** 递归深度保护（合集拆完还要给子项分类） */
  depth?: number
  confidenceConfirm?: number
  confidenceAuto?: number
}

interface Candidate {
  cat: string
  sub: string | null
  score: number
  /** 贡献了这个分的词，reason 要用 */
  evidence: Array<{ term: string; entry: LexEntry | null; token: CorpusToken; fromLearning: boolean }>
}

const EPS = 1e-6
/** 歧义判定阈值（§5.3 Step 3） */
const AMBIGUITY_RATIO = 0.8
const AMBIGUITY_PENALTY = 0.6
/** 自动归档线 / 标黄线（§5.3 Step 5） */
export const TH_AUTO = 0.75
export const TH_CONFIRM = 0.4

/** 二级分类 → 主题标签（§5.3 Step 6 的映射表） */
const SUB_TOPIC_TAG: Record<string, string> = {
  action: '动作',
  expression: '表情',
  closet: '换装',
  physics: '物理',
  optimizer: '优化',
  camera: '相机',
  interactive: '交互',
  menu_ui: 'UI',
  sound: '音效',
  tracker: '追踪',
  upload: '上传',
  editor: '编辑器',
  network: '网络同步',
  framework: '依赖框架',
  other: ''
}

function subLabel(cfg: CategoryConfig, cat: string, sub: string | null): string | null {
  if (!sub) return null
  const c = cfg.categories.find((x) => x.key === cat)
  const s = c?.subcategories.find((x) => x.key === sub)
  return s?.label['zh-CN'] ?? sub
}

export function isValidCategory(cfg: CategoryConfig, cat: string, sub: string | null): boolean {
  const c = cfg.categories.find((x) => x.key === cat)
  if (!c) return false
  if (sub === null) return true
  return c.subcategories.some((s) => s.key === sub)
}

/**
 * 硬规则认出"这是有形资产"（FBX / prefab / 模型）时，材质·着色器·贴图这类
 * **附带产物**的分类不该赢过它。
 *
 * 真件实测：束縛チャイナFULLSET 里有一张 matcap 贴图，引擎就把整包判成
 * 材质/MatCap —— 但里面是 FBX + 十几个 avatar 的 prefab，明明是服装。
 * 一个模型包必然带贴图和 .mat，这是结构性的，不是这条素材的特征。
 */
const PHYSICAL_CATS = new Set(['model', 'clothing', 'hair', 'accessory', 'prop', 'world'])
const INCIDENTAL_CATS = new Set(['material', 'shader', 'texture', 'reference'])

function applyContentTypePrior(candidates: Candidate[], contentType: ContentType): Candidate[] {
  if (contentType !== 'model' && contentType !== 'unity_project') return candidates
  return candidates.map((c) => {
    let w = 1
    if (PHYSICAL_CATS.has(c.cat)) w = 1.5
    else if (INCIDENTAL_CATS.has(c.cat)) w = 0.5
    return { ...c, score: c.score * w }
  })
}

/** 语料 → 候选分类打分（Step 2） */
function scoreCorpus(corpus: Corpus, deps: ClassifyDeps): Candidate[] {
  const map = new Map<string, Candidate>()
  const keyOf = (cat: string, sub: string | null): string => cat + '|' + (sub ?? '')

  for (const token of corpus.tokens) {
    const hits = 0 // learning 表另算，这里先按词典基础分
    const entry = deps.lex.lookup(token.term)
    if (entry && entry.cat) {
      const boost = 1 + Math.log(1 + hits)
      const add = (cat: string, sub: string | null, weight: number, fromLearning: boolean, e: LexEntry | null): void => {
        if (!isValidCategory(deps.categories, cat, sub)) return
        const k = keyOf(cat, sub)
        const cur = map.get(k) ?? { cat, sub, score: 0, evidence: [] }
        cur.score += weight
        cur.evidence.push({ term: token.term, entry: e, token, fromLearning })
        map.set(k, cur)
      }
      add(entry.cat, entry.sub, entry.w * token.weight * boost, false, entry)
    }

    // 用户学过的规则：同 token 指到别的分类，按 learningWeight 加进来
    const learned = deps.learning?.get(token.term)
    if (learned?.length) {
      for (const row of learned) {
        const w = row.weight * token.weight * (1 + Math.log(1 + row.hits))
        const k = keyOf(row.category, row.subcategory)
        if (!isValidCategory(deps.categories, row.category, row.subcategory)) continue
        const cur = map.get(k) ?? { cat: row.category, sub: row.subcategory, score: 0, evidence: [] }
        cur.score += w
        cur.evidence.push({ term: token.term, entry: null, token, fromLearning: true })
        map.set(k, cur)
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => b.score - a.score)
}

/** 按一级分类汇总（歧义判定必须在一级层面做，见下） */
interface CatScore {
  cat: string
  score: number
  /** 一级内部，二级各自的分 */
  subs: Map<string | null, number>
  evidence: Candidate['evidence']
}

function byCategory(candidates: Candidate[]): CatScore[] {
  const map = new Map<string, CatScore>()
  for (const c of candidates) {
    const cur: CatScore = map.get(c.cat) ?? { cat: c.cat, score: 0, subs: new Map(), evidence: [] as Candidate['evidence'] }
    cur.score += c.score
    cur.subs.set(c.sub, (cur.subs.get(c.sub) ?? 0) + c.score)
    cur.evidence.push(...c.evidence)
    map.set(c.cat, cur)
  }
  return Array.from(map.values()).sort((a, b) => b.score - a.score)
}

/**
 * 一级内部挑二级：只认"真的投了某个二级"的分。
 *
 * 目录名 '插件' 这种只给一级不给二级，它的分进 subs[null] —— 不能拿它去当二级答案，
 * 否则永远选成"无二级"（实测 LightController 就是这么丢掉二级的）。
 */
function pickSub(cur: CatScore | undefined): string | null {
  if (!cur) return null
  let best: { sub: string | null; score: number } | null = null
  for (const [sub, score] of cur.subs) {
    if (sub === null) continue
    if (!best || score > best.score) best = { sub, score }
  }
  return best?.sub ?? null
}
/**
 * 模型名去重要**忽略大小写**。
 *
 * 沙盒活体实测踩到的：散装目录 `Grimoir_SHINANO_V1.0` 的语料里同时有 `SHINANO`（名字里的大写）
 * 和 `shinano`（路径/词典回查时的小写），旧的 `includes` 区分大小写，于是 targetAvatars 变成
 * `['SHINANO', 'Shinano']` 两条 —— 而 commit 里写 avatar 变体的闸门是 `avatars.length === 1`
 * （一条素材只有一个模型才算变体），两条直接把它挡掉了：variant 表一条 avatar 都不写，
 * 聚合视图的「适配模型」分列（R4 ⑤）对这类素材永远出不来，还顺手多挂一个大小写双胞胎标签。
 * 同一个模型只是写法不同，不能算两个。
 */
function pushAvatar(list: string[], name: string, where: 'push' | 'unshift' = 'push'): void {
  if (list.some((x) => x.toLowerCase() === name.toLowerCase())) return
  if (where === 'unshift') list.unshift(name)
  else list.push(name)
}

/** Step 6：目标模型 / 主题 / 风格标签 */
function buildTags(corpus: Corpus, deps: ClassifyDeps, cat: string, sub: string | null): { avatars: string[]; tags: string[] } {
  const avatars: string[] = []
  const tags: string[] = []
  for (const token of corpus.tokens) {
    const e = deps.lex.lookup(token.term)
    if (!e) continue
    if (e.dim === 'avatar') {
      const name = token.term.replace(/^\w/, (c) => c.toUpperCase())
      pushAvatar(avatars, name)
    } else if (e.dim === 'style') {
      /**
       * 只把风格词当标签。generic（assets / data / template / 素材 …）不能进标签：
       * 每个 unitypackage 的路径都以 Assets/ 开头，于是每张卡都挂上一个 'assets' 垃圾标签
       * （打包版实测落库就是这个样）。
       */
      if (!tags.includes(token.term) && token.term.length > 1) tags.push(token.term)
    }
  }
  const topic = SUB_TOPIC_TAG[sub ?? '']
  if (topic && !tags.includes(topic)) tags.unshift(topic)
  const subName = subLabel(deps.categories, cat, sub)
  if (subName && subName !== topic && !tags.includes(subName)) tags.push(subName)
  return { avatars, tags }
}

function reasonPartsFor(
  hard: ReturnType<typeof applyHardRules>,
  top: Candidate | undefined,
  second: Candidate | undefined,
  ambiguous: boolean,
  deps: ClassifyDeps,
  ingest: IngestResult
): { parts: ReasonPart[]; text: string } {
  const parts: ReasonPart[] = []
  const bits: string[] = []
  if (hard.rule) {
    parts.push({ key: 'classify.reason.hardRule', params: { rule: hard.rule } })
    bits.push(hard.rule)
  }
  if (top) {
    const words = top.evidence.slice(0, 4).map((e) => e.term)
    parts.push({
      key: 'classify.reason.matched',
      params: { words: words.join('、'), cat: top.cat, sub: subLabel(deps.categories, top.cat, top.sub) ?? '-' }
    })
    bits.push(`命中 ${words.join('/')} → ${top.cat}${top.sub ? '/' + top.sub : ''}`)
    if (top.evidence.some((e) => e.fromLearning)) {
      parts.push({ key: 'classify.reason.usedLearning' })
      bits.push('含你修正过的规则')
    }
  }
  if (ambiguous && second) {
    parts.push({
      key: 'classify.reason.ambiguous',
      params: { a: top?.cat ?? '-', b: second.cat }
    })
    bits.push(`同时匹配 ${top?.cat} 和 ${second.cat}`)
  }
  if (!parts.length) {
    parts.push({ key: 'classify.reason.noSignal', params: { name: cleanDisplayName(ingest.rawName).name || ingest.rawName } })
    bits.push('没有任何可靠线索')
  }
  return { parts, text: bits.join('；') }
}

/** 单个 IngestResult → 一个单元（不做拆分时用） */
function classifyOne(ingest: IngestResult, deps: ClassifyDeps): AssetUnit {
  const corpus = buildCorpus({
    dirChain: ingest.sourceDirChain,
    fileName: ingest.rawName,
    entryPaths: ingest.entries.slice(0, 4000).map((e) => e.relPath),
    readmeText: ingest.metadata.readmeText
  })
  const hard = applyHardRules(ingest.entries, ingest.rawName)
  // 先按内容类型压一道：模型包里的贴图/材质是附带产物，不该反过来定性
  let candidates = applyContentTypePrior(scoreCorpus(corpus, deps), hard.contentType)

  // Step 1：硬规则命中就锁一级，二级只在该一级里挑（§5.3 原话）
  if (hard.category) {
    const sameCat = candidates.filter((c) => c.cat === hard.category)
    if (sameCat.length) candidates = sameCat
    else if (isValidCategory(deps.categories, hard.category, null)) {
      candidates = [{ cat: hard.category, sub: null, score: 1, evidence: [] }, ...candidates]
    }
  }

  /**
   * Step 3 / Step 4 都在"一级"层面比。
   * 之前拿 cat|sub 粒度的 top1/top2 比，结果 '插件|动作' 和 '插件|（目录名给的无二级）'
   * 被当成两个对手互相抵消，ABT 明明证据很多却掉到 0.33（实测）。
   */
  const ranked = byCategory(candidates)
  const top = ranked[0]
  const second = ranked[1]
  const ambiguous = !!top && !!second && second.score >= top.score * AMBIGUITY_RATIO

  const category = top?.cat ?? hard.category ?? 'other'
  const subcategory = pickSub(top)

  let confidence: number
  if (!top) {
    confidence = 0
  } else {
    confidence = top.score / (top.score + (second?.score ?? 0) + EPS)
    if (hard.category && hard.confidence > 0) {
      // 硬规则是 0.95 档，但仍按 top1/top2 拉开的差距微调，别一律满分
      confidence = Math.min(0.95, 0.8 + confidence * 0.15)
    }
  }
  if (ambiguous) confidence *= AMBIGUITY_PENALTY
  /**
   * 封顶：硬规则认出这是"模型类内容"（FBX/prefab），赢家却是材质/着色器/贴图时，
   * 不许自动归档。真件实测 束縛チャイナFULLSET 被判成 材质/MatCap 71%，
   * 差 4 个点就要把一件服装塞进材质目录了 —— 包里有贴图是结构性的，不是它的特征。
   * 判不准就老老实实掉进待确认，让用户改一次，学习机制下次就记住。
   */
  if (
    (hard.contentType === 'model' || hard.contentType === 'unity_project') &&
    INCIDENTAL_CATS.has(category)
  ) {
    confidence = Math.min(confidence, TH_CONFIRM - 0.05)
  }
  confidence = Math.max(0, Math.min(1, confidence))


  const status: AssetUnit['status'] = confidence >= (deps.confidenceConfirm ?? TH_CONFIRM) ? 'archived' : 'pending_confirm'
  const contentType: ContentType =
    hard.contentType !== 'unknown' ? hard.contentType : ingest.metadata.previewImages.length ? 'texture' : 'unknown'

  const { avatars, tags } = buildTags(corpus, deps, category, subcategory)
  const gk = deriveGroupKey(ingest.rawName, deps.lex)
  /**
   * §B3：名字里拆出来的模型名要排在前面。
   * `Chiffon&Chocolat` 这种复合名只在文件名里出现，语料里未必有 ——
   * 只靠 buildTags 会漏掉一半，详情页就只显示一个徽章（验收 9）。
   */
  for (const a of gk.avatars) pushAvatar(avatars, a, 'unshift')
  const topCandidate = candidates.find((c) => c.cat === category && c.sub === subcategory) ?? candidates.find((c) => c.cat === category)
  const secondCat = second ? byCategory(candidates.filter((c) => c.cat === second.cat))[0] : undefined
  const rp = reasonPartsFor(
    hard,
    topCandidate ? { cat: topCandidate.cat, sub: topCandidate.sub, score: topCandidate.score, evidence: topCandidate.evidence } : undefined,
    secondCat ? { cat: secondCat.cat, sub: null, score: secondCat.score, evidence: secondCat.evidence } : undefined,
    ambiguous,
    deps,
    ingest
  )

  const md = ingest.metadata
  if (md.localeTag && !tags.includes(md.localeTag)) tags.push(md.localeTag)
  if (md.author && !tags.includes(md.author)) tags.push(md.author)

  return {
    tempId: ingest.assetId,
    name: cleanDisplayName(ingest.rawName).name || ingest.rawName,
    category,
    subcategory,
    confidence,
    status,
    contentType,
    targetAvatars: avatars,
    tags,
    localeTag: md.localeTag,
    author: md.author,
    version: md.version ?? gk.version,
    sourceUrl: md.urls[0] ?? null,
    sourceItemId: md.boothItemId,
    sourceItemIdConfidence: md.boothItemIdConfidence,
    groupKey: gk.groupKey,
    bundleRef: null,
    variantRaw: gk.variantRaw[0] ?? null,
    filePaths: ingest.entries.map((e) => e.relPath),
    packageEntries: ingest.entries.length ? undefined : undefined,
    coverImage: md.previewImages[0],
    reasonParts: rp.parts,
    reason: rp.text
  }
}

/**
 * 契约入口。识别为合集时**不再产出 N 个顶层单元**（改动单 §2），而是：
 *  - units 只给 1 条 = 合集自己（分类取子项多数派，置信度取最低那件）
 *  - tree 里带每个子项各自的分类结果与版本列表，落库时建成三级
 * 子项分类仍走完整流程（深度限制防套娃），嵌套合集挂在 item.tree 上。
 */
export function classify(ingest: IngestResult, deps: ClassifyDeps): ClassificationResult {
  const depth = deps.depth ?? 0
  const plan = depth === 0 ? planBundle(ingest, deps) : null
  if (plan && plan.items.length) {
    const items: BundleItemResult[] = []
    for (const it of plan.items) {
      const child: IngestResult = {
        ...ingest,
        assetId: ingest.assetId + ':' + it.relPath,
        rawName: it.name,
        sourceDirChain: [...ingest.sourceDirChain, it.name],
        entries: it.entries,
        /** 子项没被单独解压，暂存路径仍指父级 */
        totalBytes: it.sizeBytes
      }
      const r = classify(child, { ...deps, depth: depth + 1 })
      const unit = r.units[0]
      if (!unit) continue
      unit.bundleRef = plan.name
      unit.filePaths = it.entries.map((e) => it.relPath + '/' + e.relPath)
      /**
       * 第 10 轮 C 的后半程：登记那一步要知道"这一件在父目录里的哪一层"，
       * 否则 22 件会全部登记到筐那一层目录上（`shared/flattenUnits.ts` 用它算源路径）。
       */
      unit.sourceRelPath = it.relPath
      if (it.sourceItemId && !unit.sourceItemId) {
        /** 纯数字目录名只能算"疑似"来源（§1.3），不许当已确认 */
        unit.sourceItemId = it.sourceItemId
        unit.sourceItemIdConfidence = 0.4
      }
      items.push({
        name: it.name,
        relPath: it.relPath,
        groupKey: it.groupKey,
        sourceItemId: it.sourceItemId,
        versions: it.versions,
        unit,
        tree: r.tree ?? null
      })
    }
    if (items.length) {
      /**
       * 第 10 轮 C（他 2026-10-10 批的 Q2 甲）：**名字本身就是个筐**（`道具22件`、`ERP用12件`、
       * `更新`、`重要！`）时，不建容器卡 —— 里面那几件各自成顶层素材。
       *
       * 他的原话是「明明这个文件夹的名字都叫道具22件了，那就意味着这是 22 件不同厂家出的道具，
       * 不应该分成合集」。而**同一件衣服的多个素体适配仍然并成一张卡** —— 那条走的是
       * `groupKey`（`containerKind='merged'`），和"目录名是不是筐"是两条互不相干的路，
       * 所以这里只拦 `isBasketName`，不碰归并型。
       *
       * 外层是买来的合集（名字写着"合集/セット/まとめ"）时照旧建一张卡，
       * 里面那个筐在 `flattenChild` 里就已经被摊平成若干项了（一层层到产品为止）。
       */
      if (isBasketOnlyName(ingest.rawName)) {
        for (const i of items) i.unit.bundleRef = null
        return { units: items.map((i) => i.unit) }
      }
      const bundleUnit = bundleSelfUnit(ingest, plan, items, deps)
      return {
        units: [bundleUnit],
        bundle: { name: plan.name, coverImage: plan.coverImage },
        tree: {
          name: plan.name,
          coverImage: plan.coverImage ?? null,
          why: plan.why,
          items,
          sourceItemId: plan.sourceItemId,
          totalBytes: items.reduce((a, i) => a + sumVersions(i), 0),
          containerKind: plan.containerKind
        }
      }
    }
  }
  return { units: [classifyOne(ingest, deps)] }
}

function sumVersions(item: BundleItemResult): number {
  return item.versions.reduce((a, v) => a + v.sizeBytes, 0)
}

/**
 * 合集自己那一行怎么定分类：**子项多数派**。
 *
 * 置信度取**最低**的那件 —— 一坨 17 件里只要有 1 件引擎没把握，
 * 整包就该进「待复核」被人看一眼，不能被其余 16 件的高分平均掉。
 */
function bundleSelfUnit(
  ingest: IngestResult,
  plan: NonNullable<ReturnType<typeof planBundle>>,
  items: BundleItemResult[],
  deps: ClassifyDeps
): AssetUnit {
  const tally = new Map<string, number>()
  for (const i of items) tally.set(i.unit.category, (tally.get(i.unit.category) ?? 0) + 1)
  const category = Array.from(tally.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'other'
  const sameCat = items.filter((i) => i.unit.category === category)
  const subTally = new Map<string, number>()
  for (const i of sameCat) if (i.unit.subcategory) subTally.set(i.unit.subcategory, (subTally.get(i.unit.subcategory) ?? 0) + 1)
  const subcategory = Array.from(subTally.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  /** 最没把握的那件决定这坨要不要人看 —— 不能被其余高分平均掉 */
  const worst = items.reduce((m, i) => Math.min(m, i.unit.confidence), 1)
  const tags = Array.from(new Set(items.flatMap((i) => i.unit.tags))).slice(0, 12)
  const avatars = Array.from(new Set(items.flatMap((i) => i.unit.targetAvatars))).slice(0, 12)
  const withId = items.find((i) => i.sourceItemId)
  const parts: ReasonPart[] = plan.why.map((w) => ({ key: w.key, params: w.params as Record<string, string | number> | undefined }))
  parts.push({ key: 'classify.reason.bundleItems', params: { count: items.length } })
  /**
   * 合集自己那行**保留容器名的清洗结果**：`ABT 1.3.0【汉化 闲鱼@月见汐音】` 这种
   * 一件商品的几个分包被收进合集后，卡名还是 `ABT`、版本还是 `1.3.0`（§7 特例 3），
   * 不能因为走了合集分支就把名字和版本丢掉。
   */
  const cleaned = cleanDisplayName(ingest.rawName)
  const confidence = plan.oneProduct ? worst * 0.9 : worst
  return {
    tempId: ingest.assetId + ':bundle',
    name: plan.name,
    category,
    subcategory,
    confidence,
    status: items.every((item) => item.unit.status === 'archived') && worst >= (deps.confidenceAuto ?? TH_AUTO)
      && confidence >= (deps.confidenceConfirm ?? TH_CONFIRM)
      ? 'archived' : 'pending_confirm',
    contentType: 'bundle',
    targetAvatars: avatars,
    tags,
    localeTag: null,
    author: sameCat[0]?.unit.author ?? null,
    version: cleaned.version ?? null,
    sourceUrl: withId?.unit.sourceUrl ?? null,
    sourceItemId: withId?.sourceItemId ?? null,
    sourceItemIdConfidence: withId ? 0.4 : 0,
    groupKey: plan.name.toLowerCase(),
    bundleRef: null,
    filePaths: [],
    coverImage: plan.coverImage,
    reasonParts: parts,
    reason: `合集：${items.length} 个子项`
  }
}

/** 给 UI 分档用：绿 / 黄 / 红（§5.3 Step 5） */
export function confidenceTone(confidence: number): 'ok' | 'warn' | 'bad' {
  if (confidence >= TH_AUTO) return 'ok'
  if (confidence >= TH_CONFIRM) return 'warn'
  return 'bad'
}
