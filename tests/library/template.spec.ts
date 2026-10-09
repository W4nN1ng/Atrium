import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { renderSegments, sanitizeSegment, uniqueSuffix, renderRelativeDir } from '../../src/main/library/template'

const names = new Map<string, string>([
  ['plugin', '插件'],
  ['plugin/action', '动作类'],
  ['clothing', '服装'],
  ['other/未归类', '未归类']
])

describe('sanitizeSegment：Windows 非法字符清洗', () => {
  it('替换 \\ / : * ? " < > |', () => {
    expect(sanitizeSegment('ABT 右手用【汉化 闲鱼@月见汐音】')).toBe('ABT 右手用【汉化 闲鱼@月见汐音】')
    expect(sanitizeSegment('a:b*c?d<e>f|g')).toBe('a b c d e f g')
    expect(sanitizeSegment('C:\\路径\\x')).toBe('C 路径 x')
  })

  it('去掉结尾的空格与点（Windows 会静默吞掉它们）', () => {
    expect(sanitizeSegment('Shinano FaceAnimation   ')).toBe('Shinano FaceAnimation')
    expect(sanitizeSegment('MAD HATER .45.')).toBe('MAD HATER .45')
    expect(sanitizeSegment('...hidden')).toBe('hidden')
  })

  it('保留扩展名里的点', () => {
    expect(sanitizeSegment('LightController V2.0.3.1')).toBe('LightController V2.0.3.1')
  })

  it('保留名加下划线，不当成设备名', () => {
    expect(sanitizeSegment('CON')).toBe('CON_')
    expect(sanitizeSegment('nul.txt')).toBe('nul.txt_')
    expect(sanitizeSegment('COM1')).toBe('COM1_')
  })

  it('压缩空白、去控制字符', () => {
    expect(sanitizeSegment('初音的   VRC\n小店')).toBe('初音的 VRC 小店')
    expect(sanitizeSegment('a\x01b')).toBe('a b')
  })

  it('超长截断且不切断 emoji 代理对', () => {
    const long = '名'.repeat(300)
    const cut = sanitizeSegment(long, { maxSegment: 100 })
    expect([...cut].length).toBeLessThanOrEqual(100)
    const withEmoji = 'x'.repeat(99) + '😀'
    const c2 = sanitizeSegment(withEmoji, { maxSegment: 100 })
    expect(c2).toBe('x'.repeat(99))
  })

  it('全空输入给兜底名', () => {
    expect(sanitizeSegment('   .  ')).toBe('未命名')
  })
})

describe('renderSegments：目录模板渲染', () => {
  it('默认模板渲染成 一级/二级/资产名', () => {
    const segs = renderSegments(
      '{category}/{subcategory}/{name}',
      { category: 'plugin', subcategory: 'action', name: 'GoLoco v1.8.6' },
      names
    )
    expect(segs).toEqual(['插件', '动作类', 'GoLoco v1.8.6'])
  })

  it('没有二级分类时该段直接消失，不留空目录', () => {
    const segs = renderSegments(
      '{category}/{subcategory}/{name}',
      { category: 'plugin', subcategory: null, name: 'ABT' },
      names
    )
    expect(segs).toEqual(['插件', 'ABT'])
  })

  it('支持 version / avatar / author / year 占位符', () => {
    const segs = renderSegments(
      '{category}/{author}/{name}-{version}',
      { category: 'plugin', subcategory: 'action', name: 'ABT', version: '1.3.0', author: '月见汐音' },
      names
    )
    expect(segs).toEqual(['插件', '月见汐音', 'ABT-1.3.0'])
    const y = renderSegments('{year}/{name}', { name: 'x' }, names)
    expect(y[0]).toBe(String(new Date().getFullYear()))
  })

  it('未知占位符与空值不会产生垃圾目录', () => {
    expect(renderSegments('{bogus}/{name}', { name: 'ok' }, names)).toEqual(['ok'])
    expect(renderSegments('{category}/{name}', { category: 'unknown_key', name: 'ok' }, names)).toEqual([
      'unknown_key',
      'ok'
    ])
  })

  it('全空时用 其他/未归类/ 兜底，绝不返回空数组', () => {
    expect(renderSegments('{category}/{subcategory}', {}, names)).toEqual(['其他', '未归类', '未命名'])
  })

  it('总长超预算时只裁最后一段，分类层级保持完整', () => {
    const longName = '超'.repeat(200)
    const segs = renderSegments(
      '{category}/{subcategory}/{name}',
      { category: 'plugin', subcategory: 'action', name: longName },
      names,
      { totalLimit: 120 }
    )
    expect(segs[0]).toBe('插件')
    expect(segs[1]).toBe('动作类')
    expect(segs.join(path.sep).length).toBeLessThanOrEqual(120)
    expect(segs[2].length).toBeGreaterThan(0)
  })

  it('renderRelativeDir 产出可直接 join 的相对路径', () => {
    const rel = renderRelativeDir(
      '{category}/{subcategory}/{name}',
      { category: 'clothing', subcategory: null, name: 'Grimoir' },
      names
    )
    expect(rel).toBe(['服装', 'Grimoir'].join(path.sep))
  })
})

describe('uniqueSuffix：同名不覆盖', () => {
  it('依次加 (2)(3)', () => {
    const taken = new Set(['E:\\lib\\插件\\GoLoco v1.8.6'])
    expect(uniqueSuffix('E:\\lib\\插件\\GoLoco v1.8.6', (t) => taken.has(t))).toBe(
      'E:\\lib\\插件\\GoLoco v1.8.6 (2)'
    )
    taken.add('E:\\lib\\插件\\GoLoco v1.8.6 (2)')
    expect(uniqueSuffix('E:\\lib\\插件\\GoLoco v1.8.6', (t) => taken.has(t))).toBe(
      'E:\\lib\\插件\\GoLoco v1.8.6 (3)'
    )
    expect(uniqueSuffix('E:\\lib\\插件\\新目录', (t) => taken.has(t))).toBe('E:\\lib\\插件\\新目录')
  })
})
