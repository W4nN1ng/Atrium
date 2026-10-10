/**
 * 展示名清洗（第 2 份 §清洗 / 第 1 份验收 #1 / 改动单 2 §A3 §A4）。
 *
 * 放在 shared 是因为主进程和渲染进程都要用同一套规则：
 * 收件箱预填输入框用一次，"确认入库"兜底再用一次，两边各写一遍必然漂走
 * （之前就是 UI 剥一个扩展名、主进程剥一个扩展名，`.rar.rar` 出来还是带 `.rar`）。
 *
 * 只做"名字长什么样"，不做"这是什么分类" —— 后者是 M3 分类引擎。
 */

/** 反复剥掉尾部的容器扩展名；图片/文档扩展名也剥，展示名不该带后缀 */
const TRAILING_EXTS = [
  'rar',
  'zip',
  '7z',
  'tar',
  'gz',
  'tgz',
  'bz2',
  'xz',
  'z01',
  'unitypackage',
  'unitypackge',
  'psd',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'tga',
  'tif',
  'tiff',
  'pdf',
  'txt',
  'md',
  'html',
  'htm',
  'docx',
  'exe'
]

/** 全角/半角方括号里的备注：【汉化 闲鱼@月见汐音】、［Decal］ */
const NOTE_RE = /[【[]([^】\]]{1,40})[】\]]/g

/**
 * UUID 与长 hex 串（§A4）：**必须在提版本号之前剥掉**。
 * 不剥的话 `d6b99874-3687-4746-8eca-21c8050c74a0` 会被版本正则咬出 `99874-3687-4746-8e`
 * 这种鬼东西（改动单 2 验收 2 点名的真事故）。
 */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const LONG_HEX_RE = /\b[0-9a-f]{16,}\b/gi

/**
 * 把串里的 UUID / 长 hex 换成空格，并回报剥掉了什么。
 *
 * 导出来是因为 **两条路都要在提版本号之前先走这一步**：
 * cleanDisplayName（展示名）自己走了，deriveGroupKey（归并键 / 版本行）原先没走，
 * 于是真库那个 `d6b99874-… base resized.jpg` 的名字修好了、版本号还是 `99874-3687-4746-8e`
 * —— 同一个规则两份实现必然漂走，这就是本文件开头那段注释说的老毛病又犯了一次。
 */
export function stripIdLike(s: string): { text: string; stripped: string[] } {
  const stripped: string[] = []
  let text = s.replace(UUID_RE, (m) => {
    stripped.push(m)
    return ' '
  })
  text = text.replace(LONG_HEX_RE, (m) => {
    stripped.push(m)
    return ' '
  })
  return { text, stripped }
}

/** 开头的作者/店铺 id：Booth 是 7-8 位纯数字，通用规则取 4 位以上 */
const LEADING_ID_RE = /^\d{4,}[\s._-]+/

/**
 * 版本号（§A4 的上下文约束）：不是"看见数字点数字"就算版本。
 * 满足其一才认：跟在 v/V/ver/バージョン 后；或剥完括号备注后是最后一个 token。
 * `ABT 1.3.0【汉化 …】` 能过是因为备注先被摘掉、1.3.0 成了末 token（裁定 7 的顺序）。
 * 边界认中日韩字：`佳兔工具箱v2.7.0版本` 的 2.7.0 后面紧跟"版"，
 * 不认就会被回溯砍成 2.7，名字剩个 `佳兔工具箱.0版本`（实测截图里就是这么丑）。
 */
const CJK = '㐀-䶿一-鿿ぁ-ヿ'
const VERSION_RE = new RegExp(`[\\s._-]*[vV](\\d+(?:\\.\\d+)+)(?=$|[\\s._-]|[${CJK}])`)
const BARE_VERSION_RE = new RegExp(`[\\s._-]+(\\d+\\.\\d+(?:\\.\\d+)*)(?=$|[${CJK}])`)

/** 括号备注里的语言/作者线索（裁定 7：剥备注时别把信息丢进垃圾桶） */
const LOCALE_HINTS: Array<[RegExp, string]> = [
  [/汉化|中文|简中|繁中|中国語/i, 'zh'],
  [/日本語|和訳|にほんご/i, 'ja'],
  [/english|\beng\b/i, 'en'],
  [/한국어|韩化|韩翻/i, 'ko']
]
const AUTHOR_RE =
  /(?:闲鱼|微博|哔哩|b站|bilibili|twitter|pixiv|booth|gumroad|by|作者)\s*[:：]?\s*@?\s*([^\s@,，;；】\]]{2,24})|@([^\s@,，;；】\]]{2,24})/i

export interface NameGuess {
  /** 清洗后的展示名；清洗到空串时回退成原名，绝不返回空 */
  name: string
  /** 从名字里剥出来的版本号 */
  version: string | null
  /** 全角括号里的备注，供分类引擎当线索（汉化 / 闲鱼@月见汐音 / Decal） */
  notes: string[]
  /** 被剥掉的片段，界面可以显示"为什么名字变了" */
  stripped: string[]
  /** 括号备注里认出的语言（汉化 → zh）；认不出为 null */
  localeTag: string | null
  /** 括号备注里认出的作者/搬运者（闲鱼@月见汐音 → 月见汐音）；认不出为 null */
  author: string | null
}

/**
 * 这个名字是不是"没有信息量"（§A3）：UUID、长 hex、image0、纯数字、太短……
 * 命中就该往上一级找名字（父目录名），而不是拿它当素材名。
 */
export function isMeaninglessName(s: string): boolean {
  const t = (s ?? '').trim()
  if (!t) return true
  UUID_RE.lastIndex = 0
  if (UUID_RE.test(t)) return true
  LONG_HEX_RE.lastIndex = 0
  if (LONG_HEX_RE.test(t)) return true
  if (/^(image|img|photo|screenshot|pic|picture|untitled|无标题|新建|new)[\s._-]*\d*$/i.test(t)) return true
  if (/^\d{5,}$/.test(t)) return true
  /**
   * ⚠ "太短就算没信息量"这条**只对拉丁字母和数字成立**。
   * 第 10 轮 D 就是撞在这个上面：他真库里那个目录就叫 **`修女`**（两个字，信息量很足），
   * 老规则把它判成"太短"，于是主名让位给了包内的 `Holy Spice Kaguya` ——
   * 用户看到的是"我拖的是修女，怎么出来一张英文卡"。
   * 中日韩一个字顶拉丁一个词，2 个就够读；纯 ASCII 才要 ≥3。
   */
  if (t.length < 3 && !/[\u3040-\u30ff\u31f0-\u31ff\u4e00-\u9fff\uac00-\ud7af]/.test(t)) return true
  // 去掉扩展名后只剩分隔符
  const core = t.replace(/\.[A-Za-z0-9]+$/, '')
  if (!core.replace(/[\s._\-()[\]【】]+/g, '')) return true
  return false
}

/**
 * 这个名字**能不能当素材的主名**（第 10 轮 D 把它从 `reanalyze.ts` 提到 shared）。
 *
 * 和 `isMeaninglessName` 的差别只有两条：还挂着扩展名、以及旧版本正则咬剩的 `.0版本` 残骸。
 * 为什么要单独有这一条：**同一个判断现在有三个人要做** ——
 * 「重新分析」要不要改名、容器取名时磁盘名够不够格、以及第 10 轮"包内名不许顶掉他拖进来的名字"。
 * 各写一遍必漂（M5-3 一天内漂过两次，那件事记在本文件开头）。
 */
export function nameIsGarbage(name: string): boolean {
  const n = (name ?? '').trim()
  if (!n) return true
  if (isMeaninglessName(n)) return true
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(n)) return true
  if (/\b[0-9a-f]{16,}\b/i.test(n)) return true
  /** 展示名不该带扩展名（改名那一步没剥干净就是残骸） */
  if (/\.(zip|rar|7z|tar|gz|tgz|unitypackage|png|jpe?g|gif|webp|psd|pdf|txt|md|html?)$/i.test(n)) return true
  /** 旧版本正则的另一种残骸：`佳兔工具箱.0版本` 这种尾巴 */
  if (/\.\d+(?:版本|ver(?:sion)?|の)/i.test(n)) return true
  return false
}

/** 从括号备注里捞语言与作者（裁定 7） */
export function hintsFromNotes(notes: string[]): { localeTag: string | null; author: string | null } {
  let localeTag: string | null = null
  let author: string | null = null
  for (const n of notes) {
    if (!localeTag) {
      for (const [re, tag] of LOCALE_HINTS) {
        if (re.test(n)) {
          localeTag = tag
          break
        }
      }
    }
    if (!author) {
      const m = AUTHOR_RE.exec(n)
      if (m) author = ((m[1] ?? m[2]) || '').trim() || null
    }
  }
  return { localeTag, author }
}

export function cleanDisplayName(raw: string): NameGuess {
  const original = (raw ?? '').trim()
  const stripped: string[] = []
  const notes: string[] = []
  if (!original) return { name: '', version: null, notes, stripped, localeTag: null, author: null }

  let s = original

  // 0) UUID / 长 hex 先走（§A4：不先剥就会被版本正则咬碎）
  const idless = stripIdLike(s)
  stripped.push(...idless.stripped)
  s = idless.text

  // 1) 摘括号备注（备注里的语言/作者线索单独捞出来，裁定 7）
  s = s.replace(NOTE_RE, (_m, inner: string) => {
    const note = inner.trim()
    if (note) notes.push(note)
    stripped.push(_m)
    return ' '
  })
  const hints = hintsFromNotes(notes)

  /**
   * 1.5) 先把空白收拾干净再往下走。
   * 摘备注是把整段换成一个空格的，`ABT 1.3.0【汉化…】` 会变成 `ABT 1.3.0 `（尾巴带空格）；
   * 而裸版本号要求"是最后一个 token"，那个尾巴空格会让它匹配不上，版本号就漏了。
   * 下划线也在这里换掉，后面的 id / 版本正则只需要认空格一种分隔符。
   */
  s = s.replace(/_+/g, ' ').replace(/\s{2,}/g, ' ').trim()

  // 2) 剥尾部容器/文件扩展名（可叠多层：.rar.rar）
  for (;;) {
    const m = /\.([A-Za-z0-9]+)$/.exec(s)
    if (!m) break
    if (!TRAILING_EXTS.includes(m[1].toLowerCase())) break
    stripped.push(m[0])
    s = s.slice(0, m.index)
  }

  // 3) 剥开头数字 id
  const idm = LEADING_ID_RE.exec(s)
  if (idm) {
    stripped.push(idm[0].trim())
    s = s.slice(idm[0].length)
  }

  // 4) 取版本号（先带 V 的，再退而求其次找裸的；裸的必须是末 token，§A4）
  let version: string | null = null
  const vm = VERSION_RE.exec(s) ?? BARE_VERSION_RE.exec(s)
  if (vm) {
    version = vm[1]
    stripped.push(vm[0].trim())
    s = s.slice(0, vm.index) + s.slice(vm.index + vm[0].length)
    /**
     * 中日文习惯把"版本"两个字写在版本号后面（`v2.7.0版本`、`v1.10の素材`）。
     * 版本号整个剥掉后那个词就成了孤儿，留着会显示成"佳兔工具箱版本" —— 一起走。
     */
    s = s.replace(/^\s*(?:の)?\s*(?:版本号|版本|ver\.?)/i, '').trim()
    s = s.replace(/\s*(?:版本号|版本|version|ver\.?)$/i, '').trim()
  }

  // 5) 下划线换空格、压空白
  s = s.replace(/_+/g, ' ').replace(/\s{2,}/g, ' ').trim()
  // 尾 punctuation 收尾：剥完常剩 "Grimoir_SHINANO_" 这种
  s = s.replace(/[\s._-]+$/, '').trim()

  if (!s || isMeaninglessName(s)) {
    // 全剥没了、或剥完剩个 UUID 尾巴 —— 宁可退回原名也别给空/给垃圾
    return { name: s || original, version, notes, stripped, localeTag: hints.localeTag, author: hints.author }
  }
  return { name: s, version, notes, stripped, localeTag: hints.localeTag, author: hints.author }
}

/** 只要名字的场景用这个 */
export function displayName(raw: string): string {
  return cleanDisplayName(raw).name
}

/** 复合模型名的连接符（和 classify/groupKey 的 §B3 一个口径） */
const COMPOSITE_SEP_RE = /[&\uFF06+\uFF0B\u3001,\uFF0C]/

/**
 * 从方括号变体槽位原文里把**模型名**捞出来（§B2/§B3 的展示侧）。
 *
 * `Shinano_ATTITUDE The Royal Bunny` → ['Shinano']
 * `Chiffon&Chocolat_ATTITUDE The Royal Bunny` → ['Chiffon','Chocolat']
 * `KipfelMame_ATTITUDE` → ['KipfelMame']（驼峰拆分要查词表，展示层没有词表，就不硬猜）
 *
 * 放 shared 是因为主进程（分组徽章）和渲染进程（容器内每行的模型徽章）都要用同一套，
 * 两边各写一遍必然漂走 —— 那正是 naming.ts 开头那段注释说的老毛病。
 */
export function modelNamesFromVariantRaw(raw: string | null | undefined): string[] {
  const s = (raw ?? '').trim()
  if (!s) return []
  const head = s.split(/[_\uFF3F]/)[0] ?? ''
  return head
    .split(COMPOSITE_SEP_RE)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2)
}

/**
 * 第 10 轮 D：主名让位给磁盘名之后，**被压下去的那个名字不许丢** —— 塞进 tags。
 *
 * 走 tags 而不是新开一列是有理由的：tag 已经进检索索引、也已经在卡片上露出来，
 * 用户以后按 `Holy Spice Kaguya` 搜照样搜得到这张「修女」，只是它不再是主名。
 * 单独抽出来是因为这一步原来写在 `ingest/api.ts` 的一个大对象字面量里，
 * **没有任何用例看着它** —— 判据在 shared 才测得到，这是本仓库一贯的那条规矩。
 *
 * 不改动传进来的数组（调用方给的是 `model?.tags ?? []`，那种引用别处还在用）。
 */
export function tagsWithAltName(tags: readonly string[] | null | undefined, altName: string | null | undefined): string[] {
  const base = tags ? [...tags] : []
  const s = (altName ?? '').trim()
  if (!s) return base
  if (base.includes(s)) return base
  return [...base, s]
}

/**
 * §A3 取名优先级：第一个"有意义"的名字胜出。
 * 候选按顺序给：主体文件名 → 主体所在目录名 → 容器目录名 → 原名兜底。
 */
export function pickMeaningfulName(candidates: Array<string | null | undefined>): string | null {
  for (const c of candidates) {
    if (!c) continue
    const cleaned = cleanDisplayName(c).name
    if (cleaned && !isMeaninglessName(cleaned)) return cleaned
  }
  return null
}
