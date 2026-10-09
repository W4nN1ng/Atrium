import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  COVER_NONE,
  isImageName,
  listImageFiles,
  pickCoverCandidate,
  thumbKeyFromUrl,
  thumbKeyOf,
  thumbUrlFor
} from '../../src/main/library/thumbRules'

/**
 * 封面"挑哪张图"的规则。用户扫一眼卡片就知道挑得对不对，
 * 所以这部分必须能脱离 Electron 单测（写文件那半在 thumbs.ts）。
 */

let dir = ''

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-thumbs-'))
})
afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    /* 临时目录交给系统 */
  }
})

const f = (absPath: string, size: number): { absPath: string; size: number } => ({ absPath, size })

describe('挑封面', () => {
  it('名字带 preview/cover 的赢，哪怕它不是最大的', () => {
    const got = pickCoverCandidate([
      f('C:/x/Assets/Body/Model_diffuse.png', 9 * 1024 * 1024),
      f('C:/x/preview.png', 2 * 1024 * 1024)
    ])
    expect(path.basename(got ?? '')).toBe('preview.png')
  })

  it('日文/中文命名也认（カバー・封面・一览）', () => {
    expect(path.basename(pickCoverCandidate([f('/a/封面.png', 100000), f('/a/mesh_diffuse.png', 900000)]) ?? '')).toBe('封面.png')
    expect(path.basename(pickCoverCandidate([f('/a/サンプル.gif', 500000), f('/a/一覧.png', 100000)]) ?? '')).toBe('一覧.png')
  })

  it('没提示词时选大的，但封顶 8MB：40MB 的图不会因为"大"被选中', () => {
    const got = pickCoverCandidate([
      f('/a/small.png', 300 * 1024),
      f('/a/big.png', 40 * 1024 * 1024)
    ])
    expect(path.basename(got ?? '')).toBe('small.png')
  })

  it('太小的角标和读不懂的格式直接不要', () => {
    expect(pickCoverCandidate([f('/a/icon.png', 900), f('/a/psd.psd', 5 * 1024 * 1024)])).toBeNull()
    expect(pickCoverCandidate([])).toBeNull()
  })

  it('同尺寸下包根目录的赢过三层子目录里的', () => {
    const got = pickCoverCandidate([
      f('/pkg/a/b/c/detail.png', 500000),
      f('/pkg/top.png', 500000)
    ])
    expect(path.basename(got ?? '')).toBe('top.png')
  })

  it('gif 排在 png/jpg 后面（动图当封面会静止）', () => {
    const got = pickCoverCandidate([f('/a/anim.gif', 600000), f('/a/still.png', 500000)])
    expect(path.basename(got ?? '')).toBe('still.png')
  })
})

describe('列目录', () => {
  it('只往下走两层，且跳过 . 开头的目录', () => {
    const root = path.join(dir, 'scan')
    fs.mkdirSync(path.join(root, 'sub', 'deep', 'deeper'), { recursive: true })
    fs.mkdirSync(path.join(root, '.hidden'), { recursive: true })
    fs.writeFileSync(path.join(root, 'a.png'), Buffer.alloc(4000))
    fs.writeFileSync(path.join(root, 'sub', 'b.jpg'), Buffer.alloc(4000))
    fs.writeFileSync(path.join(root, 'sub', 'deep', 'c.webp'), Buffer.alloc(4000))
    fs.writeFileSync(path.join(root, 'sub', 'deep', 'deeper', 'd.png'), Buffer.alloc(4000))
    fs.writeFileSync(path.join(root, '.hidden', 'e.png'), Buffer.alloc(4000))
    fs.writeFileSync(path.join(root, 'readme.txt'), 'not an image')
    // 深度 2 = 根目录 + 往下层。为一个封面把五万文件的包扫穿是本末倒置。
    const names = listImageFiles(root).map((x) => path.basename(x.absPath)).sort()
    expect(names).toEqual(['a.png', 'b.jpg'])
    // 想看深一层就把 depth 调大，说明确实是"层数"卡住而不是漏扫
    expect(listImageFiles(root, 400, 3).map((x) => path.basename(x.absPath)).sort()).toEqual([
      'a.png',
      'b.jpg',
      'c.webp'
    ])
  })

  it('目录不存在时返回空而不是抛', () => {
    expect(listImageFiles(path.join(dir, '没有这个目录'))).toEqual([])
  })
})

describe('athumb 地址', () => {
  it('往返一致', () => {
    const url = thumbUrlFor('1f7d0bb8f950e33e')
    expect(url).toBe('athumb://1f7d0bb8f950e33e.jpg')
    expect(thumbKeyFromUrl(url)).toBe('1f7d0bb8f950e33e')
  })

  it('键只允许字母数字下划线点横杠（哈希和 ULID 就这些字符）', () => {
    expect(thumbKeyFromUrl('athumb://01J4M2X8K9FQ3ZT.jpg')).toBe('01J4M2X8K9FQ3ZT')
    expect(thumbKeyFromUrl('athumb://带空格.jpg')).toBeNull()
    expect(thumbKeyFromUrl('athumb://a%20b.jpg')).toBeNull()
  })

  it('Chromium 把 standard 协议的地址规范化成 host + 尾斜杠，两种都要认', () => {
    // 实测：渲染进程里 fetch('athumb://xxx.jpg')，主进程收到的 request.url 是带尾斜杠的
    expect(thumbKeyFromUrl('athumb://1f7d0bb8f950e33e.jpg/')).toBe('1f7d0bb8f950e33e')
    expect(thumbKeyFromUrl('athumb://1f7d0bb8f950e33e.jpg')).toBe('1f7d0bb8f950e33e')
    // 写成路径形式的（自己拼的 URL）也要能解
    expect(thumbKeyFromUrl('athumb:///1f7d0bb8f950e33e.jpg')).toBe('1f7d0bb8f950e33e')
  })

  it('路径穿越与别的协议一律拒绝', () => {
    expect(thumbKeyFromUrl('athumb://../library.db')).toBeNull()
    expect(thumbKeyFromUrl('athumb://a/../../windows/win.ini')).toBeNull()
    expect(thumbKeyFromUrl('athumb://C:/Windows/win.ini')).toBeNull()
    expect(thumbKeyFromUrl('file:///C:/Windows/win.ini')).toBeNull()
    expect(thumbKeyFromUrl('http://a/b.jpg')).toBeNull()
    expect(thumbKeyFromUrl('')).toBeNull()
    // 多级路径只取最后一段，且段里不许有 .. —— 拼出来的路径永远在缩略图目录内
    expect(thumbKeyFromUrl('athumb://a/b.jpg')).toBe('b')
  })

  it("'none' 这个记号不会被当成地址", () => {
    expect(COVER_NONE).toBe('none')
    expect(thumbKeyFromUrl(COVER_NONE)).toBeNull()
  })

  it('有哈希用哈希，没哈希才用 id（同内容换名字不重做缩略图）', () => {
    expect(thumbKeyOf({ id: '01ABC', hash_xxh64: 'deadbeef' })).toBe('deadbeef')
    expect(thumbKeyOf({ id: '01ABC', hash_xxh64: null })).toBe('01ABC')
  })
})

describe('isImageName', () => {
  it('大小写混排与多后缀', () => {
    expect(isImageName('A.PNG')).toBe(true)
    expect(isImageName('x.tar.gz')).toBe(false)
    expect(isImageName('noext')).toBe(false)
    expect(isImageName('a.psd')).toBe(false)
  })
})
