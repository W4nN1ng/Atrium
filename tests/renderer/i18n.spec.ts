import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * i18n 对账测试：三份语言文件的 key 集合必须完全一致，
 * 并且代码里 t('…') 用到的每个 key 都要在 zh-CN 里存在。
 * —— 漏翻译在运行时只会显示 key 名，肉眼很容易放过，所以用测试兜住。
 */

const ROOT = path.resolve(__dirname, '../..')
const I18N = path.join(ROOT, 'src', 'renderer', 'i18n')
const LOCALES = ['zh-CN', 'en', 'ja'] as const

function flatten(obj: unknown, prefix = ''): string[] {
  if (!obj || typeof obj !== 'object') return [prefix]
  const out: string[] = []
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object') out.push(...flatten(v, key))
    else out.push(key)
  }
  return out
}

function load(loc: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(I18N, `${loc}.json`), 'utf8')) as Record<string, unknown>
}

/**
 * 形如 'ingest.warn.extMismatch' 的 i18n 键字面量。
 * 主进程按位置传参（progress(jobId, stage, pct, 'ingest.msg.hashing', …)）时，
 * 只认 `messageKey:` 前缀的旧扫描规则会整个漏掉，所以改成按命名空间认。
 */
const KEY_LITERAL_RE =
  /'((?:covers|ingest|probe|err|toast|settings|library|status|collections|inbox|asset|unity|common|nav|classify|rearchive|installed|variantKind|wizard)\.[A-Za-z0-9_.]+)'/g

/** 但 'settings.json'、'library.db' 这种是文件名，不是 key */
const FILE_EXT_RE =
  /\.(?:json|db|sqlite|sqlite3|png|jpe?g|ico|icns|ts|tsx|js|cjs|mjs|node|exe|dll|txt|md|html|css|ya?ml|lock|log|csv|xml|ini|url|unity|meta|shader|psd|zip|rar|7z|reg|cmd|ps1|bat)$/i

function collectKeys(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) collectKeys(p, acc)
    else if (/\.tsx?$/.test(e.name)) {
      const src = fs.readFileSync(p, 'utf8')
      for (const m of src.matchAll(/[^A-Za-z0-9_]t\(\s*'([A-Za-z0-9_.]+)'/g)) acc.push(m[1])
      for (const m of src.matchAll(/[^A-Za-z0-9_]t\(\s*`([A-Za-z0-9_.]+)\$\{/g)) acc.push(m[1])
      for (const m of src.matchAll(KEY_LITERAL_RE)) if (!FILE_EXT_RE.test(m[1])) acc.push(m[1])
    }
  }
  return acc
}

const data = Object.fromEntries(LOCALES.map((l) => [l, flatten(load(l))])) as Record<string, string[]>
const used = Array.from(new Set(collectKeys(path.join(ROOT, 'src', 'renderer'))))

/** 主进程只回传 i18n key，所以那些 key 也必须三语齐全，否则界面会退回中文兜底 */
function collectMainKeys(): string[] {
  const acc: string[] = []
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.ts$/.test(e.name)) {
        const src = fs.readFileSync(p, 'utf8')
        for (const m of src.matchAll(/(?:messageKey|textKey)\s*:\s*'([A-Za-z0-9_.]+)'/g)) acc.push(m[1])
        for (const m of src.matchAll(KEY_LITERAL_RE)) if (!FILE_EXT_RE.test(m[1])) acc.push(m[1])
      }
    }
  }
  walk(path.join(ROOT, 'src', 'main'))
  return acc
}

/** 去掉注释，只留代码本体 */
function stripComments(src: string): string {
  return src
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n')
}

const CJK = /[\u3040-\u30ff\u31f0-\u31ff\u4e00-\u9fff\uff00-\uffef\u3000-\u303f]/

describe('i18n 三语一致', () => {
  it('每种语言的 key 数量一致', () => {
    const n = data['zh-CN'].length
    expect(n).toBeGreaterThan(100)
    for (const loc of LOCALES) expect(data[loc].length, `${loc} key 数不同`).toBe(n)
  })

  it('key 集合完全相同，没有谁多一条或少一条', () => {
    const base = new Set(data['zh-CN'])
    for (const loc of LOCALES) {
      const other = new Set(data[loc])
      const missing = [...base].filter((k) => !other.has(k))
      const extra = [...other].filter((k) => !base.has(k))
      expect(missing, `${loc} 缺：${missing.join(', ')}`).toEqual([])
      expect(extra, `${loc} 多：${extra.join(', ')}`).toEqual([])
    }
  })

  it('没有空翻译', () => {
    for (const loc of LOCALES) {
      const raw = load(loc)
      const walk = (o: Record<string, unknown>, p: string): void => {
        for (const [k, v] of Object.entries(o)) {
          const key = p ? `${p}.${k}` : k
          if (v && typeof v === 'object') walk(v as Record<string, unknown>, key)
          else expect(String(v).trim().length, `${loc} 的 ${key} 是空的`).toBeGreaterThan(0)
        }
      }
      walk(raw, '')
    }
  })

  it('代码里用到的每个 key 都存在（动态前缀单独查）', () => {
    const base = new Set(data['zh-CN'])
    // 形如 t('status.' + x) 的写法会被正则抓成 'status.'，这里按前缀处理
    const statics = used.filter((k) => !k.endsWith('.'))
    const prefixes = used.filter((k) => k.endsWith('.'))
    const missing = statics.filter((k) => !base.has(k))
    expect(missing, `这些 key 没定义：${missing.join(', ')}`).toEqual([])
    for (const p of prefixes) {
      expect(
        [
          'status.',
          'settings.tabs.',
          'inbox.stage.',
          'vpm.errors.',
          'vpm.warnings.',
          'vpm.projects.state.',
          'vpm.projects.match.',
          'vpm.projects.confidence.',
          'vpm.plan.action.',
          'vpm.plan.reason.',
          'vpm.plan.conflict.',
          'vpm.plan.risk.',
          'vpm.plan.warn.'
        ],
        `意外的动态前缀 ${p}`
      ).toContain(p)
      expect(base.has(p.slice(0, -1)) || [...base].some((k) => k.startsWith(p)), `前缀 ${p} 下没有任何 key`).toBe(true)
    }
    // 动态拼接的那几组，逐个枚举值确认
    for (const s of ['archived', 'classified', 'pending_confirm', 'inbox']) {
      expect(base.has(`status.${s}`), `缺 status.${s}`).toBe(true)
    }
    for (const t of ['general', 'library', 'classify', 'unity', 'vpm', 'integration', 'maintenance', 'about']) {
      expect(base.has(`settings.tabs.${t}`), `缺 settings.tabs.${t}`).toBe(true)
    }
    for (const st of [
      'queued',
      'hashing',
      'detecting',
      'extracting',
      'fingerprinting',
      'classifying',
      'awaiting_confirm',
      'committing',
      'done',
      'failed',
      'cancelled',
      'duplicate'
    ]) {
      expect(base.has(`inbox.stage.${st}`), `缺 inbox.stage.${st}`).toBe(true)
    }
  })

  it('主进程回传的 key 三语都存在（否则界面会退回中文兜底）', () => {
    const mainKeys = Array.from(new Set(collectMainKeys()))
    expect(mainKeys.length, '没扫到任何主进程 key，说明扫描规则失效了').toBeGreaterThan(5)
    for (const loc of LOCALES) {
      const set = new Set(data[loc])
      const missing = mainKeys.filter((k) => !set.has(k))
      expect(missing, `${loc} 缺主进程用的 key：${missing.join(', ')}`).toEqual([])
    }
  })

  it('格式名（probe.label）不许是中文，否则切了英文界面还是中文', () => {
    const bad: string[] = []
    for (const rel of ['src/main/unpack/magic.ts', 'src/main/ingest/worker.ts']) {
      const src = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
      for (const m of src.matchAll(/\blabel:\s*'([^']*)'/g)) {
        if (CJK.test(m[1])) bad.push(`${rel} label: '${m[1]}'`)
      }
      // make('zip', null, 'ZIP') 这种位置参数也要查
      for (const m of src.matchAll(/\bmake\(\s*'[^']*'\s*,\s*(?:'[^']*'|null)\s*,\s*'([^']*)'\s*\)/g)) {
        if (CJK.test(m[1])) bad.push(`${rel} make(..., '${m[1]}')`)
      }
      // 往界面直推中文字面量（走 message 兜底之外的路）
      for (const m of src.matchAll(/warnings\.push\(\s*'([^']*)'/g)) {
        if (CJK.test(m[1])) bad.push(`${rel} warnings.push('${m[1]}')`)
      }
    }
    expect(bad, `这些文案绕过了 i18n：\n${bad.join('\n')}`).toEqual([])
  })

  it('探测器的 label 全集是 ASCII（渲染进程按它查翻译，查不到就原样显示）', () => {
    const src = stripComments(fs.readFileSync(path.join(ROOT, 'src/main/unpack/magic.ts'), 'utf8'))
    const labels = [...src.matchAll(/\bmake\(\s*'[^']*'\s*,\s*(?:'[^']*'|null)\s*,\s*'([^']*)'\s*\)/g)].map((m) => m[1])
    expect(labels.length, '一个 label 都没扫到，扫描规则失效了').toBeGreaterThan(15)
    for (const l of labels) expect(l, `label '${l}' 含非 ASCII`).toMatch(/^[\x20-\x7e]+$/)
  })
})

describe('插值占位符写法（i18next 只认双花括号）', () => {
  /**
   * 起因是 2026-10-06 的沙盒活体：三道抽取闸门的四条文案（`err.extract*`）把占位符写成了
   * 单花括号 `{extractRoot}`，界面上就原样显示大括号 —— 而**主进程参数是照发到的**
   * （CDP 直接调 `unity:importPlan` 能看到 `reasonParams:{extractRoot:'C:/…'}`，
   * store 里也存着），所以这是纯文案写法问题，单测和 tsc 都看不见它。
   * 闸门拒绝的话术恰恰是最需要让用户看懂"改哪里"的那几句。
   */
  const ALLOW_LITERAL_BRACE = ['dirTemplateHint']

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

  it('三份文件里没有任何"单花括号"占位符（写了就等于界面漏大括号）', () => {
    const bad: string[] = []
    let scanned = 0
    for (const loc of LOCALES) {
      for (const [key, text] of values(load(loc))) {
        if (ALLOW_LITERAL_BRACE.some((k) => key.endsWith(k))) continue
        scanned++
        const rest = text.replace(/\{\{[^}]*\}\}/g, '')
        const hits = rest.match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g)
        if (hits) bad.push(`${loc} ${key} → ${hits.join(' ')}`)
      }
    }
    /** 扫到 0 条说明读文件/遍历的规则坏了，那也要红（不许假绿） */
    expect(scanned, '一条文案都没扫到，遍历规则失效了').toBeGreaterThan(500)
    expect(bad, `这些文案的占位符会被原样显示：\n${bad.join('\n')}`).toEqual([])
  })

  it('带参数的文案必须用 {{name}}（反向确认扫描规则真的认得合法写法）', () => {
    const withParams = values(load('zh-CN')).filter(([, t]) => /\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}/.test(t))
    /** 合法写法的数量级摆在那里（memberPicked / memberFound / extract* 修完之后…），
     *  真掉下去说明有人把双花括号也改坏了 */
    expect(withParams.length, '合法占位符一条都没扫到').toBeGreaterThan(80)
  })
})
