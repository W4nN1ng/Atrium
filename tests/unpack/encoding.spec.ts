import { describe, it, expect } from 'vitest'
import iconv from 'iconv-lite'
import { decodeText, decodeUtf8Strict, decodeZipName, normalizeEntryPath } from '../../src/main/unpack/encoding'

describe('decodeText', () => {
  it('纯 ASCII 走 UTF-8', () => {
    const r = decodeText(Buffer.from('Grimoir_SHINANO_V1.0.txt', 'latin1'))
    expect(r.encoding).toBe('UTF-8')
    expect(r.text).toBe('Grimoir_SHINANO_V1.0.txt')
  })

  it('UTF-8 BOM 会被识别并去掉 BOM', () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('说明：这是汉化版', 'utf8')])
    const r = decodeText(buf)
    expect(r.encoding).toBe('UTF-8(BOM)')
    expect(r.text).toBe('说明：这是汉化版')
  })

  it('合法 UTF-8 中文不会被误判成 cp932', () => {
    const r = decodeText(Buffer.from('初音的VRC小店/道具22件', 'utf8'))
    expect(r.encoding).toBe('UTF-8')
    expect(r.text).toBe('初音的VRC小店/道具22件')
  })

  it('Shift-JIS 的日文 readme 能正确解出来（这是本库最常见的坑）', () => {
    const sjis = iconv.encode('こちらの素材はShinano専用です。無断転載禁止。', 'cp932')
    // 确认这段字节按 UTF-8 严格解是坏的，才会落到 cp932 分支
    expect(decodeUtf8Strict(sjis)).toBeNull()
    const r = decodeText(sjis)
    expect(r.encoding).toBe('cp932')
    expect(r.text).toBe('こちらの素材はShinano専用です。無断転載禁止。')
  })

  it.each([
    'こちらの素材はShinano専用です。無断転載禁止。',
    '導入方法と利用規約を必ずお読みください。',
    '衣装の着せ替えについて/説明書.txt',
    '改変済みアバターをアップロードする前に確認してください。',
    '取扱説明書.txt'
  ])('EUC-JP の漢字を含む説明文を正しく読む: %s', (text) => {
    expect(decodeText(iconv.encode(text, 'euc-jp'))).toEqual({ text, encoding: 'EUC-JP' })
  })

  it('GBK 的中文说明在 cp932 解不通时回退到 GBK', () => {
    const gbk = iconv.encode('本素材仅供个人使用，禁止二次上传到任何平台。', 'gbk')
    const r = decodeText(gbk)
    expect(['GBK', 'cp932']).toContain(r.encoding)
    // 至少不能留替换符
    expect(r.text).not.toContain('\uFFFD')
  })

  it.each([
    '本素材仅供个人使用，禁止二次上传到任何平台。',
    '汉化说明/使用方法.txt',
    '日本语说明/うまくいかない时.txt',
    'しなの表情说明.txt',
    'FREE無料'
  ])('GBK 与 EUC-JP 字节区重叠时保留中文: %s', (text) => {
    expect(decodeText(iconv.encode(text, 'gbk'))).toEqual({ text, encoding: 'GBK' })
  })

  it.each([
    '導入方法と利用規約を必ずお読みください。',
    '衣装の着せ替えについて/説明書.txt',
    '表情の変更方法/使い方.txt'
  ])('增加 EUC-JP 后仍能读取 Shift-JIS: %s', (text) => {
    expect(decodeText(iconv.encode(text, 'cp932'))).toEqual({ text, encoding: 'cp932' })
  })

  it('UTF-16LE 带 BOM 能读', () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Readme 说明', 'utf16le')])
    const r = decodeText(buf)
    expect(r.text).toBe('Readme 说明')
  })

  it('坏码不会返回 U+FFFD', () => {
    const r = decodeText(Buffer.from([0xc3, 0x28, 0xa0, 0xff, 0xfe, 0x00, 0x41]))
    expect(r.text).not.toContain('\uFFFD')
  })

  it('空 buffer 不抛', () => {
    expect(decodeText(Buffer.alloc(0)).encoding).toBe('empty')
  })

  it('截断的 EUC-JP 不能抢走 latin1 的无替换符兜底', () => {
    expect(decodeText(Buffer.from([0xa4, 0xa6, 0xbb]))).toEqual({
      text: '\u00a4\u00a6\u00bb',
      encoding: 'latin1'
    })
  })
})

describe('decodeZipName', () => {
  it('声明 UTF-8 时按 UTF-8 解', () => {
    const raw = Buffer.from('插件/动作类/GoLoco 説明書.txt', 'utf8')
    const r = decodeZipName(raw, true)
    expect(r.name).toBe('插件/动作类/GoLoco 説明書.txt')
    expect(r.encoding).toBe('UTF-8')
  })

  it('没声明 + 字节是 Shift-JIS → 解成日文而不是乱码', () => {
    const name = 'しなの表情／フェイシャル.txt'
    const raw = iconv.encode(name, 'cp932')
    const r = decodeZipName(raw, false)
    expect(r.name).toBe(name)
    expect(r.encoding).toBe('cp932')
  })

  it.each([
    'うまくいかない時.txt',
    '表情の変更方法/使い方.txt',
    '髪の毛の色を変更する方法.txt'
  ])('未声明 UTF-8 的 EUC-JP 文件名不会损坏汉字: %s', (name) => {
    expect(decodeZipName(iconv.encode(name, 'euc-jp'), false)).toEqual({ name, encoding: 'EUC-JP' })
  })

  it('合法且声明为 UTF-8 的日文不参与旧编码猜测', () => {
    const name = 'うまくいかない時/取扱説明書.txt'
    expect(decodeZipName(Buffer.from(name, 'utf8'), true)).toEqual({ name, encoding: 'UTF-8' })
  })

  it('错误声明 UTF-8 的 EUC-JP 文件名仍可恢复', () => {
    const name = 'うまくいかない時.txt'
    expect(decodeZipName(iconv.encode(name, 'euc-jp'), true)).toEqual({ name, encoding: 'EUC-JP' })
  })

  it('声明了 UTF-8 但字节其实是坏的，也不会返回 U+FFFD', () => {
    const r = decodeZipName(Buffer.from([0xff, 0xfe, 0x41, 0x42, 0x43]), true)
    expect(r.name).not.toContain('\uFFFD')
    expect(r.name.length).toBeGreaterThan(0)
  })
})

describe('normalizeEntryPath', () => {
  it('统一分隔符并去掉 ./ 前缀', () => {
    expect(normalizeEntryPath('.\\Assets\\Foo\\Bar.prefab')).toBe('Assets/Foo/Bar.prefab')
    expect(normalizeEntryPath('./a/b/c.txt')).toBe('a/b/c.txt')
    expect(normalizeEntryPath('  名前.txt  ')).toBe('名前.txt')
  })
})
it('does not reinterpret a single ambiguous GBK Kanji using weak EUC-JP evidence', () => {
  expect(decodeZipName(iconv.encode('箕.txt', 'gbk'), false).name).toBe('箕.txt')
})
