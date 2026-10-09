import { describe, it, expect } from 'vitest'
import { searchForms, searchKey, stripSymbols, expandQuery } from '../../src/shared/normalize'

const has = (s: string, forms: string[]): boolean => forms.some((f) => f === s || f.includes(s))

describe('F5 检索归一化 —— 规格点名的两个例子', () => {
  it('输 shinano 能搜到 しなの / シナノ', () => {
    expect(searchForms('しなの').all).toContain('shinano')
    expect(searchForms('シナノ').all).toContain('shinano')
    // 反过来：搜日文也能命中罗马字写法
    expect(searchForms('Shinano').all.some((f) => f.includes('shinano'))).toBe(true)
  })

  it('输 yifu 能搜到 衣服', () => {
    const f = searchForms('衣服').all
    expect(f).toContain('yifu')
    expect(f).toContain('yi fu')
    expect(f).toContain('衣服')
  })
})

describe('分段转换（整串丢给库会出事）', () => {
  it('拉丁字母不许被 pinyin 逐字母拆开加空格', () => {
    const f = searchForms('Grimoir_SHINANO_V1.0').all
    expect(f.some((x) => /g\s+r\s+i/.test(x)), '出现了 G r i m o i r 这种碎串：' + f.join(' | ')).toBe(false)
    expect(f.some((x) => x.includes('grimoir'))).toBe(true)
    expect(f.some((x) => x.includes('shinano'))).toBe(true)
  })

  it('汉字+假名混排要两边都转（束縛チャイナ）', () => {
    const f = searchForms('束縛チャイナFULLSET').all
    expect(has('chaina', f), f.join(' | ')).toBe(true)
    expect(has('shufu', f), f.join(' | ')).toBe(true)
    expect(has('fullset', f), f.join(' | ')).toBe(true)
  })

  it('长音给出折叠变体（カー → kaa 与 ka）', () => {
    const f = searchForms('スカート').all
    expect(has('sukaato', f), f.join(' | ')).toBe(true)
    expect(has('sukato', f), f.join(' | ')).toBe(true)
  })

  it('浊音半浊音不许被分解成「清音+组合音标」', () => {
    // NFKD 会把 バ 拆成 ハ+U+3099，那个码点不在拉丁音标范围内删不掉，
    // 于是 toRomaji 出来是 'ha゙'：搜「ソクバク」会产出带组合音标的怪 token，
    // 单搜一个「バ」都能匹配出无关素材（实测踩过）。
    expect(searchForms('ソクバク').translit).toContain('sokubaku')
    expect(searchForms('ぐ').translit).toContain('gu')
    expect(searchForms('パ').translit).toContain('pa')
    for (const s of ['ソクバク', 'ぐ', 'パ', 'スカート']) {
      for (const form of searchForms(s).all) {
        expect(form, s + ' → ' + form).not.toMatch(/[゙゚]/)
      }
    }
  })

  it('纯数字与中英混排不炸', () => {
    expect(searchForms('6117553 Shinano_FaceAnimation.rar.rar').all.length).toBeGreaterThan(1)
    expect(searchForms('插件/动作类').all.some((x) => x.includes('dongzuo'))).toBe(true)
    expect(searchForms('').all).toEqual([])
    expect(searchForms('   ').all).toEqual([])
    expect(searchForms('———').all.length).toBeGreaterThanOrEqual(0)
  })
})

describe('符号与全角', () => {
  it('全角折半角、兼容分解', () => {
    expect(stripSymbols('ＡＢＣ（测试）')).toContain('ABC')
    expect(searchKey('（重要）説明書')).toBe('重要 説明書')
  })

  it('searchKey 稳定且幂等', () => {
    const k = searchKey('Grimoir SHINANO V1.0')
    expect(searchKey(k)).toBe(k)
  })

  it('expandQuery 和 searchForms 同一套口径（输入框与索引不会各写一半）', () => {
    expect(expandQuery('衣服')).toEqual(searchForms('衣服').all)
  })
})
