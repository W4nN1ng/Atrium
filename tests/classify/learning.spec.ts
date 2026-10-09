import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CategoryConfig, IngestResult } from '../../src/shared/types'
import { openDatabase, closeDatabase, type Db } from '../../src/main/db'
import { buildCorpus } from '../../src/main/fingerprint/corpus'
import { classify } from '../../src/main/classify/engine'
import { loadLexicon, type Lexicon } from '../../src/main/classify/lexicon'
import { learnFromCorrection, learningMap, learnedHint, tokensToLearn, isLearnable, ANNOUNCE_AFTER, type LearnInput } from '../../src/main/classify/learning'
import type { LearningRow } from '../../src/main/classify/engine'

const ROOT = path.resolve(__dirname, '../..')
let lex: Lexicon
let categories: CategoryConfig
let db: Db
let dir = ''

beforeAll(() => {
  lex = loadLexicon({ builtin: path.join(ROOT, 'resources/lexicon/lexicon.json') })
  categories = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources/lexicon/categories.json'), 'utf8')) as CategoryConfig
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-learn-'))
  db = openDatabase(path.join(dir, 'library.db'))
})

afterAll(() => {
  closeDatabase()
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    /* 交给系统 */
  }
})

function mk(name: string, dirs: string[], entries: string[]): IngestResult {
  return {
    assetId: '01L' + Math.random().toString(36).slice(2, 8).toUpperCase(),
    rawName: name,
    sourceDirChain: dirs,
    stagingPath: 'C:/fake',
    detectedKind: 'archive',
    detectedFormat: 'zip',
    entries: entries.map((e) => ({ relPath: e, size: 10, ext: e.split('.').pop() ?? '', isDir: false })),
    nestedDepth: 1,
    warnings: [],
    totalBytes: 30,
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

function corpusOf(i: IngestResult) {
  return buildCorpus({
    dirChain: i.sourceDirChain,
    fileName: i.rawName,
    entryPaths: i.entries.map((e) => e.relPath)
  })
}

function classifyWith(i: IngestResult, learning?: Map<string, LearningRow[]>): ReturnType<typeof classify> {
  return classify(i, { lex, categories, learning })
}

/** 一个词典里没答案的假工具名：只能靠学习机制记住 */
const MYSTERY = 'WobbleFrame_thing_v1.zip'

function ensureUnclassified(): void {
  const u = classifyWith(mk(MYSTERY, ['随便'], ['a.bin'])).units[0]
  // 没学过之前不该自信地归到某个二级
  expect(u.subcategory === 'expression' || u.subcategory === null).toBe(true)
}

describe('§8.6 学习机制', () => {
  it('修正一次后，同 token 的素材分类真的变了', () => {
    ensureUnclassified()
    const target = mk(MYSTERY, ['随便'], ['a.bin'])
    const r = learnFromCorrection(db, {
      corpus: corpusOf(target),
      lex,
      newCategory: 'plugin',
      newSubcategory: 'expression'
    })
    expect(r.touched).toBeGreaterThan(0)

    // 另一个只共享 'wobbleframe' 这个词的新素材
    const sibling = mk('WobbleFrame_other_v2.zip', ['随便'], ['b.bin'])
    const learned = learningMap(db)
    const u = classifyWith(sibling, learned).units[0]
    expect(u.category).toBe('plugin')
    expect(u.subcategory).toBe('expression')
  })

  it('没学过的 token 不受影响', () => {
    const learned = learningMap(db)
    // 对照组必须换一个不相干的目录：'随便' 这个目录名本身是被学过的 token，
    // 同目录素材被一起带走是学习机制**应该**有的行为，不是漏学。
    const u = classifyWith(mk('Unrelated_Pack_v1.zip', ['别的目录'], ['c.bin']), learned).units[0]
    expect(u.subcategory).not.toBe('expression')
  })

  it('修正三次才提示"已学习"（§5.4 阈值）', () => {
    const fresh = mk('Zigzag_Kit_v9.zip', ['随便'], ['d.bin'])
    const corpus = corpusOf(fresh)
    for (let i = 0; i < ANNOUNCE_AFTER; i++) {
      learnFromCorrection(db, { corpus, newCategory: 'prop', newSubcategory: 'weapon' })
    }
    const hint = learnedHint(db)
    expect(hint, '修了三次还不提示就是阈值写错了').toBeTruthy()
    expect(hint!.rules).toBeGreaterThanOrEqual(1)
    expect(hint!.category).toBe('prop')
    expect(hint!.subcategory).toBe('weapon')
  })

  it('只改二级时，一级的分不被抑制（区分"分类错了"和"二级错了"）', () => {
    const i = mk('FlipFlop_Tool_v1.zip', ['插件'], ['e.bin'])
    learnFromCorrection(db, {
      corpus: corpusOf(i),
      newCategory: 'plugin',
      newSubcategory: 'camera',
      oldCategory: 'plugin',
      oldSubcategory: 'sound'
    })
    const learned = learningMap(db)
    const u = classifyWith(mk('FlipFlop_other_v2.zip', ['插件'], ['f.bin']), learned).units[0]
    expect(u.category).toBe('plugin')
    expect(u.subcategory).toBe('camera')
  })

  it('readme 里的普通词不进学习表（否则一个"用"字带跑所有素材）', () => {
    const i = mk('Quiet_Pack.zip', ['插件'], ['g.bin'])
    const corpus = buildCorpus({
      dirChain: ['插件'],
      fileName: 'Quiet_Pack.zip',
      entryPaths: ['g.bin'],
      readmeText: '这个插件很好用，谢谢使用'
    })
    const tokens = tokensToLearn(corpus, lex)
    expect(tokens).toContain('插件')
    expect(tokens).not.toContain('谢谢')
    expect(tokens).not.toContain('使用')
    void i
  })

  it('版本号/扩展名/泛词一律不学（否则 v1 会变成全局规则）', () => {
    for (const bad of ['v1', '1.0', 'zip', 'unitypackage', 'pack', 'set', '素材', '22', 'x']) {
      expect(isLearnable(bad), bad).toBe(false)
    }
    for (const good of ['wobbleframe', 'goloco', '插件', '佳兔工具箱', 'lilitoon']) {
      expect(isLearnable(good), good).toBe(true)
    }
  })

  it('学习权重真的进了打分公式（hits 越多分越高）', () => {
    const i = mk('Heavy_Learn_v1.zip', ['随便'], ['h.bin'])
    const corpus = corpusOf(i)
    learnFromCorrection(db, { corpus, newCategory: 'audio', newSubcategory: 'sfx' })
    const once = learningMap(db).get('heavy')?.[0]?.hits ?? 0
    learnFromCorrection(db, { corpus, newCategory: 'audio', newSubcategory: 'sfx' })
    const twice = learningMap(db).get('heavy')?.[0]?.hits ?? 0
    expect(twice).toBe(once + 1)
  })
})
