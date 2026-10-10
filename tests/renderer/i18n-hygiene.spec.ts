import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 界面文案的两条卫生规矩（第 10 轮 F，他 2026-10-10 的原话：
 * 「把所有旧文案、旧文本删了，不要再出现"unity导入在M5交付"类似的内容」）。
 *
 * ## 为什么要写成用例而不是"这次改完就完了"
 *
 * 这两类话术都是**会自己长回来**的：写功能的时候顺手来一句「在 Mx 交付」最省事，
 * 而它一旦发出去就变成一句谎（M5 早就交付了，他还得截图来问我为什么）。
 * 内部代号「A」也一样 —— 第 8 轮改名只改了 README 和发布页，界面里留了四十来条，
 * 这次是从一张活体截图里看见「打开 Unity 时 A 没地方可切」才发现的。
 *
 * ## 规矩
 *
 *  1. **界面不许写里程碑编号**（`M1` / `M5-B` / `M6`…）—— 界面只说"现在能做什么"和
 *     "现在不能做什么、为什么"，不说"以后哪个版本会补"。
 *  2. **界面不许出现内部代号**：产品名叫 Atrium，句子里当主语用「它」。
 *     `Ctrl+A`、`E:\vrc\A`、`M5-A` 这种是合法的，不算命中。
 */
const ROOT = path.resolve(__dirname, '../..')
const I18N = path.join(ROOT, 'src', 'renderer', 'i18n')
const LOCALES = ['zh-CN', 'en', 'ja'] as const

/** 合法的 "A"：快捷键、路径、旧的内部编号、单位。扫之前先把这些挖掉 */
const ALLOWED = /Ctrl\+[A-Z]|Alt\+[A-Z]|Shift\+[A-Z]|[A-Z]:\\?[^\s"]*|M\d-[AB]\b|\bAtrium\b/g

function values(obj: unknown, prefix = ''): Array<[string, string]> {
  const out: Array<[string, string]> = []
  if (!obj || typeof obj !== 'object') return out
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object') out.push(...values(v, key))
    else if (typeof v === 'string') out.push([key, v])
  }
  return out
}

function load(loc: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(I18N, `${loc}.json`), 'utf8')) as Record<string, unknown>
}

/** 里程碑编号：`M` 紧跟数字（`MB`、`MP4`、`PDF` 这种不会命中） */
function milestoneHits(text: string): string[] {
  return [...text.matchAll(/\bM\d+\b/g)].map((m) => m[0])
}

/** 内部代号：按语言各一套"裸 A 当产品名"的形状 */
function internalNameHits(loc: string, raw: string): string[] {
  const text = raw.replace(ALLOWED, '·')
  /**
   * ⚠ 这里原来写的是 `loc === 'zh'`，而语言文件的名字是 **`zh-CN`** ——
   * 于是中文那份一直在跑英文那套规则，`A 不知道…` 这种句子根本抓不到。
   * 这条是本轮变异回扫（F4）逼出来的：撤掉修复用例不红，就是因为闸本身瞎了一只眼。
   * 所以下面用前缀判，并且有一条正向对照专门喂 `zh-CN`。
   */
  if (loc.startsWith('zh')) return [...text.matchAll(/(^|[^A-Za-z0-9_\\/:.-])A(?=[ 不没得叫让就才将又只必该手怎这自])/g)].map(() => 'A')
  if (loc.startsWith('ja')) return [...text.matchAll(/(^|[^A-Za-z0-9_])A(?=\s*[はがを])/g)].map(() => 'A')
  /**
   * 英文最难判：**"A batch is already running" 里的 A 是不定冠词**，不是产品名。
   * 所以只认三种形状，而且**要求紧邻** —— 第一版没要求紧邻，把
   * "A toast reports…"、"A project as the import target"、"A group left with one member"
   * 全报成了内部代号（10 条里 4 条是误报，误报多了这条闸就没人看了）。
   *  1. `A <只有产品会做的动词>`
   *  2. `<及物动词|介词> A` —— start A、open A、should A do、through A
   *  3. `A's` —— 所有格
   */
  const VERB = "asks?|asked|can|cannot|can'?t|won'?t|will|must|needs?|knows|handles|queues|archives|moves|picks|stopped|does|doesn'?t|should|is|are|has|have|works|still"
  return [
    ...[...text.matchAll(new RegExp(`\\bA\\s+(?:${VERB})\\b`, 'g'))].map((m) => m[0]),
    ...[...text.matchAll(/\b(?:[Ss]tart|[Oo]pen|[Tt]o|[Ww]ith|[Tt]hrough|[Vv]ia|[Ss]hould|[Aa]sk|[Uu]se)\s+A\b/g)].map((m) => m[0]),
    ...[...text.matchAll(/\bA's\b/g)].map((m) => m[0])
  ]
}

/** 未来承诺话术：界面不许预告"以后某个版本会补"（`{{milestone}}` 占位符本身不含编号，所以单独一条） */
function promiseHits(text: string): string[] {
  return [...text.matchAll(/将在|敬请期待|対応予定|Coming in|coming soon|TODO/gi)].map((m) => m[0])
}

/**
 * 源码里**硬编码**的字符串字面量（不走语言文件的那批）。
 *
 * 为什么也要扫：`reason` 这类字段会直接显示在详情面板上，可它不在 i18n 文件里 ——
 * 第一版那条"界面不许写里程碑"的用例只查语言文件，于是 `ingest/api.ts` 里那句
 * `'M2 手工分类（未走自动分类）'` 就这么漏过去了。
 */
function sourceStringLiterals(dir: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        walk(p)
        continue
      }
      if (!/\.(ts|tsx)$/.test(e.name)) continue
      const src = stripComments(fs.readFileSync(p, 'utf8'))
      for (const m of src.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) out.push([p, m[2]])
    }
  }
  walk(dir)
  return out
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n')
}

describe('界面文案卫生（第 10 轮 F）', () => {
  const all = LOCALES.flatMap((loc) => values(load(loc)).map(([k, v]) => [loc, k, v] as const))

  it('扫得到东西（扫到 0 条就是这条用例自己坏了）', () => {
    expect(all.length).toBeGreaterThan(600)
  })

  it('⭐ 三份语言文件里没有任何里程碑编号（M1 / M5-B / M6…）', () => {
    const bad = all.filter(([, , v]) => milestoneHits(v).length).map(([l, k, v]) => `${l} ${k}：${v}`)
    expect(bad, `这些话术会在界面上变成一句过期的谎：\n${bad.join('\n')}`).toEqual([])
  })

  it('⭐ 也不许有"将在某个版本交付 / 敬请期待"这类预告（占位符逃过了上一条，这里补上）', () => {
    /**
     * `common.notImplemented` 的原文是「该功能将在 {{milestone}} 交付」——
     * 编号在**参数**里，所以按字面量找 `M\d` 的那条抓不到它。
     * 界面只说两种话：现在能做什么、现在不能做什么以及为什么。
     */
    const bad = all.filter(([, , v]) => promiseHits(v).length).map(([l, k, v]) => `${l} ${k}：${v}`)
    expect(bad, `不许预告以后哪个版本会补：\n${bad.join('\n')}`).toEqual([])
  })

  it('⭐ 源码里硬编码的用户可见字符串也不许带里程碑编号（reason 这类不走语言文件）', () => {
    /**
     * 第一版这条只扫语言文件，于是 `ingest/api.ts` 里那句 `'M2 手工分类（未走自动分类）'`
     * 一路活到本轮审计才被抓出来 —— 它会显示在详情面板「为什么这么判」那一行。
     * 现在扫下来是 0 条，所以**不需要白名单**；哪天有人写了带编号的硬编码文案，这里就红。
     */
    const lits = sourceStringLiterals(path.join(ROOT, 'src'))
    expect(lits.length, '一个字符串字面量都没扫到 = 这条用例自己坏了').toBeGreaterThan(2000)
    const bad = lits.filter(([, s]) => /\bM\d+\b/.test(s)).map(([f, s]) => `${f}：${s.slice(0, 80)}`)
    expect(bad, `这些会直接显示给用户，而编号对用户没有信息量：\n${bad.join('\n')}`).toEqual([])
  })

  it('⭐ 界面里没有把内部代号「A」当产品名用的文案', () => {
    /**
     * 每种语言只跑**自己**那条规则。第一版把三套规则都套到所有值上，
     * 于是中文那条（"A 后面跟空格或虚词"）在英文句子上乱咬 ——
     * "A batch is already running" 里的不定冠词被报成内部代号，四条误报。
     */
    const bad = all.filter(([loc, , v]) => internalNameHits(loc, v).length).map(([l, k, v]) => `${l} ${k}：${v}`)
    expect(bad, `产品名是 Atrium；句子里当主语就用「它」：\n${bad.join('\n')}`).toEqual([])
  })

  /**
   * 正向对照 —— 本仓库为这件事写过警告（`tools/pkg-version.cjs` 那条"跑出来是绿的不等于它会红"）。
   * 扫描规则一旦失效，上面两条就永久假绿，所以这里**故意喂它坏例子和合法例子**。
   */
  it('扫描规则本身有效：坏例子必须被抓到，合法写法不许误报', () => {
    expect(milestoneHits('Unity 导入在 M5 交付')).toEqual(['M5'])
    expect(milestoneHits('自动切换集合在 M6 生效')).toEqual(['M6'])
    expect(milestoneHits('批量选择在 M5-B 交付')).toEqual(['M5'])
    expect(internalNameHits('zh', '还没有集合。打开 Unity 时 A 没地方可切')).toEqual(['A'])
    expect(internalNameHits('en', "A can't pick for you").length, "'A can' 这种主语必须抓到").toBeGreaterThan(0)
    expect(internalNameHits('en', 'Start A with Windows').length).toBeGreaterThan(0)
    expect(internalNameHits('en', "No import records for this asset in A's log")).toEqual(["A's"])
    expect(internalNameHits('ja', 'A は選べません')).toEqual(['A'])
    /** ⭐ 语言文件的名字是 `zh-CN` 不是 `zh` —— 按前缀判，这条钉住那只瞎掉的眼睛 */
    expect(internalNameHits('zh-CN', 'A 不知道这次拖来了什么').length, 'zh-CN 必须走中文那套规则').toBeGreaterThan(0)
    expect(internalNameHits('zh-TW', 'A 不认得这个文件夹').length).toBeGreaterThan(0)
    expect(internalNameHits('zh-CN', '库根 E:\\vrc\\A 不受影响，Ctrl+A 全选')).toEqual([])
    /** 承诺话术：抓得到，而**描述现在行为的"会在…"不许误报** */
    expect(promiseHits('该功能将在 {{milestone}} 交付').length).toBeGreaterThan(0)
    expect(promiseHits('Unity 导入在 M5 交付')).toEqual([])
    expect(promiseHits('开着时：新发现的工程，会在它出现或 Unity 打开它时装上桥接')).toEqual([])
    expect(promiseHits('Coming in {{milestone}}')).toEqual(['Coming in'])
    /** 源码那条也一样：得能抓到带编号的硬编码文案 */
    expect(/\bM\d+\b/.test('M2 手工分类（未走自动分类）')).toBe(true)
    expect(/\bM\d+\b/.test('手工分类（没走自动判断）')).toBe(false)
    /** 合法的：快捷键、路径、产品名、单位，以及**英文的不定冠词** */
    expect(milestoneHits('204 MB 的文件')).toEqual([])
    expect(internalNameHits('zh', 'Ctrl+A 全选，库根 E:\\vrc\\A 不受影响')).toEqual([])
    expect(internalNameHits('en', 'Atrium must keep running in the tray')).toEqual([])
    expect(internalNameHits('en', 'A toast reports what was done')).toEqual([])
    expect(internalNameHits('en', 'A batch is already running — finish or roll it back first')).toEqual([])
    expect(internalNameHits('en', 'Pick a project as the import target. A project that is not running cannot be imported into.')).toEqual([])
    expect(internalNameHits('en', 'A group left with one member — over-merged')).toEqual([])
  })
})
