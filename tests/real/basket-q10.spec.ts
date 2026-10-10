import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { CategoryConfig, FileEntry, IngestResult } from '../../src/shared/types'
import { classify } from '../../src/main/classify/engine'
import { isBasketOnlyName } from '../../src/main/classify/bundle'
import { loadLexicon, type Lexicon } from '../../src/main/classify/lexicon'

/**
 * Q10 · **只读**：他那 9 个"筐名目录"里，摊出来的每一件各自会被判成什么类。
 *
 * 他 2026-10-10 批的是「本轮只量，改判另开一轮」—— 分类判据一改牵动全库，
 * 混进本轮红了都不知道是谁干的。所以这份文件**一个字节都不写**：
 * 只 `readdirSync` 他的素材库，判据从产品代码 import（不在测试里另抄一份正则）。
 *
 * ⚠ 这一趟和真入库那条流水线的**差别**要说清楚：这里没有 worker 的内容指纹
 * （不解包、不深读 `.unitypackage`、不读 README），证据只有名字与目录结构。
 * 所以它回答的是"名字这一路判成什么"，不能当成"入库后一定就是这个类"。
 *
 *   AVCA_Q10=1 npx vitest run tests/real/basket-q10.spec.ts
 */
const ROOT = path.resolve(__dirname, '../..')
const LIB = process.env.AVCA_Q10_LIB || 'E:/vrc/A'
let lex: Lexicon
let categories: CategoryConfig

beforeAll(() => {
  lex = loadLexicon({ builtin: path.join(ROOT, 'resources/lexicon/lexicon.json') })
  categories = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources/lexicon/categories.json'), 'utf8')) as CategoryConfig
})

const SKIP_DIR = new Set(['Editor', 'Temp', 'Library', '.git', '__MACOSX'])

function listRecursive(absDir: string, prefix = '', depth = 0): FileEntry[] {
  if (depth > 6) return []
  const out: FileEntry[] = []
  for (const e of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (SKIP_DIR.has(e.name)) continue
    const rel = prefix ? prefix + '/' + e.name : e.name
    const abs = path.join(absDir, e.name)
    const isDir = e.isDirectory()
    let size = 0
    try {
      size = isDir ? 0 : fs.statSync(abs).size
    } catch {
      /* 读不到就算 0，这一趟不写任何东西 */
    }
    out.push({ relPath: rel, size, ext: (e.name.split('.').pop() ?? '').toLowerCase(), isDir })
    if (isDir) out.push(...listRecursive(abs, rel, depth + 1))
  }
  return out
}

/** 找到库里所有"名字本身就是筐"的目录（含套在合集里面的那些） */
function findBaskets(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || SKIP_DIR.has(e.name)) continue
    const abs = path.join(dir, e.name)
    if (isBasketOnlyName(e.name)) acc.push(abs)
    findBaskets(abs, acc)
  }
  return acc
}

function ingestFor(absDir: string, entries: FileEntry[]): IngestResult {
  return {
    assetId: 'Q10',
    rawName: path.basename(absDir),
    sourceDirChain: [],
    stagingPath: absDir,
    detectedKind: 'folder',
    detectedFormat: 'dir',
    entries,
    nestedDepth: 1,
    warnings: [],
    totalBytes: entries.reduce((a, e) => a + (e.isDir ? 0 : e.size), 0),
    metadata: {
      urls: [],
      boothItemId: null,
      boothItemIdConfidence: 0,
      sourcePlatform: null,
      version: null,
      localeTag: null,
      author: null,
      readmeText: '',
      previewImages: []
    }
  }
}

describe.skipIf(process.env.AVCA_Q10 !== '1')('Q10 · 筐摊开之后每件判成什么（只读）', () => {
  it('列出来给他看，不改任何东西', () => {
    expect(fs.existsSync(LIB), '库根不在：' + LIB).toBe(true)
    const baskets = findBaskets(LIB)
    console.log('库根：' + LIB)
    console.log('筐名目录：' + baskets.length + ' 处')
    const tally = new Map<string, number>()
    for (const b of baskets) {
      const entries = listRecursive(b)
      const r = classify(ingestFor(b, entries), { lex, categories })
      const names = r.units.map((u) => u.name)
      const cats = r.units.map((u) => u.category + (u.subcategory ? '/' + u.subcategory : ''))
      for (const c of cats) tally.set(c, (tally.get(c) ?? 0) + 1)
      console.log('\n— ' + path.relative(LIB, b).split('\\').join('/') + '（摊出 ' + r.units.length + ' 项）')
      r.units.forEach((u, i) => {
        console.log(
          '   ' +
            (i + 1) +
            '. ' +
            u.name +
            ' → ' +
            cats[i] +
            '　置信度 ' +
            Math.round(u.confidence * 100) +
            '%' +
            (u.status === 'pending_confirm' ? '　【会停在待确认】' : '')
        )
      })
      if (names.length !== new Set(names).size) console.log('   ⚠ 有重名：' + names.filter((n, i) => names.indexOf(n) !== i).join('、'))
    }
    console.log('\n类别分布：' + [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => k + '×' + v).join('　'))
  }, 300000)
})
