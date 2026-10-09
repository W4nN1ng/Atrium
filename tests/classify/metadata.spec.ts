import { describe, it, expect } from 'vitest'
import iconv from 'iconv-lite'
import {
  extractMetadata,
  extractVersion,
  extractUrls,
  parseInternetShortcut,
  stripHtml,
  detectAuthor,
  detectLocale,
  guessItemIdFromDirs,
  pickPlatform,
  pickPreviewImages,
  type SourceReader,
  type SourceFile
} from '../../src/main/fingerprint/metadata'
import { decodeText } from '../../src/main/unpack/encoding'

/** 内存版 reader：单测不碰磁盘，但解码必须走真 decodeText（cp932 那条就是要验它） */
function memReader(map: Record<string, Buffer | string>): SourceReader {
  const files: SourceFile[] = Object.entries(map).map(([relPath, v]) => ({
    relPath,
    size: typeof v === 'string' ? Buffer.byteLength(v) : v.length,
    isDir: false
  }))
  return {
    files: () => files,
    readText: async (rel: string): Promise<string | null> => {
      const v = map[rel]
      if (v === undefined) return null
      const buf = typeof v === 'string' ? Buffer.from(v, 'utf8') : v
      if (buf.length === 0) return null
      return decodeText(buf).text
    }
  }
}

describe('extractVersion', () => {
  it('取最后一个匹配，而不是第一个', () => {
    expect(extractVersion('ABT 1.3.0【汉化 闲鱼@月见汐音】')).toBe('1.3.0')
    expect(extractVersion('Grimoir_SHINANO_V1.0')).toBe('1.0')
    expect(extractVersion('mod2.1 final3.5.2')).toBe('3.5.2')
  })

  it('不许把 Unity 版本串当成素材版本', () => {
    expect(extractVersion('ProjectVersion 2022.3.22f1')).toBeNull()
    expect(extractVersion('works with 2021.3.0p1 only')).toBeNull()
  })

  it('四位数年份开头的不收', () => {
    expect(extractVersion('backup 2024.05.01')).toBeNull()
  })

  it('没有版本就返回 null', () => {
    expect(extractVersion('Shinano FaceAnimation')).toBeNull()
  })
})

describe('URL 与平台', () => {
  it('能从 Windows .url 文件里读出 booth 链接和商品 id（§7 特例 8）', async () => {
    const urlFile = '[InternetShortcut]\r\nURL=https://booth.pm/ja/items/3087170\r\n\r\n'
    const md = await extractMetadata({
      fileName: 'lilToon - BOOTH.url',
      dirChain: ['lilToon_2.x.x'],
      reader: memReader({ 'lilToon - BOOTH.url': urlFile })
    })
    expect(md.urls[0]).toBe('https://booth.pm/ja/items/3087170')
    expect(md.boothItemId).toBe('3087170')
    expect(md.sourcePlatform).toBe('booth')
    expect(md.boothItemIdConfidence).toBeGreaterThanOrEqual(0.9)
  })

  it('github / gumroad / 爱发电 都认', () => {
    expect(pickPlatform(['https://github.com/rurre/Palm-Island']).platform).toBe('github')
    expect(pickPlatform(['https://gumroad.com/l/some-mod']).platform).toBe('gumroad')
    expect(pickPlatform(['https://afdian.net/@someone']).platform).toBe('afdian')
    expect(pickPlatform(['https://example.com/x']).platform).toBe('other')
  })

  it('纯数字目录名只给"疑似"置信度，不能直接断言（§1.3）', () => {
    expect(guessItemIdFromDirs(['R5613-VRChat-武器合集（军事武器合集）', '4185283', 'MAD HATER .45'])).toBe('4185283')
    expect(guessItemIdFromDirs(['插件', '6866030亲亲音效+亲吻时产生爱心粒子'])).toBe('6866030')
    expect(guessItemIdFromDirs(['插件', 'shinano表情'])).toBeNull()
  })

  it('id 直接粘在中文名字前面也要拆出来', async () => {
    const md = await extractMetadata({
      fileName: '6718483Milfy妆容.zip',
      dirChain: ['贴图', '6718483Milfy妆容'],
      reader: memReader({})
    })
    expect(md.boothItemId).toBe('6718483')
    expect(md.boothItemIdConfidence).toBeLessThan(0.5)
  })

  it('URL 结尾的标点和全角括号不吃进去', () => {
    const u = extractUrls('见 https://booth.pm/items/1234567，谢谢')
    expect(u[0]).toBe('https://booth.pm/items/1234567')
  })
})

describe('HTML 与编码', () => {
  it('HTML 必须先剥标签再入语料', () => {
    const s = stripHtml('<html><head><style>a{b:c}</style></head><body><h1>導入方法</h1><p>Assets 下<br>放置<script>x()</script></body></html>')
    expect(s).toContain('導入方法')
    expect(s).toContain('放置')
    expect(s).not.toContain('<')
    expect(s).not.toContain('b:c')
  })

  it('cp932/Shift-JIS 的日文说明要能读出来（§8.5）', async () => {
    const ja = 'このアセットは表情変更用です。利用規約をよくお読みください。'
    const bytes = iconv.encode(ja, 'cp932')
    // 验的是"这堆字节不是 UTF-8 能解的"，而不是某个具体字节值
    expect(bytes.equals(Buffer.from(ja, 'utf8'))).toBe(false)
    expect(decodeText(bytes).text).toContain('表情変更用')
    const md = await extractMetadata({
      fileName: '説明文.txt',
      dirChain: ['插件', 'shinano表情'],
      reader: memReader({ '説明文.txt': bytes })
    })
    expect(md.readmeText).toContain('表情変更用')
    expect(md.localeTag).toBe('日本語')
  })
})

describe('作者与语言标记', () => {
  it('【汉化 闲鱼@月见汐音】→ author=月见汐音、locale=汉化（§7 特例 3）', () => {
    expect(detectAuthor('ABT 1.3.0【汉化 闲鱼@月见汐音】')).toBe('月见汐音')
    expect(detectLocale('ABT 1.3.0【汉化 闲鱼@月见汐音】')).toBe('汉化')
  })

  it('有汉化标记时不许判成日文（哪怕名字里有假名）', () => {
    expect(detectLocale('日本語原版 汉化 by Yama')).toBe('汉化')
    expect(detectLocale('日本語版そのまま')).toBe('日本語')
  })

  it('by xxx 与 @xxx 两种署名都认', () => {
    expect(detectAuthor('CoolShader by Rurre')).toBe('Rurre')
    expect(detectAuthor('some pack @mochi_tei')).toBe('mochi_tei')
  })
})

describe('封面图优先级', () => {
  const files: SourceFile[] = [
    { relPath: 'a/preview.png', size: 100, isDir: false },
    { relPath: 'a/01.png', size: 900, isDir: false },
    { relPath: 'b/source.psd', size: 5000, isDir: false },
    { relPath: 'README.md', size: 10, isDir: false }
  ]
  it('preview/封面/サムネ 排最前，psd 不当封面', () => {
    const picks = pickPreviewImages(files)
    expect(picks[0]).toBe('a/preview.png')
    expect(picks).not.toContain('b/source.psd')
  })
  it('没有图就返回空数组', () => {
    expect(pickPreviewImages([{ relPath: 'x/readme.txt', size: 1, isDir: false }])).toEqual([])
  })
})

describe('extractMetadata 汇总', () => {
  it('名字里什么信息都有时，各字段各就各位', async () => {
    const md = await extractMetadata({
      fileName: 'LightControllerV2.0.3.1.unitypackage',
      dirChain: ['插件', '灯光'],
      reader: memReader({ 'Readme.txt': '灯光控制器，交互用。' })
    })
    expect(md.version).toBe('2.0.3.1')
    expect(md.readmeText).toContain('灯光控制器')
    expect(md.boothItemId).toBeNull()
  })

  it('空来源不许抛，返回空壳', async () => {
    const md = await extractMetadata({ fileName: 'abc.zip', dirChain: [], reader: memReader({}) })
    expect(md.urls).toEqual([])
    expect(md.previewImages).toEqual([])
    expect(md.version).toBeNull()
  })
})
