import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildCorpus, tokenize, stripJunk, stripExt, POSITION_WEIGHT } from '../../src/main/fingerprint/corpus'
import { loadLexicon } from '../../src/main/classify/lexicon'

const ROOT = path.resolve(__dirname, '../..')
const lex = loadLexicon({ builtin: path.join(ROOT, 'resources/lexicon/lexicon.json') })

describe('stripJunk / stripExt', () => {
  it('剥掉 Unity 排序前缀和 VRCFury 生成物后缀', () => {
    expect(stripJunk('!UIMenu')).toBe('UIMenu')
    expect(stripJunk('#[Camera]')).toContain('Camera')
    expect(stripJunk('ModularAvatarMenuInstaller__Generated')).toBe('ModularAvatarMenuInstaller')
    expect(stripJunk('~优先显示')).toBe('优先显示')
  })
  it('扩展名只去最后一段，版本号里的小数点不动', () => {
    expect(stripExt('LightControllerV2.0.3.1.unitypackage')).toBe('LightControllerV2.0.3.1')
    expect(stripExt('Grimoir_SHINANO_V1.0.zip')).toBe('Grimoir_SHINANO_V1.0')
    expect(stripExt('noext')).toBe('noext')
  })
})

describe('tokenize', () => {
  it('保留未切分整串，同时给出切分结果', () => {
    const t = tokenize('Grimoir_SHINANO_V1.0')
    expect(t).toContain('grimoir')
    expect(t).toContain('shinano')
    expect(t).toContain('grimoir_shinano_v1.0')
  })

  it('camelCase 再切一刀，让 FaceAnimation 能命中 face / animation', () => {
    const t = tokenize('Shinano_FaceAnimation')
    expect(t).toContain('face')
    expect(t).toContain('animation')
    expect(t).toContain('faceanimation')
  })

  it('CJK 不做空格分词，但滑窗能命中 2~6 字子串', () => {
    const t = tokenize('插件道具合集-初音的VRC小店')
    expect(t).toContain('插件')
    expect(t).toContain('合集')
    expect(t).toContain('插件道具合集')
    const m = tokenize('神楽坂雫衣装セット')
    expect(m).toContain('衣装')
    expect(m).toContain('神楽坂雫衣装セット')
  })

  it('太长的 CJK 串不滑窗（防组合爆炸）', () => {
    const long = '一'.repeat(80)
    expect(tokenize(long).length).toBeLessThan(20)
  })

  it('纯 ASCII 短词与空串不进表', () => {
    expect(tokenize('a')).toEqual([])
    expect(tokenize('')).toEqual([])
  })
})

describe('buildCorpus 权重', () => {
  const corpus = buildCorpus({
    dirChain: ['插件', 'shinano表情'],
    fileName: '6117553 Shinano_FaceAnimation.rar.rar',
    entryPaths: ['FREE無料-Shinano10FaceAnimation.zip', 'Assets/Face/FaceEmoMenu.anim'],
    readmeText: '这是一个表情插件，包含まばたき与リップシンク'
  })

  it('同一个词多处出现时取最大权重，不相加', () => {
    const shinano = corpus.best.get('shinano')
    expect(shinano).toBeTruthy()
    expect(shinano?.weight).toBe(POSITION_WEIGHT.file)
    // face 是从文件名 Shinano_FaceAnimation 的 camelCase 切出来的 → 拿文件名的 3.0
    expect(corpus.best.get('face')?.weight).toBe(POSITION_WEIGHT.file)
    // 只在包内路径出现的词才吃 2.0
    expect(corpus.best.get('faceemomenu')?.weight).toBe(POSITION_WEIGHT.entry)
  })

  it('目录名权重 2.5、包内路径 2.0、readme 1.0 都各就各位', () => {
    expect(corpus.best.get('插件')?.weight).toBe(POSITION_WEIGHT.dir)
    expect(corpus.best.get('表情')?.weight).toBeGreaterThan(POSITION_WEIGHT.readme - 0.001)
    expect(corpus.best.get('faceemomenu')?.where).toBe('entry')
  })

  it('readme token 有上限，不会被长文本冲爆', () => {
    const big = buildCorpus({
      dirChain: [],
      fileName: 'x.zip',
      entryPaths: [],
      readmeText: '词'.repeat(1) + '\n' + Array.from({ length: 5000 }, (_, i) => 'token' + i).join('\n')
    })
    expect(big.tokens.length).toBeLessThan(1200)
  })

  it('语料里的词真能查到词典（打通 corpus → lexicon）', () => {
    const hits = corpus.tokens
      .map((t) => ({ t, e: lex.lookup(t.term) }))
      .filter((x) => x.e)
      .map((x) => x.t.term + '→' + x.e?.dim + ':' + (x.e?.cat ?? '-'))
    expect(hits.join(' ')).toContain('shinano→avatar')
    expect(hits.join(' ')).toContain('插件→theme:plugin')
  })
})

describe('词典本体', () => {
  it('规模够 §6 要求的 ≥600 条，且 15 个一级分类都有词', () => {
    expect(lex.size()).toBeGreaterThanOrEqual(600)
    expect(lex.categories().length).toBe(15)
  })

  it('用户词典同词覆盖内置（改权重立刻生效）', () => {
    const tmp = path.join(process.env.TEMP || process.env.TMP || '.', 'avca-lex-user.json')
    fs.writeFileSync(
      tmp,
      JSON.stringify({ entries: [{ term: 'abt', cat: 'animation', sub: 'action', w: 5, dim: 'tool' }] })
    )
    try {
      const merged = loadLexicon({ builtin: path.join(ROOT, 'resources/lexicon/lexicon.json'), user: tmp })
      expect(merged.lookup('abt')?.cat).toBe('animation')
      expect(lex.lookup('abt')?.cat).toBe('plugin')
    } finally {
      fs.rmSync(tmp, { force: true })
    }
  })

  it('连写与带空格两种写法都能命中', () => {
    expect(lex.lookup('face animation')?.dim).toBeTruthy()
    expect(lex.lookup('GO GO LOCO')?.cat).toBe('plugin')
    expect(lex.lookup('gogoloco')?.sub).toBe('action')
  })
})
